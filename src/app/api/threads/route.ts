import { NextResponse } from "next/server";
import { listArchivedThreads, listThreads } from "@/lib/chat-data";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function GET() {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user || data.user.is_anonymous) {
    return NextResponse.json({ message: "Sign in to sync conversation history." }, { status: 401 });
  }
  try {
    const [threads, archivedThreads] = await Promise.all([
      listThreads(supabase),
      listArchivedThreads(supabase),
    ]);
    return NextResponse.json({ threads, archivedThreads });
  } catch {
    return NextResponse.json({ message: "Conversation history is unavailable." }, { status: 503 });
  }
}
