import type {
  DiscoveredTranscript,
  SummaryTranscriptMessage,
} from './harnessTypes.js'

const MAX_SUMMARY_CHARS = 60_000
const MAX_EXCERPT_CHARS = 900
const MAX_UNIQUE_ITEMS = 80
const PATH_RE =
  /(?:^|[\s('"`])((?:~?\/|\.{1,2}\/|[A-Za-z]:\\|[A-Za-z0-9_.-]+\/)[A-Za-z0-9_./\\@:+%=-]+(?:\.[A-Za-z0-9_+-]+)?)/g
const COMMAND_RE =
  /(?:^|\n)\s*(?:\$ )?((?:bun|npm|pnpm|yarn|node|python|python3|git|rg|grep|find|sed|cat|ls|cd|mkdir|cp|mv|rm|curl|pytest|cargo|go|make|docker|limitless|claude|codex)\b[^\n]{0,240})/g
const DECISION_RE =
  /\b(decided|decision|chose|agreed|confirmed|root cause|fixed|implemented|changed|removed|added|created|patched|reverted|verified|blocked|failed|passed|error|issue|bug|todo|next)\b/i

function cleanText(text: string): string {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/\t/g, '  ')
    .replace(/[ \f\v]+/g, ' ')
    .replace(/\n{4,}/g, '\n\n\n')
    .trim()
}

function truncateMiddle(text: string, max = MAX_EXCERPT_CHARS): string {
  const cleaned = cleanText(text)
  if (cleaned.length <= max) return cleaned
  const head = Math.floor(max * 0.62)
  const tail = max - head - 34
  return `${cleaned.slice(0, head).trimEnd()}\n...[middle omitted]...\n${cleaned
    .slice(-tail)
    .trimStart()}`
}

function isLikelyInstruction(text: string): boolean {
  return /\b(please|need|want|make|build|fix|delete|remove|add|create|change|update|set|inspect|examine|find|prepare|resume|summarize|compact|verify|commit|push|run|search|look)\b/i.test(
    text,
  )
}

function extractMatches(messages: SummaryTranscriptMessage[], re: RegExp): string[] {
  const seen = new Set<string>()
  const out: string[] = []

  for (const msg of messages) {
    re.lastIndex = 0
    let match: RegExpExecArray | null
    while ((match = re.exec(msg.text)) && out.length < MAX_UNIQUE_ITEMS) {
      const value = cleanText(match[1] ?? match[0]).replace(/[),.;:]+$/g, '')
      if (value.length < 2 || seen.has(value)) continue
      seen.add(value)
      out.push(value)
    }
  }

  return out
}

function pickCoverageIndexes(length: number): number[] {
  if (length <= 18) {
    return Array.from({ length }, (_, index) => index)
  }

  const indexes = new Set<number>()
  for (let i = 0; i < Math.min(6, length); i++) indexes.add(i)
  for (let i = Math.max(0, length - 8); i < length; i++) indexes.add(i)

  const buckets = 10
  for (let bucket = 1; bucket < buckets; bucket++) {
    indexes.add(Math.floor((length * bucket) / buckets))
  }

  return Array.from(indexes).sort((a, b) => a - b)
}

function section(title: string, body: string | string[]): string {
  const lines = Array.isArray(body) ? body : body.split('\n')
  const content = lines.filter(line => line.trim().length > 0)
  if (content.length === 0) return `## ${title}\n- None captured.`
  return `## ${title}\n${content.join('\n')}`
}

function bulletize(items: string[], empty = '- None captured.'): string[] {
  if (items.length === 0) return [empty]
  return items.map(item => `- ${item}`)
}

function formatMessageLine(
  msg: SummaryTranscriptMessage,
  index: number,
  total: number,
): string {
  const timestamp = msg.timestamp ? ` @ ${msg.timestamp}` : ''
  const rawRole =
    msg.rawRole && msg.rawRole !== msg.role ? ` (${msg.rawRole})` : ''
  return `- [${index + 1}/${total}] ${msg.role}${rawRole}${timestamp}: ${truncateMiddle(
    msg.text,
  )}`
}

export function buildCrossHarnessResumeSummary(args: {
  transcript: DiscoveredTranscript
  messages: SummaryTranscriptMessage[]
  sourceLabel?: string
}): string {
  const { transcript } = args
  const messages = args.messages
    .map(msg => ({ ...msg, text: cleanText(msg.text) }))
    .filter(msg => msg.text.length > 0)

  const userMessages = messages.filter(msg => msg.role === 'user')
  const assistantMessages = messages.filter(msg => msg.role === 'assistant')
  const instructions = userMessages
    .filter(msg => isLikelyInstruction(msg.text))
    .map((msg, index) => `${index + 1}. ${truncateMiddle(msg.text, 700)}`)
    .slice(0, 40)
  const decisions = messages
    .filter(msg => DECISION_RE.test(msg.text))
    .map((msg, index) => `${index + 1}. ${msg.role}: ${truncateMiddle(msg.text, 700)}`)
    .slice(0, 60)
  const paths = extractMatches(messages, PATH_RE)
  const commands = extractMatches(messages, COMMAND_RE)
  const coverage = pickCoverageIndexes(messages.length).map(index =>
    formatMessageLine(messages[index]!, index, messages.length),
  )
  const tail = messages
    .slice(-12)
    .map((msg, offset, arr) =>
      formatMessageLine(msg, messages.length - arr.length + offset, messages.length),
    )

  const parts = [
    `# Cross-Harness Resume Summary

This is a full-session resume seed generated from a ${args.sourceLabel ?? transcript.harness} transcript. It is intended to let a different harness continue the work without access to the original runtime state or full message history.`,
    section('Source Session', [
      `- Harness: ${transcript.harness}`,
      `- Session ID: ${transcript.sessionId}`,
      `- Title/name: ${transcript.sessionName}`,
      `- Transcript path: ${transcript.path}`,
      `- Working directory: ${transcript.cwd ?? '(unknown)'}`,
      `- Indexed message count: ${transcript.messageCount}`,
      `- Parsed resumable messages: ${messages.length} (${userMessages.length} user, ${assistantMessages.length} assistant)`,
      `- Modified: ${new Date(transcript.modifiedMs).toISOString()}`,
    ]),
    section('Primary User Requests', instructions),
    section(
      'Decisions, State Changes, Errors, and Verifications',
      decisions.length > 0
        ? decisions.map(item => `- ${item}`)
        : ['- No explicit decision/state lines were detected. Use the timeline below.'],
    ),
    section('Files, Paths, and Repositories Mentioned', bulletize(paths)),
    section('Commands and Tool Evidence Mentioned', bulletize(commands)),
    section('Whole-Session Timeline Coverage', coverage),
    section('Most Recent Context to Continue From', tail),
    section('Resume Instructions', [
      '- Treat this summary as the authoritative continuity artifact for the imported session.',
      '- Continue from the most recent context above, while preserving earlier decisions and constraints.',
      '- If a referenced file or command result matters, inspect the local workspace or transcript path before assuming it is still current.',
      '- Do not ask the user to recap unless the summary explicitly shows a missing credential, missing external system, or irreconcilable ambiguity.',
    ]),
  ]

  const full = parts.join('\n\n').trim()
  if (full.length <= MAX_SUMMARY_CHARS) return full

  const overflowNote = `\n\n## Truncation Notice\n- The deterministic resume summary exceeded ${MAX_SUMMARY_CHARS} characters and was middle-truncated. The full transcript remains at: ${transcript.path}`
  return truncateMiddle(full, MAX_SUMMARY_CHARS - overflowNote.length) + overflowNote
}
