# Routing Validation Design

**Date:** 2026-06-10
**Authored by:** routing-eval researcher (Sonnet 4.6, read-only), transcribed by the Fable 5 orchestrator. Grounded in `eef03ef..54a3e19` (feat/multi-provider).
**Inputs read:** `src/utils/model/outcomeLedger.ts`, `src/services/api/modelRegistry.ts` (`resolveProviderForClass`, `billingModel`, `buildModelRegistry`), `src/skills/bundled/openRalph.ts` (hook capture, route-stats, scheduler contract), the corresponding test files, `src/services/api/providerFailover.ts`, `docs/research/08-innovation-brainstorm.md`.

## Executive summary

The routing stack is architecturally sound but empirically unvalidated. Core risks: `MIN_RELIABLE_N = 3` is very small, `duration_s` is always null, there is no cost field, and the success signal (`status == complete AND tests_passed !== false`) conflates task difficulty with model quality. Three falsifiable hypotheses must hold before the moat claim does: ledger-ranked selection outperforms static for matched cells after sufficient data; the n<3 exploration rule converges in bounded dispatches when models genuinely differ; routing doesn't thrash when models are equivalent. The cheapest validation is a pure-function offline replay harness — seeded JSONL fixtures, deterministic dispatch simulation, regret vs oracle — runnable today at zero API cost via the existing pure exports. Live A/B at 20–40 dispatches (realistic solo-founder budget) detects only large effects (≥25pp at ~50% power), so the offline replay is the primary instrument. Blocking instrumentation gaps: missing cost field and no task-difficulty normalization; duration and billing splits are nice-to-have. Smallest shippable artifact: `src/services/api/modelRegistry.replay.test.ts` (~120 LOC, five scenarios, cumulative-regret assertion). Do-no-harm gate: ledger routing must not underperform static by more than 10pp at N=40 before production use.

## 1. Hypotheses (falsifiable)

### H1 — Ledger ranking beats static order for proven cells

For any (persona × workload × model-class) cell where all candidates have n ≥ `MIN_RELIABLE_N` (3), `resolveProviderForClass`'s top-1 achieves a higher verified-success rate over the next K dispatches than static top-1 (`STATIC_CLASS_CANDIDATES` position 0).

**Falsification:** at any cell with n ≥ MIN_RELIABLE_N and ≥2 live candidates, ledger top-1 success ≤ static top-1 over the next 20 dispatches (one-tailed, α = 0.10).

**Grounding:** only group-0 candidates are ledger-ranked; all-group-2 behavior is identical to static. H1 is testable only once a candidate has 3 recorded dispatches.

### H2 — Exploration converges within bounded dispatches when models genuinely differ

With true rates |p_A − p_B| ≥ Δ, the exploration rule converges to routing ≥80% of dispatches to the better model within K dispatches, K not exponential in pool size.

**Falsification:** 50 simulated sequences at p_A=0.80, p_B=0.40 (Δ=0.40): if the better-model dispatch fraction does not exceed 0.75 within 20 dispatches in the median simulation, rejected. For Δ=0.20, extend to 40.

**Grounding/risk:** group transitions at exactly n=3, rank frozen at the 3-sample rate. No posterior update, no confidence interval, no recency weighting. A model that improved server-side stays deprioritized unless re-dispatched — a potential dead-loop.

### H3 (guard) — Stable selection when models are equivalent

With p_A ≈ p_B (±5pp), selection fraction for top-1 stays ≥0.60 over any 20-dispatch window once both reach group 0.

**Falsification:** 100 simulations at p_A=p_B=0.70; if stability drops below 0.50 in >20% of simulations, violated. Thrashing makes the billing scheduler unreliable and confuses failover semantics.

### H4 (do-no-harm, verify FIRST) — Ledger routing never underperforms static by more than X

Over any 40-dispatch window, ledger-routing verified-success is no more than 10pp worse than static-order for the same cell. A guard rail, not an optimization target — lower evidence bar, more actionable: if bad luck in the first 3 draws can lock in an inferior choice, `MIN_RELIABLE_N` must rise before further deployment. The difficulty-normalization gap (§4 Gap 2) is the root cause of the failure mode (easy-task wins masquerading as model quality).

## 2. Experiment design

### 2a. Offline replay (primary — zero API cost, runnable today)

**File:** `src/services/api/modelRegistry.replay.test.ts` (bun:test). Imports `resolveProviderForClass` and `aggregateLedgerStats` — both pure, ledger entries injected as parameters, no fs.

**Scenarios:**
1. **(H1, strong signal)** model-X p=0.80 (8/10 entries), model-Y p=0.40 (4/10) — both group 0. Expect X first.
2. **(H2, convergence)** 50 sequences, p_A=0.80/p_B=0.40, start 1 entry each (group 1); each round: call resolveProviderForClass on accumulated entries, "dispatch" its top-1, sample outcome from true rate, append, repeat 30 rounds. Measure better-model fraction at N=20.
3. **(H3, stability)** p_A=p_B=0.70, 20 dispatches post-threshold; measure sliding-window stability.
4. **(difficulty confound — documented limitation, not a passing assertion)** adversarial: X gets easy tasks (always succeeds), Y gets hard (always fails); ledger says X=1.0/Y=0.0 though Y is superior per-difficulty. Record the oracle gap as commentary.
5. **(structural invariant)** one candidate per group (n=0 / n=2 / n=3): ordering group0 > group1 > group2 regardless of within-group-1 observed rates.

**Regret vs oracle:** oracle picks the higher true-rate model every round; cumulative regret = Σ(oracle_outcome − ledger_outcome). Target: ≤3 missed successes per 30 dispatches (10% learning overhead). Above that, exploration cost exceeds routing benefit — consider static-until-N=10-then-ledger.

**"Validated" =** Scenario 1 ranks correctly; Scenario 2 median better-model fraction ≥0.75 at N=20; Scenario 3 stability ≥0.60 in ≥80% of sims; Scenario 5 invariant holds. Seeded LCG PRNG for reproducibility (Math.random isn't seedable); expose `makePRNG(seed)`.

**Size:** ~120 LOC (PRNG ~15, fixture builder ~15, simulateDispatchSequence ~35, four tests ~55). Registry fixture per modelRegistry.test.ts pattern: `{ firstPartyModels: ['haiku','gpt-5.5-mini'], profiles: [] }` — both in `STATIC_CLASS_CANDIDATES.fast`.

### 2b. Live A/B (deferred until offline passes)

Scratch repo, alternate per paired task: Arm A standard ledger-ranked; Arm B `ledgerEntries: []` (forces group 2 = static order). Same persona (openralph-builder), same workload, same task category, sequential not simultaneous. **Power, honestly:** N=20 paired at α=0.10 one-tailed ≈ 50% power for a 25pp difference; a 10pp difference needs N≈200. So live A/B is a sanity check for catastrophic failure, not proof of optimality. Pre-register: H1 supported if Fisher's exact p<0.15 or ledger arm exceeds static by ≥15pp. Report raw counts.

## 3. Metrics

1. **Verified-success rate** — successes/n per cell, success = `status==='complete' && tests_passed !== false` (mirrors `isSuccessEntry`). Reliability limits: (a) `tests_passed: null` counts as success — "completed, unverified" is indistinguishable from "tests passed"; consider a strict `=== true` variant for validation runs. (b) `status: complete` is self-reported; checker rows exist but aren't joined to worker rows (Gap 4). (c) No difficulty normalization (Gap 2).
2. **Cumulative regret vs oracle** — temporal cost of learning; post-convergence regret should approach zero.
3. **Exploration cost** — dispatches on group-1 candidates before all reach group 0. Worst case (C−1)×3; C=3 → 6 dispatches (fine), C=5 → 12. Replay should measure at MIN_RELIABLE_N = 3 vs 5.
4. **Selection stability** — sliding-window top-1 fraction; concern below 0.60 post-group-0.
5. **Do-no-harm gate** — retrospective replay of the dispatch history under static strategy; if ledger underperforms by >10pp at N=40, freeze ledger-ranking for that cell (fall back to static) until n ≥ 20. Circuit-breaker, not kill switch.

## 4. Instrumentation gaps

**Blocking-ish:**
- **Gap 1 — duration_s always null.** Hook sets None ("not available from stdin"). Blocks cost-per-success and billing validation; regret works without it. Fix: PreToolUse start-timestamp + PostToolUse elapsed — ~5 lines in the hook Python; both events already handled.
- **Gap 2 — no task-difficulty normalization.** `workload` is session-level (always "long-running" post-89a0309), not task-level. Observed success mixes model quality with task difficulty. Partially blocks H1 in live data (replay sidesteps with synthetic fixtures). Fix: `task_category` field (implementation/debugging/research/refactoring) in task YAML + persona-result YAML — non-breaking extension.
- **Gap 3 — no cost field.** "Verified-success per dollar" (the §2 Angle A endgame) is uncomputable. Doesn't block H1–H3; reframes H4 ideally as cost-adjusted. Nice-to-have now.

**Nice-to-have:**
- **Gap 4 — no checker↔worker join.** Both rows carry task_slug but it's often null. Mandatory task_slug + a join would enable checker-verified success rate (stricter than self-report).
- **Gap 5 — no session-carryover test.** Ledger→routing connection is via the prompt instruction (step 8), not mechanical; a session that skips route-stats routes statically. Untested.

## 5. Smallest shippable slice

`src/services/api/modelRegistry.replay.test.ts`, ~120 LOC, bun:test, imports listed in §2a, scenarios 1/2/3/5 as passing assertions + scenario 4 as recorded commentary. Run: `bun test src/services/api/modelRegistry.replay.test.ts`. Passing suite with reproducible seeds = the validation bar for the current algorithm at MIN_RELIABLE_N=3 (and the harness doubles as the regression net for any future bandit upgrade).

## 6. How this validation could mislead

1. **Adjudication selection bias** — adjudicated entries ("highest-value A/B data") come disproportionately from hard/stuck tasks (the trigger conditions). Preferences learned on hard tasks may invert on easy ones; no `adjudicated` flag exists in the ledger to stratify.
2. **Persona confounds** — persona is role, not task type; one cell mixes radically different complexities. Structural until Gap 2 closes.
3. **Non-stationarity (the most dangerous for the moat claim)** — providers silently re-point model IDs at new weights. No decay/recency weighting exists; January's best may be March's worst under the same ID, and the ledger amplifies stale preferences. Mitigation to implement later: time-window filtering + per-cell confidence expiry with forced re-exploration.
4. **Success signal is not ground truth** — both fields self-reported; uniform over-reporting inflates everything equally, but *differential* over-reporting by model family creates spurious preferences. Checker join (Gap 4) is the cure.
5. **Circular coverage** — incumbents that reach group 0 first keep receiving dispatches and keep accumulating data; group-2 newcomers only get dispatched when incumbents fail or are excluded. Left alone, the ledger tends to confirm the static order it was seeded with rather than discover alternatives. The group-1 exploration rule mitigates only for models that get at least one dispatch.
