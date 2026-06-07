import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'

// Mock state.getSessionId BEFORE importing the module under test so the
// mock is in place when subprocessEnv.ts pulls in the dependency.
let mockSessionId: string | null | (() => string) = 'sid-abc-123'
mock.module('../bootstrap/state.js', () => ({
  getSessionId: () => {
    if (typeof mockSessionId === 'function') return mockSessionId()
    return mockSessionId
  },
}))

// Imported AFTER the mock — otherwise the real getSessionId binds and
// the test can't swap it.
import {
  registerUpstreamProxyEnvFn,
  subprocessEnv,
} from './subprocessEnv.js'

describe('subprocessEnv — CLAUDE_SESSION_ID injection', () => {
  let originalEnv: NodeJS.ProcessEnv

  beforeEach(() => {
    originalEnv = { ...process.env }
    mockSessionId = 'sid-abc-123'
    // Disable the GHA scrub path by default so injection covers the
    // common non-Actions case.
    delete process.env.CLAUDE_CODE_SUBPROCESS_ENV_SCRUB
    // Wipe any prior session id leakage from the parent shell.
    delete process.env.CLAUDE_SESSION_ID
    // Disconnect any proxy env hook so tests are deterministic.
    registerUpstreamProxyEnvFn(() => ({}))
  })

  afterEach(() => {
    for (const k of Object.keys(process.env)) {
      if (!(k in originalEnv)) delete process.env[k]
    }
    Object.assign(process.env, originalEnv)
  })

  test('injects CLAUDE_SESSION_ID when getSessionId() returns a value', () => {
    const env = subprocessEnv()
    expect(env.CLAUDE_SESSION_ID).toBe('sid-abc-123')
  })

  test('does NOT overwrite CLAUDE_SESSION_ID when caller already set it', () => {
    process.env.CLAUDE_SESSION_ID = 'caller-provided'
    const env = subprocessEnv()
    expect(env.CLAUDE_SESSION_ID).toBe('caller-provided')
  })

  test('silently no-ops when getSessionId() throws (early boot path)', () => {
    mockSessionId = () => {
      throw new Error('STATE not initialized')
    }
    const env = subprocessEnv()
    // Either undefined or the parent's value — either is fine; the
    // contract is "do not throw, do not crash subprocess spawn".
    expect(env.CLAUDE_SESSION_ID).toBeUndefined()
  })

  test('skips injection when getSessionId returns empty string', () => {
    mockSessionId = ''
    const env = subprocessEnv()
    expect(env.CLAUDE_SESSION_ID).toBeUndefined()
  })

  test('injection survives the GHA scrub path', () => {
    process.env.CLAUDE_CODE_SUBPROCESS_ENV_SCRUB = '1'
    process.env.ANTHROPIC_API_KEY = 'should-be-scrubbed'
    const env = subprocessEnv()
    // Scrub removes the secret…
    expect(env.ANTHROPIC_API_KEY).toBeUndefined()
    // …but session id still gets injected at the end.
    expect(env.CLAUDE_SESSION_ID).toBe('sid-abc-123')
  })

  test('does not mutate process.env directly', () => {
    const before = process.env.CLAUDE_SESSION_ID
    subprocessEnv()
    expect(process.env.CLAUDE_SESSION_ID).toBe(before)
  })

  test('proxy env hooks compose with session id injection', () => {
    registerUpstreamProxyEnvFn(() => ({ HTTPS_PROXY: 'http://relay:8080' }))
    const env = subprocessEnv()
    expect(env.HTTPS_PROXY).toBe('http://relay:8080')
    expect(env.CLAUDE_SESSION_ID).toBe('sid-abc-123')
  })
})
