import { NextResponse } from "next/server";
import { isUuid } from "@/lib/chat-projects";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(_request: Request, context: RouteContext) {
  const [{ id }, supabase] = await Promise.all([
    context.params,
    createSupabaseServerClient(),
  ]);
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user || authData.user.is_anonymous) {
    return NextResponse.json({ message: "Sign in to share conversations." }, { status: 401 });
  }
  if (!isUuid(id)) {
    return NextResponse.json({ message: "Conversation not found." }, { status: 404 });
  }

  const { data, error } = await supabase.rpc("create_chat_share", { p_thread_id: id });
  const token = Array.isArray(data) && typeof data[0]?.share_token === "string"
    ? data[0].share_token
    : null;
  if (error || !token) {
    return NextResponse.json({ message: "Conversation could not be shared." }, { status: 400 });
  }
  return NextResponse.json({ token });
}
