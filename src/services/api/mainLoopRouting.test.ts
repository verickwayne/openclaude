// src/services/api/mainLoopRouting.test.ts
import { expect, test } from 'bun:test'
import { resolveMainLoopOverride } from './claude.js'

const REG_INPUT = {
  firstPartyModels: ['claude-opus-4-8'],
  profiles: [
    { id: 'p1', name: 'OpenRouter', provider: 'openai', baseUrl: 'https://openrouter.ai/api/v1', model: 'openai/gpt-5.5', apiKey: 'sk' },
  ] as any[],
}

test('first-party model while global route IS first-party → no override (native path)', () => {
  expect(resolveMainLoopOverride('claude-opus-4-8', REG_INPUT, { globalRouteIsFirstParty: true })).toBeNull()
})

test('first-party model while global route is NOT first-party → anthropic-native override', () => {
  const o = resolveMainLoopOverride('claude-opus-4-8', REG_INPUT, { globalRouteIsFirstParty: false })
  expect(o?.kind).toBe('anthropic-native')
  expect(o?.model).toBe('claude-opus-4-8')
})

test('third-party model → openai-compatible override regardless of global route', () => {
  const o = resolveMainLoopOverride('openai/gpt-5.5', REG_INPUT, { globalRouteIsFirstParty: true })
  expect(o?.kind).toBe('openai-compatible')
  expect(o?.baseURL).toBe('https://openrouter.ai/api/v1')
  expect(o?.model).toBe('openai/gpt-5.5')
})

test('unknown model → null (fall back to default behavior)', () => {
  expect(resolveMainLoopOverride('mystery', REG_INPUT, { globalRouteIsFirstParty: true })).toBeNull()
})
