import { afterAll, beforeEach, expect, mock, test } from 'bun:test'
import {
  acquireSharedMutationLock,
  releaseSharedMutationLock,
} from '../../test/sharedMutationLock.js'
import {
  DEFAULT_LAST_K_TURNS,
  isObservationMaskingEnabled,
  maskStaleObservations,
  MIN_CONTENT_CHARS,
} from './maskStaleObservations.js'

// Mock microCompact so tests are deterministic and don't need the full module.
mock.module('../compact/microCompact.js', () => ({
  isCompactableTool: (name: string) => {
    const SAFE = new Set(['Read', 'Bash', 'Grep', 'LS', 'Edit', 'Write', 'WebFetch'])
    return SAFE.has(name) || name.startsWith('mcp__')
  },
}))

await acquireSharedMutationLock('services/api/maskStaleObservations.test.ts')

afterAll(() => {
  try {
    mock.restore()
  } finally {
    releaseSharedMutationLock()
  }
})

// ---------------------------------------------------------------------------
// Message-builder helpers
// ---------------------------------------------------------------------------

type Block = Record<string, unknown>
type Msg = { role: string; content: Block[] | string }

function bigText(n: number): string {
  return 'x'.repeat(n)
}

let nextId = 0

function buildToolExchange(
  toolName: string,
  resultLength: number,
  contentOverride?: string,
): Msg[] {
  const id = `toolu_${nextId++}`
  return [
    {
      role: 'assistant',
      content: [
        {
          type: 'tool_use',
          id,
          name: toolName,
          input: { file_path: `/file${nextId}.ts` },
        },
      ],
    },
    {
      role: 'user',
      content: [
        {
          type: 'tool_result',
          tool_use_id: id,
          content: contentOverride ?? bigText(resultLength),
        },
      ],
    },
  ]
}

/**
 * Build a conversation with `n` tool exchanges, each with `resultLength`-char
 * content. All tool exchanges use `toolName` (default 'Read').
 */
function buildConversation(
  n: number,
  resultLength = 3_000,
  toolName = 'Read',
): Msg[] {
  const out: Msg[] = [{ role: 'user', content: 'Initial request' }]
  for (let i = 0; i < n; i++) {
    out.push(...buildToolExchange(toolName, resultLength))
  }
  return out
}

function getToolResultMessages(messages: Msg[]): Msg[] {
  return messages.filter(
    m =>
      Array.isArray(m.content) &&
      m.content.some((b: any) => b.type === 'tool_result'),
  )
}

function getToolResultBlock(msg: Msg): Block {
  return (msg.content as Block[]).find(
    (b: any) => b.type === 'tool_result',
  ) as Block
}

function getResultText(msg: Msg): string {
  const block = getToolResultBlock(msg)
  const c = block.content
  if (typeof c === 'string') return c
  if (Array.isArray(c)) {
    return (c as Array<{ type?: string; text?: string }>)
      .filter(b => b?.type === 'text')
      .map(b => b.text ?? '')
      .join('\n')
  }
  return ''
}

// ---------------------------------------------------------------------------
// isObservationMaskingEnabled
// ---------------------------------------------------------------------------

beforeEach(() => {
  nextId = 0
})

test('isObservationMaskingEnabled: false when unset', () => {
  expect(isObservationMaskingEnabled({})).toBe(false)
})

test('isObservationMaskingEnabled: true when LIMITLESS_OBSERVATION_MASKING=1', () => {
  expect(isObservationMaskingEnabled({ LIMITLESS_OBSERVATION_MASKING: '1' })).toBe(
    true,
  )
})

test('isObservationMaskingEnabled: false for other values', () => {
  expect(isObservationMaskingEnabled({ LIMITLESS_OBSERVATION_MASKING: 'true' })).toBe(false)
  expect(isObservationMaskingEnabled({ LIMITLESS_OBSERVATION_MASKING: '0' })).toBe(false)
  expect(isObservationMaskingEnabled({ LIMITLESS_OBSERVATION_MASKING: 'yes' })).toBe(false)
})

// ---------------------------------------------------------------------------
// Fast-path: no changes → same reference
// ---------------------------------------------------------------------------

test('returns same reference when nothing to mask (no tool results)', () => {
  const messages: Msg[] = [{ role: 'user', content: 'hello' }]
  const result = maskStaleObservations(messages)
  expect(result).toBe(messages)
})

test('returns same reference when all results are in the protected tail', () => {
  // 4 exchanges, lastKTurns=6 — all 4 assistant turns are protected
  const messages = buildConversation(4, 5_000)
  const result = maskStaleObservations(messages, { lastKTurns: 6 })
  expect(result).toBe(messages)
})

test('returns same reference when all results are below minContentChars', () => {
  // Results of 1999 chars — just under the 2000-char threshold
  const messages = buildConversation(10, MIN_CONTENT_CHARS - 1)
  const result = maskStaleObservations(messages)
  expect(result).toBe(messages)
})

// ---------------------------------------------------------------------------
// Masking behavior
// ---------------------------------------------------------------------------

test('masks old large results; preserves last-K turns', () => {
  // 10 exchanges with 5k chars each; protect last 6
  const messages = buildConversation(10, 5_000)
  const result = maskStaleObservations(messages, { lastKTurns: 6 })

  const resultMsgs = getToolResultMessages(result)
  expect(resultMsgs.length).toBe(10)

  // Oldest 4 should be masked
  for (let i = 0; i < 4; i++) {
    const text = getResultText(resultMsgs[i])
    expect(text).toContain('[tool_result masked:')
    expect(text).toContain('Read')
    expect(text).toContain('5000 chars')
  }

  // Newest 6 should be untouched
  for (let i = 4; i < 10; i++) {
    const text = getResultText(resultMsgs[i])
    expect(text).toBe(bigText(5_000))
  }
})

test('respects minContentChars — small results in old turns are preserved', () => {
  // 8 exchanges with 1500-char results (below 2000 threshold), protect last 6
  const messages = buildConversation(8, 1_500)
  const result = maskStaleObservations(messages, {
    lastKTurns: 6,
    minContentChars: 2_000,
  })
  // Nothing masked — all below threshold
  expect(result).toBe(messages)
})

test('minContentChars can be tuned — masks exactly at the threshold', () => {
  // 8 exchanges with exactly 3000-char results; set minContentChars=3000
  const messages = buildConversation(8, 3_000)
  const result = maskStaleObservations(messages, {
    lastKTurns: 6,
    minContentChars: 3_000,
  })
  const resultMsgs = getToolResultMessages(result)
  // Oldest 2 masked (8 total - 6 protected = 2 old)
  for (let i = 0; i < 2; i++) {
    expect(getResultText(resultMsgs[i])).toContain('[tool_result masked:')
  }
  // Newest 6 preserved
  for (let i = 2; i < 8; i++) {
    expect(getResultText(resultMsgs[i])).toBe(bigText(3_000))
  }
})

// ---------------------------------------------------------------------------
// Tool pairing / block structure preservation
// ---------------------------------------------------------------------------

test('preserves tool_use_id and is_error in masked blocks', () => {
  const messages = buildConversation(8, 5_000)
  const result = maskStaleObservations(messages, { lastKTurns: 6 })

  const resultMsgs = getToolResultMessages(result)
  // First 2 are masked; their tool_use_id must survive
  for (let i = 0; i < 2; i++) {
    const block = getToolResultBlock(resultMsgs[i])
    expect(typeof block.tool_use_id).toBe('string')
    expect((block.tool_use_id as string).startsWith('toolu_')).toBe(true)
    expect(block.type).toBe('tool_result')
  }
})

test('message array shape stays valid Anthropic message format', () => {
  const messages = buildConversation(10, 5_000)
  const result = maskStaleObservations(messages, { lastKTurns: 4 })

  for (const msg of result) {
    expect(typeof msg.role).toBe('string')
    if (Array.isArray(msg.content)) {
      for (const block of msg.content) {
        expect(typeof (block as any).type).toBe('string')
      }
    }
  }

  // Every tool_use must have a matching tool_result somewhere downstream
  const toolUseIds = new Set<string>()
  const toolResultIds = new Set<string>()
  for (const msg of result) {
    if (!Array.isArray(msg.content)) continue
    for (const block of msg.content as Block[]) {
      if ((block as any).type === 'tool_use') {
        toolUseIds.add((block as any).id as string)
      }
      if ((block as any).type === 'tool_result') {
        toolResultIds.add((block as any).tool_use_id as string)
      }
    }
  }
  // Every tool_result_id must correspond to a tool_use_id
  for (const id of toolResultIds) {
    expect(toolUseIds.has(id)).toBe(true)
  }
})

// ---------------------------------------------------------------------------
// Already-cleared blocks are skipped
// ---------------------------------------------------------------------------

test('skips blocks already cleared by microCompact', () => {
  const [asst, userMsg] = buildToolExchange('Read', 5_000)
  const block = ((userMsg.content as Block[]).find(
    b => (b as any).type === 'tool_result',
  ) as Block)
  block.content = '[Old tool result content cleared]'

  // Wrap with enough old turns to make it eligible
  const messages: Msg[] = [
    { role: 'user', content: 'start' },
    // 7 old exchanges to push them past lastKTurns=6
    ...buildConversation(7, 5_000),
    asst,
    userMsg,
    // 6 fresh exchanges to protect the tail
    ...buildConversation(6, 5_000),
  ]

  const result = maskStaleObservations(messages, { lastKTurns: 6 })

  // Find the cleared message in the result — it should still be cleared, not
  // double-masked
  const resultMsgs = getToolResultMessages(result)
  const clearedMsg = resultMsgs.find(m => {
    const t = getResultText(m)
    return t === '[Old tool result content cleared]'
  })
  expect(clearedMsg).toBeDefined()
})

// ---------------------------------------------------------------------------
// Non-compactable tools are never masked
// ---------------------------------------------------------------------------

test('does not mask Task tool results', () => {
  const messages = buildConversation(10, 5_000, 'Task')
  const result = maskStaleObservations(messages, { lastKTurns: 2 })
  // All 10 should be untouched regardless of age
  const resultMsgs = getToolResultMessages(result)
  for (const msg of resultMsgs) {
    expect(getResultText(msg)).toBe(bigText(5_000))
  }
})

test('does not mask Agent tool results', () => {
  const messages = buildConversation(10, 5_000, 'Agent')
  const result = maskStaleObservations(messages, { lastKTurns: 2 })
  const resultMsgs = getToolResultMessages(result)
  for (const msg of resultMsgs) {
    expect(getResultText(msg)).toBe(bigText(5_000))
  }
})

// ---------------------------------------------------------------------------
// Image-bearing blocks are never masked
// ---------------------------------------------------------------------------

test('does not mask tool_result blocks containing image content', () => {
  const id = `toolu_img_${nextId++}`
  const messages: Msg[] = [
    { role: 'user', content: 'start' },
    // Push 7 old assistant turns before the image result
    ...buildConversation(7, 5_000),
    {
      role: 'assistant',
      content: [{ type: 'tool_use', id, name: 'Read', input: {} }],
    },
    {
      role: 'user',
      content: [
        {
          type: 'tool_result',
          tool_use_id: id,
          content: [
            { type: 'text', text: bigText(5_000) },
            { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'abc' } },
          ],
        },
      ],
    },
    // Fresh tail
    ...buildConversation(6, 5_000),
  ]

  const result = maskStaleObservations(messages, { lastKTurns: 6 })

  // Find the image-bearing message
  const imgMsg = result.find(m => {
    if (!Array.isArray(m.content)) return false
    return (m.content as Block[]).some(b => {
      if ((b as any).type !== 'tool_result') return false
      const content = (b as any).content
      return Array.isArray(content) && content.some((c: any) => c.type === 'image')
    })
  })
  expect(imgMsg).toBeDefined()
  // Content should be unchanged — the image block must still be there
  const trBlock = ((imgMsg!.content as Block[]).find(b => (b as any).type === 'tool_result') as Block)
  expect(Array.isArray(trBlock.content)).toBe(true)
  expect((trBlock.content as Block[]).some(b => (b as any).type === 'image')).toBe(true)
})

// ---------------------------------------------------------------------------
// Storage reference extraction
// ---------------------------------------------------------------------------

test('summary includes filepath when content carries persisted-output tag', () => {
  const filepath = '/home/user/.cache/claude/sessions/abc123/tool-results/toolu_001.txt'
  // Content must exceed MIN_CONTENT_CHARS (2000) to be eligible for masking.
  const preview = bigText(2_100)
  const persistedContent = `<persisted-output>\nOutput too large (100.0 KB). Full output saved to: ${filepath}\n\nPreview (first 2.0 KB):\n${preview}\n...</persisted-output>`

  const id = `toolu_persist_${nextId++}`
  const messages: Msg[] = [
    { role: 'user', content: 'start' },
    // The persisted-content exchange goes first (oldest)
    {
      role: 'assistant',
      content: [{ type: 'tool_use', id, name: 'Bash', input: {} }],
    },
    {
      role: 'user',
      content: [
        {
          type: 'tool_result',
          tool_use_id: id,
          content: persistedContent,
        },
      ],
    },
    // 6 fresh exchanges fill the protected tail
    ...buildConversation(6, 5_000),
  ]

  const result = maskStaleObservations(messages, { lastKTurns: 6 })

  const trMsg = result.find(m => {
    if (!Array.isArray(m.content)) return false
    return (m.content as Block[]).some(
      b =>
        (b as any).type === 'tool_result' &&
        (b as any).tool_use_id === id,
    )
  })
  expect(trMsg).toBeDefined()
  const text = getResultText(trMsg!)
  expect(text).toContain('[tool_result masked:')
  expect(text).toContain(filepath)
})

// ---------------------------------------------------------------------------
// Masked content is valid Anthropic content-block shape
// ---------------------------------------------------------------------------

test('masked content blocks are valid Anthropic text blocks', () => {
  const messages = buildConversation(8, 5_000)
  const result = maskStaleObservations(messages, { lastKTurns: 4 })
  const resultMsgs = getToolResultMessages(result)
  // First 4 should be masked
  for (let i = 0; i < 4; i++) {
    const block = getToolResultBlock(resultMsgs[i])
    expect(block.type).toBe('tool_result')
    expect(Array.isArray(block.content)).toBe(true)
    const textBlock = (block.content as Block[])[0]
    expect((textBlock as any).type).toBe('text')
    expect(typeof (textBlock as any).text).toBe('string')
  }
})

// ---------------------------------------------------------------------------
// DEFAULT constant values
// ---------------------------------------------------------------------------

test('DEFAULT_LAST_K_TURNS is 6', () => {
  expect(DEFAULT_LAST_K_TURNS).toBe(6)
})

test('MIN_CONTENT_CHARS is 2000', () => {
  expect(MIN_CONTENT_CHARS).toBe(2_000)
})
