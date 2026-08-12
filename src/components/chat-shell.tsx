"use client";

import Link from "next/link";
import Image from "next/image";
import {
  Archive,
  ArrowUpRight,
  BrainCircuit,
  Check,
  ChevronDown,
  ChevronRight,
  Code2,
  Compass,
  Copy,
  ShieldBan,
  Files,
  Folder,
  FolderInput,
  FolderMinus,
  FolderPlus,
  HatGlasses,
  History,
  Lightbulb,
  LogIn,
  LogOut,
  Menu,
  MessageSquareText,
  MoreHorizontal,
  PanelLeftClose,
  PanelLeftOpen,
  Paperclip,
  Pencil,
  Pin,
  Plus,
  RefreshCw,
  Search,
  Share2,
  Globe,
  SendHorizontal,
  Settings,
  Sparkles,
  SquarePen,
  Trash2,
  UserRound,
  X,
  Zap,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
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
import {
  attachmentPayload,
  prepareChatAttachments,
  removePendingDocumentAttachments,
} from "@/lib/client-attachments";
import { CHAT_ATTACHMENT_ACCEPT, MAX_CHAT_ATTACHMENTS } from "@/lib/attachment-constants";
import {
  CHAT_PREFERENCES_CHANGE_EVENT,
  CHAT_PREFERENCES_STORAGE_KEY,
  readChatPreferences,
} from "@/lib/chat-preferences";
import type { ChatAttachment, ChatMessage, ChatProject, ChatThread, Viewer } from "@/lib/types";
import { readJsonResponse } from "@/lib/client-response";
import { normalizeProjectName } from "@/lib/chat-projects";

type ChatShellProps = { initialViewer: Viewer; initialThread?: ChatThread | null };
type ChatResponse = {
  threadId: string | null;
  projectId: string | null;
  title: string;
  userMessage: ChatMessage | null;
  message: ChatMessage;
  remainingGuestMessages: number | null;
  privateChat?: boolean;
};

const GUEST_THREADS_KEY = "bmai-guest-threads-v1";
const GUEST_PROJECTS_KEY = "bmai-guest-projects-v1";
const PINNED_THREADS_KEY = "bmai-pinned-threads-v1";

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
    return Array.isArray(parsed)
      ? (parsed as ChatThread[]).slice(0, 20).map((thread) => ({ ...thread, projectId: thread.projectId ?? null }))
      : [];
  } catch {
    return [];
  }
}

function safeGuestProjects(): ChatProject[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(GUEST_PROJECTS_KEY) ?? "[]") as unknown;
    return Array.isArray(parsed) ? (parsed as ChatProject[]).slice(0, 30) : [];
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

function writeGuestProjects(projects: ChatProject[]) {
  localStorage.setItem(GUEST_PROJECTS_KEY, JSON.stringify(projects.slice(0, 30)));
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

function replaceThreadInUrl(threadId: string | null) {
  const url = new URL(window.location.href);
  if (threadId) url.searchParams.set("thread", threadId);
  else url.searchParams.delete("thread");
  window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
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

export function ChatShell({ initialViewer, initialThread = null }: ChatShellProps) {
  const [viewer] = useState(initialViewer);
  const [threads, setThreads] = useState<ChatThread[]>(initialThread ? [initialThread] : []);
  const [projects, setProjects] = useState<ChatProject[]>([]);
  const [currentThreadId, setCurrentThreadId] = useState<string | null>(initialThread?.id ?? null);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(initialThread?.projectId ?? null);
  const [messages, setMessages] = useState<ChatMessage[]>(initialThread?.messages ?? []);
  const [input, setInput] = useState("");
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const [attachmentPreparing, setAttachmentPreparing] = useState(false);
  const [isPrivateChat, setIsPrivateChat] = useState(false);
  const [mode, setMode] = useState<ChatMode>(DEFAULT_CHAT_MODE);
  const [defaultMode, setDefaultMode] = useState<ChatMode>(DEFAULT_CHAT_MODE);
  const [enterToSend, setEnterToSend] = useState(true);
  const [pending, setPending] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(viewer.authenticated && !initialThread);
  const [remaining, setRemaining] = useState<number | null>(viewer.authenticated ? null : 10);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [projectsCollapsed, setProjectsCollapsed] = useState(false);
  const [historyCollapsed, setHistoryCollapsed] = useState(false);
  const [collapsedProjectIds, setCollapsedProjectIds] = useState<string[]>([]);
  const [creatingProject, setCreatingProject] = useState(false);
  const [editingProjectId, setEditingProjectId] = useState<string | null>(null);
  const [projectNameDraft, setProjectNameDraft] = useState("");
  const [projectMenuId, setProjectMenuId] = useState<string | null>(null);
  const [threadMenuId, setThreadMenuId] = useState<string | null>(null);
  const [threadMenuSource, setThreadMenuSource] = useState<"sidebar" | "header">("sidebar");
  const [threadMenuPosition, setThreadMenuPosition] = useState<{ top: number; left: number } | null>(null);
  const [projectSubmenuOpen, setProjectSubmenuOpen] = useState(false);
  const [threadToMoveAfterProjectCreation, setThreadToMoveAfterProjectCreation] = useState<string | null>(null);
  const [filesPanelOpen, setFilesPanelOpen] = useState(false);
  const [pinnedThreadIds, setPinnedThreadIds] = useState<Set<string>>(() => new Set());
  const [threadActionNotice, setThreadActionNotice] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const [desktopSidebarCollapsed, setDesktopSidebarCollapsed] = useState(false);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editInput, setEditInput] = useState("");
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const profileMenuRef = useRef<HTMLDivElement>(null);
  const projectNameInputRef = useRef<HTMLInputElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const threadMenuRef = useRef<HTMLDivElement>(null);
  const threadMenuTriggerRef = useRef<HTMLButtonElement>(null);
  const projectSubmenuRef = useRef<HTMLDivElement>(null);
  const projectSubmenuTriggerRef = useRef<HTMLButtonElement>(null);
  const pinnedThreadsKey = `${PINNED_THREADS_KEY}:${viewer.id ?? "guest"}`;

  const updateThreads = useCallback((updater: (current: ChatThread[]) => ChatThread[]) => {
    setThreads((current) => {
      const next = updater(current);
      if (!viewer.authenticated) writeGuestThreads(next);
      return next;
    });
  }, [viewer.authenticated]);

  const updateProjects = useCallback((updater: (current: ChatProject[]) => ChatProject[]) => {
    setProjects((current) => {
      const next = updater(current);
      if (!viewer.authenticated) writeGuestProjects(next);
      return next;
    });
  }, [viewer.authenticated]);

  const updatePinnedThreads = useCallback((updater: (current: Set<string>) => Set<string>) => {
    setPinnedThreadIds((current) => {
      const next = updater(new Set(current));
      localStorage.setItem(pinnedThreadsKey, JSON.stringify([...next]));
      return next;
    });
  }, [pinnedThreadsKey]);

  useEffect(() => {
    const syncPreferences = () => {
      const preferences = readChatPreferences();
      setDefaultMode(preferences.defaultMode);
      setMode(preferences.defaultMode);
      setEnterToSend(preferences.enterToSend);
    };
    const syncStoredPreferences = (event: StorageEvent) => {
      if (event.key === CHAT_PREFERENCES_STORAGE_KEY) syncPreferences();
    };

    syncPreferences();
    window.addEventListener(CHAT_PREFERENCES_CHANGE_EVENT, syncPreferences);
    window.addEventListener("storage", syncStoredPreferences);
    return () => {
      window.removeEventListener(CHAT_PREFERENCES_CHANGE_EVENT, syncPreferences);
      window.removeEventListener("storage", syncStoredPreferences);
    };
  }, []);

  useEffect(() => {
    const loadTimer = window.setTimeout(() => {
      try {
        const stored = JSON.parse(localStorage.getItem(pinnedThreadsKey) ?? "[]") as unknown;
        setPinnedThreadIds(new Set(
          Array.isArray(stored) ? stored.filter((id): id is string => typeof id === "string") : [],
        ));
      } catch {
        localStorage.removeItem(pinnedThreadsKey);
        setPinnedThreadIds(new Set());
      }
    }, 0);
    return () => window.clearTimeout(loadTimer);
  }, [pinnedThreadsKey]);

  useEffect(() => {
    if (!viewer.authenticated) {
      const guestHistoryTimer = window.setTimeout(() => {
        setThreads(safeGuestThreads());
        setProjects(safeGuestProjects());
      }, 0);
      void fetch("/api/session", { cache: "no-store" })
        .then((response) => response.json())
        .then((payload: { remainingGuestMessages?: number }) => {
          if (typeof payload.remainingGuestMessages === "number") setRemaining(payload.remainingGuestMessages);
        })
        .catch(() => undefined);
      return () => window.clearTimeout(guestHistoryTimer);
    } else {
      void Promise.allSettled([
        fetch("/api/threads", { cache: "no-store" }),
        fetch("/api/projects", { cache: "no-store" }),
      ])
        .then(async ([threadsResult, projectsResult]) => {
          let unavailable = false;
          if (threadsResult.status === "fulfilled" && threadsResult.value.ok) {
            const payload = await threadsResult.value.json() as { threads?: ChatThread[] };
            setThreads(payload.threads ?? []);
          } else {
            unavailable = true;
          }
          if (projectsResult.status === "fulfilled" && projectsResult.value.ok) {
            const payload = await projectsResult.value.json() as { projects?: ChatProject[] };
            setProjects(payload.projects ?? []);
          } else {
            unavailable = true;
          }
          if (unavailable) setError("Some conversation history is temporarily unavailable.");
        })
        .catch(() => setError("History is being stubborn. Your next message can still work."))
        .finally(() => setHistoryLoading(false));
    }
  }, [viewer.authenticated]);

  useEffect(() => {
    if (!creatingProject && !editingProjectId) return;
    requestAnimationFrame(() => projectNameInputRef.current?.focus());
  }, [creatingProject, editingProjectId]);

  useEffect(() => {
    if (!projectMenuId) return;
    const closeMenusOnOutsideClick = (event: PointerEvent) => {
      const target = event.target as Element;
      if (target.closest(".project-action-menu, .project-more")) return;
      setProjectMenuId(null);
    };
    const closeMenus = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setProjectMenuId(null);
    };
    document.addEventListener("pointerdown", closeMenusOnOutsideClick);
    document.addEventListener("keydown", closeMenus);
    return () => {
      document.removeEventListener("pointerdown", closeMenusOnOutsideClick);
      document.removeEventListener("keydown", closeMenus);
    };
  }, [projectMenuId]);

  useEffect(() => {
    if (!threadMenuId) return;
    const closeOnOutsideClick = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!threadMenuRef.current?.contains(target) && !threadMenuTriggerRef.current?.contains(target)) {
        setThreadMenuId(null);
      }
    };
    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setThreadMenuId(null);
      threadMenuTriggerRef.current?.focus();
    };
    const closeOnViewportChange = () => setThreadMenuId(null);
    document.addEventListener("pointerdown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    document.addEventListener("scroll", closeOnViewportChange, true);
    window.addEventListener("resize", closeOnViewportChange);

    const positionTimer = window.setTimeout(() => {
      const menu = threadMenuRef.current;
      if (!menu) return;
      const bounds = menu.getBoundingClientRect();
      const nextTop = Math.min(
        Math.max(8, bounds.top),
        Math.max(8, window.innerHeight - bounds.height - 8),
      );
      const nextLeft = Math.min(
        Math.max(8, bounds.left),
        Math.max(8, window.innerWidth - bounds.width - 8),
      );
      setThreadMenuPosition({ top: nextTop, left: nextLeft });
      menu.querySelector<HTMLButtonElement>("[role='menuitem']")?.focus();
    }, 0);

    return () => {
      window.clearTimeout(positionTimer);
      document.removeEventListener("pointerdown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
      document.removeEventListener("scroll", closeOnViewportChange, true);
      window.removeEventListener("resize", closeOnViewportChange);
    };
  }, [threadMenuId]);

  useEffect(() => {
    if (!threadActionNotice) return;
    const noticeTimer = window.setTimeout(() => setThreadActionNotice(""), 2_400);
    return () => window.clearTimeout(noticeTimer);
  }, [threadActionNotice]);

  useEffect(() => {
    if (!filesPanelOpen) return;
    const previousOverflow = document.body.style.overflow;
    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (document.querySelector(".image-preview-backdrop, .document-preview-layer")) return;
      setFilesPanelOpen(false);
    };
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [filesPanelOpen]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, pending]);

  useEffect(() => {
    if (!profileMenuOpen) return;
    const closeOnOutsideClick = (event: PointerEvent) => {
      if (!profileMenuRef.current?.contains(event.target as Node)) setProfileMenuOpen(false);
    };
    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") setProfileMenuOpen(false);
    };
    document.addEventListener("pointerdown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [profileMenuOpen]);

  const filteredThreads = useMemo(() => {
    const query = search.trim().toLowerCase();
    const visibleThreads = threads.filter((thread) => !thread.archived);
    const matchingThreads = query
      ? visibleThreads.filter((thread) => thread.title.toLowerCase().includes(query))
      : visibleThreads;
    return [...matchingThreads].sort((first, second) =>
      Number(pinnedThreadIds.has(second.id)) - Number(pinnedThreadIds.has(first.id)));
  }, [pinnedThreadIds, search, threads]);

  const currentThread = threads.find((thread) => thread.id === currentThreadId) ?? null;
  const menuThread = threadMenuId ? threads.find((thread) => thread.id === threadMenuId) ?? null : null;
  const chatFileGroups = useMemo(() => messages.flatMap((message) => (
    message.attachments?.length
      ? [{ messageId: message.id, role: message.role, attachments: message.attachments }]
      : []
  )), [messages]);
  const chatFileCount = chatFileGroups.reduce((count, group) => count + group.attachments.length, 0);
  const currentProject = projects.find((project) => (
    project.id === (currentThread?.projectId ?? activeProjectId)
  )) ?? null;
  const projectIds = useMemo(() => new Set(projects.map(({ id }) => id)), [projects]);
  const historyThreads = filteredThreads.filter((thread) => !thread.projectId || !projectIds.has(thread.projectId));
  const visibleProjects = useMemo(() => {
    const query = search.trim().toLowerCase();
    return projects.filter((project) => {
      if (!query || project.name.toLowerCase().includes(query)) return true;
      return filteredThreads.some((thread) => thread.projectId === project.id);
    });
  }, [filteredThreads, projects, search]);

  const expandDesktopSidebar = (destination?: "search" | "projects" | "history" | "account") => {
    if (destination === "projects") setProjectsCollapsed(false);
    if (destination === "history") setHistoryCollapsed(false);
    if (destination === "account") setProfileMenuOpen(true);
    setDesktopSidebarCollapsed(false);
    if (destination === "search") requestAnimationFrame(() => searchInputRef.current?.focus());
  };

  const newChat = (projectId: string | null = null) => {
    const privateMessageAttachments = isPrivateChat
      ? messages.flatMap((message) => message.attachments ?? [])
      : [];
    void removePendingDocumentAttachments([...attachments, ...privateMessageAttachments]);
    setIsPrivateChat(false);
    setCurrentThreadId(null);
    replaceThreadInUrl(null);
    setActiveProjectId(projectId);
    setMessages([]);
    setInput("");
    setAttachments([]);
    setError("");
    setEditingMessageId(null);
    setEditInput("");
    setProjectMenuId(null);
    setThreadMenuId(null);
    setProjectSubmenuOpen(false);
    setFilesPanelOpen(false);
    setMode(defaultMode);
    setHistoryLoading(false);
    setSidebarOpen(false);
    requestAnimationFrame(() => composerRef.current?.focus());
  };

  const selectThread = async (thread: ChatThread) => {
    const privateMessageAttachments = isPrivateChat
      ? messages.flatMap((message) => message.attachments ?? [])
      : [];
    void removePendingDocumentAttachments([...attachments, ...privateMessageAttachments]);
    setIsPrivateChat(false);
    setCurrentThreadId(thread.id);
    replaceThreadInUrl(thread.id);
    setActiveProjectId(thread.projectId ?? null);
    setSidebarOpen(false);
    setError("");
    setEditingMessageId(null);
    setAttachments([]);
    setProjectMenuId(null);
    setThreadMenuId(null);
    setProjectSubmenuOpen(false);
    setFilesPanelOpen(false);
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

  const togglePrivateChat = () => {
    if (pending) return;
    if (isPrivateChat) {
      newChat();
      setThreadActionNotice("Private chat discarded. Back to a saved chat.");
      return;
    }

    void removePendingDocumentAttachments(attachments);
    setIsPrivateChat(true);
    setCurrentThreadId(null);
    replaceThreadInUrl(null);
    setActiveProjectId(null);
    setMessages([]);
    setInput("");
    setAttachments([]);
    setError("");
    setHistoryLoading(false);
    setEditingMessageId(null);
    setEditInput("");
    setProjectMenuId(null);
    setThreadMenuId(null);
    setProjectSubmenuOpen(false);
    setFilesPanelOpen(false);
    setMode(defaultMode);
    setSidebarOpen(false);
    setThreadActionNotice("Private chat started. It will not appear in history or be shareable.");
    requestAnimationFrame(() => composerRef.current?.focus());
  };

  const deleteThread = async (threadId: string) => {
    if (viewer.authenticated) {
      const response = await fetch(`/api/threads/${threadId}`, { method: "DELETE" });
      if (!response.ok) return setError("That thread refused to disappear. Dramatic.");
    }
    setThreadMenuId(null);
    updateThreads((current) => current.filter((thread) => thread.id !== threadId));
    updatePinnedThreads((current) => {
      current.delete(threadId);
      return current;
    });
    if (currentThreadId === threadId) newChat();
  };

  const submitProject = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const name = normalizeProjectName(projectNameDraft);
    if (!name) return setError("Give the project a name first.");
    setError("");
    let project: ChatProject;
    if (viewer.authenticated) {
      const response = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const payload = await readJsonResponse<{ project?: ChatProject; message?: string }>(response);
      if (!response.ok || !payload.project) {
        return setError(payload.message ?? "Project could not be created.");
      }
      project = payload.project;
    } else {
      const now = new Date().toISOString();
      project = { id: localId(), name, createdAt: now, updatedAt: now };
    }
    updateProjects((current) => [...current, project]);
    const threadIdToMove = threadToMoveAfterProjectCreation;
    setThreadToMoveAfterProjectCreation(null);
    if (threadIdToMove) {
      const moved = await moveThread(threadIdToMove, project.id);
      if (moved) setThreadActionNotice(`Conversation moved to ${project.name}.`);
    }
    setCreatingProject(false);
    setProjectNameDraft("");
    setProjectsCollapsed(false);
  };

  const beginProjectRename = (project: ChatProject) => {
    setProjectMenuId(null);
    setCreatingProject(false);
    setThreadToMoveAfterProjectCreation(null);
    setEditingProjectId(project.id);
    setProjectNameDraft(project.name);
  };

  const submitProjectRename = async (event: FormEvent<HTMLFormElement>, projectId: string) => {
    event.preventDefault();
    const name = normalizeProjectName(projectNameDraft);
    if (!name) return setError("Give the project a name first.");
    setError("");
    if (viewer.authenticated) {
      const response = await fetch(`/api/projects/${projectId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const payload = await readJsonResponse<{ message?: string }>(response);
      if (!response.ok) return setError(payload.message ?? "Project could not be renamed.");
    }
    updateProjects((current) => current.map((project) => (
      project.id === projectId ? { ...project, name, updatedAt: new Date().toISOString() } : project
    )));
    setEditingProjectId(null);
    setProjectNameDraft("");
  };

  const deleteProject = async (project: ChatProject) => {
    const accepted = window.confirm(`Delete “${project.name}”? Its conversations will move back to History.`);
    if (!accepted) return;
    setError("");
    if (viewer.authenticated) {
      const response = await fetch(`/api/projects/${project.id}`, { method: "DELETE" });
      const payload = await readJsonResponse<{ message?: string }>(response);
      if (!response.ok) return setError(payload.message ?? "Project could not be deleted.");
    }
    updateProjects((current) => current.filter(({ id }) => id !== project.id));
    updateThreads((current) => current.map((thread) => (
      thread.projectId === project.id ? { ...thread, projectId: null } : thread
    )));
    setActiveProjectId((current) => current === project.id ? null : current);
    setProjectMenuId(null);
    setEditingProjectId((current) => current === project.id ? null : current);
  };

  const moveThread = async (threadId: string, projectId: string | null) => {
    setError("");
    if (viewer.authenticated) {
      const response = await fetch(`/api/threads/${threadId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId }),
      });
      const payload = await readJsonResponse<{ message?: string }>(response);
      if (!response.ok) {
        setError(payload.message ?? "Conversation could not be moved.");
        return false;
      }
    }
    updateThreads((current) => current.map((thread) => (
      thread.id === threadId ? { ...thread, projectId, updatedAt: new Date().toISOString() } : thread
    )));
    if (currentThreadId === threadId) setActiveProjectId(projectId);
    setThreadMenuId(null);
    setProjectSubmenuOpen(false);
    return true;
  };

  const beginNewProjectForThread = (threadId: string) => {
    setThreadToMoveAfterProjectCreation(threadId);
    setCreatingProject(true);
    setEditingProjectId(null);
    setProjectNameDraft("");
    setProjectsCollapsed(false);
    setThreadMenuId(null);
    setProjectSubmenuOpen(false);
    setSidebarOpen(true);
  };

  const renameThread = async (thread: ChatThread) => {
    const title = window.prompt("Rename conversation", thread.title)?.replace(/\s+/g, " ").trim().slice(0, 80);
    if (!title || title === thread.title) return setThreadMenuId(null);
    setError("");
    if (viewer.authenticated) {
      const response = await fetch(`/api/threads/${thread.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title }),
      });
      const payload = await readJsonResponse<{ message?: string }>(response);
      if (!response.ok) return setError(payload.message ?? "Conversation could not be renamed.");
    }
    updateThreads((current) => current.map((item) => item.id === thread.id ? { ...item, title } : item));
    setThreadMenuId(null);
  };

  const shareThread = async (thread: ChatThread) => {
    setThreadMenuId(null);
    if (!viewer.authenticated) {
      setThreadActionNotice("Sign in to create a reusable conversation link.");
      return;
    }
    try {
      const response = await fetch(`/api/threads/${thread.id}/share`, { method: "POST" });
      const payload = await readJsonResponse<{ token?: string; message?: string }>(response);
      if (!response.ok || !payload.token) {
        throw new Error(payload.message ?? "Conversation could not be shared.");
      }
      const shareUrl = new URL(`/share/${payload.token}`, window.location.origin).toString();
      if (typeof navigator.share === "function") {
        await navigator.share({
          title: thread.title,
          text: "Continue this Busted Minds AI conversation in your own private chat.",
          url: shareUrl,
        });
        setThreadActionNotice("Share link sent.");
      } else {
        await navigator.clipboard.writeText(shareUrl);
        setThreadActionNotice("Share link copied to the clipboard.");
      }
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === "AbortError") return;
      setError(caught instanceof Error ? caught.message : "Conversation could not be shared.");
    }
  };

  const togglePinnedThread = (threadId: string) => {
    const wasPinned = pinnedThreadIds.has(threadId);
    updatePinnedThreads((current) => {
      if (wasPinned) current.delete(threadId);
      else current.add(threadId);
      return current;
    });
    setThreadMenuId(null);
    setThreadActionNotice(wasPinned ? "Conversation unpinned." : "Conversation pinned to the top.");
  };

  const archiveThread = async (threadId: string) => {
    setThreadMenuId(null);
    setError("");
    try {
      if (viewer.authenticated) {
        const response = await fetch(`/api/threads/${threadId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ archived: true }),
        });
        const payload = await readJsonResponse<{ message?: string }>(response);
        if (!response.ok) throw new Error(payload.message ?? "Conversation could not be archived.");
        updateThreads((current) => current.filter((thread) => thread.id !== threadId));
      } else {
        updateThreads((current) => current.map((thread) => (
          thread.id === threadId ? { ...thread, archived: true } : thread
        )));
      }
      updatePinnedThreads((current) => {
        current.delete(threadId);
        return current;
      });
      if (currentThreadId === threadId) newChat();
      setThreadActionNotice("Conversation archived.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Conversation could not be archived.");
    }
  };

  const toggleProject = (projectId: string) => {
    setCollapsedProjectIds((current) => (
      current.includes(projectId)
        ? current.filter((id) => id !== projectId)
        : [...current, projectId]
    ));
  };

  const requestAnswer = async ({
    text,
    baseMessages,
    replaceFromMessageId,
    regenerateFromMessageId,
    useSearch,
    messageAttachments = [],
  }: {
    text: string;
    baseMessages: ChatMessage[];
    replaceFromMessageId?: string;
    regenerateFromMessageId?: string;
    useSearch?: boolean;
    messageAttachments?: ChatAttachment[];
  }) => {
    const trimmedText = text.trim();
    if ((!trimmedText && !messageAttachments.length && !regenerateFromMessageId) || pending) return false;
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
      ...(messageAttachments.length ? { attachments: messageAttachments } : {}),
    };
    setMessages([...baseMessages, ...(optimisticUserMessage ? [optimisticUserMessage] : [])]);
    setError("");
    setPending(true);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          threadId: isPrivateChat ? undefined : currentThreadId,
          projectId: isPrivateChat || currentThreadId ? undefined : activeProjectId,
          message: trimmedText || undefined,
          attachments: attachmentPayload(messageAttachments),
          history: isPrivateChat || !viewer.authenticated
            ? guestHistoryPayload(baseMessages, messageAttachments.length === 0)
            : undefined,
          replaceFromMessageId,
          regenerateFromMessageId,
          useSearch,
          mode,
          privateChat: isPrivateChat,
        }),
      });
      const payload = await readJsonResponse<ChatResponse & { message?: ChatMessage | string }>(response);
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
      if (isPrivateChat) {
        setCurrentThreadId(null);
        replaceThreadInUrl(null);
        return true;
      }
      const resolvedId = payload.threadId ?? currentThreadId ?? localId();
      setCurrentThreadId(resolvedId);
      replaceThreadInUrl(resolvedId);
      updateThreads((current) => {
        const existing = current.find((thread) => thread.id === resolvedId);
        const editedFirstMessage = Boolean(replaceFromMessageId && baseMessages.length === 0);
        const updated: ChatThread = {
          id: resolvedId,
          title: editedFirstMessage ? payload.title : existing?.title ?? payload.title,
          projectId: payload.projectId ?? existing?.projectId ?? activeProjectId,
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
    const selectedAttachments = attachments;
    if ((!text && !selectedAttachments.length) || pending || attachmentPreparing) return;
    setInput("");
    setAttachments([]);
    if (composerRef.current) composerRef.current.style.height = "auto";
    const sent = await requestAnswer({ text, baseMessages: messages, messageAttachments: selectedAttachments });
    if (!sent) {
      setInput(text);
      setAttachments(selectedAttachments);
    }
  };

  const chooseAttachments = async (files: FileList | null) => {
    if (!files?.length || pending || attachmentPreparing) return;
    const selectedFiles = Array.from(files);
    if (fileInputRef.current) fileInputRef.current.value = "";
    setAttachmentPreparing(true);
    setError("");
    try {
      const prepared = await prepareChatAttachments(selectedFiles, attachments, viewer.id);
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
      messageAttachments: message.attachments ?? [],
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
    if (!enterToSend) return;

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

  const openThreadMenu = (
    thread: ChatThread,
    trigger: HTMLButtonElement,
    source: "sidebar" | "header",
  ) => {
    setProjectMenuId(null);
    if (threadMenuId === thread.id && threadMenuSource === source) {
      setThreadMenuId(null);
      setProjectSubmenuOpen(false);
      return;
    }
    const triggerBounds = trigger.getBoundingClientRect();
    const menuWidth = 232;
    const opensRight = window.innerWidth - triggerBounds.right >= menuWidth + 16;
    threadMenuTriggerRef.current = trigger;
    setThreadMenuSource(source);
    setProjectSubmenuOpen(false);
    setThreadMenuPosition(source === "header" ? {
      top: triggerBounds.bottom + 8,
      left: Math.max(8, triggerBounds.right - menuWidth),
    } : {
      top: triggerBounds.top - 5,
      left: opensRight ? triggerBounds.right + 8 : triggerBounds.right - menuWidth,
    });
    setThreadMenuId(thread.id);
  };

  const displayName = viewer.name?.split(" ")[0] || viewer.email?.split("@")[0] || "sharp mind";
  const projectThreadsFor = (project: ChatProject) => {
    const projectNameMatches = search.trim()
      && project.name.toLowerCase().includes(search.trim().toLowerCase());
    return (projectNameMatches ? threads : filteredThreads)
      .filter((thread) => thread.projectId === project.id);
  };
  const renderThreadRow = (thread: ChatThread, nested = false) => (
    <div className={nested ? "thread-item-wrap is-nested" : "thread-item-wrap"} key={thread.id}>
      <div className={thread.id === currentThreadId ? "thread-row active" : "thread-row"}>
        <button type="button" onClick={() => void selectThread(thread)}>
          <MessageSquareText size={15} /> <span>{thread.title}</span>
        </button>
        {pinnedThreadIds.has(thread.id) && (
          <span className="thread-pinned-indicator" title="Pinned conversation">
            <Pin size={13} aria-hidden />
          </span>
        )}
        <button
          className="thread-more"
          type="button"
          onClick={(event) => {
            openThreadMenu(thread, event.currentTarget, "sidebar");
          }}
          aria-label={`Open menu for ${thread.title}`}
          aria-haspopup="menu"
          aria-expanded={threadMenuId === thread.id}
          aria-controls={threadMenuId === thread.id ? `thread-actions-${thread.id}` : undefined}
        >
          <MoreHorizontal size={17} />
        </button>
      </div>
    </div>
  );

  const renderMoveToProjectSubmenu = (thread: ChatThread) => (
    <div
      className="thread-project-submenu-anchor"
      onPointerEnter={() => setProjectSubmenuOpen(true)}
    >
      <button
        ref={projectSubmenuTriggerRef}
        type="button"
        role="menuitem"
        aria-haspopup="menu"
        aria-expanded={projectSubmenuOpen}
        aria-controls={projectSubmenuOpen ? `thread-projects-${thread.id}` : undefined}
        onClick={() => setProjectSubmenuOpen((current) => !current)}
        onKeyDown={(event) => {
          if (event.key !== "ArrowRight") return;
          event.preventDefault();
          event.stopPropagation();
          setProjectSubmenuOpen(true);
          requestAnimationFrame(() => {
            projectSubmenuRef.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
          });
        }}
      >
        <FolderInput size={18} /><span>Move to project</span><ChevronRight size={16} />
      </button>
      {projectSubmenuOpen && (
        <div
          id={`thread-projects-${thread.id}`}
          className={threadMenuSource === "header"
            ? "thread-project-submenu opens-left"
            : "thread-project-submenu opens-right"}
          ref={projectSubmenuRef}
          role="menu"
          aria-label="Choose a project"
          onKeyDown={(event) => {
            if (event.key === "Escape" || event.key === "ArrowLeft") {
              event.preventDefault();
              event.stopPropagation();
              setProjectSubmenuOpen(false);
              projectSubmenuTriggerRef.current?.focus();
              return;
            }
            if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
            event.preventDefault();
            event.stopPropagation();
            const items = [...event.currentTarget.querySelectorAll<HTMLButtonElement>(":scope > button:not(:disabled)")];
            const currentIndex = items.indexOf(document.activeElement as HTMLButtonElement);
            const nextIndex = event.key === "Home"
              ? 0
              : event.key === "End"
                ? items.length - 1
                : event.key === "ArrowDown"
                  ? (currentIndex + 1) % items.length
                  : (currentIndex - 1 + items.length) % items.length;
            items[nextIndex]?.focus();
          }}
        >
          <button type="button" role="menuitem" onClick={() => beginNewProjectForThread(thread.id)}>
            <FolderPlus size={18} /><span>New project</span>
          </button>
          <div className="thread-action-menu-divider" role="separator" />
          {projects.map((project) => (
            <button
              type="button"
              role="menuitemradio"
              aria-checked={thread.projectId === project.id}
              onClick={() => void moveThread(thread.id, project.id)}
              key={project.id}
            >
              <Folder size={18} /><span>{project.name}</span>
              {thread.projectId === project.id && <Check size={14} />}
            </button>
          ))}
          {!projects.length && <span className="thread-project-submenu-empty">No projects yet.</span>}
          {thread.projectId && (
            <>
              <div className="thread-action-menu-divider" role="separator" />
              <button type="button" role="menuitem" onClick={() => void moveThread(thread.id, null)}>
                <FolderMinus size={18} /><span>Remove from project</span>
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );

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
        <button className="new-chat-button" type="button" onClick={() => newChat()}>
          <SquarePen size={18} /> New conversation <span>⌘ K</span>
        </button>
        <label className="thread-search">
          <Search size={16} aria-hidden />
          <input ref={searchInputRef} value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search conversations" aria-label="Search conversations" />
        </label>

        <div className="thread-list">
          <section className="sidebar-conversation-section" aria-labelledby="projects-heading">
            <div className="conversation-section-head">
              <button
                id="projects-heading"
                className="conversation-section-toggle"
                type="button"
                onClick={() => setProjectsCollapsed((current) => !current)}
                aria-expanded={!projectsCollapsed}
              >
                {projectsCollapsed ? <ChevronRight size={15} /> : <ChevronDown size={15} />}
                <span>Projects</span>
              </button>
              <button
                className="section-add-button"
                type="button"
                onClick={() => {
                  setThreadToMoveAfterProjectCreation(null);
                  setCreatingProject(true);
                  setEditingProjectId(null);
                  setProjectMenuId(null);
                  setThreadMenuId(null);
                  setProjectNameDraft("");
                  setProjectsCollapsed(false);
                }}
                aria-label="Create project"
                title="Create project"
              >
                <FolderPlus size={16} />
              </button>
            </div>

            {!projectsCollapsed && (
              <div className="project-list">
                {creatingProject && (
                  <form className="project-name-form" onSubmit={submitProject}>
                    <Folder size={15} aria-hidden />
                    <input
                      ref={projectNameInputRef}
                      value={projectNameDraft}
                      onChange={(event) => setProjectNameDraft(event.target.value)}
                      placeholder="Project name"
                      aria-label="Project name"
                      maxLength={60}
                    />
                    <button type="submit" aria-label="Save project"><Check size={14} /></button>
                    <button
                      type="button"
                      onClick={() => {
                        setCreatingProject(false);
                        setThreadToMoveAfterProjectCreation(null);
                        setProjectNameDraft("");
                      }}
                      aria-label="Cancel project"
                    >
                      <X size={14} />
                    </button>
                  </form>
                )}

                {visibleProjects.map((project) => {
                  const projectThreads = projectThreadsFor(project);
                  const collapsed = collapsedProjectIds.includes(project.id);
                  return (
                    <div className="project-group" key={project.id}>
                      <div className={currentProject?.id === project.id ? "project-row active" : "project-row"}>
                        <button type="button" onClick={() => toggleProject(project.id)} aria-expanded={!collapsed}>
                          <span className="project-chevron">
                            {collapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
                          </span>
                          <Folder size={17} />
                          <span>{project.name}</span>
                        </button>
                        <button type="button" onClick={() => newChat(project.id)} aria-label={`New conversation in ${project.name}`} title="New conversation">
                          <Plus size={16} />
                        </button>
                        <button
                          className="project-more"
                          type="button"
                          onClick={() => {
                            setThreadMenuId(null);
                            setProjectMenuId((current) => current === project.id ? null : project.id);
                          }}
                          aria-label={`Manage ${project.name}`}
                          aria-expanded={projectMenuId === project.id}
                        >
                          <MoreHorizontal size={16} />
                        </button>
                      </div>

                      {editingProjectId === project.id && (
                        <form className="project-name-form is-nested" onSubmit={(event) => void submitProjectRename(event, project.id)}>
                          <Folder size={15} aria-hidden />
                          <input
                            ref={projectNameInputRef}
                            value={projectNameDraft}
                            onChange={(event) => setProjectNameDraft(event.target.value)}
                            aria-label={`Rename ${project.name}`}
                            maxLength={60}
                          />
                          <button type="submit" aria-label="Save project name"><Check size={14} /></button>
                          <button
                            type="button"
                            onClick={() => { setEditingProjectId(null); setProjectNameDraft(""); }}
                            aria-label="Cancel rename"
                          >
                            <X size={14} />
                          </button>
                        </form>
                      )}

                      {projectMenuId === project.id && (
                        <div className="project-action-menu" role="menu" aria-label={`Manage ${project.name}`}>
                          <button type="button" role="menuitem" onClick={() => beginProjectRename(project)}>
                            <Pencil size={14} /> Rename project
                          </button>
                          <button className="danger" type="button" role="menuitem" onClick={() => void deleteProject(project)}>
                            <Trash2 size={14} /> Delete project
                          </button>
                        </div>
                      )}

                      {!collapsed && (
                        <div className="project-thread-list">
                          <button className="project-new-chat" type="button" onClick={() => newChat(project.id)}>
                            <SquarePen size={14} /> New conversation
                          </button>
                          {projectThreads.map((thread) => renderThreadRow(thread, true))}
                          {!projectThreads.length && !search && (
                            <p className="empty-project-copy">No conversations yet.</p>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}

                {!creatingProject && !visibleProjects.length && (
                  <button
                    className="empty-projects-button"
                    type="button"
                    onClick={() => {
                      setThreadToMoveAfterProjectCreation(null);
                      setCreatingProject(true);
                      setEditingProjectId(null);
                      setProjectNameDraft("");
                    }}
                  >
                    <FolderPlus size={16} />
                    <span>{search ? "No project matches." : "Create a project to group related chats."}</span>
                  </button>
                )}
              </div>
            )}
          </section>

          <section className="sidebar-conversation-section history-section" aria-labelledby="history-heading">
            <div className="conversation-section-head">
              <button
                id="history-heading"
                className="conversation-section-toggle"
                type="button"
                onClick={() => setHistoryCollapsed((current) => !current)}
                aria-expanded={!historyCollapsed}
              >
                {historyCollapsed ? <ChevronRight size={15} /> : <ChevronDown size={15} />}
                <span>History</span>
                <small>{historyThreads.length}</small>
              </button>
            </div>
            {!historyCollapsed && (
              <div className="history-thread-list">
                {historyLoading && threads.length === 0 ? (
                  <div className="thread-skeletons"><span /><span /><span /></div>
                ) : historyThreads.length ? historyThreads.map((thread) => renderThreadRow(thread)) : (!search || !visibleProjects.length) ? (
                  <div className="empty-threads">
                    <BustedBulbMark size={17} />
                    <p>{search ? "No conversation matches that." : threads.length ? "No ungrouped conversations." : "Your next dangerous idea starts here."}</p>
                  </div>
                ) : null}
              </div>
            )}
          </section>
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
          {viewer.authenticated ? (
            <div className="profile-menu-anchor" ref={profileMenuRef}>
              {profileMenuOpen && (
                <div className="profile-menu" role="menu" aria-label="Profile menu">
                  <Link href="/settings" className="profile-menu-item" role="menuitem">
                    <span className="profile-menu-icon"><Settings size={16} /></span>
                    <span><strong>Settings</strong></span>
                  </Link>
                  <a href="https://accounts.bustedminds.us.kg/" className="profile-menu-item" role="menuitem">
                    <span className="profile-menu-icon"><UserRound size={16} /></span>
                    <span><strong>Account</strong><small>accounts.bustedminds.us.kg</small></span>
                    <ArrowUpRight size={14} />
                  </a>
                  <form action="/auth/sign-out" method="post">
                    <button className="profile-menu-item profile-menu-logout" type="submit" role="menuitem">
                      <span className="profile-menu-icon"><LogOut size={16} /></span>
                      <span><strong>Log out</strong></span>
                    </button>
                  </form>
                </div>
              )}
              <button
                className="account-link profile-menu-trigger"
                type="button"
                aria-haspopup="menu"
                aria-expanded={profileMenuOpen}
                onClick={() => setProfileMenuOpen((current) => !current)}
              >
                <span className="avatar"><UserRound size={17} /></span>
                <span><strong>{displayName}</strong><small>{viewer.username ? `@${viewer.username}` : "Busted Minds Account"}</small></span>
                <ChevronDown size={15} />
              </button>
            </div>
          ) : (
            <Link href="/auth/sign-in" className="account-link">
              <span className="avatar"><UserRound size={17} /></span>
              <span><strong>Guest mind</strong><small>{remaining ?? 10} messages left</small></span>
              <ArrowUpRight size={15} />
            </Link>
          )}
        </div>
      </aside>

      <aside className="sidebar-rail" aria-label="Collapsed conversations sidebar">
        <nav className="sidebar-rail-nav" aria-label="Conversation shortcuts">
          <button
            className="sidebar-rail-control sidebar-rail-brand"
            type="button"
            onClick={() => expandDesktopSidebar()}
            aria-label="Open sidebar"
            aria-controls="conversation-sidebar"
            aria-expanded="false"
            data-tooltip="Open sidebar"
          >
            <BrandMark compact priority />
            <PanelLeftOpen className="sidebar-rail-expand-icon" size={21} aria-hidden />
          </button>
          <button
            className="sidebar-rail-control"
            type="button"
            onClick={() => newChat()}
            aria-label="New conversation"
            data-tooltip="New conversation"
          >
            <SquarePen size={21} />
          </button>
          <button
            className="sidebar-rail-control"
            type="button"
            onClick={() => expandDesktopSidebar("search")}
            aria-label="Search conversations"
            aria-controls="conversation-sidebar"
            data-tooltip="Search conversations"
          >
            <Search size={21} />
          </button>
          <button
            className="sidebar-rail-control"
            type="button"
            onClick={() => expandDesktopSidebar("history")}
            aria-label="Conversation history"
            aria-controls="conversation-sidebar"
            data-tooltip="Conversation history"
          >
            <MessageSquareText size={21} />
          </button>
          <button
            className="sidebar-rail-control"
            type="button"
            onClick={() => expandDesktopSidebar("projects")}
            aria-label="Projects"
            aria-controls="conversation-sidebar"
            data-tooltip="Projects"
          >
            <Folder size={21} />
          </button>
        </nav>

        <div className="sidebar-rail-footer">
          <Link
            href="/settings"
            className="sidebar-rail-control"
            aria-label="Settings"
            data-tooltip="Settings"
          >
            <Settings size={19} />
          </Link>
          {viewer.authenticated ? (
            <button
              className="sidebar-rail-control sidebar-rail-account"
              type="button"
              onClick={() => expandDesktopSidebar("account")}
              aria-label={`Open ${displayName} profile menu`}
              aria-controls="conversation-sidebar"
              data-tooltip={displayName}
            >
              <span className="sidebar-rail-avatar" aria-hidden>{displayName.charAt(0).toUpperCase()}</span>
            </button>
          ) : (
            <Link
              href="/auth/sign-in"
              className="sidebar-rail-control sidebar-rail-account"
              aria-label="Sign in"
              data-tooltip="Sign in"
            >
              <LogIn size={20} />
            </Link>
          )}
        </div>
      </aside>

      <section className="chat-stage">
        <header className={isPrivateChat ? "topbar private-chat-topbar" : "topbar"}>
          <button className="icon-button menu-button" type="button" onClick={() => setSidebarOpen(true)} aria-label="Open conversations" aria-controls="conversation-sidebar"><Menu size={20} /></button>
          <BrandMark compact />
          <div className="thread-heading">
            <strong>{isPrivateChat ? "Private chat" : currentThread?.title ?? "New conversation"}</strong>
            <small>
              {isPrivateChat
                ? <><HatGlasses size={10} /> Not saved to history</>
                : currentProject
                  ? <><Folder size={10} /> {currentProject.name}</>
                  : <><span /> Ready to think</>}
            </small>
          </div>
          <div className="topbar-actions">
            {!viewer.authenticated && <span className="message-meter"><BustedBulbMark size={15} /> {remaining ?? 10} free</span>}
            {(!currentThread || isPrivateChat) && (
              <button
                className={isPrivateChat ? "private-chat-button is-active" : "private-chat-button"}
                type="button"
                onClick={togglePrivateChat}
                disabled={pending}
                aria-pressed={isPrivateChat}
                aria-label={isPrivateChat ? "Exit and discard private chat" : "Start a private chat"}
                title={isPrivateChat ? "Exit and discard private chat" : "Private chat — not saved or shareable"}
              >
                {isPrivateChat ? <>
                  <span className="private-chat-button-icon"><HatGlasses size={16} /></span>
                  <span className="private-chat-button-copy">
                    <strong>Private chat</strong>
                    <small>Not saved</small>
                  </span>
                </> : <><HatGlasses size={16} /><span className="private-chat-label">Private</span></>}
              </button>
            )}
            {currentThread && (
              <button
                className="icon-button top-thread-menu-button"
                type="button"
                onClick={(event) => openThreadMenu(currentThread, event.currentTarget, "header")}
                aria-label={`Open chat actions for ${currentThread.title}`}
                aria-haspopup="menu"
                aria-expanded={threadMenuId === currentThread.id && threadMenuSource === "header"}
                aria-controls={threadMenuId === currentThread.id && threadMenuSource === "header" ? `thread-actions-${currentThread.id}` : undefined}
              >
                <MoreHorizontal size={20} />
              </button>
            )}
          </div>
        </header>

        <div className={`${messages.length ? "conversation has-messages" : "conversation"}${isPrivateChat ? " is-private" : ""}`}>
          {!messages.length && !historyLoading ? (
            isPrivateChat ? (
              <section className="welcome private-welcome">
                <div className="welcome-heading-row">
                  <div className="welcome-sigil private-welcome-sigil"><HatGlasses size={30} /></div>
                  <div>
                    <p className="eyebrow">Private chat</p>
                    <p className="welcome-status">Your off-the-record space is ready</p>
                  </div>
                </div>
                <h1>Think freely. <em>Leave no history.</em></h1>
                <p className="welcome-copy">
                  This chat won&apos;t appear in your history and will not be public. When you leave Private mode,
                  the conversation is discarded.
                </p>
                <div className="private-welcome-grid" role="list" aria-label="Private chat behavior">
                  <div role="listitem"><span><History size={18} /></span><strong>No history</strong><small>Nothing is added to your conversations.</small></div>
                  <div role="listitem"><span><ShieldBan size={18} /></span><strong>No AI training</strong><small>Your data will not be used to train models.</small></div>
                  <div role="listitem"><span><LogOut size={18} /></span><strong>Cleared on exit</strong><small>Leaving Private mode discards this chat.</small></div>
                </div>
              </section>
            ) : (
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
            )
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
            <form className={isPrivateChat ? "composer private-chat-composer" : "composer"} onSubmit={(event) => void send(event)}>
              {isPrivateChat && (
                <div className="private-composer-status">
                  <span><HatGlasses size={13} /><strong>Private chat</strong></span>
                  <small>Won&apos;t appear in history or be shareable</small>
                </div>
              )}
              <ImageAttachments
                attachments={attachments}
                onRemove={(id) => void removeAttachment(id)}
              />
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
                ref={composerRef}
                rows={1}
                value={input}
                maxLength={12_000}
                onChange={(event) => resizeComposer(event.target.value)}
                onKeyDown={onComposerKeyDown}
                placeholder={isPrivateChat ? "Ask anything in this private chat." : "Ask anything. I can take it."}
                aria-label="Message Busted Minds AI"
                disabled={pending || (!viewer.authenticated && remaining === 0)}
              />
              <div className="composer-bottom">
                <button
                  className="composer-attachment-button"
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={
                    pending
                    || attachmentPreparing
                    || attachments.length >= MAX_CHAT_ATTACHMENTS
                    || (!viewer.authenticated && remaining === 0)
                  }
                  aria-label="Attach files"
                  title={viewer.authenticated ? "Attach up to 3 images or documents" : "Attach up to 3 images; sign in for documents"}
                >
                  <Paperclip size={17} />
                </button>
                <ChatModePicker key={pending ? "mode-busy" : "mode-ready"} mode={mode} onChange={setMode} disabled={pending} />
                {attachmentPreparing && <span className="image-preparing">Preparing file…</span>}
                <button
                  className="composer-send-button"
                  type="submit"
                  disabled={
                    (!input.trim() && !attachments.length)
                    || pending
                    || attachmentPreparing
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
      {threadActionNotice && (
        <div className="thread-action-notice" role="status">{threadActionNotice}</div>
      )}
      {threadMenuId && menuThread && threadMenuPosition && createPortal(
        <div
          id={`thread-actions-${menuThread.id}`}
          className={threadMenuSource === "header"
            ? "thread-action-menu header-thread-action-menu"
            : "thread-action-menu sidebar-thread-action-menu"}
          ref={threadMenuRef}
          role="menu"
          aria-label={`Actions for ${menuThread.title}`}
          style={{ top: threadMenuPosition.top, left: threadMenuPosition.left }}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              setThreadMenuId(null);
              threadMenuTriggerRef.current?.focus();
              return;
            }
            if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
            event.preventDefault();
            const items = [...event.currentTarget.querySelectorAll<HTMLButtonElement>(
              ":scope > button:not(:disabled), :scope > .thread-project-submenu-anchor > button:not(:disabled)",
            )];
            const currentIndex = items.indexOf(document.activeElement as HTMLButtonElement);
            const nextIndex = event.key === "Home"
              ? 0
              : event.key === "End"
                ? items.length - 1
                : event.key === "ArrowDown"
                  ? (currentIndex + 1) % items.length
                  : (currentIndex - 1 + items.length) % items.length;
            items[nextIndex]?.focus();
          }}
        >
          {threadMenuSource === "header" ? (
            <>
              <button type="button" role="menuitem" onClick={() => {
                setThreadMenuId(null);
                setProjectSubmenuOpen(false);
                setFilesPanelOpen(true);
              }}>
                <Files size={18} /><span>View files in chat</span>
              </button>
              <button type="button" role="menuitem" onClick={() => togglePinnedThread(menuThread.id)}>
                <Pin size={18} /><span>{pinnedThreadIds.has(menuThread.id) ? "Unpin Chat" : "Pin Chat"}</span>
              </button>
              <button type="button" role="menuitem" onClick={() => void archiveThread(menuThread.id)}>
                <Archive size={18} /><span>Archive</span>
              </button>
              <button
                className="danger"
                type="button"
                role="menuitem"
                onClick={() => {
                  if (window.confirm(`Delete “${menuThread.title}”? This cannot be undone.`)) {
                    void deleteThread(menuThread.id);
                  }
                }}
              >
                <Trash2 size={18} /><span>Delete</span>
              </button>
              <div className="thread-action-menu-divider" role="separator" />
              {renderMoveToProjectSubmenu(menuThread)}
            </>
          ) : (
            <>
              <button type="button" role="menuitem" onClick={() => void shareThread(menuThread)}>
                <Share2 size={18} /><span>Share</span>
              </button>
              <button type="button" role="menuitem" onClick={() => void renameThread(menuThread)}>
                <Pencil size={18} /><span>Rename</span>
              </button>
              <button type="button" role="menuitem" onClick={() => togglePinnedThread(menuThread.id)}>
                <Pin size={18} /><span>{pinnedThreadIds.has(menuThread.id) ? "Unpin chat" : "Pin chat"}</span>
              </button>
              <button type="button" role="menuitem" onClick={() => void archiveThread(menuThread.id)}>
                <Archive size={18} /><span>Archive</span>
              </button>
              <button className="danger" type="button" role="menuitem" onClick={() => void deleteThread(menuThread.id)}>
                <Trash2 size={18} /><span>Delete</span>
              </button>
              <div className="thread-action-menu-divider" role="separator" />
              {renderMoveToProjectSubmenu(menuThread)}
            </>
          )}
        </div>,
        document.body,
      )}
      {filesPanelOpen && currentThread && createPortal(
        <div
          className="chat-files-backdrop"
          onPointerDown={(event) => {
            if (event.target === event.currentTarget) setFilesPanelOpen(false);
          }}
        >
          <section className="chat-files-panel" role="dialog" aria-modal="true" aria-labelledby="chat-files-title">
            <header className="chat-files-header">
              <span className="chat-files-header-icon"><Files size={19} /></span>
              <span>
                <strong id="chat-files-title">Files in this chat</strong>
                <small>{chatFileCount ? `${chatFileCount} ${chatFileCount === 1 ? "file" : "files"}` : "No files shared"}</small>
              </span>
              <button type="button" onClick={() => setFilesPanelOpen(false)} aria-label="Close files in chat">
                <X size={18} />
              </button>
            </header>
            <div className="chat-files-content">
              {chatFileGroups.length ? chatFileGroups.map((group) => (
                <section className="chat-files-group" key={group.messageId}>
                  <p>{group.role === "user" ? "You shared" : "Busted Minds AI shared"}</p>
                  <ImageAttachments attachments={group.attachments} />
                </section>
              )) : (
                <div className="chat-files-empty">
                  <span><Files size={24} /></span>
                  <strong>No files in this chat</strong>
                  <p>Images and documents shared in this conversation will appear here.</p>
                </div>
              )}
            </div>
          </section>
        </div>,
        document.body,
      )}
    </main>
  );
}
