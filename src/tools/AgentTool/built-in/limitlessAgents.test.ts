import { expect, test } from 'bun:test'

import { LIMITLESS_AGENTS } from './limitlessAgents.js'

test('Limitless built-in agent team is available with expected roles', () => {
  const names = LIMITLESS_AGENTS.map(agent => agent.agentType)

  expect(names).toEqual([
    'limitless-founder-os',
    'limitless-strategy',
    'limitless-finance',
    'limitless-product',
    'limitless-gtm',
    'limitless-ops',
    'limitless-integrations',
    'limitless-eng-lead',
    'limitless-designer',
    'limitless-debugger',
    'limitless-qa',
    'limitless-reviewer',
    'limitless-docs-release',
    'limitless-harness-improver',
  ])
})

test('Limitless agents emit structured routing metadata', () => {
  for (const agent of LIMITLESS_AGENTS) {
    const prompt = agent.getSystemPrompt({ toolUseContext: { options: {} } })
    expect(prompt).toContain('Limitless')
    expect(prompt).toContain('provider_model_used')
    expect(prompt).toContain('```yaml')
  }
})

test('integration agent is optimized for MCP and tool-call workflows', () => {
  const integrations = LIMITLESS_AGENTS.find(
    agent => agent.agentType === 'limitless-integrations',
  )
  expect(integrations).toBeDefined()
  const prompt = integrations!.getSystemPrompt({
    toolUseContext: { options: {} },
  })
  expect(prompt).toContain('MCP')
  expect(prompt).toContain('Gmail')
  expect(prompt).toContain('tool calls')
  expect(prompt).toContain('additionalProperties: false')
})

test('harness improver is transcript-aware and proposal-oriented', () => {
  const improver = LIMITLESS_AGENTS.find(
    agent => agent.agentType === 'limitless-harness-improver',
  )
  expect(improver).toBeDefined()
  const prompt = improver!.getSystemPrompt({ toolUseContext: { options: {} } })
  expect(prompt).toContain('transcripts')
  expect(prompt).toContain('.limitless/improvement/backlog.md')
  expect(prompt).toContain('Do not edit product/harness code')
  expect(prompt).toContain('outcome ledgers')
  expect(prompt).toContain('mcp-proposals')
  expect(prompt).toContain('Gmail')
})
