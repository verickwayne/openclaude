import { expect, test } from 'bun:test'
import { getOpus48Option, getFable5Option } from './modelOptions.js'

test('Opus 4.8 option has the canonical value', () => {
  expect(getOpus48Option().value).toBe('claude-opus-4-8')
  expect(getOpus48Option().label).toContain('Opus 4.8')
})
test('Fable 5 option has the canonical value', () => {
  expect(getFable5Option().value).toBe('claude-fable-5')
  expect(getFable5Option().label).toContain('Fable 5')
})
