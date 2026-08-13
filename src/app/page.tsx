import type { Metadata } from "next";
import { ChatShell } from "@/components/chat-shell";
import { loadViewer } from "@/lib/auth/viewer";
import { loadThreadConversation } from "@/lib/chat-data";
import { isUuid } from "@/lib/chat-projects";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { ChatThread } from "@/lib/types";

const siteUrl = "https://ai.bustedminds.us.kg/";
const siteTitle = "Busted Minds AI — AI Chat & Thought Partner";
const siteDescription =
  "Chat with Busted Minds AI for sharp answers, clearer thinking, coding help, research, and honest feedback.";

export const metadata: Metadata = {
  title: { absolute: siteTitle },
  description: siteDescription,
  alternates: { canonical: siteUrl },
};

const structuredData = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Organization",
      "@id": "https://bustedminds.us.kg/#organization",
      name: "Busted Minds",
      url: "https://bustedminds.us.kg/",
    },
    {
      "@type": "WebSite",
      "@id": `${siteUrl}#website`,
      name: "Busted Minds AI",
      alternateName: "BM AI",
      url: siteUrl,
      description: siteDescription,
      publisher: { "@id": "https://bustedminds.us.kg/#organization" },
    },
    {
      "@type": "WebApplication",
      "@id": `${siteUrl}#application`,
      name: "Busted Minds AI",
      alternateName: "BM AI",
      url: siteUrl,
      description: siteDescription,
      applicationCategory: "UtilitiesApplication",
      operatingSystem: "Any",
      browserRequirements: "Requires JavaScript",
      publisher: { "@id": "https://bustedminds.us.kg/#organization" },
      image: `${siteUrl}brand/bmai-og.png`,
    },
  ],
};

type HomePageProps = { searchParams: Promise<{ thread?: string | string[] }> };

export default async function HomePage({ searchParams }: HomePageProps) {
  const [viewer, query] = await Promise.all([loadViewer(), searchParams]);
  const requestedThreadId = typeof query.thread === "string" ? query.thread : null;
  let initialThread: ChatThread | null = null;
  if (viewer.authenticated && requestedThreadId && isUuid(requestedThreadId)) {
    const supabase = await createSupabaseServerClient();
    const { data: thread } = await supabase
      .from("chat_threads")
      .select("id,title,project_id,active_leaf_id,archived,updated_at")
      .eq("id", requestedThreadId)
      .maybeSingle();
    if (thread) {
      try {
        const conversation = await loadThreadConversation(supabase, thread.id, thread.active_leaf_id);
        initialThread = {
          id: thread.id,
          title: thread.title,
          projectId: thread.project_id,
          archived: thread.archived,
          updatedAt: thread.updated_at,
          ...conversation,
        };
      } catch {
        initialThread = null;
      }
    }
  }
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData).replace(/</g, "\\u003c") }}
      />
      <ChatShell initialViewer={viewer} initialThread={initialThread} />
    </>
  );
}
