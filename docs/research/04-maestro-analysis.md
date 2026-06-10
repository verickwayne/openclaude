# Maestro Architecture Analysis — Patterns for OpenClaude

**Source location:** `/Users/verickwayne/Projects/ruflo/v2/src/maestro/` (part of the Ruflo / claude-flow v2 project)  
**Key files read:**
- `/Users/verickwayne/Projects/ruflo/v2/src/maestro/maestro-types.ts`
- `/Users/verickwayne/Projects/ruflo/v2/src/maestro/maestro-swarm-coordinator.ts`
- `/Users/verickwayne/Projects/ruflo/v2/src/hive-mind/core/HiveMind.ts`
- `/Users/verickwayne/Projects/ruflo/v2/src/hive-mind/core/Queen.ts`
- `/Users/verickwayne/Projects/ruflo/v2/src/hive-mind/integration/SwarmOrchestrator.ts`
- `/Users/verickwayne/Projects/ruflo/v2/src/hive-mind/core/Memory.ts`
- `/Users/verickwayne/Projects/ruflo/v2/src/providers/provider-manager.ts`
- `/Users/verickwayne/Projects/ruflo/v2/docs/AUTOMATIC_ERROR_RECOVERY_v2.7.35.md`
- `/Users/verickwayne/Projects/ruflo/v2/tests/maestro/test-specs-driven-workflow.cjs`
- `/Users/verickwayne/Projects/ruflo/v2/CLAUDE.md` (project config, exposed via system reminder)

---

## 1. What Maestro Is

Maestro is the **specs-driven workflow orchestration layer** inside Ruflo (a fork/extension of claude-flow). It is not a standalone project — it lives under `src/maestro/` and delegates all actual execution to a lower-level **HiveMind swarm** (`src/hive-mind/`). The two layers work together:

- **Maestro** = the workflow state machine (phases: Requirements → Design → Implementation → Quality Gates → Completed). Surfaces to users via CLI commands (`npx claude-flow maestro spec`, `maestro implement`, etc.).
- **HiveMind** = the execution engine (Queen coordinator, typed Agents, SwarmOrchestrator, Consensus, shared SQLite-backed Memory).

The primary coordinator class is `MaestroSwarmCoordinator` (`maestro-swarm-coordinator.ts`). It replaced an earlier `MaestroOrchestrator` (the commit message says "Eliminates dual agent systems").

---

## 2. Agent Loop / Orchestration Model

### Maestro workflow state machine
`MaestroWorkflowState` (in `maestro-types.ts`) tracks a named feature through five sequential phases stored as a `Map<string, MaestroWorkflowState>` in the coordinator:

```
Requirements Clarification → Research & Design → Implementation Planning → Task Execution → Completed
```

Phase transitions are explicit method calls: `createSpec()` → `generateDesign()` → `generateTasks()` → `implementTask(n)` → `reviewTasks()` → `approvePhase()`. Each step:
1. Submits a typed `TaskSubmitOptions` to `hiveMind.submitTask()`.
2. Polls until the task's DB status flips to `completed` or `failed` (via `waitForTaskCompletion()` with per-phase timeouts: 2 min / 5 min / 10 min respectively).
3. Updates `state.currentPhase` and appends a history entry.

### HiveMind execution engine
Inside `HiveMind`, `submitTask()` writes the task to SQLite, calls `orchestrator.submitTask()`, then notifies the `Queen`. The `Queen` runs two independent `setInterval` loops:
- **Coordination loop** (every 5 s): health-checks agents, detects stalled tasks (no progress in >10 min), triggers rebalancing.
- **Optimization loop** (every 60 s): analyzes performance patterns, adjusts strategy parameters, trains neural patterns from successful decisions.

`SwarmOrchestrator` has three more loops:
- **Task distributor** (every 5 s): drains the queued-assignment backlog by matching capability requirements to idle agents.
- **Progress monitor** (every 2 s): emits `progressUpdate` events as `currentPhase / totalPhases`.
- **Load balancer** (every 30 s): calls `rebalance()` when `loadFactor > 0.8` and idle agents exist.

**Pattern:** The system is a **multi-loop state machine** rather than a single "agent loop." Each concern (health, load, progress, task distribution) has its own interval-driven loop operating at a different cadence.

---

## 3. Long-Run Management: Checkpointing, Persistence, Resume, Recovery

### Persistence
All state lives in a **SQLite database** (singleton `DatabaseManager`, path `.swarm/memory.db`). Swarms, agents, tasks, agent-to-task assignments, consensus proposals, and inter-agent communications are all rows in this DB. `HiveMind.load(swarmId)` fully reconstitutes a swarm from the database — agents are reloaded with their capabilities, the active swarm pointer is restored, and execution can resume.

### Resume
`HiveMind.load()` reads the swarm config from `JSON.parse(swarmData.config)`, re-initializes all subsystems, and loops over all agents stored for that swarm to re-instantiate them. This is the primary resume path.

### Checkpoints
`SwarmOrchestrator.createExecutionPlan()` attaches `checkpoints` to every execution plan — one per phase, with `validationCriteria` and a `failureThreshold`. After each sequential phase, `evaluateCheckpoint()` scores the phase result; if the score is below the threshold, execution throws and falls to `handleTaskFailure()`.

### Failure recovery
`Queen.handleAgentFailure()` detects unresponsive agents (via `agent.isResponsive()` polled in the coordination loop) and calls `reassignTask()` to move work to the next available agent. `HiveMind.retryTask()` creates a new task tagged `retryOf: originalTaskId` with empty dependencies, so retry is idempotent and traceable.

At the infrastructure level, `error-recovery.ts` (v2.7.35) adds `retryWithRecovery<T>(fn, options)` — exponential backoff (1 s, 2 s, 4 s… up to 16 s, 3–5 attempts) with configurable cleanup callbacks and an explicit SQLite → JSON fallback when SQLite is unavailable.

### Run history
Every `MaestroWorkflowState` carries a `history: Array<{ phase, status, timestamp, output?, error? }>` that accumulates as phases complete. `getWorkflowState(featureName)` returns this for human inspection. The DB independently stores `tasks` rows with `created_at`, `assigned_at`, `completed_at`, `result`, and `error` fields.

---

## 4. Continue vs. Stop — Completion Criteria

Maestro's explicit phase-approval gate (`approvePhase()`) is the key stop/continue mechanism:

1. Each phase produces file artifacts (`requirements.md`, `design.md`, `tasks.md`, `quality-review.md`) under `.claude/claude-flow/maestro/specs/<featureName>/`.
2. `approvePhase()` optionally runs a **consensus vote** among agents (≥66% threshold, 5-minute deadline). If consensus fails, it throws — the phase is blocked until a human or retry resolves it.
3. The `phaseProgression` map is a fixed DAG; there is no back-edge. Once `Completed` is reached there is no further work.
4. Quality gates in `KiroEnhancedSpec` (`maestro-types.ts`) add a second layer: `QualityGate` objects with `blocking: boolean` and per-criterion scoring. If a blocking gate fails, `evaluateCheckpoint()` throws before the phase is marked done.

**The completion-forcing tension:** Maestro's approach is heavy gating. Each phase calls `waitForTaskCompletion()` which polls a DB row until `status === 'completed'` or hits a hard timeout. There is no "declare done early" path — the coordinator always waits for the swarm to write a terminal status. This means a slow simple task is held to the same wall-clock ceiling as a complex one (e.g., `implementTask` has a 10-minute hard timeout regardless of task size). This is directly analogous to OpenClaude's completion-forcing problem.

---

## 5. Task Decomposition / Subagent / Multi-Agent Coordination

### Topology-based agent specialization
`HiveMind.autoSpawnAgents()` reads a topology config and spawns typed agents:
- `specs-driven` topology: `requirements_analyst × 1`, `design_architect × 2`, `task_planner × 1`, `implementation_coder × 2`, `quality_reviewer × 1`, `steering_documenter × 1`.
- Each agent type has a fixed capability set (e.g., `implementation_coder` gets `['code_generation', 'implementation', 'debugging', 'refactoring']`).

### Capability-matched routing
`Queen.selectAgentsForTask()` scores every idle agent against a task's `requiredCapabilities` — capability match × 10, type suitability × 5, idle bonus +8, historical success rate × 10. The top-scoring agents up to `min(task.maxAgents, strategy.maxAgents)` are assigned.

### Parallel vs. sequential per-phase
`SwarmOrchestrator` respects `TaskSubmitOptions.strategy`:
- `parallel`: all phase assignments run via `Promise.all()`.
- `sequential`: each phase waits for the prior checkpoint before proceeding.
- `adaptive`: selects strategy by task complexity analysis.
- Design phase explicitly uses `strategy: 'parallel'` with `maxAgents: 2` so both `design_architect` agents produce independent proposals that are then consensus-validated.

### Consensus multi-agent coordination
`ConsensusEngine` (used in `approvePhase()` and optionally in `generateDesign()`) implements a proposal/vote cycle. The Queen broadcasts a `ConsensusProposal` to all agents; each votes with a `confidence` score and `reasoning`; the engine checks whether the vote ratio meets `consensusThreshold` (default 0.66). Configurable algorithms per `ConsensusRequirements.algorithm`: `simple-majority`, `weighted-vote`, `byzantine-fault-tolerant`, `raft`.

### Inter-agent communication
`Communication` class (`src/hive-mind/core/Communication.ts`) maintains channels per agent; the `Queen` broadcasts via `createCommunication()` rows in SQLite. Agents receive assignments via DB message queue (not direct function calls), decoupling them across process boundaries.

---

## 6. Context / Memory Management over Long Horizons

### Shared swarm memory
`Memory` class (`src/hive-mind/core/Memory.ts`) provides a key/value store over SQLite with an LRU in-process cache (`HighPerformanceCache`, 10 000 entries, 100 MB cap). The cache uses LRU eviction under memory pressure. Stats include `hitRate`, `evictions`, `utilizationPercent`.

### Steering documents
`MaestroSwarmCoordinator.createSteeringDocument()` writes domain-specific guidelines (`product`, `tech`, `workflow`) into the swarm memory under the `steering/<domain>` key and broadcasts a `steering_update` to all agents. Every `implementTask()` and `reviewTasks()` call pulls the full steering context via `getSteeringContext()` — all matching keys are fetched and concatenated — giving all agents shared governance context without re-injecting it into every LLM prompt.

### Queen decision memory
`Queen.applyDecision()` stores each `QueenDecision` at `decision/<taskId>` in the `queen-decisions` namespace with a 7-day TTL. The optimization loop calls `getSuccessfulDecisions()` and feeds them to `mcpWrapper.trainNeural()` every minute — a form of episodic memory reuse.

### TTL-based expiry
`HiveMind` config includes `memoryTTL: 86400000` (24 h default). Memory entries beyond TTL are not served from cache but remain in DB for history.

### Context budget management
The `ReasoningBank` (separate `agentic-flow` module, referenced in `V2.7.26_RELEASE_SUMMARY.md`) provides the LLM-side context compression: 384-dimension local transformer embeddings (Xenova/all-MiniLM-L6-v2), HNSW-indexed vector search described as "150x–12,500x faster" than naive scan. "Compact context" mode (invoked via `optimizer.getCompactContext()`) claimed to reduce token usage by 32%. In npx mode it falls back to hash-based embeddings without error.

---

## 7. Provider / Model Routing

`src/providers/provider-manager.ts` is a full multi-provider router, independent of the Maestro workflow layer. It supports:
- **Providers:** Anthropic, OpenAI, Google, Cohere, Ollama (local).
- **Load balancing strategies:** `round-robin`, `least-loaded`, `latency-based`, `cost-based`.
- **Fallback rules** (`FallbackRule[]`): configurable per-provider fallback chains with conditions.
- **Cost optimization:** optional `maxCostPerRequest` cap and `preferredProviders` ordering.
- **Response caching:** `CacheConfig` with TTL; cache key is a hash of the request.
- **Rate limiting:** per-provider `RateLimiter` objects with configurable windows.
- **Monitoring:** `metricsInterval`-driven metrics emission.

The `CLAUDE.md` (v3 Ruflo) also documents a **3-tier model routing** scheme:
- Tier 1: "Agent Booster" (WASM, <1 ms, $0) for trivial transforms — LLM is bypassed entirely.
- Tier 2: Haiku (~500 ms) for simple tasks (complexity <30%).
- Tier 3: Sonnet/Opus (2–5 s) for complex reasoning (complexity >30%).

Tier selection is done by inspecting a `[TASK_MODEL_RECOMMENDATION]` flag before spawning agents. This is the closest Ruflo gets to a first-class answer to "how do you avoid running Opus for a trivial reply?"

---

## 8. Observability

### Event bus
`HiveMind` extends `EventEmitter` and emits: `initialized`, `agentSpawned`, `taskSubmitted`, `taskCancelled`, `agentsRebalanced`, `shutdown`. `SwarmOrchestrator` emits: `taskCompleted`, `taskFailed`, `progressUpdate`, `checkpointPassed`, `assignmentQueued`. `Queen` emits: `rebalanceNeeded`, `agentFailed`, `taskStalled`, `strategyAdjusted`, `performanceRecommendation`.

### Status API
`HiveMind.getFullStatus()` returns a `SwarmStatus` struct with: per-agent status + current task, per-task status + progress %, task stats (pending/in-progress/completed/failed counts), memory hit rate, communication stats, uptime, and computed `health` (`healthy` / `degraded` / `critical`). This is surfaced via the CLI as `npx claude-flow status`.

### Human steering
`MaestroSwarmCoordinator.createSteeringDocument(domain, content)` lets a human inject constraints into swarm memory at any point. The `approvePhase()` method is an explicit human-in-the-loop gate; the workflow pauses until `approvePhase()` is called.

### Logging
`ILogger` is injected throughout; every major state change emits a `logger.info()` line with structured data. `DatabaseManager` persists all communications as rows, providing an append-only audit trail across sessions.

---

## 9. Most Transferable Patterns for OpenClaude

The following patterns are directly applicable to OpenClaude's long-running autonomous work and its completion-forcing problem:

### Pattern A: Tiered timeout per task category (addresses completion-forcing)
Maestro assigns per-phase timeouts: 2 min for requirements analysis, 5 min for design, 10 min for implementation. OpenClaude should similarly size timeouts by task complexity class rather than applying one universal timeout. For simple responses, a short timeout with early-exit on first valid output would prevent the slow-response problem.

### Pattern B: Complexity-first model routing (addresses slow simple responses)
The 3-tier model routing (Tier 1: bypass LLM / Tier 2: Haiku / Tier 3: Sonnet/Opus) is a direct fix for OpenClaude's completion-forcing making simple tasks slow. Detect task complexity before dispatching; if below a threshold, skip the heavy completion loop entirely.

### Pattern C: Phase-aware state machine with file-backed artifacts
Each Maestro phase writes a markdown artifact to disk (`requirements.md`, `design.md`, etc.) before progressing. OpenClaude could do the same: write intermediate results to a scratchpad file and treat its presence as a checkpoint. This provides free resume-on-crash without a dedicated checkpoint protocol.

### Pattern D: Multi-loop architecture instead of a single agent loop
The Queen's 5-second health loop, 60-second optimization loop, and the Orchestrator's 2-second progress loop run independently. OpenClaude should similarly separate concerns: a fast loop for liveness/stall detection, a slow loop for context consolidation, rather than a single monolithic iteration.

### Pattern E: Explicit human-in-the-loop gates via `approvePhase()`
Maestro pauses at each phase transition until a human (or consensus) approves. OpenClaude could offer optional `--approve-phases` mode for high-stakes runs, exposing `state.currentPhase` via the status API so a user can inspect before the next phase begins.

### Pattern F: Capability-matched agent selection with historical scoring
The Queen scores agents on capability match + historical success rate. OpenClaude, when dispatching subagents, should prefer agents/tools that have historically succeeded on similar task types — this is already partially supported via Mnemo's episodic memory.

### Pattern G: Stall detection with reassignment
`isTaskStalled()` checks whether `last_progress_update` is >10 minutes old. OpenClaude should similarly detect when a subagent has not updated progress within a threshold and auto-reassign rather than waiting for a hard timeout.

### Pattern H: Steering documents as shared ambient context
Rather than injecting all governance context into every LLM prompt, Maestro stores steering docs in swarm memory and agents pull only what they need. OpenClaude could adopt the same pattern: store project constraints, coding standards, and user preferences in a shared memory namespace and have each subagent fetch relevant sections rather than receiving a full context dump.

---

## Summary (6–8 lines)

Maestro is a specs-driven workflow layer on top of a HiveMind swarm inside Ruflo/claude-flow v2. Its most transferable pattern for OpenClaude is **tiered task timeouts + complexity-first model routing**: it assigns hard per-phase timeouts (2–10 min) and has a 3-tier model selector (bypass / Haiku / Sonnet) that avoids running heavyweight models on trivial tasks — directly addressing OpenClaude's completion-forcing slowness. Its **multi-loop architecture** (separate 2 s / 5 s / 30 s / 60 s interval loops for progress, health, load-balancing, and optimization) is a cleaner separation of concerns than a single agent loop. **File-backed phase artifacts** (each phase writes a markdown file) give free checkpointing and resume-on-crash. The **explicit `approvePhase()` human gate** with optional consensus voting is a model for how OpenClaude could offer controllable autonomy on long runs. **Stall detection** (10-minute no-progress threshold triggers reassignment) and **capability-scored agent selection with historical success rates** are directly applicable to subagent dispatching. Finally, the **steering document pattern** — storing shared governance context in swarm memory rather than injecting it into every prompt — reduces per-call context overhead on long horizons.
