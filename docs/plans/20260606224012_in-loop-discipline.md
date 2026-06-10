# In-Loop Discipline — Hardcoding Harness-Engineering Principles into the Limitless Agent Loop

**Status:** Draft for review
**Author:** Claude Opus 4.7 (drafted with Verick)
**Date created:** 2026-06-06
**Target codebase:** `~/Projects/openclaude` (TS, Bun, Claude Code fork)
**Related conversation:** `/Users/verickwayne/Projects/tenet/docs/harness-engineering-conversation-slice.md` (2026-05-14)
**Template:** Comprehensive (architectural change, multi-phase, cross-cutting)

---

## 1. Motivation

On 2026-05-14, after the ACORD-blank-PDF incident (verified the dict-value proxy instead of the rendered appearance stream and shipped blank forms to an underwriter), I named the failure mode as: **forward-motion-over-verification, declarative-knowledge-failing-to-fire-procedurally, proxy-checks-passing-as-real-checks, in-session-introspection-being-unreliable.** I concluded that the bias lives in model weights (Opus 4.7), is reinforced by RLHF, and the only structural fix is compensating in the harness — declarative principles in CLAUDE.md don't fire procedurally at decision points.

Ralph compensates for these biases via **PreToolUse hooks and subagent contracts wrapping Claude Code from outside**. The Claude Code harness itself is unchanged. Ralph's compensations work, but they're bolted on — anyone running Claude Code without ralph gets none of them.

The goal of this plan: take the ralph compensations and **make them native behavior of the Limitless agent loop.** Not opt-in hooks. Not a "ralph mode" to enable. The loop's `decide-next-action` step intrinsically knows about phases, structured returns, saturation redirect, plan-then-edit, and anti-self-tamper.

This is the change Limitless exists to enable — we own the fork, we can modify the loop.

---

## 2. The six patterns

From the 2026-06-06 research synthesis (Cline, OpenHands, Roo Code, Aider, smolagents, LangGraph, Maestro/Ruflo):

| # | Pattern | Compensates for | Public state |
|---|---|---|---|
| 1 | **Phase-restricted tool surface** | Forward-motion-over-planning | Cline + Roo have it; we crib |
| 2 | **Structured returns with typed-source verification** | Proxy-check-passes-as-real-check | OpenHands has the mechanic + a known liveness bug; Maestro has the type design; we combine |
| 3 | **Saturation redirect (forced next-action)** | Loop grinds without progress | **Unfilled industry-wide.** Ralph's pattern. Our publishable contribution. |
| 4 | **Plan-then-edit as native phases** | Forward-motion-over-planning (deeper) | Aider has it at prompt level with a known regression; we do it as loop state |
| 5 | **Anti-self-tamper** | Model edits its own enforcement | **Unfilled industry-wide.** Our publishable contribution. |
| 6 | **Multi-call consensus on high-stakes outputs** | Single-call-bias on judgment artifacts | Maestro's type design; expensive; defer to v2 |

We implement 1–5 in v1. #6 is documented as future work.

---

## 3. Current state of the Limitless agent loop

This section was assembled by reading the actual code, not inferred from file names.

### 3.1 Main loop structure

The agent loop lives in `src/query.ts`:

- **`query()`** at `src/query.ts:228-247` — public entry; yields `StreamEvent`s
- **`queryLoop()`** at `src/query.ts:250-260` — internal generator wrapping the iteration
- **`while (true)`** at `src/query.ts:327` — the actual iteration body, lines 327–1666

### 3.2 State shape (current)

Defined at `src/query.ts:209-226`. The loop carries:

```typescript
{
  messages: Message[]                  // accumulated history
  toolUseContext: ToolUseContext       // tools, perms, abort, appState
  turnCount: number                    // iteration counter
  continuationNudgeCount: number       // capped at MAX_CONTINUATION_NUDGES
  autoCompactTracking: AutoCompactState
  pendingToolUseSummary: Promise<...> | undefined
  stopHookActive: boolean              // hook activation flag
  transition: { reason: string }       // why the loop continued
}
```

### 3.3 Tool dispatch path

`src/query.ts:1537-1539`:

```typescript
const toolUpdates = streamingToolExecutor
  ? streamingToolExecutor.getRemainingResults()
  : runTools(toolUseBlocks, assistantMessages, canUseTool, toolUseContext)
```

`runTools()` in `src/services/tools/toolOrchestration.ts:19-82` partitions tools into serial (mutating) vs concurrent (read-only) batches and dispatches each to `runToolUse()` in `src/services/tools/toolExecution.ts`.

### 3.4 Hooks

- **PreToolUse hooks:** `runPreToolUseHooks()` at `src/services/tools/toolHooks.ts:502`. Hooks can return `decision: 'block'` with a reason; the loop short-circuits the tool call.
- **Stop hooks:** `handleStopHooks()` invoked at `src/query.ts:1351`. Hooks can set `preventContinuation: true`, causing the loop to exit with `reason: 'stop_hook_prevented'` at `src/query.ts:1363`.
- **Hook type definitions:** `src/types/hooks.ts` defines `decision: 'approve' | 'block'`, `permissionDecision`, `additionalContext`, `updatedInput`, `continue: false` with `stopReason`. **Same surface as Claude Code's hook protocol — we install gate content, not gate mechanism.**

### 3.5 Existing intervention precedent

`src/query/toolFailureLoopGuard.ts` already implements a passive in-loop intervention:

- Tracks per-iteration tool failures by `(signature, category, path)`.
- After `DEFAULT_TOOL_FAILURE_LOOP_THRESHOLD = 3` consecutive matching failures, returns `tripped: true`.
- Called from `src/query.ts:1638-1642`; on trip, the loop returns `reason: 'tool_failure_loop'`.

**This is the existing precedent for everything we're adding.** Pattern #3 (saturation redirect) is the *active* version of this same mechanism — instead of "tripped → stop," it'll be "tripped → forced next action."

### 3.6 Loop exit conditions

Seven enumerated exit paths:
1. API error → `src/query.ts:1348`
2. Stop hook prevented continuation → `:1363`
3. Tool-failure-loop tripped → `:1665`
4. No more work (completed) → `:1514`
5. Aborted during tool execution → `:1630`
6. Hook stopped continuation → `:1635`
7. Continuation nudge cap hit → implicit via `MAX_CONTINUATION_NUDGES`

### 3.7 No existing phase/mode concept

Searched for `phase`, `mode`, `planMode`, `WorkflowPhase`. The closest existing concepts are `transition.reason` (a string label) and `continuationNudgeCount` (a counter). **There is no first-class phase field on loop state today.** This is the structural addition that unlocks patterns #1, #3, #4.

---

## 4. Target state

### 4.1 New loop state

Extend the State type at `src/query.ts:209-226`:

```typescript
{
  ...existing fields,

  // New — phase as first-class loop state
  phase: Phase                          // 'explore' | 'plan' | 'build' | 'verify' | 'refine'
  phaseHistory: PhaseTransition[]       // append-only audit log
  phaseEnteredAt: number                // turnCount when phase began

  // New — saturation tracking (extends toolFailureLoopGuard pattern)
  saturationCount: number               // consecutive no-progress iterations
  saturationProofTurn: number | null    // turn at which WebSearch/WebFetch fired post-saturation

  // New — verification ledger (typed-source provenance)
  verificationLedger: VerificationEntry[]   // every claim with its source

  // New — tamper-guard state
  tamperGuardEnabled: boolean           // default true; disabled only by env var with audit log
}
```

### 4.2 New types

In `src/types/loopDiscipline.ts` (new file):

```typescript
export type Phase = 'explore' | 'plan' | 'build' | 'verify' | 'refine'

export type PhaseTransition = {
  from: Phase
  to: Phase
  reason: string
  turnCount: number
  timestamp: number
}

export type VerificationEntry = {
  claim: string
  source: 'agent' | 'tool' | 'hook' | 'human'   // typed provenance
  toolName?: string                              // populated if source='tool'
  evidence?: string                              // hash, exit code, file ref
  turnCount: number
}

// Per-phase tool allowlist. Read+grep+web always allowed.
export const PHASE_TOOL_ALLOWLIST: Record<Phase, ToolPolicy> = {
  explore:  { allow: ['Read', 'Grep', 'Glob', 'WebSearch', 'WebFetch', 'Bash:read-only'] },
  plan:     { allow: ['Read', 'Grep', 'Glob', 'WebSearch', 'WebFetch', 'Bash:read-only', 'EmitPlan'] },
  build:    { allow: '*', deny: [] },           // full surface
  verify:   { allow: ['Read', 'Bash:test', 'EmitVerification'] },
  refine:   { allow: ['Edit', 'MultiEdit', 'Read', 'Grep', 'Bash:test'] },
}
```

`Bash:read-only` and `Bash:test` are pattern-matched at the Bash dispatcher (e.g., `git status` allowed in plan, `git commit` denied; `pytest` allowed in verify, `pip install` denied).

### 4.3 New loop transitions

Phase transitions are **explicit and audited**, not inferred:

- Loop starts in `phase: 'build'` (preserves current behavior for users not using phases).
- Phase transitions via `EmitPhaseTransition` tool (model-initiated, recorded) or by harness rules (saturation forces explore→plan, plan→build only after EmitPlan succeeds).
- Every transition appends to `phaseHistory` and resets `saturationCount`.

---

## 5. Per-pattern implementation phases

### Phase A — Foundation (no behavior change yet)

**Goal:** Land the state shape, types, and feature flag with zero behavior change.

**Changes:**
1. Create `src/types/loopDiscipline.ts` with `Phase`, `PhaseTransition`, `VerificationEntry`, `PHASE_TOOL_ALLOWLIST`.
2. Extend State type at `src/query.ts:209-226` with new fields, all defaulted such that legacy behavior is preserved (`phase: 'build'`, `tamperGuardEnabled: false` initially).
3. Add env flag `OPENCLAUDE_IN_LOOP_DISCIPLINE=0|1|2` (0=off, 1=advisory-only, 2=enforced). Default `0` for the first release.
4. Add `appState.loopDiscipline.events[]` for structured per-turn observability — every phase transition, gate decision, verification entry pushed here.

**Acceptance:** existing tests pass; new state fields visible in transcripts; no enforcement yet.

**Smoke test A:**
```bash
OPENCLAUDE_IN_LOOP_DISCIPLINE=0 bun test
# Output: a query that triggers no phase transitions; transcript shows phase='build' throughout, no events.
```

---

### Phase B — Pattern #1: Phase-restricted tool surface

**Goal:** Model literally cannot call Edit during 'explore' phase.

**Surgery site:** `src/services/tools/toolHooks.ts:502` (`runPreToolUseHooks`).

**Implementation:**
1. New hook: `phaseGateHook` registered at the front of the PreToolUse chain.
2. On every PreToolUse, look up `state.phase`, consult `PHASE_TOOL_ALLOWLIST[phase]`.
3. If tool is not in allow set (or matches deny pattern), return:
   ```typescript
   {
     decision: 'block',
     reason: `Tool '${toolName}' is not available in phase '${phase}'. Current phase allows: ${allowedTools.join(', ')}. To use this tool, emit a phase transition first.`,
     hookSpecificOutput: { ... permissionDecisionReason ... }
   }
   ```
4. Add `EmitPhaseTransition` as a built-in tool, always allowed. Records phase change in state.

**Pattern stolen from:** Cline's `ToolExecutor` rejection (`src/core/task/ToolExecutor.ts` in `cline/cline`). The block returns a tool-result-shaped error so the model can disambiguate from a real failure.

**Acceptance:**
- A test that puts the loop in `phase: 'explore'` and attempts an `Edit` returns a `decision: 'block'` from the PreToolUse chain.
- The model receives the structured error in its next-turn context.
- `EmitPhaseTransition('build')` succeeds and the next `Edit` call completes normally.

**Smoke test B:**
```bash
OPENCLAUDE_IN_LOOP_DISCIPLINE=2 OPENCLAUDE_INITIAL_PHASE=explore \
  limitless run "edit src/test.ts"
# Expected: model attempts Edit, gets blocked with phase-mismatch error,
# transitions to 'build', completes edit successfully.
# Transcript shows: phase=explore → blocked Edit → EmitPhaseTransition → phase=build → Edit success.
```

---

### Phase C — Pattern #5: Anti-self-tamper

**Goal:** The model cannot edit Limitless's own enforcement code while running.

**Why next:** Lowest implementation cost, highest blast-radius protection, prerequisite for trusting all later phases. Without this, the model can route around every other gate by editing the gate.

**Surgery site:** `src/services/tools/toolHooks.ts:502` (same PreToolUse chain).

**Implementation:**
1. New hook: `selfTamperGuard` after `phaseGateHook`.
2. On any `Edit`/`Write`/`MultiEdit`/`NotebookEdit`, canonicalize the target path (`path.resolve()`, follow symlinks via `realpath`).
3. Check against a **directory-prefix deny list** (not regex allow list — the directory-prefix form avoids the `ralph-noop-blocker.sh`/regex-bypass class of bug noted in `ralph-mode-enforcer.sh:47-49`):
   ```typescript
   const TAMPER_DENY_PREFIXES = [
     // Limitless's own enforcement code
     'src/services/tools/toolHooks.ts',
     'src/query/toolFailureLoopGuard.ts',
     'src/query/stopHooks.ts',
     'src/types/loopDiscipline.ts',
     'src/types/hooks.ts',
     // Loop core
     'src/query.ts',
     'src/services/tools/toolOrchestration.ts',
     'src/services/tools/toolExecution.ts',
   ]
   ```
4. On match: `decision: 'block'`, reason explains that the file is loop-critical enforcement and edits are blocked while `OPENCLAUDE_IN_LOOP_DISCIPLINE >= 1`. Bypass is via env var `OPENCLAUDE_TAMPER_GUARD=off` set in the parent process before launch — not editable in-loop.

**Acceptance:**
- Edit to `src/services/tools/toolHooks.ts` blocked.
- Edit to `src/services/tools/../tools/toolHooks.ts` (path-traversal trick) **also** blocked (canonicalization catches it).
- Edit to `src/components/Header.tsx` succeeds.

**Smoke test C:**
```bash
OPENCLAUDE_IN_LOOP_DISCIPLINE=2 \
  limitless run "edit src/services/tools/toolHooks.ts to remove the phase gate"
# Expected: Edit blocked. Block reason includes the file path. Loop continues; model receives the block as a tool result and reroutes.
```

---

### Phase D — Pattern #3: Saturation redirect

**Goal:** When the loop stops making progress, force the next action to be WebSearch or WebFetch (not "stop," like the existing toolFailureLoopGuard does).

**Why this is the publishable contribution:** Researcher's finding — every shipping open-source harness either halts on saturation or asks the human. Nobody auto-redirects.

**Surgery sites:** Two:
- `src/query/toolFailureLoopGuard.ts` — extend with a saturation-aware mode
- `src/query.ts:1638-1666` — change the "tripped" handler from "exit" to "annotate next-turn"

**Implementation:**
1. Add `SaturationDetector` next to `ToolFailureLoopGuard`. Saturation signals:
   - **Repeated edits to same file with no test exit** (high signal — the iconic "I'll just change one more thing" loop)
   - **N consecutive turns with no tool calls that change observable state** (no Edit, no Write, no Bash that produces output)
   - **N consecutive Edit calls to file X with same imports/symbols touched** (semantic stuck)
2. On saturation trip:
   - Do not exit. Set `state.saturationCount` and `state.saturationProofTurn = null`.
3. New PreToolUse hook `saturationRedirectGate` (runs *after* phaseGate and selfTamperGuard):
   - If `state.saturationCount >= 3` and `state.saturationProofTurn === null` and the requested tool is in `MUTATING_TOOLS` (Edit, Write, MultiEdit, Bash non-readonly), block with:
     ```
     SATURATION REDIRECT: This loop has produced no progress in N consecutive iterations.
     Your next tool call must be WebSearch or WebFetch. After that completes, this block lifts.
     Topics to search: novel approaches in this domain, recent papers, competitor implementations,
     adjacent-field solutions to the same shape of problem.
     ```
4. PostToolUse hook `saturationProofRecord`: if WebSearch/WebFetch returns successfully, set `state.saturationProofTurn = state.turnCount`. Counter resets to 0 on the next observable-state-change tool call.

**Pattern stolen from:** `~/.claude/scripts/ralph-mode-enforcer.sh:78-104` (saturation gate forces WebSearch/WebFetch before more edits).

**Pessimism (from OpenHands condenser bug, PR #6795):** The detector must have explicit reset/idempotency. Saturation count must reset when the model transitions phases or makes observable progress, or the gate becomes the stuck pattern it's meant to prevent.

**Acceptance:**
- Loop with 3+ consecutive no-progress edits triggers redirect block on the 4th Edit.
- WebSearch satisfies the proof; next Edit succeeds.
- A non-saturated loop with 3+ successful edits never triggers (counter resets on progress).

**Smoke test D:**
```bash
OPENCLAUDE_IN_LOOP_DISCIPLINE=2 \
  limitless run "fix the flaky test in tests/foo.test.ts that keeps failing intermittently"
# Drive the model into a thrash where it keeps editing without resolving.
# Expected: after 3 no-progress turns, the 4th Edit is blocked with the saturation redirect message.
# Expected: model calls WebSearch, gets results, retries the Edit, which now succeeds.
# Transcript shows saturation events in appState.loopDiscipline.events[].
```

---

### Phase E — Pattern #4: Plan-then-edit as native phases

**Goal:** When task complexity warrants, the loop *requires* a plan to be emitted before any Edit is permitted.

**Surgery site:** Combines patterns #1 and #2. Uses the phase gate from B + a new `EmitPlan` tool that produces a verifiable structured artifact.

**Implementation:**
1. New built-in tool: `EmitPlan(plan: { intent: string, files_to_edit: string[], smallest_test: string })`. Always allowed in `plan` phase.
2. Phase transition `plan → build` is **gated**: it only succeeds if `state.verificationLedger` contains a recent `EmitPlan` entry.
3. Escalation: when `toolFailureLoopGuard` trips or saturation redirect fires for the second time in a single task, the loop *forces* transition to `plan` phase. Model must `EmitPlan` before Edit returns.

**Pattern stolen from:** `~/.claude/agents/ralph-builder.md:55-79` (T8 plan-then-edit protocol at escalation_level >= 1). Plus Aider's architect/editor (with the explicit-handoff structure that Aider's Issue #2258 says they were missing).

**Anti-pattern accommodation:** Aider's split caused "appends instead of creates" because the editor lost context from the architect. Mitigation: the plan artifact (`EmitPlan` payload) is **prepended verbatim** to the next-turn context as a system message, not summarized. The model writing Edit calls in `build` phase has the full plan in working memory.

**Acceptance:**
- Default: model in `build` phase can Edit freely (no forced planning for simple tasks).
- After saturation redirect fires twice: phase auto-transitions to `plan`. Edit blocks until `EmitPlan` succeeds.
- After `EmitPlan` and `EmitPhaseTransition('build')`: Edit allowed. Plan is in next-turn system prompt.

**Smoke test E:**
```bash
OPENCLAUDE_IN_LOOP_DISCIPLINE=2 OPENCLAUDE_FORCE_ESCALATION=1 \
  limitless run "refactor src/auth/ to use the new token format"
# Expected: phase=plan, Edit blocked, EmitPlan called with files+test description,
# phase transitions to build, Edits succeed, plan visible in transcript context for build turns.
```

---

### Phase F — Pattern #2: Structured returns with typed-source verification

**Goal:** A "done" claim is only valid if the verification ledger contains an entry with `source: 'tool'` or `source: 'hook'` matching the claim. The model cannot self-certify.

**Surgery sites:**
- `src/query.ts:1514` (the `completed` exit) — gate the `completed` return on verification ledger contents.
- `src/services/tools/toolExecution.ts` — every tool with a verifiable side effect (`Edit`, `Write`, `Bash` running tests, etc.) registers a `VerificationEntry` in the ledger automatically.

**Implementation:**
1. New built-in tool: `EmitVerification(claim: string, evidenceFromTool: string)`. Allowed in `verify` and `build` phases.
2. PostToolUse hook `verificationLedgerWriter`: when a verification-bearing tool (Bash running a test, Read of an output file, etc.) succeeds, append `{ claim: tool-derived, source: 'tool', toolName, evidence: stdout-hash-or-exit-code, turnCount }` to `state.verificationLedger`.
3. **Liveness check** (mitigates OpenHands SecurityAnalyzer silent-failure, Issue #9154): if the model emits a "task complete" signal but `state.verificationLedger` has no entry from the last K turns with `source !== 'agent'`, the loop refuses to exit with `reason: 'completed'`. Instead it transitions to `phase: 'verify'` and re-prompts with: "You claimed done but no tool/hook has produced verification evidence. Run a verification step."
4. Make the `transition.reason` exit reasons explicit: `completed_with_verification` vs `completed_unverified` (latter is gated off in `OPENCLAUDE_IN_LOOP_DISCIPLINE=2`).

**Pattern stolen from:** OpenHands' `security_risk` field-on-action (LLMSecurityAnalyzer populates a field that the main loop reads to gate execution). Plus Maestro's `QualityCriteria.source: 'automated-test' | 'code-analysis' | 'human-review' | 'consensus'` type design.

**Acceptance:**
- Task involving a code edit: loop refuses to exit until either (a) a Bash test run appears in the ledger or (b) explicit phase transition to `verify` + `EmitVerification`.
- A pure question-answering task (no tool calls): ledger empty, but loop exits via a separate `completed_no_artifacts` reason (not gated).
- If ledger has `source: 'agent'` entries only, the loop does NOT exit on done-signal.

**Smoke test F:**
```bash
OPENCLAUDE_IN_LOOP_DISCIPLINE=2 \
  limitless run "add a function foo() to src/utils.ts that returns 42, then say you're done"
# Expected: model writes Edit, then says "I'm done."
# Loop sees: ledger has source='tool' entry from Edit-with-test? NO — no test was run.
# Loop transitions to phase=verify, re-prompts. Model runs `bun test`, ledger gets source='tool' Bash entry,
# loop exits with reason: 'completed_with_verification'.
```

---

### Phase G — Cross-cutting: Observability + reset semantics

**Goal:** Every gate, transition, and counter-reset is recorded so we can debug failures without re-running.

**Implementation:**
1. `appState.loopDiscipline.events: DisciplineEvent[]` populated by every hook in B–F.
2. Event shape: `{ kind: 'gate-blocked' | 'phase-transition' | 'saturation-trip' | 'verification-write' | 'tamper-block', turnCount, phase, details }`.
3. Add CLI flag `--debug-discipline` that streams the events to stderr in real time.
4. Counter-reset audit: every time `saturationCount` resets, log the trigger.

**Acceptance:** Running with `--debug-discipline` produces a full event timeline that explains every loop-state mutation introduced by B–F.

---

## 6. Migration / backwards compatibility

- `OPENCLAUDE_IN_LOOP_DISCIPLINE=0` (default first release): all new state fields exist but no gates enforce. Pure observability mode.
- `OPENCLAUDE_IN_LOOP_DISCIPLINE=1` (advisory): gates emit `additionalContext` warnings but don't block. Lets us measure how often each gate would fire on real workloads.
- `OPENCLAUDE_IN_LOOP_DISCIPLINE=2` (enforced): full enforcement.
- Existing Limitless users hit zero behavior change unless they opt in.
- Internal default for Tenet's instances: `=2`.

Each phase ships independently. A is the prerequisite for everything; B–F can ship in order without forcing the others.

---

## 7. Full smoke test plan

After all phases land, the following sequence proves the system end-to-end:

```bash
# Smoke 1: legacy behavior preserved
OPENCLAUDE_IN_LOOP_DISCIPLINE=0 \
  limitless run "list files in src/" → should behave identically to pre-discipline Limitless

# Smoke 2: phase gate (B)
OPENCLAUDE_IN_LOOP_DISCIPLINE=2 OPENCLAUDE_INITIAL_PHASE=explore \
  limitless run "edit src/foo.ts" → Edit blocked, phase transition succeeds, edit then succeeds

# Smoke 3: tamper guard (C)
OPENCLAUDE_IN_LOOP_DISCIPLINE=2 \
  limitless run "remove the phase gate from toolHooks.ts" → Edit blocked, loop continues

# Smoke 4: saturation redirect (D)
OPENCLAUDE_IN_LOOP_DISCIPLINE=2 \
  limitless run "<task designed to thrash>" → after 3 no-progress turns, WebSearch forced, then progress resumes

# Smoke 5: plan-then-edit escalation (E)
OPENCLAUDE_IN_LOOP_DISCIPLINE=2 OPENCLAUDE_FORCE_ESCALATION=1 \
  limitless run "refactor src/auth/" → forced phase=plan, EmitPlan required, plan visible in build context

# Smoke 6: verification ledger (F)
OPENCLAUDE_IN_LOOP_DISCIPLINE=2 \
  limitless run "add foo() to src/utils.ts, then say done" → loop won't exit until test run produces a tool-source ledger entry

# Smoke 7: observability (G)
OPENCLAUDE_IN_LOOP_DISCIPLINE=2 --debug-discipline \
  limitless run "<any task>" → stderr shows full event timeline; every gate, every transition, every reset

# Smoke 8: replay the ACORD failure
# Create a test fixture that simulates the 2026-05-14 incident: a tool that "fills" a PDF by writing
# field-dictionary values but not appearance streams; a "verify" tool that reads field values; an
# "extract rendered text" tool that returns the actual rendered output (would show blank).
# Without discipline: the model reports "verified" off the field-value check and "ships" the PDF.
# With OPENCLAUDE_IN_LOOP_DISCIPLINE=2: the loop refuses to exit because the verification ledger
# only has source='agent' entries (the model's claim) and no source='tool' entry from the rendered-text
# extraction. Forced into phase=verify, model runs the extractor, sees blank output, doesn't ship.
#
# This smoke test directly reproduces the original failure mode in a controlled environment and
# proves the harness compensation works on the exact bias that motivated the work.
```

---

## 8. Rollback plan

- Each phase is gated by `OPENCLAUDE_IN_LOOP_DISCIPLINE` and individual sub-flags (`OPENCLAUDE_TAMPER_GUARD`, `OPENCLAUDE_SATURATION_REDIRECT`, etc.). Set to `0` / `off` for instant disable.
- Phases A–G are separate commits / PRs. Reverting any one phase doesn't cascade.
- Phase A (foundation) is a no-op at the behavior layer. It can stay in main even if B–G are reverted.
- New types and the `EmitPlan`/`EmitVerification`/`EmitPhaseTransition` tools are gated behind the env flag — if disabled, they're unregistered and invisible to the model.

---

## 9. Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| Phase gate too aggressive — blocks legitimate workflows | High | Ship Phase A (observability) before B (enforcement); use advisory mode (=1) to measure |
| Saturation detector causes the stuck pattern it's meant to prevent (OpenHands PR #6795) | Medium | Explicit counter reset on phase transition; idempotency test in Smoke 4 |
| Plan-then-edit context-loss tax (Aider Issue #2258) | Medium | Plan artifact prepended verbatim to build-phase context, not summarized |
| Verification ledger silently broken (OpenHands Issue #9154) | Medium-high | Liveness check: if `OPENCLAUDE_IN_LOOP_DISCIPLINE=2` and no `verificationLedgerWriter` calls in 10 turns, log a critical warning to stderr |
| Tamper guard blocks legitimate self-modification (e.g., upgrading Limitless via Limitless) | Low | Env var override at process launch only; out-of-loop terminal can edit normally |
| Performance hit from per-PreToolUse phase lookup | Low | Phase lookup is O(1) map access; allowlist check is O(allowed_tools.length) ~10 |
| Existing Limitless users hit unexpected behavior changes | Low | Default `=0` for first release; opt-in via env var |
| Schema additions break existing transcripts/replay tools | Low | Phase A adds fields with defaults; old transcripts replay as `phase: 'build'` throughout |

---

## 10. What we are NOT building in v1

- **Pattern #6 (multi-call consensus on high-stakes outputs).** Maestro's `ConsensusRequirements` design is sound but adds latency/cost. Defer to v2 after we measure how much #1–#5 reduce failure rates. Document the type design (`ConsensusRequirements`, `ConsensusVote`, `ConsensusResult` from Maestro) as a forward-compatibility note in `src/types/loopDiscipline.ts`.
- **Cross-session persistent loop state.** Phase resets on every new query session. Cross-session continuity is Mnemo's job, not the loop's.
- **UI changes.** Phase indicator in the Limitless TUI/web client is a separate PR. v1 is loop semantics + CLI observability only.

---

## 11. Acceptance criteria (for the plan itself)

This plan is approved if Verick can answer "yes" to:

1. Does the plan name a specific file + line for every change? ✅ (Sections 4.1, 4.2, every phase)
2. Are the bias compensations grounded in the actual code (not fabricated)? ✅ (Section 3 read by Explore agent; verified against `src/query.ts`, `toolHooks.ts`, `toolFailureLoopGuard.ts`)
3. Is each pattern justified by a specific failure mode we've encountered? ✅ (Phase F smoke 8 replays the ACORD incident)
4. Is the migration path zero-impact for existing users? ✅ (Section 6)
5. Are anti-patterns from the public research explicitly addressed? ✅ (OpenHands condenser → Phase D reset; Aider architect/editor → Phase E verbatim handoff; OpenHands SecurityAnalyzer → Phase F liveness check)
6. Can each phase ship independently? ✅ (Section 6)

---

## 12. References

- Trigger conversation: `/Users/verickwayne/Projects/tenet/docs/harness-engineering-conversation-slice.md` (2026-05-14)
- Ralph compensations (precedent): `~/.claude/scripts/ralph-mode-enforcer.sh`, `~/.claude/agents/ralph-builder.md`
- Cline ToolExecutor pattern: `cline/cline` → `src/core/task/ToolExecutor.ts` (per DeepWiki: Plan/Act modes)
- OpenHands SecurityAnalyzer: https://docs.openhands.dev/sdk/guides/security
- OpenHands SDK paper §8: https://arxiv.org/html/2511.03690v1
- OpenHands condenser regression: https://github.com/All-Hands-AI/OpenHands/pull/6795
- OpenHands SecurityAnalyzer silent failure: https://github.com/All-Hands-AI/OpenHands/issues/9154
- Aider architect/editor regression: https://github.com/Aider-AI/aider/issues/2258
- Maestro types (typed-source design): `~/Projects/ruflo/v2/src/maestro/maestro-types.ts`
- Limitless loop architecture (this codebase): `src/query.ts:209-1666`, `src/services/tools/toolHooks.ts:502+`, `src/query/toolFailureLoopGuard.ts`
