#!/usr/bin/env bun
/**
 * Golden-trajectory smoke harness driver.
 *
 * Usage:
 *   bun run evals/smoke/run.ts                  # assert mode (compare vs goldens)
 *   bun run evals/smoke/run.ts --capture         # capture mode (write new goldens)
 *   bun run evals/smoke/run.ts --ci-subset       # assert mode, only ci_subset:true tasks
 *   bun run evals/smoke/run.ts --task <id>       # run a single task by id
 *
 * Provider env required:
 *   ANTHROPIC_API_KEY=<key>  (or set CLAUDE_CONFIG_DIR to a clean config dir)
 *
 * The harness spawns `node dist/cli.mjs` in headless mode per task and parses
 * the stream-json stdout to extract tool_use names and final assistant text.
 *
 * COST DESIGN:
 *   - No mock/fake provider exists in this repo's src/services/api/.
 *   - Per-PR CI runs only tasks with ci_subset:true (3 tasks, Haiku, ≤3 turns each).
 *     Estimated cost: ~$0.002 per PR. Use --ci-subset in CI.
 *   - The full 6-task suite runs nightly or on the eval:smoke:full label.
 *     Run without --ci-subset to get the full suite.
 *   - Goldens assert tool SET membership (not exact sequence) to avoid
 *     flakiness from non-deterministic ordering.
 */

import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  cpSync,
  rmSync,
} from "fs";
import { resolve, join } from "path";
import { tmpdir } from "os";
import { assertRun, loadGolden } from "./assert.js";
import type { GoldenEntry, TaskAssert } from "./assert.js";

// ─── Types ────────────────────────────────────────────────────────────────────

interface TaskDef {
  id: string;
  prompt: string;
  model: string;
  max_turns: number;
  cwd_fixture: string;
  permission_mode?: string;
  /** Tools to disallow at the CLI level (passed as --disallowedTools). */
  disallowed_tools?: string[];
  /** If true, included in --ci-subset runs. */
  ci_subset?: boolean;
  assert: TaskAssert;
}

interface StreamJsonMessage {
  type: string;
  subtype?: string;
  message?: {
    role?: string;
    content?: Array<{
      type: string;
      name?: string;
      text?: string;
      input?: unknown;
    }>;
  };
  result?: string;
  is_error?: boolean;
}

// ─── Paths ────────────────────────────────────────────────────────────────────

const REPO_ROOT = resolve(import.meta.dir, "../..");
const TASKS_DIR = resolve(import.meta.dir, "tasks");
const GOLDEN_DIR = resolve(import.meta.dir, "../golden");
const CLI_PATH = join(REPO_ROOT, "dist/cli.mjs");

// Minimal global config dir to bypass any stored provider profile.
// CLAUDE_CONFIG_DIR overrides the path of ~/.limitless.json, so pointing it
// at a clean temp dir prevents RunPod/local provider profiles from applying.
const CLEAN_CONFIG_DIR = join(import.meta.dir, "config");

// ─── CLI args ─────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const captureMode = args.includes("--capture");
const ciSubset = args.includes("--ci-subset");
const taskFilter = (() => {
  const idx = args.indexOf("--task");
  return idx !== -1 ? args[idx + 1] : null;
})();

// ─── Ensure clean config dir exists ──────────────────────────────────────────

function ensureCleanConfigDir(): void {
  if (!existsSync(CLEAN_CONFIG_DIR)) {
    mkdirSync(CLEAN_CONFIG_DIR, { recursive: true });
  }
  const configFile = join(CLEAN_CONFIG_DIR, ".limitless.json");
  if (!existsSync(configFile)) {
    // Minimal config: no active provider profile, onboarding done.
    const minimalConfig = {
      hasCompletedOnboarding: true,
      providerProfiles: [],
      activeProviderProfileId: null,
    };
    writeFileSync(configFile, JSON.stringify(minimalConfig, null, 2));
  }
}

// ─── Load tasks ───────────────────────────────────────────────────────────────

function loadTasks(): TaskDef[] {
  const files = readdirSync(TASKS_DIR).filter((f: string) => f.endsWith(".json"));
  const tasks: TaskDef[] = [];
  for (const file of files) {
    const raw = readFileSync(join(TASKS_DIR, file), "utf8");
    tasks.push(JSON.parse(raw) as TaskDef);
  }
  return tasks;
}

// ─── Run a single task via headless mode ─────────────────────────────────────

async function runTask(task: TaskDef): Promise<GoldenEntry> {
  const fixtureSrc = resolve(REPO_ROOT, task.cwd_fixture);

  // Copy fixture into a temp dir so mutations (Edit/Write tools) don't corrupt
  // the source fixture. Each run gets a fresh copy — idempotent re-runs.
  const tmpFixtureDir = join(tmpdir(), `limitless-eval-${task.id}-${Date.now()}`);
  cpSync(fixtureSrc, tmpFixtureDir, { recursive: true });

  const fixtureDir = tmpFixtureDir;

  // Build env — inject ANTHROPIC_API_KEY if set, plus clean config dir.
  const childEnv: Record<string, string> = {
    ...process.env as Record<string, string>,
    CLAUDE_CONFIG_DIR: CLEAN_CONFIG_DIR,
  };

  // Forward ANTHROPIC_API_KEY if available in the environment.
  // In CI, this should be set as a secret. Locally, set it in your shell.
  if (process.env.ANTHROPIC_API_KEY) {
    childEnv.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
  }

  // Clear any OpenAI provider env that might leak from the shell.
  delete childEnv.OPENAI_BASE_URL;
  delete childEnv.OPENAI_API_KEY;
  delete childEnv.OPENAI_MODEL;
  delete childEnv.CLAUDE_CODE_USE_OPENAI;
  delete childEnv.CLAUDE_CODE_PROVIDER_PROFILE_ENV_APPLIED;

  const cliArgs = [
    CLI_PATH,
    "-p",
    task.prompt,
    "--output-format",
    "stream-json",
    "--verbose",
    "--bare",
    "--max-turns",
    String(task.max_turns),
    "--model",
    task.model,
    "--provider",
    "anthropic",
    "--add-dir",
    fixtureDir,
    "--permission-mode",
    task.permission_mode ?? "bypassPermissions",
    // Pass disallowed tools at the CLI level so the tool is never registered.
    ...(task.disallowed_tools && task.disallowed_tools.length > 0
      ? ["--disallowedTools", task.disallowed_tools.join(",")]
      : []),
  ];

  const proc = Bun.spawn(["node", ...cliArgs], {
    cwd: fixtureDir,
    env: childEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const toolsCalled: string[] = [];
  let finalText = "";

  // Parse stream-json from stdout line by line.
  const reader = proc.stdout.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    // Process complete lines.
    let newline: number;
    while ((newline = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (!line) continue;

      let msg: StreamJsonMessage;
      try {
        msg = JSON.parse(line) as StreamJsonMessage;
      } catch {
        continue; // Skip non-JSON lines (should be guarded by streamJsonStdoutGuard)
      }

      // Extract tool_use names from assistant messages.
      if (msg.type === "assistant" && msg.message?.content) {
        for (const block of msg.message.content) {
          if (block.type === "tool_use" && block.name) {
            toolsCalled.push(block.name);
          }
        }
      }

      // Capture final result text.
      if (msg.type === "result" && typeof msg.result === "string") {
        finalText = msg.result;
      }
    }
  }

  // Drain any remaining buffer.
  if (buffer.trim()) {
    try {
      const msg = JSON.parse(buffer.trim()) as StreamJsonMessage;
      if (msg.type === "result" && typeof msg.result === "string") {
        finalText = msg.result;
      }
    } catch {
      // Ignore partial lines
    }
  }

  await proc.exited;

  // Clean up temp fixture copy.
  try {
    rmSync(tmpFixtureDir, { recursive: true, force: true });
  } catch {
    // Non-fatal; temp dirs are cleaned by the OS eventually.
  }

  return { tools_called: toolsCalled, final_text: finalText };
}

// ─── Golden file paths ────────────────────────────────────────────────────────

function goldenPath(taskId: string): string {
  return join(GOLDEN_DIR, `${taskId}.jsonl`);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  ensureCleanConfigDir();

  // Check dist/cli.mjs exists.
  if (!existsSync(CLI_PATH)) {
    console.error(
      `ERROR: dist/cli.mjs not found. Run 'bun run build' first.\n  Expected: ${CLI_PATH}`,
    );
    process.exit(1);
  }

  if (!existsSync(GOLDEN_DIR)) {
    mkdirSync(GOLDEN_DIR, { recursive: true });
  }

  const allTasks = loadTasks();

  // Filter tasks.
  let tasks = allTasks;
  if (taskFilter) {
    tasks = tasks.filter((t) => t.id === taskFilter);
    if (tasks.length === 0) {
      console.error(`ERROR: No task found with id "${taskFilter}".`);
      console.error(`Available tasks: ${allTasks.map((t) => t.id).join(", ")}`);
      process.exit(1);
    }
  } else if (ciSubset) {
    tasks = tasks.filter((t) => t.ci_subset === true);
  }

  console.log(
    `\n=== Smoke Harness — ${captureMode ? "CAPTURE" : "ASSERT"} mode ===`,
  );
  console.log(
    `Tasks: ${tasks.map((t) => t.id).join(", ")} (${tasks.length} total)\n`,
  );

  const failures: string[] = [];
  let passed = 0;

  for (const task of tasks) {
    process.stdout.write(`  Running: ${task.id} ... `);
    const start = Date.now();

    let live: GoldenEntry;
    try {
      live = await runTask(task);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`FAIL (spawn error)`);
      failures.push(`[${task.id}] Spawn error: ${msg}`);
      continue;
    }

    const elapsed = ((Date.now() - start) / 1000).toFixed(1);

    if (captureMode) {
      // Write golden.
      writeFileSync(goldenPath(task.id), JSON.stringify(live));
      console.log(`CAPTURED (${elapsed}s) tools=${JSON.stringify(live.tools_called)}`);
      passed++;
    } else {
      // Assert mode.
      const golden = loadGolden(goldenPath(task.id));
      const result = assertRun(task.id, live, golden, task.assert);
      if (result.passed) {
        console.log(`PASS (${elapsed}s) tools=${JSON.stringify(live.tools_called)}`);
        passed++;
      } else {
        console.log(`FAIL (${elapsed}s)`);
        failures.push(...result.failures);
      }
    }
  }

  console.log(`\n${passed}/${tasks.length} tasks ${captureMode ? "captured" : "passed"}.`);

  if (failures.length > 0) {
    console.error("\n=== FAILURES ===\n");
    for (const f of failures) {
      console.error(f);
      console.error("");
    }
    console.error(
      `\nTo re-capture goldens after an intentional change, run:\n` +
        `  bun run eval:smoke -- --capture\n`,
    );
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Unhandled error:", err);
  process.exit(1);
});
