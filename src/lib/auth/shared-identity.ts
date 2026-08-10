import type { User, UserIdentity } from "@supabase/supabase-js";

const bustedMindsProvider = "custom:busted-minds";
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const sharedUsernamePattern = /^[a-zA-Z0-9_]{3,24}$/;

function bustedMindsIdentityData(user: User): Record<string, unknown> | null {
  const identity = user.identities?.find(
    (candidate: UserIdentity) => candidate.provider === bustedMindsProvider,
  );
  return (identity?.identity_data as Record<string, unknown> | undefined) ?? null;
}

export function centralSubjectFromUser(user: User): string | null {
  const identity = user.identities?.find(
    (candidate: UserIdentity) => candidate.provider === bustedMindsProvider,
  );
  const data = identity?.identity_data as Record<string, unknown> | undefined;
  const candidates = [data?.sub, data?.user_id, identity?.identity_id, identity?.id];
  return candidates.find(
    (candidate): candidate is string =>
      typeof candidate === "string" && uuidPattern.test(candidate),
  ) ?? null;
}

export function preferredUsernameFromUser(user: User): string | null {
  const data = bustedMindsIdentityData(user);
  const username = data?.preferred_username;

  // Only the provider-owned identity is trusted. BMAI user_metadata is
  // user-editable and therefore must never be a username source.
  if (
    data?.email_verified !== true ||
    typeof username !== "string" ||
    !sharedUsernamePattern.test(username)
  ) {
    return null;
  }

  return username;
}

export type AccountProfileProjection = {
  id: string;
  central_account_id: string;
  email: string | null;
  display_name: string | null;
  username: string | null;
  updated_at: string;
};

export function accountProfileProjection(
  user: User,
  updatedAt = new Date().toISOString(),
): AccountProfileProjection {
  const centralAccountId = centralSubjectFromUser(user);
  if (!centralAccountId) {
    throw new Error("The Busted Minds Account subject was not present in this session.");
  }

  const metadata = user.user_metadata as Record<string, unknown>;
  const displayName =
    [metadata.full_name, metadata.name, metadata.display_name].find(
      (value): value is string => typeof value === "string" && value.trim().length > 0,
    )?.trim() ?? null;

  return {
    id: user.id,
    central_account_id: centralAccountId,
    email: user.email ?? null,
    display_name: displayName,
    username: preferredUsernameFromUser(user),
    updated_at: updatedAt,
  };
}
