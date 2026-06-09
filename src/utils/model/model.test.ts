import { expect, test } from 'bun:test'
import { getMarketingNameForModel } from './model.js'

test('marketing name for Opus 4.8', () => {
  expect(getMarketingNameForModel('claude-opus-4-8')).toBe('Opus 4.8')
})
test('marketing name for Fable 5', () => {
  expect(getMarketingNameForModel('claude-fable-5')).toBe('Fable 5')
})
