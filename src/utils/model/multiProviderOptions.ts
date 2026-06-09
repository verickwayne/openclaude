// src/utils/model/multiProviderOptions.ts
import type { ProviderProfile } from '../config.js'
import type { ModelOption } from './modelOptions.js'
import type { ModelSetting } from './model.js'
import { parseModelList } from '../providerModels.js' // verified path (one level up, NOT ./providerModels)

export type TaggedModelOption = ModelOption & {
  providerId: string
  providerName: string
}

export type ProviderGroup = 'anthropic' | 'openai' | 'openrouter' | 'local' | 'other'

const GROUP_ORDER: ProviderGroup[] = ['anthropic', 'openai', 'openrouter', 'local', 'other']

const GROUP_DISPLAY_NAMES: Record<ProviderGroup, string> = {
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  openrouter: 'OpenRouter',
  local: 'Local',
  other: 'Other',
}

/** Unique sentinel prefix for group header option values. */
export const GROUP_HEADER_VALUE_PREFIX = '__provider_group_header__'

export function makeGroupHeaderValue(group: ProviderGroup): string {
  return `${GROUP_HEADER_VALUE_PREFIX}${group}`
}

export function isGroupHeaderValue(value: string): boolean {
  return value.startsWith(GROUP_HEADER_VALUE_PREFIX)
}

/**
 * Classify a profile (or first-party providerId) into a display group.
 *
 * - 'anthropic': providerId === 'first-party', or profile.provider is
 *   'claude-max-proxy' or 'anthropic'.
 * - 'openai': profile.provider === 'openai' (covers ChatGPT/Codex base URLs).
 * - 'openrouter': baseUrl contains 'openrouter.ai'.
 * - 'local': provider is 'ollama' or 'lmstudio', or baseUrl is a localhost/
 *   127.0.0.1 address.
 * - 'other': everything else (sorts last alongside local).
 */
export function classifyProviderGroup(
  providerId: string,
  profile?: Pick<ProviderProfile, 'provider' | 'baseUrl'>,
): ProviderGroup {
  if (providerId === 'first-party') {
    return 'anthropic'
  }

  if (!profile) {
    return 'other'
  }

  const { provider, baseUrl } = profile
  const lowerProvider = (provider ?? '').toLowerCase()
  const lowerBaseUrl = (baseUrl ?? '').toLowerCase()

  // Anthropic-compatible providers
  if (lowerProvider === 'anthropic' || lowerProvider === 'claude-max-proxy') {
    return 'anthropic'
  }

  // OpenRouter — check before generic OpenAI because openrouter uses openai
  // compatibility and its baseUrl is the primary signal.
  if (lowerBaseUrl.includes('openrouter.ai')) {
    return 'openrouter'
  }

  // Local providers
  if (
    lowerProvider === 'ollama' ||
    lowerProvider === 'lmstudio' ||
    lowerBaseUrl.includes('localhost') ||
    lowerBaseUrl.includes('127.0.0.1')
  ) {
    return 'local'
  }

  // OpenAI-compatible (after openrouter/local checks)
  if (lowerProvider === 'openai') {
    return 'openai'
  }

  return 'other'
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

/**
 * Returns the same options as `getAllProviderModelOptions` but sorted by
 * provider group (Anthropic → OpenAI → OpenRouter → Local/Other) with a
 * non-selectable header item inserted before each group that has at least one
 * model. The header items have values matching `GROUP_HEADER_VALUE_PREFIX +
 * group` and carry `disabled: true` so keyboard navigation skips them on
 * Enter.
 */
export function getGroupedProviderModelOptions(input: {
  firstPartyOptions: ModelOption[]
  profiles: ProviderProfile[]
}): TaggedModelOption[] {
  // Build a map from group → tagged options in insertion order
  const groups = new Map<ProviderGroup, TaggedModelOption[]>()
  for (const g of GROUP_ORDER) {
    groups.set(g, [])
  }

  const seen = new Set<ModelSetting>()

  const push = (
    o: ModelOption,
    providerId: string,
    providerName: string,
    group: ProviderGroup,
  ) => {
    if (seen.has(o.value)) return
    seen.add(o.value)
    groups.get(group)!.push({ ...o, providerId, providerName })
  }

  for (const o of input.firstPartyOptions) {
    push(o, 'first-party', 'Anthropic', 'anthropic')
  }

  for (const profile of input.profiles) {
    const group = classifyProviderGroup(profile.id, profile)
    for (const model of parseModelList(profile.model ?? '')) {
      push(
        { value: model, label: model, description: `via ${profile.name}` },
        profile.id,
        profile.name,
        group,
      )
    }
  }

  const result: TaggedModelOption[] = []
  for (const g of GROUP_ORDER) {
    const items = groups.get(g)!
    if (items.length === 0) continue

    // Insert a non-selectable header before the group
    const headerValue = makeGroupHeaderValue(g)
    const headerLabel = `── ${GROUP_DISPLAY_NAMES[g]} ──`
    result.push({
      value: headerValue as ModelSetting,
      label: headerLabel,
      description: '',
      providerId: '__header__',
      providerName: '',
      // @ts-expect-error -- 'disabled' is an OptionWithDescription field, not ModelOption,
      // but it is spread into SelectOption downstream via optionsOverride.
      disabled: true,
    })

    result.push(...items)
  }

  return result
}
