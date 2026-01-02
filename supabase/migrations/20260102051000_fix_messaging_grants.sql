-- Restore least-privilege grants for messaging tables (RLS handles access)
revoke all on table public.conversations from anon, authenticated;
revoke all on table public.messages from anon, authenticated;
revoke all on table public.conversation_participants from anon, authenticated;

grant select, insert, update on table public.conversations to authenticated;
grant select, insert on table public.messages to authenticated;
grant select, insert, update on table public.conversation_participants to authenticated;

grant all on table public.conversations to service_role;
grant all on table public.messages to service_role;
grant all on table public.conversation_participants to service_role;
