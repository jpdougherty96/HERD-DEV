set check_function_bodies = off;

alter table public.bookings
  add column if not exists capture_status text not null default 'NONE',
  add column if not exists capture_attempt_count integer not null default 0,
  add column if not exists capture_last_error text,
  add column if not exists captured_at timestamptz;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'bookings_capture_status_check'
      and conrelid = 'public.bookings'::regclass
  ) then
    alter table public.bookings
      add constraint bookings_capture_status_check
      check (capture_status in ('NONE','CAPTURE_IN_PROGRESS','CAPTURED','CAPTURE_FAILED','NEEDS_RECONCILE'));
  end if;
end $$;

create table if not exists public.payment_reconciliations (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings(id) on delete cascade,
  stripe_payment_intent_id text,
  stripe_checkout_session_id text,
  reason text not null,
  status text not null default 'OPEN' check (status in ('OPEN','RESOLVED')),
  details jsonb,
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

alter table public.payment_reconciliations enable row level security;

create policy "Service role can manage payment reconciliations"
  on public.payment_reconciliations
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

revoke all on table public.payment_reconciliations from anon, authenticated;
grant all on table public.payment_reconciliations to service_role;
