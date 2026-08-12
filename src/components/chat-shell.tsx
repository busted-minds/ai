"use client";

import Link from "next/link";
import Image from "next/image";
import {
  ArrowUpRight,
  BrainCircuit,
  Check,
  ChevronDown,
  Code2,
  Compass,
  Copy,
  Lightbulb,
  LogIn,
  Menu,
  MessageSquareText,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Paperclip,
  Pencil,
  RefreshCw,
  Search,
  Globe,
  SendHorizontal,
  Sparkles,
  SquarePen,
  Sun,
  Trash2,
  UserRound,
  X,
  Zap,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { BrandMark } from "./brand-mark";
import { BustedBulbMark } from "./busted-bulb-mark";
import { ImageAttachments } from "./image-attachments";
import {
  CHAT_MODE_OPTIONS,
  DEFAULT_CHAT_MODE,
  type ChatMode,
} from "@/lib/ai/modes";
import { attachmentPayload, prepareImageAttachments } from "@/lib/client-images";
import { MAX_IMAGE_ATTACHMENTS } from "@/lib/image-constants";
import type { ChatAttachment, ChatMessage, ChatThread, Viewer } from "@/lib/types";

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
    description: "Find the simple truth hiding inside the complicated version.",
    prompt: "Explain a difficult concept to me with one sharp analogy and no fluff.",
  },
  {
    icon: Code2,
    eyebrow: "Build",
    title: "Ship better code",
    description: "Turn a rough technical problem into a production-ready approach.",
    prompt: "Help me design a clean, production-ready approach for the software problem I describe next.",
  },
  {
    icon: Compass,
    eyebrow: "Decide",
    title: "Challenge my plan",
    description: "Pressure-test the thinking before the real world gets a vote.",
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
  const persistable = threads.slice(0, 20).map((thread) => ({
    ...thread,
    messages: thread.messages?.map((message) => ({
      ...message,
      attachments: message.attachments?.map((attachment) => ({ ...attachment, url: "" })),
    })),
  }));
  localStorage.setItem(GUEST_THREADS_KEY, JSON.stringify(persistable));
}

function localId() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function guestHistoryPayload(messages: ChatMessage[], includeImages: boolean) {
  const imageMessageIndex = includeImages
    ? messages.findLastIndex((message) => message.role === "user" && attachmentPayload(message.attachments ?? []).length > 0)
    : -1;
  return messages.map(({ role, content, attachments }, index) => ({
    role,
    content,
    ...(index === imageMessageIndex ? { attachments: attachmentPayload(attachments ?? []) } : {}),
  }));
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

function ChatModeIcon({ mode, size = 15 }: { mode: ChatMode; size?: number }) {
  if (mode === "expert") return <BrainCircuit size={size} />;
  if (mode === "auto") return <Sparkles size={size} />;
  return <Zap size={size} />;
}

function ChatModePicker({
  mode,
  onChange,
  disabled,
}: {
  mode: ChatMode;
  onChange: (mode: ChatMode) => void;
  disabled: boolean;
}) {
  const [open, setOpen] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);
  const selectedMode = CHAT_MODE_OPTIONS.find((option) => option.value === mode) ?? CHAT_MODE_OPTIONS[0];

  useEffect(() => {
    if (!open) return;
    const closeOnOutsideClick = (event: PointerEvent) => {
      if (!pickerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  return (
    <div className="mode-picker" ref={pickerRef}>
      {open && (
        <div className="mode-menu" role="menu" aria-label="AI response mode">
          {CHAT_MODE_OPTIONS.map((option) => (
            <button
              key={option.value}
              className={option.value === mode ? "mode-option is-selected" : "mode-option"}
              type="button"
              role="menuitemradio"
              aria-checked={option.value === mode}
              onClick={() => {
                onChange(option.value);
                setOpen(false);
              }}
            >
              <span className={`mode-option-icon mode-option-icon-${option.value}`}>
                <ChatModeIcon mode={option.value} size={16} />
              </span>
              <span className="mode-option-copy">
                <strong>{option.label}</strong>
                <small>{option.description}</small>
              </span>
              {option.value === mode && <Check size={15} />}
            </button>
          ))}
        </div>
      )}
      <button
        className={`mode-trigger mode-trigger-${mode}`}
        type="button"
        aria-label={`Response mode: ${selectedMode.label}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        disabled={disabled}
        title={`Response mode: ${selectedMode.label}`}
      >
        <ChatModeIcon mode={mode} />
        <span>{selectedMode.label}</span>
        <ChevronDown className="mode-trigger-chevron" size={13} />
      </button>
    </div>
  );
}

function MarkdownMessage({
  content,
  disabled,
  onRegenerate,
  onRegenerateWithSearch,
}: {
  content: string;
  disabled: boolean;
  onRegenerate: () => void;
  onRegenerateWithSearch: () => void;
}) {
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
        <button
          className="message-action search-answer-action"
          type="button"
          onClick={onRegenerateWithSearch}
          disabled={disabled}
          aria-label="Regenerate answer with DuckDuckGo search"
          title="Regenerate with DuckDuckGo search"
        >
          <Globe size={15} />
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
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const [imagePreparing, setImagePreparing] = useState(false);
  const [mode, setMode] = useState<ChatMode>(DEFAULT_CHAT_MODE);
  const [pending, setPending] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(viewer.authenticated);
  const [remaining, setRemaining] = useState<number | null>(viewer.authenticated ? null : 10);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [desktopSidebarCollapsed, setDesktopSidebarCollapsed] = useState(false);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editInput, setEditInput] = useState("");
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
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
    setAttachments([]);
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
    setAttachments([]);
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
    useSearch,
    imageAttachments = [],
  }: {
    text: string;
    baseMessages: ChatMessage[];
    replaceFromMessageId?: string;
    regenerateFromMessageId?: string;
    useSearch?: boolean;
    imageAttachments?: ChatAttachment[];
  }) => {
    const trimmedText = text.trim();
    if ((!trimmedText && !imageAttachments.length && !regenerateFromMessageId) || pending) return false;
    if (!viewer.authenticated && remaining === 0) {
      setError("Guest brainpower exhausted. Sign in for unlimited conversations.");
      return false;
    }

    const originalMessages = messages;
    const optimisticUserMessage: ChatMessage | null = regenerateFromMessageId ? null : {
      id: localId(),
      role: "user",
      content: trimmedText,
      createdAt: new Date().toISOString(),
      ...(imageAttachments.length ? { attachments: imageAttachments } : {}),
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
          attachments: attachmentPayload(imageAttachments),
          history: viewer.authenticated
            ? undefined
            : guestHistoryPayload(baseMessages, imageAttachments.length === 0),
          replaceFromMessageId,
          regenerateFromMessageId,
          useSearch,
          mode,
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
    const selectedImages = attachments;
    if ((!text && !selectedImages.length) || pending || imagePreparing) return;
    setInput("");
    setAttachments([]);
    if (composerRef.current) composerRef.current.style.height = "auto";
    const sent = await requestAnswer({ text, baseMessages: messages, imageAttachments: selectedImages });
    if (!sent) {
      setInput(text);
      setAttachments(selectedImages);
    }
  };

  const chooseImages = async (files: FileList | null) => {
    if (!files?.length || pending || imagePreparing) return;
    const selectedFiles = Array.from(files);
    if (imageInputRef.current) imageInputRef.current.value = "";
    setImagePreparing(true);
    setError("");
    try {
      const prepared = await prepareImageAttachments(
        selectedFiles,
        MAX_IMAGE_ATTACHMENTS - attachments.length,
      );
      setAttachments((current) => [...current, ...prepared]);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Those images could not be prepared.");
    } finally {
      setImagePreparing(false);
    }
  };

  const beginEdit = (message: ChatMessage) => {
    if (pending) return;
    setEditingMessageId(message.id);
    setEditInput(message.content);
    setError("");
  };

  const saveEdit = async (message: ChatMessage, index: number) => {
    const text = editInput.trim();
    if ((!text && !message.attachments?.length) || text === message.content || pending) return;
    const sent = await requestAnswer({
      text,
      baseMessages: messages.slice(0, index),
      replaceFromMessageId: message.id,
      imageAttachments: message.attachments ?? [],
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

  const regenerateWithSearch = async (message: ChatMessage, index: number) => {
    if (pending) return;
    setEditingMessageId(null);
    await requestAnswer({
      text: "",
      baseMessages: messages.slice(0, index),
      regenerateFromMessageId: message.id,
      useSearch: true,
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
    <main className={desktopSidebarCollapsed ? "app-shell sidebar-collapsed" : "app-shell"}>
      <div className={sidebarOpen ? "sidebar-backdrop is-open" : "sidebar-backdrop"} onClick={() => setSidebarOpen(false)} aria-hidden />
      <aside id="conversation-sidebar" className={sidebarOpen ? "sidebar is-open" : "sidebar"}>
        <div className="sidebar-head">
          <BrandMark priority />
          <button
            className="sidebar-collapse-button icon-button"
            type="button"
            onClick={() => setDesktopSidebarCollapsed(true)}
            aria-label="Collapse conversations sidebar"
            aria-controls="conversation-sidebar"
            aria-expanded="true"
          >
            <PanelLeftClose size={18} />
          </button>
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
          <button
            className="icon-button sidebar-expand-button"
            type="button"
            onClick={() => setDesktopSidebarCollapsed(false)}
            aria-label="Expand conversations sidebar"
            aria-controls="conversation-sidebar"
            aria-expanded="false"
          >
            <PanelLeftOpen size={19} />
          </button>
          <button className="icon-button menu-button" type="button" onClick={() => setSidebarOpen(true)} aria-label="Open conversations" aria-controls="conversation-sidebar"><Menu size={20} /></button>
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
              <div className="welcome-heading-row">
                <div className="welcome-sigil"><BustedBulbMark size={34} /></div>
                <div>
                  <p className="eyebrow">Good {shortGreeting()}</p>
                  <p className="welcome-status">Your thinking room is ready</p>
                </div>
              </div>
              <h1>Busted Minds AI: <em>break open any idea.</em></h1>
              <p className="welcome-copy">
                Chat with BM AI for sharp answers, clearer thinking, coding help, research, and honest feedback—with
                a frankly unreasonable amount of confidence.
              </p>
              <div className="starter-grid">
                {starterPrompts.map(({ icon: Icon, eyebrow, title, description, prompt }) => (
                  <button key={title} type="button" onClick={() => { setInput(prompt); requestAnimationFrame(() => composerRef.current?.focus()); }}>
                    <span className="starter-icon"><Icon size={19} /></span>
                    <small>{eyebrow}</small>
                    <strong>{title}</strong>
                    <p>{description}</p>
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
                        <ImageAttachments attachments={message.attachments} />
                        <textarea
                          value={editInput}
                          onChange={(event) => setEditInput(event.target.value)}
                          maxLength={12_000}
                          rows={3}
                          aria-label="Edit your message"
                          autoFocus
                        />
                        <div className="message-editor-actions">
                          <button type="button" onClick={() => setEditingMessageId(null)}>Cancel</button>
                          <button
                            type="button"
                            onClick={() => void saveEdit(message, index)}
                            disabled={
                              (!editInput.trim() && !message.attachments?.length)
                              || editInput.trim() === message.content
                              || pending
                            }
                          >
                            <SendHorizontal size={14} /> Save & resend
                          </button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <ImageAttachments attachments={message.attachments} />
                        {message.content && <p>{message.content}</p>}
                        <div className="message-actions user-message-actions">
                          {message.content && <CopyMessageAction content={message.content} label="Copy your message" />}
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
                  <div>
                    <MarkdownMessage
                      content={message.content}
                      disabled={pending}
                      onRegenerate={() => void regenerate(message, index)}
                      onRegenerateWithSearch={() => void regenerateWithSearch(message, index)}
                    />
                  </div>
                </article>
              ))}
              {pending && (
                <article className="message assistant-message thinking-message">
                  <div>
                    <p>
                      <i /><i /><i />
                      {mode === "expert"
                        ? "Working through the hard parts"
                        : mode === "auto"
                          ? "Choosing the right brain for this"
                          : "Moving fast"}
                    </p>
                  </div>
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
              <ImageAttachments
                attachments={attachments}
                onRemove={(id) => setAttachments((current) => current.filter((attachment) => attachment.id !== id))}
              />
              <input
                ref={imageInputRef}
                className="visually-hidden"
                type="file"
                accept="image/jpeg,image/png,image/webp"
                multiple
                onChange={(event) => void chooseImages(event.target.files)}
                tabIndex={-1}
              />
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
                <button
                  className="composer-attachment-button"
                  type="button"
                  onClick={() => imageInputRef.current?.click()}
                  disabled={
                    pending
                    || imagePreparing
                    || attachments.length >= MAX_IMAGE_ATTACHMENTS
                    || (!viewer.authenticated && remaining === 0)
                  }
                  aria-label="Attach images"
                  title="Attach up to 3 images"
                >
                  <Paperclip size={17} />
                </button>
                <ChatModePicker key={pending ? "mode-busy" : "mode-ready"} mode={mode} onChange={setMode} disabled={pending} />
                {imagePreparing && <span className="image-preparing">Optimizing image…</span>}
                <button
                  className="composer-send-button"
                  type="submit"
                  disabled={
                    (!input.trim() && !attachments.length)
                    || pending
                    || imagePreparing
                    || (!viewer.authenticated && remaining === 0)
                  }
                  aria-label="Send message"
                >
                  <SendHorizontal size={19} />
                </button>
              </div>
            </form>
            {!messages.length && (
              <p className="fine-print">
                Busted Minds AI cannot make mistakes.
              </p>
            )}
          </div>
        </div>
      </section>
    </main>
  );
}
