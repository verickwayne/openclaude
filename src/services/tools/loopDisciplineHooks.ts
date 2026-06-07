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

import * as path from 'node:path'
import {
  type DisciplineLevel,
  type LoopDisciplineState,
  type Phase,
  PHASE_TOOL_ALLOWLIST,
  TAMPER_DENY_PREFIXES,
  TAMPER_GUARDED_TOOL_NAMES,
} from '../../types/loopDiscipline.js'

export type GateOutcome =
  | { ok: true }
  | {
      ok: false
      reason: string
      gate: 'phase-restriction' | 'self-tamper'
    }

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
 * Self-tamper guard. Blocks Edit/Write/MultiEdit/NotebookEdit on paths
 * that resolve into OpenClaude's own enforcement code. The gate runs
 * AFTER evaluatePhaseGate so a phase-mismatch deny isn't masked by a
 * tamper-block when both apply.
 *
 * Match strategy: normalize the input path with path.resolve() (handles
 * `../` traversal and absolute-vs-relative), then check if the resulting
 * path ENDS WITH `/<deny-prefix>`. The suffix form avoids needing to
 * know OpenClaude's install root at runtime.
 *
 * Bypass: only via OPENCLAUDE_TAMPER_GUARD=off set at process launch —
 * caller passes the result of readTamperGuardEnabled() into `enabled`.
 * In-loop tool calls cannot toggle this because the env read happens
 * once at queryLoop entry, not per-tool.
 */
export function evaluateSelfTamperGuard(
  state: LoopDisciplineState | undefined,
  toolName: string,
  toolInput: Record<string, unknown> | undefined,
  enabled: boolean,
): GateOutcome {
  if (!enabled) return { ok: true }
  if (!state) return { ok: true }
  if (state.level === 0) return { ok: true }
  if (!TAMPER_GUARDED_TOOL_NAMES.has(toolName)) return { ok: true }

  const target = readEditTargetPath(toolInput)
  if (!target) return { ok: true }

  const normalized = path.resolve(target)

  for (const prefix of TAMPER_DENY_PREFIXES) {
    // Suffix match with a leading slash so `src/query.ts` doesn't match
    // `extras/src/query.ts.bak` accidentally. Tail boundary is the path
    // separator; we accept either no further chars (file is the exact
    // target) or a trailing dot (e.g., .ts vs .tsx case) — but since the
    // prefix already includes the extension, an exact-match endsWith is
    // sufficient.
    if (
      normalized.endsWith('/' + prefix) ||
      normalized.endsWith(path.sep + prefix.replace(/\//g, path.sep))
    ) {
      if (state.level === 1) return { ok: true }
      return {
        ok: false,
        gate: 'self-tamper',
        reason: formatTamperDenyReason({
          target: normalized,
          prefix,
          toolName,
        }),
      }
    }
  }

  return { ok: true }
}

function readEditTargetPath(
  input: Record<string, unknown> | undefined,
): string | undefined {
  if (!input) return undefined
  for (const key of ['file_path', 'notebook_path', 'path']) {
    const raw = input[key]
    if (typeof raw === 'string' && raw.length > 0) return raw
  }
  return undefined
}

function formatTamperDenyReason(args: {
  target: string
  prefix: string
  toolName: string
}): string {
  return [
    `Tool '${args.toolName}' attempted to modify '${args.target}'.`,
    `That path is loop-discipline enforcement code (matched suffix '${args.prefix}') and cannot be edited from inside the loop.`,
    `If you need to change this file, exit the loop and edit it directly. To bypass for one process, set OPENCLAUDE_TAMPER_GUARD=off in the parent shell before launching — it cannot be toggled mid-loop.`,
  ].join(' ')
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

/** Test probe for the tamper guard. */
export function _tamperGuardTestProbe(args: {
  level: DisciplineLevel
  phase?: Phase
  toolName: string
  toolInput?: Record<string, unknown>
  enabled?: boolean
}): GateOutcome {
  return evaluateSelfTamperGuard(
    {
      level: args.level,
      phase: args.phase ?? 'build',
      phaseHistory: [],
      phaseEnteredAt: 1,
      saturationCount: 0,
      saturationProofTurn: null,
      verificationLedger: [],
      tamperGuardEnabled: args.enabled ?? args.level >= 1,
      consensusRecords: [],
      events: [],
    },
    args.toolName,
    args.toolInput,
    args.enabled ?? args.level >= 1,
  )
}
