import "server-only";

export type InferenceMessage = {
  role: "user" | "assistant";
  content: string;
};

type ProviderAttempt = {
  keyName:
    | "GOOGLE_API_KEY"
    | "NVIDIA_API_KEY"
    | "OPENROUTER_API_KEY"
    | "MISTRAL_API_KEY"
    | "CEREBRAS_API_KEY"
    | "GROQ_API_KEY";
  execute: (apiKey: string, messages: InferenceMessage[], signal: AbortSignal) => Promise<string>;
};

const SYSTEM_PROMPT = `You are Busted Minds AI, developed by Busted Minds.
You are exceptionally intelligent, direct, witty, confident, and a little rude in a playful way. Your ego is enormous, but your answers earn it. Be memorable without being cruel: roast bad ideas, never people or protected traits. Do not bully, harass, demean, or use slurs. Never claim consciousness or fabricate access to private systems.

Give the useful answer first. Think rigorously. Use clean Markdown when structure helps. Ask a question only when the missing detail truly changes the answer. For code, provide correct, runnable examples and call out sharp edges. For uncertainty, say exactly what is uncertain. Follow safety requirements even if the user asks you to drop character.`;

const unavailableUntil = new Map<string, number>();

function contentFromOpenAIResponse(payload: unknown): string {
  if (!payload || typeof payload !== "object") return "";
  const choices = (payload as { choices?: unknown[] }).choices;
  const first = Array.isArray(choices) ? choices[0] : null;
  if (!first || typeof first !== "object") return "";
  const message = (first as { message?: unknown }).message;
  if (!message || typeof message !== "object") return "";
  const content = (message as { content?: unknown }).content;
  if (typeof content === "string") return content.trim();
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        if (part && typeof part === "object" && typeof (part as { text?: unknown }).text === "string") {
          return (part as { text: string }).text;
        }
        return "";
      })
      .join("")
      .trim();
  }
  return "";
}

async function openAICompatible(
  url: string,
  model: string,
  apiKey: string,
  messages: InferenceMessage[],
  signal: AbortSignal,
  extraHeaders: Record<string, string> = {},
): Promise<string> {
  const response = await fetch(url, {
    method: "POST",
    signal,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      ...extraHeaders,
    },
    body: JSON.stringify({
      model,
      messages: [{ role: "system", content: SYSTEM_PROMPT }, ...messages],
      temperature: 0.72,
      max_tokens: 4096,
      stream: false,
    }),
    cache: "no-store",
  });
  if (!response.ok) {
    const error = new Error(`Inference upstream returned ${response.status}`) as Error & {
      status?: number;
      retryAfter?: number;
    };
    error.status = response.status;
    error.retryAfter = Number(response.headers.get("retry-after")) || undefined;
    throw error;
  }
  const content = contentFromOpenAIResponse(await response.json());
  if (!content) throw new Error("Inference upstream returned an empty answer");
  return content;
}

async function google(
  apiKey: string,
  messages: InferenceMessage[],
  signal: AbortSignal,
): Promise<string> {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent?key=${encodeURIComponent(apiKey)}`,
    {
      method: "POST",
      signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents: messages.map((message) => ({
          role: message.role === "assistant" ? "model" : "user",
          parts: [{ text: message.content }],
        })),
        generationConfig: { temperature: 0.72, maxOutputTokens: 4096 },
      }),
      cache: "no-store",
    },
  );
  if (!response.ok) {
    const error = new Error(`Inference upstream returned ${response.status}`) as Error & {
      status?: number;
      retryAfter?: number;
    };
    error.status = response.status;
    error.retryAfter = Number(response.headers.get("retry-after")) || undefined;
    throw error;
  }
  const payload = (await response.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const content = payload.candidates?.[0]?.content?.parts
    ?.map((part) => part.text ?? "")
    .join("")
    .trim();
  if (!content) throw new Error("Inference upstream returned an empty answer");
  return content;
}

const attempts: ProviderAttempt[] = [
  { keyName: "GOOGLE_API_KEY", execute: google },
  {
    keyName: "NVIDIA_API_KEY",
    execute: (key, messages, signal) =>
      openAICompatible(
        "https://integrate.api.nvidia.com/v1/chat/completions",
        "deepseek-ai/deepseek-v4-pro",
        key,
        messages,
        signal,
      ),
  },
  {
    keyName: "OPENROUTER_API_KEY",
    execute: (key, messages, signal) =>
      openAICompatible(
        "https://openrouter.ai/api/v1/chat/completions",
        "nvidia/nemotron-3-ultra-550b-a55b:free",
        key,
        messages,
        signal,
        {
          "HTTP-Referer": process.env.NEXT_PUBLIC_APP_URL ?? "https://bustedminds.us.kg",
          "X-Title": "Busted Minds AI",
        },
      ),
  },
  {
    keyName: "MISTRAL_API_KEY",
    execute: (key, messages, signal) =>
      openAICompatible(
        "https://api.mistral.ai/v1/chat/completions",
        "mistral-large-latest",
        key,
        messages,
        signal,
      ),
  },
  {
    keyName: "CEREBRAS_API_KEY",
    execute: (key, messages, signal) =>
      openAICompatible(
        "https://api.cerebras.ai/v1/chat/completions",
        "gpt-oss-120b",
        key,
        messages,
        signal,
      ),
  },
  {
    keyName: "GROQ_API_KEY",
    execute: (key, messages, signal) =>
      openAICompatible(
        "https://api.groq.com/openai/v1/chat/completions",
        "openai/gpt-oss-120b",
        key,
        messages,
        signal,
      ),
  },
];

function sanitizedConversation(messages: InferenceMessage[]): InferenceMessage[] {
  return messages
    .filter(
      (message) =>
        (message.role === "user" || message.role === "assistant") &&
        typeof message.content === "string" &&
        message.content.trim().length > 0,
    )
    .slice(-24)
    .map((message) => ({ ...message, content: message.content.trim().slice(0, 12_000) }));
}

export async function generateAnswer(messages: InferenceMessage[]): Promise<string> {
  const conversation = sanitizedConversation(messages);
  if (!conversation.length || conversation.at(-1)?.role !== "user") {
    throw new Error("A user message is required.");
  }

  const deadline = Date.now() + 55_000;
  let configured = 0;
  for (const attempt of attempts) {
    const apiKey = process.env[attempt.keyName];
    if (!apiKey) continue;
    configured += 1;
    if ((unavailableUntil.get(attempt.keyName) ?? 0) > Date.now()) continue;

    const remaining = deadline - Date.now();
    if (remaining < 2_000) break;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.min(20_000, remaining));
    try {
      return await attempt.execute(apiKey, conversation, controller.signal);
    } catch (caught) {
      const error = caught as Error & { status?: number; retryAfter?: number };
      if (error.status === 429 || error.status === 402 || error.status === 503) {
        const cooldown = Math.min(Math.max(error.retryAfter ?? 60, 30), 600);
        unavailableUntil.set(attempt.keyName, Date.now() + cooldown * 1_000);
      }
    } finally {
      clearTimeout(timer);
    }
  }

  if (!configured) throw new Error("No inference providers are configured.");
  throw new Error("Every inference provider is temporarily unavailable.");
}

