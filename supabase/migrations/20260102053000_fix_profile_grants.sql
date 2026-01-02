-- Restore profile table grants so class listings can join host profiles.
revoke all on table public.profiles from anon, authenticated;

grant select on table public.profiles to anon;
grant select, insert, update on table public.profiles to authenticated;
grant all on table public.profiles to service_role;
