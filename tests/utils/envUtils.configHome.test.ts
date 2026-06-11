import { expect, test } from 'bun:test'
import { resolveClaudeConfigHomeDir } from '../../src/utils/envUtils.js'

test('default config home is ~/.limitless when no env + no legacy dirs', () => {
  const r = resolveClaudeConfigHomeDir({ homeDir: '/tmp/none-exist-xyz' })
  expect(r.endsWith('/.limitless')).toBe(true)
})
test('explicit CLAUDE_CONFIG_DIR still wins', () => {
  const r = resolveClaudeConfigHomeDir({ configDirEnv: '/custom/dir', homeDir: '/tmp/x' })
  expect(r).toBe('/custom/dir')
})
