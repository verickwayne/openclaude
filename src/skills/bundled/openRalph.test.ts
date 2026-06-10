import { afterEach, expect, test } from 'bun:test'
import { readFileSync } from 'fs'

import { clearBundledSkills, getBundledSkills } from '../bundledSkills.js'
import { OPENRALPH_FILES, registerOpenRalphSkills } from './openRalph.js'

const testGlobal = globalThis as typeof globalThis & {
  MACRO?: { VERSION: string }
}
testGlobal.MACRO ??= { VERSION: 'test' }

afterEach(() => {
  clearBundledSkills()
})

test('/openralph registers engage/status/resume/disengage skills', async () => {
  registerOpenRalphSkills()

  const names = getBundledSkills().map(command => command.name)
  expect(names).toContain('openralph')
  expect(names).toContain('openralph-status')
  expect(names).toContain('openralph-resume')
  expect(names).toContain('openralph-disengage')

  const engage = getBundledSkills().find(command => command.name === 'openralph')
  expect(engage?.aliases).toContain('ralph-engage')
  expect(engage?.skillRoot).toBeDefined()

  const blocks = await engage!.getPromptForCommand('ship the harness', {} as never)
  const text = (blocks[0] as { text: string }).text

  expect(text).toContain('# /openralph')
  expect(text).toContain('ship the harness')
  expect(text).toContain('.openclaude/ralph/bin/openralph-hook.sh')
  expect(text).toContain('.claude/settings.local.json')
  expect(text).toContain('goal.json')
  expect(text).toContain('openralph-builder')
})

test('OpenRalph built-in persona agents are available', () => {
  const source = readFileSync(
    'src/tools/AgentTool/built-in/openRalphAgents.ts',
    'utf8',
  )

  expect(source).toContain("agentType: 'openralph-builder'")
  expect(source).toContain("agentType: 'openralph-refiner'")
  expect(source).toContain("agentType: 'openralph-researcher'")
  expect(source).toContain("agentType: 'openralph-test-analyzer'")
})

// ── Script-string assertions (no shell execution) ──────────────────────────

test('hook script does not mkdir SESSION_STATE_DIR', () => {
  const hook = OPENRALPH_FILES['bin/openralph-hook.sh']
  // The hook must never create the session directory — it would mask missing
  // engage state and let observer sessions adopt a wrong state dir.
  expect(hook).not.toContain('mkdir -p "$SESSION_STATE_DIR"')
  expect(hook).not.toContain('mkdir -p "${SESSION_STATE_DIR}')
})

test('hook Stop gate requires owning session and passes through disengaged status', () => {
  const hook = OPENRALPH_FILES['bin/openralph-hook.sh']
  // Gate must require the session to own the loop.
  expect(hook).toContain('"$SESSION_ID" == "$ACTIVE_SESSION"')
  // Gate must pass through when goal is disengaged (in addition to complete/completed).
  expect(hook).toContain('"$STATUS" != "disengaged"')
})

test('hook session-level log and Stop gate are guarded by [[ -d "$SESSION_STATE_DIR" ]]', () => {
  const hook = OPENRALPH_FILES['bin/openralph-hook.sh']
  // The session-scoped block must be guarded so sessions without state dirs
  // are transparent pass-throughs.
  expect(hook).toContain('[[ -d "$SESSION_STATE_DIR" ]]')
})

test('engage script gitignore section uses per-entry idempotent appends', () => {
  const bootstrap = OPENRALPH_FILES['bin/openralph-bootstrap.sh']
  // Old approach: single block guarded by one grep check — would skip all
  // entries if any one already existed.  New approach: a loop that appends
  // each entry individually only when missing.
  expect(bootstrap).toContain('grep -qF "$_entry" .gitignore || echo "$_entry" >> .gitignore')
  // The old single-shot guard pattern must be gone.
  expect(bootstrap).not.toContain("! grep -q '^\\.openclaude/ralph/events\\.jsonl$' .gitignore")
  // Every required entry must still be present.
  const requiredEntries = [
    '.openclaude/ralph/enabled',
    '.openclaude/ralph/active-session',
    '.openclaude/ralph/active-session.json',
    '.openclaude/ralph/bridges/',
    '.openclaude/ralph/events.jsonl',
    '.openclaude/ralph/logs/',
    '.openclaude/ralph/sessions/',
  ]
  for (const entry of requiredEntries) {
    expect(bootstrap).toContain(entry)
  }
})

test('researcher whenToUse references sessions/<session_id>/ path form', () => {
  const source = readFileSync(
    'src/tools/AgentTool/built-in/openRalphAgents.ts',
    'utf8',
  )
  // Must reference the session-scoped path, not the old flat research dir.
  expect(source).toContain('sessions/<session_id>/research')
  expect(source).not.toContain("under .openclaude/ralph/research.'")
})
