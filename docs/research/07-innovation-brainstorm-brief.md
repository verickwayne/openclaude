# Innovation Brainstorm Brief (T6 input)

Prepared 2026-06-09 by the Fable 5 orchestrator for the mission-priority-3
brainstorm ("what can we do that no one is doing but someone should be doing"),
to be run WITH a `model: fable` agent once the fix wave lands.

Hard constraints carried through: no alignment/safety/guardrail/refusal
language; identity layer untouchable; everything provider-agnostic.

## Seed angles (from 05-synthesis, verified still unclaimed by Codex's commits)

1. **Per-step model routing inside the loop.** The multi-provider substrate
   (ResolvedProvider + registry + per-request override) exists; nobody routes
   loop *steps* by role yet: cheap model for intent triage and stop-condition
   checks, mid-tier for tool selection, frontier only for multi-hop reasoning.
   Maestro's 3-tier selector (~/Projects/ruflo/v2/src/maestro) is the reference
   shape. Latency + cost win unlocked by work already merged.

2. **Separate checker model for the stop/completion decision.** The agent that
   did the work should not grade "am I done?" — a small fast model evaluating
   machine-verifiable criteria (tests green, files exist, goal.json condition)
   removes self-grading bias in both directions (over-claiming AND
   doom-looping). Pairs with the OpenRalph goal ledger Codex shipped: the
   goal-gate currently re-prompts the same model; route that check to a cheap
   checker with the provider-agnostic picker.

3. **Workload-class-aware everything.** e13382b classified workloads but only
   gated discipline phases (T8 extends to the 3 hot paths). The classification
   is a primitive — route ALL per-turn taxes through it: memory prefetch,
   transcript-size telemetry, dispatch-log verbosity.

4. **Session-owned loop state as a first-class concept** (Verick directive,
   Codex implementing for OpenRalph, infra already migrated `.ralph/` to
   sessions/<sid>/). Next step nobody's doing: cross-session loop *lineage* —
   a resumed/adopted loop records its ancestor chain, so progress/blockers
   survive orphaning with provenance, and two sessions can NEGOTIATE handoff
   (current collision answer is still "refuse or override").

5. **Observation masking** (02 §4): replace stale tool outputs with one-line
   summaries instead of LLM compaction — cheaper, and avoids the documented
   13-15% trajectory-extension effect of summarization hiding stop signals.

## Questions for the Fable 5 brainstorm partner

- Which of 1-5 compounds with the others rather than competing?
- What does the multi-provider substrate enable that single-provider harnesses
  structurally cannot copy? (That's the moat question.)
- What's the smallest shippable slice of per-step routing that proves the
  pattern without a config explosion?

## Inputs to hand the brainstorm agent verbatim

- This file, 05-synthesis.md §P2/P3, and the T8 commit diff (once landed).
- Codex's docs/architecture/agent-loop-harness.md + openralph.md (post-commit).
