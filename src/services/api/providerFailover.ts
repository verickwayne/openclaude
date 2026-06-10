// src/services/api/providerFailover.ts
//
// Mid-run provider failover for long-running workloads.
//
// When `withRetry` exhausts all retries against a provider due to an auth,
// rate-limit, or server error, `claude.ts` can throw `ProviderFailoverError`
// instead of yielding a terminal error message.  `query.ts` catches it,
// re-resolves the model class to the next available provider (using
// `resolveProviderForClass` with `excludeProvider: failedProvider`), swaps
// `toolUseContext.options.providerOverride`, and continues the loop — the
// run outlives any single provider.
//
// Gates (all must pass to throw ProviderFailoverError):
//   1. OPENCLAUDE_PROVIDER_FAILOVER !== '0'  (kill-switch)
//   2. workload === 'long-running'            (only pay the switch cost for long runs)
//   3. at least one alternative candidate exists (resolveProviderForClass returns >= 2 items)
//   4. error is auth / rate-limit / server (see classifyFailoverReason)
//
// Provenance: per-session JSONL at <projectDir>/<sessionId>/provider-failover.jsonl.
// Each line is a ProviderFailoverRecord — self-contained, machine-readable.

import * as fs from 'node:fs'
import * as path from 'node:path'
import { APIError } from '@anthropic-ai/sdk'
import { is529Error } from './withRetry.js'
import type { ResolvedProvider } from './resolvedProvider.js'
import type { RankedCandidate } from './modelRegistry.js'
import type { LoopWorkloadClass } from '../../types/loopDiscipline.js'

// ─── Error class ─────────────────────────────────────────────────────────────

/**
 * Thrown by `claude.ts` when all retries against a provider are exhausted,
 * the workload is `long-running`, at least one alternative provider is
 * available, and the kill-switch is not off.
 *
 * Caught in `query.ts` at the same level as `FallbackTriggeredError`.
 * The catch handler calls `resolveProviderForClass` (with excludeProvider),
 * updates `toolUseContext.options.providerOverride`, and `continue`s the loop.
 */
export class ProviderFailoverError extends Error {
  constructor(
    public readonly originalError: unknown,
    public readonly fromProvider: string,
    public readonly fromModel: string,
    public readonly reason: FailoverReason,
  ) {
    super(`Provider failover triggered: ${fromProvider}/${fromModel} (${reason})`)
    this.name = 'ProviderFailoverError'
  }
}

// ─── Reason classification ────────────────────────────────────────────────────

export type FailoverReason = 'auth' | 'rate_limit' | 'server_error'

/**
 * Classify the error into a failover reason, or return `null` if the error
 * is not one that warrants a provider switch.
 *
 * - auth:        401 (invalid key / expired token)
 * - rate_limit:  429 (quota exhausted — not transient; a per-minute 429 with
 *                short retry-after is handled inside `withRetry` directly)
 * - server_error: 5xx or 529 (overloaded) — provider is unhealthy
 *
 * Notably excludes: 400 (bad request — provider-specific, not a sign the
 * provider is down), 404 (handled by the streaming fallback path in claude.ts),
 * connection errors (retried by withRetry already with keep-alive disable).
 *
 * Uses duck-typing on `.status` and `.message` instead of `instanceof APIError`
 * so that both real SDK errors and plain-object mocks in tests are handled
 * identically — and so that errors wrapped in `CannotRetryError.originalError`
 * (which may have been reconstructed across a serialization boundary) are
 * classified correctly regardless of prototype chain.
 */
export function classifyFailoverReason(error: unknown): FailoverReason | null {
  // Duck-type: any error-like object with a numeric `status` field.
  // (We read status before calling is529Error so the 529/overloaded_error path
  // is also checked below via the >= 500 branch.)
  const status = (error as { status?: unknown })?.status
  const message = (error as { message?: unknown })?.message

  // is529Error requires instanceof APIError; supplement with duck-type status
  // and message checks so test mocks (plain objects) and real SDK errors are
  // both handled.
  const is529 =
    is529Error(error) ||
    status === 529 ||
    (typeof message === 'string' && message.includes('"type":"overloaded_error"'))
  if (is529) return 'server_error'

  if (typeof status !== 'number') return null
  if (status === 401) return 'auth'
  if (status === 429) return 'rate_limit'
  if (status >= 500) return 'server_error'
  return null
}

// ─── Decision gate ────────────────────────────────────────────────────────────

/**
 * Decide whether to trigger a provider failover given the exhausted-retry
 * context.  Pure function — no side effects, no I/O.
 *
 * @param error       The originalError from `CannotRetryError`.
 * @param workload    Current loop workload class from `state.loopDiscipline`.
 * @param candidates  Result of `resolveProviderForClass(…, { excludeProvider: failed })`.
 *                    May include the failed provider's model — the caller must pass
 *                    the already-filtered list (excludeProvider applied).
 *
 * Returns `{ failover: true, candidate, reason }` or `{ failover: false }`.
 */
export type FailoverDecision =
  | { failover: true; candidate: RankedCandidate; reason: FailoverReason }
  | { failover: false }

export function shouldFailover(
  error: unknown,
  workload: LoopWorkloadClass,
  candidates: RankedCandidate[],
  env: NodeJS.ProcessEnv = process.env,
): FailoverDecision {
  // Kill-switch: OPENCLAUDE_PROVIDER_FAILOVER=0 disables entirely.
  if (env.OPENCLAUDE_PROVIDER_FAILOVER === '0') return { failover: false }

  // Only fire on long-running workloads — direct/bounded callers should see the
  // error immediately rather than silently switching providers.
  if (workload !== 'long-running') return { failover: false }

  // No alternatives → nothing to switch to.
  if (candidates.length === 0) return { failover: false }

  const reason = classifyFailoverReason(error)
  if (reason === null) return { failover: false }

  // candidates[0] is the highest-ranked alternative (already sorted by
  // resolveProviderForClass with excludeProvider applied by the caller).
  return { failover: true, candidate: candidates[0], reason }
}

// ─── Provenance record ────────────────────────────────────────────────────────

/**
 * One line of the per-session failover provenance log.
 * Shape is intentionally narrow — no PII, no request content.
 */
export type ProviderFailoverRecord = {
  ts: string
  event: 'provider_failover'
  from_provider: string
  from_model: string
  to_provider: string
  to_model: string
  reason: FailoverReason
  workload: LoopWorkloadClass
  session_id: string
}

/**
 * Append a single failover record to the per-session JSONL log.
 * The log path is <projectDir>/<sessionId>/provider-failover.jsonl —
 * co-located with tool-results/ in the same session directory.
 *
 * Writes are best-effort; any I/O error is returned as `{ ok: false }` and
 * the caller swallows it — logging failure must not stall the loop.
 */
export function appendFailoverRecord(
  record: ProviderFailoverRecord,
  logPath: string,
  fileSystem: {
    mkdirSync: (p: string, opts: { recursive: boolean }) => void
    appendFileSync: (p: string, data: string) => void
  } = {
    mkdirSync: (p, o) => fs.mkdirSync(p, o),
    appendFileSync: (p, d) => fs.appendFileSync(p, d),
  },
): { ok: true } | { ok: false; error: string } {
  try {
    fileSystem.mkdirSync(path.dirname(logPath), { recursive: true })
    fileSystem.appendFileSync(logPath, JSON.stringify(record) + '\n')
    return { ok: true }
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

/**
 * Build the per-session failover log path.
 * Mirrors the toolResultStorage pattern: <projectDir>/<sessionId>/provider-failover.jsonl.
 */
export function getFailoverLogPath(
  projectDir: string,
  sessionId: string,
): string {
  return path.join(projectDir, sessionId, 'provider-failover.jsonl')
}

// ─── Kill-switch reader ───────────────────────────────────────────────────────

/**
 * True when the failover feature is active (kill-switch not off).
 * Exported so tests can check the gate without replying on env mutation.
 */
export function isProviderFailoverEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return env.OPENCLAUDE_PROVIDER_FAILOVER !== '0'
}
