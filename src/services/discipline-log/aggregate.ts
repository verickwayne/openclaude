// Pure aggregation helpers for DisciplineEvent JSONL streams. Split out
// from scripts/analyze-discipline-log.ts so the logic is unit-testable
// independently of fs/stdio plumbing.
//
// The shape mirrors DisciplineEvent from src/types/loopDiscipline.ts but
// is intentionally LOOSER (every field optional) so the aggregator can
// process partial / future-versioned log entries without crashing. The
// fail-soft contract matches the rest of the discipline observability
// stack: if input is malformed, drop the row rather than the run.

/** Loose shape — accepts current and forward-compatible event variants. */
export type LooseEvent = {
  kind: string
  turnCount?: number
  phase?: string
  gate?: string
  toolName?: string
  targetPath?: string
  entry?: {
    source?: string
    toolName?: string
  }
  from?: string
  to?: string
  consecutiveNoProgress?: number
  trigger?: string
  reason?: string
  timestamp?: number
}

/** Aggregated counts across a stream of events. */
export type Aggregation = {
  total: number
  byKind: Map<string, number>
  gateBlockedByTool: Map<string, number>
  tamperBlockPaths: Map<string, number>
  ledgerBySource: Map<string, number>
  phaseTransitions: Map<string, number>
  saturationTripsByPhase: Map<string, number>
}

/** Parse a single JSONL line into a LooseEvent or null. */
export function parseLine(line: string): LooseEvent | null {
  const trimmed = line.trim()
  if (trimmed.length === 0) return null
  try {
    const obj = JSON.parse(trimmed) as unknown
    if (
      typeof obj === 'object' &&
      obj !== null &&
      typeof (obj as { kind?: unknown }).kind === 'string'
    ) {
      return obj as LooseEvent
    }
    return null
  } catch {
    return null
  }
}

/** Update an aggregation with one event. Pure; returns the same map references. */
export function fold(agg: Aggregation, event: LooseEvent): void {
  agg.total += 1
  bump(agg.byKind, event.kind)

  switch (event.kind) {
    case 'gate-blocked': {
      const key = `${event.toolName ?? '?'} (${event.gate ?? 'unknown'})`
      bump(agg.gateBlockedByTool, key)
      break
    }
    case 'tamper-block': {
      bump(agg.tamperBlockPaths, event.targetPath ?? '?')
      break
    }
    case 'verification-write': {
      bump(agg.ledgerBySource, event.entry?.source ?? '?')
      break
    }
    case 'phase-transition': {
      const key = `${event.from} → ${event.to}`
      bump(agg.phaseTransitions, key)
      break
    }
    case 'saturation-trip': {
      bump(agg.saturationTripsByPhase, event.phase ?? '?')
      break
    }
    default:
      // Unknown event kind — already counted in byKind; no further split.
      break
  }
}

function bump(map: Map<string, number>, key: string): void {
  map.set(key, (map.get(key) ?? 0) + 1)
}

export function emptyAggregation(): Aggregation {
  return {
    total: 0,
    byKind: new Map(),
    gateBlockedByTool: new Map(),
    tamperBlockPaths: new Map(),
    ledgerBySource: new Map(),
    phaseTransitions: new Map(),
    saturationTripsByPhase: new Map(),
  }
}

/**
 * Sort a map's entries by count descending, breaking ties alphabetically.
 * Used by the report formatter so the output is stable across runs.
 */
export function sortedCounts(map: Map<string, number>): Array<[string, number]> {
  return Array.from(map.entries()).sort(
    (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
  )
}

/**
 * Truncate a sorted-counts list to the top N. Returns the input
 * unchanged when limit is null (no truncation).
 */
export function topN(
  rows: Array<[string, number]>,
  limit: number | null,
): Array<[string, number]> {
  if (limit === null) return rows
  return rows.slice(0, Math.max(0, limit))
}

/**
 * Format an aggregation report as a single multi-line string. Matches
 * the output the CLI script produces — kept here so tests can pin the
 * format without spawning a subprocess.
 */
export function formatReport(agg: Aggregation): string {
  const lines: string[] = []
  lines.push(`Total events: ${agg.total}`)

  lines.push(...sectionLines('Events by kind', sortedCounts(agg.byKind), null))
  lines.push(
    ...sectionLines(
      'Top gate-blocked tools',
      sortedCounts(agg.gateBlockedByTool),
      5,
    ),
  )
  lines.push(
    ...sectionLines(
      'Top tamper-block paths',
      sortedCounts(agg.tamperBlockPaths),
      5,
    ),
  )
  lines.push(
    ...sectionLines(
      'Verification ledger by source',
      sortedCounts(agg.ledgerBySource),
      null,
    ),
  )
  lines.push(
    ...sectionLines('Phase transitions', sortedCounts(agg.phaseTransitions), null),
  )
  lines.push(
    ...sectionLines(
      'Saturation trips by phase',
      sortedCounts(agg.saturationTripsByPhase),
      5,
    ),
  )

  return lines.join('\n')
}

function sectionLines(
  title: string,
  rows: Array<[string, number]>,
  limit: number | null,
): string[] {
  const out: string[] = ['', title, '─'.repeat(title.length)]
  const display = topN(rows, limit)
  if (display.length === 0) {
    out.push('  (none)')
    return out
  }
  const widest = Math.max(...display.map(([k]) => k.length))
  for (const [k, v] of display) {
    out.push(`  ${k.padEnd(widest)}  ${v}`)
  }
  return out
}
