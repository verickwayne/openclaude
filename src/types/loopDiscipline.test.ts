import { describe, expect, it } from 'bun:test'
import {
  createInitialLoopDisciplineState,
  DEFAULT_INITIAL_PHASE,
  getDisciplineEvents,
  MUTATING_BASH_PATTERN,
  MUTATING_TOOL_NAMES,
  PHASE_TOOL_ALLOWLIST,
  readDisciplineLevel,
  readInitialPhase,
  TAMPER_DENY_PREFIXES,
} from './loopDiscipline.js'

describe('readDisciplineLevel', () => {
  it('returns 0 when unset (legacy preservation)', () => {
    expect(readDisciplineLevel({})).toBe(0)
  })

  it('returns 1 for advisory', () => {
    expect(readDisciplineLevel({ OPENCLAUDE_IN_LOOP_DISCIPLINE: '1' })).toBe(1)
  })

  it('returns 2 for enforcement', () => {
    expect(readDisciplineLevel({ OPENCLAUDE_IN_LOOP_DISCIPLINE: '2' })).toBe(2)
  })

  it('treats unrecognized values as 0 (fail safe to legacy)', () => {
    expect(readDisciplineLevel({ OPENCLAUDE_IN_LOOP_DISCIPLINE: 'yes' })).toBe(0)
    expect(readDisciplineLevel({ OPENCLAUDE_IN_LOOP_DISCIPLINE: '3' })).toBe(0)
  })
})

describe('readInitialPhase', () => {
  it('returns the default when unset', () => {
    expect(readInitialPhase({})).toBe(DEFAULT_INITIAL_PHASE)
    expect(readInitialPhase({})).toBe('build')
  })

  it('honors each valid phase', () => {
    for (const p of ['explore', 'plan', 'build', 'verify', 'refine'] as const) {
      expect(readInitialPhase({ OPENCLAUDE_INITIAL_PHASE: p })).toBe(p)
    }
  })

  it('falls back silently on typo', () => {
    expect(readInitialPhase({ OPENCLAUDE_INITIAL_PHASE: 'explor' })).toBe('build')
  })
})

describe('createInitialLoopDisciplineState', () => {
  it('produces a safe default state at level 0', () => {
    const s = createInitialLoopDisciplineState(0)
    expect(s.level).toBe(0)
    expect(s.phase).toBe('build')
    expect(s.phaseHistory).toEqual([])
    expect(s.phaseEnteredAt).toBe(1)
    expect(s.saturationCount).toBe(0)
    expect(s.saturationProofTurn).toBeNull()
    expect(s.verificationLedger).toEqual([])
    expect(s.tamperGuardEnabled).toBe(false)
    expect(s.consensusRecords).toEqual([])
    expect(s.events).toEqual([])
  })

  it('enables tamper guard from level 1', () => {
    expect(createInitialLoopDisciplineState(1).tamperGuardEnabled).toBe(true)
    expect(createInitialLoopDisciplineState(2).tamperGuardEnabled).toBe(true)
  })

  it('honors an explicit initial phase override', () => {
    const s = createInitialLoopDisciplineState(2, 'explore')
    expect(s.phase).toBe('explore')
  })
})

describe('PHASE_TOOL_ALLOWLIST', () => {
  it('covers every phase', () => {
    const phases = ['explore', 'plan', 'build', 'verify', 'refine'] as const
    for (const p of phases) {
      expect(PHASE_TOOL_ALLOWLIST[p]).toBeDefined()
    }
  })

  it('keeps build unrestricted (legacy behavior)', () => {
    expect(PHASE_TOOL_ALLOWLIST.build.allow).toBe('*')
  })

  it('blocks edit-class tools from explore and plan', () => {
    for (const p of ['explore', 'plan'] as const) {
      const allow = PHASE_TOOL_ALLOWLIST[p].allow
      expect(allow).not.toBe('*')
      expect(allow as string[]).not.toContain('Edit')
      expect(allow as string[]).not.toContain('Write')
    }
  })

  it('denies destructive Bash commands in non-build phases', () => {
    for (const p of ['explore', 'plan', 'verify'] as const) {
      const patterns = PHASE_TOOL_ALLOWLIST[p].bashDenyPatterns
      expect(patterns).toBeDefined()
      expect(patterns!.some(r => r.test('git commit -m x'))).toBe(true)
    }
  })
})

describe('saturation mutation detectors', () => {
  it('flags the canonical mutating tools', () => {
    expect(MUTATING_TOOL_NAMES.has('Edit')).toBe(true)
    expect(MUTATING_TOOL_NAMES.has('Write')).toBe(true)
    expect(MUTATING_TOOL_NAMES.has('MultiEdit')).toBe(true)
    expect(MUTATING_TOOL_NAMES.has('Read')).toBe(false)
    expect(MUTATING_TOOL_NAMES.has('Grep')).toBe(false)
  })

  it('flags mutating bash commands', () => {
    expect(MUTATING_BASH_PATTERN.test('rm -rf foo')).toBe(true)
    expect(MUTATING_BASH_PATTERN.test('git commit -m x')).toBe(true)
    expect(MUTATING_BASH_PATTERN.test('git push')).toBe(true)
    expect(MUTATING_BASH_PATTERN.test('git status')).toBe(false)
    expect(MUTATING_BASH_PATTERN.test('ls -la')).toBe(false)
  })
})

describe('TAMPER_DENY_PREFIXES', () => {
  it('protects the core loop discipline machinery', () => {
    expect(TAMPER_DENY_PREFIXES).toContain('src/query.ts')
    expect(TAMPER_DENY_PREFIXES).toContain('src/services/tools/toolHooks.ts')
    expect(TAMPER_DENY_PREFIXES).toContain('src/types/loopDiscipline.ts')
  })
})

describe('getDisciplineEvents', () => {
  it('reads back the empty stream on a fresh state', () => {
    const s = createInitialLoopDisciplineState(0)
    expect(getDisciplineEvents(s)).toEqual([])
  })
})

// ─────────────────────────────────────────────────────────────────────
// Phase D — saturation tracking helpers
// ─────────────────────────────────────────────────────────────────────

import {
  applyPhaseTransitionReset,
  applySaturationObservation,
  classifyIteration,
  SATURATION_PROOF_TOOL_NAMES,
  SATURATION_THRESHOLD,
  VERIFICATION_BASH_PATTERN,
} from './loopDiscipline.js'

describe('classifyIteration', () => {
  it('classifies a Edit-only turn as mutating-without-verification', () => {
    expect(
      classifyIteration({
        toolNamesUsed: ['Edit', 'Edit'],
        bashCommandsUsed: [],
      }),
    ).toBe('mutating-without-verification')
  })

  it('classifies a test run as verification (overrides any concurrent mutation)', () => {
    expect(
      classifyIteration({
        toolNamesUsed: ['Edit'],
        bashCommandsUsed: ['bun test'],
      }),
    ).toBe('verification')
  })

  it('classifies a typecheck run as verification', () => {
    for (const cmd of ['npm run typecheck', 'tsc --noEmit', 'bun run typecheck']) {
      expect(
        classifyIteration({ toolNamesUsed: [], bashCommandsUsed: [cmd] }),
      ).toBe('verification')
    }
  })

  it('classifies WebSearch as external-knowledge (highest priority)', () => {
    expect(
      classifyIteration({
        toolNamesUsed: ['WebSearch', 'Edit'],
        bashCommandsUsed: ['bun test'],
      }),
    ).toBe('external-knowledge')
  })

  it('classifies WebFetch as external-knowledge', () => {
    expect(
      classifyIteration({
        toolNamesUsed: ['WebFetch'],
        bashCommandsUsed: [],
      }),
    ).toBe('external-knowledge')
  })

  it('classifies mutating bash commands', () => {
    expect(
      classifyIteration({
        toolNamesUsed: ['Bash'],
        bashCommandsUsed: ['git commit -m fix'],
      }),
    ).toBe('mutating-without-verification')
  })

  it('classifies a Read-only turn as inert', () => {
    expect(
      classifyIteration({
        toolNamesUsed: ['Read', 'Grep'],
        bashCommandsUsed: ['ls -la', 'git status'],
      }),
    ).toBe('inert')
  })

  it('classifies an empty turn as inert', () => {
    expect(
      classifyIteration({ toolNamesUsed: [], bashCommandsUsed: [] }),
    ).toBe('inert')
  })
})

describe('applySaturationObservation', () => {
  const base = createInitialLoopDisciplineState(2)

  it('increments on mutating-without-verification', () => {
    const next = applySaturationObservation({
      state: base,
      kind: 'mutating-without-verification',
      turnCount: 5,
    })
    expect(next.saturationCount).toBe(1)
    expect(next.saturationProofTurn).toBeNull()
  })

  it('keeps incrementing across consecutive mutating iterations', () => {
    let s = base
    for (let i = 1; i <= SATURATION_THRESHOLD; i++) {
      s = applySaturationObservation({
        state: s,
        kind: 'mutating-without-verification',
        turnCount: i,
      })
      expect(s.saturationCount).toBe(i)
    }
  })

  it('verification resets the counter', () => {
    const tripped = { ...base, saturationCount: 5 }
    const next = applySaturationObservation({
      state: tripped,
      kind: 'verification',
      turnCount: 9,
    })
    expect(next.saturationCount).toBe(0)
    expect(next.saturationProofTurn).toBeNull()
  })

  it('external-knowledge resets count AND records the proof turn', () => {
    const tripped = { ...base, saturationCount: 5 }
    const next = applySaturationObservation({
      state: tripped,
      kind: 'external-knowledge',
      turnCount: 9,
    })
    expect(next.saturationCount).toBe(0)
    expect(next.saturationProofTurn).toBe(9)
  })

  it('inert does not change state (idempotency for read-only turns)', () => {
    const tripped = { ...base, saturationCount: 2 }
    const next = applySaturationObservation({
      state: tripped,
      kind: 'inert',
      turnCount: 9,
    })
    expect(next).toBe(tripped)
  })
})

describe('applyPhaseTransitionReset', () => {
  it('clears the saturation counter (OpenHands #6795 lesson)', () => {
    const tripped = {
      ...createInitialLoopDisciplineState(2),
      saturationCount: 5,
      saturationProofTurn: 7,
    }
    const next = applyPhaseTransitionReset(tripped)
    expect(next.saturationCount).toBe(0)
    expect(next.saturationProofTurn).toBeNull()
  })

  it('does not change other fields', () => {
    const tripped = {
      ...createInitialLoopDisciplineState(2),
      phase: 'plan' as const,
      saturationCount: 5,
    }
    const next = applyPhaseTransitionReset(tripped)
    expect(next.phase).toBe('plan')
    expect(next.level).toBe(tripped.level)
  })
})

describe('VERIFICATION_BASH_PATTERN', () => {
  it('matches common test runners', () => {
    for (const cmd of [
      'bun test',
      'npm test',
      'npm run test',
      'pnpm test',
      'yarn test',
      'jest',
      'vitest',
      'pytest',
      'cargo test',
      'go test ./...',
    ]) {
      expect(VERIFICATION_BASH_PATTERN.test(cmd)).toBe(true)
    }
  })

  it('does not match generic bash commands', () => {
    for (const cmd of ['ls', 'cat README.md', 'git status', 'pwd']) {
      expect(VERIFICATION_BASH_PATTERN.test(cmd)).toBe(false)
    }
  })
})

describe('SATURATION_PROOF_TOOL_NAMES', () => {
  it('covers the two web-fetch tools and only those', () => {
    expect(SATURATION_PROOF_TOOL_NAMES.has('WebSearch')).toBe(true)
    expect(SATURATION_PROOF_TOOL_NAMES.has('WebFetch')).toBe(true)
    expect(SATURATION_PROOF_TOOL_NAMES.size).toBe(2)
    expect(SATURATION_PROOF_TOOL_NAMES.has('Read')).toBe(false)
  })
})

// ─────────────────────────────────────────────────────────────────────
// Phase E — plan-then-edit native phases
// ─────────────────────────────────────────────────────────────────────

import {
  applyEmitPlan,
  applyPhaseTransition,
  buildPlanHandoffMessage,
  evaluatePhaseTransition,
} from './loopDiscipline.js'

describe('applyEmitPlan', () => {
  it('records the plan on disciplineState with turn + timestamp', () => {
    const base = createInitialLoopDisciplineState(2, 'plan')
    const next = applyEmitPlan({
      state: base,
      plan: {
        intent: 'Refactor parser to support unicode',
        files_to_edit: ['src/parser.ts', 'src/lexer.ts'],
        smallest_test: 'bun test src/parser.test.ts',
      },
      turnCount: 7,
      now: 1700000000,
    })
    expect(next.pendingPlan).not.toBeNull()
    if (next.pendingPlan) {
      expect(next.pendingPlan.intent).toBe('Refactor parser to support unicode')
      expect(next.pendingPlan.files_to_edit).toEqual([
        'src/parser.ts',
        'src/lexer.ts',
      ])
      expect(next.pendingPlan.emittedAtTurn).toBe(7)
      expect(next.pendingPlan.emittedAtTimestamp).toBe(1700000000)
    }
  })

  it('trims oversized intent / files / test inputs', () => {
    const base = createInitialLoopDisciplineState(2)
    const huge = 'x'.repeat(10_000)
    const lots = Array.from({ length: 200 }, (_, i) => `f${i}.ts`)
    const next = applyEmitPlan({
      state: base,
      plan: {
        intent: huge,
        files_to_edit: lots,
        smallest_test: huge,
      },
      turnCount: 1,
      now: 0,
    })
    expect(next.pendingPlan?.intent.length).toBe(4_000)
    expect(next.pendingPlan?.files_to_edit.length).toBe(50)
    expect(next.pendingPlan?.smallest_test.length).toBe(2_000)
  })
})

describe('evaluatePhaseTransition — plan → build gate', () => {
  it('allows plan → build when pendingPlan is fresh', () => {
    const s = applyEmitPlan({
      state: createInitialLoopDisciplineState(2, 'plan'),
      plan: {
        intent: 'do thing',
        files_to_edit: ['a.ts'],
        smallest_test: 'bun test',
      },
      turnCount: 3,
      now: 0,
    })
    const out = evaluatePhaseTransition(s, 'build')
    expect(out.allowed).toBe(true)
  })

  it('blocks plan → build when no plan was emitted', () => {
    const s = createInitialLoopDisciplineState(2, 'plan')
    const out = evaluatePhaseTransition(s, 'build')
    expect(out.allowed).toBe(false)
    if (!out.allowed) {
      expect(out.reason).toContain('EmitPlan')
    }
  })

  it('blocks plan → build when the plan is stale (emitted before phase entry)', () => {
    // Plan emitted at turn 2, then re-entered plan phase at turn 7 — plan is stale.
    const planned = applyEmitPlan({
      state: createInitialLoopDisciplineState(2, 'plan'),
      plan: {
        intent: 'old',
        files_to_edit: ['a.ts'],
        smallest_test: 't',
      },
      turnCount: 2,
      now: 0,
    })
    const reentered = { ...planned, phaseEnteredAt: 7 }
    const out = evaluatePhaseTransition(reentered, 'build')
    expect(out.allowed).toBe(false)
    if (!out.allowed) {
      expect(out.reason).toContain('fresh plan')
    }
  })

  it('allows any → plan freely (model can always re-plan)', () => {
    const s = createInitialLoopDisciplineState(2, 'build')
    expect(evaluatePhaseTransition(s, 'plan').allowed).toBe(true)
  })

  it('allows any → verify freely', () => {
    const s = createInitialLoopDisciplineState(2, 'build')
    expect(evaluatePhaseTransition(s, 'verify').allowed).toBe(true)
  })

  it('is permissive at level 0 (legacy preservation)', () => {
    const s = createInitialLoopDisciplineState(0, 'plan')
    expect(evaluatePhaseTransition(s, 'build').allowed).toBe(true)
  })

  it('is a no-op for self-transitions', () => {
    const s = createInitialLoopDisciplineState(2, 'build')
    expect(evaluatePhaseTransition(s, 'build').allowed).toBe(true)
  })
})

describe('applyPhaseTransition', () => {
  it('records the transition in history', () => {
    const before = createInitialLoopDisciplineState(2, 'build')
    const after = applyPhaseTransition({
      state: before,
      to: 'plan',
      reason: 'forced by saturation',
      turnCount: 9,
      now: 1700000000,
    })
    expect(after.phase).toBe('plan')
    expect(after.phaseHistory).toHaveLength(1)
    expect(after.phaseHistory[0]).toEqual({
      from: 'build',
      to: 'plan',
      reason: 'forced by saturation',
      turnCount: 9,
      timestamp: 1700000000,
    })
    expect(after.phaseEnteredAt).toBe(9)
  })

  it('resets saturation counters on transition (idempotency)', () => {
    const tripped = {
      ...createInitialLoopDisciplineState(2, 'build'),
      saturationCount: 7,
      saturationProofTurn: 5,
    }
    const after = applyPhaseTransition({
      state: tripped,
      to: 'plan',
      reason: 'redirect',
      turnCount: 9,
      now: 0,
    })
    expect(after.saturationCount).toBe(0)
    expect(after.saturationProofTurn).toBeNull()
  })

  it('appends transitions chronologically', () => {
    let s = createInitialLoopDisciplineState(2, 'build')
    s = applyPhaseTransition({
      state: s,
      to: 'plan',
      reason: 'r1',
      turnCount: 1,
      now: 1,
    })
    s = applyPhaseTransition({
      state: s,
      to: 'build',
      reason: 'r2',
      turnCount: 2,
      now: 2,
    })
    expect(s.phaseHistory.map(t => t.to)).toEqual(['plan', 'build'])
  })
})

describe('buildPlanHandoffMessage', () => {
  it('returns null when no plan exists', () => {
    const s = createInitialLoopDisciplineState(2)
    expect(buildPlanHandoffMessage(s)).toBeNull()
  })

  it('reproduces the plan VERBATIM (Aider #2258 mitigation)', () => {
    const s = applyEmitPlan({
      state: createInitialLoopDisciplineState(2, 'plan'),
      plan: {
        intent: 'EXACT INTENT STRING',
        files_to_edit: ['src/a.ts', 'src/b.ts'],
        smallest_test: 'pytest tests/test_foo.py::test_bar',
      },
      turnCount: 3,
      now: 0,
    })
    const msg = buildPlanHandoffMessage(s)
    expect(msg).not.toBeNull()
    if (msg) {
      expect(msg).toContain('EXACT INTENT STRING')
      expect(msg).toContain('src/a.ts')
      expect(msg).toContain('src/b.ts')
      expect(msg).toContain('pytest tests/test_foo.py::test_bar')
      expect(msg).toContain('plan-handoff')
    }
  })

  it('does not summarize or otherwise transform the plan content', () => {
    const intent = 'A very specific instruction with details that matter for correctness — including exact column names and table prefixes.'
    const s = applyEmitPlan({
      state: createInitialLoopDisciplineState(2, 'plan'),
      plan: {
        intent,
        files_to_edit: ['x.ts'],
        smallest_test: 'bun test',
      },
      turnCount: 1,
      now: 0,
    })
    const msg = buildPlanHandoffMessage(s)
    expect(msg).toContain(intent)
  })
})

// ─────────────────────────────────────────────────────────────────────
// Phase E5 — pre-API plan handoff (the conditions that fire injection)
// ─────────────────────────────────────────────────────────────────────

/**
 * Mirrors the predicate used in query.ts at the system-prompt build site.
 * Kept in the test suite so the firing conditions are pinned and any
 * later refactor that breaks the contract surfaces immediately.
 */
function shouldInjectPlanHandoff(state: LoopDisciplineState): boolean {
  return (
    state.level >= 1 &&
    state.phase === 'build' &&
    state.pendingPlan !== null &&
    state.pendingPlan.emittedAtTurn < state.phaseEnteredAt
  )
}

describe('Phase E5 — shouldInjectPlanHandoff predicate', () => {
  it('returns false at level 0 (legacy preservation)', () => {
    let s = createInitialLoopDisciplineState(0, 'build')
    s = applyEmitPlan({
      state: { ...s, phaseEnteredAt: 5 },
      plan: { intent: 'x', files_to_edit: ['a'], smallest_test: 't' },
      turnCount: 3,
      now: 0,
    })
    expect(shouldInjectPlanHandoff(s)).toBe(false)
  })

  it('returns false in phases other than build', () => {
    for (const phase of ['explore', 'plan', 'verify', 'refine'] as const) {
      let s = createInitialLoopDisciplineState(2, phase)
      s = applyEmitPlan({
        state: { ...s, phaseEnteredAt: 5 },
        plan: { intent: 'x', files_to_edit: ['a'], smallest_test: 't' },
        turnCount: 3,
        now: 0,
      })
      expect(shouldInjectPlanHandoff(s)).toBe(false)
    }
  })

  it('returns false when no pendingPlan exists', () => {
    const s = createInitialLoopDisciplineState(2, 'build')
    expect(shouldInjectPlanHandoff(s)).toBe(false)
  })

  it('returns false when the plan was emitted in the current phase (would be stale plan from a re-entry)', () => {
    // Plan emitted while phase is build means the model emitted a plan
    // mid-edit. The plan is for a future re-plan, not the current phase
    // execution. Don't inject.
    let s = createInitialLoopDisciplineState(2, 'build')
    s = applyEmitPlan({
      state: s,
      plan: { intent: 'x', files_to_edit: ['a'], smallest_test: 't' },
      turnCount: s.phaseEnteredAt + 1,
      now: 0,
    })
    // pendingPlan.emittedAtTurn (phaseEnteredAt + 1) > phaseEnteredAt → no inject
    expect(shouldInjectPlanHandoff(s)).toBe(false)
  })

  it('returns true when build phase has a plan from a preceding phase', () => {
    // Realistic sequence: model is in plan at turn 1, emits plan at turn 2,
    // transitions to build at turn 3 (phaseEnteredAt = 3, plan.emittedAtTurn = 2).
    let s = createInitialLoopDisciplineState(2, 'plan')
    s = applyEmitPlan({
      state: s,
      plan: {
        intent: 'Refactor auth',
        files_to_edit: ['src/auth.ts'],
        smallest_test: 'bun test',
      },
      turnCount: 2,
      now: 0,
    })
    s = applyPhaseTransition({
      state: s,
      to: 'build',
      reason: 'plan emitted, ready to edit',
      turnCount: 3,
      now: 0,
    })
    expect(shouldInjectPlanHandoff(s)).toBe(true)
  })

  it('keeps returning true on subsequent build turns while plan is in scope', () => {
    // Same as above but verify the predicate stays true for multiple
    // build turns — model sees the plan throughout build, not just on
    // turn 1.
    let s = createInitialLoopDisciplineState(2, 'plan')
    s = applyEmitPlan({
      state: s,
      plan: { intent: 'x', files_to_edit: ['a'], smallest_test: 't' },
      turnCount: 2,
      now: 0,
    })
    s = applyPhaseTransition({
      state: s,
      to: 'build',
      reason: 'go',
      turnCount: 3,
      now: 0,
    })
    expect(shouldInjectPlanHandoff(s)).toBe(true)
    expect(shouldInjectPlanHandoff(s)).toBe(true)
    expect(shouldInjectPlanHandoff(s)).toBe(true)
  })

  it('returns false after a re-transition to plan (plan is no longer scope-fresh)', () => {
    // Sequence: plan → build (plan injected) → plan again. The original
    // pendingPlan is now stale relative to the new plan phase.
    let s = createInitialLoopDisciplineState(2, 'plan')
    s = applyEmitPlan({
      state: s,
      plan: { intent: 'x', files_to_edit: ['a'], smallest_test: 't' },
      turnCount: 2,
      now: 0,
    })
    s = applyPhaseTransition({
      state: s,
      to: 'build',
      reason: 'go',
      turnCount: 3,
      now: 0,
    })
    expect(shouldInjectPlanHandoff(s)).toBe(true)
    // Back to plan — applyPhaseTransitionReset zeros the trip counter
    // but pendingPlan persists. Now we're in plan phase, not build, so
    // injection condition is false.
    s = applyPhaseTransition({
      state: s,
      to: 'plan',
      reason: 'reconsidering',
      turnCount: 5,
      now: 0,
    })
    expect(shouldInjectPlanHandoff(s)).toBe(false)
  })

  it('integration: buildPlanHandoffMessage returns the injection content', () => {
    let s = createInitialLoopDisciplineState(2, 'plan')
    s = applyEmitPlan({
      state: s,
      plan: {
        intent: 'INTENT MARKER',
        files_to_edit: ['FILE_MARKER.ts'],
        smallest_test: 'TEST_MARKER',
      },
      turnCount: 2,
      now: 0,
    })
    s = applyPhaseTransition({
      state: s,
      to: 'build',
      reason: 'go',
      turnCount: 3,
      now: 0,
    })
    expect(shouldInjectPlanHandoff(s)).toBe(true)
    const handoff = buildPlanHandoffMessage(s)
    expect(handoff).not.toBeNull()
    if (handoff) {
      expect(handoff).toContain('INTENT MARKER')
      expect(handoff).toContain('FILE_MARKER.ts')
      expect(handoff).toContain('TEST_MARKER')
      expect(handoff).toContain('plan-handoff')
    }
  })
})

// ─────────────────────────────────────────────────────────────────────
// Phase F — verification ledger with typed-source provenance
// ─────────────────────────────────────────────────────────────────────

import {
  applyVerificationEntry,
  countLedgerEntriesBySource,
  evaluateCompletionExit,
  hadMutationsThisLoop,
} from './loopDiscipline.js'

describe('applyVerificationEntry', () => {
  it('appends an entry with turn + timestamp', () => {
    const base = createInitialLoopDisciplineState(2)
    const next = applyVerificationEntry({
      state: base,
      entry: {
        claim: 'tests pass',
        source: 'tool',
        toolName: 'Bash',
        evidence: 'bun test → exit 0',
      },
      turnCount: 5,
      now: 1700000000,
    })
    expect(next.verificationLedger).toHaveLength(1)
    expect(next.verificationLedger[0]).toEqual({
      claim: 'tests pass',
      source: 'tool',
      toolName: 'Bash',
      evidence: 'bun test → exit 0',
      turnCount: 5,
      timestamp: 1700000000,
    })
  })

  it('caps the ledger at 200 entries (drops oldest)', () => {
    let s = createInitialLoopDisciplineState(2)
    for (let i = 1; i <= 220; i++) {
      s = applyVerificationEntry({
        state: s,
        entry: { claim: `c${i}`, source: 'agent' },
        turnCount: i,
        now: i,
      })
    }
    expect(s.verificationLedger).toHaveLength(200)
    expect(s.verificationLedger[0].claim).toBe('c21')
    expect(s.verificationLedger[199].claim).toBe('c220')
  })
})

describe('countLedgerEntriesBySource', () => {
  it('returns zeros on empty ledger', () => {
    const c = countLedgerEntriesBySource(createInitialLoopDisciplineState(2))
    expect(c).toEqual({ agent: 0, tool: 0, hook: 0, human: 0 })
  })

  it('classifies mixed entries', () => {
    let s = createInitialLoopDisciplineState(2)
    s = applyVerificationEntry({
      state: s,
      entry: { claim: 'a', source: 'agent' },
      turnCount: 1,
      now: 0,
    })
    s = applyVerificationEntry({
      state: s,
      entry: { claim: 'b', source: 'tool' },
      turnCount: 2,
      now: 0,
    })
    s = applyVerificationEntry({
      state: s,
      entry: { claim: 'c', source: 'tool' },
      turnCount: 3,
      now: 0,
    })
    s = applyVerificationEntry({
      state: s,
      entry: { claim: 'd', source: 'human' },
      turnCount: 4,
      now: 0,
    })
    expect(countLedgerEntriesBySource(s)).toEqual({
      agent: 1,
      tool: 2,
      hook: 0,
      human: 1,
    })
  })
})

describe('evaluateCompletionExit', () => {
  it('is permissive at level 0 (legacy preservation)', () => {
    const s = createInitialLoopDisciplineState(0)
    const out = evaluateCompletionExit(s, true)
    expect(out.allowed).toBe(true)
    if (out.allowed) expect(out.reason).toBe('completed_legacy')
  })

  it('allows exit when no mutations happened (pure Q&A)', () => {
    const s = createInitialLoopDisciplineState(2)
    const out = evaluateCompletionExit(s, false)
    expect(out.allowed).toBe(true)
    if (out.allowed) expect(out.reason).toBe('completed_no_artifacts')
  })

  it('blocks exit at level 2 when mutations happened but no non-agent entries', () => {
    let s = createInitialLoopDisciplineState(2)
    // Agent claimed verification — does NOT count.
    s = applyVerificationEntry({
      state: s,
      entry: { claim: 'I verified it', source: 'agent' },
      turnCount: 1,
      now: 0,
    })
    const out = evaluateCompletionExit(s, true)
    expect(out.allowed).toBe(false)
    if (!out.allowed) {
      expect(out.reason).toBe('requires_verification')
      expect(out.nudge).toContain('COMPLETION EXIT BLOCKED')
      expect(out.nudge).toContain('EmitVerification')
    }
  })

  it('allows exit at level 2 when ledger has a tool entry', () => {
    let s = createInitialLoopDisciplineState(2)
    s = applyVerificationEntry({
      state: s,
      entry: { claim: 'tests pass', source: 'tool', toolName: 'Bash' },
      turnCount: 1,
      now: 0,
    })
    const out = evaluateCompletionExit(s, true)
    expect(out.allowed).toBe(true)
    if (out.allowed) expect(out.reason).toBe('completed_with_verification')
  })

  it('allows exit at level 2 when human marked it verified', () => {
    let s = createInitialLoopDisciplineState(2)
    s = applyVerificationEntry({
      state: s,
      entry: { claim: 'this is verification-free', source: 'human' },
      turnCount: 1,
      now: 0,
    })
    const out = evaluateCompletionExit(s, true)
    expect(out.allowed).toBe(true)
  })

  it('is advisory at level 1 (always allows but tags)', () => {
    const s = createInitialLoopDisciplineState(1)
    const out = evaluateCompletionExit(s, true)
    expect(out.allowed).toBe(true)
  })
})

describe('hadMutationsThisLoop', () => {
  it('false on a fresh state', () => {
    expect(hadMutationsThisLoop(createInitialLoopDisciplineState(2))).toBe(
      false,
    )
  })

  it('true when ledger has entries', () => {
    const s = applyVerificationEntry({
      state: createInitialLoopDisciplineState(2),
      entry: { claim: 'x', source: 'agent' },
      turnCount: 1,
      now: 0,
    })
    expect(hadMutationsThisLoop(s)).toBe(true)
  })

  it('true when saturation has incremented', () => {
    const s = applySaturationObservation({
      state: createInitialLoopDisciplineState(2),
      kind: 'mutating-without-verification',
      turnCount: 1,
    })
    expect(hadMutationsThisLoop(s)).toBe(true)
  })

  it('true when phase history visited build', () => {
    const s = applyPhaseTransition({
      state: createInitialLoopDisciplineState(2, 'explore'),
      to: 'build',
      reason: 'go',
      turnCount: 1,
      now: 0,
    })
    expect(hadMutationsThisLoop(s)).toBe(true)
  })
})

describe('Phase F integration: applySaturationObservation auto-records ledger on verification', () => {
  it('writes a source=\'tool\' ledger entry when verification fires', () => {
    const base = createInitialLoopDisciplineState(2)
    const next = applySaturationObservation({
      state: base,
      kind: 'verification',
      turnCount: 5,
      verificationEvidence: 'bun test → 78 pass / 0 fail',
      now: 1700000000,
    })
    expect(next.verificationLedger).toHaveLength(1)
    expect(next.verificationLedger[0].source).toBe('tool')
    expect(next.verificationLedger[0].toolName).toBe('Bash')
    expect(next.verificationLedger[0].evidence).toContain('78 pass')
  })

  it('verification entry satisfies the completion gate', () => {
    let s = createInitialLoopDisciplineState(2)
    // Mutation happens.
    s = applySaturationObservation({
      state: s,
      kind: 'mutating-without-verification',
      turnCount: 1,
    })
    // Pre-verification: gate refuses.
    expect(evaluateCompletionExit(s, true).allowed).toBe(false)
    // Run tests.
    s = applySaturationObservation({
      state: s,
      kind: 'verification',
      turnCount: 2,
      verificationEvidence: 'bun test → 0 fail',
      now: 0,
    })
    // Post-verification: gate allows.
    expect(evaluateCompletionExit(s, true).allowed).toBe(true)
  })
})

// ─────────────────────────────────────────────────────────────────────
// Phase G — observability (DisciplineEvent emission + stderr)
// ─────────────────────────────────────────────────────────────────────

import {
  emitDisciplineEventToStderr,
  formatDisciplineEvent,
  isDisciplineDebugEnabled,
  recordDisciplineEvent,
} from './loopDiscipline.js'

describe('recordDisciplineEvent', () => {
  it('appends an event to the stream', () => {
    const base = createInitialLoopDisciplineState(2)
    const next = recordDisciplineEvent(base, {
      kind: 'phase-transition',
      turnCount: 1,
      from: 'build',
      to: 'plan',
      reason: 'test',
      timestamp: 0,
    })
    expect(next.events).toHaveLength(1)
    expect(next.events[0].kind).toBe('phase-transition')
  })

  it('caps the stream at 1000 events (drops oldest)', () => {
    let s = createInitialLoopDisciplineState(2)
    for (let i = 1; i <= 1100; i++) {
      s = recordDisciplineEvent(s, {
        kind: 'saturation-reset',
        turnCount: i,
        phase: 'build',
        trigger: 'verification',
        timestamp: i,
      })
    }
    expect(s.events).toHaveLength(1000)
    expect((s.events[0] as { turnCount: number }).turnCount).toBe(101)
    expect((s.events[999] as { turnCount: number }).turnCount).toBe(1100)
  })
})

describe('formatDisciplineEvent', () => {
  it('formats phase-transition with from→to', () => {
    expect(
      formatDisciplineEvent({
        kind: 'phase-transition',
        turnCount: 7,
        from: 'plan',
        to: 'build',
        reason: 'EmitPhaseTransition',
        timestamp: 0,
      }),
    ).toBe('discipline: t7 phase-transition plan→build (EmitPhaseTransition)')
  })

  it('formats gate-blocked with tool + gate + reason', () => {
    const line = formatDisciplineEvent({
      kind: 'gate-blocked',
      turnCount: 3,
      phase: 'explore',
      gate: 'phase-restriction',
      toolName: 'Edit',
      reason: "Tool 'Edit' is not available in phase 'explore'.",
      timestamp: 0,
    })
    expect(line).toContain('t3')
    expect(line).toContain('explore')
    expect(line).toContain('phase-restriction')
    expect(line).toContain('Edit')
  })

  it('formats saturation-trip with consecutive count', () => {
    expect(
      formatDisciplineEvent({
        kind: 'saturation-trip',
        turnCount: 9,
        phase: 'build',
        consecutiveNoProgress: 3,
        timestamp: 0,
      }),
    ).toContain('count=3')
  })

  it('formats verification-write with source + tool + truncated claim', () => {
    const line = formatDisciplineEvent({
      kind: 'verification-write',
      turnCount: 5,
      phase: 'build',
      entry: {
        claim: 'x'.repeat(200),
        source: 'tool',
        toolName: 'Bash',
        evidence: 'bun test → 0 fail',
        turnCount: 5,
        timestamp: 0,
      },
      timestamp: 0,
    })
    expect(line).toContain('source=tool')
    expect(line).toContain('tool=Bash')
    // Claim should be truncated to ≤ 80 chars after the claim=" prefix.
    const claimSegment = line.split('claim="')[1] ?? ''
    expect(claimSegment.length).toBeLessThan(85)
  })

  it('formats tamper-block with path', () => {
    expect(
      formatDisciplineEvent({
        kind: 'tamper-block',
        turnCount: 4,
        phase: 'build',
        targetPath: '/x/openclaude/src/query.ts',
        reason: 'enforcement code',
        timestamp: 0,
      }),
    ).toContain('path=/x/openclaude/src/query.ts')
  })
})

describe('isDisciplineDebugEnabled', () => {
  it('returns false when env is unset', () => {
    expect(isDisciplineDebugEnabled({})).toBe(false)
  })

  it('returns true when OPENCLAUDE_DEBUG_DISCIPLINE=1', () => {
    expect(
      isDisciplineDebugEnabled({ OPENCLAUDE_DEBUG_DISCIPLINE: '1' }),
    ).toBe(true)
  })

  it('returns false for any other value (only "1" enables)', () => {
    expect(
      isDisciplineDebugEnabled({ OPENCLAUDE_DEBUG_DISCIPLINE: 'true' }),
    ).toBe(false)
    expect(
      isDisciplineDebugEnabled({ OPENCLAUDE_DEBUG_DISCIPLINE: 'yes' }),
    ).toBe(false)
  })
})

describe('emitDisciplineEventToStderr', () => {
  it('writes a single newline-terminated line', () => {
    const writes: string[] = []
    emitDisciplineEventToStderr(
      {
        kind: 'saturation-trip',
        turnCount: 1,
        phase: 'build',
        consecutiveNoProgress: 3,
        timestamp: 0,
      },
      { write: (s: string) => writes.push(s) },
    )
    expect(writes).toHaveLength(1)
    expect(writes[0].endsWith('\n')).toBe(true)
    expect(writes[0]).toContain('saturation-trip')
  })
})

// ─────────────────────────────────────────────────────────────────────
// Phase E4 — forced-plan-phase escalation
// ─────────────────────────────────────────────────────────────────────

import {
  evaluateForcedPlan,
  FORCED_PLAN_TRIPS_THRESHOLD,
  SATURATION_THRESHOLD as SAT,
} from './loopDiscipline.js'

describe('Phase E4 — saturationTripsThisTask counter', () => {
  it('starts at 0 on fresh state', () => {
    expect(createInitialLoopDisciplineState(2).saturationTripsThisTask).toBe(0)
  })

  it('increments only on threshold crossing (not every mutation)', () => {
    let s = createInitialLoopDisciplineState(2)
    for (let i = 0; i < SAT - 1; i++) {
      s = applySaturationObservation({
        state: s,
        kind: 'mutating-without-verification',
        turnCount: i + 1,
      })
    }
    expect(s.saturationTripsThisTask).toBe(0)
    // Crossing the threshold.
    s = applySaturationObservation({
      state: s,
      kind: 'mutating-without-verification',
      turnCount: SAT,
    })
    expect(s.saturationTripsThisTask).toBe(1)
    // Above threshold — no double-count from a single armed window.
    s = applySaturationObservation({
      state: s,
      kind: 'mutating-without-verification',
      turnCount: SAT + 1,
    })
    expect(s.saturationTripsThisTask).toBe(1)
  })

  it('counts each fresh trip after a reset', () => {
    let s = createInitialLoopDisciplineState(2)
    // First arming.
    for (let i = 0; i < SAT; i++) {
      s = applySaturationObservation({
        state: s,
        kind: 'mutating-without-verification',
        turnCount: i + 1,
      })
    }
    expect(s.saturationTripsThisTask).toBe(1)
    // WebSearch resets count (Phase D), trips counter persists.
    s = applySaturationObservation({
      state: s,
      kind: 'external-knowledge',
      turnCount: SAT + 1,
    })
    expect(s.saturationTripsThisTask).toBe(1)
    expect(s.saturationCount).toBe(0)
    // Second arming.
    for (let i = 0; i < SAT; i++) {
      s = applySaturationObservation({
        state: s,
        kind: 'mutating-without-verification',
        turnCount: SAT + 2 + i,
      })
    }
    expect(s.saturationTripsThisTask).toBe(2)
  })

  it('resets to 0 on phase transition (applyPhaseTransitionReset path)', () => {
    let s = {
      ...createInitialLoopDisciplineState(2, 'build'),
      saturationTripsThisTask: 2,
    }
    s = applyPhaseTransition({
      state: s,
      to: 'plan',
      reason: 'redirect',
      turnCount: 5,
      now: 0,
    })
    expect(s.saturationTripsThisTask).toBe(0)
  })
})

describe('evaluateForcedPlan', () => {
  it('does not force at level 0 or 1 (legacy + advisory)', () => {
    for (const level of [0, 1] as const) {
      const s = {
        ...createInitialLoopDisciplineState(level, 'build'),
        saturationTripsThisTask: 5,
      }
      expect(evaluateForcedPlan(s).force).toBe(false)
    }
  })

  it('does not force when trips count is below threshold', () => {
    const s = {
      ...createInitialLoopDisciplineState(2, 'build'),
      saturationTripsThisTask: FORCED_PLAN_TRIPS_THRESHOLD - 1,
    }
    expect(evaluateForcedPlan(s).force).toBe(false)
  })

  it('forces phase=plan when trips count >= threshold', () => {
    const s = {
      ...createInitialLoopDisciplineState(2, 'build'),
      saturationTripsThisTask: FORCED_PLAN_TRIPS_THRESHOLD,
    }
    const out = evaluateForcedPlan(s)
    expect(out.force).toBe(true)
    if (out.force) expect(out.reason).toContain('saturation trips')
  })

  it('does not re-force when already in plan phase', () => {
    const s = {
      ...createInitialLoopDisciplineState(2, 'plan'),
      saturationTripsThisTask: 5,
    }
    expect(evaluateForcedPlan(s).force).toBe(false)
  })

  it('does not force when a fresh pendingPlan is being executed', () => {
    // Model emitted a plan, transitioned to build, and is now mid-execution.
    // Saturation may have armed but we should let the plan finish before
    // re-forcing — the completion gate or another saturation cycle will
    // handle persistent failure.
    let s = createInitialLoopDisciplineState(2, 'build')
    s = applyEmitPlan({
      state: s,
      plan: {
        intent: 'x',
        files_to_edit: ['a'],
        smallest_test: 't',
      },
      turnCount: s.phaseEnteredAt + 1,
      now: 0,
    })
    // Mark trips count high.
    s = { ...s, saturationTripsThisTask: 5 }
    expect(evaluateForcedPlan(s).force).toBe(false)
  })

  it('DOES force when pendingPlan is stale (emitted before current phase)', () => {
    let s = createInitialLoopDisciplineState(2, 'plan')
    s = applyEmitPlan({
      state: s,
      plan: { intent: 'x', files_to_edit: ['a'], smallest_test: 't' },
      turnCount: 2,
      now: 0,
    })
    // Transition into build (plan now consumed for execution).
    s = applyPhaseTransition({
      state: s,
      to: 'build',
      reason: 'go',
      turnCount: 3,
      now: 0,
    })
    // The transition reset saturationTripsThisTask. Simulate two more trips.
    s = { ...s, saturationTripsThisTask: 2 }
    // Now the pendingPlan was emitted at turn 2 but phaseEnteredAt=3 (build),
    // so pendingPlan.emittedAtTurn (2) < phaseEnteredAt (3) → stale, so the
    // forcer reactivates.
    expect(evaluateForcedPlan(s).force).toBe(true)
  })
})

describe('Phase G integration: apply* functions emit events', () => {
  it('applyPhaseTransition records a phase-transition event', () => {
    const before = createInitialLoopDisciplineState(2, 'build')
    const after = applyPhaseTransition({
      state: before,
      to: 'plan',
      reason: 'r',
      turnCount: 1,
      now: 0,
    })
    const transitions = after.events.filter(e => e.kind === 'phase-transition')
    expect(transitions).toHaveLength(1)
  })

  it('applyVerificationEntry records a verification-write event', () => {
    const before = createInitialLoopDisciplineState(2)
    const after = applyVerificationEntry({
      state: before,
      entry: { claim: 'x', source: 'tool' },
      turnCount: 1,
      now: 0,
    })
    const writes = after.events.filter(e => e.kind === 'verification-write')
    expect(writes).toHaveLength(1)
  })

  it('applySaturationObservation emits saturation-trip ONLY on threshold crossing', () => {
    let s = createInitialLoopDisciplineState(2)
    // First two mutations — no trip yet.
    s = applySaturationObservation({
      state: s,
      kind: 'mutating-without-verification',
      turnCount: 1,
    })
    s = applySaturationObservation({
      state: s,
      kind: 'mutating-without-verification',
      turnCount: 2,
    })
    expect(s.events.filter(e => e.kind === 'saturation-trip')).toHaveLength(0)

    // Third mutation crosses threshold.
    s = applySaturationObservation({
      state: s,
      kind: 'mutating-without-verification',
      turnCount: 3,
    })
    expect(s.events.filter(e => e.kind === 'saturation-trip')).toHaveLength(1)

    // Fourth mutation does NOT emit another trip (already armed).
    s = applySaturationObservation({
      state: s,
      kind: 'mutating-without-verification',
      turnCount: 4,
    })
    expect(s.events.filter(e => e.kind === 'saturation-trip')).toHaveLength(1)
  })

  it('applySaturationObservation emits saturation-reset on verification or external-knowledge', () => {
    let s = createInitialLoopDisciplineState(2)
    s = applySaturationObservation({
      state: s,
      kind: 'verification',
      turnCount: 1,
    })
    s = applySaturationObservation({
      state: s,
      kind: 'external-knowledge',
      turnCount: 2,
    })
    const resets = s.events.filter(e => e.kind === 'saturation-reset')
    expect(resets).toHaveLength(2)
  })
})
