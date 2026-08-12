import { NextResponse } from "next/server";
import { CHAT_IMAGE_BUCKET, parseStoredAttachments } from "@/lib/chat-attachments";
import { MAX_IMAGE_BYTES } from "@/lib/image-constants";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type RouteContext = {
  params: Promise<{ messageId: string; attachmentId: string }>;
};

function safeDownloadName(name: string) {
  return name.replace(/[\r\n"\\]/g, " ").replace(/\s+/g, " ").trim().slice(0, 120) || "image";
}

export async function GET(_request: Request, context: RouteContext) {
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
    return NextResponse.json({ message: "Image not found." }, { status: 404 });
  }

  const { data, error } = await supabase.storage.from(CHAT_IMAGE_BUCKET).download(attachment.storagePath);
  if (error || !data) {
    return NextResponse.json({ message: "Image is unavailable." }, { status: 404 });
  }
  if (!data.size || data.size > MAX_IMAGE_BYTES) {
    return NextResponse.json({ message: "Image is invalid." }, { status: 422 });
  }

  return new Response(data, {
    headers: {
      "Cache-Control": "private, no-store",
      "Content-Disposition": `inline; filename="${safeDownloadName(attachment.name)}"`,
      "Content-Length": String(data.size),
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "Content-Type": attachment.mimeType,
      "X-Content-Type-Options": "nosniff",
    },
  });
}
