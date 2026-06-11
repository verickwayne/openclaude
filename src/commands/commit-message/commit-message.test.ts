import { describe, expect, it } from 'bun:test'
import {
  formatCoAuthorTrailer,
  parseCoAuthor,
  stripMatchingQuotes,
  USAGE,
} from './commit-message.js'

describe('commit-message command helpers', () => {
  it('parses quoted co-author names with a plain email', () => {
    expect(parseCoAuthor('"GPT 5.5" noreply@limitless.local')).toEqual({
      name: 'GPT 5.5',
      email: 'noreply@limitless.local',
    })
  })

  it('parses co-author trailers with angle-bracket emails', () => {
    expect(parseCoAuthor('Limitless (gpt-5.5) <noreply@limitless.local>')).toEqual(
      {
        name: 'Limitless (gpt-5.5)',
        email: 'noreply@limitless.local',
      },
    )
  })

  it('rejects co-author trailers with empty sanitized names', () => {
    expect(parseCoAuthor('"  " noreply@limitless.local')).toBeNull()
    expect(parseCoAuthor('"  " <noreply@limitless.local>')).toBeNull()
  })

  it('strips one pair of matching quotes from custom attribution text', () => {
    expect(stripMatchingQuotes('"Generated with Limitless"')).toBe(
      'Generated with Limitless',
    )
    expect(stripMatchingQuotes("'Generated with Limitless'")).toBe(
      'Generated with Limitless',
    )
    expect(stripMatchingQuotes('"Generated with Limitless')).toBe(
      '"Generated with Limitless',
    )
  })

  it('formats a sanitized co-author trailer', () => {
    expect(
      formatCoAuthorTrailer('Limitless <gpt>\n', '<noreply@limitless.local>'),
    ).toBe('Co-Authored-By: Limitless gpt <noreply@limitless.local>')
  })

  it('makes set scope explicit with example text', () => {
    expect(USAGE).toContain(
      'Controls only the attribution text appended after /commit messages.',
    )
    expect(USAGE).toContain(
      '/commit-message set "Generated with Limitless using GPT-5.5"',
    )
    expect(USAGE).not.toContain('/commit-message set-attribution')
  })
})
