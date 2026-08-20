import { NextResponse } from "next/server";

const SEARCH_ORIGIN = "https://search.bustedminds.org";
const LOCAL_SEARCH_ORIGIN = /^http:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?$/;

export function safeSearchReturn(value: string | null | undefined): URL {
  const fallback = new URL(SEARCH_ORIGIN);
  if (!value) return fallback;

  try {
    const destination = new URL(value);
    const localDevelopmentReturn = process.env.NODE_ENV !== "production"
      && LOCAL_SEARCH_ORIGIN.test(destination.origin);
    if (destination.origin !== SEARCH_ORIGIN && !localDevelopmentReturn) return fallback;
    if (destination.username || destination.password) return fallback;
    return destination;
  } catch {
    return fallback;
  }
}

export function GET(request: Request) {
  const url = new URL(request.url);
  return NextResponse.redirect(safeSearchReturn(url.searchParams.get("return")), 303);
}
