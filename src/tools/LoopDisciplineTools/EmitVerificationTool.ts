// EmitVerification — the model's vehicle for attaching a structured
// claim + evidence pair to the verification ledger.
//
// Important: this tool ALWAYS writes source='agent' regardless of input.
// The model cannot satisfy the completion gate by simply calling
// EmitVerification with source='tool' — that would be exactly the
// proxy-check failure mode the gate exists to prevent. Non-agent ledger
// entries come from PostToolUse hooks (the auto-ledger pattern from
// Phase F via applySaturationObservation on verification-pattern Bash
// commands), from explicit harness writes, or from a future EmitFromHuman
// admin tool.
//
// The value of EmitVerification at level 2: it produces a structured
// audit trail of why the model believed work was done. When the
// completion gate refuses exit, those agent claims help the model
// reason about what additional evidence to gather. They don't unlock
// the gate, but they make the model's reasoning legible.
//
// Per docs/plans/20260606224012_in-loop-discipline.md Phase F.

import { z } from 'zod/v4'
import { buildTool } from '../../Tool.js'
import { applyVerificationEntry } from '../../types/loopDiscipline.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { EMIT_VERIFICATION_TOOL_NAME } from './constants.js'

const inputSchema = lazySchema(() =>
  z.strictObject({
    claim: z
      .string()
      .min(1)
      .describe(
        'What was verified, stated concretely. Example: "All 5 ACORD form fields render visibly when extracted via pdftotext", NOT "forms look correct".',
      ),
    evidence: z
      .string()
      .optional()
      .describe(
        'Optional evidence reference — file path, command output excerpt, exit code, or similar. The completion gate does not parse this field; it exists for the audit trail and for the model\'s own reasoning when the gate refuses exit and asks for additional evidence.',
      ),
    tool_name: z
      .string()
      .optional()
      .describe(
        'Optional name of the tool that produced the evidence (e.g., "Bash", "pdftotext"). Audit trail only.',
      ),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>

const outputSchema = lazySchema(() =>
  z.object({
    recorded: z.boolean(),
    ledger_size: z.number(),
    note: z.string(),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>

const DESCRIPTION =
  "Record a structured verification claim into the audit ledger. The claim is stored with source='agent' — it does NOT unlock the completion gate, which requires evidence from tools the model did not invoke. Use this to make your reasoning legible when the loop refuses to exit and you want to enumerate what you checked."

const PROMPT = `Use EmitVerification to record a structured claim about what you verified. Each call appends to the audit ledger.

Important constraint: claims you submit via EmitVerification are recorded as source='agent'. They do NOT satisfy the completion exit gate at discipline level 2 — that gate requires non-agent evidence (a test run's exit code via Bash, a hook-injected check, a human-marked entry).

When to call EmitVerification:
- The completion gate refused exit and you want to enumerate what you DID check while reasoning about what additional evidence to gather.
- You're producing an audit trail for your own reasoning during a verification phase.

When NOT to call EmitVerification:
- You expect calling it to unlock the gate. It will not.
- You want to claim a verification you didn't perform. The audit trail will reflect what was actually checked.

For real evidence: run the verification using a tool (Bash test runner, output extractor, etc.). The auto-ledger writer records those as source='tool'.`

export const EmitVerificationTool = buildTool({
  name: EMIT_VERIFICATION_TOOL_NAME,
  searchHint: 'record a structured verification claim in the audit ledger',
  maxResultSizeChars: 2_000,
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
    return 'EmitVerification'
  },
  shouldDefer: true,
  isEnabled() {
    return true
  },
  toAutoClassifierInput(input) {
    return `claim: ${input.claim.slice(0, 60)}`
  },
  async checkPermissions(input) {
    return { behavior: 'allow', updatedInput: input }
  },
  renderToolUseMessage() {
    return null
  },
  async call(input, context, _canUseTool, _parentMessage, _onProgress) {
    const setter = context.setLoopDiscipline
    const getter = context.getLoopDiscipline
    if (!setter || !getter) {
      return {
        data: {
          recorded: false,
          ledger_size: 0,
          note: 'No-op: loop-discipline mutator/accessor unavailable in this context.',
        },
      }
    }

    let ledgerSize = 0
    setter(prev => {
      const next = applyVerificationEntry({
        state: prev,
        entry: {
          claim: input.claim.slice(0, 2_000),
          // Hard-coded source='agent' — model cannot claim non-agent
          // sources via this tool. See file-header comment for why.
          source: 'agent',
          toolName: input.tool_name?.slice(0, 50),
          evidence: input.evidence?.slice(0, 1_000),
        },
        turnCount: prev.phaseEnteredAt + 1,
        now: Date.now(),
      })
      ledgerSize = next.verificationLedger.length
      return next
    })

    return {
      data: {
        recorded: true,
        ledger_size: ledgerSize,
        note: "Recorded with source='agent'. Does NOT satisfy the completion gate — non-agent evidence is required for that. Run a real verification (Bash test, output extractor) if you need to unlock exit.",
      },
    }
  },
})
