import { describe, expect, it } from 'bun:test'
import {
  _phaseGateTestProbe,
  _tamperGuardTestProbe,
  evaluatePhaseGate,
  evaluateSaturationRedirect,
  evaluateSelfTamperGuard,
} from './loopDisciplineHooks.js'
import {
  createInitialLoopDisciplineState,
  readTamperGuardEnabled,
  SATURATION_THRESHOLD,
  type DisciplineLevel,
  type LoopDisciplineState,
} from '../../types/loopDiscipline.js'

function stateForSaturation(args: {
  level: DisciplineLevel
  saturationCount: number
  saturationProofTurn?: number | null
}): LoopDisciplineState {
  return {
    ...createInitialLoopDisciplineState(args.level),
    saturationCount: args.saturationCount,
    saturationProofTurn: args.saturationProofTurn ?? null,
  }
}

describe('evaluatePhaseGate — level 0 (observe-only)', () => {
  it('lets every tool through regardless of phase', () => {
    for (const phase of ['explore', 'research', 'plan', 'build', 'verify', 'refine'] as const) {
      const out = _phaseGateTestProbe({
        level: 0,
        phase,
        toolName: 'Edit',
        toolInput: { file_path: '/tmp/foo' },
      })
      expect(out.ok).toBe(true)
    }
  })

  it('lets through even an explicitly mutating Bash command', () => {
    const out = _phaseGateTestProbe({
      level: 0,
      phase: 'explore',
      toolName: 'Bash',
      toolInput: { command: 'git commit -m "anything"' },
    })
    expect(out.ok).toBe(true)
  })
})

describe('evaluatePhaseGate — level 1 (advisory)', () => {
  it('still lets disallowed tools through (no enforcement)', () => {
    const out = _phaseGateTestProbe({
      level: 1,
      phase: 'explore',
      toolName: 'Edit',
    })
    expect(out.ok).toBe(true)
  })
})

describe('evaluatePhaseGate — level 2 (enforced)', () => {
  it('blocks Edit in explore phase', () => {
    const out = _phaseGateTestProbe({
      level: 2,
      phase: 'explore',
      toolName: 'Edit',
      toolInput: { file_path: '/tmp/foo' },
    })
    expect(out.ok).toBe(false)
    if (!out.ok) {
      expect(out.gate).toBe('phase-restriction')
      expect(out.reason).toContain("'Edit'")
      expect(out.reason).toContain("phase 'explore'")
      expect(out.reason).toContain('EmitPhaseTransition')
    }
  })

  it('blocks Write in plan phase', () => {
    const out = _phaseGateTestProbe({
      level: 2,
      phase: 'plan',
      toolName: 'Write',
    })
    expect(out.ok).toBe(false)
  })

  it('allows Read in explore phase', () => {
    const out = _phaseGateTestProbe({
      level: 2,
      phase: 'explore',
      toolName: 'Read',
    })
    expect(out.ok).toBe(true)
  })

  it('allows all tools in build phase', () => {
    for (const tool of ['Edit', 'Write', 'MultiEdit', 'Bash', 'AnythingElse']) {
      const out = _phaseGateTestProbe({
        level: 2,
        phase: 'build',
        toolName: tool,
      })
      expect(out.ok).toBe(true)
    }
  })

  it('blocks destructive Bash in explore phase even though Bash is allowed', () => {
    const out = _phaseGateTestProbe({
      level: 2,
      phase: 'explore',
      toolName: 'Bash',
      toolInput: { command: 'git commit -m fix' },
    })
    expect(out.ok).toBe(false)
    if (!out.ok) {
      expect(out.gate).toBe('phase-restriction')
      expect(out.reason).toContain('git commit -m fix')
    }
  })

  it('allows read-only Bash in explore phase', () => {
    for (const cmd of ['git status', 'ls -la', 'pwd', 'cat README.md']) {
      const out = _phaseGateTestProbe({
        level: 2,
        phase: 'explore',
        toolName: 'Bash',
        toolInput: { command: cmd },
      })
      expect(out.ok).toBe(true)
    }
  })

  it('blocks Edit in verify phase', () => {
    const out = _phaseGateTestProbe({
      level: 2,
      phase: 'verify',
      toolName: 'Edit',
    })
    expect(out.ok).toBe(false)
  })

  it('allows Edit in refine phase', () => {
    const out = _phaseGateTestProbe({
      level: 2,
      phase: 'refine',
      toolName: 'Edit',
    })
    expect(out.ok).toBe(true)
  })

  it('blocks destructive Bash in refine phase via inherited deny patterns', () => {
    // refine has no bashDenyPatterns, so this should pass — confirming
    // patterns are per-phase, not global.
    const out = _phaseGateTestProbe({
      level: 2,
      phase: 'refine',
      toolName: 'Bash',
      toolInput: { command: 'git commit -m polish' },
    })
    expect(out.ok).toBe(true)
  })
})

describe('evaluatePhaseGate — undefined state', () => {
  it('lets every tool through when no discipline state is present (legacy callers)', () => {
    const out = evaluatePhaseGate(undefined, 'Edit', { file_path: '/tmp/x' })
    expect(out.ok).toBe(true)
  })
})

describe('evaluatePhaseGate — integration with the real state factory', () => {
  it('uses the level + phase that createInitialLoopDisciplineState produced', () => {
    const state = createInitialLoopDisciplineState(2, 'explore')
    const denied = evaluatePhaseGate(state, 'Edit', { file_path: '/tmp/x' })
    expect(denied.ok).toBe(false)

    const allowed = evaluatePhaseGate(state, 'Read', { file_path: '/tmp/x' })
    expect(allowed.ok).toBe(true)
  })
})

// ─────────────────────────────────────────────────────────────────────
// Phase C: self-tamper guard
// ─────────────────────────────────────────────────────────────────────

describe('readTamperGuardEnabled', () => {
  it('returns false at level 0 regardless of env (legacy preservation)', () => {
    expect(readTamperGuardEnabled(0, {})).toBe(false)
    expect(
      readTamperGuardEnabled(0, { LIMITLESS_TAMPER_GUARD: 'on' }),
    ).toBe(false)
  })

  it('returns true at level 1+ when env is unset', () => {
    expect(readTamperGuardEnabled(1, {})).toBe(true)
    expect(readTamperGuardEnabled(2, {})).toBe(true)
  })

  it('returns false when explicitly disabled at launch', () => {
    expect(
      readTamperGuardEnabled(2, { LIMITLESS_TAMPER_GUARD: 'off' }),
    ).toBe(false)
  })

  it('treats any other value as on (fail safe to enforcing)', () => {
    expect(
      readTamperGuardEnabled(2, { LIMITLESS_TAMPER_GUARD: 'yes' }),
    ).toBe(true)
    expect(
      readTamperGuardEnabled(2, { LIMITLESS_TAMPER_GUARD: '0' }),
    ).toBe(true)
  })
})

describe('evaluateSelfTamperGuard — disabled cases', () => {
  it('lets every Edit through at level 0', () => {
    const out = _tamperGuardTestProbe({
      level: 0,
      toolName: 'Edit',
      toolInput: { file_path: '/some/openclaude/src/query.ts' },
    })
    expect(out.ok).toBe(true)
  })

  it('lets every Edit through when enabled=false (env bypass)', () => {
    const out = _tamperGuardTestProbe({
      level: 2,
      enabled: false,
      toolName: 'Edit',
      toolInput: { file_path: '/some/openclaude/src/query.ts' },
    })
    expect(out.ok).toBe(true)
  })

  it('lets non-mutating tools through unconditionally', () => {
    for (const tool of ['Read', 'Grep', 'Glob', 'Bash', 'WebSearch']) {
      const out = _tamperGuardTestProbe({
        level: 2,
        toolName: tool,
        toolInput: { file_path: '/x/src/query.ts' },
      })
      expect(out.ok).toBe(true)
    }
  })
})

describe('evaluateSelfTamperGuard — protected paths', () => {
  it('blocks Edit on a query.ts path', () => {
    const out = _tamperGuardTestProbe({
      level: 2,
      toolName: 'Edit',
      toolInput: {
        file_path: '/Users/x/Projects/openclaude/src/query.ts',
      },
    })
    expect(out.ok).toBe(false)
    if (!out.ok) {
      expect(out.gate).toBe('self-tamper')
      expect(out.reason).toContain('src/query.ts')
      expect(out.reason).toContain('LIMITLESS_TAMPER_GUARD=off')
    }
  })

  it('blocks Write on toolHooks.ts (which contains the gate itself)', () => {
    const out = _tamperGuardTestProbe({
      level: 2,
      toolName: 'Write',
      toolInput: {
        file_path: '/foo/openclaude/src/services/tools/toolHooks.ts',
      },
    })
    expect(out.ok).toBe(false)
  })

  it('blocks MultiEdit on loopDiscipline.ts', () => {
    const out = _tamperGuardTestProbe({
      level: 2,
      toolName: 'MultiEdit',
      toolInput: { file_path: '/x/openclaude/src/types/loopDiscipline.ts' },
    })
    expect(out.ok).toBe(false)
  })

  it('blocks loopDisciplineHooks.ts itself (gate guards its own host file)', () => {
    const out = _tamperGuardTestProbe({
      level: 2,
      toolName: 'Edit',
      toolInput: {
        file_path: '/x/src/services/tools/loopDisciplineHooks.ts',
      },
    })
    expect(out.ok).toBe(false)
  })

  it('defeats ../ traversal via path.resolve canonicalization', () => {
    const out = _tamperGuardTestProbe({
      level: 2,
      toolName: 'Edit',
      toolInput: {
        file_path: '/x/openclaude/src/foo/../services/../query.ts',
      },
    })
    // Canonicalizes to /x/openclaude/src/query.ts → blocked
    expect(out.ok).toBe(false)
  })

  it('does not block similar-looking but distinct paths', () => {
    const out = _tamperGuardTestProbe({
      level: 2,
      toolName: 'Edit',
      toolInput: { file_path: '/x/extras/src/query.ts.bak' },
    })
    expect(out.ok).toBe(true)
  })

  it('does not block legit edits to user-code under src/', () => {
    const out = _tamperGuardTestProbe({
      level: 2,
      toolName: 'Edit',
      toolInput: {
        file_path: '/x/openclaude/src/components/Header.tsx',
      },
    })
    expect(out.ok).toBe(true)
  })
})

describe('evaluateSelfTamperGuard — level 1 advisory mode', () => {
  it('does not enforce — gate is consulted but never blocks', () => {
    const out = _tamperGuardTestProbe({
      level: 1,
      toolName: 'Edit',
      toolInput: { file_path: '/x/openclaude/src/query.ts' },
    })
    expect(out.ok).toBe(true)
  })
})

describe('evaluateSelfTamperGuard — input edge cases', () => {
  it('lets undefined-input tools through', () => {
    const out = evaluateSelfTamperGuard(
      createInitialLoopDisciplineState(2),
      'Edit',
      undefined,
      true,
    )
    expect(out.ok).toBe(true)
  })

  it('handles notebook_path key', () => {
    const out = _tamperGuardTestProbe({
      level: 2,
      toolName: 'NotebookEdit',
      toolInput: { notebook_path: '/x/openclaude/src/query.ts' },
    })
    expect(out.ok).toBe(false)
  })
})

// ─────────────────────────────────────────────────────────────────────
// Phase D — saturation redirect gate
// ─────────────────────────────────────────────────────────────────────

describe('evaluateSaturationRedirect — disabled cases', () => {
  it('lets everything through at level 0 even when over threshold', () => {
    const s = stateForSaturation({
      level: 0,
      saturationCount: SATURATION_THRESHOLD + 5,
    })
    expect(
      evaluateSaturationRedirect(s, 'Edit', { file_path: '/x' }).ok,
    ).toBe(true)
  })

  it('lets everything through when state is undefined (legacy callers)', () => {
    expect(
      evaluateSaturationRedirect(undefined, 'Edit', { file_path: '/x' }).ok,
    ).toBe(true)
  })

  it('does not block at level 1 even when tripped (advisory mode)', () => {
    const s = stateForSaturation({
      level: 1,
      saturationCount: SATURATION_THRESHOLD + 1,
    })
    expect(
      evaluateSaturationRedirect(s, 'Edit', { file_path: '/x' }).ok,
    ).toBe(true)
  })
})

describe('evaluateSaturationRedirect — below threshold', () => {
  it('lets mutating tools through when count < threshold', () => {
    const s = stateForSaturation({
      level: 2,
      saturationCount: SATURATION_THRESHOLD - 1,
    })
    expect(
      evaluateSaturationRedirect(s, 'Edit', { file_path: '/x' }).ok,
    ).toBe(true)
  })
})

// ─────────────────────────────────────────────────────────────────────
// Phase G2 — event emission contract (the gate evaluators themselves
// only return outcomes; toolHooks.ts records events on block. These
// tests verify that the event shapes are well-formed for the runtime
// to emit.)
// ─────────────────────────────────────────────────────────────────────

import { recordDisciplineEvent } from '../../types/loopDiscipline.js'

describe('Phase G2 — gate-blocked event shape', () => {
  it('builds a well-formed phase-restriction gate-blocked event', () => {
    const base = createInitialLoopDisciplineState(2, 'explore')
    const next = recordDisciplineEvent(base, {
      kind: 'gate-blocked',
      turnCount: 5,
      phase: 'explore',
      gate: 'phase-restriction',
      toolName: 'Edit',
      reason: 'denied',
      timestamp: 0,
    })
    expect(next.events).toHaveLength(1)
    const e = next.events[0]
    expect(e.kind).toBe('gate-blocked')
    if (e.kind === 'gate-blocked') {
      expect(e.gate).toBe('phase-restriction')
      expect(e.toolName).toBe('Edit')
    }
  })

  it('builds a well-formed saturation-redirect gate-blocked event', () => {
    const base = createInitialLoopDisciplineState(2)
    const next = recordDisciplineEvent(base, {
      kind: 'gate-blocked',
      turnCount: 7,
      phase: 'build',
      gate: 'saturation-redirect',
      toolName: 'Write',
      reason: 'SATURATION REDIRECT: ...',
      timestamp: 0,
    })
    const e = next.events[0]
    if (e.kind === 'gate-blocked') {
      expect(e.gate).toBe('saturation-redirect')
    }
  })

  it('builds a well-formed tamper-block event', () => {
    const base = createInitialLoopDisciplineState(2)
    const next = recordDisciplineEvent(base, {
      kind: 'tamper-block',
      turnCount: 3,
      phase: 'build',
      targetPath: '/x/openclaude/src/query.ts',
      reason: 'enforcement code',
      timestamp: 0,
    })
    const e = next.events[0]
    expect(e.kind).toBe('tamper-block')
    if (e.kind === 'tamper-block') {
      expect(e.targetPath).toBe('/x/openclaude/src/query.ts')
    }
  })
})

describe('evaluateSaturationRedirect — tripped', () => {
  it('blocks Edit at level 2 when count == threshold', () => {
    const s = stateForSaturation({
      level: 2,
      saturationCount: SATURATION_THRESHOLD,
    })
    const out = evaluateSaturationRedirect(s, 'Edit', { file_path: '/x' })
    expect(out.ok).toBe(false)
    if (!out.ok) {
      expect(out.gate).toBe('saturation-redirect')
      expect(out.reason).toContain('SATURATION REDIRECT')
      expect(out.reason).toContain('WebSearch or WebFetch')
    }
  })

  it('blocks Write at level 2 when over threshold', () => {
    const s = stateForSaturation({
      level: 2,
      saturationCount: SATURATION_THRESHOLD + 2,
    })
    expect(evaluateSaturationRedirect(s, 'Write', undefined).ok).toBe(false)
  })

  it('blocks mutating bash even when Bash is allowed at the phase level', () => {
    const s = stateForSaturation({
      level: 2,
      saturationCount: SATURATION_THRESHOLD,
    })
    const out = evaluateSaturationRedirect(s, 'Bash', {
      command: 'git commit -m fix',
    })
    expect(out.ok).toBe(false)
  })

  it('does NOT block read-only Bash when tripped', () => {
    const s = stateForSaturation({
      level: 2,
      saturationCount: SATURATION_THRESHOLD,
    })
    const out = evaluateSaturationRedirect(s, 'Bash', { command: 'ls -la' })
    expect(out.ok).toBe(true)
  })

  it('does NOT block Read/Grep/Glob when tripped (they gather information)', () => {
    const s = stateForSaturation({
      level: 2,
      saturationCount: SATURATION_THRESHOLD,
    })
    for (const tool of ['Read', 'Grep', 'Glob']) {
      expect(
        evaluateSaturationRedirect(s, tool, { file_path: '/x' }).ok,
      ).toBe(true)
    }
  })

  it('ALWAYS lets the proof tools through (WebSearch/WebFetch)', () => {
    const s = stateForSaturation({
      level: 2,
      saturationCount: SATURATION_THRESHOLD + 10,
    })
    expect(evaluateSaturationRedirect(s, 'WebSearch', undefined).ok).toBe(true)
    expect(evaluateSaturationRedirect(s, 'WebFetch', undefined).ok).toBe(true)
  })

  it('clears the block once proofTurn is set (post-WebSearch state)', () => {
    const s = stateForSaturation({
      level: 2,
      saturationCount: SATURATION_THRESHOLD,
      saturationProofTurn: 7,
    })
    const out = evaluateSaturationRedirect(s, 'Edit', { file_path: '/x' })
    expect(out.ok).toBe(true)
  })
})
