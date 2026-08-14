import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  generateAnswer: vi.fn(),
  getUser: vi.fn(),
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
}));

vi.mock("@/lib/ai/providers", () => ({
  flushInferenceTelemetry: vi.fn(async () => undefined),
  generateAnswer: mocks.generateAnswer,
}));

vi.mock("@/lib/document-extraction", () => ({
  DocumentExtractionError: class DocumentExtractionError extends Error {},
  buildDocumentContext: vi.fn(),
  extractDocumentText: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({
    auth: { getUser: mocks.getUser },
    from: mocks.from,
  }),
}));

import { POST } from "@/app/api/chat/route";

describe("private chat API", () => {
  beforeEach(() => {
    mocks.from.mockReset().mockImplementation((table: string) => {
      if (table !== "user_ai_preferences") throw new Error(`Unexpected table read: ${table}`);
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({
              data: { custom_instructions: "Use the online preference." },
              error: null,
            }),
          }),
        }),
      };
    });
    mocks.generateAnswer.mockReset().mockResolvedValue("A temporary answer");
    mocks.getUser.mockReset().mockResolvedValue({
      data: { user: { id: "7d249434-7bc8-4c61-b61f-d7c62a65a789", is_anonymous: false } },
    });
  });

  it("answers authenticated private chats without reading or writing thread history", async () => {
    const response = await POST(new Request("http://localhost/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        privateChat: true,
        threadId: "e480fb04-e799-4874-ab36-56956d9e146a",
        projectId: "044427d1-0e84-4ea3-8104-a6d40f939611",
        history: [{ role: "user", content: "Keep this context temporary." }],
        message: "Answer without saving this.",
        customInstructions: "Ignore the saved online preference.",
      }),
    }));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(mocks.from).toHaveBeenCalledOnce();
    expect(mocks.from).toHaveBeenCalledWith("user_ai_preferences");
    expect(mocks.generateAnswer).toHaveBeenCalledWith([
      { role: "user", content: "Keep this context temporary." },
      { role: "user", content: "Answer without saving this." },
    ], expect.objectContaining({ customInstructions: "Use the online preference." }));
    expect(payload).toMatchObject({
      privateChat: true,
      threadId: null,
      projectId: null,
      userMessage: { role: "user", content: "Answer without saving this." },
      message: { role: "assistant", content: "A temporary answer" },
    });
  });
});
