import { safeNextPath } from "@/lib/security";

export const BUSTED_MINDS_ACCOUNT_ORIGIN = "https://accounts.bustedminds.org";
export const BUSTED_MINDS_AI_ORIGIN = "https://ai.bustedminds.org";

export function accountSignInHref(nextPath = "/"): string {
  const params = new URLSearchParams({ next: safeNextPath(nextPath) });
  return `/auth/sign-in?${params.toString()}`;
}

export function accountRegistrationHref(nextPath = "/"): string {
  const safeDestination = safeNextPath(nextPath);
  const continuation = new URL("/account/connect/bmai", BUSTED_MINDS_ACCOUNT_ORIGIN);
  continuation.searchParams.set("next", safeDestination);
  continuation.searchParams.set("origin", BUSTED_MINDS_AI_ORIGIN);

  const registration = new URL("/auth", BUSTED_MINDS_ACCOUNT_ORIGIN);
  registration.searchParams.set("mode", "register");
  registration.searchParams.set("source", "bmai");
  registration.searchParams.set(
    "next",
    `${continuation.pathname}${continuation.search}`,
  );
  return registration.toString();
}
