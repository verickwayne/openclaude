import { describe, expect, test } from 'bun:test'
import { mergeCrossHarnessLogs } from '../../../src/commands/resume/crossHarnessMerge.js'
import type { DiscoveredTranscript } from '../../../src/services/crossHarness/harnessTypes.js'
import type { LogOption } from '../../../src/types/logs.js'

function nativeLog(sessionId: string, modifiedMs: number, overrides: Partial<LogOption> = {}): LogOption {
  const d = new Date(modifiedMs)
  return {
    sessionId,
    tag: 'limitless',
    firstPrompt: `native ${sessionId}`,
    messageCount: 3,
    created: d,
    modified: d,
    messages: [],
    date: d.toISOString(),
    value: 0,
    isSidechain: false,
    ...overrides,
  } as LogOption
}

function entry(sessionId: string, modifiedMs: number, overrides: Partial<DiscoveredTranscript> = {}): DiscoveredTranscript {
  return {
    harness: 'codex',
    path: `/tmp/${sessionId}.jsonl`,
    sessionId,
    sessionName: `Session ${sessionId}`,
    firstPrompt: `hello from ${sessionId}`,
    cwd: '/tmp',
    messageCount: 7,
    modifiedMs,
    ...overrides,
  }
}

describe('mergeCrossHarnessLogs', () => {
  test('keeps native logs and preserves their tag', () => {
    const native = nativeLog('native-1', 1000, { tag: 'limitless' })
    const result = mergeCrossHarnessLogs([native], [])
    expect(result).toHaveLength(1)
    expect(result[0]!.sessionId).toBe('native-1')
    expect(result[0]!.tag).toBe('limitless')
    expect(result[0]!.crossHarness).toBeUndefined()
  })

  test('drops a foreign entry whose sessionId duplicates a native one (native wins)', () => {
    const native = nativeLog('dup-id', 5000, { tag: 'limitless', firstPrompt: 'native version' })
    const dup = entry('dup-id', 9000) // newer mtime, but should still be dropped
    const result = mergeCrossHarnessLogs([native], [dup])
    expect(result).toHaveLength(1)
    expect(result[0]!.sessionId).toBe('dup-id')
    expect(result[0]!.tag).toBe('limitless')
    expect(result[0]!.firstPrompt).toBe('native version')
    expect(result[0]!.crossHarness).toBeUndefined()
  })

  test('turns a fresh codex entry into a tagged LogOption with crossHarness set', () => {
    const e = entry('codex-1', 2000, {
      harness: 'codex',
      sessionName: 'My Thread',
      firstPrompt: 'do the thing',
      messageCount: 12,
    })
    const result = mergeCrossHarnessLogs([], [e])
    expect(result).toHaveLength(1)
    const log = result[0]!
    expect(log.sessionId).toBe('codex-1')
    expect(log.tag).toBe('codex')
    expect(log.customTitle).toBe('[codex] My Thread')
    expect(log.firstPrompt).toBe('do the thing')
    expect(log.messageCount).toBe(12)
    expect(log.messages).toEqual([])
    expect(log.crossHarness).toBe(e)
    expect(log.created.getTime()).toBe(2000)
    expect(log.modified.getTime()).toBe(2000)
  })

  test('returns result sorted by modified desc (native + foreign interleaved)', () => {
    const native = nativeLog('n', 3000)
    const older = entry('codex-old', 1000)
    const newer = entry('codex-new', 9000)
    const result = mergeCrossHarnessLogs([native], [older, newer])
    expect(result.map(r => r.sessionId)).toEqual(['codex-new', 'n', 'codex-old'])
  })
})
