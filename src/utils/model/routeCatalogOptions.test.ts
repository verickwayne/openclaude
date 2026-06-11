import { describe, expect, test } from 'bun:test'

import { buildRouteCatalogModelOptions } from './routeCatalogOptions.js'

describe('buildRouteCatalogModelOptions', () => {
  test('marks the route default model as recommended without catalog metadata', () => {
    const options = buildRouteCatalogModelOptions(
      'DeepSeek',
      [
        { id: 'deepseek-chat', apiName: 'deepseek-chat', label: 'DeepSeek Chat' },
        { id: 'deepseek-v4-pro', apiName: 'deepseek-v4-pro', label: 'DeepSeek V4 Pro' },
      ],
      'deepseek-v4-pro',
    )

    expect(options).toEqual([
      {
        value: 'deepseek-chat',
        label: 'DeepSeek Chat',
        description: 'Provider: DeepSeek',
        descriptionForModel: 'Provider: DeepSeek (deepseek-chat)',
      },
      {
        value: 'deepseek-v4-pro',
        label: 'DeepSeek V4 Pro',
        description: 'Recommended · Provider: DeepSeek',
        descriptionForModel: 'Recommended · Provider: DeepSeek (deepseek-v4-pro)',
      },
    ])
  })

  test('carries parameter, context, and price metadata onto model options', () => {
    const options = buildRouteCatalogModelOptions(
      'OpenRouter',
      [
        {
          id: 'kimi',
          apiName: 'moonshotai/kimi-k2-thinking',
          label: 'Kimi K2 Thinking',
          parameterLabel: '1T total / 32B active',
          contextWindow: 262_144,
          pricing: {
            inputPerMillionUsd: '$0.60',
            outputPerMillionUsd: '$2.50',
          },
        },
      ],
    )

    expect(options[0]).toMatchObject({
      value: 'moonshotai/kimi-k2-thinking',
      parameterLabel: '1T total / 32B active',
      contextWindow: 262_144,
      pricing: {
        inputPerMillionUsd: '$0.60',
        outputPerMillionUsd: '$2.50',
      },
    })
    expect(options[0]?.description).toContain('parameters 1T total / 32B active')
    expect(options[0]?.description).toContain('context 262,144')
    expect(options[0]?.description).toContain('price input $0.60 / output $2.50 per 1M')
  })
})
