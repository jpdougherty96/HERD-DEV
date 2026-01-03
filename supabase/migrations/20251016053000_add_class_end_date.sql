-- HERD migration: add classes.end_date + review unlocking support

-- 1. Ensure classes table has an end_date derived from start_date/number_of_days
ALTER TABLE public.classes
  ADD COLUMN IF NOT EXISTS end_date DATE;

-- Backfill existing rows
UPDATE public.classes
SET end_date = CASE
  WHEN start_date IS NULL THEN NULL
  ELSE start_date + (GREATEST(COALESCE(number_of_days, 1), 1) - 1)
END
WHERE end_date IS NULL;

-- Trigger to keep end_date in sync on insert/update
CREATE OR REPLACE FUNCTION public.trg_set_classes_end_date()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.start_date IS NULL THEN
    NEW.end_date := NULL;
  ELSE
    NEW.end_date := NEW.start_date + (GREATEST(COALESCE(NEW.number_of_days, 1), 1) - 1);
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_set_classes_end_date ON public.classes;

CREATE TRIGGER trg_set_classes_end_date
BEFORE INSERT OR UPDATE OF start_date, number_of_days
ON public.classes
FOR EACH ROW
EXECUTE FUNCTION public.trg_set_classes_end_date();

-- 2. Ensure bookings table exposes a review gating flag
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS review_allowed BOOLEAN DEFAULT FALSE;

ALTER TABLE public.bookings
  ALTER COLUMN review_allowed SET DEFAULT FALSE;

UPDATE public.bookings
SET review_allowed = COALESCE(review_allowed, FALSE);

DROP FUNCTION IF EXISTS public.herd_due_payouts(integer);

-- 3. Update payout helper to respect class end dates
CREATE OR REPLACE FUNCTION public.herd_due_payouts(buffer_hours integer)
RETURNS TABLE(
  id uuid,
  class_id uuid,
  host_payout_cents integer,
  stripe_charge_id text,
  host_stripe_account_id text,
  class_end_date date,
  class_end_utc timestamp with time zone
)
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH classes_with_ts AS (
    SELECT
      c.id AS class_id,
      c.host_id,
      COALESCE(c.end_date, c.start_date) AS effective_end_date,
      (
        (
          COALESCE(c.end_date, c.start_date)::text
          || ' '
          || COALESCE(c.start_time::text, '00:00:00')
        )
      )::timestamp AT TIME ZONE 'utc' AS class_end_utc
    FROM public.classes c
  )
  SELECT
    b.id,
    cw.class_id,
    b.host_payout_cents,
    b.stripe_charge_id,
    p.stripe_account_id AS host_stripe_account_id,
    cw.effective_end_date AS class_end_date,
    cw.class_end_utc
  FROM public.bookings b
  JOIN classes_with_ts cw ON cw.class_id = b.class_id
  JOIN public.profiles p ON p.id = cw.host_id
  WHERE b.payment_status = 'HELD'
    AND cw.class_end_utc < now() - (buffer_hours || ' hours')::interval;
$function$;

-- 4. Make sure booking notification vars include end_date
CREATE OR REPLACE FUNCTION public.enqueue_booking_email_job(
  _booking_id uuid,
  _type text,
  _template text,
  _to_email text DEFAULT NULL::text,
  _subject text DEFAULT NULL::text,
  _vars jsonb DEFAULT '{}'::jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
declare
  v record;
  full_address text;
  approve_base text;
  approve_url text;
  decline_url text;
begin
  select
    b.id as booking_id,
    b.class_id,
    b.user_id as guest_id,
    b.qty,
    b.total_cents,
    b.host_message,
    b.status as booking_status,
    b.payment_status,
    b.platform_fee_cents,
    b.host_payout_cents,
    c.title as class_title,
    c.short_summary,
    c.description,
    c.start_date,
    c.start_time,
    c.end_date,
    c.number_of_days,
    c.hours_per_day,
    c.price_per_person_cents,
    c.max_students,
    c.minimum_age,
    c.advisories,
    c.house_rules,
    c.auto_approve,
    c.address_street,
    c.address_city,
    c.address_state,
    c.address_zip,
    c.address_country,
    c.host_id,
    ph.full_name as host_name,
    ph.email as host_email,
    pg.full_name as guest_name,
    pg.email as guest_email
  into v
  from bookings b
  join classes c on c.id = b.class_id
  join profiles ph on ph.id = c.host_id
  join profiles pg on pg.id = b.user_id
  where b.id = _booking_id;

  if not found then
    raise notice 'No booking found for %', _booking_id;
    return;
  end if;

  -- Build address
  full_address := trim(
    coalesce(v.address_street, '') || ', ' ||
    coalesce(v.address_city, '') || ', ' ||
    coalesce(v.address_state, '') || ' ' ||
    coalesce(v.address_zip, '')
  );

  -- Build host dashboard URLs (from a DB setting or static fallback)
  approve_base := coalesce(
    current_setting('app.host_dashboard_url', true),
    'https://herd.rent/dashboard'
  );

  approve_url := approve_base || '/bookings/' || v.booking_id || '?action=approve';
  decline_url := approve_base || '/bookings/' || v.booking_id || '?action=deny';

  -- Build merged vars
  _vars := coalesce(_vars, '{}'::jsonb) || jsonb_build_object(
    'BOOKING_ID', v.booking_id,
    'BOOKING_STATUS', v.booking_status,
    'PAYMENT_STATUS', v.payment_status,
    'STUDENT_COUNT', v.qty,
    'TOTAL_AMOUNT', round(v.total_cents / 100.0, 2)::text,
    'PLATFORM_FEE', round(coalesce(v.platform_fee_cents,0) / 100.0, 2)::text,
    'HOST_EARNINGS', round(coalesce(v.host_payout_cents,0) / 100.0, 2)::text,
    'HOST_MESSAGE', coalesce(v.host_message, ''),
    'CLASS_ID', v.class_id,
    'CLASS_TITLE', v.class_title,
    'CLASS_SUMMARY', coalesce(v.short_summary, ''),
    'CLASS_DESCRIPTION', coalesce(v.description, ''),
    'CLASS_DATE', v.start_date::text,
    'CLASS_END_DATE', coalesce(v.end_date, v.start_date)::text,
    'CLASS_TIME', v.start_time::text,
    'CLASS_DURATION_DAYS', v.number_of_days,
    'CLASS_HOURS_PER_DAY', coalesce(v.hours_per_day,0),
    'CLASS_PRICE_PER_PERSON', round(v.price_per_person_cents / 100.0, 2)::text,
    'CLASS_MAX_STUDENTS', v.max_students,
    'CLASS_MIN_AGE', v.minimum_age,
    'CLASS_ADVISORIES', coalesce(v.advisories, ''),
    'CLASS_HOUSE_RULES', coalesce(v.house_rules, ''),
    'CLASS_AUTO_APPROVE', coalesce(v.auto_approve,false),
    'CLASS_ADDRESS', full_address,
    'HOST_ID', v.host_id,
    'HOST_NAME', coalesce(v.host_name, ''),
    'HOST_EMAIL', coalesce(v.host_email, ''),
    'GUEST_ID', v.guest_id,
    'GUEST_NAME', coalesce(v.guest_name, ''),
    'GUEST_EMAIL', coalesce(v.guest_email, ''),
    'APPROVE_URL', approve_url,
    'DECLINE_URL', decline_url
  );

  -- Choose recipient if not provided
  if _to_email is null then
    if position('host' in lower(_type)) > 0 then
      _to_email := v.host_email;
    else
      _to_email := v.guest_email;
    end if;
  end if;

  insert into public.email_jobs
    (type, to_email, subject, template, vars, status, attempts, created_at)
  values
    (_type, _to_email, _subject, _template, _vars, 'QUEUED', 0, now());

  raise notice 'Queued email job for type %, to %', _type, _to_email;
end;
$function$;
