# Agent Loop Harness Notes

Date: 2026-06-10

This note records the harness decisions behind Limitless's long-running agent-loop work.

## Inputs

- Local loop discipline implementation: `src/types/loopDiscipline.ts`, `src/query.ts`, `src/services/tools/loopDisciplineHooks.ts`.
- Local Maestro reference: `/Users/verickwayne/Projects/ruflo/v2/src/maestro`.
- Anthropic long-running harness guidance: initializer/coding split, feature ledger, progress notes, git history, and one-feature-at-a-time execution.
- Claude Code practice guidance: verification signal, explore-plan-code separation, subagents for investigation, parallel sessions, hooks, and skills.

## What Changed

- Loop discipline now records a `workload` class and uses adaptive level resolution. Direct Q&A runs with discipline level 0 even if the operator configured strict discipline, unless `OPENCLAUDE_DISCIPLINE_PROFILE=always` is set.
- Implementation and long-running prompts keep the configured discipline level, preserving phase gates, saturation redirect, forced plan, and verification ledger behavior.
- `/longtask` was added as a bundled skill. It creates or updates `.openclaude/longtask.json` as a durable source of truth for work that may span context windows.
- `orchestration` was added as a built-in read-only agent. It decomposes large requests into work items, parallel groups, persistent artifacts, provider/model classes, and completion gates.

## Design Rules

- Keep direct-answer turns fast. Do not expose long-horizon machinery unless the prompt implies implementation or multi-step work.
- Make durable artifacts explicit. For long work, a JSON ledger is easier to resume and less likely to drift than prose-only progress notes.
- Separate roles by context cost. Use fast search/summarization models for discovery, stronger models for architecture and implementation, and an independent verifier for non-trivial implementation.
- Treat verification as an executable signal: a command, build, test, browser check, or other observable result.
- Let model choice be a routing decision. The orchestration plan should name the model class needed for each work item, not assume the main thread model is best for every subtask.
