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
if [[ -d "$PROJECT_ROOT/.limitless/ralph" ]]; then RALPH_DIR="$PROJECT_ROOT/.limitless/ralph"
elif [[ -d "$PROJECT_ROOT/.openclaude/ralph" ]]; then RALPH_DIR="$PROJECT_ROOT/.openclaude/ralph"
else RALPH_DIR="$PROJECT_ROOT/.limitless/ralph"; fi
RALPH_REL="\${RALPH_DIR#"$PROJECT_ROOT/"}"
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
  # An OpenRalph loop is definitionally long-running autonomous work.
  "workload": "long-running",
  "iteration": 0,
  "max_iterations": int(os.environ["MAX_ITERATIONS"] or "0"),
  "started_at": os.environ["NOW"],
  "updated_at": os.environ["NOW"],
  "start_commit": os.environ.get("START_COMMIT") or None,
  "completion_condition": os.environ.get("COMPLETION_CONDITION") or None,
  "proof_command": os.environ.get("PROOF_COMMAND") or None,
  "lineage": [],
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
task_category: null
status: null
failure_category: null
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
  # Entries track the resolved state dir ($RALPH_REL is .limitless/ralph for new
  # repos, .openclaude/ralph when an existing legacy session was kept live).
  # grep -qF per-entry keeps this idempotent across reruns and across the rename.
  for _entry in \
    "# OpenRalph local scheduler state" \
    "$RALPH_REL/enabled" \
    "$RALPH_REL/active-session" \
    "$RALPH_REL/active-session.json" \
    "$RALPH_REL/bridges/" \
    "$RALPH_REL/events.jsonl" \
    "$RALPH_REL/logs/" \
    "$RALPH_REL/sessions/" \
  ; do
    grep -qF "$_entry" .gitignore || echo "$_entry" >> .gitignore
  done
  # $RALPH_REL/ledger/outcomes.jsonl is NOT gitignored by default.
  # Routing knowledge is a data asset worth committing (see openRalph §3 / Angle E).
  # To opt out: manually add $RALPH_REL/ledger/ to your .gitignore.
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
if [[ -d "$ROOT/.limitless/ralph" ]]; then RALPH_DIR="$ROOT/.limitless/ralph"
elif [[ -d "$ROOT/.openclaude/ralph" ]]; then RALPH_DIR="$ROOT/.openclaude/ralph"
else RALPH_DIR="$ROOT/.limitless/ralph"; fi
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
TOOL_USE_ID="$(read_json_field tool_use_id)"
CWD_VALUE="$(read_json_field cwd)"
TRANSCRIPT="$(read_json_field transcript_path)"
[[ -n "$SESSION_ID" ]] || SESSION_ID="\${CLAUDE_CODE_SESSION_ID:-\${CLAUDE_SESSION_ID:-unknown}}"
SESSION_STATE_DIR="$RALPH_DIR/sessions/$SESSION_ID"
ACTIVE_SESSION="$(cat "$RALPH_DIR/active-session" 2>/dev/null || true)"
export SESSION_ID SESSION_STATE_DIR EVENT TOOL_NAME TOOL_USE_ID CWD_VALUE TRANSCRIPT

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

# ── Dispatch start-timestamp (PreToolUse Agent) ───────────────────────────────
# Write a per-call start marker so PostToolUse can compute elapsed duration_s.
#
# Correlation: tool_use_id is present in both PreToolUse and PostToolUse hook
# inputs (see PreToolUseHookInput / PostToolUseHookInput in coreTypes.generated.ts).
# Each Agent tool call gets a unique tool_use_id, so a marker keyed by it is
# exactly correlated with its PostToolUse counterpart even if two Agent calls
# somehow ran in parallel. That said, the OpenRalph scheduler dispatches personas
# serially — one Agent call per turn — so in practice at most one marker exists
# at a time. A second PreToolUse arriving before its matching PostToolUse (which
# cannot happen in normal serial dispatch) would simply overwrite the earlier
# marker; the earlier PostToolUse would then find no marker and leave duration_s
# null rather than producing a wrong value. All IO failures are silenced (|| true).
if [[ "$EVENT" == "PreToolUse" && "$TOOL_NAME" == "Agent" && -n "$TOOL_USE_ID" ]]; then
  python3 - "$RALPH_DIR/bridges/start-\${TOOL_USE_ID}.ts" <<'PY' || true
import os, sys, time
marker_path = sys.argv[1]
try:
  os.makedirs(os.path.dirname(marker_path), exist_ok=True)
  with open(marker_path, "w", encoding="utf-8") as f:
    f.write(str(time.time()))
except Exception:
  pass
PY
fi
# ─────────────────────────────────────────────────────────────────────────────

# ── Routing Outcome Ledger capture ────────────────────────────────────────────
# On PostToolUse where tool_name == Agent, extract the persona-result YAML block
# from the tool response and append one JSONL record to the cross-session ledger.
# Runs unconditionally (not just in session state dir) so it captures all dispatches.
# Wrapped in || true so a malformed YAML or absent field never fails the hook.
if [[ "$EVENT" == "PostToolUse" && "$TOOL_NAME" == "Agent" ]]; then
  TOOL_RESPONSE="$(read_json_field tool_response)"
  # TOOL_RESPONSE_JSON re-serializes the tool_response value as valid JSON so
  # the Python block can json.loads it for token extraction.  When tool_response
  # is already a plain string (legacy tests / plain-text hook callers), json.dumps
  # produces a JSON-quoted string that json.loads back to the original.  When
  # tool_response is a nested AgentToolResult object, json.dumps produces the
  # JSON representation of that object.  Either way json.loads succeeds.
  TOOL_RESPONSE_JSON="$(python3 - "tool_response" "$INPUT" <<'PY'
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
  START_MARKER="$RALPH_DIR/bridges/start-\${TOOL_USE_ID}.ts"
  export TOOL_RESPONSE TOOL_RESPONSE_JSON TOOL_INPUT_RAW START_MARKER
  python3 - "$RALPH_DIR/ledger/outcomes.jsonl" "$SESSION_STATE_DIR/session.json" <<'PY' || true
import json, os, re, sys, time
ledger_path, session_json_path = sys.argv[1], sys.argv[2]
tool_response = os.environ.get("TOOL_RESPONSE", "")
tool_response_json = os.environ.get("TOOL_RESPONSE_JSON", "")
tool_input_raw = os.environ.get("TOOL_INPUT_RAW", "")
session_id = os.environ.get("SESSION_ID", "unknown")

# Guard: only capture ledger entries for OpenRalph agents.
# A non-OpenRalph Agent whose response happens to contain YAML would write a
# spurious row — the subagent_type prefix is the first gate.
persona = None
try:
  tool_input = json.loads(tool_input_raw) if tool_input_raw else {}
  persona = tool_input.get("subagent_type") or None
except Exception:
  pass

if not (persona and persona.startswith("openralph-")):
  sys.exit(0)

# ── Token usage extraction (Gap 3) ────────────────────────────────────────────
# tool_response_json is the JSON-preserved AgentToolResult value (re-serialized
# from the parsed hook input so it is valid JSON regardless of whether the
# original was a nested object or a plain string).
# CAVEAT: AgentToolResult.usage reflects the FINAL assistant turn only — it is a
# proxy for total dispatch cost, not a per-tool-call sum.
input_tokens = None
output_tokens = None
cache_read_tokens = None
cache_write_tokens = None
service_tier = None
# yaml_search_text defaults to tool_response (plain-text path).  When
# tool_response_json is a JSON AgentToolResult object, the YAML lives in
# content[0].text with real newlines; we pull that text so the YAML regex
# finds the fence correctly even though the outer JSON encodes newlines as \\n.
yaml_search_text = tool_response
try:
  parsed_response = json.loads(tool_response_json)
  if isinstance(parsed_response, dict):
    usage = parsed_response.get("usage")
    if isinstance(usage, dict):
      input_tokens = usage.get("input_tokens")
      output_tokens = usage.get("output_tokens")
      cache_read_tokens = usage.get("cache_read_input_tokens")
      cache_write_tokens = usage.get("cache_creation_input_tokens")
      service_tier = usage.get("service_tier")
    content = parsed_response.get("content")
    if isinstance(content, list) and content:
      first = content[0]
      if isinstance(first, dict) and first.get("type") == "text":
        yaml_search_text = first.get("text") or tool_response
  elif isinstance(parsed_response, str):
    # tool_response was a plain string (legacy path); use it for YAML regex.
    yaml_search_text = parsed_response
except Exception:
  pass
# ─────────────────────────────────────────────────────────────────────────────

# Extract the trailing YAML block from the tool response.
# Build the backtick fence programmatically to avoid quoting issues.
_bt3 = chr(96) * 3
yaml_match = re.search(_bt3 + r"yaml\\s*\\n([\\s\\S]*?)" + _bt3, yaml_search_text or "")
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
task_category = parse_yaml_field(yaml_text, "task_category")
failure_category = parse_yaml_field(yaml_text, "failure_category")
provider_model_used = parse_yaml_field(yaml_text, "provider_model_used")
status = parse_yaml_field(yaml_text, "status")
tests_passed_raw = parse_yaml_field(yaml_text, "tests_passed")
new_gaps_raw = parse_yaml_field(yaml_text, "new_gaps")
goal_met_raw = parse_yaml_field(yaml_text, "goal_met")
# persona already set from tool_input; fallback to YAML if present there
if not persona:
  persona = parse_yaml_field(yaml_text, "persona")

# tests_passed: coerce to bool or None.
if tests_passed_raw is None or tests_passed_raw.lower() == "skipped":
  tests_passed = None
else:
  tests_passed = tests_passed_raw.lower() not in ("false", "0", "no")

# goal_met: coerce to bool or None. Present only on checker rows; null for all others.
if goal_met_raw is None:
  goal_met = None
else:
  goal_met = goal_met_raw.lower() not in ("false", "0", "no")

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

# duration_s: read the PreToolUse start marker (keyed by tool_use_id) and
# compute elapsed seconds as an integer using wall-clock time (time.time()).
# The PreToolUse and PostToolUse hook invocations are separate subprocesses so
# time.monotonic() would not correlate across them; time.time() is the right
# instrument here and is precise enough for per-dispatch durations.
# All failure paths leave duration_s None — the ledger record is never blocked.
duration_s = None
start_marker = os.environ.get("START_MARKER", "")
if start_marker:
  try:
    with open(start_marker, "r", encoding="utf-8") as _mf:
      start_ts = float(_mf.read().strip())
    duration_s = int(time.time() - start_ts)
  except Exception:
    pass

# billing_model heuristic — mirrors billingModel() in modelRegistry.ts.
# Tokens for subscription rows have $0 marginal cost.
# NOTE: do NOT compute dollars here — the cross-provider price table is
# incomplete; tokens are the honest unit (researcher verdict, Gap 3 feasibility).
billing_model = None
if provider_model_used:
  pmu = provider_model_used.lower()
  # free: any localhost/127.0.0.1 marker (local models, dev proxies)
  if "localhost" in pmu or "127.0.0.1" in pmu:
    billing_model = "free"
  # subscription: anthropic-proxy prefix (Claude Max OAuth proxy) or
  # Codex endpoint (chatgpt.com/backend-api/codex URL pattern or codex-prefix alias)
  elif pmu.startswith("anthropic-proxy"):
    billing_model = "subscription"
  elif "codex" in pmu:
    billing_model = "subscription"
  # metered: everything else (anthropic-native, gemini, bedrock, vertex,
  # generic openai-compatible, etc.)
  else:
    billing_model = "metered"

record = {
  "ts": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
  "session_id": session_id,
  "task_slug": task_slug,
  "task_category": task_category,
  "persona": persona,
  "workload": workload,
  "provider_model_used": provider_model_used,
  "status": status,
  "failure_category": failure_category,
  "tests_passed": tests_passed,
  "new_gaps": new_gaps,
  "duration_s": duration_s,
  "goal_met": goal_met,
  "input_tokens": input_tokens,
  "output_tokens": output_tokens,
  "cache_read_tokens": cache_read_tokens,
  "cache_write_tokens": cache_write_tokens,
  "service_tier": service_tier,
  "billing_model": billing_model,
}

# Clean up the start marker regardless of whether we write a ledger row.
# Silenced so a missing or unreadable marker never raises.
if start_marker:
  try:
    os.remove(start_marker)
  except Exception:
    pass

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
state_dir = os.environ.get("SESSION_STATE_DIR", ".limitless/ralph/sessions/<session_id>")
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
if [[ -d "$(pwd)/.limitless/ralph" ]]; then RALPH_DIR="$(pwd)/.limitless/ralph"
elif [[ -d "$(pwd)/.openclaude/ralph" ]]; then RALPH_DIR="$(pwd)/.openclaude/ralph"
else RALPH_DIR="$(pwd)/.limitless/ralph"; fi
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
if [[ -f "$SESSION_STATE_DIR/session.json" ]]; then
  python3 - "$SESSION_STATE_DIR/session.json" <<'PY'
import json, sys
try:
  data = json.load(open(sys.argv[1], encoding="utf-8"))
  lineage = data.get("lineage") or []
  if lineage:
    chain = " -> ".join(entry.get("ancestor", "?") for entry in lineage)
    print("lineage: " + chain)
except Exception:
  pass
PY
fi
echo "-- queue --"
sed -n '1,80p' "$SESSION_STATE_DIR/queue.md" 2>/dev/null || true
echo "-- progress --"
sed -n '1,120p' "$SESSION_STATE_DIR/progress.md" 2>/dev/null || true
echo "-- recent hook events --"
tail -20 "$SESSION_STATE_DIR/events.jsonl" 2>/dev/null || tail -20 "$RALPH_DIR/events.jsonl" 2>/dev/null || true
`

const OPENRALPH_DISENGAGE_SH = `#!/usr/bin/env bash
set -euo pipefail
if [[ -d "$(pwd)/.limitless/ralph" ]]; then RALPH_DIR="$(pwd)/.limitless/ralph"
elif [[ -d "$(pwd)/.openclaude/ralph" ]]; then RALPH_DIR="$(pwd)/.openclaude/ralph"
else RALPH_DIR="$(pwd)/.limitless/ralph"; fi
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

const OPENRALPH_ADOPT_SH = `#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
openralph-adopt.sh [--force] <orphan_session_id>

Adopt an orphaned OpenRalph session into the current new session.
The orphan's files are COPIED (not moved) so the ancestor's history
is preserved unchanged.  The new session gets a fresh session_id,
carries forward the orphan's lineage chain, and becomes the active session.

Liveness: an orphan that still looks live (active-session pointer + enabled
marker) is adopted anyway if its bridge heartbeat file is missing or older
than OPENRALPH_ADOPT_STALE_SECONDS (default 600) — a crashed loop never
clears those markers, so staleness is the crash signal.  Adoption is only
refused when the bridge heartbeat is fresh.  --force skips the liveness
refusal entirely.
EOF
}

FORCE="0"
ORPHAN_SID=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --force) FORCE="1"; shift ;;
    -h|--help) usage; exit 0 ;;
    *) ORPHAN_SID="$1"; shift ;;
  esac
done
if [[ -z "$ORPHAN_SID" ]]; then
  echo "Usage: openralph-adopt.sh [--force] <orphan_session_id>" >&2
  usage >&2
  exit 2
fi

PROJECT_ROOT="$(pwd)"
if [[ -d "$PROJECT_ROOT/.limitless/ralph" ]]; then RALPH_DIR="$PROJECT_ROOT/.limitless/ralph"
elif [[ -d "$PROJECT_ROOT/.openclaude/ralph" ]]; then RALPH_DIR="$PROJECT_ROOT/.openclaude/ralph"
else RALPH_DIR="$PROJECT_ROOT/.limitless/ralph"; fi
SESSION_DIR="$RALPH_DIR/sessions"
ORPHAN_STATE_DIR="$SESSION_DIR/$ORPHAN_SID"

if [[ ! -d "$ORPHAN_STATE_DIR" ]]; then
  echo "Orphan session not found: $ORPHAN_STATE_DIR" >&2
  exit 2
fi

# Liveness check: the orphan must not be the current active session of a LIVE loop.
# A loop LOOKS live when BOTH conditions hold:
#   1. active-session points to this session id, AND
#   2. the enabled marker exists (the disengager removes enabled when it matches active-session).
# But a CRASHED loop leaves exactly that state behind — the disengager never ran.
# So when the live-looking condition holds, the deciding signal is the bridge
# heartbeat: the hook overwrites bridges/<sid>.json on every event, so a fresh
# mtime means a genuinely live loop while a missing or stale bridge means crash.
ACTIVE_SESSION="$(cat "$RALPH_DIR/active-session" 2>/dev/null || true)"
ENABLED="$RALPH_DIR/enabled"
BRIDGE_FILE="$RALPH_DIR/bridges/$ORPHAN_SID.json"
STALE_SECONDS="\${OPENRALPH_ADOPT_STALE_SECONDS:-600}"
if [[ "$ACTIVE_SESSION" == "$ORPHAN_SID" && -f "$ENABLED" ]]; then
  if [[ "$FORCE" == "1" ]]; then
    echo "WARNING: --force given; adopting $ORPHAN_SID even though it looks live (a live loop may still be running)." >&2
  else
    BRIDGE_AGE="$(python3 - "$BRIDGE_FILE" <<'PY'
import os, sys, time
try:
  print(int(time.time() - os.path.getmtime(sys.argv[1])))
except OSError:
  print(-1)
PY
)"
    if [[ "$BRIDGE_AGE" -lt 0 ]]; then
      echo "orphan bridge missing; treating as crashed and adopting."
    elif [[ "$BRIDGE_AGE" -gt "$STALE_SECONDS" ]]; then
      echo "orphan bridge stale \${BRIDGE_AGE}s > \${STALE_SECONDS}s threshold; treating as crashed and adopting."
    else
      echo "Cannot adopt: session $ORPHAN_SID looks live — bridge heartbeat is \${BRIDGE_AGE}s old (fresh, <= \${STALE_SECONDS}s threshold)." >&2
      echo "Options: wait until the bridge heartbeat exceeds OPENRALPH_ADOPT_STALE_SECONDS (default 600)," >&2
      echo "rerun with --force to override, or disengage the loop first:" >&2
      echo "  bash .limitless/ralph/bin/openralph-disengage.sh" >&2
      exit 2
    fi
  fi
fi

NEW_SESSION_ID="\${CLAUDE_CODE_SESSION_ID:-\${CLAUDE_SESSION_ID:-}}"
if [[ -z "$NEW_SESSION_ID" ]]; then
  NEW_SESSION_ID="$(python3 - <<'PY'
import uuid
print(uuid.uuid4())
PY
)"
fi
NEW_STATE_DIR="$SESSION_DIR/$NEW_SESSION_ID"
mkdir -p "$NEW_STATE_DIR"

NOW="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
export ORPHAN_SID NEW_SESSION_ID NEW_STATE_DIR ORPHAN_STATE_DIR NOW

# Copy the orphan's work files into the new session dir.
# Originals are NOT touched — this is copy-not-move semantics.
for src_file in session.json goal.json queue.md progress.md; do
  if [[ -f "$ORPHAN_STATE_DIR/$src_file" ]]; then
    cp "$ORPHAN_STATE_DIR/$src_file" "$NEW_STATE_DIR/$src_file"
  fi
done

# Update session.json: set new session_id, updated_at, and compose the lineage chain.
python3 - "$NEW_STATE_DIR/session.json" <<'PY'
import json, os, sys, time
session_path = sys.argv[1]
orphan_sid = os.environ["ORPHAN_SID"]
new_sid = os.environ["NEW_SESSION_ID"]
now = os.environ["NOW"]

try:
  data = json.load(open(session_path, encoding="utf-8"))
except Exception:
  data = {}

# Inherit the ancestor's lineage and append this adoption event.
ancestor_lineage = data.get("lineage") or []
ancestor_lineage.append({"ancestor": orphan_sid, "adopted_at": now})

data["session_id"] = new_sid
data["lineage"] = ancestor_lineage
data["updated_at"] = now
data["status"] = "running"

with open(session_path, "w", encoding="utf-8") as f:
  json.dump(data, f, indent=2)
  f.write("\\n")
PY

# Update the active-session pointer and write active-session.json.
printf '%s\n' "$NEW_SESSION_ID" > "$RALPH_DIR/active-session"
cp "$NEW_STATE_DIR/session.json" "$RALPH_DIR/active-session.json"
touch "$RALPH_DIR/enabled"

echo "OpenRalph session adopted"
echo "Ancestor: $ORPHAN_SID"
echo "New session: $NEW_SESSION_ID"
echo "State: $NEW_STATE_DIR/session.json"
echo "Ancestor state preserved at: $ORPHAN_STATE_DIR"
`

const OPENRALPH_ROUTE_STATS_SH = `#!/usr/bin/env bash
set -euo pipefail
if [[ -d "$(pwd)/.limitless/ralph" ]]; then RALPH_DIR="$(pwd)/.limitless/ralph"
elif [[ -d "$(pwd)/.openclaude/ralph" ]]; then RALPH_DIR="$(pwd)/.openclaude/ralph"
else RALPH_DIR="$(pwd)/.limitless/ralph"; fi
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

# Build checker verdict index: task_slug -> latest checker row (by ts, then array order).
checker_by_slug = {}
for row in rows:
  persona = row.get("persona") or ""
  if not persona.endswith("-checker"):
    continue
  slug = row.get("task_slug")
  if not slug:
    continue
  existing = checker_by_slug.get(slug)
  if existing is None or (row.get("ts") or "") >= (existing.get("ts") or ""):
    checker_by_slug[slug] = row

# Infrastructure failure categories: excluded from n/successes (not model-quality evidence).
INFRA_CATEGORIES = {"rate_limited", "auth", "server_error", "timeout"}

# Aggregate per (persona, workload, provider_model_used).
# Worker rows: persona does NOT end with "-checker".
Cell = collections.namedtuple("Cell", ["persona", "workload", "model"])
stats = {}  # Cell -> {n, successes, durations, n_verified, verified_successes, token_pairs, infra_excluded}

for row in rows:
  persona = row.get("persona") or "unknown"
  if persona.endswith("-checker"):
    continue
  workload = row.get("workload") or "unknown"
  model = row.get("provider_model_used") or "unknown"
  cell = Cell(persona, workload, model)
  if cell not in stats:
    stats[cell] = {"n": 0, "successes": 0, "durations": [], "n_verified": 0, "verified_successes": 0, "token_pairs": [], "infra_excluded": 0}
  entry = stats[cell]
  # Exclude infrastructure failures — they carry no model-quality signal.
  fc = row.get("failure_category")
  if fc and fc in INFRA_CATEGORIES:
    entry["infra_excluded"] += 1
    continue
  entry["n"] += 1
  # self-reported success: status == complete AND tests_passed is not False
  status = (row.get("status") or "").lower()
  tests_passed = row.get("tests_passed")
  is_self_success = status == "complete" and tests_passed is not False
  if is_self_success:
    entry["successes"] += 1
  dur = row.get("duration_s")
  if dur is not None:
    entry["durations"].append(dur)
  # token pair: input_tokens + output_tokens (both must be non-null integers)
  it = row.get("input_tokens")
  ot = row.get("output_tokens")
  if isinstance(it, int) and isinstance(ot, int):
    entry["token_pairs"].append(it + ot)
  # checker-verified join: absent verdict excluded (not a failure)
  slug = row.get("task_slug")
  if slug and slug in checker_by_slug:
    goal_met = checker_by_slug[slug].get("goal_met")
    if goal_met is not None:
      entry["n_verified"] += 1
      if is_self_success and goal_met is True:
        entry["verified_successes"] += 1

any_verified = any(e["n_verified"] > 0 for e in stats.values())
any_tokens = any(len(e["token_pairs"]) > 0 for e in stats.values())
any_infra_excluded = any(e["infra_excluded"] > 0 for e in stats.values())

# Print table
if any_verified and any_tokens and any_infra_excluded:
  header = f"{'persona':<28} {'workload':<14} {'model':<36} {'n':>4} {'success_rate':>12} {'avg_duration_s':>14} {'avg_tokens':>10} {'n_verified':>10} {'verified_rate':>13} {'infra_excl':>10}"
elif any_verified and any_tokens:
  header = f"{'persona':<28} {'workload':<14} {'model':<36} {'n':>4} {'success_rate':>12} {'avg_duration_s':>14} {'avg_tokens':>10} {'n_verified':>10} {'verified_rate':>13}"
elif any_verified and any_infra_excluded:
  header = f"{'persona':<28} {'workload':<14} {'model':<36} {'n':>4} {'success_rate':>12} {'avg_duration_s':>14} {'n_verified':>10} {'verified_rate':>13} {'infra_excl':>10}"
elif any_tokens and any_infra_excluded:
  header = f"{'persona':<28} {'workload':<14} {'model':<36} {'n':>4} {'success_rate':>12} {'avg_duration_s':>14} {'avg_tokens':>10} {'infra_excl':>10}"
elif any_verified:
  header = f"{'persona':<28} {'workload':<14} {'model':<36} {'n':>4} {'success_rate':>12} {'avg_duration_s':>14} {'n_verified':>10} {'verified_rate':>13}"
elif any_tokens:
  header = f"{'persona':<28} {'workload':<14} {'model':<36} {'n':>4} {'success_rate':>12} {'avg_duration_s':>14} {'avg_tokens':>10}"
elif any_infra_excluded:
  header = f"{'persona':<28} {'workload':<14} {'model':<36} {'n':>4} {'success_rate':>12} {'avg_duration_s':>14} {'infra_excl':>10}"
else:
  header = f"{'persona':<28} {'workload':<14} {'model':<36} {'n':>4} {'success_rate':>12} {'avg_duration_s':>14}"
print(header)
print("-" * len(header))
for cell in sorted(stats, key=lambda c: (c.persona, c.workload, c.model)):
  e = stats[cell]
  n = e["n"]
  success_rate = e["successes"] / n if n > 0 else 0.0
  avg_duration = sum(e["durations"]) / len(e["durations"]) if e["durations"] else None
  avg_dur_str = f"{avg_duration:.1f}" if avg_duration is not None else "   n/a"
  avg_tok = sum(e["token_pairs"]) / len(e["token_pairs"]) if e["token_pairs"] else None
  avg_tok_str = f"{int(avg_tok)}" if avg_tok is not None else "   n/a"
  ie = e["infra_excluded"]
  ie_str = str(ie)
  if any_verified and any_tokens and any_infra_excluded:
    nv = e["n_verified"]
    vr = e["verified_successes"] / nv if nv > 0 else None
    vr_str = f"{vr:.0%}" if vr is not None else "    n/a"
    print(f"{cell.persona:<28} {cell.workload:<14} {cell.model:<36} {n:>4} {success_rate:>11.0%} {avg_dur_str:>14} {avg_tok_str:>10} {nv:>10} {vr_str:>13} {ie_str:>10}")
  elif any_verified and any_tokens:
    nv = e["n_verified"]
    vr = e["verified_successes"] / nv if nv > 0 else None
    vr_str = f"{vr:.0%}" if vr is not None else "    n/a"
    print(f"{cell.persona:<28} {cell.workload:<14} {cell.model:<36} {n:>4} {success_rate:>11.0%} {avg_dur_str:>14} {avg_tok_str:>10} {nv:>10} {vr_str:>13}")
  elif any_verified and any_infra_excluded:
    nv = e["n_verified"]
    vr = e["verified_successes"] / nv if nv > 0 else None
    vr_str = f"{vr:.0%}" if vr is not None else "    n/a"
    print(f"{cell.persona:<28} {cell.workload:<14} {cell.model:<36} {n:>4} {success_rate:>11.0%} {avg_dur_str:>14} {nv:>10} {vr_str:>13} {ie_str:>10}")
  elif any_tokens and any_infra_excluded:
    print(f"{cell.persona:<28} {cell.workload:<14} {cell.model:<36} {n:>4} {success_rate:>11.0%} {avg_dur_str:>14} {avg_tok_str:>10} {ie_str:>10}")
  elif any_verified:
    nv = e["n_verified"]
    vr = e["verified_successes"] / nv if nv > 0 else None
    vr_str = f"{vr:.0%}" if vr is not None else "    n/a"
    print(f"{cell.persona:<28} {cell.workload:<14} {cell.model:<36} {n:>4} {success_rate:>11.0%} {avg_dur_str:>14} {nv:>10} {vr_str:>13}")
  elif any_tokens:
    print(f"{cell.persona:<28} {cell.workload:<14} {cell.model:<36} {n:>4} {success_rate:>11.0%} {avg_dur_str:>14} {avg_tok_str:>10}")
  elif any_infra_excluded:
    print(f"{cell.persona:<28} {cell.workload:<14} {cell.model:<36} {n:>4} {success_rate:>11.0%} {avg_dur_str:>14} {ie_str:>10}")
  else:
    print(f"{cell.persona:<28} {cell.workload:<14} {cell.model:<36} {n:>4} {success_rate:>11.0%} {avg_dur_str:>14}")
PY
`

const OPENRALPH_KICK_SH = `#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
openralph-kick.sh --session <id-or-prefix> [--project <path>]
openralph-kick.sh --session <id> --prompt "objective" [--project <path>] [bootstrap flags...]
openralph-kick.sh --session <id> --prompt-file <path> [--project <path>] [bootstrap flags...]

Options:
  --session, -s <id>          Target OpenClaude session id or existing-session prefix.
  --project, -C <path>        Project root. Defaults to current directory.
  --prompt <text>             Create the target session when state is missing.
  --prompt-file <path>        Read objective from file when state is missing.
  --mode <mode>               Forwarded to openralph-bootstrap.sh.
  --max-iterations <n>        Forwarded to openralph-bootstrap.sh.
  --completion-condition <t>  Forwarded to openralph-bootstrap.sh.
  --proof-command <command>   Forwarded to openralph-bootstrap.sh.
  --force                    Do not refuse a live-looking target.

Existing sessions are reactivated by filesystem markers. Missing sessions need
--prompt or --prompt-file so the kick has a concrete objective to bootstrap.
EOF
}

SESSION_ARG=""
PROJECT_ROOT="$(pwd -P 2>/dev/null || pwd)"
PROMPT=""
PROMPT_FILE=""
FORCE="0"
FORWARD_ARGS=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --session|-s) SESSION_ARG="\${2:-}"; shift 2 ;;
    --project|-C) PROJECT_ROOT="\${2:-}"; shift 2 ;;
    --prompt) PROMPT="\${2:-}"; shift 2 ;;
    --prompt-file) PROMPT_FILE="\${2:-}"; shift 2 ;;
    --force) FORCE="1"; shift ;;
    --mode|--max-iterations|--completion-condition|--proof-command)
      FORWARD_ARGS+=("$1" "\${2:-}")
      shift 2
      ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown argument: $1" >&2; usage >&2; exit 2 ;;
  esac
done

SESSION_ARG="\${SESSION_ARG#sid:}"
if [[ -z "$SESSION_ARG" ]]; then
  echo "--session is required" >&2
  usage >&2
  exit 2
fi

PROJECT_ROOT="$(cd "$PROJECT_ROOT" && pwd -P)"
if [[ -d "$PROJECT_ROOT/.limitless/ralph" ]]; then RALPH_DIR="$PROJECT_ROOT/.limitless/ralph"
elif [[ -d "$PROJECT_ROOT/.openclaude/ralph" ]]; then RALPH_DIR="$PROJECT_ROOT/.openclaude/ralph"
else RALPH_DIR="$PROJECT_ROOT/.limitless/ralph"; fi
SESSION_DIR="$RALPH_DIR/sessions"
BOOTSTRAP="$RALPH_DIR/bin/openralph-bootstrap.sh"
mkdir -p "$SESSION_DIR" "$RALPH_DIR/bridges" "$RALPH_DIR/logs"

resolve_session() {
  local arg="$1" d sid matches=()
  for d in "$SESSION_DIR"/*; do
    [[ -d "$d" ]] || continue
    sid="$(basename "$d")"
    if [[ "$sid" == "$arg" || "$sid" == "$arg"* ]]; then
      matches+=("$sid")
    fi
  done
  if [[ \${#matches[@]} -gt 1 ]]; then
    echo "openralph-kick: ambiguous session prefix '$arg':" >&2
    printf '  %s\\n' "\${matches[@]}" >&2
    exit 2
  fi
  [[ \${#matches[@]} -eq 1 ]] && printf '%s\\n' "\${matches[0]}"
}

write_kick_state() {
  local sid="$1"
  local session_state_dir="$SESSION_DIR/$sid"
  local active bridge_age
  mkdir -p "$session_state_dir"

  active="$(cat "$RALPH_DIR/active-session" 2>/dev/null || true)"
  if [[ "$FORCE" != "1" && "$active" == "$sid" && -f "$RALPH_DIR/enabled" ]]; then
    bridge_age="$(python3 - "$RALPH_DIR/bridges/$sid.json" <<'PY'
import os, sys, time
try:
  print(int(time.time() - os.path.getmtime(sys.argv[1])))
except OSError:
  print(-1)
PY
)"
    if [[ "$bridge_age" -ge 0 && "$bridge_age" -lt "\${OPENRALPH_KICK_LIVE_SECONDS:-15}" ]]; then
      echo "openralph-kick: session $sid already looks live (bridge age \${bridge_age}s). Use --force to rewrite kick markers anyway." >&2
      exit 2
    fi
  elif [[ "$FORCE" != "1" && -n "$active" && "$active" != "$sid" && -f "$RALPH_DIR/enabled" ]]; then
    # A DIFFERENT session is currently the active-session pointer with enabled present.
    # If its bridge heartbeat is fresh, re-pointing active-session would silently disable
    # that session's Stop gate mid-flight (the hook gate requires SESSION_ID == ACTIVE_SESSION).
    # Reuse the same staleness threshold as openralph-adopt.sh so the rule is consistent.
    bridge_age="$(python3 - "$RALPH_DIR/bridges/$active.json" <<'PY'
import os, sys, time
try:
  print(int(time.time() - os.path.getmtime(sys.argv[1])))
except OSError:
  print(-1)
PY
)"
    if [[ "$bridge_age" -ge 0 && "$bridge_age" -lt "\${OPENRALPH_ADOPT_STALE_SECONDS:-600}" ]]; then
      echo "openralph-kick: session $active is live (bridge age \${bridge_age}s, threshold \${OPENRALPH_ADOPT_STALE_SECONDS:-600}s). Re-pointing active-session to $sid would disable its Stop gate mid-flight. Wait until the bridge heartbeat exceeds OPENRALPH_ADOPT_STALE_SECONDS, disengage $active first, or rerun with --force." >&2
      exit 2
    fi
  fi

  touch "$RALPH_DIR/enabled"
  printf '%s\\n' "$sid" > "$RALPH_DIR/active-session"
  if [[ -f "$session_state_dir/session.json" ]]; then
    cp "$session_state_dir/session.json" "$RALPH_DIR/active-session.json" 2>/dev/null || true
  fi

  python3 - "$session_state_dir/kick.json" "$session_state_dir/kick-log.jsonl" "$RALPH_DIR/events.jsonl" <<'PY'
import json, os, sys, time
kick_path, kick_log, events_path = sys.argv[1:4]
record = {
  "ts": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
  "event": "kick",
  "session_id": os.environ["OPENRALPH_KICK_SESSION_ID"],
  "session_state_dir": os.environ["OPENRALPH_KICK_SESSION_DIR"],
  "project_root": os.environ["OPENRALPH_KICK_PROJECT_ROOT"],
}
with open(kick_path, "w", encoding="utf-8") as f:
  json.dump(record, f, indent=2)
  f.write("\\n")
for path in (kick_log, events_path):
  with open(path, "a", encoding="utf-8") as f:
    f.write(json.dumps(record, separators=(",", ":")) + "\\n")
PY
}

SESSION_ID="$(resolve_session "$SESSION_ARG" || true)"
if [[ -n "$SESSION_ID" ]]; then
  export OPENRALPH_KICK_SESSION_ID="$SESSION_ID"
  export OPENRALPH_KICK_SESSION_DIR="$SESSION_DIR/$SESSION_ID"
  export OPENRALPH_KICK_PROJECT_ROOT="$PROJECT_ROOT"
  write_kick_state "$SESSION_ID"
  echo "OpenRalph kicked"
  echo "Session: $SESSION_ID"
  echo "Project: $PROJECT_ROOT"
  echo "Kick marker: $SESSION_DIR/$SESSION_ID/kick.json"
  exit 0
fi

if [[ -z "$PROMPT" && -n "$PROMPT_FILE" ]]; then
  if [[ ! -f "$PROMPT_FILE" ]]; then
    echo "openralph-kick: --prompt-file not found: $PROMPT_FILE" >&2
    exit 2
  fi
  PROMPT="$(cat "$PROMPT_FILE")"
fi

if [[ -z "$PROMPT" ]]; then
  echo "openralph-kick: no session matched '$SESSION_ARG'. Pass --prompt or --prompt-file to create it." >&2
  exit 2
fi

if [[ ! -x "$BOOTSTRAP" ]]; then
  echo "openralph-kick: bootstrap script not executable at $BOOTSTRAP" >&2
  exit 1
fi

TMP_PROMPT="$(mktemp "\${TMPDIR:-/tmp}/openralph-kick-prompt.XXXXXX")"
printf '%s\\n' "$PROMPT" > "$TMP_PROMPT"
(cd "$PROJECT_ROOT" && \
  CLAUDE_CODE_SESSION_ID="$SESSION_ARG" \
  CLAUDE_SESSION_ID="$SESSION_ARG" \
  bash "$BOOTSTRAP" --prompt-file "$TMP_PROMPT" "\${FORWARD_ARGS[@]}")

export OPENRALPH_KICK_SESSION_ID="$SESSION_ARG"
export OPENRALPH_KICK_SESSION_DIR="$SESSION_DIR/$SESSION_ARG"
export OPENRALPH_KICK_PROJECT_ROOT="$PROJECT_ROOT"
write_kick_state "$SESSION_ARG"
echo "OpenRalph kicked"
echo "Session: $SESSION_ARG"
echo "Project: $PROJECT_ROOT"
echo "Kick marker: $SESSION_DIR/$SESSION_ARG/kick.json"
`

const OPENRALPH_README = `# OpenRalph Support Files

OpenRalph is a project-local scheduler pattern for OpenClaude.

It combines:
- Ralph-style session bridges and hook events
- a goal condition checked after turns through the Stop hook
- persona dispatch through built-in OpenRalph agents
- provider/model routing notes in each persona result

Installed project state lives in \`.limitless/ralph/\`.
Each workstream's mutable scheduler files live in \`.limitless/ralph/sessions/<session_id>/\`; \`active-session\` is only a project-local pointer.
`

export const OPENRALPH_FILES = {
  'bin/openralph-bootstrap.sh': OPENRALPH_BOOTSTRAP_SH,
  'bin/openralph-hook.sh': OPENRALPH_HOOK_SH,
  'bin/openralph-status.sh': OPENRALPH_STATUS_SH,
  'bin/openralph-disengage.sh': OPENRALPH_DISENGAGE_SH,
  'bin/openralph-adopt.sh': OPENRALPH_ADOPT_SH,
  'bin/openralph-route-stats.sh': OPENRALPH_ROUTE_STATS_SH,
  'bin/openralph-kick.sh': OPENRALPH_KICK_SH,
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
   - \`bin/*\` -> \`.limitless/ralph/bin/*\`
   - preserve executable mode with \`chmod +x .limitless/ralph/bin/*.sh\`
2. Create or merge these project hooks into \`.claude/settings.local.json\` without deleting existing hooks:

\`\`\`json
{
  "hooks": {
    "SessionStart": [{"matcher": "", "hooks": [{"type": "command", "command": "OPENRALPH_PROJECT_ROOT=$PWD bash .limitless/ralph/bin/openralph-hook.sh", "timeout": 10}]}],
    "PreToolUse": [{"matcher": "", "hooks": [{"type": "command", "command": "OPENRALPH_PROJECT_ROOT=$PWD bash .limitless/ralph/bin/openralph-hook.sh", "timeout": 10}]}],
    "PostToolUse": [{"matcher": "", "hooks": [{"type": "command", "command": "OPENRALPH_PROJECT_ROOT=$PWD bash .limitless/ralph/bin/openralph-hook.sh", "timeout": 10}]}],
    "PostToolUseFailure": [{"matcher": "", "hooks": [{"type": "command", "command": "OPENRALPH_PROJECT_ROOT=$PWD bash .limitless/ralph/bin/openralph-hook.sh", "timeout": 10}]}],
    "Stop": [{"matcher": "", "hooks": [{"type": "command", "command": "OPENRALPH_PROJECT_ROOT=$PWD bash .limitless/ralph/bin/openralph-hook.sh", "timeout": 10}]}]
  }
}
\`\`\`

3. Write the objective to a temp file and run:

\`\`\`bash
bash .limitless/ralph/bin/openralph-bootstrap.sh --prompt-file /tmp/openralph-prompt.txt --mode build
\`\`\`

## Improved scheduler contract

Use Ralph's persona scheduler, plus Claude Code's newer \`/goal\` idea:

1. Resolve the active session id from \`.limitless/ralph/active-session\`, then set \`OPENRALPH_SESSION_DIR=.limitless/ralph/sessions/<session_id>\`.
2. Keep \`$OPENRALPH_SESSION_DIR/goal.json\` as the completion condition. Make it concrete and verifiable.
3. Keep \`$OPENRALPH_SESSION_DIR/queue.md\` as the ordered atomic-task source of truth. When writing a new queue item, classify it with an optional \`category:\` field using exactly one of: implementation | debugging | research | refactoring | verification | other.
4. Before each dispatch, write one task brief to \`$OPENRALPH_SESSION_DIR/current-task.md\`. The brief MUST include a \`task_slug:\` field (a short kebab-case identifier unique to this task, e.g. \`task_slug: fix-auth-redirect\`) and the \`category:\` field from the queue item. Every persona echoes the EXACT task_slug from the brief in its result YAML — the routing ledger uses this slug to join checker verdicts to worker rows. Include task_slug and category in the brief header so the persona can echo them as \`task_slug\` and \`task_category\` in the result YAML.
5. Dispatch one of these built-in agents with the Agent tool:
   - \`openralph-builder\` for implementation
   - \`openralph-refiner\` for completeness and edge cases
   - \`openralph-researcher\` for bounded external or repo research
   - \`openralph-test-analyzer\` for failed test diagnosis
6. Parse the returned YAML into \`$OPENRALPH_SESSION_DIR/persona-result.yml\`.
7. Update \`progress.md\`, \`queue.md\`, and \`goal.json\` in that same session directory.
8. Before each dispatch, run \`bash .limitless/ralph/bin/openralph-route-stats.sh\` to read the routing outcome ledger. Pick the provider/model for this persona and workload by best confidence-adjusted success rate (status=="complete" and tests_passed!=false counts as success). If any candidate model has n < 3 recorded outcomes for this persona × workload cell, prefer trying it once over exploiting the current best — exploration prevents day-one lock-in. Record the chosen model as \`provider_model_used\` in the persona-result YAML. For long-running or overnight tasks, prefer subscription-billed candidates (Claude Max proxy, Codex OAuth) over metered API candidates within the same success-rate tier, and prefer metered candidates for short interactive dispatches — subscription quota is perishable and expires unspent if idle.

### Adjudicated dispatch (optional mode — highest-value ledger entries)

**Trigger:** use adjudicated dispatch when the current task in \`current-task.md\` contains the field \`adjudicate: true\`, OR when the task has accumulated 2 or more consecutive \`blocked\` or \`partial\` results (no_progress detected in \`progress.md\`). The marker is the preferred explicit opt-in — add \`adjudicate: true\` in the task YAML header of any high-stakes or long-running work item in \`queue.md\`.

**Procedure (N=2 cross-provider builds):**

a. Read \`bash .limitless/ralph/bin/openralph-route-stats.sh\` to enumerate available model candidates. Select exactly 2 candidate models from **different providers** — the highest-ranked model from provider A and the highest-ranked model from provider B (using the same success-rate selection rule defined in the routing instruction above). If route stats are empty, pick one Anthropic model and one non-Anthropic model. **Provider diversity wins over billing preference:** if the billing preference from step 8 cannot be satisfied for both candidates simultaneously (e.g. only one subscription-billed provider is available), candidate A takes the preferred-billing provider and candidate B takes the best-ranked candidate from any other provider regardless of billing model.
b. For each candidate, create an isolated git worktree:
   \`\`\`bash
   git worktree add .limitless/ralph/adjudication/<slug>-candidate-A <base-branch>
   git worktree add .limitless/ralph/adjudication/<slug>-candidate-B <base-branch>
   \`\`\`
c. Dispatch the **identical task brief** (the same \`current-task.md\` content, unmodified) to both candidates using the Agent tool — one dispatch per worktree. Each persona receives the identical brief so the comparison is decorrelated by model family, not by task framing. Instruct each: "Work inside the worktree at \`.limitless/ralph/adjudication/<slug>-candidate-X\`. Do not commit to main. Return your standard persona-result YAML."
d. Dispatch \`openralph-checker\` **once per candidate result** to evaluate each independently. Pass each candidate's \`provider_model_used\` as \`worker_model\` so the checker uses a different provider. Collect each checker's verdict YAML (\`goal_met\`, \`gaps\`, \`tests_passed\`, evidence).
e. **Compare verdicts — exactly one of three branches applies:**
   - **BOTH pass** (both checkers returned \`goal_met: true\`): tiebreak to pick the winner — prefer the candidate with fewer \`gaps\` items, then the one with \`tests_passed: true\`, then the one ranked higher by route-stats success rate. Proceed to (f).
   - **EXACTLY ONE passes** (\`goal_met: true\` from one checker only): that candidate is the winner. Proceed to (f).
   - **NEITHER passes** (no checker returned \`goal_met: true\`): merge nothing — do not merge either candidate's work. Discard both worktrees with \`git worktree remove --force\`, push the union of both checkers' \`gaps\` lists as new queue items (dedupe identical gap text before pushing), and resume the outer scheduler loop at the next queue item. Skip (f) through (i).
f. **Merge the winner:** cherry-pick or merge the winner's worktree commits into the main working tree. Remove the winner's worktree: \`git worktree remove .limitless/ralph/adjudication/<slug>-candidate-X\`.
g. **Discard the loser:** remove the loser's worktree without merging: \`git worktree remove --force .limitless/ralph/adjudication/<slug>-candidate-Y\`.
h. **Ledger capture is automatic:** both persona dispatches return the standard persona-result YAML, and both checker dispatches return their verdict YAML. The PostToolUse hook captures all four YAML blocks to the routing ledger automatically — no extra steps needed. Both outcomes (winner AND loser) are recorded to the ledger. Adjudication events are the highest-value ledger entries because they are direct A/B comparisons on identical inputs — the loser's outcome is as valuable as the winner's for routing calibration.
i. Parse the winner's persona-result YAML into \`$OPENRALPH_SESSION_DIR/persona-result.yml\`, update \`progress.md\` and \`queue.md\` as usual, then resume the outer scheduler loop at the next queue item.

9. Before writing \`goal.json.status\` to \`complete\` or \`completed\`, dispatch \`openralph-checker\` via the Agent tool. Pass in the dispatch context: the goal condition text, the proof_command (or null), \`worker_model\` set to the \`provider_model_used\` value from the most recent worker persona result, and the \`task_slug\` from the most recent worker dispatch. The checker MUST echo this exact task_slug in its verdict YAML — the routing ledger joins checker verdicts to worker rows by matching task_slug (see step 4). The checker MUST use a different provider and model family than worker_model — instruct it explicitly: "Do not use [worker_model provider]. Use a model from a different provider." Only mark goal.json complete if the checker's returned YAML has \`goal_met: true\`. If the checker returns \`goal_met: false\`, extract its \`gaps\` list and push each gap as a new queue item before continuing the loop. The checker's YAML verdict carries \`task_slug\`, \`provider_model_used\`, and \`status: complete\` (indicating the check itself ran) so the routing ledger automatically records the verification dispatch via the PostToolUse hook.
10. Stop only when \`goal.json.status\` is \`complete\` and the proof is visible in \`progress.md\`.

The Stop hook records session bridges and blocks a stop while the active session's \`goal.json.status\` is still running, so future turns resume from session-scoped OpenRalph files instead of relying on memory.

11. **Adopting an orphaned session:** When engaging into a repo that has orphaned sessions (sessions in \`.limitless/ralph/sessions/\` whose \`session.json.status\` is not \`complete\` or \`disengaged\`, and which are not the current active session of a live loop), the scheduler MAY adopt one via \`bash .limitless/ralph/bin/openralph-adopt.sh <orphan_session_id>\` instead of starting fresh. The adopt script copies the orphan's \`session.json\`, \`goal.json\`, \`queue.md\`, and \`progress.md\` into a new session directory without touching the originals, records the adoption in the new session's \`lineage\` field (composing any ancestor chain the orphan already carried), and updates the \`active-session\` pointer to the new session. The adopted \`progress.md\` and \`queue.md\` are authoritative history — treat their completed and in-flight entries as ground truth rather than re-deriving task state from scratch.`
}

function buildStatusPrompt(): string {
  return `# /openralph-status

Run \`bash .limitless/ralph/bin/openralph-status.sh\` if it exists.

Then report:
- whether OpenRalph is enabled
- current session id, mode, iteration, and status
- current goal condition and proof command
- top queue item
- in-flight, completed, and blocked entries
- most recent hook bridge event
- top routing stats (run \`bash .limitless/ralph/bin/openralph-route-stats.sh\`)

If support files are missing, inspect \`.limitless/ralph/active-session\` and \`.limitless/ralph/sessions/<session_id>/\` directly and report what exists.`
}

function buildResumePrompt(): string {
  return `# /openralph-resume

Resume an existing OpenRalph workstream.

1. Resolve the session id from \`.limitless/ralph/active-session\` unless the user names a session explicitly.
2. Inspect \`.limitless/ralph/sessions/<session_id>/session.json\`, \`goal.json\`, \`queue.md\`, \`progress.md\`, \`current-task.md\`, \`persona-result.yml\`, and recent \`events.jsonl\`.
3. If \`.limitless/ralph/enabled\` is missing, recreate it unless that session status is \`disengaged\`.
4. Reinstall or verify the project hooks in \`.claude/settings.local.json\`.
5. Pick the next unfinished queue item, write a focused \`current-task.md\` inside that session directory, dispatch the matching OpenRalph persona agent, and continue the scheduler loop.
6. Update that session's \`goal.json\` only when the completion condition has visible proof.`
}

function buildDisengagePrompt(): string {
  return `# /openralph-disengage

Run \`bash .limitless/ralph/bin/openralph-disengage.sh\` if it exists.

Then write a concise handoff into the target session's \`progress.md\` with:
- why the session was disengaged
- last completed task
- next recommended task
- verification state

Do not delete OpenRalph state files.`
}

function buildKickPrompt(args: string): string {
  const trimmed = args.trim()
  const suffix = trimmed ? ` ${trimmed}` : ' --session <session_id_or_prefix>'

  return `# /openralph-kick

Force OpenRalph loop state for a specific session from the project-local support script.

Run:

\`\`\`bash
bash .limitless/ralph/bin/openralph-kick.sh${suffix}
\`\`\`

Use this when a slash command was typed but the loop did not actually engage, or when a separate terminal needs to reactivate a session by id. For existing state, the script sets \`.limitless/ralph/active-session\`, touches \`.limitless/ralph/enabled\`, writes \`kick.json\`, and appends \`kick-log.jsonl\`/project events. For missing state, rerun with \`--prompt\` or \`--prompt-file\` so \`openralph-bootstrap.sh\` can create a concrete session objective.

Lifecycle verb reference: kick = shell-level re-entry markers for a loop that never started or whose hook never fired; resume = model-driven continuation of a loop that ran and has existing session state; disengage = close the loop and preserve its state for future reference.`
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

  registerBundledSkill({
    name: 'openralph-kick',
    aliases: ['ralph-kick', 'openralph-force'],
    description: 'Force or bootstrap OpenRalph scheduler state for a specific session id.',
    whenToUse:
      'When the user typed a Ralph/OpenRalph slash command but the loop did not engage, or wants a separate terminal to target a session id.',
    argumentHint: '--session <id-or-prefix> [--prompt objective]',
    userInvocable: true,
    async getPromptForCommand(args) {
      return [{ type: 'text', text: buildKickPrompt(args) }]
    },
  })
}
