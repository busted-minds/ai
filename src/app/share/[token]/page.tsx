import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ArrowRight, FileText, ImageIcon, LockKeyhole, Share2 } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { BrandMark } from "@/components/brand-mark";
import { ContinueSharedChatButton } from "@/components/shared-chat-actions";
import { loadViewer } from "@/lib/auth/viewer";
import { loadSharedChat } from "@/lib/chat-sharing-server";
import { isSupportedImageMimeType } from "@/lib/image-constants";

type SharedChatPageProps = { params: Promise<{ token: string }> };

export async function generateMetadata({ params }: SharedChatPageProps): Promise<Metadata> {
  const { token } = await params;
  const sharedChat = await loadSharedChat(token);
  if (!sharedChat) return { title: "Shared conversation not found", robots: { index: false, follow: false } };
  return {
    title: sharedChat.title,
    description: "A conversation shared from Busted Minds AI. Continue it in your own private chat.",
    robots: { index: false, follow: false },
  };
}

export default async function SharedChatPage({ params }: SharedChatPageProps) {
  const { token } = await params;
  const [sharedChat, viewer] = await Promise.all([loadSharedChat(token), loadViewer()]);
  if (!sharedChat) notFound();

  const ownerCanOpenOriginal = viewer.authenticated
    && viewer.id === sharedChat.ownerUserId
    && Boolean(sharedChat.sourceThreadId);
  const signInPath = `/auth/sign-in?next=${encodeURIComponent(`/share/${token}`)}`;

  return (
    <main className="shared-chat-page">
      <header className="shared-chat-topbar">
        <Link href="/" className="shared-chat-brand" aria-label="Busted Minds AI home">
          <BrandMark compact />
        </Link>
        <span><Share2 size={15} /> Shared conversation</span>
        <Link href="/" className="shared-chat-back"><ArrowLeft size={16} /> New chat</Link>
      </header>

      <section className="shared-chat-shell">
        <div className="shared-chat-intro">
          <span className="shared-chat-sigil"><Share2 size={22} /></span>
          <p>Shared from Busted Minds AI</p>
          <h1>{sharedChat.title}</h1>
          <div><LockKeyhole size={14} /> Continue with a private copy. Your replies won&apos;t change the original.</div>
        </div>

        <div className="shared-chat-messages">
          {sharedChat.messages.map((message, index) => (
            <article
              className={message.role === "user" ? "shared-chat-message is-user" : "shared-chat-message is-assistant"}
              key={`${message.role}-${index}`}
            >
              <small>{message.role === "user" ? "User" : "Busted Minds AI"}</small>
              {message.content && (
                message.role === "assistant"
                  ? <div className="shared-chat-markdown"><ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown></div>
                  : <p>{message.content}</p>
              )}
              {message.attachments.length > 0 && (
                <ul className="shared-chat-attachments" aria-label="Private attachments">
                  {message.attachments.map((attachment, attachmentIndex) => (
                    <li key={`${attachment.name}-${attachmentIndex}`}>
                      {isSupportedImageMimeType(attachment.mimeType)
                        ? <ImageIcon size={15} />
                        : <FileText size={15} />}
                      <span>{attachment.name}</span>
                      <small>Private</small>
                    </li>
                  ))}
                </ul>
              )}
            </article>
          ))}
        </div>

        <footer className="shared-chat-footer">
          <p>The conversation is copied at the point it was shared. Attachments stay private to their owner.</p>
          {ownerCanOpenOriginal ? (
            <Link className="shared-chat-primary-action" href={`/?thread=${encodeURIComponent(sharedChat.sourceThreadId!)}`}>
              <ArrowRight size={18} /><span>Open my original chat</span>
            </Link>
          ) : viewer.authenticated ? (
            <ContinueSharedChatButton token={token} />
          ) : (
            <Link className="shared-chat-primary-action" href={signInPath}>
              <ArrowRight size={18} /><span>Sign in to continue</span>
            </Link>
          )}
        </footer>
      </section>
    </main>
  );
}
