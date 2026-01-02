-- Allow public reads of posts while keeping write access to authenticated users.
revoke all on table public.posts from anon, authenticated;

grant select on table public.posts to anon;
grant select, insert, update, delete on table public.posts to authenticated;
grant all on table public.posts to service_role;
