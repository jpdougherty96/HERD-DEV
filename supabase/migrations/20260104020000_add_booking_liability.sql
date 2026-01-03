set check_function_bodies = off;

alter table public.bookings
  add column if not exists liability_accepted boolean not null default false,
  add column if not exists liability_accepted_at timestamptz,
  add column if not exists liability_version text not null default '2026-01-03';
