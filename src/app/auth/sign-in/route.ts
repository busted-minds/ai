import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { AUTH_NEXT_COOKIE, requestOrigin, safeNextPath } from "@/lib/security";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const nextPath = safeNextPath(url.searchParams.get("next"));
  const supabase = await createSupabaseServerClient();
  const redirectTo = `${requestOrigin(request)}/auth/callback`;
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "custom:busted-minds",
    options: {
      redirectTo,
      scopes: "openid email profile",
      skipBrowserRedirect: true,
    },
  });
  if (error || !data.url) {
    return NextResponse.redirect(new URL("/auth/error?reason=unavailable", request.url));
  }
  const cookieStore = await cookies();
  cookieStore.set(AUTH_NEXT_COOKIE, nextPath, {
    httpOnly: true,
    maxAge: 10 * 60,
    path: "/",
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  });
  return NextResponse.redirect(data.url);
}
