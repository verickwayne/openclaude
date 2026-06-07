// Loop-discipline hook surface.
//
// Pure functions consulted by runPreToolUseHooks. Each one inspects the
// current loop's discipline state and returns either { ok: true } (let the
// tool through) or { ok: false, reason } (block with a tool-result-shaped
// error). The hook chain in toolHooks.ts wires the returned reason into a
// PermissionResult so the model receives it as ordinary deny feedback —
// disambiguable from a real tool failure.
//
// Pattern stolen from ralph-mode-enforcer.sh (research-mode tool block) and
// Cline's PLAN_MODE_RESTRICTED_TOOLS in ToolExecutor.ts. The implementation
// detail that matters: the model gets a structured rejection it can route
// around (via EmitPhaseTransition once that lands in Phase E), not a fatal.

import {
  type DisciplineLevel,
  type LoopDisciplineState,
  type Phase,
  PHASE_TOOL_ALLOWLIST,
} from '../../types/loopDiscipline.js'

export type GateOutcome =
  | { ok: true }
  | { ok: false; reason: string; gate: 'phase-restriction' }

/**
 * Phase gate. Checks whether `toolName` is allowed in the current phase.
 *
 * - Level 0 (observe-only): always allow. The discipline bag still exists
 *   but no gates fire.
 * - Level 1 (advisory): always allow. Callers that want to surface advisory
 *   warnings can read the would-be reason from the returned object.
 * - Level 2 (enforced): block tools that aren't in the phase's allow set.
 *
 * Bash is special: when allowed in a phase, it still gets pattern-matched
 * against the phase's `bashDenyPatterns` (so `git status` is fine in plan
 * mode but `git commit` is denied).
 */
export function evaluatePhaseGate(
  state: LoopDisciplineState | undefined,
  toolName: string,
  toolInput: Record<string, unknown> | undefined,
): GateOutcome {
  if (!state) return { ok: true }
  if (state.level === 0) return { ok: true }

  const policy = PHASE_TOOL_ALLOWLIST[state.phase]
  if (!policy) return { ok: true }

  const allowed =
    policy.allow === '*' || (policy.allow as string[]).includes(toolName)

  if (!allowed) {
    if (state.level === 1) return { ok: true }
    return {
      ok: false,
      gate: 'phase-restriction',
      reason: formatPhaseDenyReason({
        toolName,
        phase: state.phase,
        allow: policy.allow,
      }),
    }
  }

  // Bash-specific deny patterns. Apply even in build (full surface) if the
  // policy lists them — but build's policy currently has no bashDenyPatterns,
  // so this only fires in explore/plan/verify/refine.
  if (
    toolName === 'Bash' &&
    Array.isArray(policy.bashDenyPatterns) &&
    policy.bashDenyPatterns.length > 0
  ) {
    const cmd = readBashCommand(toolInput)
    if (cmd) {
      for (const pat of policy.bashDenyPatterns) {
        if (pat.test(cmd)) {
          if (state.level === 1) return { ok: true }
          return {
            ok: false,
            gate: 'phase-restriction',
            reason: formatBashDenyReason({
              command: cmd,
              phase: state.phase,
              pattern: pat.toString(),
            }),
          }
        }
      }
    }
  }

  return { ok: true }
}

/**
 * Build a deny message that gives the model enough information to
 * self-correct: which tool, which phase, what's allowed, and how to move
 * out of the phase (forward-compatible note about EmitPhaseTransition,
 * which lands in Phase E).
 */
function formatPhaseDenyReason(args: {
  toolName: string
  phase: Phase
  allow: string[] | '*'
}): string {
  const allowed =
    args.allow === '*'
      ? 'all tools'
      : (args.allow as string[]).join(', ')
  return [
    `Tool '${args.toolName}' is not available in phase '${args.phase}'.`,
    `Current phase allows: ${allowed}.`,
    `To use this tool, complete the current phase's work first and emit a phase transition (EmitPhaseTransition tool lands in Phase E of the in-loop discipline plan).`,
  ].join(' ')
}

function formatBashDenyReason(args: {
  command: string
  phase: Phase
  pattern: string
}): string {
  return [
    `Bash command '${args.command.slice(0, 80)}' is denied in phase '${args.phase}' by pattern ${args.pattern}.`,
    `Read-only Bash (git status, ls, etc.) is permitted; mutating commands (git commit/push, rm, package installs) are not.`,
  ].join(' ')
}

function readBashCommand(
  input: Record<string, unknown> | undefined,
): string | undefined {
  if (!input) return undefined
  const cmd = input.command
  return typeof cmd === 'string' ? cmd : undefined
}

/**
 * Helper for tests: assert the evaluator's contract holds for the given
 * (level, phase, tool) combo. Exported so loopDisciplineHooks.test.ts can
 * reuse the same fixtures the runtime uses.
 */
export function _phaseGateTestProbe(args: {
  level: DisciplineLevel
  phase: Phase
  toolName: string
  toolInput?: Record<string, unknown>
}): GateOutcome {
  return evaluatePhaseGate(
    {
      level: args.level,
      phase: args.phase,
      phaseHistory: [],
      phaseEnteredAt: 1,
      saturationCount: 0,
      saturationProofTurn: null,
      verificationLedger: [],
      tamperGuardEnabled: args.level >= 1,
      consensusRecords: [],
      events: [],
    },
    args.toolName,
    args.toolInput,
  )
}
