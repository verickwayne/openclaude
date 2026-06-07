// GetLoopDisciplineStatus — the model's read-side window into its own
// loop-discipline state.
//
// Read complement to the Emit* family. EmitPlan / EmitPhaseTransition /
// EmitVerification let the model WRITE to discipline state; this tool
// lets it READ. Useful when:
//   - A gate just fired and the model needs to understand WHY (which
//     phase it's in, how close to saturation it is, what's in the
//     pendingPlan).
//   - The model wants to verify its own assumptions before transitioning
//     phases (am I really in plan? does my pendingPlan still exist?).
//   - Debugging "why did the harness do X" without grepping the JSONL
//     log mid-session.
//
// Returns a compact summary, NOT the full state. The verbatim event
// stream lives in state.events; for post-session forensics, consult
// OPENCLAUDE_DISCIPLINE_EVENT_LOG.

import { z } from 'zod/v4'
import { buildTool } from '../../Tool.js'
import {
  countLedgerEntriesBySource,
  formatDisciplineEvent,
} from '../../types/loopDiscipline.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { GET_LOOP_DISCIPLINE_STATUS_TOOL_NAME } from './constants.js'

const DEFAULT_RECENT_EVENTS = 10
const MAX_RECENT_EVENTS = 50

const inputSchema = lazySchema(() =>
  z.strictObject({
    recent_events: z
      .number()
      .int()
      .min(0)
      .max(MAX_RECENT_EVENTS)
      .optional()
      .describe(
        `How many recent DisciplineEvents to include (default ${DEFAULT_RECENT_EVENTS}, max ${MAX_RECENT_EVENTS}). Pass 0 to omit events entirely.`,
      ),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>

const outputSchema = lazySchema(() =>
  z.object({
    available: z.boolean(),
    level: z.number().optional(),
    phase: z.string().optional(),
    phase_entered_at_turn: z.number().optional(),
    saturation_count: z.number().optional(),
    saturation_trips_this_task: z.number().optional(),
    saturation_proof_turn: z.number().nullable().optional(),
    tamper_guard_enabled: z.boolean().optional(),
    pending_plan: z
      .object({
        intent_excerpt: z.string(),
        files_to_edit: z.array(z.string()),
        smallest_test: z.string(),
        emitted_at_turn: z.number(),
      })
      .nullable()
      .optional(),
    ledger_counts: z
      .object({
        agent: z.number(),
        tool: z.number(),
        hook: z.number(),
        human: z.number(),
      })
      .optional(),
    recent_events: z.array(z.string()).optional(),
    note: z.string(),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>

const DESCRIPTION =
  'Read the current loop-discipline state: phase, saturation counters, pending plan summary, ledger counts by source, and the last N recorded events. Useful for debugging why a gate fired, verifying the harness state matches your model of it, or deciding what tool to call next.'

const PROMPT = `Call GetLoopDisciplineStatus when:
- A gate (phase, tamper, saturation) just denied a tool call and you want to understand the exact state that caused it.
- You want to verify your model of the current phase before transitioning.
- You're at high saturation and want to see how many trips this task has already had.

The output is a snapshot. The verbatim event stream (and the verification ledger) live in process state; this tool returns a compact projection optimized for the model's next decision, not for forensics.`

export const GetLoopDisciplineStatusTool = buildTool({
  name: GET_LOOP_DISCIPLINE_STATUS_TOOL_NAME,
  searchHint: 'read the current loop-discipline state',
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
    return 'GetLoopDisciplineStatus'
  },
  shouldDefer: true,
  isEnabled() {
    return true
  },
  isReadOnly() {
    return true
  },
  toAutoClassifierInput() {
    return ''
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
    const getter = context.getLoopDiscipline
    if (!getter) {
      return {
        data: {
          available: false,
          note: 'Loop-discipline accessor unavailable in this context (legacy caller). Set OPENCLAUDE_IN_LOOP_DISCIPLINE=1 or higher to enable the discipline harness.',
        },
      }
    }

    const state = getter()
    if (!state) {
      return {
        data: {
          available: false,
          note: 'No loop-discipline state has been initialized for this loop.',
        },
      }
    }

    const recentCount = input.recent_events ?? DEFAULT_RECENT_EVENTS
    const recent =
      recentCount > 0
        ? state.events
            .slice(-recentCount)
            .map(formatDisciplineEvent)
        : []

    const ledgerCounts = countLedgerEntriesBySource(state)

    return {
      data: {
        available: true,
        level: state.level,
        phase: state.phase,
        phase_entered_at_turn: state.phaseEnteredAt,
        saturation_count: state.saturationCount,
        saturation_trips_this_task: state.saturationTripsThisTask,
        saturation_proof_turn: state.saturationProofTurn,
        tamper_guard_enabled: state.tamperGuardEnabled,
        pending_plan: state.pendingPlan
          ? {
              intent_excerpt: state.pendingPlan.intent.slice(0, 400),
              files_to_edit: state.pendingPlan.files_to_edit,
              smallest_test: state.pendingPlan.smallest_test,
              emitted_at_turn: state.pendingPlan.emittedAtTurn,
            }
          : null,
        ledger_counts: ledgerCounts,
        recent_events: recent,
        note: 'Snapshot of current loop-discipline state. For full event history use OPENCLAUDE_DISCIPLINE_EVENT_LOG.',
      },
    }
  },
})
