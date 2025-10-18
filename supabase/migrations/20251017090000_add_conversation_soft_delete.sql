-- HERD migration: add per-participant conversation deletion support

-- 1. Allow participants to mark a conversation as deleted for themselves
ALTER TABLE public.conversation_participants
  ADD COLUMN IF NOT EXISTS deleted_at timestamp with time zone;

-- 2. RPC to mark a conversation as deleted for the current user and
--    remove the conversation entirely when every participant has deleted it
DROP FUNCTION IF EXISTS public.delete_conversation_for_user(uuid);

CREATE OR REPLACE FUNCTION public.delete_conversation_for_user(_conversation_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_conversation RECORD;
  v_participant_id uuid;
  v_all_deleted boolean;
BEGIN
  SELECT id, host_id, guest_id
  INTO v_conversation
  FROM public.conversations
  WHERE id = _conversation_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Conversation % not found', _conversation_id
      USING ERRCODE = 'P0002';
  END IF;

  IF auth.uid() IS DISTINCT FROM v_conversation.host_id
     AND auth.uid() IS DISTINCT FROM v_conversation.guest_id THEN
    RAISE EXCEPTION 'You are not part of this conversation.'
      USING ERRCODE = '42501';
  END IF;

  IF v_conversation.host_id IS NOT NULL THEN
    INSERT INTO public.conversation_participants (conversation_id, user_id, last_read_at)
    SELECT _conversation_id, v_conversation.host_id, now()
    WHERE NOT EXISTS (
      SELECT 1
      FROM public.conversation_participants
      WHERE conversation_id = _conversation_id
        AND user_id = v_conversation.host_id
    );
  END IF;

  IF v_conversation.guest_id IS NOT NULL THEN
    INSERT INTO public.conversation_participants (conversation_id, user_id, last_read_at)
    SELECT _conversation_id, v_conversation.guest_id, now()
    WHERE NOT EXISTS (
      SELECT 1
      FROM public.conversation_participants
      WHERE conversation_id = _conversation_id
        AND user_id = v_conversation.guest_id
    );
  END IF;

  SELECT id
  INTO v_participant_id
  FROM public.conversation_participants
  WHERE conversation_id = _conversation_id
    AND user_id = auth.uid()
  LIMIT 1;

  IF v_participant_id IS NULL THEN
    RAISE EXCEPTION 'Unable to mark conversation % as deleted for current user.', _conversation_id
      USING ERRCODE = '42501';
  END IF;

  UPDATE public.conversation_participants
  SET deleted_at = COALESCE(deleted_at, now()),
      last_read_at = COALESCE(last_read_at, now())
  WHERE id = v_participant_id;

  SELECT bool_and(deleted_at IS NOT NULL)
  INTO v_all_deleted
  FROM public.conversation_participants
  WHERE conversation_id = _conversation_id;

  IF COALESCE(v_all_deleted, false) THEN
    DELETE FROM public.conversations
    WHERE id = _conversation_id;
  END IF;
END;
$function$;

REVOKE ALL ON FUNCTION public.delete_conversation_for_user(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_conversation_for_user(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_conversation_for_user(uuid) TO service_role;

-- 3. New messages should revive a conversation for all participants
CREATE OR REPLACE FUNCTION public.reset_conversation_deletions()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  UPDATE public.conversation_participants
  SET deleted_at = NULL
  WHERE conversation_id = NEW.conversation_id;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_reset_conversation_deletions ON public.messages;

CREATE TRIGGER trg_reset_conversation_deletions
AFTER INSERT ON public.messages
FOR EACH ROW
EXECUTE FUNCTION public.reset_conversation_deletions();
