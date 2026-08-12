"use client";

import Link from "next/link";
import { BrainCircuit, Check, CornerDownLeft, RotateCcw, Save, Sparkles, Zap } from "lucide-react";
import { useMemo, useState, useSyncExternalStore } from "react";
import { CHAT_MODE_OPTIONS, type ChatMode } from "@/lib/ai/modes";
import {
  DEFAULT_CHAT_PREFERENCES,
  CHAT_PREFERENCES_CHANGE_EVENT,
  CHAT_PREFERENCES_STORAGE_KEY,
  MAX_CUSTOM_INSTRUCTIONS_LENGTH,
  normalizeCustomInstructions,
  parseChatPreferences,
  readChatPreferences,
  writeChatPreferences,
  type ChatPreferences,
} from "@/lib/chat-preferences";
import { readJsonResponse } from "@/lib/client-response";

function ModeIcon({ mode }: { mode: ChatMode }) {
  if (mode === "expert") return <BrainCircuit size={19} />;
  if (mode === "auto") return <Sparkles size={19} />;
  return <Zap size={19} />;
}

function subscribeToPreferences(onChange: () => void) {
  const onStorage = (event: StorageEvent) => {
    if (event.key === CHAT_PREFERENCES_STORAGE_KEY) onChange();
  };
  window.addEventListener(CHAT_PREFERENCES_CHANGE_EVENT, onChange);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(CHAT_PREFERENCES_CHANGE_EVENT, onChange);
    window.removeEventListener("storage", onStorage);
  };
}

function getPreferencesSnapshot() {
  return JSON.stringify(readChatPreferences());
}

type AiPreferencesFormProps = {
  authenticated: boolean;
  customInstructionsAvailable: boolean;
  initialCustomInstructions: string;
  initialPreferences: ChatPreferences;
};

function AiPreferencesForm({
  authenticated,
  customInstructionsAvailable,
  initialCustomInstructions,
  initialPreferences,
}: AiPreferencesFormProps) {
  const preferences = initialPreferences;
  const [instructions, setInstructions] = useState(initialCustomInstructions);
  const [savedInstructions, setSavedInstructions] = useState(initialCustomInstructions);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");

  const updatePreferences = (next: ChatPreferences) => {
    writeChatPreferences(next);
  };

  const normalizedDraft = normalizeCustomInstructions(instructions);
  const instructionsChanged = normalizedDraft !== savedInstructions;
  const canSaveInstructions = authenticated && customInstructionsAvailable;

  const persistInstructions = async (nextInstructions: string) => {
    if (!canSaveInstructions || saving) return;
    setSaving(true);
    setSaveError("");
    try {
      const response = await fetch("/api/ai/preferences", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customInstructions: nextInstructions }),
      });
      const payload = await readJsonResponse<{ customInstructions?: string; message?: string }>(response);
      if (!response.ok || typeof payload.customInstructions !== "string") {
        throw new Error(payload.message ?? "Custom instructions could not be saved.");
      }
      setInstructions(payload.customInstructions);
      setSavedInstructions(payload.customInstructions);
    } catch (caught) {
      setSaveError(caught instanceof Error ? caught.message : "Custom instructions could not be saved.");
    } finally {
      setSaving(false);
    }
  };

  const saveInstructions = () => persistInstructions(normalizedDraft);

  const resetPreferences = async () => {
    updatePreferences(DEFAULT_CHAT_PREFERENCES);
    setInstructions("");
    if (canSaveInstructions && savedInstructions) {
      await persistInstructions("");
    }
  };

  const saveStatus = !authenticated
    ? "Sign in"
    : !customInstructionsAvailable
      ? "Unavailable"
    : saving
      ? "Saving"
      : saveError
        ? "Not saved"
        : instructionsChanged
          ? "Unsaved"
          : "Saved online";

  return (
    <section className="settings-section" id="ai-preferences" aria-labelledby="ai-preferences-heading">
      <div className="settings-section-heading">
        <div>
          <h2 id="ai-preferences-heading">AI preferences</h2>
          <p>Set device defaults and account-synced response guidance.</p>
        </div>
        <span>{saveStatus}</span>
      </div>

      <div className="preference-group">
        <div className="preference-label-row">
          <div>
            <h3>Default model mode</h3>
            <p>New chats open in this response mode. You can still switch modes in the composer.</p>
          </div>
        </div>
        <div className="model-mode-options" role="group" aria-label="Default model mode">
          {CHAT_MODE_OPTIONS.map((option) => (
            <button
              key={option.value}
              className={preferences.defaultMode === option.value
                ? `model-mode-option model-mode-option-${option.value} is-selected`
                : `model-mode-option model-mode-option-${option.value}`}
              type="button"
              aria-pressed={preferences.defaultMode === option.value}
              onClick={() => updatePreferences({ ...preferences, defaultMode: option.value })}
            >
              <span className="model-mode-icon"><ModeIcon mode={option.value} /></span>
              <span>
                <strong>{option.label}</strong>
                <small>{option.description}</small>
              </span>
              <Check className="model-mode-check" size={16} aria-hidden />
            </button>
          ))}
        </div>
      </div>

      <div className="preference-group">
        <div className="preference-label-row">
          <div>
            <label htmlFor="custom-instructions">Custom instructions</label>
            <p>Tell BMAI how to write, what to prioritize, or what it should know about you.</p>
          </div>
          <span>{instructions.length.toLocaleString()} / {MAX_CUSTOM_INSTRUCTIONS_LENGTH.toLocaleString()}</span>
        </div>
        <textarea
          id="custom-instructions"
          className="custom-instructions"
          value={instructions}
          maxLength={MAX_CUSTOM_INSTRUCTIONS_LENGTH}
          rows={6}
          placeholder="Example: Keep answers concise, use TypeScript examples, and explain unfamiliar terms."
          onChange={(event) => setInstructions(event.target.value)}
          disabled={!canSaveInstructions || saving}
        />
        <p className="preference-privacy-note">
          {canSaveInstructions
            ? "Saved securely to your account and applied across your signed-in devices."
            : authenticated
              ? "Your online custom instructions could not be loaded. Refresh this page to try again."
            : <><Link href="/auth/sign-in?next=/settings">Sign in</Link> to save custom instructions securely to your account.</>}
        </p>
        {saveError && <p className="preference-save-error" role="alert">{saveError}</p>}
        <div className="preference-actions">
          <button className="preference-reset-button" type="button" onClick={resetPreferences} disabled={saving}>
            <RotateCcw size={15} /> Reset
          </button>
          <button
            className="preference-save-button"
            type="button"
            onClick={saveInstructions}
            disabled={!canSaveInstructions || !instructionsChanged || saving}
          >
            <Save size={15} /> {!authenticated
              ? "Sign in to save"
              : !customInstructionsAvailable
                ? "Online settings unavailable"
              : saving
                ? "Saving…"
                : instructionsChanged
                  ? "Save instructions"
                  : "Instructions saved online"}
          </button>
        </div>
      </div>

      <div className="preference-toggle-row">
        <span className="preference-toggle-icon"><CornerDownLeft size={18} /></span>
        <span>
          <strong>Press Enter to send</strong>
          <small>Use Shift + Enter for a new line. Touch devices always use the send button.</small>
        </span>
        <button
          className={preferences.enterToSend ? "preference-switch is-on" : "preference-switch"}
          type="button"
          role="switch"
          aria-checked={preferences.enterToSend}
          aria-label="Press Enter to send"
          onClick={() => updatePreferences({ ...preferences, enterToSend: !preferences.enterToSend })}
        >
          <span />
        </button>
      </div>
    </section>
  );
}

export function AiPreferences({
  authenticated,
  customInstructionsAvailable,
  initialCustomInstructions,
}: {
  authenticated: boolean;
  customInstructionsAvailable: boolean;
  initialCustomInstructions: string;
}) {
  const snapshot = useSyncExternalStore(subscribeToPreferences, getPreferencesSnapshot, () => null);
  const preferences = useMemo(() => parseChatPreferences(snapshot), [snapshot]);

  return (
    <AiPreferencesForm
      authenticated={authenticated}
      customInstructionsAvailable={customInstructionsAvailable}
      initialCustomInstructions={initialCustomInstructions}
      initialPreferences={preferences}
    />
  );
}
