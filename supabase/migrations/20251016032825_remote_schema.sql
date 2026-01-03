set check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.available_spots(class_uuid uuid)
 RETURNS integer
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with cap as (
    select max_students
    from classes
    where id = class_uuid
  ),
  used as (
    select coalesce(sum(qty), 0) as seats
    from bookings
    where class_id = class_uuid
      and status in ('APPROVED')      -- only confirmed seats
  )
  select greatest((select max_students from cap) - (select seats from used), 0);
$function$
;

CREATE OR REPLACE FUNCTION public.broadcast_message_to_class(_class_id uuid, _host_id uuid, _content text)
 RETURNS TABLE(conversation_id uuid, guest_id uuid, message_id uuid)
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_guest record;
  v_conversation_id uuid;
  v_message_id uuid;
BEGIN
  -- Loop through every approved booking for this class
  FOR v_guest IN
    SELECT DISTINCT b.user_id
    FROM bookings b
    WHERE b.class_id = _class_id
      AND b.status = 'APPROVED'
  LOOP
    -- Create or find the private conversation for this host + guest + class
    v_conversation_id := find_or_create_conversation(_class_id, _host_id, v_guest.user_id);

    -- Insert the broadcast message
    INSERT INTO messages (conversation_id, sender_id, content, created_at)
    VALUES (v_conversation_id, _host_id, _content, now())
    RETURNING id INTO v_message_id;

    -- Return one row per recipient
    conversation_id := v_conversation_id;
    guest_id := v_guest.user_id;
    message_id := v_message_id;
    RETURN NEXT;
  END LOOP;

  RETURN;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.cents_to_dollars(cents integer)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
AS $function$
  select to_char(coalesce(cents,0) / 100.0, 'FM999999990D00')
$function$
;

CREATE OR REPLACE FUNCTION public.enqueue_booking_email_job(_booking_id uuid, _type text, _template text, _to_email text DEFAULT NULL::text, _subject text DEFAULT NULL::text, _vars jsonb DEFAULT '{}'::jsonb)
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
$function$
;

CREATE OR REPLACE FUNCTION public.enqueue_email_job(p_type text, p_to_email text, p_subject text, p_template text, p_vars jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
begin
  if coalesce(p_to_email, '') = '' then
    -- silently skip if no destination; avoids trigger failures
    raise notice 'enqueue_email_job: missing to_email for type %', p_type;
    return;
  end if;

  insert into public.email_jobs(type, to_email, subject, template, vars)
  values (p_type, p_to_email, p_subject, p_template, coalesce(p_vars, '{}'::jsonb));
end;
$function$
;

CREATE OR REPLACE FUNCTION public.find_or_create_conversation(_class_id uuid, _user_a uuid, _user_b uuid)
 RETURNS uuid
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_conversation_id uuid;
BEGIN
  -- 1️⃣ Try to find an existing conversation with these two users and class
  SELECT c.id
  INTO v_conversation_id
  FROM conversations c
  JOIN conversation_participants cp1 ON cp1.conversation_id = c.id AND cp1.user_id = _user_a
  JOIN conversation_participants cp2 ON cp2.conversation_id = c.id AND cp2.user_id = _user_b
  WHERE c.class_id = _class_id
  LIMIT 1;

  -- 2️⃣ If found, just return it
  IF v_conversation_id IS NOT NULL THEN
    RETURN v_conversation_id;
  END IF;

  -- 3️⃣ Otherwise, create a new conversation
  INSERT INTO conversations (class_id, created_at, updated_at)
  VALUES (_class_id, now(), now())
  RETURNING id INTO v_conversation_id;

  -- 4️⃣ Add both users as participants
  INSERT INTO conversation_participants (conversation_id, user_id)
  VALUES 
    (v_conversation_id, _user_a),
    (v_conversation_id, _user_b);

  -- 5️⃣ Return the new conversation ID
  RETURN v_conversation_id;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  insert into public.profiles (id, email, full_name, created_at, updated_at)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', ''),
    now(),
    now()
  )
  on conflict (id) do nothing;
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.herd_due_payouts(buffer_hours integer)
 RETURNS TABLE(id uuid, host_payout_cents integer, stripe_charge_id text, host_stripe_account_id text)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with classes_with_ts as (
    select
      c.id,
      c.host_id,
      (
        (c.start_date::text || ' ' || coalesce(c.start_time::text,'00:00:00'))
      )::timestamp at time zone 'utc' as class_start_utc
    from classes c
  )
  select
    b.id,
    b.host_payout_cents,
    b.stripe_charge_id,
    p.stripe_account_id as host_stripe_account_id
  from bookings b
  join classes_with_ts cw on cw.id = b.class_id
  join profiles p on p.id = cw.host_id
  where b.payment_status = 'HELD'
    and cw.class_start_utc < now() - (buffer_hours || ' hours')::interval;
$function$
;

CREATE OR REPLACE FUNCTION public.is_member_of_conversation(c_id uuid, u_id uuid)
 RETURNS boolean
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1
    from conversation_participants cp
    where cp.conversation_id = c_id
      and cp.user_id = u_id
  );
$function$
;

CREATE OR REPLACE FUNCTION public.is_user_in_conversation(convo_id uuid)
 RETURNS boolean
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM conversation_participants cp
    WHERE cp.conversation_id = convo_id
      AND cp.user_id = auth.uid()
  );
$function$
;

CREATE OR REPLACE FUNCTION public.trg_enqueue_on_denied()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  IF ((new.status::text='DENIED' AND coalesce(old.status::text,'')<>'DENIED')
   OR (new.status::text='CANCELLED' AND coalesce(old.status::text,'')<>'CANCELLED')) THEN
    PERFORM public.enqueue_booking_email_job(new.id, 'booking_denied_guest', 'BOOKING_DENIED');
  END IF;
  RETURN new;
END; $function$
;

CREATE OR REPLACE FUNCTION public.trg_enqueue_on_pending_insert()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
begin
  -- When a new booking is created in PENDING state, enqueue both host and guest notification emails
  if new.status = 'PENDING' then
    perform public.enqueue_booking_email_job(
      new.id,
      'booking_requested_host',
      'BOOKING_REQUESTED_HOST'
    );

    perform public.enqueue_booking_email_job(
      new.id,
      'booking_requested_guest',
      'BOOKING_REQUESTED_GUEST'
    );
  end if;

  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.trg_update_host_rating()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
declare
  new_avg numeric;
  new_count integer;
begin
  select avg(rating)::numeric(3,2), count(*) into new_avg, new_count
  from public.reviews where host_id = new.host_id;

  update public.profiles
  set rating_average = new_avg, rating_count = new_count
  where id = new.host_id;

  return new;
end;
$function$
;



