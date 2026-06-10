import { describe, expect, test } from 'bun:test'

import type { ProviderProfile } from './config.js'
import {
  isProviderAvailable,
  parseModelInput,
  appendModelsToModelField,
  type ProviderAvailabilityDeps,
} from './providerAvailability.js'

function makeProfile(overrides: Partial<ProviderProfile> = {}): ProviderProfile {
  return {
    id: 'p1',
    name: 'Test',
    provider: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o',
    ...overrides,
  }
}

const noCredentials: ProviderAvailabilityDeps = {
  resolveRouteId: () => 'openai',
  isLocalRoute: () => false,
  isOAuthRoute: () => false,
  isCodexProfile: () => false,
  hasClaudeOAuth: () => false,
  hasCodexCredentials: () => false,
  getRouteCredential: () => undefined,
}

describe('isProviderAvailable', () => {
  test('returns true when an apiKey is present', () => {
    expect(
      isProviderAvailable(makeProfile({ apiKey: 'sk-123' }), noCredentials),
    ).toBe(true)
  })

  test('treats a whitespace-only apiKey as no key', () => {
    expect(
      isProviderAvailable(makeProfile({ apiKey: '   ' }), {
        ...noCredentials,
      }),
    ).toBe(false)
  })

  test('returns true for a local route even without credentials', () => {
    expect(
      isProviderAvailable(makeProfile({ provider: 'ollama', apiKey: undefined }), {
        ...noCredentials,
        resolveRouteId: () => 'ollama',
        isLocalRoute: (routeId) => routeId === 'ollama',
      }),
    ).toBe(true)
  })

  test('returns true for lmstudio local route', () => {
    expect(
      isProviderAvailable(makeProfile({ provider: 'lmstudio' }), {
        ...noCredentials,
        resolveRouteId: () => 'lmstudio',
        isLocalRoute: (routeId) => routeId === 'lmstudio',
      }),
    ).toBe(true)
  })

  test('returns true for an OAuth route (claude-max-proxy) with stored Claude OAuth', () => {
    expect(
      isProviderAvailable(makeProfile({ provider: 'claude-max-proxy' }), {
        ...noCredentials,
        resolveRouteId: () => 'claude-max-proxy',
        isOAuthRoute: (routeId) => routeId === 'claude-max-proxy',
        hasClaudeOAuth: () => true,
      }),
    ).toBe(true)
  })

  test('returns false for an OAuth route when no Claude OAuth is stored', () => {
    expect(
      isProviderAvailable(makeProfile({ provider: 'claude-max-proxy' }), {
        ...noCredentials,
        resolveRouteId: () => 'claude-max-proxy',
        isOAuthRoute: (routeId) => routeId === 'claude-max-proxy',
        hasClaudeOAuth: () => false,
      }),
    ).toBe(false)
  })

  test('returns true for a codex profile with stored codex credentials', () => {
    expect(
      isProviderAvailable(makeProfile({ provider: 'openai' }), {
        ...noCredentials,
        isCodexProfile: () => true,
        hasCodexCredentials: () => true,
      }),
    ).toBe(true)
  })

  test('returns false for a codex profile without stored codex credentials', () => {
    expect(
      isProviderAvailable(makeProfile({ provider: 'openai' }), {
        ...noCredentials,
        isCodexProfile: () => true,
        hasCodexCredentials: () => false,
      }),
    ).toBe(false)
  })

  test('returns true for a hosted route with a route-specific env credential', () => {
    expect(
      isProviderAvailable(makeProfile({ apiKey: undefined }), {
        ...noCredentials,
        resolveRouteId: () => 'openrouter',
        getRouteCredential: (_profile, routeId) =>
          routeId === 'openrouter' ? 'or-live-key' : undefined,
      }),
    ).toBe(true)
  })

  test('returns false for a hosted route with no key and no OAuth', () => {
    expect(isProviderAvailable(makeProfile({ apiKey: undefined }), noCredentials)).toBe(
      false,
    )
  })
})

describe('parseModelInput', () => {
  test('splits on commas', () => {
    expect(parseModelInput('a, b ,c')).toEqual(['a', 'b', 'c'])
  })

  test('splits on newlines', () => {
    expect(parseModelInput('a\nb\nc')).toEqual(['a', 'b', 'c'])
  })

  test('splits on mixed commas and newlines, trims, drops empties', () => {
    expect(parseModelInput('a,\n b ,,\n\nc,')).toEqual(['a', 'b', 'c'])
  })

  test('dedupes repeated entries preserving first-seen order', () => {
    expect(parseModelInput('a, b, a, c, b')).toEqual(['a', 'b', 'c'])
  })

  test('returns an empty array for blank input', () => {
    expect(parseModelInput('   \n , ')).toEqual([])
  })
})

describe('appendModelsToModelField', () => {
  test('appends new models to an existing comma list', () => {
    expect(appendModelsToModelField('gpt-4o', ['gpt-4o-mini', 'o3'])).toBe(
      'gpt-4o, gpt-4o-mini, o3',
    )
  })

  test('dedupes against existing models in the field', () => {
    expect(appendModelsToModelField('gpt-4o, o3', ['o3', 'gpt-4o-mini'])).toBe(
      'gpt-4o, o3, gpt-4o-mini',
    )
  })

  test('dedupes within the incoming list', () => {
    expect(appendModelsToModelField('gpt-4o', ['o3', 'o3'])).toBe('gpt-4o, o3')
  })

  test('handles an empty existing field', () => {
    expect(appendModelsToModelField('', ['a', 'b'])).toBe('a, b')
  })

  test('returns the normalized existing field when nothing new is added', () => {
    expect(appendModelsToModelField('gpt-4o, o3', ['o3'])).toBe('gpt-4o, o3')
  })
})
