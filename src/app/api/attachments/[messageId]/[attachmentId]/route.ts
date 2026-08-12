import { NextResponse } from "next/server";
import { bucketForStoredAttachment, parseStoredAttachments } from "@/lib/chat-attachments";
import { MAX_DOCUMENT_BYTES, isSupportedDocumentMimeType } from "@/lib/attachment-constants";
import { renderDocumentPreview } from "@/lib/document-preview";
import { MAX_IMAGE_BYTES } from "@/lib/image-constants";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type RouteContext = {
  params: Promise<{ messageId: string; attachmentId: string }>;
};

function safeDownloadName(name: string) {
  return name.replace(/[\r\n"\\]/g, " ").replace(/\s+/g, " ").trim().slice(0, 120) || "attachment";
}

function contentDisposition(name: string, inline: boolean) {
  const safeName = safeDownloadName(name);
  const asciiName = safeName.replace(/[^\x20-\x7e]/g, "_");
  return `${inline ? "inline" : "attachment"}; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(safeName)}`;
}

export async function GET(request: Request, context: RouteContext) {
  const [{ messageId, attachmentId }, supabase] = await Promise.all([
    context.params,
    createSupabaseServerClient(),
  ]);
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user || authData.user.is_anonymous) {
    return NextResponse.json({ message: "Sign in required." }, { status: 401 });
  }

  const { data: message } = await supabase
    .from("chat_messages")
    .select("id,attachments")
    .eq("id", messageId)
    .maybeSingle();
  const attachment = parseStoredAttachments(message?.attachments)
    .find((candidate) => candidate.id === attachmentId);
  if (!message || !attachment) {
    return NextResponse.json({ message: "Attachment not found." }, { status: 404 });
  }

  const { data, error } = await supabase.storage
    .from(bucketForStoredAttachment(attachment))
    .download(attachment.storagePath);
  if (error || !data) {
    return NextResponse.json({ message: "Attachment is unavailable." }, { status: 404 });
  }
  const document = isSupportedDocumentMimeType(attachment.mimeType);
  const maxBytes = document ? MAX_DOCUMENT_BYTES : MAX_IMAGE_BYTES;
  if (!data.size || data.size > maxBytes || data.size !== attachment.size) {
    return NextResponse.json({ message: "Attachment is invalid." }, { status: 422 });
  }
  const searchParams = new URL(request.url).searchParams;
  const preview = document && searchParams.get("preview") === "1";
  const download = searchParams.get("download") === "1";

  if (
    preview
    && isSupportedDocumentMimeType(attachment.mimeType)
    && attachment.mimeType !== "application/pdf"
  ) {
    try {
      const html = await renderDocumentPreview(
        Buffer.from(await data.arrayBuffer()),
        attachment.mimeType,
        attachment.name,
      );
      return new Response(html, {
        headers: {
          "Cache-Control": "private, no-store",
          "Content-Disposition": contentDisposition(`${attachment.name}.html`, true),
          "Content-Security-Policy": "default-src 'none'; img-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'; sandbox",
          "Content-Type": "text/html; charset=utf-8",
          "X-Content-Type-Options": "nosniff",
        },
      });
    } catch {
      return NextResponse.json({ message: "This document could not be previewed." }, { status: 422 });
    }
  }

  const inline = !download && (!document || attachment.mimeType === "application/pdf");

  return new Response(data, {
    headers: {
      "Cache-Control": "private, no-store",
      "Content-Disposition": contentDisposition(attachment.name, inline),
      "Content-Length": String(data.size),
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "Content-Type": attachment.mimeType,
      "X-Content-Type-Options": "nosniff",
    },
  });
}
