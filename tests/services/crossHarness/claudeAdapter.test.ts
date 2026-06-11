import { expect, test, beforeEach, afterEach } from 'bun:test'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { DiscoveredTranscript } from '../../../src/services/crossHarness/harnessTypes.js'
import { claudeAdapter } from '../../../src/services/crossHarness/adapters/claudeAdapter.js'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** Build a minimal Claude/Limitless JSONL line for a user or assistant turn. */
function msgLine(role: 'user' | 'assistant', content: string, sessionId = 'OLD'): string {
  return JSON.stringify({
    parentUuid: null,
    isSidechain: false,
    type: role,
    message: { role, content },
    uuid: `source-uuid-${role}`,
    timestamp: '2026-01-01T00:00:00.000Z',
    cwd: '/source-cwd',
    sessionId,
    version: '0.0.0',
    gitBranch: 'main',
  })
}

/** A metadata line that should be skipped by the adapter. */
function lastPromptLine(): string {
  return JSON.stringify({
    type: 'last-prompt',
    sessionId: 'OLD' as any,
    lastPrompt: 'some user text',
  })
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

let tmpDir: string
let transcriptPath: string

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'xharness-claude-adapter-'))
  transcriptPath = join(tmpDir, 'session.jsonl')

  // 2 user turns + 1 assistant turn + 1 last-prompt metadata line (must be skipped)
  const lines = [
    msgLine('user', 'first user message'),
    lastPromptLine(),                         // ← metadata; must NOT appear in output
    msgLine('assistant', 'assistant reply'),
    msgLine('user', 'second user message'),
  ]
  writeFileSync(transcriptPath, lines.join('\n') + '\n', 'utf8')
})

afterEach(() => {
  try { rmSync(tmpDir, { recursive: true, force: true }) } catch {}
})

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTranscript(overrides: Partial<DiscoveredTranscript> = {}): DiscoveredTranscript {
  return {
    harness: 'limitless',
    path: transcriptPath,
    sessionId: 'OLD',
    sessionName: 'Test Session',
    firstPrompt: 'first user message',
    cwd: '/p',
    messageCount: 3,
    modifiedMs: 1000,
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// toLimitlessTranscript
// ---------------------------------------------------------------------------

test('toLimitlessTranscript: returns 3 records (metadata line skipped)', () => {
  const t = makeTranscript()
  const records = claudeAdapter.toLimitlessTranscript(t, 'NEW')
  expect(records).toHaveLength(3)
})

test('toLimitlessTranscript: all records have sessionId === newSessionId', () => {
  const t = makeTranscript()
  const records = claudeAdapter.toLimitlessTranscript(t, 'NEW')
  for (const r of records) {
    expect(r.sessionId).toBe('NEW')
  }
})

test('toLimitlessTranscript: first record has parentUuid === null', () => {
  const t = makeTranscript()
  const records = claudeAdapter.toLimitlessTranscript(t, 'NEW')
  expect(records[0]!.parentUuid).toBeNull()
})

test('toLimitlessTranscript: second record parentUuid === first record uuid', () => {
  const t = makeTranscript()
  const records = claudeAdapter.toLimitlessTranscript(t, 'NEW')
  expect(records[1]!.parentUuid).toBe(records[0]!.uuid)
})

test('toLimitlessTranscript: third record parentUuid === second record uuid', () => {
  const t = makeTranscript()
  const records = claudeAdapter.toLimitlessTranscript(t, 'NEW')
  expect(records[2]!.parentUuid).toBe(records[1]!.uuid)
})

test('toLimitlessTranscript: assistant record content is preserved verbatim', () => {
  const t = makeTranscript()
  const records = claudeAdapter.toLimitlessTranscript(t, 'NEW')
  // Second record in JSONL order (index 1) is the assistant line
  const assistantRecord = records.find(r => r.type === 'assistant')
  expect(assistantRecord).toBeDefined()
  expect(assistantRecord!.message.content).toBe('assistant reply')
  expect(assistantRecord!.message.role).toBe('assistant')
})

test('toLimitlessTranscript: isSidechain is false on all records', () => {
  const t = makeTranscript()
  const records = claudeAdapter.toLimitlessTranscript(t, 'NEW')
  for (const r of records) {
    expect(r.isSidechain).toBe(false)
  }
})

test('toLimitlessTranscript: uses t.cwd when set', () => {
  const t = makeTranscript({ cwd: '/p' })
  const records = claudeAdapter.toLimitlessTranscript(t, 'NEW')
  for (const r of records) {
    expect(r.cwd).toBe('/p')
  }
})

test('toLimitlessTranscript: falls back to source cwd when t.cwd is null', () => {
  const t = makeTranscript({ cwd: null })
  const records = claudeAdapter.toLimitlessTranscript(t, 'NEW')
  // Source lines have cwd '/source-cwd'
  for (const r of records) {
    expect(r.cwd).toBe('/source-cwd')
  }
})

test('toLimitlessTranscript: metadata (last-prompt) line is NOT included', () => {
  const t = makeTranscript()
  const records = claudeAdapter.toLimitlessTranscript(t, 'NEW')
  // Confirm none have type 'last-prompt'
  for (const r of records) {
    expect(r.type === 'user' || r.type === 'assistant').toBe(true)
  }
  // Confirm count is exactly 3 (not 4)
  expect(records).toHaveLength(3)
})

// ---------------------------------------------------------------------------
// summarize
// ---------------------------------------------------------------------------

test('summarize: contains header with sessionId and sessionName', () => {
  const t = makeTranscript()
  const summary = claudeAdapter.summarize(t)
  expect(summary).toContain('Resumed from Claude session OLD')
  expect(summary).toContain('Test Session')
})

test('summarize: result is <= 4096 characters', () => {
  const t = makeTranscript()
  const summary = claudeAdapter.summarize(t)
  expect(summary.length).toBeLessThanOrEqual(4096)
})

test('summarize: contains message content from the transcript', () => {
  const t = makeTranscript()
  const summary = claudeAdapter.summarize(t)
  expect(summary).toContain('first user message')
})
