import { dirname, join } from 'path'
import { isLegacyConfigReadEnabled } from './markdownConfigLoader.js'

// Root project-instruction filename resolution order:
//   1. AGENTS.md   — harness-neutral, preferred
//   2. LIMITLESS.md — Limitless-native
//   3. CLAUDE.md   — LEGACY fallback (only when legacy reads are enabled)
export const PRIMARY_PROJECT_INSTRUCTION_FILE = 'AGENTS.md'
export const NATIVE_PROJECT_INSTRUCTION_FILE = 'LIMITLESS.md'
export const FALLBACK_PROJECT_INSTRUCTION_FILE = 'CLAUDE.md'

// Non-legacy filenames, always read. Order = priority (earlier wins).
const NON_LEGACY_PROJECT_INSTRUCTION_FILES = [
  PRIMARY_PROJECT_INSTRUCTION_FILE,
  NATIVE_PROJECT_INSTRUCTION_FILE,
] as const

/**
 * Ordered list of candidate root instruction filenames (earlier = higher
 * priority): AGENTS.md → LIMITLESS.md → CLAUDE.md. The legacy CLAUDE.md
 * candidate is dropped in strict zero-link mode (readLegacyConfigDirs: false).
 */
export function getProjectInstructionFileNames(): string[] {
  return [
    ...NON_LEGACY_PROJECT_INSTRUCTION_FILES,
    ...(isLegacyConfigReadEnabled() ? [FALLBACK_PROJECT_INSTRUCTION_FILE] : []),
  ]
}

export function getProjectInstructionFilePaths(dir: string): string[] {
  return getProjectInstructionFileNames().map(name => join(dir, name))
}

export function getProjectInstructionFilePath(
  dir: string,
  existsSync: (path: string) => boolean,
): string {
  const paths = getProjectInstructionFilePaths(dir)
  const existing = paths.find(path => existsSync(path))
  // Fall back to the last candidate (lowest-priority filename that's enabled)
  // so the return type stays a string even when no file exists on disk.
  return existing ?? paths[paths.length - 1]!
}

export function hasProjectInstructionFile(
  dir: string,
  existsSync: (path: string) => boolean,
): boolean {
  return getProjectInstructionFilePaths(dir).some(path => existsSync(path))
}

export function findProjectInstructionFilePathInAncestors(
  startDir: string,
  existsSync: (path: string) => boolean,
): string | null {
  let currentDir = startDir

  while (true) {
    if (hasProjectInstructionFile(currentDir, existsSync)) {
      return getProjectInstructionFilePath(currentDir, existsSync)
    }

    const parentDir = dirname(currentDir)
    if (parentDir === currentDir) {
      return null
    }

    currentDir = parentDir
  }
}

export function isProjectInstructionFileName(name: string): boolean {
  return (
    name === PRIMARY_PROJECT_INSTRUCTION_FILE ||
    name === NATIVE_PROJECT_INSTRUCTION_FILE ||
    name === FALLBACK_PROJECT_INSTRUCTION_FILE
  )
}
