import { registerBundledSkill } from '../bundledSkills.js'

const OPENRALPH_BOOTSTRAP_SH = `#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
openralph-bootstrap.sh --prompt-file <path> [--mode build|research|refine|explore] [--max-iterations n] [--completion-condition text] [--proof-command command]
EOF
}

MODE="build"
MAX_ITERATIONS="0"
PROMPT_FILE=""
COMPLETION_CONDITION=""
PROOF_COMMAND=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --prompt-file) PROMPT_FILE="\${2:-}"; shift 2 ;;
    --mode) MODE="\${2:-}"; shift 2 ;;
    --max-iterations) MAX_ITERATIONS="\${2:-0}"; shift 2 ;;
    --completion-condition) COMPLETION_CONDITION="\${2:-}"; shift 2 ;;
    --proof-command) PROOF_COMMAND="\${2:-}"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown argument: $1" >&2; usage >&2; exit 2 ;;
  esac
done

case "$MODE" in build|research|refine|explore) ;; *) echo "Invalid mode: $MODE" >&2; exit 2 ;; esac
if [[ -z "$PROMPT_FILE" || ! -f "$PROMPT_FILE" ]]; then
  echo "--prompt-file is required" >&2
  exit 2
fi

PROJECT_ROOT="$(pwd)"
RALPH_DIR="$PROJECT_ROOT/.openclaude/ralph"
SESSION_DIR="$RALPH_DIR/sessions"
mkdir -p "$SESSION_DIR" "$RALPH_DIR/bridges" "$RALPH_DIR/logs" "$RALPH_DIR/ledger"

SESSION_ID="\${CLAUDE_CODE_SESSION_ID:-\${CLAUDE_SESSION_ID:-}}"
if [[ -z "$SESSION_ID" ]]; then
  SESSION_ID="$(python3 - <<'PY'
import uuid
print(uuid.uuid4())
PY
)"
fi
SESSION_STATE_DIR="$SESSION_DIR/$SESSION_ID"
mkdir -p "$SESSION_STATE_DIR"

PROMPT="$(cat "$PROMPT_FILE")"
rm -f "$PROMPT_FILE"
NOW="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
START_COMMIT="$(git rev-parse HEAD 2>/dev/null || true)"
export SESSION_ID SESSION_STATE_DIR PROJECT_ROOT MODE MAX_ITERATIONS NOW START_COMMIT PROMPT COMPLETION_CONDITION PROOF_COMMAND

touch "$RALPH_DIR/enabled"
printf '%s\n' "$SESSION_ID" > "$RALPH_DIR/active-session"

python3 - "$SESSION_STATE_DIR/session.json" "$RALPH_DIR/active-session.json" <<'PY'
import json, os, sys
session_path, active_path = sys.argv[1], sys.argv[2]
data = {
  "session_id": os.environ["SESSION_ID"],
  "session_state_dir": os.environ["SESSION_STATE_DIR"],
  "cwd": os.environ["PROJECT_ROOT"],
  "mode": os.environ["MODE"],
  "iteration": 0,
  "max_iterations": int(os.environ["MAX_ITERATIONS"] or "0"),
  "started_at": os.environ["NOW"],
  "updated_at": os.environ["NOW"],
  "start_commit": os.environ.get("START_COMMIT") or None,
  "completion_condition": os.environ.get("COMPLETION_CONDITION") or None,
  "proof_command": os.environ.get("PROOF_COMMAND") or None,
  "status": "running",
  "prompt": os.environ["PROMPT"],
}
for path in (session_path, active_path):
  with open(path, "w", encoding="utf-8") as f:
    json.dump(data, f, indent=2)
    f.write("\\n")
PY

if [[ ! -f "$SESSION_STATE_DIR/goal.json" ]]; then
  python3 - "$SESSION_STATE_DIR/goal.json" <<'PY'
import json, os, sys
goal = {
  "session_id": os.environ["SESSION_ID"],
  "status": "running",
  "condition": os.environ.get("COMPLETION_CONDITION") or "Complete the OpenRalph prompt and prove it with visible evidence.",
  "proof_command": os.environ.get("PROOF_COMMAND") or None,
  "evaluator_notes": [],
  "last_checked_at": None,
  "completed_at": None,
}
with open(sys.argv[1], "w", encoding="utf-8") as f:
  json.dump(goal, f, indent=2)
  f.write("\\n")
PY
fi

if [[ ! -f "$SESSION_STATE_DIR/queue.md" ]]; then
  cat > "$SESSION_STATE_DIR/queue.md" <<'EOF'
# OpenRalph Queue

1. Derive the first atomic task from session.json and write it to current-task.md.
EOF
fi

if [[ ! -f "$SESSION_STATE_DIR/progress.md" ]]; then
  cat > "$SESSION_STATE_DIR/progress.md" <<'EOF'
# OpenRalph Progress

## In Flight

_(empty)_

## Completed

_(empty)_

## Blocked

_(empty)_
EOF
fi

cat > "$SESSION_STATE_DIR/current-task.md" <<'EOF'
# Current OpenRalph Task

_(scheduler has not dispatched a task yet)_
EOF

cat > "$SESSION_STATE_DIR/persona-result.yml" <<'EOF'
task_slug: null
status: null
commit: null
files_changed: []
tests_run: null
tests_passed: null
provider_model_used: null
new_gaps: []
next_action: null
notes: null
EOF

if [[ -f .gitignore ]]; then
  for _entry in \
    "# OpenRalph local scheduler state" \
    ".openclaude/ralph/enabled" \
    ".openclaude/ralph/active-session" \
    ".openclaude/ralph/active-session.json" \
    ".openclaude/ralph/bridges/" \
    ".openclaude/ralph/events.jsonl" \
    ".openclaude/ralph/logs/" \
    ".openclaude/ralph/sessions/" \
  ; do
    grep -qF "$_entry" .gitignore || echo "$_entry" >> .gitignore
  done
  # .openclaude/ralph/ledger/outcomes.jsonl is NOT gitignored by default.
  # Routing knowledge is a data asset worth committing (see openRalph §3 / Angle E).
  # To opt out: manually add .openclaude/ralph/ledger/ to your .gitignore.
fi

echo "OpenRalph engaged"
echo "Session: $SESSION_ID"
echo "Mode: $MODE"
echo "Session state: $SESSION_STATE_DIR"
echo "State: $SESSION_STATE_DIR/session.json"
echo "Goal: $SESSION_STATE_DIR/goal.json"
`

const OPENRALPH_HOOK_SH = `#!/usr/bin/env bash
set -euo pipefail

ROOT="\${OPENRALPH_PROJECT_ROOT:-$(pwd)}"
RALPH_DIR="$ROOT/.openclaude/ralph"
[[ -f "$RALPH_DIR/enabled" ]] || exit 0

INPUT="$(cat || true)"
mkdir -p "$RALPH_DIR/bridges" "$RALPH_DIR/logs"

read_json_field() {
  python3 - "$1" "$INPUT" <<'PY'
import json, sys
field, raw = sys.argv[1], sys.argv[2]
try:
  data = json.loads(raw or "{}")
except Exception:
  data = {}
value = data.get(field)
print("" if value is None else value)
PY
}

SESSION_ID="$(read_json_field session_id)"
EVENT="$(read_json_field hook_event_name)"
TOOL_NAME="$(read_json_field tool_name)"
CWD_VALUE="$(read_json_field cwd)"
TRANSCRIPT="$(read_json_field transcript_path)"
[[ -n "$SESSION_ID" ]] || SESSION_ID="\${CLAUDE_CODE_SESSION_ID:-\${CLAUDE_SESSION_ID:-unknown}}"
SESSION_STATE_DIR="$RALPH_DIR/sessions/$SESSION_ID"
ACTIVE_SESSION="$(cat "$RALPH_DIR/active-session" 2>/dev/null || true)"
export SESSION_ID SESSION_STATE_DIR EVENT TOOL_NAME CWD_VALUE TRANSCRIPT

# Always write bridge and project-level log (unconditional).
# Session-level log and Stop gate only fire when this session owns a state dir.
python3 - "$RALPH_DIR/bridges/$SESSION_ID.json" "$RALPH_DIR/events.jsonl" <<'PY'
import json, os, sys, time
bridge_path, project_log_path = sys.argv[1], sys.argv[2]
event = {
  "ts": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
  "session_id": os.environ.get("SESSION_ID"),
  "session_state_dir": os.environ.get("SESSION_STATE_DIR"),
  "event": os.environ.get("EVENT") or "unknown",
  "tool_name": os.environ.get("TOOL_NAME") or None,
  "cwd": os.environ.get("CWD_VALUE") or None,
  "transcript_path": os.environ.get("TRANSCRIPT") or None,
}
with open(bridge_path, "w", encoding="utf-8") as f:
  json.dump(event, f, indent=2)
  f.write("\\n")
with open(project_log_path, "a", encoding="utf-8") as f:
  f.write(json.dumps(event, separators=(",", ":")) + "\\n")
PY

# ── Routing Outcome Ledger capture ────────────────────────────────────────────
# On PostToolUse where tool_name == Agent, extract the persona-result YAML block
# from the tool response and append one JSONL record to the cross-session ledger.
# Runs unconditionally (not just in session state dir) so it captures all dispatches.
# Wrapped in || true so a malformed YAML or absent field never fails the hook.
if [[ "$EVENT" == "PostToolUse" && "$TOOL_NAME" == "Agent" ]]; then
  TOOL_RESPONSE="$(read_json_field tool_response)"
  TOOL_INPUT_RAW="$(python3 - "tool_input" "$INPUT" <<'PY'
import json, sys
field, raw = sys.argv[1], sys.argv[2]
try:
  data = json.loads(raw or "{}")
  val = data.get(field)
  print(json.dumps(val) if val is not None else "")
except Exception:
  print("")
PY
)"
  export TOOL_RESPONSE TOOL_INPUT_RAW
  python3 - "$RALPH_DIR/ledger/outcomes.jsonl" "$SESSION_STATE_DIR/session.json" <<'PY' || true
import json, os, re, sys, time
ledger_path, session_json_path = sys.argv[1], sys.argv[2]
tool_response = os.environ.get("TOOL_RESPONSE", "")
tool_input_raw = os.environ.get("TOOL_INPUT_RAW", "")
session_id = os.environ.get("SESSION_ID", "unknown")

# Persona: prefer subagent_type from tool_input (the dispatched agent name).
persona = None
try:
  tool_input = json.loads(tool_input_raw) if tool_input_raw else {}
  persona = tool_input.get("subagent_type") or None
except Exception:
  pass

# Extract the trailing YAML block from the tool response.
# Build the backtick fence programmatically to avoid quoting issues.
_bt3 = chr(96) * 3
yaml_match = re.search(_bt3 + r"yaml\\s*\\n([\\s\\S]*?)" + _bt3, tool_response or "")
if not yaml_match:
  sys.exit(0)
yaml_text = yaml_match.group(1)

def parse_yaml_field(text, key):
  """Minimal key: value extractor — avoids a yaml dep."""
  m = re.search(r"^" + re.escape(key) + r":\\s*(.+)$", text, re.MULTILINE)
  if not m:
    return None
  val = m.group(1).strip().strip('"').strip("'")
  return None if val in ("null", "~", "") else val

task_slug = parse_yaml_field(yaml_text, "task_slug")
provider_model_used = parse_yaml_field(yaml_text, "provider_model_used")
status = parse_yaml_field(yaml_text, "status")
tests_passed_raw = parse_yaml_field(yaml_text, "tests_passed")
new_gaps_raw = parse_yaml_field(yaml_text, "new_gaps")
# persona already set from tool_input; fallback to YAML if present there
if not persona:
  persona = parse_yaml_field(yaml_text, "persona")

# tests_passed: coerce to bool or None.
if tests_passed_raw is None or tests_passed_raw.lower() == "skipped":
  tests_passed = None
else:
  tests_passed = tests_passed_raw.lower() not in ("false", "0", "no")

# new_gaps: count list items (lines starting with -) if the field is multi-line.
new_gaps = 0
gaps_block = re.search(r"^new_gaps:\\s*\\n((?:\\s+-.*\\n)*)", yaml_text, re.MULTILINE)
if gaps_block:
  new_gaps = len([l for l in gaps_block.group(1).splitlines() if l.strip().startswith("-")])
elif new_gaps_raw and new_gaps_raw not in ("[]", ""):
  new_gaps = 1

# workload: read from session.json if present.
workload = None
try:
  sess = json.load(open(session_json_path, encoding="utf-8"))
  workload = sess.get("workload") or sess.get("mode")
except Exception:
  pass

# duration_s: not available from hook stdin; set null.
duration_s = None

record = {
  "ts": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
  "session_id": session_id,
  "task_slug": task_slug,
  "persona": persona,
  "workload": workload,
  "provider_model_used": provider_model_used,
  "status": status,
  "tests_passed": tests_passed,
  "new_gaps": new_gaps,
  "duration_s": duration_s,
}

# Skip if we got no signal fields — nothing useful to record.
if not any([task_slug, provider_model_used, status]):
  sys.exit(0)

os.makedirs(os.path.dirname(ledger_path), exist_ok=True)
with open(ledger_path, "a", encoding="utf-8") as f:
  f.write(json.dumps(record, separators=(",", ":")) + "\\n")
PY
fi
# ─────────────────────────────────────────────────────────────────────────────

# Session-scoped effects only when this session has its own state dir (created by engage).
if [[ -d "$SESSION_STATE_DIR" ]]; then
  python3 - "$SESSION_STATE_DIR/events.jsonl" <<'PY'
import json, os, sys, time
session_log_path = sys.argv[1]
event = {
  "ts": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
  "session_id": os.environ.get("SESSION_ID"),
  "session_state_dir": os.environ.get("SESSION_STATE_DIR"),
  "event": os.environ.get("EVENT") or "unknown",
  "tool_name": os.environ.get("TOOL_NAME") or None,
  "cwd": os.environ.get("CWD_VALUE") or None,
  "transcript_path": os.environ.get("TRANSCRIPT") or None,
}
with open(session_log_path, "a", encoding="utf-8") as f:
  f.write(json.dumps(event, separators=(",", ":")) + "\\n")
PY

  if [[ "$EVENT" == "Stop" && "$SESSION_ID" == "$ACTIVE_SESSION" && -f "$SESSION_STATE_DIR/goal.json" ]]; then
    STATUS="$(python3 - "$SESSION_STATE_DIR/goal.json" <<'PY'
import json, sys
try:
  print(json.load(open(sys.argv[1], encoding="utf-8")).get("status", "running"))
except Exception:
  print("running")
PY
)"
    if [[ "$STATUS" != "complete" && "$STATUS" != "completed" && "$STATUS" != "disengaged" ]]; then
      python3 - <<'PY'
import json, os
state_dir = os.environ.get("SESSION_STATE_DIR", ".openclaude/ralph/sessions/<session_id>")
reason = (
  "OpenRalph goal is still running for this session. "
  f"Read {state_dir}/session.json, goal.json, queue.md, progress.md, "
  "and current-task.md; then continue the next unfinished task and update "
  "that same session directory before stopping again."
)
print(json.dumps({"decision": "block", "reason": reason}))
PY
    fi
  fi
fi
`

const OPENRALPH_STATUS_SH = `#!/usr/bin/env bash
set -euo pipefail
RALPH_DIR="$(pwd)/.openclaude/ralph"
if [[ ! -d "$RALPH_DIR" ]]; then
  echo "No OpenRalph state in $(pwd)"
  exit 0
fi
SESSION_ID=""
if [[ "\${1:-}" == "--session" ]]; then
  SESSION_ID="\${2:-}"
else
  SESSION_ID="$(cat "$RALPH_DIR/active-session" 2>/dev/null || true)"
fi
SESSION_STATE_DIR="$RALPH_DIR/sessions/$SESSION_ID"
echo "== OpenRalph =="
[[ -f "$RALPH_DIR/enabled" ]] && echo "enabled: true" || echo "enabled: false"
echo "active_session: \${SESSION_ID:-none}"
if [[ -z "$SESSION_ID" || ! -d "$SESSION_STATE_DIR" ]]; then
  echo "-- sessions --"
  find "$RALPH_DIR/sessions" -mindepth 1 -maxdepth 1 -type d -print 2>/dev/null | sed 's#.*/##' | sort
  exit 0
fi
echo "session_state_dir: $SESSION_STATE_DIR"
for file in session.json goal.json; do
  if [[ -f "$SESSION_STATE_DIR/$file" ]]; then
    echo "-- $file --"
    python3 -m json.tool "$SESSION_STATE_DIR/$file" 2>/dev/null || cat "$SESSION_STATE_DIR/$file"
  fi
done
echo "-- queue --"
sed -n '1,80p' "$SESSION_STATE_DIR/queue.md" 2>/dev/null || true
echo "-- progress --"
sed -n '1,120p' "$SESSION_STATE_DIR/progress.md" 2>/dev/null || true
echo "-- recent hook events --"
tail -20 "$SESSION_STATE_DIR/events.jsonl" 2>/dev/null || tail -20 "$RALPH_DIR/events.jsonl" 2>/dev/null || true
`

const OPENRALPH_DISENGAGE_SH = `#!/usr/bin/env bash
set -euo pipefail
RALPH_DIR="$(pwd)/.openclaude/ralph"
if [[ ! -d "$RALPH_DIR" ]]; then
  echo "No OpenRalph state in $(pwd)"
  exit 0
fi
SESSION_ID=""
if [[ "\${1:-}" == "--session" ]]; then
  SESSION_ID="\${2:-}"
else
  SESSION_ID="$(cat "$RALPH_DIR/active-session" 2>/dev/null || true)"
fi
if [[ -z "$SESSION_ID" ]]; then
  echo "No active OpenRalph session. Pass --session <id>." >&2
  exit 2
fi
SESSION_STATE_DIR="$RALPH_DIR/sessions/$SESSION_ID"
if [[ ! -d "$SESSION_STATE_DIR" ]]; then
  echo "OpenRalph session not found: $SESSION_ID" >&2
  exit 2
fi
python3 - "$SESSION_STATE_DIR/session.json" "$SESSION_STATE_DIR/goal.json" <<'PY'
import json, sys, time
session_path, goal_path = sys.argv[1], sys.argv[2]
try:
  data = json.load(open(session_path, encoding="utf-8"))
except Exception:
  data = {}
data["status"] = "disengaged"
data["updated_at"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
with open(session_path, "w", encoding="utf-8") as f:
  json.dump(data, f, indent=2)
  f.write("\\n")
try:
  goal = json.load(open(goal_path, encoding="utf-8"))
except Exception:
  goal = {}
goal["status"] = "disengaged"
goal["completed_at"] = goal.get("completed_at")
goal["last_checked_at"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
with open(goal_path, "w", encoding="utf-8") as f:
  json.dump(goal, f, indent=2)
  f.write("\\n")
PY
if [[ "$(cat "$RALPH_DIR/active-session" 2>/dev/null || true)" == "$SESSION_ID" ]]; then
  rm -f "$RALPH_DIR/enabled"
fi
echo "OpenRalph session disengaged: $SESSION_ID"
echo "State preserved at $SESSION_STATE_DIR"
`

const OPENRALPH_ROUTE_STATS_SH = `#!/usr/bin/env bash
set -euo pipefail
RALPH_DIR="$(pwd)/.openclaude/ralph"
LEDGER="$RALPH_DIR/ledger/outcomes.jsonl"
if [[ ! -f "$LEDGER" ]]; then
  echo "No routing ledger found at $LEDGER"
  exit 0
fi
python3 - "$LEDGER" <<'PY'
import json, sys, collections

ledger_path = sys.argv[1]
rows = []
with open(ledger_path, encoding="utf-8") as f:
  for line in f:
    line = line.strip()
    if not line:
      continue
    try:
      rows.append(json.loads(line))
    except Exception:
      continue

if not rows:
  print("Ledger is empty.")
  sys.exit(0)

# Aggregate per (persona, workload, provider_model_used)
Cell = collections.namedtuple("Cell", ["persona", "workload", "model"])
stats = {}  # Cell -> {n, successes, durations}

for row in rows:
  persona = row.get("persona") or "unknown"
  workload = row.get("workload") or "unknown"
  model = row.get("provider_model_used") or "unknown"
  cell = Cell(persona, workload, model)
  if cell not in stats:
    stats[cell] = {"n": 0, "successes": 0, "durations": []}
  entry = stats[cell]
  entry["n"] += 1
  # success: status == complete AND tests_passed is not False
  status = (row.get("status") or "").lower()
  tests_passed = row.get("tests_passed")
  if status == "complete" and tests_passed is not False:
    entry["successes"] += 1
  dur = row.get("duration_s")
  if dur is not None:
    entry["durations"].append(dur)

# Print table
header = f"{'persona':<28} {'workload':<14} {'model':<36} {'n':>4} {'success_rate':>12} {'avg_duration_s':>14}"
print(header)
print("-" * len(header))
for cell in sorted(stats, key=lambda c: (c.persona, c.workload, c.model)):
  e = stats[cell]
  n = e["n"]
  success_rate = e["successes"] / n if n > 0 else 0.0
  avg_duration = sum(e["durations"]) / len(e["durations"]) if e["durations"] else None
  avg_dur_str = f"{avg_duration:.1f}" if avg_duration is not None else "   n/a"
  print(f"{cell.persona:<28} {cell.workload:<14} {cell.model:<36} {n:>4} {success_rate:>11.0%} {avg_dur_str:>14}")
PY
`

const OPENRALPH_README = `# OpenRalph Support Files

OpenRalph is a project-local scheduler pattern for OpenClaude.

It combines:
- Ralph-style session bridges and hook events
- a goal condition checked after turns through the Stop hook
- persona dispatch through built-in OpenRalph agents
- provider/model routing notes in each persona result

Installed project state lives in \`.openclaude/ralph/\`.
Each workstream's mutable scheduler files live in \`.openclaude/ralph/sessions/<session_id>/\`; \`active-session\` is only a project-local pointer.
`

export const OPENRALPH_FILES = {
  'bin/openralph-bootstrap.sh': OPENRALPH_BOOTSTRAP_SH,
  'bin/openralph-hook.sh': OPENRALPH_HOOK_SH,
  'bin/openralph-status.sh': OPENRALPH_STATUS_SH,
  'bin/openralph-disengage.sh': OPENRALPH_DISENGAGE_SH,
  'bin/openralph-route-stats.sh': OPENRALPH_ROUTE_STATS_SH,
  'README.md': OPENRALPH_README,
}

function buildEngagePrompt(args: string): string {
  const prompt = args.trim()
  const objective = prompt
    ? `Use this exact OpenRalph objective:\n\n--- BEGIN OBJECTIVE ---\n${prompt}\n--- END OBJECTIVE ---`
    : 'Infer the OpenRalph objective from the current conversation.'

  return `# /openralph — engage a Ralph-style OpenClaude scheduler

${objective}

OpenRalph is not internal harness code. It is a project-local skill/process layer that uses OpenClaude's hook system, session ids, built-in agents, and provider/model picker.

## Install support files

1. Copy the support files from this skill base directory into the current repo:
   - \`bin/*\` -> \`.openclaude/ralph/bin/*\`
   - preserve executable mode with \`chmod +x .openclaude/ralph/bin/*.sh\`
2. Create or merge these project hooks into \`.claude/settings.local.json\` without deleting existing hooks:

\`\`\`json
{
  "hooks": {
    "SessionStart": [{"matcher": "", "hooks": [{"type": "command", "command": "OPENRALPH_PROJECT_ROOT=$PWD bash .openclaude/ralph/bin/openralph-hook.sh", "timeout": 10}]}],
    "PreToolUse": [{"matcher": "", "hooks": [{"type": "command", "command": "OPENRALPH_PROJECT_ROOT=$PWD bash .openclaude/ralph/bin/openralph-hook.sh", "timeout": 10}]}],
    "PostToolUse": [{"matcher": "", "hooks": [{"type": "command", "command": "OPENRALPH_PROJECT_ROOT=$PWD bash .openclaude/ralph/bin/openralph-hook.sh", "timeout": 10}]}],
    "PostToolUseFailure": [{"matcher": "", "hooks": [{"type": "command", "command": "OPENRALPH_PROJECT_ROOT=$PWD bash .openclaude/ralph/bin/openralph-hook.sh", "timeout": 10}]}],
    "Stop": [{"matcher": "", "hooks": [{"type": "command", "command": "OPENRALPH_PROJECT_ROOT=$PWD bash .openclaude/ralph/bin/openralph-hook.sh", "timeout": 10}]}]
  }
}
\`\`\`

3. Write the objective to a temp file and run:

\`\`\`bash
bash .openclaude/ralph/bin/openralph-bootstrap.sh --prompt-file /tmp/openralph-prompt.txt --mode build
\`\`\`

## Improved scheduler contract

Use Ralph's persona scheduler, plus Claude Code's newer \`/goal\` idea:

1. Resolve the active session id from \`.openclaude/ralph/active-session\`, then set \`OPENRALPH_SESSION_DIR=.openclaude/ralph/sessions/<session_id>\`.
2. Keep \`$OPENRALPH_SESSION_DIR/goal.json\` as the completion condition. Make it concrete and verifiable.
3. Keep \`$OPENRALPH_SESSION_DIR/queue.md\` as the ordered atomic-task source of truth.
4. Before each dispatch, write one task brief to \`$OPENRALPH_SESSION_DIR/current-task.md\`.
5. Dispatch one of these built-in agents with the Agent tool:
   - \`openralph-builder\` for implementation
   - \`openralph-refiner\` for completeness and edge cases
   - \`openralph-researcher\` for bounded external or repo research
   - \`openralph-test-analyzer\` for failed test diagnosis
6. Parse the returned YAML into \`$OPENRALPH_SESSION_DIR/persona-result.yml\`.
7. Update \`progress.md\`, \`queue.md\`, and \`goal.json\` in that same session directory.
8. Before each dispatch, run \`bash .openclaude/ralph/bin/openralph-route-stats.sh\` to read the routing outcome ledger. Pick the provider/model for this persona and workload by best recorded success rate (status=="complete" and tests_passed!=false counts as success). If any candidate model has n < 3 recorded outcomes for this persona × workload cell, prefer trying it once over exploiting the current best — exploration prevents day-one lock-in. Record the chosen model as \`provider_model_used\` in the persona-result YAML.

### Adjudicated dispatch (optional mode — highest-value ledger entries)

**Trigger:** use adjudicated dispatch when the current task in \`current-task.md\` contains the field \`adjudicate: true\`, OR when the task has accumulated 2 or more consecutive \`blocked\` or \`partial\` results (no_progress detected in \`progress.md\`). The marker is the preferred explicit opt-in — add \`adjudicate: true\` in the task YAML header of any high-stakes or long-running work item in \`queue.md\`.

**Procedure (N=2 cross-provider builds):**

a. Read \`bash .openclaude/ralph/bin/openralph-route-stats.sh\` to enumerate available model candidates. Select exactly 2 candidate models from **different providers** — the highest-ranked model from provider A and the highest-ranked model from provider B (using the same success-rate selection rule defined in the routing instruction above). If route stats are empty, pick one Anthropic model and one non-Anthropic model.
b. For each candidate, create an isolated git worktree:
   \`\`\`bash
   git worktree add .openclaude/ralph/adjudication/<slug>-candidate-A <base-branch>
   git worktree add .openclaude/ralph/adjudication/<slug>-candidate-B <base-branch>
   \`\`\`
c. Dispatch the **identical task brief** (the same \`current-task.md\` content, unmodified) to both candidates using the Agent tool — one dispatch per worktree. Each persona receives the identical brief so the comparison is decorrelated by model family, not by task framing. Instruct each: "Work inside the worktree at \`.openclaude/ralph/adjudication/<slug>-candidate-X\`. Do not commit to main. Return your standard persona-result YAML."
d. Dispatch \`openralph-checker\` **once per candidate result** to evaluate each independently. Pass each candidate's \`provider_model_used\` as \`worker_model\` so the checker uses a different provider. Collect each checker's verdict YAML (\`goal_met\`, \`gaps\`, \`tests_passed\`, evidence).
e. **Compare verdicts — exactly one of three branches applies:**
   - **BOTH pass** (both checkers returned \`goal_met: true\`): tiebreak to pick the winner — prefer the candidate with fewer \`gaps\` items, then the one with \`tests_passed: true\`, then the one ranked higher by route-stats success rate. Proceed to (f).
   - **EXACTLY ONE passes** (\`goal_met: true\` from one checker only): that candidate is the winner. Proceed to (f).
   - **NEITHER passes** (no checker returned \`goal_met: true\`): merge nothing — do not merge either candidate's work. Discard both worktrees with \`git worktree remove --force\`, push the union of both checkers' \`gaps\` lists as new queue items (dedupe identical gap text before pushing), and resume the outer scheduler loop at the next queue item. Skip (f) through (i).
f. **Merge the winner:** cherry-pick or merge the winner's worktree commits into the main working tree. Remove the winner's worktree: \`git worktree remove .openclaude/ralph/adjudication/<slug>-candidate-X\`.
g. **Discard the loser:** remove the loser's worktree without merging: \`git worktree remove --force .openclaude/ralph/adjudication/<slug>-candidate-Y\`.
h. **Ledger capture is automatic:** both persona dispatches return the standard persona-result YAML, and both checker dispatches return their verdict YAML. The PostToolUse hook captures all four YAML blocks to the routing ledger automatically — no extra steps needed. Both outcomes (winner AND loser) are recorded to the ledger. Adjudication events are the highest-value ledger entries because they are direct A/B comparisons on identical inputs — the loser's outcome is as valuable as the winner's for routing calibration.
i. Parse the winner's persona-result YAML into \`$OPENRALPH_SESSION_DIR/persona-result.yml\`, update \`progress.md\` and \`queue.md\` as usual, then resume the outer scheduler loop at the next queue item.

9. Before writing \`goal.json.status\` to \`complete\` or \`completed\`, dispatch \`openralph-checker\` via the Agent tool. Pass in the dispatch context: the goal condition text, the proof_command (or null), and \`worker_model\` set to the \`provider_model_used\` value from the most recent worker persona result. The checker MUST use a different provider and model family than worker_model — instruct it explicitly: "Do not use [worker_model provider]. Use a model from a different provider." Only mark goal.json complete if the checker's returned YAML has \`goal_met: true\`. If the checker returns \`goal_met: false\`, extract its \`gaps\` list and push each gap as a new queue item before continuing the loop. The checker's YAML verdict carries \`task_slug\`, \`provider_model_used\`, and \`status: complete\` (indicating the check itself ran) so the routing ledger automatically records the verification dispatch via the PostToolUse hook.
10. Stop only when \`goal.json.status\` is \`complete\` and the proof is visible in \`progress.md\`.

The Stop hook records session bridges and blocks a stop while the active session's \`goal.json.status\` is still running, so future turns resume from session-scoped OpenRalph files instead of relying on memory.`
}

function buildStatusPrompt(): string {
  return `# /openralph-status

Run \`bash .openclaude/ralph/bin/openralph-status.sh\` if it exists.

Then report:
- whether OpenRalph is enabled
- current session id, mode, iteration, and status
- current goal condition and proof command
- top queue item
- in-flight, completed, and blocked entries
- most recent hook bridge event
- top routing stats (run \`bash .openclaude/ralph/bin/openralph-route-stats.sh\`)

If support files are missing, inspect \`.openclaude/ralph/active-session\` and \`.openclaude/ralph/sessions/<session_id>/\` directly and report what exists.`
}

function buildResumePrompt(): string {
  return `# /openralph-resume

Resume an existing OpenRalph workstream.

1. Resolve the session id from \`.openclaude/ralph/active-session\` unless the user names a session explicitly.
2. Inspect \`.openclaude/ralph/sessions/<session_id>/session.json\`, \`goal.json\`, \`queue.md\`, \`progress.md\`, \`current-task.md\`, \`persona-result.yml\`, and recent \`events.jsonl\`.
3. If \`.openclaude/ralph/enabled\` is missing, recreate it unless that session status is \`disengaged\`.
4. Reinstall or verify the project hooks in \`.claude/settings.local.json\`.
5. Pick the next unfinished queue item, write a focused \`current-task.md\` inside that session directory, dispatch the matching OpenRalph persona agent, and continue the scheduler loop.
6. Update that session's \`goal.json\` only when the completion condition has visible proof.`
}

function buildDisengagePrompt(): string {
  return `# /openralph-disengage

Run \`bash .openclaude/ralph/bin/openralph-disengage.sh\` if it exists.

Then write a concise handoff into the target session's \`progress.md\` with:
- why the session was disengaged
- last completed task
- next recommended task
- verification state

Do not delete OpenRalph state files.`
}

export function registerOpenRalphSkills(): void {
  registerBundledSkill({
    name: 'openralph',
    aliases: ['ralph', 'ralph-engage', 'openralph-engage'],
    description:
      'Engage a Ralph-style OpenClaude scheduler with hook/session bridge, goal ledger, and persona dispatch.',
    whenToUse:
      'When the user wants long-running autonomous work using a Ralph-like skill/process architecture rather than internal harness changes.',
    argumentHint: '[objective]',
    userInvocable: true,
    files: OPENRALPH_FILES,
    async getPromptForCommand(args) {
      return [{ type: 'text', text: buildEngagePrompt(args) }]
    },
  })

  registerBundledSkill({
    name: 'openralph-status',
    aliases: ['ralph-status'],
    description: 'Show project-local OpenRalph scheduler status.',
    whenToUse: 'When the user asks for OpenRalph or Ralph status.',
    userInvocable: true,
    async getPromptForCommand() {
      return [{ type: 'text', text: buildStatusPrompt() }]
    },
  })

  registerBundledSkill({
    name: 'openralph-resume',
    aliases: ['ralph-resume'],
    description: 'Resume an existing project-local OpenRalph scheduler.',
    whenToUse: 'When the user asks to resume an OpenRalph or Ralph loop.',
    userInvocable: true,
    async getPromptForCommand() {
      return [{ type: 'text', text: buildResumePrompt() }]
    },
  })

  registerBundledSkill({
    name: 'openralph-disengage',
    aliases: ['ralph-disengage'],
    description: 'Disengage OpenRalph while preserving project-local state.',
    whenToUse: 'When the user asks to stop or disengage OpenRalph.',
    userInvocable: true,
    async getPromptForCommand() {
      return [{ type: 'text', text: buildDisengagePrompt() }]
    },
  })
}
