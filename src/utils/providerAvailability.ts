import type { ProviderProfile } from './config.js'
import { getClaudeAIOAuthTokens } from './auth.js'
import { readCodexCredentials } from './codexCredentials.js'
import { parseModelList } from './providerModels.js'
import { getRouteDescriptor, resolveProfileRoute } from '../integrations/index.js'
import { resolveRouteCredentialValue } from '../integrations/routeMetadata.js'
import { isCodexBaseUrl } from '../services/api/providerConfig.js'

/**
 * Injectable dependencies for {@link isProviderAvailable}. Each function
 * isolates a side-effecting lookup (route resolution, credential storage)
 * so the availability decision itself stays a pure, testable function.
 */
export type ProviderAvailabilityDeps = {
  resolveRouteId: (profile: ProviderProfile) => string
  isLocalRoute: (routeId: string) => boolean
  isOAuthRoute: (routeId: string) => boolean
  isCodexProfile: (profile: ProviderProfile) => boolean
  hasClaudeOAuth: () => boolean
  hasCodexCredentials: () => boolean
  getRouteCredential: (profile: ProviderProfile, routeId: string) => string | undefined
}

function routeIdForProfile(profile: ProviderProfile): string {
  return resolveProfileRoute(profile.provider).routeId
}

/**
 * Local routes (ollama, lmstudio, atomic-chat, …) declare
 * `setup.requiresAuth: false` / `authMode: 'none'`. They are reachable
 * without any stored credential, so a configured profile is always usable.
 */
function isLocalRoute(routeId: string): boolean {
  const descriptor = getRouteDescriptor(routeId)
  if (!descriptor) {
    return false
  }
  const setup = descriptor.setup
  return setup?.requiresAuth === false || setup?.authMode === 'none'
}

/**
 * Routes whose credentials are stored as OAuth rather than an apiKey field
 * (e.g. claude-max-proxy). Detected via the descriptor's declared auth mode.
 */
function isOAuthRoute(routeId: string): boolean {
  return getRouteDescriptor(routeId)?.setup?.authMode === 'oauth'
}

function isCodexProfile(profile: ProviderProfile): boolean {
  return isCodexBaseUrl(profile.baseUrl)
}

function hasClaudeOAuth(): boolean {
  return Boolean(getClaudeAIOAuthTokens()?.accessToken)
}

function hasCodexCredentials(): boolean {
  const credentials = readCodexCredentials()
  return Boolean(
    credentials?.apiKey ||
      credentials?.accessToken ||
      credentials?.refreshToken ||
      credentials?.idToken,
  )
}

function getRouteCredential(
  profile: ProviderProfile,
  routeId: string,
): string | undefined {
  return resolveRouteCredentialValue({
    routeId,
    baseUrl: profile.baseUrl,
    activeProfileProvider: profile.provider,
  })
}

const defaultAvailabilityDeps: ProviderAvailabilityDeps = {
  resolveRouteId: routeIdForProfile,
  isLocalRoute,
  isOAuthRoute,
  isCodexProfile,
  hasClaudeOAuth,
  hasCodexCredentials,
  getRouteCredential,
}

/**
 * True when a profile has usable credentials and can therefore serve
 * requests this session: an explicit apiKey, a local route that needs none,
 * or stored OAuth for the route's kind (Claude Max / Codex).
 */
export function isProviderAvailable(
  profile: ProviderProfile,
  deps: ProviderAvailabilityDeps = defaultAvailabilityDeps,
): boolean {
  if (profile.apiKey && profile.apiKey.trim().length > 0) {
    return true
  }

  const routeId = deps.resolveRouteId(profile)

  if (deps.getRouteCredential(profile, routeId)) {
    return true
  }

  if (deps.isLocalRoute(routeId)) {
    return true
  }

  if (deps.isCodexProfile(profile)) {
    return deps.hasCodexCredentials()
  }

  if (deps.isOAuthRoute(routeId)) {
    return deps.hasClaudeOAuth()
  }

  return false
}

/**
 * Parses a user-entered list of model IDs separated by commas and/or
 * newlines. Trims each entry, drops blanks, and dedupes preserving the
 * first-seen order.
 */
export function parseModelInput(input: string): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const part of input.split(/[\n,]/)) {
    const trimmed = part.trim()
    if (trimmed.length === 0 || seen.has(trimmed)) {
      continue
    }
    seen.add(trimmed)
    result.push(trimmed)
  }
  return result
}

/**
 * Appends new model IDs to a profile's comma-separated `model` field,
 * deduping against models already present and within the incoming list.
 * Returns the normalized, comma-joined field.
 */
export function appendModelsToModelField(
  existingModelField: string,
  newModels: string[],
): string {
  const merged: string[] = []
  const seen = new Set<string>()
  for (const model of [...parseModelList(existingModelField), ...newModels]) {
    const trimmed = model.trim()
    if (trimmed.length === 0 || seen.has(trimmed)) {
      continue
    }
    seen.add(trimmed)
    merged.push(trimmed)
  }
  return merged.join(', ')
}
