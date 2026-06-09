// src/utils/model/multiProviderOptions.test.ts
import { expect, test, describe } from 'bun:test'
import {
  getAllProviderModelOptions,
  classifyProviderGroup,
  getGroupedProviderModelOptions,
  GROUP_HEADER_VALUE_PREFIX,
  isGroupHeaderValue,
  makeGroupHeaderValue,
} from './multiProviderOptions.js'

describe('getAllProviderModelOptions', () => {
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
})

describe('classifyProviderGroup', () => {
  test('first-party providerId → anthropic', () => {
    expect(classifyProviderGroup('first-party')).toBe('anthropic')
  })

  test('provider=anthropic → anthropic', () => {
    expect(
      classifyProviderGroup('p1', { provider: 'anthropic', baseUrl: 'https://api.anthropic.com' }),
    ).toBe('anthropic')
  })

  test('provider=claude-max-proxy → anthropic', () => {
    expect(
      classifyProviderGroup('p1', { provider: 'claude-max-proxy', baseUrl: 'https://claude.ai' }),
    ).toBe('anthropic')
  })

  test('openrouter baseUrl → openrouter (even when provider=openai)', () => {
    expect(
      classifyProviderGroup('p1', {
        provider: 'openai',
        baseUrl: 'https://openrouter.ai/api/v1',
      }),
    ).toBe('openrouter')
  })

  test('provider=openai with non-openrouter non-local baseUrl → openai', () => {
    expect(
      classifyProviderGroup('p1', {
        provider: 'openai',
        baseUrl: 'https://api.openai.com/v1',
      }),
    ).toBe('openai')
  })

  test('provider=ollama → local', () => {
    expect(
      classifyProviderGroup('p1', { provider: 'ollama', baseUrl: 'http://localhost:11434' }),
    ).toBe('local')
  })

  test('provider=lmstudio → local', () => {
    expect(
      classifyProviderGroup('p1', { provider: 'lmstudio', baseUrl: 'http://127.0.0.1:1234' }),
    ).toBe('local')
  })

  test('localhost baseUrl with openai provider → local', () => {
    expect(
      classifyProviderGroup('p1', { provider: 'openai', baseUrl: 'http://localhost:8080/v1' }),
    ).toBe('local')
  })

  test('127.0.0.1 baseUrl → local', () => {
    expect(
      classifyProviderGroup('p1', { provider: 'openai', baseUrl: 'http://127.0.0.1:11434/v1' }),
    ).toBe('local')
  })

  test('unknown provider + external baseUrl → other', () => {
    expect(
      classifyProviderGroup('p1', { provider: 'custom', baseUrl: 'https://api.example.com' }),
    ).toBe('other')
  })

  test('no profile → other', () => {
    expect(classifyProviderGroup('unknown-id')).toBe('other')
  })
})

describe('isGroupHeaderValue / makeGroupHeaderValue', () => {
  test('makeGroupHeaderValue returns correct prefix', () => {
    expect(makeGroupHeaderValue('anthropic')).toBe(`${GROUP_HEADER_VALUE_PREFIX}anthropic`)
  })

  test('isGroupHeaderValue detects header values', () => {
    expect(isGroupHeaderValue(makeGroupHeaderValue('openai'))).toBe(true)
    expect(isGroupHeaderValue('claude-opus-4-8')).toBe(false)
    expect(isGroupHeaderValue('gpt-4o')).toBe(false)
  })
})

describe('getGroupedProviderModelOptions', () => {
  test('inserts group headers and preserves order: anthropic first', () => {
    const opts = getGroupedProviderModelOptions({
      firstPartyOptions: [{ value: 'claude-sonnet', label: 'Sonnet', description: '' }],
      profiles: [
        {
          id: 'p1',
          name: 'OpenRouter',
          provider: 'openai',
          baseUrl: 'https://openrouter.ai/api/v1',
          model: 'openai/gpt-4o',
        },
      ] as any[],
    })
    const values = opts.map(o => String(o.value))
    const anthropicHeaderIdx = values.findIndex(v => v === makeGroupHeaderValue('anthropic'))
    const openrouterHeaderIdx = values.findIndex(v => v === makeGroupHeaderValue('openrouter'))
    expect(anthropicHeaderIdx).toBeGreaterThanOrEqual(0)
    expect(openrouterHeaderIdx).toBeGreaterThan(anthropicHeaderIdx)
    // Sonnet comes after Anthropic header but before OpenRouter header
    const sonnetIdx = values.indexOf('claude-sonnet')
    expect(sonnetIdx).toBeGreaterThan(anthropicHeaderIdx)
    expect(sonnetIdx).toBeLessThan(openrouterHeaderIdx)
  })

  test('group order: Anthropic → OpenAI → OpenRouter → Local', () => {
    const opts = getGroupedProviderModelOptions({
      firstPartyOptions: [{ value: 'claude-a', label: 'A', description: '' }],
      profiles: [
        { id: 'p1', name: 'OAI', provider: 'openai', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4' },
        { id: 'p2', name: 'OR', provider: 'openai', baseUrl: 'https://openrouter.ai/api/v1', model: 'or-model' },
        { id: 'p3', name: 'Ollama', provider: 'ollama', baseUrl: 'http://localhost:11434', model: 'llama3' },
      ] as any[],
    })
    const headerValues = opts
      .filter(o => isGroupHeaderValue(String(o.value)))
      .map(o => String(o.value))
    expect(headerValues).toEqual([
      makeGroupHeaderValue('anthropic'),
      makeGroupHeaderValue('openai'),
      makeGroupHeaderValue('openrouter'),
      makeGroupHeaderValue('local'),
    ])
  })

  test('header items are marked disabled', () => {
    const opts = getGroupedProviderModelOptions({
      firstPartyOptions: [{ value: 'claude-a', label: 'A', description: '' }],
      profiles: [
        { id: 'p1', name: 'OAI', provider: 'openai', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4' },
      ] as any[],
    })
    const headers = opts.filter(o => isGroupHeaderValue(String(o.value)))
    expect(headers.length).toBeGreaterThan(0)
    for (const h of headers) {
      expect((h as any).disabled).toBe(true)
    }
  })

  test('omits groups with no models', () => {
    const opts = getGroupedProviderModelOptions({
      firstPartyOptions: [{ value: 'claude-a', label: 'A', description: '' }],
      profiles: [], // no profiles → no openai/openrouter/local groups
    })
    const headerValues = opts
      .filter(o => isGroupHeaderValue(String(o.value)))
      .map(o => String(o.value))
    expect(headerValues).toEqual([makeGroupHeaderValue('anthropic')])
  })

  test('dedupes by value across groups, first occurrence wins', () => {
    const opts = getGroupedProviderModelOptions({
      firstPartyOptions: [{ value: 'dup-model', label: 'Dup', description: '' }],
      profiles: [
        { id: 'p1', name: 'OAI', provider: 'openai', baseUrl: 'https://api.openai.com/v1', model: 'dup-model' },
      ] as any[],
    })
    const modelEntries = opts.filter(o => !isGroupHeaderValue(String(o.value)))
    expect(modelEntries.filter(o => o.value === 'dup-model').length).toBe(1)
    expect(modelEntries.find(o => o.value === 'dup-model')?.providerId).toBe('first-party')
  })

  test('returns empty list when no first-party options and no profiles', () => {
    const opts = getGroupedProviderModelOptions({ firstPartyOptions: [], profiles: [] })
    expect(opts).toEqual([])
  })
})
