import { expect, test } from 'bun:test'
import { CLAUDE_OPUS_4_8_CONFIG, CLAUDE_FABLE_5_CONFIG } from './configs.js'

test('Opus 4.8 config exposes the canonical id', () => {
  expect(CLAUDE_OPUS_4_8_CONFIG.firstParty).toBe('claude-opus-4-8')
})

test('Fable 5 config exposes the canonical id', () => {
  expect(CLAUDE_FABLE_5_CONFIG.firstParty).toBe('claude-fable-5')
})
