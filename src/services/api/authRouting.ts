import {
  type APIProvider,
  getAPIProvider,
  isFirstPartyAnthropicBaseUrl,
} from 'src/utils/model/providers.js'
import {
  getRouteDescriptor,
  resolveActiveRouteIdFromEnv,
} from '../../integrations/routeMetadata.js'

import type { ResolvedProvider } from './resolvedProvider.js'

// Back-compat alias: the per-request override carrier is now ResolvedProvider.
export type ProviderOverride = ResolvedProvider

export function shouldUseFirstPartyAnthropicAuthForProvider({
  providerOverride,
  apiProvider,
  isFirstPartyBaseUrl,
  routeId,
}: {
  providerOverride?: ProviderOverride
  apiProvider: APIProvider
  isFirstPartyBaseUrl?: boolean
  routeId?: string | null
}): boolean {
  if (providerOverride) {
    // Anthropic-native/proxy overrides still authenticate as Anthropic;
    // every other override kind is third-party and must not.
    return (
      providerOverride.kind === 'anthropic-native' ||
      providerOverride.kind === 'anthropic-proxy'
    )
  }
  if (apiProvider !== 'firstParty') {
    return false
  }

  if (routeId) {
    const descriptor = getRouteDescriptor(routeId)
    return (
      routeId === 'anthropic' ||
      (
        descriptor?.transportConfig.kind === 'anthropic-proxy' &&
        descriptor.setup.authMode === 'oauth'
      )
    )
  }

  return isFirstPartyBaseUrl === true
}

export function shouldUseFirstPartyAnthropicAuth(
  providerOverride?: ProviderOverride,
): boolean {
  return shouldUseFirstPartyAnthropicAuthForProvider({
    providerOverride,
    apiProvider: getAPIProvider(),
    isFirstPartyBaseUrl: isFirstPartyAnthropicBaseUrl(),
    routeId: resolveActiveRouteIdFromEnv(process.env),
  })
}
