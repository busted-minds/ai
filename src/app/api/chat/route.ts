import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { generateAnswer, type InferenceMessage } from "@/lib/ai/providers";
import { normalizeChatMode } from "@/lib/ai/modes";
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
  replaceFromMessageId?: unknown;
  regenerateFromMessageId?: unknown;
  useSearch?: unknown;
  mode?: unknown;
};

type StoredMessage = InferenceMessage & {
  id: string;
  created_at: string;
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
  const replaceFromMessageId = typeof body?.replaceFromMessageId === "string"
    ? body.replaceFromMessageId
    : null;
  const regenerateFromMessageId = typeof body?.regenerateFromMessageId === "string"
    ? body.regenerateFromMessageId
    : null;
  const useSearch = body?.useSearch === true;
  const mode = normalizeChatMode(body?.mode);
  if (replaceFromMessageId && regenerateFromMessageId) {
    return NextResponse.json({ message: "Choose either edit or regenerate." }, { status: 400 });
  }
  if ((!message && !regenerateFromMessageId) || message.length > 12_000) {
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
  if (user && (replaceFromMessageId || regenerateFromMessageId) && !requestedThreadId) {
    return NextResponse.json({ message: "Reload the conversation and try again." }, { status: 409 });
  }
  let threadId: string | null = null;
  let history: InferenceMessage[] = [];
  let messagesToDelete: string[] = [];
  let threadTitle = message ? makeThreadTitle(message) : "Untitled thought";
  let shouldReplaceThreadTitle = false;
  if (user && requestedThreadId) {
    const { data: thread } = await supabase
      .from("chat_threads")
      .select("id,title")
      .eq("id", requestedThreadId)
      .maybeSingle();
    if (!thread) return NextResponse.json({ message: "Conversation not found." }, { status: 404 });
    threadId = thread.id;
    threadTitle = thread.title;
    const { data: rows, error } = await supabase
      .from("chat_messages")
      .select("id,role,content,created_at")
      .eq("thread_id", threadId)
      .order("created_at", { ascending: true })
      .limit(200);
    if (error) return NextResponse.json({ message: "Conversation history is unavailable." }, { status: 503 });
    const storedMessages = (rows ?? []) as StoredMessage[];
    const targetId = replaceFromMessageId ?? regenerateFromMessageId;
    if (targetId) {
      const targetIndex = storedMessages.findIndex((item) => item.id === targetId);
      const expectedRole = replaceFromMessageId ? "user" : "assistant";
      if (targetIndex < 0 || storedMessages[targetIndex]?.role !== expectedRole) {
        return NextResponse.json({ message: "That message can no longer be changed. Reload and try again." }, { status: 409 });
      }
      history = storedMessages.slice(0, targetIndex).map(({ role, content }) => ({ role, content }));
      messagesToDelete = storedMessages.slice(targetIndex).map((item) => item.id);
      if (replaceFromMessageId && targetIndex === 0) {
        threadTitle = makeThreadTitle(message);
        shouldReplaceThreadTitle = true;
      }
    } else {
      history = storedMessages.map(({ role, content }) => ({ role, content }));
    }
  } else if (!user) {
    history = sanitizeHistory(body?.history);
  }

  if (regenerateFromMessageId && !threadId) {
    if (!history.length || history.at(-1)?.role !== "user") {
      return NextResponse.json({ message: "There is no answer to regenerate." }, { status: 400 });
    }
    threadTitle = makeThreadTitle(history.find((item) => item.role === "user")?.content ?? "Untitled thought");
  }

  let answer: string;
  try {
    const inferenceHistory = regenerateFromMessageId
      ? history
      : [...history, { role: "user" as const, content: message }];
    answer = await generateAnswer(inferenceHistory.slice(-24), { forceSearch: useSearch, mode });
  } catch {
    return NextResponse.json(
      { message: "The brain trust is temporarily unavailable. Try again in a moment." },
      { status: 503 },
    );
  }

  const assistantCreatedAt = new Date().toISOString();
  const userCreatedAt = new Date(Date.parse(assistantCreatedAt) - 1).toISOString();
  const userMessageId = regenerateFromMessageId ? null : crypto.randomUUID();
  const assistantMessageId = crypto.randomUUID();
  if (user) {
    if (!threadId) {
      const { data: created, error } = await supabase
        .from("chat_threads")
        .insert({ user_id: user.id, title: threadTitle })
        .select("id")
        .single();
      if (error || !created) {
        return NextResponse.json({ message: "The answer arrived, but the conversation could not be saved." }, { status: 503 });
      }
      threadId = created.id;
    }
    const { error } = messagesToDelete.length
      ? await supabase.rpc("replace_chat_branch", {
          p_thread_id: threadId,
          p_delete_message_ids: messagesToDelete,
          p_user_message_id: userMessageId,
          p_user_content: userMessageId ? message : null,
          p_assistant_message_id: assistantMessageId,
          p_assistant_content: answer,
          p_title: shouldReplaceThreadTitle ? threadTitle : null,
        })
      : await supabase.from("chat_messages").insert([
          { id: userMessageId, thread_id: threadId, user_id: user.id, role: "user", content: message, created_at: userCreatedAt },
          { id: assistantMessageId, thread_id: threadId, user_id: user.id, role: "assistant", content: answer, created_at: assistantCreatedAt },
        ]);
    if (error) {
      return NextResponse.json({ message: "The answer arrived, but the conversation could not be saved." }, { status: 503 });
    }
  }

  const nextUsed = user ? used : used + 1;
  const response = NextResponse.json({
    threadId,
    title: threadTitle,
    userMessage: userMessageId
      ? { id: userMessageId, role: "user", content: message, createdAt: userCreatedAt }
      : null,
    message: { id: assistantMessageId, role: "assistant", content: answer, createdAt: assistantCreatedAt },
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
