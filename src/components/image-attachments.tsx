"use client";

import Image from "next/image";
import { ChevronRight, Download, ExternalLink, FileText, ImageIcon, LoaderCircle, Maximize2, X } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { MAX_CHAT_ATTACHMENTS, isSupportedAttachmentMimeType } from "@/lib/attachment-constants";
import { attachmentActionUrl, safeChatAttachmentUrl } from "@/lib/attachment-urls";
import { isSupportedImageMimeType } from "@/lib/image-constants";
import type { ChatAttachment } from "@/lib/types";

function documentTypeLabel(mimeType: ChatAttachment["mimeType"]) {
  if (mimeType === "application/pdf") return "PDF";
  if (mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") return "Word";
  if (mimeType === "text/markdown") return "Markdown";
  if (mimeType === "text/csv" || mimeType === "application/csv") return "CSV";
  if (mimeType === "application/json") return "JSON";
  return "Text";
}

export function ImageAttachments({
  attachments,
  onRemove,
  compact = false,
}: {
  attachments?: ChatAttachment[];
  onRemove?: (id: string) => void;
  compact?: boolean;
}) {
  const [previewAttachment, setPreviewAttachment] = useState<ChatAttachment | null>(null);
  const [documentPreviewLoading, setDocumentPreviewLoading] = useState(false);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const returnFocusRef = useRef<HTMLButtonElement>(null);
  const documentPanelRef = useRef<HTMLElement>(null);
  const previewTitleId = useId();
  const displayAttachments = Array.isArray(attachments)
    ? (attachments as unknown[]).slice(0, MAX_CHAT_ATTACHMENTS).flatMap((item) => {
        if (!item || typeof item !== "object") return [];
        const candidate = item as Partial<ChatAttachment>;
        if (
          typeof candidate.id !== "string"
          || typeof candidate.name !== "string"
          || !isSupportedAttachmentMimeType(candidate.mimeType)
          || typeof candidate.size !== "number"
          || typeof candidate.url !== "string"
        ) {
          return [];
        }
        return [{
          id: candidate.id,
          name: candidate.name.slice(0, 120) || "attachment",
          mimeType: candidate.mimeType,
          size: candidate.size,
          url: candidate.url,
        }];
      })
    : [];

  const closePreview = useCallback(() => {
    setPreviewAttachment(null);
    window.requestAnimationFrame(() => returnFocusRef.current?.focus());
  }, []);

  useEffect(() => {
    if (!previewAttachment) return;

    const imagePreview = isSupportedImageMimeType(previewAttachment.mimeType);
    const previousOverflow = document.body.style.overflow;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closePreview();
      if (imagePreview && event.key === "Tab") {
        event.preventDefault();
        closeButtonRef.current?.focus();
      }
    };

    if (imagePreview) document.body.style.overflow = "hidden";
    else document.documentElement.classList.add("document-preview-open");
    document.addEventListener("keydown", handleKeyDown);
    const focusFrame = window.requestAnimationFrame(() => closeButtonRef.current?.focus());

    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.body.style.overflow = previousOverflow;
      document.documentElement.classList.remove("document-preview-open");
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [closePreview, previewAttachment]);

  const enterFullscreen = async () => {
    if (!documentPanelRef.current?.requestFullscreen) return;
    try {
      await documentPanelRef.current.requestFullscreen();
    } catch {
      // Fullscreen may be disabled by the browser or embedding host.
    }
  };

  if (!displayAttachments.length) return null;
  return (
    <>
      <div className={compact ? "image-attachments is-compact" : "image-attachments"}>
        {displayAttachments.map((attachment) => {
          const imageAttachment = isSupportedImageMimeType(attachment.mimeType);
          const safeUrl = safeChatAttachmentUrl(attachment);
          return (
            <div className={imageAttachment ? "image-attachment" : "document-attachment"} key={attachment.id}>
              {imageAttachment && safeUrl ? (
                <button
                  type="button"
                  className="image-attachment-trigger"
                  onClick={(event) => {
                    returnFocusRef.current = event.currentTarget;
                    setPreviewAttachment({ ...attachment, url: safeUrl });
                  }}
                  aria-label={`Preview ${attachment.name}`}
                  aria-haspopup="dialog"
                >
                  <Image
                    src={safeUrl}
                    alt={attachment.name}
                    width={compact ? 76 : 112}
                    height={compact ? 62 : 86}
                    unoptimized
                  />
                </button>
              ) : imageAttachment ? (
                <span className="image-attachment-placeholder" aria-label={attachment.name}>
                  <ImageIcon size={compact ? 18 : 22} />
                </span>
              ) : safeUrl ? (
                <button
                  type="button"
                  className="document-attachment-link"
                  onClick={(event) => {
                    returnFocusRef.current = event.currentTarget;
                    setDocumentPreviewLoading(true);
                    setPreviewAttachment({ ...attachment, url: safeUrl });
                  }}
                  aria-label={`Preview ${attachment.name}`}
                  aria-haspopup="dialog"
                >
                  <span className="document-attachment-icon"><FileText size={compact ? 17 : 20} /></span>
                  <span className="document-attachment-copy">
                    <strong title={attachment.name}>{attachment.name}</strong>
                    <small>{documentTypeLabel(attachment.mimeType)} · {Math.max(1, Math.ceil(attachment.size / 1024))} KB</small>
                  </span>
                  <ChevronRight size={compact ? 14 : 16} />
                </button>
              ) : (
                <div className="document-attachment-link" aria-label={`${attachment.name}, ready to send`}>
                  <span className="document-attachment-icon"><FileText size={compact ? 17 : 20} /></span>
                  <span className="document-attachment-copy">
                    <strong title={attachment.name}>{attachment.name}</strong>
                    <small>{Math.max(1, Math.ceil(attachment.size / 1024))} KB · ready</small>
                  </span>
                </div>
              )}
              {imageAttachment && <span className="image-attachment-name" title={attachment.name}>{attachment.name}</span>}
              {onRemove && (
                <button
                  type="button"
                  className="image-attachment-remove"
                  onClick={() => onRemove(attachment.id)}
                  aria-label={`Remove ${attachment.name}`}
                >
                  <X size={13} />
                </button>
              )}
            </div>
          );
        })}
      </div>
      {previewAttachment && isSupportedImageMimeType(previewAttachment.mimeType) && createPortal(
        <div
          className="image-preview-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closePreview();
          }}
        >
          <section
            className="image-preview-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby={previewTitleId}
          >
            <header className="image-preview-header">
              <span id={previewTitleId} title={previewAttachment.name}>{previewAttachment.name}</span>
              <button
                ref={closeButtonRef}
                type="button"
                onClick={closePreview}
                aria-label="Close image preview"
              >
                <X size={20} />
              </button>
            </header>
            <div className="image-preview-canvas">
              <Image
                className="image-preview-image"
                src={previewAttachment.url}
                alt={previewAttachment.name}
                width={1600}
                height={1200}
                unoptimized
                priority
              />
            </div>
          </section>
        </div>,
        document.body,
      )}
      {previewAttachment && !isSupportedImageMimeType(previewAttachment.mimeType) && createPortal(
        <div
          className="document-preview-layer"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closePreview();
          }}
        >
          <section
            ref={documentPanelRef}
            className="document-preview-panel"
            role="dialog"
            aria-labelledby={previewTitleId}
          >
            <header className="document-preview-header">
              <div className="document-preview-heading">
                <span className="document-preview-heading-icon"><FileText size={18} /></span>
                <span className="document-preview-breadcrumb">Files</span>
                <span aria-hidden>/</span>
                <strong id={previewTitleId} title={previewAttachment.name}>{previewAttachment.name}</strong>
              </div>
              <div className="document-preview-actions">
                <span className="document-preview-kind">{documentTypeLabel(previewAttachment.mimeType)}</span>
                <a
                  href={attachmentActionUrl(previewAttachment.url, "download")}
                  download={previewAttachment.name}
                  aria-label={`Download ${previewAttachment.name}`}
                  title="Download"
                >
                  <Download size={19} />
                </a>
                <a
                  href={attachmentActionUrl(previewAttachment.url, "preview")}
                  target="_blank"
                  rel="noreferrer"
                  aria-label={`Open ${previewAttachment.name} in a new tab`}
                  title="Open in new tab"
                >
                  <ExternalLink size={18} />
                </a>
                <button type="button" onClick={() => void enterFullscreen()} aria-label="View preview fullscreen" title="Fullscreen">
                  <Maximize2 size={18} />
                </button>
                <button ref={closeButtonRef} type="button" onClick={closePreview} aria-label="Close document preview" title="Close">
                  <X size={21} />
                </button>
              </div>
            </header>
            <div className="document-preview-canvas">
              {documentPreviewLoading && (
                <div className="document-preview-loading" role="status">
                  <LoaderCircle size={24} />
                  <span>Preparing preview…</span>
                </div>
              )}
              <iframe
                src={attachmentActionUrl(previewAttachment.url, "preview")}
                title={`Preview of ${previewAttachment.name}`}
                onLoad={() => setDocumentPreviewLoading(false)}
                onError={() => setDocumentPreviewLoading(false)}
                referrerPolicy="no-referrer"
              />
            </div>
          </section>
        </div>,
        document.body,
      )}
    </>
  );
}
