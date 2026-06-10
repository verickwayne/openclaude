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
  const realClient = await import('../services/api/client.js')
  mock.module('../services/api/client.js', () => ({
    ...realClient,
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
  // Spread the real module so all exports (e.g. addSlowOperation) remain
  // visible to later test files in a combined run.  Only the two functions
  // that sideQuery.ts actually reads are overridden; everything else falls
  // through to the real implementation.
  const realState = await import('../bootstrap/state.js')
  mock.module('../bootstrap/state.js', () => ({
    ...realState,
    getLastApiCompletionTimestamp: () => null,
    setLastApiCompletionTimestamp: () => {},
  }))
  const realSystem = await import('../constants/system.js')
  mock.module('../constants/system.js', () => ({
    ...realSystem,
    getAttributionHeader: () => null,
    getCLISyspromptPrefix: () => '',
  }))
  const realAnalytics = await import('../services/analytics/index.js')
  mock.module('../services/analytics/index.js', () => ({
    ...realAnalytics,
    logEvent: () => {},
  }))
  const realClaude = await import('../services/api/claude.js')
  mock.module('../services/api/claude.js', () => ({
    ...realClaude,
    getAPIMetadata: () => ({}),
  }))
  const realBetas = await import('./betas.js')
  mock.module('./betas.js', () => ({
    ...realBetas,
    getModelBetas: () => [],
    modelSupportsStructuredOutputs: () => false,
  }))
  const realFingerprint = await import('./fingerprint.js')
  mock.module('./fingerprint.js', () => ({
    ...realFingerprint,
    computeFingerprint: () => 'fp',
  }))
  const realModel = await import('./model/model.js')
  mock.module('./model/model.js', () => ({
    ...realModel,
    normalizeModelStringForAPI: (m: string) => m,
  }))
  const realSideQueryRegistry = await import('./sideQueryRegistry.js')
  // Default: routing disabled (no modelClass passed in existing tests).
  // Tests in the 'modelClass routing' suite override this mock per-test.
  mock.module('./sideQueryRegistry.js', () => ({
    ...realSideQueryRegistry,
    resolveTopCandidateForClass: () => null,
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

// ── modelClass routing tests ──────────────────────────────────────────────────

describe('sideQuery modelClass routing', () => {
  // These tests layer additional mocks on top of the shared beforeEach.
  // Each test sets up its own module mocks before importing a fresh sideQuery.

  test('modelClass absent → uses requested model, no registry call', async () => {
    // If modelClass is not passed, resolveTopCandidateForClass should never be called.
    let registryCalled = false
    mock.module('./sideQueryRegistry.js', () => ({
      resolveTopCandidateForClass: () => {
        registryCalled = true
        return null
      },
    }))
    mock.module('./thinking.js', () => ({
      modelSupportsAdaptiveThinking: () => false,
    }))

    const { sideQuery } = await importFreshSideQuery()
    await sideQuery({ ...BASE_OPTS, model: NON_ADAPTIVE_MODEL })

    expect(registryCalled).toBe(false)
    expect(capturedArgs).toHaveLength(1)
    expect((capturedArgs[0] as Record<string, unknown>).model).toBe(NON_ADAPTIVE_MODEL)
  })

  test('modelClass present → resolved model used, thinking guard keys off resolved model', async () => {
    const RESOLVED_MODEL = 'resolved-fast-model'
    // Registry resolves to a first-party model named RESOLVED_MODEL.
    mock.module('./sideQueryRegistry.js', () => ({
      resolveTopCandidateForClass: () => ({
        profileId: 'first-party',
        kind: 'anthropic-native',
        model: RESOLVED_MODEL,
        modelClass: 'fast',
        ledgerSuccessRate: null,
        ledgerN: 0,
      }),
    }))
    // RESOLVED_MODEL is adaptive; if the guard keys off requestedModel (NON_ADAPTIVE_MODEL)
    // it would wrongly send { type: 'disabled' }.  Keyed off resolved model → no thinking field.
    mock.module('./thinking.js', () => ({
      modelSupportsAdaptiveThinking: (m: string) => m === RESOLVED_MODEL,
    }))

    const { sideQuery } = await importFreshSideQuery()
    await sideQuery({ ...BASE_OPTS, model: NON_ADAPTIVE_MODEL, modelClass: 'fast', thinking: false })

    expect(capturedArgs).toHaveLength(1)
    // Model in the API request must be the registry-resolved one.
    expect((capturedArgs[0] as Record<string, unknown>).model).toBe(RESOLVED_MODEL)
    // Thinking guard correctly saw RESOLVED_MODEL as adaptive → no thinking field sent.
    expect(capturedArgs[0]).not.toHaveProperty('thinking')
  })

  test('resolution failure → falls back to requested model, no error thrown', async () => {
    mock.module('./sideQueryRegistry.js', () => ({
      resolveTopCandidateForClass: () => {
        throw new Error('registry unavailable')
      },
    }))
    mock.module('./thinking.js', () => ({
      modelSupportsAdaptiveThinking: () => false,
    }))

    const { sideQuery } = await importFreshSideQuery()
    // Must not throw; must use the originally-requested model.
    await expect(sideQuery({ ...BASE_OPTS, model: NON_ADAPTIVE_MODEL, modelClass: 'fast' })).resolves.toBeDefined()
    expect((capturedArgs[0] as Record<string, unknown>).model).toBe(NON_ADAPTIVE_MODEL)
  })

  test('kill switch OPENCLAUDE_SIDEQUERY_ROUTING=0 → ignores modelClass, uses requested model', async () => {
    const originalEnv = process.env.OPENCLAUDE_SIDEQUERY_ROUTING
    process.env.OPENCLAUDE_SIDEQUERY_ROUTING = '0'

    let registryCalled = false
    mock.module('./sideQueryRegistry.js', () => ({
      resolveTopCandidateForClass: () => {
        registryCalled = true
        return null
      },
    }))
    mock.module('./thinking.js', () => ({
      modelSupportsAdaptiveThinking: () => false,
    }))

    try {
      const { sideQuery } = await importFreshSideQuery()
      await sideQuery({ ...BASE_OPTS, model: NON_ADAPTIVE_MODEL, modelClass: 'fast' })

      expect(registryCalled).toBe(false)
      expect((capturedArgs[0] as Record<string, unknown>).model).toBe(NON_ADAPTIVE_MODEL)
    } finally {
      if (originalEnv === undefined) {
        delete process.env.OPENCLAUDE_SIDEQUERY_ROUTING
      } else {
        process.env.OPENCLAUDE_SIDEQUERY_ROUTING = originalEnv
      }
    }
  })
})
