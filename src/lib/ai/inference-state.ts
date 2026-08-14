import type { InferenceTier } from "./modes";
import {
  CURATED_MODEL_ORDER,
  type ModelSpec,
  type ProviderName,
  type RoutingPreference,
} from "./model-pools";

const SUMMARY_INTERVAL_MS = 5 * 60 * 1_000;
const MAX_STATUS_BUCKETS = 12;
const DEFAULT_EXPLORATION_RATE = 0.03;
const NEAR_TIE_SCORE_DELTA = 2;
const CURATED_PRIORITY_START = 40;
const CURATED_PRIORITY_STEP = 4;
const PROVIDER_SCORE_PRIOR: Record<ProviderName, number> = {
  google: 3,
  groq: 3,
  nvidia: 2,
  openrouter: 1,
  mistral: 1,
  // A Cerebras catalog does not guarantee that the account has inference quota.
  cerebras: -5,
};

type ModelRuntimeState = {
  attempts: number;
  successes: number;
  failures: number;
  cancellations: number;
  consecutiveFailures: number;
  latencyEmaMs: number | null;
  cooldownUntil: number;
  lastAttemptAt: number | null;
  lastSuccessAt: number | null;
  lastFailureAt: number | null;
  statuses: Record<string, number>;
  updatedAt: number;
};

type ProviderRuntimeState = {
  attempts: number;
  successes: number;
  failures: number;
  consecutiveFailures: number;
  cooldownUntil: number;
  remainingRequests: number | null;
  remainingTokens: number | null;
  requestQuotaResetAt: number | null;
  tokenQuotaResetAt: number | null;
  lastAttemptAt: number | null;
  lastSuccessAt: number | null;
  lastFailureAt: number | null;
  updatedAt: number;
};

export type RoutingContext = {
  tier: InferenceTier;
  needsVision: boolean;
  prompt: string;
  estimatedInputTokens?: number;
  limit?: number;
  now?: number;
  random?: () => number;
  explorationRate?: number;
};

export type RankedInferenceCandidate = {
  provider: ProviderName;
  model: string;
  score: number;
};

export type InferenceSelection = {
  candidates: ModelSpec[];
  ranked: RankedInferenceCandidate[];
  preference: RoutingPreference;
  explored: boolean;
};

export type SharedInferenceRuntimeRow = {
  scope: "provider" | "model";
  stateKey: string;
  provider: ProviderName;
  model: string | null;
  attempts: number;
  successes: number;
  failures: number;
  cancellations: number;
  consecutiveFailures: number;
  latencyEmaMs: number | null;
  cooldownUntil: number;
  remainingRequests: number | null;
  remainingTokens: number | null;
  requestQuotaResetAt: number | null;
  tokenQuotaResetAt: number | null;
  lastAttemptAt: number | null;
  lastSuccessAt: number | null;
  lastFailureAt: number | null;
  statuses: Record<string, number>;
  updatedAt: number;
};

export type SharedInferenceOutcomeState = {
  modelCooldownUntil: number;
  providerCooldownUntil: number;
  remainingRequests: number | null;
  remainingTokens: number | null;
  requestQuotaResetAt: number | null;
  tokenQuotaResetAt: number | null;
};

export type InferenceFailure = {
  status?: number;
  retryAfter?: number;
  timeout?: boolean;
  code?: string;
};

export type InferenceTelemetrySnapshot = {
  generatedAt: string;
  providers: Array<ProviderRuntimeState & { provider: ProviderName }>;
  models: Array<ModelRuntimeState & { id: string; provider: ProviderName; model: string }>;
};

export type ProviderRuntimeAvailability = {
  provider: ProviderName;
  catalogModels: number;
  routableModels: number;
  verifiedModels: number;
  blockedModels: number;
  state: "unknown" | "healthy" | "degraded" | "blocked";
};

const CODE_PROMPT_PATTERN = /(?:```|\b(?:bug|code|coding|function|implementation|program|refactor|repository|sql|typescript|javascript|python)\b)/i;
const REASONING_PROMPT_PATTERN = /\b(?:analy[sz]e|architecture|derive|diagnose|evaluate|proof|reason|research|strategy|trade-?offs?)\b/i;
const MULTILINGUAL_PROMPT_PATTERN = /[^\u0000-\u024f]/;

function newModelState(): ModelRuntimeState {
  return {
    attempts: 0,
    successes: 0,
    failures: 0,
    cancellations: 0,
    consecutiveFailures: 0,
    latencyEmaMs: null,
    cooldownUntil: 0,
    lastAttemptAt: null,
    lastSuccessAt: null,
    lastFailureAt: null,
    statuses: {},
    updatedAt: 0,
  };
}

function newProviderState(): ProviderRuntimeState {
  return {
    attempts: 0,
    successes: 0,
    failures: 0,
    consecutiveFailures: 0,
    cooldownUntil: 0,
    remainingRequests: null,
    remainingTokens: null,
    requestQuotaResetAt: null,
    tokenQuotaResetAt: null,
    lastAttemptAt: null,
    lastSuccessAt: null,
    lastFailureAt: null,
    updatedAt: 0,
  };
}

function headerNumber(headers: Headers, names: string[]): number | null {
  for (const name of names) {
    const value = headers.get(name);
    if (value === null) continue;
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function durationMs(value: string): number | null {
  const numeric = Number(value);
  if (Number.isFinite(numeric)) return numeric * 1_000;
  const match = value.match(/^(?:(\d+(?:\.\d+)?)h)?(?:(\d+(?:\.\d+)?)m)?(?:(\d+(?:\.\d+)?)s)?$/i);
  if (!match) return null;
  return (Number(match[1] ?? 0) * 3_600 + Number(match[2] ?? 0) * 60 + Number(match[3] ?? 0)) * 1_000;
}

function resetAt(headers: Headers, names: readonly string[], now: number): number | null {
  for (const name of names) {
    const value = headers.get(name);
    if (!value) continue;
    const milliseconds = durationMs(value);
    if (milliseconds !== null) return now + milliseconds;
    const date = Date.parse(value);
    if (Number.isFinite(date)) return date;
  }
  return null;
}

export function quotaFromHeaders(headers: Headers, now = Date.now()): {
  remainingRequests: number | null;
  remainingTokens: number | null;
  requestQuotaResetAt: number | null;
  tokenQuotaResetAt: number | null;
} {
  return {
    remainingRequests: headerNumber(headers, [
      "x-ratelimit-remaining-requests",
      "x-ratelimit-remaining-requests-day",
    ]),
    remainingTokens: headerNumber(headers, [
      "x-ratelimit-remaining-tokens",
      "x-ratelimit-remaining-tokens-minute",
    ]),
    requestQuotaResetAt: resetAt(headers, [
      "x-ratelimit-reset-requests",
      "x-ratelimit-reset-requests-day",
    ], now),
    tokenQuotaResetAt: resetAt(headers, [
      "x-ratelimit-reset-tokens",
      "x-ratelimit-reset-tokens-minute",
    ], now),
  };
}

function cappedIncrement(statuses: Record<string, number>, status: string): void {
  if (!(status in statuses) && Object.keys(statuses).length >= MAX_STATUS_BUCKETS) {
    statuses.other = (statuses.other ?? 0) + 1;
    return;
  }
  statuses[status] = (statuses[status] ?? 0) + 1;
}

export class InferenceTracker {
  private readonly models = new Map<string, ModelRuntimeState>();
  private readonly providers = new Map<ProviderName, ProviderRuntimeState>();
  private readonly knownModels = new Map<string, Pick<ModelSpec, "provider" | "model">>();
  private readonly baseScoreCache = new Map<string, number>();
  private lastSummaryAt = 0;

  private modelState(spec: ModelSpec): ModelRuntimeState {
    let state = this.models.get(spec.id);
    if (!state) {
      state = newModelState();
      this.models.set(spec.id, state);
      this.knownModels.set(spec.id, { provider: spec.provider, model: spec.model });
    }
    return state;
  }

  private providerState(provider: ProviderName): ProviderRuntimeState {
    let state = this.providers.get(provider);
    if (!state) {
      state = newProviderState();
      this.providers.set(provider, state);
    }
    return state;
  }

  isAvailable(spec: ModelSpec, now = Date.now()): boolean {
    const model = this.models.get(spec.id);
    const provider = this.providers.get(spec.provider);
    if (provider?.requestQuotaResetAt && provider.requestQuotaResetAt <= now) {
      provider.remainingRequests = null;
      provider.requestQuotaResetAt = null;
    }
    if (provider?.tokenQuotaResetAt && provider.tokenQuotaResetAt <= now) {
      provider.remainingTokens = null;
      provider.tokenQuotaResetAt = null;
    }
    return (model?.cooldownUntil ?? 0) <= now
      && (provider?.cooldownUntil ?? 0) <= now
      && provider?.remainingRequests !== 0
      && provider?.remainingTokens !== 0;
  }

  private preference(context: RoutingContext): RoutingPreference {
    if (context.needsVision) return "vision";
    if (CODE_PROMPT_PATTERN.test(context.prompt)) return "code";
    if (REASONING_PROMPT_PATTERN.test(context.prompt)) return "reasoning";
    if (MULTILINGUAL_PROMPT_PATTERN.test(context.prompt)) return "multilingual";
    return "general";
  }

  private baseScore(spec: ModelSpec, tier: InferenceTier, preference: RoutingPreference): number {
    const cacheKey = `${tier}:${preference}:${spec.id}`;
    const cached = this.baseScoreCache.get(cacheKey);
    if (cached !== undefined) return cached;

    let score = tier === "expert"
      ? spec.quality * 7.5 + spec.speed * 2.5
      : spec.quality * 4 + spec.speed * 6;
    score += PROVIDER_SCORE_PRIOR[spec.provider];
    if (preference === "code" && spec.specialties.includes("code")) score += 8;
    if (preference === "reasoning" && spec.specialties.includes("reasoning")) score += 7;
    if (preference === "multilingual" && spec.specialties.includes("multilingual")) score += 4;
    if (spec.source === "router") score += preference === "vision" ? 2 : 0.5;

    const curatedIndex = CURATED_MODEL_ORDER[tier][preference].indexOf(spec.id);
    if (curatedIndex >= 0) {
      score += Math.max(8, CURATED_PRIORITY_START - curatedIndex * CURATED_PRIORITY_STEP);
    }
    this.baseScoreCache.set(cacheKey, score);
    return score;
  }

  private score(spec: ModelSpec, context: RoutingContext, preference: RoutingPreference): number {
    const now = context.now ?? Date.now();
    if (
      !this.isAvailable(spec, now)
      || (context.needsVision && !spec.vision)
      || (spec.contextWindow !== undefined
        && spec.contextWindow < (context.estimatedInputTokens ?? 0) + 4_096)
    ) return Number.NEGATIVE_INFINITY;
    const model = this.models.get(spec.id);
    const provider = this.providers.get(spec.provider);
    let score = this.baseScore(spec, context.tier, preference);

    if (!model || model.attempts === 0) score += 3;
    if (model && model.attempts > 0) {
      score += (model.successes / model.attempts) * 5;
      score -= model.consecutiveFailures * 5;
      score -= Math.log1p(model.attempts) * 1.4;
    }
    if (model?.latencyEmaMs !== null && model?.latencyEmaMs !== undefined) {
      score -= Math.min(model.latencyEmaMs / 2_000, 7);
    }
    if (model?.lastAttemptAt && now - model.lastAttemptAt < 30_000) score -= 2.5;
    score -= Math.log1p(provider?.attempts ?? 0) * 0.5;

    if (provider?.remainingRequests !== null && provider?.remainingRequests !== undefined && provider.remainingRequests < 10) score -= 6;
    if (provider?.remainingTokens !== null && provider?.remainingTokens !== undefined && provider.remainingTokens < 8_192) score -= 6;
    return score;
  }

  select(models: readonly ModelSpec[], context: RoutingContext): ModelSpec[] {
    return this.selectDetailed(models, context).candidates;
  }

  selectDetailed(models: readonly ModelSpec[], context: RoutingContext): InferenceSelection {
    const limit = Math.max(1, context.limit ?? 8);
    const preference = this.preference(context);
    const ranked = models
      .map((model) => ({ model, score: this.score(model, context, preference) }))
      .filter(({ score }) => Number.isFinite(score))
      .sort((left, right) => right.score - left.score || left.model.id.localeCompare(right.model.id));
    const byProvider = new Map<ProviderName, Array<{ model: ModelSpec; score: number }>>();
    for (const item of ranked) {
      const bucket = byProvider.get(item.model.provider) ?? [];
      bucket.push(item);
      byProvider.set(item.model.provider, bucket);
    }

    const providerOrder = [...byProvider.entries()]
      .sort((left, right) => (right[1][0]?.score ?? 0) - (left[1][0]?.score ?? 0))
      .map(([provider]) => provider);
    const selected: ModelSpec[] = [];
    for (let round = 0; selected.length < limit; round += 1) {
      let added = false;
      for (const provider of providerOrder) {
        const item = byProvider.get(provider)?.[round];
        if (!item) continue;
        selected.push(item.model);
        added = true;
        if (selected.length >= limit) break;
      }
      if (!added) break;
    }

    const scoreById = new Map(ranked.map(({ model, score }) => [model.id, score]));
    const topScore = selected[0] ? scoreById.get(selected[0].id) ?? Number.NEGATIVE_INFINITY : Number.NEGATIVE_INFINITY;
    const nearTieIndexes = selected.flatMap((model, index) => (
      index > 0 && (scoreById.get(model.id) ?? Number.NEGATIVE_INFINITY) >= topScore - NEAR_TIE_SCORE_DELTA
        ? [index]
        : []
    ));
    const random = context.random ?? Math.random;
    const explorationRate = Math.min(0.05, Math.max(0, context.explorationRate
      ?? (context.random ? 0 : DEFAULT_EXPLORATION_RATE)));
    const explored = nearTieIndexes.length > 0 && random() < explorationRate;
    if (explored) {
      const exploredIndex = nearTieIndexes[Math.floor(random() * nearTieIndexes.length)] ?? nearTieIndexes[0];
      [selected[0], selected[exploredIndex]] = [selected[exploredIndex], selected[0]];
    }

    return {
      candidates: selected,
      ranked: ranked.map(({ model, score }) => ({
        provider: model.provider,
        model: model.model,
        score: Math.round(score * 100) / 100,
      })),
      preference,
      explored,
    };
  }

  started(spec: ModelSpec, now = Date.now()): void {
    const model = this.modelState(spec);
    const provider = this.providerState(spec.provider);
    model.attempts += 1;
    model.lastAttemptAt = now;
    model.updatedAt = now;
    provider.attempts += 1;
    provider.lastAttemptAt = now;
    provider.updatedAt = now;
  }

  succeeded(spec: ModelSpec, latencyMs: number, headers: Headers, now = Date.now()): void {
    const model = this.modelState(spec);
    const provider = this.providerState(spec.provider);
    model.successes += 1;
    model.consecutiveFailures = 0;
    model.cooldownUntil = 0;
    model.lastSuccessAt = now;
    model.updatedAt = now;
    model.latencyEmaMs = model.latencyEmaMs === null
      ? latencyMs
      : model.latencyEmaMs * 0.75 + latencyMs * 0.25;
    cappedIncrement(model.statuses, "200");
    provider.successes += 1;
    provider.consecutiveFailures = 0;
    provider.cooldownUntil = 0;
    provider.lastSuccessAt = now;
    provider.updatedAt = now;
    this.updateQuota(provider, headers, now);
    this.logAttempt("success", spec, { latencyMs });
    this.maybeLogSummary(now);
  }

  failed(spec: ModelSpec, failure: InferenceFailure, latencyMs: number, headers?: Headers, now = Date.now()): void {
    const model = this.modelState(spec);
    const provider = this.providerState(spec.provider);
    const status = failure.status;
    model.failures += 1;
    model.consecutiveFailures += 1;
    model.lastFailureAt = now;
    model.updatedAt = now;
    cappedIncrement(model.statuses, status ? String(status) : failure.timeout ? "timeout" : "network");
    provider.failures += 1;
    provider.consecutiveFailures += 1;
    provider.lastFailureAt = now;
    provider.updatedAt = now;
    if (headers) this.updateQuota(provider, headers, now);

    const retryMs = Math.min(Math.max((failure.retryAfter ?? 60) * 1_000, 15_000), 30 * 60 * 1_000);
    if (status === 401 || status === 403) {
      provider.cooldownUntil = Math.max(provider.cooldownUntil, now + 30 * 60 * 1_000);
    } else if (status === 402) {
      provider.cooldownUntil = Math.max(provider.cooldownUntil, now + 6 * 60 * 60 * 1_000);
    } else if (status === 429) {
      model.cooldownUntil = Math.max(model.cooldownUntil, now + retryMs);
      if (provider.remainingRequests === 0) {
        provider.cooldownUntil = Math.max(
          provider.cooldownUntil,
          provider.requestQuotaResetAt ?? now + retryMs,
        );
      }
      if (provider.remainingTokens === 0) {
        provider.cooldownUntil = Math.max(
          provider.cooldownUntil,
          provider.tokenQuotaResetAt ?? now + retryMs,
        );
      }
    } else if (status === 404) {
      model.cooldownUntil = Math.max(model.cooldownUntil, now + 24 * 60 * 60 * 1_000);
    } else if (status === 400 || status === 422) {
      model.cooldownUntil = Math.max(model.cooldownUntil, now + 6 * 60 * 60 * 1_000);
    } else {
      const backoff = Math.min(15_000 * 2 ** Math.min(model.consecutiveFailures - 1, 5), 10 * 60 * 1_000);
      model.cooldownUntil = Math.max(model.cooldownUntil, now + backoff);
      if (provider.consecutiveFailures >= 3) {
        provider.cooldownUntil = Math.max(provider.cooldownUntil, now + Math.min(backoff, 60_000));
      }
    }

    this.logAttempt("failure", spec, {
      latencyMs,
      status: status ?? null,
      code: failure.code ?? null,
      timeout: Boolean(failure.timeout),
      modelCooldownMs: Math.max(0, model.cooldownUntil - now),
      providerCooldownMs: Math.max(0, provider.cooldownUntil - now),
    });
    this.maybeLogSummary(now);
  }

  cancelled(spec: ModelSpec, now = Date.now()): void {
    const model = this.modelState(spec);
    model.cancellations += 1;
    model.updatedAt = now;
    this.logAttempt("cancelled", spec, {});
  }

  snapshot(now = Date.now()): InferenceTelemetrySnapshot {
    return {
      generatedAt: new Date(now).toISOString(),
      providers: [...this.providers.entries()].map(([provider, state]) => ({ provider, ...state })),
      models: [...this.models.entries()].map(([id, state]) => ({
        id,
        ...(this.knownModels.get(id) ?? { provider: "google" as const, model: "unknown" }),
        ...state,
      })),
    };
  }

  sharedOutcomeState(spec: ModelSpec): SharedInferenceOutcomeState {
    const model = this.models.get(spec.id);
    const provider = this.providers.get(spec.provider);
    return {
      modelCooldownUntil: model?.cooldownUntil ?? 0,
      providerCooldownUntil: provider?.cooldownUntil ?? 0,
      remainingRequests: provider?.remainingRequests ?? null,
      remainingTokens: provider?.remainingTokens ?? null,
      requestQuotaResetAt: provider?.requestQuotaResetAt ?? null,
      tokenQuotaResetAt: provider?.tokenQuotaResetAt ?? null,
    };
  }

  mergeSharedRuntime(rows: readonly SharedInferenceRuntimeRow[], now = Date.now()): void {
    for (const row of rows) {
      if (row.scope === "provider") {
        const provider = this.providerState(row.provider);
        if (row.updatedAt <= provider.updatedAt) continue;
        Object.assign(provider, {
          attempts: row.attempts,
          successes: row.successes,
          failures: row.failures,
          consecutiveFailures: row.consecutiveFailures,
          cooldownUntil: row.cooldownUntil,
          remainingRequests: row.requestQuotaResetAt !== null && row.requestQuotaResetAt <= now
            ? null
            : row.remainingRequests,
          remainingTokens: row.tokenQuotaResetAt !== null && row.tokenQuotaResetAt <= now
            ? null
            : row.remainingTokens,
          requestQuotaResetAt: row.requestQuotaResetAt !== null && row.requestQuotaResetAt <= now
            ? null
            : row.requestQuotaResetAt,
          tokenQuotaResetAt: row.tokenQuotaResetAt !== null && row.tokenQuotaResetAt <= now
            ? null
            : row.tokenQuotaResetAt,
          lastAttemptAt: row.lastAttemptAt,
          lastSuccessAt: row.lastSuccessAt,
          lastFailureAt: row.lastFailureAt,
          updatedAt: row.updatedAt,
        });
        continue;
      }

      if (!row.model) continue;
      const id = row.stateKey.replace(/^model:/, "");
      const current = this.models.get(id);
      if (current && row.updatedAt <= current.updatedAt) continue;
      this.models.set(id, {
        attempts: row.attempts,
        successes: row.successes,
        failures: row.failures,
        cancellations: row.cancellations,
        consecutiveFailures: row.consecutiveFailures,
        latencyEmaMs: row.latencyEmaMs,
        cooldownUntil: row.cooldownUntil,
        lastAttemptAt: row.lastAttemptAt,
        lastSuccessAt: row.lastSuccessAt,
        lastFailureAt: row.lastFailureAt,
        statuses: { ...row.statuses },
        updatedAt: row.updatedAt,
      });
      this.knownModels.set(id, { provider: row.provider, model: row.model });
    }
  }

  catalogAvailability(models: readonly ModelSpec[], now = Date.now()): ProviderRuntimeAvailability[] {
    const grouped = new Map<ProviderName, ModelSpec[]>();
    for (const model of models) {
      const bucket = grouped.get(model.provider) ?? [];
      bucket.push(model);
      grouped.set(model.provider, bucket);
    }
    return [...grouped.entries()].map(([providerName, providerModels]) => {
      const provider = this.providers.get(providerName);
      const providerBlocked = Boolean(
        provider
        && (provider.cooldownUntil > now
          || provider.remainingRequests === 0
          || provider.remainingTokens === 0),
      );
      const routableModels = providerModels.filter((model) => this.isAvailable(model, now)).length;
      const verifiedModels = providerModels.filter((model) => (
        (this.models.get(model.id)?.successes ?? 0) > 0 && this.isAvailable(model, now)
      )).length;
      const blockedModels = providerModels.length - routableModels;
      const state = providerBlocked
        ? "blocked" as const
        : (provider?.successes ?? 0) > 0
          ? "healthy" as const
          : (provider?.failures ?? 0) > 0
            ? "degraded" as const
            : "unknown" as const;
      return {
        provider: providerName,
        catalogModels: providerModels.length,
        routableModels,
        verifiedModels,
        blockedModels,
        state,
      };
    });
  }

  private updateQuota(provider: ProviderRuntimeState, headers: Headers, now: number): void {
    const quota = quotaFromHeaders(headers, now);
    if (quota.remainingRequests !== null) provider.remainingRequests = quota.remainingRequests;
    if (quota.remainingTokens !== null) provider.remainingTokens = quota.remainingTokens;
    if (quota.requestQuotaResetAt !== null) provider.requestQuotaResetAt = quota.requestQuotaResetAt;
    if (quota.tokenQuotaResetAt !== null) provider.tokenQuotaResetAt = quota.tokenQuotaResetAt;
  }

  private logAttempt(event: string, spec: ModelSpec, detail: Record<string, unknown>): void {
    console.info("[ai-inference]", JSON.stringify({
      event,
      provider: spec.provider,
      model: spec.model,
      ...detail,
    }));
  }

  private maybeLogSummary(now: number): void {
    if (now - this.lastSummaryAt < SUMMARY_INTERVAL_MS) return;
    this.lastSummaryAt = now;
    const snapshot = this.snapshot(now);
    console.info("[ai-telemetry]", JSON.stringify({
      event: "summary",
      providers: snapshot.providers,
      models: snapshot.models.map(({ id, provider, model, attempts, successes, failures, cancellations, latencyEmaMs, cooldownUntil }) => ({
        id, provider, model, attempts, successes, failures, cancellations, latencyEmaMs, cooldownUntil,
      })),
    }));
  }
}

export const inferenceTracker = new InferenceTracker();
