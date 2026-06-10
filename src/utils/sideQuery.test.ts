import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import {
  acquireSharedMutationLock,
  releaseSharedMutationLock,
} from '../test/sharedMutationLock.js'

const originalMacro = (globalThis as Record<string, unknown>).MACRO

let capturedArgs: unknown[] = []

beforeEach(async () => {
  await acquireSharedMutationLock('utils/sideQuery.test.ts')
  ;(globalThis as Record<string, unknown>).MACRO = { VERSION: '0.0.0' }
  capturedArgs = []
  mock.module('../services/api/client.js', () => ({
    getAnthropicClient: async () => ({
      beta: {
        messages: {
          create: async (body: unknown) => {
            capturedArgs.push(body)
            return {
              id: 'msg_test',
              type: 'message',
              role: 'assistant',
              content: [{ type: 'text', text: 'ok' }],
              model: 'test',
              stop_reason: 'end_turn',
              stop_sequence: null,
              usage: {
                input_tokens: 1,
                output_tokens: 1,
                cache_read_input_tokens: 0,
                cache_creation_input_tokens: 0,
              },
              _request_id: 'req_test',
            }
          },
        },
      },
    }),
  }))
  mock.module('../bootstrap/state.js', () => ({
    getLastApiCompletionTimestamp: () => null,
    setLastApiCompletionTimestamp: () => {},
  }))
  mock.module('../constants/system.js', () => ({
    getAttributionHeader: () => null,
    getCLISyspromptPrefix: () => '',
  }))
  mock.module('../services/analytics/index.js', () => ({
    logEvent: () => {},
  }))
  mock.module('../services/api/claude.js', () => ({
    getAPIMetadata: () => ({}),
  }))
  mock.module('./betas.js', () => ({
    getModelBetas: () => [],
    modelSupportsStructuredOutputs: () => false,
  }))
  mock.module('./fingerprint.js', () => ({
    computeFingerprint: () => 'fp',
  }))
  mock.module('./model/model.js', () => ({
    normalizeModelStringForAPI: (m: string) => m,
  }))
})

afterEach(() => {
  try {
    mock.restore()
  } finally {
    if (originalMacro === undefined) {
      delete (globalThis as Record<string, unknown>).MACRO
    } else {
      ;(globalThis as Record<string, unknown>).MACRO = originalMacro
    }
    releaseSharedMutationLock()
  }
})

async function importFreshSideQuery() {
  const nonce = `${Date.now()}-${Math.random()}`
  return import(`./sideQuery.js?ts=${nonce}`)
}

const ADAPTIVE_MODEL = 'claude-sonnet-4-6'
const NON_ADAPTIVE_MODEL = 'claude-sonnet-3-5'
const BASE_OPTS = {
  querySource: 'test' as const,
  messages: [{ role: 'user' as const, content: 'hi' }],
}

describe('sideQuery thinking field — thinking:false', () => {
  test('omits thinking field entirely for adaptive-thinking models', async () => {
    mock.module('./thinking.js', () => ({
      modelSupportsAdaptiveThinking: (m: string) => m === ADAPTIVE_MODEL,
    }))
    const { sideQuery } = await importFreshSideQuery()

    await sideQuery({ ...BASE_OPTS, model: ADAPTIVE_MODEL, thinking: false })

    expect(capturedArgs).toHaveLength(1)
    expect(capturedArgs[0]).not.toHaveProperty('thinking')
  })

  test('sends {type:"disabled"} for non-adaptive-thinking models', async () => {
    mock.module('./thinking.js', () => ({
      modelSupportsAdaptiveThinking: (m: string) => m === ADAPTIVE_MODEL,
    }))
    const { sideQuery } = await importFreshSideQuery()

    await sideQuery({ ...BASE_OPTS, model: NON_ADAPTIVE_MODEL, thinking: false })

    expect(capturedArgs).toHaveLength(1)
    expect(capturedArgs[0]).toMatchObject({ thinking: { type: 'disabled' } })
  })
})

describe('sideQuery thinking field — thinking:number', () => {
  test('sends {type:"enabled"} for non-adaptive model regardless', async () => {
    mock.module('./thinking.js', () => ({
      modelSupportsAdaptiveThinking: (m: string) => m === ADAPTIVE_MODEL,
    }))
    const { sideQuery } = await importFreshSideQuery()

    await sideQuery({ ...BASE_OPTS, model: NON_ADAPTIVE_MODEL, thinking: 1024 })

    expect(capturedArgs).toHaveLength(1)
    expect(capturedArgs[0]).toMatchObject({ thinking: { type: 'enabled' } })
  })

  test('sends {type:"enabled"} for adaptive model when budget provided', async () => {
    mock.module('./thinking.js', () => ({
      modelSupportsAdaptiveThinking: (m: string) => m === ADAPTIVE_MODEL,
    }))
    const { sideQuery } = await importFreshSideQuery()

    await sideQuery({ ...BASE_OPTS, model: ADAPTIVE_MODEL, thinking: 1024 })

    expect(capturedArgs).toHaveLength(1)
    expect(capturedArgs[0]).toMatchObject({ thinking: { type: 'enabled' } })
  })
})

describe('sideQuery thinking field — thinking:undefined', () => {
  test('omits thinking field when thinking is not provided', async () => {
    mock.module('./thinking.js', () => ({
      modelSupportsAdaptiveThinking: (m: string) => m === ADAPTIVE_MODEL,
    }))
    const { sideQuery } = await importFreshSideQuery()

    await sideQuery({ ...BASE_OPTS, model: ADAPTIVE_MODEL })

    expect(capturedArgs).toHaveLength(1)
    expect(capturedArgs[0]).not.toHaveProperty('thinking')
  })
})
