import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { generateAnswer, type InferenceImage, type InferenceMessage } from "@/lib/ai/providers";
import { normalizeChatMode } from "@/lib/ai/modes";
import { makeThreadTitle } from "@/lib/chat-data";
import {
  AttachmentValidationError,
  CHAT_IMAGE_BUCKET,
  extensionForMimeType,
  parseStoredAttachments,
  safeIncomingAttachments,
  storedAttachmentForClient,
  validateIncomingAttachments,
  type StoredImageAttachment,
  type ValidatedImageAttachment,
} from "@/lib/chat-attachments";
import { MAX_CHAT_REQUEST_CHARACTERS, MAX_IMAGE_ATTACHMENTS, MAX_IMAGE_BYTES } from "@/lib/image-constants";
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
  attachments?: unknown;
  history?: unknown;
  replaceFromMessageId?: unknown;
  regenerateFromMessageId?: unknown;
  useSearch?: unknown;
  mode?: unknown;
};

type StoredMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  attachments?: unknown;
  created_at: string;
};

type ChatSupabaseClient = Awaited<ReturnType<typeof createSupabaseServerClient>>;

function inferenceImages(attachments: ValidatedImageAttachment[]): InferenceImage[] {
  return attachments.map(({ mimeType, base64 }) => ({ mimeType, base64 }));
}

function sanitizeHistory(value: unknown): InferenceMessage[] {
  if (!Array.isArray(value)) return [];
  const candidates = value.slice(-23);
  let includedImageHistory = false;
  const messages: InferenceMessage[] = [];
  for (let index = candidates.length - 1; index >= 0; index -= 1) {
    const item = candidates[index];
    if (!item || typeof item !== "object") continue;
    const role = (item as { role?: unknown }).role;
    const content = (item as { content?: unknown }).content;
    if ((role !== "user" && role !== "assistant") || typeof content !== "string") continue;
    const trimmed = content.trim().slice(0, 12_000);
    const attachments = role === "user" && !includedImageHistory
      ? safeIncomingAttachments((item as { attachments?: unknown }).attachments)
      : [];
    if (!trimmed && !attachments.length) continue;
    if (attachments.length) includedImageHistory = true;
    messages.unshift({
      role,
      content: trimmed,
      ...(attachments.length ? { images: inferenceImages(attachments) } : {}),
    });
  }
  return messages;
}

async function downloadStoredImages(
  supabase: ChatSupabaseClient,
  attachments: StoredImageAttachment[],
  limit = MAX_IMAGE_ATTACHMENTS,
): Promise<InferenceImage[]> {
  const images: InferenceImage[] = [];
  for (const attachment of attachments.slice(0, limit)) {
    const { data, error } = await supabase.storage.from(CHAT_IMAGE_BUCKET).download(attachment.storagePath);
    if (error || !data) continue;
    const bytes = Buffer.from(await data.arrayBuffer());
    if (!bytes.length || bytes.length > MAX_IMAGE_BYTES) continue;
    images.push({ mimeType: attachment.mimeType, base64: bytes.toString("base64") });
  }
  return images;
}

async function storedRowsForInference(
  supabase: ChatSupabaseClient,
  rows: StoredMessage[],
): Promise<InferenceMessage[]> {
  const messages: InferenceMessage[] = rows.map(({ role, content }) => ({ role, content }));
  let remainingImages = MAX_IMAGE_ATTACHMENTS;
  for (let index = rows.length - 1; index >= 0 && remainingImages > 0; index -= 1) {
    const row = rows[index];
    if (row.role !== "user") continue;
    const stored = parseStoredAttachments(row.attachments).slice(0, remainingImages);
    if (!stored.length) continue;
    const images = await downloadStoredImages(supabase, stored, remainingImages);
    if (images.length) {
      messages[index] = { ...messages[index], images };
      remainingImages -= images.length;
    }
  }
  return messages;
}

function limitHistoricalImages(messages: InferenceMessage[], limit: number): InferenceMessage[] {
  let remaining = Math.max(0, limit);
  const limited = [...messages];
  for (let index = limited.length - 1; index >= 0; index -= 1) {
    const message = limited[index];
    if (message.role !== "user" || !message.images?.length) continue;
    const images = message.images.slice(0, remaining);
    remaining -= images.length;
    limited[index] = {
      role: message.role,
      content: message.content || (images.length ? "" : "[An earlier image was omitted from this request.]"),
      ...(images.length ? { images } : {}),
    };
  }
  return limited;
}

async function uploadAttachments(
  supabase: ChatSupabaseClient,
  userId: string,
  messageId: string,
  attachments: ValidatedImageAttachment[],
): Promise<StoredImageAttachment[]> {
  const stored: StoredImageAttachment[] = [];
  try {
    for (const attachment of attachments) {
      const storagePath = `${userId}/${messageId}/${attachment.id}.${extensionForMimeType(attachment.mimeType)}`;
      const { error } = await supabase.storage.from(CHAT_IMAGE_BUCKET).upload(storagePath, attachment.bytes, {
        cacheControl: "31536000",
        contentType: attachment.mimeType,
        upsert: false,
      });
      if (error) throw error;
      stored.push({
        id: attachment.id,
        name: attachment.name,
        mimeType: attachment.mimeType,
        size: attachment.size,
        storagePath,
      });
    }
    return stored;
  } catch (error) {
    if (stored.length) {
      await supabase.storage.from(CHAT_IMAGE_BUCKET).remove(stored.map(({ storagePath }) => storagePath));
    }
    throw error;
  }
}

async function removeStoredAttachments(
  supabase: ChatSupabaseClient,
  attachments: StoredImageAttachment[],
) {
  const paths = [...new Set(attachments.map(({ storagePath }) => storagePath))];
  if (paths.length) await supabase.storage.from(CHAT_IMAGE_BUCKET).remove(paths);
}

export async function POST(request: Request) {
  const raw = await request.text();
  if (raw.length > MAX_CHAT_REQUEST_CHARACTERS) {
    return NextResponse.json({ message: "Those images make the request too large." }, { status: 413 });
  }
  const body = (() => {
    try {
      return JSON.parse(raw) as ChatRequest;
    } catch {
      return null;
    }
  })();
  const message = typeof body?.message === "string" ? body.message.trim() : "";
  let incomingAttachments: ValidatedImageAttachment[];
  try {
    incomingAttachments = validateIncomingAttachments(body?.attachments);
  } catch (caught) {
    const detail = caught instanceof AttachmentValidationError ? caught.message : "The image upload is invalid.";
    return NextResponse.json({ message: detail }, { status: 400 });
  }
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
  if ((!message && !incomingAttachments.length && !regenerateFromMessageId) || message.length > 12_000) {
    return NextResponse.json(
      { message: message ? "Messages must be under 12,000 characters." : "Write something or attach an image first." },
      { status: 400 },
    );
  }
  if (regenerateFromMessageId && incomingAttachments.length) {
    return NextResponse.json({ message: "Images cannot be added while regenerating an answer." }, { status: 400 });
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
  let attachmentsToDelete: StoredImageAttachment[] = [];
  let replacementAttachments: StoredImageAttachment[] = [];
  const imageTitle = incomingAttachments[0] ? `Image: ${incomingAttachments[0].name}` : "Image conversation";
  let threadTitle = makeThreadTitle(message || imageTitle);
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
      .select("id,role,content,attachments,created_at")
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
      const historyRows = storedMessages.slice(0, targetIndex);
      history = await storedRowsForInference(supabase, historyRows);
      const deletedRows = storedMessages.slice(targetIndex);
      messagesToDelete = deletedRows.map((item) => item.id);
      attachmentsToDelete = deletedRows.flatMap((item) => parseStoredAttachments(item.attachments));
      if (replaceFromMessageId) {
        replacementAttachments = parseStoredAttachments(storedMessages[targetIndex]?.attachments);
      }
      if (replaceFromMessageId && targetIndex === 0) {
        threadTitle = makeThreadTitle(message || replacementAttachments[0]?.name || imageTitle);
        shouldReplaceThreadTitle = true;
      }
    } else {
      history = await storedRowsForInference(supabase, storedMessages);
    }
  } else if (!user) {
    history = sanitizeHistory(body?.history);
  }

  if (regenerateFromMessageId && !threadId) {
    if (!history.length || history.at(-1)?.role !== "user") {
      return NextResponse.json({ message: "There is no answer to regenerate." }, { status: 400 });
    }
    threadTitle = makeThreadTitle(
      history.find((item) => item.role === "user")?.content || "Image conversation",
    );
  }

  let currentImages = inferenceImages(incomingAttachments);
  if (user && replaceFromMessageId && !currentImages.length && replacementAttachments.length) {
    currentImages = await downloadStoredImages(supabase, replacementAttachments);
  }
  if (currentImages.length) {
    history = limitHistoricalImages(history, MAX_IMAGE_ATTACHMENTS - currentImages.length);
  }

  let answer: string;
  try {
    const inferenceHistory = regenerateFromMessageId
      ? history
      : [...history, {
          role: "user" as const,
          content: message,
          ...(currentImages.length ? { images: currentImages } : {}),
        }];
    answer = await generateAnswer(inferenceHistory.slice(-24), { forceSearch: useSearch, mode });
  } catch {
    return NextResponse.json(
      { message: incomingAttachments.length
          ? "The vision brain trust is temporarily unavailable. Try again in a moment."
          : "The brain trust is temporarily unavailable. Try again in a moment." },
      { status: 503 },
    );
  }

  const assistantCreatedAt = new Date().toISOString();
  const userCreatedAt = new Date(Date.parse(assistantCreatedAt) - 1).toISOString();
  const userMessageId = regenerateFromMessageId ? null : crypto.randomUUID();
  const assistantMessageId = crypto.randomUUID();
  let storedUserAttachments: StoredImageAttachment[] = [];
  let createdThread = false;
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
      createdThread = true;
    }

    try {
      storedUserAttachments = userMessageId && incomingAttachments.length
        ? await uploadAttachments(supabase, user.id, userMessageId, incomingAttachments)
        : userMessageId && replaceFromMessageId
          ? replacementAttachments
          : [];
    } catch {
      if (createdThread) await supabase.from("chat_threads").delete().eq("id", threadId);
      return NextResponse.json({ message: "The images could not be stored securely. Try again." }, { status: 503 });
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
          p_user_attachments: storedUserAttachments,
        })
      : await supabase.from("chat_messages").insert([
          {
            id: userMessageId,
            thread_id: threadId,
            user_id: user.id,
            role: "user",
            content: message,
            attachments: storedUserAttachments,
            created_at: userCreatedAt,
          },
          {
            id: assistantMessageId,
            thread_id: threadId,
            user_id: user.id,
            role: "assistant",
            content: answer,
            attachments: [],
            created_at: assistantCreatedAt,
          },
        ]);
    if (error) {
      console.error("Chat persistence failed", {
        code: error.code,
        message: error.message,
        details: error.details,
        hint: error.hint,
        operation: messagesToDelete.length ? "replace-branch" : "insert-messages",
      });
      const newlyUploadedPaths = new Set(storedUserAttachments.map(({ storagePath }) => storagePath));
      const newUploads = storedUserAttachments.filter((attachment) =>
        incomingAttachments.length > 0 && newlyUploadedPaths.has(attachment.storagePath));
      await removeStoredAttachments(supabase, newUploads);
      if (createdThread) await supabase.from("chat_threads").delete().eq("id", threadId);
      return NextResponse.json({ message: "The answer arrived, but the conversation could not be saved." }, { status: 503 });
    }

    if (attachmentsToDelete.length) {
      const preservedPaths = new Set(storedUserAttachments.map(({ storagePath }) => storagePath));
      await removeStoredAttachments(
        supabase,
        attachmentsToDelete.filter(({ storagePath }) => !preservedPaths.has(storagePath)),
      );
    }
  }

  const responseAttachments = userMessageId
    ? user
      ? storedUserAttachments.map((attachment) => storedAttachmentForClient(userMessageId, attachment))
      : incomingAttachments.map(({ id, name, mimeType, size, dataUrl }) => ({ id, name, mimeType, size, url: dataUrl }))
    : [];
  const nextUsed = user ? used : used + 1;
  const response = NextResponse.json({
    threadId,
    title: threadTitle,
    userMessage: userMessageId
      ? {
          id: userMessageId,
          role: "user",
          content: message,
          createdAt: userCreatedAt,
          ...(responseAttachments.length ? { attachments: responseAttachments } : {}),
        }
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
