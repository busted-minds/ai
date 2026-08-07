# Busted Minds AI

A responsive, production-oriented AI chat app with a private six-provider fallback cascade, ten guest messages, unlimited account conversations, durable Supabase threads, and one shared Busted Minds Account.

## Local development

1. Copy the required public Supabase values from `.env.example` into `.env` alongside the server-only keys.
2. Run `npm install`.
3. Run `npm run dev` and open `http://localhost:3000`.

All inference keys and Supabase secret keys are read only by server routes. Never add `NEXT_PUBLIC_` to a secret.

## Verification

```powershell
npm run verify
```

Supabase migrations live in `supabase/migrations`. Project-specific management scripts live in `scripts` and use the authenticated Supabase Management API; they do not rely on the PostgreSQL pooler.

Authentication is federated through the central Busted Minds Account at `accounts.bustedminds.us.kg`. BMAI never invokes Google directly; it uses the `custom:busted-minds` OIDC provider and keeps its application data in the separate `bmai` Supabase project.
