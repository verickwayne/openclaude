import { expect, test } from 'bun:test'
import { resolveProviderRequest } from './providerConfig.js'

test('explicit apiFormat from an override wins over env', () => {
  const r = resolveProviderRequest({
    model: 'gpt-5.5',
    baseUrl: 'https://x/v1',
    apiFormat: 'responses',
  })
  expect(r.transport).not.toBe('chat_completions')
})

test('local OpenAI-compatible endpoints suppress reasoning effort', () => {
  const r = resolveProviderRequest({
    model: 'gpt-5.5',
    baseUrl: 'http://localhost:11434/v1',
    reasoningEffortOverride: 'high',
  })

  expect(r.baseUrl).toBe('http://localhost:11434/v1')
  expect(r.reasoning).toBeUndefined()
})
