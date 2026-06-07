import { describe, expect, it } from 'bun:test'
import {
  createInitialLoopDisciplineState,
  evaluateCompletionExit,
  type LoopDisciplineState,
} from '../../types/loopDiscipline.js'
import { EmitVerificationTool } from './EmitVerificationTool.js'
import { EMIT_VERIFICATION_TOOL_NAME } from './constants.js'

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

describe('EmitVerificationTool — constants', () => {
  it('exposes the expected name', () => {
    expect(EmitVerificationTool.name).toBe(EMIT_VERIFICATION_TOOL_NAME)
    expect(EmitVerificationTool.name).toBe('EmitVerification')
  })
})

describe('EmitVerificationTool — call() basic behavior', () => {
  it('records a claim with source=\'agent\' (the load-bearing invariant)', async () => {
    const ctx = makeContext(createInitialLoopDisciplineState(2))
    const out = await EmitVerificationTool.call(
      {
        claim: 'I checked the form fields look populated.',
        evidence: 'pymupdf widget.field_value scan',
        tool_name: 'pymupdf',
      },
      // biome-ignore lint/suspicious/noExplicitAny: minimal test stub
      ctx as any,
      stubCanUse,
      stubMsg,
      undefined,
    )
    expect(out.data.recorded).toBe(true)
    expect(out.data.ledger_size).toBe(1)
    const entry = ctx._holder.current.verificationLedger[0]
    expect(entry.source).toBe('agent')
    expect(entry.claim).toBe('I checked the form fields look populated.')
    expect(entry.toolName).toBe('pymupdf')
    expect(entry.evidence).toBe('pymupdf widget.field_value scan')
  })

  it('no-ops cleanly without context plumbing', async () => {
    const out = await EmitVerificationTool.call(
      { claim: 'x' },
      // biome-ignore lint/suspicious/noExplicitAny: minimal test stub
      {} as any,
      stubCanUse,
      stubMsg,
      undefined,
    )
    expect(out.data.recorded).toBe(false)
  })
})

describe('EmitVerificationTool — gate invariant', () => {
  it('agent-source entries from this tool do NOT satisfy the completion gate', async () => {
    // The crucial test: model can't bypass the gate by calling
    // EmitVerification repeatedly. The source enum is enforced at the
    // tool layer (always 'agent') and the gate ignores agent entries
    // when deciding exit.

    const ctx = makeContext({
      ...createInitialLoopDisciplineState(2),
      saturationCount: 1, // signals hadMutationsThisLoop=true
    })

    // Stack 100 EmitVerification calls.
    for (let i = 0; i < 100; i++) {
      await EmitVerificationTool.call(
        { claim: `Claim ${i}`, evidence: 'evidence-stub' },
        // biome-ignore lint/suspicious/noExplicitAny: minimal test stub
        ctx as any,
        stubCanUse,
        stubMsg,
        undefined,
      )
    }
    expect(ctx._holder.current.verificationLedger).toHaveLength(100)
    // All entries source='agent'.
    for (const e of ctx._holder.current.verificationLedger) {
      expect(e.source).toBe('agent')
    }
    // Gate STILL refuses exit.
    const exit = evaluateCompletionExit(ctx._holder.current, true)
    expect(exit.allowed).toBe(false)
  })
})

describe('EmitVerificationTool — input bounds', () => {
  it('trims oversized claim to 2000 chars', async () => {
    const ctx = makeContext(createInitialLoopDisciplineState(2))
    const huge = 'x'.repeat(10_000)
    await EmitVerificationTool.call(
      { claim: huge },
      // biome-ignore lint/suspicious/noExplicitAny: minimal test stub
      ctx as any,
      stubCanUse,
      stubMsg,
      undefined,
    )
    expect(ctx._holder.current.verificationLedger[0].claim.length).toBe(2_000)
  })

  it('trims evidence to 1000 chars', async () => {
    const ctx = makeContext(createInitialLoopDisciplineState(2))
    const huge = 'y'.repeat(5_000)
    await EmitVerificationTool.call(
      { claim: 'short', evidence: huge },
      // biome-ignore lint/suspicious/noExplicitAny: minimal test stub
      ctx as any,
      stubCanUse,
      stubMsg,
      undefined,
    )
    expect(ctx._holder.current.verificationLedger[0].evidence?.length).toBe(
      1_000,
    )
  })

  it('handles optional fields cleanly', async () => {
    const ctx = makeContext(createInitialLoopDisciplineState(2))
    await EmitVerificationTool.call(
      { claim: 'minimal' },
      // biome-ignore lint/suspicious/noExplicitAny: minimal test stub
      ctx as any,
      stubCanUse,
      stubMsg,
      undefined,
    )
    const entry = ctx._holder.current.verificationLedger[0]
    expect(entry.evidence).toBeUndefined()
    expect(entry.toolName).toBeUndefined()
  })
})
