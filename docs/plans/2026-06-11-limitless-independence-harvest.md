# Limitless Independence Harvest Recommendations

Date: 2026-06-11

Scope reviewed:

- Local Claude Code user assets under `/Users/verickwayne/.claude`, including agents, commands, references, plugin cache, and installed plugin metadata.
- Local Codex skill mirror entries derived from Claude Code plugin packs.
- Limitless/OpenClaude repo at `/Users/verickwayne/Projects/openclaude`, especially current bundled skills, tool surfaces, and agent ecosystem docs.
- Mac Mini OpenClaw/OpenClawd assets over Tailscale at `vernoncornett@100.78.242.66`, including `~/.openclaw`, OpenClaw plugin source under `~/projects/agent-memory/plugins`, MCP profiles, browser relay, and local skills.

Note: the Mac Mini filesystem uses the name `OpenClaw` in most paths. I treat that as the OpenClawd system the request refers to.

## Executive Recommendation

Limitless should not copy the Claude Code plugin cache or OpenClaw runtime wholesale. The useful material is mostly capability patterns, prompt contracts, plugin boundaries, and a few portable local assets.

For the public-facing Limitless product, prioritize:

1. A native memory lifecycle plugin interface modeled on OpenClaw's Mnemo memory extension.
2. A deterministic command/plugin API modeled on OpenClaw's `/pulse` command extension.
3. Sanitized MCP profile templates with env-var placeholders, not private server configs.
4. A browser relay capability that can attach to an existing user browser session with explicit opt-in.
5. A small set of structured workflow skills and agent prompt contracts harvested from Ralph, Superpowers, and Engineering Advanced Skills.
6. A privacy-first local session/transcript search and procedure-memory feature.

For the personal local version, preserve more aggressive and private workflow integrations:

- Ralph-style autonomous loops and local hooks.
- Claude Code bridge tooling as a temporary compatibility adapter only.
- Personal research, comms, sales, voice, and browser MCP profiles.
- Pulse-specific command routing.
- Finance/modeling scripts and private operational scripts.
- Local transcript search against existing `agent-memory` stores.

## Decision Rubric

Use these buckets when copying anything into Limitless:

- **Public core**: small, provider-neutral capability that strengthens the harness for most users.
- **Public optional pack**: valuable, but domain-specific or dependency-heavy; ship as an installable skill/plugin pack.
- **Personal local overlay**: useful for this machine or private workflows, but contains private assumptions, credentials, local paths, or one-user conventions.
- **Do not copy**: Claude Code dependent, redundant with Limitless, stale, too broad, or likely to bloat the product.

## Public Limitless Product

### Public Core Candidates

| Candidate | Source | Why it belongs | How to port |
| --- | --- | --- | --- |
| Memory lifecycle plugin interface | Mac Mini `~/.openclaw/extensions/memory-mnemo` and `~/projects/agent-memory/plugins/openclaw-memory-mnemo` | OpenClaw has useful hooks for `before_agent_start`, `agent_end`, `memory_recall`, `memory_store`, and `memory_forget`. Limitless should have a first-class, provider-neutral memory slot instead of treating memory as only another MCP. | Define a Limitless memory provider interface with lifecycle hooks, recall/store/forget schemas, redaction policy, and capture metadata. Keep Mnemo as one implementation, not the interface itself. |
| Deterministic command plugin API | Mac Mini `~/.openclaw/extensions/pulse-cmd` | Some workflows should bypass LLM routing when a command maps cleanly to scripts or APIs. This reduces latency, cost, and accidental behavior. | Add a command registration interface for slash commands that can parse args, call local tools, return structured output, and declare permissions. |
| Sanitized MCP profile templates | Mac Mini `~/.openclaw/mcp-profiles` and `~/.openclaw/mcp-servers/servers.json` | The profile idea is useful: browser, database, devops, research, voice, comms, and full profiles make MCP activation understandable. | Ship templates with server names, scopes, install notes, and env-var placeholders only. Do not copy private values or host-local absolute paths. |
| Existing-browser relay | Mac Mini `~/.openclaw/browser/chrome-extension` | Attaching to the user's active browser is a distinct capability from launching Playwright. It is valuable for authenticated workflows and inspection of real user state. | Port as an optional browser-relay plugin with explicit install, visible connection state, narrow localhost permissions, and docs for disable/removal. |
| Structured agent prompt contracts | Local `~/.claude/agents/ralph-*.md`; Superpowers `subagent-driven-development`; Engineering Advanced Skills reviewer/onboarding skills | Limitless already has teams, but these assets contain useful output contracts: builder, refiner, researcher, security reviewer, test analyzer, module explorer, spec reviewer, and code quality reviewer. | Convert only the best prompt contracts into Limitless-native agent templates or review stages. Avoid Claude Code-only hooks and path assumptions. |
| Session search and procedure memory | Local `~/.claude/commands/search-transcripts.md` and `store-procedure.md` | Users need to find prior sessions and promote repeated procedures into durable memory. This fits Limitless independence and reduces dependence on Claude transcript storage. | Build a local transcript index under `.limitless/` with redaction and opt-in. Add a procedure store backed by Limitless memory, with export/import. |
| Quality gate micro-skills | Engineering Advanced Skills, especially `karpathy-coder`, `codebase-onboarding`, API review/test skills | The most valuable pieces are small checks: assumption linting, complexity checks, goal verification, onboarding scans, API contract review. | Add compact review checklists to `/limitless-ship`, `/limitless-qa`, and `/limitless-reviewer` rather than bundling the whole catalog. |

### Public Optional Packs

These should be installable packs, not default product surface:

| Optional pack | Source | Recommendation |
| --- | --- | --- |
| Project knowledge vault / LLM wiki | Engineering Advanced Skills `llm-wiki` | Useful for large repos and teams. Ship as an optional project-knowledge plugin with templates, linting, and query commands. |
| Product-management canvases | Local `~/.claude/references/PM-Skills` and `Product-Manager-Skills` | Harvest compact templates for PRDs, JTBD, opportunity-solution trees, roadmap prioritization, and SaaS metrics into a `limitless-product` pack. Do not ship the whole catalog by default. |
| Data engineering pack | Official Claude plugin data engineering skills | Valuable for Airflow, dbt, lineage, freshness, and DAG workflows. Keep as a vertical pack. |
| Frontend/browser pack | Official frontend, Playwright, Figma, Vercel, screenshot skills | Useful, but dependency-heavy and not universal. Package as optional frontend automation. |
| Finance/modeling pack | Mac Mini `~/.openclaw/skills/cfi-financial-modeling` | Good personal/business value. Public inclusion depends on licensing review of CFI-derived material. Scripts are useful as a reference pattern for workbook tooling. |
| Business/GTM skill packs | Knowledge Work and Majestic marketplace marketing/sales/company skills | Many overlap with existing Limitless founder/product/GTM agents. Use selectively as optional packs, not core. |
| Vertical engineering packs | Majestic Rails/Python/React/DevOps/Data skills | Potentially useful marketplace content, but too broad for the core harness. Curate only where Limitless lacks coverage. |

### Public Docs and Architecture Ideas

| Source | Keep |
| --- | --- |
| SuperClaude Framework references | Command/mode/flag documentation patterns and MCP policy docs. Treat as design inspiration, not implementation source. |
| Claude MD management plugin | Recast as `AGENTS.md` / `LIMITLESS.md` maintenance guidance. Do not keep Claude-specific naming in public docs. |
| OpenClaw plugin manifests | Use the simple extension model as a reference for Limitless plugin manifests, lifecycle slots, and permission declarations. |

## Personal Local Version

These are useful locally but should not ship in the public product by default.

| Personal candidate | Source | Why personal-only |
| --- | --- | --- |
| Ralph autonomous loop and hooks | Local `~/.claude/agents/ralph-*.md`, `~/.claude/commands/ralph-*.md`, local hook scripts | High-value workflow for this machine, but contains Claude Code concepts, local path guards, session binders, and personal operating conventions. Port the idea, not the files. |
| Claude Code bridge | Mac Mini `~/.openclaw/extensions/claude-code` and MCP `claude-code` entries | Useful as a temporary compatibility adapter while moving away from Claude Code. It should not be public Limitless core because it reverses the independence goal. |
| Pulse command integration | Mac Mini `~/.openclaw/extensions/pulse-cmd` | The command-plugin pattern is public-worthy, but the Pulse scripts and data model are private/local. |
| Private MCP profiles | Mac Mini `~/.openclaw/mcp-profiles` | Profiles for Apollo, Hunter, Explorium, Apify, Notion, Vapi, Discord, Asana, GitHub, GitLab, Linear, Firebase, DuckDB, Playwright, and Steel are useful locally. Public copies must be sanitized templates only. |
| Browser relay local install | Mac Mini `~/.openclaw/browser/chrome-extension` | Keep enabled locally for authenticated browser workflows. Public version needs permission review and install UX. |
| CFI financial modeling skill | Mac Mini `~/.openclaw/skills/cfi-financial-modeling` | Useful locally immediately. Public distribution needs licensing and attribution review. |
| Local transcript and procedure search | Local `~/.claude/commands/search-transcripts.md`, `store-procedure.md`, `agent-memory` scripts | Good local productivity, but paths and storage are specific to current machines. |
| Mac Mini launch agents, service env, Instagram monitor, LanceDB exports | Mac Mini `~/.openclaw/scripts`, service files, workspace memory docs | Operationally useful locally, but private and environment-specific. |

## Do Not Copy

| Source | Reason |
| --- | --- |
| `ai-sdk-agents` Claude Code plugin | It is aimed at cross-provider agent orchestration, but Limitless already owns provider routing and orchestration. Keep the prior harvest doc as reference; do not ship this Claude Code plugin. |
| Claude Code plugin cache wholesale | Too broad, duplicates existing Limitless agents/tools, and carries Claude-specific assumptions. |
| OpenClaw runtime config files wholesale | They include local paths and may include inline credentials. Use only sanitized patterns and schemas. |
| Claude Code bridge as public core | It creates a dependency on the system Limitless is trying to become independent from. |
| Ralph hook/cron/session-binder implementation as-is | Good workflow, but bound to Claude Code transcript paths and local automation. |
| Broad Majestic/Knowledge Work catalogs wholesale | Good source material, but would bloat the product and blur the core value of Limitless. |
| Private MCP credentials or host-local env files | Never copy into repo. Public templates should name env vars and scopes only. |

## Already Covered by Limitless

Limitless already has several surfaces that make direct copying unnecessary:

- Built-in core team agents in `docs/architecture/limitless-agent-ecosystem.md`.
- Bundled `/limitless-*` skills under `src/skills/bundled`.
- Agent, team, task, MCP, LSP, web browser, and loop-discipline tools under `src/tools`.
- Provider-agnostic routing and multi-provider integration docs.
- A nightly self-improvement concept via `/limitless-self-improve`.

Because these exist, the migration should enhance the current architecture rather than importing competing agent catalogs.

## Recommended Implementation Sequence

1. **Add a capability manifest format.**
   Define how Limitless distinguishes public core, optional packs, and local overlays. Include permissions, credential names, disable path, and package visibility.

2. **Implement the memory provider interface.**
   Start with Mnemo support using OpenClaw's lifecycle shape: pre-run recall, explicit store/forget, and post-run capture. Add redaction and capture-trigger policy before enabling auto-capture.

3. **Implement command plugin registration.**
   Port the OpenClaw `/pulse` idea as a generic deterministic command API. Keep Pulse itself as a local overlay.

4. **Create sanitized MCP profile templates.**
   Add browser, database, devops, research, voice, and comms templates. Every credential must be an env-var placeholder with scope notes.

5. **Port the browser relay as an optional plugin.**
   Make install explicit. Show connection state. Keep localhost permissions narrow. Include uninstall/disable docs.

6. **Convert selected prompt contracts into Limitless skills.**
   Start with module explorer, refiner, security reviewer, test analyzer, spec reviewer, code quality reviewer, codebase onboarding, and assumption/complexity/goal verification gates.

7. **Build local overlay support.**
   Add a documented location such as `~/.limitless/overlays` for private commands, MCP profiles, and skills that should not ship in the public package.

8. **Add session search and procedure memory.**
   Use `.limitless/` as the default project-local store, with opt-in indexing of external transcript paths.

## Source Inventory

| Area | Useful public material | Personal/local material | Action |
| --- | --- | --- | --- |
| Claude Code local agents | Prompt contracts and review roles | Ralph local loop, hooks, completion promise, private conventions | Selectively port contracts |
| Claude Code local commands | Transcript search and procedure-memory concepts | Ralph status/resume/engage scripts and Graphiti-specific procedure storage | Rebuild as Limitless commands |
| Claude official plugins | Superpowers workflow docs, verification discipline, optional frontend/data packs | Claude-specific naming and assumptions | Curate, do not bulk copy |
| Engineering Advanced Skills | AgentHub ideas, LLM wiki, codebase onboarding, lightweight quality gates | Heavy scripts/catalog surface | Optional packs plus small core gates |
| Knowledge Work plugins | Domain templates for sales, marketing, legal, finance, operations | Broad catalog overlap with Limitless agents | Marketplace/optional packs only |
| Majestic marketplace | Vertical packs and some engineering workflow patterns | Huge catalog, many duplicates | Sample selectively |
| PM skill references | Product templates and canvases | Duplicative long catalogs | Compact product pack |
| SuperClaude references | Mode/flag/MCP documentation patterns | Framework-specific commands | Use as docs inspiration |
| OpenClaw memory plugin | Memory lifecycle and direct REST provider shape | Local Mnemo env/profile values | Port interface and sanitized Mnemo provider |
| OpenClaw command plugin | Deterministic command registration | Pulse scripts | Port API, keep Pulse local |
| OpenClaw MCP profiles | Profile taxonomy | Private credentials and local paths | Sanitize templates |
| OpenClaw browser relay | Existing-browser attachment pattern | Local extension install/state | Optional public plugin and local install |
| OpenClaw Claude bridge | Adapter pattern | Claude Code dependency | Personal transitional only |

## Bottom Line

Limitless should copy capabilities, not catalogs. The public product should get a stronger plugin boundary, memory lifecycle, deterministic commands, sanitized MCP profile system, browser relay, and a small number of high-signal workflow/review skills. The personal local version can keep the richer private automations, Claude Code bridge, Pulse integration, private MCP profiles, and modeling scripts as overlays.
