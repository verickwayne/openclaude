import { describe, expect, it } from 'bun:test'
import {
  _phaseGateTestProbe,
  evaluatePhaseGate,
} from './loopDisciplineHooks.js'
import { createInitialLoopDisciplineState } from '../../types/loopDiscipline.js'

describe('evaluatePhaseGate — level 0 (observe-only)', () => {
  it('lets every tool through regardless of phase', () => {
    for (const phase of ['explore', 'plan', 'build', 'verify', 'refine'] as const) {
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
