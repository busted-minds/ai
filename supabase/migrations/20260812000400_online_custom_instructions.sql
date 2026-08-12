create table if not exists public.user_ai_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  custom_instructions text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint user_ai_preferences_custom_instructions_length
    check (char_length(custom_instructions) <= 4000)
);

drop trigger if exists set_user_ai_preferences_updated_at on public.user_ai_preferences;
create trigger set_user_ai_preferences_updated_at
before update on public.user_ai_preferences
for each row execute function public.set_row_updated_at();

alter table public.user_ai_preferences enable row level security;

drop policy if exists "account owners can read their AI preferences" on public.user_ai_preferences;
create policy "account owners can read their AI preferences"
on public.user_ai_preferences for select to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "account owners can create their AI preferences" on public.user_ai_preferences;
create policy "account owners can create their AI preferences"
on public.user_ai_preferences for insert to authenticated
with check ((select auth.uid()) = user_id);

drop policy if exists "account owners can update their AI preferences" on public.user_ai_preferences;
create policy "account owners can update their AI preferences"
on public.user_ai_preferences for update to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

revoke all on public.user_ai_preferences from anon;
grant select, insert, update on public.user_ai_preferences to authenticated;

comment on column public.user_ai_preferences.custom_instructions is
  'Account-synced response preferences applied by the server during inference.';
