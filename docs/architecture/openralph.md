# OpenRalph Architecture

OpenRalph is a project-local skill and process layer for long-running OpenClaude work. It is intentionally outside the internal query loop.

## Design

- Skills expose the operator surface: `/openralph`, `/openralph-status`, `/openralph-resume`, `/openralph-disengage`, and `/openralph-kick`.
- Support scripts live under `.openclaude/ralph/bin/` after installation.
- Persistent scheduler state is session-scoped under `.openclaude/ralph/sessions/<session_id>/`.
- `.openclaude/ralph/active-session` is only a project-local pointer to the default session for status/resume commands.
- Hooks in `.claude/settings.local.json` call `openralph-hook.sh`.
- The hook reads OpenClaude hook stdin JSON and records `session_id`, event name, tool name, cwd, and transcript path.
- `goal.json` is the session's explicit completion condition, borrowing the useful part of Claude Code `/goal`.
- `queue.md`, `current-task.md`, `progress.md`, `events.jsonl`, and `persona-result.yml` live in the session directory and make scheduler state inspectable and resumable without colliding with other sessions in the same project.

## Forced Engagement

`/openralph-kick` installs and invokes `openralph-kick.sh`, the deterministic fallback for cases where a slash command was typed but the model did not actually run the loop setup. It can be run from another terminal:

```bash
bash .openclaude/ralph/bin/openralph-kick.sh --session <session_id_or_prefix>
```

For existing state, the script reactivates `.openclaude/ralph/enabled`, rewrites `active-session`, writes `sessions/<session_id>/kick.json`, and appends `kick-log.jsonl` plus project events. For missing state, it requires `--prompt` or `--prompt-file` and then bootstraps that exact session id through `openralph-bootstrap.sh`.

## Persona Agents

OpenRalph adds four built-in persona agents:

- `openralph-builder`: one atomic implementation dispatch.
- `openralph-refiner`: completeness and edge-case pass.
- `openralph-researcher`: bounded research with findings under `.openclaude/ralph/sessions/<session_id>/research/`.
- `openralph-test-analyzer`: diagnosis for failed tests without editing code.

Each persona returns structured YAML and includes `provider_model_used` so the scheduler can make provider/model routing visible.

## Improvement Over Claude Ralph

Claude Ralph proved that session bridges, stop-time pressure, durable state files, and persona dispatch improve long-running work. OpenRalph keeps those mechanics but adapts them to OpenClaude:

- hook bridge uses OpenClaude's native hook payload rather than Claude-specific PPID bridge files;
- goal state is explicit, inspectable, and tied to a specific session id;
- provider/model routing is part of the persona result contract;
- status/resume/disengage are skill commands instead of shell-only commands;
- kick is available as both a slash skill and an external terminal script, so loop engagement does not depend on one model turn choosing to follow the slash-command instructions;
- support files are bundled with the CLI and installed per project.
