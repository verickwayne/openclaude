import { expect, test } from 'bun:test'
import { mkdtempSync, mkdirSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { scanForTranscripts } from '../../../src/services/crossHarness/scanner.js'

test('scanner finds transcripts and prunes node_modules', async () => {
  const tmpRoot = mkdtempSync(join(tmpdir(), 'xharness-scan-'))

  // (a) fake limitless/claude transcript under projects/<sanitized>/S.jsonl
  const projectsDir = join(tmpRoot, 'projects', '-fake-project')
  mkdirSync(projectsDir, { recursive: true })
  const sessionId = 'aaaabbbb-cccc-dddd-eeee-ffffffffffff'
  const limitlessLine = JSON.stringify({
    type: 'user',
    message: { role: 'user', content: 'hello from limitless' },
    uuid: 'u1',
    sessionId,
    cwd: '/fake/cwd',
    timestamp: '2026-01-01T00:00:00Z',
  })
  writeFileSync(join(projectsDir, `${sessionId}.jsonl`), limitlessLine + '\n')

  // (b) codex rollout transcript
  const codexDir = join(tmpRoot, 'codex-sessions')
  mkdirSync(codexDir, { recursive: true })
  const codexId = 'ddddeeee-ffff-0000-1111-222222222222'
  const codexMeta = JSON.stringify({ timestamp: 't', type: 'session_meta', payload: { id: codexId, cwd: '/codex/cwd', timestamp: 't' } })
  const codexMsg = JSON.stringify({ timestamp: 't', type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'hello codex' }] } })
  writeFileSync(join(codexDir, `rollout-2026-01-01T00-00-00-${codexId}.jsonl`), [codexMeta, codexMsg].join('\n') + '\n')

  // (c) node_modules junk — should be pruned
  const nmDir = join(tmpRoot, 'node_modules')
  mkdirSync(nmDir, { recursive: true })
  writeFileSync(join(nmDir, 'junk.json'), JSON.stringify({ name: 'junk', version: '1' }))

  const results = await scanForTranscripts({ roots: [tmpRoot], maxDepth: 8 })

  // Should find at least 2 transcripts
  expect(results.length).toBeGreaterThanOrEqual(2)

  // None should come from node_modules
  const nmPaths = results.filter(r => r.path.includes('node_modules'))
  expect(nmPaths.length).toBe(0)

  // Should include a codex entry
  const harnessSet = new Set(results.map(r => r.harness))
  expect(harnessSet.has('codex')).toBe(true)
})
