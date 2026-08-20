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

import { GET, OPTIONS, POST } from "@/app/api/search/route";

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
    const request = new Request("https://ai.bustedminds.org/api/search", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "https://search.bustedminds.org",
      },
      body: JSON.stringify({ query: "What changed today?" }),
    });
    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("https://search.bustedminds.org");
    expect(mocks.generateAnswer).toHaveBeenCalledWith(
      [{ role: "user", content: "What changed today?" }],
      expect.objectContaining({ forceSearch: true, mode: "auto" }),
    );
    expect(payload).toMatchObject({
      answer: expect.stringContaining("grounded answer"),
      sources: [{ title: "Example source", url: "https://example.com/report", domain: "example.com" }],
      remainingGuestMessages: 9,
      authenticated: false,
      username: null,
    });
  });

  it("handles preflight and rejects unrelated browser origins", async () => {
    const allowed = await OPTIONS(new Request("https://ai.bustedminds.org/api/search", {
      method: "OPTIONS",
      headers: { Origin: "https://search.bustedminds.org" },
    }));
    const blocked = await POST(new Request("https://ai.bustedminds.org/api/search", {
      method: "POST",
      headers: { Origin: "https://example.net" },
      body: JSON.stringify({ query: "No" }),
    }));

    expect(allowed.status).toBe(204);
    expect(blocked.status).toBe(403);
    expect(mocks.generateAnswer).toHaveBeenCalledTimes(0);
  });

  it("reports the current Search account session without using an AI search", async () => {
    mocks.getUser.mockResolvedValue({
      data: {
        user: {
          is_anonymous: false,
          identities: [{
            provider: "custom:busted-minds",
            identity_data: {
              email_verified: true,
              preferred_username: "searcher_64",
            },
          }],
        },
      },
    });

    const response = await GET(new Request("https://ai.bustedminds.org/api/search", {
      headers: { Origin: "https://search.bustedminds.org" },
    }));

    await expect(response.json()).resolves.toEqual({
      authenticated: true,
      username: "searcher_64",
      remainingGuestMessages: null,
    });
    expect(mocks.generateAnswer).not.toHaveBeenCalled();
  });
});
