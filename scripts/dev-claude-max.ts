#!/usr/bin/env bun

import { spawn, type ChildProcess } from 'node:child_process'
import { delimiter } from 'node:path'

import {
  assertClaudeMaxOverlayAvailable,
  buildClaudeMaxProxyProcessEnv,
  ensureClaudeMaxLoginReady,
  getClaudeMaxProxyStdio,
  isClaudeMaxProxyHealthy,
  resolveClaudeMaxOverlayRoot,
  resolveClaudeMaxProxyBaseUrl,
  resolveClaudeMaxProxyModel,
  waitForClaudeMaxProxyHealthy,
} from './claude-max-common.ts'

const EXPLICIT_PERMISSION_MODE_FLAGS = new Set([
  '--permission-mode',
  '--dangerously-skip-permissions',
  '--allow-dangerously-skip-permissions',
  '--enable-auto-mode',
  '--dangerously-skip-permissions-with-classifiers',
])

function buildLaunchEnv(): NodeJS.ProcessEnv {
  const env = {
    ...process.env,
    ...buildClaudeMaxProxyProcessEnv(),
    CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST: '1',
    ANTHROPIC_BASE_URL: resolveClaudeMaxProxyBaseUrl(),
    ANTHROPIC_MODEL: resolveClaudeMaxProxyModel(),
  }

  delete env.CLAUDE_CODE_USE_OPENAI
  delete env.OPENAI_BASE_URL
  delete env.OPENAI_API_BASE
  delete env.OPENAI_API_KEY
  delete env.OPENAI_MODEL
  delete env.OPENAI_API_FORMAT
  delete env.OPENAI_AUTH_HEADER
  delete env.OPENAI_AUTH_SCHEME
  delete env.OPENAI_AUTH_HEADER_VALUE
  delete env.ANTHROPIC_API_KEY
  delete env.ANTHROPIC_AUTH_TOKEN

  return env
}

export function buildOpenClaudeCliArgs(
  passthroughArgs: string[],
): string[] {
  const hasExplicitPermissionMode = passthroughArgs.some(arg =>
    EXPLICIT_PERMISSION_MODE_FLAGS.has(arg) ||
    arg.startsWith('--permission-mode='),
  )

  if (hasExplicitPermissionMode) {
    return passthroughArgs
  }

  return ['--permission-mode', 'default', ...passthroughArgs]
}

function runProcess(
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv,
): Promise<number> {
  return new Promise(resolve => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      env,
      stdio: 'inherit',
    })

    child.on('close', code => resolve(code ?? 1))
    child.on('error', () => resolve(1))
  })
}

async function ensureProxyRunning(): Promise<{
  child: ChildProcess | null
  baseUrl: string
}> {
  const baseUrl = resolveClaudeMaxProxyBaseUrl()
  if (await isClaudeMaxProxyHealthy(baseUrl)) {
    return { child: null, baseUrl }
  }

  const pythonExecutable =
    process.env.CLAUDE_MAX_PROXY_PYTHON?.trim() || 'python3'
  const overlayRoot = resolveClaudeMaxOverlayRoot()
  const child = spawn(
    pythonExecutable,
    ['-c', 'from proxy.server import main; raise SystemExit(main())'],
    {
      cwd: overlayRoot,
      env: {
        ...buildClaudeMaxProxyProcessEnv(),
        CLAUDE_MAX_PROXY_QUIET: process.env.CLAUDE_MAX_PROXY_QUIET ?? '1',
        PYTHONPATH: [overlayRoot, process.env.PYTHONPATH?.trim()]
          .filter(Boolean)
          .join(delimiter),
      },
      stdio: getClaudeMaxProxyStdio(),
    },
  )

  child.on('error', error => {
    console.error(
      `Failed to start Claude Max proxy with ${pythonExecutable}: ${error.message}`,
    )
  })

  const healthy = await waitForClaudeMaxProxyHealthy(baseUrl)
  if (!healthy) {
    child.kill('SIGTERM')
    throw new Error(
      `Claude Max proxy did not become healthy at ${baseUrl}.`,
    )
  }

  return { child, baseUrl }
}

async function main(): Promise<void> {
  assertClaudeMaxOverlayAvailable()
  await ensureClaudeMaxLoginReady()

  const launchEnv = buildLaunchEnv()
  const { child: proxyChild, baseUrl } = await ensureProxyRunning()

  const cleanup = (): void => {
    if (proxyChild && !proxyChild.killed) {
      proxyChild.kill('SIGTERM')
    }
  }

  process.on('SIGINT', cleanup)
  process.on('SIGTERM', cleanup)
  process.on('exit', cleanup)

  try {
    console.log(`Claude Max proxy ready at ${baseUrl}`)

    const doctorCode = await runProcess(
      'bun',
      ['run', 'scripts/system-check.ts'],
      launchEnv,
    )
    if (doctorCode !== 0) {
      process.exit(doctorCode)
    }

    const buildCode = await runProcess('bun', ['run', 'build'], launchEnv)
    if (buildCode !== 0) {
      process.exit(buildCode)
    }

    const cliCode = await runProcess(
      'node',
      ['dist/cli.mjs', ...buildOpenClaudeCliArgs(process.argv.slice(2))],
      launchEnv,
    )
    process.exit(cliCode)
  } finally {
    cleanup()
  }
}

void main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
