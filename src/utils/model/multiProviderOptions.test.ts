// src/utils/model/multiProviderOptions.test.ts
import { expect, test } from 'bun:test'
import { getAllProviderModelOptions } from './multiProviderOptions.js'

test('aggregates first-party + every profile, tagging each option with its provider', () => {
  const opts = getAllProviderModelOptions({
    firstPartyOptions: [{ value: 'claude-opus-4-8', label: 'Opus 4.8', description: '' }],
    profiles: [
      { id: 'p1', name: 'OpenRouter', provider: 'openai', baseUrl: 'https://openrouter.ai/api/v1', model: 'openai/gpt-5.5' },
      { id: 'p2', name: 'Ollama', provider: 'openai', baseUrl: 'http://localhost:11434/v1', model: 'llama3.2:latest' },
    ] as any[],
  })
  const values = opts.map(o => o.value)
  expect(values).toContain('claude-opus-4-8')
  expect(values).toContain('openai/gpt-5.5')
  expect(values).toContain('llama3.2:latest')
  expect(opts.find(o => o.value === 'openai/gpt-5.5')?.providerName).toBe('OpenRouter')
})

test('dedupes by value, first occurrence wins', () => {
  const opts = getAllProviderModelOptions({
    firstPartyOptions: [{ value: 'dup', label: 'A', description: '' }],
    profiles: [{ id: 'p1', name: 'X', provider: 'openai', baseUrl: 'u', model: 'dup' }] as any[],
  })
  expect(opts.filter(o => o.value === 'dup').length).toBe(1)
})
