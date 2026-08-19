import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  resetWebSearchStateForTests,
  searchWeb,
  shouldUseWebSearch,
  webSearchQuery,
} from "@/lib/ai/web-search";

const SEARCH_ENV_NAMES = [
  "BRAVESEARACH_SEARCH_KEY",
  "BRAVESEARACH_ANSWER_KEY",
  "BRAVESEARCH_SEARCH_KEY",
  "BRAVESEARCH_ANSWER_KEY",
  "TAVILY_SEARCH_KEY1",
  "TAVILY_SEARCH_KEY2",
  "EXA_SEARCH_KEY",
  "GOOGLE_API_KEY",
  "GOOGLE_SEARCH_API_KEY1",
  "GOOGLE_SEARCH_API_KEY2",
  "GOOGLE_CSE_ID",
  "GOOGLE_SEARCH_DAILY_LIMIT",
  "WEB_SEARCH_CACHE_TTL_MS",
] as const;

const originalEnvironment = Object.fromEntries(
  SEARCH_ENV_NAMES.map((name) => [name, process.env[name]]),
);

function clearSearchEnvironment() {
  SEARCH_ENV_NAMES.forEach((name) => delete process.env[name]);
}

function jsonResponse(payload: unknown, status = 200, headers?: HeadersInit) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

beforeEach(() => {
  clearSearchEnvironment();
  resetWebSearchStateForTests();
});

afterEach(() => {
  clearSearchEnvironment();
  Object.entries(originalEnvironment).forEach(([name, value]) => {
    if (value !== undefined) process.env[name] = value;
  });
  vi.unstubAllGlobals();
});

describe("web search routing", () => {
  it("recognizes freshness requests and creates a Brave-safe query", () => {
    expect(shouldUseWebSearch("What is the latest Node.js version?")).toBe(true);
    expect(shouldUseWebSearch("Explain recursion with an analogy")).toBe(false);
    expect(webSearchQuery("Please search the web for the current USD JPY exchange rate"))
      .toBe("the current USD JPY exchange rate");
    expect(webSearchQuery(`search the web for ${"word ".repeat(100)}`).split(" ")).toHaveLength(50);
  });

  it("falls through failed and empty providers while keeping Tavily on its one-credit mode", async () => {
    process.env.BRAVESEARACH_SEARCH_KEY = "brave-search";
    process.env.BRAVESEARACH_ANSWER_KEY = "brave-answer";
    process.env.TAVILY_SEARCH_KEY1 = "tavily-one";
    process.env.TAVILY_SEARCH_KEY2 = "tavily-two";

    const calls: Array<{ authorization: string; body: UnknownRecord; url: string }> = [];
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      const headers = new Headers(init?.headers);
      const body = init?.body ? JSON.parse(String(init.body)) as UnknownRecord : {};
      calls.push({ url, body, authorization: headers.get("authorization") ?? "" });
      if (url.includes("/web/search")) return jsonResponse({ error: { message: "quota reached" } }, 429);
      if (url.includes("/chat/completions")) return jsonResponse({ error: { message: "temporary" } }, 503);
      if (headers.get("authorization") === "Bearer tavily-one") return jsonResponse({ results: [] });
      return jsonResponse({
        results: [{
          title: "Official result",
          url: "https://example.com/current",
          content: "The current answer from a source.",
          published_date: "2026-08-19",
        }],
      });
    }));

    const result = await searchWeb("latest example update");

    expect(result.provider).toBe("Tavily 2");
    expect(result.attemptedProviders).toEqual([
      "Brave Search",
      "Brave Answers",
      "Tavily 1",
      "Tavily 2",
    ]);
    expect(result.context).toContain("https://example.com/current");
    const tavilyBodies = calls.filter(({ url }) => url === "https://api.tavily.com/search").map(({ body }) => body);
    expect(tavilyBodies).toHaveLength(2);
    expect(tavilyBodies.every((body) => (
      body.search_depth === "basic"
      && body.auto_parameters === false
      && body.include_answer === false
    ))).toBe(true);
  });

  it("uses the separate Brave Answers key when Brave Search is unavailable", async () => {
    process.env.BRAVESEARACH_SEARCH_KEY = "search-key";
    process.env.BRAVESEARACH_ANSWER_KEY = "answer-key";
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/web/search")) return jsonResponse({}, 429);
      expect(new Headers(init?.headers).get("x-subscription-token")).toBe("answer-key");
      return jsonResponse({
        choices: [{
          message: {
            content: "Grounded answer from [Example](https://example.com/source).",
          },
        }],
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await searchWeb("current example facts");

    expect(result.provider).toBe("Brave Answers");
    expect(result.context).toContain("https://example.com/source");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("uses Exa instant search with bounded highlights for grounding", async () => {
    process.env.EXA_SEARCH_KEY = "exa-key";
    const fetchMock = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as UnknownRecord;
      expect(body).toMatchObject({
        type: "instant",
        numResults: 6,
        contents: { highlights: { maxCharacters: 1_000 } },
      });
      return jsonResponse({
        results: [{
          title: "Exa source",
          url: "https://example.com/exa",
          highlights: ["Relevant extracted passage."],
        }],
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await searchWeb("find an Exa source");

    expect(result.provider).toBe("Exa");
    expect(result.context).toContain("Relevant extracted passage.");
  });

  it("keeps the Gemini key out of Google Search and tries the two search keys last", async () => {
    process.env.GOOGLE_API_KEY = "gemini-only";
    process.env.GOOGLE_SEARCH_API_KEY1 = "search-one";
    process.env.GOOGLE_SEARCH_API_KEY2 = "search-two";
    process.env.GOOGLE_CSE_ID = "engine-id";
    const requestedKeys: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      requestedKeys.push(url.searchParams.get("key") ?? "");
      if (url.searchParams.get("key") === "search-one") return jsonResponse({}, 429);
      return jsonResponse({
        items: [{ title: "Google result", link: "https://example.com/google", snippet: "Result snippet" }],
      });
    }));

    const result = await searchWeb("look up a Google fallback result");

    expect(result.provider).toBe("Google Custom Search 2");
    expect(requestedKeys).toEqual(["search-one", "search-two"]);
    expect(requestedKeys).not.toContain("gemini-only");
  });

  it("caches successful identical searches to preserve free quota", async () => {
    process.env.BRAVESEARACH_SEARCH_KEY = "brave-search";
    const fetchMock = vi.fn(async () => jsonResponse({
      web: { results: [{ title: "Cached", url: "https://example.com/cache", description: "Reusable" }] },
    }));
    vi.stubGlobal("fetch", fetchMock);

    const first = await searchWeb("latest cache example");
    const second = await searchWeb("latest cache example");

    expect(second).toEqual(first);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

type UnknownRecord = Record<string, unknown>;
