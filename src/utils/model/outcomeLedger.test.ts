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
  joinCheckerVerdicts,
  LEDGER_RELATIVE_PATH,
  MIN_RELIABLE_N,
  type LedgerEntry,
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

// ─── task_category field ──────────────────────────────────────────────────────

describe('task_category on LedgerEntry', () => {
  let dir: string
  beforeEach(() => { dir = makeTmpDir() })
  afterEach(() => { fs.rmSync(dir, { recursive: true }) })

  test('task_category is accepted on LedgerEntry and survives round-trip through readLedgerEntries', () => {
    const entryWithCategory = { ...GOOD_ENTRY, task_category: 'implementation' }
    writeLedger(dir, [JSON.stringify(entryWithCategory)])
    const [entry] = readLedgerEntries(dir)
    // TypeScript allows optional task_category on LedgerEntry — access must not error
    expect((entry as typeof entry & { task_category?: string | null }).task_category).toBe('implementation')
  })

  test('absent task_category parses as undefined (not an error)', () => {
    writeLedger(dir, [JSON.stringify(GOOD_ENTRY)])
    const [entry] = readLedgerEntries(dir)
    // GOOD_ENTRY has no task_category — field should be undefined, not throw
    expect('task_category' in (entry ?? {})).toBe(false)
  })

  test('null task_category is preserved through readLedgerEntries', () => {
    const entryNullCategory = { ...GOOD_ENTRY, task_category: null }
    writeLedger(dir, [JSON.stringify(entryNullCategory)])
    const [entry] = readLedgerEntries(dir)
    expect((entry as typeof entry & { task_category?: string | null }).task_category).toBeNull()
  })

  test('aggregateLedgerStats produces same cell count with or without task_category — field is NOT a key dimension', () => {
    // Two entries that differ only in task_category must map to the same cell.
    const base = { persona: 'openralph-builder', workload: 'long-running', provider_model_used: 'model-z', status: 'complete', tests_passed: true }
    const entries = [
      { ...base, task_category: 'implementation' },
      { ...base, task_category: 'debugging' },
      { ...base, task_category: null },
    ]
    const stats = aggregateLedgerStats(entries)
    // All three belong to the same (persona, workload, model) cell
    expect(stats).toHaveLength(1)
    expect(stats[0]?.n).toBe(3)
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

// ─── joinCheckerVerdicts ──────────────────────────────────────────────────────

describe('joinCheckerVerdicts', () => {
  const worker = (slug: string, ts = '2026-06-09T10:00:00Z'): LedgerEntry => ({
    ts,
    task_slug: slug,
    persona: 'openralph-builder',
    workload: 'long-running',
    provider_model_used: 'model-a',
    status: 'complete',
    tests_passed: true,
  })

  const checker = (slug: string, goal_met: boolean | null, ts = '2026-06-09T11:00:00Z'): LedgerEntry => ({
    ts,
    task_slug: slug,
    persona: 'openralph-checker',
    workload: 'long-running',
    provider_model_used: 'model-b',
    status: 'complete',
    goal_met,
  })

  test('empty input returns empty output', () => {
    expect(joinCheckerVerdicts([])).toEqual([])
  })

  test('worker with matching checker → checker_goal_met from checker row', () => {
    const entries = [worker('task-a'), checker('task-a', true)]
    const result = joinCheckerVerdicts(entries)
    expect(result).toHaveLength(1)
    expect(result[0]?.checker_goal_met).toBe(true)
    expect(result[0]?.task_slug).toBe('task-a')
  })

  test('worker with no matching checker → checker_goal_met is null', () => {
    const entries = [worker('task-a')]
    const result = joinCheckerVerdicts(entries)
    expect(result).toHaveLength(1)
    expect(result[0]?.checker_goal_met).toBeNull()
  })

  test('checker without matching worker is not in output (checker rows excluded)', () => {
    const entries = [checker('task-orphan', true)]
    const result = joinCheckerVerdicts(entries)
    expect(result).toHaveLength(0)
  })

  test('multiple checkers for same slug: latest ts wins', () => {
    const entries = [
      worker('task-b'),
      checker('task-b', false, '2026-06-09T10:00:00Z'),
      checker('task-b', true, '2026-06-09T12:00:00Z'), // later → wins
    ]
    const result = joinCheckerVerdicts(entries)
    expect(result).toHaveLength(1)
    expect(result[0]?.checker_goal_met).toBe(true)
  })

  test('multiple checkers: later in array wins when ts equal', () => {
    const sameTs = '2026-06-09T10:00:00Z'
    const entries = [
      worker('task-c'),
      checker('task-c', false, sameTs),
      checker('task-c', true, sameTs), // same ts, later in array → wins
    ]
    const result = joinCheckerVerdicts(entries)
    expect(result).toHaveLength(1)
    expect(result[0]?.checker_goal_met).toBe(true)
  })

  test('checker with goal_met null → checker_goal_met null (no-verdict checker is absence)', () => {
    const entries = [worker('task-d'), checker('task-d', null)]
    const result = joinCheckerVerdicts(entries)
    expect(result).toHaveLength(1)
    expect(result[0]?.checker_goal_met).toBeNull()
  })

  test('multiple workers — each gets its own verdict (different slugs)', () => {
    const entries = [
      worker('slug-1'),
      worker('slug-2'),
      checker('slug-1', true),
      checker('slug-2', false),
    ]
    const result = joinCheckerVerdicts(entries)
    expect(result).toHaveLength(2)
    const r1 = result.find(r => r.task_slug === 'slug-1')!
    const r2 = result.find(r => r.task_slug === 'slug-2')!
    expect(r1.checker_goal_met).toBe(true)
    expect(r2.checker_goal_met).toBe(false)
  })

  test('worker with null task_slug → checker_goal_met null (cannot join on null slug)', () => {
    const nullSlugWorker: LedgerEntry = {
      task_slug: null,
      persona: 'openralph-builder',
      workload: 'long-running',
      provider_model_used: 'model-a',
      status: 'complete',
      tests_passed: true,
    }
    const entries = [nullSlugWorker, checker('some-slug', true)]
    const result = joinCheckerVerdicts(entries)
    expect(result).toHaveLength(1)
    expect(result[0]?.checker_goal_met).toBeNull()
  })

  test('non-openralph entries pass through with checker_goal_met null', () => {
    const nonRalph: LedgerEntry = {
      task_slug: 'task-x',
      persona: 'some-other-persona',
      workload: 'bounded',
      provider_model_used: 'model-c',
      status: 'complete',
    }
    const result = joinCheckerVerdicts([nonRalph])
    expect(result).toHaveLength(1)
    expect(result[0]?.checker_goal_met).toBeNull()
  })
})

// ─── aggregateLedgerStats — checker-verified mode ─────────────────────────────

describe('aggregateLedgerStats — checker-verified successDefinition', () => {
  const workerEntry = (slug: string, isSuccess: boolean, checker_goal_met: boolean | null) => ({
    task_slug: slug,
    persona: 'openralph-builder',
    workload: 'long-running',
    provider_model_used: 'model-a',
    status: isSuccess ? 'complete' : 'partial',
    tests_passed: isSuccess ? (true as boolean | null) : (false as boolean | null),
    checker_goal_met,
  })

  test('checker-verified: success only when isSuccess AND checker_goal_met true', () => {
    const entries = [
      workerEntry('t1', true, true),   // success + verified → counted
      workerEntry('t2', true, false),  // success but checker says no → not a success
      workerEntry('t3', false, true),  // not self-success → not a success
    ]
    const stats = aggregateLedgerStats(entries, { successDefinition: 'checker-verified' })
    expect(stats).toHaveLength(1)
    expect(stats[0]?.n).toBe(3)
    expect(stats[0]?.successes).toBe(1)
    expect(stats[0]?.successRate).toBeCloseTo(1 / 3)
  })

  test('checker-verified: rows with checker_goal_met null are excluded entirely', () => {
    const entries = [
      workerEntry('t1', true, true),   // included: verified success
      workerEntry('t2', true, null),   // excluded: no verdict
      workerEntry('t3', false, null),  // excluded: no verdict
    ]
    const stats = aggregateLedgerStats(entries, { successDefinition: 'checker-verified' })
    // Only t1 is included; t2 and t3 are absent from n
    expect(stats).toHaveLength(1)
    expect(stats[0]?.n).toBe(1)
    expect(stats[0]?.successes).toBe(1)
    expect(stats[0]?.successRate).toBe(1)
  })

  test('checker-verified: checker rows excluded from output cells', () => {
    const checkerEntry = {
      task_slug: 't1',
      persona: 'openralph-checker',
      workload: 'long-running',
      provider_model_used: 'model-b',
      status: 'complete',
      goal_met: true,
      checker_goal_met: null,
    }
    const workerWithVerdict = workerEntry('t1', true, true)
    const stats = aggregateLedgerStats([workerWithVerdict, checkerEntry], { successDefinition: 'checker-verified' })
    // Only the worker row should appear — checker is excluded
    expect(stats).toHaveLength(1)
    expect(stats[0]?.persona).toBe('openralph-builder')
  })

  test('checker-verified with no verified rows → empty stats', () => {
    const entries = [
      workerEntry('t1', true, null),
      workerEntry('t2', false, null),
    ]
    const stats = aggregateLedgerStats(entries, { successDefinition: 'checker-verified' })
    expect(stats).toHaveLength(0)
  })

  test('default mode (self) is unchanged — no behavior change for existing consumers', () => {
    const entries = [
      { persona: 'openralph-builder', workload: 'w', provider_model_used: 'm', status: 'complete', tests_passed: true },
      { persona: 'openralph-builder', workload: 'w', provider_model_used: 'm', status: 'complete', tests_passed: false },
    ]
    // 'self' (implicit default)
    const selfStats = aggregateLedgerStats(entries)
    expect(selfStats[0]?.n).toBe(2)
    expect(selfStats[0]?.successes).toBe(1)

    // Explicit 'self'
    const selfExplicit = aggregateLedgerStats(entries, { successDefinition: 'self' })
    expect(selfExplicit[0]?.n).toBe(2)
    expect(selfExplicit[0]?.successes).toBe(1)
  })

  test('joinCheckerVerdicts + checker-verified round-trip via aggregateLedgerStats', () => {
    // Build raw entries with one worker and one matching checker
    const rawEntries: LedgerEntry[] = [
      {
        ts: '2026-06-09T10:00:00Z',
        task_slug: 'feat-x',
        persona: 'openralph-builder',
        workload: 'long-running',
        provider_model_used: 'model-a',
        status: 'complete',
        tests_passed: true,
      },
      {
        ts: '2026-06-09T11:00:00Z',
        task_slug: 'feat-x',
        persona: 'openralph-checker',
        workload: 'long-running',
        provider_model_used: 'model-b',
        status: 'complete',
        goal_met: true,
      },
    ]
    const annotated = joinCheckerVerdicts(rawEntries)
    const stats = aggregateLedgerStats(annotated, { successDefinition: 'checker-verified' })
    expect(stats).toHaveLength(1)
    expect(stats[0]?.n).toBe(1)
    expect(stats[0]?.successes).toBe(1)
    expect(stats[0]?.successRate).toBe(1)
    expect(stats[0]?.persona).toBe('openralph-builder')
  })
})
