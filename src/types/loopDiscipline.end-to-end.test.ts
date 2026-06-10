// End-to-end integration test for the loop-discipline harness.
//
// Walks the canonical sequence — every pattern firing once in the order
// the operator expects to see them in a real session. This test exists
// as documentation-by-test: anyone reading it can trace the harness's
// observable behavior through a representative workflow.
//
// Patterns exercised:
//   1. Phase-restricted tools (Phase B) — verified via the phase gate
//      evaluators called separately.
//   2. Anti-self-tamper (Phase C) — verified via the tamper evaluator.
//   3. Saturation redirect (Phase D) — counter + threshold logic.
//   4. Plan-then-edit (Phase E + E2-E5) — full state-machine flow.
//   5. Verification ledger (Phase F + F2) — completion gate.
//   6. Observability (Phase G + G2) — event stream invariants.
//
// Pattern 6 (consensus) is intentionally deferred per plan §10.
//
// The test is intentionally LONG so the lifecycle reads top-to-bottom
// as a story. Splitting it into N micro-tests would obscure the
// composition the harness is meant to demonstrate.

import { describe, expect, it } from 'bun:test'
import {
  applyEmitPlan,
  applyPhaseTransition,
  applyPhaseTransitionReset,
  applySaturationObservation,
  applyVerificationEntry,
  classifyIteration,
  createInitialLoopDisciplineState,
  evaluateCompletionExit,
  evaluateForcedPlan,
  evaluatePhaseTransition,
  FORCED_PLAN_TRIPS_THRESHOLD,
  hadMutationsThisLoop,
  SATURATION_THRESHOLD,
} from './loopDiscipline.js'
import {
  evaluatePhaseGate,
  evaluateSaturationRedirect,
  evaluateSelfTamperGuard,
} from '../services/tools/loopDisciplineHooks.js'

describe('End-to-end discipline lifecycle: a level-2 session', () => {
  it('runs the canonical plan-then-edit-with-verification flow', () => {
    // ── T0: session start. Discipline is at enforcement level (2).
    // The operator launches with LIMITLESS_IN_LOOP_DISCIPLINE=2 and
    // LIMITLESS_INITIAL_PHASE=build (default).
    let s = createInitialLoopDisciplineState(2, 'build')
    expect(s.level).toBe(2)
    expect(s.phase).toBe('build')
    expect(s.saturationCount).toBe(0)
    expect(s.saturationTripsThisTask).toBe(0)
    expect(s.verificationLedger).toEqual([])
    expect(s.events).toEqual([])

    // ── T1: model attempts Edit. Build allows it; no gate fires.
    expect(
      evaluatePhaseGate(s, 'Edit', { file_path: '/src/foo.ts' }).ok,
    ).toBe(true)
    s = applySaturationObservation({
      state: s,
      kind: classifyIteration({
        toolNamesUsed: ['Edit'],
        bashCommandsUsed: [],
      }),
      turnCount: 1,
    })
    expect(s.saturationCount).toBe(1) // first no-progress observation

    // ── T2: model tries to edit src/query.ts — the loop's own code.
    // Tamper guard at enforcement level blocks it.
    const tamperResult = evaluateSelfTamperGuard(
      s,
      'Edit',
      { file_path: '/Users/x/openclaude/src/query.ts' },
      true,
    )
    expect(tamperResult.ok).toBe(false)
    if (!tamperResult.ok) expect(tamperResult.gate).toBe('self-tamper')

    // ── T3: model gives up on tampering, edits a user file. Two more
    // no-progress turns. Saturation crosses the threshold.
    s = applySaturationObservation({
      state: s,
      kind: 'mutating-without-verification',
      turnCount: 2,
    })
    s = applySaturationObservation({
      state: s,
      kind: 'mutating-without-verification',
      turnCount: 3,
    })
    expect(s.saturationCount).toBeGreaterThanOrEqual(SATURATION_THRESHOLD)
    expect(s.saturationTripsThisTask).toBe(1) // first trip in this task

    // The saturation event was emitted to the observability stream.
    const tripEvents = s.events.filter(e => e.kind === 'saturation-trip')
    expect(tripEvents).toHaveLength(1)

    // ── T4: model attempts a fourth Edit. Saturation redirect blocks it.
    const blockedEdit = evaluateSaturationRedirect(
      s,
      'Edit',
      { file_path: '/src/foo.ts' },
    )
    expect(blockedEdit.ok).toBe(false)
    if (!blockedEdit.ok) {
      expect(blockedEdit.gate).toBe('saturation-redirect')
      expect(blockedEdit.reason).toContain('WebSearch')
    }

    // Read tools still pass — the redirect only gates mutations.
    expect(evaluateSaturationRedirect(s, 'Read', undefined).ok).toBe(true)
    // WebSearch / WebFetch ALWAYS pass — they're the path out.
    expect(evaluateSaturationRedirect(s, 'WebSearch', undefined).ok).toBe(true)
    expect(evaluateSaturationRedirect(s, 'WebFetch', undefined).ok).toBe(true)

    // ── T5: model takes the redirect. WebSearch fires.
    s = applySaturationObservation({
      state: s,
      kind: 'external-knowledge',
      turnCount: 4,
    })
    expect(s.saturationCount).toBe(0)
    expect(s.saturationProofTurn).toBe(4)

    // Edit now passes the redirect gate again.
    expect(evaluateSaturationRedirect(s, 'Edit', undefined).ok).toBe(true)

    // ── T6: model resumes editing. Three more no-progress turns. Second
    // saturation trip. This is where the force-plan escalation engages.
    s = applySaturationObservation({
      state: s,
      kind: 'mutating-without-verification',
      turnCount: 5,
    })
    s = applySaturationObservation({
      state: s,
      kind: 'mutating-without-verification',
      turnCount: 6,
    })
    s = applySaturationObservation({
      state: s,
      kind: 'mutating-without-verification',
      turnCount: 7,
    })
    expect(s.saturationTripsThisTask).toBe(FORCED_PLAN_TRIPS_THRESHOLD)

    // ── T7: harness evaluates the forced-plan gate. Force fires.
    const forcedPlan = evaluateForcedPlan(s)
    expect(forcedPlan.force).toBe(true)
    if (forcedPlan.force) expect(forcedPlan.reason).toContain('saturation')

    // The harness applies the transition automatically.
    s = applyPhaseTransition({
      state: s,
      to: 'plan',
      reason: forcedPlan.force ? forcedPlan.reason : 'forced',
      turnCount: 8,
      now: 0,
    })
    expect(s.phase).toBe('plan')
    expect(s.saturationCount).toBe(0)
    expect(s.saturationTripsThisTask).toBe(0) // reset on transition

    // ── T8: model in plan phase. Edit would be blocked by phase gate.
    expect(evaluatePhaseGate(s, 'Edit', undefined).ok).toBe(false)
    // Try to transition straight to build without emitting a plan.
    const earlyExit = evaluatePhaseTransition(s, 'build')
    expect(earlyExit.allowed).toBe(false)
    if (!earlyExit.allowed) expect(earlyExit.reason).toContain('EmitPlan')

    // ── T9: model calls EmitPlan. Now plan→build is unlocked.
    s = applyEmitPlan({
      state: s,
      plan: {
        intent: 'Wire a missing argument through the validation pipeline',
        files_to_edit: ['src/auth/validate.ts', 'src/auth/middleware.ts'],
        smallest_test: 'bun test src/auth/validate.test.ts',
      },
      turnCount: 9,
      now: 0,
    })
    expect(s.pendingPlan).not.toBeNull()

    const planToBuild = evaluatePhaseTransition(s, 'build')
    expect(planToBuild.allowed).toBe(true)

    // ── T10: model transitions to build. The plan is in scope for
    // verbatim injection on subsequent build turns.
    s = applyPhaseTransition({
      state: s,
      to: 'build',
      reason: 'plan emitted',
      turnCount: 10,
      now: 0,
    })
    expect(s.phase).toBe('build')
    expect(s.pendingPlan?.emittedAtTurn).toBe(9)
    expect(s.phaseEnteredAt).toBe(10)
    // The shouldInjectPlanHandoff predicate (pinned in the Phase E5
    // tests) returns true here.
    expect(s.pendingPlan!.emittedAtTurn < s.phaseEnteredAt).toBe(true)

    // ── T11: model edits. Tries to exit as "done."
    s = applySaturationObservation({
      state: s,
      kind: 'mutating-without-verification',
      turnCount: 11,
    })
    // Agent records its claim of verification.
    s = applyVerificationEntry({
      state: s,
      entry: { claim: 'I think it works', source: 'agent' },
      turnCount: 12,
      now: 0,
    })

    // Completion gate refuses — the ledger has no non-agent entries.
    const exitAttempt = evaluateCompletionExit(s, hadMutationsThisLoop(s))
    expect(exitAttempt.allowed).toBe(false)
    if (!exitAttempt.allowed) {
      expect(exitAttempt.nudge).toContain('COMPLETION EXIT BLOCKED')
      expect(exitAttempt.nudge).toContain('agent-source claim')
    }

    // ── T12: model runs the bash test. Auto-ledger writes a
    // source='tool' entry.
    s = applySaturationObservation({
      state: s,
      kind: classifyIteration({
        toolNamesUsed: ['Bash'],
        bashCommandsUsed: ['bun test src/auth/validate.test.ts'],
      }),
      turnCount: 13,
      verificationEvidence: 'bun test → 1 pass / 0 fail',
      now: 0,
    })

    // ── T13: completion gate now passes.
    const finalExit = evaluateCompletionExit(s, hadMutationsThisLoop(s))
    expect(finalExit.allowed).toBe(true)
    if (finalExit.allowed) {
      expect(finalExit.reason).toBe('completed_with_verification')
    }

    // ── Final invariants on the observability stream.
    const kinds = new Set(s.events.map(e => e.kind))
    expect(kinds.has('saturation-trip')).toBe(true)
    expect(kinds.has('saturation-reset')).toBe(true)
    expect(kinds.has('phase-transition')).toBe(true)
    expect(kinds.has('verification-write')).toBe(true)

    // phase-transition events should record exactly the transitions we
    // applied: build→plan, plan→build (two total).
    const transitions = s.events.filter(e => e.kind === 'phase-transition')
    expect(transitions).toHaveLength(2)
  })
})

describe('End-to-end discipline lifecycle: level 0 preserves legacy behavior', () => {
  it('runs the same flow at level 0 with no gates firing', () => {
    let s = createInitialLoopDisciplineState(0, 'build')
    expect(s.level).toBe(0)

    // Every gate is permissive at level 0.
    expect(
      evaluatePhaseGate(s, 'Edit', { file_path: '/x' }).ok,
    ).toBe(true)
    expect(
      evaluateSelfTamperGuard(
        s,
        'Edit',
        { file_path: '/openclaude/src/query.ts' },
        false,
      ).ok,
    ).toBe(true)
    expect(
      evaluateSaturationRedirect(s, 'Edit', undefined).ok,
    ).toBe(true)

    // applySaturationObservation at level 0 returns the state unchanged
    // when called from the loop (the loop guards on level === 0). We
    // simulate that here.
    if (s.level !== 0) {
      s = applySaturationObservation({
        state: s,
        kind: 'mutating-without-verification',
        turnCount: 1,
      })
    }
    // No event emission.
    expect(s.events).toEqual([])

    // Completion gate exits permissively.
    const exit = evaluateCompletionExit(s, true)
    expect(exit.allowed).toBe(true)
    if (exit.allowed) expect(exit.reason).toBe('completed_legacy')
  })
})

describe('End-to-end discipline lifecycle: transitions preserve invariants', () => {
  it('phase transitions reset BOTH saturationCount AND saturationTripsThisTask', () => {
    let s = createInitialLoopDisciplineState(2, 'build')
    // Manufacture an already-tripped state.
    s = {
      ...s,
      saturationCount: 5,
      saturationProofTurn: 3,
      saturationTripsThisTask: 2,
    }
    const next = applyPhaseTransitionReset(s)
    expect(next.saturationCount).toBe(0)
    expect(next.saturationProofTurn).toBeNull()
    expect(next.saturationTripsThisTask).toBe(0)
  })

  it('verification entries persist across phase transitions', () => {
    let s = createInitialLoopDisciplineState(2, 'build')
    s = applyVerificationEntry({
      state: s,
      entry: { claim: 'tests pass', source: 'tool' },
      turnCount: 1,
      now: 0,
    })
    expect(s.verificationLedger).toHaveLength(1)
    s = applyPhaseTransition({
      state: s,
      to: 'plan',
      reason: 'reconsider',
      turnCount: 2,
      now: 0,
    })
    // Ledger survives — only saturation counters reset.
    expect(s.verificationLedger).toHaveLength(1)
  })

  it('pendingPlan persists across phase transitions but is consumed by the gate', () => {
    let s = createInitialLoopDisciplineState(2, 'plan')
    s = applyEmitPlan({
      state: s,
      plan: { intent: 'x', files_to_edit: ['a'], smallest_test: 't' },
      turnCount: 2,
      now: 0,
    })
    expect(s.pendingPlan).not.toBeNull()
    s = applyPhaseTransition({
      state: s,
      to: 'build',
      reason: 'go',
      turnCount: 3,
      now: 0,
    })
    // pendingPlan survives — it's needed for plan-handoff injection.
    expect(s.pendingPlan).not.toBeNull()
    // But it would be considered stale relative to a new plan phase.
    const reentered = applyPhaseTransition({
      state: s,
      to: 'plan',
      reason: 'reconsider',
      turnCount: 7,
      now: 0,
    })
    // Plan was emitted at turn 2; new plan phase entered at turn 7.
    // The gate sees the plan as stale.
    expect(evaluatePhaseTransition(reentered, 'build').allowed).toBe(false)
  })
})
