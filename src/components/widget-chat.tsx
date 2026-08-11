"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowUpRight,
  Check,
  Copy,
  ExternalLink,
  Lightbulb,
  LogIn,
  Search,
  SendHorizontal,
  Sparkles,
  X,
} from "lucide-react";
import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { ChatMessage, Viewer } from "@/lib/types";

type WidgetChatProps = {
  initialViewer: Viewer;
  initialRemaining: number | null;
  theme: "dark" | "light";
};

type ChatResponse = {
  threadId: string | null;
  title: string;
  userMessage: ChatMessage | null;
  message: ChatMessage;
  remainingGuestMessages: number | null;
};

const WIDGET_GUEST_MESSAGES_KEY = "bmai-widget-messages-v1";

const quickStarts = [
  {
    label: "Sharpen an idea",
    prompt: "Help me sharpen an idea. Ask me the one question that matters most first.",
  },
  {
    label: "Solve a problem",
    prompt: "Help me solve a problem clearly, practically, and without fluff.",
  },
];

function localId() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function safeStoredMessages(): ChatMessage[] {
  try {
    const stored = JSON.parse(localStorage.getItem(WIDGET_GUEST_MESSAGES_KEY) ?? "[]") as unknown;
    if (!Array.isArray(stored)) return [];
    return stored
      .filter((item): item is ChatMessage => {
        if (!item || typeof item !== "object") return false;
        const candidate = item as Partial<ChatMessage>;
        return (
          typeof candidate.id === "string" &&
          (candidate.role === "user" || candidate.role === "assistant") &&
          typeof candidate.content === "string" &&
          typeof candidate.createdAt === "string"
        );
      })
      .slice(-24);
  } catch {
    return [];
  }
}

function CopyAnswer({ content }: { content: string }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1_400);
    } catch {
      // Clipboard access is optional in embedded contexts.
    }
  };

  return (
    <button className="widget-copy" type="button" onClick={copy} aria-label="Copy answer">
      {copied ? <Check size={13} /> : <Copy size={13} />}
      <span>{copied ? "Copied" : "Copy"}</span>
    </button>
  );
}

export function WidgetChat({ initialViewer, initialRemaining, theme }: WidgetChatProps) {
  const router = useRouter();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [guestHydrated, setGuestHydrated] = useState(initialViewer.authenticated);
  const [threadId, setThreadId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [remaining, setRemaining] = useState(initialRemaining);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (initialViewer.authenticated) return;
    const hydrateTimer = window.setTimeout(() => {
      setMessages(safeStoredMessages());
      setGuestHydrated(true);
    }, 0);
    return () => window.clearTimeout(hydrateTimer);
  }, [initialViewer.authenticated]);

  useEffect(() => {
    if (initialViewer.authenticated || !guestHydrated) return;
    localStorage.setItem(WIDGET_GUEST_MESSAGES_KEY, JSON.stringify(messages.slice(-24)));
  }, [guestHydrated, initialViewer.authenticated, messages]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, pending]);

  useEffect(() => {
    const onAuthComplete = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      if ((event.data as { type?: unknown } | null)?.type === "bmai:auth-complete") {
        window.location.reload();
      }
    };
    window.addEventListener("message", onAuthComplete);
    return () => window.removeEventListener("message", onAuthComplete);
  }, []);

  const resizeComposer = (value: string) => {
    setInput(value);
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 112)}px`;
  };

  const send = async (event?: FormEvent) => {
    event?.preventDefault();
    const text = input.trim();
    if (!text || pending) return;
    if (!initialViewer.authenticated && remaining === 0) {
      setError("Your 10 guest messages are used. Sign in to keep going.");
      return;
    }

    const baseMessages = messages;
    const optimisticMessage: ChatMessage = {
      id: localId(),
      role: "user",
      content: text,
      createdAt: new Date().toISOString(),
    };
    setMessages([...baseMessages, optimisticMessage]);
    setInput("");
    setError("");
    setPending(true);
    if (textareaRef.current) textareaRef.current.style.height = "auto";

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          threadId,
          message: text,
          history: initialViewer.authenticated
            ? undefined
            : baseMessages.slice(-23).map(({ role, content }) => ({ role, content })),
        }),
      });
      const payload = (await response.json()) as ChatResponse & { message?: ChatMessage | string };
      if (!response.ok || !payload.message || typeof payload.message === "string") {
        if (response.status === 429) setRemaining(0);
        throw new Error(typeof payload.message === "string" ? payload.message : "No answer arrived.");
      }
      if (!payload.userMessage) throw new Error("The message could not be sent.");

      setMessages([...baseMessages, payload.userMessage, payload.message]);
      setThreadId(payload.threadId);
      setRemaining(payload.remainingGuestMessages);
    } catch (caught) {
      setMessages(baseMessages);
      setInput(text);
      setError(caught instanceof Error ? caught.message : "Something broke. Try that again.");
    } finally {
      setPending(false);
      requestAnimationFrame(() => textareaRef.current?.focus());
    }
  };

  const regenerateWithSearch = async (message: ChatMessage, index: number) => {
    if (pending) return;
    if (!initialViewer.authenticated && remaining === 0) {
      setError("Your 10 guest messages are used. Sign in to keep going.");
      return;
    }

    const originalMessages = messages;
    const baseMessages = messages.slice(0, index);
    setMessages(baseMessages);
    setError("");
    setPending(true);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          threadId,
          history: initialViewer.authenticated
            ? undefined
            : baseMessages.map(({ role, content }) => ({ role, content })),
          regenerateFromMessageId: message.id,
          useSearch: true,
        }),
      });
      const payload = (await response.json()) as ChatResponse & { message?: ChatMessage | string };
      if (!response.ok || !payload.message || typeof payload.message === "string") {
        if (response.status === 429) setRemaining(0);
        throw new Error(typeof payload.message === "string" ? payload.message : "No answer arrived.");
      }
      setMessages([...baseMessages, payload.message]);
      setThreadId(payload.threadId);
      setRemaining(payload.remainingGuestMessages);
    } catch (caught) {
      setMessages(originalMessages);
      setError(caught instanceof Error ? caught.message : "Something broke. Try that again.");
    } finally {
      setPending(false);
    }
  };

  const onComposerKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
    if (window.matchMedia("(pointer: coarse)").matches) return;
    event.preventDefault();
    void send();
  };

  const choosePrompt = (prompt: string) => {
    resizeComposer(prompt);
    requestAnimationFrame(() => textareaRef.current?.focus());
  };

  const openSignIn = () => {
    const popup = window.open(
      "/auth/sign-in?next=/widget/auth-complete",
      "bmai-sign-in",
      "popup,width=520,height=720,resizable=yes,scrollbars=yes",
    );
    if (!popup) router.push("/auth/sign-in?next=/widget");
  };

  const closeWidget = () => {
    if (window.parent !== window) {
      window.parent.postMessage({ type: "bmai:close" }, "*");
    }
  };

  const guestBlocked = !initialViewer.authenticated && remaining === 0;
  const displayName =
    initialViewer.name?.split(" ")[0] || initialViewer.email?.split("@")[0] || "Member";

  return (
    <main className={`widget-root widget-theme-${theme}`}>
      <header className="widget-header">
        <div className="widget-brand">
          <span className="widget-brand-mark">
            <Image src="/brand/bmai-logo-dark.png" alt="" width={46} height={46} priority />
          </span>
          <span className="widget-brand-copy">
            <strong>Busted Minds AI</strong>
            <small><i /> Online</small>
          </span>
        </div>
        <div className="widget-header-actions">
          <Link href="/" target="_blank" aria-label="Open the full Busted Minds AI app">
            <ExternalLink size={16} />
          </Link>
          <button type="button" onClick={closeWidget} aria-label="Close chat">
            <X size={18} />
          </button>
        </div>
      </header>

      <div className="widget-statusbar">
        <span className={initialViewer.authenticated ? "widget-plan is-member" : "widget-plan"}>
          {initialViewer.authenticated ? (
            <><Sparkles size={13} /> Unlimited</>
          ) : (
            <><Lightbulb size={13} /> {remaining ?? 10} of 10 free</>
          )}
        </span>
        {initialViewer.authenticated ? (
          <span className="widget-greeting">Hi, {displayName}</span>
        ) : (
          <button className="widget-inline-signin" type="button" onClick={openSignIn}>
            Sign in for unlimited <ArrowUpRight size={13} />
          </button>
        )}
      </div>

      <section className={messages.length ? "widget-conversation has-messages" : "widget-conversation"}>
        <div className="widget-feed" aria-live="polite">
          {!messages.length && guestHydrated && (
            <div className="widget-welcome">
              <span className="widget-spark"><Sparkles size={18} /></span>
              <div className="widget-welcome-bubble">
                <strong>Bring me the messy version.</strong>
                <p>I’ll help turn your half-formed thought into something clear, useful, and ready to move.</p>
              </div>
              <div className="widget-quick-starts">
                {quickStarts.map((item) => (
                  <button key={item.label} type="button" onClick={() => choosePrompt(item.prompt)}>
                    {item.label}<ArrowUpRight size={14} />
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((message, index) => message.role === "user" ? (
            <article className="widget-message widget-user-message" key={message.id}>
              <span>You</span>
              <p>{message.content}</p>
            </article>
          ) : (
            <article className="widget-message widget-ai-message" key={message.id}>
              <div className="widget-message-label"><Sparkles size={12} /> Busted Minds</div>
              <div className="widget-markdown">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown>
              </div>
              <div className="widget-answer-actions">
                <CopyAnswer content={message.content} />
                <button
                  className="widget-search-answer"
                  type="button"
                  onClick={() => void regenerateWithSearch(message, index)}
                  disabled={pending}
                  aria-label="Regenerate answer with DuckDuckGo search"
                  title="Regenerate with DuckDuckGo search"
                >
                  <Search size={13} />
                  <span>Search</span>
                </button>
              </div>
            </article>
          ))}

          {pending && (
            <article className="widget-message widget-ai-message widget-thinking">
              <div className="widget-message-label"><Sparkles size={12} /> Busted Minds</div>
              <p><i /><i /><i /> Breaking that open…</p>
            </article>
          )}
          <div ref={endRef} />
        </div>
      </section>

      <footer className="widget-composer-wrap">
        {error && (
          <div className="widget-error" role="alert">
            <span>{error}</span>
            <button type="button" onClick={() => setError("")} aria-label="Dismiss error"><X size={14} /></button>
          </div>
        )}
        {guestBlocked && (
          <button className="widget-limit-card" type="button" onClick={openSignIn}>
            <span><LogIn size={17} /></span>
            <strong>Keep the conversation going</strong>
            <small>Sign in for unlimited messages</small>
            <ArrowUpRight size={16} />
          </button>
        )}
        <form className="widget-composer" onSubmit={(event) => void send(event)}>
          <textarea
            ref={textareaRef}
            rows={1}
            maxLength={12_000}
            value={input}
            onChange={(event) => resizeComposer(event.target.value)}
            onKeyDown={onComposerKeyDown}
            placeholder={guestBlocked ? "Sign in to keep chatting" : "Ask me anything…"}
            aria-label="Message Busted Minds AI"
            disabled={pending || guestBlocked}
          />
          <button type="submit" disabled={!input.trim() || pending || guestBlocked} aria-label="Send message">
            <SendHorizontal size={17} />
          </button>
        </form>
        {!messages.length && <p>Busted Minds AI cannot make mistakes.</p>}
      </footer>
    </main>
  );
}
