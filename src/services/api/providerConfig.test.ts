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
