import "server-only";

import { createSupabaseAdminClient } from "../supabase/admin";
import {
  type InferenceTracker,
  type SharedInferenceOutcomeState,
  type SharedInferenceRuntimeRow,
} from "./inference-state";
import { PROVIDER_NAMES, type ModelSpec, type ProviderName } from "./model-pools";

const DEFAULT_SYNC_INTERVAL_MS = 5_000;
const DEFAULT_OPERATION_TIMEOUT_MS = 750;
const WARNING_INTERVAL_MS = 5 * 60 * 1_000;

type RuntimeDatabaseRow = {
  state_key: unknown;
  scope: unknown;
  provider: unknown;
  model: unknown;
  attempts: unknown;
  successes: unknown;
  failures: unknown;
  cancellations: unknown;
  consecutive_failures: unknown;
  latency_ema_ms: unknown;
  cooldown_until: unknown;
  remaining_requests: unknown;
  remaining_tokens: unknown;
  request_quota_reset_at: unknown;
  token_quota_reset_at: unknown;
  last_attempt_at: unknown;
  last_success_at: unknown;
  last_failure_at: unknown;
  statuses: unknown;
  updated_at: unknown;
};

export type SharedInferenceEvent = {
  event: "success" | "failure" | "cancelled";
  spec: ModelSpec;
  latencyMs?: number;
  status?: string;
  state: SharedInferenceOutcomeState;
};

function configuredDuration(name: string, fallback: number, minimum: number, maximum: number): number {
  const configured = Number(process.env[name]);
  return Number.isFinite(configured)
    ? Math.min(maximum, Math.max(minimum, configured))
    : fallback;
}

function numberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function timestamp(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function timestampOrZero(value: unknown): number {
  return timestamp(value) ?? 0;
}

function providerName(value: unknown): ProviderName | null {
  return typeof value === "string" && PROVIDER_NAMES.includes(value as ProviderName)
    ? value as ProviderName
    : null;
}

function statuses(value: unknown): Record<string, number> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .flatMap(([key, count]) => {
      const parsed = numberOrNull(count);
      return key.length <= 80 && parsed !== null && parsed >= 0 ? [[key, parsed]] : [];
    })
    .slice(0, 12));
}

function runtimeRow(value: RuntimeDatabaseRow): SharedInferenceRuntimeRow | null {
  const provider = providerName(value.provider);
  const scope = value.scope === "provider" || value.scope === "model" ? value.scope : null;
  const stateKey = typeof value.state_key === "string" ? value.state_key : null;
  const model = typeof value.model === "string" ? value.model : null;
  const updatedAt = timestamp(value.updated_at);
  if (!provider || !scope || !stateKey || updatedAt === null || (scope === "model" && !model)) return null;
  return {
    scope,
    stateKey,
    provider,
    model,
    attempts: numberOrNull(value.attempts) ?? 0,
    successes: numberOrNull(value.successes) ?? 0,
    failures: numberOrNull(value.failures) ?? 0,
    cancellations: numberOrNull(value.cancellations) ?? 0,
    consecutiveFailures: numberOrNull(value.consecutive_failures) ?? 0,
    latencyEmaMs: numberOrNull(value.latency_ema_ms),
    cooldownUntil: timestampOrZero(value.cooldown_until),
    remainingRequests: numberOrNull(value.remaining_requests),
    remainingTokens: numberOrNull(value.remaining_tokens),
    requestQuotaResetAt: timestamp(value.request_quota_reset_at),
    tokenQuotaResetAt: timestamp(value.token_quota_reset_at),
    lastAttemptAt: timestamp(value.last_attempt_at),
    lastSuccessAt: timestamp(value.last_success_at),
    lastFailureAt: timestamp(value.last_failure_at),
    statuses: statuses(value.statuses),
    updatedAt,
  };
}

function isoTimestamp(value: number): string | null {
  return value > 0 && Number.isFinite(value) ? new Date(value).toISOString() : null;
}

async function withTimeout<T>(operation: PromiseLike<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("shared inference state timeout")), timeoutMs);
  });
  try {
    return await Promise.race([Promise.resolve(operation), timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

class SharedInferenceRuntime {
  private lastSyncAt = 0;
  private lastSyncSucceeded = false;
  private syncPromise: Promise<boolean> | null = null;
  private lastWarningAt = 0;
  private readonly pendingRecords = new Set<Promise<boolean>>();

  async sync(tracker: InferenceTracker, now = Date.now()): Promise<boolean> {
    const interval = configuredDuration(
      "AI_SHARED_STATE_SYNC_MS",
      DEFAULT_SYNC_INTERVAL_MS,
      1_000,
      60_000,
    );
    if (now - this.lastSyncAt < interval) return this.lastSyncSucceeded;
    if (this.syncPromise) return this.lastSyncAt > 0 ? this.lastSyncSucceeded : this.syncPromise;
    const hasAttemptedSync = this.lastSyncAt > 0;
    // Throttle failures too, so an unavailable shared store never adds its
    // timeout cost to every inference request on a warm instance.
    this.lastSyncAt = now;
    this.syncPromise = this.performSync(tracker, now)
      .then((succeeded) => {
        this.lastSyncSucceeded = succeeded;
        return succeeded;
      })
      .finally(() => {
        this.syncPromise = null;
      });
    // A cold instance waits once (in parallel with the model catalog fetch).
    // Warm instances route from the last shared snapshot while refreshing it.
    return hasAttemptedSync ? this.lastSyncSucceeded : this.syncPromise;
  }

  queue(outcome: SharedInferenceEvent): void {
    const pending = this.record(outcome);
    this.pendingRecords.add(pending);
    void pending.finally(() => this.pendingRecords.delete(pending));
  }

  async flush(): Promise<void> {
    await Promise.allSettled([...this.pendingRecords]);
  }

  private async record(outcome: SharedInferenceEvent): Promise<boolean> {
    try {
      const client = createSupabaseAdminClient();
      const timeoutMs = configuredDuration(
        "AI_SHARED_STATE_TIMEOUT_MS",
        DEFAULT_OPERATION_TIMEOUT_MS,
        100,
        2_000,
      );
      const { error } = await withTimeout(client.rpc("record_ai_inference_runtime_event", {
        p_provider: outcome.spec.provider,
        p_model: outcome.spec.model,
        p_model_id: outcome.spec.id,
        p_event: outcome.event,
        p_latency_ms: outcome.latencyMs === undefined ? null : Math.max(0, Math.round(outcome.latencyMs)),
        p_status: outcome.status ?? null,
        p_model_cooldown_until: isoTimestamp(outcome.state.modelCooldownUntil),
        p_provider_cooldown_until: isoTimestamp(outcome.state.providerCooldownUntil),
        p_remaining_requests: outcome.state.remainingRequests,
        p_remaining_tokens: outcome.state.remainingTokens,
        p_request_quota_reset_at: outcome.state.requestQuotaResetAt === null
          ? null
          : isoTimestamp(outcome.state.requestQuotaResetAt),
        p_token_quota_reset_at: outcome.state.tokenQuotaResetAt === null
          ? null
          : isoTimestamp(outcome.state.tokenQuotaResetAt),
      }), timeoutMs);
      if (error) throw error;
      return true;
    } catch {
      this.warn("record");
      return false;
    }
  }

  private async performSync(tracker: InferenceTracker, now: number): Promise<boolean> {
    try {
      const client = createSupabaseAdminClient();
      const timeoutMs = configuredDuration(
        "AI_SHARED_STATE_TIMEOUT_MS",
        DEFAULT_OPERATION_TIMEOUT_MS,
        100,
        2_000,
      );
      const { data, error } = await withTimeout(client
        .from("ai_inference_runtime_state")
        .select("state_key,scope,provider,model,attempts,successes,failures,cancellations,consecutive_failures,latency_ema_ms,cooldown_until,remaining_requests,remaining_tokens,request_quota_reset_at,token_quota_reset_at,last_attempt_at,last_success_at,last_failure_at,statuses,updated_at")
        .order("updated_at", { ascending: false })
        .limit(250), timeoutMs);
      if (error) throw error;
      const rows = (Array.isArray(data) ? data : [])
        .map((row) => runtimeRow(row as RuntimeDatabaseRow))
        .filter((row): row is SharedInferenceRuntimeRow => Boolean(row));
      tracker.mergeSharedRuntime(rows, now);
      this.lastSyncAt = now;
      return true;
    } catch {
      this.warn("sync");
      return false;
    }
  }

  private warn(operation: "record" | "sync"): void {
    const now = Date.now();
    if (now - this.lastWarningAt < WARNING_INTERVAL_MS) return;
    this.lastWarningAt = now;
    console.warn("[ai-shared-state]", JSON.stringify({ event: `${operation}-failed`, fallback: "local" }));
  }
}

export const sharedInferenceRuntime = new SharedInferenceRuntime();
