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
 * Tools that count as "going outside the model's current context" — when
 * one of these fires after a saturation trip, it satisfies the proof
 * requirement and clears the redirect block. Pulled from the names the
 * Tool dispatcher uses; if names diverge, add aliases here rather than
 * patching every consumer.
 */
export const SATURATION_PROOF_TOOL_NAMES = new Set([
  'WebSearch',
  'WebFetch',
])

/**
 * Tools that count as "verification" — when one of these runs, saturation
 * counter resets even if no mutating tool fired since. The runner of a
 * test is making observable progress (learning whether the work works),
 * which is the opposite of saturation.
 *
 * v1: Bash is treated as verification if the command matches a test
 * runner pattern. Future versions may grow EmitVerification etc.
 */
export const VERIFICATION_BASH_PATTERN =
  /^\s*(bun\s+test|npm\s+(test|run\s+test)|pnpm\s+test|yarn\s+test|jest|vitest|pytest|cargo\s+test|go\s+test|tsc\s+--noEmit|bun\s+run\s+typecheck|npm\s+run\s+typecheck)/

/**
 * How many consecutive saturation-positive iterations before the
 * redirect gate fires. Three matches both the toolFailureLoopGuard
 * default threshold and ralph-mode-enforcer.sh's saturation check —
 * keeps the operator's mental model consistent across the harness.
 */
export const SATURATION_THRESHOLD = 3

/**
 * Per-iteration classification for the saturation tracker. The query
 * loop calls classifyIteration() after tool execution and feeds the
 * result to applySaturationObservation() — keeping the policy here
 * (in the types module) rather than in the loop body itself.
 */
export type IterationKind =
  | 'mutating-without-verification' // Edit/Write/etc. ran, no test
  | 'verification' // a test/typecheck ran
  | 'external-knowledge' // WebSearch/WebFetch ran
  | 'inert' // none of the above

/**
 * Classify a single iteration based on the tools that fired. Used by
 * applySaturationObservation in the loop after tool execution to decide
 * whether to increment, reset, or leave the saturation counter alone.
 */
export function classifyIteration(args: {
  toolNamesUsed: readonly string[]
  bashCommandsUsed: readonly string[]
}): IterationKind {
  for (const name of args.toolNamesUsed) {
    if (SATURATION_PROOF_TOOL_NAMES.has(name)) return 'external-knowledge'
  }
  for (const cmd of args.bashCommandsUsed) {
    if (VERIFICATION_BASH_PATTERN.test(cmd)) return 'verification'
  }
  for (const name of args.toolNamesUsed) {
    if (MUTATING_TOOL_NAMES.has(name)) return 'mutating-without-verification'
  }
  for (const cmd of args.bashCommandsUsed) {
    if (MUTATING_BASH_PATTERN.test(cmd)) return 'mutating-without-verification'
  }
  return 'inert'
}

/**
 * Apply one iteration's classification to the saturation tracker. Returns
 * the next discipline state — pure, no mutation. The query loop assigns
 * the return to state.loopDiscipline.
 *
 * Rules (lessons from OpenHands condenser PR #6795 — explicit reset):
 *  - 'external-knowledge' → saturationCount = 0, saturationProofTurn = turn
 *    (the proof is fresh; future redirects don't fire until a new trip)
 *  - 'verification' → saturationCount = 0 (observable progress)
 *  - 'mutating-without-verification' → saturationCount += 1
 *  - 'inert' → no change
 */
export function applySaturationObservation(args: {
  state: LoopDisciplineState
  kind: IterationKind
  turnCount: number
}): LoopDisciplineState {
  switch (args.kind) {
    case 'external-knowledge':
      return {
        ...args.state,
        saturationCount: 0,
        saturationProofTurn: args.turnCount,
      }
    case 'verification':
      return {
        ...args.state,
        saturationCount: 0,
        saturationProofTurn: null,
      }
    case 'mutating-without-verification':
      return {
        ...args.state,
        saturationCount: args.state.saturationCount + 1,
      }
    case 'inert':
      return args.state
  }
}

/**
 * Apply a phase transition's reset side effect. Called by Phase E's
 * transition handler. Saturation is always specific to the current
 * phase's work; transitioning out of a phase resets it.
 */
export function applyPhaseTransitionReset(
  state: LoopDisciplineState,
): LoopDisciplineState {
  return {
    ...state,
    saturationCount: 0,
    saturationProofTurn: null,
  }
}

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
 * Self-tamper guard's directory-prefix deny list. Phase C consults this
 * after canonicalizing the target path. Storing here so the policy lives
 * next to the rest of the discipline types — a single source of truth that
 * downstream review tooling can inspect.
 *
 * The runtime match is a suffix check: a canonicalized path that ENDS WITH
 * `/<prefix>` blocks. The suffix form intentionally avoids requiring the
 * harness to know its own install root — wherever OpenClaude's source
 * tree lives, `src/query.ts` is `src/query.ts`.
 *
 * Add Phase C's own surface (loopDisciplineHooks.ts) so the gate that
 * guards everything else also guards itself.
 */
export const TAMPER_DENY_PREFIXES: readonly string[] = [
  'src/services/tools/toolHooks.ts',
  'src/services/tools/toolOrchestration.ts',
  'src/services/tools/toolExecution.ts',
  'src/services/tools/loopDisciplineHooks.ts',
  'src/query/toolFailureLoopGuard.ts',
  'src/query/stopHooks.ts',
  'src/types/loopDiscipline.ts',
  'src/types/hooks.ts',
  'src/query.ts',
]

/** Tool names that mutate files — Phase C watches these for tamper. */
export const TAMPER_GUARDED_TOOL_NAMES = new Set([
  'Edit',
  'Write',
  'MultiEdit',
  'NotebookEdit',
])

/**
 * Read tamper-guard state from env. Returns false ONLY when the operator
 * explicitly sets OPENCLAUDE_TAMPER_GUARD=off at process launch — the env
 * read happens once per loop start so an in-loop tool call can't toggle
 * the gate.
 *
 * Default is "on" whenever discipline >= 1, matching the LoopDisciplineState
 * factory at createInitialLoopDisciplineState. Returning false at level 0
 * (legacy/off mode) preserves the no-behavior-change contract.
 */
export function readTamperGuardEnabled(
  level: DisciplineLevel,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (level === 0) return false
  return env.OPENCLAUDE_TAMPER_GUARD !== 'off'
}

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

/**
 * The plan artifact emitted by EmitPlan (Phase E). Stored on
 * LoopDisciplineState so the gate logic can verify a recent plan exists
 * before allowing plan → build transitions, and so the message-builder
 * can prepend the plan verbatim into the next-turn build-phase context.
 *
 * Fields chosen to mirror the schema in ralph-builder.md's
 * plan-then-edit protocol (T8) — the same intent / files / smallest-test
 * triad that Aider's architect+editor split uses but with an explicit
 * verbatim handoff (mitigating Aider Issue #2258 context loss).
 */
export type PendingPlan = {
  intent: string
  files_to_edit: string[]
  smallest_test: string
  emittedAtTurn: number
  emittedAtTimestamp: number
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
  /** Most recent plan emitted by EmitPlan. The plan→build phase gate
   * (Phase E) only allows the transition if pendingPlan was emitted in
   * the current plan-phase window. */
  pendingPlan: PendingPlan | null
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
    pendingPlan: null,
  }
}

/**
 * Record a plan emitted by EmitPlan. Pure transition — caller assigns to
 * state.loopDiscipline. Trims long strings to keep the payload bounded.
 */
export function applyEmitPlan(args: {
  state: LoopDisciplineState
  plan: Omit<PendingPlan, 'emittedAtTurn' | 'emittedAtTimestamp'>
  turnCount: number
  now: number
}): LoopDisciplineState {
  return {
    ...args.state,
    pendingPlan: {
      intent: args.plan.intent.slice(0, 4_000),
      files_to_edit: args.plan.files_to_edit.slice(0, 50),
      smallest_test: args.plan.smallest_test.slice(0, 2_000),
      emittedAtTurn: args.turnCount,
      emittedAtTimestamp: args.now,
    },
  }
}

/**
 * Result of evaluating a phase transition request.
 */
export type PhaseTransitionOutcome =
  | { allowed: true }
  | { allowed: false; reason: string }

/**
 * Phase transition gate. Called by EmitPhaseTransition (lands in a
 * follow-up) to decide whether the requested transition is structurally
 * valid.
 *
 * Rules (Phase E):
 *   - plan → build: requires `pendingPlan` to be non-null AND emitted in
 *     the current plan-phase window (emittedAtTurn >= phaseEnteredAt).
 *     This is the structural enforcement of plan-then-edit. Without a
 *     plan in scope, the model can't escape plan phase, which forces it
 *     to think before editing.
 *   - any → plan: always allowed (model can re-plan).
 *   - any → verify: always allowed.
 *   - verify → build: always allowed.
 *   - refine: always allowed in both directions.
 *   - explore: always allowed.
 *
 * At level 0 the gate is permissive (legacy preservation).
 */
export function evaluatePhaseTransition(
  state: LoopDisciplineState,
  to: Phase,
): PhaseTransitionOutcome {
  if (state.level === 0) return { allowed: true }
  if (state.phase === to) return { allowed: true }

  if (state.phase === 'plan' && to === 'build') {
    if (state.pendingPlan === null) {
      return {
        allowed: false,
        reason:
          'plan → build transition requires a plan. Call EmitPlan with { intent, files_to_edit, smallest_test } first.',
      }
    }
    if (state.pendingPlan.emittedAtTurn < state.phaseEnteredAt) {
      return {
        allowed: false,
        reason:
          'plan → build transition requires a fresh plan emitted in the current plan phase. Call EmitPlan again.',
      }
    }
  }
  return { allowed: true }
}

/**
 * Apply a phase transition. Records the change in history, resets
 * saturation (per Phase D / OpenHands #6795), and updates phaseEnteredAt.
 * Pure — caller assigns to state.loopDiscipline.
 *
 * NB: callers should evaluatePhaseTransition first and refuse on disallowed.
 * This helper does not re-check the gate — it's the apply, not the decide.
 */
export function applyPhaseTransition(args: {
  state: LoopDisciplineState
  to: Phase
  reason: string
  turnCount: number
  now: number
}): LoopDisciplineState {
  const transition: PhaseTransition = {
    from: args.state.phase,
    to: args.to,
    reason: args.reason,
    turnCount: args.turnCount,
    timestamp: args.now,
  }
  return {
    ...applyPhaseTransitionReset(args.state),
    phase: args.to,
    phaseHistory: [...args.state.phaseHistory, transition],
    phaseEnteredAt: args.turnCount,
  }
}

/**
 * Build the verbatim plan handoff for the next-turn build-phase context.
 * The plan payload is reproduced exactly as emitted — NOT summarized —
 * to mitigate Aider Issue #2258 (architect/editor context-loss tax). If
 * pendingPlan is null this returns null and callers should skip the
 * injection.
 */
export function buildPlanHandoffMessage(
  state: LoopDisciplineState,
): string | null {
  if (state.pendingPlan === null) return null
  const p = state.pendingPlan
  return [
    '<plan-handoff>',
    `Plan emitted at turn ${p.emittedAtTurn}, you are now in build phase.`,
    '',
    'Intent:',
    p.intent,
    '',
    'Files to edit (in order):',
    ...p.files_to_edit.map(f => `  - ${f}`),
    '',
    'Smallest test that proves the change works:',
    p.smallest_test,
    '',
    'Build the plan above. Edit the listed files. After edits, run the smallest test. Do not expand scope beyond this plan — if you discover the plan was wrong, transition back to plan phase and emit a new one.',
    '</plan-handoff>',
  ].join('\n')
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
