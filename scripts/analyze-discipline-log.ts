#!/usr/bin/env bun
// Aggregate one or more OPENCLAUDE_DISCIPLINE_EVENT_LOG JSONL files and
// print a readable cross-session summary.
//
// Usage:
//   bun scripts/analyze-discipline-log.ts <path1.jsonl> [path2.jsonl …]
//
// Output sections:
//   - Total events + per-kind counts (sorted by count desc).
//   - Top 5 tools that fired gate-blocked events.
//   - Verification ledger source distribution (agent / tool / hook / human).
//   - Phase transition arc — counts of each from→to edge.
//   - Top 5 saturation-trip phases.
//
// Exits 1 on no input or unreadable files; 0 on success.
//
// Closes the analysis gap from Workstream 3 ("anything that increases
// the harness's effectiveness") — operators answer "which patterns
// actually fire?" without writing custom jq pipelines.

import * as fs from 'node:fs'
import * as readline from 'node:readline'

type Event = {
  kind: string
  turnCount: number
  phase?: string
  // gate-blocked
  gate?: string
  toolName?: string
  // tamper-block
  targetPath?: string
  // verification-write
  entry?: {
    source: string
    toolName?: string
  }
  // phase-transition
  from?: string
  to?: string
  // saturation-trip / saturation-reset
  consecutiveNoProgress?: number
  trigger?: string
  reason?: string
  timestamp?: number
}

async function readEvents(path: string): Promise<Event[]> {
  const stream = fs.createReadStream(path, { encoding: 'utf-8' })
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity })
  const events: Event[] = []
  for await (const line of rl) {
    const trimmed = line.trim()
    if (trimmed.length === 0) continue
    try {
      const parsed = JSON.parse(trimmed) as Event
      events.push(parsed)
    } catch {
      // Skip malformed lines silently — pre-truncation noise, partial
      // writes during ctrl-c, etc.
    }
  }
  return events
}

function sortedCounts(map: Map<string, number>): Array<[string, number]> {
  return Array.from(map.entries()).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
}

function printSection(title: string, rows: Array<[string, number]>, limit: number | null = null): void {
  console.log(`\n${title}`)
  console.log('─'.repeat(title.length))
  const display = limit !== null ? rows.slice(0, limit) : rows
  if (display.length === 0) {
    console.log('  (none)')
    return
  }
  const widest = Math.max(...display.map(([k]) => k.length))
  for (const [k, v] of display) {
    console.log(`  ${k.padEnd(widest)}  ${v}`)
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  if (args.length === 0) {
    console.error('usage: bun scripts/analyze-discipline-log.ts <path1.jsonl> [...]')
    process.exit(1)
  }

  const allEvents: Event[] = []
  for (const path of args) {
    try {
      const evs = await readEvents(path)
      allEvents.push(...evs)
      console.error(`read ${evs.length} events from ${path}`)
    } catch (err) {
      console.error(`failed to read ${path}: ${(err as Error).message}`)
      process.exit(1)
    }
  }

  if (allEvents.length === 0) {
    console.log('no events to analyze')
    return
  }

  console.log(`\nTotal events: ${allEvents.length}`)

  // Per-kind counts.
  const kindCounts = new Map<string, number>()
  for (const e of allEvents) {
    kindCounts.set(e.kind, (kindCounts.get(e.kind) ?? 0) + 1)
  }
  printSection('Events by kind', sortedCounts(kindCounts))

  // Top tools that fired gate-blocked events.
  const gateBlockedTools = new Map<string, number>()
  for (const e of allEvents) {
    if (e.kind !== 'gate-blocked') continue
    const key = `${e.toolName ?? '?'} (${e.gate ?? 'unknown'})`
    gateBlockedTools.set(key, (gateBlockedTools.get(key) ?? 0) + 1)
  }
  printSection('Top gate-blocked tools', sortedCounts(gateBlockedTools), 5)

  // Tamper-block paths.
  const tamperPaths = new Map<string, number>()
  for (const e of allEvents) {
    if (e.kind !== 'tamper-block') continue
    const key = e.targetPath ?? '?'
    tamperPaths.set(key, (tamperPaths.get(key) ?? 0) + 1)
  }
  printSection('Top tamper-block paths', sortedCounts(tamperPaths), 5)

  // Verification ledger source distribution.
  const ledgerSources = new Map<string, number>()
  for (const e of allEvents) {
    if (e.kind !== 'verification-write') continue
    const src = e.entry?.source ?? '?'
    ledgerSources.set(src, (ledgerSources.get(src) ?? 0) + 1)
  }
  printSection('Verification ledger by source', sortedCounts(ledgerSources))

  // Phase transition arc.
  const transitions = new Map<string, number>()
  for (const e of allEvents) {
    if (e.kind !== 'phase-transition') continue
    const key = `${e.from} → ${e.to}`
    transitions.set(key, (transitions.get(key) ?? 0) + 1)
  }
  printSection('Phase transitions', sortedCounts(transitions))

  // Top saturation-trip phases.
  const saturationPhases = new Map<string, number>()
  for (const e of allEvents) {
    if (e.kind !== 'saturation-trip') continue
    const key = e.phase ?? '?'
    saturationPhases.set(key, (saturationPhases.get(key) ?? 0) + 1)
  }
  printSection('Saturation trips by phase', sortedCounts(saturationPhases), 5)

  console.log('')
}

void main()
