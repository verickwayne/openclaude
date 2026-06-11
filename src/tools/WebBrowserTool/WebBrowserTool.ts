import { PRODUCT_DISPLAY_NAME } from '../../constants/product.js'
import { buildTool, type ToolDef } from '../../Tool.js'
import type { PermissionUpdate } from '../../types/permissions.js'
import { lazySchema } from '../../utils/lazySchema.js'
import type { PermissionDecision } from '../../utils/permissions/PermissionResult.js'
import { getRuleByContentsForTool } from '../../utils/permissions/permissions.js'
import { z } from 'zod/v4'
import {
  applyDomainFilters,
  safeHostname,
  type SearchHit,
} from '../WebSearchTool/providers/types.js'
import { duckduckgoProvider } from '../WebSearchTool/providers/duckduckgo.js'
import {
  getURLMarkdownContent,
  type FetchedContent,
} from '../WebFetchTool/utils.js'
import {
  DESCRIPTION,
  WEB_BROWSER_TOOL_NAME,
} from './prompt.js'
import {
  getToolUseSummary,
  renderToolResultMessage,
  renderToolUseMessage,
  renderToolUseProgressMessage,
} from './UI.js'

const MAX_BROWSER_TEXT_LENGTH = 120_000
const DEFAULT_COMPACT_TEXT_LENGTH = 24_000
const DEFAULT_SEARCH_LIMIT = 10

const inputSchema = lazySchema(() =>
  z.strictObject({
    action: z
      .enum(['search', 'open'])
      .describe('Use "search" to search the web or "open" to open a URL'),
    query: z
      .string()
      .min(2)
      .optional()
      .describe('Search query. Required when action is "search".'),
    url: z
      .string()
      .url()
      .optional()
      .describe('URL to open. Required when action is "open".'),
    max_results: z
      .number()
      .int()
      .min(1)
      .max(20)
      .optional()
      .describe('Maximum search results to return. Defaults to 10.'),
    content_mode: z
      .enum(['compact', 'full'])
      .optional()
      .describe('For action "open", return compact page text by default or full extracted text.'),
    max_chars: z
      .number()
      .int()
      .min(1000)
      .max(MAX_BROWSER_TEXT_LENGTH)
      .optional()
      .describe('Maximum characters to return for opened page text. Defaults to a compact 24000 characters.'),
    allowed_domains: z
      .array(z.string())
      .optional()
      .describe('Only include search results from these domains'),
    blocked_domains: z
      .array(z.string())
      .optional()
      .describe('Never include search results from these domains'),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>
type Input = z.infer<InputSchema>

const searchResultSchema = z.object({
  title: z.string(),
  url: z.string(),
  description: z.string().optional(),
  source: z.string().optional(),
})

const outputSchema = lazySchema(() =>
  z.object({
    action: z.enum(['search', 'open']),
    query: z.string().optional(),
    url: z.string().optional(),
    title: z.string().optional(),
    text: z.string().optional(),
    results: z.array(searchResultSchema).optional(),
    source: z.string().describe('Native backend used for the browsing action'),
    code: z.number().optional(),
    codeText: z.string().optional(),
    bytes: z.number().optional(),
    durationMs: z.number(),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>

export type Output = z.infer<OutputSchema>

function browserToolInputToPermissionRuleContent(input: {
  [k: string]: unknown
}): string {
  try {
    const parsedInput = WebBrowserTool.inputSchema.safeParse(input)
    if (!parsedInput.success) return `input:${String(input)}`
    if (parsedInput.data.action === 'search') return 'search'
    const url = parsedInput.data.url
    if (!url) return 'input:missing-url'
    return `domain:${new URL(url).hostname}`
  } catch {
    return `input:${String(input)}`
  }
}

function truncateBrowserText(text: string): string {
  if (text.length <= MAX_BROWSER_TEXT_LENGTH) return text
  return `${text.slice(0, MAX_BROWSER_TEXT_LENGTH)}\n\n[Content truncated due to length...]`
}

function compactMarkdown(markdown: string, maxChars = DEFAULT_COMPACT_TEXT_LENGTH): string {
  const lines = markdown
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0)

  const selected: string[] = []
  let used = 0
  let paragraphCount = 0

  for (const line of lines) {
    const isHeading = /^#{1,4}\s+\S/.test(line)
    const isList = /^[-*]\s+\S/.test(line)
    const isUsefulShortLine =
      line.length <= 260 &&
      !/^!\[/.test(line) &&
      !/^https?:\/\//i.test(line)
    const isParagraph = !isHeading && !isList && isUsefulShortLine

    if (!isHeading && !isList && !isParagraph) continue
    if (isParagraph && paragraphCount >= 30) continue

    const next = isHeading ? `\n${line}` : line
    const nextSize = next.length + 1
    if (used + nextSize > maxChars) break

    selected.push(next)
    used += nextSize
    if (isParagraph) paragraphCount++
  }

  const compact = selected.join('\n').trim()
  if (!compact) return truncateBrowserText(markdown.slice(0, maxChars))
  if (markdown.length > compact.length) {
    return `${compact}\n\n[Compact browser view. Use content_mode="full" for more extracted text.]`
  }
  return compact
}

function formatOpenedText(input: Input, content: string): string {
  if (input.content_mode === 'full') {
    return truncateBrowserText(
      content.slice(0, input.max_chars ?? MAX_BROWSER_TEXT_LENGTH),
    )
  }

  return compactMarkdown(
    content,
    input.max_chars ?? DEFAULT_COMPACT_TEXT_LENGTH,
  )
}

function extractTitleFromMarkdown(markdown: string): string | undefined {
  const heading = markdown
    .split('\n')
    .map(line => line.trim())
    .find(line => /^#\s+\S/.test(line))
  return heading?.replace(/^#\s+/, '').trim()
}

function normalizeJinaHit(raw: any): SearchHit | null {
  if (!raw || typeof raw !== 'object') return null
  const url =
    typeof raw.url === 'string'
      ? raw.url
      : typeof raw.link === 'string'
        ? raw.link
        : undefined
  const title =
    typeof raw.title === 'string'
      ? raw.title
      : typeof raw.name === 'string'
        ? raw.name
        : url
  if (!url || !title) return null
  const description =
    typeof raw.description === 'string'
      ? raw.description
      : typeof raw.snippet === 'string'
        ? raw.snippet
        : typeof raw.content === 'string'
          ? raw.content
          : undefined
  return {
    title,
    url,
    description,
    source: safeHostname(url),
  }
}

async function searchWithJina(
  input: Input,
  signal?: AbortSignal,
): Promise<SearchHit[]> {
  if (!input.query) return []
  const url = new URL('https://s.jina.ai/')
  url.searchParams.set('q', input.query)
  url.searchParams.set('count', String(input.max_results ?? DEFAULT_SEARCH_LIMIT))

  const res = await fetch(url.toString(), {
    headers: { Accept: 'application/json' },
    signal,
  })
  if (!res.ok) {
    throw new Error(`Jina native search error ${res.status}: ${await res.text().catch(() => '')}`)
  }
  const data = await res.json()
  const rawHits = Array.isArray(data.data)
    ? data.data
    : Array.isArray(data.results)
      ? data.results
      : []
  return rawHits.map(normalizeJinaHit).filter(Boolean) as SearchHit[]
}

async function runNativeSearch(
  input: Input,
  signal?: AbortSignal,
): Promise<{ results: SearchHit[]; source: string }> {
  const limit = input.max_results ?? DEFAULT_SEARCH_LIMIT
  try {
    const hits = applyDomainFilters(await searchWithJina(input, signal), input)
    if (hits.length > 0) {
      return { results: hits.slice(0, limit), source: 'jina-native' }
    }
  } catch (err) {
    console.error(`[web-browser] jina-native failed: ${err}`)
  }

  if (!input.query) return { results: [], source: 'native' }
  const ddg = await duckduckgoProvider.search(
    {
      query: input.query,
      allowed_domains: input.allowed_domains,
      blocked_domains: input.blocked_domains,
    },
    signal,
  )
  return {
    results: ddg.hits.slice(0, limit),
    source: 'duckduckgo-native',
  }
}

async function runNativeOpen(
  input: Input,
  abortController: AbortController,
): Promise<Output> {
  if (!input.url) {
    throw new Error('WebBrowser action "open" requires url.')
  }

  const response = await getURLMarkdownContent(input.url, abortController)
  if ('type' in response && response.type === 'redirect') {
    const text = [
      'Redirect detected.',
      `Original URL: ${response.originalUrl}`,
      `Redirect URL: ${response.redirectUrl}`,
      `Status: ${response.statusCode}`,
    ].join('\n')
    return {
      action: 'open',
      url: input.url,
      text,
      source: 'native-fetch',
      code: response.statusCode,
      codeText: 'Redirect',
      bytes: Buffer.byteLength(text),
      durationMs: 0,
    }
  }

  const content = response as FetchedContent
  return {
    action: 'open',
    url: input.url,
    title: extractTitleFromMarkdown(content.content),
    text: formatOpenedText(input, content.content),
    source: 'native-fetch',
    code: content.code,
    codeText: content.codeText,
    bytes: content.bytes,
    durationMs: 0,
  }
}

export const WebBrowserTool = buildTool({
  name: WEB_BROWSER_TOOL_NAME,
  searchHint: 'search the web or open pages with native browsing',
  maxResultSizeChars: 140_000,
  shouldDefer: true,
  async description(input) {
    const target = input.action === 'open' ? input.url : input.query
    return `${PRODUCT_DISPLAY_NAME} wants to browse ${target ?? 'the web'}`
  },
  userFacingName() {
    return 'Browse'
  },
  getToolUseSummary,
  getActivityDescription(input) {
    const summary = getToolUseSummary(input)
    return summary ? `Browsing ${summary}` : 'Browsing the web'
  },
  get inputSchema(): InputSchema {
    return inputSchema()
  },
  get outputSchema(): OutputSchema {
    return outputSchema()
  },
  isEnabled() {
    return true
  },
  isConcurrencySafe() {
    return true
  },
  isReadOnly() {
    return true
  },
  toAutoClassifierInput(input) {
    return input.action === 'open'
      ? input.url ?? ''
      : input.query ?? ''
  },
  async checkPermissions(input, context): Promise<PermissionDecision> {
    if (input.action === 'search') {
      return {
        behavior: 'allow',
        updatedInput: input,
        decisionReason: { type: 'other', reason: 'Read-only web search' },
      }
    }

    const permissionContext = context.getAppState().toolPermissionContext
    const ruleContent = browserToolInputToPermissionRuleContent(input)

    const denyRule = getRuleByContentsForTool(
      permissionContext,
      WebBrowserTool,
      'deny',
    ).get(ruleContent)
    if (denyRule) {
      return {
        behavior: 'deny',
        message: `${WebBrowserTool.name} denied access to ${ruleContent}.`,
        decisionReason: { type: 'rule', rule: denyRule },
      }
    }

    const allowRule = getRuleByContentsForTool(
      permissionContext,
      WebBrowserTool,
      'allow',
    ).get(ruleContent)
    if (allowRule) {
      return {
        behavior: 'allow',
        updatedInput: input,
        decisionReason: { type: 'rule', rule: allowRule },
      }
    }

    return {
      behavior: 'ask',
      message: `${PRODUCT_DISPLAY_NAME} requested permissions to use ${WebBrowserTool.name}, but you haven't granted it yet.`,
      suggestions: buildSuggestions(ruleContent),
    }
  },
  async prompt() {
    return DESCRIPTION
  },
  async validateInput(input) {
    if (input.action === 'search' && !input.query) {
      return {
        result: false,
        message: 'Error: WebBrowser action "search" requires query.',
        errorCode: 1,
      }
    }
    if (input.action === 'open' && !input.url) {
      return {
        result: false,
        message: 'Error: WebBrowser action "open" requires url.',
        errorCode: 2,
      }
    }
    if (input.allowed_domains?.length && input.blocked_domains?.length) {
      return {
        result: false,
        message:
          'Error: Cannot specify both allowed_domains and blocked_domains in the same request',
        errorCode: 3,
      }
    }
    return { result: true }
  },
  renderToolUseMessage,
  renderToolUseProgressMessage,
  renderToolResultMessage,
  async call(input, context) {
    const start = Date.now()
    if (input.action === 'search') {
      const { results, source } = await runNativeSearch(
        input,
        context.abortController.signal,
      )
      return {
        data: {
          action: 'search',
          query: input.query,
          results,
          source,
          durationMs: Date.now() - start,
        } satisfies Output,
      }
    }

    const opened = await runNativeOpen(input, context.abortController)
    return {
      data: {
        ...opened,
        durationMs: Date.now() - start,
      } satisfies Output,
    }
  },
  mapToolResultToToolResultBlockParam({ result }, toolUseID) {
    return {
      tool_use_id: toolUseID,
      type: 'tool_result',
      content: JSON.stringify(result),
    }
  },
} satisfies ToolDef<InputSchema, Output>)

function buildSuggestions(ruleContent: string): PermissionUpdate[] {
  return [
    {
      type: 'addRules',
      destination: 'localSettings',
      rules: [{ toolName: WEB_BROWSER_TOOL_NAME, ruleContent }],
      behavior: 'allow',
    },
  ]
}

export const __test = {
  truncateBrowserText,
  compactMarkdown,
  extractTitleFromMarkdown,
  normalizeJinaHit,
}
