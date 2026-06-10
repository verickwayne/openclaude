import { describe, expect, it } from 'bun:test'
import {
  buildMnemoHandoffMessage,
  buildRecallQuery,
  DEFAULT_AUTO_RECALL_LIMIT,
  isMnemoAutoRecallEnabled,
  performAutoRecall,
  type MnemoContext,
  type RecallFn,
  type RecalledMemory,
} from './autoRecall.js'

describe('isMnemoAutoRecallEnabled', () => {
  it('returns false when env is unset (default off)', () => {
    expect(isMnemoAutoRecallEnabled({})).toBe(false)
  })

  it('returns true when env explicitly enables', () => {
    expect(
      isMnemoAutoRecallEnabled({ LIMITLESS_MNEMO_AUTO_RECALL: '1' }),
    ).toBe(true)
  })

  it('only "1" enables (other truthy values are ignored)', () => {
    expect(
      isMnemoAutoRecallEnabled({ LIMITLESS_MNEMO_AUTO_RECALL: 'true' }),
    ).toBe(false)
    expect(
      isMnemoAutoRecallEnabled({ LIMITLESS_MNEMO_AUTO_RECALL: 'yes' }),
    ).toBe(false)
  })
})

describe('buildRecallQuery', () => {
  it('returns the trimmed prompt for short inputs', () => {
    expect(buildRecallQuery('  do thing  ')).toBe('do thing')
  })

  it('truncates at 500 chars', () => {
    expect(buildRecallQuery('x'.repeat(2_000)).length).toBe(500)
  })

  it('returns empty for whitespace-only inputs', () => {
    expect(buildRecallQuery('   \n  \t  ')).toBe('')
  })
})

describe('performAutoRecall', () => {
  const stubRecall: RecallFn = async () => [
    {
      uuid: 'aaaa1111-bbbb-2222-cccc-3333dddd4444',
      content: 'stub memory',
      source: 'claude-code',
      importance: 0.5,
      recalledAtTurn: 1,
    },
  ]

  it('returns null when env is off', async () => {
    const ctx = await performAutoRecall({
      firstUserPrompt: 'edit src/foo.ts',
      recall: stubRecall,
      now: 0,
      env: {},
    })
    expect(ctx).toBeNull()
  })

  it('returns null when the prompt is empty after trim', async () => {
    const ctx = await performAutoRecall({
      firstUserPrompt: '   ',
      recall: stubRecall,
      now: 0,
      env: { LIMITLESS_MNEMO_AUTO_RECALL: '1' },
    })
    expect(ctx).toBeNull()
  })

  it('returns null when recall returns zero memories (nothing relevant)', async () => {
    const ctx = await performAutoRecall({
      firstUserPrompt: 'something',
      recall: async () => [],
      now: 0,
      env: { LIMITLESS_MNEMO_AUTO_RECALL: '1' },
    })
    expect(ctx).toBeNull()
  })

  it('returns MnemoContext when env is on and memories exist', async () => {
    const ctx = await performAutoRecall({
      firstUserPrompt: 'refactor auth',
      recall: stubRecall,
      now: 1700000000,
      env: { LIMITLESS_MNEMO_AUTO_RECALL: '1' },
    })
    expect(ctx).not.toBeNull()
    if (ctx) {
      expect(ctx.query).toBe('refactor auth')
      expect(ctx.results).toHaveLength(1)
      expect(ctx.retrievedAtTimestamp).toBe(1700000000)
    }
  })

  it('respects the limit parameter', async () => {
    let capturedLimit: number | undefined
    await performAutoRecall({
      firstUserPrompt: 'x',
      recall: async args => {
        capturedLimit = args.limit
        return [
          {
            uuid: 'u',
            content: 'c',
            source: 's',
            importance: 0.5,
            recalledAtTurn: 1,
          },
        ]
      },
      limit: 7,
      now: 0,
      env: { LIMITLESS_MNEMO_AUTO_RECALL: '1' },
    })
    expect(capturedLimit).toBe(7)
  })

  it('uses DEFAULT_AUTO_RECALL_LIMIT when not specified', async () => {
    let capturedLimit: number | undefined
    await performAutoRecall({
      firstUserPrompt: 'x',
      recall: async args => {
        capturedLimit = args.limit
        return [
          {
            uuid: 'u',
            content: 'c',
            source: 's',
            importance: 0.5,
            recalledAtTurn: 1,
          },
        ]
      },
      now: 0,
      env: { LIMITLESS_MNEMO_AUTO_RECALL: '1' },
    })
    expect(capturedLimit).toBe(DEFAULT_AUTO_RECALL_LIMIT)
  })

  it('swallows recall errors and returns null (best-effort)', async () => {
    const ctx = await performAutoRecall({
      firstUserPrompt: 'x',
      recall: async () => {
        throw new Error('mcp connection refused')
      },
      now: 0,
      env: { LIMITLESS_MNEMO_AUTO_RECALL: '1' },
    })
    expect(ctx).toBeNull()
  })
})

describe('buildMnemoHandoffMessage', () => {
  it('returns empty string when results are empty', () => {
    const ctx: MnemoContext = {
      query: 'x',
      results: [],
      retrievedAtTimestamp: 0,
    }
    expect(buildMnemoHandoffMessage(ctx)).toBe('')
  })

  it('formats memories with uuid prefix + importance + source + content', () => {
    const results: RecalledMemory[] = [
      {
        uuid: 'aaaa1111-bbbb-2222-cccc-3333dddd4444',
        content: 'remembered finding',
        source: 'claude-code',
        importance: 0.7,
        recalledAtTurn: 1,
      },
    ]
    const msg = buildMnemoHandoffMessage({
      query: 'q',
      results,
      retrievedAtTimestamp: 0,
    })
    expect(msg).toContain('mnemo-auto-recall')
    expect(msg).toContain('aaaa1111')
    expect(msg).toContain('importance=0.70')
    expect(msg).toContain('source=claude-code')
    expect(msg).toContain('remembered finding')
    expect(msg).toContain('Query: q')
  })

  it('truncates long memory content', () => {
    const results: RecalledMemory[] = [
      {
        uuid: 'a',
        content: 'x'.repeat(2_000),
        source: 's',
        importance: 0.5,
        recalledAtTurn: 1,
      },
    ]
    const msg = buildMnemoHandoffMessage({
      query: 'q',
      results,
      retrievedAtTimestamp: 0,
    })
    expect(msg.length).toBeLessThan(1_000)
    expect(msg).toContain('…')
  })

  it('includes guidance to mnemo_recall for fresher / mnemo_invalidate for stale', () => {
    const msg = buildMnemoHandoffMessage({
      query: 'q',
      results: [
        {
          uuid: 'u',
          content: 'c',
          source: 's',
          importance: 0.5,
          recalledAtTurn: 1,
        },
      ],
      retrievedAtTimestamp: 0,
    })
    expect(msg).toContain('mnemo_recall')
    expect(msg).toContain('mnemo_invalidate')
  })
})
