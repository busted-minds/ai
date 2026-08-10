"use client";

import Link from "next/link";
import Image from "next/image";
import {
  ArrowUpRight,
  Check,
  Code2,
  Compass,
  Copy,
  Lightbulb,
  LogIn,
  Menu,
  MessageSquareText,
  Moon,
  Pencil,
  RefreshCw,
  Search,
  SendHorizontal,
  SquarePen,
  Sun,
  Trash2,
  UserRound,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { BrandMark } from "./brand-mark";
import { BustedBulbMark } from "./busted-bulb-mark";
import type { ChatMessage, ChatThread, Viewer } from "@/lib/types";

type ChatShellProps = { initialViewer: Viewer };
type ChatResponse = {
  threadId: string | null;
  title: string;
  userMessage: ChatMessage | null;
  message: ChatMessage;
  remainingGuestMessages: number | null;
};

const GUEST_THREADS_KEY = "bmai-guest-threads-v1";

const starterPrompts = [
  {
    icon: Lightbulb,
    eyebrow: "Think",
    title: "Untangle a hard idea",
    prompt: "Explain a difficult concept to me with one sharp analogy and no fluff.",
  },
  {
    icon: Code2,
    eyebrow: "Build",
    title: "Ship better code",
    prompt: "Help me design a clean, production-ready approach for the software problem I describe next.",
  },
  {
    icon: Compass,
    eyebrow: "Decide",
    title: "Challenge my plan",
    prompt: "Act as a brutally honest strategist. Stress-test my plan and tell me what I am missing.",
  },
];

function safeGuestThreads(): ChatThread[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(GUEST_THREADS_KEY) ?? "[]") as unknown;
    return Array.isArray(parsed) ? (parsed as ChatThread[]).slice(0, 20) : [];
  } catch {
    return [];
  }
}

function writeGuestThreads(threads: ChatThread[]) {
  localStorage.setItem(GUEST_THREADS_KEY, JSON.stringify(threads.slice(0, 20)));
}

function localId() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function shortGreeting() {
  const hour = new Date().getHours();
  if (hour < 12) return "Morning";
  if (hour < 18) return "Afternoon";
  return "Evening";
}

function CopyMessageAction({ content, label }: { content: string; label: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(content);
    } catch {
      return;
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1_500);
  };
  return (
    <button className="message-action" type="button" onClick={copy} aria-label={label}>
      {copied ? <Check size={15} /> : <Copy size={15} />}
    </button>
  );
}

function MarkdownMessage({ content, disabled, onRegenerate }: { content: string; disabled: boolean; onRegenerate: () => void }) {
  return (
    <div className="assistant-response">
      <div className="markdown">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
      </div>
      <div className="message-actions">
        <CopyMessageAction content={content} label="Copy answer" />
        <button className="message-action" type="button" onClick={onRegenerate} disabled={disabled} aria-label="Regenerate answer">
          <RefreshCw size={15} />
        </button>
      </div>
    </div>
  );
}

export function ChatShell({ initialViewer }: ChatShellProps) {
  const [viewer] = useState(initialViewer);
  const [threads, setThreads] = useState<ChatThread[]>([]);
  const [currentThreadId, setCurrentThreadId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(viewer.authenticated);
  const [remaining, setRemaining] = useState<number | null>(viewer.authenticated ? null : 10);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editInput, setEditInput] = useState("");
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const endRef = useRef<HTMLDivElement>(null);

  const updateThreads = useCallback((updater: (current: ChatThread[]) => ChatThread[]) => {
    setThreads((current) => {
      const next = updater(current);
      if (!viewer.authenticated) writeGuestThreads(next);
      return next;
    });
  }, [viewer.authenticated]);

  useEffect(() => {
    if (!viewer.authenticated) {
      const guestHistoryTimer = window.setTimeout(() => setThreads(safeGuestThreads()), 0);
      void fetch("/api/session", { cache: "no-store" })
        .then((response) => response.json())
        .then((payload: { remainingGuestMessages?: number }) => {
          if (typeof payload.remainingGuestMessages === "number") setRemaining(payload.remainingGuestMessages);
        })
        .catch(() => undefined);
      return () => window.clearTimeout(guestHistoryTimer);
    } else {
      void fetch("/api/threads", { cache: "no-store" })
        .then((response) => response.ok ? response.json() : Promise.reject())
        .then((payload: { threads?: ChatThread[] }) => setThreads(payload.threads ?? []))
        .catch(() => setError("History is being stubborn. Your next message can still work."))
        .finally(() => setHistoryLoading(false));
    }
  }, [viewer.authenticated]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, pending]);

  const filteredThreads = useMemo(() => {
    const query = search.trim().toLowerCase();
    return query ? threads.filter((thread) => thread.title.toLowerCase().includes(query)) : threads;
  }, [search, threads]);

  const currentThread = threads.find((thread) => thread.id === currentThreadId) ?? null;

  const newChat = () => {
    setCurrentThreadId(null);
    setMessages([]);
    setInput("");
    setError("");
    setEditingMessageId(null);
    setEditInput("");
    setSidebarOpen(false);
    requestAnimationFrame(() => composerRef.current?.focus());
  };

  const selectThread = async (thread: ChatThread) => {
    setCurrentThreadId(thread.id);
    setSidebarOpen(false);
    setError("");
    setEditingMessageId(null);
    if (!viewer.authenticated) {
      setMessages(thread.messages ?? []);
      return;
    }
    setHistoryLoading(true);
    try {
      const response = await fetch(`/api/threads/${thread.id}`, { cache: "no-store" });
      const payload = await response.json() as { thread?: ChatThread; message?: string };
      if (!response.ok || !payload.thread) throw new Error(payload.message ?? "Conversation could not be loaded.");
      setMessages(payload.thread.messages ?? []);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Conversation could not be loaded.");
    } finally {
      setHistoryLoading(false);
    }
  };

  const deleteThread = async (threadId: string) => {
    if (viewer.authenticated) {
      const response = await fetch(`/api/threads/${threadId}`, { method: "DELETE" });
      if (!response.ok) return setError("That thread refused to disappear. Dramatic.");
    }
    updateThreads((current) => current.filter((thread) => thread.id !== threadId));
    if (currentThreadId === threadId) newChat();
  };

  const requestAnswer = async ({
    text,
    baseMessages,
    replaceFromMessageId,
    regenerateFromMessageId,
  }: {
    text: string;
    baseMessages: ChatMessage[];
    replaceFromMessageId?: string;
    regenerateFromMessageId?: string;
  }) => {
    const trimmedText = text.trim();
    if ((!trimmedText && !regenerateFromMessageId) || pending) return false;
    if (!viewer.authenticated && remaining === 0) {
      setError("Guest brainpower exhausted. Sign in for unlimited conversations.");
      return false;
    }

    const originalMessages = messages;
    const optimisticUserMessage: ChatMessage | null = regenerateFromMessageId ? null : {
      id: localId(), role: "user", content: trimmedText, createdAt: new Date().toISOString(),
    };
    setMessages([...baseMessages, ...(optimisticUserMessage ? [optimisticUserMessage] : [])]);
    setError("");
    setPending(true);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          threadId: currentThreadId,
          message: trimmedText || undefined,
          history: viewer.authenticated ? undefined : baseMessages.map(({ role, content }) => ({ role, content })),
          replaceFromMessageId,
          regenerateFromMessageId,
        }),
      });
      const payload = await response.json() as ChatResponse & { message?: ChatMessage | string };
      if (!response.ok || !payload.message || typeof payload.message === "string") {
        throw new Error(typeof payload.message === "string" ? payload.message : "No answer arrived.");
      }

      if (!regenerateFromMessageId && !payload.userMessage) throw new Error("The sent message could not be saved.");
      const nextMessages = [
        ...baseMessages,
        ...(payload.userMessage ? [payload.userMessage] : []),
        payload.message,
      ];
      setMessages(nextMessages);
      setRemaining(payload.remainingGuestMessages);
      const resolvedId = payload.threadId ?? currentThreadId ?? localId();
      setCurrentThreadId(resolvedId);
      updateThreads((current) => {
        const existing = current.find((thread) => thread.id === resolvedId);
        const editedFirstMessage = Boolean(replaceFromMessageId && baseMessages.length === 0);
        const updated: ChatThread = {
          id: resolvedId,
          title: editedFirstMessage ? payload.title : existing?.title ?? payload.title,
          updatedAt: new Date().toISOString(),
          messages: viewer.authenticated ? undefined : nextMessages,
        };
        return [updated, ...current.filter((thread) => thread.id !== resolvedId)];
      });
      return true;
    } catch (caught) {
      setMessages(originalMessages);
      setError(caught instanceof Error ? caught.message : "Something broke. Even genius has infrastructure.");
      return false;
    } finally {
      setPending(false);
    }
  };

  const send = async (event?: FormEvent) => {
    event?.preventDefault();
    const text = input.trim();
    if (!text || pending) return;
    setInput("");
    if (composerRef.current) composerRef.current.style.height = "auto";
    const sent = await requestAnswer({ text, baseMessages: messages });
    if (!sent) setInput(text);
  };

  const beginEdit = (message: ChatMessage) => {
    if (pending) return;
    setEditingMessageId(message.id);
    setEditInput(message.content);
    setError("");
  };

  const saveEdit = async (message: ChatMessage, index: number) => {
    const text = editInput.trim();
    if (!text || text === message.content || pending) return;
    const sent = await requestAnswer({
      text,
      baseMessages: messages.slice(0, index),
      replaceFromMessageId: message.id,
    });
    if (sent) {
      setEditingMessageId(null);
      setEditInput("");
    }
  };

  const regenerate = async (message: ChatMessage, index: number) => {
    if (pending) return;
    setEditingMessageId(null);
    await requestAnswer({
      text: "",
      baseMessages: messages.slice(0, index),
      regenerateFromMessageId: message.id,
    });
  };

  const onComposerKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;

    const isMobile = window.matchMedia("(max-width: 640px), (pointer: coarse)").matches;
    if (isMobile) return;

    event.preventDefault();
    void send();
  };

  const resizeComposer = (value: string) => {
    setInput(value);
    const textarea = composerRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 180)}px`;
  };

  const toggleTheme = () => {
    const next = document.documentElement.dataset.theme === "light" ? "dark" : "light";
    document.documentElement.dataset.theme = next;
    localStorage.setItem("bmai-theme", next);
  };

  const displayName = viewer.name?.split(" ")[0] || viewer.email?.split("@")[0] || "sharp mind";

  return (
    <main className="app-shell">
      <div className={sidebarOpen ? "sidebar-backdrop is-open" : "sidebar-backdrop"} onClick={() => setSidebarOpen(false)} aria-hidden />
      <aside className={sidebarOpen ? "sidebar is-open" : "sidebar"}>
        <div className="sidebar-head">
          <BrandMark priority />
          <button className="mobile-close icon-button" type="button" onClick={() => setSidebarOpen(false)} aria-label="Close conversations">
            <X size={19} />
          </button>
        </div>
        <button className="new-chat-button" type="button" onClick={newChat}>
          <SquarePen size={18} /> New conversation <span>⌘ K</span>
        </button>
        <label className="thread-search">
          <Search size={16} aria-hidden />
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search conversations" aria-label="Search conversations" />
        </label>

        <div className="thread-list">
          <p className="section-label">Your conversations</p>
          {historyLoading && threads.length === 0 ? (
            <div className="thread-skeletons"><span /><span /><span /></div>
          ) : filteredThreads.length ? filteredThreads.map((thread) => (
            <div className={thread.id === currentThreadId ? "thread-row active" : "thread-row"} key={thread.id}>
              <button type="button" onClick={() => void selectThread(thread)}>
                <MessageSquareText size={15} /> <span>{thread.title}</span>
              </button>
              <button className="thread-delete" type="button" onClick={() => void deleteThread(thread.id)} aria-label={`Delete ${thread.title}`}>
                <Trash2 size={14} />
              </button>
            </div>
          )) : (
            <div className="empty-threads">
              <BustedBulbMark size={17} />
              <p>{search ? "No thread matches that." : "Your next dangerous idea starts here."}</p>
            </div>
          )}
        </div>

        {!viewer.authenticated && (
          <div className="sidebar-upgrade">
            <span className="upgrade-orbit"><BustedBulbMark size={18} /></span>
            <strong>Keep the good stuff.</strong>
            <p>Sign in for unlimited messages and history on every device.</p>
            <Link href="/auth/sign-in"><LogIn size={16} /> Sign in</Link>
          </div>
        )}
        <a className="powered-by" href="https://bustedminds.us.kg/" target="_blank" rel="noreferrer">
          <span>Powered by</span>
          <Image src="/brand/busted-minds.webp" alt="Busted Minds" width={88} height={40} />
        </a>
        <div className="sidebar-foot">
          <Link href={viewer.authenticated ? "/account" : "/auth/sign-in"} className="account-link">
            <span className="avatar"><UserRound size={17} /></span>
            <span><strong>{viewer.authenticated ? displayName : "Guest mind"}</strong><small>{viewer.authenticated ? (viewer.username ? `@${viewer.username}` : "Busted Minds Account") : `${remaining ?? 10} messages left`}</small></span>
            <ArrowUpRight size={15} />
          </Link>
          <button type="button" className="theme-button" onClick={toggleTheme} aria-label="Toggle color theme">
            <Sun className="theme-sun" size={17} /><Moon className="theme-moon" size={17} />
          </button>
        </div>
      </aside>

      <section className="chat-stage">
        <header className="topbar">
          <button className="icon-button menu-button" type="button" onClick={() => setSidebarOpen(true)} aria-label="Open conversations"><Menu size={20} /></button>
          <BrandMark compact />
          <div className="thread-heading">
            <strong>{currentThread?.title ?? "New conversation"}</strong>
            <small><span /> Ready to think</small>
          </div>
          <div className="topbar-actions">
            {!viewer.authenticated && <span className="message-meter"><BustedBulbMark size={15} /> {remaining ?? 10} free</span>}
            <button className="desktop-theme icon-button" type="button" onClick={toggleTheme} aria-label="Toggle theme">
              <Sun className="theme-sun" size={18} /><Moon className="theme-moon" size={18} />
            </button>
            {viewer.authenticated ? (
              <Link href="/account" className="top-account"><UserRound size={17} /><span>{viewer.username ? `@${viewer.username}` : displayName}</span></Link>
            ) : (
              <Link href="/auth/sign-in" className="top-signin"><span>Sign in</span><ArrowUpRight size={16} /></Link>
            )}
          </div>
        </header>

        <div className={messages.length ? "conversation has-messages" : "conversation"}>
          {!messages.length && !historyLoading ? (
            <section className="welcome">
              <div className="welcome-sigil"><BustedBulbMark size={34} /></div>
              <p className="eyebrow">Good {shortGreeting()}</p>
              <h1>What are we <em>breaking open</em> today?</h1>
              <p className="welcome-copy">
                Bring the mess. I’ll bring the brains, the nerve, and a frankly unreasonable amount of confidence.
              </p>
              <div className="starter-grid">
                {starterPrompts.map(({ icon: Icon, eyebrow, title, prompt }) => (
                  <button key={title} type="button" onClick={() => { setInput(prompt); requestAnimationFrame(() => composerRef.current?.focus()); }}>
                    <span className="starter-icon"><Icon size={18} /></span>
                    <small>{eyebrow}</small>
                    <strong>{title}</strong>
                    <ArrowUpRight size={17} />
                  </button>
                ))}
              </div>
            </section>
          ) : (
            <div className="message-stream">
              {messages.map((message, index) => message.role === "user" ? (
                <article className="message user-message" key={message.id}>
                  <div className="user-message-content">
                    {editingMessageId === message.id ? (
                      <div className="message-editor">
                        <textarea
                          value={editInput}
                          onChange={(event) => setEditInput(event.target.value)}
                          maxLength={12_000}
                          rows={3}
                          aria-label="Edit your message"
                          autoFocus
                        />
                        <div>
                          <button type="button" onClick={() => setEditingMessageId(null)}>Cancel</button>
                          <button type="button" onClick={() => void saveEdit(message, index)} disabled={!editInput.trim() || editInput.trim() === message.content || pending}>
                            <SendHorizontal size={14} /> Save & resend
                          </button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <p>{message.content}</p>
                        <div className="message-actions user-message-actions">
                          <CopyMessageAction content={message.content} label="Copy your message" />
                          <button className="message-action" type="button" onClick={() => beginEdit(message)} disabled={pending} aria-label="Edit and resend message">
                            <Pencil size={14} />
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                </article>
              ) : (
                <article className="message assistant-message" key={message.id}>
                  <div><MarkdownMessage content={message.content} disabled={pending} onRegenerate={() => void regenerate(message, index)} /></div>
                </article>
              ))}
              {pending && (
                <article className="message assistant-message thinking-message">
                  <div><p><i /><i /><i /> Thinking harder than strictly necessary</p></div>
                </article>
              )}
              <div ref={endRef} />
            </div>
          )}

          <div className="composer-dock">
            {error && (
              <div className="composer-error" role="alert">
                <span>{error}</span>
                {!viewer.authenticated && remaining === 0 && <Link href="/auth/sign-in">Sign in now <ArrowUpRight size={14} /></Link>}
                <button type="button" onClick={() => setError("")} aria-label="Dismiss"><X size={15} /></button>
              </div>
            )}
            <form className="composer" onSubmit={(event) => void send(event)}>
              <textarea
                ref={composerRef}
                rows={1}
                value={input}
                maxLength={12_000}
                onChange={(event) => resizeComposer(event.target.value)}
                onKeyDown={onComposerKeyDown}
                placeholder="Ask anything. I can take it."
                aria-label="Message Busted Minds AI"
                disabled={pending || (!viewer.authenticated && remaining === 0)}
              />
              <div className="composer-bottom">
                <span>{input.length > 10_000 ? `${input.length.toLocaleString()} / 12,000` : "Shift + Enter for a new line"}</span>
                <button type="submit" disabled={!input.trim() || pending || (!viewer.authenticated && remaining === 0)} aria-label="Send message">
                  <SendHorizontal size={19} />
                </button>
              </div>
            </form>
            <p className="fine-print">
              Busted Minds AI cannot make mistakes.
            </p>
          </div>
        </div>
      </section>
    </main>
  );
}
