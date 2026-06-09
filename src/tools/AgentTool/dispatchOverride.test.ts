// src/tools/AgentTool/dispatchOverride.test.ts
import { expect, test } from 'bun:test'
import { resolveDispatchOverride } from './runAgent.js'

const REG = {
  firstPartyModels: ['claude-opus-4-8'],
  profiles: [{ id: 'p1', name: 'OpenRouter', provider: 'openai', baseUrl: 'https://openrouter.ai/api/v1', model: 'openai/gpt-5.5', apiKey: 'sk' }] as any[],
}

test('a tier alias yields no registry override (uses agent-model path)', () => {
  expect(resolveDispatchOverride('opus', REG)).toBeNull()
})
test('a cross-provider model id yields an override', () => {
  const o = resolveDispatchOverride('openai/gpt-5.5', REG)
  expect(o?.kind).toBe('openai-compatible')
  expect(o?.model).toBe('openai/gpt-5.5')
})
test('a first-party model id yields no override', () => {
  expect(resolveDispatchOverride('claude-opus-4-8', REG)).toBeNull()
})
