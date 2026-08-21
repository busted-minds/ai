import { describe, expect, it } from "vitest";
import {
  decodeGuestUsage,
  encodeGuestUsage,
  GUEST_MESSAGE_LIMIT,
  remainingGuestMessages,
} from "@/lib/auth/guest-usage";
import {
  accountRegistrationHref,
  accountSignInHref,
} from "@/lib/auth/account-links";
import {
  accountProviderForSignIn,
  BUSTED_MINDS_AI_PROVIDER,
  BUSTED_MINDS_SEARCH_PROVIDER,
} from "@/lib/auth/sign-in-provider";
import { makeThreadTitle } from "@/lib/chat-data";
import { safeNextPath } from "@/lib/security";
import { duckDuckGoQuery, shouldUseDuckDuckGo } from "@/lib/ai/duckduckgo";
import {
  assessInferenceComplexity,
  DEFAULT_CHAT_MODE,
  normalizeChatMode,
  resolveInferenceTier,
} from "@/lib/ai/modes";
import {
  FALLBACK_MODELS,
  MODEL_POOLS,
  VISION_MODEL_POOLS,
  defineModel,
} from "@/lib/ai/model-pools";
import { parseProviderCatalog } from "@/lib/ai/model-registry";
import { InferenceTracker, quotaFromHeaders } from "@/lib/ai/inference-state";
import {
  AttachmentValidationError,
  parseStoredAttachments,
  validateIncomingChatAttachments,
  validateIncomingAttachments,
} from "@/lib/chat-attachments";
import { MAX_IMAGE_ATTACHMENTS } from "@/lib/image-constants";
import {
  attachmentActionUrl,
  pendingDocumentAttachmentUrl,
  safeChatAttachmentUrl,
} from "@/lib/attachment-urls";
import {
  MAX_CUSTOM_INSTRUCTIONS_LENGTH,
  normalizeCustomInstructions,
  parseChatPreferences,
} from "@/lib/chat-preferences";
import { isUuid, MAX_CHAT_PROJECT_NAME_LENGTH, normalizeProjectName } from "@/lib/chat-projects";
import {
  activeMessagePath,
  newestLeafForBranch,
  normalizeMessageGraph,
  siblingMessages,
} from "@/lib/chat-branches";
import type { ChatMessage } from "@/lib/types";

process.env.ANON_USAGE_SECRET = "test-only-secret-with-enough-entropy";

describe("guest usage meter", () => {
  it("round-trips a signed usage count", () => {
    expect(decodeGuestUsage(encodeGuestUsage(7))).toBe(7);
    expect(remainingGuestMessages(7)).toBe(3);
  });

  it("rejects tampering and clamps values", () => {
    expect(decodeGuestUsage(`${GUEST_MESSAGE_LIMIT}.tampered`)).toBe(0);
    expect(decodeGuestUsage(encodeGuestUsage(99))).toBe(GUEST_MESSAGE_LIMIT);
  });
});

describe("safe redirects", () => {
  it("accepts local paths and rejects external redirects", () => {
    expect(safeNextPath("/account?tab=history")).toBe("/account?tab=history");
    expect(safeNextPath("https://attacker.example")).toBe("/");
    expect(safeNextPath("//attacker.example")).toBe("/");
    expect(safeNextPath("/%5C%5Cattacker.example")).toBe("/");
  });
});

describe("Busted Minds Account links", () => {
  it("keeps returning users inside the AI OAuth flow", () => {
    expect(accountSignInHref("/settings")).toBe(
      "/auth/sign-in?next=%2Fsettings",
    );
  });

  it("uses Search branding only for the dedicated Search return flow", () => {
    expect(accountProviderForSignIn(
      "search",
      "/auth/search-return?return=https%3A%2F%2Fsearch.bustedminds.org%2F",
    )).toBe(BUSTED_MINDS_SEARCH_PROVIDER);
    expect(accountProviderForSignIn("search", "/settings")).toBe(BUSTED_MINDS_AI_PROVIDER);
    expect(accountProviderForSignIn(null, "/auth/search-return?return=ignored"))
      .toBe(BUSTED_MINDS_AI_PROVIDER);
  });

  it("opens central registration and then continues back through AI sign-in", () => {
    const registration = new URL(accountRegistrationHref("/settings"));
    const continuation = new URL(
      registration.searchParams.get("next") ?? "",
      registration.origin,
    );

    expect(registration.origin).toBe("https://accounts.bustedminds.org");
    expect(registration.pathname).toBe("/auth");
    expect(registration.searchParams.get("mode")).toBe("register");
    expect(registration.searchParams.get("source")).toBe("bmai");
    expect(continuation.pathname).toBe("/account/connect/bmai");
    expect(continuation.searchParams.get("next")).toBe("/settings");
    expect(continuation.searchParams.get("origin")).toBe(
      "https://ai.bustedminds.org",
    );
  });
});

describe("thread titles", () => {
  it("normalizes whitespace and keeps titles compact", () => {
    expect(makeThreadTitle("  Explain   entropy  ")).toBe("Explain entropy");
    expect(makeThreadTitle("x".repeat(100))).toHaveLength(52);
  });
});

describe("retained conversation branches", () => {
  const message = (
    id: string,
    role: "user" | "assistant",
    parentId: string | null,
    order: number,
  ): ChatMessage => ({
    id,
    role,
    parentId,
    content: id,
    createdAt: new Date(order * 1_000).toISOString(),
  });

  const graph = [
    message("user-1", "user", null, 1),
    message("answer-1", "assistant", "user-1", 2),
    message("user-2", "user", "answer-1", 3),
    message("answer-2", "assistant", "user-2", 4),
    message("answer-1b", "assistant", "user-1", 5),
    message("user-3", "user", "answer-1b", 6),
    message("answer-3", "assistant", "user-3", 7),
    message("user-1b", "user", null, 8),
    message("answer-1c", "assistant", "user-1b", 9),
  ];

  it("resolves only the selected path while retaining sibling versions", () => {
    expect(activeMessagePath(graph, "answer-3").map(({ id }) => id)).toEqual([
      "user-1",
      "answer-1b",
      "user-3",
      "answer-3",
    ]);
    expect(siblingMessages(graph, "answer-1b").map(({ id }) => id)).toEqual([
      "answer-1",
      "answer-1b",
    ]);
    expect(siblingMessages(graph, "user-1b").map(({ id }) => id)).toEqual([
      "user-1",
      "user-1b",
    ]);
  });

  it("restores the latest descendant when an older version is selected", () => {
    expect(newestLeafForBranch(graph, "answer-1")).toBe("answer-2");
    expect(newestLeafForBranch(graph, "answer-1b")).toBe("answer-3");
    expect(newestLeafForBranch(graph, "user-1b")).toBe("answer-1c");
  });

  it("upgrades legacy linear messages with missing parent metadata", () => {
    const legacy = graph.slice(0, 3).map(({ id, role, content, createdAt }) => ({
      id,
      role,
      content,
      createdAt,
    }));
    expect(normalizeMessageGraph(legacy).map(({ parentId }) => parentId)).toEqual([
      null,
      "user-1",
      "answer-1",
    ]);
  });
});

describe("chat projects", () => {
  it("normalizes project names and enforces the database length", () => {
    expect(normalizeProjectName("  Product   launch  ")).toBe("Product launch");
    expect(normalizeProjectName("x".repeat(100))).toHaveLength(MAX_CHAT_PROJECT_NAME_LENGTH);
    expect(normalizeProjectName(null)).toBe("");
  });

  it("only accepts canonical UUID project identifiers", () => {
    expect(isUuid("044427d1-0e84-4ea3-8104-a6d40f939611")).toBe(true);
    expect(isUuid("not-a-project-id")).toBe(false);
  });
});

describe("DuckDuckGo search routing", () => {
  it("recognizes requests that need fresh or explicitly searched information", () => {
    expect(shouldUseDuckDuckGo("What is the latest Node.js version?")).toBe(true);
    expect(shouldUseDuckDuckGo("Search the web for Busted Minds")).toBe(true);
    expect(shouldUseDuckDuckGo("Explain recursion with an analogy")).toBe(false);
  });

  it("removes search instructions from the Instant Answer query", () => {
    expect(duckDuckGoQuery("Please search the web for the current USD JPY exchange rate"))
      .toBe("the current USD JPY exchange rate");
  });
});

describe("chat mode routing", () => {
  it("defaults invalid and missing modes to Fast", () => {
    expect(DEFAULT_CHAT_MODE).toBe("fast");
    expect(normalizeChatMode(undefined)).toBe("fast");
    expect(normalizeChatMode("turbo")).toBe("fast");
  });

  it("uses separate Fast and Expert model pools", () => {
    expect(MODEL_POOLS.fast.every(({ free }) => free)).toBe(true);
    expect(MODEL_POOLS.expert.every(({ free }) => free)).toBe(true);
    expect(MODEL_POOLS.fast.map(({ model }) => model)).not.toEqual(MODEL_POOLS.expert.map(({ model }) => model));
    expect(new Set(FALLBACK_MODELS.map(({ provider }) => provider)).size).toBe(5);
    expect(FALLBACK_MODELS).not.toContainEqual(expect.objectContaining({ provider: "cerebras" }));
  });

  it("routes images only to vision-capable providers", () => {
    expect(VISION_MODEL_POOLS.fast.length).toBeGreaterThan(1);
    expect(VISION_MODEL_POOLS.expert.length).toBeGreaterThan(1);
    expect([...VISION_MODEL_POOLS.fast, ...VISION_MODEL_POOLS.expert])
      .not.toContainEqual(expect.objectContaining({ provider: "cerebras" }));
  });

  it("lets Auto promote complex prompts to the Expert pool", () => {
    expect(resolveInferenceTier("auto", "What is entropy?")).toBe("fast");
    expect(resolveInferenceTier("auto", "Audit this security architecture and explain the trade-offs.")).toBe("expert");
    expect(resolveInferenceTier("expert", "Hello")).toBe("expert");
  });

  it("uses conversation and attachment context for deterministic Auto routing", () => {
    const followUpContext = {
      conversationTurns: 4,
      totalInputCharacters: 900,
      priorUserPrompts: ["Design a secure authentication architecture with explicit trade-offs."],
    };
    expect(resolveInferenceTier("auto", "Apply that here.", followUpContext)).toBe("expert");
    expect(assessInferenceComplexity("Summarize this.", {
      hasDocuments: true,
      totalInputCharacters: 8_000,
    })).toMatchObject({ score: 3 });
    expect(resolveInferenceTier("auto", "Thanks", {
      conversationTurns: 3,
      totalInputCharacters: 100,
    })).toBe("fast");
  });
});

describe("chat preferences", () => {
  it("normalizes device preferences and falls back safely", () => {
    expect(parseChatPreferences(JSON.stringify({
      defaultMode: "expert",
      customInstructions: "  Keep it concise.  ",
      enterToSend: false,
    }))).toEqual({
      defaultMode: "expert",
      enterToSend: false,
    });
    expect(parseChatPreferences("not-json").defaultMode).toBe("fast");
  });

  it("caps custom instructions sent to inference", () => {
    expect(normalizeCustomInstructions(`  ${"x".repeat(MAX_CUSTOM_INSTRUCTIONS_LENGTH + 20)}  `))
      .toHaveLength(MAX_CUSTOM_INSTRUCTIONS_LENGTH);
  });
});

describe("free model registry", () => {
  it("admits Google free chat models and rejects paid or non-chat entries", () => {
    const models = parseProviderCatalog("google", {
      models: [
        { name: "models/gemini-3.6-flash", supportedGenerationMethods: ["generateContent"], inputTokenLimit: 1_000_000 },
        { name: "models/gemini-2.5-pro", supportedGenerationMethods: ["generateContent"] },
        { name: "models/gemini-pro-latest", supportedGenerationMethods: ["generateContent"] },
        { name: "models/gemini-2.5-flash-preview-tts", supportedGenerationMethods: ["generateContent"] },
        { name: "models/gemini-3.5-flash", supportedGenerationMethods: ["countTokens"] },
      ],
    });

    expect(models.map(({ model }) => model)).toEqual(["gemini-3.6-flash"]);
    expect(models[0]).toMatchObject({ free: true, vision: true, contextWindow: 1_000_000 });
  });

  it("applies reviewed profiles before model-name inference", () => {
    const [model] = parseProviderCatalog("google", {
      models: [{
        name: "models/gemini-3.5-flash",
        supportedGenerationMethods: ["generateContent"],
      }],
    });

    expect(model).toMatchObject({
      quality: 9.3,
      speed: 8.8,
      specialties: ["general", "reasoning", "code"],
    });
  });

  it("only admits zero-price OpenRouter text models and preserves vision metadata", () => {
    const freePricing = { prompt: "0", completion: "0", request: "0" };
    const models = parseProviderCatalog("openrouter", {
      data: [
        {
          id: "openrouter/free",
          pricing: freePricing,
          context_length: 200_000,
          architecture: { input_modalities: ["text", "image"], output_modalities: ["text"] },
        },
        {
          id: "vendor/paid-model",
          pricing: { prompt: "0.0001", completion: "0", request: "0" },
          architecture: { input_modalities: ["text"], output_modalities: ["text"] },
        },
        {
          id: "vendor/image-generator:free",
          pricing: freePricing,
          architecture: { input_modalities: ["text"], output_modalities: ["image"] },
        },
        {
          id: "vendor/content-safeguard:free",
          pricing: freePricing,
          architecture: { input_modalities: ["text"], output_modalities: ["text"] },
        },
        {
          id: "google/lyria-3-pro-preview",
          pricing: freePricing,
          architecture: { input_modalities: ["text"], output_modalities: ["text"] },
        },
      ],
    });

    expect(models).toHaveLength(1);
    expect(models[0]).toMatchObject({ model: "openrouter/free", vision: true, source: "router" });
  });

  it("uses provider capability and retirement metadata", () => {
    const mistral = parseProviderCatalog("mistral", {
      data: [
        { id: "mistral-large-latest", capabilities: { completion_chat: true, vision: true }, deprecation: null },
        { id: "mistral-old", capabilities: { completion_chat: true, vision: false }, deprecation: "2026-08-31" },
        { id: "mistral-embed", capabilities: { completion_chat: false, vision: false }, deprecation: null },
      ],
    });
    const groq = parseProviderCatalog("groq", {
      data: [
        { id: "qwen/qwen3.6-27b", active: true, input_modalities: ["text", "image"], output_modalities: ["text"] },
        { id: "llama-3.3-70b-versatile", active: true, input_modalities: ["text"], output_modalities: ["text"] },
      ],
    }, Date.parse("2026-08-12T00:00:00Z"));

    expect(mistral.map(({ model }) => model)).toEqual(["mistral-large-latest"]);
    expect(groq.map(({ model }) => model)).toEqual(["qwen/qwen3.6-27b"]);
    expect(groq[0]?.vision).toBe(true);
  });

  it("only admits explicitly zero-cost Cerebras models", () => {
    const models = parseProviderCatalog("cerebras", {
      data: [
        {
          id: "qwen-3.8-27b",
          pricing: { prompt: "0.0000004", completion: "0.0000008" },
          capabilities: { vision: true },
          limits: { max_context_length: 131_072 },
        },
        {
          id: "qwen-3.8-27b-free",
          pricing: { prompt: "0", completion: "0" },
          capabilities: { vision: true },
          limits: { max_context_length: 131_072 },
        },
        {
          id: "catalog-entry-without-pricing",
          capabilities: { vision: false },
        },
        {
          id: "retired-free-model",
          pricing: { prompt: "0", completion: "0" },
          deprecated: true,
        },
      ],
    });

    expect(models.map(({ model }) => model)).toEqual(["qwen-3.8-27b-free"]);
    expect(models[0]).toMatchObject({
      free: true,
      vision: true,
      contextWindow: 131_072,
    });
  });

  it("rejects NVIDIA historical, embedding, guard, and generation-only entries", () => {
    const models = parseProviderCatalog("nvidia", {
      data: [
        { id: "nvidia/nemotron-3.5-lightning-30b-a3b" },
        { id: "nvidia/llama-3.1-nemotron-ultra-253b-v1" },
        { id: "nvidia/llama-3.2-nv-embedqa-1b-v1" },
        { id: "nvidia/llama-3.1-nemoguard-8b-topic-control" },
        { id: "google/diffusiongemma-26b-a4b-it" },
        { id: "nvidia/riva-translate-4b-instruct" },
      ],
    });

    expect(models.map(({ model }) => model)).toEqual([
      "nvidia/nemotron-3.5-lightning-30b-a3b",
    ]);
  });
});

describe("adaptive inference health", () => {
  const groqFast = defineModel({
    provider: "groq",
    keyName: "GROQ_API_KEY",
    model: "example/fast",
    vision: false,
    quality: 8,
    speed: 10,
    specialties: ["general"],
  });
  const googleVision = defineModel({
    provider: "google",
    keyName: "GOOGLE_API_KEY",
    model: "example/vision",
    vision: true,
    quality: 8,
    speed: 8,
    specialties: ["general"],
  });

  it("keeps the first routing wave provider-diverse and capability-compatible", () => {
    const tracker = new InferenceTracker();
    const selected = tracker.select([groqFast, googleVision], {
      tier: "fast",
      needsVision: false,
      prompt: "Hello",
      limit: 2,
      random: () => 0,
      now: 1_000,
    });
    const vision = tracker.select([groqFast, googleVision], {
      tier: "fast",
      needsVision: true,
      prompt: "What is in this image?",
      limit: 2,
      random: () => 0,
      now: 1_000,
    });

    expect(new Set(selected.map(({ provider }) => provider)).size).toBe(2);
    expect(vision).toEqual([googleVision]);
    expect(tracker.snapshot(1_000).models).toEqual([]);
  });

  it("uses the curated Expert order ahead of GPT-OSS naming heuristics", () => {
    const tracker = new InferenceTracker();
    const expertModels = FALLBACK_MODELS.filter(({ id }) => [
      "google:gemini-3.6-flash",
      "groq:openai/gpt-oss-120b",
      "nvidia:nvidia/nemotron-3-ultra-550b-a55b",
    ].includes(id));
    const context = {
      tier: "expert" as const,
      needsVision: false,
      prompt: "Debug this implementation and explain the architectural trade-offs.",
      random: () => 0,
      now: 1_000,
    };

    expect(tracker.select(expertModels, context)[0]?.id).toBe("google:gemini-3.6-flash");
    expect(tracker.select(expertModels, context).map(({ id }) => id))
      .toEqual(tracker.select(expertModels, context).map(({ id }) => id));
  });

  it("only explores explicitly near-tied candidates", () => {
    const tracker = new InferenceTracker();
    const googleFast = {
      ...googleVision,
      id: "google:example/fast",
      model: "example/fast",
      speed: groqFast.speed,
    };
    const selection = tracker.selectDetailed([googleFast, groqFast], {
      tier: "fast",
      needsVision: false,
      prompt: "Hello",
      explorationRate: 0.03,
      random: () => 0,
      now: 1_000,
    });

    expect(selection.explored).toBe(true);
    expect(new Set(selection.candidates.map(({ provider }) => provider)).size).toBe(2);
  });

  it("merges shared cooldowns from another server instance", () => {
    const tracker = new InferenceTracker();
    tracker.mergeSharedRuntime([{
      scope: "provider",
      stateKey: "provider:groq",
      provider: "groq",
      model: null,
      attempts: 4,
      successes: 2,
      failures: 2,
      cancellations: 0,
      consecutiveFailures: 1,
      latencyEmaMs: null,
      cooldownUntil: 10_000,
      remainingRequests: 0,
      remainingTokens: 8_000,
      requestQuotaResetAt: 10_000,
      tokenQuotaResetAt: 4_000,
      lastAttemptAt: 2_000,
      lastSuccessAt: 1_000,
      lastFailureAt: 2_000,
      statuses: {},
      updatedAt: 2_000,
    }], 3_000);

    expect(tracker.isAvailable(groqFast, 3_000)).toBe(false);
    expect(tracker.isAvailable(groqFast, 11_000)).toBe(true);
  });

  it("shares model cooldowns across every use of the same provider/model", () => {
    const tracker = new InferenceTracker();
    tracker.started(groqFast, 1_000);
    tracker.failed(groqFast, { status: 429, retryAfter: 60 }, 25, new Headers(), 1_025);
    const duplicate = { ...groqFast };

    expect(tracker.select([duplicate], {
      tier: "fast",
      needsVision: false,
      prompt: "Hello",
      random: () => 0,
      now: 2_000,
    })).toEqual([]);
  });

  it("opens a provider-wide circuit for payment failures", () => {
    const tracker = new InferenceTracker();
    const anotherGroqModel = { ...groqFast, id: "groq:example/other", model: "example/other" };
    tracker.started(groqFast, 1_000);
    tracker.failed(groqFast, { status: 402 }, 25, new Headers(), 1_025);

    expect(tracker.isAvailable(anotherGroqModel, 2_000)).toBe(false);
    expect(tracker.catalogAvailability([groqFast, anotherGroqModel], 2_000)).toEqual([{
      provider: "groq",
      catalogModels: 2,
      routableModels: 0,
      verifiedModels: 0,
      blockedModels: 2,
      state: "blocked",
    }]);
  });

  it("learns independent request and token quota reset timing", () => {
    const headers = new Headers({
      "x-ratelimit-remaining-requests-day": "12",
      "x-ratelimit-remaining-tokens-minute": "4096",
      "x-ratelimit-reset-requests-day": "1m30s",
      "x-ratelimit-reset-tokens-minute": "5s",
    });

    expect(quotaFromHeaders(headers, 10_000)).toEqual({
      remainingRequests: 12,
      remainingTokens: 4096,
      requestQuotaResetAt: 100_000,
      tokenQuotaResetAt: 15_000,
    });
  });

  it("does not hold an entire provider until the longer request reset when tokens recover sooner", () => {
    const tracker = new InferenceTracker();
    const anotherGroqModel = { ...groqFast, id: "groq:example/other", model: "example/other" };
    tracker.started(groqFast, 1_000);
    tracker.failed(groqFast, { status: 429, retryAfter: 1 }, 10, new Headers({
      "x-ratelimit-remaining-requests": "10",
      "x-ratelimit-remaining-tokens": "0",
      "x-ratelimit-reset-requests": "90s",
      "x-ratelimit-reset-tokens": "5s",
    }), 1_010);

    expect(tracker.isAvailable(anotherGroqModel, 5_000)).toBe(false);
    expect(tracker.isAvailable(anotherGroqModel, 7_000)).toBe(true);
  });
});

describe("chat image validation", () => {
  const pngDataUrl = `data:image/png;base64,${Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  ]).toString("base64")}`;

  it("accepts supported image data and sanitizes its display name", () => {
    const [attachment] = validateIncomingAttachments([{
      name: "../screen\u0000shot.png",
      mimeType: "image/png",
      dataUrl: pngDataUrl,
    }]);

    expect(attachment).toMatchObject({
      name: ".. screen shot.png",
      mimeType: "image/png",
      size: 8,
    });
    expect(attachment?.bytes.equals(Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ]))).toBe(true);
  });

  it("rejects spoofed image types and too many files", () => {
    expect(() => validateIncomingAttachments([{
      name: "spoof.png",
      mimeType: "image/png",
      dataUrl: `data:image/png;base64,${Buffer.from("not a png").toString("base64")}`,
    }])).toThrow(AttachmentValidationError);

    expect(() => validateIncomingAttachments(Array.from(
      { length: MAX_IMAGE_ATTACHMENTS + 1 },
      () => ({ name: "image.png", mimeType: "image/png", dataUrl: pngDataUrl }),
    ))).toThrow(`Attach no more than ${MAX_IMAGE_ATTACHMENTS} images at once.`);
  });

  it("only accepts canonical private-storage metadata paths", () => {
    const valid = {
      id: "ddae8165-42f2-4b2e-a543-f5504e97f07d",
      name: "diagram.png",
      mimeType: "image/png",
      size: 512,
      storagePath: "d866016b-bde8-4712-901a-3f016f95fca5/044427d1-0e84-4ea3-8104-a6d40f939611/ddae8165-42f2-4b2e-a543-f5504e97f07d.png",
    };

    expect(parseStoredAttachments([valid])).toEqual([valid]);
    expect(parseStoredAttachments([{ ...valid, storagePath: `../${valid.storagePath}` }])).toEqual([]);
  });

  it("accepts private document references only for their authenticated owner", () => {
    const userId = "d866016b-bde8-4712-901a-3f016f95fca5";
    const documentId = "044427d1-0e84-4ea3-8104-a6d40f939611";
    const document = {
      id: documentId,
      name: "quarterly-report.pdf",
      mimeType: "application/pdf",
      size: 2048,
      storagePath: `${userId}/pending/${documentId}.pdf`,
    };

    expect(validateIncomingChatAttachments([document], userId)).toEqual({
      images: [],
      documents: [document],
    });
    expect(parseStoredAttachments([document])).toEqual([document]);
    expect(() => validateIncomingChatAttachments(
      [document],
      "fb2203f1-adfc-49ab-8da3-61b8807960fb",
    )).toThrow(AttachmentValidationError);
    expect(() => validateIncomingChatAttachments([document], null))
      .toThrow("Sign in to attach documents.");
  });
});

describe("pending attachment preview URLs", () => {
  const attachment = {
    id: "044427d1-0e84-4ea3-8104-a6d40f939611",
    name: "Quarterly report & notes.pdf",
    mimeType: "application/pdf" as const,
    size: 2048,
    url: "",
  };

  it("builds a private pending URL that remains valid with preview actions", () => {
    const url = pendingDocumentAttachmentUrl(attachment);
    expect(safeChatAttachmentUrl({ ...attachment, url })).toBe(url);
    expect(attachmentActionUrl(url, "preview")).toContain("&preview=1");
  });

  it("rejects mismatched or untrusted pending URLs", () => {
    const url = pendingDocumentAttachmentUrl(attachment);
    expect(safeChatAttachmentUrl({ ...attachment, name: "different.pdf", url })).toBe("");
    expect(safeChatAttachmentUrl({ ...attachment, url: "https://example.com/report.pdf" })).toBe("");
  });
});
