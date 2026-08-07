import type { SupabaseClient } from "@supabase/supabase-js";
import type { ChatMessage, ChatThread } from "./types";

type MessageRow = {
  id: string;
  role: "user" | "assistant";
  content: string;
  created_at: string;
};

export function makeThreadTitle(message: string): string {
  const compact = message.replace(/\s+/g, " ").trim();
  if (!compact) return "Untitled thought";
  return compact.length > 54 ? `${compact.slice(0, 51).trimEnd()}…` : compact;
}

export function messageFromRow(row: MessageRow): ChatMessage {
  return { id: row.id, role: row.role, content: row.content, createdAt: row.created_at };
}

export async function listThreads(supabase: SupabaseClient): Promise<ChatThread[]> {
  const { data, error } = await supabase
    .from("chat_threads")
    .select("id,title,updated_at")
    .eq("archived", false)
    .order("updated_at", { ascending: false })
    .limit(100);
  if (error) throw error;
  return (data ?? []).map((row) => ({
    id: row.id as string,
    title: row.title as string,
    updatedAt: row.updated_at as string,
  }));
}

export async function loadThreadMessages(
  supabase: SupabaseClient,
  threadId: string,
): Promise<ChatMessage[]> {
  const { data, error } = await supabase
    .from("chat_messages")
    .select("id,role,content,created_at")
    .eq("thread_id", threadId)
    .order("created_at", { ascending: true })
    .limit(200);
  if (error) throw error;
  return ((data ?? []) as MessageRow[]).map(messageFromRow);
}

