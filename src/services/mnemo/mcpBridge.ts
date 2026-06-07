// Bridge from the autoRecall.ts RecallFn contract to a live MCP client.
//
// The auto-recall mechanism shipped in Workstream 3 v1 was scaffolding:
// types + helpers + a callback abstraction (RecallFn) for the actual
// retrieval. This module is the v2 wiring — it finds a connected Mnemo
// MCP server in the toolUseContext's mcpClients array and binds a
// RecallFn that calls the live mnemo_recall tool.
//
// Failure modes (all surfaced as `null` from createMnemoRecallFn, or
// thrown rejections from the returned RecallFn that performAutoRecall
// will catch in its try block):
//   - No Mnemo server in the mcpClients array → null at bridge time.
//   - Server in mcpClients but not 'connected' state → null at bridge time.
//   - callTool() rejects (transport closed, server panic, etc.) → the
//     RecallFn rethrows. performAutoRecall's try/catch makes this a
//     soft failure for the loop.
//   - mnemo_recall returns ok=false → empty array (no warning; the
//     model can still mnemo_recall on-demand).
//
// Identifying the Mnemo server: match on the server name prefix
// "mnemo" case-insensitively. The full normalized name in the
// MCP registry is something like `plugin_mnemo-claude-code_mnemo`
// or `mnemo`. Matching loosely lets the bridge survive name drift.

import type {
  MCPServerConnection,
  ConnectedMCPServer,
} from '../mcp/types.js'
import type { RecallFn, RecalledMemory } from './autoRecall.js'

/** Tool name to invoke on the Mnemo MCP server. */
export const MNEMO_RECALL_TOOL = 'mnemo_recall'

/**
 * Find the connected Mnemo MCP server in the supplied client list. Returns
 * undefined when no candidate exists.
 */
export function findMnemoServer(
  clients: readonly MCPServerConnection[],
): ConnectedMCPServer | undefined {
  for (const c of clients) {
    if (c.type !== 'connected') continue
    if (looksLikeMnemoServerName(c.name)) return c
    // Some installs report the server-info name separately from the
    // registry name. Check both.
    if (c.serverInfo && looksLikeMnemoServerName(c.serverInfo.name)) return c
  }
  return undefined
}

function looksLikeMnemoServerName(name: string): boolean {
  // Loose substring match. Used over /\bmnemo\b/i because JS regex treats
  // underscore as a word character, so the boundary anchors would miss
  // names like `plugin_mnemo-claude-code_mnemo` (which is the actual
  // registry name in production).
  return name.toLowerCase().includes('mnemo')
}

/**
 * Build a RecallFn from a live MCP client list. Returns null when no
 * Mnemo server is available — the caller should treat that as "auto-
 * recall is silently disabled this session" and proceed.
 */
export function createMnemoRecallFn(
  clients: readonly MCPServerConnection[],
  /**
   * Optional abort signal to thread into the underlying callTool().
   * Tied to the loop's lifecycle so a long-running recall can't outlive
   * the agent turn.
   */
  signal?: AbortSignal,
): RecallFn | null {
  const mnemo = findMnemoServer(clients)
  if (!mnemo) return null

  return async ({ query, limit }) => {
    const args: Record<string, unknown> = { query }
    if (typeof limit === 'number') args.limit = limit

    // The SDK Client.callTool signature accepts (request, resultSchema?, options?).
    // We don't pass a resultSchema — the raw envelope is fine here because the
    // payload shape is well-known.
    const result = (await mnemo.client.callTool(
      { name: MNEMO_RECALL_TOOL, arguments: args },
      undefined,
      { signal },
    )) as { content?: unknown; isError?: boolean }

    if (result.isError === true) return []
    return parseRecallResult(result.content)
  }
}

/**
 * Parse the MCP tool-result content into RecalledMemory[]. mnemo_recall
 * returns its payload as a single text content block whose body is a
 * JSON object `{ ok, results: [...], count, query_ms }`. We extract
 * `results` and map each row into the bridge's RecalledMemory shape.
 *
 * Returns [] on any unexpected shape — the caller treats absence of
 * memories as "no auto-recall content," not as an error.
 */
export function parseRecallResult(content: unknown): RecalledMemory[] {
  if (!Array.isArray(content)) return []
  for (const block of content) {
    if (!isTextBlock(block)) continue
    const parsed = safeJsonParse(block.text)
    if (!parsed) continue
    const results = (parsed as { results?: unknown }).results
    if (!Array.isArray(results)) continue
    const memories: RecalledMemory[] = []
    for (const row of results) {
      const mem = toRecalledMemory(row)
      if (mem) memories.push(mem)
    }
    return memories
  }
  return []
}

function isTextBlock(b: unknown): b is { type: 'text'; text: string } {
  return (
    typeof b === 'object' &&
    b !== null &&
    (b as { type?: unknown }).type === 'text' &&
    typeof (b as { text?: unknown }).text === 'string'
  )
}

function safeJsonParse(s: string): unknown {
  try {
    return JSON.parse(s)
  } catch {
    return null
  }
}

function toRecalledMemory(row: unknown): RecalledMemory | null {
  if (typeof row !== 'object' || row === null) return null
  const r = row as Record<string, unknown>
  const uuid = typeof r.uuid === 'string' ? r.uuid : null
  const content =
    typeof r.content === 'string'
      ? r.content
      : typeof r.fact === 'string'
        ? r.fact
        : null
  if (uuid === null || content === null) return null
  const source =
    typeof r.source === 'string' ? r.source : 'unknown'
  const importance =
    typeof r.importance === 'number' ? r.importance : 0.5
  return {
    uuid,
    content,
    source,
    importance,
    recalledAtTurn: 0, // caller may overwrite
  }
}
