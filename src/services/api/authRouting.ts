import {
  type APIProvider,
  getAPIProvider,
  isFirstPartyAnthropicBaseUrl,
} from 'src/utils/model/providers.js'
import {
  getRouteDescriptor,
  resolveActiveRouteIdFromEnv,
} from '../../integrations/routeMetadata.js'

export type ProviderOverride = { model: string; baseURL: string; apiKey: string }

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
  if (providerOverride || apiProvider !== 'firstParty') {
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
