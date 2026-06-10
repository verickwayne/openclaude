/**
 * Opt-in observation masking for stale tool results.
 *
 * Replaces the content of old tool_result blocks with a compact one-line
 * summary without invoking an LLM. Research shows mechanical masking "often
 * matched or exceeded LLM summarization in solve rate" while being
 * substantially cheaper, and avoids the risk that LLM summarization
 * "inadvertently extend[s] agent trajectories by 13–15% by obscuring natural
 * stopping signals." (02-sota-harness-practices.md §5.2)
 *
 * Gated DARK by default — only active when
 * OPENCLAUDE_OBSERVATION_MASKING=1. Unlike the night's other kill switches
 * this is opt-IN because it touches context fidelity.
 *
 * Safety guarantees:
 * - Never touches the last K assistant turns (default: LAST_K_TURNS = 6).
 * - Never breaks tool_use / tool_result pairing — block structure is
 *   preserved; only the result body is replaced.
 * - Never masks results already cleared by microCompact or budget reduction
 *   (TOOL_RESULT_CLEARED_MESSAGE sentinel).
 * - Never masks tool_result blocks with image content (non-text blocks).
 * - Skips results whose text is smaller than MIN_CONTENT_CHARS (default
 *   2000) — masking tiny results saves nothing and adds noise.
 * - Respects isCompactableTool() to avoid masking flow-control tools
 *   (Task, Agent) that microCompact also avoids.
 */

import { isCompactableTool } from '../compact/microCompact.js'
import { TOOL_RESULT_CLEARED_MESSAGE } from '../../utils/toolResultStorage.js'

// ---------------------------------------------------------------------------
// Public constants — exposed so tests and callers can reference them.
// ---------------------------------------------------------------------------

/** Default number of assistant turns to protect from masking. */
export const DEFAULT_LAST_K_TURNS = 6

/**
 * Minimum tool_result text size (chars) before masking is applied.
 * Masking tiny results saves nothing and increases noise.
 */
export const MIN_CONTENT_CHARS = 2_000

// ---------------------------------------------------------------------------
// Types (mirror compressToolHistory.ts shapes so the two can compose)
// ---------------------------------------------------------------------------

type AnyMessage = {
  role?: string
  message?: { role?: string; content?: unknown }
  content?: unknown
}

type ToolResultBlock = {
  type: 'tool_result'
  tool_use_id?: string
  is_error?: boolean
  content?: unknown
}

type ToolUseBlock = {
  type: 'tool_use'
  id?: string
  name?: string
  input?: unknown
}

// ---------------------------------------------------------------------------
// Env-var gate
// ---------------------------------------------------------------------------

/**
 * Returns true when the opt-in env flag is set.
 * Accepts an explicit env dict for testability.
 */
export function isObservationMaskingEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return env.OPENCLAUDE_OBSERVATION_MASKING === '1'
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function getInner(msg: AnyMessage): { role?: string; content?: unknown } {
  return (msg.message ?? msg) as { role?: string; content?: unknown }
}

function extractText(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return (content as Array<{ type?: string; text?: string }>)
      .filter(b => b?.type === 'text' && typeof b.text === 'string')
      .map(b => b.text ?? '')
      .join('\n')
  }
  return ''
}

function hasNonTextContent(content: unknown): boolean {
  if (!Array.isArray(content)) return false
  return (content as Array<{ type?: string }>).some(
    b => b?.type !== 'text',
  )
}

function isAlreadyCleared(block: ToolResultBlock): boolean {
  return extractText(block.content) === TOOL_RESULT_CLEARED_MESSAGE
}

/** Build the index of tool_use blocks by id for name resolution. */
function indexToolUses(messages: AnyMessage[]): Map<string, ToolUseBlock> {
  const map = new Map<string, ToolUseBlock>()
  for (const msg of messages) {
    const content = getInner(msg).content
    if (!Array.isArray(content)) continue
    for (const b of content as Array<{ type?: string; id?: string }>) {
      if (b?.type === 'tool_use' && b.id) {
        map.set(b.id, b as ToolUseBlock)
      }
    }
  }
  return map
}

/**
 * Identify message indices that contain at least one tool_result block and
 * record the assistant turn that immediately preceded each such message.
 * "Turn N" counts assistant turns from 0 = oldest.
 */
function indexToolResultMessages(messages: AnyMessage[]): {
  /** Message indices whose content includes ≥1 tool_result. */
  indices: number[]
  /**
   * For each entry in `indices`, the assistant turn index (0 = oldest) that
   * produced the corresponding tool_use blocks. Used to enforce last-K
   * protection at the assistant-turn granularity, matching the task spec.
   */
  assistantTurnByIndex: Map<number, number>
} {
  const indices: number[] = []
  const assistantTurnByIndex = new Map<number, number>()

  let assistantTurnCounter = 0
  let lastAssistantTurn = 0

  for (let i = 0; i < messages.length; i++) {
    const inner = getInner(messages[i])
    const role = inner.role ?? messages[i].role
    const content = inner.content

    if (role === 'assistant') {
      lastAssistantTurn = assistantTurnCounter
      assistantTurnCounter++
      continue
    }

    if (
      role === 'user' &&
      Array.isArray(content) &&
      content.some((b: { type?: string }) => b?.type === 'tool_result')
    ) {
      indices.push(i)
      assistantTurnByIndex.set(i, lastAssistantTurn)
    }
  }

  return { indices, assistantTurnByIndex }
}

/** Build the one-line masked summary injected in place of the content. */
function buildMaskedContent(
  block: ToolResultBlock,
  toolName: string,
  origSize: number,
  storageRef: string,
): ToolResultBlock {
  const refPart = storageRef ? ` — full content at ${storageRef}` : ''
  const summary = `[tool_result masked: ${toolName}, ${origSize} chars${refPart}]`
  return {
    ...block,
    content: [{ type: 'text', text: summary }],
  }
}

/**
 * Extract a storage reference from tool_result content.
 *
 * When BashTool / Read / PowerShell persists large output to disk, the
 * content starts with `<persisted-output>` and the second line contains the
 * filepath ("Full output saved to: <path>"). We surface that path so the
 * masked summary can point back to it.
 */
function extractStorageRef(content: unknown): string {
  const text = extractText(content)
  if (!text.startsWith('<persisted-output>')) return ''
  // "Output too large … Full output saved to: /path/to/file\n"
  const match = text.match(/Full output saved to:\s*(.+?)(?:\n|$)/)
  return match?.[1]?.trim() ?? ''
}

function rewriteMessage<T extends AnyMessage>(
  msg: T,
  newContent: unknown[],
): T {
  if (msg.message) {
    return { ...msg, message: { ...msg.message, content: newContent } }
  }
  return { ...msg, content: newContent }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export type MaskStaleObservationsOptions = {
  /** Number of assistant turns to protect (default: DEFAULT_LAST_K_TURNS). */
  lastKTurns?: number
  /** Minimum tool_result content size to consider masking (default: MIN_CONTENT_CHARS). */
  minContentChars?: number
}

/**
 * Walk `messages` and replace qualifying tool_result content with a one-line
 * summary. Returns the same array reference when no masking was applied
 * (zero-copy fast path).
 *
 * A tool_result is maskable when ALL of the following hold:
 * 1. The assistant turn that produced the matching tool_use is NOT in the
 *    last `lastKTurns` assistant turns.
 * 2. The result content text exceeds `minContentChars`.
 * 3. The result has not already been cleared (TOOL_RESULT_CLEARED_MESSAGE).
 * 4. The result contains only text blocks (image blocks are never masked).
 * 5. The tool is in the compactable set (isCompactableTool).
 *
 * The block structure (type, tool_use_id, is_error) is always preserved —
 * only the `content` field is replaced.
 */
export function maskStaleObservations<T extends AnyMessage>(
  messages: T[],
  opts: MaskStaleObservationsOptions = {},
): T[] {
  const lastK = opts.lastKTurns ?? DEFAULT_LAST_K_TURNS
  const minChars = opts.minContentChars ?? MIN_CONTENT_CHARS

  const { indices, assistantTurnByIndex } = indexToolResultMessages(messages)
  if (indices.length === 0) return messages

  // Count total assistant turns to establish the protection window.
  let totalAssistantTurns = 0
  for (const msg of messages) {
    const role = getInner(msg).role ?? msg.role
    if (role === 'assistant') totalAssistantTurns++
  }

  // Assistant turns >= this threshold are protected.
  const protectedFromTurn = Math.max(0, totalAssistantTurns - lastK)

  const toolUsesById = indexToolUses(messages)

  // O(1) lookup: messageIndex → position in the tool-result-messages list
  const indexSet = new Set(indices)

  let anyMasked = false
  const result = messages.map(msg => {
    const msgIdx = messages.indexOf(msg)
    if (!indexSet.has(msgIdx)) return msg

    const assistantTurnForThis = assistantTurnByIndex.get(msgIdx) ?? 0
    if (assistantTurnForThis >= protectedFromTurn) return msg

    const inner = getInner(msg)
    const content = inner.content as unknown[]
    let changed = false
    const newContent = content.map(block => {
      const b = block as { type?: string }
      if (b?.type !== 'tool_result') return block

      const tr = block as ToolResultBlock
      if (isAlreadyCleared(tr)) return block

      // Skip image/non-text blocks — we can't produce a lossless summary
      // of binary content.
      if (hasNonTextContent(tr.content)) return block

      const toolUse = toolUsesById.get(tr.tool_use_id ?? '')
      const toolName = toolUse?.name ?? 'tool'

      // Respect microCompact's curated safe-to-compress set.
      if (!isCompactableTool(toolName)) return block

      const origText = extractText(tr.content)
      if (origText.length < minChars) return block

      const storageRef = extractStorageRef(tr.content)
      changed = true
      anyMasked = true
      return buildMaskedContent(tr, toolName, origText.length, storageRef)
    })

    return changed ? rewriteMessage(msg, newContent) : msg
  })

  // Return the original reference when nothing changed — same pattern as
  // compressToolHistory for callers that use reference equality as a
  // "was anything modified?" signal.
  return anyMasked ? result : messages
}
