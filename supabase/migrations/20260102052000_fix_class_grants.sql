-- Restore grants for classes table (RLS governs access)
revoke all on table public.classes from anon, authenticated;

grant select on table public.classes to anon;
grant select, insert, update, delete on table public.classes to authenticated;
grant all on table public.classes to service_role;
