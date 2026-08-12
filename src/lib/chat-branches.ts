import type { ChatMessage } from "./types";

function compareMessages(first: ChatMessage, second: ChatMessage) {
  const timeDifference = Date.parse(first.createdAt) - Date.parse(second.createdAt);
  return timeDifference || first.id.localeCompare(second.id);
}

export function normalizeMessageGraph(messages: ChatMessage[]): ChatMessage[] {
  let previousId: string | null = null;
  return messages.map((message) => {
    const hasParent = Object.prototype.hasOwnProperty.call(message, "parentId");
    const normalized = {
      ...message,
      parentId: hasParent ? message.parentId ?? null : previousId,
    };
    previousId = message.id;
    return normalized;
  });
}

export function activeMessagePath(
  messages: ChatMessage[],
  activeLeafId?: string | null,
): ChatMessage[] {
  if (!messages.length) return [];
  const normalized = normalizeMessageGraph(messages);
  const byId = new Map(normalized.map((message) => [message.id, message]));
  let current = (activeLeafId ? byId.get(activeLeafId) : undefined)
    ?? [...normalized].sort(compareMessages).at(-1);
  const reversed: ChatMessage[] = [];
  const visited = new Set<string>();

  while (current && !visited.has(current.id)) {
    reversed.push(current);
    visited.add(current.id);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }

  return reversed.reverse();
}

export function siblingMessages(messages: ChatMessage[], messageId: string): ChatMessage[] {
  const normalized = normalizeMessageGraph(messages);
  const selected = normalized.find((message) => message.id === messageId);
  if (!selected) return [];
  return normalized
    .filter((message) => message.role === selected.role && message.parentId === selected.parentId)
    .sort(compareMessages);
}

export function newestLeafForBranch(messages: ChatMessage[], branchMessageId: string): string | null {
  const normalized = normalizeMessageGraph(messages);
  if (!normalized.some((message) => message.id === branchMessageId)) return null;
  const children = new Map<string, ChatMessage[]>();
  for (const message of normalized) {
    if (!message.parentId) continue;
    children.set(message.parentId, [...(children.get(message.parentId) ?? []), message]);
  }

  const descendants: ChatMessage[] = [];
  const pending = [branchMessageId];
  const visited = new Set<string>();
  while (pending.length) {
    const id = pending.pop();
    if (!id || visited.has(id)) continue;
    visited.add(id);
    const message = normalized.find((candidate) => candidate.id === id);
    if (message) descendants.push(message);
    for (const child of children.get(id) ?? []) pending.push(child.id);
  }

  const descendantIds = new Set(descendants.map(({ id }) => id));
  const leaves = descendants.filter((message) =>
    !(children.get(message.id) ?? []).some((child) => descendantIds.has(child.id)));
  return [...leaves].sort(compareMessages).at(-1)?.id ?? branchMessageId;
}
