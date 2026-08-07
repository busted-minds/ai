import { NextResponse } from "next/server";
import { synchronizeAccountProfile } from "@/lib/auth/viewer";
import { requestOrigin, safeNextPath } from "@/lib/security";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const nextPath = safeNextPath(url.searchParams.get("next"));
  if (!code) return NextResponse.redirect(`${requestOrigin(request)}/auth/error?reason=missing-code`);

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);
  if (error || !data.user || data.user.is_anonymous) {
    return NextResponse.redirect(`${requestOrigin(request)}/auth/error?reason=invalid-session`);
  }

  try {
    await synchronizeAccountProfile(data.user);
  } catch {
    await supabase.auth.signOut();
    return NextResponse.redirect(`${requestOrigin(request)}/auth/error?reason=account-link`);
  }
  return NextResponse.redirect(`${requestOrigin(request)}${nextPath}`);
}

