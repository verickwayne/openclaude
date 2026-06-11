import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'fs'
import { join } from 'path'
import { getClaudeConfigHomeDir } from '../../utils/envUtils.js'
import type { CrossHarnessIndex, DiscoveredTranscript } from './harnessTypes.js'
import { scanForTranscripts, type ScanOptions } from './scanner.js'

// ---------------------------------------------------------------------------
// Index file path
// ---------------------------------------------------------------------------

function getIndexPath(): string {
  return join(getClaudeConfigHomeDir(), 'cross-harness-index.json')
}

// ---------------------------------------------------------------------------
// load / save
// ---------------------------------------------------------------------------

/** Load the persisted index, or return an empty index on any error. */
export function loadIndex(): CrossHarnessIndex {
  try {
    const raw = readFileSync(getIndexPath(), 'utf8')
    const parsed = JSON.parse(raw) as CrossHarnessIndex
    if (
      parsed &&
      typeof parsed === 'object' &&
      parsed.version === 1 &&
      Array.isArray(parsed.entries)
    ) {
      return parsed
    }
  } catch {
    // missing or corrupt — fall through
  }
  return { version: 1, generatedMs: 0, entries: [] }
}

/** Atomically write the index (write to .tmp, then rename). */
export function saveIndex(idx: CrossHarnessIndex): void {
  const indexPath = getIndexPath()
  const tmpPath = indexPath + '.tmp'
  // Ensure parent dir exists
  const dir = join(indexPath, '..')
  mkdirSync(dir, { recursive: true })
  writeFileSync(tmpPath, JSON.stringify(idx), 'utf8')
  renameSync(tmpPath, indexPath)
}

// ---------------------------------------------------------------------------
// refreshIndex
// ---------------------------------------------------------------------------

export interface RefreshOptions extends ScanOptions {
  /** Injectable scan function — defaults to scanForTranscripts. Receives ScanOptions. */
  scanFn?: (opts?: ScanOptions) => Promise<DiscoveredTranscript[]>
}

/**
 * Refresh the persisted index.
 *
 * Algorithm:
 * 1. Load the current index to get the mtime of each known path.
 * 2. Run the scan (real or injected).
 * 3. For each scanned path: if its mtime matches the cached mtime, reuse the
 *    cached entry (no re-detection needed); otherwise use the freshly detected
 *    entry.
 * 4. Drop entries whose path is no longer present in the scan results AND
 *    doesn't exist on disk.
 * 5. Persist and return.
 */
export async function refreshIndex(opts: RefreshOptions = {}): Promise<CrossHarnessIndex> {
  const { scanFn, ...scanOpts } = opts

  const currentIndex = loadIndex()

  // Build lookup: path → cached entry + mtime
  const cachedByPath = new Map<string, DiscoveredTranscript>()
  for (const entry of currentIndex.entries) {
    cachedByPath.set(entry.path, entry)
  }

  // Run scan
  const scan = scanFn ?? scanForTranscripts
  const scanned = await scan(Object.keys(scanOpts).length > 0 ? scanOpts : undefined)

  // Build path set from scan results
  const scannedPaths = new Set(scanned.map(e => e.path))

  // Determine final entries
  const finalEntries: DiscoveredTranscript[] = []

  for (const scannedEntry of scanned) {
    const cached = cachedByPath.get(scannedEntry.path)
    if (cached && cached.modifiedMs === scannedEntry.modifiedMs) {
      // Mtime unchanged — reuse cached entry
      finalEntries.push(cached)
    } else {
      // New or changed — use freshly scanned entry
      finalEntries.push(scannedEntry)
    }
  }

  // Add cached entries whose paths were NOT returned by the scan but still
  // exist on disk (e.g. scan roots might not cover them this run).
  // Drop entries that are both missing from the scan AND don't exist on disk.
  for (const cached of cachedByPath.values()) {
    if (scannedPaths.has(cached.path)) continue // already handled above
    try {
      statSync(cached.path)
      // File still exists — keep cached entry
      finalEntries.push(cached)
    } catch {
      // File gone — drop it
    }
  }

  const newIndex: CrossHarnessIndex = {
    version: 1,
    generatedMs: Date.now(),
    entries: finalEntries,
  }

  saveIndex(newIndex)
  return newIndex
}

// ---------------------------------------------------------------------------
// searchIndex
// ---------------------------------------------------------------------------

/**
 * Search/filter and rank entries in an index.
 *
 * Ranking tiers (highest first):
 *   1. Exact sessionId match
 *   2. sessionId startsWith query
 *   3. sessionName or firstPrompt case-insensitive includes query
 *
 * Within the same tier, sort by modifiedMs descending.
 * Empty query returns all entries sorted by modifiedMs descending.
 */
export function searchIndex(
  idx: CrossHarnessIndex,
  query: string,
): DiscoveredTranscript[] {
  const q = query.trim()

  if (!q) {
    return [...idx.entries].sort((a, b) => b.modifiedMs - a.modifiedMs)
  }

  const lower = q.toLowerCase()

  type Tier = 0 | 1 | 2
  // Map index position → tier (avoids path collision when entries share paths)
  const tierByIdx = new Map<number, Tier>()

  idx.entries.forEach((entry, i) => {
    const { sessionId, sessionName, firstPrompt } = entry

    if (sessionId === q) {
      tierByIdx.set(i, 0)
    } else if (sessionId.startsWith(q)) {
      const current = tierByIdx.get(i)
      if (current === undefined || current > 1) tierByIdx.set(i, 1)
    } else {
      const nameMatch = sessionName.toLowerCase().includes(lower)
      const promptMatch = (firstPrompt ?? '').toLowerCase().includes(lower)
      if (nameMatch || promptMatch) {
        const current = tierByIdx.get(i)
        if (current === undefined || current > 2) tierByIdx.set(i, 2)
      }
    }
  })

  const matches = idx.entries
    .map((e, i) => ({ entry: e, tier: tierByIdx.get(i) }))
    .filter((x): x is { entry: DiscoveredTranscript; tier: Tier } => x.tier !== undefined)

  return matches
    .sort((a, b) => {
      if (a.tier !== b.tier) return a.tier - b.tier
      return b.entry.modifiedMs - a.entry.modifiedMs
    })
    .map(x => x.entry)
}
