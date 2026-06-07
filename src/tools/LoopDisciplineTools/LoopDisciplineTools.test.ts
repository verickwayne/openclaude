import { describe, expect, it } from 'bun:test'
import {
  createInitialLoopDisciplineState,
  type LoopDisciplineState,
} from '../../types/loopDiscipline.js'
import { EmitPlanTool } from './EmitPlanTool.js'
import { EmitPhaseTransitionTool } from './EmitPhaseTransitionTool.js'
import {
  EMIT_PHASE_TRANSITION_TOOL_NAME,
  EMIT_PLAN_TOOL_NAME,
} from './constants.js'

// Minimal ToolUseContext stub. We only exercise the discipline-mutator
// path — the rest of the context fields are left undefined and the tools
// don't touch them.
function makeContext(initial: LoopDisciplineState) {
  const holder = { current: initial }
  return {
    getLoopDiscipline: () => holder.current,
    setLoopDiscipline: (
      update: (prev: LoopDisciplineState) => LoopDisciplineState,
    ) => {
      holder.current = update(holder.current)
    },
    _holder: holder,
  }
}

// Stub for the unused (canUseTool, parentMessage) tail args. buildTool's
// wrapper threads more args through than the call() definition uses, so
// tests have to pass these through with the same `as any` discipline.
// biome-ignore lint/suspicious/noExplicitAny: bridge into the tool runtime
const stubCanUse: any = async () => ({ behavior: 'allow' })
// biome-ignore lint/suspicious/noExplicitAny: bridge into the tool runtime
const stubMsg: any = {}

describe('EmitPlanTool — constants', () => {
  it('exposes the expected name', () => {
    expect(EmitPlanTool.name).toBe(EMIT_PLAN_TOOL_NAME)
    expect(EmitPlanTool.name).toBe('EmitPlan')
  })
})

describe('EmitPlanTool — call()', () => {
  it('records a plan via the discipline mutator', async () => {
    const ctx = makeContext(createInitialLoopDisciplineState(2, 'plan'))
    const out = await EmitPlanTool.call(
      {
        intent: 'Refactor parser',
        files_to_edit: ['src/parser.ts', 'src/lexer.ts'],
        smallest_test: 'bun test src/parser.test.ts',
      },
      // biome-ignore lint/suspicious/noExplicitAny: minimal test stub
      ctx as any,
      stubCanUse,
      stubMsg,
    )
    expect(out.data.plan_recorded).toBe(true)
    expect(out.data.intent_chars).toBe('Refactor parser'.length)
    expect(out.data.files_count).toBe(2)
    expect(ctx._holder.current.pendingPlan).not.toBeNull()
    expect(ctx._holder.current.pendingPlan?.intent).toBe('Refactor parser')
  })

  it('no-ops cleanly when setLoopDiscipline is unavailable (legacy callers)', async () => {
    const out = await EmitPlanTool.call(
      {
        intent: 'x',
        files_to_edit: ['a'],
        smallest_test: 't',
      },
      // biome-ignore lint/suspicious/noExplicitAny: minimal test stub
      {} as any,
      stubCanUse,
      stubMsg,
    )
    expect(out.data.plan_recorded).toBe(false)
    expect(out.data.next_action).toContain('No-op')
  })
})

describe('EmitPhaseTransitionTool — constants', () => {
  it('exposes the expected name', () => {
    expect(EmitPhaseTransitionTool.name).toBe(EMIT_PHASE_TRANSITION_TOOL_NAME)
    expect(EmitPhaseTransitionTool.name).toBe('EmitPhaseTransition')
  })
})

describe('EmitPhaseTransitionTool — call()', () => {
  it('allows build → plan', async () => {
    const ctx = makeContext(createInitialLoopDisciplineState(2, 'build'))
    const out = await EmitPhaseTransitionTool.call(
      { to: 'plan', reason: 'reconsidering approach' },
      // biome-ignore lint/suspicious/noExplicitAny: minimal test stub
      ctx as any,
      stubCanUse,
      stubMsg,
    )
    expect(out.data.transitioned).toBe(true)
    expect(out.data.from).toBe('build')
    expect(out.data.to).toBe('plan')
    expect(ctx._holder.current.phase).toBe('plan')
  })

  it('blocks plan → build without a plan', async () => {
    const ctx = makeContext(createInitialLoopDisciplineState(2, 'plan'))
    const out = await EmitPhaseTransitionTool.call(
      { to: 'build', reason: 'ready to edit' },
      // biome-ignore lint/suspicious/noExplicitAny: minimal test stub
      ctx as any,
      stubCanUse,
      stubMsg,
    )
    expect(out.data.transitioned).toBe(false)
    expect(out.data.blocked_reason).toContain('EmitPlan')
    expect(ctx._holder.current.phase).toBe('plan')
  })

  it('allows plan → build after EmitPlan', async () => {
    const ctx = makeContext(createInitialLoopDisciplineState(2, 'plan'))
    await EmitPlanTool.call(
      {
        intent: 'do it',
        files_to_edit: ['a.ts'],
        smallest_test: 't',
      },
      // biome-ignore lint/suspicious/noExplicitAny: minimal test stub
      ctx as any,
      stubCanUse,
      stubMsg,
    )
    const out = await EmitPhaseTransitionTool.call(
      { to: 'build', reason: 'plan emitted' },
      // biome-ignore lint/suspicious/noExplicitAny: minimal test stub
      ctx as any,
      stubCanUse,
      stubMsg,
    )
    expect(out.data.transitioned).toBe(true)
    expect(out.data.to).toBe('build')
    expect(ctx._holder.current.phase).toBe('build')
  })

  it('records history through applyPhaseTransition (resets saturation)', async () => {
    const ctx = makeContext({
      ...createInitialLoopDisciplineState(2, 'build'),
      saturationCount: 5,
      saturationProofTurn: 3,
    })
    const out = await EmitPhaseTransitionTool.call(
      { to: 'plan', reason: 'redirect' },
      // biome-ignore lint/suspicious/noExplicitAny: minimal test stub
      ctx as any,
      stubCanUse,
      stubMsg,
    )
    expect(out.data.transitioned).toBe(true)
    expect(ctx._holder.current.saturationCount).toBe(0)
    expect(ctx._holder.current.saturationProofTurn).toBeNull()
    expect(ctx._holder.current.phaseHistory).toHaveLength(1)
  })

  it('produces a useful next_action hint for each destination', async () => {
    for (const phase of ['explore', 'plan', 'build', 'verify', 'refine'] as const) {
      // For plan→build we'd need a plan first, so start in build for all dests.
      const ctx = makeContext(createInitialLoopDisciplineState(2, 'build'))
      const out = await EmitPhaseTransitionTool.call(
        { to: phase, reason: 'test' },
        // biome-ignore lint/suspicious/noExplicitAny: minimal test stub
        ctx as any,
        stubCanUse,
        stubMsg,
      )
      expect(out.data.next_action).toContain(phase)
    }
  })

  it('no-ops cleanly without context plumbing', async () => {
    const out = await EmitPhaseTransitionTool.call(
      { to: 'plan', reason: 'x' },
      // biome-ignore lint/suspicious/noExplicitAny: minimal test stub
      {} as any,
      stubCanUse,
      stubMsg,
    )
    expect(out.data.transitioned).toBe(false)
  })
})

describe('EmitPhaseTransition + EmitPlan end-to-end', () => {
  it('models the full plan-then-edit flow', async () => {
    const ctx = makeContext(createInitialLoopDisciplineState(2, 'build'))

    // Step 1: build → plan (allowed unconditionally).
    let out = await EmitPhaseTransitionTool.call(
      { to: 'plan', reason: 'about to refactor' },
      // biome-ignore lint/suspicious/noExplicitAny: minimal test stub
      ctx as any,
      stubCanUse,
      stubMsg,
    )
    expect(out.data.transitioned).toBe(true)
    expect(ctx._holder.current.phase).toBe('plan')

    // Step 2: EmitPlan.
    const planOut = await EmitPlanTool.call(
      {
        intent: 'Extract token validation to a shared helper',
        files_to_edit: ['src/auth/validate.ts', 'src/auth/index.ts'],
        smallest_test: 'bun test src/auth/validate.test.ts',
      },
      // biome-ignore lint/suspicious/noExplicitAny: minimal test stub
      ctx as any,
      stubCanUse,
      stubMsg,
    )
    expect(planOut.data.plan_recorded).toBe(true)

    // Step 3: plan → build (now allowed).
    out = await EmitPhaseTransitionTool.call(
      { to: 'build', reason: 'plan emitted, ready to edit' },
      // biome-ignore lint/suspicious/noExplicitAny: minimal test stub
      ctx as any,
      stubCanUse,
      stubMsg,
    )
    expect(out.data.transitioned).toBe(true)
    expect(ctx._holder.current.phase).toBe('build')
    expect(ctx._holder.current.phaseHistory.map(t => t.to)).toEqual([
      'plan',
      'build',
    ])
  })
})
