import { readdirSync, readFileSync, statSync } from 'fs'
import { homedir } from 'os'
import { extname, join } from 'path'
import { getClaudeConfigHomeDir, getProjectsDir } from '../../utils/envUtils.js'
import { detectHarness } from './detectors.js'
import type { DiscoveredTranscript } from './harnessTypes.js'

// ---------------------------------------------------------------------------
// Pruned directory names
// ---------------------------------------------------------------------------

const PRUNE_DIRS = new Set([
  'node_modules',
  '.git',
  'Library',
  '.Trash',
  '.npm',
  'dist',
  'build',
  '.next',
  '.cache',
  'coverage',
])

/** Known harness dot-dirs that should NOT be pruned even though they start with '.'. */
const KEEP_DOT_DIRS = new Set(['.claude', '.codex', '.limitless'])

function shouldPrune(dirName: string): boolean {
  if (PRUNE_DIRS.has(dirName)) return true
  if (dirName.startsWith('.') && !KEEP_DOT_DIRS.has(dirName)) return true
  return false
}

// ---------------------------------------------------------------------------
// Candidate file extensions
// ---------------------------------------------------------------------------

const CANDIDATE_EXTS = new Set(['.jsonl', '.json'])

// ---------------------------------------------------------------------------
// Line reader — read first ~maxBytes, return up to maxLines lines
// ---------------------------------------------------------------------------

const SAMPLE_MAX_BYTES = 65536
const SAMPLE_MAX_LINES = 20

function sampleLines(filePath: string): string[] {
  try {
    const buf = Buffer.alloc(SAMPLE_MAX_BYTES)
    const fs = require('fs') as typeof import('fs')
    const fd = fs.openSync(filePath, 'r')
    let bytesRead = 0
    try {
      bytesRead = fs.readSync(fd, buf, 0, SAMPLE_MAX_BYTES, null)
    } finally {
      fs.closeSync(fd)
    }
    const raw = buf.subarray(0, bytesRead).toString('utf8')
    return raw.split('\n').slice(0, SAMPLE_MAX_LINES)
  } catch {
    return []
  }
}

// ---------------------------------------------------------------------------
// Recursive walk
// ---------------------------------------------------------------------------

function walkDir(
  dir: string,
  depth: number,
  maxDepth: number,
  out: DiscoveredTranscript[],
  seen: Set<string>,
): void {
  if (depth > maxDepth) return

  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return
  }

  for (const entry of entries) {
    const fullPath = join(dir, entry)

    let st
    try {
      st = statSync(fullPath)
    } catch {
      continue
    }

    if (st.isDirectory()) {
      if (!shouldPrune(entry)) {
        walkDir(fullPath, depth + 1, maxDepth, out, seen)
      }
    } else if (st.isFile()) {
      const ext = extname(entry)
      if (!CANDIDATE_EXTS.has(ext)) continue
      if (seen.has(fullPath)) continue

      const lines = sampleLines(fullPath)
      const result = detectHarness(fullPath, lines, st.mtimeMs)
      if (result !== null) {
        seen.add(fullPath)
        out.push(result)
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface ScanOptions {
  roots?: string[]
  maxDepth?: number
}

/**
 * Scan the filesystem for transcript files from any supported harness
 * (limitless, claude, codex).
 */
export async function scanForTranscripts(
  opts: ScanOptions = {},
): Promise<DiscoveredTranscript[]> {
  const home = homedir()

  // Build default roots, deduped
  const defaultRoots = [
    getProjectsDir(),
    join(home, '.claude', 'projects'),
    join(home, '.codex', 'sessions'),
    home,
  ]

  const rawRoots = opts.roots ?? defaultRoots
  // Deduplicate by normalised path
  const seen = new Set<string>()
  const roots: string[] = []
  for (const r of rawRoots) {
    if (!seen.has(r)) {
      seen.add(r)
      roots.push(r)
    }
  }

  const maxDepth = opts.maxDepth ?? 8
  const results: DiscoveredTranscript[] = []
  const pathSeen = new Set<string>()

  for (const root of roots) {
    walkDir(root, 0, maxDepth, results, pathSeen)
  }

  // Dedupe by path (in case roots overlap)
  const finalSeen = new Set<string>()
  const deduped: DiscoveredTranscript[] = []
  for (const r of results) {
    if (!finalSeen.has(r.path)) {
      finalSeen.add(r.path)
      deduped.push(r)
    }
  }

  return deduped
}
