// src/commands/model/multiProvider.test.ts
import { expect, test } from 'bun:test'
import { buildMultiProviderOptionsOverride } from './model.js'

test('returns an override list when >1 provider is logged in', () => {
  const override = buildMultiProviderOptionsOverride({
    firstPartyOptions: [{ value: 'claude-opus-4-8', label: 'Opus 4.8', description: '' }],
    profiles: [
      { id: 'p1', name: 'OpenRouter', provider: 'openai', baseUrl: 'u', model: 'openai/gpt-5.5' },
    ] as any[],
  })
  expect(override?.some(o => o.value === 'openai/gpt-5.5')).toBe(true)
  expect(override?.some(o => o.value === 'claude-opus-4-8')).toBe(true)
})
