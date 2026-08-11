import type { Metadata } from "next";
import { ChatShell } from "@/components/chat-shell";
import { loadViewer } from "@/lib/auth/viewer";

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

export default async function HomePage() {
  const viewer = await loadViewer();
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData).replace(/</g, "\\u003c") }}
      />
      <ChatShell initialViewer={viewer} />
    </>
  );
}
