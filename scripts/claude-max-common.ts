import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  checkAndRefreshOAuthTokenIfNeeded,
  clearOAuthTokenCache,
  getClaudeAIOAuthTokens,
} from '../src/utils/auth.js'
import { getClaudeConfigHomeDir } from '../src/utils/envUtils.js'

const SCRIPTS_DIR = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(SCRIPTS_DIR, '..')
const DEFAULT_OVERLAY_ROOT = resolve(
  REPO_ROOT,
  '../research/ClaudeMax-OAuth-Overlay',
)
const DEFAULT_PROXY_BASE_URL = 'http://127.0.0.1:8031'

export function resolveClaudeMaxOverlayRoot(
  processEnv: NodeJS.ProcessEnv = process.env,
): string {
  const explicit = processEnv.CLAUDE_MAX_OVERLAY_ROOT?.trim()
  return explicit ? resolve(explicit) : DEFAULT_OVERLAY_ROOT
}

export function resolveClaudeMaxProxyScriptPath(
  processEnv: NodeJS.ProcessEnv = process.env,
): string {
  return join(resolveClaudeMaxOverlayRoot(processEnv), 'proxy', 'server.py')
}

export function resolveClaudeMaxProxyBaseUrl(
  processEnv: NodeJS.ProcessEnv = process.env,
): string {
  return (
    processEnv.CLAUDE_MAX_PROXY_BASE_URL?.trim() ||
    processEnv.ANTHROPIC_BASE_URL?.trim() ||
    DEFAULT_PROXY_BASE_URL
  )
}

export function resolveClaudeMaxProxyModel(
  processEnv: NodeJS.ProcessEnv = process.env,
): string {
  return processEnv.ANTHROPIC_MODEL?.trim() || 'claude-sonnet-4-5'
}

export function resolveClaudeMaxProxyBindConfig(
  baseUrl: string,
): { host: string; port: string } {
  const parsed = new URL(baseUrl)
  if (
    parsed.pathname !== '/' &&
    parsed.pathname !== ''
  ) {
    throw new Error(
      `Claude Max proxy base URL must not include a path: ${baseUrl}`,
    )
  }
  if (parsed.protocol !== 'http:') {
    throw new Error(
      `Claude Max proxy base URL must use http:// for the local proxy: ${baseUrl}`,
    )
  }
  return {
    host: parsed.hostname,
    port: parsed.port || '80',
  }
}

export function buildClaudeMaxProxyProcessEnv(
  processEnv: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const baseUrl = resolveClaudeMaxProxyBaseUrl(processEnv)
  const bind = resolveClaudeMaxProxyBindConfig(baseUrl)
  return {
    ...processEnv,
    CLAUDE_CONFIG_DIR:
      processEnv.CLAUDE_CONFIG_DIR?.trim() || getClaudeConfigHomeDir(),
    CLAUDE_MAX_PROXY_HOST: bind.host,
    CLAUDE_MAX_PROXY_PORT: bind.port,
  }
}

export function getClaudeMaxProxyStdio(): ['ignore', 'inherit', 'inherit'] {
  return ['ignore', 'inherit', 'inherit']
}

export async function ensureClaudeMaxLoginReady(): Promise<void> {
  clearOAuthTokenCache()
  await checkAndRefreshOAuthTokenIfNeeded()
  const tokens = getClaudeAIOAuthTokens()
  if (!tokens?.accessToken || !tokens.refreshToken) {
    throw new Error(
      'Claude.ai OAuth login is missing. Run `limitless auth login --claudeai` before launching the Claude Max proxy.',
    )
  }
}

export async function isClaudeMaxProxyHealthy(
  baseUrl: string,
): Promise<boolean> {
  try {
    const response = await fetch(new URL('/health', baseUrl), {
      method: 'GET',
    })
    if (!response.ok) {
      return false
    }
    const payload = (await response.json()) as { ok?: boolean }
    return payload.ok === true
  } catch {
    return false
  }
}

export async function waitForClaudeMaxProxyHealthy(
  baseUrl: string,
  options?: {
    attempts?: number
    delayMs?: number
  },
): Promise<boolean> {
  const attempts = options?.attempts ?? 40
  const delayMs = options?.delayMs ?? 250

  for (let index = 0; index < attempts; index += 1) {
    if (await isClaudeMaxProxyHealthy(baseUrl)) {
      return true
    }
    await new Promise(resolve => setTimeout(resolve, delayMs))
  }

  return false
}

export function assertClaudeMaxOverlayAvailable(
  processEnv: NodeJS.ProcessEnv = process.env,
): void {
  const overlayRoot = resolveClaudeMaxOverlayRoot(processEnv)
  const proxyScript = resolveClaudeMaxProxyScriptPath(processEnv)

  if (!existsSync(overlayRoot)) {
    throw new Error(
      `Claude Max overlay repo not found at ${overlayRoot}. Set CLAUDE_MAX_OVERLAY_ROOT if it lives elsewhere.`,
    )
  }

  if (!existsSync(proxyScript)) {
    throw new Error(
      `Claude Max proxy entrypoint not found at ${proxyScript}.`,
    )
  }
}
