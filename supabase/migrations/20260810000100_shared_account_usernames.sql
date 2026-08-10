-- Store a read-only projection of the canonical Busted Minds Account username.
-- The source remains public.profiles in the central Chess/Accounts project.

alter table public.account_profiles
  add column if not exists username text;

alter table public.account_profiles
  drop constraint if exists account_profiles_username_format;
alter table public.account_profiles
  add constraint account_profiles_username_format
  check (username is null or username ~ '^[a-zA-Z0-9_]{3,24}$');

create unique index if not exists account_profiles_username_lower_idx
  on public.account_profiles (lower(username))
  where username is not null;

-- Safely populate rows whose stored custom-OIDC identity already contains the
-- central, verified profile claim. A cross-project management backfill fills
-- older identities that predate preferred_username issuance.
update public.account_profiles as profile
set username = identity.identity_data ->> 'preferred_username'
from auth.identities as identity
where identity.user_id = profile.id
  and identity.provider = 'custom:busted-minds'
  and identity.identity_data ->> 'email_verified' = 'true'
  and identity.identity_data ->> 'preferred_username' ~ '^[a-zA-Z0-9_]{3,24}$'
  and case
        when identity.identity_data ->> 'sub' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
          then (identity.identity_data ->> 'sub')::uuid
        else null
      end = profile.central_account_id
  and profile.username is distinct from identity.identity_data ->> 'preferred_username';

-- BMAI users can read this projection but cannot create or mutate it through
-- the public API. The server sync uses the project secret after validating the
-- provider-owned OIDC identity.
revoke insert, update on public.account_profiles from authenticated;

comment on column public.account_profiles.username is
  'Read-only projection of the verified preferred_username issued by the central Busted Minds Account OIDC provider.';
