import { roughTokenCountEstimation } from '../tokenEstimation.js'

export function clampToTokenBudget(text: string, maxTokens: number): string {
  if (maxTokens <= 0 || text.length === 0) return ''
  if (roughTokenCountEstimation(text) <= maxTokens) return text

  // roughTokenCountEstimation is char based, so binary search is stable and
  // cheap. Prefer cutting at a line boundary for readable context blocks.
  let lo = 0
  let hi = text.length
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2)
    if (roughTokenCountEstimation(text.slice(0, mid)) <= maxTokens) {
      lo = mid
    } else {
      hi = mid - 1
    }
  }

  const hardCut = text.slice(0, lo)
  const lastNewline = hardCut.lastIndexOf('\n')
  const cut = lastNewline > Math.floor(hardCut.length * 0.6)
    ? hardCut.slice(0, lastNewline)
    : hardCut
  return `${cut}\n[...context block truncated to ${maxTokens} token budget]`
}

export function extractTextFromContent(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  const parts: string[] = []
  for (const block of content) {
    if (typeof block === 'string') {
      parts.push(block)
      continue
    }
    if (typeof block !== 'object' || block === null) continue
    const b = block as Record<string, unknown>
    if (typeof b.text === 'string') parts.push(b.text)
    if (typeof b.content === 'string') parts.push(b.content)
  }
  return parts.join('\n')
}

export function getLastRealUserText(messages: Array<Record<string, unknown>>): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]
    if (msg?.type !== 'user' || msg?.isMeta === true) continue
    const inner = (msg.message ?? msg) as { content?: unknown }
    const text = extractTextFromContent(inner.content).trim()
    if (text.length > 0) return text
  }
  return ''
}

