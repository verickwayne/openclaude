// Loop-discipline primitives — types only.
//
// Compensations land across Phase A-G of
// docs/plans/20260606224012_in-loop-discipline.md. Phase A (this file +
// State extension in query.ts) is no-behavior-change: the fields exist and
// can be observed, but no gates enforce until OPENCLAUDE_IN_LOOP_DISCIPLINE
// is set to 1 (advisory) or 2 (enforced) and the per-pattern hooks land.

/** Lifecycle phase for the agent loop. */
export type Phase = 'explore' | 'plan' | 'build' | 'verify' | 'refine'

/** One row in the audit log of phase changes. */
export type PhaseTransition = {
  from: Phase
  to: Phase
  reason: string
  turnCount: number
  timestamp: number
}

/**
 * Provenance-tagged claim. The `source` discriminator is the load-bearing
 * field — `'agent'` entries never satisfy a verification requirement that
 * demands `'tool'` or `'hook'`. This is the runtime mechanism that closes
 * the 2026-05-14 ACORD-blank-PDF failure mode (model claimed "verified"
 * off a proxy field-value check; rendered output was blank).
 */
export type VerificationEntry = {
  claim: string
  source: 'agent' | 'tool' | 'hook' | 'human'
  toolName?: string
  evidence?: string
  turnCount: number
  timestamp: number
}

/** Enforcement level for the in-loop discipline system. */
export type DisciplineLevel = 0 | 1 | 2

/** Per-phase tool restriction policy. */
export type ToolPolicy = {
  /** Tool names allowed in this phase. `'*'` means full surface. */
  allow: string[] | '*'
  /** Optional Bash command-pattern denials applied even when allow='*'. */
  bashDenyPatterns?: RegExp[]
}

/**
 * Phase → tool policy lookup. Build is intentionally unrestricted so the
 * default new-session phase preserves legacy behavior (see Phase A
 * initialization: `phase: 'build'`).
 *
 * Bash:read-only and Bash:test are matched at the dispatcher level via
 * bashDenyPatterns — `git status` is fine in plan, `git commit` is denied.
 */
export const PHASE_TOOL_ALLOWLIST: Record<Phase, ToolPolicy> = {
  explore: {
    allow: ['Read', 'Grep', 'Glob', 'WebSearch', 'WebFetch', 'Bash'],
    bashDenyPatterns: [
      /^\s*git\s+(commit|push|add|rm|reset|checkout\s+--|stash\s+drop|branch\s+-D)/,
      /^\s*(rm|mv|cp)\s/,
      /^\s*npm\s+(install|publish)/,
      /^\s*bun\s+(install|add|remove|publish)/,
    ],
  },
  plan: {
    allow: ['Read', 'Grep', 'Glob', 'WebSearch', 'WebFetch', 'Bash', 'EmitPlan'],
    bashDenyPatterns: [
      /^\s*git\s+(commit|push|add|rm|reset|checkout\s+--|stash\s+drop|branch\s+-D)/,
      /^\s*(rm|mv|cp)\s/,
      /^\s*npm\s+(install|publish)/,
      /^\s*bun\s+(install|add|remove|publish)/,
    ],
  },
  build: {
    allow: '*',
  },
  verify: {
    allow: ['Read', 'Grep', 'Glob', 'Bash', 'EmitVerification'],
    bashDenyPatterns: [
      /^\s*git\s+(commit|push|reset)/,
      /^\s*(rm|mv|cp)\s/,
    ],
  },
  refine: {
    allow: ['Edit', 'MultiEdit', 'Read', 'Grep', 'Bash'],
  },
}

/**
 * Phase-keyed default loop start. Querysessions begin in `'build'` to keep
 * legacy users unaffected when OPENCLAUDE_IN_LOOP_DISCIPLINE is 0.
 */
export const DEFAULT_INITIAL_PHASE: Phase = 'build'

/** One row of the per-turn observability stream. */
export type DisciplineEvent =
  | {
      kind: 'phase-transition'
      turnCount: number
      from: Phase
      to: Phase
      reason: string
      timestamp: number
    }
  | {
      kind: 'gate-blocked'
      turnCount: number
      phase: Phase
      gate:
        | 'phase-restriction'
        | 'self-tamper'
        | 'saturation-redirect'
        | 'verification-required'
      toolName: string
      reason: string
      timestamp: number
    }
  | {
      kind: 'saturation-trip'
      turnCount: number
      phase: Phase
      consecutiveNoProgress: number
      timestamp: number
    }
  | {
      kind: 'saturation-reset'
      turnCount: number
      phase: Phase
      trigger: string
      timestamp: number
    }
  | {
      kind: 'verification-write'
      turnCount: number
      phase: Phase
      entry: VerificationEntry
      timestamp: number
    }
  | {
      kind: 'tamper-block'
      turnCount: number
      phase: Phase
      targetPath: string
      reason: string
      timestamp: number
    }

/** Tools and bash patterns considered "mutating" for saturation tracking. */
export const MUTATING_TOOL_NAMES = new Set([
  'Edit',
  'Write',
  'MultiEdit',
  'NotebookEdit',
])

export const MUTATING_BASH_PATTERN =
  /^\s*(rm|mv|cp|git\s+commit|git\s+push|git\s+reset|npm\s+install|bun\s+install)/

/**
 * Read the enforcement level from the environment. Defaults to 0 (observe
 * only) so existing OpenClaude installs are unaffected until the operator
 * explicitly opts in.
 */
export function readDisciplineLevel(
  env: NodeJS.ProcessEnv = process.env,
): DisciplineLevel {
  const raw = env.OPENCLAUDE_IN_LOOP_DISCIPLINE
  if (raw === '1') return 1
  if (raw === '2') return 2
  return 0
}

/**
 * Self-tamper guard's directory-prefix deny list. Phase C will consult this
 * after canonicalizing the target path. Storing here so the policy lives
 * next to the rest of the discipline types — a single source of truth that
 * downstream review tooling can inspect.
 */
export const TAMPER_DENY_PREFIXES: readonly string[] = [
  'src/services/tools/toolHooks.ts',
  'src/services/tools/toolOrchestration.ts',
  'src/services/tools/toolExecution.ts',
  'src/query/toolFailureLoopGuard.ts',
  'src/query/stopHooks.ts',
  'src/types/loopDiscipline.ts',
  'src/types/hooks.ts',
  'src/query.ts',
]

/**
 * Forward-compatibility note. Pattern #6 (multi-call consensus on
 * high-stakes outputs) is documented in the v1 plan as deferred. The type
 * shape below is reserved so that future hooks can populate consensus
 * fields without breaking the State contract.
 */
export type ConsensusRecord = {
  topic: string
  votes: { agentId: string; value: string; confidence: number }[]
  decision: string
  unanimity: boolean
  turnCount: number
  timestamp: number
}

/** Per-loop loop-discipline bag held on State. */
export type LoopDisciplineState = {
  level: DisciplineLevel
  phase: Phase
  phaseHistory: PhaseTransition[]
  phaseEnteredAt: number
  saturationCount: number
  saturationProofTurn: number | null
  verificationLedger: VerificationEntry[]
  /** Reserved for Phase A → C wiring. */
  tamperGuardEnabled: boolean
  /** Reserved for Pattern #6 (deferred). */
  consensusRecords: ConsensusRecord[]
  /** Per-turn observability stream. Phase G promotes selected events to
   * AppState for the reactive TUI; until then they live here and are
   * available via getDisciplineEvents() for diagnostic dumps. */
  events: DisciplineEvent[]
}

/** Initial-state factory used by query.ts. */
export function createInitialLoopDisciplineState(
  level: DisciplineLevel,
  initialPhase: Phase = DEFAULT_INITIAL_PHASE,
): LoopDisciplineState {
  return {
    level,
    phase: initialPhase,
    phaseHistory: [],
    phaseEnteredAt: 1,
    saturationCount: 0,
    saturationProofTurn: null,
    verificationLedger: [],
    tamperGuardEnabled: level >= 1,
    consensusRecords: [],
    events: [],
  }
}

/**
 * Read the current per-turn observability stream. Diagnostic helper —
 * tests and the (Phase G) --debug-discipline CLI flag consume this.
 */
export function getDisciplineEvents(
  s: LoopDisciplineState,
): readonly DisciplineEvent[] {
  return s.events
}

/**
 * Read the initial phase from the environment. Defaults to
 * DEFAULT_INITIAL_PHASE ('build') to preserve legacy behavior. Accepted
 * values are the literal phase names; anything else falls back silently
 * (we treat operator typos as "they meant build").
 */
export function readInitialPhase(
  env: NodeJS.ProcessEnv = process.env,
): Phase {
  const raw = env.OPENCLAUDE_INITIAL_PHASE
  if (
    raw === 'explore' ||
    raw === 'plan' ||
    raw === 'build' ||
    raw === 'verify' ||
    raw === 'refine'
  ) {
    return raw
  }
  return DEFAULT_INITIAL_PHASE
}
