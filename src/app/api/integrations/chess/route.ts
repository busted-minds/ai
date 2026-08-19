import { NextResponse } from "next/server";
import {
  flushInferenceTelemetry,
  generateAnswer,
} from "@/lib/ai/providers";
import {
  CHESS_COACH_SYSTEM_PROMPT,
  chessCoachConversation,
  parseChessCoachRequest,
  verifyChessCoachSignature,
} from "@/lib/integrations/chess";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: Request) {
  const secret = process.env.BMAI_CHESS_INTEGRATION_SECRET?.trim();
  if (!secret || secret.length < 32) {
    return NextResponse.json(
      { code: "NOT_CONFIGURED", message: "Chess coaching is not configured." },
      { status: 503 },
    );
  }

  const body = await request.text();
  if (body.length > 32_768) {
    return NextResponse.json(
      { code: "BAD_REQUEST", message: "The review context is too large." },
      { status: 413 },
    );
  }
  if (!verifyChessCoachSignature({
    body,
    secret,
    signature: request.headers.get("x-bm-chess-signature"),
    timestamp: request.headers.get("x-bm-chess-timestamp"),
  })) {
    return NextResponse.json(
      { code: "UNAUTHORIZED", message: "The Chess integration signature is invalid." },
      { status: 401 },
    );
  }

  const parsed = (() => {
    try {
      return parseChessCoachRequest(JSON.parse(body));
    } catch {
      return null;
    }
  })();
  if (!parsed) {
    return NextResponse.json(
      { code: "VALIDATION_ERROR", message: "The review question is invalid." },
      { status: 422 },
    );
  }

  try {
    const answer = await generateAnswer(chessCoachConversation(parsed), {
      disableSearch: true,
      mode: "expert",
      systemPrompt: CHESS_COACH_SYSTEM_PROMPT,
      timeoutMs: 45_000,
    });
    void flushInferenceTelemetry();
    return NextResponse.json(
      { answer },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    void flushInferenceTelemetry();
    return NextResponse.json(
      {
        code: "DEPENDENCY_UNAVAILABLE",
        message: "Nova’s conversational coach is temporarily unavailable.",
      },
      { status: 503 },
    );
  }
}
