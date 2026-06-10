// src/services/api/providerFailover.test.ts
//
// Unit tests for the mid-run provider failover decision logic.
// All tests are pure (no I/O, no network, no env mutation via module reload).

import { describe, expect, test } from 'bun:test'
import { APIError } from '@anthropic-ai/sdk'
import {
  appendFailoverRecord,
  classifyFailoverReason,
  getFailoverLogPath,
  isProviderFailoverEnabled,
  ProviderFailoverError,
  type ProviderFailoverRecord,
  shouldFailover,
} from './providerFailover.js'
import type { RankedCandidate } from './modelRegistry.js'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeApiError(status: number, message = 'error'): APIError {
  return {
    status,
    message,
    name: 'APIError',
    headers: new Headers(),
    error: {},
  } as unknown as APIError
}

function makeCandidate(
  profileId: string,
  model: string,
  modelClass: 'mid' | 'frontier' | 'fast' | 'verification' | 'local' = 'mid',
): RankedCandidate {
  return {
    profileId,
    kind: 'openai-compatible' as const,
    model,
    modelClass,
    ledgerSuccessRate: null,
    ledgerN: 0,
  }
}

// ─── classifyFailoverReason ───────────────────────────────────────────────────

describe('classifyFailoverReason', () => {
  test('returns auth for 401', () => {
    expect(classifyFailoverReason(makeApiError(401))).toBe('auth')
  })

  test('returns rate_limit for 429', () => {
    expect(classifyFailoverReason(makeApiError(429))).toBe('rate_limit')
  })

  test('returns server_error for 500', () => {
    expect(classifyFailoverReason(makeApiError(500))).toBe('server_error')
  })

  test('returns server_error for 503', () => {
    expect(classifyFailoverReason(makeApiError(503))).toBe('server_error')
  })

  test('returns server_error for 529 overloaded via message', () => {
    const err = {
      ...makeApiError(529),
      message: '{"type":"overloaded_error","error":{"type":"overloaded_error"}}',
    } as unknown as APIError
    expect(classifyFailoverReason(err)).toBe('server_error')
  })

  test('returns null for 400 (bad request — not a provider failure)', () => {
    expect(classifyFailoverReason(makeApiError(400))).toBeNull()
  })

  test('returns null for 404 (handled by streaming fallback path)', () => {
    expect(classifyFailoverReason(makeApiError(404))).toBeNull()
  })

  test('returns null for non-APIError', () => {
    expect(classifyFailoverReason(new Error('network timeout'))).toBeNull()
  })

  test('returns null for plain object', () => {
    expect(classifyFailoverReason({ code: 'ECONNRESET' })).toBeNull()
  })
})

// ─── shouldFailover ───────────────────────────────────────────────────────────

describe('shouldFailover', () => {
  const altCandidate = makeCandidate('openrouter', 'openai/gpt-5.5')

  test('returns failover=true for long-running + 401 + candidate available', () => {
    const decision = shouldFailover(
      makeApiError(401),
      'long-running',
      [altCandidate],
    )
    expect(decision.failover).toBe(true)
    if (decision.failover) {
      expect(decision.candidate).toBe(altCandidate)
      expect(decision.reason).toBe('auth')
    }
  })

  test('returns failover=true for long-running + 429 + candidate available', () => {
    const decision = shouldFailover(
      makeApiError(429),
      'long-running',
      [altCandidate],
    )
    expect(decision.failover).toBe(true)
    if (decision.failover) {
      expect(decision.reason).toBe('rate_limit')
    }
  })

  test('returns failover=true for long-running + 500 + candidate available', () => {
    const decision = shouldFailover(
      makeApiError(500),
      'long-running',
      [altCandidate],
    )
    expect(decision.failover).toBe(true)
    if (decision.failover) {
      expect(decision.reason).toBe('server_error')
    }
  })

  test('returns failover=false for direct workload even with 401', () => {
    const decision = shouldFailover(makeApiError(401), 'direct', [altCandidate])
    expect(decision.failover).toBe(false)
  })

  test('returns failover=false for bounded workload even with 429', () => {
    const decision = shouldFailover(makeApiError(429), 'bounded', [altCandidate])
    expect(decision.failover).toBe(false)
  })

  test('returns failover=false when no candidates', () => {
    const decision = shouldFailover(makeApiError(401), 'long-running', [])
    expect(decision.failover).toBe(false)
  })

  test('returns failover=false for non-failover error class (400)', () => {
    const decision = shouldFailover(
      makeApiError(400),
      'long-running',
      [altCandidate],
    )
    expect(decision.failover).toBe(false)
  })

  test('kill-switch: OPENCLAUDE_PROVIDER_FAILOVER=0 disables', () => {
    const env = { OPENCLAUDE_PROVIDER_FAILOVER: '0' } as NodeJS.ProcessEnv
    const decision = shouldFailover(
      makeApiError(401),
      'long-running',
      [altCandidate],
      env,
    )
    expect(decision.failover).toBe(false)
  })

  test('kill-switch: absent env var allows failover', () => {
    const env = {} as NodeJS.ProcessEnv
    const decision = shouldFailover(
      makeApiError(401),
      'long-running',
      [altCandidate],
      env,
    )
    expect(decision.failover).toBe(true)
  })

  test('kill-switch: OPENCLAUDE_PROVIDER_FAILOVER=1 allows failover', () => {
    const env = { OPENCLAUDE_PROVIDER_FAILOVER: '1' } as NodeJS.ProcessEnv
    const decision = shouldFailover(
      makeApiError(401),
      'long-running',
      [altCandidate],
      env,
    )
    expect(decision.failover).toBe(true)
  })

  test('picks the first (highest-ranked) candidate', () => {
    const second = makeCandidate('local-ollama', 'llama3')
    const decision = shouldFailover(
      makeApiError(401),
      'long-running',
      [altCandidate, second],
    )
    expect(decision.failover).toBe(true)
    if (decision.failover) {
      expect(decision.candidate.profileId).toBe('openrouter')
    }
  })
})

// ─── ProviderFailoverError ────────────────────────────────────────────────────

describe('ProviderFailoverError', () => {
  test('carries all fields', () => {
    const original = new Error('original')
    const err = new ProviderFailoverError(original, 'first-party', 'claude-opus-4-8', 'auth')
    expect(err.originalError).toBe(original)
    expect(err.fromProvider).toBe('first-party')
    expect(err.fromModel).toBe('claude-opus-4-8')
    expect(err.reason).toBe('auth')
    expect(err.name).toBe('ProviderFailoverError')
    expect(err instanceof ProviderFailoverError).toBe(true)
    expect(err instanceof Error).toBe(true)
  })
})

// ─── isProviderFailoverEnabled ────────────────────────────────────────────────

describe('isProviderFailoverEnabled', () => {
  test('true when env var absent', () => {
    expect(isProviderFailoverEnabled({})).toBe(true)
  })

  test('false when OPENCLAUDE_PROVIDER_FAILOVER=0', () => {
    expect(isProviderFailoverEnabled({ OPENCLAUDE_PROVIDER_FAILOVER: '0' })).toBe(false)
  })

  test('true when OPENCLAUDE_PROVIDER_FAILOVER=1', () => {
    expect(isProviderFailoverEnabled({ OPENCLAUDE_PROVIDER_FAILOVER: '1' })).toBe(true)
  })
})

// ─── appendFailoverRecord ─────────────────────────────────────────────────────

describe('appendFailoverRecord', () => {
  test('writes a valid JSON line to the log path', () => {
    const written: Array<{ path: string; data: string }> = []
    const dirs: string[] = []
    const fs = {
      mkdirSync: (p: string, _: { recursive: boolean }) => { dirs.push(p) },
      appendFileSync: (p: string, d: string) => { written.push({ path: p, data: d }) },
    }
    const record: ProviderFailoverRecord = {
      ts: '2026-06-10T00:00:00Z',
      event: 'provider_failover',
      from_provider: 'first-party',
      from_model: 'claude-opus-4-8',
      to_provider: 'openrouter',
      to_model: 'openai/gpt-5.5',
      reason: 'rate_limit',
      workload: 'long-running',
      session_id: 'test-session-123',
    }
    const result = appendFailoverRecord(record, '/project/.session/provider-failover.jsonl', fs)
    expect(result.ok).toBe(true)
    expect(written).toHaveLength(1)
    const parsed = JSON.parse(written[0]!.data.trim())
    expect(parsed.event).toBe('provider_failover')
    expect(parsed.from_provider).toBe('first-party')
    expect(parsed.to_provider).toBe('openrouter')
    expect(parsed.reason).toBe('rate_limit')
    expect(parsed.workload).toBe('long-running')
    expect(parsed.session_id).toBe('test-session-123')
  })

  test('returns ok=false on write error without throwing', () => {
    const fs = {
      mkdirSync: (_p: string, _: { recursive: boolean }) => {},
      appendFileSync: () => { throw new Error('disk full') },
    }
    const record: ProviderFailoverRecord = {
      ts: '2026-06-10T00:00:00Z',
      event: 'provider_failover',
      from_provider: 'first-party',
      from_model: 'claude-opus-4-8',
      to_provider: 'openrouter',
      to_model: 'openai/gpt-5.5',
      reason: 'server_error',
      workload: 'long-running',
      session_id: 'sess',
    }
    const result = appendFailoverRecord(record, '/any/path.jsonl', fs)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toContain('disk full')
    }
  })
})

// ─── getFailoverLogPath ───────────────────────────────────────────────────────

describe('getFailoverLogPath', () => {
  test('returns <projectDir>/<sessionId>/provider-failover.jsonl', () => {
    const p = getFailoverLogPath('/home/user/.openclaude/project', 'sess-abc')
    // Path join is OS-specific; just check the structure.
    expect(p).toContain('sess-abc')
    expect(p).toContain('provider-failover.jsonl')
    expect(p).toContain('project')
  })
})
