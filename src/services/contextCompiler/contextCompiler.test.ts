import { afterEach, describe, expect, test } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  buildRepoMap,
  clampToTokenBudget,
  compileContextReport,
  getLastRealUserText,
} from './index.js'

const tempDirs: string[] = []

afterEach(() => {
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop()!, { recursive: true, force: true })
  }
})

function tempGitRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'limitless-context-compiler-'))
  tempDirs.push(dir)
  execFileSync('git', ['init'], { cwd: dir, stdio: 'ignore' })
  execFileSync('git', ['config', 'user.email', 'test@example.com'], {
    cwd: dir,
    stdio: 'ignore',
  })
  execFileSync('git', ['config', 'user.name', 'Test'], {
    cwd: dir,
    stdio: 'ignore',
  })
  return dir
}

describe('clampToTokenBudget', () => {
  test('keeps short text unchanged', () => {
    expect(clampToTokenBudget('short text', 100)).toBe('short text')
  })

  test('truncates long text with a marker', () => {
    const text = Array.from({ length: 200 }, (_, i) => `line ${i}`).join('\n')
    const result = clampToTokenBudget(text, 20)
    expect(result.length).toBeLessThan(text.length)
    expect(result).toContain('truncated to 20 token budget')
  })
})

describe('getLastRealUserText', () => {
  test('skips hidden meta messages', () => {
    const messages = [
      { type: 'user', isMeta: false, message: { content: 'real request' } },
      { type: 'user', isMeta: true, message: { content: 'hidden context' } },
    ] as any[]
    expect(getLastRealUserText(messages)).toBe('real request')
  })
})

describe('compileContextReport', () => {
  test('accounts for recent, older, tool result, mnemo, and repo-map lanes', () => {
    const messages = [
      { type: 'user', message: { content: 'old request' } },
      {
        type: 'user',
        message: {
          content: [
            { type: 'tool_result', tool_use_id: 'tu1', content: 'tool output' },
          ],
        },
      },
      { type: 'assistant', message: { content: 'recent answer' } },
    ] as any[]

    const report = compileContextReport({
      messages,
      budgetTokens: 1_000,
      recentMessageCount: 1,
      mnemoText: 'memory',
      repoMapText: 'repo',
    })

    expect(report.totalEstimatedTokens).toBeGreaterThan(0)
    expect(report.lanes.find(l => l.id === 'older_messages')?.itemCount).toBe(1)
    expect(report.lanes.find(l => l.id === 'tool_results')?.itemCount).toBe(1)
    expect(report.lanes.find(l => l.id === 'recent_messages')?.itemCount).toBe(1)
    expect(report.lanes.find(l => l.id === 'mnemo')?.itemCount).toBe(1)
    expect(report.lanes.find(l => l.id === 'repo_map')?.itemCount).toBe(1)
  })
})

describe('buildRepoMap', () => {
  test('builds a bounded symbol map from tracked source files', async () => {
    const dir = tempGitRepo()
    mkdirSync(join(dir, 'src'), { recursive: true })
    writeFileSync(
      join(dir, 'src', 'auth.ts'),
      [
        'export function validateToken() { return true }',
        'export class AuthSession {}',
        'export const refreshAuth = () => true',
      ].join('\n'),
    )
    writeFileSync(
      join(dir, 'src', 'billing.ts'),
      'export function chargeCard() { return true }',
    )
    execFileSync('git', ['add', '.'], { cwd: dir, stdio: 'ignore' })

    const repoMap = await buildRepoMap({
      cwd: dir,
      taskText: 'fix auth token refresh',
      maxTokens: 120,
    })

    expect(repoMap).toContain('<repo-map>')
    expect(repoMap).toContain('src/auth.ts')
    expect(repoMap).toContain('validateToken')
    expect(repoMap.length).toBeLessThan(1_000)
  })
})

