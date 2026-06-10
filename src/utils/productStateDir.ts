import { existsSync } from 'fs'
import { join } from 'path'

// Product state directory rebrand: the canonical name is `.limitless`. The
// previous name `.openclaude` is still read when no `.limitless` directory
// exists yet, so existing project state (ralph sessions, routing ledger,
// long-task ledger, plans, hook-chains, wiki) survives the rename without any
// move/copy of live data.
export const LIMITLESS_DIRNAME = '.limitless'
export const LEGACY_OPENCLAUDE_DIRNAME = '.openclaude'

/**
 * Resolve which product state directory NAME to use under `root`.
 *
 * Resolution order (non-destructive, idempotent):
 *   1. `.limitless` if it already exists  → migrated / fresh-default user
 *   2. `.openclaude` if it already exists  → not-yet-migrated user (keep using
 *      the live directory so a running ralph loop is never orphaned)
 *   3. `.limitless` otherwise              → fresh user, new default
 *
 * This intentionally never moves or deletes the legacy directory. A user with a
 * live `.openclaude/ralph` session keeps reading and writing that exact
 * directory until they (or a future explicit migration) create `.limitless`.
 */
export function resolveProjectStateDirname(
  root: string,
  exists: (p: string) => boolean = existsSync,
): string {
  if (exists(join(root, LIMITLESS_DIRNAME))) {
    return LIMITLESS_DIRNAME
  }
  if (exists(join(root, LEGACY_OPENCLAUDE_DIRNAME))) {
    return LEGACY_OPENCLAUDE_DIRNAME
  }
  return LIMITLESS_DIRNAME
}

/**
 * Resolve an absolute path to a product-state artifact under `root`, preferring
 * `.limitless/` and falling back to an existing `.openclaude/`.
 */
export function resolveProjectStatePath(
  root: string,
  ...sub: string[]
): string {
  return join(root, resolveProjectStateDirname(root), ...sub)
}
