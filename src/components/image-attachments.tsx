import Image from "next/image";
import { ImageIcon, X } from "lucide-react";
import { MAX_IMAGE_ATTACHMENTS, isSupportedImageMimeType } from "@/lib/image-constants";
import type { ChatAttachment } from "@/lib/types";

export function ImageAttachments({
  attachments,
  onRemove,
  compact = false,
}: {
  attachments?: ChatAttachment[];
  onRemove?: (id: string) => void;
  compact?: boolean;
}) {
  const displayAttachments = Array.isArray(attachments)
    ? (attachments as unknown[]).slice(0, MAX_IMAGE_ATTACHMENTS).flatMap((item) => {
        if (!item || typeof item !== "object") return [];
        const candidate = item as Partial<ChatAttachment>;
        if (
          typeof candidate.id !== "string"
          || typeof candidate.name !== "string"
          || !isSupportedImageMimeType(candidate.mimeType)
          || typeof candidate.size !== "number"
          || typeof candidate.url !== "string"
        ) {
          return [];
        }
        return [{
          id: candidate.id,
          name: candidate.name.slice(0, 120) || "image",
          mimeType: candidate.mimeType,
          size: candidate.size,
          url: candidate.url,
        }];
      })
    : [];
  if (!displayAttachments.length) return null;
  return (
    <div className={compact ? "image-attachments is-compact" : "image-attachments"}>
      {displayAttachments.map((attachment) => {
        const safeUrl = attachment.url === ""
          || attachment.url.startsWith(`data:${attachment.mimeType};base64,`)
          || /^\/api\/attachments\/[0-9a-f-]+\/[0-9a-f-]+$/i.test(attachment.url)
          ? attachment.url
          : "";
        return (
          <div className="image-attachment" key={attachment.id}>
            {safeUrl ? (
              <a href={safeUrl} target="_blank" rel="noreferrer" aria-label={`Open ${attachment.name}`}>
                <Image
                  src={safeUrl}
                  alt={attachment.name}
                  width={compact ? 76 : 112}
                  height={compact ? 62 : 86}
                  unoptimized
                />
              </a>
            ) : (
              <span className="image-attachment-placeholder" aria-label={attachment.name}>
                <ImageIcon size={compact ? 18 : 22} />
              </span>
            )}
            <span className="image-attachment-name" title={attachment.name}>{attachment.name}</span>
            {onRemove && (
              <button type="button" onClick={() => onRemove(attachment.id)} aria-label={`Remove ${attachment.name}`}>
                <X size={13} />
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
