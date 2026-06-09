import { expect, test } from 'bun:test'

import {
  buildClaudeMaxProxyProcessEnv,
  getClaudeMaxProxyStdio,
  resolveClaudeMaxOverlayRoot,
  resolveClaudeMaxProxyBaseUrl,
  resolveClaudeMaxProxyBindConfig,
} from './claude-max-common.ts'

test('Claude Max proxy base URL defaults to the local proxy port', () => {
  expect(resolveClaudeMaxProxyBaseUrl({})).toBe('http://127.0.0.1:8031')
})

test('Claude Max proxy base URL prefers explicit override', () => {
  expect(
    resolveClaudeMaxProxyBaseUrl({
      CLAUDE_MAX_PROXY_BASE_URL: 'http://127.0.0.1:9009',
      ANTHROPIC_BASE_URL: 'http://127.0.0.1:8031',
    }),
  ).toBe('http://127.0.0.1:9009')
})

test('Claude Max overlay root honors explicit override', () => {
  expect(
    resolveClaudeMaxOverlayRoot({
      CLAUDE_MAX_OVERLAY_ROOT: '/tmp/claude-max-overlay',
    }),
  ).toBe('/tmp/claude-max-overlay')
})

test('Claude Max proxy bind config rejects non-local path suffixes', () => {
  expect(() =>
    resolveClaudeMaxProxyBindConfig('http://127.0.0.1:8031/v1'),
  ).toThrow('must not include a path')
})

test('Claude Max proxy bind config rejects https proxy URLs', () => {
  expect(() =>
    resolveClaudeMaxProxyBindConfig('https://127.0.0.1:8031'),
  ).toThrow('must use http://')
})

test('Claude Max proxy stdio ignores stdin so the TUI keeps keyboard control', () => {
  expect(getClaudeMaxProxyStdio()).toEqual(['ignore', 'inherit', 'inherit'])
})

test('Claude Max proxy process env preserves Claude config and bind info', () => {
  const env = buildClaudeMaxProxyProcessEnv({
    CLAUDE_CONFIG_DIR: '/tmp/openclaude-config',
    CLAUDE_MAX_PROXY_BASE_URL: 'http://127.0.0.1:8042',
  })

  expect(env.CLAUDE_CONFIG_DIR).toBe('/tmp/openclaude-config')
  expect(env.CLAUDE_MAX_PROXY_HOST).toBe('127.0.0.1')
  expect(env.CLAUDE_MAX_PROXY_PORT).toBe('8042')
})
