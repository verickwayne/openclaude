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

/** Max raw-file bytes to include in the fallback record content. */
const FALLBACK_MAX_BYTES = 8 * 1024 // 8 KB

/** Max bytes to include in summarize body. */
const SUMMARY_MAX_BYTES = 2 * 1024 // 2 KB

/**
 * Extract plain text from a content value that may be:
 *   - a string
 *   - an array of content-part objects (with a `.text` property)
 * Returns empty string if nothing extractable.
 */
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

/**
 * Best-effort extraction of role + text from an arbitrary parsed JSON object.
 *
 * Role resolution priority:
 *   obj.role  >  obj.message?.role  >  obj.type === 'assistant' ? 'assistant' : 'user'
 *
 * Text resolution priority (first non-empty wins):
 *   obj.content (string)  >  obj.text  >  obj.message?.content (string or array)  >  JSON of obj.content array text parts
 *
 * Any role that is not exactly 'assistant' is normalised to 'user'.
 * Returns null if no text could be extracted.
 */
function extractRoleAndText(obj: Record<string, unknown>): { role: 'user' | 'assistant'; text: string } | null {
  // --- Role ---
  const rawRole: unknown =
    (typeof obj.role === 'string' && obj.role) ||
    (() => {
      const m = obj.message
      if (m && typeof m === 'object' && 'role' in (m as object)) {
        const r = (m as { role: unknown }).role
        if (typeof r === 'string') return r
      }
      return undefined
    })() ||
    (obj.type === 'assistant' ? 'assistant' : 'user')

  const role: 'user' | 'assistant' = rawRole === 'assistant' ? 'assistant' : 'user'

  // --- Text ---
  let text = ''

  // 1. obj.content as string
  if (typeof obj.content === 'string' && obj.content) {
    text = obj.content
  }

  // 2. obj.text
  if (!text && typeof obj.text === 'string' && obj.text) {
    text = obj.text
  }

  // 3. obj.message?.content (string or array)
  if (!text) {
    const m = obj.message
    if (m && typeof m === 'object') {
      const mc = (m as { content?: unknown }).content
      if (mc !== undefined) {
        const extracted = extractText(mc)
        if (extracted) text = extracted
      }
    }
  }

  // 4. JSON.stringify text parts from obj.content array
  if (!text && Array.isArray(obj.content)) {
    const extracted = extractText(obj.content)
    if (extracted) text = extracted
  }

  if (!text) return null

  return { role, text }
}

// ---------------------------------------------------------------------------
// genericAdapter
// ---------------------------------------------------------------------------

export const genericAdapter: HarnessAdapter = {
  harness: 'unknown',

  toLimitlessTranscript(
    t: DiscoveredTranscript,
    newSessionId: string,
  ): TranscriptMessage[] {
    const raw = readFileSync(t.path, 'utf8')
    const cwd = t.cwd ?? process.cwd()

    const records: TranscriptMessage[] = []
    let prevUuid: string | null = null

    for (const line of raw.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed) continue

      let obj: Record<string, unknown>
      try {
        obj = JSON.parse(trimmed)
        if (!obj || typeof obj !== 'object' || Array.isArray(obj)) continue
      } catch {
        // Skip unparseable lines
        continue
      }

      const extracted = extractRoleAndText(obj)
      if (!extracted) continue

      const uuid = randomUUID()
      const parentUuid = prevUuid as (import('crypto').UUID | null)
      prevUuid = uuid

      const timestamp =
        typeof obj.timestamp === 'string' ? obj.timestamp : new Date().toISOString()

      // Build plain object and cast — Message is typed as `any` in the project
      // stub (src/types/message.ts), so the plain-object cast is safe here.
      const record = {
        type: extracted.role as 'user' | 'assistant',
        message: { role: extracted.role, content: extracted.text },
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

    // If nothing was extractable, produce a single fallback user record whose
    // content is a header followed by the raw file text (truncated to ~8 KB).
    if (records.length === 0) {
      const truncated = raw.length > FALLBACK_MAX_BYTES ? raw.slice(0, FALLBACK_MAX_BYTES) : raw
      const content = `Imported transcript (unrecognized format) from ${t.path}\n\n${truncated}`

      const uuid = randomUUID()
      const fallback = {
        type: 'user' as const,
        message: { role: 'user', content },
        uuid,
        parentUuid: null,
        isSidechain: false as const,
        cwd,
        sessionId: newSessionId,
        timestamp: new Date().toISOString(),
        version: VERSION,
        userType: 'external',
        entrypoint: 'cross-harness-resume',
      } as TranscriptMessage // Message is `any` in stub; plain object cast is safe here

      records.push(fallback)
    }

    return records
  },

  summarize(t: DiscoveredTranscript): string {
    const raw = readFileSync(t.path, 'utf8')
    const header = `Resumed from imported transcript ${t.sessionId} (${t.sessionName})`

    // Collect extractable text snippets from the file
    const snippets: string[] = []
    for (const line of raw.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed) continue
      let obj: Record<string, unknown>
      try {
        obj = JSON.parse(trimmed)
        if (!obj || typeof obj !== 'object' || Array.isArray(obj)) continue
      } catch {
        continue
      }
      const extracted = extractRoleAndText(obj)
      if (extracted) snippets.push(extracted.text)
    }

    let body: string
    if (snippets.length > 0) {
      body = snippets.join('\n')
      if (body.length > SUMMARY_MAX_BYTES) body = body.slice(0, SUMMARY_MAX_BYTES)
    } else {
      // No extractable text — fall back to raw file content
      body = raw.length > SUMMARY_MAX_BYTES ? raw.slice(0, SUMMARY_MAX_BYTES) : raw
    }

    return `${header}\n${body}`
  },
}
