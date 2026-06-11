// Mnemo auto-recall at loop initialization.
//
// Per the 2026-05-14 conversation slice (tenet/docs/harness-engineering-
// conversation-slice.md, msg 14): "Mnemo functions as a knowledge store;
// retrieval is left to my discretion; my discretion is exactly what's
// broken. For Mnemo to actually solve this class of failure, it has to
// evolve from 'knowledge that I query when I think to' into 'knowledge
// that fires automatically at decision points I can't bypass.'"
//
// This module is the structural fix: at queryLoop entry, automatically
// query Mnemo for memories relevant to the user's first prompt and
// inject them as a system message before the model's first turn. The
// model gets the prior context whether it would have thought to query
// Mnemo or not.
//
// v1 scope: scaffold + helper functions + injection format. The actual
// MCP client call is abstracted behind a RecallFn callback so the
// runtime wiring (which needs the live MCP client context) can be done
// in a follow-up commit without changing this module's contract.

/**
 * A recalled memory entry. The shape is intentionally compact — just
 * enough for the model to know what's there and decide if it's
 * relevant. Full details can be queried via mnemo_recall on-demand.
 */
export type RecalledMemory = {
  uuid: string
  content: string
  source: string
  importance: number
  recalledAtTurn: number
}

/** Bag of recalled memories for the current loop. */
export type MnemoContext = {
  query: string
  results: RecalledMemory[]
  retrievedAtTimestamp: number
}

/**
 * Recall function abstraction. The harness calls this with the user's
 * first prompt; the function returns relevant memories. In production
 * this wraps the MCP mnemo_recall tool; in tests it's a stub.
 */
export type RecallFn = (args: {
  query: string
  limit?: number
}) => Promise<RecalledMemory[]>

/**
 * Read the auto-recall env flag. When set to '1', the loop performs an
 * automatic Mnemo recall at session start. Default off so legacy installs
 * see no behavior change.
 */
export function isMnemoAutoRecallEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return (env.LIMITLESS_MNEMO_AUTO_RECALL) === '1'
}

/**
 * How many memories to inject by default. Bounded to keep the system
 * prompt manageable — the model can mnemo_recall for more on demand.
 */
export const DEFAULT_AUTO_RECALL_LIMIT = 5

/**
 * Extract a recall query from the user's first prompt. v1 is the
 * identity transform with bounds; a future version may run a
 * summarization pass for long prompts.
 */
export function buildRecallQuery(firstUserPrompt: string): string {
  return firstUserPrompt.trim().slice(0, 500)
}

/**
 * Execute the auto-recall against the supplied RecallFn. Returns null
 * when the env flag is off OR the user prompt is empty (Q&A with no
 * prior context). Otherwise returns the MnemoContext for the caller
 * to inject.
 *
 * Wraps the recall in a try/catch so a transient MCP failure can't
 * brick the loop — at worst the model starts without prior context,
 * same as a session before this feature shipped.
 */
export async function performAutoRecall(args: {
  firstUserPrompt: string
  recall: RecallFn
  limit?: number
  now: number
  env?: NodeJS.ProcessEnv
}): Promise<MnemoContext | null> {
  if (!isMnemoAutoRecallEnabled(args.env)) return null
  const query = buildRecallQuery(args.firstUserPrompt)
  if (query.length === 0) return null

  let results: RecalledMemory[] = []
  try {
    results = await args.recall({
      query,
      limit: args.limit ?? DEFAULT_AUTO_RECALL_LIMIT,
    })
  } catch {
    // Swallow — auto-recall is best-effort. The model can still
    // mnemo_recall on-demand if it wants prior context.
    return null
  }

  if (results.length === 0) return null

  return {
    query,
    results,
    retrievedAtTimestamp: args.now,
  }
}

/**
 * Build the system-message content that injects MnemoContext into the
 * next-turn context. Compact but informative — the model gets the
 * top-K memories with their importance and content, plus a reminder
 * to mnemo_recall for related entries.
 */
export function buildMnemoHandoffMessage(ctx: MnemoContext): string {
  if (ctx.results.length === 0) return ''
  const lines = [
    '<mnemo-auto-recall>',
    `Auto-recall returned ${ctx.results.length} memories relevant to your current task.`,
    'Query: ' + ctx.query,
    '',
    'Memories:',
  ]
  for (const m of ctx.results) {
    lines.push(
      `  [${m.uuid.slice(0, 8)}, importance=${m.importance.toFixed(2)}, source=${m.source}]`,
    )
    // Indent + truncate each memory's content for legibility.
    const content = m.content.length > 400
      ? m.content.slice(0, 400) + '…'
      : m.content
    for (const line of content.split('\n')) {
      lines.push('    ' + line)
    }
    lines.push('')
  }
  lines.push(
    'These are prior decisions, findings, and corrections. Treat them as the operator\'s working notes — they will not always be perfectly current. If you find a contradiction, mnemo_recall a fresher query OR mnemo_invalidate the stale entry.',
  )
  lines.push('</mnemo-auto-recall>')
  return lines.join('\n')
}
