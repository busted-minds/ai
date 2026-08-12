# Busted Minds AI

A responsive, production-oriented multimodal AI chat app with a private six-provider fallback cascade, image understanding, ten guest messages, unlimited account conversations, durable Supabase threads, and one shared Busted Minds Account.

## Local development

1. Copy the required public Supabase values from `.env.example` into `.env` alongside the server-only keys.
2. Run `npm install`.
3. Run `npm run dev` and open `http://localhost:3000`.

All inference keys and Supabase secret keys are read only by server routes. Never add `NEXT_PUBLIC_` to a secret.

The chat and embedded widget accept up to three JPEG, PNG, or WebP images per message. Images are resized in the browser to at most 1600 px and 800 KB each before upload. Account images live in the private `chat-images` Supabase Storage bucket and are fetched through an authenticated route; guest images remain available only for the current browser session.

## Verification

```powershell
npm run verify
```

Supabase migrations live in `supabase/migrations`. Project-specific management scripts live in `scripts` and use the authenticated Supabase Management API; they do not rely on the PostgreSQL pooler.

Authentication is federated through the central Busted Minds Account at `accounts.bustedminds.us.kg`. BMAI never invokes Google directly; it uses the `custom:busted-minds` OIDC provider and keeps its application data in the separate `bmai` Supabase project.

The canonical custom username remains in the central Accounts/Chess `profiles` table. The central OIDC server exposes verified usernames as the standard `preferred_username` profile claim; BMAI stores a read-only projection in `account_profiles` and does not provide username creation or editing.

## Vanilla-site widget

Add the hosted widget script just before the closing `</body>` tag:

```html
<script
  src="https://YOUR-BMAI-DOMAIN/widget.js"
  data-theme="auto"
  data-position="right"
  async
></script>
```

The widget uses the same server-enforced allowance as the full app: ten total guest messages and unlimited messages after signing in with a Busted Minds Account. Optional attributes are `data-theme="auto|dark|light"`, `data-position="right|left"`, `data-label="Ask Busted Minds AI"`, and `data-open="true"`.

The host page can also control the panel with `BustedMindsAI.open()`, `BustedMindsAI.close()`, or `BustedMindsAI.toggle()` after the script loads.
