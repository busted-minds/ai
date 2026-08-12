"use client";

import {
  CHAT_DOCUMENT_BUCKET,
  MAX_CHAT_ATTACHMENTS,
  MAX_DOCUMENT_BYTES,
  MAX_TOTAL_DOCUMENT_BYTES,
  documentMimeTypeForFile,
  extensionForDocumentMimeType,
  isSupportedDocumentMimeType,
} from "./attachment-constants";
import { prepareImageAttachment } from "./client-images";
import { isSupportedImageMimeType } from "./image-constants";
import { pendingDocumentAttachmentUrl } from "./attachment-urls";
import { getSupabaseBrowserClient } from "./supabase/browser";
import type { ChatAttachment } from "./types";

function localId() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function cleanFileName(name: string) {
  return name
    .replace(/[\u0000-\u001f\u007f/\\]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120) || "document";
}

async function uploadDocument(file: File, userId: string): Promise<ChatAttachment> {
  const mimeType = documentMimeTypeForFile(file);
  if (!mimeType) {
    throw new Error("Use PDF, DOCX, TXT, Markdown, CSV, JSON, JPEG, PNG, or WebP files.");
  }
  if (!file.size || file.size > MAX_DOCUMENT_BYTES) {
    throw new Error("Each document must be 8 MB or smaller.");
  }
  const supabase = getSupabaseBrowserClient();
  if (!supabase) throw new Error("Secure file storage is unavailable.");

  const id = localId();
  const storagePath = `${userId}/pending/${id}.${extensionForDocumentMimeType(mimeType)}`;
  const { error } = await supabase.storage.from(CHAT_DOCUMENT_BUCKET).upload(storagePath, file, {
    cacheControl: "3600",
    contentType: mimeType,
    upsert: false,
  });
  if (error) throw new Error("That document could not be uploaded securely.");
  const attachment: ChatAttachment = {
    id,
    name: cleanFileName(file.name),
    mimeType,
    size: file.size,
    storagePath,
    url: "",
  };
  return { ...attachment, url: pendingDocumentAttachmentUrl(attachment) };
}

export async function prepareChatAttachments(
  files: File[],
  existing: ChatAttachment[],
  userId: string | null,
): Promise<ChatAttachment[]> {
  const availableSlots = MAX_CHAT_ATTACHMENTS - existing.length;
  if (files.length > availableSlots) {
    throw new Error(`Attach no more than ${MAX_CHAT_ATTACHMENTS} files at once.`);
  }

  const documentBytes = files.reduce((total, file) =>
    total + (isSupportedImageMimeType(file.type) ? 0 : file.size), 0);
  if (documentBytes > MAX_TOTAL_DOCUMENT_BYTES) {
    throw new Error("The combined document upload must be 16 MB or smaller.");
  }

  const prepared: ChatAttachment[] = [];
  try {
    for (const file of files) {
      if (isSupportedImageMimeType(file.type)) {
        prepared.push(await prepareImageAttachment(file));
        continue;
      }
      if (!userId) throw new Error("Sign in to attach documents. Guests can still attach images.");
      prepared.push(await uploadDocument(file, userId));
    }
    return prepared;
  } catch (error) {
    await removePendingDocumentAttachments(prepared);
    throw error;
  }
}

export async function removePendingDocumentAttachments(attachments: ChatAttachment[]) {
  const paths = attachments.flatMap((attachment) =>
    isSupportedDocumentMimeType(attachment.mimeType)
      && typeof attachment.storagePath === "string"
      && attachment.storagePath
      ? [attachment.storagePath]
      : []);
  if (!paths.length) return;
  const supabase = getSupabaseBrowserClient();
  if (!supabase) return;
  await supabase.storage.from(CHAT_DOCUMENT_BUCKET).remove([...new Set(paths)]);
}

export function attachmentPayload(attachments: ChatAttachment[]) {
  if (!Array.isArray(attachments)) return [];
  const payload: Array<
    | { name: string; mimeType: string; size: number; dataUrl: string }
    | { id: string; name: string; mimeType: string; size: number; storagePath: string }
  > = [];
  for (const item of (attachments as unknown[]).slice(0, MAX_CHAT_ATTACHMENTS)) {
    if (!item || typeof item !== "object") continue;
    const attachment = item as Partial<ChatAttachment>;
    if (
      typeof attachment.name !== "string"
      || typeof attachment.size !== "number"
      || typeof attachment.mimeType !== "string"
    ) {
      continue;
    }
    if (
      isSupportedImageMimeType(attachment.mimeType)
      && typeof attachment.url === "string"
      && attachment.url.startsWith(`data:${attachment.mimeType};base64,`)
    ) {
      payload.push({
        name: attachment.name,
        mimeType: attachment.mimeType,
        size: attachment.size,
        dataUrl: attachment.url,
      });
      continue;
    }
    if (
      isSupportedDocumentMimeType(attachment.mimeType)
      && typeof attachment.id === "string"
      && typeof attachment.storagePath === "string"
    ) {
      payload.push({
        id: attachment.id,
        name: attachment.name,
        mimeType: attachment.mimeType,
        size: attachment.size,
        storagePath: attachment.storagePath,
      });
    }
  }
  return payload;
}
