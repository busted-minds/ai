drop policy if exists "account owners can delete their messages" on public.chat_messages;
create policy "account owners can delete their messages"
on public.chat_messages for delete to authenticated
using (
  (select auth.uid()) = user_id
  and exists (
    select 1 from public.chat_threads
    where chat_threads.id = chat_messages.thread_id
      and chat_threads.user_id = (select auth.uid())
  )
);

grant delete on public.chat_messages to authenticated;

create or replace function public.replace_chat_branch(
  p_thread_id uuid,
  p_delete_message_ids uuid[],
  p_user_message_id uuid,
  p_user_content text,
  p_assistant_message_id uuid,
  p_assistant_content text,
  p_title text
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
begin
  if current_user_id is null or not exists (
    select 1
    from public.chat_threads
    where id = p_thread_id and user_id = current_user_id
  ) then
    raise exception 'Conversation not found';
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
    insert into public.chat_messages (id, thread_id, user_id, role, content)
    values (p_user_message_id, p_thread_id, current_user_id, 'user', p_user_content);
  end if;

  insert into public.chat_messages (id, thread_id, user_id, role, content)
  values (p_assistant_message_id, p_thread_id, current_user_id, 'assistant', p_assistant_content);
end;
$$;

revoke all on function public.replace_chat_branch(uuid, uuid[], uuid, text, uuid, text, text) from public, anon;
grant execute on function public.replace_chat_branch(uuid, uuid[], uuid, text, uuid, text, text) to authenticated;
