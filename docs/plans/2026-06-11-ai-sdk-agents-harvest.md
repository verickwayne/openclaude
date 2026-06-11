# AI SDK Agents Harvest

## Context

The Claude Code plugin `ai-sdk-agents@claude-code-plugins-plus` was evaluated on 2026-06-11 as a possible source of multi-agent orchestration ideas for Limitless.

Decision:

- Do not vendor the plugin into Limitless.
- Do not add `@ai-sdk-tools/agents` as a runtime dependency.
- Treat the plugin as a concept source for native Limitless agent/team ergonomics.

Rationale:

- Limitless already has native agent definitions, subagent spawning, per-agent model routing, background execution, worktree isolation, and team/swarm concepts.
- The plugin mostly scaffolds a separate TypeScript AI SDK application rather than extending a coding-agent harness.
- Several plugin artifacts are stale or brittle: nonexistent `@ai-sdk/core` imports, old hard-coded Anthropic model names, CJS-style `require.main` examples inside ESM TypeScript snippets, and generic generated scripts mislabeled as shell scripts.

## Native Limitless Opportunities

### Handoff Graphs

Add a first-class way to describe expected handoffs between agents in docs or agent metadata.

Useful shape:

```json
{
  "agents": ["coordinator", "researcher", "implementer", "reviewer"],
  "handoffs": [
    { "from": "coordinator", "to": "researcher", "reason": "requirements unclear or source validation needed" },
    { "from": "researcher", "to": "implementer", "reason": "research complete" },
    { "from": "implementer", "to": "reviewer", "reason": "diff ready for review" }
  ],
  "maxDepth": 4,
  "fallback": "coordinator"
}
```

This should be documentation or native metadata first, not a new orchestration library.

### Workflow Observability

Expose or document per-task workflow diagnostics for native Limitless teams:

- agents involved,
- model/provider used per agent,
- handoff count,
- elapsed time per agent,
- terminal status,
- output artifact path,
- failure or timeout reason.

The existing task, agent, and outcome-ledger surfaces should be reused before adding new storage.

### Circuit Breakers

Document and, if needed, enforce native guards for runaway agent workflows:

- max handoff depth,
- per-agent timeout,
- workflow deadline,
- repeated handoff loop detection,
- partial-result fallback.

This belongs near the existing AgentTool, team, and task orchestration docs.

### Guided Team Setup

Consider a `/limitless-team create` or docs-backed wizard that generates native Limitless agent/team metadata from a simple workflow description.

It should produce Limitless-native artifacts only:

- agent definitions,
- model routing snippets for `~/.limitless.json`,
- allowed tool lists,
- optional MCP requirements,
- a verification checklist.

It should not create a standalone `@ai-sdk-tools/agents` TypeScript app.

## Non-Goals

- No dependency on `@ai-sdk-tools/agents`.
- No separate TypeScript agent framework inside Limitless.
- No duplicated provider abstraction outside the existing Limitless provider stack.
- No import of the plugin's generated scaffolding as production code.

## Suggested Next Step

Fold the strongest pieces into `docs/architecture/limitless-agent-ecosystem.md` after choosing the exact user-facing surface:

- docs-only pattern,
- agent metadata extension,
- slash-command wizard,
- or task/outcome-ledger observability improvement.
