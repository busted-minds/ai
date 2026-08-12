export type ChatRole = "user" | "assistant";

export type ChatAttachment = {
  id: string;
  name: string;
  mimeType: "image/jpeg" | "image/png" | "image/webp";
  size: number;
  url: string;
};

export type ChatMessage = {
  id: string;
  role: ChatRole;
  content: string;
  createdAt: string;
  attachments?: ChatAttachment[];
};

export type ChatThread = {
  id: string;
  title: string;
  updatedAt: string;
  messages?: ChatMessage[];
};

export type Viewer = {
  authenticated: boolean;
  id: string | null;
  email: string | null;
  name: string | null;
  username: string | null;
  centralAccountId: string | null;
};
