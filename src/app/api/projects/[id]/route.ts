import { NextResponse } from "next/server";
import { normalizeProjectName } from "@/lib/chat-projects";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type RouteContext = { params: Promise<{ id: string }> };

async function authenticatedClient() {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.getUser();
  return { supabase, user: data.user && !data.user.is_anonymous ? data.user : null };
}

export async function PATCH(request: Request, context: RouteContext) {
  const [{ id }, { supabase, user }] = await Promise.all([context.params, authenticatedClient()]);
  if (!user) return NextResponse.json({ message: "Sign in required." }, { status: 401 });
  const body = (await request.json().catch(() => null)) as { name?: unknown } | null;
  const name = normalizeProjectName(body?.name);
  if (!name) return NextResponse.json({ message: "A project name is required." }, { status: 400 });
  const { data, error } = await supabase
    .from("chat_projects")
    .update({ name })
    .eq("id", id)
    .select("id")
    .maybeSingle();
  if (error) return NextResponse.json({ message: "Project could not be renamed." }, { status: 400 });
  if (!data) return NextResponse.json({ message: "Project not found." }, { status: 404 });
  return NextResponse.json({ ok: true, name });
}

export async function DELETE(_request: Request, context: RouteContext) {
  const [{ id }, { supabase, user }] = await Promise.all([context.params, authenticatedClient()]);
  if (!user) return NextResponse.json({ message: "Sign in required." }, { status: 401 });
  const { data, error } = await supabase
    .from("chat_projects")
    .delete()
    .eq("id", id)
    .select("id")
    .maybeSingle();
  if (error) return NextResponse.json({ message: "Project could not be deleted." }, { status: 400 });
  if (!data) return NextResponse.json({ message: "Project not found." }, { status: 404 });
  return NextResponse.json({ ok: true });
}
