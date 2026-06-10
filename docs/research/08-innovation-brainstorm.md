# Innovation Brainstorm — "What can we do that no one is doing but someone should be doing?"

Written 2026-06-09 by the Fable 5 brainstorm partner (T6). Inputs: `07-innovation-brainstorm-brief.md`,
`05-synthesis.md`, `02-sota-harness-practices.md`, `04-maestro-analysis.md`,
`docs/architecture/agent-loop-harness.md`, `docs/architecture/openralph.md`, and the source at
`src/types/loopDiscipline.ts`, `src/services/api/resolvedProvider.ts` + `modelRegistry.ts`,
`src/utils/sideQuery.ts`, `src/skills/bundled/openRalph.ts`, `src/tools/AgentTool/built-in/openRalphAgents.ts`,
`src/tools/AgentTool/built-in/orchestrationAgent.ts`. Commits examined: e13382b, 46ef535, 2be1fd3,
eef03ef, 577803c, ebba1e9.

Hard constraints honored throughout: provider-agnostic everything; identity layer untouched; neutral
engineering only.

---

## 0. The one-sentence answer

**Nobody ships a harness whose model-routing table is learned from its own work.** Every router in
the literature (RouteLLM, Topaz, MasRouter, Maestro's 3-tier selector) is trained or configured
*offline* on generic benchmarks or static price tiers. OpenClaude is the only harness I can find
that has, simultaneously: (a) a multi-provider registry where any model from any vendor is one
`ResolvedProvider` away, (b) session-owned loop state that makes every dispatch durable and
inspectable, and (c) per-dispatch outcome labels (`provider_model_used` + `tests_passed` + `status`)
already being emitted — and thrown away. Close that loop and the harness gets *empirically better at
routing every night it runs*, on **your** repo, **your** task mix, **your** providers. That is the
flywheel, and it is the build for tonight.

---

## 1. Stress-testing the five seed angles

### Compound vs. compete

The five angles are not five bets. They are one stack plus two orthogonals:

```
Seed 3 (workload class)  ──┐
                           ├──► Seed 1 (per-step routing) ──► Seed 2 (checker model)
provider_model_used data ──┘         (Seed 2 is a special case of Seed 1)

Seed 4 (loop lineage)      — orthogonal: state continuity, not routing
Seed 5 (observation masking) — orthogonal: context hygiene, not routing
```

- **Seed 3 is the input feature.** Workload class (`direct`/`bounded`/`long-running`) is exactly the
  granularity a routing decision wants. It already exists and is already threaded through the loop
  (`classifyLoopWorkloadFromPrompt`, e13382b; hot-path gating, eef03ef/577803c). Treating it as a
  routing *feature* rather than just a discipline *gate* is free.
- **Seed 2 is contained in Seed 1.** "Route the stop/completion check to a small model" is per-step
  routing applied to one step. Ship Seed 2 first because it has the highest leverage per line: the
  OpenRalph goal-gate (`goal.json` + Stop hook) already defines machine-verifiable criteria, so the
  checker's job is mechanical — exactly what a cheap model handles.
- **Seed 1 has two cheap chokepoints, no config explosion needed.** The fear in the brief
  ("smallest slice without a config explosion") dissolves once you notice the harness already has
  two single-file chokepoints:
  1. `src/utils/sideQuery.ts` — every existing harness side-call (session rename, memory scan,
     tool-use summaries, WebFetch digestion) flows through one function that is currently hardwired
     to the first-party client. Make it registry-aware and *every* side-step becomes routable with
     zero per-step config.
  2. The OpenRalph scheduler contract step 8 ("use the model/provider picker deliberately") — the
     dispatch-time model choice is already a prompt-level decision. Give it data instead of vibes
     (see §3) and per-dispatch routing ships without touching the query loop at all.
- **Seed 4 compounds with session-owned state but not with routing.** Lineage/negotiated handoff is
  real and nobody does it, but it only pays off when loops get orphaned — a low-frequency event.
  Park it behind the routing stack. One note for later: the ancestor chain should also carry the
  routing ledger forward (a resumed loop inherits its ancestor's model-performance knowledge), which
  is another reason to build the ledger first.
- **Seed 5 competes for attention, not architecture.** Observation masking is a known technique the
  whole field is converging on (02 §5.2: "often matched or exceeded LLM summarization in solve
  rate"). It's a solid cost win and should ship eventually, but it is the *least* differentiating
  item on the list — every single-provider harness can and will copy it. Do it in a quiet week.

### The moat question — what can a single-provider harness structurally NOT copy?

Four things, in increasing order of defensibility:

1. **Price/billing-model arbitrage.** OpenClaude routes across *billing models*, not just models:
   metered API, subscription OAuth (Claude Max proxy, Codex OAuth — both already in
   `ResolvedProviderKind`), and local/$0. A single-provider harness's "routing table" is its
   vendor's pricing page. Copyable only by becoming multi-provider.
2. **Degradation-immune long runs.** Session-owned loop state means the loop is the durable object
   and the model is fungible. A provider outage, 429-storm, or quota exhaustion mid-run becomes a
   re-route, not a stall. A single-provider harness's 3-day run has a single point of failure it
   cannot engineer away.
3. **Decorrelated judgment.** Seed 2's deepest version: the checker is not just a *smaller* model,
   it's a *different vendor's* model. Same-family models share training lineage and therefore share
   blind spots — a Haiku grading an Opus inherits correlated failure modes. A cross-vendor checker
   removes the correlation. Claude Code's `/goal` uses a small checker; it structurally cannot use a
   decorrelated one.
4. **Locally-learned routing.** The flywheel from §0. Even if a single-provider harness logged
   outcomes, the only decision it could learn is "which of my vendor's three tiers" — a decision the
   vendor's own docs already answer. Cross-vendor outcome data on *your* task distribution is
   knowledge that exists nowhere else and compounds with usage. This is the moat, because it is a
   data asset, not a feature.

### Smallest shippable slice of each seed

| Seed | Smallest slice | Size |
|---|---|---|
| 1. Per-step routing | Make `sideQuery()` resolve its model through the registry (one env/config knob: `smallModel` class) | ~60 LOC |
| 2. Checker model | OpenRalph goal-gate check dispatched via a `verification`-class model instead of re-prompting the worker | ~40 LOC prompt/script |
| 3. Workload-aware everything | Already mostly landed (eef03ef, 577803c); remaining: gate memory-prefetch depth + telemetry verbosity | ~30 LOC |
| 4. Loop lineage | `ancestor_session_id` field in `session.json`, written by `/openralph-resume` | ~20 LOC |
| 5. Observation masking | Replace tool results older than N turns with first-line summaries at context assembly | ~120 LOC |

---

## 2. New angles — what becomes possible only when all three primitives exist

The brief asks for the intersection of (multi-provider substrate × session-owned loops × workload
classification). Each angle below requires at least two of the three; the first requires all three.

### Angle A — The Routing Outcome Ledger (the flywheel) ★ BUILD TONIGHT

**What:** an append-only, project-local ledger of every persona dispatch:
`(workload class, persona, provider/model used) → (status, tests_passed, duration, gaps found)`.
The scheduler reads a summarized success table before each dispatch and picks the
historically-best model for that persona × workload cell, with light exploration of under-sampled
candidates.

**Why all three primitives:** the multi-provider registry supplies the candidate set; session-owned
state supplies durable, attributable dispatch records (`persona-result.yml`, `events.jsonl` per
session); workload classification supplies the feature that makes the statistics transferable
across tasks. Remove any one and the ledger is either trivial (one provider — nothing to choose),
unattributable (no session scoping), or unstratified (a success rate averaged over "hello" and
"port the build system" is noise).

**Why nobody does it:** routers in the wild are offline-trained classifiers (RouteLLM: BERT-class,
generic benchmarks) or static capability vectors (Topaz). Maestro scores *agents* on historical
success but within one execution substrate. No coding harness closes the loop from *its own
verified outcomes* back into *its own next dispatch* — because no other harness has all three
primitives at once. The data is already being generated: `provider_model_used` is in every persona
YAML contract and is write-only today. This is a sub-one-evening fix to a designed-in seam.

**Endgame this unlocks (the wild version):** the dispatch decision becomes an expected-value
calculation — each (provider, model) has a measured success rate per workload cell and a known cost
(metered price, subscription quota drawdown, or $0 local). The scheduler maximizes verified-success
per dollar per hour. At that point OpenClaude is not "a harness with model routing"; it is a
**market-maker over heterogeneous model capacity**, and every other harness is a single-supplier
procurement department. Angles B–D below are intermediate stations on that line.

### Angle B — Cross-provider adjudication (decorrelated second opinions)

**What:** when the checker disagrees with the worker, or stall detection fires
(same-action-repeated-N, `no_progress >= 3`), the scheduler re-dispatches the *same* task brief to
a *different provider's* model and diffs the results. The wild form is N-version agenting: dispatch
`openralph-builder` to two providers in parallel git worktrees and let the test suite pick the
winner — N-version programming where versions are model families, not dev teams.

**Why only here:** requires the registry (candidate diversity), session state (two dispatches
against one durable task brief, results comparable because the brief is a file, not a prompt
memory), and workload classification (you only pay 2× on `long-running` work where a wrong
trajectory costs hours). Single-provider harnesses can retry; they cannot *decorrelate*.

**First slice:** a scheduler-contract rule — "on second consecutive `blocked`/`partial` for the same
task_slug, re-dispatch once with a model from a different `profileId` and record both outcomes in
the ledger." Note the compounding: adjudication events are the *highest-value* ledger entries,
because they are direct A/B comparisons on identical inputs.

### Angle C — Degradation-immune loops (mid-run provider failover + billing-aware scheduling)

**What:** two halves.
1. *Failover:* on auth failure/429/5xx during a `long-running` workload, the scheduler re-resolves
   the model class to the next provider in the class and continues; `events.jsonl` records the
   failover with provenance. The run outlives any provider.
2. *Billing-aware scheduling:* route overnight/long-running work to subscription-billed capacity
   (Claude Max proxy, Codex OAuth — flat-rate quota that *expires if unspent*) and interactive
   bursts to metered API. Subscription quota is a perishable resource; nobody treats it as a
   scheduling input. "Your 3-day run costs $0 marginal because it drained your idle Max quota" is a
   sentence no other harness can say.

**Why only here:** failover without session-owned durable state is a lost run; failover without a
registry is a retry against the same dead endpoint; billing-awareness without workload
classification can't tell which work is deferrable. The substrate makes both halves ~policy, not
~infrastructure.

### Angle D — Model classes as a first-class registry concept (the keystone API)

**What:** the orchestration agent already emits provider/model *classes* as prose ("fast
search/summarization, strong architecture, implementation, verification, local/offline" —
`orchestrationAgent.ts`). The scheduler contract names the same classes. Nothing resolves them.
Add `resolveProviderForClass(class, { workload })` next to `resolveProviderForModel()` in
`modelRegistry.ts`: class → ranked candidates, ranked by the Angle-A ledger when data exists,
by static config when it doesn't, filtered by live availability (Angle C).

**Why it matters:** this is the API that makes A, B, and C composable instead of three ad-hoc
mechanisms, and it is what makes the orchestration agent's output *executable* instead of
advisory. It is deliberately second — built before the ledger exists, it would rank candidates by
nothing.

### Angle E — The ledger as a shareable artifact (longer horizon, flagged not spec'd)

Once routing knowledge is a file (`outcomes.jsonl` + summary), it is portable: committable per-repo
(team members inherit each other's routing knowledge through git), and aggregatable across projects.
A community-pooled, anonymized version — "empirical model-performance-by-task-class, measured by
verified outcomes in real harnesses, not benchmarks" — would be the first routing dataset with
ground truth attached. That is an ocean, not a lake; noted for the roadmap, out of scope tonight.

---

## 3. Top recommendation — first-slice spec (one subagent task)

**Build: the Routing Outcome Ledger for OpenRalph** (Angle A, slice 1).
Consume `provider_model_used`; record outcomes; surface a success table; make the scheduler read it
before choosing a dispatch model.

### Design decisions

- **Ledger location:** `.openclaude/ralph/ledger/outcomes.jsonl` — at the ralph root, NOT inside
  `sessions/<sid>/`. Routing knowledge must outlive sessions; sessions write to it, none owns it.
  Append-only JSONL (matches `events.jsonl` precedent; immutable-state pattern from 02 §6.3).
- **Capture point:** the existing `openralph-hook.sh` PostToolUse hook (bundled inside
  `src/skills/bundled/openRalph.ts`). It already receives hook stdin JSON for every tool event. On
  PostToolUse where `tool_name == "Agent"` and the tool response contains a persona YAML block,
  extract the fields and append a ledger line. This keeps the entire change inside files OpenRalph
  already owns — zero query-loop surface touched, zero risk to non-ralph users.
- **Decision point:** the scheduler contract (prompt) + a stats script. The scheduler is
  prompt-driven by design; the right first slice gives it *data*, not new machinery.
- **Exploration:** epsilon-greedy in prompt form — "if a candidate model class pairing has fewer
  than 3 recorded outcomes for this persona × workload cell, prefer trying it once over exploiting
  the current best." Prevents day-one lock-in to whatever model ran first.

### Data shape (one JSONL line per dispatch)

```json
{
  "ts": "2026-06-09T22:14:03Z",
  "session_id": "abc123",
  "task_slug": "wire-route-stats",
  "persona": "openralph-builder",
  "workload": "long-running",
  "provider_model_used": "openai-compatible/gpt-5.3-codex",
  "status": "complete",
  "tests_passed": true,
  "new_gaps": 0,
  "duration_s": 312
}
```

(`workload` read from the session's `session.json`; `duration_s` from bridging the PreToolUse and
PostToolUse hook timestamps for the Agent call, or null if unavailable — don't block on it.)

### Files to touch (all changes in two files + tests)

1. **`src/skills/bundled/openRalph.ts`** (~180 LOC delta, all inside existing heredoc scripts +
   contract text):
   - `OPENRALPH_HOOK_SH`: in the PostToolUse branch, when `tool_name == "Agent"`, pass the tool
     response through the existing embedded-python helper; extract the trailing YAML block; if it
     contains `task_slug` + `provider_model_used`, append the ledger line to
     `$RALPH_DIR/ledger/outcomes.jsonl` (mkdir -p; tolerate absent fields as null; never fail the
     hook — wrap in `|| true`).
   - New `OPENRALPH_ROUTE_STATS_SH` installed to `.openclaude/ralph/bin/openralph-route-stats.sh`:
     reads the ledger, prints a table of
     `persona × workload × provider_model_used → n, success_rate, avg_duration` (embedded python3,
     stdlib only; `status=="complete" && tests_passed!=false` counts as success).
   - Bootstrap script: create `ledger/` dir; add `.openclaude/ralph/ledger/` to the gitignore
     block **commented optional** — default is NOT ignored (routing knowledge is worth committing;
     see Angle E).
   - Scheduler contract step 8 rewritten: "Before each dispatch, run
     `bash .openclaude/ralph/bin/openralph-route-stats.sh`. Pick the model for this persona and
     workload by best recorded success rate; if any candidate has n < 3, try it instead. Record the
     choice in the dispatch."
   - `/openralph-status` prompt: add "top routing stats" to the report list.
2. **`src/skills/bundled/openRalph.test.ts`** (~80 LOC): unit-test the hook's YAML-extraction +
   append path (feed a synthetic PostToolUse stdin JSON with a persona YAML in tool_response,
   assert the JSONL line) and the stats script's aggregation on a fixture ledger.

Total: **~260 LOC**, one subagent, one evening. No new TS modules required for slice 1 — the
TS-side `outcomeLedger.ts` reader (for Angle D's `resolveProviderForClass`) is slice 2.

### How to verify it works

1. `bun test src/skills/bundled/openRalph.test.ts` — extraction + aggregation green.
2. End-to-end: in a scratch repo, `/openralph` with a toy goal; let the scheduler run two persona
   dispatches; confirm `.openclaude/ralph/ledger/outcomes.jsonl` has ≥2 lines with non-null
   `provider_model_used` and correct `session_id`; run `openralph-route-stats.sh` and see the table.
3. Behavior check: with a seeded ledger showing model X at 0/3 and model Y at 3/3 for
   `openralph-builder × bounded`, confirm the scheduler's next dispatch names model Y (read the
   dispatch prompt in the transcript).
4. Pre-mortem checks built in: hook must exit 0 on malformed YAML (assert in test); ledger append
   must be atomic-enough (single `>>` write of one line); concurrent sessions appending is safe
   because JSONL lines are independent.

---

## 4. Ranked board (impact × implementability × uniqueness, each /5)

| # | Item | Imp | Impl | Uniq | Σ | Verdict |
|---|---|---|---|---|---|---|
| 1 | **A. Routing outcome ledger** | 4 | 5 | 5 | **100** | **Build tonight** (spec above) |
| 2 | Seed 2: cross-provider checker for goal-gate | 4 | 5 | 4 | 80 | Build this week; first *consumer* of the ledger's `verification` class |
| 3 | Seed 1 slice: registry-aware `sideQuery()` | 3 | 5 | 3 | 45 | Quiet-win; makes all harness side-calls routable in one chokepoint |
| 4 | D. `resolveProviderForClass()` in registry | 4 | 4 | 4 | 64 | Slice 2 — keystone API once ledger has data |
| 5 | C. Mid-loop failover + billing-aware scheduling | 5 | 3 | 5 | 75 | Highest ceiling; needs D first; the demo that sells the fork |
| 6 | B. Cross-provider adjudication / N-version builds | 4 | 4 | 5 | 80 | Cheap prompt-level slice after ledger; feeds the ledger its best data |
| 7 | Seed 5: observation masking | 3 | 4 | 2 | 24 | Worth doing, zero moat — schedule, don't prioritize |
| 8 | Seed 4: loop lineage + negotiated handoff | 3 | 3 | 4 | 36 | After routing stack; lineage should carry the ledger forward |
| 9 | Seed 3 remainder: workload-gate memory/telemetry | 2 | 5 | 2 | 20 | Mop-up task for any idle persona |
| 10 | E. Shareable/pooled routing dataset | 5 | 2 | 5 | 50 | Ocean — flag on roadmap, do not start |

**Opinionated bottom line:** build the ledger tonight (#1), point the checker at it this week
(#2 + #4), then ship failover (#5) as the headline capability: "OpenClaude runs are
provider-outage-immune and learn which model to send." Items 1→2→4→5→6 are one compounding line —
each ships independently, each makes the next cheaper, and the further down the line, the harder it
is for any single-provider harness to follow.
