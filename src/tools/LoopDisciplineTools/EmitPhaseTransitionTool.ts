// EmitPhaseTransition — the model's vehicle for moving between loop
// phases. Consults evaluatePhaseTransition() before applying — refuses
// transitions that fail the gate (e.g. plan → build without a fresh
// pendingPlan from EmitPlan).
//
// Per docs/plans/20260606224012_in-loop-discipline.md Phase E.

import { z } from 'zod/v4'
import { buildTool } from '../../Tool.js'
import {
  applyPhaseTransition,
  evaluatePhaseTransition,
  type Phase,
} from '../../types/loopDiscipline.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { EMIT_PHASE_TRANSITION_TOOL_NAME } from './constants.js'

const PHASE_VALUES = ['explore', 'plan', 'build', 'verify', 'refine'] as const

const inputSchema = lazySchema(() =>
  z.strictObject({
    to: z
      .enum(PHASE_VALUES)
      .describe(
        'Destination phase. plan→build requires a recent EmitPlan call. All other transitions are unconditionally allowed.',
      ),
    reason: z
      .string()
      .min(1)
      .describe(
        'Why this transition is happening — recorded in phaseHistory for the audit trail.',
      ),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>

const outputSchema = lazySchema(() =>
  z.object({
    transitioned: z.boolean(),
    from: z.enum(PHASE_VALUES).optional(),
    to: z.enum(PHASE_VALUES).optional(),
    blocked_reason: z.string().optional(),
    next_action: z.string(),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>

const DESCRIPTION =
  'Transition the loop to a different phase. The destination decides which tools are available, so use this to move out of plan once you have a plan, or into verify after you finish editing.'

const PROMPT = `Use EmitPhaseTransition to move between the five loop phases:
- explore: read/grep/web only — no editing.
- plan: read/grep/web + EmitPlan. Required entry point if the gate forces you here.
- build: full tool surface. Default for most work.
- verify: read + bash test runners. Use after edits to prove they work.
- refine: edit + read + test. Polish pass.

The plan→build transition is gated: it only succeeds when EmitPlan has been called in the current plan-phase window. Other transitions always succeed.`

export const EmitPhaseTransitionTool = buildTool({
  name: EMIT_PHASE_TRANSITION_TOOL_NAME,
  searchHint: 'change the active loop phase',
  maxResultSizeChars: 4_000,
  strict: true,
  async description() {
    return DESCRIPTION
  },
  async prompt() {
    return PROMPT
  },
  get inputSchema(): InputSchema {
    return inputSchema()
  },
  get outputSchema(): OutputSchema {
    return outputSchema()
  },
  userFacingName() {
    return 'EmitPhaseTransition'
  },
  shouldDefer: true,
  isEnabled() {
    return true
  },
  toAutoClassifierInput(input) {
    return `→ ${input.to}`
  },
  async checkPermissions(input) {
    return { behavior: 'allow', updatedInput: input }
  },
  renderToolUseMessage() {
    return null
  },
  mapToolResultToToolResultBlockParam(content, toolUseID) {
    return {
      tool_use_id: toolUseID,
      type: 'tool_result',
      content: JSON.stringify(content),
    }
  },
  async call(input, context, _canUseTool, _parentMessage, _onProgress) {
    const setter = context.setLoopDiscipline
    const getter = context.getLoopDiscipline
    if (!setter || !getter) {
      return {
        data: {
          transitioned: false,
          next_action:
            'No-op: loop-discipline mutator/accessor unavailable in this context. Transition was NOT recorded.',
        },
      }
    }

    const current = getter()
    if (!current) {
      return {
        data: {
          transitioned: false,
          next_action:
            'No-op: loop-discipline state unavailable. Transition was NOT recorded.',
        },
      }
    }

    const gate = evaluatePhaseTransition(current, input.to as Phase)
    if (!gate.allowed) {
      return {
        data: {
          transitioned: false,
          from: current.phase,
          to: input.to as Phase,
          blocked_reason: gate.reason,
          next_action: gate.reason,
        },
      }
    }

    let recordedFrom: Phase = current.phase
    let recordedTo: Phase = input.to as Phase
    setter(prev => {
      const next = applyPhaseTransition({
        state: prev,
        to: input.to as Phase,
        reason: input.reason,
        turnCount: prev.phaseEnteredAt + 1,
        now: Date.now(),
      })
      recordedFrom = prev.phase
      recordedTo = next.phase
      return next
    })

    return {
      data: {
        transitioned: true,
        from: recordedFrom,
        to: recordedTo,
        next_action: buildNextActionHint(recordedTo),
      },
    }
  },
})

function buildNextActionHint(to: Phase): string {
  switch (to) {
    case 'explore':
      return 'You are in explore phase. Read/grep/web only — no editing. Use this to map unfamiliar code before planning.'
    case 'plan':
      return 'You are in plan phase. Call EmitPlan with intent + files_to_edit + smallest_test before transitioning to build.'
    case 'build':
      return 'You are in build phase. Full tool surface. The plan you emitted (if any) is prepended to your next-turn context.'
    case 'verify':
      return 'You are in verify phase. Run tests (bun test / pytest / etc.) to produce verification evidence. The completion gate refuses exit without non-agent verification entries.'
    case 'refine':
      return 'You are in refine phase. Polish pass: edits + reads + tests. No new features.'
  }
}
