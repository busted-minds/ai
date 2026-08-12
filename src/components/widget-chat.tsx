"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowUpRight,
  BrainCircuit,
  Check,
  ChevronDown,
  Copy,
  ExternalLink,
  Lightbulb,
  LogIn,
  Globe,
  Paperclip,
  SendHorizontal,
  Sparkles,
  X,
  Zap,
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
import { ImageAttachments } from "./image-attachments";
import {
  attachmentPayload,
  prepareChatAttachments,
  removePendingDocumentAttachments,
} from "@/lib/client-attachments";
import { CHAT_ATTACHMENT_ACCEPT, MAX_CHAT_ATTACHMENTS } from "@/lib/attachment-constants";
import {
  CHAT_MODE_OPTIONS,
  DEFAULT_CHAT_MODE,
  normalizeChatMode,
  type ChatMode,
} from "@/lib/ai/modes";
import type { ChatAttachment, ChatMessage, Viewer } from "@/lib/types";
import { readJsonResponse } from "@/lib/client-response";

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
const WIDGET_CHAT_MODE_KEY = "bmai-widget-response-mode-v1";

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

function guestHistoryPayload(messages: ChatMessage[]) {
  const imageMessageIndex = messages.findLastIndex(
    (message) => message.role === "user" && attachmentPayload(message.attachments ?? []).length > 0,
  );
  return messages.map(({ role, content, attachments }, index) => ({
    role,
    content,
    ...(index === imageMessageIndex ? { attachments: attachmentPayload(attachments ?? []) } : {}),
  }));
}

function persistableMessages(messages: ChatMessage[]) {
  return messages.slice(-24).map((message) => ({
    ...message,
    attachments: message.attachments?.map((attachment) => ({ ...attachment, url: "" })),
  }));
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

function WidgetModeIcon({ mode }: { mode: ChatMode }) {
  if (mode === "expert") return <BrainCircuit size={14} />;
  if (mode === "auto") return <Sparkles size={14} />;
  return <Zap size={14} />;
}

function WidgetModePicker({
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
    <div className="widget-mode-picker" ref={pickerRef}>
      <button
        className={`widget-mode-trigger widget-mode-trigger-${mode}`}
        type="button"
        onClick={() => setOpen((current) => !current)}
        disabled={disabled}
        aria-label={`Response mode: ${selectedMode.label}`}
        aria-haspopup="menu"
        aria-expanded={open}
        title={`Response mode: ${selectedMode.label}`}
      >
        <WidgetModeIcon mode={mode} />
        <span>{selectedMode.label}</span>
        <ChevronDown className="widget-mode-trigger-chevron" size={13} />
      </button>
      {open && (
        <div className="widget-mode-menu" role="menu" aria-label="AI response mode">
          {CHAT_MODE_OPTIONS.map((option) => (
            <button
              key={option.value}
              className={option.value === mode ? "widget-mode-option is-selected" : "widget-mode-option"}
              type="button"
              role="menuitemradio"
              aria-checked={option.value === mode}
              onClick={() => {
                onChange(option.value);
                setOpen(false);
              }}
            >
              <span className={`widget-mode-option-icon widget-mode-option-icon-${option.value}`}>
                <WidgetModeIcon mode={option.value} />
              </span>
              <span className="widget-mode-option-copy">
                <strong>{option.label}</strong>
                <small>{option.description}</small>
              </span>
              {option.value === mode && <Check size={15} />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function WidgetChat({ initialViewer, initialRemaining, theme }: WidgetChatProps) {
  const router = useRouter();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [guestHydrated, setGuestHydrated] = useState(initialViewer.authenticated);
  const [threadId, setThreadId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const [attachmentPreparing, setAttachmentPreparing] = useState(false);
  const [remaining, setRemaining] = useState(initialRemaining);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [mode, setMode] = useState<ChatMode>(DEFAULT_CHAT_MODE);
  const [modeHydrated, setModeHydrated] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
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
    localStorage.setItem(WIDGET_GUEST_MESSAGES_KEY, JSON.stringify(persistableMessages(messages)));
  }, [guestHydrated, initialViewer.authenticated, messages]);

  useEffect(() => {
    try {
      setMode(normalizeChatMode(localStorage.getItem(WIDGET_CHAT_MODE_KEY)));
    } catch {
      // Storage access can be unavailable in embedded, privacy-restricted contexts.
    } finally {
      setModeHydrated(true);
    }
  }, []);

  useEffect(() => {
    if (!modeHydrated) return;
    try {
      localStorage.setItem(WIDGET_CHAT_MODE_KEY, mode);
    } catch {
      // The selected mode remains available for this session when storage is unavailable.
    }
  }, [mode, modeHydrated]);

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
    const selectedAttachments = attachments;
    if ((!text && !selectedAttachments.length) || pending || attachmentPreparing) return;
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
      ...(selectedAttachments.length ? { attachments: selectedAttachments } : {}),
    };
    setMessages([...baseMessages, optimisticMessage]);
    setInput("");
    setAttachments([]);
    setError("");
    setPending(true);
    if (textareaRef.current) textareaRef.current.style.height = "auto";

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          threadId,
          message: text || undefined,
          attachments: attachmentPayload(selectedAttachments),
          mode,
          history: initialViewer.authenticated
            ? undefined
            : guestHistoryPayload(
                baseMessages.slice(-23).map((message) => ({
                  ...message,
                  attachments: selectedAttachments.length ? undefined : message.attachments,
                })),
              ),
        }),
      });
      const payload = await readJsonResponse<ChatResponse & { message?: ChatMessage | string }>(response);
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
      setAttachments(selectedAttachments);
      setError(caught instanceof Error ? caught.message : "Something broke. Try that again.");
    } finally {
      setPending(false);
      requestAnimationFrame(() => textareaRef.current?.focus());
    }
  };

  const chooseAttachments = async (files: FileList | null) => {
    if (!files?.length || pending || attachmentPreparing) return;
    const selectedFiles = Array.from(files);
    if (fileInputRef.current) fileInputRef.current.value = "";
    setAttachmentPreparing(true);
    setError("");
    try {
      const prepared = await prepareChatAttachments(selectedFiles, attachments, initialViewer.id);
      setAttachments((current) => [...current, ...prepared]);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Those files could not be prepared.");
    } finally {
      setAttachmentPreparing(false);
    }
  };

  const removeAttachment = async (id: string) => {
    const attachment = attachments.find((candidate) => candidate.id === id);
    setAttachments((current) => current.filter((candidate) => candidate.id !== id));
    if (attachment) await removePendingDocumentAttachments([attachment]);
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
            : guestHistoryPayload(baseMessages),
          regenerateFromMessageId: message.id,
          useSearch: true,
          mode,
        }),
      });
      const payload = await readJsonResponse<ChatResponse & { message?: ChatMessage | string }>(response);
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
    void removePendingDocumentAttachments(attachments);
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
              <ImageAttachments attachments={message.attachments} compact />
              {message.content && <p>{message.content}</p>}
            </article>
          ) : (
            <article className="widget-message widget-ai-message" key={message.id}>
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
                  aria-label="Search the web"
                  title="Search the web"
                >
                  <Globe size={13} />
                  <span>Search</span>
                </button>
              </div>
            </article>
          ))}

          {pending && (
            <article className="widget-message widget-ai-message widget-thinking">
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
        <ImageAttachments
          attachments={attachments}
          compact
          onRemove={(id) => void removeAttachment(id)}
        />
        <form className="widget-composer" onSubmit={(event) => void send(event)}>
          <input
            ref={fileInputRef}
            className="visually-hidden"
            type="file"
            accept={CHAT_ATTACHMENT_ACCEPT}
            multiple
            onChange={(event) => void chooseAttachments(event.target.files)}
            tabIndex={-1}
          />
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
          <div className="widget-composer-bottom">
            <button
              className="widget-attachment-button"
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={pending || attachmentPreparing || guestBlocked || attachments.length >= MAX_CHAT_ATTACHMENTS}
              aria-label="Attach files"
              title={initialViewer.authenticated ? "Attach up to 3 images or documents" : "Attach up to 3 images; sign in for documents"}
            >
              <Paperclip size={15} />
            </button>
            <WidgetModePicker
              mode={mode}
              onChange={setMode}
              disabled={pending || attachmentPreparing || guestBlocked}
            />
            <button
              className="widget-send-button"
              type="submit"
              disabled={(!input.trim() && !attachments.length) || pending || attachmentPreparing || guestBlocked}
              aria-label="Send message"
            >
              <SendHorizontal size={17} />
            </button>
          </div>
        </form>
        {!messages.length && <p>Busted Minds AI cannot make mistakes.</p>}
      </footer>
    </main>
  );
}
