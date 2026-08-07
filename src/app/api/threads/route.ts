import { NextResponse } from "next/server";
import { listThreads } from "@/lib/chat-data";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function GET() {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user || data.user.is_anonymous) {
    return NextResponse.json({ message: "Sign in to sync conversation history." }, { status: 401 });
  }
  try {
    return NextResponse.json({ threads: await listThreads(supabase) });
  } catch {
    return NextResponse.json({ message: "Conversation history is unavailable." }, { status: 503 });
  }
}

