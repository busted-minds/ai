import { isSupportedAttachmentMimeType, type SupportedAttachmentMimeType } from "./attachment-constants";

export const CHAT_SHARE_TOKEN_PATTERN = /^[0-9a-f]{48}$/;

export type SharedChatAttachment = {
  name: string;
  mimeType: SupportedAttachmentMimeType;
  size: number;
};

export type SharedChatMessage = {
  role: "user" | "assistant";
  content: string;
  attachments: SharedChatAttachment[];
};

export type SharedChat = {
  token: string;
  title: string;
  messages: SharedChatMessage[];
  createdAt: string;
  ownerUserId: string;
  sourceThreadId: string | null;
};

function sharedAttachment(value: unknown): SharedChatAttachment | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate.name !== "string"
    || !candidate.name.trim()
    || candidate.name.length > 120
    || !isSupportedAttachmentMimeType(candidate.mimeType)
    || typeof candidate.size !== "number"
    || !Number.isInteger(candidate.size)
    || candidate.size <= 0
  ) return null;
  return {
    name: candidate.name,
    mimeType: candidate.mimeType,
    size: candidate.size,
  };
}

function sharedMessage(value: unknown): SharedChatMessage | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;
  if (
    (candidate.role !== "user" && candidate.role !== "assistant")
    || typeof candidate.content !== "string"
    || candidate.content.length > 50_000
    || !Array.isArray(candidate.attachments)
    || candidate.attachments.length > 3
  ) return null;
  const attachments = candidate.attachments.map(sharedAttachment);
  if (attachments.some((attachment) => attachment === null)) return null;
  if (!candidate.content && !attachments.length) return null;
  return {
    role: candidate.role,
    content: candidate.content,
    attachments: attachments as SharedChatAttachment[],
  };
}

export function sharedChatFromRow(token: string, value: unknown): SharedChat | null {
  if (!CHAT_SHARE_TOKEN_PATTERN.test(token) || !value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  if (
    typeof row.title !== "string"
    || !row.title.trim()
    || row.title.length > 80
    || !Array.isArray(row.messages)
    || row.messages.length < 1
    || row.messages.length > 200
    || typeof row.created_at !== "string"
    || typeof row.owner_user_id !== "string"
    || (row.source_thread_id !== null && typeof row.source_thread_id !== "string")
  ) return null;
  const messages = row.messages.map(sharedMessage);
  if (messages.some((message) => message === null)) return null;
  return {
    token,
    title: row.title,
    messages: messages as SharedChatMessage[],
    createdAt: row.created_at,
    ownerUserId: row.owner_user_id,
    sourceThreadId: row.source_thread_id as string | null,
  };
}
