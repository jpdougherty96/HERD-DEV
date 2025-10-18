-- Update enqueue_booking_email_job to include student names, fee breakdown, and host/guest links
create or replace function public.enqueue_booking_email_job(
  _booking_id uuid,
  _type text,
  _template text,
  _to_email text default null,
  _subject text default null,
  _vars jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
as $$
declare
  v record;
  full_address text;
  host_dashboard_base text;
  guest_dashboard_base text;
  approve_url text;
  decline_url text;
  guest_booking_url text;
  host_booking_url text;
  student_names_text text;
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
    b.stripe_fee_cents,
    b.student_names,
    c.title as class_title,
    c.short_summary,
    c.description,
    c.start_date,
    c.start_time,
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
  from public.bookings b
  join public.classes c on c.id = b.class_id
  join public.profiles ph on ph.id = c.host_id
  join public.profiles pg on pg.id = b.user_id
  where b.id = _booking_id;

  if not found then
    raise notice 'No booking found for %', _booking_id;
    return;
  end if;

  full_address := trim(
    coalesce(v.address_street, '') || ', ' ||
    coalesce(v.address_city, '') || ', ' ||
    coalesce(v.address_state, '') || ' ' ||
    coalesce(v.address_zip, '')
  );

  student_names_text := case
    when v.student_names is null then ''
    when array_length(v.student_names, 1) is null then ''
    else array_to_string(v.student_names, ', ')
  end;

  host_dashboard_base := coalesce(current_setting('app.host_dashboard_url', true), 'https://herdstaging.dev/dashboard');
  guest_dashboard_base := coalesce(current_setting('app.guest_dashboard_url', true), 'https://herdstaging.dev/dashboard/guestview');

  approve_url := host_dashboard_base || '?role=host&tab=bookings&booking=' || v.booking_id || '&action=approve';
  decline_url := host_dashboard_base || '?role=host&tab=bookings&booking=' || v.booking_id || '&action=deny';

  guest_booking_url := guest_dashboard_base || '?tab=bookings';
  if v.booking_id is not null then
    guest_booking_url := guest_booking_url || '&booking=' || v.booking_id;
  end if;

  host_booking_url := host_dashboard_base || '?role=host&tab=bookings';
  if v.booking_id is not null then
    host_booking_url := host_booking_url || '&booking=' || v.booking_id;
  end if;

  _vars := coalesce(_vars, '{}'::jsonb) || jsonb_build_object(
    'BOOKING_ID', v.booking_id,
    'BOOKING_STATUS', v.booking_status,
    'PAYMENT_STATUS', v.payment_status,
    'STUDENT_COUNT', v.qty,
    'STUDENT_NAMES', student_names_text,
    'TOTAL_AMOUNT', round(v.total_cents / 100.0, 2)::text,
    'PLATFORM_FEES', round(coalesce(v.platform_fee_cents, 0) / 100.0, 2)::text,
    'HOST_EARNINGS', round(coalesce(v.host_payout_cents, 0) / 100.0, 2)::text,
    'STRIPE_FEES', round(coalesce(v.stripe_fee_cents, 0) / 100.0, 2)::text,
    'HOST_MESSAGE', coalesce(v.host_message, ''),
    'CLASS_ID', v.class_id,
    'CLASS_TITLE', v.class_title,
    'CLASS_SUMMARY', coalesce(v.short_summary, ''),
    'CLASS_DESCRIPTION', coalesce(v.description, ''),
    'CLASS_DATE', v.start_date::text,
    'CLASS_TIME', v.start_time::text,
    'CLASS_DURATION_DAYS', v.number_of_days,
    'CLASS_HOURS_PER_DAY', coalesce(v.hours_per_day, 0),
    'CLASS_PRICE_PER_PERSON', round(v.price_per_person_cents / 100.0, 2)::text,
    'CLASS_MAX_STUDENTS', v.max_students,
    'CLASS_MIN_AGE', v.minimum_age,
    'CLASS_ADVISORIES', coalesce(v.advisories, ''),
    'CLASS_HOUSE_RULES', coalesce(v.house_rules, ''),
    'CLASS_AUTO_APPROVE', coalesce(v.auto_approve, false),
    'CLASS_ADDRESS', full_address,
    'HOST_ID', v.host_id,
    'HOST_NAME', coalesce(v.host_name, ''),
    'HOST_EMAIL', coalesce(v.host_email, ''),
    'GUEST_ID', v.guest_id,
    'GUEST_NAME', coalesce(v.guest_name, ''),
    'GUEST_EMAIL', coalesce(v.guest_email, ''),
    'APPROVE_URL', approve_url,
    'DECLINE_URL', decline_url,
    'BOOKING_URL', case
      when position('host' in lower(_type)) > 0 then host_booking_url
      else guest_booking_url
    end
  );

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
$$;
