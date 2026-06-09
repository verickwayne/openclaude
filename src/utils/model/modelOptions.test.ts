import { afterEach, beforeEach, expect, test } from 'bun:test'
import {
  acquireSharedMutationLock,
  releaseSharedMutationLock,
} from '../../test/sharedMutationLock.js'
import { getGlobalConfig, saveGlobalConfig } from '../config.js'
import { getFable5Option, getOpus48Option, getScopedAdditionalModelOptions } from './modelOptions.js'

test('Opus 4.8 option has the canonical value', () => {
  expect(getOpus48Option().value).toBe('claude-opus-4-8')
  expect(getOpus48Option().label).toContain('Opus 4.8')
})
test('Fable 5 option has the canonical value', () => {
  expect(getFable5Option().value).toBe('claude-fable-5')
  expect(getFable5Option().label).toContain('Fable 5')
})

// Capture original config values for cleanup
const originalFirstPartyCache = getGlobalConfig().firstPartyAdditionalModelOptionsCache

beforeEach(async () => {
  await acquireSharedMutationLock('model/modelOptions.test.ts')
})

afterEach(() => {
  try {
    saveGlobalConfig(c => ({
      ...c,
      firstPartyAdditionalModelOptionsCache: originalFirstPartyCache,
    }))
  } finally {
    releaseSharedMutationLock()
  }
})

test('first-party bootstrap additions survive a provider scope change', () => {
  saveGlobalConfig(c => ({
    ...c,
    firstPartyAdditionalModelOptionsCache: [
      { value: 'claude-fable-5', label: 'Fable 5', description: 'Latest Claude model' },
    ],
  }))
  // Even with the OpenAI scope marker set, first-party additions must remain
  // reachable on the first-party route (this is what the picker reads).
  const opts = getScopedAdditionalModelOptions('firstParty')
  expect(opts.some(o => o.value === 'claude-fable-5')).toBe(true)
})
