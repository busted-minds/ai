import type { SupabaseClient } from "@supabase/supabase-js";
import type { ChatMessage, ChatProject, ChatThread } from "./types";
import { parseStoredAttachments, storedAttachmentForClient } from "./chat-attachments";
import { activeMessagePath } from "./chat-branches";

type MessageRow = {
  id: string;
  role: "user" | "assistant";
  content: string;
  created_at: string;
  attachments?: unknown;
  parent_message_id?: string | null;
};

export function makeThreadTitle(message: string): string {
  const compact = message.replace(/\s+/g, " ").trim();
  if (!compact) return "Untitled thought";
  return compact.length > 54 ? `${compact.slice(0, 51).trimEnd()}…` : compact;
}

export function messageFromRow(row: MessageRow): ChatMessage {
  const attachments = parseStoredAttachments(row.attachments)
    .map((attachment) => storedAttachmentForClient(row.id, attachment));
  return {
    id: row.id,
    role: row.role,
    content: row.content,
    createdAt: row.created_at,
    parentId: row.parent_message_id ?? null,
    ...(attachments.length ? { attachments } : {}),
  };
}

export async function listThreads(supabase: SupabaseClient): Promise<ChatThread[]> {
  const { data, error } = await supabase
    .from("chat_threads")
    .select("id,title,project_id,updated_at")
    .eq("archived", false)
    .order("updated_at", { ascending: false })
    .limit(100);
  if (error) throw error;
  return (data ?? []).map((row) => ({
    id: row.id as string,
    title: row.title as string,
    projectId: row.project_id as string | null,
    updatedAt: row.updated_at as string,
  }));
}

export async function listProjects(supabase: SupabaseClient): Promise<ChatProject[]> {
  const { data, error } = await supabase
    .from("chat_projects")
    .select("id,name,created_at,updated_at")
    .order("created_at", { ascending: true })
    .limit(100);
  if (error) throw error;
  return (data ?? []).map((row) => ({
    id: row.id as string,
    name: row.name as string,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  }));
}

export async function loadThreadMessages(
  supabase: SupabaseClient,
  threadId: string,
): Promise<ChatMessage[]> {
  return (await loadThreadConversation(supabase, threadId)).messages;
}

export async function loadThreadConversation(
  supabase: SupabaseClient,
  threadId: string,
  requestedActiveLeafId?: string | null,
): Promise<{ messages: ChatMessage[]; allMessages: ChatMessage[]; activeLeafId: string | null }> {
  let activeLeafId = requestedActiveLeafId;
  if (activeLeafId === undefined) {
    const { data: thread, error: threadError } = await supabase
      .from("chat_threads")
      .select("active_leaf_id")
      .eq("id", threadId)
      .maybeSingle();
    if (threadError) throw threadError;
    activeLeafId = thread?.active_leaf_id ?? null;
  }
  const { data, error } = await supabase
    .from("chat_messages")
    .select("id,role,content,attachments,parent_message_id,created_at")
    .eq("thread_id", threadId)
    .order("created_at", { ascending: true })
    .limit(1000);
  if (error) throw error;
  const allMessages = ((data ?? []) as MessageRow[]).map(messageFromRow);
  const resolvedLeafId = activeLeafId && allMessages.some(({ id }) => id === activeLeafId)
    ? activeLeafId
    : allMessages.at(-1)?.id ?? null;
  return {
    messages: activeMessagePath(allMessages, resolvedLeafId),
    allMessages,
    activeLeafId: resolvedLeafId,
  };
}
