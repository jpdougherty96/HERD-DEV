-- Restore booking table grants for authenticated users and service role.
revoke all on table public.bookings from anon, authenticated;

grant select, insert, update on table public.bookings to authenticated;
grant all on table public.bookings to service_role;
