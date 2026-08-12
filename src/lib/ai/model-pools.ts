import type { InferenceTier } from "./modes";

export type ProviderKeyName =
  | "GOOGLE_API_KEY"
  | "NVIDIA_API_KEY"
  | "OPENROUTER_API_KEY"
  | "MISTRAL_API_KEY"
  | "CEREBRAS_API_KEY"
  | "GROQ_API_KEY";

export type ModelSpec = {
  id: string;
  provider: "google" | "nvidia" | "openrouter" | "mistral" | "cerebras" | "groq";
  keyName: ProviderKeyName;
  model: string;
};

export const MODEL_POOLS: Record<InferenceTier, readonly ModelSpec[]> = {
  fast: [
    {
      id: "groq-gpt-oss-20b",
      provider: "groq",
      keyName: "GROQ_API_KEY",
      model: "openai/gpt-oss-20b",
    },
    {
      id: "google-gemini-flash",
      provider: "google",
      keyName: "GOOGLE_API_KEY",
      model: "gemini-3.6-flash",
    },
    {
      id: "nvidia-nemotron-lightning",
      provider: "nvidia",
      keyName: "NVIDIA_API_KEY",
      model: "nvidia/nemotron-3.5-lightning-30b-a3b",
    },
    {
      id: "openrouter-nemotron-nano-free",
      provider: "openrouter",
      keyName: "OPENROUTER_API_KEY",
      model: "nvidia/nemotron-3-nano-30b-a3b:free",
    },
    {
      id: "cerebras-gpt-oss-120b-fast-fallback",
      provider: "cerebras",
      keyName: "CEREBRAS_API_KEY",
      model: "gpt-oss-120b",
    },
  ],
  expert: [
    {
      id: "openrouter-nemotron-ultra-free",
      provider: "openrouter",
      keyName: "OPENROUTER_API_KEY",
      model: "nvidia/nemotron-3-ultra-550b-a55b:free",
    },
    {
      id: "nvidia-nemotron-ultra",
      provider: "nvidia",
      keyName: "NVIDIA_API_KEY",
      model: "nvidia/nemotron-3-ultra-550b-a55b",
    },
    {
      id: "google-gemini-pro",
      provider: "google",
      keyName: "GOOGLE_API_KEY",
      model: "gemini-pro-latest",
    },
    {
      id: "groq-gpt-oss-120b",
      provider: "groq",
      keyName: "GROQ_API_KEY",
      model: "openai/gpt-oss-120b",
    },
    {
      id: "cerebras-gpt-oss-120b-expert-fallback",
      provider: "cerebras",
      keyName: "CEREBRAS_API_KEY",
      model: "gpt-oss-120b",
    },
    {
      id: "mistral-large",
      provider: "mistral",
      keyName: "MISTRAL_API_KEY",
      model: "mistral-large-latest",
    },
  ],
};

export const VISION_MODEL_POOLS: Record<InferenceTier, readonly ModelSpec[]> = {
  fast: [
    {
      id: "google-gemini-flash-vision",
      provider: "google",
      keyName: "GOOGLE_API_KEY",
      model: "gemini-3.6-flash",
    },
    {
      id: "groq-qwen-vision",
      provider: "groq",
      keyName: "GROQ_API_KEY",
      model: "qwen/qwen3.6-27b",
    },
    {
      id: "mistral-ministral-vision",
      provider: "mistral",
      keyName: "MISTRAL_API_KEY",
      model: "ministral-8b-2512",
    },
    {
      id: "openrouter-free-vision",
      provider: "openrouter",
      keyName: "OPENROUTER_API_KEY",
      model: "openrouter/free",
    },
    {
      id: "nvidia-nemotron-omni-vision",
      provider: "nvidia",
      keyName: "NVIDIA_API_KEY",
      model: "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning",
    },
  ],
  expert: [
    {
      id: "google-gemini-pro-vision",
      provider: "google",
      keyName: "GOOGLE_API_KEY",
      model: "gemini-pro-latest",
    },
    {
      id: "mistral-large-vision",
      provider: "mistral",
      keyName: "MISTRAL_API_KEY",
      model: "mistral-large-latest",
    },
    {
      id: "groq-qwen-vision-expert-fallback",
      provider: "groq",
      keyName: "GROQ_API_KEY",
      model: "qwen/qwen3.6-27b",
    },
    {
      id: "nvidia-nemotron-omni-vision-expert-fallback",
      provider: "nvidia",
      keyName: "NVIDIA_API_KEY",
      model: "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning",
    },
    {
      id: "openrouter-free-vision-expert-fallback",
      provider: "openrouter",
      keyName: "OPENROUTER_API_KEY",
      model: "openrouter/free",
    },
  ],
};
