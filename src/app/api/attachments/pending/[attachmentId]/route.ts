import { NextResponse } from "next/server";
import {
  CHAT_DOCUMENT_BUCKET,
  MAX_DOCUMENT_BYTES,
  extensionForDocumentMimeType,
  isSupportedDocumentMimeType,
} from "@/lib/attachment-constants";
import { renderDocumentPreview } from "@/lib/document-preview";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type RouteContext = {
  params: Promise<{ attachmentId: string }>;
};

function safeDownloadName(name: string | null) {
  return (name ?? "")
    .replace(/[\u0000-\u001f\u007f"\\/]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120) || "document";
}

function contentDisposition(name: string, inline: boolean) {
  const safeName = safeDownloadName(name);
  const asciiName = safeName.replace(/[^\x20-\x7e]/g, "_");
  return `${inline ? "inline" : "attachment"}; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(safeName)}`;
}

export async function GET(request: Request, context: RouteContext) {
  const [{ attachmentId }, supabase] = await Promise.all([
    context.params,
    createSupabaseServerClient(),
  ]);
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user || authData.user.is_anonymous) {
    return NextResponse.json({ message: "Sign in required." }, { status: 401 });
  }
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(attachmentId)) {
    return NextResponse.json({ message: "Attachment not found." }, { status: 404 });
  }

  const searchParams = new URL(request.url).searchParams;
  const mimeType = searchParams.get("mimeType");
  if (!isSupportedDocumentMimeType(mimeType)) {
    return NextResponse.json({ message: "Unsupported document type." }, { status: 400 });
  }

  const storagePath = `${authData.user.id}/pending/${attachmentId}.${extensionForDocumentMimeType(mimeType)}`;
  const { data, error } = await supabase.storage.from(CHAT_DOCUMENT_BUCKET).download(storagePath);
  if (error || !data) {
    return NextResponse.json({ message: "Attachment is unavailable." }, { status: 404 });
  }
  if (!data.size || data.size > MAX_DOCUMENT_BYTES) {
    return NextResponse.json({ message: "Attachment is invalid." }, { status: 422 });
  }

  const name = safeDownloadName(searchParams.get("name"));
  const preview = searchParams.get("preview") === "1";
  const download = searchParams.get("download") === "1";
  if (preview && mimeType !== "application/pdf") {
    try {
      const html = await renderDocumentPreview(Buffer.from(await data.arrayBuffer()), mimeType, name);
      return new Response(html, {
        headers: {
          "Cache-Control": "private, no-store",
          "Content-Disposition": contentDisposition(`${name}.html`, true),
          "Content-Security-Policy": "default-src 'none'; img-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'; sandbox",
          "Content-Type": "text/html; charset=utf-8",
          "X-Content-Type-Options": "nosniff",
        },
      });
    } catch {
      return NextResponse.json({ message: "This document could not be previewed." }, { status: 422 });
    }
  }

  return new Response(data, {
    headers: {
      "Cache-Control": "private, no-store",
      "Content-Disposition": contentDisposition(name, !download && mimeType === "application/pdf"),
      "Content-Length": String(data.size),
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "Content-Type": mimeType,
      "X-Content-Type-Options": "nosniff",
    },
  });
}
