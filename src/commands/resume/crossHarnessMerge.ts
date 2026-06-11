import type { DiscoveredTranscript } from '../../services/crossHarness/harnessTypes.js'
import type { LogOption } from '../../types/logs.js'

/**
 * Resolve a log's sessionId. Mirrors getSessionIdFromLog from sessionStorage
 * but inlined to keep this helper free of that module's heavy import cycle.
 */
function sessionIdOf(log: LogOption): string | undefined {
  return log.sessionId ?? log.messages[0]?.sessionId
}

/**
 * Merge cross-harness discovered transcripts into the native picker list.
 *
 * Each `DiscoveredTranscript` becomes a `LogOption` tagged by harness so the
 * existing `LogSelector` tab grouping surfaces it under a harness tab. The
 * `crossHarness` field flags it as foreign so the resume path can materialize
 * it on select. Native logs always win on sessionId collision.
 *
 * Pure function — no I/O, fully unit-testable.
 */
export function mergeCrossHarnessLogs(
  nativeLogs: LogOption[],
  entries: DiscoveredTranscript[],
): LogOption[] {
  const nativeSessionIds = new Set<string>()
  for (const log of nativeLogs) {
    const id = sessionIdOf(log)
    if (id) nativeSessionIds.add(id)
  }

  const foreign: LogOption[] = []
  for (const entry of entries) {
    if (nativeSessionIds.has(entry.sessionId)) continue // native wins
    const modified = new Date(entry.modifiedMs)
    const log = {
      sessionId: entry.sessionId,
      tag: entry.harness,
      customTitle: `[${entry.harness}] ${entry.sessionName}`,
      firstPrompt: entry.firstPrompt,
      messageCount: entry.messageCount,
      created: modified,
      modified,
      messages: [],
      crossHarness: entry,
      // Required LogOption fields with no natural cross-harness equivalent.
      date: modified.toISOString(),
      value: 0,
      isSidechain: false,
    } as LogOption
    foreign.push(log)
  }

  return [...nativeLogs, ...foreign].sort(
    (a, b) => b.modified.getTime() - a.modified.getTime(),
  )
}
