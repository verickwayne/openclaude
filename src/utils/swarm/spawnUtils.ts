/**
 * Shared utilities for spawning teammates across different backends.
 */

import {
  getChromeFlagOverride,
  getFlagSettingsPath,
  getInlinePlugins,
  getMainLoopModelOverride,
  getSessionBypassPermissionsMode,
} from '../../bootstrap/state.js'
import type { ResolvedProvider } from '../../services/api/resolvedProvider.js'
import { quote } from '../bash/shellQuote.js'
import { isInBundledMode } from '../bundledMode.js'
import type { PermissionMode } from '../permissions/PermissionMode.js'
import { getTeammateModeFromSnapshot } from './backends/teammateModeSnapshot.js'
import { TEAMMATE_COMMAND_ENV_VAR } from './constants.js'

/**
 * Gets the command to use for spawning teammate processes.
 * Uses TEAMMATE_COMMAND_ENV_VAR if set, otherwise falls back to the
 * current process executable path.
 */
export function getTeammateCommand(): string {
  if (process.env[TEAMMATE_COMMAND_ENV_VAR]) {
    return process.env[TEAMMATE_COMMAND_ENV_VAR]
  }
  return isInBundledMode() ? process.execPath : process.argv[1]!
}

/**
 * Builds CLI flags to propagate from the current session to spawned teammates.
 * This ensures teammates inherit important settings like permission mode,
 * model selection, and plugin configuration from their parent.
 *
 * @param options.planModeRequired - If true, don't inherit bypass permissions (plan mode takes precedence)
 * @param options.permissionMode - Permission mode to propagate
 */
export function buildInheritedCliFlags(options?: {
  planModeRequired?: boolean
  permissionMode?: PermissionMode
}): string {
  const flags: string[] = []
  const { planModeRequired, permissionMode } = options || {}

  // Propagate permission mode to teammates, but NOT if plan mode is required
  // Plan mode takes precedence over bypass permissions for safety
  if (planModeRequired) {
    // Don't inherit bypass permissions when plan mode is required
  } else if (
    permissionMode === 'bypassPermissions' ||
    getSessionBypassPermissionsMode()
  ) {
    flags.push('--dangerously-skip-permissions')
  } else if (permissionMode === 'acceptEdits') {
    flags.push('--permission-mode acceptEdits')
  }

  // Propagate --model if explicitly set via CLI
  const modelOverride = getMainLoopModelOverride()
  if (modelOverride) {
    flags.push(`--model ${quote([modelOverride])}`)
  }

  // Propagate --settings if set via CLI
  const settingsPath = getFlagSettingsPath()
  if (settingsPath) {
    flags.push(`--settings ${quote([settingsPath])}`)
  }

  // Propagate --plugin-dir for each inline plugin
  const inlinePlugins = getInlinePlugins()
  for (const pluginDir of inlinePlugins) {
    flags.push(`--plugin-dir ${quote([pluginDir])}`)
  }

  // Propagate --teammate-mode so tmux teammates use the same mode as leader
  const sessionMode = getTeammateModeFromSnapshot()
  flags.push(`--teammate-mode ${sessionMode}`)

  // Propagate --chrome / --no-chrome if explicitly set on the CLI
  const chromeFlagOverride = getChromeFlagOverride()
  if (chromeFlagOverride === true) {
    flags.push('--chrome')
  } else if (chromeFlagOverride === false) {
    flags.push('--no-chrome')
  }

  return flags.join(' ')
}

/**
 * Environment variables that must be explicitly forwarded to tmux-spawned
 * teammates. Tmux may start a new login shell that doesn't inherit the
 * parent's env, so we forward any that are set in the current process.
 */
const TEAMMATE_ENV_VARS = [
  // API provider selection — without these, teammates default to firstParty
  // and send requests to the wrong endpoint (GitHub issue #23561)
  'CLAUDE_CODE_USE_BEDROCK',
  'CLAUDE_CODE_USE_VERTEX',
  'CLAUDE_CODE_USE_FOUNDRY',
  'CLAUDE_CODE_USE_GITHUB',
  'CLAUDE_CODE_USE_GEMINI',
  'CLAUDE_CODE_USE_MISTRAL',
  'CLAUDE_CODE_USE_OPENAI',
  'GITHUB_TOKEN',
  'GH_TOKEN',
  'OPENAI_API_KEY',
  'OPENAI_BASE_URL',
  'OPENAI_MODEL',
  'GEMINI_API_KEY',
  'GEMINI_BASE_URL',
  'GEMINI_MODEL',
  'GOOGLE_API_KEY',
  'MISTRAL_API_KEY',
  'MISTRAL_MODEL',
  'MISTRAL_BASE_URL',
  // Custom API endpoint
  'ANTHROPIC_BASE_URL',
  // Config directory override
  'CLAUDE_CONFIG_DIR',
  // CCR marker — teammates need this for CCR-aware code paths. Auth finds
  // its own way via /home/claude/.claude/remote/.oauth_token regardless;
  // the FD env var wouldn't help (pipe FDs don't cross tmux).
  'CLAUDE_CODE_REMOTE',
  // Auto-memory gate (memdir/paths.ts) checks REMOTE && !MEMORY_DIR to
  // disable memory on ephemeral CCR filesystems. Forwarding REMOTE alone
  // would flip teammates to memory-off when the parent has it on.
  'CLAUDE_CODE_REMOTE_MEMORY_DIR',
  // Upstream proxy — the parent's MITM relay is reachable from teammates
  // (same container network). Forward the proxy vars so teammates route
  // customer-configured upstream traffic through the relay for credential
  // injection. Without these, teammates bypass the proxy entirely.
  'HTTPS_PROXY',
  'https_proxy',
  'HTTP_PROXY',
  'http_proxy',
  'NO_PROXY',
  'no_proxy',
  'SSL_CERT_FILE',
  'NODE_EXTRA_CA_CERTS',
  'REQUESTS_CA_BUNDLE',
  'CURL_CA_BUNDLE',
  // Source builds may rely on user shell PATH for rg/node/bun and other tools.
  // Forward it so teammates resolve the same toolchain as the parent session.
  'PATH',
] as const

/**
 * Provider-selection env keys. When a per-teammate provider override is
 * supplied to buildInheritedEnvVars, the parent's values for these keys are
 * NOT forwarded — the override's own values (from buildTeammateProviderEnv)
 * replace them so the teammate routes to its own provider.
 */
const PROVIDER_ENV_KEYS = new Set<string>([
  'CLAUDE_CODE_USE_BEDROCK',
  'CLAUDE_CODE_USE_VERTEX',
  'CLAUDE_CODE_USE_FOUNDRY',
  'CLAUDE_CODE_USE_GITHUB',
  'CLAUDE_CODE_USE_GEMINI',
  'CLAUDE_CODE_USE_MISTRAL',
  'CLAUDE_CODE_USE_OPENAI',
  'OPENAI_API_KEY',
  'OPENAI_BASE_URL',
  'OPENAI_MODEL',
  'OPENAI_API_FORMAT',
  'OPENAI_AUTH_HEADER',
  'OPENAI_AUTH_HEADER_VALUE',
  'GEMINI_API_KEY',
  'GEMINI_BASE_URL',
  'GEMINI_MODEL',
  'GOOGLE_API_KEY',
  'MISTRAL_API_KEY',
  'MISTRAL_MODEL',
  'MISTRAL_BASE_URL',
  'ANTHROPIC_BASE_URL',
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_MODEL',
])

/**
 * Builds the provider-selection env for a single teammate from a
 * ResolvedProvider. Returns a plain env map (not a shell string) so callers
 * can merge or inspect it. ResolvedProvider carries CAPITAL `baseURL`.
 */
export function buildTeammateProviderEnv(
  rp: ResolvedProvider,
): NodeJS.ProcessEnv {
  if (rp.kind === 'openai-compatible' || rp.kind === 'gemini') {
    return {
      CLAUDE_CODE_USE_OPENAI: '1',
      OPENAI_BASE_URL: rp.baseURL ?? '',
      OPENAI_API_KEY: rp.apiKey ?? '',
      OPENAI_MODEL: rp.model,
      ...(rp.apiFormat ? { OPENAI_API_FORMAT: rp.apiFormat } : {}),
      ...(rp.authHeader ? { OPENAI_AUTH_HEADER: rp.authHeader } : {}),
      ...(rp.authHeaderValue
        ? { OPENAI_AUTH_HEADER_VALUE: rp.authHeaderValue }
        : {}),
    }
  }
  // anthropic-native / anthropic-proxy / bedrock / vertex
  return {
    ANTHROPIC_MODEL: rp.model,
    ...(rp.baseURL ? { ANTHROPIC_BASE_URL: rp.baseURL } : {}),
    ...(rp.apiKey ? { ANTHROPIC_API_KEY: rp.apiKey } : {}),
  }
}

/**
 * Builds the `env KEY=VALUE ...` string for teammate spawn commands.
 * Always includes CLAUDECODE=1 and CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1,
 * plus any provider/config env vars that are set in the current process.
 *
 * When `options.teammateOverride` is supplied, the parent's provider-selection
 * env (CLAUDE_CODE_USE_* / OPENAI_* / ANTHROPIC_* / GEMINI_* / MISTRAL_*) is
 * replaced by the override's own provider env, so the teammate can run on a
 * different provider than its parent. The host-managed marker is preserved.
 */
export function buildInheritedEnvVars(options?: {
  teammateOverride?: ResolvedProvider
}): string {
  const { teammateOverride } = options || {}

  const envVars = [
    'CLAUDECODE=1',
    'CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1',
    // Teammates should inherit the leader-selected provider route instead of
    // replaying persisted ~/.claude or settings.env provider defaults.
    'CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST=1',
  ]

  for (const key of TEAMMATE_ENV_VARS) {
    // When overriding the teammate's provider, skip the parent's
    // provider-selection vars; the override supplies its own below.
    if (teammateOverride && PROVIDER_ENV_KEYS.has(key)) {
      continue
    }
    const value = process.env[key]
    if (value !== undefined && value !== '') {
      envVars.push(`${key}=${quote([value])}`)
    }
  }

  if (teammateOverride) {
    const overrideEnv = buildTeammateProviderEnv(teammateOverride)
    for (const [key, value] of Object.entries(overrideEnv)) {
      if (value !== undefined && value !== '') {
        envVars.push(`${key}=${quote([value])}`)
      }
    }
  }

  return envVars.join(' ')
}
