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

PROMPT="$(cat "$PROMPT_FILE")"
rm -f "$PROMPT_FILE"
NOW="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
START_COMMIT="$(git rev-parse HEAD 2>/dev/null || true)"
export SESSION_ID PROJECT_ROOT MODE MAX_ITERATIONS NOW START_COMMIT PROMPT COMPLETION_CONDITION PROOF_COMMAND

touch "$RALPH_DIR/enabled"

python3 - "$RALPH_DIR/session.json" "$SESSION_DIR/$SESSION_ID.json" <<'PY'
import json, os, sys
state_path, session_path = sys.argv[1], sys.argv[2]
data = {
  "session_id": os.environ["SESSION_ID"],
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
for path in (state_path, session_path):
  with open(path, "w", encoding="utf-8") as f:
    json.dump(data, f, indent=2)
    f.write("\\n")
PY

if [[ ! -f "$RALPH_DIR/goal.json" ]]; then
  python3 - "$RALPH_DIR/goal.json" <<'PY'
import json, os, sys
goal = {
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

if [[ ! -f "$RALPH_DIR/queue.md" ]]; then
  cat > "$RALPH_DIR/queue.md" <<'EOF'
# OpenRalph Queue

1. Derive the first atomic task from session.json and write it to current-task.md.
EOF
fi

if [[ ! -f "$RALPH_DIR/progress.md" ]]; then
  cat > "$RALPH_DIR/progress.md" <<'EOF'
# OpenRalph Progress

## In Flight

_(empty)_

## Completed

_(empty)_

## Blocked

_(empty)_
EOF
fi

cat > "$RALPH_DIR/current-task.md" <<'EOF'
# Current OpenRalph Task

_(scheduler has not dispatched a task yet)_
EOF

cat > "$RALPH_DIR/persona-result.yml" <<'EOF'
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
    echo ".openclaude/ralph/bridges/"
    echo ".openclaude/ralph/events.jsonl"
    echo ".openclaude/ralph/logs/"
    echo ".openclaude/ralph/session.json"
    echo ".openclaude/ralph/current-task.md"
    echo ".openclaude/ralph/persona-result.yml"
  } >> .gitignore
fi

echo "OpenRalph engaged"
echo "Session: $SESSION_ID"
echo "Mode: $MODE"
echo "State: $RALPH_DIR/session.json"
echo "Goal: $RALPH_DIR/goal.json"
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
export SESSION_ID EVENT TOOL_NAME CWD_VALUE TRANSCRIPT

python3 - "$RALPH_DIR/bridges/$SESSION_ID.json" "$RALPH_DIR/events.jsonl" <<'PY'
import json, os, sys, time
bridge_path, log_path = sys.argv[1], sys.argv[2]
event = {
  "ts": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
  "session_id": os.environ.get("SESSION_ID"),
  "event": os.environ.get("EVENT") or "unknown",
  "tool_name": os.environ.get("TOOL_NAME") or None,
  "cwd": os.environ.get("CWD_VALUE") or None,
  "transcript_path": os.environ.get("TRANSCRIPT") or None,
}
with open(bridge_path, "w", encoding="utf-8") as f:
  json.dump(event, f, indent=2)
  f.write("\\n")
with open(log_path, "a", encoding="utf-8") as f:
  f.write(json.dumps(event, separators=(",", ":")) + "\\n")
PY

if [[ "$EVENT" == "Stop" && -f "$RALPH_DIR/goal.json" ]]; then
  STATUS="$(python3 - "$RALPH_DIR/goal.json" <<'PY'
import json, sys
try:
  print(json.load(open(sys.argv[1], encoding="utf-8")).get("status", "running"))
except Exception:
  print("running")
PY
)"
  if [[ "$STATUS" != "complete" && "$STATUS" != "completed" ]]; then
    cat <<'JSON'
{"decision":"block","reason":"OpenRalph goal is still running. Read .openclaude/ralph/session.json, .openclaude/ralph/goal.json, queue.md, progress.md, and current-task.md; then continue the next unfinished task and update the OpenRalph files before stopping again."}
JSON
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
echo "== OpenRalph =="
[[ -f "$RALPH_DIR/enabled" ]] && echo "enabled: true" || echo "enabled: false"
for file in session.json goal.json; do
  if [[ -f "$RALPH_DIR/$file" ]]; then
    echo "-- $file --"
    python3 -m json.tool "$RALPH_DIR/$file" 2>/dev/null || cat "$RALPH_DIR/$file"
  fi
done
echo "-- queue --"
sed -n '1,80p' "$RALPH_DIR/queue.md" 2>/dev/null || true
echo "-- progress --"
sed -n '1,120p' "$RALPH_DIR/progress.md" 2>/dev/null || true
echo "-- recent hook events --"
tail -20 "$RALPH_DIR/events.jsonl" 2>/dev/null || true
`

const OPENRALPH_DISENGAGE_SH = `#!/usr/bin/env bash
set -euo pipefail
RALPH_DIR="$(pwd)/.openclaude/ralph"
if [[ ! -d "$RALPH_DIR" ]]; then
  echo "No OpenRalph state in $(pwd)"
  exit 0
fi
rm -f "$RALPH_DIR/enabled"
python3 - "$RALPH_DIR/session.json" <<'PY'
import json, sys, time
path = sys.argv[1]
try:
  data = json.load(open(path, encoding="utf-8"))
except Exception:
  data = {}
data["status"] = "disengaged"
data["updated_at"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
with open(path, "w", encoding="utf-8") as f:
  json.dump(data, f, indent=2)
  f.write("\\n")
PY
echo "OpenRalph disengaged. State preserved at $RALPH_DIR"
`

const OPENRALPH_README = `# OpenRalph Support Files

OpenRalph is a project-local scheduler pattern for OpenClaude.

It combines:
- Ralph-style session bridges and hook events
- a goal condition checked after turns through the Stop hook
- persona dispatch through built-in OpenRalph agents
- provider/model routing notes in each persona result

Installed project state lives in \`.openclaude/ralph/\`.
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

1. Keep \`.openclaude/ralph/goal.json\` as the completion condition. Make it concrete and verifiable.
2. Keep \`.openclaude/ralph/queue.md\` as the ordered atomic-task source of truth.
3. Before each dispatch, write one task brief to \`.openclaude/ralph/current-task.md\`.
4. Dispatch one of these built-in agents with the Agent tool:
   - \`openralph-builder\` for implementation
   - \`openralph-refiner\` for completeness and edge cases
   - \`openralph-researcher\` for bounded external or repo research
   - \`openralph-test-analyzer\` for failed test diagnosis
5. Parse the returned YAML into \`.openclaude/ralph/persona-result.yml\`.
6. Update \`progress.md\`, \`queue.md\`, and \`goal.json\`.
7. Use the model/provider picker deliberately: fast models for search/status, strongest available model for architecture or risky edits, local models for offline mechanical tasks.
8. Stop only when \`goal.json.status\` is \`complete\` and the proof is visible in \`progress.md\`.

The Stop hook records session bridges and blocks a stop while \`goal.json.status\` is still running, so future turns resume from the OpenRalph files instead of relying on memory.`
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

If support files are missing, inspect \`.openclaude/ralph/\` directly and report what exists.`
}

function buildResumePrompt(): string {
  return `# /openralph-resume

Resume an existing OpenRalph workstream.

1. Inspect \`.openclaude/ralph/session.json\`, \`goal.json\`, \`queue.md\`, \`progress.md\`, \`current-task.md\`, \`persona-result.yml\`, and recent \`events.jsonl\`.
2. If \`.openclaude/ralph/enabled\` is missing, recreate it unless the session status is \`disengaged\`.
3. Reinstall or verify the project hooks in \`.claude/settings.local.json\`.
4. Pick the next unfinished queue item, write a focused \`current-task.md\`, dispatch the matching OpenRalph persona agent, and continue the scheduler loop.
5. Update \`goal.json\` only when the completion condition has visible proof.`
}

function buildDisengagePrompt(): string {
  return `# /openralph-disengage

Run \`bash .openclaude/ralph/bin/openralph-disengage.sh\` if it exists.

Then write a concise handoff into \`.openclaude/ralph/progress.md\` with:
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
