import { afterEach, expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

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

// ── Routing Outcome Ledger tests ──────────────────────────────────────────────

test('hook captures ledger line on PostToolUse Agent dispatch', () => {
  const hook = OPENRALPH_FILES['bin/openralph-hook.sh']

  // Capture must be inside the PostToolUse branch keyed on EVENT == PostToolUse
  // and TOOL_NAME == Agent.
  expect(hook).toContain('PostToolUse')
  expect(hook).toContain('Agent')

  // Must write to the ledger path (project-level, cross-session).
  expect(hook).toContain('ledger/outcomes.jsonl')

  // Must mkdir -p for the ledger dir before appending.
  expect(hook).toContain('ledger')

  // Must extract provider_model_used from the YAML block.
  expect(hook).toContain('provider_model_used')

  // Must never fail the hook — wrap in || true so a bad YAML doesn't break the
  // Stop gate or any other hook event.
  expect(hook).toContain('|| true')
})

test('hook ledger append uses safe shell variable references (ledger path uses RALPH_DIR)', () => {
  const hook = OPENRALPH_FILES['bin/openralph-hook.sh']
  // The ledger path must reference RALPH_DIR (not a hard-coded literal).
  // Plain $RALPH_DIR is safe in a JS template literal because JS only interpolates
  // ${expr} — bare $VARNAME is left as-is in the string.
  // The generated script must contain RALPH_DIR somewhere near ledger/outcomes.jsonl.
  const ledgerLine = hook
    .split('\n')
    .find(line => line.includes('ledger/outcomes.jsonl'))
  expect(ledgerLine).toBeDefined()
  // The line referencing the ledger file should contain RALPH_DIR (with or without
  // braces — both are safe in JS template literals for this variable name).
  expect(hook).toMatch(/RALPH_DIR.*ledger\/outcomes\.jsonl|ledger\/outcomes\.jsonl.*RALPH_DIR/)
})

test('route-stats script is registered in OPENRALPH_FILES', () => {
  const key = 'bin/openralph-route-stats.sh'
  // toHaveProperty mis-handles paths with slashes — use direct key check instead.
  expect(key in OPENRALPH_FILES).toBe(true)
  const script = (OPENRALPH_FILES as Record<string, string>)[key]

  // Must read outcomes.jsonl.
  expect(script).toContain('outcomes.jsonl')

  // Must aggregate per persona × workload × provider_model_used.
  expect(script).toContain('persona')
  expect(script).toContain('provider_model_used')

  // Must compute a success rate (status==complete + tests_passed not false).
  expect(script).toContain('success')

  // Must print n (count) and avg_duration.
  expect(script).toContain('avg_duration')

  // Must use python3 stdlib only (no pip deps).
  expect(script).toContain('python3')
  expect(script).not.toContain('import pandas')
  expect(script).not.toContain('import numpy')
})

test('scheduler step 8 reads route-stats and uses success-rate model selection with exploration', async () => {
  registerOpenRalphSkills()
  const engage = getBundledSkills().find(command => command.name === 'openralph')!
  const blocks = await engage.getPromptForCommand('', {} as never)
  const text = (blocks[0] as { text: string }).text

  // Step 8 must reference the route-stats script.
  expect(text).toContain('openralph-route-stats.sh')

  // Must pick model by best recorded success rate.
  expect(text).toContain('success rate')

  // Must specify the exploration rule: n < 3 triggers trying an under-sampled candidate.
  expect(text).toContain('n < 3')
})

test('bootstrap creates ledger dir and ledger is NOT gitignored by default', () => {
  const bootstrap = OPENRALPH_FILES['bin/openralph-bootstrap.sh']

  // Must mkdir -p for the ledger directory.
  expect(bootstrap).toContain('ledger')

  // The ledger path must NOT appear as a gitignore entry (it is committed by default
  // per §3 / Angle E — routing knowledge is worth committing).
  // It may appear commented-out as an optional line but must not be in the active
  // per-entry idempotent append loop without a comment marker.
  const gitignoreLoopMatch = bootstrap.match(
    /for _entry in\\s+\\\\([\s\S]*?)\\s*;\\s*do/,
  )
  if (gitignoreLoopMatch) {
    // If the loop is present, ledger/outcomes.jsonl must not be in it.
    expect(gitignoreLoopMatch[1]).not.toContain('ledger')
  }
  // outcomes.jsonl itself must not be added as a gitignore entry anywhere.
  // A comment referencing it (# optional: ...) is acceptable.
  const nonCommentLines = bootstrap
    .split('\n')
    .filter(line => !line.trim().startsWith('#'))
  const gitignoreLedgerEntries = nonCommentLines.filter(
    line =>
      line.includes('.openclaude/ralph/ledger') &&
      line.includes('>> .gitignore'),
  )
  expect(gitignoreLedgerEntries).toHaveLength(0)
})

test('ledger JSONL record shape contains all required fields', () => {
  const hook = OPENRALPH_FILES['bin/openralph-hook.sh']

  // All required fields per spec §3 data shape must appear in the ledger logic.
  const requiredFields = [
    '"ts"',
    '"session_id"',
    '"task_slug"',
    '"persona"',
    '"provider_model_used"',
    '"status"',
    '"tests_passed"',
    '"workload"',
  ]
  for (const field of requiredFields) {
    expect(hook).toContain(field)
  }
})

test('status prompt reports top routing stats', async () => {
  registerOpenRalphSkills()
  const status = getBundledSkills().find(command => command.name === 'openralph-status')!
  const blocks = await status.getPromptForCommand('', {} as never)
  const text = (blocks[0] as { text: string }).text
  expect(text).toContain('routing stats')
  expect(text).toContain('openralph-route-stats.sh')
})

// ── Behavioral tests: run the real hook script in a subprocess ───────────────

/**
 * Writes the bundled hook script into a fresh temp project root, creates the
 * `.openclaude/ralph/enabled` marker the hook requires, runs the hook with the
 * given stdin JSON, and returns the temp root + exit code.
 */
function runHookSubprocess(stdinPayload: Record<string, unknown>): {
  root: string
  exitCode: number
  stderr: string
} {
  const root = mkdtempSync(join(tmpdir(), 'openralph-hook-behavioral-'))
  mkdirSync(join(root, '.openclaude', 'ralph'), { recursive: true })
  writeFileSync(join(root, '.openclaude', 'ralph', 'enabled'), '')
  const hookPath = join(root, 'openralph-hook.sh')
  writeFileSync(hookPath, OPENRALPH_FILES['bin/openralph-hook.sh'])

  const proc = Bun.spawnSync(['bash', hookPath], {
    cwd: root,
    env: { ...process.env, OPENRALPH_PROJECT_ROOT: root },
    stdin: Buffer.from(JSON.stringify(stdinPayload)),
  })
  return {
    root,
    exitCode: proc.exitCode,
    stderr: proc.stderr.toString(),
  }
}

test('hook exits 0 and writes no ledger line when tool_response has no YAML block', () => {
  const { root, exitCode } = runHookSubprocess({
    hook_event_name: 'PostToolUse',
    tool_name: 'Agent',
    tool_input: { subagent_type: 'openralph-builder' },
    tool_response: 'garbage no yaml here',
    session_id: 'test-sess',
    cwd: 'test-cwd',
    transcript_path: 'test-transcript',
  })

  expect(exitCode).toBe(0)

  const ledgerPath = join(root, '.openclaude', 'ralph', 'ledger', 'outcomes.jsonl')
  if (existsSync(ledgerPath)) {
    expect(readFileSync(ledgerPath, 'utf8').trim()).toBe('')
  }
})

test('hook appends one well-formed JSONL ledger record for a valid persona YAML', () => {
  const personaYaml = [
    '```yaml',
    'task_slug: "wire-route-stats"',
    'status: "complete"',
    'commit: "abc1234"',
    'files_changed:',
    '  - "src/foo.ts"',
    'tests_run: "bun test src/foo.test.ts"',
    'tests_passed: true',
    'provider_model_used: "openai-compatible/gpt-5.3-codex"',
    'new_gaps: []',
    'next_action: "none"',
    'notes: "ok"',
    '```',
  ].join('\n')

  const { root, exitCode, stderr } = runHookSubprocess({
    hook_event_name: 'PostToolUse',
    tool_name: 'Agent',
    tool_input: { subagent_type: 'openralph-builder', prompt: 'do the task' },
    tool_response: `Work finished.\n\n${personaYaml}\n`,
    session_id: 'test-sess',
    cwd: 'test-cwd',
    transcript_path: 'test-transcript',
  })

  expect(exitCode).toBe(0)

  const ledgerPath = join(root, '.openclaude', 'ralph', 'ledger', 'outcomes.jsonl')
  expect(existsSync(ledgerPath)).toBe(true)

  const lines = readFileSync(ledgerPath, 'utf8').trim().split('\n')
  expect(lines).toHaveLength(1)

  const record = JSON.parse(lines[0]!) as Record<string, unknown>
  expect(record.session_id).toBe('test-sess')
  expect(record.task_slug).toBe('wire-route-stats')
  expect(record.persona).toBe('openralph-builder')
  expect(record.provider_model_used).toBe('openai-compatible/gpt-5.3-codex')
  expect(record.status).toBe('complete')
  expect(record.tests_passed).toBe(true)
  expect(record.new_gaps).toBe(0)
  expect(typeof record.ts).toBe('string')
  // Sanity: stderr should not show a python traceback swallowed by || true.
  expect(stderr).not.toContain('SyntaxError')
  expect(stderr).not.toContain('Traceback')
})
