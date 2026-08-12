import type { ChatAttachment } from "./types";
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

export class AttachmentValidationError extends Error {}

function cleanImageName(value: unknown): string {
  const name = typeof value === "string"
    ? value.replace(/[\u0000-\u001f\u007f/\\]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 120)
    : "";
  return name || "image";
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
      name: cleanImageName(candidate.name),
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

export function parseStoredAttachments(value: unknown): StoredImageAttachment[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, MAX_IMAGE_ATTACHMENTS).flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const candidate = item as Record<string, unknown>;
    if (
      typeof candidate.id !== "string"
      || typeof candidate.storagePath !== "string"
      || typeof candidate.size !== "number"
      || !Number.isInteger(candidate.size)
      || candidate.size <= 0
      || candidate.size > MAX_IMAGE_BYTES
      || !isSupportedImageMimeType(candidate.mimeType)
      || !/^[0-9a-f-]+\/[0-9a-f-]+\/[0-9a-f-]+\.(?:jpg|png|webp)$/i.test(candidate.storagePath)
    ) {
      return [];
    }
    return [{
      id: candidate.id,
      name: cleanImageName(candidate.name),
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
  attachment: StoredImageAttachment,
): ChatAttachment {
  return {
    id: attachment.id,
    name: attachment.name,
    mimeType: attachment.mimeType,
    size: attachment.size,
    url: chatAttachmentUrl(messageId, attachment.id),
  };
}
