set check_function_bodies = off;

alter table public.bookings
  add column if not exists payout_status text not null default 'NONE',
  add column if not exists stripe_transfer_id text,
  add column if not exists paid_out_at timestamptz,
  add column if not exists payout_attempt_count integer not null default 0,
  add column if not exists payout_last_error text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'bookings_payout_status_check'
      and conrelid = 'public.bookings'::regclass
  ) then
    alter table public.bookings
      add constraint bookings_payout_status_check
      check (payout_status in ('NONE','DUE','IN_PROGRESS','PAID','FAILED'));
  end if;
end $$;

create table if not exists public.payout_batches (
  id uuid primary key default gen_random_uuid(),
  host_id uuid not null references public.profiles(id) on delete cascade,
  stripe_account_id text not null,
  total_amount_cents integer not null,
  idempotency_key text,
  stripe_transfer_id text,
  status text not null default 'CREATED' check (status in ('CREATED','SENT','FAILED')),
  booking_ids uuid[] not null,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);

alter table public.payout_batches
  add column if not exists idempotency_key text;

create unique index if not exists payout_batches_idempotency_key_idx
  on public.payout_batches (idempotency_key);

alter table public.payout_batches enable row level security;

create policy "Service role can manage payout batches"
  on public.payout_batches
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

revoke all on table public.payout_batches from anon, authenticated;
grant all on table public.payout_batches to service_role;
