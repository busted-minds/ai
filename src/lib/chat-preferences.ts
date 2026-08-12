import { DEFAULT_CHAT_MODE, normalizeChatMode, type ChatMode } from "./ai/modes";

export const CHAT_PREFERENCES_STORAGE_KEY = "bmai-chat-preferences-v1";
export const CHAT_PREFERENCES_CHANGE_EVENT = "bmai-chat-preferences-change";
export const MAX_CUSTOM_INSTRUCTIONS_LENGTH = 4_000;

export type ChatPreferences = {
  defaultMode: ChatMode;
  enterToSend: boolean;
};

export const DEFAULT_CHAT_PREFERENCES: ChatPreferences = {
  defaultMode: DEFAULT_CHAT_MODE,
  enterToSend: true,
};

export function normalizeCustomInstructions(value: unknown): string {
  return typeof value === "string"
    ? value.trim().slice(0, MAX_CUSTOM_INSTRUCTIONS_LENGTH)
    : "";
}

export function parseChatPreferences(value: string | null): ChatPreferences {
  if (!value) return DEFAULT_CHAT_PREFERENCES;

  try {
    const parsed = JSON.parse(value) as Partial<Record<keyof ChatPreferences, unknown>>;
    return {
      defaultMode: normalizeChatMode(parsed.defaultMode),
      enterToSend: typeof parsed.enterToSend === "boolean" ? parsed.enterToSend : true,
    };
  } catch {
    return DEFAULT_CHAT_PREFERENCES;
  }
}

export function readChatPreferences(): ChatPreferences {
  if (typeof window === "undefined") return DEFAULT_CHAT_PREFERENCES;
  const stored = localStorage.getItem(CHAT_PREFERENCES_STORAGE_KEY);
  const preferences = parseChatPreferences(stored);
  const sanitized = JSON.stringify(preferences);
  if (stored !== sanitized) {
    // Earlier versions put custom instructions in this object. Rewriting it
    // ensures that account-only data is removed from local storage.
    localStorage.setItem(CHAT_PREFERENCES_STORAGE_KEY, sanitized);
  }
  return preferences;
}

export function writeChatPreferences(preferences: ChatPreferences): void {
  localStorage.setItem(CHAT_PREFERENCES_STORAGE_KEY, JSON.stringify(preferences));
  window.dispatchEvent(new Event(CHAT_PREFERENCES_CHANGE_EVENT));
}
