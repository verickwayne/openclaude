// src/services/api/modelRegistry.ts
import type { ProviderProfile } from '../../utils/config.js'
import { parseModelList } from '../../utils/providerModels.js' // verified path (NOT utils/model/)
import {
  firstPartyResolvedProvider,
  resolvedProviderFromProfile,
  type ResolvedProvider,
} from './resolvedProvider.js'

export type RegistryInput = {
  firstPartyModels: string[]
  profiles: ProviderProfile[]
}

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
