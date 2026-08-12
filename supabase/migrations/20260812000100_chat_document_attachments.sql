alter table public.chat_messages
  add column if not exists attachment_context text not null default '';

alter table public.chat_messages
  drop constraint if exists chat_messages_attachment_context_check;
alter table public.chat_messages
  add constraint chat_messages_attachment_context_check check (
    char_length(attachment_context) <= 48000
    and (role = 'user' or attachment_context = '')
  );

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'chat-files',
  'chat-files',
  false,
  8000000,
  array[
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'text/plain',
    'text/markdown',
    'text/csv',
    'application/csv',
    'application/json'
  ]::text[]
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "account owners can read their chat files" on storage.objects;
create policy "account owners can read their chat files"
on storage.objects for select to authenticated
using (
  bucket_id = 'chat-files'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

drop policy if exists "account owners can upload their chat files" on storage.objects;
create policy "account owners can upload their chat files"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'chat-files'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

drop policy if exists "account owners can delete their chat files" on storage.objects;
create policy "account owners can delete their chat files"
on storage.objects for delete to authenticated
using (
  bucket_id = 'chat-files'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

drop function if exists public.replace_chat_branch(uuid, uuid[], uuid, text, uuid, text, text);
drop function if exists public.replace_chat_branch(uuid, uuid[], uuid, text, uuid, text, text, jsonb);

create function public.replace_chat_branch(
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
      created_at
    )
    values (
      p_user_message_id,
      p_thread_id,
      current_user_id,
      'user',
      p_user_content,
      normalized_attachments,
      normalized_attachment_context,
      replacement_created_at
    );
  end if;

  insert into public.chat_messages (id, thread_id, user_id, role, content, created_at)
  values (
    p_assistant_message_id,
    p_thread_id,
    current_user_id,
    'assistant',
    p_assistant_content,
    replacement_created_at + interval '1 microsecond'
  );
end;
$$;

revoke all on function public.replace_chat_branch(uuid, uuid[], uuid, text, uuid, text, text, jsonb, text)
  from public, anon;
grant execute on function public.replace_chat_branch(uuid, uuid[], uuid, text, uuid, text, text, jsonb, text)
  to authenticated;

comment on column public.chat_messages.attachments is
  'Private image and document attachment metadata. Binary data is stored in private Storage buckets.';
comment on column public.chat_messages.attachment_context is
  'Bounded text extracted from user documents for reuse in later inference turns.';
