// src/utils/model/multiProviderOptions.ts
import type { ProviderProfile } from '../config.js'
import type { ModelOption } from './modelOptions.js'
import type { ModelSetting } from './model.js'
import { parseModelList } from '../providerModels.js' // verified path (one level up, NOT ./providerModels)

export type TaggedModelOption = ModelOption & {
  providerId: string
  providerName: string
  available?: boolean
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
export const ADD_REMOVE_MODELS_VALUE = '__add_remove_models__'

const AVAILABLE_MARKER = '●'

export const ANTHROPIC_PICKER_MODELS: ModelOption[] = [
  {
    value: 'claude-opus-4-8',
    label: 'Opus 4.8',
    description: 'Anthropic subscription',
  },
  {
    value: 'sonnet',
    label: 'Sonnet',
    description: 'Anthropic subscription',
  },
  {
    value: 'haiku',
    label: 'Haiku',
    description: 'Anthropic subscription',
  },
  {
    value: 'claude-fable-5',
    label: 'Fable 5',
    description: 'Anthropic subscription',
  },
]

export const OPENAI_PICKER_MODELS: ModelOption[] = [
  { value: 'gpt-5.5', label: 'GPT-5.5', description: 'OpenAI' },
  { value: 'gpt-5.5-mini', label: 'GPT-5.5 Mini', description: 'OpenAI' },
  { value: 'gpt-5.4', label: 'GPT-5.4', description: 'OpenAI' },
  { value: 'gpt-5.4-mini', label: 'GPT-5.4 Mini', description: 'OpenAI' },
  { value: 'gpt-4.1', label: 'GPT-4.1', description: 'OpenAI' },
]

export const OPENROUTER_PICKER_MODELS: ModelOption[] = [
  {
    value: 'google/gemini-2.5-pro',
    label: 'Gemini 2.5 Pro',
    description: 'OpenRouter',
  },
  {
    value: 'deepseek/deepseek-chat-v3-0324',
    label: 'DeepSeek V3 0324',
    description: 'OpenRouter',
  },
  {
    value: 'qwen/qwen3-coder',
    label: 'Qwen3 Coder',
    description: 'OpenRouter',
  },
  {
    value: 'meta-llama/llama-3.3-70b-instruct',
    label: 'Llama 3.3 70B Instruct',
    description: 'OpenRouter',
  },
]

export function makeGroupHeaderValue(group: ProviderGroup): string {
  return `${GROUP_HEADER_VALUE_PREFIX}${group}`
}

export function isGroupHeaderValue(value: string): boolean {
  return value.startsWith(GROUP_HEADER_VALUE_PREFIX)
}

export function isAddRemoveModelsValue(value: string): boolean {
  return value === ADD_REMOVE_MODELS_VALUE
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

function withAvailabilityMarker(option: ModelOption, available: boolean): ModelOption {
  if (!available || option.label.startsWith(AVAILABLE_MARKER)) {
    return option
  }

  return {
    ...option,
    label: `${AVAILABLE_MARKER} ${option.label}`,
  }
}

function addModelOption(
  options: TaggedModelOption[],
  seen: Set<string>,
  option: ModelOption,
  providerId: string,
  providerName: string,
  available: boolean,
): void {
  const normalized = String(option.value).trim().toLowerCase()
  if (!normalized || seen.has(normalized)) {
    return
  }

  seen.add(normalized)
  options.push({
    ...withAvailabilityMarker(option, available),
    providerId,
    providerName,
    available,
  })
}

export function getCuratedModelOptionsForProfile(
  profile: Pick<ProviderProfile, 'id' | 'provider' | 'name' | 'baseUrl' | 'model'>,
): ModelOption[] {
  const group = classifyProviderGroup(profile.id, profile)
  const configured = parseModelList(profile.model ?? '').map(model => ({
    value: model,
    label: model,
    description: `Provider: ${profile.name}`,
  }))

  switch (group) {
    case 'anthropic':
      return [...ANTHROPIC_PICKER_MODELS, ...configured]
    case 'openai':
      return [...OPENAI_PICKER_MODELS, ...configured]
    case 'openrouter':
      return [...OPENROUTER_PICKER_MODELS, ...configured]
    case 'local':
    case 'other':
      return configured
  }
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

  const seen = new Set<string>()
  const hasAnthropicProfile = input.profiles.some(
    profile => classifyProviderGroup(profile.id, profile) === 'anthropic',
  )

  const push = (
    o: ModelOption,
    providerId: string,
    providerName: string,
    group: ProviderGroup,
    available = true,
  ) => {
    addModelOption(
      groups.get(group)!,
      seen,
      o,
      providerId,
      providerName,
      available,
    )
  }

  for (const o of [...ANTHROPIC_PICKER_MODELS, ...input.firstPartyOptions]) {
    push(o, 'first-party', 'Anthropic', 'anthropic', hasAnthropicProfile)
  }

  for (const profile of input.profiles) {
    const group = classifyProviderGroup(profile.id, profile)
    for (const option of getCuratedModelOptionsForProfile(profile)) {
      push(
        option,
        profile.id,
        profile.name,
        group,
        true,
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

  if (input.profiles.length > 0) {
    result.push({
      value: ADD_REMOVE_MODELS_VALUE as ModelSetting,
      label: 'Add/Remove Models',
      description: 'Search provider model catalogs and update picker entries',
      providerId: '__action__',
      providerName: '',
    })
  }

  return result
}
