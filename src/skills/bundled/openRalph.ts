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
mkdir -p "$SESSION_DIR" "$RALPH_DIR/bridges" "$RALPH_DIR/logs"

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

if [[ -f .gitignore ]] && ! grep -q '^\\.openclaude/ralph/events\\.jsonl$' .gitignore; then
  {
    echo ""
    echo "# OpenRalph local scheduler state"
    echo ".openclaude/ralph/enabled"
    echo ".openclaude/ralph/active-session"
    echo ".openclaude/ralph/active-session.json"
    echo ".openclaude/ralph/bridges/"
    echo ".openclaude/ralph/events.jsonl"
    echo ".openclaude/ralph/logs/"
    echo ".openclaude/ralph/sessions/"
  } >> .gitignore
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
ACTIVE_STATE_DIR="$RALPH_DIR/sessions/$ACTIVE_SESSION"
if [[ ! -d "$SESSION_STATE_DIR" && -n "$ACTIVE_SESSION" && -d "$ACTIVE_STATE_DIR" ]]; then
  SESSION_STATE_DIR="$ACTIVE_STATE_DIR"
fi
mkdir -p "$SESSION_STATE_DIR"
export SESSION_ID SESSION_STATE_DIR EVENT TOOL_NAME CWD_VALUE TRANSCRIPT

python3 - "$RALPH_DIR/bridges/$SESSION_ID.json" "$RALPH_DIR/events.jsonl" "$SESSION_STATE_DIR/events.jsonl" <<'PY'
import json, os, sys, time
bridge_path, project_log_path, session_log_path = sys.argv[1], sys.argv[2], sys.argv[3]
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
for path in (project_log_path, session_log_path):
  with open(path, "a", encoding="utf-8") as f:
    f.write(json.dumps(event, separators=(",", ":")) + "\\n")
PY

if [[ "$EVENT" == "Stop" && -f "$SESSION_STATE_DIR/goal.json" ]]; then
  STATUS="$(python3 - "$SESSION_STATE_DIR/goal.json" <<'PY'
import json, sys
try:
  print(json.load(open(sys.argv[1], encoding="utf-8")).get("status", "running"))
except Exception:
  print("running")
PY
)"
  if [[ "$STATUS" != "complete" && "$STATUS" != "completed" ]]; then
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

const OPENRALPH_FILES = {
  'bin/openralph-bootstrap.sh': OPENRALPH_BOOTSTRAP_SH,
  'bin/openralph-hook.sh': OPENRALPH_HOOK_SH,
  'bin/openralph-status.sh': OPENRALPH_STATUS_SH,
  'bin/openralph-disengage.sh': OPENRALPH_DISENGAGE_SH,
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
8. Use the model/provider picker deliberately: fast models for search/status, strongest available model for architecture or risky edits, local models for offline mechanical tasks.
9. Stop only when \`goal.json.status\` is \`complete\` and the proof is visible in \`progress.md\`.

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
