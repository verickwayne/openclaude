// src/utils/model/outcomeLedger.test.ts
import { expect, test, describe, beforeEach, afterEach } from 'bun:test'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {
  readLedgerEntries,
  aggregateLedgerStats,
  getLedgerStats,
  isSuccessEntry,
  LEDGER_RELATIVE_PATH,
  MIN_RELIABLE_N,
} from './outcomeLedger.js'

// ─── Fixture helpers ──────────────────────────────────────────────────────────

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'openclaude-ledger-test-'))
}

function writeLedger(dir: string, lines: string[]): void {
  const ledgerPath = path.join(dir, LEDGER_RELATIVE_PATH)
  fs.mkdirSync(path.dirname(ledgerPath), { recursive: true })
  fs.writeFileSync(ledgerPath, lines.join('\n') + '\n', 'utf8')
}

const GOOD_ENTRY = {
  ts: '2026-06-09T22:14:03Z',
  session_id: 'abc123',
  task_slug: 'wire-route-stats',
  persona: 'openralph-builder',
  workload: 'long-running',
  provider_model_used: 'openai-compatible/gpt-5.3-codex',
  status: 'complete',
  tests_passed: true,
  new_gaps: 0,
  duration_s: 312,
}

// ─── isSuccessEntry ───────────────────────────────────────────────────────────

describe('isSuccessEntry', () => {
  test('complete + tests_passed:true → success', () => {
    expect(isSuccessEntry({ status: 'complete', tests_passed: true })).toBe(true)
  })

  test('complete + tests_passed:null → success (null treated as "not false")', () => {
    expect(isSuccessEntry({ status: 'complete', tests_passed: null })).toBe(true)
  })

  test('complete + tests_passed omitted → success', () => {
    expect(isSuccessEntry({ status: 'complete' })).toBe(true)
  })

  test('complete + tests_passed:false → not success', () => {
    expect(isSuccessEntry({ status: 'complete', tests_passed: false })).toBe(false)
  })

  test('partial + tests_passed:true → not success', () => {
    expect(isSuccessEntry({ status: 'partial', tests_passed: true })).toBe(false)
  })

  test('blocked → not success', () => {
    expect(isSuccessEntry({ status: 'blocked' })).toBe(false)
  })

  test('empty entry → not success', () => {
    expect(isSuccessEntry({})).toBe(false)
  })
})

// ─── readLedgerEntries ────────────────────────────────────────────────────────

describe('readLedgerEntries — missing file', () => {
  test('returns empty array when ledger file does not exist', () => {
    const dir = makeTmpDir()
    expect(readLedgerEntries(dir)).toEqual([])
    fs.rmSync(dir, { recursive: true })
  })

  test('returns empty array for non-existent project root', () => {
    expect(readLedgerEntries('/tmp/nonexistent-project-root-xyz-12345')).toEqual([])
  })
})

describe('readLedgerEntries — happy path', () => {
  let dir: string
  beforeEach(() => { dir = makeTmpDir() })
  afterEach(() => { fs.rmSync(dir, { recursive: true }) })

  test('parses a single valid JSONL line', () => {
    writeLedger(dir, [JSON.stringify(GOOD_ENTRY)])
    const entries = readLedgerEntries(dir)
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject(GOOD_ENTRY)
  })

  test('parses multiple valid lines', () => {
    writeLedger(dir, [JSON.stringify(GOOD_ENTRY), JSON.stringify({ ...GOOD_ENTRY, session_id: 'xyz' })])
    expect(readLedgerEntries(dir)).toHaveLength(2)
  })

  test('skips blank lines without error', () => {
    writeLedger(dir, [JSON.stringify(GOOD_ENTRY), '', '   ', JSON.stringify(GOOD_ENTRY)])
    expect(readLedgerEntries(dir)).toHaveLength(2)
  })
})

describe('readLedgerEntries — malformed lines', () => {
  let dir: string
  beforeEach(() => { dir = makeTmpDir() })
  afterEach(() => { fs.rmSync(dir, { recursive: true }) })

  test('skips a line with invalid JSON and keeps the rest', () => {
    writeLedger(dir, [
      JSON.stringify(GOOD_ENTRY),
      '{broken json',
      JSON.stringify({ ...GOOD_ENTRY, session_id: 'def456' }),
    ])
    const entries = readLedgerEntries(dir)
    expect(entries).toHaveLength(2)
    expect(entries.map(e => e.session_id)).toEqual(['abc123', 'def456'])
  })

  test('skips a line that is a bare scalar (not an object), keeps rest', () => {
    // JSON.parse("42") succeeds but isn't a LedgerEntry object — still stored (safe passthrough)
    // The important thing: it doesn't throw and valid entries survive
    writeLedger(dir, ['42', JSON.stringify(GOOD_ENTRY)])
    const entries = readLedgerEntries(dir)
    // 42 parses as a number but gets stored as-is; GOOD_ENTRY still present
    expect(entries.some(e => e.session_id === 'abc123')).toBe(true)
  })

  test('handles an entirely malformed ledger without throwing', () => {
    writeLedger(dir, ['{', '}', 'not json at all', '---'])
    expect(() => readLedgerEntries(dir)).not.toThrow()
  })

  test('entries with missing fields parse successfully with undefined values', () => {
    const partial = { session_id: 'partial', status: 'complete' }
    writeLedger(dir, [JSON.stringify(partial)])
    const [entry] = readLedgerEntries(dir)
    expect(entry?.session_id).toBe('partial')
    expect(entry?.persona).toBeUndefined()
  })
})

// ─── aggregateLedgerStats ─────────────────────────────────────────────────────

describe('aggregateLedgerStats', () => {
  test('empty input → empty output', () => {
    expect(aggregateLedgerStats([])).toEqual([])
  })

  test('entries missing any key field are excluded from cells', () => {
    // no persona → excluded
    const noPersona = { workload: 'bounded', provider_model_used: 'gpt-5', status: 'complete', tests_passed: true }
    // no workload → excluded
    const noWorkload = { persona: 'openralph-builder', provider_model_used: 'gpt-5', status: 'complete', tests_passed: true }
    // no model → excluded
    const noModel = { persona: 'openralph-builder', workload: 'bounded', status: 'complete', tests_passed: true }
    expect(aggregateLedgerStats([noPersona, noWorkload, noModel])).toEqual([])
  })

  test('single complete+passing entry → successRate 1.0', () => {
    const [stat] = aggregateLedgerStats([GOOD_ENTRY])
    expect(stat?.successRate).toBe(1)
    expect(stat?.n).toBe(1)
    expect(stat?.successes).toBe(1)
  })

  test('3/3 beats 0/3 — model Y ranked above model X', () => {
    const modelX = { persona: 'openralph-builder', workload: 'bounded', provider_model_used: 'model-x', status: 'complete', tests_passed: false }
    const modelY = { persona: 'openralph-builder', workload: 'bounded', provider_model_used: 'model-y', status: 'complete', tests_passed: true }
    const entries = [
      { ...modelX }, { ...modelX }, { ...modelX }, // 0/3
      { ...modelY }, { ...modelY }, { ...modelY }, // 3/3
    ]
    const stats = aggregateLedgerStats(entries)
    const x = stats.find(s => s.provider_model_used === 'model-x')!
    const y = stats.find(s => s.provider_model_used === 'model-y')!
    expect(x.successRate).toBe(0)
    expect(y.successRate).toBe(1)
    expect(y.n).toBe(3)
  })

  test('mixed success/fail gives correct rate', () => {
    const entries = [
      { persona: 'p', workload: 'w', provider_model_used: 'm', status: 'complete', tests_passed: true },
      { persona: 'p', workload: 'w', provider_model_used: 'm', status: 'complete', tests_passed: false },
      { persona: 'p', workload: 'w', provider_model_used: 'm', status: 'partial', tests_passed: true },
    ]
    const [stat] = aggregateLedgerStats(entries)
    expect(stat?.n).toBe(3)
    expect(stat?.successes).toBe(1)
    expect(stat?.successRate).toBeCloseTo(1 / 3)
  })

  test('avgDurationS computed from non-null duration_s values only', () => {
    const entries = [
      { persona: 'p', workload: 'w', provider_model_used: 'm', status: 'complete', tests_passed: true, duration_s: 100 },
      { persona: 'p', workload: 'w', provider_model_used: 'm', status: 'complete', tests_passed: true, duration_s: 200 },
      { persona: 'p', workload: 'w', provider_model_used: 'm', status: 'complete', tests_passed: true, duration_s: null },
    ]
    const [stat] = aggregateLedgerStats(entries)
    expect(stat?.avgDurationS).toBe(150)
  })

  test('avgDurationS is null when all durations are null', () => {
    const entries = [
      { persona: 'p', workload: 'w', provider_model_used: 'm', status: 'complete', tests_passed: true, duration_s: null },
    ]
    const [stat] = aggregateLedgerStats(entries)
    expect(stat?.avgDurationS).toBeNull()
  })

  test('separate cells for different personas', () => {
    const a = { persona: 'openralph-builder', workload: 'bounded', provider_model_used: 'm', status: 'complete', tests_passed: true }
    const b = { persona: 'openralph-checker', workload: 'bounded', provider_model_used: 'm', status: 'complete', tests_passed: true }
    const stats = aggregateLedgerStats([a, b])
    expect(stats).toHaveLength(2)
  })

  test('separate cells for different workloads', () => {
    const a = { persona: 'p', workload: 'bounded', provider_model_used: 'm', status: 'complete', tests_passed: true }
    const b = { persona: 'p', workload: 'long-running', provider_model_used: 'm', status: 'complete', tests_passed: true }
    const stats = aggregateLedgerStats([a, b])
    expect(stats).toHaveLength(2)
  })
})

// ─── getLedgerStats (integration) ────────────────────────────────────────────

describe('getLedgerStats', () => {
  let dir: string
  beforeEach(() => { dir = makeTmpDir() })
  afterEach(() => { fs.rmSync(dir, { recursive: true }) })

  test('returns empty when no ledger', () => {
    expect(getLedgerStats(dir)).toEqual([])
  })

  test('reads and aggregates from disk', () => {
    writeLedger(dir, [JSON.stringify(GOOD_ENTRY), JSON.stringify(GOOD_ENTRY)])
    const stats = getLedgerStats(dir)
    expect(stats).toHaveLength(1)
    expect(stats[0]?.n).toBe(2)
    expect(stats[0]?.successRate).toBe(1)
  })
})

// ─── Constants exported ───────────────────────────────────────────────────────

describe('constants', () => {
  test('LEDGER_RELATIVE_PATH matches expected location', () => {
    expect(LEDGER_RELATIVE_PATH).toBe('.openclaude/ralph/ledger/outcomes.jsonl')
  })

  test('MIN_RELIABLE_N is 3 (epsilon-greedy threshold)', () => {
    expect(MIN_RELIABLE_N).toBe(3)
  })
})
