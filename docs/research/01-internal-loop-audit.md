# Internal Agent Loop Audit — feat/multi-provider

**Date:** 2026-06-09  
**Branch:** feat/multi-provider  
**Scope:** `src/query.ts`, `src/types/loopDiscipline.ts`, `src/services/mnemo/autoRecall.ts`, `src/services/mnemo/mcpBridge.ts`, `src/query/stopHooks.ts`, `src/query/tokenBudget.ts`, `~/.claude/scripts/ralph-*.sh`

---

## A. Inventory of Completion-Forcing Mechanisms

### A1. Continuation Nudge (regex signal injection)
**File:** `src/query.ts:1596–1666`  
**What it does:** After any no-tool-call assistant turn, scans the last assistant text against 6+ regex patterns for phrases like "let me do…", "now I'll create…", "time to build…". If a match is found and no completion marker is present, injects a isMeta user message: `"Continue with the task. Use the appropriate tools to proceed."` and loops back. Capped at `MAX_CONTINUATION_NUDGES = 3` (`src/query.ts:199`).

**Why added:** Compensates for the model returning a narration turn ("I'll now edit the file") without actually calling a tool — training bias toward early declaration rather than action.

**Note:** The regex `completionMarkers` (`done|finished|completed|complete|summary|that's all|all set|hope this helps|let me know if`) suppresses nudging when the model signals completion. But every simple answer that happens to contain "let me know if" or "hope this helps" triggers the suppression path — while every short (<80 char) response matching `i'll do|i need to do` triggers an extra loop turn. There is no complexity gate: a two-word reply like `"Let me now help."` can trigger iteration if it matches.

---

### A2. Completion Exit Gate — Phase F (verification-required block)
**File:** `src/query.ts:1668–1713` + `src/types/loopDiscipline.ts:800–847`  
**What it does:** When `OPENCLAUDE_IN_LOOP_DISCIPLINE >= 2`, before allowing the loop to return `reason: 'completed'`, calls `evaluateCompletionExit()`. If the loop performed any mutating work (Edit/Write/Bash mutations detected) but the `verificationLedger` has no `source: 'tool'|'hook'|'human'` entries, exit is refused and a large verification nudge is injected: `"COMPLETION EXIT BLOCKED: this loop performed mutating work… run a test via Bash…"`.

**Why added:** Closes the 2026-05-14 ACORD-blank-PDF failure shape — model claiming "verified" without any tool actually confirming the output.

**Latency note:** At discipline level 0 (default) this is a no-op and adds zero overhead (`evaluateCompletionExit` returns `{allowed: true, reason: 'completed_legacy'}` immediately). At level 2 it adds one extra API turn minimum when mutations happen without a test run.

---

### A3. Token Budget Continuation Loop
**File:** `src/query.ts:1545–1593` + `src/query/tokenBudget.ts:45–93`  
**What it does:** When `TOKEN_BUDGET` feature flag is on and the turn token count is below 90% of budget (`COMPLETION_THRESHOLD = 0.9`), injects a continuation nudge message and loops. Caps out only when: (a) `pct >= 90`, or (b) 3+ continuations and token delta between checks < 500 (`DIMINISHING_THRESHOLD`). Disabled for subagents (`agentId` check).

**Why added:** Anti-idle for long-running SDK/agent turns that stop without exhausting their budget.

---

### A4. Max-Output-Tokens Recovery Loop
**File:** `src/query.ts:1419–1491`  
**What it does:** When the model hits its output token cap, injects: `"Output token limit hit. Resume directly — no apology, no recap of what you were doing. Pick up mid-thought if that is where the cut happened. Break remaining work into smaller pieces."` and retries up to `MAX_OUTPUT_TOKENS_RECOVERY_LIMIT = 3` times.

**Why added:** Prevents silent truncation of long-running code generation from appearing as completion.

---

### A5. Stop Hook Blocking Error Re-loop
**File:** `src/query.ts:1517–1543` + `src/query/stopHooks.ts:65–473`  
**What it does:** After every no-tool-call turn, `handleStopHooks()` is called. If any stop hook returns a `blockingError`, it is injected as a user message and the loop continues (transition reason: `stop_hook_blocking`). The ralph hooks are wired here.

**Why added:** Allows external scripts (ralph mode-enforcer, deny-watcher) to programmatically prevent turn completion and force a re-think.

**Latency:** `handleStopHooks` is on the critical path of every single response that does not call tools. It runs even for `"hello"`. It calls `executeStopHooks()` which spawns the full registered hook chain (all `~/.claude/settings.json` Stop hooks), including: `ralph-anti-idle.sh`, `ralph-completion-detector.sh`, `ralph-mode-enforcer.sh`, etc. For non-ralph sessions these scripts all exit early (state file absent), but the subprocess spawn and I/O still costs ~15–80ms per hook in the chain. Additionally `executePromptSuggestion`, `executeAutoDream`, `executeExtractMemories` are also fired as fire-and-forget side effects inside `handleStopHooks` (`stopHooks.ts:137–157`) on every turn.

---

### A6. Forced Plan Phase Transition (Phase E4 / saturation escalation)
**File:** `src/query.ts:2155–2168` + `src/types/loopDiscipline.ts:875–896`  
**What it does:** At discipline level >= 2, if `saturationTripsThisTask >= FORCED_PLAN_TRIPS_THRESHOLD (= 2)`, the loop forces `phase = 'plan'` via `applyPhaseTransition`. The model can't escape plan phase without calling `EmitPlan`. Adds at minimum one plan-gathering turn before any further edits.

**Why added:** Prevents edit-saturate-retry-repeat loops where the model keeps making the same changes without meaningful progress.

---

### A7. Mnemo Auto-Recall at Loop Entry (blocking await)
**File:** `src/query.ts:387–411` + `src/services/mnemo/autoRecall.ts:87–117` + `src/services/mnemo/mcpBridge.ts:64–92`  
**What it does:** When `OPENCLAUDE_MNEMO_AUTO_RECALL=1`, at loop entry (before the first iteration), calls `performAutoRecall()` which issues a live MCP tool call to `mnemo_recall` with the user's first prompt. The result is stored in `mnemoAutoRecallContext` and injected into the system prompt on **every** iteration of the loop as a `<mnemo-auto-recall>` XML block via `buildMnemoHandoffMessage()`.

**Why added:** Structural fix for "knowledge that fires automatically at decision points" — prevents the model from missing relevant prior decisions because it forgot to query Mnemo.

**Latency:** `await performAutoRecall()` is a synchronous await at loop start, on the critical path, before any model call. For a simple `"hello"` query, this MCP round-trip (typically 50–300ms) is paid unconditionally when the env flag is on. The injected XML block (up to 5 memories × 400 chars each = ~2000 tokens) is then prepended to the system prompt on every iteration.

---

### A8. Plan Handoff Injection (Phase E5 — every build-phase turn)
**File:** `src/query.ts:619–637`  
**What it does:** During every build-phase loop iteration where a `pendingPlan` was emitted in the preceding plan phase, `buildPlanHandoffMessage()` constructs a `<plan-handoff>` block (up to 4000 + 50 + 2000 chars = ~8000 chars) and appends it to the system prompt before every API call.

**Why added:** Mitigates architect/editor context-loss (Aider Issue #2258) — the plan verbatim is kept in front of the model at every build turn.

**Latency:** On simple turns with no active plan, the `state.loopDiscipline.pendingPlan !== null` check is false and this is a no-op. Cost only materializes when a plan is active.

---

### A9. Ralph Anti-Idle Hook (UserPromptSubmit injection)
**File:** `~/.claude/scripts/ralph-anti-idle.sh`  
**What it does:** Fires on every `UserPromptSubmit` event. When a ralph session state file exists for the session, injects a large `additionalContext` block (200–600 words) containing: mode-specific CRITICAL BEHAVIORAL RULES, saturation escalation directives (up to 3-tier escalation with WebSearch mandate), daemon alert text, deny-watcher feedback, and post-manifest dream mode banners. In dream mode, the injected RULES block is replaced entirely with a ~400-word research mandate.

**Why added:** Multi-layer anti-idle system — ensures the model has explicit behavioral constraints at every prompt boundary.

**Latency:** This runs synchronously on the prompt-submit path. The script does: YAML parsing with `sed`, multiple `grep` calls, Python3 subprocess for elapsed time calculation, git `rev-list --count`, and file stats. For non-ralph sessions (no state file), it exits early after 2 checks. For active ralph sessions, the python3 call and git command add ~30–80ms on the critical path.

---

### A10. Ralph Mode Enforcer (PreToolUse blocking)
**File:** `~/.claude/scripts/ralph-mode-enforcer.sh`  
**What it does:** On every PreToolUse event, reads the session state file and (a) blocks Edit/Write/MultiEdit calls to ralph enforcement scripts (tamper protection), (b) in research mode blocks Edit/Write/NotebookEdit to non-research-note paths, (c) at 3+ consecutive saturation iterations, blocks Edit/Write/MultiEdit entirely until a `saturation-research-proof-{iter}` file exists (requiring a WebSearch or WebFetch call first).

**Why added:** Makes mode transitions structurally real rather than advisory.

---

### A11. Ralph Completion Detector (Stop hook observer)
**File:** `~/.claude/scripts/ralph-completion-detector.sh`  
**What it does:** Fires after every Stop hook. Evaluates up to 11 signals (iteration count, queue state, output velocity, persona returns, gap velocity, cost velocity, file growth, etc.) and writes `.ralph/completion-candidate.md` when >= 60% of applicable signals report saturation. Does not block; the anti-idle hook (A9) reads this file and escalates the injected directive text.

---

### A12. Loop Workload Classifier (fast-path gate for discipline)
**File:** `src/types/loopDiscipline.ts:420–453`  
**What it does:** At loop entry, `classifyLoopWorkloadFromPrompt()` classifies the first user prompt as `'direct'|'bounded'|'long-running'`. With `OPENCLAUDE_DISCIPLINE_PROFILE=adaptive` (default), `direct` queries get `effectiveDisciplineLevel = 0` even when `OPENCLAUDE_IN_LOOP_DISCIPLINE >= 1`. This is an intentional fast-path for Q&A.

**Classification logic:**
- `length === 0` → `direct`
- Matches LONG_RUNNING_PATTERN or `length > 800` → `long-running`
- Matches MUTATION_PATTERN → `bounded`
- `length <= 320` AND matches DIRECT_QUESTION_PATTERN → `direct`
- Otherwise → `bounded`

**Gap:** Simple greetings like `"hello"` or `"what time is it?"` get `direct` and bypass discipline overhead. But short mutation-sounding prompts like `"fix this"` (matches MUTATION_PATTERN) get `bounded` which activates the continuation nudge and completion gate even though the task may genuinely be trivial.

---

## B. Latency Hot-Paths for Simple Queries

For a trivial query like `"hello"` (non-ralph session, `OPENCLAUDE_IN_LOOP_DISCIPLINE=0`, `OPENCLAUDE_MNEMO_AUTO_RECALL=0`):

### B1. Stop Hooks Run on Every No-Tool Turn (largest single overhead)
**File:** `src/query.ts:1502–1511` + `src/query/stopHooks.ts:65–473`  
Every turn that returns without tool calls hits `handleStopHooks()`, which:
1. Calls `saveCacheSafeParams()` (file write) for main session queries
2. Calls `executeStopHooks()` — spawns the entire registered `Stop` hook chain. With the default openclaude setup this includes `ralph-anti-idle.sh`, `ralph-completion-detector.sh`, plus any user-configured hooks. Even when ralph is inactive, subprocess spawn cost is ~15–50ms per hook.
3. Calls `executePromptSuggestion()` (fire-and-forget but still spawned)
4. Calls `executeAutoDream()` (fire-and-forget)
5. Calls `executeExtractMemories()` (fire-and-forget, when EXTRACT_MEMORIES feature is on)

**Impact:** For `"hello"`, the model responds with pure text (no tools), hits this path on every turn. The stop hook chain has no early-exit for "no ralph session + trivial query"; it spawns each script.

### B2. Continuation Nudge Regex Scan (every no-tool turn)
**File:** `src/query.ts:1602–1664`  
After every no-tool-call turn, the last assistant text is scanned against 6 regex patterns. Short responses are cheap (O(text_length)), but:
- The patterns are not pre-compiled — they're constructed inline each iteration as regex literals (allocated fresh each check). This is minor overhead individually but multiplies with turn count.
- The check runs even for `"I don't know"` responses that clearly can't match.

### B3. Mnemo Auto-Recall Blocking Await (when env flag is set)
**File:** `src/query.ts:397–411`  
`await performAutoRecall()` is a synchronous await at loop entry — before the model call, before any streaming, on the critical path. Round-trip to mnemo MCP server: typically 50–300ms. For `"hello"`, this buys nothing and costs 1 RTT.

### B4. Skill Discovery Prefetch (every iteration)
**File:** `src/query.ts:464–468`  
`skillPrefetch?.startSkillDiscoveryPrefetch()` fires on every iteration when `EXPERIMENTAL_SKILL_SEARCH` feature is on. This is a fire-and-forget but still initiates a background task that runs during the model call.

### B5. Multi-Turn Context + Conversation Arc Updates (feature-gated, per-iteration)
**File:** `src/query.ts:501–508`, `src/query.ts:1786–1796`  
When `MULTI_TURN_CONTEXT` and `CONVERSATION_ARC` features are on and `knowledgeGraphEnabled`, each iteration calls `await updateArcPhase()` and `await finalizeArcTurn()` — dynamic `import()` + DB writes. These are on the critical path of tool execution post-processing.

### B6. Always-Run LoopDiscipline Initialization (even when level=0)
**File:** `src/query.ts:346–373`  
Even at `OPENCLAUDE_IN_LOOP_DISCIPLINE=0`, the loop calls:
- `classifyLoopWorkloadFromPrompt(firstUserPrompt)` — regex scan of the prompt
- `readDisciplineLevel()` / `readDisciplineProfile()` — env reads
- `resolveEffectiveDisciplineLevel()` — logic evaluation
- `createInitialLoopDisciplineState()` — object allocation
- `extractFirstUserPromptText()` — message array scan

These are fast individually (~0.1ms total) but they run unconditionally. Not a meaningful latency source on their own; included for completeness.

### B7. Per-Iteration Tool Result Budget + Message Snip (potentially heavy)
**File:** `src/query.ts:519–558`  
Every iteration (even for simple queries with no prior tool results):
1. `applyToolResultBudget()` — scans `messagesForQuery` for oversized tool results. For a fresh session this is fast (no messages to scan), but in long sessions with many tool results it is O(messages × result_size).
2. `snipModule.snipCompactIfNeeded()` — history snip check, feature-gated.
3. `microcompact()` — synchronous await, dep-injected.
4. `autocompact()` — synchronous await, dep-injected.

All four run on the hot path before every model call with no "session is fresh, skip" guard.

---

## C. Specific Opportunities

### C1. Fast-Path Early Exit for Direct Queries in Stop Hooks
**Highest-leverage fix.** 

**Problem:** `handleStopHooks()` (`stopHooks.ts:65`) runs on every no-tool-call turn with no query-complexity gate. Subprocess hook spawning is ~15–80ms per hook.

**Fix:** At the top of `handleStopHooks()`, check the loop's workload class. If `loopDiscipline.workload === 'direct'` (i.e., `classifyLoopWorkloadFromPrompt` classified it as a Q&A question), skip the entire hook chain and return `{blockingErrors: [], preventContinuation: false}` immediately.

The discipline state is already threaded through `ToolUseContext` via `getLoopDiscipline()` (`query.ts:379–385`), so `handleStopHooks` can read it without a new parameter.

```typescript
// stopHooks.ts — proposed at top of handleStopHooks():
const loopDiscipline = toolUseContext.getLoopDiscipline?.()
if (loopDiscipline?.workload === 'direct') {
  return { blockingErrors: [], preventContinuation: false }
}
```

**Expected savings:** ~80–200ms per simple query (eliminates subprocess spawn chain). This is the single largest controllable latency item on the hot path.

---

### C2. Conditional Mnemo Auto-Recall (workload gate)
**File:** `src/query.ts:397–411`

Same fast-path guard as C1. When `loopWorkload === 'direct'`, skip the blocking `await performAutoRecall()`. Direct questions rarely benefit from injecting prior-session memory — the model is answering in-context.

```typescript
// query.ts — proposed at recall block:
if (isMnemoAutoRecallEnabled() && loopWorkload !== 'direct') {
  // ... existing recall logic
}
```

**Expected savings:** 50–300ms eliminated from the critical path for direct queries.

---

### C3. Make Continuation Nudge Patterns Pre-Compiled Module-Level Constants
**File:** `src/query.ts:1617–1634`

The 6+ regex patterns are constructed inside the loop body each iteration. At 3 max nudges × potential for many turns, this allocates new RegExp objects repeatedly. Move to module-level compiled constants.

```typescript
// query.ts — move outside queryLoop():
const CONTINUATION_SIGNAL_PATTERNS_SHORT = [
  /\bso now (i|let me|we) (need to|have to|should|must|will) (do|create|...)/,
  // ...
] as const

const CONTINUATION_SIGNAL_PATTERNS_ALL = [
  ...CONTINUATION_SIGNAL_PATTERNS_SHORT,
  /\b(i('ll| will| need to| have to| must) (now )?(do|...)\b/,
  // ...
] as const
```

**Expected savings:** Minor (sub-millisecond per call) but eliminates GC pressure in multi-turn sessions. The bigger gain is that moving the patterns out makes it easier to benchmark and tune the false-positive rate separately.

---

### C4. Workload-Gated Discipline Observations (per-iteration post-tool overhead)
**File:** `src/query.ts:2137–2153`

`applySaturationObservation()` is called after every tool batch. At discipline level 0, it's already short-circuited by the `state.loopDiscipline.level === 0` guard at query.ts:2138. But `evaluateForcedPlan()` and `evaluateVerificationLiveness()` run unconditionally after that. Neither is expensive, but they can be unified under the same guard:

```typescript
// query.ts:2155 — proposed:
if (state.loopDiscipline.level >= 2) {
  const forcedPlan = evaluateForcedPlan(nextLoopDiscipline)
  // ...
  const livenessWarning = evaluateVerificationLiveness(...)
  // ...
}
```

---

### C5. Defer or Parallelize Multi-Turn-Context DB Writes
**File:** `src/query.ts:1767–1796` (MULTI_TURN_CONTEXT and CONVERSATION_ARC blocks)

Both `updateArcPhase()` and `finalizeArcTurn()` are `await`ed on the post-tool critical path (before the next API call). For a simple `"hello"` these are no-ops at the data level but still incur dynamic `import()` + async function overhead. Convert to fire-and-forget (`void`) or move behind a `loopWorkload !== 'direct'` guard.

---

### C6. Eliminate False-Positive Continuation Nudges for Completion-Signaling Text
**File:** `src/query.ts:1636–1638`

The `completionMarkers` check (`done|finished|completed|let me know if|hope this helps`) runs ONLY if a continuation signal matched first. Invert the order: check for completion markers before the continuation signal scan to exit the whole block cheaply on the most common "task is done" path.

```typescript
// query.ts — reorder:
const completionMarkers = /\b(done|finished|completed|...)\b/
if (completionMarkers.test(lastText)) {
  // skip continuation scan entirely
} else if (continuationSignals.some(re => re.test(lastText))) {
  // ... nudge
}
```

---

### C7. Direct Classification Gap: "bounded" Classification of Trivial Mutations
**File:** `src/types/loopDiscipline.ts:406–453`

`MUTATION_REQUEST_PATTERN` matches extremely broad verbs: `add|build|change|code|create|delete|edit|fix|implement|install...`. The prompt `"fix this typo"` gets `bounded` and activates the continuation nudge gate. Consider a secondary check: if the prompt is short (`length <= 120`) AND matches only MUTATION_PATTERN (not LONG_RUNNING), treat it as `bounded-simple` and reduce nudge aggressiveness (e.g. 1 max nudge instead of 3) rather than full `bounded` treatment.

---

## Summary Table

| Mechanism | File:line | Active by default | Latency for simple query |
|---|---|---|---|
| Continuation nudge | `query.ts:1596` | Yes (but level 0) | <1ms (regex scan only) |
| Completion exit gate | `query.ts:1668` | Only at level>=2 | 0ms at level 0 |
| Token budget continuation | `query.ts:1545` | Feature flag | 0ms if off |
| Max-output-tokens recovery | `query.ts:1419` | Always | 0ms (only fires on token hit) |
| Stop hook chain | `query.ts:1502` + `stopHooks.ts:65` | Always | **~80–200ms** (subprocess spawns) |
| Mnemo auto-recall (blocking) | `query.ts:397` | Env flag | 50–300ms if on |
| Plan handoff injection | `query.ts:619` | When plan active | 0ms if no plan |
| Ralph anti-idle (UserPromptSubmit) | `ralph-anti-idle.sh` | When ralph active | ~30–80ms if ralph active |
| Ralph mode enforcer (PreToolUse) | `ralph-mode-enforcer.sh` | When ralph active | ~15–50ms per tool call |
| Skill discovery prefetch | `query.ts:464` | Feature flag | Minimal (async) |

---

**Highest-leverage single fix:** Add a `loopDiscipline.workload === 'direct'` guard at the top of `handleStopHooks()` in `src/query/stopHooks.ts`. This eliminates the subprocess hook spawn chain (~80–200ms) for every simple Q&A response — the largest controllable overhead on the direct-query path. The workload classification (`direct` for `classifyLoopWorkloadFromPrompt`) already runs at loop entry and is available on `ToolUseContext` via `getLoopDiscipline()`. The change is 3 lines and has no interaction with any other mechanism.
