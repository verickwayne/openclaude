// src/utils/model/outcomeLedger.ts
//
// Pure reader for .openclaude/ralph/ledger/outcomes.jsonl.
// Tolerates missing file (→ empty results) and malformed lines (→ skip).
// No caching, no fs watching — every call reads fresh.

import * as fs from 'node:fs'
import * as path from 'node:path'

// ─── Types ────────────────────────────────────────────────────────────────────

/** One JSONL line written by openralph-hook.sh. All fields optional because
 *  the hook skips absent YAML values rather than failing. */
export type LedgerEntry = {
  ts?: string
  session_id?: string | null
  task_slug?: string | null
  persona?: string | null
  workload?: string | null
  provider_model_used?: string | null
  status?: string | null
  tests_passed?: boolean | null
  new_gaps?: number | null
  duration_s?: number | null
}

/** Aggregated success stats for one (persona, workload, provider_model_used) cell. */
export type LedgerStats = {
  persona: string
  workload: string
  provider_model_used: string
  n: number
  successes: number
  /** successes / n, or null when n === 0. */
  successRate: number | null
  /** mean of non-null duration_s values, or null when none recorded. */
  avgDurationS: number | null
}

// ─── Constants ────────────────────────────────────────────────────────────────

/** Relative path from project root to the ledger file. */
export const LEDGER_RELATIVE_PATH = '.openclaude/ralph/ledger/outcomes.jsonl'

/** Minimum cell size before stats are considered reliable (epsilon-greedy
 *  exploration threshold used by resolveProviderForClass). */
export const MIN_RELIABLE_N = 3

/**
 * Wilson score lower confidence bound for a binomial proportion.
 *
 * Used as the sort key for ledger-ranked candidates (group 0) instead of
 * raw successRate, so that early-luck lock-in is dampened: a 3/3 record
 * (LCB ≈ 0.75 at z=1.0) no longer crushes a 5/8 record (LCB ≈ 0.45);
 * as n grows, LCB converges to the true rate.
 *
 * @param successes  Number of successful outcomes in the cell.
 * @param n          Total outcomes in the cell (must be > 0).
 * @param z          Normal quantile for the one-sided confidence level
 *                   (1.0 ≈ 84%, 1.28 ≈ 90%, 1.645 ≈ 95%).  Default 1.0.
 * @returns          Lower bound in [0, 1].  Returns 0 when n === 0.
 */
export function wilsonLower(successes: number, n: number, z = 1.0): number {
  if (n === 0) return 0
  const phat = successes / n
  const z2 = z * z
  const num =
    phat + z2 / (2 * n) - z * Math.sqrt(phat * (1 - phat) / n + z2 / (4 * n * n))
  const den = 1 + z2 / n
  return num / den
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Returns true when an entry counts as a success:
 * status === 'complete' AND tests_passed !== false.
 * Mirrors the shell/python definition in openralph-route-stats.sh.
 */
export function isSuccessEntry(entry: LedgerEntry): boolean {
  return entry.status === 'complete' && entry.tests_passed !== false
}

// ─── Core functions ───────────────────────────────────────────────────────────

/**
 * Read and parse outcomes.jsonl from `<projectRoot>/.openclaude/ralph/ledger/`.
 * Returns an empty array when the file is absent.
 * Malformed lines are silently skipped.
 */
export function readLedgerEntries(projectRoot: string): LedgerEntry[] {
  const ledgerPath = path.join(projectRoot, LEDGER_RELATIVE_PATH)
  let raw: string
  try {
    raw = fs.readFileSync(ledgerPath, 'utf8')
  } catch {
    return []
  }

  const entries: LedgerEntry[] = []
  for (const line of raw.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    try {
      const parsed = JSON.parse(trimmed) as LedgerEntry
      entries.push(parsed)
    } catch {
      // malformed line — skip
    }
  }
  return entries
}

/**
 * Aggregate ledger entries into per-(persona × workload × provider_model_used)
 * success-rate cells.
 *
 * Entries that are missing any of the three key fields are excluded from
 * aggregation; they cannot be attributed to a cell.
 */
export function aggregateLedgerStats(entries: LedgerEntry[]): LedgerStats[] {
  type CellKey = string
  const cells = new Map<
    CellKey,
    { persona: string; workload: string; model: string; n: number; successes: number; durations: number[] }
  >()

  for (const entry of entries) {
    const persona = entry.persona
    const workload = entry.workload
    const model = entry.provider_model_used
    if (!persona || !workload || !model) continue

    const key = `${persona}\0${workload}\0${model}`
    let cell = cells.get(key)
    if (!cell) {
      cell = { persona, workload, model, n: 0, successes: 0, durations: [] }
      cells.set(key, cell)
    }
    cell.n++
    if (isSuccessEntry(entry)) cell.successes++
    if (typeof entry.duration_s === 'number' && entry.duration_s !== null) {
      cell.durations.push(entry.duration_s)
    }
  }

  const result: LedgerStats[] = []
  for (const cell of cells.values()) {
    const avgDurationS =
      cell.durations.length > 0
        ? cell.durations.reduce((a, b) => a + b, 0) / cell.durations.length
        : null
    result.push({
      persona: cell.persona,
      workload: cell.workload,
      provider_model_used: cell.model,
      n: cell.n,
      successes: cell.successes,
      successRate: cell.n > 0 ? cell.successes / cell.n : null,
      avgDurationS,
    })
  }
  return result
}

/**
 * Convenience: read the ledger from `projectRoot` and return aggregated stats.
 */
export function getLedgerStats(projectRoot: string): LedgerStats[] {
  return aggregateLedgerStats(readLedgerEntries(projectRoot))
}
