import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'

import {
  findProjectInstructionFilePathInAncestors,
  FALLBACK_PROJECT_INSTRUCTION_FILE,
  getProjectInstructionFilePath,
  getProjectInstructionFilePaths,
  hasProjectInstructionFile,
  isProjectInstructionFileName,
  NATIVE_PROJECT_INSTRUCTION_FILE,
  PRIMARY_PROJECT_INSTRUCTION_FILE,
} from './projectInstructions.js'

describe('projectInstructions', () => {
  test('prefers AGENTS.md over LIMITLESS.md and CLAUDE.md for root project instructions', () => {
    const dir = '/repo'
    const existingPaths = new Set([
      join(dir, PRIMARY_PROJECT_INSTRUCTION_FILE),
      join(dir, NATIVE_PROJECT_INSTRUCTION_FILE),
      join(dir, FALLBACK_PROJECT_INSTRUCTION_FILE),
    ])

    const filePath = getProjectInstructionFilePath(
      dir,
      path => existingPaths.has(path),
    )

    expect(filePath).toBe(join(dir, PRIMARY_PROJECT_INSTRUCTION_FILE))
  })

  test('prefers LIMITLESS.md over legacy CLAUDE.md when AGENTS.md is absent', () => {
    const dir = '/repo'
    const existingPaths = new Set([
      join(dir, NATIVE_PROJECT_INSTRUCTION_FILE),
      join(dir, FALLBACK_PROJECT_INSTRUCTION_FILE),
    ])

    const filePath = getProjectInstructionFilePath(
      dir,
      path => existingPaths.has(path),
    )

    expect(filePath).toBe(join(dir, NATIVE_PROJECT_INSTRUCTION_FILE))
  })

  test('falls back to legacy CLAUDE.md when AGENTS.md and LIMITLESS.md are absent', () => {
    const dir = '/repo'
    const existingPaths = new Set([join(dir, FALLBACK_PROJECT_INSTRUCTION_FILE)])

    const filePath = getProjectInstructionFilePath(
      dir,
      path => existingPaths.has(path),
    )

    expect(filePath).toBe(join(dir, FALLBACK_PROJECT_INSTRUCTION_FILE))
  })

  test('returns candidate root instruction paths in order AGENTS.md → LIMITLESS.md → CLAUDE.md', () => {
    const dir = '/repo'

    expect(getProjectInstructionFilePaths(dir)).toEqual([
      join(dir, PRIMARY_PROJECT_INSTRUCTION_FILE),
      join(dir, NATIVE_PROJECT_INSTRUCTION_FILE),
      join(dir, FALLBACK_PROJECT_INSTRUCTION_FILE),
    ])
  })

  test('detects whether a repo instruction file exists', () => {
    const dir = '/repo'
    const existingPaths = new Set([join(dir, PRIMARY_PROJECT_INSTRUCTION_FILE)])

    expect(hasProjectInstructionFile(dir, path => existingPaths.has(path))).toBe(
      true,
    )
    expect(hasProjectInstructionFile(dir, () => false)).toBe(false)
  })

  test('recognizes AGENTS.md, LIMITLESS.md, and CLAUDE.md as root instruction filenames', () => {
    expect(isProjectInstructionFileName(PRIMARY_PROJECT_INSTRUCTION_FILE)).toBe(
      true,
    )
    expect(isProjectInstructionFileName(NATIVE_PROJECT_INSTRUCTION_FILE)).toBe(
      true,
    )
    expect(isProjectInstructionFileName(FALLBACK_PROJECT_INSTRUCTION_FILE)).toBe(
      true,
    )
    expect(isProjectInstructionFileName('README.md')).toBe(false)
  })

  test('finds repo instructions in ancestor directories', () => {
    const repoDir = '/repo'
    const nestedDir = join(repoDir, 'packages', 'app')
    const existingPaths = new Set([join(repoDir, PRIMARY_PROJECT_INSTRUCTION_FILE)])

    expect(
      findProjectInstructionFilePathInAncestors(
        nestedDir,
        path => existingPaths.has(path),
      ),
    ).toBe(join(repoDir, PRIMARY_PROJECT_INSTRUCTION_FILE))
  })

  test('prefers the closest ancestor project instruction file', () => {
    const repoDir = '/repo'
    const nestedProjectDir = join(repoDir, 'packages', 'app')
    const existingPaths = new Set([
      join(repoDir, PRIMARY_PROJECT_INSTRUCTION_FILE),
      join(nestedProjectDir, FALLBACK_PROJECT_INSTRUCTION_FILE),
    ])

    expect(
      findProjectInstructionFilePathInAncestors(
        join(nestedProjectDir, 'src'),
        path => existingPaths.has(path),
      ),
    ).toBe(join(nestedProjectDir, FALLBACK_PROJECT_INSTRUCTION_FILE))
  })

  test('returns null when no ancestor repo instruction file exists', () => {
    expect(
      findProjectInstructionFilePathInAncestors('/repo/packages/app', () => false),
    ).toBeNull()
  })
})
