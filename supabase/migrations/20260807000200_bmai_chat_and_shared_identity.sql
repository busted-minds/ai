create extension if not exists pgcrypto with schema extensions;

create table if not exists public.account_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  central_account_id uuid not null unique,
  email text,
  display_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint account_profiles_display_name_length check (display_name is null or char_length(display_name) <= 120)
);

create table if not exists public.chat_threads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null default 'Untitled thought',
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint chat_threads_title_length check (char_length(title) between 1 and 80)
);

create table if not exists public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.chat_threads(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null,
  content text not null,
  created_at timestamptz not null default now(),
  constraint chat_messages_role_check check (role in ('user', 'assistant')),
  constraint chat_messages_content_length check (char_length(content) between 1 and 50000)
);

create index if not exists chat_threads_user_updated_idx
  on public.chat_threads (user_id, updated_at desc)
  where archived = false;
create index if not exists chat_messages_thread_created_idx
  on public.chat_messages (thread_id, created_at asc);
create index if not exists chat_messages_user_idx
  on public.chat_messages (user_id);

create or replace function public.touch_chat_thread()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  update public.chat_threads
  set updated_at = now()
  where id = new.thread_id and user_id = new.user_id;
  return new;
end;
$$;

drop trigger if exists touch_chat_thread_after_message on public.chat_messages;
create trigger touch_chat_thread_after_message
after insert on public.chat_messages
for each row execute function public.touch_chat_thread();

create or replace function public.set_row_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_account_profiles_updated_at on public.account_profiles;
create trigger set_account_profiles_updated_at
before update on public.account_profiles
for each row execute function public.set_row_updated_at();

drop trigger if exists set_chat_threads_updated_at on public.chat_threads;
create trigger set_chat_threads_updated_at
before update on public.chat_threads
for each row execute function public.set_row_updated_at();

alter table public.account_profiles enable row level security;
alter table public.chat_threads enable row level security;
alter table public.chat_messages enable row level security;

drop policy if exists "account owners can read their profile" on public.account_profiles;
create policy "account owners can read their profile"
on public.account_profiles for select to authenticated
using ((select auth.uid()) = id);

drop policy if exists "account owners can create their profile" on public.account_profiles;
create policy "account owners can create their profile"
on public.account_profiles for insert to authenticated
with check ((select auth.uid()) = id);

drop policy if exists "account owners can update their profile" on public.account_profiles;
create policy "account owners can update their profile"
on public.account_profiles for update to authenticated
using ((select auth.uid()) = id)
with check ((select auth.uid()) = id);

drop policy if exists "account owners can read their threads" on public.chat_threads;
create policy "account owners can read their threads"
on public.chat_threads for select to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "account owners can create their threads" on public.chat_threads;
create policy "account owners can create their threads"
on public.chat_threads for insert to authenticated
with check ((select auth.uid()) = user_id);

drop policy if exists "account owners can update their threads" on public.chat_threads;
create policy "account owners can update their threads"
on public.chat_threads for update to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

drop policy if exists "account owners can delete their threads" on public.chat_threads;
create policy "account owners can delete their threads"
on public.chat_threads for delete to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "account owners can read their messages" on public.chat_messages;
create policy "account owners can read their messages"
on public.chat_messages for select to authenticated
using (
  (select auth.uid()) = user_id
  and exists (
    select 1 from public.chat_threads
    where chat_threads.id = chat_messages.thread_id
      and chat_threads.user_id = (select auth.uid())
  )
);

drop policy if exists "account owners can create their messages" on public.chat_messages;
create policy "account owners can create their messages"
on public.chat_messages for insert to authenticated
with check (
  (select auth.uid()) = user_id
  and exists (
    select 1 from public.chat_threads
    where chat_threads.id = chat_messages.thread_id
      and chat_threads.user_id = (select auth.uid())
  )
);

revoke all on public.account_profiles, public.chat_threads, public.chat_messages from anon;
grant select, insert, update on public.account_profiles to authenticated;
grant select, insert, update, delete on public.chat_threads to authenticated;
grant select, insert on public.chat_messages to authenticated;

comment on column public.account_profiles.central_account_id is
  'Canonical subject (sub) issued by the central Busted Minds OAuth/OIDC server.';

