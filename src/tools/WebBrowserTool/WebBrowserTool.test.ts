import { describe, expect, test } from 'bun:test'
import { __test } from './WebBrowserTool.js'

describe('WebBrowserTool helpers', () => {
  test('extracts the first markdown h1 as title', () => {
    expect(__test.extractTitleFromMarkdown('intro\n# Example Title\nbody')).toBe(
      'Example Title',
    )
  })

  test('normalizes Jina-style hits', () => {
    const hit = __test.normalizeJinaHit({
      title: 'Docs',
      url: 'https://example.com/docs',
      content: 'Documentation page',
    })
    expect(hit).toEqual({
      title: 'Docs',
      url: 'https://example.com/docs',
      description: 'Documentation page',
      source: 'example.com',
    })
  })

  test('truncates long page text', () => {
    const value = __test.truncateBrowserText('x'.repeat(130_000))
    expect(value.length).toBeLessThan(130_000)
    expect(value).toContain('Content truncated')
  })

  test('builds compact markdown from headings and short paragraphs', () => {
    const value = __test.compactMarkdown(
      '# Title\n\nThis is a useful paragraph.\n\n' + 'x'.repeat(500),
      2000,
    )
    expect(value).toContain('# Title')
    expect(value).toContain('This is a useful paragraph.')
    expect(value).toContain('Compact browser view')
    expect(value).not.toContain('x'.repeat(500))
  })
})
