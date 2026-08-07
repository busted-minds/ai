import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { synchronizeAccountProfile } from "@/lib/auth/viewer";
import { AUTH_NEXT_COOKIE, requestOrigin, safeNextPath } from "@/lib/security";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const cookieStore = await cookies();
  const nextPath = safeNextPath(
    cookieStore.get(AUTH_NEXT_COOKIE)?.value ?? url.searchParams.get("next"),
  );
  cookieStore.delete(AUTH_NEXT_COOKIE);
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
