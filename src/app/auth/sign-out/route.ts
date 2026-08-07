import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requestOrigin } from "@/lib/security";

async function signOut(request: Request) {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut({ scope: "local" });
  return NextResponse.redirect(requestOrigin(request), { status: 303 });
}

export const GET = signOut;
export const POST = signOut;

