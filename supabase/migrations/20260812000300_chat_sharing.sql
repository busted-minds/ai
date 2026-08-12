create table if not exists public.chat_shares (
  id uuid primary key default gen_random_uuid(),
  token text not null unique,
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  source_thread_id uuid references public.chat_threads(id) on delete set null,
  title text not null,
  messages jsonb not null,
  created_at timestamptz not null default now(),
  constraint chat_shares_token_format check (token ~ '^[0-9a-f]{48}$'),
  constraint chat_shares_title_length check (char_length(title) between 1 and 80),
  constraint chat_shares_messages_shape check (
    jsonb_typeof(messages) = 'array'
    and jsonb_array_length(messages) between 1 and 200
    and octet_length(messages::text) <= 11000000
  )
);

create table if not exists public.chat_share_imports (
  share_id uuid not null references public.chat_shares(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  thread_id uuid not null references public.chat_threads(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (share_id, user_id),
  constraint chat_share_imports_thread_unique unique (thread_id)
);

create index if not exists chat_shares_owner_user_idx
  on public.chat_shares (owner_user_id);
create index if not exists chat_shares_source_thread_idx
  on public.chat_shares (source_thread_id);
create index if not exists chat_share_imports_user_idx
  on public.chat_share_imports (user_id);

alter table public.chat_shares enable row level security;
alter table public.chat_share_imports enable row level security;

revoke all on public.chat_shares, public.chat_share_imports from public, anon, authenticated;

create or replace function public.create_chat_share(p_thread_id uuid)
returns table (share_token text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  thread_title text;
  snapshot jsonb;
  generated_token text;
begin
  if current_user_id is null then
    raise exception 'Sign in required';
  end if;

  select title
  into thread_title
  from public.chat_threads
  where id = p_thread_id
    and user_id = current_user_id;

  if thread_title is null then
    raise exception 'Conversation not found';
  end if;

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
    order by message.created_at, message.id
  ), '[]'::jsonb)
  into snapshot
  from (
    select id, role, content, attachments, created_at
    from public.chat_messages
    where thread_id = p_thread_id
      and user_id = current_user_id
    order by created_at desc, id desc
    limit 200
  ) as message;

  if jsonb_array_length(snapshot) = 0 then
    raise exception 'Empty conversations cannot be shared';
  end if;

  generated_token := encode(extensions.gen_random_bytes(24), 'hex');
  insert into public.chat_shares (
    token,
    owner_user_id,
    source_thread_id,
    title,
    messages
  ) values (
    generated_token,
    current_user_id,
    p_thread_id,
    thread_title,
    snapshot
  );

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
  import_started_at timestamptz := clock_timestamp();
begin
  if current_user_id is null then
    raise exception 'Sign in required';
  end if;

  select *
  into selected_share
  from public.chat_shares
  where token = p_token
  for update;

  if selected_share.id is null then
    raise exception 'Shared conversation not found';
  end if;

  select thread_id
  into imported_thread_id
  from public.chat_share_imports
  where share_id = selected_share.id
    and user_id = current_user_id;

  if imported_thread_id is not null then
    return imported_thread_id;
  end if;

  insert into public.chat_threads (user_id, title)
  values (current_user_id, selected_share.title)
  returning id into imported_thread_id;

  insert into public.chat_messages (
    thread_id,
    user_id,
    role,
    content,
    created_at
  )
  select
    imported_thread_id,
    current_user_id,
    message.item ->> 'role',
    left(
      concat(
        message.item ->> 'content',
        case
          when jsonb_array_length(coalesce(message.item -> 'attachments', '[]'::jsonb)) > 0
          then concat(
            case when coalesce(message.item ->> 'content', '') = '' then '' else E'\n\n' end,
            '[Shared attachment',
            case when jsonb_array_length(message.item -> 'attachments') = 1 then '' else 's' end,
            ': ',
            coalesce((
              select string_agg(attachment.item ->> 'name', ', ')
              from jsonb_array_elements(message.item -> 'attachments') as attachment(item)
            ), 'attachment'),
            ']'
          )
          else ''
        end
      ),
      50000
    ),
    import_started_at + ((message.ordinality - 1) * interval '1 microsecond')
  from jsonb_array_elements(selected_share.messages) with ordinality as message(item, ordinality);

  insert into public.chat_share_imports (share_id, user_id, thread_id)
  values (selected_share.id, current_user_id, imported_thread_id);

  return imported_thread_id;
end;
$$;

revoke all on function public.create_chat_share(uuid) from public, anon;
grant execute on function public.create_chat_share(uuid) to authenticated;

revoke all on function public.import_shared_chat(text) from public, anon;
grant execute on function public.import_shared_chat(text) to authenticated;

comment on table public.chat_shares is
  'Immutable, token-addressed snapshots of conversations. Direct client access is denied.';
comment on table public.chat_share_imports is
  'One private imported thread per shared conversation and recipient.';
