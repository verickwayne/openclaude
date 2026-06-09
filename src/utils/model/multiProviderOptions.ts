// src/utils/model/multiProviderOptions.ts
import type { ProviderProfile } from '../config.js'
import type { ModelOption } from './modelOptions.js'
import type { ModelSetting } from './model.js'
import { parseModelList } from '../providerModels.js' // verified path (one level up, NOT ./providerModels)

export type TaggedModelOption = ModelOption & {
  providerId: string
  providerName: string
}

export function getAllProviderModelOptions(input: {
  firstPartyOptions: ModelOption[]
  profiles: ProviderProfile[]
}): TaggedModelOption[] {
  const seen = new Set<ModelSetting>()
  const out: TaggedModelOption[] = []
  const push = (o: ModelOption, providerId: string, providerName: string) => {
    if (seen.has(o.value)) return
    seen.add(o.value)
    out.push({ ...o, providerId, providerName })
  }
  for (const o of input.firstPartyOptions) push(o, 'first-party', 'Anthropic')
  for (const profile of input.profiles) {
    for (const model of parseModelList(profile.model ?? '')) {
      push(
        { value: model, label: model, description: `via ${profile.name}` },
        profile.id,
        profile.name,
      )
    }
  }
  return out
}
