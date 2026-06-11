import { expect, test, afterEach } from 'bun:test'
import { mkdtempSync, writeFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { codexAdapter } from '../../../src/services/crossHarness/adapters/codexAdapter.js'
import type { DiscoveredTranscript } from '../../../src/services/crossHarness/harnessTypes.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let tmpDir: string | null = null

function tempRollout(lines: string[]): string {
  if (!tmpDir) {
    tmpDir = mkdtempSync(join(tmpdir(), 'xharness-codex-'))
  }
  const path = join(tmpDir, `rollout-${Date.now()}.jsonl`)
  writeFileSync(path, lines.join('\n') + '\n')
  return path
}

afterEach(() => {
  if (tmpDir) {
    try { rmSync(tmpDir, { recursive: true, force: true }) } catch {}
    tmpDir = null
  }
})

// ---------------------------------------------------------------------------
// Standard rollout fixture
// ---------------------------------------------------------------------------

function makeStandardRollout(): { path: string; t: DiscoveredTranscript } {
  const lines = [
    // session_meta — gives cwd and session id
    JSON.stringify({ timestamp: 't0', type: 'session_meta', payload: { id: 'C1', cwd: '/c', timestamp: 't0' } }),
    // user message
    JSON.stringify({ timestamp: 't1', type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'hello codex' }] } }),
    // assistant message
    JSON.stringify({ timestamp: 't2', type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'hi there' }] } }),
    // event_msg — must be ignored
    JSON.stringify({ timestamp: 't3', type: 'event_msg', payload: { event: 'some_event', data: {} } }),
  ]

  const path = tempRollout(lines)
  const t: DiscoveredTranscript = {
    harness: 'codex',
    path,
    sessionId: 'C1',
    cwd: '/c',
    sessionName: 'thread X',
    firstPrompt: 'hello codex',
    messageCount: 2,
    modifiedMs: 1,
  }
  return { path, t }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test('toLimitlessTranscript: all records have sessionId === newSessionId', () => {
  const { t } = makeStandardRollout()
  const records = codexAdapter.toLimitlessTranscript(t, 'NEW')
  expect(records.length).toBeGreaterThan(0)
  for (const r of records) {
    expect(r.sessionId).toBe('NEW')
  }
})

test('toLimitlessTranscript: first record has parentUuid === null', () => {
  const { t } = makeStandardRollout()
  const records = codexAdapter.toLimitlessTranscript(t, 'NEW')
  expect(records.length).toBeGreaterThan(0)
  expect(records[0]!.parentUuid).toBeNull()
})

test('toLimitlessTranscript: exactly 2 message records (event_msg ignored)', () => {
  const { t } = makeStandardRollout()
  const records = codexAdapter.toLimitlessTranscript(t, 'NEW')
  expect(records).toHaveLength(2)
})

test('toLimitlessTranscript: assistant record has content containing "hi there"', () => {
  const { t } = makeStandardRollout()
  const records = codexAdapter.toLimitlessTranscript(t, 'NEW')
  const assistantRecord = records.find(r => r.message.role === 'assistant')
  expect(assistantRecord).toBeDefined()
  expect(assistantRecord!.message.content).toContain('hi there')
})

test('toLimitlessTranscript: user record content contains "hello codex"', () => {
  const { t } = makeStandardRollout()
  const records = codexAdapter.toLimitlessTranscript(t, 'NEW')
  const userRecord = records.find(r => r.message.role === 'user')
  expect(userRecord).toBeDefined()
  expect(userRecord!.message.content).toContain('hello codex')
})

test('toLimitlessTranscript: parent chain is correct (first null, second points to first)', () => {
  const { t } = makeStandardRollout()
  const records = codexAdapter.toLimitlessTranscript(t, 'NEW')
  expect(records).toHaveLength(2)
  expect(records[0]!.parentUuid).toBeNull()
  // Second record's parentUuid must equal first record's uuid
  expect(records[1]!.parentUuid).toBe(records[0]!.uuid)
})

test('toLimitlessTranscript: isSidechain is false on all records', () => {
  const { t } = makeStandardRollout()
  const records = codexAdapter.toLimitlessTranscript(t, 'NEW')
  for (const r of records) {
    expect(r.isSidechain).toBe(false)
  }
})

test('toLimitlessTranscript: cwd comes from session_meta', () => {
  const { t } = makeStandardRollout()
  const records = codexAdapter.toLimitlessTranscript(t, 'NEW')
  for (const r of records) {
    expect(r.cwd).toBe('/c')
  }
})

test('summarize: contains "Resumed from Codex thread C1"', () => {
  const { t } = makeStandardRollout()
  const summary = codexAdapter.summarize(t)
  expect(summary).toContain('Resumed from Codex thread C1')
})

test('summarize: contains the session name', () => {
  const { t } = makeStandardRollout()
  const summary = codexAdapter.summarize(t)
  expect(summary).toContain('thread X')
})

// ---------------------------------------------------------------------------
// developer-role test
// ---------------------------------------------------------------------------

test('developer-role message becomes a user record prefixed with "[system/developer]"', () => {
  const lines = [
    JSON.stringify({ timestamp: 't0', type: 'session_meta', payload: { id: 'D1', cwd: '/dev', timestamp: 't0' } }),
    JSON.stringify({ timestamp: 't1', type: 'response_item', payload: { type: 'message', role: 'developer', content: [{ type: 'input_text', text: 'system context injected' }] } }),
    JSON.stringify({ timestamp: 't2', type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'acknowledged' }] } }),
  ]

  const path = tempRollout(lines)
  const t: DiscoveredTranscript = {
    harness: 'codex',
    path,
    sessionId: 'D1',
    cwd: '/dev',
    sessionName: 'dev thread',
    firstPrompt: 'system context injected',
    messageCount: 2,
    modifiedMs: 1,
  }

  const records = codexAdapter.toLimitlessTranscript(t, 'SESS-D')

  expect(records).toHaveLength(2)

  // developer → user role
  const devRecord = records[0]!
  expect(devRecord.message.role).toBe('user')
  expect(devRecord.message.content).toContain('[system/developer]')
  expect(devRecord.message.content).toContain('system context injected')
})

// ---------------------------------------------------------------------------
// XML stripping in summarize
// ---------------------------------------------------------------------------

test('summarize: strips leading XML blocks from message text', () => {
  const xmlContent = '<environment_context>\n<cwd>/tmp/proj</cwd>\n</environment_context>\nReal user message after xml'
  const lines = [
    JSON.stringify({ timestamp: 't0', type: 'session_meta', payload: { id: 'X1', cwd: '/tmp', timestamp: 't0' } }),
    JSON.stringify({ timestamp: 't1', type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: xmlContent }] } }),
  ]

  const path = tempRollout(lines)
  const t: DiscoveredTranscript = {
    harness: 'codex',
    path,
    sessionId: 'X1',
    cwd: '/tmp',
    sessionName: 'xml test',
    firstPrompt: 'xml test',
    messageCount: 1,
    modifiedMs: 1,
  }

  const summary = codexAdapter.summarize(t)
  // Should not contain the raw XML tags
  expect(summary).not.toContain('<environment_context>')
  // Should contain the real message text
  expect(summary).toContain('Real user message after xml')
})

// ---------------------------------------------------------------------------
// Output_text content type
// ---------------------------------------------------------------------------

test('toLimitlessTranscript: output_text content type is flattened correctly', () => {
  const lines = [
    JSON.stringify({ timestamp: 't0', type: 'session_meta', payload: { id: 'O1', cwd: '/o', timestamp: 't0' } }),
    JSON.stringify({
      timestamp: 't1',
      type: 'response_item',
      payload: {
        type: 'message',
        role: 'assistant',
        content: [
          { type: 'output_text', text: 'first chunk' },
          { type: 'output_text', text: ' second chunk' },
        ],
      },
    }),
  ]

  const path = tempRollout(lines)
  const t: DiscoveredTranscript = {
    harness: 'codex',
    path,
    sessionId: 'O1',
    cwd: '/o',
    sessionName: 'output test',
    firstPrompt: '',
    messageCount: 1,
    modifiedMs: 1,
  }

  const records = codexAdapter.toLimitlessTranscript(t, 'SESS-O')
  expect(records).toHaveLength(1)
  expect(records[0]!.message.content).toContain('first chunk')
  expect(records[0]!.message.content).toContain('second chunk')
})

// ---------------------------------------------------------------------------
// harness property
// ---------------------------------------------------------------------------

test('codexAdapter.harness is "codex"', () => {
  expect(codexAdapter.harness).toBe('codex')
})
