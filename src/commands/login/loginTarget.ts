/**
 * Resolves which login flow /login should initiate based on the active
 * provider. Subscription providers (Anthropic via the Claude Max OAuth
 * proxy, OpenAI via ChatGPT/Codex OAuth) get real sign-in flows; local
 * providers get a model refresh; API-key providers are pointed at
 * /provider.
 */

import { isCodexBaseUrl } from '../../services/api/providerConfig.js'
import {
  getRouteDescriptor,
  getRouteLabel,
  resolveActiveRouteIdFromEnv,
} from '../../integrations/routeMetadata.js'
import { getActiveProviderProfile } from '../../utils/providerProfiles.js'
import { isEnvTruthy } from '../../utils/envUtils.js'

export type LoginTarget =
  | { kind: 'anthropic' }
  | { kind: 'claude-max'; proxyBaseUrl?: string }
  | { kind: 'codex' }
  | { kind: 'local'; routeId: string; label: string }
  | { kind: 'api-key-provider'; label: string }

export function resolveLoginTarget(
  processEnv: NodeJS.ProcessEnv = process.env,
  options?: {
    /** Test seam — defaults to the active profile from global config. */
    activeProfileProvider?: string | null
  },
): LoginTarget {
  // OpenAI subscription (ChatGPT/Codex OAuth) rides the OpenAI-compat env
  // with the chatgpt.com backend base URL or an oauth credential source.
  if (isEnvTruthy(processEnv.CLAUDE_CODE_USE_OPENAI)) {
    const baseUrl = processEnv.OPENAI_BASE_URL ?? processEnv.OPENAI_API_BASE
    if (
      processEnv.CODEX_CREDENTIAL_SOURCE === 'oauth' ||
      isCodexBaseUrl(baseUrl)
    ) {
      return { kind: 'codex' }
    }
  }

  const activeProfileProvider =
    options && 'activeProfileProvider' in options
      ? (options.activeProfileProvider ?? undefined)
      : getActiveProviderProfile()?.provider
  const routeId = resolveActiveRouteIdFromEnv(processEnv, {
    activeProfileProvider,
  })

  if (!routeId || routeId === 'anthropic') {
    return { kind: 'anthropic' }
  }

  const descriptor = getRouteDescriptor(routeId)
  const transportKind = descriptor?.transportConfig.kind

  if (transportKind === 'anthropic-proxy') {
    return {
      kind: 'claude-max',
      proxyBaseUrl: processEnv.ANTHROPIC_BASE_URL?.trim() || undefined,
    }
  }

  if (transportKind === 'local') {
    return {
      kind: 'local',
      routeId,
      label: getRouteLabel(routeId) ?? routeId,
    }
  }

  return {
    kind: 'api-key-provider',
    label: getRouteLabel(routeId) ?? 'The active provider',
  }
}
