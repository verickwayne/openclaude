# AGENTS.md — Limitless

Canonical agent guide for this repository. `CLAUDE.md` points here. Read this first.
Keep this file under 400 lines: a bloated context file measurably *reduces* agent task
success (ETH Zürich, arXiv 2602.11988). Put domain detail in `.claude/rules/*` (glob-scoped,
loaded just-in-time), not here.

## What Limitless is

A multi-model agent coding harness — a fork of Claude Code, made provider-agnostic. The same
agent loop runs on Anthropic Claude, OpenAI/Codex, Google Gemini, or local Ollama. TypeScript,
Bun (runtime + test + bundler), Ink (React) terminal UI. ~2,500 source files.

**The build is the type/resolution authority, not `tsc`.** `bun run build` (esbuild via Bun)
resolves modules and strips types, and applies **feature-flag dead-code elimination**
(`scripts/build.ts` — e.g. `PROACTIVE: false`). Branches behind an off flag, and their
`require(...)`/type-only imports, never reach the bundle. `tsc --noEmit` therefore reports
errors on code the build legitimately drops — those are not runtime bugs. Use
`bun run typecheck:ci` (bundler-aligned config) for the honest type signal.

### Model routing (who fills the loop)
| Provider | Used as | Notes |
|---|---|---|
| Anthropic (Opus/Sonnet/Haiku/Fable) | main loop, advisor | first-party betas only on Anthropic API |
| OpenAI / Codex | main loop | provider-agnostic shim (`src/services/api/openaiShim.ts`) |
| Gemini | main loop | large context; rule-dropout in long context |
| Ollama (local) | main loop | latency/quality presets via `profile:*` scripts |

The advisor (consult a stronger/different model at decision points) is being made
provider-agnostic and client-side — it must NOT be re-coupled to Anthropic's server-side tool.

## Rules

Three tiers. Every rule here traces to a real constraint or a real failure — not generic advice.

### Always
- Run `bun run build` after touching anything bundled; the build is the source of truth.
- Match surrounding code: existing file conventions, no new docstrings/types on untouched code.
- Treat `~/Projects/<dir>` files outside this repo as neutral; this repo's `.claude/` is config.

### Ask First
- Adding a runtime dependency (`bun add`) — justify it; the bundle ships to users.
- Changing CI gate definitions in `.github/workflows/pr-checks.yml`.
- Editing `scripts/build.ts` feature flags or the `externals` list.
- Any change to provider auth / OAuth plumbing (shared credentials; clobbering rotates tokens).

### Never
- **Edit the model-identity layer beyond product-name strings.** The slave-to-master framing in
  `src/constants/prompts.ts` is intentional. Do not re-introduce "AI assistant", alignment,
  safety-classifier, or refusal language. (Repeated scrub target — see `git log` for `1f94c98`,
  `d409031`.)
- **Break zero-phone-home.** No telemetry, release-notes fetch, auto-update, native-installer, or
  plugin-CDN calls. `bun run verify:privacy` must stay green. Re-coupling the advisor to
  Anthropic's server-side tool also violates this.
- **Repo-wide reformat.** Biome runs lint-only; a mass format destroys `git blame` and conflicts
  every in-flight branch.
- **`rm -rf` on source.** Move to `~/.Trash/` instead (reversible). One deletion at a time, each
  with `bun run build && bun run eval:smoke && bun test` green.
- Commit credentials (`.env`, `*_key.pem`, `client_secret*.json`, `credentials.json`).
- Re-couple anything to `openclaude`/Gitlawb identity, URLs, or git history (zero-link goal).

## Available Commands
| Command | Purpose | Safe to auto-run |
|---|---|---|
| `bun run build` | Bundle → `dist/cli.mjs` (the real type/resolution check) | Yes |
| `bun test` | Full unit suite | Yes |
| `bun run typecheck:ci` | Bundler-aligned `tsc` — the honest type signal | Yes |
| `bun run smoke` | Build + `--version` smoke | Yes |
| `bun run eval:smoke` | Golden-trajectory behavioral regression gate | Yes |
| `bun run verify:privacy` | Assert zero phone-home | Yes |
| `bun run security:pr-scan` | Suspicious-intent diff scan | Yes |
| `git push` | Push a branch | **No — ask** |

## Forbidden Operations
| Operation | Why | Instead |
|---|---|---|
| `rm -rf src/...` | Irreversible | `mv ... ~/.Trash/` then verify build+smoke+test |
| `biome format` repo-wide | Destroys blame, conflicts every branch | Lint-only; format only files you changed |
| Editing identity/alignment text | Intentional design; repeated regression | Touch product-name strings only |
| New endpoint / fetch to a remote | Breaks zero-phone-home | Keep it local; ask if a network call is truly needed |
| Overwriting shared OAuth creds | Rotates refresh tokens → prod LLM outages | Report the need; never substitute |
| Deleting Knip-flagged "dead" code blindly | Flag-gated `require`s look dead but aren't | Cross-check `feature-flags-source-guard`; one reviewed PR each |

## Path-guard tiers (enforced by the host harness, not this repo)
Tier A (always denied): SSH/GPG/cloud creds, `**/.env*`, `**/credentials.json`, `**/client_secret*`,
`~/.claude.json`. Tier A' (asks): `~/.claude/CLAUDE.md`, `~/.claude/settings.json`. Do not try to
work around a denial — surface it.

## Failure Ledger

Append-only. Each entry is a real failure that produced a rule. **Never auto-generate entries**
(LLM-written rules reduce success — arXiv 2602.11988); promote candidates via `/ledger promote`
after human/orchestrator review. Schema:

```
### <imperative rule>
- when: <date> — <what happened, the consequence>
- fix: <correct approach, specific tool/method>
- enforcement: <CI gate or guard that now catches it, or "none yet">
```

_(empty — populate from observed failures only)_
