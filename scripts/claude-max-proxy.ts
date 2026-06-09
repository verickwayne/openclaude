#!/usr/bin/env bun

import { spawn } from 'node:child_process'
import { delimiter } from 'node:path'

import {
  assertClaudeMaxOverlayAvailable,
  buildClaudeMaxProxyProcessEnv,
  getClaudeMaxProxyStdio,
  resolveClaudeMaxOverlayRoot,
} from './claude-max-common.ts'

function main(): void {
  assertClaudeMaxOverlayAvailable()

  const overlayRoot = resolveClaudeMaxOverlayRoot()
  const pythonExecutable =
    process.env.CLAUDE_MAX_PROXY_PYTHON?.trim() || 'python3'

  const child = spawn(
    pythonExecutable,
    ['-c', 'from proxy.server import main; raise SystemExit(main())'],
    {
      cwd: overlayRoot,
      env: {
        ...buildClaudeMaxProxyProcessEnv(),
        PYTHONPATH: [overlayRoot, process.env.PYTHONPATH?.trim()]
          .filter(Boolean)
          .join(delimiter),
      },
      stdio: getClaudeMaxProxyStdio(),
    },
  )

  child.on('exit', code => {
    process.exit(code ?? 0)
  })

  child.on('error', error => {
    console.error(
      `Failed to start Claude Max proxy with ${pythonExecutable}: ${error.message}`,
    )
    process.exit(1)
  })
}

main()
