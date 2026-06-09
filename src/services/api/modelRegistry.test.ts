import { expect, test } from 'bun:test'
import { buildModelRegistry, resolveProviderForModel, buildLiveRegistryInput } from './modelRegistry.js'

const PROFILES = [
  { id: 'p1', name: 'OpenRouter', provider: 'openai', baseUrl: 'https://openrouter.ai/api/v1', model: 'openai/gpt-5.5,anthropic/claude-3.5' },
  { id: 'p2', name: 'Ollama', provider: 'openai', baseUrl: 'http://localhost:11434/v1', model: 'llama3.2:latest' },
] as any[]

test('registry maps each profile model to its profile', () => {
  const reg = buildModelRegistry({
    firstPartyModels: ['claude-opus-4-8', 'claude-fable-5'],
    profiles: PROFILES,
  })
  expect(reg.get('openai/gpt-5.5')?.profileId).toBe('p1')
  expect(reg.get('llama3.2:latest')?.profileId).toBe('p2')
  expect(reg.get('claude-opus-4-8')?.profileId).toBe('first-party')
})

test('resolveProviderForModel returns a ResolvedProvider for a known model', () => {
  const rp = resolveProviderForModel('openai/gpt-5.5', {
    firstPartyModels: ['claude-opus-4-8'],
    profiles: PROFILES,
  })
  expect(rp?.kind).toBe('openai-compatible')
  expect(rp?.baseURL).toBe('https://openrouter.ai/api/v1')
  expect(rp?.model).toBe('openai/gpt-5.5')
})

test('resolveProviderForModel returns null for an unknown model', () => {
  const rp = resolveProviderForModel('mystery-model', { firstPartyModels: [], profiles: [] })
  expect(rp).toBeNull()
})

test('buildLiveRegistryInput reads first-party models + saved profiles', () => {
  const input = buildLiveRegistryInput({
    getFirstPartyModels: () => ['claude-opus-4-8'],
    getProfiles: () => PROFILES,
  })
  expect(input.firstPartyModels).toContain('claude-opus-4-8')
  expect(input.profiles.length).toBe(2)
})
