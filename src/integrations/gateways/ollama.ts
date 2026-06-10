import { defineGateway } from '../define.js'

export default defineGateway({
  id: 'ollama',
  label: 'Ollama',
  category: 'local',
  defaultBaseUrl: 'http://localhost:11434/v1',
  defaultModel: 'llama3.1:8b',
  supportsModelRouting: true,
  setup: {
    requiresAuth: false,
    authMode: 'none',
  },
  startup: {
    autoDetectable: true,
    probeReadiness: 'ollama-generation',
  },
  transportConfig: {
    kind: 'local',
    openaiShim: {
      supportsAuthHeaders: true,
      maxTokensField: 'max_tokens',
      removeBodyFields: ['thinking', 'reasoning_effort'],
    },
  },
  preset: {
    id: 'ollama',
    description: 'Local or remote Ollama endpoint',
    modelEnvVars: ['OPENAI_MODEL'],
    vendorId: 'openai',
  },
  catalog: {
    source: 'dynamic',
    discovery: { kind: 'ollama' },
    // Ollama runs locally — listing models is a single sub-ms HTTP call with no
    // quota cost, so we don't need to cache it for long. 'on-open' re-fetches
    // every time the /model picker opens, guaranteeing the list always
    // reflects what's actually on disk (including models added/removed between
    // sessions). 5m TTL is a defense-in-depth bound in case the user opens
    // the picker rapidly in succession.
    discoveryCacheTtl: '5m',
    discoveryRefreshMode: 'on-open',
    allowManualRefresh: true,
  },
  usage: { supported: false },
})
