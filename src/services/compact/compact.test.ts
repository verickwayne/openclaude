import { describe, expect, test } from 'bun:test'
import { sanitizeMessagesForCompactSummary } from './compact.js'

describe('sanitizeMessagesForCompactSummary', () => {
  test('converts unsupported content block tags to compact-safe text', () => {
    const [message] = sanitizeMessagesForCompactSummary([
      {
        type: 'user',
        uuid: 'user-1',
        message: {
          role: 'user',
          content: [
            { type: 'text', text: 'before' },
            { type: 'fallback', text: 'provider-specific fallback text' },
            {
              type: 'tool_result',
              tool_use_id: 'toolu_1',
              content: [
                { type: 'fallback', text: 'nested fallback text' },
              ],
            },
          ],
        },
      },
    ] as any)

    expect(message.message.content).toEqual([
      { type: 'text', text: 'before' },
      { type: 'text', text: 'provider-specific fallback text' },
      {
        type: 'tool_result',
        tool_use_id: 'toolu_1',
        content: [{ type: 'text', text: 'nested fallback text' }],
      },
    ])
  })
})
