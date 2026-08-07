import { describe, expect, it } from "vitest";
import {
  decodeGuestUsage,
  encodeGuestUsage,
  GUEST_MESSAGE_LIMIT,
  remainingGuestMessages,
} from "@/lib/auth/guest-usage";
import { makeThreadTitle } from "@/lib/chat-data";
import { safeNextPath } from "@/lib/security";

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
  });
});

describe("thread titles", () => {
  it("normalizes whitespace and keeps titles compact", () => {
    expect(makeThreadTitle("  Explain   entropy  ")).toBe("Explain entropy");
    expect(makeThreadTitle("x".repeat(100))).toHaveLength(52);
  });
});

