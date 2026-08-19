import {
  CURATED_MODEL_PROFILES,
  FALLBACK_MODELS,
  PROVIDER_BY_NAME,
  PROVIDER_DEFINITIONS,
  defineModel,
  type ModelSpec,
  type ModelSpecialty,
  type ProviderDefinition,
  type ProviderName,
} from "./model-pools";

const CATALOG_TTL_MS = 15 * 60 * 1_000;
const CATALOG_TIMEOUT_MS = 3_500;
const RETIREMENT_GUARD_MS = 7 * 24 * 60 * 60 * 1_000;

const GOOGLE_FREE_CHAT_MODELS = new Set([
  "gemini-3.6-flash",
  "gemini-3.5-flash",
  "gemini-3.5-flash-lite",
  "gemini-3.1-flash-lite",
  "gemini-3-flash-preview",
  "gemini-flash-latest",
  "gemini-flash-lite-latest",
  "gemma-4-26b-a4b-it",
  "gemma-4-31b-it",
]);

const GROQ_RETIREMENTS: Readonly<Record<string, string>> = {
  "llama-3.1-8b-instant": "2026-08-16T00:00:00Z",
  "llama-3.3-70b-versatile": "2026-08-16T00:00:00Z",
  "qwen/qwen3-32b": "2026-07-17T00:00:00Z",
  "meta-llama/llama-4-scout-17b-16e-instruct": "2026-07-17T00:00:00Z",
};

/** Model families whose endpoint is not a general text-answering chat model. */
const UNSUITABLE_MODEL_PATTERN = /(?:audio|clip|diffusion|embed|guard|image(?:gen)?|lyria|moderation|ocr|parse|rerank|retriev|reward|safety|speech|translate|tts|whisper)/i;
/** NVIDIA's list endpoint retains many retired models, so admit maintained families only. */
const NVIDIA_CURRENT_CHAT_PATTERN = /^(?:deepseek-ai\/deepseek-v\d+-flash-[\d-]+|google\/gemma-4-[\w.-]+|mistralai\/mistral-nemotron|nvidia\/llama-3\.3-nemotron-super-49b-v1\.5|nvidia\/nemotron-(?:3(?:\.5)?|4|mini|nano)[\w.-]*|nvidia\/nvidia-nemotron-[\w.-]+|openai\/gpt-oss-(?:20b|120b)|z-ai\/glm-[\d.]+)$/i;
const NVIDIA_INCOMPATIBLE_CHAT_MODELS = new Set([
  // Still returned by NVIDIA's historical catalog, but its chat endpoint is 404.
  "nvidia/llama-3.1-nemotron-ultra-253b-v1",
]);
const VISION_PATTERN = /(?:fuyu|gemma-[34]|omni|pixtral|(?:^|[\/_-])vl(?:$|[\/_-])|vision|vila|neva)/i;
const REASONING_PATTERN = /(?:deepseek|gpt-oss|magistral|nemotron|o[1-9](?:$|[-/])|qwq|reason|thinking)/i;
const CODE_PATTERN = /(?:code|coder|codestral|devstral|gpt-oss|leanstral|qwen)/i;
const MULTILINGUAL_PATTERN = /(?:allam|aya|command-r|glm|mistral|qwen)/i;

type UnknownRecord = Record<string, unknown>;

export type ProviderCatalogStatus = {
  provider: ProviderName;
  configured: boolean;
  source: "catalog" | "fallback" | "unconfigured";
  catalogModels: number;
  refreshedAt: string | null;
  error: string | null;
};

export type ModelCatalogSnapshot = {
  models: readonly ModelSpec[];
  providers: readonly ProviderCatalogStatus[];
  refreshedAt: string;
  expiresAt: number;
};

let cachedSnapshot: ModelCatalogSnapshot | null = null;
let refreshPromise: Promise<ModelCatalogSnapshot> | null = null;

function record(value: unknown): UnknownRecord | null {
  return value && typeof value === "object" ? value as UnknownRecord : null;
}

function records(value: unknown): UnknownRecord[] {
  return Array.isArray(value)
    ? value.map(record).filter((item): item is UnknownRecord => Boolean(item))
    : [];
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function numberValue(value: unknown): number | undefined {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function booleanValue(value: unknown): boolean {
  return value === true;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function specialties(model: string): ModelSpecialty[] {
  const result: ModelSpecialty[] = ["general"];
  if (REASONING_PATTERN.test(model)) result.push("reasoning");
  if (CODE_PATTERN.test(model)) result.push("code");
  if (MULTILINGUAL_PATTERN.test(model)) result.push("multilingual");
  return result;
}

function inferredQuality(model: string): number {
  if (/(?:ultra|550b|405b|340b|235b|pro(?:$|[-/])|large|gpt-oss-120b)/i.test(model)) return 9.2;
  if (/(?:120b|72b|70b|65b|medium|super|compound$|31b|32b|35b)/i.test(model)) return 8.7;
  if (/(?:30b|27b|26b|24b|20b|flash$|magistral|reason)/i.test(model)) return 8.2;
  if (/(?:14b|12b|9b|8b|small|flash-lite|mini)/i.test(model)) return 7.4;
  if (/(?:7b|4b|3b|2b|1b|tiny)/i.test(model)) return 6.5;
  return 7.8;
}

function inferredSpeed(model: string): number {
  if (/(?:lightning|flash-lite|nano|tiny|mini|3b|4b|8b|9b)/i.test(model)) return 9.5;
  if (/(?:flash|small|14b|20b|27b|30b|31b|32b|compound-mini)/i.test(model)) return 8.7;
  if (/(?:70b|72b|120b|medium|super|gpt-oss-120b)/i.test(model)) return 7.2;
  if (/(?:235b|340b|405b|550b|ultra|large|pro(?:$|[-/]))/i.test(model)) return 5.2;
  return 7.8;
}

function discoveredModel(
  provider: ProviderName,
  model: string,
  options: { vision?: boolean; contextWindow?: number; source?: ModelSpec["source"] } = {},
): ModelSpec {
  const definition = PROVIDER_BY_NAME[provider];
  const fallback = FALLBACK_MODELS.find((candidate) => (
    candidate.provider === provider && candidate.model === model
  ));
  const curated = CURATED_MODEL_PROFILES[`${provider}:${model}`];
  return defineModel({
    provider,
    keyName: definition.keyName,
    model,
    vision: options.vision ?? curated?.vision ?? fallback?.vision ?? VISION_PATTERN.test(model),
    quality: curated?.quality ?? fallback?.quality ?? inferredQuality(model),
    speed: curated?.speed ?? fallback?.speed ?? inferredSpeed(model),
    ...(options.contextWindow ? { contextWindow: options.contextWindow } : {}),
    specialties: curated?.specialties ?? fallback?.specialties ?? specialties(model),
    source: options.source ?? "catalog",
  });
}

function isZeroPrice(value: unknown): boolean {
  if (value === undefined || value === null || value === "") return true;
  return numberValue(value) === 0;
}

function isExplicitZeroPrice(value: unknown): boolean {
  return value !== undefined && value !== null && value !== "" && numberValue(value) === 0;
}

function parseGoogle(payload: unknown): ModelSpec[] {
  const root = record(payload);
  return records(root?.models)
    .flatMap((item) => {
      const model = stringValue(item.name)?.replace(/^models\//, "");
      const methods = stringArray(item.supportedGenerationMethods);
      if (!model || !GOOGLE_FREE_CHAT_MODELS.has(model) || !methods.includes("generateContent")) return [];
      return [discoveredModel("google", model, {
        vision: !model.startsWith("gemma-4-") || /(?:26b|31b)/.test(model),
        contextWindow: numberValue(item.inputTokenLimit),
      })];
    });
}

function parseOpenRouter(payload: unknown): ModelSpec[] {
  const root = record(payload);
  return records(root?.data).flatMap((item) => {
    const model = stringValue(item.id);
    const pricing = record(item.pricing);
    const architecture = record(item.architecture);
    const outputModalities = stringArray(architecture?.output_modalities);
    const inputModalities = stringArray(architecture?.input_modalities);
    if (
      !model
      || UNSUITABLE_MODEL_PATTERN.test(model)
      || !isZeroPrice(pricing?.prompt)
      || !isZeroPrice(pricing?.completion)
      || !isZeroPrice(pricing?.request)
      || (outputModalities.length > 0 && !outputModalities.includes("text"))
    ) return [];
    return [discoveredModel("openrouter", model, {
      vision: inputModalities.includes("image"),
      contextWindow: numberValue(item.context_length),
      source: model === "openrouter/free" ? "router" : "catalog",
    })];
  });
}

function parseMistral(payload: unknown): ModelSpec[] {
  const root = record(payload);
  return records(root?.data).flatMap((item) => {
    const model = stringValue(item.id);
    const capabilities = record(item.capabilities);
    if (
      !model
      || !booleanValue(capabilities?.completion_chat)
      || Boolean(item.deprecation)
      || UNSUITABLE_MODEL_PATTERN.test(model)
      || /voxtral/i.test(model)
    ) return [];
    return [discoveredModel("mistral", model, {
      vision: booleanValue(capabilities?.vision),
      contextWindow: numberValue(item.max_context_length),
    })];
  });
}

function parseGroq(payload: unknown, now: number): ModelSpec[] {
  const root = record(payload);
  return records(root?.data).flatMap((item) => {
    const model = stringValue(item.id);
    const retirement = model ? GROQ_RETIREMENTS[model] : undefined;
    const inputModalities = stringArray(item.input_modalities);
    const outputModalities = stringArray(item.output_modalities);
    if (
      !model
      || item.active === false
      || UNSUITABLE_MODEL_PATTERN.test(model)
      || (inputModalities.length > 0 && !inputModalities.includes("text"))
      || (outputModalities.length > 0 && !outputModalities.includes("text"))
      || (retirement && Date.parse(retirement) - now <= RETIREMENT_GUARD_MS)
    ) return [];
    return [discoveredModel("groq", model, {
      vision: inputModalities.includes("image"),
      contextWindow: numberValue(item.context_window) ?? numberValue(item.context_length),
    })];
  });
}

function parseNvidia(payload: unknown): ModelSpec[] {
  const root = record(payload);
  return records(root?.data).flatMap((item) => {
    const model = stringValue(item.id);
    if (
      !model
      || UNSUITABLE_MODEL_PATTERN.test(model)
      || NVIDIA_INCOMPATIBLE_CHAT_MODELS.has(model)
      || !NVIDIA_CURRENT_CHAT_PATTERN.test(model)
    ) return [];
    return [discoveredModel("nvidia", model)];
  });
}

function parseCerebras(payload: unknown): ModelSpec[] {
  const root = record(payload);
  return records(root?.data).flatMap((item) => {
    const model = stringValue(item.id);
    const pricing = record(item.pricing);
    const capabilities = record(item.capabilities);
    const limits = record(item.limits);
    const architecture = record(item.architecture);
    const modality = stringValue(architecture?.modality);
    if (
      !model
      || item.deprecated === true
      || UNSUITABLE_MODEL_PATTERN.test(model)
      || !pricing
      || !isExplicitZeroPrice(pricing.prompt)
      || !isExplicitZeroPrice(pricing.completion)
    ) return [];
    return [discoveredModel("cerebras", model, {
      vision: booleanValue(capabilities?.vision) || Boolean(modality && /vision/i.test(modality)),
      contextWindow: numberValue(limits?.max_context_length),
    })];
  });
}

export function parseProviderCatalog(
  provider: ProviderName,
  payload: unknown,
  now = Date.now(),
): ModelSpec[] {
  const parsed = provider === "google" ? parseGoogle(payload)
    : provider === "openrouter" ? parseOpenRouter(payload)
      : provider === "mistral" ? parseMistral(payload)
        : provider === "groq" ? parseGroq(payload, now)
          : provider === "nvidia" ? parseNvidia(payload)
            : parseCerebras(payload);
  return [...new Map(parsed.map((model) => [model.id, model])).values()];
}

function catalogTtl(): number {
  const configured = Number(process.env.AI_MODEL_CATALOG_TTL_MS);
  return Number.isFinite(configured) && configured >= 60_000 ? configured : CATALOG_TTL_MS;
}

async function fetchProviderCatalog(
  provider: ProviderDefinition,
  apiKey: string,
): Promise<ModelSpec[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CATALOG_TIMEOUT_MS);
  const url = provider.name === "google"
    ? `${provider.catalogUrl}?key=${encodeURIComponent(apiKey)}`
    : provider.catalogUrl;
  try {
    const response = await fetch(url, {
      headers: provider.name === "google" || provider.name === "cerebras"
        ? undefined
        : { Authorization: `Bearer ${apiKey}` },
      signal: controller.signal,
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`catalog returned ${response.status}`);
    const models = parseProviderCatalog(provider.name, await response.json());
    // A paid-only Cerebras catalog is a valid empty free catalog. Other
    // providers retain their last-known free fallbacks when parsing fails.
    if (!models.length && provider.name !== "cerebras") {
      throw new Error("catalog contained no eligible free chat models");
    }
    return models;
  } finally {
    clearTimeout(timer);
  }
}

function safeCatalogError(caught: unknown): string {
  if (caught instanceof DOMException && caught.name === "AbortError") return "catalog timeout";
  if (caught instanceof Error && /^catalog (?:returned|contained)/.test(caught.message)) return caught.message;
  return "catalog request failed";
}

async function refreshCatalog(): Promise<ModelCatalogSnapshot> {
  const refreshedAt = new Date().toISOString();
  const results = await Promise.all(PROVIDER_DEFINITIONS.map(async (provider) => {
    const key = process.env[provider.keyName];
    if (!key) {
      return {
        models: [] as ModelSpec[],
        status: {
          provider: provider.name,
          configured: false,
          source: "unconfigured" as const,
          catalogModels: 0,
          refreshedAt: null,
          error: null,
        },
      };
    }
    try {
      const models = await fetchProviderCatalog(provider, key);
      return {
        models,
        status: {
          provider: provider.name,
          configured: true,
          source: "catalog" as const,
          catalogModels: models.length,
          refreshedAt,
          error: null,
        },
      };
    } catch (caught) {
      const models = FALLBACK_MODELS.filter((model) => model.provider === provider.name);
      return {
        models,
        status: {
          provider: provider.name,
          configured: true,
          source: "fallback" as const,
          catalogModels: models.length,
          refreshedAt,
          error: safeCatalogError(caught),
        },
      };
    }
  }));

  const models = [...new Map(results.flatMap((result) => result.models).map((model) => [model.id, model])).values()];
  const snapshot: ModelCatalogSnapshot = {
    models,
    providers: results.map((result) => result.status),
    refreshedAt,
    expiresAt: Date.now() + catalogTtl(),
  };
  cachedSnapshot = snapshot;
  console.info("[ai-catalog]", JSON.stringify({
    event: "refresh",
    models: models.length,
    providers: snapshot.providers.map(({ provider, source, catalogModels, error }) => ({
      provider, source, catalogModels, error,
    })),
  }));
  return snapshot;
}

function startRefresh(): Promise<ModelCatalogSnapshot> {
  if (!refreshPromise) {
    refreshPromise = refreshCatalog().finally(() => {
      refreshPromise = null;
    });
  }
  return refreshPromise;
}

export async function getFreeModelCatalog(): Promise<ModelCatalogSnapshot> {
  if (cachedSnapshot && cachedSnapshot.expiresAt > Date.now()) return cachedSnapshot;
  if (cachedSnapshot) {
    void startRefresh();
    return cachedSnapshot;
  }
  return startRefresh();
}

export async function forceModelCatalogRefresh(): Promise<ModelCatalogSnapshot> {
  cachedSnapshot = null;
  return startRefresh();
}

export function currentModelCatalogSnapshot(): ModelCatalogSnapshot | null {
  return cachedSnapshot;
}

export function resetModelCatalogForTests(): void {
  cachedSnapshot = null;
  refreshPromise = null;
}
