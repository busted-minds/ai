import { beforeEach, describe, expect, it, vi } from "vitest";
import { generateAnswer } from "@/lib/ai/providers";
import {
  CHESS_COACH_SYSTEM_PROMPT,
  parseChessCoachRequest,
  signChessCoachRequest,
  verifyChessCoachSignature,
} from "@/lib/integrations/chess";
import { POST } from "@/app/api/integrations/chess/route";

vi.mock("@/lib/ai/providers", () => ({
  flushInferenceTelemetry: vi.fn(async () => undefined),
  generateAnswer: vi.fn(async () => "The main idea is to improve your king safety."),
}));

const payload = {
  source: "nova-review",
  question: "Why was this move a mistake?",
  history: [],
  context: {
    initialFen: "start",
    positionFen: "position-before-the-move",
    reviewColor: "w",
    move: {
      accuracy: 42,
      bestSan: "Nf3",
      bestUci: "g1f3",
      classification: "mistake",
      color: "w",
      continuation: ["Nf3", "Nc6"],
      evaluationAfter: "Black +1.2",
      evaluationBefore: "Equal",
      explanation: "The move gives Black the initiative.",
      headline: "The center needed support",
      lossCp: 120,
      phase: "opening",
      playedSan: "a3",
      playedUci: "a2a3",
      ply: 3,
      themes: ["development", "center"],
    },
    engine: {
      depth: 18,
      mate: null,
      principalVariation: ["Nf3", "Nc6"],
      scoreCp: -120,
    },
  },
} as const;

const integrationSecret = "test-chess-secret-at-least-32-bytes";

describe("Busted Minds Chess integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.BMAI_CHESS_INTEGRATION_SECRET = integrationSecret;
  });

  it("validates the bounded review contract", () => {
    expect(parseChessCoachRequest(payload)).toEqual(payload);
    expect(parseChessCoachRequest({ ...payload, source: "live-game" })).toBeNull();
  });

  it("rejects stale or tampered signatures", () => {
    const body = JSON.stringify(payload);
    const timestamp = String(Date.now());
    const signature = signChessCoachRequest(integrationSecret, timestamp, body);
    expect(verifyChessCoachSignature({ body, secret: integrationSecret, signature, timestamp })).toBe(true);
    expect(verifyChessCoachSignature({ body: `${body} `, secret: integrationSecret, signature, timestamp })).toBe(false);
    expect(verifyChessCoachSignature({
      body,
      now: Number(timestamp) + 300_001,
      secret: integrationSecret,
      signature,
      timestamp,
    })).toBe(false);
  });

  it("uses the dedicated grounded prompt for a signed request", async () => {
    const body = JSON.stringify(payload);
    const timestamp = String(Date.now());
    const request = new Request("http://localhost/api/integrations/chess", {
      body,
      headers: {
        "Content-Type": "application/json",
        "x-bm-chess-signature": signChessCoachRequest(
          integrationSecret,
          timestamp,
          body,
        ),
        "x-bm-chess-timestamp": timestamp,
      },
      method: "POST",
    });

    const response = await POST(request);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      answer: "The main idea is to improve your king safety.",
    });
    expect(generateAnswer).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          role: "user",
          content: expect.stringContaining("<engine_review>"),
        }),
      ]),
      expect.objectContaining({
        disableSearch: true,
        systemPrompt: CHESS_COACH_SYSTEM_PROMPT,
      }),
    );
  });

  it("rejects unsigned requests before inference", async () => {
    const response = await POST(new Request(
      "http://localhost/api/integrations/chess",
      { body: JSON.stringify(payload), method: "POST" },
    ));

    expect(response.status).toBe(401);
    expect(generateAnswer).not.toHaveBeenCalled();
  });
});
