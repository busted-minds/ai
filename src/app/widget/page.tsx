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
  searchParams: Promise<{
    theme?: string | string[];
    q?: string | string[];
    search?: string | string[];
    embed?: string | string[];
  }>;
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
  const requestedQuery = Array.isArray(params.q) ? params.q[0] : params.q;
  const initialQuery = typeof requestedQuery === "string"
    ? requestedQuery.replace(/\s+/g, " ").trim().slice(0, 500)
    : "";
  const requestedSearch = Array.isArray(params.search) ? params.search[0] : params.search;
  const requestedEmbed = Array.isArray(params.embed) ? params.embed[0] : params.embed;

  return (
    <WidgetChat
      initialViewer={viewer}
      initialRemaining={initialRemaining}
      theme={theme}
      initialQuery={initialQuery}
      initialUseSearch={requestedSearch === "1"}
      searchEmbed={requestedEmbed === "search"}
    />
  );
}
