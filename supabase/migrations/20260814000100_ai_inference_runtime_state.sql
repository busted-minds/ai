create table public.ai_inference_runtime_state (
  state_key text primary key,
  scope text not null check (scope in ('provider', 'model')),
  provider text not null,
  model text,
  attempts bigint not null default 0 check (attempts >= 0),
  successes bigint not null default 0 check (successes >= 0),
  failures bigint not null default 0 check (failures >= 0),
  cancellations bigint not null default 0 check (cancellations >= 0),
  consecutive_failures integer not null default 0 check (consecutive_failures >= 0),
  latency_ema_ms double precision,
  cooldown_until timestamptz,
  remaining_requests bigint,
  remaining_tokens bigint,
  request_quota_reset_at timestamptz,
  token_quota_reset_at timestamptz,
  last_attempt_at timestamptz,
  last_success_at timestamptz,
  last_failure_at timestamptz,
  statuses jsonb not null default '{}'::jsonb check (jsonb_typeof(statuses) = 'object'),
  updated_at timestamptz not null default clock_timestamp(),
  check ((scope = 'provider' and model is null) or (scope = 'model' and model is not null))
);

alter table public.ai_inference_runtime_state enable row level security;

revoke all on table public.ai_inference_runtime_state from public, anon, authenticated;
grant select, insert, update, delete on table public.ai_inference_runtime_state to service_role;

create or replace function public.record_ai_inference_runtime_event(
  p_provider text,
  p_model text,
  p_model_id text,
  p_event text,
  p_latency_ms integer default null,
  p_status text default null,
  p_model_cooldown_until timestamptz default null,
  p_provider_cooldown_until timestamptz default null,
  p_remaining_requests bigint default null,
  p_remaining_tokens bigint default null,
  p_request_quota_reset_at timestamptz default null,
  p_token_quota_reset_at timestamptz default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  recorded_at timestamptz := clock_timestamp();
  normalized_status text := left(nullif(p_status, ''), 80);
begin
  if p_event not in ('success', 'failure', 'cancelled')
    or p_provider is null or char_length(p_provider) not between 1 and 40
    or p_model is null or char_length(p_model) not between 1 and 200
    or p_model_id is null or char_length(p_model_id) not between 1 and 260 then
    raise exception 'Invalid inference runtime event';
  end if;

  insert into public.ai_inference_runtime_state as runtime (
    state_key,
    scope,
    provider,
    model,
    attempts,
    successes,
    failures,
    consecutive_failures,
    cooldown_until,
    remaining_requests,
    remaining_tokens,
    request_quota_reset_at,
    token_quota_reset_at,
    last_attempt_at,
    last_success_at,
    last_failure_at,
    updated_at
  ) values (
    'provider:' || p_provider,
    'provider',
    p_provider,
    null,
    1,
    case when p_event = 'success' then 1 else 0 end,
    case when p_event = 'failure' then 1 else 0 end,
    case when p_event = 'failure' then 1 else 0 end,
    case when p_event = 'success' then null else p_provider_cooldown_until end,
    p_remaining_requests,
    p_remaining_tokens,
    p_request_quota_reset_at,
    p_token_quota_reset_at,
    recorded_at,
    case when p_event = 'success' then recorded_at else null end,
    case when p_event = 'failure' then recorded_at else null end,
    recorded_at
  )
  on conflict (state_key) do update set
    attempts = runtime.attempts + 1,
    successes = runtime.successes + case when p_event = 'success' then 1 else 0 end,
    failures = runtime.failures + case when p_event = 'failure' then 1 else 0 end,
    consecutive_failures = case
      when p_event = 'success' then 0
      when p_event = 'failure' then runtime.consecutive_failures + 1
      else runtime.consecutive_failures
    end,
    cooldown_until = case
      when p_event = 'success' then null
      else greatest(runtime.cooldown_until, p_provider_cooldown_until)
    end,
    remaining_requests = coalesce(p_remaining_requests, runtime.remaining_requests),
    remaining_tokens = coalesce(p_remaining_tokens, runtime.remaining_tokens),
    request_quota_reset_at = coalesce(p_request_quota_reset_at, runtime.request_quota_reset_at),
    token_quota_reset_at = coalesce(p_token_quota_reset_at, runtime.token_quota_reset_at),
    last_attempt_at = recorded_at,
    last_success_at = case when p_event = 'success' then recorded_at else runtime.last_success_at end,
    last_failure_at = case when p_event = 'failure' then recorded_at else runtime.last_failure_at end,
    updated_at = recorded_at;

  insert into public.ai_inference_runtime_state as runtime (
    state_key,
    scope,
    provider,
    model,
    attempts,
    successes,
    failures,
    cancellations,
    consecutive_failures,
    latency_ema_ms,
    cooldown_until,
    last_attempt_at,
    last_success_at,
    last_failure_at,
    statuses,
    updated_at
  ) values (
    'model:' || p_model_id,
    'model',
    p_provider,
    p_model,
    1,
    case when p_event = 'success' then 1 else 0 end,
    case when p_event = 'failure' then 1 else 0 end,
    case when p_event = 'cancelled' then 1 else 0 end,
    case when p_event = 'failure' then 1 else 0 end,
    case when p_event = 'success' then p_latency_ms else null end,
    case when p_event = 'success' then null else p_model_cooldown_until end,
    recorded_at,
    case when p_event = 'success' then recorded_at else null end,
    case when p_event = 'failure' then recorded_at else null end,
    case when normalized_status is null then '{}'::jsonb else jsonb_build_object(normalized_status, 1) end,
    recorded_at
  )
  on conflict (state_key) do update set
    attempts = runtime.attempts + 1,
    successes = runtime.successes + case when p_event = 'success' then 1 else 0 end,
    failures = runtime.failures + case when p_event = 'failure' then 1 else 0 end,
    cancellations = runtime.cancellations + case when p_event = 'cancelled' then 1 else 0 end,
    consecutive_failures = case
      when p_event = 'success' then 0
      when p_event = 'failure' then runtime.consecutive_failures + 1
      else runtime.consecutive_failures
    end,
    latency_ema_ms = case
      when p_event <> 'success' or p_latency_ms is null then runtime.latency_ema_ms
      when runtime.latency_ema_ms is null then p_latency_ms
      else runtime.latency_ema_ms * 0.75 + p_latency_ms * 0.25
    end,
    cooldown_until = case
      when p_event = 'success' then null
      else greatest(runtime.cooldown_until, p_model_cooldown_until)
    end,
    last_attempt_at = recorded_at,
    last_success_at = case when p_event = 'success' then recorded_at else runtime.last_success_at end,
    last_failure_at = case when p_event = 'failure' then recorded_at else runtime.last_failure_at end,
    statuses = case
      when normalized_status is null then runtime.statuses
      else jsonb_set(
        runtime.statuses,
        array[normalized_status],
        to_jsonb(coalesce((runtime.statuses ->> normalized_status)::bigint, 0) + 1),
        true
      )
    end,
    updated_at = recorded_at;
end;
$$;

revoke all on function public.record_ai_inference_runtime_event(
  text, text, text, text, integer, text, timestamptz, timestamptz,
  bigint, bigint, timestamptz, timestamptz
) from public, anon, authenticated;
grant execute on function public.record_ai_inference_runtime_event(
  text, text, text, text, integer, text, timestamptz, timestamptz,
  bigint, bigint, timestamptz, timestamptz
) to service_role;

comment on table public.ai_inference_runtime_state is
  'Service-role-only shared provider and model health used by the adaptive inference router.';
comment on function public.record_ai_inference_runtime_event(
  text, text, text, text, integer, text, timestamptz, timestamptz,
  bigint, bigint, timestamptz, timestamptz
) is 'Atomically records one terminal inference attempt for cross-instance routing health.';
