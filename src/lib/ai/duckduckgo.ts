export type DuckDuckGoSearchResult = {
  context: string;
  resultCount: number;
};

type DuckDuckGoTopic = {
  FirstURL?: unknown;
  Text?: unknown;
  Topics?: unknown;
};

type DuckDuckGoPayload = {
  AbstractSource?: unknown;
  AbstractText?: unknown;
  AbstractURL?: unknown;
  Answer?: unknown;
  AnswerType?: unknown;
  Definition?: unknown;
  DefinitionSource?: unknown;
  DefinitionURL?: unknown;
  Heading?: unknown;
  RelatedTopics?: unknown;
  Results?: unknown;
};

const SEARCH_NEEDED_PATTERNS = [
  /\b(search|browse|look\s*up|find online|on the web|internet search)\b/i,
  /\b(latest|current(?:ly)?|today|tonight|yesterday|tomorrow|right now|recent|breaking|news|live|up[ -]to[ -]date|as of)\b/i,
  /\b(weather|forecast|temperature|score|standings|schedule|fixture|stock price|share price|exchange rate|traffic)\b/i,
  /\b(price of|release date|latest version|current version|president|prime minister|chief executive|ceo)\b/i,
];

function text(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function topicItems(value: unknown): Array<{ title: string; url: string }> {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const topic = item as DuckDuckGoTopic;
    const nested = topicItems(topic.Topics);
    const title = text(topic.Text);
    const url = text(topic.FirstURL);
    return [...(title && url ? [{ title, url }] : []), ...nested];
  });
}

export function shouldUseDuckDuckGo(message: string): boolean {
  const normalized = message.trim();
  return normalized.length > 0 && SEARCH_NEEDED_PATTERNS.some((pattern) => pattern.test(normalized));
}

export function duckDuckGoQuery(message: string): string {
  return message
    .replace(/\b(?:please\s+)?(?:search|browse|look\s*up|find online)\b(?:\s+(?:the\s+)?(?:web|internet))?\s*(?:for)?\s*/i, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 500);
}

export async function searchDuckDuckGo(
  message: string,
  signal?: AbortSignal,
): Promise<DuckDuckGoSearchResult> {
  const query = duckDuckGoQuery(message) || message.trim().slice(0, 500);
  const params = new URLSearchParams({
    q: query,
    format: "json",
    no_html: "1",
    no_redirect: "1",
    skip_disambig: "1",
    t: "busted_minds_ai",
  });
  const response = await fetch(`https://api.duckduckgo.com/?${params.toString()}`, {
    headers: { Accept: "application/json" },
    cache: "no-store",
    signal,
  });
  if (!response.ok) throw new Error(`DuckDuckGo returned ${response.status}`);

  const payload = (await response.json()) as DuckDuckGoPayload;
  const lines: string[] = [`Search query: ${query}`];
  const heading = text(payload.Heading);
  const answer = text(payload.Answer);
  const answerType = text(payload.AnswerType);
  const abstract = text(payload.AbstractText);
  const abstractSource = text(payload.AbstractSource);
  const abstractUrl = text(payload.AbstractURL);
  const definition = text(payload.Definition);
  const definitionSource = text(payload.DefinitionSource);
  const definitionUrl = text(payload.DefinitionURL);

  if (heading) lines.push(`Topic: ${heading}`);
  if (answer) lines.push(`Instant answer${answerType ? ` (${answerType})` : ""}: ${answer}`);
  if (abstract) {
    lines.push(`Summary: ${abstract}`);
    if (abstractUrl) lines.push(`Summary source: ${abstractSource || "Source"} — ${abstractUrl}`);
  }
  if (definition) {
    lines.push(`Definition: ${definition}`);
    if (definitionUrl) lines.push(`Definition source: ${definitionSource || "Source"} — ${definitionUrl}`);
  }

  const topics = [
    ...topicItems(payload.Results),
    ...topicItems(payload.RelatedTopics),
  ].filter((item, index, items) => items.findIndex((candidate) => candidate.url === item.url) === index)
    .slice(0, 8);
  if (topics.length) {
    lines.push("Related results:");
    topics.forEach((topic, index) => lines.push(`${index + 1}. ${topic.title} — ${topic.url}`));
  }

  const resultCount = Number(Boolean(answer)) + Number(Boolean(abstract)) + Number(Boolean(definition)) + topics.length;
  if (!resultCount) lines.push("DuckDuckGo returned no instant answer or related result for this query.");

  return { context: lines.join("\n").slice(0, 9_000), resultCount };
}
