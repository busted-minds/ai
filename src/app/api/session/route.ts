import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { loadViewer } from "@/lib/auth/viewer";
import {
  decodeGuestUsage,
  GUEST_USAGE_COOKIE,
  remainingGuestMessages,
} from "@/lib/auth/guest-usage";

export async function GET() {
  const [viewer, cookieStore] = await Promise.all([loadViewer(), cookies()]);
  const used = decodeGuestUsage(cookieStore.get(GUEST_USAGE_COOKIE)?.value);
  return NextResponse.json(
    { viewer, remainingGuestMessages: viewer.authenticated ? null : remainingGuestMessages(used) },
    { headers: { "Cache-Control": "no-store" } },
  );
}

