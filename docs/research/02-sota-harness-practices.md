# SOTA Harness Engineering Practices for Long-Running Autonomous Agents
## Research Report — June 2026

**Scope:** Best practices across 2025–2026 literature and production systems (Claude Code, OpenHands/CodeAct, Devin 2.0, SWE-agent, Maestro, OpenDev) for building harnesses that run AI coding agents over long horizons with high completion fidelity, controlled cost, and acceptable latency on simple tasks.

---

## 1. Agent-Loop Design for Long-Horizon Autonomy

### 1.1 The Reactive While-Loop (Claude Code pattern)

The dominant SOTA pattern is a minimal **reactive while-loop** rather than a state-machine graph. Claude Code's `queryLoop()` cycles: context assembly → pre-model shapers → model call → tool dispatch → permission gate → result collection. Repeat until model produces a text-only turn (no `tool_use` blocks), an iteration cap fires, or a hook intervenes.

Key design choice: invest almost all code in execution infrastructure (tools, hooks, sandboxes, context management), almost none in explicit reasoning scaffolding. The architecture is 98.4% harness, 1.6% AI logic.

Source: [Dive into Claude Code (arXiv 2604.14228)](https://arxiv.org/html/2604.14228v1), [Agent Harness Engineering – Addy Osmani](https://addyosmani.com/blog/agent-harness-engineering/)

### 1.2 Extended ReAct Cycle (OpenDev/terminal agent pattern)

OpenDev uses a **six-phase ReAct extension** per loop iteration:
1. Pre-check and compaction (manage token budget first)
2. Thinking (optional, separate cheap model)
3. Self-critique (optional validation pass)
4. Action (LLM call with tool schemas)
5. Tool execution (registry dispatch)
6. Post-processing (iterate or return)

The thinking phase uses a independently configurable model — allows swapping in a fast model for reasoning and a stronger one for generation. This is multi-model routing within a single agent loop.

Source: [Building AI Coding Agents for the Terminal (arXiv 2603.05344)](https://arxiv.org/html/2603.05344v1)

### 1.3 Event-Sourced State / Agent as Pure Function (OpenHands 2025)

OpenHands' SDK redesign (Nov 2025) models an agent as a **pure function from event history to next event**, run in a loop. The conversation is an immutable, typed stream of `Action` and `Observation` Pydantic events. Both are replayable, both are stored append-only.

Benefits: pause/resume/fork, deterministic replay, full audit trail, and the ability to restart sessions from any checkpoint by replaying events. The state is the log.

Source: [OpenHands ICLR 2025 paper](https://proceedings.iclr.cc/paper_files/paper/2025/file/a4b6ad6b48850c0c331d1259fc66a69c-Paper-Conference.pdf), [OpenHands deep dive](https://pablordoricaw.github.io/multi-agent-systems-research/deep-dives/openhands/)

### 1.4 Checkpointing Strategies

**Git as checkpoint store:** agents commit to git after each meaningful unit of work, enabling rollback to any prior state. Claude Code uses git integration for version tracking and branch experimentation across sessions. This is cheaper and more reliable than purpose-built snapshot systems.

**Workpad/progress files:** Maestro v2 agents write a `WORKPAD.md` with analysis, acceptance criteria, and execution plan *before touching files*. On retry, new agent sessions read the workpad first. This is persistent memory without embedding APIs — just a file on disk.

**Filesystem-first state:** the filesystem is the canonical state store. Sessions write intermediate work to disk, not to context. On restart, read the filesystem to reconstruct current state. This is described as "a kitchen rather than a single gadget."

**Session JSONL transcripts:** Claude Code stores transcripts as append-only JSONL. Resume/fork reconstruct state from immutable logs. Subagents maintain separate sidechain files (not embedded in parent context), preventing bloat.

Source: [Claude Code Checkpointing docs](https://code.claude.ai/docs/en/checkpointing), [Maestro v2 harness post](https://blog.mphomphego.co.za/blog/2026/04/18/harness-engineering-building-maestro-v2-an-autonomous-github-agent-orchestrator.html), [Addy Osmani harness engineering](https://addyosmani.com/blog/agent-harness-engineering/)

### 1.5 Keep-Going vs. Stop Controls

**Keep-going:** the Ralph/loop pattern (Claude Code's `/loop` and `/goal` features) intercepts the model's attempt to exit, re-injects the original goal prompt into a fresh context window, and forces continuation. Each iteration starts from clean context but reads state from the filesystem. This has enabled documented runs of 3+ days of continuous autonomous work.

**Stop-condition checker:** the `/goal` command uses a dedicated **small, fast model** to evaluate the completion condition after every turn. The checker model is separate from the main reasoning model. This decouples "did I finish?" from "what do I do next?" — preventing self-grading bias where agents "reliably skew positive" when evaluating their own work.

**Verifiable stop conditions:** the four ingredients that make a stop condition actually work: (1) machine-verifiable (not "build a good app"); (2) document-grounded ("all 62 tasks in product-roadmap.md checked off"); (3) testable ("test suite passes with `npm test`"); (4) scoped ("do not modify auth.ts").

**Stall detection / retry limits:** Maestro v2 implements per-issue retry limits. On exhaustion, labels move to `stalled`, routing to human intervention rather than infinite retry. A lightweight evaluator node running every 3 steps (using a fast, cheap model) checks whether progress is being made; if `no_progress >= 3`, escalate or terminate.

Source: [Ralph Loop / Claude Code /goal](https://theaiarchitects.com/blog/claude-code-ralph-loop), [Maestro v2 harness post](https://blog.mphomphego.co.za/blog/2026/04/18/harness-engineering-building-maestro-v2-an-autonomous-github-agent-orchestrator.html), [Claude Code /loop feature](https://glenrhodes.com/claude-code-loop-feature-enables-3-day-autonomous-task-scheduling-shifting-ai-coding-tools-from-synchronous-query-tools-to-asynchronous-agents/)

---

## 2. Completion-vs-Quality Tension

### 2.1 Checklist/Work-Stream as Source of Truth

The single highest-ROI harness pattern for completion quality is making a **structured checklist or task list the authoritative completion criterion**, not the model's own judgment. Patterns:

- `product-roadmap.md` with checkboxes: checker model evaluates "are all boxes checked and CI green?" not "does the code feel done?"
- GitHub Issues with label state machine (`cc-todo → planning → in-progress → pr-review → done`): the state of the issue tracker IS the completion state
- `WORKPAD.md` with acceptance criteria written before any code is touched: grounds the completion check in pre-agreed criteria

This is **spec-driven development** applied to autonomous agents: the spec (checklist/issue) is the single source of truth, not model judgment.

Source: [Maestro v2 harness post](https://blog.mphomphego.co.za/blog/2026/04/18/harness-engineering-building-maestro-v2-an-autonomous-github-agent-orchestrator.html), [Agent skills need exit criteria](https://www.developersdigest.tech/blog/agent-skills-production-checklist)

### 2.2 Planner/Generator/Evaluator Split

The **Sprint Contract Pattern**: generator and evaluator agents negotiate "done conditions" before any code is written. This prevents scope drift, prevents the generator from gaming its own evaluation, and catches ambiguous completion criteria before execution spends tokens on them.

A separate evaluator agent is not optional for quality: models "reliably skew positive when evaluating own work." The verifier must be a different agent instance, ideally running a different model.

Source: [Addy Osmani harness engineering](https://addyosmani.com/blog/agent-harness-engineering/)

### 2.3 Code as the Verification Substrate

The SOTA pattern (described in the "Code as Agent Harness" paper, arXiv 2605.18747) is to use **code execution results — not language — as the completion signal**. The harness runs: generate code → sandbox execute → collect compiler errors/test results/exceptions → feed back. Completion criterion is machine-checkable: all tests pass, no type errors, no regressions against prior passing tests.

This eliminates the quality degradation risk from "LLM says it's done" and makes completion binary and verifiable.

Source: [Code as Agent Harness (arXiv 2605.18747)](https://arxiv.org/html/2605.18747v1)

### 2.4 Avoiding "Doom Loops" and Overclaiming

Early-exit research (arXiv 2505.17616) shows agents frequently fail to recognize they are stuck, entering "doom loops" (repeating failed actions). The harness must provide:

- **Iteration cap with stall detection** (not just a max turn limit): detect when the same action is repeated N times
- **Extrinsic exit** via a separate evaluator model: inject exit instructions from outside rather than relying on agent self-assessment
- **Failure escalation path**: transition from `stalled` label to human review rather than infinite retry

Overclaiming (prematurely declaring completion) is reduced by requiring the checker model to verify against machine-readable criteria, not the main agent's narration.

Source: [Early-exit agent behavior (arXiv 2505.17616)](https://arxiv.org/html/2505.17616v2), [Agentic workflow loop fixes](https://www.aiqnahub.com/agentic-workflow-loop-forever/)

---

## 3. Latency and Efficiency

### 3.1 Complexity-Based Routing (Fast Path vs. Full Loop)

**RouteLLM** (open-source, ICLR 2025): trains a BERT-class classifier (< 10ms, no LLM inference needed) that routes queries to cheap vs. expensive models. Achieves 85% cost reduction maintaining 95% quality by routing 90% of queries to nano/flash tier models.

Complexity scoring signals for routing:
- Query length and linguistic complexity
- Keyword detection (math, code, "design", "architect" keywords)
- Structural cues (multi-step requests, constraints, open-ended)
- Score < 0.4 → fast tier (Haiku, GPT-4o Mini); 0.4–0.8 → mid tier (Sonnet, GPT-4o); ≥ 0.8 → frontier (Opus, o3)

**Critical implication for OpenClaude:** the completion-forcing additions to the harness that slow down simple responses are the exact problem RouteLLM solves. Route single-turn, low-complexity queries directly to response generation without entering the full agent loop at all.

Source: [AI Agent Model Routing (Zylos Research)](https://zylos.ai/research/2026-03-02-ai-agent-model-routing/), [LLM Routing in production (LogRocket)](https://blog.logrocket.com/llm-routing-right-model-for-requests/), [Dynamic Model Routing survey (arXiv 2603.04445)](https://arxiv.org/pdf/2603.04445)

### 3.2 Cascading/Sequential Fallback

Attempt cheap model first; escalate based on confidence thresholds:
```
query → Haiku → [confidence >= 0.7?]
  YES → return immediately (no loop entered)
  NO  → Sonnet → [confidence >= 0.7?]
    YES → return
    NO  → full agent loop with Opus/frontier model
```

Confidence estimation: logprob thresholds on answer tokens, model self-reported confidence, or a secondary judge model. The latency cost is one extra fast-model call before the expensive path.

Source: [Zylos routing research](https://zylos.ai/research/2026-03-02-ai-agent-model-routing/)

### 3.3 Speculative / Parallel Tool Use

**Streaming tool execution:** Claude Code begins executing tools *as they stream from the model response*, not after the full response arrives. Concurrent-safe tools (read-only operations) execute in parallel; state-modifying tools serialize. This hides tool latency through overlap rather than sequential chaining.

**Graph-based tool routing (arXiv 2603.01548):** a dependency graph handles routine tool substitutions deterministically; LLM is only invoked when the graph returns no path. Result: 93% reduction in control-plane LLM calls for tool routing decisions.

**GAP (Graph-based Agent Planning, arXiv 2510.25320):** models task dependencies as a graph to identify which tools can execute in parallel. Reinforcement learning trains the model to distinguish parallelizable vs. sequential queries. DualSpec (arXiv 2603.07416) uses a speculate-verify paradigm where a small reasoning model drafts actions while a stronger model performs full reasoning in parallel.

Source: [Parallel tool calling optimization (Zylos 2026)](https://zylos.ai/research/2026-04-23-parallel-tool-calling-optimization-ai-agents), [Graph-based agent planning (arXiv 2510.25320)](https://arxiv.org/html/2510.25320v1)

### 3.4 Early Exit on Simple Turns

For single-turn conversational queries that don't require tools, the full agent loop (pre-check, compaction check, permission gate, result collection) adds unnecessary latency. Pattern: **detect tool-free responses before entering the loop**. If the model's first response has no `tool_use` blocks and the query complexity score is below threshold, skip the loop machinery and return immediately.

Claude Code does this implicitly (the loop terminates on text-only turns), but the cost is still one full loop iteration. An explicit pre-loop classifier can route simple queries out entirely.

Source: [Claude Code architecture (arXiv 2604.14228)](https://arxiv.org/html/2604.14228v1)

### 3.5 Lazy Tool Schema Loading

Do not expose all tool schemas upfront. OpenDev uses **lazy MCP discovery**: `search_tools` finds external tools keyword-by-keyword only when contextually relevant. Claude Code's `ToolSearch` mechanism loads full schemas on demand; deferred tools appear by name only until fetched. This reduces context overhead on every request that doesn't need the full tool menu.

Rule of thumb from production: ten well-described tools outperform fifty partially-described tools. Models need to "hold the menu in their head."

Source: [Effective context engineering for AI agents (Anthropic)](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents), [Building terminal agents (arXiv 2603.05344)](https://arxiv.org/html/2603.05344v1)

---

## 4. Provider/Model-Agnostic Orchestration

### 4.1 Per-Step Model Routing in Multi-Turn Loops

The production pattern for agentic pipelines is **per-step model assignment** based on what each step requires, not a single model for the whole conversation:

| Step | Model tier | Rationale |
|------|-----------|-----------|
| Intent classification / triage | Nano (Haiku, GPT-4o Mini) | Binary/categorical decision; < 10ms |
| Tool selection | Fast-mid (Sonnet) | Moderate reasoning needed |
| Complex multi-hop reasoning / planning | Frontier (Opus, o3) | Hard tasks; frontier justified |
| Self-critique / verification | Fast-mid or dedicated judge | Separate from generator |
| Final synthesis / response | Mid (Sonnet) | Quality output at lower cost |

Organizations using a single LLM for all tasks overpay by 40–85% vs. intelligent routing. Routing 90% to nano tier with 10% to frontier yields ~86% cost savings with negligible quality loss.

Source: [Multi-model routing (Mindra)](https://mindra.co/blog/multi-model-routing-llm-orchestration-2026), [Zylos routing](https://zylos.ai/research/2026-03-02-ai-agent-model-routing/)

### 4.2 Topaz: Skill-Vector Routing

From [Explainable Model Routing for Agentic Workflows (arXiv 2604.03527)](https://arxiv.org/html/2604.03527v1): decompose routing into eight skill dimensions (mathematical reasoning, logical reasoning, code generation, tool use, factual knowledge, writing quality, instruction following, summarization). For each subtask, compute overlap between task requirement vector and model capability vector using `min(1, capability/requirement)` — satisfaction is capped, excess capability provides no benefit. Route to cheapest model that satisfies requirements.

This prevents the "over-allocation" problem: assigning Opus to a task a Haiku can handle equally well.

### 4.3 Backend Abstraction Pattern (Maestro v2)

Maestro v2 implements identical `Protocol` interfaces for Claude Code CLI and AWS Bedrock backends, returning `AsyncIterator[TurnEvent]`. Swapping backends is a single config value. This enables: CLI in development (no AWS credentials), Bedrock in production (no subprocess overhead), seamless migration between providers.

For OpenClaude: abstract the provider interface so routing decisions only change a model identifier, not the calling code.

Source: [Maestro v2 harness post](https://blog.mphomphego.co.za/blog/2026/04/18/harness-engineering-building-maestro-v2-an-autonomous-github-agent-orchestrator.html)

### 4.4 MasRouter (ACL 2025): Three-Layer Multi-Agent Routing

For complex multi-agent systems: three-layer cascade routing:
1. **Collaboration determiner:** single-agent vs. multi-agent workflow
2. **Role allocator:** which specialized roles are needed
3. **LLM router:** which model per role

Results on benchmarks: 1.8–8.2% quality improvement with 52% overhead reduction vs. static assignment.

Source: [Zylos routing research](https://zylos.ai/research/2026-03-02-ai-agent-model-routing/)

---

## 5. Orchestration Patterns

### 5.1 Four Subagent Patterns (2026)

Phil Schmid's canonical taxonomy ([subagent-patterns-2026](https://www.philschmid.de/subagent-patterns-2026)):

**Pattern 1: Inline Tool (Subagent as Function Call)**
- Subagent spawned via tool call, returns result as tool response
- Synchronous (blocks) or asynchronous (returns ID, result arrives as notification)
- Use for: self-contained bounded tasks (code review, file analysis, test generation)
- Cheapest model that supports tool use is sufficient

**Pattern 2: Fan-Out (Spawn and Wait)**
- `spawn_agent` dispatches immediately, returns ID; `wait_agent` blocks on completion
- Main agent can interleave its own work between spawn and collect
- Use for: multiple independent tasks running concurrently
- No mid-task course correction possible

**Pattern 3: Agent Pool (Persistent with Messaging)**
- Long-lived subagents communicating via `send_message`/`wait_agent`/`kill_agent`
- Agents retain conversation history across multiple interactions
- Use for: multi-step workflows where agents collaborate iteratively
- Results arrive incrementally; orchestrator adjusts follow-up instructions

**Pattern 4: Teams (Direct Agent-to-Agent)**
- Agents message each other directly without routing through main agent
- Main agent's context stays clean; inter-agent conversations are invisible
- Use for: large tasks where coordination logic exceeds single-agent capacity
- Requires frontier-class models for all participants; hardest to debug

**Recommendation:** Start with Pattern 1; advance only when sub-task coordination complexity demands it. Pattern 2 is sufficient for most parallel workloads. Pattern 4 should be rare.

Source: [Phil Schmid subagent patterns 2026](https://www.philschmid.de/subagent-patterns-2026)

### 5.2 Context Compaction Strategies

Context "rot" (degradation) begins at every increment of context growth, not just at the context limit. Chroma's 2025 study found a "lost-in-the-middle" effect with 30%+ accuracy drops for information buried in middle turns. 65% of enterprise AI failures in 2025 were attributed to context drift or memory loss, not raw context exhaustion.

**Five-layer progressive compaction (Claude Code):**
1. Budget reduction: per-message result size caps via `maxResultSizeChars`
2. Snip: lightweight temporal trim of older segments
3. Microcompact: time-based + cache-aware compression
4. Context collapse: read-time projection over history (non-destructive)
5. Auto-compact: model-generated semantic summary (last resort)

Earlier, cheaper layers run before costly summarization. The model only pays for summarization when all cheaper options are exhausted.

**Observation masking (SOTA cost-efficient approach):** replace environment observations beyond recent turns with single-line summaries. Research shows this "often matched or exceeded LLM summarization in solve rate" while being substantially cheaper, and avoids the risk that summarization "inadvertently extend[s] agent trajectories by 13–15% by obscuring natural stopping signals."

**Session rotation thresholds:**
- 64% context usage: trigger memory synchronization while context is still coherent
- 80% context usage: initiate graceful handoff to fresh session

**What to preserve in compaction:**
- Architectural choices and decisions made
- Specific file paths and code modifications
- Alternatives rejected (prevents re-litigating decisions)
- Next-priority tasks, explicitly ordered
- Environmental configuration for reproducibility

**What to discard:**
- Raw tool outputs and intermediate search results
- Temporary file contents
- Redundant observations

Source: [Anthropic context engineering](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents), [Context window management (Zylos)](https://zylos.ai/research/2026-03-31-context-window-management-session-lifecycle-long-running-agents/), [Context compaction in agent frameworks (DEV)](https://dev.to/crabtalk/context-compaction-in-agent-frameworks-4ckk)

### 5.3 Planner/Executor/Verifier Split

**Plan-then-Execute (canonical):** planner decomposes goal into bounded changes with clear acceptance criteria; executor makes changes; reviewer checks correctness, risk, and missing tests; decider determines if result merges or cycles.

**Critical rule:** planner should use read-only tool schemas during planning. OpenDev enforces this by giving the Planner subagent a schema containing only read-only tools — "the LLM never sees tool definitions it cannot use, eliminating the possibility of write attempts during planning." This is architectural enforcement, not a prompt instruction.

**Complexity-based plan approval (Maestro v2):** agents calculate a complexity score (0.0–1.0) in the workpad. Below 0.3, proceed automatically. At 0.3+, require human approval before moving to `in-progress`. Human reviews plan and complexity estimate simultaneously. This is a concrete keep-going vs. stop control gated on estimated complexity.

Source: [Plan-then-execute pattern (multi-agent)](https://www.digitalapplied.com/blog/multi-agent-orchestration-5-patterns-that-work), [Maestro v2 harness post](https://blog.mphomphego.co.za/blog/2026/04/18/harness-engineering-building-maestro-v2-an-autonomous-github-agent-orchestrator.html)

### 5.4 Hooks as Enforcement Layer

Hooks fire at lifecycle points (PreToolUse, PostToolUse, pre-commit) and are the structural enforcement mechanism that keeps agents on the rails. Claude Code uses seven-layer defense:
1. Pre-filtering: deny rules strip tools before model sees them
2. Deny-first rule evaluation
3. Permission mode constraints
4. Auto-mode ML classifier
5. Shell sandboxing
6. Permission restoration blocking on resume/fork
7. Hook-based interception (Pre/PostToolUse)

Maestro v2 uses PostToolUse hooks to auto-format Python with ruff before the next turn — the agent never has a chance to ignore linting because the hook enforces it at the tool layer.

**Pattern:** hooks enforce harness rules deterministically; model instructions enforce them probabilistically. Put any invariant that must always hold into a hook, not a prompt.

Source: [Claude Code architecture (arXiv 2604.14228)](https://arxiv.org/html/2604.14228v1), [Maestro v2 harness post](https://blog.mphomphego.co.za/blog/2026/04/18/harness-engineering-building-maestro-v2-an-autonomous-github-agent-orchestrator.html)

### 5.5 Single Parameterized Agent Class

OpenDev lesson: use a **single parameterized agent class** rather than a hierarchy of planning/exploration/generation subclasses. Configure via constructor arguments (`allowed_tools`, system prompt overrides). This solved the "diamond problem" when subagents needed mixed capabilities and eliminated a whole class of coordination bugs.

**Dependency injection:** seven managers (mode, approval, undo, session, etc.) are bundled in a single `AgentDependencies` object passed at execution time, not construction time. This decouples agent logic from runtime services and makes testing straightforward.

Source: [Building terminal agents (arXiv 2603.05344)](https://arxiv.org/html/2603.05344v1)

### 5.6 Harness as Intelligence, Model as Executor

Maestro v2's key principle: **intelligence lives in `WORKFLOW.md`, not in the orchestrator code.** The template is Jinja2-rendered per-issue with context. When failure patterns emerge, fix the template — not the model selection or the orchestrator. Three enforcement layers:
1. Feedforward (WORKFLOW.md hard rules preventing failures)
2. Hooks (PostToolUse auto-formatting, plan-mode enforcement)
3. Feedback (Langfuse traces catching stalls post-generation)

Addison Osmani's summary: "A decent model with a great harness beats a great model with a bad harness. The gap between model capability and observed performance is largely a harness gap."

---

## 6. Observability and Feedback Infrastructure

### 6.1 Per-Task Isolated Observability

Assign a `task_id` to each agent invocation. Route logs to task-specific output (file, log group, trace). Shared monitoring hides individual agent failures in noise. Maestro v2 uses Langfuse: every issue run becomes a top-level trace; key operations are named spans (`issue-run`, `tracker.toctou_check`, `tracker.move_to_planning`).

### 6.2 Verdict Ledger / History Store

Every completed run should write to a history store capturing: issue ID, final status, attempt number, token counts, session ID, transcript, timestamps. This enables: post-mortems, "how many issues stalled last week?" queries, cost accounting per task type, and training data generation.

Source: [Maestro v2 harness post](https://blog.mphomphego.co.za/blog/2026/04/18/harness-engineering-building-maestro-v2-an-autonomous-github-agent-orchestrator.html)

### 6.3 Immutable Append-Only State

Claude Code's JSONL transcript format and Maestro's frozen dataclasses both converge on the same pattern: **state mutation produces new objects; old state is never overwritten.** Benefits: no race conditions in async environments, full history for replay, auditability without separate audit infrastructure.

---

## 7. Concrete Implementation Checklist for OpenClaude

### Agent Loop
- [ ] Implement reactive while-loop; terminate on text-only turn (no tool_use blocks)
- [ ] Add iteration cap + doom-loop detection (same action repeated N times)
- [ ] Use a separate lightweight checker model for completion evaluation (not self-evaluation)
- [ ] Make stop conditions machine-verifiable (checklist file, test suite, file state)
- [ ] Implement stall escalation path (N failed attempts → human/stalled state, not infinite retry)

### Latency / Fast Path
- [ ] Add pre-loop complexity classifier (BERT-class, < 10ms) to bypass full loop on simple queries
- [ ] Route queries below complexity 0.4 directly to nano/fast model without entering agent loop
- [ ] Implement lazy tool schema loading — expose tool names only, load schemas on demand
- [ ] Enable streaming tool execution (parallel concurrent-safe tools, serialize state-modifying)

### Context Management
- [ ] Implement five-layer progressive compaction (caps → snip → microcompact → collapse → summarize)
- [ ] Set session rotation thresholds: warn at 64%, rotate at 80% context usage
- [ ] Use observation masking (replace old tool outputs with summaries) before LLM summarization
- [ ] Store what to preserve in handoffs: decisions made, files modified, next steps, alternatives rejected

### Multi-Model Routing
- [ ] Assign distinct models to: planner, executor, verifier/checker, synthesizer
- [ ] Route per-step by task type (triage → nano; complex reasoning → frontier)
- [ ] Abstract provider behind identical protocol interface; model assignment is config only
- [ ] Implement complexity-gated human approval (score < 0.3 → auto; ≥ 0.3 → human review)

### Orchestration
- [ ] Default to Pattern 1 (inline tool subagents); promote to Pattern 2 (fan-out) when parallel tasks exist
- [ ] Enforce planner tool schema contains only read-only tools — architectural, not prompt-based
- [ ] Implement PreToolUse hooks for destructive operations, PostToolUse hooks for quality enforcement
- [ ] Write WORKFLOW.md/AGENTS.md entries only for observed failures; remove when redundant

### State and Observability
- [ ] Use append-only JSONL/immutable frozen dataclasses for state; mutations produce new objects
- [ ] Write workpad/progress file before any code changes; read it first on session resume
- [ ] Assign task_id per invocation; isolate logs per task
- [ ] Maintain verdict ledger (history store) with: status, attempts, tokens, transcript, timestamps

---

## Sources

- [Code as Agent Harness (arXiv 2605.18747)](https://arxiv.org/html/2605.18747v1)
- [Building AI Coding Agents for the Terminal (arXiv 2603.05344)](https://arxiv.org/html/2603.05344v1)
- [Anatomy of an Agent Harness – LangChain](https://www.langchain.com/blog/the-anatomy-of-an-agent-harness)
- [Agent Harness Engineering – Addy Osmani](https://addyosmani.com/blog/agent-harness-engineering/)
- [Dive into Claude Code (arXiv 2604.14228)](https://arxiv.org/html/2604.14228v1)
- [Claude Code Checkpointing Docs](https://code.claude.ai/docs/en/checkpointing)
- [Claude Code /loop and /goal](https://glenrhodes.com/claude-code-loop-feature-enables-3-day-autonomous-task-scheduling-shifting-ai-coding-tools-from-synchronous-query-tools-to-asynchronous-agents/)
- [Ralph Loop Pattern](https://theaiarchitects.com/blog/claude-code-ralph-loop)
- [Harness Engineering: Maestro v2 (Mphomphego blog)](https://blog.mphomphego.co.za/blog/2026/04/18/harness-engineering-building-maestro-v2-an-autonomous-github-agent-orchestrator.html)
- [Maestro HN thread](https://news.ycombinator.com/item?id=46307563)
- [RunMaestro.ai](https://runmaestro.ai/)
- [Effective Context Engineering for AI Agents (Anthropic)](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)
- [Context Window Management (Zylos)](https://zylos.ai/research/2026-03-31-context-window-management-session-lifecycle-long-running-agents/)
- [Context Compression Strategies (Zylos)](https://zylos.ai/research/2026-02-28-ai-agent-context-compression-strategies/)
- [Phil Schmid: Subagent Patterns 2026](https://www.philschmid.de/subagent-patterns-2026)
- [Multi-Agent Orchestration Patterns 2026](https://www.digitalapplied.com/blog/multi-agent-orchestration-5-patterns-that-work)
- [AI Agent Model Routing (Zylos)](https://zylos.ai/research/2026-03-02-ai-agent-model-routing/)
- [Explainable Model Routing for Agentic Workflows (arXiv 2604.03527)](https://arxiv.org/html/2604.03527v1)
- [Dynamic Model Routing Survey (arXiv 2603.04445)](https://arxiv.org/pdf/2603.04445)
- [Multi-model routing 2026 (Mindra)](https://mindra.co/blog/multi-model-routing-llm-orchestration-2026)
- [LLM Routing in production (LogRocket)](https://blog.logrocket.com/llm-routing-right-model-for-requests/)
- [Parallel Tool Calling Optimization (Zylos)](https://zylos.ai/research/2026-04-23-parallel-tool-calling-optimization-ai-agents)
- [Graph-based Agent Planning (arXiv 2510.25320)](https://arxiv.org/html/2510.25320v1)
- [DualSpec speculative planning (arXiv 2603.07416)](https://arxiv.org/pdf/2603.07416)
- [Early-exit agent behavior (arXiv 2505.17616)](https://arxiv.org/html/2505.17616v2)
- [OpenHands ICLR 2025](https://proceedings.iclr.cc/paper_files/paper/2025/file/a4b6ad6b48850c0c331d1259fc66a69c-Paper-Conference.pdf)
- [Beyond Task Completion: Assessment Framework (arXiv 2512.12791)](https://arxiv.org/html/2512.12791v1)
- [PARC: Autonomous Self-Reflective Coding Agent (arXiv 2512.03549)](https://arxiv.org/pdf/2512.03549)
- [Context as a Tool: SWE-Agents (arXiv 2512.22087)](https://arxiv.org/pdf/2512.22087)
- [FoldAct (arXiv 2512.22733)](https://arxiv.org/pdf/2512.22733)
- [ARC context management (arXiv 2601.12030)](https://arxiv.org/pdf/2601.12030)
