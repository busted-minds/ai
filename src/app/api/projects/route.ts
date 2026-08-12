import { NextResponse } from "next/server";
import { listProjects } from "@/lib/chat-data";
import { normalizeProjectName } from "@/lib/chat-projects";
import { createSupabaseServerClient } from "@/lib/supabase/server";

async function authenticatedClient() {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.getUser();
  return { supabase, user: data.user && !data.user.is_anonymous ? data.user : null };
}

export async function GET() {
  const { supabase, user } = await authenticatedClient();
  if (!user) return NextResponse.json({ message: "Sign in required." }, { status: 401 });
  try {
    return NextResponse.json({ projects: await listProjects(supabase) });
  } catch {
    return NextResponse.json({ message: "Projects are unavailable." }, { status: 503 });
  }
}

export async function POST(request: Request) {
  const { supabase, user } = await authenticatedClient();
  if (!user) return NextResponse.json({ message: "Sign in required." }, { status: 401 });
  const body = (await request.json().catch(() => null)) as { name?: unknown } | null;
  const name = normalizeProjectName(body?.name);
  if (!name) return NextResponse.json({ message: "A project name is required." }, { status: 400 });
  const { data, error } = await supabase
    .from("chat_projects")
    .insert({ user_id: user.id, name })
    .select("id,name,created_at,updated_at")
    .single();
  if (error || !data) return NextResponse.json({ message: "Project could not be created." }, { status: 400 });
  return NextResponse.json({
    project: {
      id: data.id,
      name: data.name,
      createdAt: data.created_at,
      updatedAt: data.updated_at,
    },
  }, { status: 201 });
}
