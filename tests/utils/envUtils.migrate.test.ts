import { expect, test } from 'bun:test'
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { migrateLegacyOpenClaudeHome } from '../../src/utils/envUtils.js'

test('copies .openclaude -> .limitless without deleting source', () => {
  const home = mkdtempSync(join(tmpdir(), 'lh-'))
  mkdirSync(join(home, '.openclaude', 'projects'), { recursive: true })
  writeFileSync(join(home, '.openclaude', 'history.jsonl'), 'x')
  migrateLegacyOpenClaudeHome({ homeDir: home })
  expect(readFileSync(join(home, '.limitless', 'history.jsonl'), 'utf8')).toBe('x')
  expect(existsSync(join(home, '.openclaude', 'history.jsonl'))).toBe(true)
})
test('no-op when CLAUDE_CONFIG_DIR set', () => {
  // should not throw and should return without copying
  migrateLegacyOpenClaudeHome({ homeDir: '/tmp/whatever', configDirEnv: '/x' })
})
