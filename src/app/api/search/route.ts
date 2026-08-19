import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import {
  flushInferenceTelemetry,
  generateAnswer,
} from "@/lib/ai/providers";
import {
  decodeGuestUsage,
  encodeGuestUsage,
  GUEST_MESSAGE_LIMIT,
  GUEST_USAGE_COOKIE,
  remainingGuestMessages,
} from "@/lib/auth/guest-usage";
import { normalizeCustomInstructions } from "@/lib/chat-preferences";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const SEARCH_ORIGIN = "https://search.bustedminds.us.kg";
const LOCAL_ORIGIN = /^http:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?$/;

type SearchSource = {
  title: string;
  url: string;
  domain: string;
};

function allowedOrigin(request: Request): string | null {
  const origin = request.headers.get("origin");
  if (!origin) return process.env.NODE_ENV === "production" ? null : "*";
  return origin === SEARCH_ORIGIN || LOCAL_ORIGIN.test(origin) ? origin : null;
}

function corsHeaders(request: Request): HeadersInit {
  const origin = allowedOrigin(request);
  return {
    ...(origin ? { "Access-Control-Allow-Origin": origin } : {}),
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Max-Age": "86400",
    "Cache-Control": "no-store",
    Vary: "Origin",
  };
}

function json(request: Request, body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: corsHeaders(request) });
}

function requestIsAllowed(request: Request): boolean {
  return allowedOrigin(request) !== null;
}

function extractSources(answer: string): SearchSource[] {
  const sources: SearchSource[] = [];
  const seen = new Set<string>();
  const markdownLink = /\[([^\]\n]{1,180})\]\((https?:\/\/[^\s)]+)\)/g;
  for (const match of answer.matchAll(markdownLink)) {
    try {
      const url = new URL(match[2]);
      if (seen.has(url.href)) continue;
      seen.add(url.href);
      sources.push({
        title: match[1].replace(/[*_`]/g, "").trim() || url.hostname,
        url: url.href,
        domain: url.hostname.replace(/^www\./, ""),
      });
      if (sources.length >= 8) break;
    } catch {
      // Ignore malformed model-authored links instead of exposing them to clients.
    }
  }
  return sources;
}

export async function OPTIONS(request: Request) {
  if (!requestIsAllowed(request)) return json(request, { message: "Origin not allowed." }, 403);
  return new NextResponse(null, { status: 204, headers: corsHeaders(request) });
}

export async function POST(request: Request) {
  if (!requestIsAllowed(request)) return json(request, { message: "Origin not allowed." }, 403);

  const raw = await request.text();
  if (raw.length > 4_096) return json(request, { message: "That search is too large." }, 413);

  const body = (() => {
    try {
      return JSON.parse(raw) as { query?: unknown };
    } catch {
      return null;
    }
  })();
  const query = typeof body?.query === "string"
    ? body.query.replace(/\s+/g, " ").trim().slice(0, 500)
    : "";
  if (!query) return json(request, { message: "Ask a question first." }, 400);

  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.getUser();
  const user = data.user && !data.user.is_anonymous ? data.user : null;
  const cookieStore = await cookies();
  const used = decodeGuestUsage(cookieStore.get(GUEST_USAGE_COOKIE)?.value);
  if (!user && used >= GUEST_MESSAGE_LIMIT) {
    return json(request, {
      message: "You’ve used all 10 guest AI searches. Open Busted Minds AI and sign in to keep going.",
      remainingGuestMessages: 0,
    }, 429);
  }

  let customInstructions = "";
  if (user) {
    const { data: preferences } = await supabase
      .from("user_ai_preferences")
      .select("custom_instructions")
      .eq("user_id", user.id)
      .maybeSingle();
    customInstructions = normalizeCustomInstructions(preferences?.custom_instructions);
  }

  try {
    const answer = await generateAnswer([{ role: "user", content: query }], {
      forceSearch: true,
      mode: "auto",
      customInstructions,
    });
    void flushInferenceTelemetry();
    const nextUsed = user ? used : used + 1;
    const response = json(request, {
      answer,
      sources: extractSources(answer),
      remainingGuestMessages: user ? null : remainingGuestMessages(nextUsed),
      authenticated: Boolean(user),
    });
    if (!user) {
      response.cookies.set(GUEST_USAGE_COOKIE, encodeGuestUsage(nextUsed), {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        path: "/",
        maxAge: 60 * 60 * 24 * 365,
      });
    }
    return response;
  } catch {
    void flushInferenceTelemetry();
    return json(request, {
      message: "Busted Minds AI is thinking too hard right now. The web results are still ready below.",
    }, 503);
  }
}
