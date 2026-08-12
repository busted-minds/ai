create table if not exists public.chat_projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint chat_projects_name_length check (char_length(name) between 1 and 60)
);

alter table public.chat_threads
  add column if not exists project_id uuid;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'chat_threads_project_id_fkey'
      and conrelid = 'public.chat_threads'::regclass
  ) then
    alter table public.chat_threads
      add constraint chat_threads_project_id_fkey
      foreign key (project_id) references public.chat_projects(id) on delete set null;
  end if;
end $$;

create index if not exists chat_projects_user_updated_idx
  on public.chat_projects (user_id, updated_at desc);
create index if not exists chat_threads_project_id_idx
  on public.chat_threads (project_id);

drop trigger if exists set_chat_projects_updated_at on public.chat_projects;
create trigger set_chat_projects_updated_at
before update on public.chat_projects
for each row execute function public.set_row_updated_at();

alter table public.chat_projects enable row level security;

drop policy if exists "account owners can read their projects" on public.chat_projects;
create policy "account owners can read their projects"
on public.chat_projects for select to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "account owners can create their projects" on public.chat_projects;
create policy "account owners can create their projects"
on public.chat_projects for insert to authenticated
with check ((select auth.uid()) = user_id);

drop policy if exists "account owners can update their projects" on public.chat_projects;
create policy "account owners can update their projects"
on public.chat_projects for update to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

drop policy if exists "account owners can delete their projects" on public.chat_projects;
create policy "account owners can delete their projects"
on public.chat_projects for delete to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "account owners can create their threads" on public.chat_threads;
create policy "account owners can create their threads"
on public.chat_threads for insert to authenticated
with check (
  (select auth.uid()) = user_id
  and (
    project_id is null
    or exists (
      select 1 from public.chat_projects
      where chat_projects.id = chat_threads.project_id
        and chat_projects.user_id = (select auth.uid())
    )
  )
);

drop policy if exists "account owners can update their threads" on public.chat_threads;
create policy "account owners can update their threads"
on public.chat_threads for update to authenticated
using ((select auth.uid()) = user_id)
with check (
  (select auth.uid()) = user_id
  and (
    project_id is null
    or exists (
      select 1 from public.chat_projects
      where chat_projects.id = chat_threads.project_id
        and chat_projects.user_id = (select auth.uid())
    )
  )
);

revoke all on public.chat_projects from anon;
grant select, insert, update, delete on public.chat_projects to authenticated;
