import { defineAnthropicProxy } from '../define.js'

export default defineAnthropicProxy({
  id: 'claude-max-proxy',
  label: 'Claude Max OAuth Proxy',
  classification: 'anthropic-proxy',
  defaultBaseUrl: 'http://127.0.0.1:8031',
  defaultModel: 'claude-sonnet-4-5',
  setup: {
    requiresAuth: true,
    authMode: 'oauth',
    setupPrompt:
      'Sign in with `limitless auth login --claudeai`, then start the local Claude Max proxy.',
  },
  startup: {
    autoDetectable: true,
  },
  envVarConfig: {
    authTokenEnvVar: 'CLAUDE_CODE_OAUTH_TOKEN',
    baseUrlEnvVar: 'ANTHROPIC_BASE_URL',
    modelEnvVar: 'ANTHROPIC_MODEL',
  },
  capabilities: {
    supportsVision: true,
    supportsStreaming: true,
    supportsFunctionCalling: true,
    supportsJsonMode: true,
    supportsPreciseTokenCount: true,
  },
  transportConfig: {
    kind: 'anthropic-proxy',
  },
  preset: {
    id: 'claude-max-proxy',
    label: 'Claude Max OAuth Proxy',
    description:
      'Local Anthropic-compatible proxy that reuses Claude subscription OAuth login instead of API-key billing.',
    vendorId: 'anthropic',
    baseUrlEnvVars: ['ANTHROPIC_BASE_URL'],
    modelEnvVars: ['ANTHROPIC_MODEL'],
  },
  usage: {
    supported: false,
    ui: {
      fallbackMessage:
        '/usage is not available on the local Claude Max OAuth proxy yet.',
    },
  },
})
