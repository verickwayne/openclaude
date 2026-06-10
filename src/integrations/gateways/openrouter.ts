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
    ],
  },
  usage: { supported: false },
})
