import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requestOrigin, safeNextPath } from "@/lib/security";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const nextPath = safeNextPath(url.searchParams.get("next"));
  const supabase = await createSupabaseServerClient();
  const redirectTo = `${requestOrigin(request)}/auth/callback?next=${encodeURIComponent(nextPath)}`;
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
  return NextResponse.redirect(data.url);
}

