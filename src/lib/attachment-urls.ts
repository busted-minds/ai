import { isSupportedDocumentMimeType } from "./attachment-constants";
import { isSupportedImageMimeType } from "./image-constants";
import type { ChatAttachment } from "./types";

const STORED_ATTACHMENT_PATH = /^\/api\/attachments\/[0-9a-f-]{36}\/[0-9a-f-]{36}$/i;
const PENDING_ATTACHMENT_PATH = /^\/api\/attachments\/pending\/[0-9a-f-]{36}$/i;

export function pendingDocumentAttachmentUrl(
  attachment: Pick<ChatAttachment, "id" | "name" | "mimeType">,
) {
  const searchParams = new URLSearchParams({
    mimeType: attachment.mimeType,
    name: attachment.name,
  });
  return `/api/attachments/pending/${encodeURIComponent(attachment.id)}?${searchParams.toString()}`;
}

export function attachmentActionUrl(url: string, action: "download" | "preview") {
  return `${url}${url.includes("?") ? "&" : "?"}${action}=1`;
}

export function safeChatAttachmentUrl(
  attachment: Pick<ChatAttachment, "mimeType" | "name" | "url">,
) {
  if (
    isSupportedImageMimeType(attachment.mimeType)
    && attachment.url.startsWith(`data:${attachment.mimeType};base64,`)
  ) {
    return attachment.url;
  }

  const [path, query, ...extra] = attachment.url.split("?");
  if (!path || extra.length || path.includes("#")) return "";
  if (STORED_ATTACHMENT_PATH.test(path) && query === undefined) return attachment.url;
  if (!isSupportedDocumentMimeType(attachment.mimeType) || !PENDING_ATTACHMENT_PATH.test(path) || !query) {
    return "";
  }

  const searchParams = new URLSearchParams(query);
  if ([...searchParams.keys()].some((key) => key !== "mimeType" && key !== "name")) return "";
  return searchParams.get("mimeType") === attachment.mimeType
    && searchParams.get("name") === attachment.name
    ? attachment.url
    : "";
}
