// Loop-discipline primitives — types only.
//
// Compensations land across Phase A-G of
// docs/plans/20260606224012_in-loop-discipline.md. Phase A (this file +
// State extension in query.ts) is no-behavior-change: the fields exist and
// can be observed, but no gates enforce until OPENCLAUDE_IN_LOOP_DISCIPLINE
// is set to 1 (advisory) or 2 (enforced) and the per-pattern hooks land.

/**
 * Lifecycle phase for the agent loop.
 *
 * - explore: read the codebase, no edits. For "what does this codebase do" work.
 * - research: external knowledge gathering via WebSearch / WebFetch. No code
 *   reads, no edits — biased toward learning from outside the repo.
 * - plan: prepare a plan via EmitPlan; no edits. plan → build is gated on
 *   the plan having been emitted in the current plan-phase window.
 * - build: full tool surface. Default phase for new sessions.
 * - verify: read + bash tests + EmitVerification. Produces non-agent
 *   ledger entries that satisfy the completion exit gate.
 * - refine: edit + read + test. Polish pass without new feature work.
 */
export type Phase = 'explore' | 'research' | 'plan' | 'build' | 'verify' | 'refine'

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
  research: {
    // No Bash, no edits. Focus is external knowledge gathering — the
    // model is in this phase precisely because in-repo information was
    // insufficient. Read+Grep are allowed so the model can ground web
    // findings against current code, but bash is off the table.
    // EmitPhaseTransition is implicitly allowed (handled by the tool
    // dispatcher, not the per-phase allowlist — every phase needs the
    // transition tool to be reachable).
    allow: ['WebSearch', 'WebFetch', 'Read', 'Grep', 'Glob'],
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
  /** Optional context written into the ledger entry on verification turns
   * (Phase F). Lets the query loop pass through the actual bash command
   * that ran so the audit trail isn't generic. */
  verificationEvidence?: string
  /** Optional timestamp; defaults to 0 if omitted (tests pass numbers). */
  now?: number
}): LoopDisciplineState {
  const now = args.now ?? 0
  switch (args.kind) {
    case 'external-knowledge': {
      const next = {
        ...args.state,
        saturationCount: 0,
        saturationProofTurn: args.turnCount,
      }
      return recordDisciplineEvent(next, {
        kind: 'saturation-reset',
        turnCount: args.turnCount,
        phase: next.phase,
        trigger: 'external-knowledge',
        timestamp: now,
      })
    }
    case 'verification': {
      // Phase F: automatically record a source='tool' ledger entry so
      // the completion gate has evidence without needing the model to
      // call EmitVerification manually. The actual test runner ran and
      // its exit code is the proof — that's what the entry attests to.
      const intermediate = {
        ...args.state,
        saturationCount: 0,
        saturationProofTurn: null,
      }
      const withReset = recordDisciplineEvent(intermediate, {
        kind: 'saturation-reset',
        turnCount: args.turnCount,
        phase: intermediate.phase,
        trigger: 'verification',
        timestamp: now,
      })
      return applyVerificationEntry({
        state: withReset,
        entry: {
          claim:
            args.verificationEvidence ??
            'verification-pattern bash command ran',
          source: 'tool',
          toolName: 'Bash',
          evidence: args.verificationEvidence,
        },
        turnCount: args.turnCount,
        now,
      })
    }
    case 'mutating-without-verification': {
      const nextCount = args.state.saturationCount + 1
      const justCrossedThreshold =
        args.state.saturationCount < SATURATION_THRESHOLD &&
        nextCount >= SATURATION_THRESHOLD
      const next = {
        ...args.state,
        saturationCount: nextCount,
        // Phase E4: every time saturation arms in the current task,
        // bump the trips counter. query.ts reads this to decide
        // whether to force a plan-phase transition.
        saturationTripsThisTask: justCrossedThreshold
          ? args.state.saturationTripsThisTask + 1
          : args.state.saturationTripsThisTask,
      }
      // Emit saturation-trip event when crossing the threshold so the
      // observability stream shows exactly when the redirect arms.
      if (justCrossedThreshold) {
        return recordDisciplineEvent(next, {
          kind: 'saturation-trip',
          turnCount: args.turnCount,
          phase: next.phase,
          consecutiveNoProgress: nextCount,
          timestamp: now,
        })
      }
      return next
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
    saturationTripsThisTask: 0,
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
  /** How many times saturation has tripped since the last phase
   * transition. When this reaches 2 at level >= 2, query.ts forces
   * phase=plan to make the model re-think the approach. Pattern from
   * docs/plans/20260606224012_in-loop-discipline.md Phase E
   * "escalation: when toolFailureLoopGuard trips or saturation redirect
   * fires for the second time in a single task, the loop forces
   * transition to plan phase." Phase D handles the first trip via the
   * WebSearch redirect; this counter is the escalation lever for the
   * second. */
  saturationTripsThisTask: number
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
    saturationTripsThisTask: 0,
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
  const next = {
    ...applyPhaseTransitionReset(args.state),
    phase: args.to,
    phaseHistory: [...args.state.phaseHistory, transition],
    phaseEnteredAt: args.turnCount,
  }
  return recordDisciplineEvent(next, {
    kind: 'phase-transition',
    turnCount: args.turnCount,
    from: args.state.phase,
    to: args.to,
    reason: args.reason,
    timestamp: args.now,
  })
}

/**
 * Append a VerificationEntry to the ledger. Pure transition. Caller
 * assigns to state.loopDiscipline.
 *
 * Caps the ledger at 200 entries — older entries fall off the front.
 * Ledger entries are not the source of truth for what was verified
 * (the artifact itself is), they're an audit trail the loop uses to
 * gate exit. 200 is plenty for any reasonable task.
 */
export function applyVerificationEntry(args: {
  state: LoopDisciplineState
  entry: Omit<VerificationEntry, 'turnCount' | 'timestamp'>
  turnCount: number
  now: number
}): LoopDisciplineState {
  const entry: VerificationEntry = {
    ...args.entry,
    turnCount: args.turnCount,
    timestamp: args.now,
  }
  const next = [...args.state.verificationLedger, entry]
  const trimmed = next.length > 200 ? next.slice(next.length - 200) : next
  const withLedger = { ...args.state, verificationLedger: trimmed }
  return recordDisciplineEvent(withLedger, {
    kind: 'verification-write',
    turnCount: args.turnCount,
    phase: withLedger.phase,
    entry,
    timestamp: args.now,
  })
}

/**
 * Count ledger entries by source. Used by the completion gate to decide
 * whether any non-agent evidence exists.
 *
 * `source: 'agent'` entries are claims the model made about its own work
 * — those NEVER count as verification. Only tool / hook / human entries
 * satisfy the gate. This is the runtime mechanism that closes the
 * 2026-05-14 ACORD-blank-PDF failure shape: the model could write
 * `source: 'agent'` ledger entries claiming "rendered output verified"
 * all day and the loop would still refuse to exit.
 */
export function countLedgerEntriesBySource(
  state: LoopDisciplineState,
): Record<VerificationEntry['source'], number> {
  const counts: Record<VerificationEntry['source'], number> = {
    agent: 0,
    tool: 0,
    hook: 0,
    human: 0,
  }
  for (const e of state.verificationLedger) {
    counts[e.source] += 1
  }
  return counts
}

/**
 * Result of the completion exit gate.
 */
export type CompletionExitOutcome =
  | { allowed: true; reason: 'completed_with_verification' | 'completed_no_artifacts' | 'completed_legacy' }
  | { allowed: false; reason: string; nudge: string }

/**
 * Completion exit gate (Phase F). Called from query.ts at the point
 * where the loop would otherwise return `reason: 'completed'`. At level
 * 0 / 1 it's permissive. At level 2 it refuses exit when the loop did
 * mutating work without any tool / hook / human verification entries —
 * a model "I'm done" claim by itself is not sufficient evidence.
 *
 * Three exit reasons:
 *   - completed_with_verification — ledger has non-agent entries.
 *   - completed_no_artifacts — no mutations happened (pure Q&A turn).
 *   - completed_legacy — discipline disabled.
 *
 * One refuse case:
 *   - requires_verification — mutations happened but no non-agent entry.
 *
 * Pessimism (OpenHands Issue #9154 — non-model-controlled fields need
 * their own liveness check): the gate's input is the ledger AND the
 * history of saturation observations. If the loop ran mutating
 * iterations but the verificationLedger has no tool entries at all by
 * exit time, that's either an honest "no verification yet" state OR a
 * sign that the writer-hook isn't firing. The gate refuses in either
 * case — fail closed.
 */
export function evaluateCompletionExit(
  state: LoopDisciplineState,
  hadMutationsThisLoop: boolean,
): CompletionExitOutcome {
  if (state.level === 0) {
    return { allowed: true, reason: 'completed_legacy' }
  }
  if (!hadMutationsThisLoop) {
    return { allowed: true, reason: 'completed_no_artifacts' }
  }
  const counts = countLedgerEntriesBySource(state)
  const nonAgent = counts.tool + counts.hook + counts.human
  if (nonAgent > 0) {
    return { allowed: true, reason: 'completed_with_verification' }
  }
  if (state.level === 1) {
    // Advisory: allow but tag.
    return { allowed: true, reason: 'completed_with_verification' }
  }
  const agentClaimCount = counts.agent
  // Surface what claims exist in the ledger so the model can reason
  // about what's missing rather than re-stating its existing
  // self-assertions. The body intentionally does NOT suggest
  // EmitVerification as a gate-unlock — that tool writes
  // source='agent' regardless of input, so it can't satisfy the gate.
  // It's audit-only.
  const claimSummary =
    agentClaimCount > 0
      ? ` You have ${agentClaimCount} agent-source claim${agentClaimCount === 1 ? '' : 's'} in the ledger, but agent claims do not satisfy this gate — they are records of what you believe, not evidence that something is true.`
      : ''

  return {
    allowed: false,
    reason: 'requires_verification',
    nudge: [
      'COMPLETION EXIT BLOCKED: this loop performed mutating work',
      `(saturationCount peak: ${state.saturationCount}) but the verification`,
      'ledger contains no tool / hook / human entries.' + claimSummary,
      'To unlock exit, produce evidence from a DIFFERENT path than the',
      'one that wrote the artifact: run a test via Bash (bun test /',
      'pytest / etc. — this auto-records a source=\'tool\' ledger entry),',
      'render the produced artifact with a different tool than the one',
      'that wrote it, or have a human review and mark it verified.',
      'EmitVerification records your reasoning but does NOT satisfy the',
      'gate.',
    ].join(' '),
  }
}

/**
 * How many trips before forcing phase=plan. Two means: the model went
 * into saturation, did a WebSearch redirect (resetting count via Phase D
 * external-knowledge path), then saturated AGAIN before producing
 * verifiable progress. At that point WebSearch alone isn't helping;
 * stop, plan, restart.
 */
export const FORCED_PLAN_TRIPS_THRESHOLD = 2

/**
 * Decide whether the query loop should force a plan-phase transition
 * after this iteration's observation. Phase E4: the structural lever
 * that makes Phase E's plan-then-edit actually fire — without this,
 * plan→build only happens when the model voluntarily transitions.
 *
 * Returns `{force: true, reason}` only when:
 *   - level >= 2 (advisory + observe modes skip)
 *   - saturationTripsThisTask >= FORCED_PLAN_TRIPS_THRESHOLD
 *   - current phase isn't already 'plan' (no re-forcing)
 *   - we're not already executing a pendingPlan (model is mid-execution
 *     of a plan it just emitted — let it finish)
 */
export type ForcedPlanOutcome =
  | { force: false }
  | { force: true; reason: string }

export function evaluateForcedPlan(
  state: LoopDisciplineState,
): ForcedPlanOutcome {
  if (state.level < 2) return { force: false }
  if (state.phase === 'plan') return { force: false }
  if (state.saturationTripsThisTask < FORCED_PLAN_TRIPS_THRESHOLD) {
    return { force: false }
  }
  // If we have a fresh pendingPlan from this phase, the model is
  // executing a plan — don't yank it back. The completion gate or
  // saturation redirect will handle any failure to make progress.
  if (
    state.pendingPlan !== null &&
    state.pendingPlan.emittedAtTurn >= state.phaseEnteredAt
  ) {
    return { force: false }
  }
  return {
    force: true,
    reason: `${state.saturationTripsThisTask} saturation trips in current task — forcing phase=plan so the model re-thinks the approach.`,
  }
}

/**
 * Did mutating work happen this loop? Used by evaluateCompletionExit to
 * decide whether the verification gate fires. Definition: phaseHistory
 * mentions a non-explore phase OR ledger has any entry OR saturation
 * counter ever incremented.
 *
 * Conservative — if there's any chance work happened, return true. The
 * gate refuses on uncertainty.
 */
export function hadMutationsThisLoop(state: LoopDisciplineState): boolean {
  if (state.verificationLedger.length > 0) return true
  if (state.saturationCount > 0) return true
  // phaseHistory tracks transitions; if anything other than the initial
  // phase was visited, mutations are possible.
  for (const t of state.phaseHistory) {
    if (t.to === 'build' || t.to === 'refine' || t.to === 'verify') {
      return true
    }
  }
  return false
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
 * tests and the --debug-discipline CLI flag consume this.
 */
export function getDisciplineEvents(
  s: LoopDisciplineState,
): readonly DisciplineEvent[] {
  return s.events
}

/**
 * Append an event to the per-loop observability stream. Caps at 1000
 * events — older events fall off. The cap is generous because events
 * are small (mostly bools, ints, short strings) and the stream is
 * inspected by humans during debugging, not stored forever.
 */
export function recordDisciplineEvent(
  state: LoopDisciplineState,
  event: DisciplineEvent,
): LoopDisciplineState {
  const next = [...state.events, event]
  const trimmed = next.length > 1000 ? next.slice(next.length - 1000) : next
  return { ...state, events: trimmed }
}

/**
 * Format a DisciplineEvent for stderr streaming. Single-line, prefixed
 * with `discipline:` so log aggregation can grep it easily.
 *
 * Format chosen to match the conventions in
 * ~/.claude/scripts/ralph-mode-enforcer.sh log output — turn:phase →
 * event-kind details. Keeps mental model consistent between the bolt-on
 * ralph harness and the native OpenClaude discipline.
 */
export function formatDisciplineEvent(e: DisciplineEvent): string {
  switch (e.kind) {
    case 'phase-transition':
      return `discipline: t${e.turnCount} phase-transition ${e.from}→${e.to} (${e.reason})`
    case 'gate-blocked':
      return `discipline: t${e.turnCount} ${e.phase} gate-blocked tool=${e.toolName} gate=${e.gate} reason="${e.reason}"`
    case 'saturation-trip':
      return `discipline: t${e.turnCount} ${e.phase} saturation-trip count=${e.consecutiveNoProgress}`
    case 'saturation-reset':
      return `discipline: t${e.turnCount} ${e.phase} saturation-reset trigger=${e.trigger}`
    case 'verification-write':
      return `discipline: t${e.turnCount} ${e.phase} verification-write source=${e.entry.source} tool=${e.entry.toolName ?? 'none'} claim="${e.entry.claim.slice(0, 80)}"`
    case 'tamper-block':
      return `discipline: t${e.turnCount} ${e.phase} tamper-block path=${e.targetPath} reason="${e.reason}"`
  }
}

/**
 * Read the --debug-discipline flag state from env. The CLI plumbing
 * sets OPENCLAUDE_DEBUG_DISCIPLINE=1 when the flag is present. Env-var
 * fallback so the discipline observability can be enabled outside the
 * full CLI flag pipeline (e.g. SDK consumers).
 */
export function isDisciplineDebugEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return env.OPENCLAUDE_DEBUG_DISCIPLINE === '1'
}

/**
 * Write a single event to stderr in --debug-discipline format. The
 * decision to actually emit lives at the caller — this helper just
 * does formatting + write. Caller checks isDisciplineDebugEnabled or
 * the equivalent CLI flag state.
 */
export function emitDisciplineEventToStderr(
  event: DisciplineEvent,
  stderr: { write: (s: string) => unknown } = process.stderr,
): void {
  stderr.write(formatDisciplineEvent(event) + '\n')
}

/**
 * Read the path of the JSONL event log from env. When set, the query
 * loop appends each newly-recorded DisciplineEvent as a JSON line to
 * that file. Surfaces the event stream as a queryable post-session
 * artifact (jq, datasette, etc.) — complements the live stderr stream.
 * Returns null when the env var isn't set, indicating "don't log."
 */
export function readDisciplineEventLogPath(
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const raw = env.OPENCLAUDE_DISCIPLINE_EVENT_LOG
  if (typeof raw !== 'string') return null
  const trimmed = raw.trim()
  return trimmed.length > 0 ? trimmed : null
}

/**
 * Append a single event to the JSONL event log. The line shape is the
 * event object stringified verbatim — no projection, no field rename.
 * Future log consumers can rely on the field set matching the
 * DisciplineEvent TypeScript shape exactly.
 *
 * Writes are best-effort; any I/O error is swallowed and logged once to
 * stderr to avoid spamming. Worst case: the operator loses some
 * observability rows but the loop continues unaffected — same fail-soft
 * contract as the stderr stream.
 */
export function appendDisciplineEventToFile(
  event: DisciplineEvent,
  path: string,
  fileSystem: {
    appendFileSync: (path: string, data: string) => void
  } = {
    // Lazy require to avoid pulling node:fs into bundles where it isn't
    // available. The default branch in production resolves to fs.
    appendFileSync(p: string, d: string): void {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const fs = require('node:fs') as typeof import('node:fs')
      fs.appendFileSync(p, d)
    },
  },
): { ok: true } | { ok: false; error: string } {
  try {
    fileSystem.appendFileSync(path, JSON.stringify(event) + '\n')
    return { ok: true }
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

/**
 * How many turns may pass without a non-agent ledger write before the
 * liveness check fires its warning. Picked at 10 because shorter values
 * produce noise for legitimate read-heavy loops; longer values let
 * silent-failure modes (the OpenHands Issue #9154 shape) accumulate
 * before surfacing.
 */
export const VERIFICATION_LIVENESS_WINDOW = 10

/**
 * Liveness check (Phase F2 — OpenHands Issue #9154 mitigation).
 *
 * At level >= 2, if mutating work has been happening in this loop but no
 * non-agent ledger write has occurred in the last
 * VERIFICATION_LIVENESS_WINDOW turns, return a warning string. The
 * scenario: the auto-ledger writer (Phase F's applySaturationObservation
 * verification branch) or any future hook-based ledger writer is silently
 * not firing, so the completion gate looks "armed" but isn't actually
 * receiving evidence.
 *
 * Returns null when no warning should fire. Returns the warning string
 * (already prefixed with the discipline: token) when it should. Caller
 * writes to stderr; this helper has no side effects.
 */
export function evaluateVerificationLiveness(args: {
  state: LoopDisciplineState
  turnCount: number
}): string | null {
  if (args.state.level < 2) return null
  if (!hadMutationsThisLoop(args.state)) return null

  // Find the most recent non-agent ledger entry.
  let lastNonAgentTurn: number | null = null
  for (let i = args.state.verificationLedger.length - 1; i >= 0; i--) {
    const e = args.state.verificationLedger[i]
    if (e.source !== 'agent') {
      lastNonAgentTurn = e.turnCount
      break
    }
  }

  if (lastNonAgentTurn === null) {
    // Never received non-agent evidence. The window starts from when
    // discipline armed (phaseEnteredAt of the initial phase, ~ turn 1).
    if (args.turnCount - args.state.phaseEnteredAt >= VERIFICATION_LIVENESS_WINDOW) {
      return [
        'discipline: WARN verification-liveness — level=2 has run',
        `${args.turnCount - args.state.phaseEnteredAt} turns with mutations`,
        'but ZERO non-agent ledger writes. If the auto-ledger writer is',
        'wired but not firing, the completion gate will refuse exit. Likely',
        'causes: classifyIteration returns inert for your verification',
        'pattern (extend VERIFICATION_BASH_PATTERN), or no Bash test',
        'commands have run.',
      ].join(' ')
    }
    return null
  }

  if (args.turnCount - lastNonAgentTurn >= VERIFICATION_LIVENESS_WINDOW) {
    return [
      `discipline: WARN verification-liveness — ${args.turnCount - lastNonAgentTurn}`,
      'turns since the last non-agent ledger write. The completion gate',
      'will refuse exit if the auto-ledger writer is silently failing.',
    ].join(' ')
  }

  return null
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
    raw === 'research' ||
    raw === 'plan' ||
    raw === 'build' ||
    raw === 'verify' ||
    raw === 'refine'
  ) {
    return raw
  }
  return DEFAULT_INITIAL_PHASE
}
