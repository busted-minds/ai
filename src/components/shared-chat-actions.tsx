"use client";

import { ArrowRight, LoaderCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { readJsonResponse } from "@/lib/client-response";

export function ContinueSharedChatButton({ token }: { token: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  const continueChat = async () => {
    if (pending) return;
    setPending(true);
    setError("");
    try {
      const response = await fetch(`/api/shares/${encodeURIComponent(token)}/continue`, {
        method: "POST",
      });
      const payload = await readJsonResponse<{ threadId?: string; message?: string }>(response);
      if (!response.ok || !payload.threadId) {
        throw new Error(payload.message ?? "This conversation could not be copied.");
      }
      router.push(`/?thread=${encodeURIComponent(payload.threadId)}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "This conversation could not be copied.");
      setPending(false);
    }
  };

  return (
    <div className="shared-chat-continue">
      <button type="button" onClick={() => void continueChat()} disabled={pending}>
        {pending ? <LoaderCircle className="shared-chat-spinner" size={18} /> : <ArrowRight size={18} />}
        <span>{pending ? "Creating your private copy…" : "Continue in my chat"}</span>
      </button>
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
