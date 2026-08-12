import { describe, expect, it } from "vitest";
import { CHAT_SHARE_TOKEN_PATTERN, sharedChatFromRow } from "@/lib/chat-sharing";

const token = "a".repeat(48);

describe("shared conversations", () => {
  it("accepts a bounded immutable snapshot", () => {
    const chat = sharedChatFromRow(token, {
      title: "A useful conversation",
      owner_user_id: "7d249434-7bc8-4c61-b61f-d7c62a65a789",
      source_thread_id: "e480fb04-e799-4874-ab36-56956d9e146a",
      created_at: "2026-08-12T04:00:00.000Z",
      messages: [
        { role: "user", content: "Explain this", attachments: [] },
        {
          role: "assistant",
          content: "Here is the explanation.",
          attachments: [],
        },
        {
          role: "user",
          content: "",
          attachments: [{ name: "diagram.png", mimeType: "image/png", size: 2048 }],
        },
      ],
    });

    expect(CHAT_SHARE_TOKEN_PATTERN.test(token)).toBe(true);
    expect(chat).toMatchObject({
      token,
      title: "A useful conversation",
      messages: [{ role: "user" }, { role: "assistant" }, { role: "user" }],
    });
  });

  it("rejects malformed tokens, roles, and attachment metadata", () => {
    const base = {
      title: "Conversation",
      owner_user_id: "7d249434-7bc8-4c61-b61f-d7c62a65a789",
      source_thread_id: null,
      created_at: "2026-08-12T04:00:00.000Z",
    };
    expect(sharedChatFromRow("guessable", { ...base, messages: [] })).toBeNull();
    expect(sharedChatFromRow(token, {
      ...base,
      messages: [{ role: "system", content: "hidden", attachments: [] }],
    })).toBeNull();
    expect(sharedChatFromRow(token, {
      ...base,
      messages: [{
        role: "user",
        content: "file",
        attachments: [{ name: "file.exe", mimeType: "application/x-msdownload", size: 10 }],
      }],
    })).toBeNull();
  });
});
