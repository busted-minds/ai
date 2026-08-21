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
const { data: clientList, error: clientListError } = await central.auth.admin.oauth.listClients({ perPage: 100 });
if (clientListError) throw clientListError;
const clients = Array.isArray(clientList)
  ? clientList
  : clientList?.clients ?? clientList?.data?.clients ?? [];
const { data: providerList, error: providerListError } = await bmai.auth.admin.customProviders.listProviders({ type: "oidc" });
if (providerListError) throw providerListError;
const providers = Array.isArray(providerList)
  ? providerList
  : providerList?.providers ?? providerList?.data?.providers ?? [];
const registrations = [
  {
    identifier: "custom:busted-minds",
    clientName: "Busted Minds AI",
    clientUri: "https://ai.bustedminds.org/",
    logoUri: "https://ai.bustedminds.org/brand/bmai-logo-light.png",
  },
  {
    identifier: "custom:busted-minds-search",
    clientName: "Busted Minds Search",
    clientUri: "https://search.bustedminds.org/",
    logoUri: "https://search.bustedminds.org/image/busted-minds-search-short-version.png",
  },
];

async function configureRegistration(registration) {
  let oauthClient = clients.find((client) =>
    client.client_name === registration.clientName && client.redirect_uris.includes(callback));
  let provider = providers.find((candidate) => candidate.identifier === registration.identifier);
  let clientSecret;

  if (!oauthClient) {
    const { data, error } = await central.auth.admin.oauth.createClient({
      client_name: registration.clientName,
      client_uri: registration.clientUri,
      redirect_uris: [callback],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      scope: "openid email profile",
      token_endpoint_auth_method: "client_secret_basic",
    });
    if (error) throw error;
    oauthClient = data;
    clientSecret = data.client_secret;
  }

  const clientUpdate = {};
  if (oauthClient.client_uri !== registration.clientUri) clientUpdate.client_uri = registration.clientUri;
  if (oauthClient.logo_uri !== registration.logoUri) clientUpdate.logo_uri = registration.logoUri;
  if (Object.keys(clientUpdate).length > 0) {
    const { data, error } = await central.auth.admin.oauth.updateClient(oauthClient.client_id, clientUpdate);
    if (error) throw error;
    oauthClient = data;
  }

  if (!provider || provider.client_id !== oauthClient.client_id) {
    if (!clientSecret) {
      const { data, error } = await central.auth.admin.oauth.regenerateClientSecret(oauthClient.client_id);
      if (error) throw error;
      oauthClient = data;
      clientSecret = data.client_secret;
    }
  }

  if (!oauthClient || (!provider && !clientSecret)) {
    throw new Error(`The confidential client secret for ${registration.clientName} was unavailable.`);
  }
  const providerConfiguration = {
    name: registration.clientName,
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
      identifier: registration.identifier,
      ...providerConfiguration,
      client_secret: clientSecret,
    });
    if (error) throw error;
    provider = data;
  } else {
    const update = { ...providerConfiguration };
    if (clientSecret) update.client_secret = clientSecret;
    const { data, error } = await bmai.auth.admin.customProviders.updateProvider(registration.identifier, update);
    if (error) throw error;
    provider = data;
  }

  if (!provider.enabled || provider.client_id !== oauthClient.client_id || provider.issuer !== `${centralUrl}/auth/v1`) {
    throw new Error(`OIDC provider verification failed for ${registration.identifier}.`);
  }
  return oauthClient.client_id;
}

for (const registration of registrations) {
  const clientId = await configureRegistration(registration);
  console.log(`Verified ${registration.clientName} as ${registration.identifier} (${clientId}).`);
}
console.log("No client secret was printed or written to disk.");
