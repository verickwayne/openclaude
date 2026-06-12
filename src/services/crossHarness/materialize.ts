import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { adapterFor } from './adapters/index.js'
import type { DiscoveredTranscript, ResumeMode } from './harnessTypes.js'
import type { TranscriptMessage, LogOption, SerializedMessage } from '../../types/logs.js'
import {
  getCanonicalSessionsDir,
  recordSessionIndexEntry,
} from '../../utils/sessionStorage.js'

/**
 * Materialize a foreign `DiscoveredTranscript` into a Limitless session on
 * disk, then return a `LogOption` that the picker / resume path can consume.
 *
 * Two modes:
 *   'full'    – replays every message through the harness adapter
 *   'summary' – writes a single user message whose content is adapter.summarize()
 */
export async function materialize(
  t: DiscoveredTranscript,
  mode: ResumeMode,
): Promise<{ sessionId: string; log: LogOption }> {
  const newSessionId = randomUUID()
  const adapter = adapterFor(t.harness)
  const cwd = t.cwd ?? process.cwd()

  // -----------------------------------------------------------------------
  // Build message records
  // -----------------------------------------------------------------------
  let recs: TranscriptMessage[]

  if (mode === 'full') {
    recs = adapter.toLimitlessTranscript(t, newSessionId)
  } else {
    // summary mode: one root message whose content is adapter.summarize()
    const uuid = randomUUID()
    const summaryRec = {
      type: 'user',
      message: { role: 'user' as const, content: adapter.summarize(t) },
      uuid,
      parentUuid: null,
      isSidechain: false as const,
      cwd,
      sessionId: newSessionId,
      timestamp: new Date().toISOString(),
      version: ((globalThis as any).MACRO?.VERSION) ?? '0.0.0',
      userType: 'external',
      entrypoint: 'cross-harness-resume',
    } as TranscriptMessage // Message is `any` in the stub; plain-object cast is safe here
    recs = [summaryRec]
  }

  // -----------------------------------------------------------------------
  // Write JSONL file
  // -----------------------------------------------------------------------
  const dir = getCanonicalSessionsDir()
  mkdirSync(dir, { recursive: true })

  const filePath = join(dir, `${newSessionId}.jsonl`)

  // Message records first
  const lines: string[] = recs.map(rec => JSON.stringify(rec) + '\n')

  // Then the two metadata trailers
  const titleRecord = {
    type: 'custom-title',
    customTitle: `[${t.harness}] ${t.sessionName}`,
    sessionId: newSessionId,
  }
  const tagRecord = {
    type: 'tag',
    tag: t.harness,
    sessionId: newSessionId,
  }
  lines.push(JSON.stringify(titleRecord) + '\n')
  lines.push(JSON.stringify(tagRecord) + '\n')

  writeFileSync(filePath, lines.join(''), 'utf8')
  recordSessionIndexEntry(newSessionId, filePath, cwd)

  // -----------------------------------------------------------------------
  // Build LogOption
  // -----------------------------------------------------------------------
  // LogOption has several required fields (date, value, isSidechain) that
  // don't have natural equivalents for a cross-harness session; we fill them
  // with sensible defaults and cast at the end for safety.
  const now = new Date()
  const log = {
    sessionId: newSessionId,
    tag: t.harness,
    customTitle: `[${t.harness}] ${t.sessionName}`,
    firstPrompt: t.firstPrompt,
    messageCount: recs.length,
    created: now,
    modified: now,
    messages: recs as unknown as SerializedMessage[],
    projectPath: cwd,
    fullPath: filePath,
    // Required fields with no natural cross-harness equivalent
    date: now.toISOString(),
    value: 0,
    isSidechain: false,
  } as LogOption

  return { sessionId: newSessionId, log }
}
