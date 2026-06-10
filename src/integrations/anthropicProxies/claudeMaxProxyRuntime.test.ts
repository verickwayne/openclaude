import { expect, test } from 'bun:test'

import {
  describeEnsureResult,
  pythonHasModule,
  resolveOverlayRoot,
  resolveProxyBaseUrl,
} from './claudeMaxProxyRuntime.js'

test('resolveProxyBaseUrl prefers explicit override, then ANTHROPIC_BASE_URL, then default', () => {
  expect(resolveProxyBaseUrl({ CLAUDE_MAX_PROXY_BASE_URL: 'http://x:9000' })).toBe(
    'http://x:9000',
  )
  expect(resolveProxyBaseUrl({ ANTHROPIC_BASE_URL: 'http://127.0.0.1:8031' })).toBe(
    'http://127.0.0.1:8031',
  )
  expect(resolveProxyBaseUrl({})).toBe('http://127.0.0.1:8031')
})

test('resolveOverlayRoot honors CLAUDE_MAX_OVERLAY_ROOT', () => {
  expect(resolveOverlayRoot({ CLAUDE_MAX_OVERLAY_ROOT: '/tmp/overlay' })).toBe(
    '/tmp/overlay',
  )
})

test('resolveOverlayRoot defaults under the home directory', () => {
  const root = resolveOverlayRoot({})
  expect(root.endsWith('Projects/research/ClaudeMax-OAuth-Overlay')).toBe(true)
})

test('describeEnsureResult is silent on success, actionable on failure', () => {
  expect(describeEnsureResult({ status: 'already-running' })).toBeNull()
  expect(describeEnsureResult({ status: 'started' })).toBeNull()
  expect(
    describeEnsureResult({ status: 'overlay-missing', overlayRoot: '/x' }),
  ).toContain('/x')
  expect(
    describeEnsureResult({ status: 'unhealthy', baseUrl: 'http://y' }),
  ).toContain('http://y')
  expect(
    describeEnsureResult({ status: 'error', message: 'boom' }),
  ).toContain('boom')
})

test('describeEnsureResult missing-curl-cffi message contains curl_cffi and pip install', () => {
  const msg = describeEnsureResult({ status: 'missing-curl-cffi', python: 'python3' })
  expect(msg).toContain('curl_cffi')
  expect(msg).toContain('pip install')
  expect(msg).toContain('python3')
})

test('pythonHasModule returns false for a bogus module name', () => {
  expect(pythonHasModule('python3', '__no_such_module_xyz__')).toBe(false)
})
