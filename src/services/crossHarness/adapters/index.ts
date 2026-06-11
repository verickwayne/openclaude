import type { HarnessAdapter, HarnessId } from '../harnessTypes.js'
import { claudeAdapter } from './claudeAdapter.js'
import { codexAdapter } from './codexAdapter.js'
import { genericAdapter } from './genericAdapter.js'

/** Resolve the reconstruction adapter for a discovered transcript's harness. */
export function adapterFor(harness: HarnessId): HarnessAdapter {
  switch (harness) {
    case 'limitless':
    case 'claude':
      return claudeAdapter
    case 'codex':
      return codexAdapter
    default:
      return genericAdapter
  }
}

export { claudeAdapter, codexAdapter, genericAdapter }
