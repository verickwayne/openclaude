import { PRODUCT_DISPLAY_NAME } from '../../constants/product.js'
import { existsSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { BrowserContext, Page } from 'playwright-core'
import { chromium } from 'playwright-core'
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
const BROWSER_WAIT_MS = 800

const inputSchema = lazySchema(() =>
  z.strictObject({
    action: z
      .enum([
        'search',
        'open',
        'navigate',
        'click',
        'type',
        'screenshot',
        'text',
        'links',
        'elements',
      ])
      .describe('Use "search"/"open" for lightweight browsing or browser automation actions for live pages'),
    query: z
      .string()
      .min(2)
      .optional()
      .describe('Search query. Required when action is "search".'),
    url: z
      .string()
      .url()
      .optional()
      .describe('URL to open. Required when action is "open" or "navigate".'),
    selector: z
      .string()
      .optional()
      .describe('CSS selector for click/type. If omitted for click, text_match is used.'),
    text_match: z
      .string()
      .optional()
      .describe('Visible text to click when selector is omitted. Case-insensitive substring match.'),
    text: z
      .string()
      .optional()
      .describe('Text to type when action is "type".'),
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
    action: z.enum([
      'search',
      'open',
      'navigate',
      'click',
      'type',
      'screenshot',
      'text',
      'links',
      'elements',
    ]),
    query: z.string().optional(),
    url: z.string().optional(),
    title: z.string().optional(),
    text: z.string().optional(),
    screenshot_path: z.string().optional(),
    elements: z
      .array(
        z.object({
          selector: z.string(),
          text: z.string(),
          tag: z.string(),
        }),
      )
      .optional(),
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
    if (
      parsedInput.data.action !== 'open' &&
      parsedInput.data.action !== 'navigate'
    ) {
      return 'browser-session'
    }
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

type BrowserSession = {
  context: BrowserContext
  page: Page
}

let browserSessionPromise: Promise<BrowserSession> | null = null

function findChromeExecutable(): string {
  const candidates = [
    process.env.LIMITLESS_BROWSER_EXECUTABLE,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ].filter(Boolean) as string[]
  const executable = candidates.find(path => existsSync(path))
  if (!executable) {
    throw new Error(
      'No Chromium browser executable found. Set LIMITLESS_BROWSER_EXECUTABLE to Chrome/Chromium.',
    )
  }
  return executable
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function ensureBrowserSession(): Promise<BrowserSession> {
  if (browserSessionPromise) return browserSessionPromise

  browserSessionPromise = (async () => {
    const userDataDir = join(tmpdir(), 'limitless-webbrowser-profile')
    mkdirSync(userDataDir, { recursive: true })
    const context = await chromium.launchPersistentContext(userDataDir, {
      executablePath: findChromeExecutable(),
      headless: process.env.LIMITLESS_BROWSER_HEADLESS !== '0',
      viewport: { width: 1440, height: 1000 },
      args: [
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-background-networking',
        '--disable-features=Translate,OptimizationHints',
      ],
      acceptDownloads: true,
    })
    const page = context.pages()[0] ?? (await context.newPage())
    context.on('close', () => {
      browserSessionPromise = null
    })
    return { context, page }
  })()

  return browserSessionPromise
}

async function getBrowserPage(): Promise<Page> {
  const session = await ensureBrowserSession()
  return session.page
}

async function navigateBrowser(url: string): Promise<string> {
  const page = await getBrowserPage()
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 })
  await page.waitForLoadState('networkidle', { timeout: 5_000 }).catch(() => {})
  return page.url()
}

async function clickBrowser(input: Input): Promise<string> {
  const page = await getBrowserPage()
  const locator = input.selector
    ? page.locator(input.selector).first()
    : page.getByText(input.text_match ?? '', { exact: false }).first()
  const label = (await locator.textContent({ timeout: 5_000 }).catch(() => '')) ?? ''
  await locator.click({ timeout: 15_000 })
  await page.waitForLoadState('networkidle', { timeout: 5_000 }).catch(() => {})
  await sleep(BROWSER_WAIT_MS)
  return label.trim().slice(0, 200) || page.url()
}

async function typeBrowser(input: Input): Promise<string> {
  if (!input.selector || input.text === undefined) {
    throw new Error('WebBrowser action "type" requires selector and text.')
  }
  const page = await getBrowserPage()
  const locator = page.locator(input.selector).first()
  await locator.fill(input.text, { timeout: 15_000 })
  return input.selector
}

async function getBrowserText(): Promise<string> {
  const page = await getBrowserPage()
  return page.evaluate(() => {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
    const chunks: string[] = []
    while (walker.nextNode()) {
      const text = walker.currentNode.nodeValue?.replace(/\s+/g, ' ').trim()
      if (text) chunks.push(text)
      if (chunks.join('\n').length > 120_000) break
    }
    return chunks.join('\n')
  })
}

async function getBrowserLinks(): Promise<SearchHit[]> {
  const page = await getBrowserPage()
  return page.evaluate(() =>
    [...document.querySelectorAll<HTMLAnchorElement>('a[href]')]
      .slice(0, 200)
      .map(a => ({
        title: (a.innerText || a.getAttribute('aria-label') || a.href)
          .trim()
          .slice(0, 200),
        url: a.href,
        description: a
          .closest('article,li,section,div')
          ?.textContent?.trim()
          .replace(/\s+/g, ' ')
          .slice(0, 280),
        source: location.hostname,
      })),
  )
}

async function getBrowserElements(): Promise<Array<{ selector: string; text: string; tag: string }>> {
  const page = await getBrowserPage()
  return page.evaluate(() => {
    function selectorFor(el: Element) {
      if (el.id) return `#${CSS.escape(el.id)}`
      const aria = el.getAttribute('aria-label')
      if (aria) {
        return `${el.tagName.toLowerCase()}[aria-label="${aria.replace(/"/g, '\\"')}"]`
      }
      const parent = el.parentElement
      const nth = parent ? [...parent.children].indexOf(el) + 1 : 1
      return `${el.tagName.toLowerCase()}:nth-child(${nth})`
    }
    return [
      ...document.querySelectorAll<HTMLElement>(
        'a,button,input,textarea,select,[role="button"],summary,video,audio',
      ),
    ]
      .filter(el => {
        const rect = el.getBoundingClientRect()
        return rect.width > 0 && rect.height > 0
      })
      .slice(0, 120)
      .map(el => ({
        selector: selectorFor(el),
        text: (
          el.innerText ||
          (el as HTMLInputElement).value ||
          el.getAttribute('aria-label') ||
          el.getAttribute('title') ||
          ''
        )
          .trim()
          .replace(/\s+/g, ' ')
          .slice(0, 160),
        tag: el.tagName.toLowerCase(),
      }))
  })
}

async function screenshotBrowser(): Promise<string> {
  const page = await getBrowserPage()
  const dir = join(tmpdir(), 'limitless-webbrowser')
  mkdirSync(dir, { recursive: true })
  const path = join(dir, `screenshot-${Date.now()}.png`)
  await page.screenshot({ path, fullPage: false })
  return path
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
    if (input.action === 'navigate' && !input.url) {
      return {
        result: false,
        message: 'Error: WebBrowser action "navigate" requires url.',
        errorCode: 3,
      }
    }
    if (
      input.action === 'click' &&
      !input.selector &&
      !input.text_match
    ) {
      return {
        result: false,
        message:
          'Error: WebBrowser action "click" requires selector or text_match.',
        errorCode: 4,
      }
    }
    if (
      input.action === 'type' &&
      (!input.selector || input.text === undefined)
    ) {
      return {
        result: false,
        message: 'Error: WebBrowser action "type" requires selector and text.',
        errorCode: 5,
      }
    }
    if (input.allowed_domains?.length && input.blocked_domains?.length) {
      return {
        result: false,
        message:
          'Error: Cannot specify both allowed_domains and blocked_domains in the same request',
        errorCode: 6,
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

    if (input.action === 'open') {
      const opened = await runNativeOpen(input, context.abortController)
      return {
        data: {
          ...opened,
          durationMs: Date.now() - start,
        } satisfies Output,
      }
    }

    if (input.action === 'navigate') {
      const url = await navigateBrowser(input.url!)
      return {
        data: {
          action: 'navigate',
          url,
          source: 'playwright',
          durationMs: Date.now() - start,
        } satisfies Output,
      }
    }

    if (input.action === 'click') {
      const clicked = await clickBrowser(input)
      const page = await getBrowserPage()
      return {
        data: {
          action: 'click',
          url: page.url(),
          text: clicked,
          source: 'playwright',
          durationMs: Date.now() - start,
        } satisfies Output,
      }
    }

    if (input.action === 'type') {
      const typed = await typeBrowser(input)
      const page = await getBrowserPage()
      return {
        data: {
          action: 'type',
          url: page.url(),
          text: typed,
          source: 'playwright',
          durationMs: Date.now() - start,
        } satisfies Output,
      }
    }

    if (input.action === 'screenshot') {
      const screenshotPath = await screenshotBrowser()
      const page = await getBrowserPage()
      return {
        data: {
          action: 'screenshot',
          url: page.url(),
          screenshot_path: screenshotPath,
          text: `Screenshot saved to ${screenshotPath}`,
          source: 'playwright',
          durationMs: Date.now() - start,
        } satisfies Output,
      }
    }

    if (input.action === 'links') {
      const page = await getBrowserPage()
      return {
        data: {
          action: 'links',
          url: page.url(),
          results: await getBrowserLinks(),
          source: 'playwright',
          durationMs: Date.now() - start,
        } satisfies Output,
      }
    }

    if (input.action === 'elements') {
      const page = await getBrowserPage()
      return {
        data: {
          action: 'elements',
          url: page.url(),
          elements: await getBrowserElements(),
          source: 'playwright',
          durationMs: Date.now() - start,
        } satisfies Output,
      }
    }

    const page = await getBrowserPage()
    return {
      data: {
        action: 'text',
        url: page.url(),
        text: formatOpenedText(input, await getBrowserText()),
        source: 'playwright',
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
