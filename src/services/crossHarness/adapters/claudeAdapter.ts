import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import type { DiscoveredTranscript, HarnessAdapter } from '../harnessTypes.js'
import type { TranscriptMessage } from '../../../types/logs.js'

// ---------------------------------------------------------------------------
// Version resolution — MACRO is injected by the build bundler; undefined in
// bun test, so fall back to '0.0.0'.
// ---------------------------------------------------------------------------
const VERSION: string = ((globalThis as any).MACRO?.VERSION) ?? '0.0.0'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Extract plain text from a message content value (string or content-part array). */
function extractText(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map((part: unknown) => {
        if (typeof part === 'string') return part
        if (
          part !== null &&
          typeof part === 'object' &&
          'text' in (part as object) &&
          typeof (part as { text: unknown }).text === 'string'
        ) {
          return (part as { text: string }).text
        }
        return ''
      })
      .filter(Boolean)
      .join(' ')
  }
  return ''
}

// ---------------------------------------------------------------------------
// claudeAdapter
// ---------------------------------------------------------------------------

export const claudeAdapter: HarnessAdapter = {
  harness: 'claude',

  toLimitlessTranscript(
    t: DiscoveredTranscript,
    newSessionId: string,
  ): TranscriptMessage[] {
    const raw = readFileSync(t.path, 'utf8')
    const records: TranscriptMessage[] = []
    let prevUuid: string | null = null

    for (const line of raw.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed) continue

      let obj: Record<string, unknown>
      try {
        obj = JSON.parse(trimmed)
      } catch {
        continue
      }

      // Keep only user / assistant message lines; skip metadata lines.
      const lineType = obj.type
      if (lineType !== 'user' && lineType !== 'assistant') continue

      const sourceMsg = obj.message as { role: string; content: unknown } | undefined
      if (!sourceMsg || (sourceMsg.role !== 'user' && sourceMsg.role !== 'assistant')) continue

      const uuid = randomUUID()
      const parentUuid = prevUuid as (import('crypto').UUID | null)
      prevUuid = uuid

      const timestamp =
        typeof obj.timestamp === 'string' ? obj.timestamp : new Date().toISOString()
      const cwd =
        typeof t.cwd === 'string'
          ? t.cwd
          : typeof obj.cwd === 'string'
          ? obj.cwd
          : process.cwd()

      // Build the plain object and cast to TranscriptMessage — Message is
      // typed as `any` in this snapshot (message.ts stub), so this is safe.
      const record = {
        // TranscriptMessage (SerializedMessage) fields
        type: sourceMsg.role as 'user' | 'assistant',
        message: { role: sourceMsg.role, content: sourceMsg.content },
        uuid,
        parentUuid,
        isSidechain: false as const,
        cwd,
        sessionId: newSessionId,
        timestamp,
        version: VERSION,
        userType: 'external',
        entrypoint: 'cross-harness-resume',
      } as TranscriptMessage // Message is `any` in stub; plain object cast is safe here

      records.push(record)
    }

    return records
  },

  summarize(t: DiscoveredTranscript): string {
    const raw = readFileSync(t.path, 'utf8')
    const lines = raw.split('\n')

    // Collect last ~20 user/assistant text contents.
    const snippets: string[] = []
    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed) continue
      let obj: Record<string, unknown>
      try {
        obj = JSON.parse(trimmed)
      } catch {
        continue
      }
      const lineType = obj.type
      if (lineType !== 'user' && lineType !== 'assistant') continue
      const msg = obj.message as { role: string; content: unknown } | undefined
      if (!msg) continue
      const text = extractText(msg.content).trim()
      if (text) snippets.push(text)
    }

    // Keep last 20 snippets.
    const tail = snippets.slice(-20)

    const header = `Resumed from Claude session ${t.sessionId} (${t.sessionName})`
    const body = tail.join('\n')
    const full = `${header}\n${body}`

    // Clamp to 4 KB.
    if (full.length <= 4096) return full
    return full.slice(0, 4096)
  },
}
