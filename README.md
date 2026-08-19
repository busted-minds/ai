# Busted Minds AI

A responsive, production-oriented multimodal AI chat app with a private six-provider fallback cascade, image understanding, ten guest messages, unlimited account conversations, durable Supabase threads, and one shared Busted Minds Account.

## Local development

1. Copy the required public Supabase values from `.env.example` into `.env` alongside the server-only keys.
2. Run `npm install`.
3. Run `npm run dev` and open `http://localhost:3000`.

All inference keys and Supabase secret keys are read only by server routes. Never add `NEXT_PUBLIC_` to a secret.

Inference uses an adaptive, zero-cost six-provider registry. Authenticated provider catalogs are refreshed every 15 minutes and filtered to free text/vision chat models. Reviewed Fast/Expert preference lists provide a stable base order for general, code, reasoning, multilingual, and vision requests; live capability, context, latency, health, and quota data adjust that order. Runtime health is synchronized through a service-role-only Supabase state table so serverless instances share cooldowns and observed performance, with an in-process fallback if synchronization is unavailable. Slow requests are hedged across different providers. Set `AI_MODEL_CATALOG_TTL_MS`, `AI_SHARED_STATE_SYNC_MS`, and `AI_SHARED_STATE_TIMEOUT_MS` to tune refresh and synchronization timing.

Fresh or explicitly searched questions use a server-only free-tier search cascade in this order: Brave Web Search, Brave Answers, both Tavily keys, Exa, both Google Custom Search keys, then DuckDuckGo Instant Answers. Failed, empty, unauthorized, or quota-exhausted providers are cooled down and the next provider is tried automatically. Successful searches are cached for five minutes to conserve quota. Tavily is fixed to one-credit `basic` searches, Exa uses bounded `instant` highlights, Brave Answers does not enable research mode, and Google is capped at at most 100 attempts per UTC day in each warm runtime. Set `WEB_SEARCH_CACHE_TTL_MS` to adjust the cache and `GOOGLE_SEARCH_DAILY_LIMIT` to lower (never raise) the Google cap. Keep paid overage disabled in every provider dashboard for a strict zero-cost guarantee; application-side limits cannot override an account that has billing enabled. Google has announced that Custom Search JSON API will shut down on January 1, 2027, so it is deliberately a late fallback.

For a protected operational snapshot, set a long random `AI_HEALTH_TOKEN` and request `GET /api/ai/health` with `Authorization: Bearer <token>`. Add `?refresh=1` to force an authenticated catalog refresh. The endpoint is disabled with a 404 when the token is unset and never returns API keys, prompts, or responses.

The chat and embedded widget accept up to three JPEG, PNG, WebP, PDF, DOCX, TXT, Markdown, CSV, or JSON files per message. Images are resized in the browser to at most 1600 px and 800 KB each before upload. Signed-in users upload documents directly to the private `chat-files` Supabase Storage bucket, bypassing the Vercel Function request-body limit; documents are limited to 8 MB each and 16 MB combined. Extracted text is bounded and saved with the message so later turns can reuse it. Guests can attach images, while document uploads require a Busted Minds Account. Private files are fetched through an authenticated route.

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

## Busted Minds Chess coaching

Completed Nova Reviews can request contextual follow-up explanations through
`POST /api/integrations/chess`. This is a private server-to-server endpoint,
not a browser API. Set the same random `BMAI_CHESS_INTEGRATION_SECRET` of at
least 32 characters in the Chess and BMAI deployments. Chess signs the exact
request body with HMAC-SHA256 and sends the timestamp and signature in
`X-BM-Chess-Timestamp` and `X-BM-Chess-Signature`.

The endpoint accepts only bounded `source: "nova-review"` payloads, disables
web search, uses a supportive chess-specific system prompt, and grounds concrete
move claims in the Stockfish review supplied by Chess. These requests are
ephemeral and are not written to BMAI threads or projects.
