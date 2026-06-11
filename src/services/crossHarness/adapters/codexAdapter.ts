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
// Codex rollout JSONL format (verified on 374 real files)
//
// Path pattern: ~/.codex/sessions/YYYY/MM/DD/rollout-<iso>-<uuid>.jsonl
// Each line: { "timestamp": string, "type": string, "payload": ... }
//
//   type:"session_meta"   → payload:{id, timestamp, cwd, ...}  (first line)
//   type:"response_item"  → payload:{type:"message", role:"developer|user|assistant",
//                             content:[{type:"input_text"|"output_text", text:string}]}
//   all other types       → IGNORED (e.g. "event_msg")
//
// developer role: treated as user-role context, prefixed with "[system/developer]\n"
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** XML / preamble block pattern: leading <tag>...</tag> blocks. */
const XML_BLOCK_RE = /^(\s*<[^>]+>[\s\S]*?<\/[^>]+>\s*)+/

/**
 * Flatten a Codex content array to a single text string.
 * Both "input_text" and "output_text" part types are included.
 */
function flattenContent(content: unknown): string {
  if (!Array.isArray(content)) return ''
  return content
    .map((part: unknown) => {
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
    .join('')
}

/**
 * Strip leading XML/preamble blocks (e.g. <environment_context>...</environment_context>,
 * AGENTS.md-style text) so summarize() returns a readable digest.
 */
function stripLeadingXml(text: string): string {
  return text.replace(XML_BLOCK_RE, '').trim()
}

// ---------------------------------------------------------------------------
// Parsed line types
// ---------------------------------------------------------------------------

interface CodexRolloutLine {
  timestamp: string
  type: string
  payload: Record<string, unknown>
}

interface ParsedTranscript {
  /** cwd from session_meta, or fallback */
  cwd: string
  /** Ordered list of messages extracted from response_item lines */
  messages: Array<{
    timestamp: string
    role: 'user' | 'assistant'
    rawRole: string
    text: string
  }>
}

function parseRollout(path: string, cwdFallback: string | null): ParsedTranscript {
  let raw: string
  try {
    raw = readFileSync(path, 'utf8')
  } catch {
    return { cwd: cwdFallback ?? process.cwd(), messages: [] }
  }

  let cwd: string = cwdFallback ?? process.cwd()
  const messages: ParsedTranscript['messages'] = []

  for (const line of raw.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue

    let obj: CodexRolloutLine
    try {
      const parsed = JSON.parse(trimmed)
      if (!parsed || typeof parsed !== 'object') continue
      obj = parsed as CodexRolloutLine
    } catch {
      continue
    }

    // session_meta → grab cwd
    if (obj.type === 'session_meta') {
      const payload = obj.payload
      if (payload && typeof payload.cwd === 'string') {
        cwd = payload.cwd
      }
      continue
    }

    // response_item with payload.type === 'message' → real message
    if (obj.type === 'response_item') {
      const payload = obj.payload
      if (!payload || payload.type !== 'message') continue

      const rawRole = typeof payload.role === 'string' ? payload.role : ''
      if (!rawRole) continue

      const text = flattenContent(payload.content)

      // Map roles: assistant → assistant, user → user, developer → user (with prefix)
      let role: 'user' | 'assistant'
      let finalText: string

      if (rawRole === 'assistant') {
        role = 'assistant'
        finalText = text
      } else if (rawRole === 'developer') {
        role = 'user'
        finalText = `[system/developer]\n${text}`
      } else {
        // 'user' or any unexpected role treated as user
        role = 'user'
        finalText = text
      }

      messages.push({
        timestamp: typeof obj.timestamp === 'string' ? obj.timestamp : new Date().toISOString(),
        role,
        rawRole,
        text: finalText,
      })
      continue
    }

    // All other types (event_msg, etc.) → IGNORED
  }

  return { cwd, messages }
}

// ---------------------------------------------------------------------------
// codexAdapter
// ---------------------------------------------------------------------------

export const codexAdapter: HarnessAdapter = {
  harness: 'codex',

  toLimitlessTranscript(
    t: DiscoveredTranscript,
    newSessionId: string,
  ): TranscriptMessage[] {
    const cwdFallback = t.cwd ?? null
    const { cwd, messages } = parseRollout(t.path, cwdFallback)

    const records: TranscriptMessage[] = []
    let prevUuid: string | null = null

    for (const msg of messages) {
      const uuid = randomUUID()
      const parentUuid = prevUuid as (import('crypto').UUID | null)
      prevUuid = uuid

      // Build plain object; Message is typed as `any` in the stub (message.ts),
      // so the cast below is safe.
      const record = {
        type: msg.role,
        message: { role: msg.role, content: msg.text },
        uuid,
        parentUuid,
        isSidechain: false as const,
        cwd,
        sessionId: newSessionId,
        timestamp: msg.timestamp,
        version: VERSION,
        userType: 'external',
        entrypoint: 'cross-harness-resume',
      } as TranscriptMessage // Message is `any` in stub; plain object cast is safe here

      records.push(record)
    }

    return records
  },

  summarize(t: DiscoveredTranscript): string {
    const cwdFallback = t.cwd ?? null
    const { messages } = parseRollout(t.path, cwdFallback)

    // Collect text snippets, stripping leading XML/preamble blocks.
    const snippets: string[] = []
    for (const msg of messages) {
      const stripped = stripLeadingXml(msg.text).trim()
      if (stripped) snippets.push(stripped)
    }

    // Keep last 20 snippets.
    const tail = snippets.slice(-20)

    const header = `Resumed from Codex thread ${t.sessionId} (${t.sessionName})`
    const body = tail.join('\n')
    const full = `${header}\n${body}`

    // Clamp to 4 KB.
    if (full.length <= 4096) return full
    return full.slice(0, 4096)
  },
}
