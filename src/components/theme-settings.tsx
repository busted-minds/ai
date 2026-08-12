"use client";

import { Check, Moon, Sun } from "lucide-react";
import { useSyncExternalStore } from "react";

type Theme = "dark" | "light";

const THEME_STORAGE_KEY = "bmai-theme";
const THEME_CHANGE_EVENT = "bmai-theme-change";

function getTheme(): Theme {
  return document.documentElement.dataset.theme === "light" ? "light" : "dark";
}

function subscribeToTheme(onChange: () => void) {
  window.addEventListener(THEME_CHANGE_EVENT, onChange);
  return () => window.removeEventListener(THEME_CHANGE_EVENT, onChange);
}

function setTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
  localStorage.setItem(THEME_STORAGE_KEY, theme);
  window.dispatchEvent(new Event(THEME_CHANGE_EVENT));
}

export function ThemeSettings() {
  const theme = useSyncExternalStore(subscribeToTheme, getTheme, () => "dark");

  return (
    <section className="settings-section" aria-labelledby="appearance-heading">
      <div className="settings-section-heading">
        <div>
          <h2 id="appearance-heading">Appearance</h2>
          <p>Choose how Busted Minds AI looks on this device.</p>
        </div>
        <span>{theme === "light" ? "Light" : "Dark"}</span>
      </div>
      <div className="appearance-options" role="group" aria-label="Color theme">
        <button
          className={theme === "dark" ? "appearance-option is-selected" : "appearance-option"}
          type="button"
          aria-pressed={theme === "dark"}
          onClick={() => setTheme("dark")}
        >
          <span className="appearance-preview appearance-preview-dark"><Moon size={20} /></span>
          <span><strong>Dark</strong><small>Easy on the eyes in low light.</small></span>
          <Check className="appearance-check" size={17} aria-hidden />
        </button>
        <button
          className={theme === "light" ? "appearance-option is-selected" : "appearance-option"}
          type="button"
          aria-pressed={theme === "light"}
          onClick={() => setTheme("light")}
        >
          <span className="appearance-preview appearance-preview-light"><Sun size={20} /></span>
          <span><strong>Light</strong><small>Bright and clear for daytime.</small></span>
          <Check className="appearance-check" size={17} aria-hidden />
        </button>
      </div>
    </section>
  );
}
