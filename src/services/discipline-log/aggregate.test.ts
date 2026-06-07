import { describe, expect, it } from 'bun:test'
import {
  emptyAggregation,
  fold,
  formatReport,
  parseLine,
  sortedCounts,
  topN,
  type LooseEvent,
} from './aggregate.js'

describe('parseLine', () => {
  it('returns null on empty lines', () => {
    expect(parseLine('')).toBeNull()
    expect(parseLine('   ')).toBeNull()
  })

  it('returns null on malformed JSON', () => {
    expect(parseLine('not json')).toBeNull()
    expect(parseLine('{not: closed')).toBeNull()
  })

  it('returns null on JSON without a kind field', () => {
    expect(parseLine('{}')).toBeNull()
    expect(parseLine('{"turnCount": 1}')).toBeNull()
  })

  it('returns null on JSON with kind that is not a string', () => {
    expect(parseLine('{"kind": 1}')).toBeNull()
  })

  it('parses a well-formed event', () => {
    const ev = parseLine(
      '{"kind":"phase-transition","from":"build","to":"plan","turnCount":1,"timestamp":0}',
    )
    expect(ev).not.toBeNull()
    if (ev) {
      expect(ev.kind).toBe('phase-transition')
      expect(ev.from).toBe('build')
      expect(ev.to).toBe('plan')
    }
  })

  it('accepts events with unknown extra fields (forward compat)', () => {
    const ev = parseLine(
      '{"kind":"future-kind","some_new_field":42,"timestamp":0}',
    )
    expect(ev).not.toBeNull()
    expect(ev?.kind).toBe('future-kind')
  })
})

describe('fold', () => {
  it('counts by kind', () => {
    const agg = emptyAggregation()
    fold(agg, { kind: 'phase-transition' })
    fold(agg, { kind: 'phase-transition' })
    fold(agg, { kind: 'verification-write' })
    expect(agg.total).toBe(3)
    expect(agg.byKind.get('phase-transition')).toBe(2)
    expect(agg.byKind.get('verification-write')).toBe(1)
  })

  it('splits gate-blocked by tool + gate', () => {
    const agg = emptyAggregation()
    fold(agg, {
      kind: 'gate-blocked',
      toolName: 'Edit',
      gate: 'phase-restriction',
    })
    fold(agg, {
      kind: 'gate-blocked',
      toolName: 'Edit',
      gate: 'saturation-redirect',
    })
    fold(agg, {
      kind: 'gate-blocked',
      toolName: 'Edit',
      gate: 'phase-restriction',
    })
    expect(agg.gateBlockedByTool.get('Edit (phase-restriction)')).toBe(2)
    expect(agg.gateBlockedByTool.get('Edit (saturation-redirect)')).toBe(1)
  })

  it('aggregates tamper-block paths', () => {
    const agg = emptyAggregation()
    fold(agg, { kind: 'tamper-block', targetPath: '/x/query.ts' })
    fold(agg, { kind: 'tamper-block', targetPath: '/x/query.ts' })
    fold(agg, { kind: 'tamper-block', targetPath: '/x/hooks.ts' })
    expect(agg.tamperBlockPaths.get('/x/query.ts')).toBe(2)
    expect(agg.tamperBlockPaths.get('/x/hooks.ts')).toBe(1)
  })

  it('extracts ledger source from nested entry field', () => {
    const agg = emptyAggregation()
    fold(agg, {
      kind: 'verification-write',
      entry: { source: 'tool' },
    })
    fold(agg, {
      kind: 'verification-write',
      entry: { source: 'agent' },
    })
    fold(agg, {
      kind: 'verification-write',
      entry: { source: 'tool' },
    })
    expect(agg.ledgerBySource.get('tool')).toBe(2)
    expect(agg.ledgerBySource.get('agent')).toBe(1)
  })

  it('records phase transitions as from→to edges', () => {
    const agg = emptyAggregation()
    fold(agg, { kind: 'phase-transition', from: 'build', to: 'plan' })
    fold(agg, { kind: 'phase-transition', from: 'plan', to: 'build' })
    fold(agg, { kind: 'phase-transition', from: 'build', to: 'plan' })
    expect(agg.phaseTransitions.get('build → plan')).toBe(2)
    expect(agg.phaseTransitions.get('plan → build')).toBe(1)
  })

  it('groups saturation-trip by phase', () => {
    const agg = emptyAggregation()
    fold(agg, { kind: 'saturation-trip', phase: 'build' })
    fold(agg, { kind: 'saturation-trip', phase: 'refine' })
    fold(agg, { kind: 'saturation-trip', phase: 'build' })
    expect(agg.saturationTripsByPhase.get('build')).toBe(2)
    expect(agg.saturationTripsByPhase.get('refine')).toBe(1)
  })

  it('handles missing fields with "?" placeholders', () => {
    const agg = emptyAggregation()
    fold(agg, { kind: 'gate-blocked' })
    fold(agg, { kind: 'tamper-block' })
    fold(agg, { kind: 'verification-write' })
    expect(agg.gateBlockedByTool.get('? (unknown)')).toBe(1)
    expect(agg.tamperBlockPaths.get('?')).toBe(1)
    expect(agg.ledgerBySource.get('?')).toBe(1)
  })

  it('does not crash on unknown event kinds (forward compat)', () => {
    const agg = emptyAggregation()
    fold(agg, { kind: 'future-kind' } as LooseEvent)
    expect(agg.total).toBe(1)
    expect(agg.byKind.get('future-kind')).toBe(1)
  })
})

describe('sortedCounts', () => {
  it('sorts by count descending', () => {
    const m = new Map([
      ['a', 1],
      ['b', 5],
      ['c', 3],
    ])
    expect(sortedCounts(m).map(([k]) => k)).toEqual(['b', 'c', 'a'])
  })

  it('breaks ties alphabetically', () => {
    const m = new Map([
      ['banana', 2],
      ['apple', 2],
      ['cherry', 2],
    ])
    expect(sortedCounts(m).map(([k]) => k)).toEqual([
      'apple',
      'banana',
      'cherry',
    ])
  })

  it('returns [] on empty map', () => {
    expect(sortedCounts(new Map())).toEqual([])
  })
})

describe('topN', () => {
  it('returns the input unchanged when limit is null', () => {
    const rows: Array<[string, number]> = [['a', 1], ['b', 2]]
    expect(topN(rows, null)).toBe(rows)
  })

  it('truncates to the first N entries', () => {
    const rows: Array<[string, number]> = [
      ['a', 5],
      ['b', 4],
      ['c', 3],
      ['d', 2],
    ]
    expect(topN(rows, 2)).toEqual([
      ['a', 5],
      ['b', 4],
    ])
  })

  it('clamps negative limits to 0', () => {
    const rows: Array<[string, number]> = [['a', 1]]
    expect(topN(rows, -5)).toEqual([])
  })

  it('returns full array when limit exceeds length', () => {
    const rows: Array<[string, number]> = [['a', 1]]
    expect(topN(rows, 100)).toEqual([['a', 1]])
  })
})

describe('formatReport', () => {
  it('renders a fresh aggregation as empty sections', () => {
    const out = formatReport(emptyAggregation())
    expect(out).toContain('Total events: 0')
    expect(out).toContain('Events by kind')
    expect(out).toContain('(none)')
  })

  it('renders a populated aggregation with all sections', () => {
    const agg = emptyAggregation()
    fold(agg, { kind: 'phase-transition', from: 'build', to: 'plan' })
    fold(agg, {
      kind: 'gate-blocked',
      toolName: 'Edit',
      gate: 'phase-restriction',
    })
    fold(agg, {
      kind: 'verification-write',
      entry: { source: 'tool' },
    })
    const out = formatReport(agg)
    expect(out).toContain('Total events: 3')
    expect(out).toContain('phase-transition')
    expect(out).toContain('Edit (phase-restriction)')
    expect(out).toContain('build → plan')
  })

  it('produces stable output across runs (sort is deterministic)', () => {
    const agg = emptyAggregation()
    for (const kind of ['z', 'a', 'm', 'b', 'a']) {
      fold(agg, { kind })
    }
    const first = formatReport(agg)
    const second = formatReport(agg)
    expect(first).toBe(second)
  })
})
