import type { Metadata } from "next";
import { cookies } from "next/headers";
import { WidgetChat } from "@/components/widget-chat";
import {
  decodeGuestUsage,
  GUEST_USAGE_COOKIE,
  remainingGuestMessages,
} from "@/lib/auth/guest-usage";
import { loadViewer } from "@/lib/auth/viewer";

type WidgetPageProps = {
  searchParams: Promise<{ theme?: string | string[] }>;
};

export const metadata: Metadata = {
  title: "Busted Minds AI widget",
  robots: { index: false, follow: false },
};

export default async function WidgetPage({ searchParams }: WidgetPageProps) {
  const [viewer, cookieStore, params] = await Promise.all([loadViewer(), cookies(), searchParams]);
  const used = decodeGuestUsage(cookieStore.get(GUEST_USAGE_COOKIE)?.value);
  const initialRemaining = viewer.authenticated ? null : remainingGuestMessages(used);
  const requestedTheme = Array.isArray(params.theme) ? params.theme[0] : params.theme;
  const theme = requestedTheme === "light" ? "light" : "dark";

  return <WidgetChat initialViewer={viewer} initialRemaining={initialRemaining} theme={theme} />;
}
