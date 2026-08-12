"use client";

export async function readJsonResponse<T>(response: Response): Promise<T> {
  const raw = await response.text();
  if (raw) {
    try {
      return JSON.parse(raw) as T;
    } catch {
      // Fall through to a useful HTTP error instead of exposing JSON.parse internals.
    }
  }

  const status = response.status ? ` (${response.status})` : "";
  throw new Error(
    response.ok
      ? "The server returned an empty response. Try again."
      : `The server could not complete that request${status}. Check the server log and try again.`,
  );
}
