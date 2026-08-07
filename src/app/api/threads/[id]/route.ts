import { NextResponse } from "next/server";
import { loadThreadMessages } from "@/lib/chat-data";
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
    .select("id,title,updated_at")
    .eq("id", id)
    .maybeSingle();
  if (!thread) return NextResponse.json({ message: "Conversation not found." }, { status: 404 });
  try {
    const messages = await loadThreadMessages(supabase, id);
    return NextResponse.json({
      thread: { id: thread.id, title: thread.title, updatedAt: thread.updated_at, messages },
    });
  } catch {
    return NextResponse.json({ message: "Conversation could not be loaded." }, { status: 503 });
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  const [{ id }, { supabase, user }] = await Promise.all([context.params, authenticatedClient()]);
  if (!user) return NextResponse.json({ message: "Sign in required." }, { status: 401 });
  const body = (await request.json().catch(() => null)) as { title?: unknown } | null;
  const title = typeof body?.title === "string" ? body.title.replace(/\s+/g, " ").trim().slice(0, 80) : "";
  if (!title) return NextResponse.json({ message: "A title is required." }, { status: 400 });
  const { error } = await supabase.from("chat_threads").update({ title }).eq("id", id);
  if (error) return NextResponse.json({ message: "Conversation could not be renamed." }, { status: 400 });
  return NextResponse.json({ ok: true, title });
}

export async function DELETE(_request: Request, context: RouteContext) {
  const [{ id }, { supabase, user }] = await Promise.all([context.params, authenticatedClient()]);
  if (!user) return NextResponse.json({ message: "Sign in required." }, { status: 401 });
  const { error } = await supabase.from("chat_threads").delete().eq("id", id);
  if (error) return NextResponse.json({ message: "Conversation could not be deleted." }, { status: 400 });
  return NextResponse.json({ ok: true });
}

