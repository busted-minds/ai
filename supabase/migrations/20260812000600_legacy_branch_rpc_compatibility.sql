create or replace function public.replace_chat_branch(
  p_thread_id uuid,
  p_delete_message_ids uuid[],
  p_user_message_id uuid,
  p_user_content text,
  p_assistant_message_id uuid,
  p_assistant_content text,
  p_title text,
  p_user_attachments jsonb,
  p_user_attachment_context text
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  requested_count integer := coalesce(cardinality(p_delete_message_ids), 0);
  owned_count integer;
  branch_parent_message_id uuid;
  replacement_created_at timestamptz := clock_timestamp();
  normalized_attachments jsonb := coalesce(p_user_attachments, '[]'::jsonb);
  normalized_attachment_context text := coalesce(p_user_attachment_context, '');
begin
  if current_user_id is null or not exists (
    select 1
    from public.chat_threads
    where id = p_thread_id and user_id = current_user_id
  ) then
    raise exception 'Conversation not found';
  end if;

  if jsonb_typeof(normalized_attachments) <> 'array'
    or jsonb_array_length(normalized_attachments) > 3
    or octet_length(normalized_attachments::text) > 8192
    or char_length(normalized_attachment_context) > 48000 then
    raise exception 'Invalid message attachments';
  end if;

  select count(*)::integer
  into owned_count
  from public.chat_messages
  where thread_id = p_thread_id
    and user_id = current_user_id
    and id = any(p_delete_message_ids);

  if requested_count = 0 or owned_count <> requested_count then
    raise exception 'Invalid replacement branch';
  end if;

  select parent_message_id
  into branch_parent_message_id
  from public.chat_messages
  where thread_id = p_thread_id
    and user_id = current_user_id
    and id = any(p_delete_message_ids)
  order by created_at, id
  limit 1;

  delete from public.chat_messages
  where thread_id = p_thread_id
    and user_id = current_user_id
    and id = any(p_delete_message_ids);

  if p_title is not null then
    update public.chat_threads
    set title = p_title
    where id = p_thread_id and user_id = current_user_id;
  end if;

  if p_user_message_id is not null then
    insert into public.chat_messages (
      id,
      thread_id,
      user_id,
      role,
      content,
      attachments,
      attachment_context,
      parent_message_id,
      created_at
    ) values (
      p_user_message_id,
      p_thread_id,
      current_user_id,
      'user',
      p_user_content,
      normalized_attachments,
      normalized_attachment_context,
      branch_parent_message_id,
      replacement_created_at
    );
  end if;

  insert into public.chat_messages (
    id,
    thread_id,
    user_id,
    role,
    content,
    parent_message_id,
    created_at
  ) values (
    p_assistant_message_id,
    p_thread_id,
    current_user_id,
    'assistant',
    p_assistant_content,
    coalesce(p_user_message_id, branch_parent_message_id),
    replacement_created_at + interval '1 microsecond'
  );

  update public.chat_threads
  set active_leaf_id = p_assistant_message_id
  where id = p_thread_id and user_id = current_user_id;
end;
$$;

revoke all on function public.replace_chat_branch(uuid, uuid[], uuid, text, uuid, text, text, jsonb, text)
  from public, anon;
grant execute on function public.replace_chat_branch(uuid, uuid[], uuid, text, uuid, text, text, jsonb, text)
  to authenticated;

comment on function public.replace_chat_branch(uuid, uuid[], uuid, text, uuid, text, text, jsonb, text) is
  'Compatibility path for pre-branching app deployments. New clients use append_chat_branch.';
