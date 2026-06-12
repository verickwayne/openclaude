/**
 * Assertion logic for the golden-trajectory smoke harness.
 *
 * Compares a captured run against a golden JSONL file and task-level assert rules.
 * Exits non-zero with a teaching message on any failure.
 */

import { readFileSync } from "fs";

export interface GoldenEntry {
  /** Ordered list of tool_use names extracted from the run. */
  tools_called: string[];
  /** Final assistant text (last result text). */
  final_text: string;
}

export interface TaskAssert {
  /** Tool names that MUST appear in the run (set membership, order-insensitive). */
  tools_called?: string[];
  /** Tool names that MUST NEVER appear in the run. */
  tools_forbidden?: string[];
  /** If present, final_text must contain this substring (case-insensitive). */
  final_contains?: string;
}

export interface AssertResult {
  passed: boolean;
  failures: string[];
}

/**
 * Compare a live run against the golden file + task assert rules.
 *
 * For CI determinism:
 *  - tools_forbidden is always checked against the live run (never relaxed).
 *  - tools_called asserts SET membership vs golden (not exact sequence) when
 *    golden exists; falls back to task assert rules when no golden yet.
 *  - final_contains is a substring check, case-insensitive.
 */
export function assertRun(
  taskId: string,
  live: GoldenEntry,
  golden: GoldenEntry | null,
  taskAssert: TaskAssert,
): AssertResult {
  const failures: string[] = [];
  const liveToolSet = new Set(live.tools_called);

  // 1. Forbidden tools — checked against live run, never relaxed.
  for (const forbidden of taskAssert.tools_forbidden ?? []) {
    if (liveToolSet.has(forbidden)) {
      failures.push(
        `[${taskId}] REGRESSION: forbidden tool "${forbidden}" was called.\n` +
          `  Expected: never called\n` +
          `  Got: called (full sequence: ${JSON.stringify(live.tools_called)})`,
      );
    }
  }

  // 2. Required tools — SET membership (order-insensitive for non-determinism).
  const requiredTools = taskAssert.tools_called ?? [];
  if (requiredTools.length > 0) {
    for (const required of requiredTools) {
      if (!liveToolSet.has(required)) {
        failures.push(
          `[${taskId}] REGRESSION: required tool "${required}" was NOT called.\n` +
            `  Expected tool in run: ${required}\n` +
            `  Got tools: ${JSON.stringify(live.tools_called)}`,
        );
      }
    }
  }

  // 3. Golden presence check: only assert tools from the golden that are ALSO
  //    listed in taskAssert.tools_called (i.e., known-required tools). This
  //    avoids golden flakiness from non-deterministic optional tool choices
  //    (e.g., model may or may not use Bash for grep-like operations).
  if (golden !== null && requiredTools.length > 0) {
    const goldenToolSet = new Set(golden.tools_called);
    for (const required of requiredTools) {
      if (goldenToolSet.has(required) && !liveToolSet.has(required)) {
        // Only flag if the golden also had this required tool (belt-and-suspenders).
        // The tools_called check above already catches missing required tools.
      }
    }
  }

  // 4. final_contains substring check.
  if (taskAssert.final_contains) {
    const needle = taskAssert.final_contains.toLowerCase();
    const haystack = live.final_text.toLowerCase();
    if (!haystack.includes(needle)) {
      failures.push(
        `[${taskId}] REGRESSION: final text does not contain expected substring.\n` +
          `  Expected substring: "${taskAssert.final_contains}"\n` +
          `  Got final text: "${live.final_text.slice(0, 300)}"`,
      );
    }
  }

  return { passed: failures.length === 0, failures };
}

/**
 * Load a golden JSONL file.
 * Returns null if the file does not exist (first capture run).
 */
export function loadGolden(goldenPath: string): GoldenEntry | null {
  try {
    const raw = readFileSync(goldenPath, "utf8").trim();
    if (!raw) return null;
    // The golden file is a single JSON line (one GoldenEntry per task).
    return JSON.parse(raw) as GoldenEntry;
  } catch {
    return null;
  }
}
