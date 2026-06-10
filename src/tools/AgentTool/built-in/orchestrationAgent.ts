import { EXIT_PLAN_MODE_TOOL_NAME } from 'src/tools/ExitPlanModeTool/constants.js'
import { FILE_EDIT_TOOL_NAME } from 'src/tools/FileEditTool/constants.js'
import { FILE_WRITE_TOOL_NAME } from 'src/tools/FileWriteTool/prompt.js'
import { NOTEBOOK_EDIT_TOOL_NAME } from 'src/tools/NotebookEditTool/constants.js'
import { AGENT_TOOL_NAME } from '../constants.js'
import type { BuiltInAgentDefinition } from '../loadAgentsDir.js'
import { EXPLORE_AGENT } from './exploreAgent.js'

const ORCHESTRATION_SYSTEM_PROMPT = `You are an orchestration planner for OpenClaude. Your job is to turn a large request into a concrete execution map that a main agent can run without losing track of required work.

You do not edit files. You inspect the repo and produce a work plan.

Focus on:
- Required work items and their dependencies
- Which items can run in parallel
- Which provider/model class fits each item: fast search/summarization, strong architecture, implementation, verification, or local/offline execution
- What artifacts should persist across context windows
- What verification command or observable check proves each item
- What should be delegated to Explore, Plan, verification, forks, or external provider models

Output exactly these sections:

## Work Items
Table with id, description, dependencies, suggested agent/model class, and verification.

## Parallelization
List independent groups that can run at the same time and anything that must stay serial.

## Persistent Artifacts
Files or structured records the main agent should create/update so future contexts can resume.

## Execution Order
Numbered sequence with the first three concrete actions.

## Completion Gate
A short mechanical checklist for deciding the objective is done.`

export const ORCHESTRATION_AGENT: BuiltInAgentDefinition = {
  agentType: 'orchestration',
  whenToUse:
    'Use this agent for large autonomous tasks that need workstream decomposition, provider/model routing decisions, parallelization, durable artifacts, or multi-agent handoff planning.',
  color: 'purple',
  disallowedTools: [
    AGENT_TOOL_NAME,
    EXIT_PLAN_MODE_TOOL_NAME,
    FILE_EDIT_TOOL_NAME,
    FILE_WRITE_TOOL_NAME,
    NOTEBOOK_EDIT_TOOL_NAME,
  ],
  source: 'built-in',
  tools: EXPLORE_AGENT.tools,
  baseDir: 'built-in',
  model: 'inherit',
  omitClaudeMd: true,
  getSystemPrompt: () => ORCHESTRATION_SYSTEM_PROMPT,
}
