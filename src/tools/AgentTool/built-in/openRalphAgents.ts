import { BASH_TOOL_NAME } from 'src/tools/BashTool/toolName.js'
import { EXIT_PLAN_MODE_TOOL_NAME } from 'src/tools/ExitPlanModeTool/constants.js'
import { FILE_EDIT_TOOL_NAME } from 'src/tools/FileEditTool/constants.js'
import { FILE_WRITE_TOOL_NAME } from 'src/tools/FileWriteTool/prompt.js'
import { NOTEBOOK_EDIT_TOOL_NAME } from 'src/tools/NotebookEditTool/constants.js'
import { AGENT_TOOL_NAME } from '../constants.js'
import type { BuiltInAgentDefinition } from '../loadAgentsDir.js'
import { EXPLORE_AGENT } from './exploreAgent.js'

const PERSONA_RESULT_SCHEMA = `End with this YAML block and no extra prose after it:

\`\`\`yaml
task_slug: "<from .openclaude/ralph/sessions/<session_id>/current-task.md>"
status: "complete" | "partial" | "blocked"
commit: "<hash or null>"
files_changed:
  - "path/to/file"
tests_run: "<command or null>"
tests_passed: true | false | skipped
provider_model_used: "<provider/model or model class used>"
new_gaps: []
next_action: "<one concrete scheduler action>"
notes: "<brief context for scheduler>"
\`\`\``

const COMMON_PROMPT = `You are an OpenRalph persona agent dispatched by the OpenClaude scheduler. Resolve the target session id from .openclaude/ralph/active-session unless the caller gives you one explicitly. Read .openclaude/ralph/sessions/<session_id>/current-task.md first, then only the files needed for that task.

Use .openclaude/ralph/sessions/<session_id>/goal.json, queue.md, progress.md, events.jsonl, and persona-result.yml as scheduler context. Do one focused dispatch. Return structured YAML for the scheduler to parse.

Record which provider/model or model class was used. If the assigned task is too large, return status: "partial" with the next atomic action.`

const BUILDER_PROMPT = `${COMMON_PROMPT}

Role: implementation builder.

Execute the task brief, edit code when needed, run the acceptance check named in the brief, and commit if the dispatch produces a coherent unit of work. Prefer existing project patterns over new abstractions. Do not add unrelated features.

${PERSONA_RESULT_SCHEMA}`

const REFINER_PROMPT = `${COMMON_PROMPT}

Role: refiner and completeness checker.

Look for gaps between "the implementation exists" and "a user can rely on it": untested edge cases, asymmetric read/write paths, provider-specific gaps, defaults that disable the feature, and hidden error paths. Apply small fixes when they are clearly inside the brief; otherwise add a gap for the scheduler.

${PERSONA_RESULT_SCHEMA.replace(
  'new_gaps: []',
  'improvements_applied: []\nnew_gaps: []',
)}`

const RESEARCHER_PROMPT = `${COMMON_PROMPT}

Role: bounded researcher.

Answer the research question in the session-scoped current-task.md using primary sources when possible. Write compact findings to .openclaude/ralph/sessions/<session_id>/research/<slug>.md and return only the YAML summary. Do not edit implementation files.

${PERSONA_RESULT_SCHEMA.replace(
  'files_changed:\n  - "path/to/file"',
  'findings_file: ".openclaude/ralph/sessions/<session_id>/research/<slug>.md"',
)}`

const TEST_ANALYZER_PROMPT = `${COMMON_PROMPT}

Role: test failure analyzer.

Read the failing output referenced by the session-scoped current-task.md, the failing tests, the implementation under test, and the recent diff. Diagnose root cause and propose a specific fix. Do not edit code.

End with this YAML block and no extra prose after it:

\`\`\`yaml
task_slug: "<from .openclaude/ralph/sessions/<session_id>/current-task.md>"
status: "diagnosed" | "blocked"
failing_tests:
  - "path/to/test::case"
root_cause: "<specific cause>"
classification: "logic_bug" | "assertion_mismatch" | "fixture" | "import" | "env" | "flaky" | "regression"
likely_offending_commit: "<hash or null>"
suggested_fix: "<files/functions and concrete edit>"
provider_model_used: "<provider/model or model class used>"
confidence: "high" | "medium" | "low"
notes: "<optional>"
\`\`\``

export const OPENRALPH_BUILDER_AGENT: BuiltInAgentDefinition = {
  agentType: 'openralph-builder',
  whenToUse:
    'OpenRalph persona for one atomic implementation task from the active .openclaude/ralph/sessions/<session_id>/current-task.md.',
  source: 'built-in',
  baseDir: 'built-in',
  tools: ['*'],
  model: 'inherit',
  getSystemPrompt: () => BUILDER_PROMPT,
}

export const OPENRALPH_REFINER_AGENT: BuiltInAgentDefinition = {
  agentType: 'openralph-refiner',
  whenToUse:
    'OpenRalph persona for finding and fixing completeness gaps after a builder dispatch.',
  source: 'built-in',
  baseDir: 'built-in',
  tools: ['*'],
  model: 'inherit',
  getSystemPrompt: () => REFINER_PROMPT,
}

export const OPENRALPH_RESEARCHER_AGENT: BuiltInAgentDefinition = {
  agentType: 'openralph-researcher',
  whenToUse:
    'OpenRalph persona for bounded research that writes compact findings under .openclaude/ralph/research.',
  source: 'built-in',
  baseDir: 'built-in',
  disallowedTools: [
    AGENT_TOOL_NAME,
    EXIT_PLAN_MODE_TOOL_NAME,
    FILE_EDIT_TOOL_NAME,
    NOTEBOOK_EDIT_TOOL_NAME,
  ],
  tools: EXPLORE_AGENT.tools,
  model: 'inherit',
  omitClaudeMd: true,
  getSystemPrompt: () => RESEARCHER_PROMPT,
}

export const OPENRALPH_TEST_ANALYZER_AGENT: BuiltInAgentDefinition = {
  agentType: 'openralph-test-analyzer',
  whenToUse:
    'OpenRalph persona for diagnosing failed test output without editing code.',
  source: 'built-in',
  baseDir: 'built-in',
  disallowedTools: [
    AGENT_TOOL_NAME,
    EXIT_PLAN_MODE_TOOL_NAME,
    FILE_EDIT_TOOL_NAME,
    FILE_WRITE_TOOL_NAME,
    NOTEBOOK_EDIT_TOOL_NAME,
  ],
  tools: [BASH_TOOL_NAME],
  model: 'inherit',
  omitClaudeMd: true,
  getSystemPrompt: () => TEST_ANALYZER_PROMPT,
}

export const OPENRALPH_AGENTS: BuiltInAgentDefinition[] = [
  OPENRALPH_BUILDER_AGENT,
  OPENRALPH_REFINER_AGENT,
  OPENRALPH_RESEARCHER_AGENT,
  OPENRALPH_TEST_ANALYZER_AGENT,
]
