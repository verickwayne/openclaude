# OpenClaude Harness Improvement — Synthesis & Priorities

Synthesizes `01-internal-loop-audit.md`, `02-sota-harness-practices.md`,
`03-anthropic-recent-tools.md`, `04-maestro-analysis.md`. Written by Claude
(Fable 5 orchestrator session) 2026-06-09 as the counterpart research track to
Codex's internal-loop work.

**Hard constraint carried through everything below:** NO alignment / safety /
guardrail / refusal language is to be added anywhere. Never edit the identity
layer (`prompts.ts`, `modelIdentity.ts`, `system.ts`, `cyberRiskInstruction.ts`).
These recommendations are neutral engineering only.

## The core tension to resolve

The completion-forcing additions (anti-idle, continuation nudges, mandatory
stop-hook chains, blocking mnemo recall, discipline phases) were added to beat a
training bias toward stopping early / favoring completion-signal over real
completion. They work for long autonomous runs but tax EVERY turn — including
`"hello"`. The fix is not to remove them; it's to make them **conditional on a
cheap, early workload classification** so trivial turns take the fast path and
only genuine multi-step work pays the discipline tax.

The good news (from 01): the classifier already exists.
`classifyLoopWorkloadFromPrompt()` (`loopDiscipline.ts:420`) already tags
`"hello"` as `direct`. It just isn't plumbed into the three hot paths.

## Priority 1 — Latency: gate completion-forcing on workload class (the fast path)

This is the single highest-leverage change and directly fixes the user's
complaint. All three are small and additive.

1. **Stop-hook fast path.** `handleStopHooks()` (`src/query/stopHooks.ts:65`)
   runs the full subprocess hook chain (ralph-anti-idle, completion-detector,
   etc.) on every no-tool-call turn unconditionally (~80–200ms even when ralph is
   inactive). Add at the top:
   `if (loopDiscipline?.workload === 'direct') return { blockingErrors: [], preventContinuation: false }`.
   `loopDiscipline` is already available via `toolUseContext.getLoopDiscipline?.()`.
2. **Mnemo auto-recall: skip or defer for `direct`.** `query.ts:397–411` blocks
   the first model call on an MCP `mnemo_recall` round-trip (50–300ms) for every
   query when `OPENCLAUDE_MNEMO_AUTO_RECALL=1`. For `direct` workloads, skip it
   (or fire-and-forget so it never blocks the first token).
3. **Continuation-nudge gate + precompile.** `query.ts:1596–1666` re-evaluates
   (and re-allocates) 6+ regexes each iteration; hoist them to module scope and
   only run the nudge logic when `workload !== 'direct'`.

Net effect: a trivial Q&A turn skips the subprocess chain, the blocking recall,
and the nudge scan — the bulk of controllable per-turn overhead.

## Priority 2 — Provider/model-agnostic execution (leverage the multi-provider substrate)

The multi-provider routing shipped this session (ResolvedProvider + registry +
per-request override) is the substrate. Now USE it inside the loop:

1. **Per-step model routing** (02 §5, 04 tiered routing). Route loop *steps* by
   role: cheap/fast model (Haiku-class or a local model) for intent
   classification, triage, and the stop-condition check; mid-tier for tool
   selection/synthesis; frontier (Opus 4.8 / Fable 5) only for hard multi-hop
   reasoning. Maestro's 3-tier selector + per-phase timeouts (`04` §1) is the
   reference shape. This is both a latency AND cost win and is only possible now
   that the harness is model-agnostic.
2. **Separate checker model for the completion/stop decision** (02 §2). Don't let
   the main agent grade its own "am I done?" — run a small fast model against
   *machine-verifiable* criteria. Removes self-grading bias in BOTH directions
   (over-claiming and doom-looping). Pairs with the workpad below.
3. **Cross-provider `effort` + thinking normalization** (03). Normalize the
   `effort`/thinking surface across providers; add the Fable 5 guard (omit
   `thinking` entirely rather than `disabled` — sending `{type:'disabled'}` 400s).

## Priority 3 — Mechanical completion without over-running

Aligns with the user's "completion measured mechanically, not by feel" rule.

1. **Workpad / checklist as canonical state** (02 §3, 04 file-backed artifacts).
   For an autonomous run, write `WORKPAD.md` with acceptance criteria up front;
   the completion check reads that file + CI/test state, not the model's
   narrative. Highest-ROI pattern for quality-preserving completion. Also gives
   free checkpoint/resume.
2. **Stall detection with escalation, not infinite retry** (02 §7, 04 §5). Detect
   same-action-repeated-N-times → `stalled` state → route to human/escalation
   rather than burning frontier tokens. A lightweight fast-model progress check
   every ~3 turns is cheaper than a stuck loop.
3. **Observation masking** (02 §4). Replace old tool outputs in context with
   one-line summaries (cheaper than LLM compaction, and avoids LLM summarization
   inadvertently extending trajectories 13–15% by hiding stop signals).

## Priority 4 — Adopt recent Anthropic tooling (03), provider-agnostically

Reimplement these as harness features that work across providers (not Anthropic-only):
- **Tool-result clearing / context editing** for long runs (big token savings).
- **`/goal`-style condition-driven loop** — run until a stated condition holds
  (maps directly to the user's mechanical-completion rule).
- **Task budgets** (`output_config.task_budget`) — advisory token budget threaded
  across compaction for long-horizon continuity.
- **Hooks as hard enforcement** (02 §8) — invariants belong in PreToolUse/
  PostToolUse hooks, not prompts (and NOT as alignment language — purely
  mechanical things like auto-format-on-write, read-only-tools-in-plan-mode).
- **Streaming parallel tool execution** (02 §6) — run read-only concurrent-safe
  tools in parallel as they stream; dominant latency win, no quality tradeoff.

## Priority 5 — Agent & skills library additions (capability surface)

Candidates that give the model more capability without touching identity:
- A **complexity-router** primitive/skill (the fast classifier from P1, exposed).
- A **verifier/checker** subagent (cheap model, machine-criteria) for P2.2 / P3.1.
- A **stall-detector** subagent (P3.2).
- **Provider-routing helpers** so subagent dispatch can pick model-by-capability
  (Maestro's capability-scored selection + Mnemo episodic success-rate history,
  04 §6).
- A **workpad** skill (init acceptance criteria, check against CI/tests).

## Sequencing note vs Codex

Codex is implementing the internal-loop changes. To avoid collision: my track's
**unique, likely-unfilled** angles are (a) the per-step/provider-agnostic model
routing INSIDE the loop (uses my multi-provider substrate), (b) the
separate-checker-model stop decision, (c) the workpad/mechanical-completion
file, and (d) the skills/agents additions. The P1 latency fast-path is the most
likely thing Codex ALSO targets — at the 1-hour check, diff his work and only
fill what's missing; don't duplicate.
