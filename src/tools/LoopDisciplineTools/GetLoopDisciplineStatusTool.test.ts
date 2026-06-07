import { describe, expect, it } from 'bun:test'
import {
  applyEmitPlan,
  applyPhaseTransition,
  applySaturationObservation,
  applyVerificationEntry,
  createInitialLoopDisciplineState,
  type LoopDisciplineState,
} from '../../types/loopDiscipline.js'
import { GetLoopDisciplineStatusTool } from './GetLoopDisciplineStatusTool.js'
import { GET_LOOP_DISCIPLINE_STATUS_TOOL_NAME } from './constants.js'

function makeContext(initial: LoopDisciplineState | null) {
  const holder = { current: initial }
  return {
    getLoopDiscipline: () => holder.current ?? undefined,
  }
}

// biome-ignore lint/suspicious/noExplicitAny: bridge into runtime
const stubCanUse: any = async () => ({ behavior: 'allow' })
// biome-ignore lint/suspicious/noExplicitAny: bridge into runtime
const stubMsg: any = {}

describe('GetLoopDisciplineStatusTool — constants', () => {
  it('exposes the expected name', () => {
    expect(GetLoopDisciplineStatusTool.name).toBe(
      GET_LOOP_DISCIPLINE_STATUS_TOOL_NAME,
    )
    expect(GetLoopDisciplineStatusTool.name).toBe('GetLoopDisciplineStatus')
  })

  it('exposes isReadOnly as truthy (helps the scheduler batch this with other reads)', () => {
    // The runtime override accepts zero args; the property is shaped by
    // the tool definition. Probe without args to avoid the typed call site.
    // biome-ignore lint/suspicious/noExplicitAny: probe of typed method
    expect((GetLoopDisciplineStatusTool.isReadOnly as any)()).toBe(true)
  })
})

describe('GetLoopDisciplineStatusTool — unavailable cases', () => {
  it('reports unavailable when no discipline accessor exists', async () => {
    const out = await GetLoopDisciplineStatusTool.call(
      {},
      // biome-ignore lint/suspicious/noExplicitAny: minimal stub
      {} as any,
      stubCanUse,
      stubMsg,
      undefined,
    )
    expect(out.data.available).toBe(false)
    expect(out.data.note).toContain('OPENCLAUDE_IN_LOOP_DISCIPLINE')
  })

  it('reports unavailable when accessor returns undefined', async () => {
    const ctx = makeContext(null)
    const out = await GetLoopDisciplineStatusTool.call(
      {},
      // biome-ignore lint/suspicious/noExplicitAny: minimal stub
      ctx as any,
      stubCanUse,
      stubMsg,
      undefined,
    )
    expect(out.data.available).toBe(false)
  })
})

describe('GetLoopDisciplineStatusTool — fresh state', () => {
  it('returns level, phase, and zeroed counters', async () => {
    const ctx = makeContext(createInitialLoopDisciplineState(2, 'build'))
    const out = await GetLoopDisciplineStatusTool.call(
      {},
      // biome-ignore lint/suspicious/noExplicitAny: minimal stub
      ctx as any,
      stubCanUse,
      stubMsg,
      undefined,
    )
    expect(out.data.available).toBe(true)
    expect(out.data.level).toBe(2)
    expect(out.data.phase).toBe('build')
    expect(out.data.saturation_count).toBe(0)
    expect(out.data.saturation_trips_this_task).toBe(0)
    expect(out.data.saturation_proof_turn).toBeNull()
    expect(out.data.pending_plan).toBeNull()
    expect(out.data.recent_events).toEqual([])
    expect(out.data.ledger_counts).toEqual({
      agent: 0,
      tool: 0,
      hook: 0,
      human: 0,
    })
  })
})

describe('GetLoopDisciplineStatusTool — populated state', () => {
  it('surfaces phase, saturation, pending plan, and ledger counts', async () => {
    let s = createInitialLoopDisciplineState(2, 'plan')
    s = applyEmitPlan({
      state: s,
      plan: {
        intent: 'Refactor parser for unicode',
        files_to_edit: ['src/parser.ts', 'src/lexer.ts'],
        smallest_test: 'bun test src/parser.test.ts',
      },
      turnCount: 2,
      now: 1700000000,
    })
    s = applyPhaseTransition({
      state: s,
      to: 'build',
      reason: 'plan ready',
      turnCount: 3,
      now: 1700000001,
    })
    s = applySaturationObservation({
      state: s,
      kind: 'mutating-without-verification',
      turnCount: 4,
    })
    s = applyVerificationEntry({
      state: s,
      entry: { claim: 'tests pass', source: 'tool', toolName: 'Bash' },
      turnCount: 5,
      now: 0,
    })
    s = applyVerificationEntry({
      state: s,
      entry: { claim: 'I think it works', source: 'agent' },
      turnCount: 6,
      now: 0,
    })

    const ctx = makeContext(s)
    const out = await GetLoopDisciplineStatusTool.call(
      {},
      // biome-ignore lint/suspicious/noExplicitAny: minimal stub
      ctx as any,
      stubCanUse,
      stubMsg,
      undefined,
    )
    expect(out.data.available).toBe(true)
    expect(out.data.phase).toBe('build')
    expect(out.data.phase_entered_at_turn).toBe(3)
    expect(out.data.saturation_count).toBe(1)
    expect(out.data.pending_plan).not.toBeNull()
    if (out.data.pending_plan) {
      expect(out.data.pending_plan.intent_excerpt).toContain('parser')
      expect(out.data.pending_plan.files_to_edit).toContain('src/parser.ts')
      expect(out.data.pending_plan.emitted_at_turn).toBe(2)
    }
    expect(out.data.ledger_counts).toEqual({
      agent: 1,
      tool: 1,
      hook: 0,
      human: 0,
    })
    expect(out.data.recent_events?.length).toBeGreaterThan(0)
  })

  it('truncates pending_plan.intent_excerpt to 400 chars', async () => {
    const s = applyEmitPlan({
      state: createInitialLoopDisciplineState(2, 'build'),
      plan: {
        intent: 'x'.repeat(2_000),
        files_to_edit: ['a'],
        smallest_test: 't',
      },
      turnCount: 1,
      now: 0,
    })
    const ctx = makeContext(s)
    const out = await GetLoopDisciplineStatusTool.call(
      {},
      // biome-ignore lint/suspicious/noExplicitAny: minimal stub
      ctx as any,
      stubCanUse,
      stubMsg,
      undefined,
    )
    expect(out.data.pending_plan?.intent_excerpt.length).toBe(400)
  })
})

describe('GetLoopDisciplineStatusTool — recent_events limit', () => {
  it('respects the input recent_events parameter', async () => {
    let s = createInitialLoopDisciplineState(2, 'build')
    // Generate 5 events via phase transitions.
    for (let i = 0; i < 5; i++) {
      s = applyPhaseTransition({
        state: s,
        to: i % 2 === 0 ? 'plan' : 'build',
        reason: `r${i}`,
        turnCount: i + 1,
        now: i,
      })
    }
    const ctx = makeContext(s)
    const out = await GetLoopDisciplineStatusTool.call(
      { recent_events: 2 },
      // biome-ignore lint/suspicious/noExplicitAny: minimal stub
      ctx as any,
      stubCanUse,
      stubMsg,
      undefined,
    )
    expect(out.data.recent_events).toHaveLength(2)
  })

  it('returns empty array when recent_events=0', async () => {
    let s = createInitialLoopDisciplineState(2, 'build')
    s = applyPhaseTransition({
      state: s,
      to: 'plan',
      reason: 'r',
      turnCount: 1,
      now: 0,
    })
    const ctx = makeContext(s)
    const out = await GetLoopDisciplineStatusTool.call(
      { recent_events: 0 },
      // biome-ignore lint/suspicious/noExplicitAny: minimal stub
      ctx as any,
      stubCanUse,
      stubMsg,
      undefined,
    )
    expect(out.data.recent_events).toEqual([])
  })
})
