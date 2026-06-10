// src/services/api/resolvedProvider.ts
import type {
  OpenAICompatibleApiFormat,
  OpenAICompatibleAuthScheme,
  ProviderProfile,
} from '../../utils/config.js'

export type ResolvedProviderKind =
  | 'anthropic-native'
  | 'anthropic-proxy'
  | 'openai-compatible'
  | 'gemini'
  | 'bedrock'
  | 'vertex'

/** Self-contained description of how to reach a provider for ONE request. */
// IMPORTANT (review fix #3): the existing `ProviderOverride` type is
// `{ model; baseURL; apiKey }` with CAPITAL `baseURL`, and the shim/client
// already read `.baseURL`. ResolvedProvider therefore uses `baseURL` (capital)
// so those existing readers keep working unchanged. Map `profile.baseUrl`
// (lowercase, the ProviderProfile field) → `baseURL` in the builder.
// `apiFormat` and `authScheme` reuse the real config types.
export type ResolvedProvider = {
  /** Owning profile id, or 'first-party' for native Anthropic. */
  profileId: string
  kind: ResolvedProviderKind
  /** The model id to request from this provider. */
  model: string
  baseURL?: string
  apiKey?: string
  authHeader?: string
  authScheme?: OpenAICompatibleAuthScheme
  authHeaderValue?: string
  apiFormat?: OpenAICompatibleApiFormat
  /** OAuth bearer for subscription-billed providers (Codex). */
  oauthAccessToken?: string
}

export function firstPartyResolvedProvider(model: string): ResolvedProvider {
  return { profileId: 'first-party', kind: 'anthropic-native', model }
}

function kindFromProfile(profile: ProviderProfile): ResolvedProviderKind {
  const provider = profile.provider ?? 'openai'
  const baseUrl = (profile.baseUrl ?? '').toLowerCase()
  if (provider === 'claude-max-proxy') {
    return 'anthropic-proxy'
  }
  if (provider === 'anthropic') {
    // A local/loopback Anthropic base URL is the Claude Max OAuth proxy.
    if (baseUrl.includes('127.0.0.1') || baseUrl.includes('localhost')) {
      return 'anthropic-proxy'
    }
    return 'anthropic-native'
  }
  if (provider === 'gemini') return 'gemini'
  if (provider === 'bedrock') return 'bedrock'
  if (provider === 'vertex') return 'vertex'
  return 'openai-compatible'
}

export function resolvedProviderFromProfile(
  profile: ProviderProfile,
  model: string,
): ResolvedProvider {
  return {
    profileId: profile.id,
    kind: kindFromProfile(profile),
    model,
    baseURL: profile.baseUrl || undefined, // lowercase field → capital carrier
    apiKey: profile.apiKey || undefined,
    authHeader: profile.authHeader || undefined,
    authScheme: profile.authScheme || undefined,
    authHeaderValue: profile.authHeaderValue || undefined,
    apiFormat: profile.apiFormat || undefined,
  }
}

import { isCodexBaseUrl } from './providerConfig.js'

type CredentialReaders = {
  readCodex?: () => { accessToken: string; accountId?: string } | undefined
}

export function enrichWithStoredCredentials(
  rp: ResolvedProvider,
  readers: CredentialReaders = {},
): ResolvedProvider {
  if (rp.baseURL && isCodexBaseUrl(rp.baseURL) && readers.readCodex) {
    const cred = readers.readCodex()
    if (cred?.accessToken) {
      return { ...rp, oauthAccessToken: cred.accessToken }
    }
  }
  return rp
}
