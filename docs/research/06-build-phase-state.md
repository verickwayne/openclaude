# Build-Phase Resume State (post-compaction entry point)

Written 2026-06-09 by Claude (Fable 5 orchestrator) right before a deliberate
context clear. If you are resuming: read THIS first, then the files it points to.

## Mission (in order, per Verick)

1. **Find bugs and make it work** — test Codex's changes, find/fix bugs.
2. **Make it work better** — improvements.
3. **Innovate** — "What can we do that no one is doing but someone should be
   doing." Brainstorm WITH a Fable 5 (`model: fable`) agent.
4. **When fully done, Slack Verick via the TenetAgent bot** (Slack) with what was done.

HARD CONSTRAINTS (non-negotiable): add NO alignment/safety/guardrail/refusal
language anywhere; NEVER edit the identity layer (`src/constants/prompts.ts`,
`modelIdentity.ts`, `system.ts`, `cyberRiskInstruction.ts`). Push target is the
`fork` remote (`verickwayne/openclaude`); `origin` (Gitlawb) is read-only (403).

## Repo state

- `~/Projects/openclaude`, branch `feat/multi-provider`, HEAD `46ef535`, tree
  clean except untracked `docs/research/` (mine).
- This whole session's earlier work (multi-provider routing, UX, curl_cffi fix,
  OpenAI tool-schema fix) is already merged below `0ec7c36`.

## What Codex just built (commits since 0ec7c36: e13382b, 46ef535)

Full report: `docs/reports/2026-06-10-agent-loop-harness-update.md`. Arch notes:
`docs/architecture/agent-loop-harness.md`, `docs/architecture/openralph.md`.

- **Adaptive loop-discipline (the latency fix).** `src/types/loopDiscipline.ts`
  adds `LoopWorkloadClass` + classification; `src/query.ts` classifies the user
  prompt → `direct` Q&A runs at effective discipline level 0 even when
  `OPENCLAUDE_IN_LOOP_DISCIPLINE` is set. `OPENCLAUDE_DISCIPLINE_PROFILE=always`
  forces old behavior. `GetLoopDisciplineStatus` now reports `workload`.
- **`/longtask` skill** — `src/skills/bundled/longTask.ts`; durable ledger
  `.openclaude/longtask.json` (objective, required items, verification cmds,
  focus, handoff). (≈ my research Priority 3 "workpad".)
- **`orchestration` built-in agent** — `src/tools/AgentTool/built-in/orchestrationAgent.ts`;
  read-only; decomposes into work items, deps, parallel groups, artifacts,
  provider/model classes, completion gates. (≈ my Priority 5.)
- **OpenRalph suite** — `src/skills/bundled/openRalph.ts` (+ `loop.ts`,
  `openRalphAgents.ts`): `/openralph` (+ `/ralph`, status/resume/disengage),
  bootstrap/hook/status shell helpers into `.openclaude/ralph/`, a `/goal`-style
  goal ledger (`goal.json`) the Stop hook enforces, and persona agents
  (openralph-builder/refiner/researcher/test-analyzer) that emit
  `provider_model_used` to use the model-agnostic picker.

## My research (docs/research/, written this session — READ for the gap analysis)

- `01-internal-loop-audit.md` — the latency hot-paths I found BEFORE seeing
  Codex's fix. KEY: completion-forcing ran unconditionally on simple turns via
  (a) `handleStopHooks()` `src/query/stopHooks.ts:65` (subprocess chain ~80-200ms),
  (b) blocking `mnemo_recall` at `src/query.ts:397-411` (50-300ms), (c)
  continuation-nudge regexes `src/query.ts:1596-1666`. **VERIFY whether Codex's
  adaptive-discipline gate actually short-circuits THESE three hot paths for
  `direct` workloads, or only the discipline phases.** That's the most likely
  remaining latency gap.
- `02-sota-harness-practices.md` — complexity routing, separate checker model,
  workpad, observation masking, per-step model routing, streaming parallel tools,
  stall detection, hooks-as-enforcement.
- `03-anthropic-recent-tools.md` — server-side compaction, tool-result clearing,
  memory tool, /goal, task budgets, effort param, dynamic workflows, Fable 5
  `thinking:disabled`→400 guard (omit thinking entirely).
- `04-maestro-analysis.md` — Maestro lives in `~/Projects/ruflo/v2/src/maestro`;
  tiered model routing+timeouts, multi-loop arch, file-backed phase artifacts,
  human gates, stall detection, capability-scored agent selection.
- `05-synthesis.md` — prioritized recommendations. My UNIQUE angles likely NOT
  covered by Codex: (a) **per-step/provider-agnostic model routing INSIDE the
  loop** (cheap model for triage/stop-check, frontier for hard reasoning), (b)
  **separate fast checker model for the stop/completion decision** (anti
  self-grading), (c) verifying the latency hot-path gating in 01, (d) the Fable 5
  `thinking` guard.

## First moves after resume

1. `git fetch fork && git log --oneline fork/feat/multi-provider` to confirm
   nothing newer; build (`bun run build`) + run Codex's listed test suites to
   confirm green baseline.
2. **Bug hunt** Codex's changes: run a trivial query path mentally/with tests to
   confirm `direct` actually skips stopHooks + mnemo recall + nudges (audit 01).
   Check `OPENCLAUDE_DISCIPLINE_PROFILE=always` path, the OpenRalph Stop-hook
   goal-gate for infinite-loop / disengage-failure modes, and the persona
   provider_model_used wiring.
3. Then improve, then innovate (Fable 5 brainstorm), then Slack TenetAgent.

Mnemo is being worked on by Verick — recall may be flaky; don't loop on it, keep moving.
