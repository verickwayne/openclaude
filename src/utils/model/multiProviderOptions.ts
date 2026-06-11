// src/utils/model/multiProviderOptions.ts
import type { ProviderProfile } from '../config.js'
import type { ModelOption } from './modelOptions.js'
import type { ModelSetting } from './model.js'
import { parseModelList } from '../providerModels.js' // verified path (one level up, NOT ./providerModels)
import { isProviderAvailable } from '../providerAvailability.js'

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
const UNAVAILABLE_MARKER = '○'

export const ANTHROPIC_PICKER_MODELS: ModelOption[] = [
  {
    value: 'claude-opus-4-8',
    label: 'Opus 4.8',
    description: 'Claude Max / Anthropic subscription',
  },
  {
    value: 'sonnet',
    label: 'Sonnet',
    description: 'Claude Max / Anthropic subscription',
  },
  {
    value: 'haiku',
    label: 'Haiku',
    description: 'Claude Max / Anthropic subscription',
  },
  {
    value: 'claude-fable-5',
    label: 'Fable 5',
    description: 'Claude Max / Anthropic subscription',
  },
]

export const OPENAI_PICKER_MODELS: ModelOption[] = [
  { value: 'gpt-5.5', label: 'GPT-5.5', description: 'OpenAI' },
  { value: 'gpt-5.5-mini', label: 'GPT-5.5 Mini', description: 'OpenAI' },
  { value: 'gpt-5.4', label: 'GPT-5.4', description: 'OpenAI' },
  { value: 'gpt-5.4-mini', label: 'GPT-5.4 Mini', description: 'OpenAI' },
  { value: 'gpt-4.1', label: 'GPT-4.1', description: 'OpenAI' },
]

export const OPENAI_SUBSCRIPTION_PICKER_MODELS: ModelOption[] = [
  { value: 'gpt-5.5', label: 'GPT-5.5', description: 'OpenAI subscription' },
  { value: 'gpt-5.5-mini', label: 'GPT-5.5 Mini', description: 'OpenAI subscription' },
  { value: 'gpt-5.4', label: 'GPT-5.4', description: 'OpenAI subscription' },
  { value: 'gpt-5.4-mini', label: 'GPT-5.4 Mini', description: 'OpenAI subscription' },
  { value: 'gpt-5.3-codex', label: 'GPT-5.3 Codex', description: 'OpenAI subscription' },
  { value: 'gpt-5.3-codex-spark', label: 'GPT-5.3 Codex Spark', description: 'OpenAI subscription' },
  { value: 'gpt-5.2-codex', label: 'GPT-5.2 Codex', description: 'OpenAI subscription' },
  { value: 'gpt-5.1-codex-max', label: 'GPT-5.1 Codex Max', description: 'OpenAI subscription' },
  { value: 'gpt-5.1-codex-mini', label: 'GPT-5.1 Codex Mini', description: 'OpenAI subscription' },
  { value: 'codexplan', label: 'Codex Plan', description: 'OpenAI subscription' },
  { value: 'codexspark', label: 'Codex Spark', description: 'OpenAI subscription' },
]

export const OPENROUTER_PICKER_MODELS: ModelOption[] = [
  {
    value: 'minimax/minimax-m3',
    label: 'MiniMax M3',
    description: 'OpenRouter',
    contextWindow: 1_048_576,
    pricing: { inputPerMillionUsd: '$0.30', outputPerMillionUsd: '$1.20' },
  },
  {
    value: 'moonshotai/kimi-k2-thinking',
    label: 'Kimi K2 Thinking',
    description: 'OpenRouter',
    contextWindow: 262_144,
    parameterLabel: '1T total / 32B active',
    pricing: { inputPerMillionUsd: '$0.60', outputPerMillionUsd: '$2.50' },
  },
  {
    value: 'meta-llama/llama-4-scout',
    label: 'Llama 4 Scout',
    description: 'OpenRouter',
    contextWindow: 10_000_000,
    parameterLabel: '109B total / 17B active',
    pricing: { inputPerMillionUsd: '$0.10', outputPerMillionUsd: '$0.30' },
  },
  {
    value: 'qwen/qwen3-coder',
    label: 'Qwen3 Coder',
    description: 'OpenRouter',
    contextWindow: 1_048_576,
    parameterLabel: '480B total / 35B active',
    pricing: { inputPerMillionUsd: '$0.22', outputPerMillionUsd: '$1.80' },
  },
  {
    value: 'deepseek/deepseek-v4-flash',
    label: 'DeepSeek V4 Flash',
    description: 'OpenRouter',
    contextWindow: 1_048_576,
    parameterLabel: '284B total / 13B active',
    pricing: { inputPerMillionUsd: '$0.0983', outputPerMillionUsd: '$0.1966' },
  },
]

export const LOCAL_PICKER_MODELS: ModelOption[] = [
  {
    value: 'llama3.2:latest',
    label: 'Llama 3.2',
    description: 'Local provider',
  },
  {
    value: 'phi4-mini:latest',
    label: 'Phi 4 Mini',
    description: 'Local provider',
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
 *   127.0.0.1 address, or a remote RunPod-hosted local model proxy.
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

  // OpenRouter — check before generic OpenAI and local providers because
  // OpenRouter uses OpenAI compatibility and persisted profiles can identify
  // it either by provider id or by baseUrl.
  if (lowerProvider === 'openrouter' || lowerBaseUrl.includes('openrouter.ai')) {
    return 'openrouter'
  }

  // Local providers
  if (
    lowerProvider === 'ollama' ||
    lowerProvider === 'lmstudio' ||
    lowerBaseUrl.includes('localhost') ||
    lowerBaseUrl.includes('127.0.0.1') ||
    lowerBaseUrl.includes('runpod.net')
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
  const marker = available ? AVAILABLE_MARKER : UNAVAILABLE_MARKER
  const cleanLabel = option.label
    .replace(new RegExp(`^[${AVAILABLE_MARKER}${UNAVAILABLE_MARKER}]\\s+`), '')
    .trim()
  return {
    ...option,
    label: `${marker} ${cleanLabel}`,
    description: `${available ? 'Available' : 'Needs provider activation'} · ${
      option.description
    }`,
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
      return [...getOpenAIStableModelOptions([profile]), ...configured]
    case 'openrouter':
      return [...OPENROUTER_PICKER_MODELS, ...configured]
    case 'local':
    case 'other':
      return configured
  }
}

function getProfilesForGroup(
  profiles: ProviderProfile[],
  group: ProviderGroup,
): ProviderProfile[] {
  return profiles.filter(profile => classifyProviderGroup(profile.id, profile) === group)
}

function isOpenAISubscriptionProfile(
  profile: Pick<ProviderProfile, 'baseUrl' | 'model'>,
): boolean {
  const baseUrl = profile.baseUrl.trim().toLowerCase().replace(/\/+$/, '')
  const model = profile.model.trim().toLowerCase()
  return (
    baseUrl === 'https://chatgpt.com/backend-api/codex' ||
    model === 'codexplan' ||
    model === 'codexspark'
  )
}

function dedupeModelOptions(options: ModelOption[]): ModelOption[] {
  const seen = new Set<string>()
  const deduped: ModelOption[] = []

  for (const option of options) {
    const key = String(option.value).trim().toLowerCase()
    if (!key || seen.has(key)) {
      continue
    }
    seen.add(key)
    deduped.push(option)
  }

  return deduped
}

function getOpenAIStableModelOptions(
  profiles: Array<Pick<ProviderProfile, 'baseUrl' | 'model'>>,
): ModelOption[] {
  if (profiles.length === 0) {
    return OPENAI_PICKER_MODELS
  }

  const options: ModelOption[] = []
  if (profiles.some(isOpenAISubscriptionProfile)) {
    options.push(...OPENAI_SUBSCRIPTION_PICKER_MODELS)
  }
  if (profiles.some(profile => !isOpenAISubscriptionProfile(profile))) {
    options.push(...OPENAI_PICKER_MODELS)
  }

  return dedupeModelOptions(options)
}

function groupHasAvailableProfile(profiles: ProviderProfile[]): boolean {
  return profiles.some(profile => isProviderAvailable(profile))
}

function getMetadataKey(value: ModelOption['value']): string {
  return String(value).trim().toLowerCase()
}

function buildMetadataByValue(options: ModelOption[] | undefined): Map<string, ModelOption> {
  const metadata = new Map<string, ModelOption>()
  for (const option of options ?? []) {
    const key = getMetadataKey(option.value)
    if (!key) continue
    metadata.set(key, option)
  }
  return metadata
}

function mergeOptionMetadata(option: ModelOption, metadata?: ModelOption): ModelOption {
  if (!metadata) {
    return option
  }
  return {
    ...option,
    contextWindow: metadata.contextWindow ?? option.contextWindow,
    parameterCount: metadata.parameterCount ?? option.parameterCount,
    parameterLabel: metadata.parameterLabel ?? option.parameterLabel,
    pricing: metadata.pricing ?? option.pricing,
  }
}

function formatTokenCount(value: number): string {
  if (value >= 1_000_000) {
    return `${Number((value / 1_000_000).toFixed(1))}M`
  }
  if (value >= 1_000) {
    return `${Number((value / 1_000).toFixed(1))}K`
  }
  return value.toLocaleString()
}

function getParameterDisplay(option: ModelOption): string {
  if (option.parameterLabel?.trim()) {
    return option.parameterLabel.trim()
  }
  if (option.parameterCount) {
    return formatTokenCount(option.parameterCount)
  }
  return 'not published'
}

function getContextDisplay(option: ModelOption): string {
  return option.contextWindow ? formatTokenCount(option.contextWindow) : 'not published'
}

function getPriceDisplay(option: ModelOption): string {
  const input = option.pricing?.inputPerMillionUsd
  const output = option.pricing?.outputPerMillionUsd
  return `in ${input ?? '?'} / out ${output ?? '?'} per 1M`
}

function withVisibleModelMetadata(option: ModelOption): ModelOption {
  const metadata = `Params: ${getParameterDisplay(option)} · Context: ${getContextDisplay(option)} · Price: ${getPriceDisplay(option)}`
  const baseDescription = option.description.trim()
  return {
    ...option,
    description: baseDescription ? `${baseDescription} · ${metadata}` : metadata,
  }
}

function getConfiguredOptionsForProfiles(
  profiles: ProviderProfile[],
  modelOptionsByProfileId?: Record<string, ModelOption[]>,
): ModelOption[] {
  const configured: ModelOption[] = []
  for (const profile of profiles) {
    const metadataByValue = buildMetadataByValue(modelOptionsByProfileId?.[profile.id])
    for (const model of parseModelList(profile.model ?? '')) {
      configured.push(
        mergeOptionMetadata(
          {
            value: model,
            label: model,
            description: `Provider: ${profile.name}`,
          },
          metadataByValue.get(model.trim().toLowerCase()),
        ),
      )
    }
  }
  return configured
}

function getStableGroupModelOptions(
  group: ProviderGroup,
  profiles: ProviderProfile[],
  _firstPartyOptions: ModelOption[],
  modelOptionsByProfileId?: Record<string, ModelOption[]>,
): ModelOption[] {
  const configured = getConfiguredOptionsForProfiles(profiles, modelOptionsByProfileId)
  const metadataByValue = buildMetadataByValue(
    profiles.flatMap(profile => modelOptionsByProfileId?.[profile.id] ?? []),
  )
  const mergeGroupMetadata = (options: ModelOption[]): ModelOption[] =>
    options.map(option =>
      mergeOptionMetadata(option, metadataByValue.get(getMetadataKey(option.value))),
    )
  switch (group) {
    case 'anthropic':
      return mergeGroupMetadata([...ANTHROPIC_PICKER_MODELS, ...configured])
    case 'openai':
      return mergeGroupMetadata([...getOpenAIStableModelOptions(profiles), ...configured])
    case 'openrouter':
      return mergeGroupMetadata([...OPENROUTER_PICKER_MODELS, ...configured])
    case 'local':
      return mergeGroupMetadata([...LOCAL_PICKER_MODELS, ...configured])
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
  modelOptionsByProfileId?: Record<string, ModelOption[]>
}): TaggedModelOption[] {
  // Build a map from group → tagged options in insertion order
  const groups = new Map<ProviderGroup, TaggedModelOption[]>()
  for (const g of GROUP_ORDER) {
    groups.set(g, [])
  }

  const globalSeen = new Set<string>()

  for (const group of GROUP_ORDER) {
    if (group === 'other') continue

    const groupProfiles = getProfilesForGroup(input.profiles, group)
    const providerId = groupProfiles[0]?.id ?? group
    const providerName = groupProfiles[0]?.name ?? GROUP_DISPLAY_NAMES[group]
    const available = groupHasAvailableProfile(groupProfiles)
    const groupSeen = new Set<string>()

    for (const option of getStableGroupModelOptions(
      group,
      groupProfiles,
      input.firstPartyOptions,
      input.modelOptionsByProfileId,
    )) {
      const normalized = String(option.value).trim().toLowerCase()
      if (!normalized || groupSeen.has(normalized) || globalSeen.has(normalized)) {
        continue
      }
      groupSeen.add(normalized)
      globalSeen.add(normalized)
      addModelOption(
        groups.get(group)!,
        new Set<string>(),
        withVisibleModelMetadata(option),
        providerId,
        providerName,
        available,
      )
    }
  }

  const otherProfiles = getProfilesForGroup(input.profiles, 'other')
  for (const profile of otherProfiles) {
    for (const option of getConfiguredOptionsForProfiles([profile], input.modelOptionsByProfileId)) {
      addModelOption(
        groups.get('other')!,
        globalSeen,
        withVisibleModelMetadata(option),
        profile.id,
        profile.name,
        isProviderAvailable(profile),
      )
    }
  }

  const result: TaggedModelOption[] = []
  for (const g of GROUP_ORDER) {
    const items = groups.get(g)!
    if (items.length === 0) continue

    // Insert a non-selectable header before the group
    const headerValue = makeGroupHeaderValue(g)
    const headerLabel = GROUP_DISPLAY_NAMES[g]
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

  result.push({
    value: ADD_REMOVE_MODELS_VALUE as ModelSetting,
    label: 'Add models',
    description: 'Search provider model catalogs and update picker entries',
    providerId: '__action__',
    providerName: '',
  })

  return result
}
