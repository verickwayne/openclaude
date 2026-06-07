#!/usr/bin/env bun
// Aggregate one or more OPENCLAUDE_DISCIPLINE_EVENT_LOG JSONL files and
// print a readable cross-session summary.
//
// Usage:
//   bun scripts/analyze-discipline-log.ts <path1.jsonl> [path2.jsonl …]
//
// The aggregation logic lives in src/services/discipline-log/aggregate.ts
// (unit-tested). This script is the thin fs/stdio wrapper.
//
// Exits 1 on no input or unreadable files; 0 on success.

import * as fs from 'node:fs'
import * as readline from 'node:readline'
import {
  emptyAggregation,
  fold,
  formatReport,
  parseLine,
  type Aggregation,
} from '../src/services/discipline-log/aggregate.js'

async function foldFile(path: string, agg: Aggregation): Promise<number> {
  const stream = fs.createReadStream(path, { encoding: 'utf-8' })
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity })
  let count = 0
  for await (const line of rl) {
    const ev = parseLine(line)
    if (ev !== null) {
      fold(agg, ev)
      count += 1
    }
  }
  return count
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  if (args.length === 0) {
    console.error(
      'usage: bun scripts/analyze-discipline-log.ts <path1.jsonl> [...]',
    )
    process.exit(1)
  }

  const agg = emptyAggregation()
  for (const path of args) {
    try {
      const n = await foldFile(path, agg)
      console.error(`read ${n} events from ${path}`)
    } catch (err) {
      console.error(`failed to read ${path}: ${(err as Error).message}`)
      process.exit(1)
    }
  }

  if (agg.total === 0) {
    console.log('no events to analyze')
    return
  }

  console.log('')
  console.log(formatReport(agg))
  console.log('')
}

void main()
