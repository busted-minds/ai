import type { SupportedAttachmentMimeType } from "./attachment-constants";

export type ChatRole = "user" | "assistant";

export type ChatAttachment = {
  id: string;
  name: string;
  mimeType: SupportedAttachmentMimeType;
  size: number;
  url: string;
  storagePath?: string;
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
  projectId: string | null;
  archived?: boolean;
  updatedAt: string;
  messages?: ChatMessage[];
};

export type ChatProject = {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
};

export type Viewer = {
  authenticated: boolean;
  id: string | null;
  email: string | null;
  name: string | null;
  username: string | null;
  centralAccountId: string | null;
};
