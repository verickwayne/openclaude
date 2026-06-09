// src/services/api/resolvedProvider.test.ts
import { expect, test } from 'bun:test'
import {
  type ResolvedProvider,
  firstPartyResolvedProvider,
  resolvedProviderFromProfile,
} from './resolvedProvider.js'

test('firstPartyResolvedProvider describes the native Anthropic route', () => {
  const rp = firstPartyResolvedProvider('claude-opus-4-8')
  expect(rp.kind).toBe('anthropic-native')
  expect(rp.profileId).toBe('first-party')
  expect(rp.model).toBe('claude-opus-4-8')
})

test('resolvedProviderFromProfile maps an OpenAI-compatible profile', () => {
  const rp = resolvedProviderFromProfile(
    {
      id: 'p1',
      name: 'OpenRouter',
      provider: 'openai',
      baseUrl: 'https://openrouter.ai/api/v1',
      model: 'openai/gpt-5.5',
      apiKey: 'sk-test',
    } as any,
    'openai/gpt-5.5',
  )
  expect(rp.kind).toBe('openai-compatible')
  expect(rp.baseURL).toBe('https://openrouter.ai/api/v1')
  expect(rp.apiKey).toBe('sk-test')
  expect(rp.model).toBe('openai/gpt-5.5')
})

test('resolvedProviderFromProfile maps a Claude Max proxy profile to anthropic-proxy', () => {
  const rp = resolvedProviderFromProfile(
    {
      id: 'p2',
      name: 'Anthropic (Subscription)',
      provider: 'anthropic',
      baseUrl: 'http://127.0.0.1:8031',
      model: 'claude-sonnet-4-5',
    } as any,
    'claude-sonnet-4-5',
  )
  expect(rp.kind).toBe('anthropic-proxy')
  expect(rp.baseURL).toBe('http://127.0.0.1:8031')
})

import { enrichWithStoredCredentials } from './resolvedProvider.js'

test('Codex OAuth profile gets its access token + account id injected', () => {
  const base = {
    profileId: 'p3', kind: 'openai-compatible' as const,
    model: 'codexplan', baseURL: 'https://chatgpt.com/backend-api/codex',
  }
  const enriched = enrichWithStoredCredentials(base, {
    readCodex: () => ({ accessToken: 'tok-123', accountId: 'acct-9', refreshToken: 'r' }),
  })
  expect(enriched.oauthAccessToken).toBe('tok-123')
})
