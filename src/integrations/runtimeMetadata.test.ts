import { describe, expect, test } from 'bun:test'

import { resolveOpenAIShimRuntimeContext } from './runtimeMetadata.js'

describe('resolveOpenAIShimRuntimeContext', () => {
  test('strips unsupported thinking controls for OpenRouter models', () => {
    const context = resolveOpenAIShimRuntimeContext({
      baseUrl: 'https://openrouter.ai/api/v1',
      model: 'meta-llama/llama-4-scout',
      activeProfileProvider: 'openrouter',
    })

    expect(context.routeId).toBe('openrouter')
    expect(context.openaiShimConfig.removeBodyFields).toContain('thinking')
    expect(context.openaiShimConfig.removeBodyFields).toContain('reasoning_effort')
  })

  test('preserves OpenRouter stripping when model-specific inference adds fields', () => {
    const context = resolveOpenAIShimRuntimeContext({
      baseUrl: 'https://openrouter.ai/api/v1',
      model: 'deepseek/deepseek-v4-flash',
      activeProfileProvider: 'openrouter',
    })

    expect(context.routeId).toBe('openrouter')
    expect(context.openaiShimConfig.thinkingRequestFormat).toBe('deepseek-compatible')
    expect(context.openaiShimConfig.removeBodyFields).toContain('thinking')
    expect(context.openaiShimConfig.removeBodyFields).toContain('reasoning_effort')
  })
})
