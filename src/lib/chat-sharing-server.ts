import "server-only";

import { cache } from "react";
import { CHAT_SHARE_TOKEN_PATTERN, sharedChatFromRow } from "./chat-sharing";
import { createSupabaseAdminClient } from "./supabase/admin";

export const loadSharedChat = cache(async (token: string) => {
  if (!CHAT_SHARE_TOKEN_PATTERN.test(token)) return null;
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from("chat_shares")
    .select("owner_user_id,source_thread_id,title,messages,created_at")
    .eq("token", token)
    .maybeSingle();
  if (error || !data) return null;
  return sharedChatFromRow(token, data);
});
