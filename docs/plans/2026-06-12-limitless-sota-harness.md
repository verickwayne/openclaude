# Limitless SOTA Harness — Execution Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. This plan was authored with superpowers:writing-plans + majestic-engineer:harness-engineering, a 4-stream web-verified research base, and a Fable advisor checkpoint.

**Goal:** Raise Limitless from a mid-maturity harness (Pillar scores 1.5/2/2 of 5) to a state-of-the-art, multi-model agent harness that is *measurably* best-in-class for complex, multi-faceted work — and ships one capability (cross-provider advisor) no other harness has.

**Architecture:** Three Harness-Engineering pillars (Context / Constraints / Garbage-Collection) brought to ≥4/5 via cheap deterministic gates, anchored by a behavioral safety net (golden-trajectory evals) installed *before* any behavior-changing work, then one differentiating capability (provider-agnostic advisor) shipped behind a flag and *proven* by the eval harness rather than a borrowed benchmark. Innovation bets that overlap existing primitives (Mnemo, agent-teams) are implemented as *wiring*, not new subsystems.

**Tech Stack:** TypeScript, Bun (runtime + test + bundler), Ink (React TUI), esbuild-via-bun build with feature-flag dead-code-elimination, GitHub Actions CI, Mnemo/Graphiti memory, promptfoo (evals), Knip (dead-code), dependency-cruiser (boundaries), Biome (lint), OpenTelemetry GenAI SemConv (observability).

---

## Source of Truth: The Assessment (the bar we are clearing)

| Pillar | Now | Target | Gap closed by |
|---|---|---|---|
| 1 — Context Engineering | 1.5/5 | 4.5/5 | Phase 1 (AGENTS.md, rules, model profiles), Phase 6 (failure-ledger loop) |
| 2 — Architectural Constraints | 2/5 | 4.5/5 | Phase 0 (smoke evals), Phase 2 (type/lint/boundary gates), Phase 5 (trajectory evals) |
| 3 — Garbage Collection | 2/5 | 4/5 | Phase 3 (orphan GC), Phase 6 (delta-gate + scheduled GC + OTel) |

**Established facts the implementers must not re-derive:**
- CI lives in `.github/workflows/pr-checks.yml` (jobs `smoke-and-tests`, `web`). Root `tsc --noEmit` is NOT gated — only `web/` is typechecked.
- `tsc --noEmit` is red: **1,743 errors** (1,451 non-test, 292 test). The 292 test errors are missing bun-test globals (`describe`/`test`/`expect`). None are runtime bugs (the bundler resolves/strips independently).
- Orphans from the openclaude→limitless scrub: `src/cli/transports/` (7 files, ~3,242 LOC, imports a deleted `Transport.ts`), `src/proactive/` (dir absent; gated off by `PROACTIVE: false` in `scripts/build.ts:24`), `src/assistant/` (2 files, `index.js` missing), ~15 stale `.openclaude`-asserting test files.
- Advisor plumbing exists but is Anthropic-server-side-only: `src/utils/advisor.ts` (`isAdvisorEnabled` gated by `shouldIncludeFirstPartyOnlyBetas()` + GrowthBook `tengu_sage_compass`; the reusable `ADVISOR_TOOL_INSTRUCTIONS` prompt; `modelSupportsAdvisor`/`isValidAdvisorModel` allow only opus-4-6/sonnet-4-6), `advisorModel` setting (`src/utils/settings/types.ts:735`), `--advisor` flag (`src/main.tsx:3756`).
- Agent-teams is now always-on (`src/utils/agentSwarmsEnabled.ts` — already edited).
- Skill-matcher hook: `~/.limitless/scripts/skill-matcher.py` (UserPromptSubmit). Mnemo supports `fact_type` + tags.
- Strengths to imitate, not replace: `scripts/verify-no-phone-home.ts`, `scripts/feature-flags-source-guard.test.ts`, `scripts/validate-externals.ts`, `scripts/pr-intent-scan.ts`.

---

## Execution Strategy (subagent-driven-development delegation matrix)

The orchestrator is a fixed **Opus** instance. Implementers are **Sonnet**. The **Fable advisor** is consulted at exactly three checkpoints. This section is binding on the orchestrator.

**Roles & models**
- **Opus orchestrator:** owns the plan, writes each subagent's prompt (acceptance criteria + narrow file manifest + *only* the relevant research excerpt — never this whole plan, never the full research synthesis), reviews gate *definitions* and subsystem *architecture*, commits nothing itself except merges.
- **Sonnet implementer:** one per task; receives a self-contained brief; implements + tests + commits on its branch; reports a 4-status (DONE / DONE_WITH_CONCERNS / NEEDS_CONTEXT / BLOCKED).
- **Sonnet spec-reviewer + Sonnet code-quality-reviewer:** the two-stage review after each task (per subagent-driven-development).
- **Fable advisor checkpoints (only these three — never on mechanical config PRs):** (1) Phase 0 gate-design sign-off before implementation; (2) Phase 4 advisor-architecture sign-off before code; (3) Phase 4 advisor pre-merge review.

**Parallel-vs-sequential split (the token-economy core)**
- **Phase 0 + Phase 2 are shared-file territory** (both edit `.github/workflows/pr-checks.yml`, `package.json`, `tsconfig*.json`). Run them as **one sequential Sonnet on one branch.** Parallelizing config edits only buys merge conflicts + duplicate file-reads — the two largest token taxes.
- **Phase 1 (AGENTS.md)** ships first and alone — it makes every subsequent subagent cheaper (less hallucination, fewer re-reads). Tiny, <400 lines.
- **Phase 3 (GC deletions)** is sequential by nature (each deletion is its own reviewed PR) but gated behind Phase 0's smoke evals.
- **Phases 4, 5, 6 touch disjoint subsystems** (advisor / eval-harness / hooks+observability) → **parallel git worktrees, one Sonnet each** (use superpowers:using-git-worktrees).
- **Token rules:** (a) each subagent gets a file manifest of ≤8 paths; (b) the Phase 0/2 gates become each later subagent's *own* verification loop — they pay for themselves immediately; (c) never paste the research synthesis — paste the 3-6 relevant bullets; (d) reviewers get git SHAs + acceptance criteria, not narrative.

---

## Phase 0 — Behavioral Safety Net + Measurement Repair (THE LOAD-BEARING WALL)

> Rationale (Fable advisor, decision 1 + "if you change one thing"): every later phase modifies a working harness with zero behavioral regression detection. Capture goldens FIRST. Also repair the type-error measurement so later gates are honest.
> Owner: one sequential Sonnet. Fable advisor signs off on gate design before implementation.

### Task 0.1: Golden-trajectory smoke harness

**Files:**
- Create: `evals/smoke/tasks/*.yaml` (10–15 fixed tasks)
- Create: `evals/smoke/run.ts` (headless driver → JSONL trajectory)
- Create: `evals/smoke/assert.ts` (trajectory assertions)
- Create: `evals/golden/*.jsonl` (captured baselines, committed)
- Modify: `package.json` (add `"eval:smoke": "bun run evals/smoke/run.ts"`)
- Modify: `.github/workflows/pr-checks.yml` (add a gated step)

- [ ] **Step 1: Enumerate the 10–15 canonical flows.** One YAML per flow, covering: single-file edit, multi-file edit, codebase search, subagent dispatch (agent-teams), session-resume (cross-harness), tool-permission denial, plan-mode entry/exit. Each YAML: `{ id, prompt, cwd_fixture, assert: { tools_called: [...], tools_forbidden: [...], final_contains: "..." } }`.
- [ ] **Step 2: Write `evals/smoke/run.ts`** — drives `node dist/cli.mjs` headless (`--print`/non-interactive) per task with a fixed model, captures every tool_use (name + args + order) + final output to `evals/golden/<id>.jsonl`. Use the existing headless/print path (`src/cli/print.ts`).
- [ ] **Step 3: Capture baselines on the CURRENT build.** Run `bun run eval:smoke --capture` against today's `dist/cli.mjs`; commit `evals/golden/*.jsonl`. These are the before-state.
- [ ] **Step 4: Write `evals/smoke/assert.ts`** — re-run each task, diff the new trajectory against the golden: assert tool-call *sequence* identity on deterministic tasks; assert `tools_forbidden` never appear; LLM-rubric (`final_contains`) on non-deterministic outputs.
- [ ] **Step 5: Gate it in CI** — add to `pr-checks.yml` `smoke-and-tests` job after the existing smoke step:
  ```yaml
      - name: Golden trajectory smoke evals
        run: bun run eval:smoke
  ```
- [ ] **Step 6: Prove the gate fails on a regression** — temporarily break one tool name, confirm `eval:smoke` exits non-zero, revert.
- [ ] **Step 7: Commit.** `git add evals/ package.json .github/workflows/pr-checks.yml && git commit -m "feat(evals): golden-trajectory smoke harness as CI gate"`

### Task 0.2: tsconfig.ci.json — measurement repair

**Files:**
- Create: `tsconfig.ci.json`
- Modify: `package.json` (add `"typecheck:ci": "tsc -p tsconfig.ci.json --noEmit"`)

- [ ] **Step 1: Create `tsconfig.ci.json`** extending the root, adding bun-test globals and excluding known-orphan/flag-gated paths so the count reflects *genuine* type debt:
  ```jsonc
  {
    "extends": "./tsconfig.json",
    "compilerOptions": {
      "noEmit": true,
      "types": ["bun"]            // kills the 292 describe/test/expect errors
    },
    "exclude": [
      "node_modules", "dist",
      "src/cli/transports/**",    // orphan: imports deleted Transport.ts
      "src/assistant/**"          // orphan: index.js removed
      // proactive/ already absent; its requires are flag-gated (build.ts PROACTIVE:false)
    ]
  }
  ```
- [ ] **Step 2: Re-count.** Run `bun run typecheck:ci 2>&1 | grep -cE "error TS"`. Record the genuine count in the commit message (advisor expects ~200, not 1,743).
- [ ] **Step 3: Commit.** `git add tsconfig.ci.json package.json && git commit -m "build: bundler-aligned CI tsconfig — strips flag/orphan/test-global noise (NNNN→MMM genuine errors)"`

**Phase 0 acceptance:** `bun run eval:smoke` is green and gating PRs; `bun run typecheck:ci` reports the true genuine-error count. Do NOT proceed to deletions (Phase 3) until 0.1 is merged.

---

## Phase 1 — Context Foundation (Pillar 1)

> Ships first and alone. Highest-ROI ~200 lines in the plan. Failure-ledger only — NEVER auto-generate rules (ETH Zurich arxiv 2602.11988: bloated/LLM-gen AGENTS.md *reduces* success). Owner: one Sonnet.

### Task 1.1: Root AGENTS.md (canonical, <400 lines)

**Files:**
- Create: `AGENTS.md`
- Create: `CLAUDE.md` symlink → `AGENTS.md` (`ln -s AGENTS.md CLAUDE.md`) OR a one-line `CLAUDE.md`: `READ AGENTS.md FIRST.`

- [ ] **Step 1: Write AGENTS.md** with these sections, in priority order (critical-first; lost-in-middle is real): (a) **What Limitless is** + the model-routing table; (b) **Three-tier rules** — `## Always` / `## Ask First` / `## Never`; (c) **Available Commands** table (`bun run build`, `bun test`, `bun run typecheck:ci`, `bun run eval:smoke`, `bun run verify:privacy`, `bun run security:pr-scan` — each with a "safe to auto-run" column); (d) **Forbidden Operations** table (why + alternative) seeded from the path-guard tiers, the no-phone-home rule, and "never edit the model-identity layer beyond product strings"; (e) **Failure Ledger** section — empty, with the schema documented (`rule | date | what-happened | fix | enforcement`). Hard cap 400 lines.
- [ ] **Step 2: Symlink CLAUDE.md.** Verify `cat CLAUDE.md` resolves to AGENTS.md.
- [ ] **Step 3: Commit.** `git add AGENTS.md CLAUDE.md && git commit -m "docs(agents): canonical AGENTS.md — three-tier rules, tool/forbidden tables, empty failure ledger"`

### Task 1.2: Glob-scoped rule files + model context profiles

**Files:**
- Create: `.claude/rules/typescript.md`, `.claude/rules/tui.md`, `.claude/rules/multi-model.md`, `.claude/rules/forbidden.md`

- [ ] **Step 1:** Each file starts with a frontmatter `paths:`/`globs:` header (per Cursor/Cline convention) so it loads JIT only when matching files are touched: `typescript.md` (`src/**/*.ts`), `tui.md` (`src/**/*.tsx`, Ink rules — least-represented in model training), `multi-model.md` (`src/services/api/**`, `src/utils/model/**`), `forbidden.md` (`alwaysApply: true`).
- [ ] **Step 2:** Put a `## Model Context Profiles` block in `multi-model.md`: per-routable-model context budget + known gaps (claude / gpt-codex / gemini / ollama), so the routing layer has context-aware caveats. Keep factual; mark estimates as estimates.
- [ ] **Step 3:** Put **agent-role-scoped** forbidden-ops in `forbidden.md` partitioned by persona (builder / researcher / refiner) — researcher never writes `src/**`; refiner never adds files or changes public API without a ledger entry.
- [ ] **Step 4: Commit.** `git add .claude/rules && git commit -m "docs(rules): glob-scoped rule files + per-model context profiles + agent-role forbidden ops"`

**Phase 1 acceptance:** AGENTS.md ≤400 lines, CLAUDE.md resolves to it, `.claude/rules/*` are glob-scoped, failure ledger present-but-empty.

---

## Phase 2 — Deterministic Gates (Pillar 2)

> Shared-file territory with Phase 0 — same sequential Sonnet, same branch family. Each gate must be binary pass/fail with a *teaching* error message.

### Task 2.1: Type-debt ratchet
**Files:** Create `scripts/tsc-ratchet.ts` (or adopt `tsc-baseline`); Create `.tsc-baseline.json`; Modify `pr-checks.yml`.
- [ ] **Step 1:** Decide tool: a ~50-line `scripts/tsc-ratchet.ts` that runs `typecheck:ci`, fingerprints each error by **file + TS-error-code** (NOT line number — line numbers churn and merge-conflict), and compares the set against `.tsc-baseline.json`. (Reject betterer — dormant + state-file merge-conflicts across parallel branches; reject changed-files-only — tsc errors aren't file-local.)
- [ ] **Step 2:** Generate baseline from the genuine count (Phase 0.2). Commit `.tsc-baseline.json`.
- [ ] **Step 3:** Gate: `bun run scripts/tsc-ratchet.ts` fails iff a *new* (file,code) fingerprint appears. Teaching error: print the new error + "type debt may only decrease; fix it or it blocks merge."
- [ ] **Step 4:** Add to `pr-checks.yml`. Prove it fails on an injected error, revert. Commit.

### Task 2.2: Biome lint gate (lint-only, suppression baseline, NO format)
**Files:** Create `biome.json`; Modify `pr-checks.yml`.
- [ ] **Step 1:** `bunx @biomejs/biome init`. In `biome.json` set `"linter": { "enabled": true }`, `"formatter": { "enabled": false }` (a 646K-LOC reformat destroys blame + conflicts every in-flight branch). Enable import-organization + a conservative rule set; the existing `biome-ignore` comments already align.
- [ ] **Step 2:** Establish a suppression baseline so existing violations don't block (rule-level `"level": "warn"` for noisy rules, escalate over time).
- [ ] **Step 3:** Gate: `biome check --error-on-warnings src/` → 0 or fail. Add to CI. Commit.

### Task 2.3: One structural boundary test (dependency-cruiser)
**Files:** Create `.dependency-cruiser.js`; Modify `pr-checks.yml`.
- [ ] **Step 1:** `bunx depcruise --init`. Add ONE high-value rule with a teaching `comment`: forbid `src/services/crossHarness/**` (resume feature) from being imported by core, and forbid the orphan `src/cli/transports/**` from re-entering the live graph. The `comment` string (guideline + alternative) prints verbatim on violation.
- [ ] **Step 2:** Add a second rule wiring the feature-flag boundary: files reachable only behind a build flag must not be imported by flag-ungated modules (makes the DCE guarantee structurally testable; complements `feature-flags-source-guard`).
- [ ] **Step 3:** Gate: `depcruise --config .dependency-cruiser.js src/` error-level. Add to CI. Commit.

### Task 2.4: Knip baseline (NO deletions yet)
**Files:** Create `.knip.json`, `.knip-baseline.json`; Modify `pr-checks.yml`.
- [ ] **Step 1:** `bunx knip --reporter json > .knip-baseline.json`. Zero-config first pass — let false positives surface so plugin rules get tuned, not suppressed wholesale.
- [ ] **Step 2:** Add a **delta-gate**: CI fails if `unusedExports`/`unusedFiles` count exceeds the committed baseline (blocks *net-new* orphans without requiring the backlog to be zero). Do NOT run `knip --fix` here.
- [ ] **Step 3:** Commit baseline + gate.

**Phase 2 acceptance:** four new binary gates in `pr-checks.yml` (type-ratchet, biome lint, dependency-cruiser, knip-delta), each proven to fail on a real violation; no repo-wide reformat; no deletions yet.

---

## Phase 3 — Garbage Collection Execution (Pillar 3)

> Gated behind Phase 0 smoke evals. Each deletion is its own reviewed PR, cross-checked against `feature-flags-source-guard`, with `eval:smoke` re-run. Sequential. This is where the Knip flag-gated false-positive trap lives — handle with care.

### Task 3.1: Delete the dangling type-only orphan (`cli/transports`)
- [ ] **Step 1:** Confirm `src/cli/transports/**` is unreachable from the live entry graph (build still 0-missing with it excluded). Confirm via `depcruise` that nothing live imports it.
- [ ] **Step 2:** `mv src/cli/transports ~/.Trash/limitless-transports-$(date)` (reversible, per safety rules) — do not `rm -rf`.
- [ ] **Step 3:** `bun run build && bun run eval:smoke && bun test` all green. Commit one PR.

### Task 3.2: Delete stale `.openclaude`-asserting tests (~15)
- [ ] **Step 1:** `grep -rl "openclaude" --include='*.test.ts' src scripts`. For each, confirm the asserted value is now `.limitless` and the test is stale (not a still-valid legacy-compat test).
- [ ] **Step 2:** Update or remove each; `bun test` green. Commit one PR.

### Task 3.3: Resolve flag-off `proactive` / `assistant`
- [ ] **Step 1:** Decision (orchestrator + Fable if non-obvious): KEEP (re-add the missing `index.ts` behind the flag, properly stubbed) or CUT (remove the flag + the guarded `require`s). `proactive` dir is absent and `PROACTIVE:false` — leaning CUT; `assistant` has 2 live-ish consumers (`dialogLaunchers.tsx`, `useAssistantHistory.ts`) — verify before cutting.
- [ ] **Step 2:** Apply; build + eval:smoke + test green; update `.knip-baseline.json` and `.tsc-baseline.json` downward. Commit.
- [ ] **Step 3:** Update `.knip-baseline.json` / `.tsc-baseline.json` to the new lower counts (ratchets only move down).

**Phase 3 acceptance:** orphan subtrees removed reversibly, every deletion PR green on build+smoke+test, baselines ratcheted down.

---

## Phase 4 — Cross-Provider Advisor (THE DIFFERENTIATOR)

> The one capability no other harness has. Reuse existing plumbing; swap the Anthropic server-tool for a provider-agnostic local call. Ship behind a flag with cost/outcome telemetry so Phase 5 evals prove it. Own worktree. Fable advisor signs off on architecture (before code) and pre-merge.

### Task 4.1: Architecture spec (Fable checkpoint #2)
- [ ] **Step 1:** Implementer reads `src/utils/advisor.ts`, `src/main.tsx:2068-2090,2584,2974,3756`, `src/utils/messages.ts:1264-1269`, and the provider-client layer (`src/services/api/*`, `src/utils/model/providers.ts`). Produce a 1-page contract: a local `advisor` tool (no params) that serializes the full transcript, dispatches to the configured advisor provider via the existing provider client, injects the result as a tool result. Keep `ADVISOR_TOOL_INSTRUCTIONS` verbatim (provider-neutral).
- [ ] **Step 2:** Fable advisor reviews the contract. Adjust. Then implement.

### Task 4.2: Implement provider-agnostic advisor
**Files:** Modify `src/utils/advisor.ts` (relax `isValidAdvisorModel`/`modelSupportsAdvisor` to any provider; replace the server-tool gate); Create `src/tools/AdvisorTool/AdvisorTool.ts` (local tool); Modify the tool registry + `/advisor` command to accept `provider:model`.
- [ ] **Step 1 (TDD):** Write the failing test: `advisor` tool with main=non-Anthropic returns guidance (mock the advisor provider client).
- [ ] **Step 2:** Implement the local tool: serialize transcript → call advisor provider → return `{ guidance }`. Gate behind `LIMITLESS_ADVISOR` flag + cost/latency telemetry log per call.
- [ ] **Step 3:** Wire `/advisor <provider:model>` config + `advisorModel` setting passthrough. Keep `CLAUDE_CODE_DISABLE_ADVISOR_TOOL` as an off switch.
- [ ] **Step 4:** Tests green; `bun run build && bun run eval:smoke`. Fable advisor pre-merge review (checkpoint #3). Commit.

**Phase 4 acceptance:** `/advisor opus` works with a GPT/Gemini/Ollama main model; advisor calls emit cost+latency telemetry; off by default flag, documented in AGENTS.md.

---

## Phase 5 — Eval-Driven Harness Dev (prove the advisor; lock behavior) — PARALLEL with 4 after 0

> Own worktree. Expands Phase 0's smoke slice into a real trajectory-eval suite (promptfoo) and uses it to prove the advisor's before/after on Limitless's own workloads.

### Task 5.1: promptfoo trajectory eval suite
**Files:** Create `evals/promptfoo.yaml`, `evals/cases/*.yaml`; Modify `pr-checks.yml`.
- [ ] **Step 1:** `bun add -d promptfoo` (verify latest version at install). Configure trajectory assertions (verified-real): `trajectory:tool-used`, `trajectory:tool-args-match`, `trajectory:tool-sequence`, `trajectory:step-count`, `trajectory:goal-success`.
- [ ] **Step 2:** 3 cases per major entry point (simple / ambiguous / multi-tool), each asserting tool set + forbidden tools + `llm-rubric` on output.
- [ ] **Step 3:** Multi-provider parity: run each case against ≥2 providers; assert no parity regression. Gate in CI (nightly or label-triggered if too slow for every PR). Commit.

### Task 5.2: Advisor before/after proof
- [ ] **Step 1:** Run the suite with `LIMITLESS_ADVISOR` off vs on across the complex/multi-tool cases; record success-rate + token-cost delta.
- [ ] **Step 2:** Write the result into `docs/research/advisor-impact.md` (Limitless's own number, not the borrowed 74.8/72.1). If it doesn't beat cost, keep the flag default-off and say so.

**Phase 5 acceptance:** trajectory eval suite gating, advisor impact measured on Limitless workloads and documented.

### Task 5.3 (LangChain finding): pre-completion verification hook
**Files:** Create the hook in the existing hook infra.
- [ ] **Step 1:** Add a pre-completion checklist hook that intercepts "task done" and forces a verification pass (build + eval:smoke + ledger-check) before the agent declares completion. (LangChain: this single hook moved an agent top-30→top-5.) Commit.

---

## Phase 6 — Self-Maintaining Loop (Pillar 1↔3 closure) — PARALLEL after 0

> Own worktree. Wire EXISTING primitives (Mnemo, hooks, agent-teams), do not build new subsystems. Failure-registry is the one true must-build.

### Task 6.1: Failure-registry primitive (must-build)
**Files:** Create a PostToolUse hook script; Modify settings to register it.
- [ ] **Step 1:** Hook classifies tool results as success/failure; on failure, writes a `fact_type=failure` entry to Mnemo (task summary, tool, error type, provider, timestamp). NO auto-promotion to AGENTS.md.
- [ ] **Step 2:** Add a `/ledger promote` manual review step: surfaces clustered failure facts, human/orchestrator approves promotion into the AGENTS.md failure ledger. (ETH finding: auto-appended rules hurt — keep a human/Opus gate.)
- [ ] **Step 3:** At task start, semantic-search the failure registry; surface relevant prior failures as a hard constraint near the top of the turn (not buried in history). Commit.

### Task 6.2: Typed memory namespaces (Mnemo wiring, not a new store)
- [ ] **Step 1:** Define four Mnemo namespaces via `fact_type`/tags: `repo-fact`, `decision`, `failure`, `handoff`. Route existing capture hooks into them; advisor reads `decision`, planner reads `failure`, executor reads `repo-fact`.
- [ ] **Step 2:** On session end, write a structured `handoff` artifact (YAML, not prose) the next session's init reads first. Commit.

### Task 6.3: OTel GenAI SemConv instrumentation (file export, NOT Phoenix)
- [ ] **Step 1:** `bun add @opentelemetry/sdk-node`. Emit per-task spans: `gen_ai.agent.name = task_id`, child spans per tool with `gen_ai.tool.name`/`gen_ai.tool.type`. Export OTLP→file/console now (skip self-hosted Phoenix — ops sink for one operator; add a viewer later).
- [ ] **Step 2:** Link each task's `task_id` to its trace in the existing teammate-view. Commit.

### Task 6.4: Scheduled GC workflow
**Files:** Create `.github/workflows/gc.yml`.
- [ ] **Step 1:** Weekly cron + `workflow_dispatch`: run `knip --reporter json`, open a small PR per GC task (dead-code / unused-deps / stale-docs), auto-merge if all gates pass. Commit.

**Phase 6 acceptance:** failures captured to Mnemo + surfaced before retries; `/ledger promote` works; typed namespaces in use; OTel spans emitted to file; weekly GC workflow live.

---

## Explicitly Cut / Deferred (do NOT build — advisor rulings)

- **Cognitive-role provider routing as a subsystem** → becomes a per-role provider config field on agent-teams *after* Phase 5 proves cross-provider advisor value. Not a Phase.
- **Self-hosted Arize Phoenix** → OTel-to-file now; viewer later.
- **Adversarial/prompt-injection eval layer** → not the current threat model.
- **drift + lychee doc-link checking** → cosmetic; revisit if docs grow.
- **Repo-wide Biome format** → never (blame + merge destruction).
- **Blanket coverage-threshold gate** → theater on an inherited tree; ratchet coverage like types if wanted, else skip.
- **Cross-model MoA output-blending** → ICLR 2025 Self-MoA: lowers quality. Multi-model value is role differentiation only.
- **Continuous advisor polling** → advisor at decision checkpoints only.
- **Parallel fan-out for dependent subtasks** → Cognition: reliability collapse. Fan out only on zero-shared-write-surface subtasks.

---

## Self-Review (writing-plans checklist)

1. **Spec coverage:** Pillar 1 → Phase 1 + 6.1/6.2; Pillar 2 → Phase 0 + 2 + 5; Pillar 3 → Phase 3 + 6.3/6.4. Differentiator (advisor) → Phase 4. SDD delegation/parallelization/token-economy → Execution Strategy section. All assessment gaps mapped. ✓
2. **Placeholder scan:** Config-file tasks (Phase 0–2) carry exact code; subsystem tasks (4–6) carry file manifests + interface contracts + acceptance + verify commands, with an explicit "read these exact files first" step — because fabricating line-level code for unread modules would be wrong, not merely incomplete. This is a deliberate, flagged altitude choice, not a placeholder. ✓
3. **Type/name consistency:** `eval:smoke`, `typecheck:ci`, `.tsc-baseline.json`, `.knip-baseline.json`, `LIMITLESS_ADVISOR`, `ADVISOR_TOOL_INSTRUCTIONS`, Mnemo `fact_type` namespaces — used consistently across tasks. ✓

**Dependencies:** Phase 0 blocks 3, 4, 5, 6 (safety net first). Phase 1 ships first (cheapens all). Phase 2 shares Phase 0's branch. Phases 4/5/6 parallelize in worktrees once 0+1+2 land.
