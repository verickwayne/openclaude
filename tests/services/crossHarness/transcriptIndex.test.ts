import { expect, test, beforeEach, afterEach } from 'bun:test'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import type { CrossHarnessIndex, DiscoveredTranscript } from '../../../src/services/crossHarness/harnessTypes.js'
import {
  loadIndex,
  saveIndex,
  searchIndex,
  refreshIndex,
} from '../../../src/services/crossHarness/transcriptIndex.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let tmpDir: string
let indexPath: string

function makeEntry(overrides: Partial<DiscoveredTranscript> = {}): DiscoveredTranscript {
  return {
    harness: 'claude',
    path: '/fake/path.jsonl',
    sessionId: 'aaaa-0000',
    sessionName: 'My session',
    firstPrompt: 'hello there',
    cwd: '/fake',
    messageCount: 3,
    modifiedMs: 1000,
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Setup: redirect the index file to a temp dir via env var
// ---------------------------------------------------------------------------

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'xharness-index-'))
  // Override CLAUDE_CONFIG_DIR so getClaudeConfigHomeDir() points to our tmp dir
  process.env.CLAUDE_CONFIG_DIR = tmpDir
  indexPath = join(tmpDir, 'cross-harness-index.json')
})

afterEach(() => {
  delete process.env.CLAUDE_CONFIG_DIR
  try { rmSync(tmpDir, { recursive: true, force: true }) } catch {}
})

// ---------------------------------------------------------------------------
// Round-trip save/load
// ---------------------------------------------------------------------------

test('loadIndex returns empty index when file missing', () => {
  const idx = loadIndex()
  expect(idx.version).toBe(1)
  expect(idx.entries).toHaveLength(0)
  expect(idx.generatedMs).toBe(0)
})

test('saveIndex + loadIndex round-trips entries', () => {
  const entry = makeEntry({ sessionId: 'sess-1', sessionName: 'Test' })
  const idx: CrossHarnessIndex = { version: 1, generatedMs: 12345, entries: [entry] }
  saveIndex(idx)
  expect(existsSync(indexPath)).toBe(true)
  const loaded = loadIndex()
  expect(loaded.version).toBe(1)
  expect(loaded.generatedMs).toBe(12345)
  expect(loaded.entries).toHaveLength(1)
  expect(loaded.entries[0]!.sessionId).toBe('sess-1')
})

test('loadIndex returns empty index on corrupt file', () => {
  writeFileSync(indexPath, 'not valid json{{{{')
  const idx = loadIndex()
  expect(idx.entries).toHaveLength(0)
})

// ---------------------------------------------------------------------------
// searchIndex ranking
// ---------------------------------------------------------------------------

const ENTRIES: DiscoveredTranscript[] = [
  makeEntry({ sessionId: 'exact-match-id', sessionName: 'Some session', firstPrompt: 'p1', modifiedMs: 1000 }),
  makeEntry({ sessionId: 'prefix-match-id', sessionName: 'Another one', firstPrompt: 'p2', modifiedMs: 2000 }),
  makeEntry({ sessionId: 'other-id', sessionName: 'Session with query word inside', firstPrompt: 'inside query here', modifiedMs: 3000 }),
  makeEntry({ sessionId: 'unrelated', sessionName: 'Completely different', firstPrompt: 'nothing here', modifiedMs: 500 }),
]

const IDX: CrossHarnessIndex = { version: 1, generatedMs: 999, entries: ENTRIES }

test('searchIndex: exact sessionId match ranks first', () => {
  const results = searchIndex(IDX, 'exact-match-id')
  expect(results[0]!.sessionId).toBe('exact-match-id')
})

test('searchIndex: sessionId prefix match ranks second', () => {
  const results = searchIndex(IDX, 'prefix-match')
  expect(results[0]!.sessionId).toBe('prefix-match-id')
})

test('searchIndex: sessionName/firstPrompt substring match', () => {
  const results = searchIndex(IDX, 'query word')
  expect(results.length).toBeGreaterThan(0)
  // Both sessionName and firstPrompt contain "query"
  const ids = results.map(r => r.sessionId)
  expect(ids.includes('other-id')).toBe(true)
})

test('searchIndex: empty query returns all sorted by modifiedMs desc', () => {
  const results = searchIndex(IDX, '')
  expect(results).toHaveLength(ENTRIES.length)
  // Sorted descending by modifiedMs
  for (let i = 0; i < results.length - 1; i++) {
    expect(results[i]!.modifiedMs).toBeGreaterThanOrEqual(results[i + 1]!.modifiedMs)
  }
})

// ---------------------------------------------------------------------------
// refreshIndex — injectable scan fn
// ---------------------------------------------------------------------------

test('refreshIndex persists entries from scan fn', async () => {
  const fakeEntry = makeEntry({ sessionId: 'scanned-id', modifiedMs: 9999 })
  const fakeScan = async () => [fakeEntry]
  const idx = await refreshIndex({ scanFn: fakeScan })
  expect(idx.entries).toHaveLength(1)
  expect(idx.entries[0]!.sessionId).toBe('scanned-id')
  // Persisted to disk
  const loaded = loadIndex()
  expect(loaded.entries[0]!.sessionId).toBe('scanned-id')
})

test('refreshIndex reuses cached entry when file mtime is unchanged', async () => {
  // Seed the index with an entry
  const existingEntry = makeEntry({ sessionId: 'cached-id', modifiedMs: 5000, path: '/some/fake/file.jsonl' })
  saveIndex({ version: 1, generatedMs: 1, entries: [existingEntry] })

  // The scan returns the same path with same mtime — should be reused as-is
  const scannedEntry = makeEntry({ sessionId: 'scanned-id-NEW', modifiedMs: 5000, path: '/some/fake/file.jsonl' })
  const fakeScan = async () => [scannedEntry]

  const idx = await refreshIndex({ scanFn: fakeScan })
  expect(idx.entries).toHaveLength(1)
  // Should keep the cached entry (unchanged mtime)
  expect(idx.entries[0]!.sessionId).toBe('cached-id')
})

test('refreshIndex drops entries whose path no longer exists', async () => {
  // Seed with an entry pointing at a non-existent path
  const ghost = makeEntry({ sessionId: 'ghost-id', path: '/does/not/exist/ever.jsonl', modifiedMs: 1 })
  saveIndex({ version: 1, generatedMs: 1, entries: [ghost] })

  // The scan returns nothing (no file found at that path)
  const fakeScan = async () => []
  const idx = await refreshIndex({ scanFn: fakeScan })
  expect(idx.entries).toHaveLength(0)
})
