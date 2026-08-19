import type { InferenceTier } from "./modes";

export const PROVIDER_NAMES = [
  "google",
  "nvidia",
  "openrouter",
  "mistral",
  "cerebras",
  "groq",
] as const;

export type ProviderName = (typeof PROVIDER_NAMES)[number];

export type ProviderKeyName =
  | "GOOGLE_API_KEY"
  | "NVIDIA_API_KEY"
  | "OPENROUTER_API_KEY"
  | "MISTRAL_API_KEY"
  | "CEREBRAS_API_KEY"
  | "GROQ_API_KEY";

export type ModelSpecialty = "code" | "reasoning" | "general" | "multilingual";

export type ModelSpec = {
  /** Stable health/telemetry key shared everywhere this provider/model is used. */
  id: string;
  provider: ProviderName;
  keyName: ProviderKeyName;
  model: string;
  free: true;
  vision: boolean;
  quality: number;
  speed: number;
  contextWindow?: number;
  specialties: readonly ModelSpecialty[];
  source: "catalog" | "fallback" | "router";
};

export type RoutingPreference = ModelSpecialty | "vision";

export type CuratedModelProfile = Pick<ModelSpec, "quality" | "speed" | "specialties"> & {
  vision?: boolean;
};

export type ProviderDefinition = {
  name: ProviderName;
  keyName: ProviderKeyName;
  catalogUrl: string;
};

export const PROVIDER_DEFINITIONS: readonly ProviderDefinition[] = [
  {
    name: "google",
    keyName: "GOOGLE_API_KEY",
    catalogUrl: "https://generativelanguage.googleapis.com/v1beta/models",
  },
  {
    name: "nvidia",
    keyName: "NVIDIA_API_KEY",
    catalogUrl: "https://integrate.api.nvidia.com/v1/models",
  },
  {
    name: "openrouter",
    keyName: "OPENROUTER_API_KEY",
    catalogUrl: "https://openrouter.ai/api/v1/models",
  },
  {
    name: "mistral",
    keyName: "MISTRAL_API_KEY",
    catalogUrl: "https://api.mistral.ai/v1/models",
  },
  {
    name: "cerebras",
    keyName: "CEREBRAS_API_KEY",
    // The authenticated catalog does not expose enough pricing metadata to
    // distinguish shared/PAYG models from genuinely no-cost models.
    catalogUrl: "https://api.cerebras.ai/public/v1/models",
  },
  {
    name: "groq",
    keyName: "GROQ_API_KEY",
    catalogUrl: "https://api.groq.com/openai/v1/models",
  },
] as const;

export const PROVIDER_BY_NAME = Object.fromEntries(
  PROVIDER_DEFINITIONS.map((provider) => [provider.name, provider]),
) as Record<ProviderName, ProviderDefinition>;

type SeedOptions = Omit<ModelSpec, "id" | "free" | "source"> & {
  source?: ModelSpec["source"];
};

export function defineModel(options: SeedOptions): ModelSpec {
  return {
    ...options,
    id: `${options.provider}:${options.model}`,
    free: true,
    source: options.source ?? "fallback",
  };
}

const general = ["general"] as const;
const reasoning = ["general", "reasoning"] as const;
const codeReasoning = ["general", "reasoning", "code"] as const;
const multilingualReasoning = ["general", "reasoning", "multilingual"] as const;

/**
 * Human-reviewed profiles override model-name inference. Catalog capability
 * metadata still wins for vision and context-window fields when it is present.
 */
export const CURATED_MODEL_PROFILES: Readonly<Record<string, CuratedModelProfile>> = {
  "google:gemini-3.6-flash": {
    quality: 9.8, speed: 8.5, specialties: codeReasoning, vision: true,
  },
  "google:gemini-3.5-flash": {
    quality: 9.3, speed: 8.8, specialties: codeReasoning, vision: true,
  },
  "nvidia:openai/gpt-oss-120b": {
    quality: 9.1, speed: 9, specialties: codeReasoning,
  },
  "nvidia:openai/gpt-oss-20b": {
    quality: 8, speed: 9.7, specialties: codeReasoning,
  },
  "nvidia:nvidia/llama-3.3-nemotron-super-49b-v1.5": {
    quality: 8.7, speed: 9.3, specialties: reasoning,
  },
  "mistral:mistral-medium-latest": {
    quality: 9.5, speed: 7.4, specialties: ["general", "reasoning", "code", "multilingual"], vision: true,
  },
  "mistral:mistral-large-2512": {
    quality: 9.3, speed: 5.4, specialties: multilingualReasoning, vision: true,
  },
} as const;

/**
 * Stable base routing policy. Missing or retired models are simply skipped
 * after each live catalog refresh; scored catalog candidates remain as the
 * final fallback behind these reviewed choices.
 */
export const CURATED_MODEL_ORDER: Readonly<
  Record<InferenceTier, Record<RoutingPreference, readonly string[]>>
> = {
  fast: {
    general: [
      "groq:openai/gpt-oss-20b",
      "google:gemini-3.5-flash-lite",
      "nvidia:nvidia/nemotron-3.5-lightning-30b-a3b",
      "openrouter:nvidia/nemotron-3.5-lightning:free",
      "mistral:mistral-small-latest",
    ],
    code: [
      "groq:openai/gpt-oss-20b",
      "google:gemini-3.5-flash",
      "openrouter:cohere/north-mini-code:free",
      "nvidia:openai/gpt-oss-20b",
      "mistral:mistral-code-latest",
      "cerebras:zai-glm-4.7",
    ],
    reasoning: [
      "groq:openai/gpt-oss-20b",
      "nvidia:nvidia/nemotron-3.5-lightning-30b-a3b",
      "google:gemini-3.5-flash",
      "openrouter:nvidia/nemotron-3.5-lightning:free",
      "mistral:magistral-small-latest",
      "cerebras:gpt-oss-120b",
    ],
    multilingual: [
      "google:gemini-3.5-flash-lite",
      "mistral:mistral-small-latest",
      "nvidia:z-ai/glm-5.2",
      "groq:allam-2-7b",
      "cerebras:zai-glm-4.7",
      "openrouter:nvidia/nemotron-3.5-lightning:free",
    ],
    vision: [
      "google:gemini-3.5-flash-lite",
      "groq:qwen/qwen3.6-27b",
      "openrouter:nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free",
      "nvidia:nvidia/nemotron-3-nano-omni-30b-a3b-reasoning",
      "mistral:mistral-small-latest",
    ],
  },
  expert: {
    general: [
      "google:gemini-3.6-flash",
      "mistral:mistral-medium-latest",
      "nvidia:nvidia/nemotron-3-ultra-550b-a55b",
      "mistral:mistral-large-latest",
      "google:gemini-3.5-flash",
      "groq:openai/gpt-oss-120b",
      "cerebras:gpt-oss-120b",
      "openrouter:nvidia/nemotron-3-ultra-550b-a55b:free",
    ],
    code: [
      "google:gemini-3.6-flash",
      "mistral:mistral-medium-latest",
      "nvidia:nvidia/nemotron-3-ultra-550b-a55b",
      "mistral:mistral-large-latest",
      "google:gemini-3.5-flash",
      "groq:openai/gpt-oss-120b",
      "nvidia:openai/gpt-oss-120b",
      "openrouter:nvidia/nemotron-3-ultra-550b-a55b:free",
    ],
    reasoning: [
      "google:gemini-3.6-flash",
      "mistral:mistral-medium-latest",
      "nvidia:nvidia/nemotron-3-ultra-550b-a55b",
      "mistral:magistral-small-latest",
      "google:gemini-3.5-flash",
      "groq:openai/gpt-oss-120b",
      "cerebras:gpt-oss-120b",
      "openrouter:nvidia/nemotron-3-ultra-550b-a55b:free",
    ],
    multilingual: [
      "google:gemini-3.6-flash",
      "mistral:mistral-medium-latest",
      "mistral:mistral-large-latest",
      "nvidia:z-ai/glm-5.2",
      "google:gemini-3.5-flash",
      "cerebras:zai-glm-4.7",
      "groq:openai/gpt-oss-120b",
    ],
    vision: [
      "google:gemini-3.6-flash",
      "mistral:mistral-medium-latest",
      "google:gemini-3.5-flash",
      "mistral:mistral-large-latest",
      "groq:qwen/qwen3.6-27b",
      "openrouter:nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free",
      "nvidia:nvidia/nemotron-3-nano-omni-30b-a3b-reasoning",
    ],
  },
} as const;

/**
 * Last-known-good models used only when an authenticated catalog cannot be
 * refreshed. A successful catalog response always replaces these entries, so
 * removed models do not linger indefinitely.
 */
export const FALLBACK_MODELS: readonly ModelSpec[] = [
  defineModel({
    provider: "google", keyName: "GOOGLE_API_KEY", model: "gemini-3.6-flash",
    vision: true, quality: 9.2, speed: 8.5, specialties: reasoning,
  }),
  defineModel({
    provider: "google", keyName: "GOOGLE_API_KEY", model: "gemini-3.5-flash-lite",
    vision: true, quality: 7.8, speed: 9.8, specialties: general,
  }),
  defineModel({
    provider: "nvidia", keyName: "NVIDIA_API_KEY",
    model: "nvidia/nemotron-3.5-lightning-30b-a3b",
    vision: false, quality: 8.3, speed: 9.2, specialties: reasoning,
  }),
  defineModel({
    provider: "nvidia", keyName: "NVIDIA_API_KEY",
    model: "nvidia/nemotron-3-ultra-550b-a55b",
    vision: false, quality: 9.6, speed: 4.5, specialties: codeReasoning,
  }),
  defineModel({
    provider: "nvidia", keyName: "NVIDIA_API_KEY",
    model: "nvidia/nemotron-3-super-120b-a12b",
    vision: false, quality: 9, speed: 7, specialties: codeReasoning,
  }),
  defineModel({
    provider: "nvidia", keyName: "NVIDIA_API_KEY",
    model: "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning",
    vision: true, quality: 8.3, speed: 7.5, specialties: reasoning,
  }),

  defineModel({
    provider: "openrouter", keyName: "OPENROUTER_API_KEY", model: "openrouter/free",
    vision: true, quality: 8, speed: 7, specialties: reasoning, source: "router",
  }),
  defineModel({
    provider: "openrouter", keyName: "OPENROUTER_API_KEY",
    model: "nvidia/nemotron-3-ultra-550b-a55b:free",
    vision: false, quality: 9.6, speed: 4.5, specialties: codeReasoning,
  }),
  defineModel({
    provider: "openrouter", keyName: "OPENROUTER_API_KEY",
    model: "nvidia/nemotron-3.5-lightning:free",
    vision: false, quality: 8.3, speed: 9, specialties: reasoning,
  }),

  defineModel({
    provider: "mistral", keyName: "MISTRAL_API_KEY", model: "mistral-large-latest",
    vision: true, quality: 9.2, speed: 6.5, specialties: codeReasoning,
  }),
  defineModel({
    provider: "mistral", keyName: "MISTRAL_API_KEY", model: "mistral-small-latest",
    vision: true, quality: 8, speed: 9, specialties: general,
  }),
  defineModel({
    provider: "mistral", keyName: "MISTRAL_API_KEY", model: "ministral-8b-latest",
    vision: true, quality: 7.3, speed: 9.5, specialties: general,
  }),
  defineModel({
    provider: "mistral", keyName: "MISTRAL_API_KEY", model: "magistral-small-latest",
    vision: true, quality: 8.6, speed: 7, specialties: reasoning,
  }),

  defineModel({
    provider: "groq", keyName: "GROQ_API_KEY", model: "openai/gpt-oss-20b",
    vision: false, quality: 8, speed: 9.8, specialties: codeReasoning,
  }),
  defineModel({
    provider: "groq", keyName: "GROQ_API_KEY", model: "openai/gpt-oss-120b",
    vision: false, quality: 9.1, speed: 9, specialties: codeReasoning,
  }),
  defineModel({
    provider: "groq", keyName: "GROQ_API_KEY", model: "qwen/qwen3.6-27b",
    vision: true, quality: 9, speed: 9, specialties: codeReasoning,
  }),
  defineModel({
    provider: "groq", keyName: "GROQ_API_KEY", model: "groq/compound",
    vision: false, quality: 8.7, speed: 8.5, specialties: codeReasoning,
  }),
  defineModel({
    provider: "groq", keyName: "GROQ_API_KEY", model: "groq/compound-mini",
    vision: false, quality: 8, speed: 9.5, specialties: reasoning,
  }),
] as const;

/** Static compatibility view; runtime routing uses the refreshed registry. */
export const MODEL_POOLS: Record<InferenceTier, readonly ModelSpec[]> = {
  fast: FALLBACK_MODELS.filter((model) => model.speed >= 8),
  expert: FALLBACK_MODELS.filter((model) => model.quality >= 8.6),
};

/** Static compatibility view; runtime routing uses the refreshed registry. */
export const VISION_MODEL_POOLS: Record<InferenceTier, readonly ModelSpec[]> = {
  fast: MODEL_POOLS.fast.filter((model) => model.vision),
  expert: MODEL_POOLS.expert.filter((model) => model.vision),
};
