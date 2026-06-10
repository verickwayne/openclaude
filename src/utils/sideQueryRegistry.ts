/**
 * Thin registry-resolution wrapper for sideQuery.
 *
 * Isolated into its own module so tests can mock it via `mock.module('./sideQueryRegistry.js', …)`
 * without pulling the full multi-provider registry + ledger + profile stack into the
 * sideQuery test surface.
 *
 * Production callers: sideQuery.ts only.
 */
import {
  buildLiveRegistryInput,
  resolveProviderForClass,
  type ModelClass,
  type RankedCandidate,
} from '../services/api/modelRegistry.js'
import { readLedgerEntries } from './model/outcomeLedger.js'
import { getFirstPartyModelIds } from './model/modelOptions.js'
import { getProviderProfiles } from './providerProfiles.js'
import { getProjectRoot } from '../bootstrap/state.js'

/**
 * Resolve the top-ranked provider candidate for the given model class.
 * Returns null when the registry has no live candidates (no configured providers
 * for that class) so sideQuery can fall back to the originally-requested model.
 *
 * Reads the outcome ledger once per call (acceptable for the infrequent side-call
 * hot path; a higher-frequency caller should pass pre-read entries in a future
 * revision).
 */
export function resolveTopCandidateForClass(
  modelClass: ModelClass,
): RankedCandidate | null {
  const registryInput = buildLiveRegistryInput({
    getFirstPartyModels: getFirstPartyModelIds,
    getProfiles: getProviderProfiles,
  })
  const ledgerEntries = readLedgerEntries(getProjectRoot())
  const candidates = resolveProviderForClass(modelClass, registryInput, {
    ledgerEntries,
  })
  return candidates.length > 0 ? candidates[0] : null
}
