import {
  isSupportedImageMimeType,
  type SupportedImageMimeType,
} from "./image-constants";

export const SUPPORTED_DOCUMENT_MIME_TYPES = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/plain",
  "text/markdown",
  "text/csv",
  "application/csv",
  "application/json",
] as const;

export type SupportedDocumentMimeType = (typeof SUPPORTED_DOCUMENT_MIME_TYPES)[number];
export type SupportedAttachmentMimeType = SupportedImageMimeType | SupportedDocumentMimeType;

export const MAX_CHAT_ATTACHMENTS = 3;
export const MAX_DOCUMENT_BYTES = 8_000_000;
export const MAX_TOTAL_DOCUMENT_BYTES = 16_000_000;
export const MAX_ATTACHMENT_CONTEXT_CHARACTERS = 48_000;
export const CHAT_DOCUMENT_BUCKET = "chat-files";

export const CHAT_ATTACHMENT_ACCEPT = [
  "image/jpeg",
  "image/png",
  "image/webp",
  ...SUPPORTED_DOCUMENT_MIME_TYPES,
  ".md",
  ".csv",
  ".json",
].join(",");

export function isSupportedDocumentMimeType(value: unknown): value is SupportedDocumentMimeType {
  return typeof value === "string"
    && SUPPORTED_DOCUMENT_MIME_TYPES.includes(value as SupportedDocumentMimeType);
}

export function isSupportedAttachmentMimeType(value: unknown): value is SupportedAttachmentMimeType {
  return isSupportedImageMimeType(value) || isSupportedDocumentMimeType(value);
}

export function extensionForDocumentMimeType(mimeType: SupportedDocumentMimeType) {
  if (mimeType === "application/pdf") return "pdf";
  if (mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") return "docx";
  if (mimeType === "text/markdown") return "md";
  if (mimeType === "text/csv" || mimeType === "application/csv") return "csv";
  if (mimeType === "application/json") return "json";
  return "txt";
}

export function documentMimeTypeForFile(file: Pick<File, "name" | "type">): SupportedDocumentMimeType | null {
  if (isSupportedDocumentMimeType(file.type)) return file.type;
  const extension = file.name.split(".").pop()?.toLowerCase();
  if (extension === "pdf") return "application/pdf";
  if (extension === "docx") return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  if (extension === "md") return "text/markdown";
  if (extension === "csv") return "text/csv";
  if (extension === "json") return "application/json";
  if (extension === "txt") return "text/plain";
  return null;
}
