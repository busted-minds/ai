alter table public.chat_messages
  add column if not exists parent_message_id uuid;

with ordered_messages as (
  select
    id,
    lag(id) over (partition by thread_id order by created_at, id) as previous_message_id
  from public.chat_messages
)
update public.chat_messages as message
set parent_message_id = ordered.previous_message_id
from ordered_messages as ordered
where message.id = ordered.id
  and message.parent_message_id is null;

alter table public.chat_messages
  drop constraint if exists chat_messages_thread_id_id_key;
alter table public.chat_messages
  add constraint chat_messages_thread_id_id_key unique (thread_id, id);
alter table public.chat_messages
  drop constraint if exists chat_messages_parent_same_thread_fkey;
alter table public.chat_messages
  add constraint chat_messages_parent_same_thread_fkey
  foreign key (thread_id, parent_message_id)
  references public.chat_messages (thread_id, id)
  on delete cascade;

create index if not exists chat_messages_thread_parent_idx
  on public.chat_messages (thread_id, parent_message_id, created_at, id);

alter table public.chat_threads
  add column if not exists active_leaf_id uuid;

update public.chat_threads as thread
set active_leaf_id = (
  select message.id
  from public.chat_messages as message
  where message.thread_id = thread.id
  order by message.created_at desc, message.id desc
  limit 1
)
where thread.active_leaf_id is null;

drop function if exists public.replace_chat_branch(uuid, uuid[], uuid, text, uuid, text, text, jsonb, text);

create or replace function public.append_chat_branch(
  p_thread_id uuid,
  p_parent_message_id uuid,
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
  current_active_leaf_id uuid;
  inserted_at timestamptz := clock_timestamp();
  normalized_attachments jsonb := coalesce(p_user_attachments, '[]'::jsonb);
  normalized_attachment_context text := coalesce(p_user_attachment_context, '');
begin
  if current_user_id is null then
    raise exception 'Conversation not found';
  end if;

  select active_leaf_id
  into current_active_leaf_id
  from public.chat_threads
  where id = p_thread_id and user_id = current_user_id
  for update;

  if not found then
    raise exception 'Conversation not found';
  end if;

  if p_parent_message_id is not null and not exists (
    with recursive active_path as (
      select message.id, message.parent_message_id
      from public.chat_messages as message
      where message.thread_id = p_thread_id
        and message.user_id = current_user_id
        and message.id = current_active_leaf_id
      union all
      select parent.id, parent.parent_message_id
      from public.chat_messages as parent
      join active_path as child on child.parent_message_id = parent.id
      where parent.thread_id = p_thread_id
        and parent.user_id = current_user_id
    )
    select 1 from active_path where id = p_parent_message_id
  ) then
    raise exception 'The selected conversation branch is no longer active';
  end if;

  if jsonb_typeof(normalized_attachments) <> 'array'
    or jsonb_array_length(normalized_attachments) > 3
    or octet_length(normalized_attachments::text) > 8192
    or char_length(normalized_attachment_context) > 48000 then
    raise exception 'Invalid message attachments';
  end if;

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
      p_parent_message_id,
      inserted_at
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
    coalesce(p_user_message_id, p_parent_message_id),
    inserted_at + interval '1 microsecond'
  );

  update public.chat_threads
  set active_leaf_id = p_assistant_message_id
  where id = p_thread_id and user_id = current_user_id;
end;
$$;

revoke all on function public.append_chat_branch(uuid, uuid, uuid, text, uuid, text, text, jsonb, text)
  from public, anon;
grant execute on function public.append_chat_branch(uuid, uuid, uuid, text, uuid, text, text, jsonb, text)
  to authenticated;

create or replace function public.create_chat_share(p_thread_id uuid)
returns table (share_token text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  thread_title text;
  thread_active_leaf_id uuid;
  snapshot jsonb;
  generated_token text;
begin
  if current_user_id is null then
    raise exception 'Sign in required';
  end if;

  select title, active_leaf_id
  into thread_title, thread_active_leaf_id
  from public.chat_threads
  where id = p_thread_id
    and user_id = current_user_id;

  if thread_title is null then
    raise exception 'Conversation not found';
  end if;

  with recursive active_path as (
    select message.*, 0 as depth
    from public.chat_messages as message
    where message.thread_id = p_thread_id
      and message.user_id = current_user_id
      and message.id = thread_active_leaf_id
    union all
    select parent.*, child.depth + 1
    from public.chat_messages as parent
    join active_path as child on child.parent_message_id = parent.id
    where parent.thread_id = p_thread_id
      and parent.user_id = current_user_id
  )
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'role', message.role,
      'content', message.content,
      'attachments', coalesce((
        select jsonb_agg(jsonb_build_object(
          'name', attachment.item ->> 'name',
          'mimeType', attachment.item ->> 'mimeType',
          'size', attachment.item -> 'size'
        ))
        from jsonb_array_elements(message.attachments) as attachment(item)
      ), '[]'::jsonb)
    )
    order by message.depth desc
  ), '[]'::jsonb)
  into snapshot
  from (
    select * from active_path order by depth asc limit 200
  ) as message;

  if jsonb_array_length(snapshot) = 0 then
    raise exception 'Empty conversations cannot be shared';
  end if;

  generated_token := encode(extensions.gen_random_bytes(24), 'hex');
  insert into public.chat_shares (token, owner_user_id, source_thread_id, title, messages)
  values (generated_token, current_user_id, p_thread_id, thread_title, snapshot);

  return query select generated_token;
end;
$$;

create or replace function public.import_shared_chat(p_token text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  selected_share public.chat_shares%rowtype;
  imported_thread_id uuid;
  imported_parent_id uuid := null;
  imported_message_id uuid;
  imported_message jsonb;
  imported_content text;
  import_started_at timestamptz := clock_timestamp();
  message_index integer := 0;
begin
  if current_user_id is null then
    raise exception 'Sign in required';
  end if;

  select * into selected_share
  from public.chat_shares
  where token = p_token
  for update;

  if selected_share.id is null then
    raise exception 'Shared conversation not found';
  end if;

  select thread_id into imported_thread_id
  from public.chat_share_imports
  where share_id = selected_share.id and user_id = current_user_id;

  if imported_thread_id is not null then
    return imported_thread_id;
  end if;

  insert into public.chat_threads (user_id, title)
  values (current_user_id, selected_share.title)
  returning id into imported_thread_id;

  for imported_message in
    select item from jsonb_array_elements(selected_share.messages) as shared_message(item)
  loop
    imported_content := left(
      concat(
        imported_message ->> 'content',
        case
          when jsonb_array_length(coalesce(imported_message -> 'attachments', '[]'::jsonb)) > 0
          then concat(
            case when coalesce(imported_message ->> 'content', '') = '' then '' else E'\n\n' end,
            '[Shared attachment',
            case when jsonb_array_length(imported_message -> 'attachments') = 1 then '' else 's' end,
            ': ',
            coalesce((
              select string_agg(attachment.item ->> 'name', ', ')
              from jsonb_array_elements(imported_message -> 'attachments') as attachment(item)
            ), 'attachment'),
            ']'
          )
          else ''
        end
      ),
      50000
    );

    insert into public.chat_messages (
      thread_id, user_id, role, content, parent_message_id, created_at
    ) values (
      imported_thread_id,
      current_user_id,
      imported_message ->> 'role',
      imported_content,
      imported_parent_id,
      import_started_at + (message_index * interval '1 microsecond')
    ) returning id into imported_message_id;

    imported_parent_id := imported_message_id;
    message_index := message_index + 1;
  end loop;

  update public.chat_threads
  set active_leaf_id = imported_parent_id
  where id = imported_thread_id and user_id = current_user_id;

  insert into public.chat_share_imports (share_id, user_id, thread_id)
  values (selected_share.id, current_user_id, imported_thread_id);

  return imported_thread_id;
end;
$$;

comment on column public.chat_messages.parent_message_id is
  'The preceding message in this retained conversation branch; sibling rows are alternate versions.';
comment on column public.chat_threads.active_leaf_id is
  'The leaf of the conversation branch currently selected by the account owner.';
