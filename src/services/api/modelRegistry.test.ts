import { afterEach, expect, test, describe } from 'bun:test'
import {
  buildModelRegistry,
  resolveProviderForModel,
  buildLiveRegistryInput,
  resolveProviderForClass,
  billingModel,
} from './modelRegistry.js'
import type { LedgerEntry } from '../../utils/model/outcomeLedger.js'
import { MIN_RELIABLE_N } from '../../utils/model/outcomeLedger.js'

const PROFILES = [
  { id: 'p1', name: 'OpenRouter', provider: 'openai', baseUrl: 'https://openrouter.ai/api/v1', model: 'openai/gpt-5.5,anthropic/claude-3.5' },
  { id: 'p2', name: 'Ollama', provider: 'openai', baseUrl: 'http://localhost:11434/v1', model: 'llama3.2:latest' },
] as any[]

const originalOpenRouterApiKey = process.env.OPENROUTER_API_KEY

afterEach(() => {
  if (originalOpenRouterApiKey === undefined) {
    delete process.env.OPENROUTER_API_KEY
  } else {
    process.env.OPENROUTER_API_KEY = originalOpenRouterApiKey
  }
})

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

test('OpenRouter profile models use OPENROUTER_API_KEY when profile key is empty', () => {
  process.env.OPENROUTER_API_KEY = 'or-live-key'

  const rp = resolveProviderForModel('openai/gpt-5.5', {
    firstPartyModels: [],
    profiles: [
      {
        id: 'openrouter',
        name: 'OpenRouter',
        provider: 'openrouter',
        baseUrl: 'https://openrouter.ai/api/v1',
        model: 'openai/gpt-5.5',
      },
    ] as any[],
  })

  expect(rp?.apiKey).toBe('or-live-key')
})

test('claude-max-proxy profiles route as Anthropic proxy, not OpenAI-compatible', () => {
  const rp = resolveProviderForModel('claude-sonnet-4-5', {
    firstPartyModels: [],
    profiles: [
      {
        id: 'claude-max',
        name: 'Anthropic (Subscription)',
        provider: 'claude-max-proxy',
        baseUrl: 'http://127.0.0.1:8031',
        model: 'claude-sonnet-4-5',
      },
    ] as any[],
  })

  expect(rp?.kind).toBe('anthropic-proxy')
  expect(rp?.baseURL).toBe('http://127.0.0.1:8031')
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

// ─── resolveProviderForClass ──────────────────────────────────────────────────

/**
 * Registry fixture used across resolveProviderForClass tests.
 * - 'haiku' is a first-party model (fast/verification class)
 * - 'sonnet' is a first-party model (mid class)
 * - 'claude-opus-4-8' is a first-party model (frontier class)
 * - 'model-x' is on profile 'provider-x'
 * - 'model-y' is on profile 'provider-y'
 */
const CLASS_REGISTRY_INPUT = {
  firstPartyModels: ['haiku', 'sonnet', 'claude-opus-4-8'],
  profiles: [
    { id: 'provider-x', name: 'Provider X', provider: 'openai', baseUrl: 'https://provider-x.example.com/v1', model: 'model-x' },
    { id: 'provider-y', name: 'Provider Y', provider: 'openai', baseUrl: 'https://provider-y.example.com/v1', model: 'model-y' },
  ] as any[],
}

/** Build a set of MIN_RELIABLE_N ledger entries for a given model with given outcome. */
function ledgerEntries(
  model: string,
  status: 'complete' | 'partial' | 'blocked',
  tests_passed: boolean,
  count = MIN_RELIABLE_N,
  persona = 'openralph-builder',
  workload = 'bounded',
): LedgerEntry[] {
  return Array.from({ length: count }, (_, i) => ({
    ts: `2026-06-09T22:${String(i).padStart(2, '0')}:00Z`,
    session_id: `sess-${model}-${i}`,
    task_slug: 'test-task',
    persona,
    workload,
    provider_model_used: model,
    status,
    tests_passed,
    new_gaps: 0,
    duration_s: 100,
  }))
}

describe('resolveProviderForClass — basic availability', () => {
  test('returns empty array when no live candidates exist for class', () => {
    // 'local' class with no local profiles
    const result = resolveProviderForClass('local', {
      firstPartyModels: ['haiku'],
      profiles: [],
    })
    expect(result).toEqual([])
  })

  test('returns candidates only for live (registered) models', () => {
    // Only 'haiku' is live; 'gpt-5.5-mini' etc are not in the registry
    const result = resolveProviderForClass('fast', {
      firstPartyModels: ['haiku'],
      profiles: [],
    })
    expect(result.length).toBe(1)
    expect(result[0]?.model).toBe('haiku')
  })

  test('RankedCandidate carries modelClass field', () => {
    const [c] = resolveProviderForClass('frontier', {
      firstPartyModels: ['claude-opus-4-8'],
      profiles: [],
    })
    expect(c?.modelClass).toBe('frontier')
  })

  test('candidates include ResolvedProvider fields (profileId, kind, model)', () => {
    const [c] = resolveProviderForClass('fast', {
      firstPartyModels: ['haiku'],
      profiles: [],
    })
    expect(c?.profileId).toBe('first-party')
    expect(c?.kind).toBe('anthropic-native')
    expect(c?.model).toBe('haiku')
  })
})

describe('resolveProviderForClass — excludeProvider', () => {
  test('excludes candidates whose profileId matches excludeProvider', () => {
    // Both model-x (provider-x) and model-y (provider-y) would qualify for 'mid'
    // if they were in the static list — but that's not the case. Use a bespoke
    // registry where both are in the 'fast' class static candidates:
    // Instead test with first-party (profileId='first-party') excluded.
    const result = resolveProviderForClass('fast', {
      firstPartyModels: ['haiku'],
      profiles: [],
    }, { excludeProvider: 'first-party' })
    expect(result).toEqual([])
  })

  test('only excludes the specified provider, keeps others', () => {
    // haiku is first-party; model-x is provider-x.
    // We need model-x to be in the 'fast' static candidates — it isn't by default,
    // but we test with an explicit profile that maps a known static fast model alias
    // to a different provider. Use gpt-5.5-mini routed through provider-x.
    const input = {
      firstPartyModels: ['haiku'],
      profiles: [
        { id: 'openai-p', name: 'OpenAI', provider: 'openai', baseUrl: 'https://api.openai.com/v1', model: 'gpt-5.5-mini' },
      ] as any[],
    }
    const allCandidates = resolveProviderForClass('fast', input)
    expect(allCandidates.length).toBe(2) // haiku + gpt-5.5-mini

    const withExclude = resolveProviderForClass('fast', input, { excludeProvider: 'first-party' })
    expect(withExclude.length).toBe(1)
    expect(withExclude[0]?.model).toBe('gpt-5.5-mini')
  })
})

describe('resolveProviderForClass — excludeProviders (accumulated set)', () => {
  const input = {
    firstPartyModels: ['haiku'],
    profiles: [
      { id: 'openai-p', name: 'OpenAI', provider: 'openai', baseUrl: 'https://api.openai.com/v1', model: 'gpt-5.5-mini' },
      { id: 'mini-p', name: 'Mini Gateway', provider: 'openai', baseUrl: 'https://mini.example/v1', model: 'gpt-5.4-mini' },
    ] as any[],
  }

  test('excludes every profileId in the array', () => {
    const all = resolveProviderForClass('fast', input)
    expect(all.length).toBe(3) // haiku + gpt-5.5-mini + gpt-5.4-mini

    const result = resolveProviderForClass('fast', input, {
      excludeProviders: ['first-party', 'openai-p'],
    })
    expect(result.length).toBe(1)
    expect(result[0]?.profileId).toBe('mini-p')
  })

  test('returns empty when all providers are excluded', () => {
    const result = resolveProviderForClass('fast', input, {
      excludeProviders: ['first-party', 'openai-p', 'mini-p'],
    })
    expect(result).toEqual([])
  })

  test('excludeProviders unions with the single excludeProvider param', () => {
    const result = resolveProviderForClass('fast', input, {
      excludeProvider: 'first-party',
      excludeProviders: ['openai-p'],
    })
    expect(result.length).toBe(1)
    expect(result[0]?.profileId).toBe('mini-p')
  })

  test('empty excludeProviders array excludes nothing (back-compat)', () => {
    const result = resolveProviderForClass('fast', input, { excludeProviders: [] })
    expect(result.length).toBe(3)
  })
})

describe('resolveProviderForClass — ledger ranking', () => {
  test('no ledger → static order, ledgerN=0, ledgerSuccessRate=null', () => {
    const result = resolveProviderForClass('fast', {
      firstPartyModels: ['haiku'],
      profiles: [],
    }, { ledgerEntries: [] })
    expect(result[0]?.ledgerN).toBe(0)
    expect(result[0]?.ledgerSuccessRate).toBeNull()
  })

  test('ledger with n >= MIN_RELIABLE_N: higher success rate ranked first', () => {
    // model-y: 3/3 success; model-x: 0/3
    // Use a registry where both are in the 'fast' static list by putting them in profiles
    // and piggybacking on the fact that the static list for 'fast' includes 'haiku' which
    // we'll replace with model-x and model-y as direct first-party models.
    const input = {
      firstPartyModels: ['model-y', 'model-x', 'haiku'],
      profiles: [] as any[],
    }

    // Override STATIC_CLASS_CANDIDATES is not possible from outside, but we can test ranking
    // by using 'local' class which pulls from profiles with localhost.
    // Better: use a test where the static candidates exist in the registry.
    // 'haiku', 'gpt-5.5-mini', 'gpt-5.4-mini' are in the 'fast' static list.
    // Register them as first-party so they're live.
    const inputFast = {
      firstPartyModels: ['haiku', 'gpt-5.5-mini'],
      profiles: [] as any[],
    }

    const noLedger = resolveProviderForClass('fast', inputFast, { ledgerEntries: [] })
    // Static order: haiku comes before gpt-5.5-mini
    expect(noLedger[0]?.model).toBe('haiku')
    expect(noLedger[1]?.model).toBe('gpt-5.5-mini')

    // Seed gpt-5.5-mini as 3/3 success, haiku as 0/3 fail
    const entries: LedgerEntry[] = [
      ...ledgerEntries('gpt-5.5-mini', 'complete', true),  // 3/3 ✓
      ...ledgerEntries('haiku', 'complete', false),         // 0/3 ✗ (tests_passed=false)
    ]

    const withLedger = resolveProviderForClass('fast', inputFast, { ledgerEntries: entries })
    // gpt-5.5-mini should be ranked first (1.0 rate) over haiku (0.0 rate)
    expect(withLedger[0]?.model).toBe('gpt-5.5-mini')
    expect(withLedger[0]?.ledgerSuccessRate).toBe(1)
    expect(withLedger[0]?.ledgerN).toBe(MIN_RELIABLE_N)
    expect(withLedger[1]?.model).toBe('haiku')
    expect(withLedger[1]?.ledgerSuccessRate).toBe(0)
  })

  test('n < MIN_RELIABLE_N: under-sampled candidates ranked after reliable, before unknown', () => {
    const inputFast = {
      firstPartyModels: ['haiku', 'gpt-5.5-mini', 'gpt-5.4-mini'],
      profiles: [] as any[],
    }

    // haiku: MIN_RELIABLE_N records (reliable, 100%)
    // gpt-5.5-mini: 1 record (under-sampled, 100%)
    // gpt-5.4-mini: 0 records (no data)
    const entries: LedgerEntry[] = [
      ...ledgerEntries('haiku', 'complete', true),           // MIN_RELIABLE_N entries
      ...ledgerEntries('gpt-5.5-mini', 'complete', true, 1), // 1 entry only
    ]

    const result = resolveProviderForClass('fast', inputFast, { ledgerEntries: entries })
    const models = result.map(c => c.model)
    // haiku: reliable → group 0; gpt-5.5-mini: under-sampled → group 1; gpt-5.4-mini: no data → group 2
    expect(models.indexOf('haiku')).toBeLessThan(models.indexOf('gpt-5.5-mini'))
    expect(models.indexOf('gpt-5.5-mini')).toBeLessThan(models.indexOf('gpt-5.4-mini'))
  })

  test('workload filter: ledger stats only from matching workload', () => {
    const inputFast = {
      firstPartyModels: ['haiku', 'gpt-5.5-mini'],
      profiles: [] as any[],
    }
    // haiku wins in 'long-running', gpt-5.5-mini wins in 'bounded'
    const entries: LedgerEntry[] = [
      ...ledgerEntries('haiku', 'complete', true, MIN_RELIABLE_N, 'openralph-builder', 'long-running'),
      ...ledgerEntries('gpt-5.5-mini', 'complete', false, MIN_RELIABLE_N, 'openralph-builder', 'long-running'),
    ]

    // When querying with workload='long-running', haiku should rank first
    const result = resolveProviderForClass('fast', inputFast, {
      ledgerEntries: entries,
      workload: 'long-running',
    })
    expect(result[0]?.model).toBe('haiku')

    // When querying with workload='bounded', no ledger data → static order (haiku first)
    const resultBounded = resolveProviderForClass('fast', inputFast, {
      ledgerEntries: entries,
      workload: 'bounded',
    })
    expect(resultBounded[0]?.model).toBe('haiku') // static order, no ledger data for bounded
    expect(resultBounded[0]?.ledgerN).toBe(0)
  })

  test('personaHint filter: only uses ledger data from matching persona', () => {
    const inputFast = {
      firstPartyModels: ['haiku', 'gpt-5.5-mini'],
      profiles: [] as any[],
    }
    // builder persona: gpt-5.5-mini 3/3
    // checker persona: haiku 3/3
    const entries: LedgerEntry[] = [
      ...ledgerEntries('gpt-5.5-mini', 'complete', true, MIN_RELIABLE_N, 'openralph-builder', 'bounded'),
      ...ledgerEntries('haiku', 'complete', false, MIN_RELIABLE_N, 'openralph-checker', 'bounded'),
    ]

    // For builder persona: gpt-5.5-mini ranks first (1.0), haiku not in builder data
    const forBuilder = resolveProviderForClass('fast', inputFast, {
      ledgerEntries: entries,
      personaHint: 'openralph-builder',
      workload: 'bounded',
    })
    expect(forBuilder[0]?.model).toBe('gpt-5.5-mini')

    // For checker persona: haiku ranks first (but 0.0 rate), gpt-5.5-mini not in checker data
    const forChecker = resolveProviderForClass('fast', inputFast, {
      ledgerEntries: entries,
      personaHint: 'openralph-checker',
      workload: 'bounded',
    })
    // haiku has reliable data (0.0 rate), gpt-5.5-mini has no data → haiku in group 0, gpt-5.5-mini group 2
    // group 0 sorts before group 2 regardless of rate
    expect(forChecker.find(c => c.model === 'haiku')?.ledgerSuccessRate).toBe(0)
    expect(forChecker.find(c => c.model === 'gpt-5.5-mini')?.ledgerN).toBe(0)
  })
})

describe('resolveProviderForClass — local class', () => {
  test('surfaces localhost-profile models for local class', () => {
    const input = {
      firstPartyModels: [],
      profiles: [
        { id: 'ollama', name: 'Ollama', provider: 'ollama', baseUrl: 'http://localhost:11434/v1', model: 'llama3.2:latest' },
      ] as any[],
    }
    const result = resolveProviderForClass('local', input)
    expect(result.length).toBe(1)
    expect(result[0]?.model).toBe('llama3.2:latest')
    expect(result[0]?.modelClass).toBe('local')
  })

  test('127.0.0.1 baseUrl also surfaces for local class', () => {
    const input = {
      firstPartyModels: [],
      profiles: [
        { id: 'lm', name: 'LMStudio', provider: 'lmstudio', baseUrl: 'http://127.0.0.1:1234/v1', model: 'phi-4' },
      ] as any[],
    }
    const result = resolveProviderForClass('local', input)
    expect(result[0]?.model).toBe('phi-4')
  })

  test('non-local profiles do not appear in local class', () => {
    const input = {
      firstPartyModels: [],
      profiles: [
        { id: 'openrouter', name: 'OpenRouter', provider: 'openai', baseUrl: 'https://openrouter.ai/api/v1', model: 'some-model' },
      ] as any[],
    }
    const result = resolveProviderForClass('local', input)
    expect(result).toEqual([])
  })
})

describe('resolveProviderForClass — model classes map to expected vocab', () => {
  // Confirm the class names match the orchestrationAgent vocabulary
  test('"fast" class has static candidates including haiku-like aliases', () => {
    const result = resolveProviderForClass('fast', {
      firstPartyModels: ['haiku'],
      profiles: [],
    })
    expect(result.some(c => c.model === 'haiku')).toBe(true)
  })

  test('"verification" class has same fast-tier candidates (cheap different-provider use case)', () => {
    const result = resolveProviderForClass('verification', {
      firstPartyModels: ['haiku'],
      profiles: [],
    })
    expect(result.some(c => c.model === 'haiku')).toBe(true)
  })

  test('"frontier" class surfaces opus-equivalent models', () => {
    const result = resolveProviderForClass('frontier', {
      firstPartyModels: ['claude-opus-4-8'],
      profiles: [],
    })
    expect(result.some(c => c.model === 'claude-opus-4-8')).toBe(true)
  })
})

// ─── billingModel mapping ─────────────────────────────────────────────────────

describe('billingModel — kind→billing mapping', () => {
  test('anthropic-native → metered', () => {
    expect(billingModel({ kind: 'anthropic-native' })).toBe('metered')
  })

  test('anthropic-proxy → subscription (Claude Max OAuth proxy)', () => {
    expect(billingModel({ kind: 'anthropic-proxy', baseURL: 'http://localhost:5001/v1' })).toBe('subscription')
  })

  test('openai-compatible + Codex baseURL → subscription', () => {
    expect(billingModel({ kind: 'openai-compatible', baseURL: 'https://chatgpt.com/backend-api/codex' })).toBe('subscription')
  })

  test('openai-compatible + localhost baseURL → free', () => {
    expect(billingModel({ kind: 'openai-compatible', baseURL: 'http://localhost:11434/v1' })).toBe('free')
  })

  test('openai-compatible + 127.0.0.1 baseURL → free', () => {
    expect(billingModel({ kind: 'openai-compatible', baseURL: 'http://127.0.0.1:1234/v1' })).toBe('free')
  })

  test('openai-compatible + remote URL → metered', () => {
    expect(billingModel({ kind: 'openai-compatible', baseURL: 'https://openrouter.ai/api/v1' })).toBe('metered')
  })

  test('gemini → metered', () => {
    expect(billingModel({ kind: 'gemini' })).toBe('metered')
  })

  test('bedrock → metered', () => {
    expect(billingModel({ kind: 'bedrock' })).toBe('metered')
  })

  test('vertex → metered', () => {
    expect(billingModel({ kind: 'vertex' })).toBe('metered')
  })
})

// ─── billing-aware candidate preference ──────────────────────────────────────

describe('resolveProviderForClass — billing-aware preference', () => {
  // Registry with:
  //   haiku          → first-party anthropic-native (metered)
  //   gpt-5.5-mini   → openai-compatible remote (metered)
  //   max-proxy-fast → anthropic-proxy localhost (subscription)
  const billingInput = {
    firstPartyModels: ['haiku'],
    profiles: [
      {
        id: 'openai-p',
        name: 'OpenAI',
        provider: 'openai',
        baseUrl: 'https://api.openai.com/v1',
        model: 'gpt-5.5-mini',
      },
      {
        id: 'max-proxy',
        name: 'Max Proxy',
        provider: 'anthropic',
        // lowercase 'localhost' triggers anthropic-proxy kind in resolvedProvider.ts
        baseUrl: 'http://localhost:9090/v1',
        model: 'claude-haiku-4-5',
      },
    ] as any[],
  }

  test('RankedCandidate carries billingModel field', () => {
    const results = resolveProviderForClass('fast', {
      firstPartyModels: ['haiku'],
      profiles: [],
    })
    expect(results[0]?.billingModel).toBe('metered') // anthropic-native
  })

  test('preferBilling:subscription moves subscription candidate to front within its group', () => {
    // Without preferBilling: static order is haiku first (index 0 in STATIC_CLASS_CANDIDATES.fast)
    const withoutPref = resolveProviderForClass('fast', billingInput)
    // haiku is first in static list — should appear first without preference
    expect(withoutPref[0]?.model).toBe('haiku')

    // With preferBilling:subscription — claude-haiku-4-5 (subscription) should sort before haiku
    const withPref = resolveProviderForClass('fast', billingInput, { preferBilling: 'subscription' })
    const subscriptionFirst = withPref.find(c => c.billingModel === 'subscription')
    const firstNonSub = withPref.find(c => c.billingModel !== 'subscription')
    // Subscription candidate must appear before the first non-subscription in the same group
    expect(withPref.indexOf(subscriptionFirst!)).toBeLessThan(withPref.indexOf(firstNonSub!))
  })

  test('proven metered candidate beats unproven subscription across groups', () => {
    // haiku gets MIN_RELIABLE_N proven ledger entries (group 0), making it reliable
    // claude-haiku-4-5 (subscription) has no ledger data (group 2)
    // preferBilling:subscription must NOT promote group-2 subscription over group-0 metered
    const entries: LedgerEntry[] = Array.from({ length: MIN_RELIABLE_N }, (_, i) => ({
      ts: `2026-06-10T01:${String(i).padStart(2, '0')}:00Z`,
      session_id: `sess-${i}`,
      task_slug: 'test',
      persona: 'openralph-builder',
      workload: 'long-running',
      provider_model_used: 'haiku',
      status: 'complete' as const,
      tests_passed: true,
      new_gaps: 0,
      duration_s: 60,
    }))

    const result = resolveProviderForClass('fast', billingInput, {
      preferBilling: 'subscription',
      ledgerEntries: entries,
      workload: 'long-running',
    })

    const haikuIdx = result.findIndex(c => c.model === 'haiku')
    const subIdx = result.findIndex(c => c.billingModel === 'subscription')
    // haiku (group 0, proven) must still sort before claude-haiku-4-5 (group 2, unproven)
    expect(haikuIdx).toBeLessThan(subIdx)
  })

  test('kill-switch LIMITLESS_BILLING_AWARE=0 disables preference', () => {
    const withKillSwitch = resolveProviderForClass(
      'fast',
      billingInput,
      { preferBilling: 'subscription' },
      { LIMITLESS_BILLING_AWARE: '0' },
    )
    const withoutKillSwitch = resolveProviderForClass(
      'fast',
      billingInput,
      { preferBilling: 'subscription' },
    )

    // With kill-switch: order should be static (haiku first, as in default)
    // Without kill-switch: subscription should be preferred
    const killSwitchFirst = withKillSwitch[0]?.model
    const preferenceFirst = withoutKillSwitch[0]?.model

    // kill-switch active → preference ignored → static order (haiku first)
    expect(killSwitchFirst).toBe('haiku')
    // preference active → subscription candidate moves up
    expect(withoutKillSwitch.find(c => c.billingModel === 'subscription')).toBeDefined()
    const subIdx = withoutKillSwitch.findIndex(c => c.billingModel === 'subscription')
    const nonSubIdx = withoutKillSwitch.findIndex(c => c.billingModel !== 'subscription')
    expect(subIdx).toBeLessThan(nonSubIdx)
  })

  test('preferBilling absent → no billing re-sort (zero behavior change)', () => {
    const noPref = resolveProviderForClass('fast', billingInput)
    const explicitNoPref = resolveProviderForClass('fast', billingInput, {})
    // Both should produce same order as static
    expect(noPref.map(c => c.model)).toEqual(explicitNoPref.map(c => c.model))
    // And haiku (static-order first) should still be first
    expect(noPref[0]?.model).toBe('haiku')
  })
})
