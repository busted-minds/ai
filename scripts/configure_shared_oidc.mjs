import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

const AI_ROOT = resolve(import.meta.dirname, "..");
const CHESS_ROOT = resolve(AI_ROOT, "..", "chess");

function readEnv(path) {
  const values = {};
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    values[match[1]] = match[2].trim().replace(/^("|')|("|')$/g, "");
  }
  return values;
}

const aiEnv = readEnv(resolve(AI_ROOT, ".env"));
const chessEnv = readEnv(resolve(CHESS_ROOT, ".env"));
const centralUrl = "https://mbqplfqelnljrlvzkmxe.supabase.co";
const bmaiUrl = "https://zwefyzpiknkopvcjbfsy.supabase.co";
const centralSecret = chessEnv.SUPABASE_SECRET_KEY;
const bmaiSecret = aiEnv.SUPABASE_SECRET_KEY;
if (!centralSecret || !bmaiSecret) throw new Error("Both project secret keys are required.");

const central = createClient(centralUrl, centralSecret, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const bmai = createClient(bmaiUrl, bmaiSecret, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const callback = `${bmaiUrl}/auth/v1/callback`;
const clientName = "Busted Minds AI";
const { data: clientList, error: clientListError } = await central.auth.admin.oauth.listClients({ perPage: 100 });
if (clientListError) throw clientListError;
const clients = Array.isArray(clientList)
  ? clientList
  : clientList?.clients ?? clientList?.data?.clients ?? [];
let oauthClient = clients.find((client) =>
  client.client_name === clientName && client.redirect_uris.includes(callback));

const { data: providerList, error: providerListError } = await bmai.auth.admin.customProviders.listProviders({ type: "oidc" });
if (providerListError) throw providerListError;
const providers = Array.isArray(providerList)
  ? providerList
  : providerList?.providers ?? providerList?.data?.providers ?? [];
let provider = providers.find((candidate) => candidate.identifier === "custom:busted-minds");
let clientSecret;

if (!oauthClient) {
  const { data, error } = await central.auth.admin.oauth.createClient({
    client_name: clientName,
    client_uri: "https://bustedminds.org/",
    redirect_uris: [callback],
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    scope: "openid email profile",
    token_endpoint_auth_method: "client_secret_basic",
  });
  if (error) throw error;
  oauthClient = data;
  clientSecret = data.client_secret;
} else if (!provider || provider.client_id !== oauthClient.client_id) {
  const { data, error } = await central.auth.admin.oauth.regenerateClientSecret(oauthClient.client_id);
  if (error) throw error;
  oauthClient = data;
  clientSecret = data.client_secret;
}

if (!oauthClient || (!provider && !clientSecret)) throw new Error("The confidential client secret was unavailable.");
const providerConfiguration = {
  name: "Busted Minds",
  client_id: oauthClient.client_id,
  scopes: ["openid", "email", "profile"],
  pkce_enabled: true,
  enabled: true,
  email_optional: false,
  issuer: `${centralUrl}/auth/v1`,
  skip_nonce_check: false,
};

if (!provider) {
  const { data, error } = await bmai.auth.admin.customProviders.createProvider({
    provider_type: "oidc",
    identifier: "custom:busted-minds",
    ...providerConfiguration,
    client_secret: clientSecret,
  });
  if (error) throw error;
  provider = data;
} else {
  const update = { ...providerConfiguration };
  if (clientSecret) update.client_secret = clientSecret;
  const { data, error } = await bmai.auth.admin.customProviders.updateProvider("custom:busted-minds", update);
  if (error) throw error;
  provider = data;
}

if (!provider.enabled || provider.client_id !== oauthClient.client_id || provider.issuer !== `${centralUrl}/auth/v1`) {
  throw new Error("OIDC provider verification failed.");
}
console.log("Verified one confidential Busted Minds AI client and custom:busted-minds in BMAI.");
console.log(`Central client ID: ${oauthClient.client_id}`);
console.log("No client secret was printed or written to disk.");
