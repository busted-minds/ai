import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  generateAnswer: vi.fn(),
  getUser: vi.fn(),
  maybeSingle: vi.fn(),
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
}));

vi.mock("@/lib/ai/providers", () => ({
  flushInferenceTelemetry: vi.fn(async () => undefined),
  generateAnswer: mocks.generateAnswer,
}));

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({
    auth: { getUser: mocks.getUser },
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: mocks.maybeSingle }),
      }),
    }),
  }),
}));

import { OPTIONS, POST } from "@/app/api/search/route";

describe("native Busted Minds search API", () => {
  beforeEach(() => {
    process.env.ANON_USAGE_SECRET = "search-route-test-secret-that-is-long-enough";
    mocks.generateAnswer.mockReset().mockResolvedValue(
      "A grounded answer from [Example source](https://example.com/report).",
    );
    mocks.getUser.mockReset().mockResolvedValue({ data: { user: null } });
    mocks.maybeSingle.mockReset().mockResolvedValue({ data: null });
  });

  it("returns a web-grounded answer and normalized sources to the search site", async () => {
    const request = new Request("https://ai.bustedminds.us.kg/api/search", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "https://search.bustedminds.us.kg",
      },
      body: JSON.stringify({ query: "What changed today?" }),
    });
    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("https://search.bustedminds.us.kg");
    expect(mocks.generateAnswer).toHaveBeenCalledWith(
      [{ role: "user", content: "What changed today?" }],
      expect.objectContaining({ forceSearch: true, mode: "auto" }),
    );
    expect(payload).toMatchObject({
      answer: expect.stringContaining("grounded answer"),
      sources: [{ title: "Example source", url: "https://example.com/report", domain: "example.com" }],
      remainingGuestMessages: 9,
      authenticated: false,
    });
  });

  it("handles preflight and rejects unrelated browser origins", async () => {
    const allowed = await OPTIONS(new Request("https://ai.bustedminds.us.kg/api/search", {
      method: "OPTIONS",
      headers: { Origin: "https://search.bustedminds.us.kg" },
    }));
    const blocked = await POST(new Request("https://ai.bustedminds.us.kg/api/search", {
      method: "POST",
      headers: { Origin: "https://example.net" },
      body: JSON.stringify({ query: "No" }),
    }));

    expect(allowed.status).toBe(204);
    expect(blocked.status).toBe(403);
    expect(mocks.generateAnswer).toHaveBeenCalledTimes(0);
  });
});
