# Anthropic Recent Tooling: Late April – Early June 2026

**Research window:** April 13 – June 9, 2026 (Claude Code v2.1.105 → v2.1.170+)  
**Target:** Features that help Claude perform better at long-running autonomous tasks  
**Audience:** OpenClaude — an open-source Claude Code fork that is provider/model-agnostic  
**Knowledge cutoff note:** Claude's training cutoff is ~Jan 2026. Everything in this document was verified via WebSearch/WebFetch against live Anthropic docs and changelog pages during the research session. Source URLs are cited inline.

---

## Contents

1. [Context Management](#1-context-management)
   - 1a. Server-Side Compaction
   - 1b. Context Editing (Tool Result / Thinking Block Clearing)
   - 1c. Memory Tool
   - 1d. 1M Context Window GA
2. [Subagents & Orchestration](#2-subagents--orchestration)
   - 2a. Dynamic Workflows (Claude Code)
   - 2b. Agent SDK — Subagents
   - 2c. Managed Agents — Multiagent Orchestration, Outcomes, Dreaming
   - 2d. Agent View (`claude agents`)
   - 2e. `/goal` Command
3. [Tool-Use Improvements](#3-tool-use-improvements)
   - 3a. Task Budgets
   - 3b. Effort Parameter & `xhigh` Level
   - 3c. Hooks System (Claude Code + Agent SDK)
   - 3d. Security-Guidance Plugin
   - 3e. Mid-Conversation System Messages
4. [Long-Horizon / Autonomous-Run Features](#4-long-horizon--autonomous-run-features)
   - 4a. `/goal` (self-running loops)
   - 4b. Routines (scheduled cloud agents)
   - 4c. Background Sessions & `claude agents`
   - 4d. Mobile Push Notifications
   - 4e. Ultraplan
   - 4f. Fast Mode
5. [New Models](#5-new-models)
   - 5a. Claude Opus 4.7
   - 5b. Claude Opus 4.8
   - 5c. Claude Fable 5
6. [Platform & Infrastructure](#6-platform--infrastructure)
   - 6a. Self-Hosted Sandboxes (Managed Agents)
   - 6b. MCP Tunnels
   - 6c. Streaming Tool Execution Always-On
7. [OpenClaude Adoption Summary](#7-openclaude-adoption-summary)

---

## 1. Context Management

### 1a. Server-Side Compaction

**What it is:** The API automatically summarizes earlier conversation history when context approaches a configurable token threshold. The summary is injected as a `compaction` block; the API strips all prior message blocks on subsequent requests.

**How it works:**
- Trigger: `input_tokens` exceeds threshold (default 150,000; minimum 50,000)
- Claude generates a summary using the default or a custom `instructions` prompt
- The compaction block streams as a single `content_block_delta` event (no intermediate streaming unlike text blocks)
- `stop_reason: "compaction"` when `pause_after_compaction: true`
- Usage tracking splits into `iterations[]` — top-level `input_tokens`/`output_tokens` reflect only non-compaction iterations; sum all iterations for total billed cost

**API surface:**
```python
# Beta header required
betas=["compact-2026-01-12"]

# In messages.create / messages.stream:
context_management={
    "edits": [
        {
            "type": "compact_20260112",
            "trigger": {"type": "input_tokens", "value": 150000},
            "pause_after_compaction": False,    # optional
            "instructions": "Custom summary prompt..."  # optional, replaces default
        }
    ]
}
```

Passing compaction blocks back correctly: always append `response.content` (full list, not just `text` blocks) — compaction blocks must be in the message history or the API cannot strip prior context on the next request.

**Supported models:** Fable 5, Opus 4.8, 4.7, 4.6, Sonnet 4.6  
**Sources:** https://platform.claude.com/docs/en/build-with-claude/compaction

**OpenClaude adoption:**
- The agent loop in OpenClaude (`src/`) needs to preserve full `response.content` arrays (not just text extraction) so compaction blocks are not silently dropped
- Add a `compaction` strategy option to `ClaudeAgentOptions` that maps to this beta header + strategy; non-Claude providers can no-op or implement client-side summarization
- The `PreCompact` hook event (Week 16 addition) allows blocking compaction — useful for OpenClaude operators who want provider-parity by implementing their own summarization

---

### 1b. Context Editing (Tool Result / Thinking Block Clearing)

**What it is:** Server-side strategies that selectively clear stale content — tool results, thinking blocks — from conversation history without summarizing. Distinct from compaction (which summarizes; this prunes). Primary use case: agentic workflows with heavy tool use. Reported benefits: 84% token savings, 39% improvement on agentic search tasks.

**Strategies available:**
1. **`clear_tool_results_20250124`** — clears tool result blocks from earlier turns
2. **`clear_thinking_blocks_20250219`** — clears thinking blocks (options: clear all, or preserve last N)
3. **Client-side SDK compaction** — SDK-based summarization (server-side is preferred for most use cases)

**API surface (context editing is in `context_management.edits`):**
```python
# Tool result clearing
context_management={
    "edits": [
        {
            "type": "clear_tool_results_20250124",
            "trigger": {"type": "tool_use_count", "value": 5}  # after 5 tool uses
        }
    ]
}

# Thinking block clearing
context_management={
    "edits": [
        {
            "type": "clear_thinking_blocks_20250219",
            "preserve_last_n": 2  # keep last 2 thinking blocks
        }
    ]
}
```

**Sources:** https://platform.claude.com/docs/en/build-with-claude/context-editing

**OpenClaude adoption:**
- Wire these strategies into the context management config passed to each provider adapter
- Providers that don't support `context_management` can implement equivalent client-side pruning (strip `tool_result` blocks older than N turns before assembling the messages array)
- Worth implementing for OpenAI/Gemini adapters as a client-side option since those providers also suffer from tool-result bloat on long agent loops

---

### 1c. Memory Tool

**What it is:** A client-side tool that enables cross-session file-based memory. Claude reads from and writes to a `/memories` directory, allowing it to carry context across separate sessions.

**API surface:**
- Tool name: `memory_20250818` (declared in `tools` array)
- Python SDK: `BetaAbstractMemoryTool` helper class
- The tool exposes read/write/list operations on the `/memories` directory

```python
from anthropic.beta import BetaAbstractMemoryTool

tools = [BetaAbstractMemoryTool()]
# Claude can now call memory_20250818 to persist and retrieve facts
```

**Sources:** https://platform.claude.com/docs/en/agents-and-tools/tool-use/memory-tool

**OpenClaude adoption:**
- Implement as a first-class tool option in the Agent SDK layer — keep the `/memories` directory convention but allow path override
- Valuable for long autonomous runs where the agent needs to checkpoint learned state that survives session restart
- For non-Claude providers, the same tool definition can be passed; the provider executes the same file I/O tool implementation

---

### 1d. 1M Context Window GA

**What it is:** The 1M-token context window for Opus 4.6 and Sonnet 4.6 moved from beta to GA. No beta headers required. No long-context surcharge.

**Impact for autonomous tasks:** Long-running agents that accumulate large conversation histories can now operate through more turns before needing compaction or pruning, with no additional cost penalty.

**Models:** Opus 4.8, 4.7, 4.6, Sonnet 4.6 — all 1M context, GA  
**Sources:** Verified via claude-api skill model table and Week 22 changelog

**OpenClaude adoption:**
- Update any hardcoded context-window limits in OpenClaude's provider config for Anthropic models from 200K → 1M
- When selecting compaction/pruning triggers, default thresholds can be pushed higher for Anthropic models

---

## 2. Subagents & Orchestration

### 2a. Dynamic Workflows (Claude Code)

**What it is:** A JavaScript orchestration script that Claude writes for a task and a background runtime executes. The script coordinates subagents; intermediate results live in script variables, not Claude's context window. Designed for tasks too large for a single conversation: codebase-wide audits, 500-file migrations, cross-checked research.

**Key constraints:**
- Up to 16 concurrent agents (fewer on low-CPU machines)
- 1,000 total agents per run
- No mid-run user input (except for tool permission prompts)
- Resumable within the same session (agents that completed return cached results)
- Subagents always run in `acceptEdits` mode; inherit tool allowlist

**How to trigger:**
- Use the keyword `ultracode` in a prompt, or ask for "a workflow" in natural language
- `/effort ultracode` — sets `xhigh` reasoning + automatic workflow orchestration for every task in the session
- `/deep-research <question>` — bundled workflow for multi-source research

**Workflow script location:** `~/.claude/projects/<session>/` — readable and editable  
**Saving for reuse:** `/workflows` → select run → press `s` → saves to `.claude/workflows/` (project) or `~/.claude/workflows/` (personal)

**Availability:** Claude Code v2.1.154+, all paid plans, Bedrock, Vertex, Foundry  
**Sources:** https://code.claude.com/docs/en/workflows, https://code.claude.com/docs/en/whats-new/2026-w22

**OpenClaude adoption:**
- This is the most complex feature to reimplement since it requires a background JavaScript runtime + agent dispatch infrastructure
- Short path: treat the workflow script as a generated Bash/JS orchestration file and execute it via `claude -p` (non-interactive) with OpenClaude's provider routing
- Longer path: implement a lightweight workflow runner that reads the same script format and dispatches `query()` calls via the Agent SDK
- The `/deep-research` pattern (fan-out → cross-check → synthesize) is the highest-value template to reimplement as a named workflow

---

### 2b. Agent SDK — Subagents

**What it is:** The Agent SDK's `agents` option lets the main agent spawn named subagents (defined with a description, system prompt, and tool list). Subagents are invoked via the `Agent` tool. Messages from subagent context include `parent_tool_use_id` for lineage tracking.

**API surface (Python):**
```python
from claude_agent_sdk import query, ClaudeAgentOptions, AgentDefinition

async for message in query(
    prompt="Use the code-reviewer agent to review this codebase",
    options=ClaudeAgentOptions(
        allowed_tools=["Read", "Glob", "Grep", "Agent"],
        agents={
            "code-reviewer": AgentDefinition(
                description="Expert code reviewer for quality and security reviews.",
                prompt="Analyze code quality and suggest improvements.",
                tools=["Read", "Glob", "Grep"],
            )
        },
    ),
):
    print(message)
```

**Sessions:** Capture session ID from `SystemMessage(subtype="init").data["session_id"]` and pass `resume=session_id` to continue with full context.

**Sources:** https://code.claude.com/docs/en/agent-sdk/overview

**OpenClaude adoption:**
- OpenClaude already has an `Agent` tool concept; align the `AgentDefinition` schema with OpenClaude's existing subagent config format
- The `parent_tool_use_id` lineage field is useful for building an audit log of autonomous multi-agent runs — add to the event stream

---

### 2c. Managed Agents — Multiagent Orchestration, Outcomes, Dreaming

**What it is:** Three new capabilities added to Managed Agents (hosted REST API where Anthropic runs both the agent loop and the per-session sandbox):

**Multiagent Orchestration:** A coordinator agent delegates to specialist agents with their own model, prompt, and tool configuration, working in parallel on a shared filesystem.

**Outcomes:** Define success criteria via a rubric. The agent iterates and improves until criteria are met.
- API events: `user.define_outcome`, `span.outcome_evaluation_*`
- The agent autonomously retries and self-critiques against the rubric

**Dreaming (research preview):** A scheduled background process that reviews agent sessions and memory stores, extracts patterns, and curates memories so agents self-improve over time.

**Sources:** Announced ~May 6-7, 2026 at "Code with Claude" event. Managed Agents overview: https://platform.claude.com/docs/en/managed-agents/overview

**OpenClaude adoption:**
- Multiagent Orchestration: the coordinator/specialist pattern can be approximated today using nested `query()` calls in the Agent SDK, with each "specialist" being a separate `query()` call with different options
- Outcomes: implement a lightweight eval loop in OpenClaude — after each agent turn, run a fast judge model against a provided rubric string; re-invoke if criteria not met, up to N retries
- Dreaming: this is the most novel — it requires a persistent memory store + a scheduled reflection agent. The Mnemo memory architecture in Verick's stack already implements this pattern; the API surface is `mnemo_dream_*` tools

---

### 2d. Agent View (`claude agents`)

**What it is:** A terminal dashboard showing every Claude Code session — what's running, what's blocked on user input, what's completed. Each session runs as a background process without a terminal attached.

**CLI surface:**
```bash
claude agents                          # open dashboard
claude agents --cwd <path>             # scope to directory
claude agents --add-dir <path> \
  --model claude-opus-4-8 \
  --effort xhigh \
  --permission-mode acceptEdits        # dispatch a background session with config
claude --bg --exec 'pytest -x'        # run shell command as attachable background job
```

**Week 20 dispatch flags:** `--add-dir`, `--settings`, `--mcp-config`, `--plugin-dir`, `--permission-mode`, `--model`, `--effort`, `--dangerously-skip-permissions`

**Sources:** https://code.claude.com/docs/en/whats-new/2026-w20

**OpenClaude adoption:**
- OpenClaude can implement a similar process manager using the Agent SDK's session abstraction — persist session IDs in a local state file, provide a TUI or JSON status endpoint
- The `claude --bg --exec` pattern (background job with attach/detach) is directly implementable via `query()` in a forked process writing to a session JSONL

---

### 2e. `/goal` Command

**What it is:** A persistent completion condition for a Claude Code session. After every agent turn, a fast model evaluates whether the condition holds; if not, Claude automatically starts another turn instead of returning control. The goal clears once met. Works in interactive, `-p` (non-interactive), and Remote Control modes.

**Usage:**
```
/goal all tests in test/auth pass and the lint step is clean
```

**Sources:** https://code.claude.com/docs/en/whats-new/2026-w20

**OpenClaude adoption:**
- Implement as a wrapper around the Agent SDK's `query()` loop: after each `ResultMessage`, call a lightweight judge (e.g., Haiku 4.5 or local model) with the goal condition and the result; re-invoke `query()` if the condition is not met
- This is one of the highest-value features for autonomous task completion and is straightforwardly implementable without platform-specific APIs

---

## 3. Tool-Use Improvements

### 3a. Task Budgets

**What it is:** An advisory token budget for the full agentic loop. The model sees a server-injected countdown that updates as it generates thinking, tool calls, and output. The model self-moderates — finishing work gracefully rather than cutting off mid-action — as the budget depletes. Distinct from `max_tokens` (which is a hard per-request ceiling the model doesn't see).

**API surface:**
```python
# Beta header required
betas=["task-budgets-2026-03-13"]

output_config={
    "effort": "high",
    "task_budget": {
        "type": "tokens",
        "total": 64000,           # minimum 20,000
        "remaining": 48000        # optional: carry over from prior request after compaction
    }
}
```

**How counting works:**
- Budget counts what Claude *generates* this turn (thinking + tool calls + output text) plus new tool results it *sees* this turn
- Resent conversation history from prior turns is NOT counted again
- The countdown is server-side only; no `remaining` field in the response `usage` object
- Advisory, not hard-enforced — Claude may slightly exceed the budget to finish a current action gracefully

**Interaction with other params:**
- `effort` controls reasoning depth per step; `task_budget` caps total work across the loop — complementary
- Adaptive thinking scales down automatically as budget depletes
- Do NOT decrement `remaining` client-side when resending full history — this causes premature wrap-up

**Supported models:** Fable 5, Opus 4.8, 4.7 (beta). Not supported on Opus 4.6 or lower.  
**Sources:** https://platform.claude.com/docs/en/build-with-claude/task-budgets

**OpenClaude adoption:**
- Pass `task_budget` in `output_config` for any Anthropic model that supports it; for other providers, emulate by tracking output token count per turn and injecting a remaining-budget notice into the system prompt
- The cross-compaction `remaining` field solves a hard problem in long autonomous runs — implement a budget tracker in OpenClaude's agent loop that persists across turns and passes `remaining` after any context-pruning event

---

### 3b. Effort Parameter & `xhigh` Level

**What it is:** GA parameter controlling reasoning depth and token spend. Values: `low`, `medium`, `high` (default), `xhigh` (new in Opus 4.7), `max`.

**API surface:**
```python
output_config={"effort": "xhigh"}   # in messages.create — inside output_config, not top-level
```

**`xhigh`:** Between `high` and `max`. Recommended default for most coding and agentic tasks on Opus 4.7/4.8/Fable 5. Also the basis for `/effort ultracode` (xhigh + workflow orchestration) in Claude Code.

**In Claude Code:**
```
/effort xhigh
/effort ultracode    # xhigh + automatic dynamic workflows for every task
```

**Hooks can now read effort level:**
- `effort.level` field in hook JSON
- `$CLAUDE_EFFORT` environment variable (Week 19 addition)

**Sources:** https://code.claude.com/docs/en/whats-new/2026-w16, https://code.claude.com/docs/en/whats-new/2026-w19

**OpenClaude adoption:**
- OpenClaude should expose `effort` as a first-class option in its agent config; map to `output_config.effort` for Anthropic models
- For non-Anthropic providers, map to equivalent parameters (OpenAI `reasoning_effort`, Gemini thinking budget, etc.) in provider adapters
- `$CLAUDE_EFFORT` hook injection: if OpenClaude implements its own hooks system, add the active effort level to hook environment

---

### 3c. Hooks System (Claude Code + Agent SDK)

**What it is:** Lifecycle callbacks at key points in the agent loop. Available in both Claude Code (shell scripts / JSON) and the Agent SDK (Python/TypeScript callback functions).

**Available hook events (confirmed):**
- `PreToolUse` — validate/block/transform tool calls before execution
- `PostToolUse` — log/react after tool execution
- `Stop` — run after the agent ends a turn
- `SessionStart` — on session initialization (can return `reloadSkills: true`)
- `SessionEnd`
- `UserPromptSubmit` — on user input
- `MessageDisplay` (Week 22 addition) — transform/hide assistant message text at display time
- `PreCompact` — can block compaction (`exit 2` or `{"decision":"block"}`)

**New hook features (Week 19–20):**
- `effort.level` and `$CLAUDE_EFFORT` available in hook context
- `args: string[]` exec form — spawns command directly without a shell (no quoting issues for paths)
- `continueOnBlock` option — when a `PostToolUse` hook blocks a tool, feeds the rejection reason back to Claude and continues the turn instead of ending it
- `terminalSequence` field — hooks can emit desktop notifications, window titles, bells without a controlling terminal

**Agent SDK hooks (Python):**
```python
from claude_agent_sdk import HookMatcher

hooks={
    "PostToolUse": [
        HookMatcher(matcher="Edit|Write", hooks=[my_async_callback])
    ]
}
```

**Sources:** https://code.claude.com/docs/en/agent-sdk/overview, https://code.claude.com/docs/en/whats-new/2026-w19, https://code.claude.com/docs/en/whats-new/2026-w20

**OpenClaude adoption:**
- OpenClaude already has a hooks system (Verick's security-monitor.sh uses it); extend it to cover the `MessageDisplay` and `PreCompact` events
- `continueOnBlock` is particularly valuable for long autonomous runs — without it, a blocked tool call ends the turn and requires human intervention; with it, Claude can self-correct
- The `args: string[]` exec form should be the default for hook spawning in OpenClaude to avoid shell-quoting bugs in path-heavy hook scripts

---

### 3d. Security-Guidance Plugin

**What it is:** An Anthropic-maintained plugin that reviews Claude's code changes for vulnerabilities in the same session, at three granularities:
1. Fast pattern check on each file edit
2. Model review at the end of each turn
3. Deeper agentic review on commit or push

Custom rules: `.claude/claude-security-guidance.md`

**Install:**
```
/plugin install security-guidance@claude-plugins-official
/reload-plugins
```

**Sources:** https://code.claude.com/docs/en/whats-new/2026-w22

**OpenClaude adoption:**
- The three-tier review pattern (per-edit pattern check, per-turn model review, per-commit agentic review) is a valuable template for any quality-assurance plugin
- Implement as an OpenClaude plugin using the `PostToolUse` hook (for per-edit) + `Stop` hook (for per-turn) + a `PreCommit`-style trigger
- The `.claude/claude-security-guidance.md` custom rules convention should be adopted as a general pattern for operator-supplied plugin configuration

---

### 3e. Mid-Conversation System Messages

**What it is:** `{"role": "system", ...}` injected into the `messages[]` array at arbitrary positions. Allows operators to update instructions mid-session without invalidating the cached prefix for prior turns.

**API surface:**
```python
# Beta header
betas=["mid-conversation-system-2026-04-07"]

messages=[
    {"role": "user", "content": "Fix the auth bug"},
    {"role": "assistant", "content": response1.content},
    # Inject operator instruction mid-session:
    {"role": "system", "content": "New constraint: all changes must be backward-compatible"},
    {"role": "user", "content": "Now also check the session module"},
]
```

**Sources:** Confirmed in prior research session; beta header `mid-conversation-system-2026-04-07`

**OpenClaude adoption:**
- Critical for multi-agent handoffs where the operator needs to update constraints between agent turns without restarting the session
- Implement as an option in `query()` — allow the caller to inject a system message at the next turn boundary
- Cache-friendliness: because the system message is injected mid-array (not replacing the prefix), prior turns remain cache-eligible

---

## 4. Long-Horizon / Autonomous-Run Features

### 4a. `/goal` (self-running loops)

*(Full details in section 2e — listed here for cross-reference)*

A completion condition that drives autonomous multi-turn execution without user intervention. The evaluator (a fast model) checks the condition after each turn. OpenClaude equivalent: wrap `query()` in a loop with a judge call.

---

### 4b. Routines (Scheduled Cloud Agents)

**What it is:** Templated agents that fire on a schedule, GitHub event, or API webhook. Defined once on Claude Code on the web. Each routine gets a tokened `/fire` endpoint for external trigger.

**Trigger types:** Cron schedule, GitHub events (PR opened, release published, etc.) with optional filters, API webhook

**CLI scaffold:**
```
/schedule daily PR review at 9am
```

**Sources:** https://code.claude.com/docs/en/whats-new/2026-w16

**OpenClaude adoption:**
- The webhook `/fire` endpoint pattern is straightforwardly implementable as a small HTTP server that accepts a POST and invokes `query()` with a predefined prompt/options
- Schedule-based triggers: OpenClaude can implement via cron + the Agent SDK in `claude -p` mode
- GitHub event triggers: implement as a GitHub Actions step that calls the OpenClaude `/fire` endpoint

---

### 4c. Background Sessions & `claude agents`

*(Full details in section 2d)*

Background sessions persist without a terminal attached. `claude agents` is the management dashboard. Key for long autonomous runs that outlive a terminal session.

**OpenClaude adoption:** Implement session state as JSONL on disk; allow `query()` calls to resume sessions by ID; expose a status endpoint or simple TUI listing active sessions.

---

### 4d. Mobile Push Notifications

**What it is:** Push notifications to the developer's phone when a long agent task finishes or requires a decision. Requires Remote Control to be connected.

**CLI trigger:**
```
> notify me when the tests pass
```

**Config:** "Push when Claude decides" in `/config`  
**Sources:** https://code.claude.com/docs/en/whats-new/2026-w16

**OpenClaude adoption:**
- Implement via any push notification service (Pushover, Ntfy, Apple/Android push)
- Hook into the `Stop` hook event — emit a notification when the agent completes or produces a result requiring human action
- OpenClaude's existing Telegram/Slack notification infrastructure (from Verick's setup) covers this pattern

---

### 4e. Ultraplan

**What it is:** Cloud-based plan drafting. Draft a plan from the CLI, review and comment on it in a web editor, then run it remotely or pull it back locally.

**CLI trigger:**
```
/ultraplan
```

**Sources:** https://code.claude.com/docs/en/whats-new/2026-w15

**OpenClaude adoption:**
- The core pattern (generate plan → human review → execute) is the most important part to reimplement
- OpenClaude can implement via: `query()` with a `plan_only` flag → output plan as Markdown → present for human approval → re-invoke `query()` with the approved plan as system context

---

### 4f. Fast Mode

**What it is:** A high-speed configuration of the current model (same quality, ~2.5x speed, 2x per-token cost).

**Current state (as of Week 22):**
- Fast mode defaults to Opus 4.8 at $10/$50 per MTok
- Opus 4.7 fast mode: $30/$150 per MTok
- Toggle: `/fast`
- Opus 4.6 fast mode deprecated

**Sources:** https://code.claude.com/docs/en/whats-new/2026-w22, https://code.claude.com/docs/en/whats-new/2026-w20

**OpenClaude adoption:**
- Map `/fast` toggle to a provider-specific fast-inference endpoint or flag
- For Anthropic: set `output_config.effort` lower (e.g., `low`) + model stays the same; actual "fast mode" appears to be an infrastructure-level routing decision on Anthropic's side, not an API parameter

---

## 5. New Models

### 5a. Claude Opus 4.7

**Released:** Week 16 (April 13–17, 2026)  
**Model ID:** `claude-opus-4-7`  
**Context:** 1M tokens  
**Pricing:** $5/$25 per MTok (input/output)  
**Key changes from 4.6:**
- Introduces `xhigh` effort level (between `high` and `max`)
- Adaptive thinking only — `thinking: {type: "adaptive"}` replaces `budget_tokens`
- Sampling parameters (`temperature`, `top_p`, `top_k`) removed — returns 400 if sent
- `thinking: {type: "disabled"}` still works on 4.7; omitting `thinking` also works
- Task budgets supported (beta)
- Thinking content omitted by default; opt in with `thinking: {type: "adaptive", display: "summarized"}`

**Sources:** https://code.claude.com/docs/en/whats-new/2026-w16

---

### 5b. Claude Opus 4.8

**Released:** Week 22 (May 25–29, 2026) — now the default model  
**Model ID:** `claude-opus-4-8`  
**Context:** 1M tokens  
**Pricing:** $5/$25 per MTok (standard), $10/$50 per MTok (fast mode)  
**Key changes from 4.7:**
- Same API surface as 4.7 (no new breaking changes)
- `high` effort by default; `/effort xhigh` for harder tasks
- State-of-the-art long-horizon agentic work
- When thinking is disabled, may write longer reasoning into visible response — leave adaptive thinking on or add a final-answer-only instruction
- Task budgets supported (beta)

**Sources:** https://code.claude.com/docs/en/whats-new/2026-w22

---

### 5c. Claude Fable 5

**Model ID:** `claude-fable-5`  
**Context:** 1M tokens  
**Pricing:** $10/$50 per MTok  
**Breaking changes vs. 4.7/4.8:**
- Explicit `thinking: {type: "disabled"}` returns 400 — must **omit** the `thinking` parameter entirely instead
- Otherwise same adaptive-only surface as Opus 4.7/4.8

**Features:**
- Task budgets supported (beta)
- All effort levels including `xhigh` and `max`
- Highest capability tier for long-horizon agentic work

**Sources:** claude-api skill model table (cached 2026-05-26)

**OpenClaude adoption for all three models:**
- Update provider adapter's model capability matrix: context window 1M for all three, effort GA, task budgets beta
- Fable 5 breaking change (no explicit `thinking: disabled`) must be handled in the adapter — detect model ID and omit the `thinking` param rather than passing `{type: "disabled"}`
- For OpenClaude's provider-agnostic design: expose effort as a normalized 0–4 scale; map to each provider's native representation

---

## 6. Platform & Infrastructure

### 6a. Self-Hosted Sandboxes (Managed Agents)

**What it is:** Tool execution on user-controlled infrastructure (own VPC, or Cloudflare/Daytona/Modal/Vercel) while the agent loop runs on Anthropic's infrastructure. Public beta.

**Sources:** Announced at "Code with Claude" event ~May 6-7, 2026

**OpenClaude adoption:**
- OpenClaude already runs tools locally — this feature is essentially the default for OpenClaude
- The design pattern to adopt: clear separation between "agent loop" (LLM API calls) and "tool execution" (local process); currently this is the Agent SDK model

---

### 6b. MCP Tunnels

**What it is:** Reach MCP servers inside private networks via a lightweight gateway with a single outbound connection — no inbound firewall rules required. Research preview.

**Sources:** Announced at "Code with Claude" event ~May 6-7, 2026

**OpenClaude adoption:**
- Forward to OpenClaude's MCP server config layer — when a tunnel URL is provided, route MCP calls through the tunnel gateway rather than direct connection

---

### 6c. Streaming Tool Execution Always-On

**What it is:** Week 22 (v2.1.150+): streaming tool execution is now always enabled, including with telemetry disabled and on Bedrock, Vertex, and Foundry.

**Sources:** https://code.claude.com/docs/en/whats-new/2026-w22

**OpenClaude adoption:**
- Streaming tool execution (partial tool call results visible before completion) improves responsiveness in long tool calls
- Ensure OpenClaude's tool execution layer streams results rather than buffering until tool completion

---

## 7. OpenClaude Adoption Summary

The 8 most adoptable items, ranked by impact-to-effort ratio for a provider-agnostic fork:

1. **`/goal` self-running loops** — Wrap `query()` in a condition-checking loop with a lightweight judge model. No Anthropic-specific APIs needed. Directly enables the core autonomous-run use case. High impact, low effort.

2. **Task Budgets** — Pass `output_config.task_budget` for Anthropic models; emulate for other providers by injecting a "remaining budget: N tokens" notice into the system prompt and tracking output token counts. Prevents runaway agent loops and enables graceful wrap-up.

3. **Context Editing (tool result clearing)** — For non-Anthropic providers, implement as client-side pruning of `tool_result` blocks older than N turns. 84% token savings on long agentic runs is the most directly measurable efficiency gain in the list.

4. **Server-Side Compaction** — Enable via `betas=["compact-2026-01-12"]` for Anthropic models. For other providers, use the Client SDK compaction helper or a custom summarization step. The critical implementation detail: always preserve full `response.content` arrays, not just text extraction.

5. **`continueOnBlock` hook option** — When a `PostToolUse` hook blocks a tool call, feeding the rejection reason back to Claude (rather than ending the turn) allows the agent to self-correct without human intervention. This is the difference between a blocked autonomous run and a self-recovering one.

6. **Dynamic Workflows pattern** — Even without the full workflow runtime, the fan-out → cross-check → synthesize structure of `/deep-research` is high value. Implement as a Python/TS orchestrator that spawns multiple `query()` calls with the same task from different angles, then synthesizes results.

7. **Effort parameter with `xhigh`** — Map `effort` to `output_config.effort` for Anthropic; map to `reasoning_effort` (OpenAI) or thinking budget (Gemini) in provider adapters. `xhigh` is the recommended default for agentic tasks on Opus 4.7/4.8/Fable 5 — set it as OpenClaude's default for those models.

8. **Fable 5 breaking change guard** — One-line fix in the provider adapter: detect model ID `claude-fable-5` and omit `thinking` parameter rather than passing `{type: "disabled"}`. Without this, any OpenClaude session using Fable 5 with thinking disabled will return a 400 error.

---

*Research session: June 9, 2026. Sources: Anthropic Claude Code docs (code.claude.com/docs), Claude API docs (platform.claude.com/docs), weekly digests Week 15–22, Agent SDK overview.*
