"use client";

import { useEffect } from "react";
import { Check } from "lucide-react";

export function WidgetAuthComplete() {
  useEffect(() => {
    window.opener?.postMessage({ type: "bmai:auth-complete" }, window.location.origin);
    const timer = window.setTimeout(() => window.close(), 500);
    return () => window.clearTimeout(timer);
  }, []);

  return (
    <main className="widget-auth-complete">
      <span><Check size={24} /></span>
      <strong>You’re signed in.</strong>
      <p>Returning you to the conversation…</p>
    </main>
  );
}
