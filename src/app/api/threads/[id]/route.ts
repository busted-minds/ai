import { NextResponse } from "next/server";
import { loadThreadConversation } from "@/lib/chat-data";
import { newestLeafForBranch } from "@/lib/chat-branches";
import { bucketForStoredAttachment, parseStoredAttachments } from "@/lib/chat-attachments";
import { isUuid } from "@/lib/chat-projects";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type RouteContext = { params: Promise<{ id: string }> };

async function authenticatedClient() {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.getUser();
  return { supabase, user: data.user && !data.user.is_anonymous ? data.user : null };
}

export async function GET(_request: Request, context: RouteContext) {
  const [{ id }, { supabase, user }] = await Promise.all([context.params, authenticatedClient()]);
  if (!user) return NextResponse.json({ message: "Sign in required." }, { status: 401 });
  const { data: thread } = await supabase
    .from("chat_threads")
    .select("id,title,project_id,active_leaf_id,updated_at")
    .eq("id", id)
    .maybeSingle();
  if (!thread) return NextResponse.json({ message: "Conversation not found." }, { status: 404 });
  try {
    const conversation = await loadThreadConversation(supabase, id, thread.active_leaf_id);
    return NextResponse.json({
      thread: {
        id: thread.id,
        title: thread.title,
        projectId: thread.project_id,
        updatedAt: thread.updated_at,
        ...conversation,
      },
    });
  } catch {
    return NextResponse.json({ message: "Conversation could not be loaded." }, { status: 503 });
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  const [{ id }, { supabase, user }] = await Promise.all([context.params, authenticatedClient()]);
  if (!user) return NextResponse.json({ message: "Sign in required." }, { status: 401 });
  const body = (await request.json().catch(() => null)) as {
    title?: unknown;
    projectId?: unknown;
    archived?: unknown;
    activeMessageId?: unknown;
  } | null;
  if (!body) return NextResponse.json({ message: "Nothing to update." }, { status: 400 });

  const updates: { title?: string; project_id?: string | null; archived?: boolean; active_leaf_id?: string } = {};
  if (Object.prototype.hasOwnProperty.call(body, "title")) {
    const title = typeof body.title === "string" ? body.title.replace(/\s+/g, " ").trim().slice(0, 80) : "";
    if (!title) return NextResponse.json({ message: "A title is required." }, { status: 400 });
    updates.title = title;
  }
  if (Object.prototype.hasOwnProperty.call(body, "projectId")) {
    if (body.projectId !== null && !isUuid(body.projectId)) {
      return NextResponse.json({ message: "Choose a valid project." }, { status: 400 });
    }
    updates.project_id = body.projectId;
  }
  if (Object.prototype.hasOwnProperty.call(body, "archived")) {
    if (typeof body.archived !== "boolean") {
      return NextResponse.json({ message: "Choose a valid archive state." }, { status: 400 });
    }
    updates.archived = body.archived;
  }
  if (Object.prototype.hasOwnProperty.call(body, "activeMessageId")) {
    if (!isUuid(body.activeMessageId)) {
      return NextResponse.json({ message: "Choose a valid message version." }, { status: 400 });
    }
    try {
      const conversation = await loadThreadConversation(supabase, id);
      const activeLeafId = newestLeafForBranch(conversation.allMessages, body.activeMessageId);
      if (!activeLeafId) {
        return NextResponse.json({ message: "That message version is no longer available." }, { status: 404 });
      }
      updates.active_leaf_id = activeLeafId;
    } catch {
      return NextResponse.json({ message: "Message versions are temporarily unavailable." }, { status: 503 });
    }
  }
  if (!Object.keys(updates).length) {
    return NextResponse.json({ message: "Nothing to update." }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("chat_threads")
    .update(updates)
    .eq("id", id)
    .select("id,title,project_id,active_leaf_id,archived")
    .maybeSingle();
  if (error) return NextResponse.json({ message: "Conversation could not be updated." }, { status: 400 });
  if (!data) return NextResponse.json({ message: "Conversation not found." }, { status: 404 });
  const response: Record<string, unknown> = {
    ok: true,
    title: data.title,
    projectId: data.project_id,
    archived: data.archived,
  };
  if (updates.active_leaf_id) {
    try {
      response.thread = {
        id,
        title: data.title,
        projectId: data.project_id,
        updatedAt: new Date().toISOString(),
        ...await loadThreadConversation(supabase, id, data.active_leaf_id),
      };
    } catch {
      return NextResponse.json({ message: "The message version changed, but could not be loaded." }, { status: 503 });
    }
  }
  return NextResponse.json(response);
}

export async function DELETE(_request: Request, context: RouteContext) {
  const [{ id }, { supabase, user }] = await Promise.all([context.params, authenticatedClient()]);
  if (!user) return NextResponse.json({ message: "Sign in required." }, { status: 401 });
  const { data: messages } = await supabase
    .from("chat_messages")
    .select("attachments")
    .eq("thread_id", id);
  const storedAttachments = (messages ?? [])
    .flatMap((message) => parseStoredAttachments(message.attachments));
  const { error } = await supabase.from("chat_threads").delete().eq("id", id);
  if (error) return NextResponse.json({ message: "Conversation could not be deleted." }, { status: 400 });
  const byBucket = new Map<string, string[]>();
  for (const attachment of storedAttachments) {
    const bucket = bucketForStoredAttachment(attachment);
    byBucket.set(bucket, [...(byBucket.get(bucket) ?? []), attachment.storagePath]);
  }
  await Promise.all([...byBucket].map(([bucket, paths]) =>
    supabase.storage.from(bucket).remove([...new Set(paths)])));
  return NextResponse.json({ ok: true });
}
