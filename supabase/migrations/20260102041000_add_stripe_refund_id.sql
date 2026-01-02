set check_function_bodies = off;

alter table public.bookings
  add column if not exists stripe_refund_id text;
