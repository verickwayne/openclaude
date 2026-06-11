import React from 'react'
import { MessageResponse } from '../../components/MessageResponse.js'
import { TOOL_SUMMARY_MAX_LENGTH } from '../../constants/toolLimits.js'
import { Box, Text } from '../../ink.js'
import { truncate } from '../../utils/format.js'
import type { Output } from './WebBrowserTool.js'

export function renderToolUseMessage(
  input: Partial<{
    action: string
    query: string
    url: string
  }>,
  { verbose }: { verbose: boolean },
): React.ReactNode {
  const target = input.action === 'open' ? input.url : input.query
  if (!target) return null
  return verbose ? `${input.action ?? 'browse'}: ${target}` : target
}

export function renderToolUseProgressMessage(): React.ReactNode {
  return (
    <MessageResponse height={1}>
      <Text dimColor>Browsing…</Text>
    </MessageResponse>
  )
}

export function renderToolResultMessage(output: Output): React.ReactNode {
  const timeDisplay =
    output.durationMs >= 1000
      ? `${Math.round(output.durationMs / 1000)}s`
      : `${Math.round(output.durationMs)}ms`
  const label =
    output.action === 'search'
      ? `Found ${output.results?.length ?? 0} result${(output.results?.length ?? 0) === 1 ? '' : 's'}`
      : `Opened ${output.url ?? 'page'}`

  return (
    <Box justifyContent="space-between" width="100%">
      <MessageResponse height={1}>
        <Text>
          {label} in {timeDisplay}
        </Text>
      </MessageResponse>
    </Box>
  )
}

export function getToolUseSummary(
  input:
    | Partial<{
        action: string
        query: string
        url: string
      }>
    | undefined,
): string | null {
  if (!input) return null
  const target = input.action === 'open' ? input.url : input.query
  return target ? truncate(target, TOOL_SUMMARY_MAX_LENGTH) : null
}
