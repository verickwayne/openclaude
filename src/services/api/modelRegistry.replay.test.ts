// src/services/api/modelRegistry.replay.test.ts
//
// Offline replay harness: validates ledger-based routing against an oracle.
// Pure-function — no fs, no API calls, no module mocks.
// Spec: docs/research/09-routing-validation-design.md §2a and §5.

import { expect, test, describe } from 'bun:test'
import { resolveProviderForClass } from './modelRegistry.js'
import {
  aggregateLedgerStats,
  MIN_RELIABLE_N,
  type LedgerEntry,
} from '../../utils/model/outcomeLedger.js'

// ─── Registry fixture ─────────────────────────────────────────────────────────
// Both 'haiku' and 'gpt-5.5-mini' are in STATIC_CLASS_CANDIDATES.fast;
// registering as first-party makes them live candidates.
const REPLAY_REGISTRY = {
  firstPartyModels: ['haiku', 'gpt-5.5-mini'],
  profiles: [] as any[],
}

// ─── Seeded LCG PRNG ──────────────────────────────────────────────────────────
// Park-Miller LCG (multiplier 16807, modulus 2^31−1).
// Returns a function f() → [0, 1) — no Math.random, fully reproducible.
function makePRNG(seed: number): () => number {
  let state = seed >>> 0
  if (state === 0) state = 1
  const M = 2147483647
  const A = 16807
  return () => {
    state = (state * A) % M
    return state / M
  }
}

// ─── Fixture builder ──────────────────────────────────────────────────────────
// Matches the pattern from modelRegistry.test.ts ledgerEntries().
function makeEntries(
  model: string,
  n: number,
  successRate: number,
  persona = 'openralph-builder',
  workload = 'long-running',
): LedgerEntry[] {
  return Array.from({ length: n }, (_, i) => ({
    ts: `2026-06-10T10:${String(i).padStart(2, '0')}:00Z`,
    session_id: `replay-${model}-${i}`,
    task_slug: `task-${i}`,
    persona,
    workload,
    provider_model_used: model,
    status: (i / n < successRate ? 'complete' : 'partial') as 'complete' | 'partial',
    tests_passed: i / n < successRate ? true : false,
    new_gaps: 0,
    duration_s: null,
  }))
}

// ─── Simulation engine ────────────────────────────────────────────────────────
type DispatchRound = {
  round: number
  dispatchedModel: string
  success: boolean
  oracleModel: string
  oracleSuccess: boolean
}

/**
 * simulateDispatchSequence: runs N rounds of the ledger-driven dispatch loop.
 *
 * Each round:
 *   1. Call resolveProviderForClass with the accumulated ledger entries.
 *   2. Take top-1 as the dispatched model.
 *   3. Sample success from its true rate using `prng`.
 *   4. Append a well-formed LedgerEntry to the accumulated entries.
 *   5. Oracle: always picks the highest true-rate model; sample its outcome.
 *
 * Returns the per-round dispatch/outcome history.
 */
function simulateDispatchSequence(
  registryInput: typeof REPLAY_REGISTRY,
  trueRates: Record<string, number>,
  prng: () => number,
  N: number,
  initialEntries: LedgerEntry[] = [],
  opts: { persona?: string; workload?: string } = {},
): DispatchRound[] {
  const persona = opts.persona ?? 'openralph-builder'
  const workload = opts.workload ?? 'long-running'
  const accumulated: LedgerEntry[] = [...initialEntries]
  const rounds: DispatchRound[] = []

  // Determine oracle model (static — highest true rate)
  const oracleModel = Object.entries(trueRates).reduce((best, [m, r]) =>
    r > (trueRates[best] ?? 0) ? m : best,
  Object.keys(trueRates)[0] ?? '',
  )

  for (let round = 0; round < N; round++) {
    const candidates = resolveProviderForClass('fast', registryInput, {
      ledgerEntries: accumulated,
      persona,
      workload,
    } as any)

    const dispatched = candidates[0]?.model ?? oracleModel
    const trueRate = trueRates[dispatched] ?? 0
    const success = prng() < trueRate

    // Oracle samples independently
    const oracleRate = trueRates[oracleModel] ?? 0
    const oracleSuccess = prng() < oracleRate

    accumulated.push({
      ts: `2026-06-10T12:${String(round).padStart(2, '0')}:00Z`,
      session_id: `sim-${round}`,
      task_slug: `sim-task-${round}`,
      persona,
      workload,
      provider_model_used: dispatched,
      status: success ? 'complete' : 'partial',
      tests_passed: success ? true : false,
      new_gaps: 0,
      duration_s: null,
    })

    rounds.push({ round, dispatchedModel: dispatched, success, oracleModel, oracleSuccess })
  }

  return rounds
}

// ─── Scenario 1: H1 — Strong-signal ranking ──────────────────────────────────
// 8/10 vs 4/10 entries; both ≥ MIN_RELIABLE_N → group-0; better model ranks first.

describe('Scenario 1 — H1: strong-signal ranking', () => {
  test('model with 0.80 rate (8/10) ranks above model with 0.40 rate (4/10)', () => {
    const entries: LedgerEntry[] = [
      ...makeEntries('haiku', 10, 0.8),      // 8/10 successes
      ...makeEntries('gpt-5.5-mini', 10, 0.4), // 4/10 successes
    ]

    const candidates = resolveProviderForClass('fast', REPLAY_REGISTRY, {
      ledgerEntries: entries,
    } as any)

    expect(candidates.length).toBeGreaterThanOrEqual(2)
    expect(candidates[0]?.model).toBe('haiku')

    const haikuRate = candidates.find(c => c.model === 'haiku')?.ledgerSuccessRate
    const miniRate = candidates.find(c => c.model === 'gpt-5.5-mini')?.ledgerSuccessRate
    // Measured: haiku ~0.80, gpt-5.5-mini ~0.40
    expect(haikuRate).toBeGreaterThan(miniRate ?? 1)
    console.log(`[Scenario 1] haiku ledgerSuccessRate=${haikuRate?.toFixed(3)}, gpt-5.5-mini=${miniRate?.toFixed(3)}`)
  })
})

// ─── Scenario 2: H2 — Convergence ────────────────────────────────────────────
// 50 seeded simulations p_A=0.80/p_B=0.40; start 1 entry each (group 1).
// Measure better-model dispatch fraction at N=20, median ≥ 0.75.
// Also assert cumulative regret ≤ 3 missed successes per 30 dispatches (median).

describe('Scenario 2 — H2: convergence', () => {
  test('median better-model dispatch fraction ≥ 0.75 at N=20 (50 sims, p_A=0.80/p_B=0.40)', () => {
    const trueRates = { 'haiku': 0.80, 'gpt-5.5-mini': 0.40 }
    const betterModel = 'haiku'
    const N_SIMS = 50
    const N_ROUNDS = 30
    const N_MEASURE = 20  // measure at round 20

    const fractions: number[] = []
    const regrets: number[] = []

    for (let s = 0; s < N_SIMS; s++) {
      const prng = makePRNG(s + 1)
      // Start with 1 entry each (group 1 — under-sampled)
      const initial: LedgerEntry[] = [
        ...makeEntries('haiku', 1, 0.80),
        ...makeEntries('gpt-5.5-mini', 1, 0.40),
      ]

      const rounds = simulateDispatchSequence(
        REPLAY_REGISTRY,
        trueRates,
        prng,
        N_ROUNDS,
        initial,
      )

      // Dispatch fraction: how often the better model was dispatched in first 20 rounds
      const first20 = rounds.slice(0, N_MEASURE)
      const betterDispatches = first20.filter(r => r.dispatchedModel === betterModel).length
      fractions.push(betterDispatches / N_MEASURE)

      // Cumulative regret at round 30: missed successes vs oracle
      const cumulativeRegret = rounds.reduce((acc, r) => {
        const oracleWouldSucceed = r.oracleSuccess
        const ledgerSucceeded = r.success
        // Regret: oracle succeeded but ledger didn't on same opportunity
        // (oracle and ledger sample independently, so we measure structural regret:
        //  dispatching suboptimal model = expected regret per round of (p_oracle - p_dispatched))
        const dispatchedRate = trueRates[r.dispatchedModel] ?? 0
        const oracleRate = trueRates[r.oracleModel] ?? 0
        return acc + Math.max(0, oracleRate - dispatchedRate)
      }, 0)
      regrets.push(cumulativeRegret)
    }

    fractions.sort((a, b) => a - b)
    regrets.sort((a, b) => a - b)
    const medianFraction = fractions[Math.floor(N_SIMS / 2)] ?? 0
    const medianRegret = regrets[Math.floor(N_SIMS / 2)] ?? 0

    console.log(`[Scenario 2] Median better-model dispatch fraction at N=20: ${medianFraction.toFixed(3)} (threshold: 0.75)`)
    console.log(`[Scenario 2] Median cumulative regret at N=30: ${medianRegret.toFixed(2)} missed successes (threshold: ≤3)`)

    expect(medianFraction).toBeGreaterThanOrEqual(0.75)
    // Regret target: ≤ 3 missed successes per 30 dispatches (10% learning overhead)
    expect(medianRegret).toBeLessThanOrEqual(3)
  })
})

// ─── Scenario 3: H3 — Stability when models are equivalent ───────────────────
// 100 sims p_A=p_B=0.70; sliding-20-window top-1 stability ≥ 0.60 in ≥ 80% of sims.
//
// Fix (commit fix(model-registry): confidence-adjusted ledger ranking ends early-luck lock-in):
// Group-0 sort key changed from raw successRate to Wilson lower confidence bound (LCB, z=1.0).
// With LCB, a 3/3 lucky start (LCB≈0.75) is no longer as dominant over a subsequent
// 3/4 record (LCB≈0.50) — as the losing candidate accumulates data its LCB grows toward
// the true rate, allowing re-ranking before the gap becomes irreversible.
// Measured stability (100 sims, seeded LCG, z=1.0): ≥80% of sims pass the 0.60 threshold.

describe('Scenario 3 — H3: stability when models are equivalent', () => {
  test('sliding-20-window stability ≥ 0.60 in ≥ 80% of sims (100 sims, p_A=p_B=0.70)', () => {
    const trueRates = { 'haiku': 0.70, 'gpt-5.5-mini': 0.70 }
    const N_SIMS = 100
    const N_ROUNDS = 40
    const WINDOW = 20
    const STABILITY_THRESHOLD = 0.60  // top-1 must be same model in ≥ 60% of window
    const PASS_RATE_THRESHOLD = 0.80  // ≥ 80% of simulations must be stable

    let stableSims = 0

    for (let s = 0; s < N_SIMS; s++) {
      const prng = makePRNG(s + 1)
      // Start with MIN_RELIABLE_N entries each so both are in group 0 from round 1
      const initial: LedgerEntry[] = [
        ...makeEntries('haiku', MIN_RELIABLE_N, 0.70),
        ...makeEntries('gpt-5.5-mini', MIN_RELIABLE_N, 0.70),
      ]

      const rounds = simulateDispatchSequence(
        REPLAY_REGISTRY,
        trueRates,
        prng,
        N_ROUNDS,
        initial,
      )

      // Sliding 20-window: take last WINDOW rounds
      const windowRounds = rounds.slice(-WINDOW)
      const top1Counts = new Map<string, number>()
      for (const r of windowRounds) {
        top1Counts.set(r.dispatchedModel, (top1Counts.get(r.dispatchedModel) ?? 0) + 1)
      }
      const maxCount = Math.max(...top1Counts.values())
      const stability = maxCount / WINDOW

      if (stability >= STABILITY_THRESHOLD) stableSims++
    }

    const stableRate = stableSims / N_SIMS
    console.log(`[Scenario 3] Stable simulations: ${stableSims}/${N_SIMS} = ${stableRate.toFixed(3)} (threshold: ≥${PASS_RATE_THRESHOLD})`)

    expect(stableRate).toBeGreaterThanOrEqual(PASS_RATE_THRESHOLD)
  })
})

// ─── Scenario 4: Difficulty confound — documented limitation ─────────────────
// adversarial: haiku gets easy tasks (always succeeds), gpt-5.5-mini gets hard (always fails).
// ledger says haiku=1.0/gpt-5.5-mini=0.0 though difficulty confounds the signal.
// NOT a pass/fail assertion — harness runs and records oracle gap as commentary.

describe('Scenario 4 — difficulty confound (documented limitation, harness-runs-only)', () => {
  test('records oracle gap — adversarial difficulty confound (no threshold assertion)', () => {
    // haiku: easy tasks → always succeeds. gpt-5.5-mini: hard tasks → always fails.
    // True per-difficulty rates are p_haiku_easy=1.0, p_mini_hard=0.0
    // but the oracle (if difficulty-normalized) would show both are equally capable.
    const confoundEntries: LedgerEntry[] = [
      ...makeEntries('haiku', 10, 1.0),       // 10/10 easy tasks
      ...makeEntries('gpt-5.5-mini', 10, 0.0), // 0/10 hard tasks
    ]

    const candidates = resolveProviderForClass('fast', REPLAY_REGISTRY, {
      ledgerEntries: confoundEntries,
    } as any)

    const haikuRate = candidates.find(c => c.model === 'haiku')?.ledgerSuccessRate ?? 0
    const miniRate = candidates.find(c => c.model === 'gpt-5.5-mini')?.ledgerSuccessRate ?? 0

    // Oracle gap: ledger believes haiku is superior by this margin
    const oracleGap = haikuRate - miniRate
    const ledgerTop1 = candidates[0]?.model

    // DOCUMENTED LIMITATION (§4 Gap 2): difficulty normalization absent.
    // The ledger correctly records observed success rates but cannot distinguish
    // model quality from task difficulty. haiku appears superior purely because
    // it received easier tasks. This confound is structural until task_category
    // field + per-cell difficulty normalization is implemented (Gap 2).
    console.log(`[Scenario 4 — DOCUMENTED LIMITATION] Oracle gap: ${oracleGap.toFixed(3)}`)
    console.log(`[Scenario 4 — DOCUMENTED LIMITATION] Ledger top-1: ${ledgerTop1} (haiku ranked first due to difficulty confound, not model quality)`)
    console.log(`[Scenario 4 — DOCUMENTED LIMITATION] haiku ledger rate=${haikuRate}, gpt-5.5-mini ledger rate=${miniRate}`)
    console.log(`[Scenario 4 — DOCUMENTED LIMITATION] Fix: add task_category to LedgerEntry + normalize by difficulty bucket`)

    // Only assertion: harness ran without error. No threshold bar.
    expect(oracleGap).toBeDefined()
    expect(candidates.length).toBeGreaterThan(0)
  })
})

// ─── Scenario 5: Group-ordering structural invariant ─────────────────────────
// Candidates at n=0 / n=2 / n=3: group0 > group1 > group2 regardless of rates.

describe('Scenario 5 — structural invariant: group0 > group1 > group2', () => {
  test('n=3 (group0) ranks before n=2 (group1) ranks before n=0 (group2)', () => {
    // haiku: n=MIN_RELIABLE_N (=3) → group 0 (reliable)
    // gpt-5.5-mini: n=2 → group 1 (under-sampled)
    // gpt-5.4-mini: n=0 → group 2 (no data)
    // Add gpt-5.4-mini to the live registry
    const registryWith3Models = {
      firstPartyModels: ['haiku', 'gpt-5.5-mini', 'gpt-5.4-mini'],
      profiles: [] as any[],
    }

    const entries: LedgerEntry[] = [
      ...makeEntries('haiku', MIN_RELIABLE_N, 0.5),     // group 0: n=3
      ...makeEntries('gpt-5.5-mini', MIN_RELIABLE_N - 1, 0.9), // group 1: n=2 (high rate but under-sampled)
      // gpt-5.4-mini: no entries → group 2
    ]

    const candidates = resolveProviderForClass('fast', registryWith3Models, {
      ledgerEntries: entries,
    } as any)

    const haikuIdx = candidates.findIndex(c => c.model === 'haiku')
    const miniIdx = candidates.findIndex(c => c.model === 'gpt-5.5-mini')
    const mini4Idx = candidates.findIndex(c => c.model === 'gpt-5.4-mini')

    console.log(`[Scenario 5] group0(haiku) idx=${haikuIdx}, group1(gpt-5.5-mini) idx=${miniIdx}, group2(gpt-5.4-mini) idx=${mini4Idx}`)
    console.log(`[Scenario 5] gpt-5.5-mini (n=2, 0.90 rate) stays group1 — group boundary prevents rate from promoting it over group0`)

    // group0 > group1 > group2 regardless of within-group rates
    expect(haikuIdx).toBeLessThan(miniIdx)   // group0 before group1
    expect(miniIdx).toBeLessThan(mini4Idx)    // group1 before group2

    // Verify the group annotations on the candidates
    expect(candidates[haikuIdx]?.ledgerN).toBe(MIN_RELIABLE_N)
    expect(candidates[miniIdx]?.ledgerN).toBe(MIN_RELIABLE_N - 1)
    expect(candidates[mini4Idx]?.ledgerN).toBe(0)
  })

  test('within-group-1: high observed rate still ranks after any group-0 candidate', () => {
    // Even if gpt-5.5-mini has 2/2 = 100% rate (group1), haiku with 1/3 = 33% (group0) ranks first
    const registryWith2Models = {
      firstPartyModels: ['haiku', 'gpt-5.5-mini'],
      profiles: [] as any[],
    }

    const entries: LedgerEntry[] = [
      ...makeEntries('haiku', MIN_RELIABLE_N, 1 / 3),          // group 0: n=3, rate=0.33
      ...makeEntries('gpt-5.5-mini', MIN_RELIABLE_N - 1, 1.0), // group 1: n=2, rate=1.0
    ]

    const candidates = resolveProviderForClass('fast', registryWith2Models, {
      ledgerEntries: entries,
    } as any)

    expect(candidates[0]?.model).toBe('haiku') // group0 beats group1 even with lower rate
    expect(candidates[0]?.ledgerN).toBe(MIN_RELIABLE_N)
    expect(candidates[1]?.model).toBe('gpt-5.5-mini')
  })
})
