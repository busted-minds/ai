import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getSupabasePublicConfig } from "@/lib/supabase/config";

function applySecurityHeaders(
  response: NextResponse,
  pathname: string,
  sameOriginPreview = false,
) {
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");

  if (pathname === "/widget") {
    // This route is intentionally public and embeddable, including from local
    // file:// prototypes whose opaque origins do not reliably match `*`.
    response.headers.delete("X-Frame-Options");
    response.headers.delete("Content-Security-Policy");
  } else if (sameOriginPreview) {
    response.headers.set("X-Frame-Options", "SAMEORIGIN");
    response.headers.set("Content-Security-Policy", "frame-ancestors 'self'");
  } else {
    response.headers.set("X-Frame-Options", "DENY");
    response.headers.set("Content-Security-Policy", "frame-ancestors 'none'");
  }
  return response;
}

export async function proxy(request: NextRequest) {
  const sameOriginPreview = request.nextUrl.pathname.startsWith("/api/attachments/")
    && request.nextUrl.searchParams.get("preview") === "1";
  const config = getSupabasePublicConfig();
  if (!config) {
    return applySecurityHeaders(
      NextResponse.next({ request }),
      request.nextUrl.pathname,
      sameOriginPreview,
    );
  }

  let response = NextResponse.next({ request });
  const supabase = createServerClient(config.url, config.publishableKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (cookiesToSet) => {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  await supabase.auth.getUser();
  return applySecurityHeaders(response, request.nextUrl.pathname, sameOriginPreview);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
