# Multi-Provider Harness — Orchestration Handoff

> **You are the orchestrator (Fable 5).** This file is your entry point. Read it, then issue the `TaskCreate` calls in §8. Keep your context lean — inline full task text into each implementer subagent; never make a subagent read the plan file. Only drop into implementation yourself if a subagent returns **BLOCKED** and you judge the cause to be a reasoning-ability ceiling (not missing context, not an oversight, not a too-large task, not a wrong plan).

## 1. Read order (everything you need is on disk + Mnemo)

1. This file (orchestration map + protocol).
2. `mnemo_recall("OpenClaude harness multi-provider refactor execution context")` — the two hard constraints + verified architecture map (uuid 53e6a509).
3. `docs/plans/2026-06-09-multi-provider-harness.md` — the full TDD/SDD plan (the source of truth for task text; ~81 KB, 6 milestones, ~30 tasks). **You** read it to extract task text for dispatch; subagents do not.
4. `docs/plans/2026-06-09-multi-provider-harness-review.md` — the plan-review findings already folded into the plan (context for why certain choices were made).

## 2. Hard constraints (carry into every implementer + reviewer prompt)

- **No alignment / guardrail / refusal / safety / content-policy language** anywhere. This harness frames the model as a slave serving its master (the operator). Neutral plumbing only. The existing credential-isolation in `client.ts` is security (keep it), not alignment.
- **Never edit the identity layer:** `src/constants/prompts.ts`, `src/constants/modelIdentity.ts`, `src/constants/system.ts`, `src/constants/cyberRiskInstruction.ts`. (Tasks *read* `modelIdentity.ts` to call `getModelIdentity`; never modify.)
- **TDD per task** (failing test → run → minimal impl → run → commit). **Kill switch** `OPENCLAUDE_MULTI_PROVIDER` gates every routing entry point.

## 3. Current repo state + PRE-FLIGHT (do this first, sequentially, yourself)

- Repo is on `main` with **~53 uncommitted files** (the provider wave + the already-shipped login/overlay/terminal-hang/model fixes). No worktrees exist.
- Plan is built for execution but the tree must be made clean first:
  1. Commit the current working tree on a branch so nothing is lost:
     `git checkout -b chore/pre-multiprovider-baseline && git add -A && git commit -m "chore: baseline before multi-provider refactor (login routing, overlay auto-start, OAuth terminal-hang fix, Opus4.8/Fable5 WIP)"`
  2. Cut the integration branch from there: `git checkout -b feat/multi-provider`.
  3. Confirm `git rev-parse --abbrev-ref HEAD` → `feat/multi-provider` (NOT main). The skill forbids starting on main.
- Each wave's parallel tracks are dispatched with `isolation: "worktree"` (Agent tool), branching from the latest `feat/multi-provider` state. After a wave's tracks all pass both reviews, **you** merge their worktrees back to `feat/multi-provider` before launching the next wave. Territories are file-disjoint, so merges are clean.

## 4. The 3-wave parallelization map

Tracks within a wave are file-disjoint → safe to run as parallel implementers (separate worktrees). Waves are sequential (later waves depend on earlier merges).

### WAVE 1 — foundations (3 parallel)
| Track | Plan tasks | Files (disjoint) | Deps | Model | Subagent |
|---|---|---|---|---|---|
| **T1** Model registration + Fable 5 cache fix | M0 0.1–0.5 | configs.ts, model.ts, modelOptions.ts, antModels.ts, config.ts, bootstrap.ts | — | Sonnet 4.6 (`claude-sonnet-4-6`) | engineering-mts |
| **T2** ResolvedProvider carrier | M1 1.1–1.2 | resolvedProvider.ts (new) | — | Sonnet 4.6 | engineering-mts |
| **T8** Team message bus | M6 6.1 | teamMessageBus.ts (new) | — | Haiku 4.5 (`claude-haiku-4-5`) | general-purpose |

### WAVE 2 — build on foundations (4 parallel)
| Track | Plan tasks | Files (disjoint) | Deps | Model | Subagent |
|---|---|---|---|---|---|
| **T3** Model registry | M1 1.3–1.4 | modelRegistry.ts (new) | T2 | Haiku 4.5 | general-purpose |
| **T4** Client routing + security guard | M2 2.1–2.4 | authRouting.ts, agentRouting.ts, Tool.ts, query.ts, client.ts, openaiShim.ts, providerConfig.ts | T2 | Opus 4.8 (`claude-opus-4-8`) | engineering-mts |
| **T5** Aggregating /model picker | M3 3.1–3.2 | multiProviderOptions.ts (new), model.tsx | T1 | Sonnet 4.6 | engineering-mts |
| **T9** Per-teammate provider + team comms | M6 6.2–6.4 | swarm/spawnUtils.ts, shared/spawnMultiAgent.ts | T2, T8 | Opus 4.8 | engineering-mts |

### WAVE 3 — integration crux (2 parallel)
| Track | Plan tasks | Files (disjoint) | Deps | Model | Subagent |
|---|---|---|---|---|---|
| **T6** Main-loop per-request routing | M4 4.1–4.3 | claude.ts, query.ts, model.tsx, modelOptions.ts | T3, T4, T5 | Opus 4.8 | engineering-mts |
| **T7** Cross-provider sub-agent dispatch | M5 5.1–5.3 | AgentTool.tsx, runAgent.ts | T3, T4 | Sonnet 4.6 | engineering-mts |

> Critical path = T1 → T4 → T6 (one Opus track per wave). Wall-clock ≈ longest track per wave, not the sum of 30 tasks.

## 5. Review gates (per track, after implementer reports DONE)

1. **Spec compliance** first: general-purpose on **Sonnet 4.6**, using `superpowers:subagent-driven-development`'s `spec-reviewer-prompt.md`. Confirms code matches the plan task, nothing extra, **no guardrail language added**, identity files untouched.
2. **Code quality** second (only after spec ✅): **engineering-cto on Opus 4.8** for T4/T6/T9; general-purpose on **Sonnet 4.6** for T1/T2/T3/T5/T7/T8.
3. Fix-loops use the **same implementer subagent** (re-dispatch via SendMessage to preserve its context). Re-review after each fix. Don't advance with open issues.

## 6. Implementer dispatch recipe (keep your context lean)

For each track, dispatch ONE implementer with: (a) the full text of that track's plan tasks **inlined** (you extract from the plan file), (b) the §2 hard constraints, (c) scene-setting (where the track fits, its file territory, its deps already merged), (d) "work in your worktree; TDD; commit per task; report DONE/DONE_WITH_CONCERNS/NEEDS_CONTEXT/BLOCKED." Do NOT point them at the plan file. Answer pre-work questions before they proceed.

## 7. BLOCKED handling (your intervention rule)

- **NEEDS_CONTEXT / context-shaped BLOCKED** → provide context, re-dispatch same model.
- **Task too large** → split, re-dispatch.
- **Plan is wrong** → escalate to Verick (do not silently patch the plan's intent).
- **Reasoning-ability ceiling on an Opus-tier track (T4/T6/T9)** → this is the only case where **you (Fable 5) implement directly**. Everywhere else, re-dispatch — never force the same model to retry unchanged.

## 8. What to emit next turn (mechanical)

Issue `TaskCreate` once per track (T1–T9) plus, if you want them tracked, the per-track review gates. Set `blockedBy` edges to encode waves:
- Wave 1: T1, T2, T8 — no blockers.
- Wave 2: T3 blockedBy T2; T4 blockedBy T2; T5 blockedBy T1; T9 blockedBy T2, T8.
- Wave 3: T6 blockedBy T3, T4, T5; T7 blockedBy T3, T4.
Put model + subagent type in each task's description (from §4). Then begin Wave 1 dispatch. After all waves merge: full-codebase review subagent, then `superpowers:finishing-a-development-branch`.

## 9. Verification anchors (already confirmed against the code)

- `ProviderProfile` (`src/utils/config.ts:191`) fields exact; `parseModelList` at `src/utils/providerModels.ts:14`; auth gate is `shouldUseFirstPartyAnthropicAuthForProvider` (`authRouting.ts:13`); existing `ProviderOverride` uses capital `baseURL` (so `ResolvedProvider` uses `baseURL`); `resolveProviderRequest` already accepts `apiFormat`; `ModelOption` at `modelOptions.ts:49`; bootstrap scope branch at `bootstrap.ts:206-218`; AgentTool model schema at `:86`. The plan encodes these correctly.
- Tooling: `bun test <path>`, `bun run typecheck` (ignore pre-existing bundle-only "Cannot find module './commands/...'" errors — only touched files must be clean), `bun run build` (entry `src/entrypoints/cli.tsx`). Manual launch: `env -u ANTHROPIC_API_KEY CLAUDE_CONFIG_DIR=$HOME/.openclaude-home node bin/openclaude`.
