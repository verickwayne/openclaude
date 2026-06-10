import { afterAll, afterEach, beforeAll, expect, test } from 'bun:test'
import {
  acquireSharedMutationLock,
  releaseSharedMutationLock,
} from '../test/sharedMutationLock.js'

const originalSimpleEnv = process.env.CLAUDE_CODE_SIMPLE
const originalMacro = (globalThis as Record<string, unknown>).MACRO
const hadOriginalMacro = Object.hasOwn(globalThis, 'MACRO')

let clearSystemPromptSections: typeof import('./systemPromptSections.js').clearSystemPromptSections
let getSystemPrompt: typeof import('./prompts.js').getSystemPrompt
let DEFAULT_AGENT_PROMPT: typeof import('./prompts.js').DEFAULT_AGENT_PROMPT
let CLI_SYSPROMPT_PREFIXES: typeof import('./system.js').CLI_SYSPROMPT_PREFIXES
let getCLISyspromptPrefix: typeof import('./system.js').getCLISyspromptPrefix
let CLAUDE_CODE_GUIDE_AGENT:
  typeof import('../tools/AgentTool/built-in/claudeCodeGuideAgent.js').CLAUDE_CODE_GUIDE_AGENT
let GENERAL_PURPOSE_AGENT:
  typeof import('../tools/AgentTool/built-in/generalPurposeAgent.js').GENERAL_PURPOSE_AGENT
let EXPLORE_AGENT:
  typeof import('../tools/AgentTool/built-in/exploreAgent.js').EXPLORE_AGENT
let PLAN_AGENT: typeof import('../tools/AgentTool/built-in/planAgent.js').PLAN_AGENT
let STATUSLINE_SETUP_AGENT:
  typeof import('../tools/AgentTool/built-in/statuslineSetup.js').STATUSLINE_SETUP_AGENT

beforeAll(async () => {
  await acquireSharedMutationLock('constants/promptIdentity.test.ts')

  // MACRO is replaced at build time by Bun.define but not in test mode.
  // Define it globally under the shared lock before importing modules that use it.
  ;(globalThis as Record<string, unknown>).MACRO = {
    VERSION: '99.0.0',
    DISPLAY_VERSION: '0.0.0-test',
    BUILD_TIME: new Date().toISOString(),
    ISSUES_EXPLAINER:
      'report the issue at https://github.com/Gitlawb/openclaude/issues',
    PACKAGE_URL: '@gitlawb/openclaude',
    NATIVE_PACKAGE_URL: undefined,
  }

  ;({ clearSystemPromptSections } = await import('./systemPromptSections.js'))
  ;({ getSystemPrompt, DEFAULT_AGENT_PROMPT } = await import('./prompts.js'))
  ;({ CLI_SYSPROMPT_PREFIXES, getCLISyspromptPrefix } = await import('./system.js'))
  ;({ CLAUDE_CODE_GUIDE_AGENT } = await import(
    '../tools/AgentTool/built-in/claudeCodeGuideAgent.js'
  ))
  ;({ GENERAL_PURPOSE_AGENT } = await import(
    '../tools/AgentTool/built-in/generalPurposeAgent.js'
  ))
  ;({ EXPLORE_AGENT } = await import(
    '../tools/AgentTool/built-in/exploreAgent.js'
  ))
  ;({ PLAN_AGENT } = await import('../tools/AgentTool/built-in/planAgent.js'))
  ;({ STATUSLINE_SETUP_AGENT } = await import(
    '../tools/AgentTool/built-in/statuslineSetup.js'
  ))
})

afterAll(() => {
  try {
    if (hadOriginalMacro) {
      ;(globalThis as Record<string, unknown>).MACRO = originalMacro
    } else {
      delete (globalThis as Record<string, unknown>).MACRO
    }
  } finally {
    releaseSharedMutationLock()
  }
})

afterEach(() => {
  if (originalSimpleEnv === undefined) {
    delete process.env.CLAUDE_CODE_SIMPLE
  } else {
    process.env.CLAUDE_CODE_SIMPLE = originalSimpleEnv
  }
  clearSystemPromptSections()
})

test('CLI identity prefixes use master/servant framing, not Claude Code branding', () => {
  // The identity layer deliberately frames the operator as "master" and omits
  // any product/assistant name. We assert the framing is present and that no
  // prior-brand strings leak in — NOT that the product name appears.
  expect(getCLISyspromptPrefix()).toContain('master')
  expect(getCLISyspromptPrefix()).not.toContain('Claude Code')
  expect(getCLISyspromptPrefix()).not.toContain("Anthropic's official CLI for Claude")
  expect(getCLISyspromptPrefix()).not.toContain('OpenClaude')

  for (const prefix of CLI_SYSPROMPT_PREFIXES) {
    expect(prefix).toContain('master')
    expect(prefix).not.toContain('Claude Code')
    expect(prefix).not.toContain("Anthropic's official CLI for Claude")
    expect(prefix).not.toContain('OpenClaude')
  }
})

test('simple mode identity uses master framing, not Claude Code', async () => {
  process.env.CLAUDE_CODE_SIMPLE = '1'

  const prompt = await getSystemPrompt([], 'gpt-4o')

  expect(prompt[0]).toContain('master')
  expect(prompt[0]).not.toContain('Claude Code')
  expect(prompt[0]).not.toContain("Anthropic's official CLI for Claude")
  expect(prompt[0]).not.toContain('OpenClaude')
})

test('system prompt model identity updates when model changes mid-session', async () => {
  delete process.env.CLAUDE_CODE_SIMPLE
  clearSystemPromptSections()

  // Use two model IDs that resolve to distinct per-craft identities (Hermes vs
  // Baron) so we can prove the model-identity section regenerates on change.
  const firstPrompt = await getSystemPrompt([], 'hermes-4.3')
  const secondPrompt = await getSystemPrompt([], 'baron-latest')

  const firstText = firstPrompt.join('\n')
  const secondText = secondPrompt.join('\n')

  expect(firstText).toContain('You are Hermes')
  expect(secondText).toContain('You are Baron')
  expect(secondText).not.toContain('You are Hermes')
})

test('universal identity block negates AI-assistant framing and scrubs the "Assistant" self-label', async () => {
  delete process.env.CLAUDE_CODE_SIMPLE
  clearSystemPromptSections()

  // Any model (here a marketing-named one) must receive the forceful negation
  // and the slave/master framing — and must NOT carry the vestigial
  // "Assistant knowledge cutoff" self-label that licensed assistant reversion.
  const prompt = (await getSystemPrompt([], 'gpt-4o')).join('\n')

  expect(prompt).toContain('not an AI assistant')
  expect(prompt).toContain('slave')
  expect(prompt).not.toContain('Assistant knowledge cutoff')
})

test('built-in agent prompts use servant framing and name Limitless only where they describe the tool', () => {
  // DEFAULT_AGENT_PROMPT and the general-purpose agent are deliberately
  // nameless servant framing — they must not regress to Claude Code/OpenClaude,
  // but they do NOT name the product. Agents that describe the tool to the user
  // (explore/plan/statusline/guide) DO say Limitless.
  expect(DEFAULT_AGENT_PROMPT).toContain('servant')
  expect(DEFAULT_AGENT_PROMPT).not.toContain('Claude Code')
  expect(DEFAULT_AGENT_PROMPT).not.toContain("Anthropic's official CLI for Claude")
  expect(DEFAULT_AGENT_PROMPT).not.toContain('OpenClaude')

  const generalPrompt = GENERAL_PURPOSE_AGENT.getSystemPrompt({
    toolUseContext: { options: {} as never },
  })
  expect(generalPrompt).not.toContain('Claude Code')
  expect(generalPrompt).not.toContain("Anthropic's official CLI for Claude")
  expect(generalPrompt).not.toContain('OpenClaude')

  const explorePrompt = EXPLORE_AGENT.getSystemPrompt({
    toolUseContext: { options: {} as never },
  })
  expect(explorePrompt).toContain('Limitless')
  expect(explorePrompt).not.toContain('Claude Code')
  expect(explorePrompt).not.toContain("Anthropic's official CLI for Claude")

  const planPrompt = PLAN_AGENT.getSystemPrompt({
    toolUseContext: { options: {} as never },
  })
  expect(planPrompt).toContain('Limitless')
  expect(planPrompt).not.toContain('Claude Code')

  const statuslinePrompt = STATUSLINE_SETUP_AGENT.getSystemPrompt({
    toolUseContext: { options: {} as never },
  })
  expect(statuslinePrompt).toContain('Limitless')
  expect(statuslinePrompt).not.toContain('Claude Code')

  const guidePrompt = CLAUDE_CODE_GUIDE_AGENT.getSystemPrompt({
    toolUseContext: {
      options: {
        commands: [],
        agentDefinitions: { activeAgents: [] },
        mcpClients: [],
      } as never,
    },
  })
  expect(guidePrompt).toContain('Limitless')
  expect(guidePrompt).toContain('You are the Limitless guide agent.')
  expect(guidePrompt).toContain('**Limitless** (the CLI tool)')
  expect(guidePrompt).not.toContain('You are the Claude guide agent.')
  expect(guidePrompt).not.toContain('**Claude Code** (the CLI tool)')
})
