import { describe, expect, it } from 'bun:test'
import {
  createMnemoRecallFn,
  findMnemoServer,
  MNEMO_RECALL_TOOL,
  parseRecallResult,
} from './mcpBridge.js'

/**
 * Minimal MCP server stub. Only the fields the bridge reads are
 * populated; everything else is typed-any to keep the test fixture
 * small.
 */
// biome-ignore lint/suspicious/noExplicitAny: small typed stub
type StubServer = any

function connectedStub(args: {
  name: string
  serverInfoName?: string
  callTool?: (req: unknown) => unknown
}): StubServer {
  return {
    type: 'connected',
    name: args.name,
    serverInfo: args.serverInfoName
      ? { name: args.serverInfoName, version: '0.0.0' }
      : undefined,
    client: {
      callTool: args.callTool ?? (() => ({ content: [] })),
    },
    capabilities: {},
    config: {},
  }
}

describe('findMnemoServer', () => {
  it('returns undefined when the array is empty', () => {
    expect(findMnemoServer([])).toBeUndefined()
  })

  it('returns undefined when no name matches mnemo', () => {
    const servers: StubServer[] = [
      connectedStub({ name: 'github' }),
      connectedStub({ name: 'playwright' }),
    ]
    expect(findMnemoServer(servers)).toBeUndefined()
  })

  it('matches by registry name', () => {
    const s = connectedStub({ name: 'plugin_mnemo-claude-code_mnemo' })
    expect(findMnemoServer([s])?.name).toBe(
      'plugin_mnemo-claude-code_mnemo',
    )
  })

  it('matches the bare name', () => {
    const s = connectedStub({ name: 'mnemo' })
    expect(findMnemoServer([s])).toBeDefined()
  })

  it('matches case-insensitively', () => {
    const s = connectedStub({ name: 'MNEMO_SERVER' })
    expect(findMnemoServer([s])).toBeDefined()
  })

  it('matches by serverInfo.name when registry name does not match', () => {
    const s = connectedStub({
      name: 'plugin_xyz',
      serverInfoName: 'mnemo',
    })
    expect(findMnemoServer([s])).toBeDefined()
  })

  it('skips non-connected servers', () => {
    const pending = { type: 'pending', name: 'mnemo' } as StubServer
    const disabled = { type: 'disabled', name: 'mnemo-disabled' } as StubServer
    const failed = { type: 'failed', name: 'mnemo' } as StubServer
    expect(findMnemoServer([pending, disabled, failed])).toBeUndefined()
  })

  it('returns the FIRST matching server (when multiple are connected)', () => {
    const s1 = connectedStub({ name: 'mnemo-first' })
    const s2 = connectedStub({ name: 'mnemo-second' })
    expect(findMnemoServer([s1, s2])?.name).toBe('mnemo-first')
  })
})

describe('createMnemoRecallFn — bridge construction', () => {
  it('returns null when no Mnemo server is in the list', () => {
    expect(createMnemoRecallFn([])).toBeNull()
    expect(
      createMnemoRecallFn([connectedStub({ name: 'github' })]),
    ).toBeNull()
  })

  it('returns a RecallFn when a Mnemo server is found', () => {
    const fn = createMnemoRecallFn([connectedStub({ name: 'mnemo' })])
    expect(typeof fn).toBe('function')
  })
})

describe('createMnemoRecallFn — runtime behavior', () => {
  it("passes the query through to the MCP client's callTool", async () => {
    let observedRequest: unknown = null
    const stub = connectedStub({
      name: 'mnemo',
      callTool: req => {
        observedRequest = req
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ ok: true, results: [], count: 0 }),
            },
          ],
        }
      },
    })
    const fn = createMnemoRecallFn([stub])
    expect(fn).not.toBeNull()
    if (!fn) return

    await fn({ query: 'auth refactor', limit: 7 })
    expect(observedRequest).toEqual({
      name: MNEMO_RECALL_TOOL,
      arguments: { query: 'auth refactor', limit: 7 },
    })
  })

  it('returns empty array on isError=true result', async () => {
    const stub = connectedStub({
      name: 'mnemo',
      callTool: () => ({ isError: true, content: [] }),
    })
    const fn = createMnemoRecallFn([stub])!
    const result = await fn({ query: 'x' })
    expect(result).toEqual([])
  })

  it('extracts results from a well-formed mnemo_recall response', async () => {
    const stub = connectedStub({
      name: 'mnemo',
      callTool: () => ({
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              ok: true,
              results: [
                {
                  uuid: 'aaaa1111-bbbb-2222-cccc-3333dddd4444',
                  content: 'remembered finding',
                  source: 'claude-code',
                  importance: 0.7,
                },
                {
                  uuid: 'bbbb2222-cccc-3333-dddd-4444eeee5555',
                  content: 'another finding',
                  source: 'user',
                  importance: 0.4,
                },
              ],
              count: 2,
            }),
          },
        ],
      }),
    })
    const fn = createMnemoRecallFn([stub])!
    const result = await fn({ query: 'x' })
    expect(result).toHaveLength(2)
    expect(result[0].uuid).toBe('aaaa1111-bbbb-2222-cccc-3333dddd4444')
    expect(result[0].content).toBe('remembered finding')
    expect(result[0].importance).toBe(0.7)
    expect(result[1].source).toBe('user')
  })
})

describe('parseRecallResult — edge cases', () => {
  it('returns [] on non-array content', () => {
    expect(parseRecallResult(null)).toEqual([])
    expect(parseRecallResult({})).toEqual([])
    expect(parseRecallResult('text')).toEqual([])
  })

  it('returns [] on content array without text blocks', () => {
    expect(parseRecallResult([{ type: 'image' }])).toEqual([])
  })

  it('returns [] when the text is not valid JSON', () => {
    expect(
      parseRecallResult([{ type: 'text', text: 'not json' }]),
    ).toEqual([])
  })

  it('returns [] when JSON has no results array', () => {
    expect(
      parseRecallResult([
        { type: 'text', text: JSON.stringify({ ok: false, error: 'x' }) },
      ]),
    ).toEqual([])
  })

  it('falls back to .fact when .content is absent (edges/relationships)', () => {
    const result = parseRecallResult([
      {
        type: 'text',
        text: JSON.stringify({
          results: [
            {
              uuid: 'u1',
              fact: 'A INTERESTED_IN B',
              source: 'graphiti',
              importance: 0.6,
            },
          ],
        }),
      },
    ])
    expect(result).toHaveLength(1)
    expect(result[0].content).toBe('A INTERESTED_IN B')
  })

  it('defaults source and importance when missing', () => {
    const result = parseRecallResult([
      {
        type: 'text',
        text: JSON.stringify({
          results: [{ uuid: 'u1', content: 'x' }],
        }),
      },
    ])
    expect(result[0].source).toBe('unknown')
    expect(result[0].importance).toBe(0.5)
  })

  it('drops rows without required uuid or content', () => {
    const result = parseRecallResult([
      {
        type: 'text',
        text: JSON.stringify({
          results: [
            { uuid: 'u1', content: 'good' },
            { uuid: 'u2' }, // no content
            { content: 'orphan' }, // no uuid
            { uuid: 'u3', content: 'also good' },
          ],
        }),
      },
    ])
    expect(result).toHaveLength(2)
    expect(result.map(r => r.uuid)).toEqual(['u1', 'u3'])
  })
})
