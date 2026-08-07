import { ChatShell } from "@/components/chat-shell";
import { loadViewer } from "@/lib/auth/viewer";

export default async function HomePage() {
  const viewer = await loadViewer();
  return <ChatShell initialViewer={viewer} />;
}

