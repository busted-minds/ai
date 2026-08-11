import type { Metadata } from "next";
import { ChatShell } from "@/components/chat-shell";
import { loadViewer } from "@/lib/auth/viewer";

export const metadata: Metadata = {
  alternates: { canonical: "https://ai.bustedminds.us.kg/" },
};

export default async function HomePage() {
  const viewer = await loadViewer();
  return <ChatShell initialViewer={viewer} />;
}
