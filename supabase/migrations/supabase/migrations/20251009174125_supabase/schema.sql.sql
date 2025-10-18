


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE SCHEMA IF NOT EXISTS "public";


ALTER SCHEMA "public" OWNER TO "pg_database_owner";


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE TYPE "public"."booking_status" AS ENUM (
    'PENDING',
    'APPROVED',
    'PAID',
    'CANCELLED',
    'REFUNDED',
    'DENIED'
);


ALTER TYPE "public"."booking_status" OWNER TO "postgres";


CREATE TYPE "public"."payment_status" AS ENUM (
    'PENDING',
    'COMPLETED',
    'FAILED',
    'REFUNDED',
    'HELD',
    'PAID'
);


ALTER TYPE "public"."payment_status" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."available_spots"("class_uuid" "uuid") RETURNS integer
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
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
$$;


ALTER FUNCTION "public"."available_spots"("class_uuid" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."broadcast_message_to_class"("_class_id" "uuid", "_host_id" "uuid", "_content" "text") RETURNS TABLE("conversation_id" "uuid", "guest_id" "uuid", "message_id" "uuid")
    LANGUAGE "plpgsql"
    AS $$
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
$$;


ALTER FUNCTION "public"."broadcast_message_to_class"("_class_id" "uuid", "_host_id" "uuid", "_content" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."cents_to_dollars"("cents" integer) RETURNS "text"
    LANGUAGE "sql" IMMUTABLE
    AS $$
  select to_char(coalesce(cents,0) / 100.0, 'FM999999990D00')
$$;


ALTER FUNCTION "public"."cents_to_dollars"("cents" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."enqueue_booking_email_job"("_booking_id" "uuid", "_type" "text", "_template" "text", "_to_email" "text" DEFAULT NULL::"text", "_subject" "text" DEFAULT NULL::"text", "_vars" "jsonb" DEFAULT '{}'::"jsonb") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
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
    'https://herd.app/dashboard'
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
$$;


ALTER FUNCTION "public"."enqueue_booking_email_job"("_booking_id" "uuid", "_type" "text", "_template" "text", "_to_email" "text", "_subject" "text", "_vars" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."enqueue_email_job"("p_type" "text", "p_to_email" "text", "p_subject" "text", "p_template" "text", "p_vars" "jsonb") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
begin
  if coalesce(p_to_email, '') = '' then
    -- silently skip if no destination; avoids trigger failures
    raise notice 'enqueue_email_job: missing to_email for type %', p_type;
    return;
  end if;

  insert into public.email_jobs(type, to_email, subject, template, vars)
  values (p_type, p_to_email, p_subject, p_template, coalesce(p_vars, '{}'::jsonb));
end;
$$;


ALTER FUNCTION "public"."enqueue_email_job"("p_type" "text", "p_to_email" "text", "p_subject" "text", "p_template" "text", "p_vars" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."find_or_create_conversation"("_class_id" "uuid", "_user_a" "uuid", "_user_b" "uuid") RETURNS "uuid"
    LANGUAGE "plpgsql"
    AS $$
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
$$;


ALTER FUNCTION "public"."find_or_create_conversation"("_class_id" "uuid", "_user_a" "uuid", "_user_b" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."handle_new_user"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
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
$$;


ALTER FUNCTION "public"."handle_new_user"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."herd_due_payouts"("buffer_hours" integer) RETURNS TABLE("id" "uuid", "host_payout_cents" integer, "stripe_charge_id" "text", "host_stripe_account_id" "text")
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
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
$$;


ALTER FUNCTION "public"."herd_due_payouts"("buffer_hours" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_member_of_conversation"("c_id" "uuid", "u_id" "uuid") RETURNS boolean
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select exists (
    select 1
    from conversation_participants cp
    where cp.conversation_id = c_id
      and cp.user_id = u_id
  );
$$;


ALTER FUNCTION "public"."is_member_of_conversation"("c_id" "uuid", "u_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_user_in_conversation"("convo_id" "uuid") RETURNS boolean
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT EXISTS (
    SELECT 1
    FROM conversation_participants cp
    WHERE cp.conversation_id = convo_id
      AND cp.user_id = auth.uid()
  );
$$;


ALTER FUNCTION "public"."is_user_in_conversation"("convo_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."trg_enqueue_on_denied"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
  IF ((new.status::text='DENIED' AND coalesce(old.status::text,'')<>'DENIED')
   OR (new.status::text='CANCELLED' AND coalesce(old.status::text,'')<>'CANCELLED')) THEN
    PERFORM public.enqueue_booking_email_job(new.id, 'booking_denied_guest', 'BOOKING_DENIED');
  END IF;
  RETURN new;
END; $$;


ALTER FUNCTION "public"."trg_enqueue_on_denied"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."trg_enqueue_on_pending_insert"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
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
$$;


ALTER FUNCTION "public"."trg_enqueue_on_pending_insert"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."trg_update_host_rating"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
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
$$;


ALTER FUNCTION "public"."trg_update_host_rating"() OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."bookings" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "class_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "qty" integer NOT NULL,
    "total_cents" integer NOT NULL,
    "status" "public"."booking_status" DEFAULT 'PENDING'::"public"."booking_status" NOT NULL,
    "stripe_checkout_session_id" "text",
    "stripe_payment_intent_id" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "approved_at" timestamp with time zone,
    "denied_at" timestamp with time zone,
    "host_message" "text",
    "payment_status" "public"."payment_status" DEFAULT 'PENDING'::"public"."payment_status",
    "stripe_charge_id" "text",
    "paid_out_at" timestamp with time zone,
    "platform_fee_cents" integer,
    "stripe_transfer_id" "text",
    "host_payout_cents" integer DEFAULT 0,
    "email_sent" boolean DEFAULT false,
    "stripe_fee_cents" integer DEFAULT 0,
    "reviewed" boolean DEFAULT false,
    "student_names" "text"[] DEFAULT '{}'::"text"[]
);


ALTER TABLE "public"."bookings" OWNER TO "postgres";


COMMENT ON COLUMN "public"."bookings"."stripe_charge_id" IS 'Stores Stripe charge ID for separate transfer.';



COMMENT ON COLUMN "public"."bookings"."paid_out_at" IS 'Timestamp when funds were released to host.';



COMMENT ON COLUMN "public"."bookings"."platform_fee_cents" IS 'Locked-in HERD fee at checkout.';



COMMENT ON COLUMN "public"."bookings"."stripe_fee_cents" IS 'Amount (in cents) Stripe charged as a processing fee for this booking, fetched from the PaymentIntent balance_transaction.';


CREATE TABLE IF NOT EXISTS "public"."reviews" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "booking_id" "uuid" NOT NULL,
    "host_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "rating" integer NOT NULL CHECK (("rating" >= 1) AND ("rating" <= 5)),
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."reviews" OWNER TO "postgres";


COMMENT ON COLUMN "public"."reviews"."rating" IS '1-5 star rating supplied by the guest.';


CREATE TABLE IF NOT EXISTS "public"."review_tokens" (
    "token" "text" NOT NULL,
    "booking_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "host_id" "uuid" NOT NULL,
    "expires_at" timestamp with time zone NOT NULL,
    "used_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."review_tokens" OWNER TO "postgres";


COMMENT ON TABLE "public"."review_tokens" IS 'One-time tokens emailed to guests to submit host reviews.';


COMMENT ON COLUMN "public"."review_tokens"."token" IS 'Opaque review link token.';


ALTER TABLE ONLY "public"."reviews"
    ADD CONSTRAINT "reviews_pkey" PRIMARY KEY ("id");


ALTER TABLE ONLY "public"."review_tokens"
    ADD CONSTRAINT "review_tokens_pkey" PRIMARY KEY ("token");


ALTER TABLE ONLY "public"."reviews"
    ADD CONSTRAINT "reviews_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE CASCADE;


ALTER TABLE ONLY "public"."reviews"
    ADD CONSTRAINT "reviews_host_id_fkey" FOREIGN KEY ("host_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;


ALTER TABLE ONLY "public"."reviews"
    ADD CONSTRAINT "reviews_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;


ALTER TABLE ONLY "public"."review_tokens"
    ADD CONSTRAINT "review_tokens_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE CASCADE;


ALTER TABLE ONLY "public"."review_tokens"
    ADD CONSTRAINT "review_tokens_host_id_fkey" FOREIGN KEY ("host_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;


ALTER TABLE ONLY "public"."review_tokens"
    ADD CONSTRAINT "review_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;


CREATE INDEX "idx_reviews_booking" ON "public"."reviews" USING "btree" ("booking_id");


CREATE INDEX "idx_reviews_host" ON "public"."reviews" USING "btree" ("host_id");


CREATE INDEX "idx_review_tokens_booking" ON "public"."review_tokens" USING "btree" ("booking_id");


CREATE INDEX "idx_review_tokens_user" ON "public"."review_tokens" USING "btree" ("user_id");


ALTER TABLE "public"."reviews" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."review_tokens" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "Users can view their review tokens" ON "public"."review_tokens"
  FOR SELECT
  USING (("user_id" = auth.uid()));


CREATE POLICY "Hosts or reviewers can view reviews" ON "public"."reviews"
  FOR SELECT
  USING (("host_id" = auth.uid()) OR ("user_id" = auth.uid()));



CREATE TABLE IF NOT EXISTS "public"."classes" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "host_id" "uuid" NOT NULL,
    "title" "text" NOT NULL,
    "short_summary" "text",
    "description" "text",
    "start_date" "date" NOT NULL,
    "start_time" time without time zone NOT NULL,
    "number_of_days" integer NOT NULL,
    "hours_per_day" numeric,
    "price_per_person_cents" integer NOT NULL,
    "max_students" integer NOT NULL,
    "minimum_age" integer DEFAULT 0,
    "instructor_bio" "text",
    "advisories" "text",
    "house_rules" "text",
    "auto_approve" boolean DEFAULT false,
    "photos" "text"[],
    "address_street" "text",
    "address_city" "text",
    "address_state" "text",
    "address_zip" "text",
    "address_country" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."classes" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."conversation_participants" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "conversation_id" "uuid",
    "user_id" "uuid",
    "last_read_at" timestamp with time zone DEFAULT "now"(),
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."conversation_participants" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."conversations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "class_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "host_id" "uuid",
    "guest_id" "uuid",
    "last_message_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."conversations" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."email_jobs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "type" "text" NOT NULL,
    "to_email" "text",
    "subject" "text",
    "template" "text" NOT NULL,
    "vars" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "status" "text" DEFAULT 'QUEUED'::"text" NOT NULL,
    "attempts" integer DEFAULT 0 NOT NULL,
    "last_error" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "sent_at" timestamp with time zone,
    "booking_id" "uuid"
);


ALTER TABLE "public"."email_jobs" OWNER TO "postgres";


COMMENT ON TABLE "public"."email_jobs" IS 'Outbox for transactional emails';



CREATE TABLE IF NOT EXISTS "public"."messages" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "conversation_id" "uuid" NOT NULL,
    "sender_id" "uuid" NOT NULL,
    "content" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "read_at" timestamp with time zone
);


ALTER TABLE "public"."messages" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."posts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "title" "text" NOT NULL,
    "content" "text",
    "photos" "text"[],
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."posts" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."profiles" (
    "id" "uuid" NOT NULL,
    "full_name" "text",
    "email" "text",
    "farm_name" "text",
    "bio" "text",
    "avatar_url" "text",
    "location" "text",
    "stripe_connected" boolean DEFAULT false,
    "is_admin" boolean DEFAULT false,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "stripe_account_id" "text",
    "rating_average" numeric DEFAULT 0,
    "rating_count" integer DEFAULT 0
);


ALTER TABLE "public"."profiles" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."reviews" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "booking_id" "uuid" NOT NULL,
    "host_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "rating" integer,
    "created_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "reviews_rating_check" CHECK ((("rating" >= 1) AND ("rating" <= 5)))
);


ALTER TABLE "public"."reviews" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."webhook_logs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "event_type" "text",
    "stripe_id" "text",
    "payload" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."webhook_logs" OWNER TO "postgres";


ALTER TABLE ONLY "public"."bookings"
    ADD CONSTRAINT "bookings_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."classes"
    ADD CONSTRAINT "classes_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."conversation_participants"
    ADD CONSTRAINT "conversation_participants_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."conversations"
    ADD CONSTRAINT "conversations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."email_jobs"
    ADD CONSTRAINT "email_jobs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."messages"
    ADD CONSTRAINT "messages_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."posts"
    ADD CONSTRAINT "posts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_email_key" UNIQUE ("email");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."reviews"
    ADD CONSTRAINT "reviews_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."webhook_logs"
    ADD CONSTRAINT "webhook_logs_pkey" PRIMARY KEY ("id");



CREATE INDEX "bookings_class_user_created_idx" ON "public"."bookings" USING "btree" ("class_id", "user_id", "created_at" DESC);



CREATE INDEX "bookings_payment_status_idx" ON "public"."bookings" USING "btree" ("payment_status");



CREATE INDEX "bookings_stripe_transfer_id_idx" ON "public"."bookings" USING "btree" ("stripe_transfer_id");



CREATE INDEX "email_jobs_status_idx" ON "public"."email_jobs" USING "btree" ("status", "created_at");



CREATE INDEX "idx_bookings_checkout" ON "public"."bookings" USING "btree" ("stripe_checkout_session_id");



CREATE INDEX "idx_bookings_class" ON "public"."bookings" USING "btree" ("class_id");



CREATE INDEX "idx_bookings_paystat" ON "public"."bookings" USING "btree" ("payment_status");



CREATE INDEX "idx_bookings_pi" ON "public"."bookings" USING "btree" ("stripe_payment_intent_id");



CREATE INDEX "idx_bookings_status" ON "public"."bookings" USING "btree" ("status");



CREATE INDEX "idx_bookings_user" ON "public"."bookings" USING "btree" ("user_id");



CREATE INDEX "idx_classes_host" ON "public"."classes" USING "btree" ("host_id");



CREATE INDEX "idx_conv_updated" ON "public"."conversations" USING "btree" ("updated_at" DESC);



CREATE INDEX "idx_conversations_last_message" ON "public"."conversations" USING "btree" ("last_message_at" DESC);



CREATE INDEX "idx_email_jobs_booking_id" ON "public"."email_jobs" USING "btree" ("booking_id");



CREATE INDEX "idx_messages_conversation" ON "public"."messages" USING "btree" ("conversation_id");



CREATE INDEX "idx_messages_conversation_created" ON "public"."messages" USING "btree" ("conversation_id", "created_at");



CREATE INDEX "idx_messages_convo" ON "public"."messages" USING "btree" ("conversation_id");



CREATE INDEX "idx_msg_conversation_created" ON "public"."messages" USING "btree" ("conversation_id", "created_at" DESC);



CREATE INDEX "idx_posts_user" ON "public"."posts" USING "btree" ("user_id");



CREATE UNIQUE INDEX "reviews_booking_id_key" ON "public"."reviews" USING "btree" ("booking_id");



CREATE UNIQUE INDEX "uq_email_jobs_booking_type_to" ON "public"."email_jobs" USING "btree" ("booking_id", "type", "to_email");



CREATE OR REPLACE TRIGGER "bookings_after_insert" AFTER INSERT ON "public"."bookings" FOR EACH ROW EXECUTE FUNCTION "public"."trg_enqueue_on_pending_insert"();



CREATE OR REPLACE TRIGGER "bookings_after_update_denied" AFTER UPDATE ON "public"."bookings" FOR EACH ROW EXECUTE FUNCTION "public"."trg_enqueue_on_denied"();



CREATE OR REPLACE TRIGGER "reviews_after_insert" AFTER INSERT ON "public"."reviews" FOR EACH ROW EXECUTE FUNCTION "public"."trg_update_host_rating"();



ALTER TABLE ONLY "public"."bookings"
    ADD CONSTRAINT "bookings_class_id_fkey" FOREIGN KEY ("class_id") REFERENCES "public"."classes"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."bookings"
    ADD CONSTRAINT "bookings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."classes"
    ADD CONSTRAINT "classes_host_id_fkey" FOREIGN KEY ("host_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."conversation_participants"
    ADD CONSTRAINT "conversation_participants_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."conversation_participants"
    ADD CONSTRAINT "conversation_participants_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."conversations"
    ADD CONSTRAINT "conversations_class_id_fkey" FOREIGN KEY ("class_id") REFERENCES "public"."classes"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."conversations"
    ADD CONSTRAINT "conversations_guest_id_fkey" FOREIGN KEY ("guest_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."conversations"
    ADD CONSTRAINT "conversations_host_id_fkey" FOREIGN KEY ("host_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."messages"
    ADD CONSTRAINT "messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."messages"
    ADD CONSTRAINT "messages_sender_id_fkey" FOREIGN KEY ("sender_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."posts"
    ADD CONSTRAINT "posts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_id_fkey" FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."reviews"
    ADD CONSTRAINT "reviews_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."reviews"
    ADD CONSTRAINT "reviews_host_id_fkey" FOREIGN KEY ("host_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."reviews"
    ADD CONSTRAINT "reviews_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



CREATE POLICY "Anyone can read classes" ON "public"."classes" FOR SELECT USING (true);



CREATE POLICY "Anyone can read posts" ON "public"."posts" FOR SELECT USING (true);



CREATE POLICY "Hosts can manage bookings for their classes" ON "public"."bookings" FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM "public"."classes" "c"
  WHERE (("c"."id" = "bookings"."class_id") AND ("c"."host_id" = "auth"."uid"()))))) WITH CHECK (true);



CREATE POLICY "Hosts can manage their own classes" ON "public"."classes" USING (("auth"."uid"() = "host_id")) WITH CHECK (("auth"."uid"() = "host_id"));



CREATE POLICY "Profiles readable by all authenticated users" ON "public"."profiles" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Users can create their own bookings" ON "public"."bookings" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can manage their own posts" ON "public"."posts" USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can update their own profile" ON "public"."profiles" FOR UPDATE USING (("auth"."uid"() = "id"));



CREATE POLICY "Users can view their own bookings" ON "public"."bookings" FOR SELECT USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can view their own profile" ON "public"."profiles" FOR SELECT USING (("auth"."uid"() = "id"));



CREATE POLICY "allow service role to update bookings" ON "public"."bookings" FOR UPDATE USING (("auth"."role"() = 'service_role'::"text"));



CREATE POLICY "allow user manage own conversation_participants" ON "public"."conversation_participants" USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



ALTER TABLE "public"."bookings" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."classes" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "conv_insert_any" ON "public"."conversations" FOR INSERT WITH CHECK (true);



CREATE POLICY "conv_select_if_member" ON "public"."conversations" FOR SELECT USING ((("auth"."uid"() = "host_id") OR ("auth"."uid"() = "guest_id")));



ALTER TABLE "public"."conversation_participants" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."conversations" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."messages" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "msg_insert_if_member_and_sender" ON "public"."messages" FOR INSERT WITH CHECK ((("sender_id" = "auth"."uid"()) AND ("auth"."uid"() IN ( SELECT "conversations"."host_id"
   FROM "public"."conversations"
  WHERE ("conversations"."id" = "messages"."conversation_id")
UNION
 SELECT "conversations"."guest_id"
   FROM "public"."conversations"
  WHERE ("conversations"."id" = "messages"."conversation_id")))));



CREATE POLICY "msg_select_if_member" ON "public"."messages" FOR SELECT USING (("auth"."uid"() IN ( SELECT "conversations"."host_id"
   FROM "public"."conversations"
  WHERE ("conversations"."id" = "messages"."conversation_id")
UNION
 SELECT "conversations"."guest_id"
   FROM "public"."conversations"
  WHERE ("conversations"."id" = "messages"."conversation_id"))));



ALTER TABLE "public"."posts" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."profiles" ENABLE ROW LEVEL SECURITY;


GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";



GRANT ALL ON FUNCTION "public"."available_spots"("class_uuid" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."available_spots"("class_uuid" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."available_spots"("class_uuid" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."broadcast_message_to_class"("_class_id" "uuid", "_host_id" "uuid", "_content" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."broadcast_message_to_class"("_class_id" "uuid", "_host_id" "uuid", "_content" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."broadcast_message_to_class"("_class_id" "uuid", "_host_id" "uuid", "_content" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."cents_to_dollars"("cents" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."cents_to_dollars"("cents" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."cents_to_dollars"("cents" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."enqueue_booking_email_job"("_booking_id" "uuid", "_type" "text", "_template" "text", "_to_email" "text", "_subject" "text", "_vars" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."enqueue_booking_email_job"("_booking_id" "uuid", "_type" "text", "_template" "text", "_to_email" "text", "_subject" "text", "_vars" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."enqueue_booking_email_job"("_booking_id" "uuid", "_type" "text", "_template" "text", "_to_email" "text", "_subject" "text", "_vars" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "public"."enqueue_email_job"("p_type" "text", "p_to_email" "text", "p_subject" "text", "p_template" "text", "p_vars" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."enqueue_email_job"("p_type" "text", "p_to_email" "text", "p_subject" "text", "p_template" "text", "p_vars" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."enqueue_email_job"("p_type" "text", "p_to_email" "text", "p_subject" "text", "p_template" "text", "p_vars" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "public"."find_or_create_conversation"("_class_id" "uuid", "_user_a" "uuid", "_user_b" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."find_or_create_conversation"("_class_id" "uuid", "_user_a" "uuid", "_user_b" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."find_or_create_conversation"("_class_id" "uuid", "_user_a" "uuid", "_user_b" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "anon";
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "service_role";



GRANT ALL ON FUNCTION "public"."herd_due_payouts"("buffer_hours" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."herd_due_payouts"("buffer_hours" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."herd_due_payouts"("buffer_hours" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."is_member_of_conversation"("c_id" "uuid", "u_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."is_member_of_conversation"("c_id" "uuid", "u_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_member_of_conversation"("c_id" "uuid", "u_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."is_user_in_conversation"("convo_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."is_user_in_conversation"("convo_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_user_in_conversation"("convo_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."trg_enqueue_on_denied"() TO "anon";
GRANT ALL ON FUNCTION "public"."trg_enqueue_on_denied"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."trg_enqueue_on_denied"() TO "service_role";



GRANT ALL ON FUNCTION "public"."trg_enqueue_on_pending_insert"() TO "anon";
GRANT ALL ON FUNCTION "public"."trg_enqueue_on_pending_insert"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."trg_enqueue_on_pending_insert"() TO "service_role";



GRANT ALL ON FUNCTION "public"."trg_update_host_rating"() TO "anon";
GRANT ALL ON FUNCTION "public"."trg_update_host_rating"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."trg_update_host_rating"() TO "service_role";



GRANT ALL ON TABLE "public"."bookings" TO "anon";
GRANT ALL ON TABLE "public"."bookings" TO "authenticated";
GRANT ALL ON TABLE "public"."bookings" TO "service_role";



GRANT ALL ON TABLE "public"."classes" TO "anon";
GRANT ALL ON TABLE "public"."classes" TO "authenticated";
GRANT ALL ON TABLE "public"."classes" TO "service_role";



GRANT ALL ON TABLE "public"."conversation_participants" TO "anon";
GRANT ALL ON TABLE "public"."conversation_participants" TO "authenticated";
GRANT ALL ON TABLE "public"."conversation_participants" TO "service_role";



GRANT ALL ON TABLE "public"."conversations" TO "anon";
GRANT ALL ON TABLE "public"."conversations" TO "authenticated";
GRANT ALL ON TABLE "public"."conversations" TO "service_role";



GRANT ALL ON TABLE "public"."email_jobs" TO "anon";
GRANT ALL ON TABLE "public"."email_jobs" TO "authenticated";
GRANT ALL ON TABLE "public"."email_jobs" TO "service_role";



GRANT ALL ON TABLE "public"."messages" TO "anon";
GRANT ALL ON TABLE "public"."messages" TO "authenticated";
GRANT ALL ON TABLE "public"."messages" TO "service_role";



GRANT ALL ON TABLE "public"."posts" TO "anon";
GRANT ALL ON TABLE "public"."posts" TO "authenticated";
GRANT ALL ON TABLE "public"."posts" TO "service_role";



GRANT ALL ON TABLE "public"."profiles" TO "anon";
GRANT ALL ON TABLE "public"."profiles" TO "authenticated";
GRANT ALL ON TABLE "public"."profiles" TO "service_role";



GRANT ALL ON TABLE "public"."reviews" TO "anon";
GRANT ALL ON TABLE "public"."reviews" TO "authenticated";
GRANT ALL ON TABLE "public"."reviews" TO "service_role";



GRANT ALL ON TABLE "public"."webhook_logs" TO "anon";
GRANT ALL ON TABLE "public"."webhook_logs" TO "authenticated";
GRANT ALL ON TABLE "public"."webhook_logs" TO "service_role";



ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";







RESET ALL;
