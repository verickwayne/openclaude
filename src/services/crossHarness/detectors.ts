import { readFileSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import { getClaudeConfigHomeDir } from '../../utils/envUtils.js'
import type { DiscoveredTranscript } from './harnessTypes.js'

// ---------------------------------------------------------------------------
// Module-level cache for the Codex session index (loaded once per process)
// ---------------------------------------------------------------------------

/** Map from session id → thread_name */
let codexSessionNameCache: Map<string, string> | null = null

function loadCodexSessionIndex(): Map<string, string> {
  if (codexSessionNameCache !== null) return codexSessionNameCache
  const m = new Map<string, string>()
  try {
    const indexPath = join(homedir(), '.codex', 'session_index.jsonl')
    const raw = readFileSync(indexPath, 'utf8')
    for (const line of raw.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed) continue
      try {
        const obj = JSON.parse(trimmed)
        if (obj && typeof obj.id === 'string' && typeof obj.thread_name === 'string') {
          m.set(obj.id, obj.thread_name)
        }
      } catch {
        // skip malformed lines
      }
    }
  } catch {
    // file missing or unreadable — return empty map
  }
  codexSessionNameCache = m
  return m
}

// ---------------------------------------------------------------------------
// Content extraction helpers
// ---------------------------------------------------------------------------

/**
 * Extract text from content that may be a string or an array of content parts.
 */
function extractText(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map((part: unknown) => {
        if (typeof part === 'string') return part
        if (part && typeof part === 'object' && 'text' in part && typeof (part as { text: unknown }).text === 'string') {
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
// detectHarness
// ---------------------------------------------------------------------------

/**
 * Detect the harness of a transcript from its path and sampled lines.
 *
 * Returns a `DiscoveredTranscript` or `null` if the file is not a recognised
 * transcript format.
 */
export function detectHarness(
  path: string,
  sampledLines: string[],
  modifiedMs: number,
): DiscoveredTranscript | null {
  // Parse all lines that are valid JSON; bail if none parse
  type ParsedLine = Record<string, unknown>
  const parsed: ParsedLine[] = []
  for (const line of sampledLines) {
    const trimmed = line.trim()
    if (!trimmed) continue
    try {
      const obj = JSON.parse(trimmed)
      if (obj && typeof obj === 'object') {
        parsed.push(obj as ParsedLine)
      }
    } catch {
      // skip malformed lines
    }
  }

  if (parsed.length === 0) return null

  // ------------------------------------------------------------------
  // CODEX detection
  // Criteria: any line has type === 'session_meta'  OR  path matches
  //           /rollout-.*\.jsonl$/
  // ------------------------------------------------------------------
  const isCodexPath = /rollout-.*\.jsonl$/.test(path)
  const hasSessionMeta = parsed.some(obj => obj.type === 'session_meta')

  if (isCodexPath || hasSessionMeta) {
    // Extract session id and cwd from session_meta line
    let sessionId = ''
    let cwd: string | null = null

    const metaLine = parsed.find(obj => obj.type === 'session_meta')
    if (metaLine) {
      const payload = metaLine.payload as Record<string, unknown> | undefined
      if (payload) {
        if (typeof payload.id === 'string') sessionId = payload.id
        if (typeof payload.cwd === 'string') cwd = payload.cwd
      }
    }

    // Fall back to parsing session id from the filename
    if (!sessionId && isCodexPath) {
      const match = path.match(/rollout-[^/]*-([0-9a-f-]{36})\.jsonl$/)
      if (match) sessionId = match[1]
    }

    // Find first user message for firstPrompt
    let firstPrompt = ''
    let messageCount = 0
    for (const obj of parsed) {
      if (obj.type === 'response_item') {
        const payload = obj.payload as Record<string, unknown> | undefined
        if (payload && payload.type === 'message') {
          messageCount++
          const role = payload.role as string | undefined
          const content = payload.content
          if (!firstPrompt && (role === 'user' || role === 'developer')) {
            firstPrompt = extractText(content).trim()
          }
        }
      }
    }

    // Session name: look up in index, fall back to firstPrompt
    const sessionNameMap = loadCodexSessionIndex()
    const sessionName = (sessionId && sessionNameMap.get(sessionId)) || firstPrompt || sessionId

    return {
      harness: 'codex',
      path,
      sessionId,
      sessionName,
      firstPrompt,
      cwd,
      messageCount,
      modifiedMs,
    }
  }

  // ------------------------------------------------------------------
  // LIMITLESS / CLAUDE detection
  // Criteria: any line has message.role AND sessionId
  // ------------------------------------------------------------------
  const limitlessLine = parsed.find(obj => {
    const msg = obj.message as Record<string, unknown> | undefined
    return (
      msg &&
      typeof msg.role === 'string' &&
      typeof obj.sessionId === 'string'
    )
  })

  if (limitlessLine) {
    const sessionId = limitlessLine.sessionId as string

    // Determine harness: limitless if path is under getClaudeConfigHomeDir(),
    // else 'claude'.
    let harness: 'limitless' | 'claude'
    try {
      const configHome = getClaudeConfigHomeDir()
      harness = path.startsWith(configHome) ? 'limitless' : 'claude'
    } catch {
      harness = 'claude'
    }

    // Extract cwd from the message line
    const cwd = typeof limitlessLine.cwd === 'string' ? limitlessLine.cwd : null

    // Find custom-title or last-prompt lines
    let sessionName = ''
    let firstPrompt = ''

    for (const obj of parsed) {
      if (obj.type === 'custom-title' && typeof obj.customTitle === 'string') {
        sessionName = obj.customTitle
      }
      if (obj.type === 'last-prompt' && typeof obj.lastPrompt === 'string') {
        if (!firstPrompt) firstPrompt = obj.lastPrompt
      }
    }

    // If no firstPrompt from last-prompt line, find first user message
    if (!firstPrompt) {
      for (const obj of parsed) {
        const msg = obj.message as Record<string, unknown> | undefined
        if (msg && msg.role === 'user') {
          firstPrompt = extractText(msg.content).trim()
          if (firstPrompt) break
        }
      }
    }

    if (!sessionName) sessionName = firstPrompt || sessionId

    // Count message lines
    const messageCount = parsed.filter(obj => {
      const msg = obj.message as Record<string, unknown> | undefined
      return msg && typeof msg.role === 'string'
    }).length

    return {
      harness,
      path,
      sessionId,
      sessionName,
      firstPrompt,
      cwd,
      messageCount,
      modifiedMs,
    }
  }

  // No recognised transcript format
  return null
}
