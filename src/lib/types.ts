export type ChatRole = "user" | "assistant";

export type ChatMessage = {
  id: string;
  role: ChatRole;
  content: string;
  createdAt: string;
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
