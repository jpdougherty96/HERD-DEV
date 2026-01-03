-- Ensure conversation delete RPC exists for dashboard soft delete

alter table public.conversation_participants
  add column if not exists deleted_at timestamp with time zone;

drop function if exists public.delete_conversation_for_user(uuid);

create or replace function public.delete_conversation_for_user(_conversation_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_conversation record;
  v_participant_id uuid;
  v_all_deleted boolean;
begin
  select id, host_id, guest_id
  into v_conversation
  from public.conversations
  where id = _conversation_id;

  if not found then
    raise exception 'Conversation % not found', _conversation_id
      using errcode = 'P0002';
  end if;

  if auth.uid() is distinct from v_conversation.host_id
     and auth.uid() is distinct from v_conversation.guest_id then
    raise exception 'You are not part of this conversation.'
      using errcode = '42501';
  end if;

  if v_conversation.host_id is not null then
    insert into public.conversation_participants (conversation_id, user_id, last_read_at)
    select _conversation_id, v_conversation.host_id, now()
    where not exists (
      select 1
      from public.conversation_participants
      where conversation_id = _conversation_id
        and user_id = v_conversation.host_id
    );
  end if;

  if v_conversation.guest_id is not null then
    insert into public.conversation_participants (conversation_id, user_id, last_read_at)
    select _conversation_id, v_conversation.guest_id, now()
    where not exists (
      select 1
      from public.conversation_participants
      where conversation_id = _conversation_id
        and user_id = v_conversation.guest_id
    );
  end if;

  select id
  into v_participant_id
  from public.conversation_participants
  where conversation_id = _conversation_id
    and user_id = auth.uid()
  limit 1;

  if v_participant_id is null then
    raise exception 'Unable to mark conversation % as deleted for current user.', _conversation_id
      using errcode = '42501';
  end if;

  update public.conversation_participants
  set deleted_at = coalesce(deleted_at, now()),
      last_read_at = coalesce(last_read_at, now())
  where id = v_participant_id;

  select bool_and(deleted_at is not null)
  into v_all_deleted
  from public.conversation_participants
  where conversation_id = _conversation_id;

  if coalesce(v_all_deleted, false) then
    delete from public.conversations
    where id = _conversation_id;
  end if;
end;
$function$;

revoke all on function public.delete_conversation_for_user(uuid) from public;
grant execute on function public.delete_conversation_for_user(uuid) to authenticated;
grant execute on function public.delete_conversation_for_user(uuid) to service_role;

create or replace function public.reset_conversation_deletions()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  update public.conversation_participants
  set deleted_at = null
  where conversation_id = new.conversation_id;
  return new;
end;
$function$;

drop trigger if exists trg_reset_conversation_deletions on public.messages;

create trigger trg_reset_conversation_deletions
after insert on public.messages
for each row
execute function public.reset_conversation_deletions();
