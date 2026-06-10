// src/services/api/modelRegistry.ts
import type { ProviderProfile } from '../../utils/config.js'
import { parseModelList } from '../../utils/providerModels.js' // verified path (NOT utils/model/)
import {
  aggregateLedgerStats,
  type LedgerEntry,
  MIN_RELIABLE_N,
} from '../../utils/model/outcomeLedger.js'
import {
  firstPartyResolvedProvider,
  resolvedProviderFromProfile,
  type ResolvedProvider,
} from './resolvedProvider.js'

export type RegistryInput = {
  firstPartyModels: string[]
  profiles: ProviderProfile[]
}

// ─── Model-class types ────────────────────────────────────────────────────────

/**
 * Vocabulary used by the orchestration agent (`orchestrationAgent.ts`) when
 * assigning provider/model classes to work items:
 *
 *   "fast search/summarization, strong architecture, implementation,
 *    verification, or local/offline execution"
 *
 * We collapse that prose into five enum members and map each to an ordered
 * static candidate list. The ledger re-ranks the list when n >= MIN_RELIABLE_N.
 */
export type ModelClass =
  | 'fast'          // fast search/summarization — cheapest capable model
  | 'mid'           // implementation / standard tasks — mid-tier
  | 'frontier'      // strong architecture / complex reasoning — most capable
  | 'verification'  // checker-pass verification — cheap + different-provider
  | 'local'         // local/offline execution — $0 cost, network-free

/**
 * A ranked candidate from `resolveProviderForClass`.
 * Shape is a superset of ResolvedProvider so callers that already use
 * resolveProviderForModel can consume both with the same code.
 */
export type RankedCandidate = ResolvedProvider & {
  /** The model class this candidate was resolved for. */
  modelClass: ModelClass
  /**
   * Ledger-derived success rate for this candidate in the requested
   * (persona × workload × provider_model_used) cell, or null when the
   * ledger had no data (fell back to static order).
   */
  ledgerSuccessRate: number | null
  /**
   * Number of ledger entries that backed `ledgerSuccessRate`.
   * 0 means static-order fallback.
   */
  ledgerN: number
}

// ─── Static class→model map ───────────────────────────────────────────────────

/**
 * Default candidate model ids for each class, in priority order.
 * These are aliases / well-known ids that the registry's first-party list
 * or a configured profile must contain to be live.  Static order is used
 * when the ledger has no data (n < MIN_RELIABLE_N) for a candidate cell.
 *
 * `local` has no first-party static candidates — it only surfaces models
 * from profiles whose baseUrl is localhost/127.0.0.1.
 */
const STATIC_CLASS_CANDIDATES: Record<ModelClass, string[]> = {
  fast: ['haiku', 'claude-haiku-4-5', 'gpt-5.5-mini', 'gpt-5.4-mini'],
  mid: ['sonnet', 'claude-sonnet-4-6', 'gpt-5.4', 'gpt-5.5', 'deepseek/deepseek-chat-v3-0324'],
  frontier: ['claude-opus-4-8', 'claude-fable-5', 'gpt-5.5', 'google/gemini-2.5-pro'],
  verification: ['haiku', 'claude-haiku-4-5', 'gpt-5.5-mini', 'gpt-5.4-mini'],
  local: [], // populated entirely from live local profiles
}

// ─── Core registry functions ──────────────────────────────────────────────────

/** model id -> ResolvedProvider. First match wins; profiles in array order. */
export function buildModelRegistry(input: RegistryInput): Map<string, ResolvedProvider> {
  const reg = new Map<string, ResolvedProvider>()
  for (const model of input.firstPartyModels) {
    if (!reg.has(model)) reg.set(model, firstPartyResolvedProvider(model))
  }
  for (const profile of input.profiles) {
    const models = parseModelList(profile.model ?? '')
    for (const model of models) {
      if (!reg.has(model)) {
        reg.set(model, resolvedProviderFromProfile(profile, model))
      }
    }
  }
  return reg
}

export function resolveProviderForModel(
  model: string,
  input: RegistryInput,
): ResolvedProvider | null {
  return buildModelRegistry(input).get(model) ?? null
}

export function buildLiveRegistryInput(deps: {
  getFirstPartyModels: () => string[]
  getProfiles: () => ProviderProfile[]
}): RegistryInput {
  return {
    firstPartyModels: deps.getFirstPartyModels(),
    profiles: deps.getProfiles(),
  }
}

// ─── resolveProviderForClass ──────────────────────────────────────────────────

/**
 * Options for `resolveProviderForClass`.
 */
export type ResolveForClassOpts = {
  /**
   * LoopWorkloadClass tag for the current dispatch ('direct' | 'bounded' |
   * 'long-running').  Passed to the ledger lookup to stratify stats.
   * When omitted, the ledger is queried without a workload filter.
   */
  workload?: string
  /**
   * Persona name of the agent being dispatched
   * ('openralph-builder', 'openralph-checker', …).
   * When provided, ledger stats are filtered to this persona.
   */
  personaHint?: string
  /**
   * Profile id of the provider to exclude from results.
   * Used by the checker's different-provider rule: pass the worker's
   * `ResolvedProvider.profileId` to exclude the entire provider family.
   */
  excludeProvider?: string
  /**
   * Pre-parsed ledger entries, already read from disk.
   * When omitted, the ledger is not consulted (pure static ranking).
   * Pass `readLedgerEntries(projectRoot)` at the call site so this
   * function stays pure and testable without filesystem access.
   */
  ledgerEntries?: LedgerEntry[]
}

/**
 * Resolve a ranked list of provider candidates for the given model class.
 *
 * Algorithm:
 * 1. Build the static candidate list for `modelClass` from STATIC_CLASS_CANDIDATES.
 *    For 'local', also include every model from profiles whose baseUrl is
 *    localhost/127.0.0.1 — they won't appear in the static list.
 * 2. Filter to live candidates: only models present in the live registry
 *    (i.e. first-party or in a configured profile).
 * 3. Filter out any candidate whose profileId matches `opts.excludeProvider`.
 * 4. Rank by ledger success rate when n >= MIN_RELIABLE_N for the
 *    (personaHint × workload × provider_model_used) cell; otherwise preserve
 *    static order (already priority-ordered in STATIC_CLASS_CANDIDATES).
 *    Candidates with n < MIN_RELIABLE_N are sorted after reliable ones but
 *    before candidates with 0 ledger data — they are preferred for exploration.
 *
 * Returns an empty array when no live candidates exist for the class.
 */
export function resolveProviderForClass(
  modelClass: ModelClass,
  input: RegistryInput,
  opts: ResolveForClassOpts = {},
): RankedCandidate[] {
  const { workload, personaHint, excludeProvider, ledgerEntries } = opts

  // Step 1 — collect static candidate model ids for this class.
  const registry = buildModelRegistry(input)
  const staticIds = [...STATIC_CLASS_CANDIDATES[modelClass]]

  // For 'local', supplement with every model from local-profile entries.
  if (modelClass === 'local') {
    for (const profile of input.profiles) {
      const lowerBase = (profile.baseUrl ?? '').toLowerCase()
      if (lowerBase.includes('localhost') || lowerBase.includes('127.0.0.1')) {
        for (const model of parseModelList(profile.model ?? '')) {
          if (!staticIds.includes(model)) staticIds.push(model)
        }
      }
    }
  }

  // Step 2 — filter to live (registry has a ResolvedProvider entry).
  // Also filter out excludeProvider at this stage.
  const liveRPs: ResolvedProvider[] = []
  for (const model of staticIds) {
    const rp = registry.get(model)
    if (!rp) continue
    if (excludeProvider && rp.profileId === excludeProvider) continue
    liveRPs.push(rp)
  }

  if (liveRPs.length === 0) return []

  // Step 3 — build ledger lookup: provider_model_used → { successRate, n }.
  type LedgerKey = string
  const ledgerLookup = new Map<LedgerKey, { successRate: number; n: number }>()

  if (ledgerEntries && ledgerEntries.length > 0) {
    const stats = aggregateLedgerStats(
      ledgerEntries.filter(e => {
        if (personaHint && e.persona && e.persona !== personaHint) return false
        if (workload && e.workload && e.workload !== workload) return false
        return true
      }),
    )
    for (const s of stats) {
      if (s.n >= MIN_RELIABLE_N) {
        ledgerLookup.set(s.provider_model_used, {
          successRate: s.successRate ?? 0,
          n: s.n,
        })
      }
    }
  }

  // Step 4 — rank.
  // Groups (lower = higher priority in sort):
  //   0: ledger-reliable (n >= MIN_RELIABLE_N), sorted by successRate desc
  //   1: under-sampled (0 < n < MIN_RELIABLE_N) — exploration preferred
  //   2: no ledger data — static order preserved within group
  type Ranked = { rp: ResolvedProvider; successRate: number | null; n: number; group: 0 | 1 | 2; staticIdx: number }

  const ranked: Ranked[] = liveRPs.map((rp, staticIdx) => {
    const ledgerData = ledgerLookup.get(rp.model)
    if (ledgerData) {
      return { rp, successRate: ledgerData.successRate, n: ledgerData.n, group: 0, staticIdx }
    }
    // Check under-sampled: exists in stats but n < MIN_RELIABLE_N
    const rawStats = ledgerEntries
      ? aggregateLedgerStats(
          ledgerEntries.filter(e => {
            if (personaHint && e.persona && e.persona !== personaHint) return false
            if (workload && e.workload && e.workload !== workload) return false
            return true
          }),
        ).find(s => s.provider_model_used === rp.model)
      : undefined
    if (rawStats && rawStats.n > 0) {
      return { rp, successRate: rawStats.successRate, n: rawStats.n, group: 1, staticIdx }
    }
    return { rp, successRate: null, n: 0, group: 2, staticIdx }
  })

  ranked.sort((a, b) => {
    if (a.group !== b.group) return a.group - b.group
    if (a.group === 0) {
      // Both reliable — sort by success rate descending
      return (b.successRate ?? 0) - (a.successRate ?? 0)
    }
    // Groups 1 and 2 — preserve static order
    return a.staticIdx - b.staticIdx
  })

  return ranked.map(({ rp, successRate, n }) => ({
    ...rp,
    modelClass,
    ledgerSuccessRate: successRate,
    ledgerN: n,
  }))
}
