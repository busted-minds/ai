import type { ChatAttachment } from "./types";
import {
  MAX_IMAGE_ATTACHMENTS,
  MAX_IMAGE_BYTES,
  MAX_IMAGE_DIMENSION,
  MAX_SOURCE_IMAGE_BYTES,
  isSupportedImageMimeType,
  type SupportedImageMimeType,
} from "./image-constants";

type LoadedImage = {
  source: CanvasImageSource;
  width: number;
  height: number;
  cleanup: () => void;
};

function localId() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function loadImage(file: File): Promise<LoadedImage> {
  if (typeof createImageBitmap === "function") {
    const bitmap = await createImageBitmap(file);
    return {
      source: bitmap,
      width: bitmap.width,
      height: bitmap.height,
      cleanup: () => bitmap.close(),
    };
  }

  const objectUrl = URL.createObjectURL(file);
  const image = document.createElement("img");
  image.decoding = "async";
  image.src = objectUrl;
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error("That image could not be decoded."));
  });
  return {
    source: image,
    width: image.naturalWidth,
    height: image.naturalHeight,
    cleanup: () => URL.revokeObjectURL(objectUrl),
  };
}

function canvasBlob(canvas: HTMLCanvasElement, mimeType: SupportedImageMimeType, quality: number) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => blob ? resolve(blob) : reject(new Error("That image could not be optimized.")),
      mimeType,
      quality,
    );
  });
}

function blobDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === "string"
      ? resolve(reader.result)
      : reject(new Error("That image could not be read."));
    reader.onerror = () => reject(new Error("That image could not be read."));
    reader.readAsDataURL(blob);
  });
}

export async function prepareImageAttachment(file: File): Promise<ChatAttachment> {
  if (!isSupportedImageMimeType(file.type)) {
    throw new Error("Only JPEG, PNG, and WebP images are supported.");
  }
  if (!file.size || file.size > MAX_SOURCE_IMAGE_BYTES) {
    throw new Error("Choose an image smaller than 12 MB.");
  }

  const loaded = await loadImage(file);
  try {
    if (!loaded.width || !loaded.height) throw new Error("That image has invalid dimensions.");
    const initialScale = Math.min(1, MAX_IMAGE_DIMENSION / Math.max(loaded.width, loaded.height));
    let width = Math.max(1, Math.round(loaded.width * initialScale));
    let height = Math.max(1, Math.round(loaded.height * initialScale));
    let quality = file.type === "image/jpeg" ? 0.86 : 0.9;
    const outputType: SupportedImageMimeType = file.type === "image/jpeg" ? "image/jpeg" : "image/webp";
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d", { alpha: outputType !== "image/jpeg" });
    if (!context) throw new Error("Image processing is unavailable in this browser.");

    let blob: Blob | null = null;
    for (let attempt = 0; attempt < 7; attempt += 1) {
      canvas.width = width;
      canvas.height = height;
      context.clearRect(0, 0, width, height);
      context.drawImage(loaded.source, 0, 0, width, height);
      blob = await canvasBlob(canvas, outputType, quality);
      if (blob.size <= MAX_IMAGE_BYTES) break;
      const scale = Math.min(0.88, Math.max(0.62, Math.sqrt(MAX_IMAGE_BYTES / blob.size) * 0.93));
      width = Math.max(1, Math.round(width * scale));
      height = Math.max(1, Math.round(height * scale));
      quality = Math.max(0.64, quality - 0.05);
    }
    if (!blob || blob.size > MAX_IMAGE_BYTES) {
      throw new Error("That image could not be reduced below 800 KB.");
    }
    if (!isSupportedImageMimeType(blob.type)) {
      throw new Error("This browser produced an unsupported image format.");
    }
    return {
      id: localId(),
      name: file.name.replace(/[\u0000-\u001f\u007f/\\]+/g, " ").trim().slice(0, 120) || "image",
      mimeType: blob.type,
      size: blob.size,
      url: await blobDataUrl(blob),
    };
  } finally {
    loaded.cleanup();
  }
}

export async function prepareImageAttachments(files: File[], availableSlots = MAX_IMAGE_ATTACHMENTS) {
  if (files.length > availableSlots) {
    throw new Error(`Attach no more than ${MAX_IMAGE_ATTACHMENTS} images at once.`);
  }
  const prepared: ChatAttachment[] = [];
  for (const file of files) prepared.push(await prepareImageAttachment(file));
  return prepared;
}

export function attachmentPayload(attachments: ChatAttachment[]) {
  if (!Array.isArray(attachments)) return [];
  return (attachments as unknown[]).slice(0, MAX_IMAGE_ATTACHMENTS).flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const attachment = item as Partial<ChatAttachment>;
    if (
      typeof attachment.name !== "string"
      || !isSupportedImageMimeType(attachment.mimeType)
      || typeof attachment.size !== "number"
      || typeof attachment.url !== "string"
      || !attachment.url.startsWith(`data:${attachment.mimeType};base64,`)
    ) {
      return [];
    }
    return [{
      name: attachment.name,
      mimeType: attachment.mimeType,
      size: attachment.size,
      dataUrl: attachment.url,
    }];
  });
}
