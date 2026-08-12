import { NextResponse } from "next/server";
import { CHAT_SHARE_TOKEN_PATTERN } from "@/lib/chat-sharing";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type RouteContext = { params: Promise<{ token: string }> };

export async function POST(_request: Request, context: RouteContext) {
  const [{ token }, supabase] = await Promise.all([
    context.params,
    createSupabaseServerClient(),
  ]);
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user || authData.user.is_anonymous) {
    return NextResponse.json({ message: "Sign in to continue this conversation." }, { status: 401 });
  }
  if (!CHAT_SHARE_TOKEN_PATTERN.test(token)) {
    return NextResponse.json({ message: "Shared conversation not found." }, { status: 404 });
  }

  const { data, error } = await supabase.rpc("import_shared_chat", { p_token: token });
  if (error || typeof data !== "string") {
    return NextResponse.json({ message: "Shared conversation could not be copied." }, { status: 400 });
  }
  return NextResponse.json({ threadId: data });
}
