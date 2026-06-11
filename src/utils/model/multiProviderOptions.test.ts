// src/utils/model/multiProviderOptions.test.ts
import { expect, test, describe } from 'bun:test'
import {
  ADD_REMOVE_MODELS_VALUE,
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

  test('RunPod-hosted local proxy baseUrl → local', () => {
    expect(
      classifyProviderGroup('p1', {
        provider: 'openai',
        baseUrl: 'https://wfcedwrz49vpv9-11434.proxy.runpod.net/v1',
      }),
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
    // Anthropic curated rows come after Anthropic header but before OpenRouter.
    const sonnetIdx = values.indexOf('sonnet')
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

  test('adds curated defaults and availability marker for logged-in providers', () => {
    const opts = getGroupedProviderModelOptions({
      firstPartyOptions: [],
      profiles: [
        {
          id: 'anthropic',
          name: 'Anthropic (Subscription)',
          provider: 'claude-max-proxy',
          baseUrl: 'http://127.0.0.1:8031',
          model: 'claude-fable-5',
          apiKey: 'test-key',
        },
        {
          id: 'openai',
          name: 'OpenAI (Subscription)',
          provider: 'openai',
          baseUrl: 'https://chatgpt.com/backend-api/codex',
          model: 'gpt-5.5',
          apiKey: 'test-key',
        },
        {
          id: 'openrouter',
          name: 'OpenRouter',
          provider: 'openrouter',
          baseUrl: 'https://openrouter.ai/api/v1',
          model: 'openai/gpt-5-mini',
          apiKey: 'test-key',
        },
      ] as any[],
    })

    expect(opts.some(o => o.value === 'claude-opus-4-8')).toBe(true)
    expect(opts.some(o => o.value === 'sonnet')).toBe(true)
    expect(opts.some(o => o.value === 'haiku')).toBe(true)
    expect(opts.some(o => o.value === 'claude-fable-5')).toBe(true)
    expect(opts.some(o => o.value === 'gpt-5.5-mini')).toBe(true)
    expect(opts.some(o => o.value === 'minimax/minimax-m3')).toBe(true)
    expect(opts.some(o => o.value === 'moonshotai/kimi-k2-thinking')).toBe(true)
    expect(opts.some(o => o.value === 'meta-llama/llama-4-scout')).toBe(true)
    expect(opts.some(o => o.value === 'qwen/qwen3-coder')).toBe(true)
    expect(opts.some(o => o.value === 'deepseek/deepseek-v4-flash')).toBe(true)
    expect(opts.find(o => o.value === 'claude-opus-4-8')?.label).toStartWith('● ')
    expect(opts.find(o => o.value === 'gpt-5.5-mini')?.label).toStartWith('● ')
    expect(opts.find(o => o.value === 'deepseek/deepseek-v4-flash')?.label).toStartWith('● ')
    expect(opts.find(o => o.value === 'minimax/minimax-m3')?.description).toContain(
      'Params:',
    )
    expect(opts.find(o => o.value === 'minimax/minimax-m3')?.description).toContain(
      'Context: 1M',
    )
    expect(opts.find(o => o.value === 'minimax/minimax-m3')?.description).toContain(
      'Price: in $0.30 / out $1.20 per 1M',
    )
  })

  test('uses cached discovery metadata on visible stable and configured OpenRouter rows', () => {
    const opts = getGroupedProviderModelOptions({
      firstPartyOptions: [],
      profiles: [
        {
          id: 'openrouter',
          name: 'OpenRouter',
          provider: 'openrouter',
          baseUrl: 'https://openrouter.ai/api/v1',
          model: 'moonshotai/kimi-k2-thinking, vendor/custom-model',
          apiKey: 'test-key',
        },
      ] as any[],
      modelOptionsByProfileId: {
        openrouter: [
          {
            value: 'moonshotai/kimi-k2-thinking',
            label: 'Kimi K2 Thinking',
            description: 'Discovered',
            contextWindow: 262_144,
            parameterLabel: '1T total / 32B active',
            pricing: { inputPerMillionUsd: '$0.55', outputPerMillionUsd: '$2.20' },
          },
          {
            value: 'vendor/custom-model',
            label: 'Custom Model',
            description: 'Discovered',
            contextWindow: 128_000,
            parameterLabel: '70B',
            pricing: { inputPerMillionUsd: '$0.10', outputPerMillionUsd: '$0.40' },
          },
        ],
      },
    })

    const kimi = opts.find(o => o.value === 'moonshotai/kimi-k2-thinking')
    expect(kimi?.description).toContain('Params: 1T total / 32B active')
    expect(kimi?.description).toContain('Context: 262.1K')
    expect(kimi?.description).toContain('Price: in $0.55 / out $2.20 per 1M')

    const custom = opts.find(o => o.value === 'vendor/custom-model')
    expect(custom?.description).toContain('Params: 70B')
    expect(custom?.description).toContain('Context: 128K')
    expect(custom?.description).toContain('Price: in $0.10 / out $0.40 per 1M')
  })

  test('appends Add models action', () => {
    const opts = getGroupedProviderModelOptions({
      firstPartyOptions: [],
      profiles: [
        {
          id: 'openai',
          name: 'OpenAI',
          provider: 'openai',
          baseUrl: 'https://api.openai.com/v1',
          model: 'gpt-5.5',
        },
      ] as any[],
    })

    expect(opts.at(-1)?.value).toBe(ADD_REMOVE_MODELS_VALUE)
    expect(opts.at(-1)?.label).toBe('Add models')
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

  test('keeps the same provider sections when no profiles are configured', () => {
    const opts = getGroupedProviderModelOptions({
      firstPartyOptions: [{ value: 'claude-a', label: 'A', description: '' }],
      profiles: [],
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
    expect(opts.find(o => o.value === 'gpt-5.5')?.label).toStartWith('○ ')
    expect(opts.find(o => o.value === 'minimax/minimax-m3')?.label).toStartWith('○ ')
    expect(opts.some(o => o.value === 'openai/gpt-5-mini')).toBe(false)
    expect(opts.find(o => o.value === 'llama3.2:latest')?.label).toStartWith('○ ')
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
    expect(modelEntries.find(o => o.value === 'dup-model')?.providerId).toBe('p1')
  })

  test('still includes pinned Anthropic models when no first-party options and no profiles are passed', () => {
    const opts = getGroupedProviderModelOptions({ firstPartyOptions: [], profiles: [] })
    expect(opts.some(o => o.value === 'claude-opus-4-8')).toBe(true)
    expect(opts.some(o => o.value === 'claude-fable-5')).toBe(true)
    expect(opts.find(o => o.value === 'claude-opus-4-8')?.label).toBe(
      '○ Opus 4.8',
    )
    expect(opts.some(o => o.value === ADD_REMOVE_MODELS_VALUE)).toBe(true)
  })
})
