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
