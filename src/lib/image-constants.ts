export const SUPPORTED_IMAGE_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;

export type SupportedImageMimeType = (typeof SUPPORTED_IMAGE_MIME_TYPES)[number];

export const MAX_IMAGE_ATTACHMENTS = 3;
export const MAX_IMAGE_BYTES = 800_000;
export const MAX_TOTAL_IMAGE_BYTES = MAX_IMAGE_ATTACHMENTS * MAX_IMAGE_BYTES;
export const MAX_SOURCE_IMAGE_BYTES = 12_000_000;
export const MAX_IMAGE_DIMENSION = 1_600;
export const MAX_CHAT_REQUEST_CHARACTERS = 3_900_000;

export function isSupportedImageMimeType(value: unknown): value is SupportedImageMimeType {
  return typeof value === "string" && SUPPORTED_IMAGE_MIME_TYPES.includes(value as SupportedImageMimeType);
}
