import { expect, test } from 'bun:test'

import { resolveLoginTarget } from './loginTarget.js'

const NO_PROFILE = { activeProfileProvider: null } as const

test('resolveLoginTarget defaults to anthropic with no provider env', () => {
  expect(resolveLoginTarget({}, NO_PROFILE)).toEqual({ kind: 'anthropic' })
})

test('resolveLoginTarget detects OpenAI subscription via codex base URL', () => {
  expect(
    resolveLoginTarget(
      {
        CLAUDE_CODE_USE_OPENAI: '1',
        OPENAI_BASE_URL: 'https://chatgpt.com/backend-api/codex',
      },
      NO_PROFILE,
    ),
  ).toEqual({ kind: 'codex' })
})

test('resolveLoginTarget detects OpenAI subscription via oauth credential source', () => {
  expect(
    resolveLoginTarget(
      {
        CLAUDE_CODE_USE_OPENAI: '1',
        CODEX_CREDENTIAL_SOURCE: 'oauth',
      },
      NO_PROFILE,
    ),
  ).toEqual({ kind: 'codex' })
})

test('resolveLoginTarget detects the Claude Max proxy route', () => {
  const target = resolveLoginTarget(
    { ANTHROPIC_BASE_URL: 'http://127.0.0.1:8031' },
    NO_PROFILE,
  )
  expect(target).toEqual({
    kind: 'claude-max',
    proxyBaseUrl: 'http://127.0.0.1:8031',
  })
})

test('resolveLoginTarget treats Ollama as a local provider', () => {
  const target = resolveLoginTarget(
    {
      CLAUDE_CODE_USE_OPENAI: '1',
      OPENAI_BASE_URL: 'http://localhost:11434/v1',
    },
    NO_PROFILE,
  )
  expect(target.kind).toBe('local')
  if (target.kind === 'local') {
    expect(target.routeId).toBe('ollama')
  }
})

test('resolveLoginTarget points API-key providers at /provider', () => {
  const target = resolveLoginTarget(
    {
      CLAUDE_CODE_USE_OPENAI: '1',
      OPENAI_BASE_URL: 'https://openrouter.ai/api/v1',
    },
    NO_PROFILE,
  )
  expect(target.kind).toBe('api-key-provider')
  if (target.kind === 'api-key-provider') {
    expect(target.label).toBe('OpenRouter')
  }
})

test('resolveLoginTarget stays anthropic for plain OpenAI API env (explicit API option)', () => {
  const target = resolveLoginTarget(
    {
      CLAUDE_CODE_USE_OPENAI: '1',
      OPENAI_BASE_URL: 'https://api.openai.com/v1',
    },
    NO_PROFILE,
  )
  expect(target.kind).toBe('api-key-provider')
})

test('resolveLoginTarget detects gemini env as api-key provider', () => {
  const target = resolveLoginTarget(
    { CLAUDE_CODE_USE_GEMINI: '1' },
    NO_PROFILE,
  )
  expect(target.kind).toBe('api-key-provider')
})
