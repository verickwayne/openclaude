// Integration test wiring the discipline tools through their .call()
// interfaces.
//
// Existing tests cover two layers separately:
//   1. apply* functions (pure transitions) — loopDiscipline.test.ts,
//      loopDiscipline.end-to-end.test.ts.
//   2. Tool definitions in isolation (single-call behavior) —
//      LoopDisciplineTools.test.ts, EmitVerificationTool.test.ts,
//      GetLoopDisciplineStatusTool.test.ts.
//
// What's NOT covered separately: a canonical sequence that goes through
// the tool .call() interfaces and verifies that the setLoopDiscipline
// mutator + getLoopDiscipline accessor correctly relay state between
// tools across multiple calls. This file fills that gap with a single
// composition test plus a few wire-specific regression assertions.

import { describe, expect, it } from 'bun:test'
import {
  createInitialLoopDisciplineState,
  evaluateCompletionExit,
  hadMutationsThisLoop,
  type LoopDisciplineState,
} from '../../types/loopDiscipline.js'
import { EmitPlanTool } from './EmitPlanTool.js'
import { EmitPhaseTransitionTool } from './EmitPhaseTransitionTool.js'
import { EmitVerificationTool } from './EmitVerificationTool.js'
import { GetLoopDisciplineStatusTool } from './GetLoopDisciplineStatusTool.js'

/** Minimal stub of the ToolUseContext fields the discipline tools read. */
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

// biome-ignore lint/suspicious/noExplicitAny: bridge into runtime
const stubCanUse: any = async () => ({ behavior: 'allow' })
// biome-ignore lint/suspicious/noExplicitAny: bridge into runtime
const stubMsg: any = {}

describe('Tool wiring integration: plan → transition → verify → status', () => {
  it('composes correctly through the tool .call() interfaces', async () => {
    // T0: start in plan phase (model is ready to plan).
    const ctx = makeContext(createInitialLoopDisciplineState(2, 'plan'))

    // T1: EmitPlanTool records the plan via setLoopDiscipline → applyEmitPlan.
    const planOut = await EmitPlanTool.call(
      {
        intent: 'Wire validation through the auth pipeline',
        files_to_edit: ['src/auth/validate.ts', 'src/auth/middleware.ts'],
        smallest_test: 'bun test src/auth/validate.test.ts',
      },
      // biome-ignore lint/suspicious/noExplicitAny: minimal stub
      ctx as any,
      stubCanUse,
      stubMsg,
      undefined,
    )
    expect(planOut.data.plan_recorded).toBe(true)
    expect(ctx._holder.current.pendingPlan).not.toBeNull()
    expect(ctx._holder.current.pendingPlan?.intent).toContain('validation')

    // T2: GetLoopDisciplineStatusTool reads back what EmitPlan wrote.
    // This verifies the getter side of the wire matches what the setter
    // wrote — a real regression risk if either side stops reading state
    // by closure.
    const statusBefore = await GetLoopDisciplineStatusTool.call(
      {},
      // biome-ignore lint/suspicious/noExplicitAny: minimal stub
      ctx as any,
      stubCanUse,
      stubMsg,
      undefined,
    )
    expect(statusBefore.data.available).toBe(true)
    expect(statusBefore.data.phase).toBe('plan')
    expect(statusBefore.data.pending_plan).not.toBeNull()
    expect(statusBefore.data.pending_plan?.files_to_edit).toEqual([
      'src/auth/validate.ts',
      'src/auth/middleware.ts',
    ])

    // T3: EmitPhaseTransitionTool moves plan → build. Gate consults
    // pendingPlan (set in T1); transition allowed.
    const transOut = await EmitPhaseTransitionTool.call(
      { to: 'build', reason: 'plan recorded, ready to edit' },
      // biome-ignore lint/suspicious/noExplicitAny: minimal stub
      ctx as any,
      stubCanUse,
      stubMsg,
      undefined,
    )
    expect(transOut.data.transitioned).toBe(true)
    expect(transOut.data.from).toBe('plan')
    expect(transOut.data.to).toBe('build')
    expect(ctx._holder.current.phase).toBe('build')

    // T4: GetLoopDisciplineStatusTool now reports the new phase and the
    // phase-transition event the transition tool emitted.
    const statusMid = await GetLoopDisciplineStatusTool.call(
      {},
      // biome-ignore lint/suspicious/noExplicitAny: minimal stub
      ctx as any,
      stubCanUse,
      stubMsg,
      undefined,
    )
    expect(statusMid.data.phase).toBe('build')
    expect(
      statusMid.data.recent_events?.some(line =>
        line.includes('phase-transition'),
      ),
    ).toBe(true)

    // T5: EmitVerificationTool records an agent-source claim. Gate
    // invariant: source is hard-coded to 'agent' regardless of input
    // (which doesn't even expose a source field). Verify here.
    const verifOut = await EmitVerificationTool.call(
      {
        claim: 'I edited both files and the imports match.',
        evidence: 'manual inspection of diff',
      },
      // biome-ignore lint/suspicious/noExplicitAny: minimal stub
      ctx as any,
      stubCanUse,
      stubMsg,
      undefined,
    )
    expect(verifOut.data.recorded).toBe(true)
    expect(ctx._holder.current.verificationLedger).toHaveLength(1)
    expect(ctx._holder.current.verificationLedger[0].source).toBe('agent')

    // T6: GetLoopDisciplineStatusTool surfaces the ledger count by source.
    // Agent count is 1; tool/hook/human all 0.
    const statusAfter = await GetLoopDisciplineStatusTool.call(
      {},
      // biome-ignore lint/suspicious/noExplicitAny: minimal stub
      ctx as any,
      stubCanUse,
      stubMsg,
      undefined,
    )
    expect(statusAfter.data.ledger_counts).toEqual({
      agent: 1,
      tool: 0,
      hook: 0,
      human: 0,
    })

    // T7: critical invariant — the completion gate STILL refuses exit
    // here because the only ledger entry is source='agent'. The model
    // can't unblock the gate by stacking more EmitVerification calls.
    // The gate's underlying check requires hadMutationsThisLoop=true,
    // so simulate that one mutation occurred by reading saturation
    // state; here we haven't mutated saturation through tools but the
    // gate evaluates hadMutationsThisLoop which returns true if the
    // ledger has any entries.
    expect(hadMutationsThisLoop(ctx._holder.current)).toBe(true)
    const exit = evaluateCompletionExit(
      ctx._holder.current,
      hadMutationsThisLoop(ctx._holder.current),
    )
    expect(exit.allowed).toBe(false)
    if (!exit.allowed) {
      expect(exit.reason).toBe('requires_verification')
      expect(exit.nudge).toContain('agent-source claim')
    }
  })
})

describe('Tool wiring: blocked plan→build without EmitPlan', () => {
  it('refuses transition AND does not advance the phase', async () => {
    const ctx = makeContext(createInitialLoopDisciplineState(2, 'plan'))

    // Try to transition without an EmitPlan call first.
    const out = await EmitPhaseTransitionTool.call(
      { to: 'build', reason: 'ready to edit' },
      // biome-ignore lint/suspicious/noExplicitAny: minimal stub
      ctx as any,
      stubCanUse,
      stubMsg,
      undefined,
    )
    expect(out.data.transitioned).toBe(false)
    expect(out.data.blocked_reason).toContain('EmitPlan')

    // Phase did NOT advance.
    expect(ctx._holder.current.phase).toBe('plan')

    // GetLoopDisciplineStatusTool confirms phase is unchanged.
    const status = await GetLoopDisciplineStatusTool.call(
      {},
      // biome-ignore lint/suspicious/noExplicitAny: minimal stub
      ctx as any,
      stubCanUse,
      stubMsg,
      undefined,
    )
    expect(status.data.phase).toBe('plan')
  })
})

describe('Tool wiring: setter/getter share the same state binding', () => {
  it('verifies state writes via setLoopDiscipline are visible to getLoopDiscipline immediately', async () => {
    // This pins the wire-up contract: the closure captures the state
    // binding by REFERENCE, so writes are visible to all subsequent
    // reads. If a future refactor accidentally returned a snapshot
    // via getLoopDiscipline, this test would fail.

    const ctx = makeContext(createInitialLoopDisciplineState(2, 'build'))

    // Read the state before any write — confirm baseline.
    const before = await GetLoopDisciplineStatusTool.call(
      {},
      // biome-ignore lint/suspicious/noExplicitAny: minimal stub
      ctx as any,
      stubCanUse,
      stubMsg,
      undefined,
    )
    expect(before.data.phase).toBe('build')

    // Write via EmitPhaseTransition.
    await EmitPhaseTransitionTool.call(
      { to: 'plan', reason: 'thinking' },
      // biome-ignore lint/suspicious/noExplicitAny: minimal stub
      ctx as any,
      stubCanUse,
      stubMsg,
      undefined,
    )

    // Immediate read via GetLoopDisciplineStatusTool sees the new phase.
    const after = await GetLoopDisciplineStatusTool.call(
      {},
      // biome-ignore lint/suspicious/noExplicitAny: minimal stub
      ctx as any,
      stubCanUse,
      stubMsg,
      undefined,
    )
    expect(after.data.phase).toBe('plan')
  })
})

describe('Tool wiring: legacy callers (no discipline plumbing)', () => {
  it('all four tools no-op cleanly when getLoopDiscipline/setLoopDiscipline are absent', async () => {
    // biome-ignore lint/suspicious/noExplicitAny: minimal stub
    const legacyCtx: any = {}

    const planOut = await EmitPlanTool.call(
      {
        intent: 'x',
        files_to_edit: ['a'],
        smallest_test: 't',
      },
      legacyCtx,
      stubCanUse,
      stubMsg,
      undefined,
    )
    expect(planOut.data.plan_recorded).toBe(false)

    const transOut = await EmitPhaseTransitionTool.call(
      { to: 'build', reason: 'x' },
      legacyCtx,
      stubCanUse,
      stubMsg,
      undefined,
    )
    expect(transOut.data.transitioned).toBe(false)

    const verifOut = await EmitVerificationTool.call(
      { claim: 'x' },
      legacyCtx,
      stubCanUse,
      stubMsg,
      undefined,
    )
    expect(verifOut.data.recorded).toBe(false)

    const statusOut = await GetLoopDisciplineStatusTool.call(
      {},
      legacyCtx,
      stubCanUse,
      stubMsg,
      undefined,
    )
    expect(statusOut.data.available).toBe(false)
  })
})
