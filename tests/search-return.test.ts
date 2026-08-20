import { describe, expect, it } from "vitest";
import { GET, safeSearchReturn } from "@/app/auth/search-return/route";

describe("Busted Minds Search account return", () => {
  it("returns an authenticated browser to its Search page", () => {
    const destination = "https://search.bustedminds.org/search.html?q=weather";
    const response = GET(new Request(
      `https://ai.bustedminds.org/auth/search-return?return=${encodeURIComponent(destination)}`,
    ));

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(destination);
  });

  it("does not redirect to an untrusted origin", () => {
    expect(safeSearchReturn("https://example.com/phishing").href).toBe(
      "https://search.bustedminds.org/",
    );
    expect(safeSearchReturn("not a URL").href).toBe(
      "https://search.bustedminds.org/",
    );
  });
});
