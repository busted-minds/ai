import {
  duckDuckGoQuery,
  searchDuckDuckGo,
  shouldUseDuckDuckGo,
} from "./duckduckgo";

export type WebSearchResult = {
  attemptedProviders: string[];
  context: string;
  provider: string;
  resultCount: number;
};

type SearchItem = {
  publishedAt?: string;
  snippet: string;
  title: string;
  url: string;
};

type ProviderResult = {
  answer?: string;
  items: SearchItem[];
};

type SearchProvider = {
  id: string;
  label: string;
  search: (query: string, signal: AbortSignal) => Promise<ProviderResult>;
};

type UnknownRecord = Record<string, unknown>;

const MAX_CONTEXT_CHARACTERS = 9_000;
const MAX_QUERY_CHARACTERS = 400;
const MAX_QUERY_WORDS = 50;
const PER_PROVIDER_TIMEOUT_MS = 4_500;
const DEFAULT_CACHE_TTL_MS = 5 * 60 * 1_000;
const MAX_CACHE_ENTRIES = 100;

const providerCooldowns = new Map<string, number>();
const resultCache = new Map<string, { expiresAt: number; result: WebSearchResult }>();
const pendingSearches = new Map<string, Promise<WebSearchResult>>();

class SearchProviderError extends Error {
  retryAfterMs?: number;
  status: number;

  constructor(status: number, message: string, retryAfterMs?: number) {
    super(message);
    this.name = "SearchProviderError";
    this.status = status;
    this.retryAfterMs = retryAfterMs;
  }
}

function record(value: unknown): UnknownRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as UnknownRecord
    : null;
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function text(value: unknown, maximum = 2_000): string {
  if (typeof value !== "string") return "";
  return value
    .replace(/<[^>]*>/g, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, "\"")
    .replace(/&#(?:39|x27);/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maximum);
}

function safeUrl(value: unknown): string {
  const candidate = text(value, 2_048);
  try {
    const parsed = new URL(candidate);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.toString() : "";
  } catch {
    return "";
  }
}

function searchItem(value: unknown, fields: {
  publishedAt?: string;
  snippet: string;
  title: string;
  url: string;
}): SearchItem | null {
  const item = record(value);
  if (!item) return null;
  const url = safeUrl(item[fields.url]);
  if (!url) return null;
  return {
    title: text(item[fields.title], 300) || new URL(url).hostname,
    url,
    snippet: text(item[fields.snippet], 1_500),
    ...(fields.publishedAt && text(item[fields.publishedAt], 100)
      ? { publishedAt: text(item[fields.publishedAt], 100) }
      : {}),
  };
}

function uniqueItems(items: Array<SearchItem | null>, maximum = 8): SearchItem[] {
  return items
    .filter((item): item is SearchItem => Boolean(item))
    .filter((item, index, candidates) => (
      candidates.findIndex((candidate) => candidate.url === item.url) === index
    ))
    .slice(0, maximum);
}

function queryForProviders(message: string): string {
  const normalized = duckDuckGoQuery(message) || message.trim();
  return normalized
    .split(/\s+/)
    .slice(0, MAX_QUERY_WORDS)
    .join(" ")
    .slice(0, MAX_QUERY_CHARACTERS)
    .trim();
}

function configuredValue(...names: string[]): string {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) return value;
  }
  return "";
}

function retryAfterMs(response: Response): number | undefined {
  const value = response.headers.get("retry-after");
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1_000;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? Math.max(0, timestamp - Date.now()) : undefined;
}

async function responseError(response: Response): Promise<SearchProviderError> {
  let detail = "";
  try {
    const payload = record(await response.json());
    const error = record(payload?.error);
    const nestedDetail = record(payload?.detail);
    detail = text(
      error?.message
        ?? error?.status
        ?? nestedDetail?.error
        ?? payload?.message
        ?? payload?.detail,
      240,
    );
  } catch {
    // Status and retry headers are enough to make a fallback decision.
  }
  return new SearchProviderError(
    response.status,
    detail || `Search provider returned ${response.status}`,
    retryAfterMs(response),
  );
}

async function jsonRequest(url: string | URL, init: RequestInit): Promise<UnknownRecord> {
  const response = await fetch(url, { ...init, cache: "no-store" });
  if (!response.ok) throw await responseError(response);
  const payload = record(await response.json());
  if (!payload) throw new SearchProviderError(502, "Search provider returned an invalid response");
  return payload;
}

function openAIAnswer(payload: UnknownRecord): string {
  const choice = record(array(payload.choices)[0]);
  const message = record(choice?.message);
  const content = message?.content;
  if (typeof content === "string") return text(content, 5_000);
  return array(content)
    .map((part) => text(record(part)?.text, 2_000))
    .filter(Boolean)
    .join("\n")
    .slice(0, 5_000);
}

function answerLinks(answer: string): SearchItem[] {
  const markdown = [...answer.matchAll(/\[([^\]]+)]\((https?:\/\/[^\s)]+)\)/g)].map((match) => ({
    title: text(match[1], 300),
    url: safeUrl(match[2]),
    snippet: "",
  }));
  const bare = [...answer.matchAll(/https?:\/\/[^\s)\]]+/g)].map((match) => ({
    title: "Source",
    url: safeUrl(match[0].replace(/[.,;:!?]+$/, "")),
    snippet: "",
  }));
  return uniqueItems([...markdown, ...bare]);
}

async function braveSearch(apiKey: string, query: string, signal: AbortSignal): Promise<ProviderResult> {
  const url = new URL("https://api.search.brave.com/res/v1/web/search");
  url.search = new URLSearchParams({
    q: query,
    count: "8",
    result_filter: "web",
    safesearch: "moderate",
    text_decorations: "false",
  }).toString();
  const payload = await jsonRequest(url, {
    headers: {
      Accept: "application/json",
      "X-Subscription-Token": apiKey,
    },
    signal,
  });
  const web = record(payload.web);
  return {
    items: uniqueItems(array(web?.results).map((item) => searchItem(item, {
      title: "title",
      url: "url",
      snippet: "description",
      publishedAt: "age",
    }))),
  };
}

async function braveAnswer(apiKey: string, query: string, signal: AbortSignal): Promise<ProviderResult> {
  const payload = await jsonRequest("https://api.search.brave.com/res/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Subscription-Token": apiKey,
    },
    body: JSON.stringify({
      model: "brave",
      messages: [{ role: "user", content: query }],
      stream: false,
    }),
    signal,
  });
  const answer = openAIAnswer(payload);
  return { answer, items: answerLinks(answer) };
}

async function tavilySearch(apiKey: string, query: string, signal: AbortSignal): Promise<ProviderResult> {
  const newsQuery = /\b(?:breaking|current|latest|news|recent|today|tonight)\b/i.test(query);
  const payload = await jsonRequest("https://api.tavily.com/search", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      query,
      search_depth: "basic",
      max_results: 8,
      topic: newsQuery ? "news" : "general",
      include_answer: false,
      include_raw_content: false,
      include_images: false,
      auto_parameters: false,
    }),
    signal,
  });
  return {
    items: uniqueItems(array(payload.results).map((item) => searchItem(item, {
      title: "title",
      url: "url",
      snippet: "content",
      publishedAt: "published_date",
    }))),
  };
}

async function exaSearch(apiKey: string, query: string, signal: AbortSignal): Promise<ProviderResult> {
  const payload = await jsonRequest("https://api.exa.ai/search", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
    },
    body: JSON.stringify({
      query,
      type: "instant",
      numResults: 6,
      contents: { highlights: { maxCharacters: 1_000 } },
    }),
    signal,
  });
  return {
    items: uniqueItems(array(payload.results).map((value) => {
      const item = record(value);
      const highlights = array(item?.highlights).map((highlight) => text(highlight, 1_000)).filter(Boolean);
      if (item && highlights.length) item.__searchSnippet = highlights.join(" ");
      return searchItem(item, {
        title: "title",
        url: "url",
        snippet: highlights.length ? "__searchSnippet" : "text",
        publishedAt: "publishedDate",
      });
    })),
  };
}

function providers(): SearchProvider[] {
  const configured: SearchProvider[] = [];
  const braveSearchKey = configuredValue("BRAVESEARACH_SEARCH_KEY", "BRAVESEARCH_SEARCH_KEY");
  const braveAnswerKey = configuredValue("BRAVESEARACH_ANSWER_KEY", "BRAVESEARCH_ANSWER_KEY");
  const tavilyKeys = [configuredValue("TAVILY_SEARCH_KEY1"), configuredValue("TAVILY_SEARCH_KEY2")];
  const exaKey = configuredValue("EXA_SEARCH_KEY");

  if (braveSearchKey) configured.push({
    id: "brave-search",
    label: "Brave Search",
    search: (query, signal) => braveSearch(braveSearchKey, query, signal),
  });
  if (braveAnswerKey) configured.push({
    id: "brave-answer",
    label: "Brave Answers",
    search: (query, signal) => braveAnswer(braveAnswerKey, query, signal),
  });
  tavilyKeys.forEach((apiKey, index) => {
    if (!apiKey) return;
    configured.push({
      id: `tavily-${index + 1}`,
      label: `Tavily ${index + 1}`,
      search: (query, signal) => tavilySearch(apiKey, query, signal),
    });
  });
  if (exaKey) configured.push({
    id: "exa",
    label: "Exa",
    search: (query, signal) => exaSearch(exaKey, query, signal),
  });
  configured.push({
    id: "duckduckgo",
    label: "DuckDuckGo Instant Answers",
    search: async (query, signal) => {
      const result = await searchDuckDuckGo(query, signal);
      return {
        answer: result.resultCount ? result.context : "",
        items: [],
      };
    },
  });
  return configured;
}

function formatContext(provider: string, query: string, result: ProviderResult): string {
  const lines = [`Search provider: ${provider}`, `Search query: ${query}`];
  if (result.answer) lines.push(`Search answer:\n${text(result.answer, 5_000)}`);
  if (result.items.length) {
    lines.push("Search sources:");
    result.items.forEach((item, index) => {
      lines.push(`${index + 1}. ${item.title}`);
      lines.push(`URL: ${item.url}`);
      if (item.publishedAt) lines.push(`Published: ${item.publishedAt}`);
      if (item.snippet) lines.push(`Excerpt: ${item.snippet}`);
    });
  }
  return lines.join("\n").slice(0, MAX_CONTEXT_CHARACTERS);
}

function nextUtcDay(now: number): number {
  const date = new Date(now);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1);
}

function cooldownUntil(error: unknown, now: number): number {
  if (error instanceof SearchProviderError) {
    if (error.retryAfterMs !== undefined) return now + Math.max(1_000, error.retryAfterMs);
    if ([401, 402, 403, 429, 432].includes(error.status)) return nextUtcDay(now);
    if (error.status >= 500) return now + 2 * 60 * 1_000;
  }
  return now + 60 * 1_000;
}

function timeoutSignal(parent?: AbortSignal): { cleanup: () => void; signal: AbortSignal } {
  const controller = new AbortController();
  const onParentAbort = () => controller.abort(parent?.reason);
  if (parent?.aborted) onParentAbort();
  else parent?.addEventListener("abort", onParentAbort, { once: true });
  const timer = setTimeout(() => controller.abort(new Error("Search provider timed out")), PER_PROVIDER_TIMEOUT_MS);
  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timer);
      parent?.removeEventListener("abort", onParentAbort);
    },
  };
}

function cacheTtlMs(): number {
  const configured = Number(process.env.WEB_SEARCH_CACHE_TTL_MS);
  return Number.isFinite(configured)
    ? Math.min(30 * 60 * 1_000, Math.max(0, configured))
    : DEFAULT_CACHE_TTL_MS;
}

function cachedResult(key: string, now: number): WebSearchResult | null {
  const cached = resultCache.get(key);
  if (!cached) return null;
  if (cached.expiresAt <= now) {
    resultCache.delete(key);
    return null;
  }
  resultCache.delete(key);
  resultCache.set(key, cached);
  return cached.result;
}

function storeResult(key: string, result: WebSearchResult, now: number): void {
  const ttl = cacheTtlMs();
  if (!ttl) return;
  resultCache.set(key, { expiresAt: now + ttl, result });
  while (resultCache.size > MAX_CACHE_ENTRIES) {
    const oldest = resultCache.keys().next().value;
    if (typeof oldest !== "string") break;
    resultCache.delete(oldest);
  }
}

async function executeSearch(query: string, signal?: AbortSignal): Promise<WebSearchResult> {
  const attemptedProviders: string[] = [];
  for (const provider of providers()) {
    if (signal?.aborted) throw signal.reason ?? new Error("Web search was cancelled");
    const now = Date.now();
    if ((providerCooldowns.get(provider.id) ?? 0) > now) continue;
    attemptedProviders.push(provider.label);
    const attempt = timeoutSignal(signal);
    try {
      const result = await provider.search(query, attempt.signal);
      const resultCount = result.items.length + Number(Boolean(result.answer));
      if (!resultCount) throw new SearchProviderError(204, "Search provider returned no usable results");
      providerCooldowns.delete(provider.id);
      return {
        attemptedProviders,
        provider: provider.label,
        resultCount,
        context: formatContext(provider.label, query, result),
      };
    } catch (error) {
      if (signal?.aborted) throw signal.reason ?? error;
      providerCooldowns.set(provider.id, cooldownUntil(error, Date.now()));
    } finally {
      attempt.cleanup();
    }
  }
  throw new Error("Every configured web search provider is unavailable.");
}

export function shouldUseWebSearch(message: string): boolean {
  return shouldUseDuckDuckGo(message);
}

export function webSearchQuery(message: string): string {
  return queryForProviders(message);
}

export async function searchWeb(message: string, signal?: AbortSignal): Promise<WebSearchResult> {
  const query = queryForProviders(message);
  if (!query) throw new Error("A web search query is required.");
  const cacheKey = query.toLocaleLowerCase();
  const now = Date.now();
  const cached = cachedResult(cacheKey, now);
  if (cached) return cached;
  const pending = pendingSearches.get(cacheKey);
  if (pending) return pending;

  const search = executeSearch(query, signal)
    .then((result) => {
      storeResult(cacheKey, result, Date.now());
      return result;
    })
    .finally(() => pendingSearches.delete(cacheKey));
  pendingSearches.set(cacheKey, search);
  return search;
}

export function resetWebSearchStateForTests(): void {
  providerCooldowns.clear();
  resultCache.clear();
  pendingSearches.clear();
}
