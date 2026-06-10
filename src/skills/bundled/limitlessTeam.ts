import { registerBundledSkill } from '../bundledSkills.js'

const LIMITLESS_TEAM_README = `# Limitless Team

Limitless Team is the built-in agent and skill ecosystem for the Limitless harness.

Design inputs:
- G-Stack: role-based skills that behave like CEO, designer, engineering manager, release manager, docs, QA, and browser operator.
- Existing Claude Code founder bench: banking analyst/associate/partner, consulting analyst/associate/partner, product analyst/associate/partner, sales BDR/AE/director, engineering CTO/FDE/MTS, and productivity assistant.
- Awesome subagent catalogs: broad role libraries are useful, but Limitless starts with a curated operating-company bench instead of hundreds of overlapping roles.
- Agent-team repos: spec-driven workflows work best when the orchestrator writes concrete artifacts and routes each phase to a specialist.
- Tool-calling harnesses: models do better when APIs, MCPs, schemas, credentials, and external data flows are explicit first-class work instead of ad hoc shell scripts.

Built-in agents:
- limitless-founder-os
- limitless-strategy
- limitless-finance
- limitless-product
- limitless-gtm
- limitless-ops
- limitless-integrations
- limitless-eng-lead
- limitless-designer
- limitless-debugger
- limitless-qa
- limitless-reviewer
- limitless-docs-release
- limitless-harness-improver

Bundled skills:
- /limitless-team
- /limitless-plan-review
- /limitless-ship
- /limitless-qa
- /limitless-learn
- /limitless-founder
- /limitless-gtm
- /limitless-finance
- /limitless-ops
- /limitless-integrations
- /limitless-self-improve
`

const LIMITLESS_TEAM_MAP = `# Limitless Team Routing Map

| Need | Skill | Agent(s) |
| --- | --- | --- |
| Founder priority / trade-off | /limitless-founder, /limitless-team | limitless-founder-os |
| Market strategy / issue tree | /limitless-founder, /limitless-team | limitless-strategy |
| Finance / fundraising / model | /limitless-finance | limitless-finance |
| Product bet / PRD / roadmap | /limitless-team, /limitless-plan-review | limitless-product |
| GTM / sales / marketing | /limitless-gtm | limitless-gtm |
| Operations / chief of staff | /limitless-ops | limitless-ops |
| APIs, MCPs, Gmail, connector workflows, tool schemas | /limitless-integrations | limitless-integrations |
| Architecture and execution sequence | /limitless-plan-review, /limitless-ship | limitless-eng-lead |
| Product and UX polish | /limitless-plan-review | limitless-designer |
| Root-cause analysis | /limitless-team | limitless-debugger |
| Implementation dispatch | /limitless-ship | main agent or openralph-builder |
| Acceptance testing | /limitless-qa, /limitless-ship | limitless-qa |
| Code review | /limitless-plan-review, /limitless-ship | limitless-reviewer |
| Docs, release notes, handoff | /limitless-ship | limitless-docs-release |
| Harness self-improvement | /limitless-self-improve | limitless-harness-improver |

Provider/model routing:
- Fast search/summarization: use a cheap fast model.
- Architecture and review: use a strong reasoning model.
- Implementation: use the best available coding model with tool access.
- Checker/QA: use a different provider/model family than the implementation worker when available.
- Local/offline: use for repository-only grep/read tasks or private-code audits.
`

export const LIMITLESS_TEAM_FILES = {
  'README.md': LIMITLESS_TEAM_README,
  'team-map.md': LIMITLESS_TEAM_MAP,
}

function buildTeamPrompt(args: string): string {
  const objective = args.trim()
    ? `Objective:\n\n--- BEGIN OBJECTIVE ---\n${args.trim()}\n--- END OBJECTIVE ---`
    : 'Infer the objective from the current conversation.'

  return `# /limitless-team

${objective}

Use the Limitless built-in team as a role router. Read the extracted \`team-map.md\` if available.

1. Classify the request: product decision, plan review, implementation, debugging, QA, docs/release, or long-running orchestration.
2. Pick the smallest useful team. Do not spawn every agent by default.
3. For founder trade-offs and priority, dispatch \`limitless-founder-os\`.
4. For market strategy and issue trees, dispatch \`limitless-strategy\`.
5. For financial model, fundraising, pricing, runway, or cap table questions, dispatch \`limitless-finance\`.
6. For product scope, roadmap, PRD, and customer-discovery framing, dispatch \`limitless-product\`.
7. For sales, marketing, positioning, ICP, pipeline, or launch motion, dispatch \`limitless-gtm\`.
8. For operating cadence, process, vendor, compliance, risk, or chief-of-staff work, dispatch \`limitless-ops\`.
9. For APIs, MCPs, Gmail, external data movement, webhooks, connector auth, local tools, or tool schemas, dispatch \`limitless-integrations\`.
10. For architecture/dependency sequencing, dispatch \`limitless-eng-lead\`.
11. For UX or naming surfaces, dispatch \`limitless-designer\`.
12. For failures, dispatch \`limitless-debugger\`.
13. For acceptance evidence, dispatch \`limitless-qa\`.
14. For diff review, dispatch \`limitless-reviewer\`.
15. For docs/release/handoff, dispatch \`limitless-docs-release\`.
16. Merge the agent outputs into a concrete action plan or execute the next obvious step.

If the work is long-running, create or update \`.limitless/longtask.json\` and treat it as the mechanical source of truth.`
}

function buildPlanReviewPrompt(args: string): string {
  return `# /limitless-plan-review

Review this plan or proposed change with the core Limitless review bench.

${args.trim() || 'Use the current conversation, repo state, and any named plan file as input.'}

Run the review in this order:
1. \`limitless-founder\`: scope, user value, what to cut.
1. \`limitless-founder-os\`: priority, trade-off, what to ignore.
2. \`limitless-product\`: user/job/scope/cut list.
3. \`limitless-eng-lead\`: architecture, dependencies, risk, verification.
4. \`limitless-designer\`: UX, naming, workflow, visual and interaction states.
5. \`limitless-reviewer\`: correctness, regressions, missing tests.

Return findings first, grouped by blocking vs non-blocking. Then give the revised implementation sequence.`
}

function buildShipPrompt(args: string): string {
  return `# /limitless-ship

Ship the requested work through a compact Limitless pipeline.

${args.trim() || 'Use the current user request as the shipping objective.'}

Pipeline:
1. Inspect repo state and existing plans before editing.
2. Use \`limitless-eng-lead\` for the smallest viable implementation sequence if the path is unclear.
3. Implement in the main session or delegate atomic tasks to an implementation agent.
4. Run the most direct verification.
5. Dispatch \`limitless-reviewer\` on the resulting diff.
6. Dispatch \`limitless-qa\` for acceptance evidence.
7. Dispatch \`limitless-docs-release\` if docs, release notes, migration notes, or operator handoff are needed.
8. Commit when the work is coherent and verification is recorded.

For multi-provider work, record which provider/model handled implementation and which handled review/QA.`
}

function buildQaPrompt(args: string): string {
  return `# /limitless-qa

Build and run an acceptance pass.

${args.trim() || 'Use the current feature or diff as the target.'}

1. Define the acceptance checklist.
2. Run the shortest reliable command checks.
3. If UI behavior is involved, specify browser steps and expected observations.
4. Dispatch \`limitless-qa\` for a focused evidence pass when useful.
5. Report pass/fail, commands run, and remaining gaps.`
}

function buildLearnPrompt(args: string): string {
  return `# /limitless-learn

Capture reusable project learning for future Limitless sessions.

${args.trim() || 'Infer the learning from recent work and repo evidence.'}

Write durable facts only when they will help future sessions:
- project conventions
- recurring verification commands
- provider/model routing lessons
- failed approaches to avoid
- release or deployment runbooks

Prefer existing project memory files if present. If none exists, update \`.limitless/learnings.md\` with concise dated entries. Do not store secrets.`
}

function buildFounderPrompt(args: string): string {
  return `# /limitless-founder

Use the Limitless founder operating bench for a company decision.

${args.trim() || 'Use the current conversation as the founder operating question.'}

Route deliberately:
1. \`limitless-founder-os\` for priority, trade-off, and what matters now.
2. \`limitless-strategy\` for market, competitive, or strategic fact base.
3. \`limitless-product\` for product bet, roadmap, PRD, or customer discovery.
4. \`limitless-finance\` for runway, pricing, unit economics, fundraising, or model work.
5. \`limitless-gtm\` for ICP, sales, marketing, positioning, or launch.
6. \`limitless-ops\` for cadence, process, vendors, risk, compliance, or status reporting.

Return a founder memo: recommendation, rationale, trade-offs, cut list, leading indicators, and first next action.`
}

function buildGtmPrompt(args: string): string {
  return `# /limitless-gtm

Use the Limitless GTM bench.

${args.trim() || 'Use the current sales, marketing, or launch question as the target.'}

Dispatch \`limitless-gtm\`. If the question depends on market facts, also dispatch \`limitless-strategy\`. If it depends on product promise, also dispatch \`limitless-product\`.

Return: ICP, buyer, pain, message, channel, asset/outreach next step, and metric.`
}

function buildFinancePrompt(args: string): string {
  return `# /limitless-finance

Use the Limitless finance and capital bench.

${args.trim() || 'Use the current model, capital, pricing, or fundraising question as the target.'}

Dispatch \`limitless-finance\`. If the model must be audited before strategy, ask it to operate analyst-first. If the answer is narrative/capital strategy, ask it to operate partner-first.

Return: headline, model or assumption issues, investor pressure points, decision implication, and next analysis.`
}

function buildOpsPrompt(args: string): string {
  return `# /limitless-ops

Use the Limitless operations bench.

${args.trim() || 'Use the current operating problem as the target.'}

Dispatch \`limitless-ops\`. If the process touches GTM, product, or engineering, pull in that specialist only for the dependency.

Return: operating cadence, owner, artifact, process/runbook, risks, and next checkpoint.`
}

function buildIntegrationsPrompt(args: string): string {
  return `# /limitless-integrations

Design or build the API/MCP/tool surface for a Limitless workflow.

${args.trim() || 'Use the current workflow, missing data source, or external-system need as the target.'}

Dispatch \`limitless-integrations\`.

Require the agent to cover:
1. source and destination systems
2. needed verbs: search, read, draft, send, create, update, archive, sync, summarize, export, import
3. existing MCPs, connectors, APIs, or local tools to use before creating anything new
4. missing MCP/tool/skill surface when existing tools do not cover the workflow
5. credential names and scopes without exposing secret values
6. model-friendly JSON schemas, including OpenAI-compatible object schemas with \`additionalProperties: false\`
7. Gmail-style flows when relevant: search/read threads, create drafts, label/archive, and send only when explicitly requested by the workflow
8. implementation path, tests, and a rollback or disable path

Return: systems, available tools, missing capability, schema sketch, build steps, verification command, and exact next action.`
}

function buildSelfImprovePrompt(args: string): string {
  const target = args.trim()
  return `# /limitless-self-improve

Set up or run the Limitless nightly harness improvement loop.

${target || 'Default: schedule a durable local run every night at 4:00am local time and run one review now if useful.'}

## What this does

The self-improvement loop reviews recent sessions, transcripts, OpenRalph outcome ledgers, hook events, errors, time sinks, provider/model routing misses, repeated user corrections, and relevant new harness research. It writes proposals to \`.limitless/improvement/\`; it does not directly edit harness code during the scheduled pass.

It also looks for places where Limitless should gain leverage through APIs, MCPs, or new tools: Gmail, calendars, CRMs, issue trackers, docs, analytics, databases, webhooks, and local project automation. When a missing capability is clear, it should add an MCP/tool proposal or prototype scaffold under \`.limitless/improvement/\`.

## Setup

1. Ensure these files exist:
   - \`.limitless/improvement/config.json\`
   - \`.limitless/improvement/backlog.md\`
   - \`.limitless/improvement/reports/\`
2. Put this default config in \`config.json\` if missing:

\`\`\`json
{
  "schedule": "0 4 * * *",
  "lookback_hours": 72,
  "transcript_search_terms": [
    "API Error",
    "tool_error",
    "blocked",
    "failed",
    "permission",
    "timeout",
    "rate_limited",
    "context",
    "slow",
    "wrong",
    "correction",
    "try again",
    "MCP",
    "connector",
    "Gmail",
    "manual export",
    "copy paste",
    "tool missing"
  ],
  "report_dir": ".limitless/improvement/reports",
  "backlog": ".limitless/improvement/backlog.md"
}
\`\`\`

3. Call \`CronCreate\` with:
   - \`cron: "0 4 * * *"\`
   - \`durable: true\`
   - \`recurring: true\`
   - prompt exactly:

\`\`\`text
Run the Limitless nightly harness improvement review. Dispatch the limitless-harness-improver agent. Review recent transcripts and .limitless/ralph ledgers for errors, time sinks, repeated corrections, provider/model routing misses, missing skills, missing agents, and missing API/MCP/tool leverage such as Gmail, calendars, CRMs, issue trackers, docs, analytics, databases, webhooks, and local project automation. Write a dated report under .limitless/improvement/reports/ and update .limitless/improvement/backlog.md with prioritized proposals. For clear missing integration capabilities, add an MCP/tool proposal or prototype scaffold under .limitless/improvement/. Do not edit harness code during the scheduled pass.
\`\`\`

4. Dispatch \`limitless-harness-improver\` once now if the user asked to run immediately or if no previous report exists.

Report the cron id, schedule, config path, latest report path, and backlog path.`
}

export function registerLimitlessTeamSkills(): void {
  registerBundledSkill({
    name: 'limitless-team',
    aliases: ['team', 'agent-team', 'limitless-agents', 'gstack'],
    description:
      'Route work through the built-in Limitless agent team inspired by G-Stack and curated agent-team repos.',
    whenToUse:
      'When a request benefits from specialist roles, multi-agent review, provider/model routing, or a compact team workflow.',
    argumentHint: '[objective]',
    userInvocable: true,
    files: LIMITLESS_TEAM_FILES,
    async getPromptForCommand(args) {
      return [{ type: 'text', text: buildTeamPrompt(args) }]
    },
  })

  registerBundledSkill({
    name: 'limitless-plan-review',
    aliases: ['plan-review', 'gstack-review', 'review-plan'],
    description:
      'Run a founder, engineering, design, and code-review pass over a plan or proposed change.',
    whenToUse:
      'When the user asks to review a plan, architecture, feature proposal, or implementation strategy.',
    argumentHint: '[plan or file path]',
    userInvocable: true,
    async getPromptForCommand(args) {
      return [{ type: 'text', text: buildPlanReviewPrompt(args) }]
    },
  })

  registerBundledSkill({
    name: 'limitless-ship',
    aliases: ['ship', 'land'],
    description:
      'Execute a compact ship pipeline: inspect, implement, verify, review, QA, docs, commit.',
    whenToUse:
      'When the user asks to ship, finish, land, or complete implementation work end to end.',
    argumentHint: '[objective]',
    userInvocable: true,
    async getPromptForCommand(args) {
      return [{ type: 'text', text: buildShipPrompt(args) }]
    },
  })

  registerBundledSkill({
    name: 'limitless-qa',
    aliases: ['qa', 'acceptance'],
    description: 'Run an acceptance-test pass with command and UI evidence.',
    whenToUse:
      'When the user asks whether something works, wants QA, or needs acceptance evidence before release.',
    argumentHint: '[target]',
    userInvocable: true,
    async getPromptForCommand(args) {
      return [{ type: 'text', text: buildQaPrompt(args) }]
    },
  })

  registerBundledSkill({
    name: 'limitless-learn',
    aliases: ['learn'],
    description: 'Capture reusable project learnings for future Limitless sessions.',
    whenToUse:
      'When a project convention, verification command, failed approach, or routing lesson should persist across sessions.',
    argumentHint: '[learning]',
    userInvocable: true,
    async getPromptForCommand(args) {
      return [{ type: 'text', text: buildLearnPrompt(args) }]
    },
  })

  registerBundledSkill({
    name: 'limitless-founder',
    aliases: ['founder', 'founder-os', 'operator'],
    description:
      'Run the founder operating bench across priority, strategy, product, finance, GTM, and operations.',
    whenToUse:
      'When the user asks for founder support, company strategy, operating decisions, or what to do next.',
    argumentHint: '[decision or company question]',
    userInvocable: true,
    async getPromptForCommand(args) {
      return [{ type: 'text', text: buildFounderPrompt(args) }]
    },
  })

  registerBundledSkill({
    name: 'limitless-gtm',
    aliases: ['gtm', 'sales', 'marketing'],
    description:
      'Run the GTM bench for ICP, positioning, sales, marketing, pipeline, outbound, and launch questions.',
    whenToUse:
      'When the user asks about sales, marketing, GTM strategy, positioning, ICP, pipeline, or launch motion.',
    argumentHint: '[GTM question]',
    userInvocable: true,
    async getPromptForCommand(args) {
      return [{ type: 'text', text: buildGtmPrompt(args) }]
    },
  })

  registerBundledSkill({
    name: 'limitless-finance',
    aliases: ['finance', 'fundraising', 'capital'],
    description:
      'Run the finance and capital bench for models, runway, pricing, unit economics, cap table, and fundraising.',
    whenToUse:
      'When the user asks about financial models, fundraising, investor materials, pricing, runway, or capital strategy.',
    argumentHint: '[finance question]',
    userInvocable: true,
    async getPromptForCommand(args) {
      return [{ type: 'text', text: buildFinancePrompt(args) }]
    },
  })

  registerBundledSkill({
    name: 'limitless-ops',
    aliases: ['ops', 'chief-of-staff', 'operator-mode'],
    description:
      'Run the operations bench for cadence, process, runbooks, status, vendor, risk, compliance, and follow-up systems.',
    whenToUse:
      'When the user asks about operations, process, cadence, status, vendors, risk, compliance, or chief-of-staff work.',
    argumentHint: '[operating problem]',
    userInvocable: true,
    async getPromptForCommand(args) {
      return [{ type: 'text', text: buildOpsPrompt(args) }]
    },
  })

  registerBundledSkill({
    name: 'limitless-integrations',
    aliases: ['integrations', 'mcp', 'api-tools', 'gmail-tools'],
    description:
      'Design or build API, MCP, Gmail, connector, webhook, local tool, skill, and model-friendly tool-schema workflows.',
    whenToUse:
      'When the user asks to connect external systems, push or pull data, add MCPs/tools, automate Gmail/API workflows, or improve tool-calling leverage.',
    argumentHint: '[workflow or system]',
    userInvocable: true,
    async getPromptForCommand(args) {
      return [{ type: 'text', text: buildIntegrationsPrompt(args) }]
    },
  })

  registerBundledSkill({
    name: 'limitless-self-improve',
    aliases: [
      'self-improve',
      'harness-improve',
      'nightly-improvement',
      'improve-harness',
    ],
    description:
      'Schedule or run the nightly Limitless harness self-improvement reviewer.',
    whenToUse:
      'When the user wants the harness to review transcripts, find errors/time sinks, research better patterns, and propose improvements on a schedule.',
    argumentHint: '[setup|run-now|status]',
    userInvocable: true,
    async getPromptForCommand(args) {
      return [{ type: 'text', text: buildSelfImprovePrompt(args) }]
    },
  })
}
