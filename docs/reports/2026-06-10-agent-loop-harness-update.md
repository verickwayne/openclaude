# Agent Loop Harness Update

Date: 2026-06-10

Branch: `feat/multi-provider`

## Summary

This report is cumulative for the June 10 OpenClaude harness work. It covers:

1. The internal agent-loop harness update that improves long-running autonomous work while reducing overhead for simple direct-answer prompts.
2. The follow-up OpenRalph workstream: a Ralph-style skill and supporting process architecture for OpenClaude that lives outside the internal harness.
3. The Ralph session-scoping follow-up: both OpenClaude OpenRalph and Claude Code CLI Ralph now bind mutable scheduler files to a specific session, not just a project folder.

## What Changed

### Internal Harness Update

1. Adaptive loop-discipline activation
   - Added `LoopWorkloadClass` and workload classification in `src/types/loopDiscipline.ts`.
   - `src/query.ts` now classifies the latest user prompt before initializing loop discipline.
   - Direct Q&A prompts run with effective discipline level `0` under the default adaptive profile, even when `OPENCLAUDE_IN_LOOP_DISCIPLINE` is configured.
   - Implementation and long-running prompts keep the configured discipline level.
   - Operators can force old behavior with `OPENCLAUDE_DISCIPLINE_PROFILE=always`.

2. Loop status visibility
   - `GetLoopDisciplineStatus` now reports `workload`, so the model and operator can tell when the fast path was chosen.

3. Durable long-task skill
   - Added bundled `/longtask`.
   - The skill creates or updates `.openclaude/longtask.json` for work that may span context windows.
   - The ledger tracks objective, required items, verification commands, current focus, and handoff notes.

4. Built-in orchestration agent
   - Added a read-only `orchestration` built-in agent.
   - It decomposes large tasks into work items, dependencies, parallel groups, persistent artifacts, provider/model classes, and completion gates.

5. Architecture note
   - Added `docs/architecture/agent-loop-harness.md` to record design decisions and local source references.

### OpenRalph Workstream

1. Bundled OpenRalph skills
   - Added `/openralph` with aliases `/ralph`, `/ralph-engage`, and `/openralph-engage`.
   - Added `/openralph-status`, `/openralph-resume`, and `/openralph-disengage`.
   - These are skill/process commands, not internal loop changes.

2. Project-local support files
   - `/openralph` extracts support files that can be installed into `.openclaude/ralph/bin/`.
   - `openralph-bootstrap.sh` creates `.openclaude/ralph/` state, queue, progress, goal, current-task, persona-result, session, and bridge directories.
   - `openralph-hook.sh` reads OpenClaude hook stdin JSON, records `session_id`, event, tool, cwd, and transcript path, and keeps unfinished OpenRalph sessions visible through the Stop hook.
   - `openralph-status.sh` and `openralph-disengage.sh` provide operational status and state-preserving shutdown.

3. Hook/session bridge
   - The OpenRalph hook architecture intentionally ports the useful part of Claude Ralph's session bridge into OpenClaude.
   - It uses OpenClaude's existing hook payload fields, especially `session_id`, `cwd`, and `transcript_path`.
   - The hook reads stdin first and falls back to environment variables, which makes it work across normal CLI sessions and subprocess contexts.

4. Goal-led scheduler pattern
   - OpenRalph borrows the newer Claude Code `/goal` concept: a concrete completion condition lives in `.openclaude/ralph/goal.json`.
   - The Stop hook blocks ordinary stopping while `goal.json.status` is still running, telling the next turn to resume from OpenRalph files.
   - Unlike native `/goal`, this layer is project-local and inspectable. The proof trail lives in `progress.md` and the goal ledger.

5. Persona agents
   - Added built-in `openralph-builder`, `openralph-refiner`, `openralph-researcher`, and `openralph-test-analyzer` agents.
   - Each persona reads `.openclaude/ralph/current-task.md` and returns structured YAML for the scheduler.
   - Persona results include `provider_model_used` so OpenRalph can use OpenClaude's provider/model-agnostic model picker intentionally.

6. Architecture note
   - Added `docs/architecture/openralph.md` to explain how the skill/process layer maps Ralph, `/goal`, `/loop`, hooks, and provider routing onto OpenClaude.

### Session-Scoped Ralph Follow-Up

1. OpenClaude OpenRalph
   - Moved mutable scheduler files to `.openclaude/ralph/sessions/<session_id>/`.
   - Kept `.openclaude/ralph/active-session` and `.openclaude/ralph/active-session.json` as project-level indexes only.
   - Updated `openralph-hook.sh` so hook events are written to both project-level `events.jsonl` and session-level `sessions/<session_id>/events.jsonl`.
   - Updated Stop-hook blocking text, status, resume, disengage, persona prompts, docs, and tests to target the session directory.

2. Claude Code CLI Ralph
   - Added shared helpers in `~/.claude/scripts/ralph-lib.sh` for resolving and linking project-local session directories.
   - Updated `~/.claude/scripts/ralph-scheduler-bootstrap.sh` to create `.ralph/sessions/<session_id>/` and symlink legacy `.ralph/progress.md`, `queue.md`, `current-task.md`, `persona-result.yml`, and related files into that session directory.
   - Updated `~/.claude/ralph/scripts/setup-loop.sh` to re-run scheduler bootstrap with the resolved Claude session id after the session state file is created.
   - Updated supporting scripts that write/read Ralph scheduler files: `ralph-subagent-log.sh`, `ralph-tool-failure-capture.sh`, `ralph-precompact-snapshot.sh`, `ralph-state-write-guard.sh`, `ralph-completion-detector.sh`, `ralph-mode-enforcer.sh`, `ralph-deny-watcher.sh`, `outcome-gate.sh`, and `ralph/hooks/stop-hook.sh`.
   - Kept compatibility symlinks so existing Ralph prompts and older tooling keep working while the actual files are session-scoped.

## Why

The existing loop-discipline system has useful long-running work primitives: phases, saturation redirect, forced plan, and verification ledger. The performance problem is that those primitives can be too heavy for simple questions when discipline is enabled.

The adaptive workload gate preserves strict behavior for real implementation work while skipping the harness for one-turn direct answers. The `/longtask` skill and `orchestration` agent add durable state and delegation planning without making every turn pay that cost.

OpenRalph addresses a different layer. Ralph's strongest property is operational: persistent state, session bridging, persona dispatch, status/resume/disengage, and stop-time pressure to keep working. OpenClaude already has hooks, session ids, provider routing, and skills, so the better port is not a direct copy of Claude scripts. It is a project-local process layer that uses those primitives and improves Ralph with a goal ledger and provider/model routing.

## Research Inputs

- Anthropic long-running harness guidance: https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents
- Anthropic harness design for long-running application development: https://www.anthropic.com/engineering/harness-design-long-running-apps
- Claude skill authoring best practices: https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices
- Claude Managed Agents overview: https://platform.claude.com/docs/en/managed-agents/overview
- Claude Code `/goal`: https://code.claude.com/docs/en/goal
- Claude Code scheduled tasks and `/loop`: https://code.claude.com/docs/en/scheduled-tasks
- Claude Code dynamic workflows: https://code.claude.com/docs/en/workflows
- Claude Code hooks: https://code.claude.com/docs/en/agent-sdk/hooks
- Claude Code Week 20 `/goal` release note: https://code.claude.com/docs/en/whats-new/2026-w20
- Local Maestro reference: `/Users/verickwayne/Projects/ruflo/v2/src/maestro`
- Local Claude Ralph reference: `/Users/verickwayne/.claude/ralph` and `/Users/verickwayne/.codex/skills/claude-command-ralph-engage/SKILL.md`

## Verification

Commands run:

```bash
bun test src/types/loopDiscipline.test.ts src/types/loopDiscipline.end-to-end.test.ts src/types/loopDiscipline.acord-prevention.test.ts src/services/tools/loopDisciplineHooks.test.ts src/tools/LoopDisciplineTools/LoopDisciplineTools.test.ts src/tools/LoopDisciplineTools/GetLoopDisciplineStatusTool.test.ts src/tools/LoopDisciplineTools/discipline-tools.integration.test.ts src/tools/LoopDisciplineTools/EmitVerificationTool.test.ts src/skills/bundled/loop.test.ts
```

```bash
bun test src/tools/AgentTool/agentToolSchema.test.ts src/tools/AgentTool/loadAgentsDir.test.ts src/tools/AgentTool/dispatchOverride.test.ts src/utils/model/agent.test.ts src/components/ProviderManager.test.tsx src/commands/model/multiProvider.test.ts src/services/api/mainLoopRouting.test.ts src/types/loopDiscipline.test.ts src/tools/LoopDisciplineTools/GetLoopDisciplineStatusTool.test.ts
```

```bash
bun test src/skills/bundled/longTask.test.ts src/skills/bundled/loop.test.ts src/types/loopDiscipline.test.ts src/tools/LoopDisciplineTools/GetLoopDisciplineStatusTool.test.ts
```

```bash
bun run build
```

```bash
git diff --check
```

Additional OpenRalph verification:

```bash
bun test src/skills/bundled/openRalph.test.ts src/skills/bundled/longTask.test.ts
```

Additional Ralph session-scoping verification:

```bash
bash -n ~/.claude/scripts/ralph-lib.sh ~/.claude/scripts/ralph-scheduler-bootstrap.sh ~/.claude/ralph/scripts/setup-loop.sh ~/.claude/scripts/ralph-subagent-log.sh ~/.claude/scripts/ralph-tool-failure-capture.sh ~/.claude/scripts/ralph-precompact-snapshot.sh ~/.claude/scripts/ralph-state-write-guard.sh ~/.claude/scripts/ralph-completion-detector.sh ~/.claude/scripts/ralph-mode-enforcer.sh ~/.claude/scripts/ralph-deny-watcher.sh ~/.claude/scripts/outcome-gate.sh ~/.claude/ralph/hooks/stop-hook.sh
```

```bash
tmp=$(mktemp -d); cd "$tmp"; git init -q; touch .gitignore; RALPH_SESSION_ID=test-session-123 bash ~/.claude/scripts/ralph-scheduler-bootstrap.sh --session-id test-session-123
```
