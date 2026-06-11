import { expect, test, afterEach } from 'bun:test'
import { mkdtempSync, writeFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { genericAdapter } from '../../../src/services/crossHarness/adapters/genericAdapter.js'
import type { DiscoveredTranscript } from '../../../src/services/crossHarness/harnessTypes.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const tmpDirs: string[] = []

function makeTmpDir(): string {
  const d = mkdtempSync(join(tmpdir(), 'xharness-generic-'))
  tmpDirs.push(d)
  return d
}

function makeTranscript(overrides: Partial<DiscoveredTranscript> = {}): DiscoveredTranscript {
  return {
    harness: 'unknown',
    path: '/fake/path.jsonl',
    sessionId: 'test-session-id',
    sessionName: 'Test Session',
    firstPrompt: 'hello',
    cwd: '/fake/cwd',
    messageCount: 0,
    modifiedMs: Date.now(),
    ...overrides,
  }
}

afterEach(() => {
  for (const d of tmpDirs.splice(0)) {
    try { rmSync(d, { recursive: true, force: true }) } catch {}
  }
})

// ---------------------------------------------------------------------------
// Test 1: JSONL with extractable role+text lines
// ---------------------------------------------------------------------------

test('toLimitlessTranscript: extracts 2 records from valid JSONL, bot mapped to user', () => {
  const dir = makeTmpDir()
  const filePath = join(dir, 'transcript.jsonl')

  // Line 1: has role + text  (explicit user role)
  // Line 2: has role 'bot' + content (bot should be mapped to 'user'; only 'assistant' stays)
  const lines = [
    JSON.stringify({ role: 'user', text: 'q1' }),
    JSON.stringify({ role: 'bot', content: 'a1' }),
  ]
  writeFileSync(filePath, lines.join('\n') + '\n')

  const t = makeTranscript({ path: filePath })
  const messages = genericAdapter.toLimitlessTranscript(t, 'NEW')

  // Should produce exactly 2 records
  expect(messages).toHaveLength(2)

  // First record: role 'user', content 'q1', parentUuid null, sessionId 'NEW'
  const first = messages[0]!
  expect(first.message.role).toBe('user')
  expect(first.message.content).toBe('q1')
  expect(first.parentUuid).toBeNull()
  expect(first.sessionId).toBe('NEW')

  // Second record: role 'user' (bot mapped to user), content 'a1'
  const second = messages[1]!
  expect(second.message.role).toBe('user')
  expect(second.message.content).toBe('a1')
  // Parent chain: second's parentUuid should equal first's uuid
  expect(second.parentUuid).toBe(first.uuid)
  expect(second.sessionId).toBe('NEW')
})

// ---------------------------------------------------------------------------
// Test 2: NON-extractable JSON → single fallback record
// ---------------------------------------------------------------------------

test('toLimitlessTranscript: non-extractable JSON produces 1 fallback record', () => {
  const dir = makeTmpDir()
  const filePath = join(dir, 'weird.jsonl')

  // Lines that have no role, no text, no content — not extractable
  const lines = [
    JSON.stringify({ foo: 1 }),
    JSON.stringify({ bar: 2 }),
  ]
  const rawContent = lines.join('\n') + '\n'
  writeFileSync(filePath, rawContent)

  const t = makeTranscript({ path: filePath, sessionId: 'SID-999', sessionName: 'Weird Session' })
  const messages = genericAdapter.toLimitlessTranscript(t, 'NEWSID')

  // Exactly one fallback record
  expect(messages).toHaveLength(1)

  const rec = messages[0]!
  expect(rec.message.role).toBe('user')
  // Content should contain the marker phrase
  expect(rec.message.content).toContain('Imported transcript (unrecognized format)')
  // Content should also contain the raw file text
  expect(rec.message.content).toContain(rawContent.trim())
})

// ---------------------------------------------------------------------------
// Test 3: summarize returns expected header
// ---------------------------------------------------------------------------

test('summarize: returns header containing sessionId and sessionName', () => {
  const dir = makeTmpDir()
  const filePath = join(dir, 'transcript2.jsonl')

  const lines = [JSON.stringify({ role: 'user', text: 'hello from summarize test' })]
  writeFileSync(filePath, lines.join('\n') + '\n')

  const t = makeTranscript({
    path: filePath,
    sessionId: 'SID-SUMMARIZE',
    sessionName: 'My Summary Session',
  })
  const summary = genericAdapter.summarize(t)

  expect(summary).toContain('Resumed from imported transcript')
  expect(summary).toContain('SID-SUMMARIZE')
  expect(summary).toContain('My Summary Session')
})

// ---------------------------------------------------------------------------
// Test 4: 'assistant' role stays 'assistant'; non-assistant → 'user'
// ---------------------------------------------------------------------------

test('toLimitlessTranscript: assistant role preserved, all others become user', () => {
  const dir = makeTmpDir()
  const filePath = join(dir, 'roles.jsonl')

  const lines = [
    JSON.stringify({ role: 'assistant', text: 'I am the assistant' }),
    JSON.stringify({ role: 'system', text: 'system prompt' }),
    JSON.stringify({ role: 'tool', content: 'tool output' }),
  ]
  writeFileSync(filePath, lines.join('\n') + '\n')

  const t = makeTranscript({ path: filePath })
  const messages = genericAdapter.toLimitlessTranscript(t, 'SID')

  expect(messages).toHaveLength(3)
  expect(messages[0]!.message.role).toBe('assistant')
  expect(messages[1]!.message.role).toBe('user')
  expect(messages[2]!.message.role).toBe('user')
})

// ---------------------------------------------------------------------------
// Test 5: adapter declares harness 'unknown'
// ---------------------------------------------------------------------------

test('genericAdapter.harness is "unknown"', () => {
  expect(genericAdapter.harness).toBe('unknown')
})
