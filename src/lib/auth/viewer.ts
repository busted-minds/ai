import type { User, UserIdentity } from "@supabase/supabase-js";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Viewer } from "@/lib/types";

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function centralSubjectFromUser(user: User): string | null {
  const identity = user.identities?.find(
    (candidate: UserIdentity) => candidate.provider === "custom:busted-minds",
  );
  const data = identity?.identity_data as Record<string, unknown> | undefined;
  const candidates = [data?.sub, data?.user_id, identity?.identity_id, identity?.id];
  return candidates.find(
    (candidate): candidate is string =>
      typeof candidate === "string" && uuidPattern.test(candidate),
  ) ?? null;
}

export async function synchronizeAccountProfile(user: User): Promise<string> {
  const centralAccountId = centralSubjectFromUser(user);
  if (!centralAccountId) {
    throw new Error("The Busted Minds Account subject was not present in this session.");
  }

  const supabase = await createSupabaseServerClient();
  const metadata = user.user_metadata as Record<string, unknown>;
  const displayName =
    [metadata.full_name, metadata.name, metadata.display_name].find(
      (value): value is string => typeof value === "string" && value.trim().length > 0,
    )?.trim() ?? null;
  const { error } = await supabase.from("account_profiles").upsert(
    {
      id: user.id,
      central_account_id: centralAccountId,
      email: user.email ?? null,
      display_name: displayName,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "id" },
  );
  if (error) throw error;
  return centralAccountId;
}

export async function loadViewer(): Promise<Viewer> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user || data.user.is_anonymous) {
      return { authenticated: false, id: null, email: null, name: null, centralAccountId: null };
    }

    const centralAccountId = centralSubjectFromUser(data.user);
    const metadata = data.user.user_metadata as Record<string, unknown>;
    const name = [metadata.full_name, metadata.name, metadata.display_name].find(
      (value): value is string => typeof value === "string" && value.trim().length > 0,
    ) ?? null;
    return {
      authenticated: true,
      id: data.user.id,
      email: data.user.email ?? null,
      name,
      centralAccountId,
    };
  } catch {
    return { authenticated: false, id: null, email: null, name: null, centralAccountId: null };
  }
}

