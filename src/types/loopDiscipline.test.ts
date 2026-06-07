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
