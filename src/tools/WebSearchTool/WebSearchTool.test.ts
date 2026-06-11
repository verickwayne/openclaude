import { describe, expect, mock, test } from 'bun:test'
import type { ProviderOutput } from './providers/types.js'
import { __test } from './WebSearchTool.js'

const {
  buildEmptyAdapterResultHint,
  formatProviderOutputWithEmptyHint,
  buildAdapterUnavailableError,
} = __test

describe('buildEmptyAdapterResultHint', () => {
  test('names the active provider and the failing backend', () => {
    const msg = buildEmptyAdapterResultHint('minimax', 'duckduckgo')
    expect(msg).toContain('minimax')
    expect(msg).toContain('duckduckgo')
  })

  test('includes the actionable env-var list so the user can pick one', () => {
    const msg = buildEmptyAdapterResultHint('moonshot', 'duckduckgo')
    for (const key of [
      'FIRECRAWL_API_KEY',
      'TAVILY_API_KEY',
      'EXA_API_KEY',
      'JINA_API_KEY',
      'BING_API_KEY',
      'MOJEEK_API_KEY',
      'LINKUP_API_KEY',
      'YOU_API_KEY',
    ]) {
      expect(msg).toContain(key)
    }
  })

  test('mentions the native-provider escape hatch', () => {
    const msg = buildEmptyAdapterResultHint('nvidia-nim', 'duckduckgo')
    expect(msg).toMatch(/Codex auth/)
    expect(msg).toMatch(/Anthropic/)
    expect(msg).toMatch(/Vertex/)
    expect(msg).toMatch(/Foundry/)
  })
})

describe('formatProviderOutputWithEmptyHint', () => {
  test('replaces the empty placeholder with a diagnostic when 0 hits', () => {
    const po: ProviderOutput = {
      hits: [],
      providerName: 'duckduckgo',
      durationSeconds: 0.42,
    }
    const out = formatProviderOutputWithEmptyHint(po, 'cat facts', 'minimax')
    expect(out.results.length).toBe(1)
    expect(out.results[0]).toMatch(/^No results from "duckduckgo"/)
    expect(out.durationSeconds).toBe(0.42)
    expect(out.query).toBe('cat facts')
  })

  test('does not mutate the result when hits are present', () => {
    const po: ProviderOutput = {
      hits: [
        {
          title: 'Cats',
          url: 'https://example.com/cats',
          description: 'About cats.',
        },
      ],
      providerName: 'duckduckgo',
      durationSeconds: 1.2,
    }
    const out = formatProviderOutputWithEmptyHint(po, 'cat facts', 'minimax')
    // hits-present case is delegated to the unmodified formatProviderOutput
    // path, so the snippet block + tool_use_id are preserved.
    expect(out.results.length).toBe(2)
    expect(typeof out.results[0]).toBe('string')
    expect(out.results[0]).toContain('Cats')
    expect(out.results[0]).toContain('https://example.com/cats')
  })
})

// Regression for #994: when every available search backend fails on an
// OpenAI-compatible provider (OpenRouter, RunPod, minimax, nvidia-nim, github
// copilot, etc.), the user must see the underlying adapter failure embedded in
// the thrown error instead of getting "Did 0 searches" from a silent fall-
// through to Anthropic's native path.
describe('buildAdapterUnavailableError', () => {
  test('names the active provider', () => {
    const msg = buildAdapterUnavailableError('minimax', 'rate limited')
    expect(msg).toContain('minimax')
  })

  test('embeds the underlying adapter error message verbatim', () => {
    const msg = buildAdapterUnavailableError(
      'moonshot',
      'duckduckgo: 429 Too Many Requests',
    )
    expect(msg).toContain('duckduckgo: 429 Too Many Requests')
  })

  test('points the user at backend configuration instead of switching models', () => {
    const msg = buildAdapterUnavailableError('nvidia-nim', 'timeout')
    expect(msg).toMatch(/Codex/)
    expect(msg).toMatch(/TAVILY_API_KEY/)
    expect(msg).not.toMatch(/Try switching/)
  })
})

describe('native web search execution', () => {
  test('forces the native web_search server tool instead of letting the helper model answer without searching', async () => {
    let capturedParams: any
    const queryModelWithStreaming = mock((params: any) => {
      capturedParams = params
      return (async function* () {
        yield {
          type: 'assistant',
          message: { content: [] },
        }
      })()
    })

    mock.module('../../services/api/claude.js', () => ({
      queryModelWithStreaming,
    }))
    mock.module('../../utils/model/providers.js', () => ({
      getAPIProvider: () => 'firstParty',
    }))

    const { WebSearchTool } = await import(
      `./WebSearchTool.js?native-tool-choice-${Date.now()}`
    )

    await WebSearchTool.call(
      { query: 'current weather in Cancun' },
      {
        abortController: new AbortController(),
        getAppState: () => ({
          effortValue: undefined,
          toolPermissionContext: {},
        }),
        options: {
          agentDefinitions: { activeAgents: [] },
          appendSystemPrompt: undefined,
          isNonInteractiveSession: false,
          mainLoopModel: 'claude-sonnet-4-5',
          thinkingConfig: { type: 'disabled' },
        },
      } as any,
      undefined as any,
      undefined as any,
      undefined,
    )

    expect(queryModelWithStreaming).toHaveBeenCalled()
    expect(capturedParams.options.toolChoice).toEqual({
      type: 'tool',
      name: 'web_search',
    })

    mock.restore()
  })
})
