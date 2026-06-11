import type { TranscriptMessage } from '../../types/logs.js'

export type HarnessId = 'limitless' | 'claude' | 'codex' | 'unknown'

export type ResumeMode = 'full' | 'summary'

export type DiscoveredTranscript = {
  harness: HarnessId
  /** Absolute path to the transcript file on disk. */
  path: string
  /** Stable id used for search/resume (sessionId for claude/limitless/codex). */
  sessionId: string
  /** Human-facing name: custom title / codex thread_name / first prompt. */
  sessionName: string
  firstPrompt: string
  /** Working directory the session ran in, if known. */
  cwd: string | null
  messageCount: number
  /** File mtime epoch ms — used for incremental refresh and sort. */
  modifiedMs: number
}

export type SummaryTranscriptMessage = {
  role: 'user' | 'assistant'
  text: string
  timestamp?: string
  rawRole?: string
}

export interface HarnessAdapter {
  readonly harness: HarnessId
  /**
   * Reconstruct the foreign transcript into Limitless `TranscriptMessage`
   * records (root→leaf), rewriting ids to `newSessionId`.
   */
  toLimitlessTranscript(
    t: DiscoveredTranscript,
    newSessionId: string,
  ): TranscriptMessage[]
  /** Produce a full-session plain-text summary seed for cross-harness resume. */
  summarize(t: DiscoveredTranscript): string
}

export type CrossHarnessIndex = {
  version: 1
  generatedMs: number
  entries: DiscoveredTranscript[]
}
