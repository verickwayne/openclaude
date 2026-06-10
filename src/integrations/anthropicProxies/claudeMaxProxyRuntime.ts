/**
 * Runtime auto-start for the local Claude Max OAuth overlay proxy.
 *
 * The claude-max-proxy route points ANTHROPIC_BASE_URL at a local proxy
 * (default http://127.0.0.1:8031) that re-signs requests with the stored
 * Claude.ai OAuth login instead of an API key. If that proxy isn't running,
 * every request fails with ECONNREFUSED. This module makes the harness
 * start the proxy on demand (at startup and after /login) so the user never
 * has to launch it in a second terminal.
 *
 * The overlay itself lives outside this repo
 * (default ~/Projects/research/ClaudeMax-OAuth-Overlay, overridable via
 * CLAUDE_MAX_OVERLAY_ROOT). When it's absent we degrade gracefully with an
 * actionable message rather than throwing.
 */

import { spawn, spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { delimiter, join, resolve } from 'node:path'
import { homedir } from 'node:os'

import { getClaudeConfigHomeDir } from '../../utils/envUtils.js'
import { logForDebugging } from '../../utils/debug.js'
import { logError } from '../../utils/log.js'

const DEFAULT_PROXY_BASE_URL = 'http://127.0.0.1:8031'

export type EnsureProxyResult =
  | { status: 'already-running' }
  | { status: 'started' }
  | { status: 'overlay-missing'; overlayRoot: string }
  | { status: 'missing-curl-cffi'; python: string }
  | { status: 'unhealthy'; baseUrl: string }
  | { status: 'error'; message: string }

/**
 * Check whether a Python interpreter has a given module importable.
 * Uses spawnSync with a short timeout; returns false on any failure.
 */
export function pythonHasModule(
  python: string,
  moduleName: string,
  timeoutMs = 5_000,
): boolean {
  const result = spawnSync(python, ['-c', `import ${moduleName}`], {
    timeout: timeoutMs,
    stdio: 'ignore',
  })
  return result.status === 0
}

export function resolveOverlayRoot(
  processEnv: NodeJS.ProcessEnv = process.env,
): string {
  const explicit = processEnv.CLAUDE_MAX_OVERLAY_ROOT?.trim()
  if (explicit) return resolve(explicit)
  return resolve(homedir(), 'Projects/research/ClaudeMax-OAuth-Overlay')
}

export function resolveProxyBaseUrl(
  processEnv: NodeJS.ProcessEnv = process.env,
): string {
  return (
    processEnv.CLAUDE_MAX_PROXY_BASE_URL?.trim() ||
    processEnv.ANTHROPIC_BASE_URL?.trim() ||
    DEFAULT_PROXY_BASE_URL
  )
}

export async function isProxyHealthy(
  baseUrl: string,
  timeoutMs = 1500,
): Promise<boolean> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(new URL('/health', baseUrl), {
      method: 'GET',
      signal: controller.signal,
    })
    if (!response.ok) return false
    const payload = (await response.json()) as { ok?: boolean }
    return payload.ok === true
  } catch {
    return false
  } finally {
    clearTimeout(timer)
  }
}

async function waitForHealthy(
  baseUrl: string,
  options: { attempts: number; delayMs: number },
): Promise<boolean> {
  for (let i = 0; i < options.attempts; i += 1) {
    if (await isProxyHealthy(baseUrl)) return true
    await new Promise(r => setTimeout(r, options.delayMs))
  }
  return false
}

function resolveBind(baseUrl: string): { host: string; port: string } {
  const parsed = new URL(baseUrl)
  return { host: parsed.hostname, port: parsed.port || '80' }
}

/**
 * Ensure the Claude Max overlay proxy is reachable, starting it if needed.
 * Idempotent: a healthy proxy short-circuits immediately. The spawned
 * process is detached and unref'd so it outlives this CLI invocation (the
 * proxy is shared state, not owned by one session).
 */
export async function ensureClaudeMaxProxyRunning(options?: {
  processEnv?: NodeJS.ProcessEnv
  startupTimeoutMs?: number
}): Promise<EnsureProxyResult> {
  const processEnv = options?.processEnv ?? process.env
  const baseUrl = resolveProxyBaseUrl(processEnv)

  if (await isProxyHealthy(baseUrl)) {
    return { status: 'already-running' }
  }

  const overlayRoot = resolveOverlayRoot(processEnv)
  const proxyEntry = join(overlayRoot, 'proxy', 'server.py')
  if (!existsSync(overlayRoot) || !existsSync(proxyEntry)) {
    return { status: 'overlay-missing', overlayRoot }
  }

  const bind = resolveBind(baseUrl)
  const python = processEnv.CLAUDE_MAX_PROXY_PYTHON?.trim() || 'python3'

  if (!pythonHasModule(python, 'curl_cffi')) {
    return { status: 'missing-curl-cffi', python }
  }

  try {
    const child = spawn(
      python,
      ['-c', 'from proxy.server import main; raise SystemExit(main())'],
      {
        cwd: overlayRoot,
        env: {
          ...processEnv,
          CLAUDE_CONFIG_DIR:
            processEnv.CLAUDE_CONFIG_DIR?.trim() || getClaudeConfigHomeDir(),
          CLAUDE_MAX_PROXY_HOST: bind.host,
          CLAUDE_MAX_PROXY_PORT: bind.port,
          PYTHONPATH: [overlayRoot, processEnv.PYTHONPATH?.trim()]
            .filter(Boolean)
            .join(delimiter),
        },
        detached: true,
        stdio: 'ignore',
      },
    )
    child.on('error', error => {
      logError(error)
    })
    child.unref()
  } catch (error) {
    return { status: 'error', message: (error as Error).message }
  }

  const timeoutMs = options?.startupTimeoutMs ?? 10_000
  const attempts = Math.max(1, Math.round(timeoutMs / 250))
  const healthy = await waitForHealthy(baseUrl, { attempts, delayMs: 250 })

  if (!healthy) {
    return { status: 'unhealthy', baseUrl }
  }

  logForDebugging(`Claude Max overlay proxy is ready at ${baseUrl}`)
  return { status: 'started' }
}

/**
 * One-line, user-facing summary of an ensure result. Returns null when there
 * is nothing worth surfacing (proxy was already up or just started cleanly).
 */
export function describeEnsureResult(result: EnsureProxyResult): string | null {
  switch (result.status) {
    case 'already-running':
    case 'started':
      return null
    case 'overlay-missing':
      return `Claude Max proxy could not start: overlay not found at ${result.overlayRoot}. Clone it there or set CLAUDE_MAX_OVERLAY_ROOT, then retry.`
    case 'missing-curl-cffi':
      return `Claude Max proxy cannot start: Python '${result.python}' is missing curl_cffi (required for TLS impersonation — without it Anthropic rejects requests with 404). Install it: ${result.python} -m pip install 'curl_cffi>=0.7' httpx`
    case 'unhealthy':
      return `Claude Max proxy was launched but is not responding at ${result.baseUrl}. Check the overlay logs (bun run claude-max:proxy in the OpenClaude repo runs it in the foreground).`
    case 'error':
      return `Claude Max proxy could not start: ${result.message}`
  }
}
