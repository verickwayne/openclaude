import { expect, test } from 'bun:test'
import { shouldUseFirstPartyAnthropicAuthForProvider } from './authRouting.js'
import type { ResolvedProvider } from './resolvedProvider.js'

test('an openai-compatible override disables first-party auth', () => {
  const override: ResolvedProvider = {
    profileId: 'p1',
    kind: 'openai-compatible',
    model: 'gpt-5.5',
    baseURL: 'https://openrouter.ai/api/v1',
    apiKey: 'sk',
  }
  expect(
    shouldUseFirstPartyAnthropicAuthForProvider({
      providerOverride: override,
      apiProvider: 'firstParty',
    }),
  ).toBe(false)
})

test('an anthropic-native override keeps first-party auth ON', () => {
  const override: ResolvedProvider = {
    profileId: 'first-party',
    kind: 'anthropic-native',
    model: 'claude-opus-4-8',
  }
  expect(
    shouldUseFirstPartyAnthropicAuthForProvider({
      providerOverride: override,
      apiProvider: 'openai', // even when global env is OpenAI
    }),
  ).toBe(true)
})

test('an anthropic-proxy override keeps first-party auth ON', () => {
  const override: ResolvedProvider = {
    profileId: 'p',
    kind: 'anthropic-proxy',
    model: 'claude-sonnet-4-5',
    baseURL: 'http://127.0.0.1:8031',
  }
  expect(
    shouldUseFirstPartyAnthropicAuthForProvider({
      providerOverride: override,
      apiProvider: 'openai',
    }),
  ).toBe(true)
})
