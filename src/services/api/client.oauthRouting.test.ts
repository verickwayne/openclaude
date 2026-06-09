import { expect, test } from 'bun:test'
import { shouldUseFirstPartyAnthropicAuthForProvider } from './authRouting.js'
import type { ResolvedProvider } from './resolvedProvider.js'

const providerOverride: ResolvedProvider = {
  profileId: 'p1',
  kind: 'openai-compatible',
  model: 'gpt-4o',
  baseURL: 'https://provider.example/v1',
  apiKey: 'provider-test-key',
}

test('Gemini provider routing does not use first-party Anthropic auth', () => {
  expect(
    shouldUseFirstPartyAnthropicAuthForProvider({
      apiProvider: 'gemini',
      routeId: 'gemini',
    }),
  ).toBe(false)
})

test('providerOverride routing does not use first-party Anthropic auth', () => {
  expect(
    shouldUseFirstPartyAnthropicAuthForProvider({
      providerOverride,
      apiProvider: 'firstParty',
      routeId: 'anthropic',
    }),
  ).toBe(false)
})

test('first-party Anthropic routing uses first-party Anthropic auth', () => {
  expect(
    shouldUseFirstPartyAnthropicAuthForProvider({
      apiProvider: 'firstParty',
      routeId: 'anthropic',
    }),
  ).toBe(true)
})

test('anthropic oauth proxy routing uses first-party Anthropic auth', () => {
  expect(
    shouldUseFirstPartyAnthropicAuthForProvider({
      apiProvider: 'firstParty',
      routeId: 'claude-max-proxy',
    }),
  ).toBe(true)
})

test('custom routes without oauth-backed descriptor do not use first-party Anthropic auth', () => {
  expect(
    shouldUseFirstPartyAnthropicAuthForProvider({
      apiProvider: 'firstParty',
      routeId: 'custom',
    }),
  ).toBe(false)
})
