import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { extname, relative, resolve } from 'node:path'
import { promisify } from 'node:util'
import { roughTokenCountEstimation } from '../tokenEstimation.js'
import { clampToTokenBudget } from './text.js'

const execFileAsync = promisify(execFile)

const DEFAULT_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.py',
  '.rb',
  '.go',
  '.rs',
  '.java',
  '.kt',
  '.swift',
  '.php',
  '.cs',
  '.cpp',
  '.c',
  '.h',
  '.hpp',
])

type RepoMapEntry = {
  path: string
  score: number
  symbols: string[]
}

export type RepoMapOptions = {
  cwd: string
  taskText?: string
  maxTokens?: number
  maxFiles?: number
}

const cache = new Map<string, { expiresAt: number; value: string }>()

function keywords(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9_./-]+/)
      .filter(word => word.length >= 3),
  )
}

async function gitFiles(cwd: string): Promise<string[]> {
  try {
    const { stdout } = await execFileAsync('git', ['-C', cwd, 'ls-files'], {
      maxBuffer: 2_000_000,
    })
    return stdout.split('\n').filter(Boolean)
  } catch {
    return []
  }
}

function scorePath(path: string, query: Set<string>): number {
  const lower = path.toLowerCase()
  let score = 0
  for (const word of query) {
    if (lower.includes(word)) score += 8
  }
  if (/(^|\/)(src|lib|app|packages)\//.test(lower)) score += 2
  if (/(test|spec|fixture|snapshot|dist|build|coverage|node_modules)\//.test(lower)) {
    score -= 4
  }
  return score
}

function extractSymbols(source: string): string[] {
  const symbols: string[] = []
  const patterns = [
    /^\s*export\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/gm,
    /^\s*(?:export\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/gm,
    /^\s*(?:export\s+)?interface\s+([A-Za-z_$][\w$]*)/gm,
    /^\s*(?:export\s+)?type\s+([A-Za-z_$][\w$]*)/gm,
    /^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/gm,
    /^\s*def\s+([A-Za-z_][\w]*)/gm,
    /^\s*class\s+([A-Za-z_][\w]*)/gm,
    /^\s*func\s+([A-Za-z_][\w]*)/gm,
  ]
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      if (match[1] && !symbols.includes(match[1])) symbols.push(match[1])
      if (symbols.length >= 12) return symbols
    }
  }
  return symbols
}

async function buildEntry(cwd: string, path: string, query: Set<string>): Promise<RepoMapEntry | null> {
  const extension = extname(path)
  if (!DEFAULT_EXTENSIONS.has(extension)) return null
  const absolute = resolve(cwd, path)
  if (!relative(cwd, absolute) || relative(cwd, absolute).startsWith('..')) {
    return null
  }
  let source = ''
  try {
    source = await readFile(absolute, 'utf8')
  } catch {
    return null
  }
  const sample = source.slice(0, 80_000)
  const symbols = extractSymbols(sample)
  if (symbols.length === 0 && scorePath(path, query) <= 0) return null
  let score = scorePath(path, query) + Math.min(symbols.length, 8)
  const symbolText = symbols.join(' ').toLowerCase()
  for (const word of query) {
    if (symbolText.includes(word)) score += 12
  }
  return { path, score, symbols }
}

export async function buildRepoMap(options: RepoMapOptions): Promise<string> {
  const requestedMaxTokens = options.maxTokens ?? 1_500
  const maxTokens =
    Number.isFinite(requestedMaxTokens) && requestedMaxTokens > 0
      ? Math.min(requestedMaxTokens, 20_000)
      : 1_500
  const maxFiles = options.maxFiles ?? 40
  const taskText = options.taskText ?? ''
  const cacheKey = `${options.cwd}\0${taskText.slice(0, 500)}\0${maxTokens}\0${maxFiles}`
  const cached = cache.get(cacheKey)
  if (cached && cached.expiresAt > Date.now()) return cached.value

  const files = await gitFiles(options.cwd)
  if (files.length === 0) return ''
  const query = keywords(taskText)
  const prelim = files
    .filter(path => DEFAULT_EXTENSIONS.has(extname(path)))
    .map(path => ({ path, score: scorePath(path, query) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(maxFiles * 3, 80))

  const entries: RepoMapEntry[] = []
  for (const candidate of prelim) {
    const entry = await buildEntry(options.cwd, candidate.path, query)
    if (entry) entries.push(entry)
  }

  const selected = entries
    .sort((a, b) => b.score - a.score || a.path.localeCompare(b.path))
    .slice(0, maxFiles)

  if (selected.length === 0) return ''
  const lines = [
    '<repo-map>',
    'Relevant repository symbols. Use file tools for exact contents before editing.',
  ]
  for (const entry of selected) {
    const symbols = entry.symbols.length > 0 ? ` :: ${entry.symbols.join(', ')}` : ''
    lines.push(`- ${entry.path}${symbols}`)
  }
  lines.push('</repo-map>')

  const value = clampToTokenBudget(lines.join('\n'), maxTokens)
  cache.set(cacheKey, { expiresAt: Date.now() + 30_000, value })
  return value
}

export function estimateRepoMapTokens(repoMap: string): number {
  return roughTokenCountEstimation(repoMap)
}
