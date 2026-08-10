import type { User } from "@supabase/supabase-js";
import {
  accountProfileProjection,
  centralSubjectFromUser,
  preferredUsernameFromUser,
} from "@/lib/auth/shared-identity";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Viewer } from "@/lib/types";

export { centralSubjectFromUser, preferredUsernameFromUser } from "@/lib/auth/shared-identity";

export async function synchronizeAccountProfile(user: User): Promise<string> {
  const projection = accountProfileProjection(user);
  const supabase = createSupabaseAdminClient();
  const { error } = await supabase.from("account_profiles").upsert(
    projection,
    { onConflict: "id" },
  );
  if (error) throw error;
  return projection.central_account_id;
}

export async function loadViewer(): Promise<Viewer> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user || data.user.is_anonymous) {
      return { authenticated: false, id: null, email: null, name: null, username: null, centralAccountId: null };
    }

    const centralAccountId = centralSubjectFromUser(data.user);
    const oidcUsername = preferredUsernameFromUser(data.user);
    const { data: profile } = await supabase
      .from("account_profiles")
      .select("central_account_id,username")
      .eq("id", data.user.id)
      .maybeSingle();
    const storedUsername = typeof profile?.username === "string" ? profile.username : null;

    if (centralAccountId && oidcUsername && storedUsername !== oidcUsername) {
      try {
        await synchronizeAccountProfile(data.user);
      } catch {
        // The verified OIDC claim can still be shown for this request. The
        // callback and live backfill remain the durable synchronization paths.
      }
    }

    const metadata = data.user.user_metadata as Record<string, unknown>;
    const name = [metadata.full_name, metadata.name, metadata.display_name].find(
      (value): value is string => typeof value === "string" && value.trim().length > 0,
    ) ?? null;
    return {
      authenticated: true,
      id: data.user.id,
      email: data.user.email ?? null,
      name,
      username: oidcUsername ?? storedUsername,
      centralAccountId:
        centralAccountId ??
        (typeof profile?.central_account_id === "string" ? profile.central_account_id : null),
    };
  } catch {
    return { authenticated: false, id: null, email: null, name: null, username: null, centralAccountId: null };
  }
}
