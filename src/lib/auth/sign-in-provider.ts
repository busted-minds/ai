export const BUSTED_MINDS_AI_PROVIDER = "custom:busted-minds" as const;
export const BUSTED_MINDS_SEARCH_PROVIDER = "custom:busted-minds-search" as const;

export function accountProviderForSignIn(
  source: string | null,
  nextPath: string,
): typeof BUSTED_MINDS_AI_PROVIDER | typeof BUSTED_MINDS_SEARCH_PROVIDER {
  return source === "search" && nextPath.startsWith("/auth/search-return?")
    ? BUSTED_MINDS_SEARCH_PROVIDER
    : BUSTED_MINDS_AI_PROVIDER;
}
