export const CHAT_MODES = ["fast", "auto", "expert"] as const;

export type ChatMode = (typeof CHAT_MODES)[number];
export type InferenceTier = Exclude<ChatMode, "auto">;

export const DEFAULT_CHAT_MODE: ChatMode = "fast";

export const CHAT_MODE_OPTIONS: ReadonlyArray<{
  value: ChatMode;
  label: string;
  description: string;
}> = [
  { value: "fast", label: "Fast", description: "Quick answers with low latency" },
  { value: "auto", label: "Auto", description: "Balances speed and depth" },
  { value: "expert", label: "Expert", description: "Stronger models for hard problems" },
];

const EXPERT_PROMPT_PATTERN = /\b(?:analy[sz]e|architecture|audit|debug|derive|diagnose|evaluate|expert|proof|reason(?:ing)?|refactor|research|security|strategy|trade-?offs?)\b/i;

export function normalizeChatMode(value: unknown): ChatMode {
  return typeof value === "string" && CHAT_MODES.includes(value as ChatMode)
    ? (value as ChatMode)
    : DEFAULT_CHAT_MODE;
}

export function resolveInferenceTier(mode: ChatMode, prompt: string): InferenceTier {
  if (mode !== "auto") return mode;

  const normalizedPrompt = prompt.trim();
  return normalizedPrompt.length > 600 || normalizedPrompt.includes("```") || EXPERT_PROMPT_PATTERN.test(normalizedPrompt)
    ? "expert"
    : "fast";
}
