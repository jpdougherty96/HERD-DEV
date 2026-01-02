set check_function_bodies = off;

create table if not exists public.booking_holds (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references public.classes(id) on delete cascade,
  guest_id uuid not null references public.profiles(id) on delete cascade,
  quantity integer not null check (quantity > 0),
  status text not null default 'HELD' check (status in ('HELD', 'CONSUMED', 'EXPIRED', 'CANCELLED')),
  stripe_checkout_session_id text unique,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '15 minutes')
);

create index if not exists booking_holds_class_status_expires_idx
  on public.booking_holds (class_id, status, expires_at);

alter table public.booking_holds enable row level security;

create policy "Guests can view their own holds"
  on public.booking_holds
  for select
  using (auth.uid() = guest_id);

create policy "Guests can create their own holds"
  on public.booking_holds
  for insert
  with check (auth.uid() = guest_id);

create policy "Service role can manage booking holds"
  on public.booking_holds
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

create or replace function public.available_spots_with_holds(class_uuid uuid)
 returns integer
 language sql
 security definer
 set search_path to 'public'
as $function$
  with cap as (
    select max_students
    from classes
    where id = class_uuid
  ),
  used as (
    select coalesce(sum(qty), 0) as seats
    from bookings
    where class_id = class_uuid
      and status in ('APPROVED')
  ),
  held as (
    select coalesce(sum(quantity), 0) as seats
    from booking_holds
    where class_id = class_uuid
      and status = 'HELD'
      and expires_at > now()
  )
  select greatest((select max_students from cap) - (select seats from used) - (select seats from held), 0);
$function$;

revoke all on table public.booking_holds from anon, authenticated;
grant select, insert on table public.booking_holds to authenticated;
grant all on table public.booking_holds to service_role;

revoke all on function public.available_spots_with_holds(uuid) from anon;
grant execute on function public.available_spots_with_holds(uuid) to authenticated;
grant execute on function public.available_spots_with_holds(uuid) to service_role;
