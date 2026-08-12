import type { ChatAttachment } from "./types";
import {
  CHAT_DOCUMENT_BUCKET,
  MAX_CHAT_ATTACHMENTS,
  MAX_DOCUMENT_BYTES,
  MAX_TOTAL_DOCUMENT_BYTES,
  extensionForDocumentMimeType,
  isSupportedAttachmentMimeType,
  isSupportedDocumentMimeType,
  type SupportedDocumentMimeType,
} from "./attachment-constants";
import {
  MAX_IMAGE_ATTACHMENTS,
  MAX_IMAGE_BYTES,
  MAX_TOTAL_IMAGE_BYTES,
  isSupportedImageMimeType,
  type SupportedImageMimeType,
} from "./image-constants";

export const CHAT_IMAGE_BUCKET = "chat-images";

export type ValidatedImageAttachment = {
  id: string;
  name: string;
  mimeType: SupportedImageMimeType;
  size: number;
  base64: string;
  bytes: Buffer;
  dataUrl: string;
};

export type StoredImageAttachment = {
  id: string;
  name: string;
  mimeType: SupportedImageMimeType;
  size: number;
  storagePath: string;
};

export type StoredDocumentAttachment = {
  id: string;
  name: string;
  mimeType: SupportedDocumentMimeType;
  size: number;
  storagePath: string;
};

export type StoredChatAttachment = StoredImageAttachment | StoredDocumentAttachment;

export type ValidatedChatAttachments = {
  images: ValidatedImageAttachment[];
  documents: StoredDocumentAttachment[];
};

export class AttachmentValidationError extends Error {}

function cleanAttachmentName(value: unknown, fallback = "attachment"): string {
  const name = typeof value === "string"
    ? value.replace(/[\u0000-\u001f\u007f/\\]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 120)
    : "";
  return name || fallback;
}

function hasExpectedMagic(bytes: Buffer, mimeType: SupportedImageMimeType): boolean {
  if (mimeType === "image/jpeg") {
    return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  }
  if (mimeType === "image/png") {
    return bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  }
  return bytes.length >= 12
    && bytes.subarray(0, 4).toString("ascii") === "RIFF"
    && bytes.subarray(8, 12).toString("ascii") === "WEBP";
}

function parseDataUrl(value: unknown, declaredMimeType: SupportedImageMimeType) {
  if (typeof value !== "string" || value.length > Math.ceil(MAX_IMAGE_BYTES * 4 / 3) + 128) {
    throw new AttachmentValidationError("Each image must be under 800 KB after optimization.");
  }
  const prefix = `data:${declaredMimeType};base64,`;
  if (!value.startsWith(prefix)) {
    throw new AttachmentValidationError("The image data does not match its file type.");
  }
  const base64 = value.slice(prefix.length);
  if (!base64 || base64.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(base64)) {
    throw new AttachmentValidationError("The image data is malformed.");
  }
  const bytes = Buffer.from(base64, "base64");
  if (!bytes.length || bytes.length > MAX_IMAGE_BYTES) {
    throw new AttachmentValidationError("Each image must be under 800 KB after optimization.");
  }
  if (!hasExpectedMagic(bytes, declaredMimeType)) {
    throw new AttachmentValidationError("The uploaded file is not a valid supported image.");
  }
  return { base64, bytes, dataUrl: `${prefix}${base64}` };
}

export function validateIncomingAttachments(value: unknown): ValidatedImageAttachment[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new AttachmentValidationError("Image attachments must be a list.");
  if (value.length > MAX_IMAGE_ATTACHMENTS) {
    throw new AttachmentValidationError(`Attach no more than ${MAX_IMAGE_ATTACHMENTS} images at once.`);
  }

  let totalBytes = 0;
  return value.map((item) => {
    if (!item || typeof item !== "object") {
      throw new AttachmentValidationError("An image attachment is malformed.");
    }
    const candidate = item as Record<string, unknown>;
    if (!isSupportedImageMimeType(candidate.mimeType)) {
      throw new AttachmentValidationError("Only JPEG, PNG, and WebP images are supported.");
    }
    const parsed = parseDataUrl(candidate.dataUrl, candidate.mimeType);
    totalBytes += parsed.bytes.length;
    if (totalBytes > MAX_TOTAL_IMAGE_BYTES) {
      throw new AttachmentValidationError("The combined image upload is too large.");
    }
    return {
      id: crypto.randomUUID(),
      name: cleanAttachmentName(candidate.name, "image"),
      mimeType: candidate.mimeType,
      size: parsed.bytes.length,
      ...parsed,
    };
  });
}

export function safeIncomingAttachments(value: unknown): ValidatedImageAttachment[] {
  try {
    return validateIncomingAttachments(value);
  } catch {
    return [];
  }
}

function isUuid(value: unknown): value is string {
  return typeof value === "string"
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function hasExpectedDocumentPath(
  storagePath: string,
  id: string,
  mimeType: SupportedDocumentMimeType,
  userId?: string,
) {
  const expectedExtension = extensionForDocumentMimeType(mimeType);
  const match = storagePath.match(/^([0-9a-f-]{36})\/pending\/([0-9a-f-]{36})\.([a-z0-9]+)$/i);
  return Boolean(
    match
    && (!userId || match[1]?.toLowerCase() === userId.toLowerCase())
    && match[2]?.toLowerCase() === id.toLowerCase()
    && match[3]?.toLowerCase() === expectedExtension,
  );
}

export function validateIncomingChatAttachments(
  value: unknown,
  userId: string | null,
): ValidatedChatAttachments {
  if (value === undefined || value === null) return { images: [], documents: [] };
  if (!Array.isArray(value)) throw new AttachmentValidationError("Attachments must be a list.");
  if (value.length > MAX_CHAT_ATTACHMENTS) {
    throw new AttachmentValidationError(`Attach no more than ${MAX_CHAT_ATTACHMENTS} files at once.`);
  }

  const imageCandidates: unknown[] = [];
  const documents: StoredDocumentAttachment[] = [];
  let totalDocumentBytes = 0;
  for (const item of value) {
    if (!item || typeof item !== "object") {
      throw new AttachmentValidationError("An attachment is malformed.");
    }
    const candidate = item as Record<string, unknown>;
    if (isSupportedImageMimeType(candidate.mimeType)) {
      imageCandidates.push(candidate);
      continue;
    }
    if (!isSupportedDocumentMimeType(candidate.mimeType)) {
      throw new AttachmentValidationError("Use PDF, DOCX, TXT, Markdown, CSV, JSON, JPEG, PNG, or WebP files.");
    }
    if (!userId) throw new AttachmentValidationError("Sign in to attach documents.");
    if (
      !isUuid(candidate.id)
      || typeof candidate.storagePath !== "string"
      || typeof candidate.size !== "number"
      || !Number.isInteger(candidate.size)
      || candidate.size <= 0
      || candidate.size > MAX_DOCUMENT_BYTES
      || !hasExpectedDocumentPath(candidate.storagePath, candidate.id, candidate.mimeType, userId)
    ) {
      throw new AttachmentValidationError("A document attachment is malformed.");
    }
    totalDocumentBytes += candidate.size;
    if (totalDocumentBytes > MAX_TOTAL_DOCUMENT_BYTES) {
      throw new AttachmentValidationError("The combined document upload must be 16 MB or smaller.");
    }
    documents.push({
      id: candidate.id,
      name: cleanAttachmentName(candidate.name, "document"),
      mimeType: candidate.mimeType,
      size: candidate.size,
      storagePath: candidate.storagePath,
    });
  }
  return { images: validateIncomingAttachments(imageCandidates), documents };
}

export function parseStoredAttachments(value: unknown): StoredChatAttachment[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, MAX_CHAT_ATTACHMENTS).flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const candidate = item as Record<string, unknown>;
    if (
      !isUuid(candidate.id)
      || typeof candidate.storagePath !== "string"
      || typeof candidate.size !== "number"
      || !Number.isInteger(candidate.size)
      || candidate.size <= 0
      || !isSupportedAttachmentMimeType(candidate.mimeType)
    ) {
      return [];
    }
    const validPath = isSupportedImageMimeType(candidate.mimeType)
      ? candidate.size <= MAX_IMAGE_BYTES
        && /^[0-9a-f-]+\/[0-9a-f-]+\/[0-9a-f-]+\.(?:jpg|png|webp)$/i.test(candidate.storagePath)
      : candidate.size <= MAX_DOCUMENT_BYTES
        && hasExpectedDocumentPath(candidate.storagePath, candidate.id, candidate.mimeType);
    if (!validPath) return [];
    return [{
      id: candidate.id,
      name: cleanAttachmentName(candidate.name),
      mimeType: candidate.mimeType,
      size: candidate.size,
      storagePath: candidate.storagePath,
    }];
  });
}

export function extensionForMimeType(mimeType: SupportedImageMimeType) {
  if (mimeType === "image/jpeg") return "jpg";
  if (mimeType === "image/png") return "png";
  return "webp";
}

export function chatAttachmentUrl(messageId: string, attachmentId: string) {
  return `/api/attachments/${encodeURIComponent(messageId)}/${encodeURIComponent(attachmentId)}`;
}

export function storedAttachmentForClient(
  messageId: string,
  attachment: StoredChatAttachment,
): ChatAttachment {
  return {
    id: attachment.id,
    name: attachment.name,
    mimeType: attachment.mimeType,
    size: attachment.size,
    url: chatAttachmentUrl(messageId, attachment.id),
  };
}

export function bucketForStoredAttachment(attachment: Pick<StoredChatAttachment, "mimeType">) {
  return isSupportedDocumentMimeType(attachment.mimeType) ? CHAT_DOCUMENT_BUCKET : CHAT_IMAGE_BUCKET;
}
