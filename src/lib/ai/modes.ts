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
  { value: "expert", label: "Expert", description: "Stronger model for hard problems" },
];

const EXPERT_PROMPT_PATTERN = /\b(?:analy[sz]e|architecture|audit|debug|derive|diagnose|evaluate|expert|proof|reason(?:ing)?|refactor|research|security|strategy|trade-?offs?)\b/i;
const COMPLEX_TASK_PATTERN = /\b(?:benchmark|compare|design|implement|investigate|migrate|optimi[sz]e|plan|review|threat\s+model|troubleshoot)\b/i;
const FOLLOW_UP_PATTERN = /^(?:and\s+)?(?:do|redo|revise|continue|expand|improve|fix|apply|try|make)\b|\b(?:that|those|the same|previous|earlier|above)\b/i;
const CONSTRAINT_PATTERN = /\b(?:also|constraint|ensure|except|include|must|requirement|should|then|without)\b/gi;
const EXPERT_COMPLEXITY_THRESHOLD = 3;

export type InferenceComplexityContext = {
  conversationTurns?: number;
  totalInputCharacters?: number;
  hasImages?: boolean;
  hasDocuments?: boolean;
  priorUserPrompts?: readonly string[];
};

export type InferenceComplexityAssessment = {
  score: number;
  signals: readonly string[];
};

export function normalizeChatMode(value: unknown): ChatMode {
  return typeof value === "string" && CHAT_MODES.includes(value as ChatMode)
    ? (value as ChatMode)
    : DEFAULT_CHAT_MODE;
}

export function assessInferenceComplexity(
  prompt: string,
  context: InferenceComplexityContext = {},
): InferenceComplexityAssessment {
  const normalizedPrompt = prompt.trim();
  const signals: string[] = [];
  let score = 0;

  if (normalizedPrompt.length > 600) {
    score += 3;
    signals.push("long-prompt");
  }
  if (normalizedPrompt.includes("```")) {
    score += 3;
    signals.push("code-block");
  }
  if (EXPERT_PROMPT_PATTERN.test(normalizedPrompt)) {
    score += 3;
    signals.push("expert-task");
  } else if (COMPLEX_TASK_PATTERN.test(normalizedPrompt)) {
    score += 2;
    signals.push("complex-task");
  }

  const constraintCount = normalizedPrompt.match(CONSTRAINT_PATTERN)?.length ?? 0;
  if (constraintCount >= 3) {
    score += 2;
    signals.push("multiple-constraints");
  } else if (constraintCount >= 2) {
    score += 1;
    signals.push("constraints");
  }

  const totalInputCharacters = Math.max(normalizedPrompt.length, context.totalInputCharacters ?? 0);
  if (totalInputCharacters > 12_000) {
    score += 2;
    signals.push("large-context");
  } else if (totalInputCharacters > 4_000) {
    score += 1;
    signals.push("extended-context");
  }
  if ((context.conversationTurns ?? 0) >= 10) {
    score += 1;
    signals.push("long-conversation");
  }
  if (context.hasDocuments) {
    score += 2;
    signals.push("document-context");
  }
  if (context.hasImages) {
    score += 1;
    signals.push("vision");
  }

  const followsComplexRequest = FOLLOW_UP_PATTERN.test(normalizedPrompt)
    && (context.priorUserPrompts ?? []).slice(-3).some((previous) => (
      previous.length > 600
      || previous.includes("```")
      || EXPERT_PROMPT_PATTERN.test(previous)
      || COMPLEX_TASK_PATTERN.test(previous)
    ));
  if (followsComplexRequest) {
    score += 3;
    signals.push("complex-follow-up");
  }

  return { score, signals };
}

export function resolveInferenceTier(
  mode: ChatMode,
  prompt: string,
  context: InferenceComplexityContext = {},
): InferenceTier {
  if (mode !== "auto") return mode;
  return assessInferenceComplexity(prompt, context).score >= EXPERT_COMPLEXITY_THRESHOLD
    ? "expert"
    : "fast";
}
