import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { generateAnswer, type InferenceMessage } from "@/lib/ai/providers";
import { makeThreadTitle } from "@/lib/chat-data";
import {
  decodeGuestUsage,
  encodeGuestUsage,
  GUEST_MESSAGE_LIMIT,
  GUEST_USAGE_COOKIE,
  remainingGuestMessages,
} from "@/lib/auth/guest-usage";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const maxDuration = 60;

type ChatRequest = {
  threadId?: unknown;
  message?: unknown;
  history?: unknown;
};

function sanitizeHistory(value: unknown): InferenceMessage[] {
  if (!Array.isArray(value)) return [];
  return value.slice(-23).flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const role = (item as { role?: unknown }).role;
    const content = (item as { content?: unknown }).content;
    if ((role !== "user" && role !== "assistant") || typeof content !== "string") return [];
    const trimmed = content.trim();
    return trimmed ? [{ role, content: trimmed.slice(0, 12_000) }] : [];
  });
}

export async function POST(request: Request) {
  const raw = await request.text();
  if (raw.length > 70_000) {
    return NextResponse.json({ message: "That conversation is too large." }, { status: 413 });
  }
  const body = (() => {
    try {
      return JSON.parse(raw) as ChatRequest;
    } catch {
      return null;
    }
  })();
  const message = typeof body?.message === "string" ? body.message.trim() : "";
  if (!message || message.length > 12_000) {
    return NextResponse.json(
      { message: message ? "Messages must be under 12,000 characters." : "Write something first." },
      { status: 400 },
    );
  }

  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.getUser();
  const user = data.user && !data.user.is_anonymous ? data.user : null;
  const cookieStore = await cookies();
  const used = decodeGuestUsage(cookieStore.get(GUEST_USAGE_COOKIE)?.value);
  if (!user && used >= GUEST_MESSAGE_LIMIT) {
    return NextResponse.json(
      { message: "You’ve used all 10 guest messages. Sign in to keep going—genius has overhead." },
      { status: 429 },
    );
  }

  const requestedThreadId = typeof body?.threadId === "string" ? body.threadId : null;
  let threadId: string | null = null;
  let history: InferenceMessage[] = [];
  if (user && requestedThreadId) {
    const { data: thread } = await supabase
      .from("chat_threads")
      .select("id")
      .eq("id", requestedThreadId)
      .maybeSingle();
    if (!thread) return NextResponse.json({ message: "Conversation not found." }, { status: 404 });
    threadId = thread.id;
    const { data: rows, error } = await supabase
      .from("chat_messages")
      .select("role,content")
      .eq("thread_id", threadId)
      .order("created_at", { ascending: false })
      .limit(23);
    if (error) return NextResponse.json({ message: "Conversation history is unavailable." }, { status: 503 });
    history = (rows ?? []).reverse() as InferenceMessage[];
  } else if (!user) {
    history = sanitizeHistory(body?.history);
  }

  let answer: string;
  try {
    answer = await generateAnswer([...history, { role: "user", content: message }]);
  } catch {
    return NextResponse.json(
      { message: "The brain trust is temporarily unavailable. Try again in a moment." },
      { status: 503 },
    );
  }

  const now = new Date().toISOString();
  const title = makeThreadTitle(message);
  if (user) {
    if (!threadId) {
      const { data: created, error } = await supabase
        .from("chat_threads")
        .insert({ user_id: user.id, title })
        .select("id")
        .single();
      if (error || !created) {
        return NextResponse.json({ message: "The answer arrived, but the conversation could not be saved." }, { status: 503 });
      }
      threadId = created.id;
    }
    const { error } = await supabase.from("chat_messages").insert([
      { thread_id: threadId, user_id: user.id, role: "user", content: message },
      { thread_id: threadId, user_id: user.id, role: "assistant", content: answer },
    ]);
    if (error) {
      return NextResponse.json({ message: "The answer arrived, but the conversation could not be saved." }, { status: 503 });
    }
  }

  const nextUsed = user ? used : used + 1;
  const response = NextResponse.json({
    threadId,
    title,
    message: { id: crypto.randomUUID(), role: "assistant", content: answer, createdAt: now },
    remainingGuestMessages: user ? null : remainingGuestMessages(nextUsed),
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
}

