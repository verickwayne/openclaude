import { join } from 'path'

export const LIMITLESS_DIRNAME = '.limitless'

/**
 * Resolve which product state directory NAME to use under `root`.
 */
export function resolveProjectStateDirname(
  _root: string,
  _exists?: (p: string) => boolean,
): string {
  return LIMITLESS_DIRNAME
}

/**
 * Resolve an absolute path to a product-state artifact under `root`.
 */
export function resolveProjectStatePath(
  root: string,
  ...sub: string[]
): string {
  return join(root, resolveProjectStateDirname(root), ...sub)
}
