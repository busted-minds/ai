import { cookies } from "next/headers";
import { after, NextResponse } from "next/server";
import {
  flushInferenceTelemetry,
  generateAnswer,
  type InferenceImage,
  type InferenceMessage,
} from "@/lib/ai/providers";
import { normalizeChatMode } from "@/lib/ai/modes";
import { normalizeCustomInstructions } from "@/lib/chat-preferences";
import { makeThreadTitle } from "@/lib/chat-data";
import { activeMessagePath } from "@/lib/chat-branches";
import { isUuid } from "@/lib/chat-projects";
import {
  AttachmentValidationError,
  CHAT_IMAGE_BUCKET,
  bucketForStoredAttachment,
  extensionForMimeType,
  parseStoredAttachments,
  storedAttachmentForClient,
  validateIncomingChatAttachments,
  type StoredChatAttachment,
  type StoredDocumentAttachment,
  type StoredImageAttachment,
  type ValidatedImageAttachment,
} from "@/lib/chat-attachments";
import { pendingDocumentAttachmentUrl } from "@/lib/attachment-urls";
import {
  DocumentExtractionError,
  buildDocumentContext,
  extractDocumentText,
} from "@/lib/document-extraction";
import { CHAT_DOCUMENT_BUCKET, isSupportedDocumentMimeType } from "@/lib/attachment-constants";
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
  projectId?: unknown;
  message?: unknown;
  attachments?: unknown;
  history?: unknown;
  replaceFromMessageId?: unknown;
  regenerateFromMessageId?: unknown;
  regenerateInstruction?: unknown;
  parentMessageId?: unknown;
  useSearch?: unknown;
  mode?: unknown;
  privateChat?: unknown;
};

type StoredMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  attachments?: unknown;
  attachment_context?: string;
  parent_message_id?: string | null;
  created_at: string;
};

type ChatSupabaseClient = Awaited<ReturnType<typeof createSupabaseServerClient>>;

function scheduleInferenceTelemetryFlush(): void {
  try {
    after(() => flushInferenceTelemetry());
  } catch {
    // Direct route invocation in local tools/tests has no Next request context.
    void flushInferenceTelemetry();
  }
}

function inferenceImages(attachments: ValidatedImageAttachment[]): InferenceImage[] {
  return attachments.map(({ mimeType, base64 }) => ({ mimeType, base64 }));
}

async function sanitizeHistory(
  value: unknown,
  supabase: ChatSupabaseClient,
  userId: string | null,
): Promise<InferenceMessage[]> {
  if (!Array.isArray(value)) return [];
  const candidates = value.slice(-23);
  let includedAttachmentHistory = false;
  const messages: InferenceMessage[] = [];
  for (let index = candidates.length - 1; index >= 0; index -= 1) {
    const item = candidates[index];
    if (!item || typeof item !== "object") continue;
    const role = (item as { role?: unknown }).role;
    const content = (item as { content?: unknown }).content;
    if ((role !== "user" && role !== "assistant") || typeof content !== "string") continue;
    const trimmed = content.trim().slice(0, 12_000);
    let images: InferenceImage[] = [];
    let documentContext = "";
    if (role === "user" && !includedAttachmentHistory) {
      try {
        const attachments = validateIncomingChatAttachments(
          (item as { attachments?: unknown }).attachments,
          userId,
        );
        images = inferenceImages(attachments.images);
        if (attachments.documents.length) {
          documentContext = await documentContextFromUploads(supabase, attachments.documents);
        }
        if (images.length || documentContext) includedAttachmentHistory = true;
      } catch {
        // A missing temporary attachment must not make the rest of private history unusable.
      }
    }
    if (!trimmed && !images.length && !documentContext) continue;
    messages.unshift({
      role,
      content: trimmed,
      ...(images.length ? { images } : {}),
      ...(documentContext ? { documentContext } : {}),
    });
  }
  return messages;
}

async function downloadStoredImages(
  supabase: ChatSupabaseClient,
  attachments: StoredChatAttachment[],
  limit = MAX_IMAGE_ATTACHMENTS,
): Promise<InferenceImage[]> {
  const images: InferenceImage[] = [];
  const imageAttachments = attachments.filter(
    (attachment): attachment is StoredImageAttachment => !isSupportedDocumentMimeType(attachment.mimeType),
  );
  for (const attachment of imageAttachments.slice(0, limit)) {
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
  const messages: InferenceMessage[] = rows.map(({ role, content, attachment_context }) => ({
    role,
    content,
    ...(role === "user" && attachment_context ? { documentContext: attachment_context } : {}),
  }));
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
  attachments: StoredChatAttachment[],
) {
  const byBucket = new Map<string, string[]>();
  for (const attachment of attachments) {
    const bucket = bucketForStoredAttachment(attachment);
    byBucket.set(bucket, [...(byBucket.get(bucket) ?? []), attachment.storagePath]);
  }
  await Promise.all([...byBucket].map(([bucket, paths]) =>
    supabase.storage.from(bucket).remove([...new Set(paths)])));
}

async function documentContextFromUploads(
  supabase: ChatSupabaseClient,
  documents: StoredDocumentAttachment[],
) {
  const extracted: Array<{ name: string; mimeType: StoredDocumentAttachment["mimeType"]; text: string }> = [];
  for (const document of documents) {
    const { data, error } = await supabase.storage.from(CHAT_DOCUMENT_BUCKET).download(document.storagePath);
    if (error || !data) throw new DocumentExtractionError(`${document.name} is no longer available.`);
    const bytes = Buffer.from(await data.arrayBuffer());
    if (bytes.length !== document.size) {
      throw new DocumentExtractionError(`${document.name} did not pass file validation.`);
    }
    extracted.push({
      name: document.name,
      mimeType: document.mimeType,
      text: await extractDocumentText(bytes, document.mimeType),
    });
  }
  return buildDocumentContext(extracted);
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
  const replaceFromMessageId = typeof body?.replaceFromMessageId === "string"
    ? body.replaceFromMessageId
    : null;
  const regenerateFromMessageId = typeof body?.regenerateFromMessageId === "string"
    ? body.regenerateFromMessageId
    : null;
  const regenerateInstruction = typeof body?.regenerateInstruction === "string"
    ? body.regenerateInstruction.trim()
    : "";
  const requestedParentMessageId = typeof body?.parentMessageId === "string"
    ? body.parentMessageId
    : null;
  const useSearch = body?.useSearch === true;
  const privateChat = body?.privateChat === true;
  const mode = normalizeChatMode(body?.mode);
  if (replaceFromMessageId && regenerateFromMessageId) {
    return NextResponse.json({ message: "Choose either edit or regenerate." }, { status: 400 });
  }
  if (regenerateInstruction && !regenerateFromMessageId) {
    return NextResponse.json({ message: "Response changes can only be used while regenerating." }, { status: 400 });
  }
  if (message.length > 12_000 || regenerateInstruction.length > 12_000) {
    return NextResponse.json(
      { message: "Messages must be under 12,000 characters." },
      { status: 400 },
    );
  }

  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.getUser();
  const user = data.user && !data.user.is_anonymous ? data.user : null;
  let customInstructions = "";
  if (user) {
    const { data: preferenceData, error: preferenceError } = await supabase
      .from("user_ai_preferences")
      .select("custom_instructions")
      .eq("user_id", user.id)
      .maybeSingle();
    if (preferenceError) {
      return NextResponse.json(
        { message: "Your AI preferences are temporarily unavailable. Try again in a moment." },
        { status: 503 },
      );
    }
    customInstructions = normalizeCustomInstructions(preferenceData?.custom_instructions);
  }
  let incomingImages: ValidatedImageAttachment[];
  let incomingDocuments: StoredDocumentAttachment[];
  try {
    ({ images: incomingImages, documents: incomingDocuments } = validateIncomingChatAttachments(
      body?.attachments,
      user?.id ?? null,
    ));
  } catch (caught) {
    const detail = caught instanceof AttachmentValidationError ? caught.message : "The file upload is invalid.";
    return NextResponse.json({ message: detail }, { status: 400 });
  }
  const incomingAttachmentCount = incomingImages.length + incomingDocuments.length;
  if (!message && !incomingAttachmentCount && !regenerateFromMessageId) {
    return NextResponse.json({ message: "Write something or attach a file first." }, { status: 400 });
  }
  if (regenerateFromMessageId && incomingAttachmentCount) {
    return NextResponse.json({ message: "Files cannot be added while regenerating an answer." }, { status: 400 });
  }
  const cookieStore = await cookies();
  const used = decodeGuestUsage(cookieStore.get(GUEST_USAGE_COOKIE)?.value);
  if (!user && used >= GUEST_MESSAGE_LIMIT) {
    return NextResponse.json(
      { message: "You’ve used all 10 guest messages. Sign in to keep going—genius has overhead." },
      { status: 429 },
    );
  }

  const requestedThreadId = !privateChat && typeof body?.threadId === "string" ? body.threadId : null;
  const requestedProjectId = !privateChat && typeof body?.projectId === "string" ? body.projectId : null;
  if (user && requestedProjectId && !isUuid(requestedProjectId)) {
    return NextResponse.json({ message: "Choose a valid project." }, { status: 400 });
  }
  if (user && !privateChat && (replaceFromMessageId || regenerateFromMessageId) && !requestedThreadId) {
    return NextResponse.json({ message: "Reload the conversation and try again." }, { status: 409 });
  }
  let threadId: string | null = null;
  let threadProjectId: string | null = requestedProjectId;
  let history: InferenceMessage[] = [];
  let branchParentMessageId: string | null = requestedParentMessageId;
  let replacementAttachments: StoredChatAttachment[] = [];
  let replacementDocumentContext = "";
  const firstAttachment = incomingImages[0] ?? incomingDocuments[0];
  const attachmentTitle = firstAttachment ? `File: ${firstAttachment.name}` : "File conversation";
  let threadTitle = makeThreadTitle(message || attachmentTitle);
  let shouldReplaceThreadTitle = false;
  if (user && requestedThreadId) {
    const { data: thread } = await supabase
      .from("chat_threads")
      .select("id,title,project_id,active_leaf_id")
      .eq("id", requestedThreadId)
      .maybeSingle();
    if (!thread) return NextResponse.json({ message: "Conversation not found." }, { status: 404 });
    threadId = thread.id;
    threadTitle = thread.title;
    threadProjectId = thread.project_id;
    const { data: rows, error } = await supabase
      .from("chat_messages")
      .select("id,role,content,attachments,attachment_context,parent_message_id,created_at")
      .eq("thread_id", threadId)
      .order("created_at", { ascending: true })
      .limit(1000);
    if (error) return NextResponse.json({ message: "Conversation history is unavailable." }, { status: 503 });
    const allStoredMessages = (rows ?? []) as StoredMessage[];
    const storedMessages = activeMessagePath(
      allStoredMessages.map((item) => ({
        id: item.id,
        role: item.role,
        content: item.content,
        createdAt: item.created_at,
        parentId: item.parent_message_id ?? null,
        attachments: [],
      })),
      thread.active_leaf_id,
    ).map((message) => allStoredMessages.find(({ id }) => id === message.id) as StoredMessage);
    const targetId = replaceFromMessageId ?? regenerateFromMessageId;
    if (targetId) {
      const targetIndex = storedMessages.findIndex((item) => item.id === targetId);
      const expectedRole = replaceFromMessageId ? "user" : "assistant";
      if (targetIndex < 0 || storedMessages[targetIndex]?.role !== expectedRole) {
        return NextResponse.json({ message: "That message can no longer be changed. Reload and try again." }, { status: 409 });
      }
      const historyRows = storedMessages.slice(0, targetIndex);
      history = await storedRowsForInference(supabase, historyRows);
      branchParentMessageId = storedMessages[targetIndex]?.parent_message_id ?? null;
      if (replaceFromMessageId) {
        replacementAttachments = parseStoredAttachments(storedMessages[targetIndex]?.attachments);
        replacementDocumentContext = storedMessages[targetIndex]?.attachment_context ?? "";
      }
      if (replaceFromMessageId && targetIndex === 0) {
        threadTitle = makeThreadTitle(message || replacementAttachments[0]?.name || attachmentTitle);
        shouldReplaceThreadTitle = true;
      }
    } else {
      history = await storedRowsForInference(supabase, storedMessages);
      branchParentMessageId = storedMessages.at(-1)?.id ?? null;
    }
  } else if (!user || privateChat) {
    history = await sanitizeHistory(body?.history, supabase, user?.id ?? null);
  }

  if (regenerateFromMessageId && !threadId) {
    if (!history.length || history.at(-1)?.role !== "user") {
      return NextResponse.json({ message: "There is no answer to regenerate." }, { status: 400 });
    }
    threadTitle = makeThreadTitle(
      history.find((item) => item.role === "user")?.content || "Image conversation",
    );
  }

  let currentDocumentContext = "";
  if (incomingDocuments.length) {
    try {
      currentDocumentContext = await documentContextFromUploads(supabase, incomingDocuments);
    } catch (caught) {
      const detail = caught instanceof DocumentExtractionError
        ? caught.message
        : "The attached document could not be read.";
      return NextResponse.json({ message: detail }, { status: 422 });
    }
  } else if (user && replaceFromMessageId) {
    currentDocumentContext = replacementDocumentContext;
  }

  let currentImages = inferenceImages(incomingImages);
  if (user && replaceFromMessageId && !currentImages.length && replacementAttachments.length) {
    currentImages = await downloadStoredImages(supabase, replacementAttachments);
  }
  if (currentImages.length) {
    history = limitHistoricalImages(history, MAX_IMAGE_ATTACHMENTS - currentImages.length);
  }

  let answer: string;
  try {
    const inferenceHistory = regenerateFromMessageId
      ? [
          ...history,
          ...(regenerateInstruction ? [{
            role: "user" as const,
            content: `Answer the prior request again, incorporating this requested change:\n\n${regenerateInstruction}`,
          }] : []),
        ]
      : [...history, {
          role: "user" as const,
          content: message,
          ...(currentImages.length ? { images: currentImages } : {}),
          ...(currentDocumentContext ? { documentContext: currentDocumentContext } : {}),
        }];
    answer = await generateAnswer(inferenceHistory.slice(-24), {
      forceSearch: useSearch,
      mode,
      customInstructions,
    });
  } catch {
    scheduleInferenceTelemetryFlush();
    return NextResponse.json(
      { message: incomingAttachmentCount
          ? "The file-reading brain trust is temporarily unavailable. Try again in a moment."
          : "The brain trust is temporarily unavailable. Try again in a moment." },
      { status: 503 },
    );
  }
  scheduleInferenceTelemetryFlush();

  const assistantCreatedAt = new Date().toISOString();
  const userCreatedAt = new Date(Date.parse(assistantCreatedAt) - 1).toISOString();
  const userMessageId = regenerateFromMessageId ? null : crypto.randomUUID();
  const assistantMessageId = crypto.randomUUID();
  let storedUserAttachments: StoredChatAttachment[] = [];
  let newlyUploadedImages: StoredImageAttachment[] = [];
  let createdThread = false;
  if (user && !privateChat) {
    if (!threadId) {
      const { data: created, error } = await supabase
        .from("chat_threads")
        .insert({ user_id: user.id, title: threadTitle, project_id: threadProjectId })
        .select("id,project_id")
        .single();
      if (error || !created) {
        return NextResponse.json({ message: "The answer arrived, but the conversation could not be saved." }, { status: 503 });
      }
      threadId = created.id;
      threadProjectId = created.project_id;
      createdThread = true;
    }

    try {
      newlyUploadedImages = userMessageId && incomingImages.length
        ? await uploadAttachments(supabase, user.id, userMessageId, incomingImages)
        : [];
      storedUserAttachments = userMessageId && incomingAttachmentCount
        ? [...newlyUploadedImages, ...incomingDocuments]
        : userMessageId && replaceFromMessageId
          ? replacementAttachments
          : [];
    } catch {
      if (createdThread) await supabase.from("chat_threads").delete().eq("id", threadId);
      return NextResponse.json({ message: "The files could not be stored securely. Try again." }, { status: 503 });
    }

    const { error } = await supabase.rpc("append_chat_branch", {
          p_thread_id: threadId,
          p_parent_message_id: branchParentMessageId,
          p_user_message_id: userMessageId,
          p_user_content: userMessageId ? message : null,
          p_assistant_message_id: assistantMessageId,
          p_assistant_content: answer,
          p_title: shouldReplaceThreadTitle ? threadTitle : null,
          p_user_attachments: storedUserAttachments,
          p_user_attachment_context: currentDocumentContext,
        });
    if (error) {
      console.error("Chat persistence failed", {
        code: error.code,
        message: error.message,
        details: error.details,
        hint: error.hint,
        operation: "append-branch",
      });
      await removeStoredAttachments(supabase, newlyUploadedImages);
      if (createdThread) await supabase.from("chat_threads").delete().eq("id", threadId);
      return NextResponse.json({ message: "The answer arrived, but the conversation could not be saved." }, { status: 503 });
    }
  }

  const responseAttachments = userMessageId
    ? privateChat
      ? [
          ...incomingImages.map(({ id, name, mimeType, size, dataUrl }) => ({
            id,
            name,
            mimeType,
            size,
            url: dataUrl,
          })),
          ...incomingDocuments.map((attachment) => ({
            ...attachment,
            url: pendingDocumentAttachmentUrl(attachment),
          })),
        ]
      : user
      ? storedUserAttachments.map((attachment) => storedAttachmentForClient(userMessageId, attachment))
      : incomingImages.map(({ id, name, mimeType, size, dataUrl }) => ({ id, name, mimeType, size, url: dataUrl }))
    : [];
  const nextUsed = user ? used : used + 1;
  const response = NextResponse.json({
    threadId,
    projectId: threadProjectId,
    title: threadTitle,
    userMessage: userMessageId
      ? {
          id: userMessageId,
          role: "user",
          content: message,
          createdAt: userCreatedAt,
          parentId: branchParentMessageId,
          ...(responseAttachments.length ? { attachments: responseAttachments } : {}),
        }
      : null,
    message: {
      id: assistantMessageId,
      role: "assistant",
      content: answer,
      createdAt: assistantCreatedAt,
      parentId: userMessageId ?? branchParentMessageId,
    },
    activeLeafId: assistantMessageId,
    remainingGuestMessages: user ? null : remainingGuestMessages(nextUsed),
    privateChat,
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
