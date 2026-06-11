import { describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  LIMITLESS_DIRNAME,
  resolveProjectStateDirname,
  resolveProjectStatePath,
} from './productStateDir.js'

function withTempRoot(fn: (root: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), 'product-state-dir-'))
  try {
    fn(root)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

describe('resolveProjectStateDirname', () => {
  test('fresh project (neither dir) → new .limitless default', () => {
    withTempRoot(root => {
      expect(resolveProjectStateDirname(root)).toBe(LIMITLESS_DIRNAME)
    })
  })

  test('previous-brand project (only .openclaude) → uses .limitless', () => {
    withTempRoot(root => {
      mkdirSync(join(root, '.openclaude'), { recursive: true })
      expect(resolveProjectStateDirname(root)).toBe(LIMITLESS_DIRNAME)
    })
  })

  test('migrated project (only .limitless) → .limitless', () => {
    withTempRoot(root => {
      mkdirSync(join(root, LIMITLESS_DIRNAME), { recursive: true })
      expect(resolveProjectStateDirname(root)).toBe(LIMITLESS_DIRNAME)
    })
  })

  test('mid-migration (both dirs) → prefers .limitless', () => {
    withTempRoot(root => {
      mkdirSync(join(root, '.openclaude'), { recursive: true })
      mkdirSync(join(root, LIMITLESS_DIRNAME), { recursive: true })
      expect(resolveProjectStateDirname(root)).toBe(LIMITLESS_DIRNAME)
    })
  })

  test('ignores injected previous-brand existence checks', () => {
    const root = '/virtual/project'
    const onlyPreviousBrand = (p: string) => p === join(root, '.openclaude')
    expect(resolveProjectStateDirname(root, onlyPreviousBrand)).toBe(LIMITLESS_DIRNAME)
    expect(resolveProjectStateDirname(root, () => false)).toBe(
      LIMITLESS_DIRNAME,
    )
  })
})

describe('resolveProjectStatePath', () => {
  test('joins the resolved dir with the subpath', () => {
    withTempRoot(root => {
      mkdirSync(join(root, '.openclaude'), { recursive: true })
      expect(resolveProjectStatePath(root, 'ralph', 'ledger')).toBe(
        join(root, LIMITLESS_DIRNAME, 'ralph', 'ledger'),
      )
    })
  })
})
