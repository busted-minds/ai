import { NextResponse } from "next/server";
import { safeSearchReturn } from "@/lib/auth/search-return";
import { createSupabaseServerClient } from "@/lib/supabase/server";

async function signOut(request: Request) {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut({ scope: "local" });

  const url = new URL(request.url);
  return NextResponse.redirect(safeSearchReturn(url.searchParams.get("return")), 303);
}

export const GET = signOut;
export const POST = signOut;
