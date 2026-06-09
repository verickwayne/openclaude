import { afterEach, beforeEach, expect, test } from 'bun:test'

import {
  acquireSharedMutationLock,
  releaseSharedMutationLock,
} from '../../test/sharedMutationLock.js'
import {
  buildInheritedEnvVars,
  buildTeammateProviderEnv,
} from './spawnUtils.js'

const ORIGINAL_ENV = { ...process.env }

beforeEach(async () => {
  await acquireSharedMutationLock('utils/swarm/spawnUtils.test.ts')
  for (const key of Object.keys(process.env)) {
    delete process.env[key]
  }
})

afterEach(() => {
  try {
    for (const key of Object.keys(process.env)) {
      delete process.env[key]
    }
    Object.assign(process.env, ORIGINAL_ENV)
  } finally {
    releaseSharedMutationLock()
  }
})

test('buildInheritedEnvVars marks spawned teammates as host-managed for provider routing', () => {
  const envVars = buildInheritedEnvVars()

  expect(envVars).toContain('CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST=1')
})

test('buildInheritedEnvVars forwards PATH for source-built teammate tool lookups', () => {
  process.env.PATH = '/custom/bin:/usr/bin'

  const envVars = buildInheritedEnvVars()

  expect(envVars).toContain('PATH=')
  expect(envVars).toContain('/custom/bin\\:/usr/bin')
})

test('teammate provider override produces OpenAI env, not the parent Anthropic env', () => {
  const env = buildTeammateProviderEnv({
    profileId: 'p1',
    kind: 'openai-compatible',
    model: 'openai/gpt-5.5',
    baseURL: 'https://openrouter.ai/api/v1',
    apiKey: 'sk',
  })
  expect(env.CLAUDE_CODE_USE_OPENAI).toBe('1')
  expect(env.OPENAI_BASE_URL).toBe('https://openrouter.ai/api/v1')
  expect(env.OPENAI_API_KEY).toBe('sk')
  expect(env.OPENAI_MODEL).toBe('openai/gpt-5.5')
})

test('an anthropic-native teammate override produces native Anthropic env', () => {
  const env = buildTeammateProviderEnv({
    profileId: 'first-party',
    kind: 'anthropic-native',
    model: 'claude-opus-4-8',
  })
  expect(env.CLAUDE_CODE_USE_OPENAI).toBeUndefined()
  expect(env.ANTHROPIC_MODEL).toBe('claude-opus-4-8')
})

test('buildInheritedEnvVars with a teammate override emits that provider env in place of the parent', () => {
  process.env.CLAUDE_CODE_USE_OPENAI = '1'
  process.env.OPENAI_API_KEY = 'parent-key'
  process.env.OPENAI_BASE_URL = 'https://parent.example/v1'

  const envVars = buildInheritedEnvVars({
    teammateOverride: {
      profileId: 'first-party',
      kind: 'anthropic-native',
      model: 'claude-opus-4-8',
    },
  })

  // Parent's OpenAI provider env must NOT be forwarded when overridden.
  expect(envVars).not.toContain('OPENAI_API_KEY=')
  expect(envVars).not.toContain('CLAUDE_CODE_USE_OPENAI=')
  expect(envVars).toContain('ANTHROPIC_MODEL=')
  expect(envVars).toContain('claude-opus-4-8')
  // Host-managed marker is preserved.
  expect(envVars).toContain('CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST=1')
})
