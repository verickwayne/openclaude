# Local skill discovery

`LocalSkillSearch` searches native project, user, plugin and MCP skill metadata
without executing a skill. It excludes skills that disable model invocation.
Use task keywords, then invoke `Skill` with a returned name to load the original
instructions, permissions, scripts and linked resources.

An empty query browses all entries. Results are paginated (default five, maximum
twenty) and capped at 6,000 characters; continue with `next_offset`. Skill bodies
are loaded only through the original Skill tool.

When a skill-listing attachment exceeds 4,000 characters and LocalSkillSearch is
available, the attachment becomes a short discovery guide. Agents without the
search tool keep their existing listing. Small catalogs also remain complete.
No files or skills are disabled. Previously sent conversation messages are not
rewritten.

This checkout is based on the user-owned OpenClaude fork, separate from the old
OpenClaude directories that now contain Limitless. Launch this standalone build
with `openclaude-context`; the existing Limitless checkouts and launchers are
outside this change.

Validation: seven focused tests pass, the CLI and SDK build, and dependency and
SDK declaration checks pass. Full TypeScript checking reports the same 1,705
diagnostics as the unmodified fork, with no new diagnostic signatures after
normalizing checkout paths and line positions.

A native CLI conversation against a local test model endpoint indexed 100
project fixture skills, emitted the short startup guide, found the exact
requested skill through LocalSkillSearch, and completed a second model turn.
The test keeps project settings enabled because disabling that source also
disables project skill discovery. It marks the fixture provider environment as
fully configured to avoid the fork's existing Codex default-profile fallback.
