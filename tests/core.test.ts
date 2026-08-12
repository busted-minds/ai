import { describe, expect, it } from "vitest";
import {
  decodeGuestUsage,
  encodeGuestUsage,
  GUEST_MESSAGE_LIMIT,
  remainingGuestMessages,
} from "@/lib/auth/guest-usage";
import { makeThreadTitle } from "@/lib/chat-data";
import { safeNextPath } from "@/lib/security";
import { duckDuckGoQuery, shouldUseDuckDuckGo } from "@/lib/ai/duckduckgo";
import {
  DEFAULT_CHAT_MODE,
  normalizeChatMode,
  resolveInferenceTier,
} from "@/lib/ai/modes";
import { MODEL_POOLS, VISION_MODEL_POOLS } from "@/lib/ai/model-pools";
import {
  AttachmentValidationError,
  parseStoredAttachments,
  validateIncomingAttachments,
} from "@/lib/chat-attachments";
import { MAX_IMAGE_ATTACHMENTS } from "@/lib/image-constants";

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
    expect(MODEL_POOLS.fast[0]?.model).toBe("openai/gpt-oss-20b");
    expect(MODEL_POOLS.expert[0]?.model).toBe("nvidia/nemotron-3-ultra-550b-a55b:free");
    expect(MODEL_POOLS.fast.map(({ model }) => model)).not.toEqual(MODEL_POOLS.expert.map(({ model }) => model));
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
});
