// EmitPlan — the model's vehicle for emitting a plan during plan phase.
//
// The recorded plan is consumed by:
//   - evaluatePhaseTransition() — plan → build is only allowed when a
//     fresh pendingPlan exists (see src/types/loopDiscipline.ts).
//   - buildPlanHandoffMessage() — produces the verbatim plan content the
//     query loop prepends to next-turn build-phase context. This is the
//     Aider Issue #2258 mitigation (no summarization between phases).
//
// The tool itself is intentionally minimal: it has no side effects beyond
// updating state.loopDiscipline via the setLoopDiscipline mutator on
// ToolUseContext. The state factory `applyEmitPlan` (in loopDiscipline.ts)
// handles input trimming and timestamping.
//
// Per docs/plans/20260606224012_in-loop-discipline.md Phase E.

import { z } from 'zod/v4'
import { buildTool } from '../../Tool.js'
import { applyEmitPlan } from '../../types/loopDiscipline.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { EMIT_PLAN_TOOL_NAME } from './constants.js'

const inputSchema = lazySchema(() =>
  z.strictObject({
    intent: z
      .string()
      .min(1)
      .describe(
        'One paragraph: what change you intend to make and why. Concrete enough to verify against — "refactor parser to support unicode" not "improve parser".',
      ),
    files_to_edit: z
      .array(z.string())
      .min(1)
      .describe(
        'Paths you will edit, in the order you intend to edit them. Relative to the project root.',
      ),
    smallest_test: z
      .string()
      .min(1)
      .describe(
        'The smallest possible command that would prove the change works. Example: "bun test src/parser.test.ts::handles-unicode" or "pytest tests/test_parser.py::test_unicode".',
      ),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>

const outputSchema = lazySchema(() =>
  z.object({
    plan_recorded: z.boolean(),
    intent_chars: z.number(),
    files_count: z.number(),
    next_action: z
      .string()
      .describe(
        'Reminder of what to do next — emit a phase transition to build, then start editing the listed files.',
      ),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>

const DESCRIPTION =
  'Emit a plan for the work you are about to do. Required by the plan→build phase gate when in-loop discipline is enforced — the model cannot exit plan phase without a recorded plan.'

const PROMPT = `Use EmitPlan when you are in plan phase and ready to transition to build. The recorded plan will be prepended VERBATIM to your next-turn build-phase context so you have the exact intent/files/test list in front of you while editing.

If you discover mid-build that the plan was wrong, transition back to plan phase and emit a new plan rather than expanding scope silently.

Inputs:
- intent: one paragraph describing the change and its reason.
- files_to_edit: ordered list of paths.
- smallest_test: command that proves the change works.

The discipline gate only allows plan→build if pendingPlan was emitted in the current plan-phase window (emittedAtTurn >= phaseEnteredAt).`

export const EmitPlanTool = buildTool({
  name: EMIT_PLAN_TOOL_NAME,
  searchHint: 'record a plan before transitioning out of plan phase',
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
    return 'EmitPlan'
  },
  shouldDefer: true,
  isEnabled() {
    return true
  },
  toAutoClassifierInput(input) {
    return `${input.files_to_edit.length} files, ${input.intent.length} chars`
  },
  async checkPermissions(input) {
    return { behavior: 'allow', updatedInput: input }
  },
  renderToolUseMessage() {
    return null
  },
  async call(input, context, _canUseTool, _parentMessage, _onProgress) {
    const setter = context.setLoopDiscipline
    if (!setter) {
      // Legacy caller without discipline plumbing. The tool is still
      // technically callable but its side effect is a no-op — caller
      // should not register this tool in such contexts.
      return {
        data: {
          plan_recorded: false,
          intent_chars: input.intent.length,
          files_count: input.files_to_edit.length,
          next_action:
            'No-op: loop-discipline mutator unavailable in this context. Plan was NOT recorded.',
        },
      }
    }

    let recorded = false
    setter(prev => {
      const next = applyEmitPlan({
        state: prev,
        plan: {
          intent: input.intent,
          files_to_edit: input.files_to_edit,
          smallest_test: input.smallest_test,
        },
        turnCount: prev.phaseEnteredAt > 0 ? prev.phaseEnteredAt + 1 : 1,
        now: Date.now(),
      })
      recorded = true
      return next
    })

    return {
      data: {
        plan_recorded: recorded,
        intent_chars: input.intent.length,
        files_count: input.files_to_edit.length,
        next_action:
          'Emit a phase transition to build (EmitPhaseTransition with to=build). The plan you just recorded will be prepended verbatim to the next-turn context.',
      },
    }
  },
})
