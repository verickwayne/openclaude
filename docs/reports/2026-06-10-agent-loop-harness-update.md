# Agent Loop Harness Update

Date: 2026-06-10

Branch: `feat/multi-provider`

## Summary

This update improves OpenClaude's internal agent-loop harness for long-running autonomous work while reducing overhead for simple direct-answer prompts.

## What Changed

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

## Why

The existing loop-discipline system has useful long-running work primitives: phases, saturation redirect, forced plan, and verification ledger. The performance problem is that those primitives can be too heavy for simple questions when discipline is enabled.

The adaptive workload gate preserves strict behavior for real implementation work while skipping the harness for one-turn direct answers. The `/longtask` skill and `orchestration` agent add durable state and delegation planning without making every turn pay that cost.

## Research Inputs

- Anthropic long-running harness guidance: https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents
- Anthropic harness design for long-running application development: https://www.anthropic.com/engineering/harness-design-long-running-apps
- Claude skill authoring best practices: https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices
- Claude Managed Agents overview: https://platform.claude.com/docs/en/managed-agents/overview
- Local Maestro reference: `/Users/verickwayne/Projects/ruflo/v2/src/maestro`

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
