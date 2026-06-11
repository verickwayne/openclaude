import { expect, test, afterEach } from 'bun:test'
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

// ---------------------------------------------------------------------------
// Redirect getProjectsDir() to a fresh temp directory per test suite.
// getClaudeConfigHomeDir is memoized keyed on CLAUDE_CONFIG_DIR, so a unique
// value here produces a fresh resolution without importing the module first.
// ---------------------------------------------------------------------------
const tmpConfigDir = mkdtempSync(join(tmpdir(), 'xharness-materialize-config-'))
process.env.CLAUDE_CONFIG_DIR = tmpConfigDir

// Late import ensures env is set before the memoized function runs.
import { materialize } from '../../../src/services/crossHarness/materialize.js'
import { getProjectsDir } from '../../../src/utils/envUtils.js'
import { sanitizePath } from '../../../src/utils/path.js'
import type { DiscoveredTranscript } from '../../../src/services/crossHarness/harnessTypes.js'

// ---------------------------------------------------------------------------
// Temp fixture management
// ---------------------------------------------------------------------------

let tmpFixtureDir: string | null = null

afterEach(() => {
  if (tmpFixtureDir) {
    try { rmSync(tmpFixtureDir, { recursive: true, force: true }) } catch {}
    tmpFixtureDir = null
  }
})

/** Write a minimal Codex rollout file; returns the path. */
function makeCodexFixture(): string {
  if (!tmpFixtureDir) {
    tmpFixtureDir = mkdtempSync(join(tmpdir(), 'xharness-materialize-fixture-'))
  }
  const path = join(tmpFixtureDir, 'rollout-test.jsonl')
  const lines = [
    JSON.stringify({ timestamp: 't0', type: 'session_meta', payload: { id: 'C1', cwd: '/tmp/proj', timestamp: 't0' } }),
    JSON.stringify({ timestamp: 't1', type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'hi' }] } }),
    JSON.stringify({ timestamp: 't2', type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'hello from codex' }] } }),
  ]
  writeFileSync(path, lines.join('\n') + '\n', 'utf8')
  return path
}

function makeTranscript(rolloutPath: string): DiscoveredTranscript {
  return {
    harness: 'codex',
    path: rolloutPath,
    sessionId: 'C1',
    cwd: '/tmp/proj',
    sessionName: 'My Thread',
    firstPrompt: 'hi',
    messageCount: 2,
    modifiedMs: 1,
  }
}

// ---------------------------------------------------------------------------
// Test: full mode
// ---------------------------------------------------------------------------

test('materialize full: file exists at expected path', async () => {
  const rolloutPath = makeCodexFixture()
  const t = makeTranscript(rolloutPath)

  const { sessionId } = await materialize(t, 'full')

  const expectedPath = join(getProjectsDir(), sanitizePath('/tmp/proj'), `${sessionId}.jsonl`)
  expect(existsSync(expectedPath)).toBe(true)
})

test('materialize full: message records have correct sessionId', async () => {
  const rolloutPath = makeCodexFixture()
  const t = makeTranscript(rolloutPath)

  const { sessionId } = await materialize(t, 'full')

  const filePath = join(getProjectsDir(), sanitizePath('/tmp/proj'), `${sessionId}.jsonl`)
  const raw = readFileSync(filePath, 'utf8')
  const lines = raw.split('\n').filter(l => l.trim())
  const parsed = lines.map(l => JSON.parse(l))

  // All message-type records must have sessionId === newSessionId
  const messageLine = parsed.filter((p: any) => p.type === 'user' || p.type === 'assistant')
  expect(messageLine.length).toBeGreaterThanOrEqual(2)
  for (const rec of messageLine) {
    expect(rec.sessionId).toBe(sessionId)
  }
})

test('materialize full: file contains custom-title line with [codex] My Thread', async () => {
  const rolloutPath = makeCodexFixture()
  const t = makeTranscript(rolloutPath)

  const { sessionId } = await materialize(t, 'full')

  const filePath = join(getProjectsDir(), sanitizePath('/tmp/proj'), `${sessionId}.jsonl`)
  const raw = readFileSync(filePath, 'utf8')
  const lines = raw.split('\n').filter(l => l.trim())
  const parsed = lines.map(l => JSON.parse(l))

  const titleLine = parsed.find((p: any) => p.type === 'custom-title')
  expect(titleLine).toBeDefined()
  expect(titleLine.customTitle).toContain('[codex] My Thread')
})

test('materialize full: file contains tag line with tag codex', async () => {
  const rolloutPath = makeCodexFixture()
  const t = makeTranscript(rolloutPath)

  const { sessionId } = await materialize(t, 'full')

  const filePath = join(getProjectsDir(), sanitizePath('/tmp/proj'), `${sessionId}.jsonl`)
  const raw = readFileSync(filePath, 'utf8')
  const lines = raw.split('\n').filter(l => l.trim())
  const parsed = lines.map(l => JSON.parse(l))

  const tagLine = parsed.find((p: any) => p.type === 'tag')
  expect(tagLine).toBeDefined()
  expect(tagLine.tag).toBe('codex')
})

test('materialize full: log has correct tag, sessionId, and messageCount >= 2', async () => {
  const rolloutPath = makeCodexFixture()
  const t = makeTranscript(rolloutPath)

  const { sessionId, log } = await materialize(t, 'full')

  expect(log.tag).toBe('codex')
  expect(log.sessionId).toBe(sessionId)
  expect(log.messageCount).toBeGreaterThanOrEqual(2)
})

// ---------------------------------------------------------------------------
// Test: summary mode
// ---------------------------------------------------------------------------

test('materialize summary: exactly 1 message record + 2 metadata lines', async () => {
  const rolloutPath = makeCodexFixture()
  const t = makeTranscript(rolloutPath)

  const { sessionId } = await materialize(t, 'summary')

  const filePath = join(getProjectsDir(), sanitizePath('/tmp/proj'), `${sessionId}.jsonl`)
  const raw = readFileSync(filePath, 'utf8')
  const lines = raw.split('\n').filter(l => l.trim())
  const parsed = lines.map(l => JSON.parse(l))

  const messageLines = parsed.filter((p: any) => p.type === 'user' || p.type === 'assistant')
  expect(messageLines).toHaveLength(1)

  const metaLines = parsed.filter((p: any) => p.type === 'custom-title' || p.type === 'tag')
  expect(metaLines).toHaveLength(2)
})

test('materialize summary: single message content contains summarize header', async () => {
  const rolloutPath = makeCodexFixture()
  const t = makeTranscript(rolloutPath)

  const { sessionId } = await materialize(t, 'summary')

  const filePath = join(getProjectsDir(), sanitizePath('/tmp/proj'), `${sessionId}.jsonl`)
  const raw = readFileSync(filePath, 'utf8')
  const lines = raw.split('\n').filter(l => l.trim())
  const parsed = lines.map(l => JSON.parse(l))

  const messageRecord = parsed.find((p: any) => p.type === 'user')
  expect(messageRecord).toBeDefined()
  // codexAdapter.summarize() produces "Resumed from Codex thread C1 (My Thread)"
  expect(messageRecord.message.content).toContain('Resumed from Codex thread C1')
})
