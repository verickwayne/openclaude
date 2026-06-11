import { defineGateway } from '../define.js'
import type { ModelCatalogEntry } from '../descriptors.js'

function formatOpenRouterUsdPerMillion(value: unknown): string | null {
  const numeric = typeof value === 'string' ? Number(value) : Number.NaN
  if (!Number.isFinite(numeric) || numeric < 0) {
    return null
  }

  const perMillion = numeric * 1_000_000
  if (perMillion === 0) {
    return '$0'
  }

  return `$${perMillion >= 1 ? perMillion.toFixed(2) : perMillion.toPrecision(2)}`
}

function parseParameterLabel(raw: unknown): string | null {
  if (!raw || typeof raw !== 'object') {
    return null
  }

  const model = raw as { description?: unknown }
  if (typeof model.description !== 'string') {
    return null
  }

  const description = model.description
  const activeMatch = description.match(
    /(?:with|activating)\s+([0-9.]+\s*[BT])\s+(?:active|activated)\s+parameters\s+(?:out of|of)\s+(?:a\s+)?(?:total\s+of\s+)?([0-9.]+\s*[BT])/i,
  )
  if (activeMatch) {
    return `${activeMatch[2].replace(/\s+/g, '')} total / ${activeMatch[1].replace(/\s+/g, '')} active`
  }

  const totalActiveMatch = description.match(
    /([0-9.]+\s*[BT])\s+total\s+parameters\s+and\s+([0-9.]+\s*[BT])\s+activated\s+parameters/i,
  )
  if (totalActiveMatch) {
    return `${totalActiveMatch[1].replace(/\s+/g, '')} total / ${totalActiveMatch[2].replace(/\s+/g, '')} active`
  }

  const totalMatch = description.match(/([0-9.]+\s*[BT])[- ]parameter/i)
  return totalMatch ? totalMatch[1].replace(/\s+/g, '') : null
}

function mapOpenRouterModel(raw: unknown): ModelCatalogEntry | null {
  if (!raw || typeof raw !== 'object') {
    return null
  }

  const model = raw as {
    id?: unknown
    name?: unknown
    context_length?: unknown
    pricing?: {
      prompt?: unknown
      completion?: unknown
    }
  }
  if (typeof model.id !== 'string' || model.id.trim().length === 0) {
    return null
  }

  const inputPrice = formatOpenRouterUsdPerMillion(model.pricing?.prompt)
  const outputPrice = formatOpenRouterUsdPerMillion(model.pricing?.completion)
  const parameterLabel = parseParameterLabel(raw)
  const priceNote =
    inputPrice || outputPrice
      ? `OpenRouter price: input ${inputPrice ?? '?'} / output ${outputPrice ?? '?'} per 1M tokens`
      : undefined
  const contextNote =
    typeof model.context_length === 'number' && Number.isFinite(model.context_length)
      ? `context ${model.context_length.toLocaleString()}`
      : undefined
  const notes = [priceNote, contextNote].filter(Boolean).join(' · ')

  return {
    id: model.id,
    apiName: model.id,
    label: typeof model.name === 'string' && model.name.trim() ? model.name : model.id,
    ...(typeof model.context_length === 'number' && Number.isFinite(model.context_length)
      ? { contextWindow: model.context_length }
      : {}),
    ...(parameterLabel ? { parameterLabel } : {}),
    ...(inputPrice || outputPrice
      ? {
          pricing: {
            ...(inputPrice ? { inputPerMillionUsd: inputPrice } : {}),
            ...(outputPrice ? { outputPerMillionUsd: outputPrice } : {}),
          },
        }
      : {}),
    ...(notes ? { notes } : {}),
  }
}

export default defineGateway({
  id: 'openrouter',
  label: 'OpenRouter',
  category: 'aggregating',
  defaultBaseUrl: 'https://openrouter.ai/api/v1',
  defaultModel: 'openai/gpt-5-mini',
  supportsModelRouting: true,
  setup: {
    requiresAuth: true,
    authMode: 'api-key',
    credentialEnvVars: ['OPENROUTER_API_KEY'],
  },
  startup: {
    probeReadiness: 'openai-compatible-models',
  },
  transportConfig: {
    kind: 'openai-compatible',
    openaiShim: {
      supportsAuthHeaders: true,
      removeBodyFields: ['thinking', 'reasoning_effort'],
    },
  },
  preset: {
    id: 'openrouter',
    description: 'OpenRouter OpenAI-compatible endpoint',
    apiKeyEnvVars: ['OPENROUTER_API_KEY'],
    vendorId: 'openai',
  },
  catalog: {
    source: 'hybrid',
    discovery: {
      kind: 'openai-compatible',
      mapModel: mapOpenRouterModel,
    },
    discoveryCacheTtl: '1d',
    discoveryRefreshMode: 'background-if-stale',
    allowManualRefresh: true,
    models: [
      { id: 'openrouter-gpt-5-mini', apiName: 'openai/gpt-5-mini', label: 'GPT-5 Mini (via OpenRouter)', modelDescriptorId: 'gpt-5-mini' },
      {
        id: 'openrouter-minimax-m3',
        apiName: 'minimax/minimax-m3',
        label: 'MiniMax M3',
        contextWindow: 1_048_576,
        pricing: { inputPerMillionUsd: '$0.30', outputPerMillionUsd: '$1.20' },
      },
      {
        id: 'openrouter-kimi-k2-thinking',
        apiName: 'moonshotai/kimi-k2-thinking',
        label: 'Kimi K2 Thinking',
        contextWindow: 262_144,
        parameterLabel: '1T total / 32B active',
        pricing: { inputPerMillionUsd: '$0.60', outputPerMillionUsd: '$2.50' },
      },
      {
        id: 'openrouter-llama-4-scout',
        apiName: 'meta-llama/llama-4-scout',
        label: 'Llama 4 Scout',
        contextWindow: 10_000_000,
        parameterLabel: '109B total / 17B active',
        pricing: { inputPerMillionUsd: '$0.10', outputPerMillionUsd: '$0.30' },
      },
      {
        id: 'openrouter-qwen3-coder',
        apiName: 'qwen/qwen3-coder',
        label: 'Qwen3 Coder 480B A35B',
        contextWindow: 1_048_576,
        parameterLabel: '480B total / 35B active',
        pricing: { inputPerMillionUsd: '$0.22', outputPerMillionUsd: '$1.80' },
      },
      {
        id: 'openrouter-deepseek-v4-flash',
        apiName: 'deepseek/deepseek-v4-flash',
        label: 'DeepSeek V4 Flash',
        contextWindow: 1_048_576,
        parameterLabel: '284B total / 13B active',
        pricing: { inputPerMillionUsd: '$0.0983', outputPerMillionUsd: '$0.1966' },
      },
    ],
  },
  usage: { supported: false },
})
