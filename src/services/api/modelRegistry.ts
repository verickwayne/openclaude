// src/services/api/modelRegistry.ts
import type { ProviderProfile } from '../../utils/config.js'
import { parseModelList } from '../../utils/providerModels.js' // verified path (NOT utils/model/)
import {
  aggregateLedgerStats,
  wilsonLower,
  type LedgerEntry,
  MIN_RELIABLE_N,
} from '../../utils/model/outcomeLedger.js'
import {
  firstPartyResolvedProvider,
  resolvedProviderFromProfile,
  type ResolvedProvider,
  type ResolvedProviderKind,
} from './resolvedProvider.js'
import { isCodexBaseUrl } from './providerConfig.js'

export type RegistryInput = {
  firstPartyModels: string[]
  profiles: ProviderProfile[]
}

// ─── Billing-model classification ────────────────────────────────────────────

/**
 * Billing model for a resolved provider candidate.
 *
 *   subscription — flat-rate OAuth quota that expires if unspent
 *                  (Claude Max proxy via anthropic-proxy; Codex OAuth via
 *                  openai-compatible with a Codex baseURL).
 *   metered       — pay-per-token API key (anthropic-native, gemini, bedrock,
 *                  vertex, generic openai-compatible).
 *   free          — $0 / local execution (localhost/127.0.0.1 profiles).
 */
export type BillingModel = 'subscription' | 'metered' | 'free'

/**
 * Derive the billing model for a ResolvedProvider.
 *
 * Mapping table:
 *   anthropic-proxy   → subscription  (localhost Anthropic = Claude Max OAuth proxy)
 *   openai-compatible → subscription  if baseURL is a Codex endpoint
 *                     → free          if baseURL is localhost/127.0.0.1
 *                     → metered       otherwise
 *   anthropic-native  → metered
 *   gemini            → metered
 *   bedrock           → metered
 *   vertex            → metered
 */
export function billingModel(rp: { kind: ResolvedProviderKind; baseURL?: string }): BillingModel {
  if (rp.kind === 'anthropic-proxy') return 'subscription'

  if (rp.kind === 'openai-compatible') {
    if (isCodexBaseUrl(rp.baseURL)) return 'subscription'
    const lower = (rp.baseURL ?? '').toLowerCase()
    if (lower.includes('localhost') || lower.includes('127.0.0.1')) return 'free'
    return 'metered'
  }

  // anthropic-native, gemini, bedrock, vertex are all pay-per-token
  return 'metered'
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
  /** Billing model for this candidate (subscription | metered | free). */
  billingModel: BillingModel
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

// ─── Model-class reverse lookup ──────────────────────────────────────────────

/**
 * All non-local model classes, in lookup priority order for failover.
 * `local` is excluded because failover to a local model when a cloud provider
 * fails is a policy decision the operator must make explicitly; it is not the
 * automatic behavior we want.
 */
export const FAILOVER_MODEL_CLASSES: ModelClass[] = ['frontier', 'mid', 'fast', 'verification']

/**
 * Guess the model class for a given model string by checking the static
 * candidate lists (and live registry profiles).  Returns the first class whose
 * static list or live registry includes `model`.  Falls back to `'mid'` when
 * no match is found — `mid` is the most common workload class for long-running
 * loops and the safest default.
 *
 * This is intentionally a best-effort heuristic used only for provider failover
 * (where the query loop has already chosen a provider and we want to find an
 * alternative in the same capability tier).  It is NOT a canonical model-class
 * assignment — the orchestration agent's explicit class choice is authoritative.
 */
export function guessModelClassForModel(
  model: string,
  input: RegistryInput,
): ModelClass {
  const registry = buildModelRegistry(input)
  // Check static lists first (fast path, no profile iteration).
  for (const cls of FAILOVER_MODEL_CLASSES) {
    if (STATIC_CLASS_CANDIDATES[cls].includes(model)) return cls
  }
  // Check live profiles: if the model is local (baseUrl = localhost), return 'local'.
  // Otherwise default to 'mid'.
  const rp = registry.get(model)
  if (rp) {
    const lower = (rp.baseURL ?? '').toLowerCase()
    if (lower.includes('localhost') || lower.includes('127.0.0.1')) return 'local'
  }
  return 'mid'
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
   * Multiple profile ids to exclude from results.  Unioned with
   * `excludeProvider`.  Used by mid-run provider failover: the query loop
   * accumulates every provider that has already failed in the current
   * failover cascade and passes the full set here, so a two-provider setup
   * where both keep erroring terminates (empty candidates → no failover)
   * instead of ping-ponging A→B→A forever.
   */
  excludeProviders?: string[]
  /**
   * Pre-parsed ledger entries, already read from disk.
   * When omitted, the ledger is not consulted (pure static ranking).
   * Pass `readLedgerEntries(projectRoot)` at the call site so this
   * function stays pure and testable without filesystem access.
   */
  ledgerEntries?: LedgerEntry[]
  /**
   * Preferred billing model for this dispatch.
   * When set, candidates whose billingModel matches are sorted to the front
   * of their existing ranking group (proven/explorers/unknown).
   * IMPORTANT: within-group only — a preferred-billing candidate never
   * jumps across groups; a proven metered provider still beats an unproven
   * subscription provider.
   * Ignored when OPENCLAUDE_BILLING_AWARE=0 (kill-switch).
   */
  preferBilling?: BillingModel
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
  env: NodeJS.ProcessEnv = process.env,
): RankedCandidate[] {
  const { workload, personaHint, excludeProvider, excludeProviders, ledgerEntries, preferBilling } = opts

  // Union of single + multi exclusion forms.
  const excludedProfileIds = new Set<string>(excludeProviders ?? [])
  if (excludeProvider) excludedProfileIds.add(excludeProvider)

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
  // Also filter out excluded profile ids at this stage.
  const liveRPs: ResolvedProvider[] = []
  for (const model of staticIds) {
    const rp = registry.get(model)
    if (!rp) continue
    if (excludedProfileIds.has(rp.profileId)) continue
    liveRPs.push(rp)
  }

  if (liveRPs.length === 0) return []

  // Step 3 — build ledger lookup: provider_model_used → { successRate, successes, n }.
  type LedgerKey = string
  const ledgerLookup = new Map<LedgerKey, { successRate: number; successes: number; n: number }>()

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
          successes: s.successes,
          n: s.n,
        })
      }
    }
  }

  // Step 4 — rank.
  // Groups (lower = higher priority in sort):
  //   0: ledger-reliable (n >= MIN_RELIABLE_N), sorted by confidence-adjusted
  //      success rate (Wilson lower confidence bound) descending — prevents
  //      early-luck lock-in from a handful of draws permanently burying
  //      under-sampled candidates; as n grows, LCB converges to the true rate.
  //   1: under-sampled (0 < n < MIN_RELIABLE_N) — exploration preferred
  //   2: no ledger data — static order preserved within group
  type Ranked = { rp: ResolvedProvider; successRate: number | null; successes: number; n: number; group: 0 | 1 | 2; staticIdx: number }

  const ranked: Ranked[] = liveRPs.map((rp, staticIdx) => {
    const ledgerData = ledgerLookup.get(rp.model)
    if (ledgerData) {
      return { rp, successRate: ledgerData.successRate, successes: ledgerData.successes, n: ledgerData.n, group: 0, staticIdx }
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
      return { rp, successRate: rawStats.successRate, successes: rawStats.successes, n: rawStats.n, group: 1, staticIdx }
    }
    return { rp, successRate: null, successes: 0, n: 0, group: 2, staticIdx }
  })

  // z=1.0 (≈84% one-sided confidence) tunes the LCB conservatism:
  // enough to dampen early-luck lock-in without over-penalising large-n cells.
  const WILSON_Z = 1.0

  ranked.sort((a, b) => {
    if (a.group !== b.group) return a.group - b.group
    if (a.group === 0) {
      // Both reliable — sort by best confidence-adjusted success rate (Wilson LCB) descending
      return wilsonLower(b.successes, b.n, WILSON_Z) - wilsonLower(a.successes, a.n, WILSON_Z)
    }
    // Groups 1 and 2 — preserve static order
    return a.staticIdx - b.staticIdx
  })

  const candidates: RankedCandidate[] = ranked.map(({ rp, successRate, n }) => ({
    ...rp,
    modelClass,
    ledgerSuccessRate: successRate,
    ledgerN: n,
    billingModel: billingModel(rp),
  }))

  // ── Billing-aware within-group re-sort ──────────────────────────────────────
  // When preferBilling is set and OPENCLAUDE_BILLING_AWARE !== '0', move
  // candidates whose billingModel matches preferBilling to the front of their
  // ranking group (proven/explorers/unknown). Within-group only: a preferred-
  // billing candidate never crosses a group boundary.
  if (preferBilling && env.OPENCLAUDE_BILLING_AWARE !== '0') {
    // Build the group lookup once (O(n)) so the comparator is O(1) per pair,
    // not O(n) per pair. Keyed on profileId so two profiles exposing the same
    // model string are distinguished correctly.
    const groupByProfileId = new Map<string, 0 | 1 | 2>(
      ranked.map(r => [r.rp.profileId, r.group]),
    )
    candidates.sort((a, b) => {
      // Primary key: group (already sorted correctly above — stable sort preserves it)
      const aGroup = groupByProfileId.get(a.profileId) ?? 2
      const bGroup = groupByProfileId.get(b.profileId) ?? 2
      if (aGroup !== bGroup) return aGroup - bGroup
      // Secondary key within group: preferred billing first
      const aPref = a.billingModel === preferBilling ? 0 : 1
      const bPref = b.billingModel === preferBilling ? 0 : 1
      return aPref - bPref
    })
  }

  return candidates
}
