import type { Message } from '../../types/message.js'
import { roughTokenCountEstimation } from '../tokenEstimation.js'
import { extractTextFromContent } from './text.js'

export type ContextLaneId =
  | 'system'
  | 'tools'
  | 'recent_messages'
  | 'older_messages'
  | 'tool_results'
  | 'mnemo'
  | 'repo_map'
  | 'other'

export type ContextLane = {
  id: ContextLaneId
  label: string
  priority: number
  budgetTokens: number
  estimatedTokens: number
  itemCount: number
  policy: 'keep' | 'compress' | 'retrieve' | 'isolate'
}

export type ContextCompileReport = {
  totalEstimatedTokens: number
  budgetTokens: number
  lanes: ContextLane[]
  overflowTokens: number
}

const DEFAULT_LANES: Record<ContextLaneId, Omit<ContextLane, 'estimatedTokens' | 'itemCount'>> = {
  system: {
    id: 'system',
    label: 'System prompt',
    priority: 100,
    budgetTokens: 24_000,
    policy: 'keep',
  },
  tools: {
    id: 'tools',
    label: 'Tool schemas',
    priority: 90,
    budgetTokens: 40_000,
    policy: 'keep',
  },
  recent_messages: {
    id: 'recent_messages',
    label: 'Recent conversation',
    priority: 80,
    budgetTokens: 80_000,
    policy: 'keep',
  },
  older_messages: {
    id: 'older_messages',
    label: 'Older conversation',
    priority: 40,
    budgetTokens: 40_000,
    policy: 'compress',
  },
  tool_results: {
    id: 'tool_results',
    label: 'Tool results',
    priority: 50,
    budgetTokens: 40_000,
    policy: 'compress',
  },
  mnemo: {
    id: 'mnemo',
    label: 'Mnemo recall',
    priority: 70,
    budgetTokens: 1_200,
    policy: 'retrieve',
  },
  repo_map: {
    id: 'repo_map',
    label: 'Repository map',
    priority: 60,
    budgetTokens: 1_500,
    policy: 'retrieve',
  },
  other: {
    id: 'other',
    label: 'Other context',
    priority: 10,
    budgetTokens: 8_000,
    policy: 'compress',
  },
}

function emptyLane(id: ContextLaneId): ContextLane {
  return {
    ...DEFAULT_LANES[id],
    estimatedTokens: 0,
    itemCount: 0,
  }
}

function messageTokenEstimate(message: Message): number {
  const inner = ((message as { message?: unknown }).message ?? message) as {
    content?: unknown
  }
  const text = extractTextFromContent(inner.content)
  if (text.length > 0) return roughTokenCountEstimation(text)
  return roughTokenCountEstimation(JSON.stringify(inner.content ?? ''))
}

function hasToolResult(message: Message): boolean {
  const inner = ((message as { message?: unknown }).message ?? message) as {
    content?: unknown
  }
  return (
    Array.isArray(inner.content) &&
    inner.content.some(
      block =>
        typeof block === 'object' &&
        block !== null &&
        (block as { type?: unknown }).type === 'tool_result',
    )
  )
}

export function compileContextReport(options: {
  messages: Message[]
  budgetTokens: number
  recentMessageCount?: number
  mnemoText?: string
  repoMapText?: string
}): ContextCompileReport {
  const lanes = new Map<ContextLaneId, ContextLane>()
  for (const id of Object.keys(DEFAULT_LANES) as ContextLaneId[]) {
    lanes.set(id, emptyLane(id))
  }

  const recentCount = options.recentMessageCount ?? 12
  const recentStart = Math.max(0, options.messages.length - recentCount)

  for (let i = 0; i < options.messages.length; i++) {
    const message = options.messages[i]
    const laneId: ContextLaneId = hasToolResult(message)
      ? 'tool_results'
      : i >= recentStart
        ? 'recent_messages'
        : 'older_messages'
    const lane = lanes.get(laneId)!
    lane.estimatedTokens += messageTokenEstimate(message)
    lane.itemCount += 1
  }

  if (options.mnemoText) {
    const lane = lanes.get('mnemo')!
    lane.estimatedTokens = roughTokenCountEstimation(options.mnemoText)
    lane.itemCount = 1
  }
  if (options.repoMapText) {
    const lane = lanes.get('repo_map')!
    lane.estimatedTokens = roughTokenCountEstimation(options.repoMapText)
    lane.itemCount = 1
  }

  const laneList = [...lanes.values()]
  const totalEstimatedTokens = laneList.reduce(
    (sum, lane) => sum + lane.estimatedTokens,
    0,
  )
  return {
    totalEstimatedTokens,
    budgetTokens: options.budgetTokens,
    lanes: laneList,
    overflowTokens: Math.max(0, totalEstimatedTokens - options.budgetTokens),
  }
}

