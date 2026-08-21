import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ signOut: vi.fn() }));

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({
    auth: { signOut: mocks.signOut },
  }),
}));

import { GET } from "@/app/auth/search-sign-out/route";

describe("Busted Minds Search sign out", () => {
  beforeEach(() => mocks.signOut.mockReset().mockResolvedValue({ error: null }));

  it("clears the local AI session and returns to Search", async () => {
    const destination = "https://search.bustedminds.org/search.html?q=weather";
    const response = await GET(new Request(
      `https://ai.bustedminds.org/auth/search-sign-out?return=${encodeURIComponent(destination)}`,
    ));

    expect(mocks.signOut).toHaveBeenCalledWith({ scope: "local" });
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(destination);
  });

  it("falls back to Search for an untrusted return URL", async () => {
    const response = await GET(new Request(
      "https://ai.bustedminds.org/auth/search-sign-out?return=https%3A%2F%2Fevil.example",
    ));

    expect(response.headers.get("location")).toBe("https://search.bustedminds.org/");
  });
});
