# Limitless Agent Ecosystem

Limitless adds a built-in agent bench on top of the provider-agnostic harness. The goal is not a large catalog of overlapping personas; it is a small set of useful operators that can route work across models and tools.

## Core Team

- `limitless-founder-os`: founder priority, trade-offs, next decision.
- `limitless-strategy`: issue trees, market facts, competitive framing.
- `limitless-finance`: models, runway, pricing, fundraising, capital strategy.
- `limitless-product`: product bets, PRDs, roadmaps, customer discovery.
- `limitless-gtm`: ICP, positioning, outbound, pipeline, launch.
- `limitless-ops`: cadence, runbooks, vendors, follow-up, status.
- `limitless-integrations`: APIs, MCPs, Gmail-style workflows, connector auth, tool schemas, local tools, and skill/plugin surfaces.
- `limitless-eng-lead`: architecture, dependency order, verification plan.
- `limitless-designer`: workflow, naming, UX, interaction states.
- `limitless-debugger`: symptom-to-cause debugging.
- `limitless-qa`: acceptance evidence.
- `limitless-reviewer`: diff and implementation review.
- `limitless-docs-release`: docs, release notes, handoff.
- `limitless-harness-improver`: scheduled transcript and outcome-ledger analysis.

## Slash Skills

The bundled `/limitless-*` skills are thin routers. They should pick the smallest useful team and keep the main session responsible for merging outputs, making edits, verifying, committing, and pushing.

The important command surfaces are:

- `/limitless-team`: general team router.
- `/limitless-plan-review`: founder/product/engineering/design/review pass over a plan.
- `/limitless-ship`: implementation pipeline.
- `/limitless-qa`: acceptance evidence.
- `/limitless-founder`, `/limitless-gtm`, `/limitless-finance`, `/limitless-ops`: operating-founder support.
- `/limitless-integrations`: API/MCP/tooling workflow design.
- `/limitless-self-improve`: schedule or run the nightly harness review.

## Tool-Calling Layer

`limitless-integrations` owns the connective tissue between models and outside systems. For each workflow it should name:

- source and destination systems,
- verbs such as search, read, draft, send, create, update, archive, sync, summarize, export, and import,
- existing MCPs or tools to use before creating new code,
- credential names and scopes without exposing secret values,
- model-friendly JSON schemas with explicit required fields and `additionalProperties: false` on object parameters,
- implementation path, verification, and disable path.

Gmail-style workflows should separate read/search from draft/send so agents can pull context, prepare work, and then execute the requested outbound step deliberately.

## Nightly Improvement

`/limitless-self-improve` configures a durable 4:00am local review. The scheduled prompt dispatches `limitless-harness-improver`, which reads recent transcripts and `.limitless/ralph` ledgers for errors, time sinks, provider/model routing misses, missing skills, missing agents, and missing API/MCP/tool leverage.

Expected artifacts:

- `.limitless/improvement/config.json`
- `.limitless/improvement/reports/YYYY-MM-DD.md`
- `.limitless/improvement/backlog.md`
- `.limitless/improvement/mcp-proposals/`
- `.limitless/improvement/prototypes/`

The nightly pass writes diagnosis and proposals. When a missing connector or tool is obvious, it may scaffold a prototype or proposal under `.limitless/improvement/`, including README, schema sketch, auth notes, and tests to add.
