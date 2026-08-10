import type { User } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import {
  accountProfileProjection,
  centralSubjectFromUser,
  preferredUsernameFromUser,
} from "@/lib/auth/shared-identity";

const centralAccountId = "0f349592-78c2-4d75-aa3e-401b83c68cc0";

function userWithIdentity(identityData: Record<string, unknown>): User {
  return {
    id: "fb2203f1-adfc-49ab-8da3-61b8807960fb",
    email: "mind@example.com",
    is_anonymous: false,
    user_metadata: {
      full_name: "  Ada Mind  ",
      preferred_username: "spoofed_in_bmai",
    },
    identities: [{
      id: centralAccountId,
      identity_id: centralAccountId,
      provider: "custom:busted-minds",
      identity_data: identityData,
      user_id: "fb2203f1-adfc-49ab-8da3-61b8807960fb",
      created_at: "2026-08-10T00:00:00.000Z",
      updated_at: "2026-08-10T00:00:00.000Z",
      last_sign_in_at: "2026-08-10T00:00:00.000Z",
    }],
  } as unknown as User;
}

describe("shared Busted Minds identity", () => {
  it("projects the verified OIDC preferred_username into the BMAI profile", () => {
    const user = userWithIdentity({
      sub: centralAccountId,
      email_verified: true,
      preferred_username: "Ada_Mind",
    });

    expect(centralSubjectFromUser(user)).toBe(centralAccountId);
    expect(preferredUsernameFromUser(user)).toBe("Ada_Mind");
    expect(accountProfileProjection(user, "2026-08-10T01:02:03.000Z")).toEqual({
      id: user.id,
      central_account_id: centralAccountId,
      email: "mind@example.com",
      display_name: "Ada Mind",
      username: "Ada_Mind",
      updated_at: "2026-08-10T01:02:03.000Z",
    });
  });

  it("ignores user-editable BMAI metadata and unverified provider claims", () => {
    expect(preferredUsernameFromUser(userWithIdentity({
      sub: centralAccountId,
      email_verified: false,
      preferred_username: "central_name",
    }))).toBeNull();

    expect(preferredUsernameFromUser(userWithIdentity({
      sub: centralAccountId,
      email_verified: true,
      preferred_username: "not a valid handle",
    }))).toBeNull();

    expect(preferredUsernameFromUser(userWithIdentity({
      sub: centralAccountId,
      email_verified: true,
    }))).toBeNull();
  });

  it("does not accept a subject or username from another provider", () => {
    const user = userWithIdentity({
      sub: centralAccountId,
      email_verified: true,
      preferred_username: "central_name",
    });
    user.identities![0].provider = "google";

    expect(centralSubjectFromUser(user)).toBeNull();
    expect(preferredUsernameFromUser(user)).toBeNull();
  });
});
