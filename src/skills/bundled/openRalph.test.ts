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
  expect(names).toContain('openralph-kick')

  const engage = getBundledSkills().find(command => command.name === 'openralph')
  expect(engage?.aliases).toContain('ralph-engage')
  expect(engage?.skillRoot).toBeDefined()

  const blocks = await engage!.getPromptForCommand('ship the harness', {} as never)
  const text = (blocks[0] as { text: string }).text

  expect(text).toContain('# /openralph')
  expect(text).toContain('ship the harness')
  expect(text).toContain('.limitless/ralph/bin/openralph-hook.sh')
  expect(text).toContain('.claude/settings.local.json')
  expect(text).toContain('goal.json')
  expect(text).toContain('openralph-builder')
})

test('/openralph-kick registers force command and installs kick script', async () => {
  registerOpenRalphSkills()

  const kick = getBundledSkills().find(command => command.name === 'openralph-kick')
  expect(kick).toBeDefined()
  expect(kick?.aliases).toContain('ralph-kick')
  expect(kick?.aliases).toContain('openralph-force')

  const blocks = await kick!.getPromptForCommand('--session 9ec404eb', {} as never)
  const text = (blocks[0] as { text: string }).text
  expect(text).toContain('# /openralph-kick')
  expect(text).toContain('openralph-kick.sh --session 9ec404eb')
  expect(text).toContain('kick.json')
  expect(text).toContain('kick-log.jsonl')
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
  // Every required entry must still be present. Entries are written against the
  // resolved state dir ($RALPH_REL), which is .limitless/ralph for fresh repos
  // and .openclaude/ralph when a live legacy session is kept in place.
  const requiredEntries = [
    '$RALPH_REL/enabled',
    '$RALPH_REL/active-session',
    '$RALPH_REL/active-session.json',
    '$RALPH_REL/bridges/',
    '$RALPH_REL/events.jsonl',
    '$RALPH_REL/logs/',
    '$RALPH_REL/sessions/',
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

test('hook ledger capture is guarded by openralph- prefix on subagent_type', () => {
  const hook = OPENRALPH_FILES['bin/openralph-hook.sh']
  // FINDING 10: a non-OpenRalph Agent whose response contains YAML must not
  // write a spurious ledger row. The guard must check subagent_type starts with
  // "openralph-" before proceeding to YAML extraction.
  expect(hook).toContain('startswith("openralph-")')
  // The guard must be placed before the YAML extraction (early exit on no match).
  const guardIdx = hook.indexOf('startswith("openralph-")')
  const yamlIdx = hook.indexOf('yaml_match = re.search')
  expect(guardIdx).toBeGreaterThan(-1)
  expect(yamlIdx).toBeGreaterThan(-1)
  expect(guardIdx).toBeLessThan(yamlIdx)
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

test('kick script is registered and targets session-scoped OpenRalph state', () => {
  const key = 'bin/openralph-kick.sh'
  expect(key in OPENRALPH_FILES).toBe(true)
  const script = (OPENRALPH_FILES as Record<string, string>)[key]

  expect(script).toContain('--session')
  expect(script).toContain('active-session')
  expect(script).toContain('enabled')
  expect(script).toContain('openralph-bootstrap.sh')
  expect(script).toContain('kick.json')
  expect(script).toContain('kick-log.jsonl')
  expect(script).toContain('CLAUDE_CODE_SESSION_ID="$SESSION_ARG"')
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

test('scheduler step 8 instructs billing-aware candidate preference for long-running work', async () => {
  registerOpenRalphSkills()
  const engage = getBundledSkills().find(command => command.name === 'openralph')!
  const blocks = await engage.getPromptForCommand('', {} as never)
  const text = (blocks[0] as { text: string }).text

  // Step 8 must mention subscription-billed candidates for long-running/overnight dispatches.
  expect(text).toContain('subscription')

  // Must name the concrete subscription-billed providers so the scheduler can act on it.
  expect(text).toContain('Claude Max proxy')
  expect(text).toContain('Codex OAuth')

  // Must mention the perishable-quota rationale.
  expect(text).toContain('perishable')

  // Must contrast long-running (subscription) with interactive/short (metered).
  expect(text).toContain('metered')
})

test('bootstrap writes workload key with LoopWorkloadClass vocabulary value', () => {
  const bootstrap = OPENRALPH_FILES['bin/openralph-bootstrap.sh']
  // FINDING 8: session.json must carry "workload" so the ledger hook's
  // `sess.get("workload") or sess.get("mode")` returns a LoopWorkloadClass value
  // ('direct' | 'bounded' | 'long-running') — not a scheduler mode string like "build".
  // An OpenRalph loop is definitionally long-running autonomous work.
  expect(bootstrap).toContain('"workload"')
  expect(bootstrap).toContain('"workload": "long-running"')
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

// ── Cross-provider checker tests ──────────────────────────────────────────────

test('openralph-checker persona is registered in openRalphAgents.ts', () => {
  const source = readFileSync(
    'src/tools/AgentTool/built-in/openRalphAgents.ts',
    'utf8',
  )
  expect(source).toContain("agentType: 'openralph-checker'")
  expect(source).toContain('OPENRALPH_CHECKER_AGENT')
  expect(source).toContain('OPENRALPH_AGENTS')
  // checker must be included in the exported array
  const agentsArrayMatch = source.match(/OPENRALPH_AGENTS[^=]*=\s*\[([^\]]+)\]/s)
  expect(agentsArrayMatch).not.toBeNull()
  expect(agentsArrayMatch![1]).toContain('OPENRALPH_CHECKER_AGENT')
})

test('checker persona is read-only — disallows file-edit and write tools', () => {
  const source = readFileSync(
    'src/tools/AgentTool/built-in/openRalphAgents.ts',
    'utf8',
  )
  // The checker definition block must include disallowedTools
  expect(source).toContain('disallowedTools')
  // The checker uses only BASH_TOOL_NAME (for running proof_command)
  expect(source).toContain("tools: [BASH_TOOL_NAME]")
  // omitClaudeMd: true keeps the checker's context clean
  expect(source).toContain('omitClaudeMd: true')
})

test('checker prompt enforces different-provider rule in whenToUse and system prompt', () => {
  const source = readFileSync(
    'src/tools/AgentTool/built-in/openRalphAgents.ts',
    'utf8',
  )
  // whenToUse must state the different-provider constraint
  expect(source).toContain('different provider')
  // system prompt must articulate the provider rule
  expect(source).toContain('PROVIDER RULE')
  // must reference worker_model
  expect(source).toContain('worker_model')
})

test('checker verdict YAML fields align with ledger extractor (task_slug, provider_model_used, status, goal_met)', () => {
  const source = readFileSync(
    'src/tools/AgentTool/built-in/openRalphAgents.ts',
    'utf8',
  )
  // Ledger extractor expects task_slug + provider_model_used + status in the YAML block
  expect(source).toContain('task_slug:')
  expect(source).toContain('provider_model_used:')
  // status: "complete" signals the check itself ran (the ledger records it)
  expect(source).toContain('status: "complete"')
  // goal_met is the verdict payload — distinct from ledger status
  expect(source).toContain('goal_met:')
  // evidence and gaps must be present in the schema
  expect(source).toContain('evidence:')
  expect(source).toContain('gaps:')
})

test('scheduler contract step 9 dispatches checker before marking goal complete', async () => {
  registerOpenRalphSkills()
  const engage = getBundledSkills().find(command => command.name === 'openralph')!
  const blocks = await engage.getPromptForCommand('', {} as never)
  const text = (blocks[0] as { text: string }).text

  // Step 9 must reference the checker persona
  expect(text).toContain('openralph-checker')

  // Must gate on goal_met: true before writing complete
  expect(text).toContain('goal_met: true')

  // Must explicitly pass worker_model to the checker dispatch
  expect(text).toContain('worker_model')

  // Must push gaps back to the queue when checker returns goal_met: false
  expect(text).toContain('goal_met: false')

  // Must instruct the scheduler to use a different provider/model family
  expect(text).toContain('different provider')
})

test('scheduler contract step 10 is the stop gate (renumbered from 9 after checker insertion)', async () => {
  registerOpenRalphSkills()
  const engage = getBundledSkills().find(command => command.name === 'openralph')!
  const blocks = await engage.getPromptForCommand('', {} as never)
  const text = (blocks[0] as { text: string }).text

  // Step 10 is now the terminal stop gate
  expect(text).toContain('10.')
  // The stop gate text must reference goal.json.status being complete
  expect(text).toMatch(/10\..*goal\.json/)
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

// ── Adjudicated dispatch tests ────────────────────────────────────────────────

test('scheduler contract defines the high-stakes marker (adjudicate: true field)', async () => {
  registerOpenRalphSkills()
  const engage = getBundledSkills().find(command => command.name === 'openralph')!
  const blocks = await engage.getPromptForCommand('', {} as never)
  const text = (blocks[0] as { text: string }).text

  // The marker must be a field named `adjudicate: true` on the task entry in
  // queue.md / current-task.md — explicit opt-in per task (simpler than heuristic).
  expect(text).toContain('adjudicate: true')

  // The contract must also state the consecutive-blocked fallback heuristic so
  // tasks that stall automatically get adjudication without requiring the field.
  expect(text).toMatch(/consecutive.*blocked|blocked.*consecutive|partial.*blocked|no_progress/i)
})

test('adjudicated dispatch step picks 2 candidates from DIFFERENT providers', async () => {
  registerOpenRalphSkills()
  const engage = getBundledSkills().find(command => command.name === 'openralph')!
  const blocks = await engage.getPromptForCommand('', {} as never)
  const text = (blocks[0] as { text: string }).text

  // Must dispatch to exactly N=2 candidates as the starting point.
  expect(text).toContain('N=2')

  // Each candidate must come from a different provider (cross-provider diversity
  // is the whole point — decorrelated second opinions).
  expect(text).toMatch(/different provider|different providers/i)

  // Must reference the route-stats / resolveProviderForClass vocabulary for picking
  // candidates so it stays consistent with the existing step 8 routing contract.
  expect(text).toContain('openralph-route-stats.sh')
})

test('adjudication contract states provider diversity wins over billing preference', async () => {
  registerOpenRalphSkills()
  const engage = getBundledSkills().find(command => command.name === 'openralph')!
  const blocks = await engage.getPromptForCommand('', {} as never)
  const text = (blocks[0] as { text: string }).text

  // FINDING 4: when only one subscription-billed provider exists, it is
  // impossible to satisfy both "prefer subscription billing" AND "different
  // providers". The contract must explicitly state that provider diversity wins
  // in this situation — candidate A takes the preferred billing, candidate B
  // takes the best-ranked candidate from any other provider.
  expect(text).toMatch(/[Pp]rovider diversity wins|diversity wins/i)
  // Must name the fallback: candidate B takes the best-ranked from any OTHER provider.
  expect(text).toMatch(/other provider/i)
})

test('adjudicated dispatch step isolates each candidate in its own worktree', async () => {
  registerOpenRalphSkills()
  const engage = getBundledSkills().find(command => command.name === 'openralph')!
  const blocks = await engage.getPromptForCommand('', {} as never)
  const text = (blocks[0] as { text: string }).text

  // Each dispatch must use an isolated git worktree so the two candidates cannot
  // interfere with each other's commits or file changes.
  expect(text).toContain('worktree')

  // The task brief sent to both must be identical (same current-task.md content).
  expect(text).toMatch(/identical|same task brief|same.*brief|brief.*identical/i)
})

test('adjudicated dispatch step dispatches openralph-checker once per candidate', async () => {
  registerOpenRalphSkills()
  const engage = getBundledSkills().find(command => command.name === 'openralph')!
  const blocks = await engage.getPromptForCommand('', {} as never)
  const text = (blocks[0] as { text: string }).text

  // The checker must be dispatched once per candidate result, not just once overall.
  // "per candidate" or "for each candidate" in the contract signals this.
  expect(text).toMatch(/checker.*each candidate|each candidate.*checker|per candidate/i)
})

test('adjudicated dispatch step compares verdicts and merges the winner', async () => {
  registerOpenRalphSkills()
  const engage = getBundledSkills().find(command => command.name === 'openralph')!
  const blocks = await engage.getPromptForCommand('', {} as never)
  const text = (blocks[0] as { text: string }).text

  // Must compare checker verdicts (goal_met + gaps count + tests) to choose winner.
  expect(text).toContain('goal_met')
  expect(text).toMatch(/winner|winning candidate/i)

  // Winner's work must be merged (or its worktree checked out into main).
  expect(text).toMatch(/merge.*winner|winner.*merge|cherry-pick|merge the winner/i)

  // Loser's worktree must be discarded.
  expect(text).toMatch(/discard.*loser|loser.*discard|remove.*worktree|worktree.*remove/i)
})

test('adjudicated dispatch step records BOTH outcomes to the ledger', async () => {
  registerOpenRalphSkills()
  const engage = getBundledSkills().find(command => command.name === 'openralph')!
  const blocks = await engage.getPromptForCommand('', {} as never)
  const text = (blocks[0] as { text: string }).text

  // Both persona dispatches return the standard YAML which the PostToolUse hook
  // picks up automatically.  The contract must confirm both flow through — mention
  // that both outcomes (winner AND loser) are recorded to the ledger.
  expect(text).toMatch(/both.*ledger|ledger.*both|all.*outcomes.*ledger|loser.*ledger|ledger.*loser/i)
})

test('adjudicated dispatch both-fail branch discards both, queues gaps, merges nothing', async () => {
  registerOpenRalphSkills()
  const engage = getBundledSkills().find(command => command.name === 'openralph')!
  const blocks = await engage.getPromptForCommand('', {} as never)
  const text = (blocks[0] as { text: string }).text

  // The contract must state all three verdict branches explicitly: both pass,
  // exactly one passes, neither passes.
  expect(text).toMatch(/both pass/i)
  expect(text).toMatch(/exactly one passes/i)
  expect(text).toMatch(/neither passes/i)

  // Neither-passes: discard BOTH worktrees.
  expect(text).toMatch(/discard both worktrees/i)

  // Neither-passes: push the union of both checkers' gaps lists as new queue
  // items, deduplicating identical gap text.
  expect(text).toContain('union')
  expect(text).toMatch(/dedupe|de-dupe|deduplicat/i)

  // Neither-passes: nothing merges — the failing candidates must never flow
  // into the merge step (that would contradict the outer checker gate).
  expect(text).toMatch(/merge nothing|do not merge either/i)
})

test('adjudication sub-list does not collide with outer step numbering (exactly one outer "9.")', async () => {
  registerOpenRalphSkills()
  const engage = getBundledSkills().find(command => command.name === 'openralph')!
  const blocks = await engage.getPromptForCommand('', {} as never)
  const text = (blocks[0] as { text: string }).text

  // A model reading the contract sequentially must see exactly ONE line that
  // starts with "9." — the outer checker gate. The adjudication procedure's
  // items must be lettered (a., b., ...) so they never render as a competing
  // outer step.
  const outerNines = text.match(/^9\./gm) ?? []
  expect(outerNines).toHaveLength(1)

  // Same guarantee for scheduler-contract steps 4-10 (1-3 also appear in the
  // unrelated install section, so they are excluded from this check).
  for (const n of [4, 5, 6, 7, 8, 10]) {
    const matches = text.match(new RegExp(`^${n}\\.`, 'gm')) ?? []
    expect(matches.length).toBeLessThanOrEqual(1)
  }

  // The adjudication procedure must use lettered items, visibly nested under
  // the adjudication section rather than bare outer numbers.
  expect(text).toMatch(/^a\. /m)
})

test('adjudicated dispatch verdict comparison uses gaps count and tests_passed', async () => {
  registerOpenRalphSkills()
  const engage = getBundledSkills().find(command => command.name === 'openralph')!
  const blocks = await engage.getPromptForCommand('', {} as never)
  const text = (blocks[0] as { text: string }).text

  // Contract must specify the comparison criteria: goal_met, gaps count, tests_passed.
  // This ensures the selector is deterministic rather than arbitrary.
  expect(text).toContain('gaps')
  expect(text).toContain('tests_passed')
})

// ─────────────────────────────────────────────────────────────────────────────

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

// ── Loop lineage tests ────────────────────────────────────────────────────────

test('bootstrap initializes session.json with an empty lineage array', () => {
  const bootstrap = OPENRALPH_FILES['bin/openralph-bootstrap.sh']
  // The Python block that writes session.json must include the lineage key.
  expect(bootstrap).toContain('"lineage"')
  expect(bootstrap).toContain('"lineage": []')
})

test('adopt script is registered in OPENRALPH_FILES', () => {
  const key = 'bin/openralph-adopt.sh'
  expect(key in OPENRALPH_FILES).toBe(true)
  const script = (OPENRALPH_FILES as Record<string, string>)[key]
  // Must be a valid bash script.
  expect(script).toContain('#!/usr/bin/env bash')
  expect(script).toContain('set -euo pipefail')
})

test('adopt script uses copy-not-move semantics — cp, never mv or rename, for orphan files', () => {
  const script = (OPENRALPH_FILES as Record<string, string>)['bin/openralph-adopt.sh']
  // Files must be copied into the new dir, NOT moved or renamed.
  expect(script).toContain('cp "$ORPHAN_STATE_DIR/')
  // Explicit absence: no mv or rename of the orphan files.
  expect(script).not.toMatch(/mv "\$ORPHAN_STATE_DIR/)
  expect(script).not.toMatch(/rename.*ORPHAN/)
  // The originals-preserved note must be in the script (as comment or echo).
  expect(script).toContain('preserved')
})

test('adopt script appends to lineage — composing ancestor chain from orphan', () => {
  const script = (OPENRALPH_FILES as Record<string, string>)['bin/openralph-adopt.sh']
  // Must read the orphan's existing lineage array and carry it forward.
  expect(script).toContain('ancestor_lineage')
  // Must append the adoption event with ancestor and adopted_at fields.
  expect(script).toContain('"ancestor"')
  expect(script).toContain('"adopted_at"')
  // Must use the orphan session id as the ancestor value.
  expect(script).toContain('orphan_sid')
})

test('adopt script updates active-session pointer to the new session', () => {
  const script = (OPENRALPH_FILES as Record<string, string>)['bin/openralph-adopt.sh']
  // active-session file must be updated to the NEW session id.
  expect(script).toContain('> "$RALPH_DIR/active-session"')
  // enabled marker must be created/touched.
  expect(script).toContain('touch "$RALPH_DIR/enabled"')
  // active-session.json must be updated from the new session dir.
  expect(script).toContain('active-session.json')
})

test('adopt script liveness heuristic: refuses only when orphan is active AND enabled AND bridge is fresh', () => {
  const script = (OPENRALPH_FILES as Record<string, string>)['bin/openralph-adopt.sh']
  // Must check the active-session pointer.
  expect(script).toContain('ACTIVE_SESSION')
  // Must check the enabled marker.
  expect(script).toContain('ENABLED')
  // Both conditions together open the staleness branch (AND logic).
  expect(script).toContain('"$ACTIVE_SESSION" == "$ORPHAN_SID" && -f "$ENABLED"')
  // Error message must point to the disengage script.
  expect(script).toContain('openralph-disengage.sh')
})

test('adopt script staleness check: bridge heartbeat mtime with 600s default and env override', () => {
  const script = (OPENRALPH_FILES as Record<string, string>)['bin/openralph-adopt.sh']
  // The heartbeat is the per-session bridge file the hook overwrites on every event.
  expect(script).toContain('bridges/$ORPHAN_SID.json')
  // mtime read via portable python3 stdlib (matches script style, no stat -f/-c divergence).
  expect(script).toContain('os.path.getmtime')
  // Default threshold 600 seconds, overridable via OPENRALPH_ADOPT_STALE_SECONDS.
  expect(script).toContain('OPENRALPH_ADOPT_STALE_SECONDS')
  expect(script).toContain(':-600}')
  // Missing bridge file must also count as crashed (getmtime failure -> -1 sentinel).
  expect(script).toContain('"$BRIDGE_AGE" -lt 0')
  // Stale comparison against the threshold.
  expect(script).toContain('"$BRIDGE_AGE" -gt "$STALE_SECONDS"')
  // Must explain why it proceeded ("treating as crashed").
  expect(script).toContain('treating as crashed')
})

test('adopt script --force flag skips liveness refusal with a warning', () => {
  const script = (OPENRALPH_FILES as Record<string, string>)['bin/openralph-adopt.sh']
  // --force must be parsed as a flag.
  expect(script).toContain('--force) FORCE="1"')
  // Forced adoption must still warn that a live loop may be running.
  expect(script).toContain('WARNING: --force')
  expect(script).toMatch(/live loop may (still )?be running/)
  // Usage line must document the flag.
  expect(script).toContain('openralph-adopt.sh [--force] <orphan_session_id>')
})

test('adopt script refusal message mentions both the staleness rule and --force', () => {
  const script = (OPENRALPH_FILES as Record<string, string>)['bin/openralph-adopt.sh']
  // Only a FRESH bridge triggers refusal — the message must say the heartbeat is fresh.
  expect(script).toContain('looks live')
  expect(script).toContain('fresh')
  // The refusal must offer the staleness escape (env var) and the --force escape.
  expect(script).toMatch(/Cannot adopt[\s\S]*OPENRALPH_ADOPT_STALE_SECONDS/)
  expect(script).toMatch(/Cannot adopt[\s\S]*--force/)
})

test('status script prints lineage chain when session has non-empty lineage', () => {
  const status = OPENRALPH_FILES['bin/openralph-status.sh']
  // Must read lineage from session.json.
  expect(status).toContain('lineage')
  // Must print a "lineage:" labelled line.
  expect(status).toContain('"lineage: "')
  // Must use ancestor fields to build the chain.
  expect(status).toContain('"ancestor"')
})

test('scheduler contract mentions adopt script and treats adopted progress.md/queue.md as authoritative', async () => {
  registerOpenRalphSkills()
  const engage = getBundledSkills().find(command => command.name === 'openralph')!
  const blocks = await engage.getPromptForCommand('', {} as never)
  const text = (blocks[0] as { text: string }).text

  // Must name the adopt script.
  expect(text).toContain('openralph-adopt.sh')

  // Must describe the adopted files as authoritative history (not stale data to re-derive).
  expect(text).toMatch(/authoritative|authoritative history/i)

  // Must mention lineage field.
  expect(text).toContain('lineage')
})

// ── duration_s capture tests ──────────────────────────────────────────────────

test('hook PreToolUse Agent writes a start-marker file keyed by tool_use_id', () => {
  const hook = OPENRALPH_FILES['bin/openralph-hook.sh']
  // PreToolUse block must be gated on EVENT==PreToolUse, TOOL_NAME==Agent, and
  // a non-empty TOOL_USE_ID so it never fires for non-Agent events.
  expect(hook).toContain('"$EVENT" == "PreToolUse" && "$TOOL_NAME" == "Agent"')
  expect(hook).toContain('-n "$TOOL_USE_ID"')
  // The marker path must be keyed by tool_use_id so pre/post pairs correlate exactly.
  expect(hook).toMatch(/start-.*TOOL_USE_ID/)
  // The write must use time.time() — wall-clock — because pre and post are separate
  // subprocess invocations; time.monotonic() would not correlate across them.
  expect(hook).toContain('time.time()')
  // The entire block must be silenced (|| true) so a failing marker write never
  // blocks the PreToolUse hook or causes a permission denial.
  const preBlock = hook.slice(
    hook.indexOf('"$EVENT" == "PreToolUse"'),
    hook.indexOf('# ─────────────────────────────────────────────────────────────────────────────\n\n# ── Routing'),
  )
  expect(preBlock).toContain('|| true')
})

test('hook PostToolUse ledger block reads start-marker and computes integer duration_s', () => {
  const hook = OPENRALPH_FILES['bin/openralph-hook.sh']
  // START_MARKER env var must be set from RALPH_DIR/bridges/start-${TOOL_USE_ID}
  // before the Python ledger block runs.
  expect(hook).toContain('START_MARKER=')
  expect(hook).toContain('export TOOL_RESPONSE TOOL_RESPONSE_JSON TOOL_INPUT_RAW START_MARKER')
  // Python must read the marker and cast elapsed to int.
  expect(hook).toContain('duration_s = int(time.time() - start_ts)')
  // All failure paths must leave duration_s None (try/except wraps the read).
  const afterStartMarker = hook.slice(hook.indexOf('duration_s = None'))
  expect(afterStartMarker).toContain('except Exception:')
  // The start marker must be deleted after duration capture (cleanup before ledger write).
  expect(hook).toContain('os.remove(start_marker)')
})

test('hook serial-assumption comment is present in the PreToolUse block', () => {
  const hook = OPENRALPH_FILES['bin/openralph-hook.sh']
  // The comment must document why tool_use_id keying is preferred over a serial slot,
  // and note that the serial dispatch assumption is what makes the fallback safe.
  expect(hook).toContain('serially')
  expect(hook).toContain('tool_use_id')
  // Comment must explain the overlap/overwrite behaviour for the non-serial edge case.
  expect(hook).toMatch(/overwrite|second PreToolUse/)
})

test('hook PreToolUse to PostToolUse round-trip produces integer duration_s in ledger', () => {
  // Build a shared temp project root so both hook invocations share the bridges dir.
  const root = mkdtempSync(join(tmpdir(), 'openralph-duration-'))
  mkdirSync(join(root, '.openclaude', 'ralph'), { recursive: true })
  writeFileSync(join(root, '.openclaude', 'ralph', 'enabled'), '')
  const hookPath = join(root, 'openralph-hook.sh')
  writeFileSync(hookPath, OPENRALPH_FILES['bin/openralph-hook.sh'])

  const spawnHook = (payload: Record<string, unknown>) =>
    Bun.spawnSync(['bash', hookPath], {
      cwd: root,
      env: { ...process.env, OPENRALPH_PROJECT_ROOT: root },
      stdin: Buffer.from(JSON.stringify(payload)),
    })

  const TOOL_USE_ID = 'tuid-duration-test-001'

  // 1. PreToolUse — writes the start marker.
  const pre = spawnHook({
    hook_event_name: 'PreToolUse',
    tool_name: 'Agent',
    tool_use_id: TOOL_USE_ID,
    tool_input: { subagent_type: 'openralph-builder', prompt: 'build' },
    session_id: 'dur-sess',
    cwd: root,
    transcript_path: '/dev/null',
  })
  expect(pre.exitCode).toBe(0)
  // Marker file must exist after PreToolUse.
  const markerPath = join(root, '.openclaude', 'ralph', 'bridges', `start-${TOOL_USE_ID}.ts`)
  expect(existsSync(markerPath)).toBe(true)

  // 2. PostToolUse — reads the marker and writes the ledger row.
  const personaYaml = [
    '```yaml',
    'task_slug: "dur-test-task"',
    'status: "complete"',
    'commit: null',
    'files_changed: []',
    'tests_run: null',
    'tests_passed: true',
    'provider_model_used: "anthropic/claude-sonnet-4-5"',
    'new_gaps: []',
    'next_action: null',
    'notes: "duration test"',
    '```',
  ].join('\n')

  const post = spawnHook({
    hook_event_name: 'PostToolUse',
    tool_name: 'Agent',
    tool_use_id: TOOL_USE_ID,
    tool_input: { subagent_type: 'openralph-builder', prompt: 'build' },
    tool_response: `Work done.\n\n${personaYaml}\n`,
    session_id: 'dur-sess',
    cwd: root,
    transcript_path: '/dev/null',
  })
  expect(post.exitCode).toBe(0)
  expect(post.stderr.toString()).not.toContain('Traceback')

  // Marker must be cleaned up after PostToolUse.
  expect(existsSync(markerPath)).toBe(false)

  // Ledger must contain one row with an integer duration_s >= 0.
  const ledgerPath = join(root, '.openclaude', 'ralph', 'ledger', 'outcomes.jsonl')
  expect(existsSync(ledgerPath)).toBe(true)
  const record = JSON.parse(readFileSync(ledgerPath, 'utf8').trim()) as Record<string, unknown>
  expect(record.task_slug).toBe('dur-test-task')
  expect(typeof record.duration_s).toBe('number')
  expect(Number.isInteger(record.duration_s)).toBe(true)
  expect(record.duration_s as number).toBeGreaterThanOrEqual(0)
})

// ── task_category capture tests ───────────────────────────────────────────────

test('scheduler contract step 3 instructs category: field when writing queue items', async () => {
  registerOpenRalphSkills()
  const engage = getBundledSkills().find(command => command.name === 'openralph')!
  const blocks = await engage.getPromptForCommand('', {} as never)
  const text = (blocks[0] as { text: string }).text

  // Step 3 must reference the category field on queue items.
  expect(text).toContain('category:')

  // Vocabulary must be spelled out exactly so the scheduler can act without ambiguity.
  for (const v of ['implementation', 'debugging', 'research', 'refactoring', 'verification', 'other']) {
    expect(text).toContain(v)
  }
})

test('PERSONA_RESULT_SCHEMA in openRalphAgents.ts contains task_category field', () => {
  const source = readFileSync(
    'src/tools/AgentTool/built-in/openRalphAgents.ts',
    'utf8',
  )
  // The shared PERSONA_RESULT_SCHEMA constant must include the task_category field.
  expect(source).toContain('task_category:')
  // The vocabulary comment must be present so personas know valid values.
  expect(source).toMatch(/implementation.*debugging.*research.*refactoring|debugging.*implementation/)
})

test('hook extractor round-trip: task_category in persona YAML flows through to JSONL record', () => {
  const personaYaml = [
    '```yaml',
    'task_slug: "add-category-field"',
    'task_category: "implementation"',
    'status: "complete"',
    'commit: "def5678"',
    'files_changed:',
    '  - "src/bar.ts"',
    'tests_run: "bun test src/bar.test.ts"',
    'tests_passed: true',
    'provider_model_used: "anthropic/claude-sonnet-4-6"',
    'new_gaps: []',
    'next_action: "none"',
    'notes: "task_category round-trip"',
    '```',
  ].join('\n')

  const { root, exitCode, stderr } = runHookSubprocess({
    hook_event_name: 'PostToolUse',
    tool_name: 'Agent',
    tool_input: { subagent_type: 'openralph-builder', prompt: 'implement the thing' },
    tool_response: `Done.\n\n${personaYaml}\n`,
    session_id: 'cat-sess',
    cwd: 'test-cwd',
    transcript_path: 'test-transcript',
  })

  expect(exitCode).toBe(0)
  expect(stderr).not.toContain('Traceback')

  const ledgerPath = join(root, '.openclaude', 'ralph', 'ledger', 'outcomes.jsonl')
  expect(existsSync(ledgerPath)).toBe(true)

  const lines = readFileSync(ledgerPath, 'utf8').trim().split('\n')
  expect(lines).toHaveLength(1)

  const record = JSON.parse(lines[0]!) as Record<string, unknown>
  expect(record.task_slug).toBe('add-category-field')
  expect(record.task_category).toBe('implementation')
  expect(record.status).toBe('complete')
})

test('hook extractor round-trip: absent task_category in YAML → null in JSONL record', () => {
  const personaYaml = [
    '```yaml',
    'task_slug: "no-category-task"',
    'status: "complete"',
    'commit: null',
    'files_changed: []',
    'tests_run: null',
    'tests_passed: true',
    'provider_model_used: "anthropic/claude-haiku-4-5"',
    'new_gaps: []',
    'next_action: null',
    'notes: "no category"',
    '```',
  ].join('\n')

  const { root, exitCode } = runHookSubprocess({
    hook_event_name: 'PostToolUse',
    tool_name: 'Agent',
    tool_input: { subagent_type: 'openralph-refiner', prompt: 'refine it' },
    tool_response: `Refined.\n\n${personaYaml}\n`,
    session_id: 'nocat-sess',
    cwd: 'test-cwd',
    transcript_path: 'test-transcript',
  })

  expect(exitCode).toBe(0)

  const ledgerPath = join(root, '.openclaude', 'ralph', 'ledger', 'outcomes.jsonl')
  const record = JSON.parse(readFileSync(ledgerPath, 'utf8').trim()) as Record<string, unknown>
  // task_category absent in YAML → null in record (never fails the hook)
  expect(record.task_category).toBeNull()
})

// ── Gap 4: goal_met extraction + checker↔worker join ─────────────────────────

test('hook extractor round-trip: goal_met: true in checker YAML flows to JSONL record', () => {
  const checkerYaml = [
    '```yaml',
    'task_slug: "feat-route-stats"',
    'task_category: "verification"',
    'status: "complete"',
    'provider_model_used: "openai-compatible/gpt-5.3-codex"',
    'goal_met: true',
    'evidence:',
    '  - "bun test passed"',
    'gaps: []',
    'proof_command_exit_code: 0',
    'notes: "all good"',
    '```',
  ].join('\n')

  const { root, exitCode, stderr } = runHookSubprocess({
    hook_event_name: 'PostToolUse',
    tool_name: 'Agent',
    tool_input: { subagent_type: 'openralph-checker', prompt: 'check the goal' },
    tool_response: `Verification done.\n\n${checkerYaml}\n`,
    session_id: 'checker-sess',
    cwd: 'test-cwd',
    transcript_path: 'test-transcript',
  })

  expect(exitCode).toBe(0)
  expect(stderr).not.toContain('Traceback')

  const ledgerPath = join(root, '.openclaude', 'ralph', 'ledger', 'outcomes.jsonl')
  expect(existsSync(ledgerPath)).toBe(true)

  const lines = readFileSync(ledgerPath, 'utf8').trim().split('\n')
  expect(lines).toHaveLength(1)

  const record = JSON.parse(lines[0]!) as Record<string, unknown>
  expect(record.persona).toBe('openralph-checker')
  expect(record.task_slug).toBe('feat-route-stats')
  expect(record.goal_met).toBe(true)
  expect(record.status).toBe('complete')
})

test('hook extractor round-trip: goal_met: false in checker YAML → false in record', () => {
  const checkerYaml = [
    '```yaml',
    'task_slug: "feat-failing"',
    'task_category: "verification"',
    'status: "complete"',
    'provider_model_used: "openai-compatible/gpt-5.3-codex"',
    'goal_met: false',
    'evidence:',
    '  - "tests failed"',
    'gaps:',
    '  - "missing coverage"',
    'proof_command_exit_code: 1',
    'notes: "needs more work"',
    '```',
  ].join('\n')

  const { root, exitCode } = runHookSubprocess({
    hook_event_name: 'PostToolUse',
    tool_name: 'Agent',
    tool_input: { subagent_type: 'openralph-checker', prompt: 'check' },
    tool_response: `Failed.\n\n${checkerYaml}\n`,
    session_id: 'checker-fail-sess',
    cwd: 'test-cwd',
    transcript_path: 'test-transcript',
  })

  expect(exitCode).toBe(0)
  const ledgerPath = join(root, '.openclaude', 'ralph', 'ledger', 'outcomes.jsonl')
  const record = JSON.parse(readFileSync(ledgerPath, 'utf8').trim()) as Record<string, unknown>
  expect(record.goal_met).toBe(false)
})

test('hook extractor round-trip: absent goal_met in worker YAML → null in record', () => {
  const workerYaml = [
    '```yaml',
    'task_slug: "worker-no-goal-met"',
    'status: "complete"',
    'commit: null',
    'files_changed: []',
    'tests_run: null',
    'tests_passed: true',
    'provider_model_used: "anthropic/claude-sonnet-4-6"',
    'new_gaps: []',
    'next_action: null',
    'notes: "worker row"',
    '```',
  ].join('\n')

  const { root, exitCode } = runHookSubprocess({
    hook_event_name: 'PostToolUse',
    tool_name: 'Agent',
    tool_input: { subagent_type: 'openralph-builder', prompt: 'build' },
    tool_response: `Done.\n\n${workerYaml}\n`,
    session_id: 'worker-sess',
    cwd: 'test-cwd',
    transcript_path: 'test-transcript',
  })

  expect(exitCode).toBe(0)
  const ledgerPath = join(root, '.openclaude', 'ralph', 'ledger', 'outcomes.jsonl')
  const record = JSON.parse(readFileSync(ledgerPath, 'utf8').trim()) as Record<string, unknown>
  // Worker rows should have goal_met: null (not a checker, no goal_met in YAML)
  expect(record.goal_met).toBeNull()
})

test('scheduler contract step 4 mandates task_slug in every dispatch brief', async () => {
  registerOpenRalphSkills()
  const engage = getBundledSkills().find(command => command.name === 'openralph')!
  const blocks = await engage.getPromptForCommand('', {} as never)
  const text = (blocks[0] as { text: string }).text

  // Step 4 must mention task_slug as a required field in the brief
  expect(text).toContain('task_slug:')
  // Must explain that it flows to the persona result YAML for ledger join
  expect(text).toMatch(/task_slug.*brief|brief.*task_slug/i)
  // Must mention the join / ledger join purpose
  expect(text).toMatch(/join|routing ledger/i)
})

test('scheduler contract step 9 passes task_slug to checker dispatch for ledger join', async () => {
  registerOpenRalphSkills()
  const engage = getBundledSkills().find(command => command.name === 'openralph')!
  const blocks = await engage.getPromptForCommand('', {} as never)
  const text = (blocks[0] as { text: string }).text

  // Step 9 must pass task_slug to the checker so the verdict can be joined to the worker row
  const step9Start = text.indexOf('9.')
  const step9End = text.indexOf('10.')
  const step9 = text.slice(step9Start, step9End)
  expect(step9).toContain('task_slug')
  expect(step9).toMatch(/task_slug.*checker|checker.*task_slug/i)
})

test('checker PERSONA_RESULT_SCHEMA in openRalphAgents.ts contains TASK_SLUG RULE', () => {
  const source = readFileSync(
    'src/tools/AgentTool/built-in/openRalphAgents.ts',
    'utf8',
  )
  // The TASK_SLUG RULE comment must be present in the checker prompt
  expect(source).toContain('TASK_SLUG RULE')
  // Must explain the join purpose (ledger joins checker verdicts to worker rows)
  expect(source).toMatch(/routing ledger.*join|join.*routing ledger/i)
  // Must instruct the checker to echo the EXACT same task_slug
  expect(source).toMatch(/EXACT.*task_slug|exact.*task_slug/i)
})

test('route-stats script skips checker rows from worker aggregation', () => {
  const script = (OPENRALPH_FILES as Record<string, string>)['bin/openralph-route-stats.sh']
  // Must skip rows whose persona ends with "-checker" in the aggregation loop
  expect(script).toContain('endswith("-checker")')
  // Must still build a checker verdict index (checker_by_slug or similar)
  expect(script).toMatch(/checker_by_slug|checker.*slug/i)
  // The checker-verified join must use goal_met from the checker row
  expect(script).toContain('goal_met')
})

test('route-stats script emits n_verified and verified_rate columns when checker data exists', () => {
  const script = (OPENRALPH_FILES as Record<string, string>)['bin/openralph-route-stats.sh']
  // Must produce n_verified column
  expect(script).toContain('n_verified')
  // Must produce verified_rate column
  expect(script).toContain('verified_rate')
  // Must gracefully skip (any_verified check) when no checker rows exist
  expect(script).toContain('any_verified')
})

// ── Finding 1: kick other-session liveness guard ──────────────────────────────

test('kick write_kick_state guards against re-pointing away from a live other session', () => {
  const script = (OPENRALPH_FILES as Record<string, string>)['bin/openralph-kick.sh']
  // The guard must fire when active != sid (a different session is live), not only
  // when active == sid. The elif branch distinguishes the two cases.
  expect(script).toContain('"$active" != "$sid"')
  // Must check the OTHER session's bridge file (keyed by $active, not $sid).
  expect(script).toContain('"$RALPH_DIR/bridges/$active.json"')
  // Staleness threshold must reuse OPENRALPH_ADOPT_STALE_SECONDS (not a new name)
  // so adopt and kick stay consistent.
  expect(script).toContain('OPENRALPH_ADOPT_STALE_SECONDS')
  // The -1 sentinel for a missing bridge must be handled (same as adopt).
  expect(script).toContain('"$bridge_age" -ge 0')
})

test('kick other-session refusal message names the live session, the staleness rule, and --force', () => {
  const script = (OPENRALPH_FILES as Record<string, string>)['bin/openralph-kick.sh']
  // The refusal message must name --force so the user knows how to override.
  expect(script).toMatch(/Re-pointing active-session[\s\S]*--force|--force[\s\S]*Re-pointing active-session/)
  // Must mention OPENRALPH_ADOPT_STALE_SECONDS so the user can tune it.
  const refusalBlock = script.slice(script.indexOf('Re-pointing active-session'))
  expect(refusalBlock.slice(0, 400)).toContain('OPENRALPH_ADOPT_STALE_SECONDS')
  // Exit code must be 2 (same as the same-session guard).
  expect(script).toContain('exit 2')
})

// ── Finding 6: buildKickPrompt verb distinction ───────────────────────────────

test('buildKickPrompt contains verb-distinction sentence for kick, resume, and disengage', async () => {
  registerOpenRalphSkills()
  const kick = getBundledSkills().find(command => command.name === 'openralph-kick')!
  const blocks = await kick.getPromptForCommand('', {} as never)
  const text = (blocks[0] as { text: string }).text

  // Must name all three lifecycle verbs in one distinguishing statement.
  expect(text).toMatch(/kick\s*=/)
  expect(text).toMatch(/resume\s*=/)
  expect(text).toMatch(/disengage\s*=/)
  // kick = shell-level re-entry markers
  expect(text).toContain('shell-level')
  // resume = model-driven continuation
  expect(text).toContain('model-driven')
})

// ── Gap 3: token usage capture ────────────────────────────────────────────────

test('hook script contains JSON-parse block for token extraction and billing_model heuristic', () => {
  const hook = OPENRALPH_FILES['bin/openralph-hook.sh']

  // json.loads path must be present (Gap 3 extraction block)
  expect(hook).toContain('json.loads(tool_response_json)')

  // billing_model heuristic must reference the three tiers
  expect(hook).toContain('"free"')
  expect(hook).toContain('"subscription"')
  expect(hook).toContain('"metered"')

  // billing_model must mirror modelRegistry.ts billingModel() decision inputs
  expect(hook).toContain('anthropic-proxy')
  expect(hook).toContain('codex')
  expect(hook).toContain('localhost')

  // The no-dollars comment must be present (tokens are the honest unit)
  expect(hook).toMatch(/do NOT compute dollars|NOT compute dollars/i)
  // Must not compute cost values — no cost/price variable assignments
  expect(hook).not.toMatch(/cost\s*=\s*|price\s*=\s*/i)

  // CAVEAT comment: AgentToolResult.usage is final-turn only
  expect(hook).toMatch(/FINAL assistant turn|final assistant turn/i)

  // New fields must appear in the JSONL record dict
  expect(hook).toContain('"input_tokens"')
  expect(hook).toContain('"output_tokens"')
  expect(hook).toContain('"cache_read_tokens"')
  expect(hook).toContain('"cache_write_tokens"')
  expect(hook).toContain('"service_tier"')
  expect(hook).toContain('"billing_model"')
})

test('hook billing_model heuristic: subscription/free/metered/null cases', () => {
  const hook = OPENRALPH_FILES['bin/openralph-hook.sh']

  // anthropic-proxy → subscription
  expect(hook).toContain('pmu.startswith("anthropic-proxy")')
  // codex keyword → subscription
  expect(hook).toContain('"codex" in pmu')
  // localhost/127.0.0.1 → free
  expect(hook).toContain('"localhost" in pmu or "127.0.0.1" in pmu')
  // null when no provider_model_used (guarded by `if provider_model_used:`)
  expect(hook).toContain('if provider_model_used:')
})

test('hook AgentToolResult round-trip: token fields and billing_model land in ledger', () => {
  // Construct a minimal AgentToolResult-shaped object and wrap it in a JSON
  // string that also carries the persona YAML inside content[0].text.
  // This exercises the dual-read: json.loads extracts tokens AND the YAML
  // regex finds the fence in the content text.
  const personaYaml = [
    '```yaml',
    'task_slug: "token-roundtrip-task"',
    'task_category: "implementation"',
    'status: "complete"',
    'commit: "abc1234"',
    'files_changed: []',
    'tests_run: null',
    'tests_passed: true',
    'provider_model_used: "anthropic/claude-sonnet-4-6"',
    'new_gaps: []',
    'next_action: null',
    'notes: "token round-trip test"',
    '```',
  ].join('\n')

  // Build AgentToolResult-shaped JSON; content[0].text carries the YAML.
  const agentToolResult = {
    agentId: 'test-agent-001',
    agentType: 'openralph-builder',
    content: [{ type: 'text', text: `Work done.\n\n${personaYaml}\n` }],
    totalToolUseCount: 3,
    totalDurationMs: 12000,
    totalTokens: 1050,
    usage: {
      input_tokens: 900,
      output_tokens: 150,
      cache_read_input_tokens: 200,
      cache_creation_input_tokens: 50,
      server_tool_use: null,
      service_tier: 'standard',
      cache_creation: null,
    },
  }

  // tool_response is the JSON-serialized AgentToolResult passed as a
  // nested object in the outer hook input (the harness does JSON.stringify
  // on the full hookInput, so tool_response ends up as a JSON sub-object).
  const { root, exitCode, stderr } = runHookSubprocess({
    hook_event_name: 'PostToolUse',
    tool_name: 'Agent',
    tool_input: { subagent_type: 'openralph-builder', prompt: 'build the thing' },
    tool_response: agentToolResult,
    session_id: 'token-sess',
    cwd: 'test-cwd',
    transcript_path: 'test-transcript',
  })

  expect(exitCode).toBe(0)
  expect(stderr).not.toContain('Traceback')
  expect(stderr).not.toContain('SyntaxError')

  const ledgerPath = join(root, '.openclaude', 'ralph', 'ledger', 'outcomes.jsonl')
  expect(existsSync(ledgerPath)).toBe(true)

  const lines = readFileSync(ledgerPath, 'utf8').trim().split('\n')
  expect(lines).toHaveLength(1)

  const record = JSON.parse(lines[0]!) as Record<string, unknown>

  // Core YAML fields extracted correctly (confirms YAML regex works on content[0].text)
  expect(record.task_slug).toBe('token-roundtrip-task')
  expect(record.status).toBe('complete')
  expect(record.tests_passed).toBe(true)
  expect(record.provider_model_used).toBe('anthropic/claude-sonnet-4-6')

  // Token fields from AgentToolResult.usage
  expect(record.input_tokens).toBe(900)
  expect(record.output_tokens).toBe(150)
  expect(record.cache_read_tokens).toBe(200)
  expect(record.cache_write_tokens).toBe(50)
  expect(record.service_tier).toBe('standard')

  // billing_model inferred from provider_model_used ('anthropic/...' → metered)
  expect(record.billing_model).toBe('metered')
})

test('hook token fields are null when tool_response is plain text (no AgentToolResult JSON)', () => {
  // Plain-text tool_response (existing behavioral tests) → tokens null, YAML works
  const personaYaml = [
    '```yaml',
    'task_slug: "plain-text-tokens-null"',
    'status: "complete"',
    'commit: null',
    'files_changed: []',
    'tests_run: null',
    'tests_passed: true',
    'provider_model_used: "openai-compatible/gpt-5.3-codex"',
    'new_gaps: []',
    'next_action: null',
    'notes: "plain text path"',
    '```',
  ].join('\n')

  const { root, exitCode, stderr } = runHookSubprocess({
    hook_event_name: 'PostToolUse',
    tool_name: 'Agent',
    tool_input: { subagent_type: 'openralph-builder', prompt: 'build' },
    tool_response: `Done.\n\n${personaYaml}\n`,
    session_id: 'plain-sess',
    cwd: 'test-cwd',
    transcript_path: 'test-transcript',
  })

  expect(exitCode).toBe(0)
  expect(stderr).not.toContain('Traceback')

  const ledgerPath = join(root, '.openclaude', 'ralph', 'ledger', 'outcomes.jsonl')
  expect(existsSync(ledgerPath)).toBe(true)
  const record = JSON.parse(readFileSync(ledgerPath, 'utf8').trim()) as Record<string, unknown>

  // YAML extraction still works on plain-text tool_response
  expect(record.task_slug).toBe('plain-text-tokens-null')
  expect(record.status).toBe('complete')

  // Token fields are null when tool_response is not a JSON AgentToolResult
  expect(record.input_tokens).toBeNull()
  expect(record.output_tokens).toBeNull()
  expect(record.cache_read_tokens).toBeNull()
  expect(record.cache_write_tokens).toBeNull()
  expect(record.service_tier).toBeNull()

  // billing_model still inferred from provider_model_used
  expect(record.billing_model).toBe('subscription') // codex → subscription
})

test('hook billing_model heuristic covers all three tiers across provider string patterns', () => {
  const cases: Array<{ provider_model_used: string; expected: 'subscription' | 'metered' | 'free' }> = [
    { provider_model_used: 'anthropic-proxy/claude-max', expected: 'subscription' },
    { provider_model_used: 'openai-compatible/gpt-5.3-codex', expected: 'subscription' },
    { provider_model_used: 'openai-compatible/codex-mini', expected: 'subscription' },
    { provider_model_used: 'anthropic/claude-sonnet-4-6', expected: 'metered' },
    { provider_model_used: 'openai-compatible/gpt-5.4', expected: 'metered' },
    { provider_model_used: 'gemini/gemini-2.5-pro', expected: 'metered' },
    { provider_model_used: 'localhost/llama-3', expected: 'free' },
    { provider_model_used: 'openai-compatible/127.0.0.1:11434/llama', expected: 'free' },
  ]

  for (const { provider_model_used, expected } of cases) {
    const personaYaml = [
      '```yaml',
      `task_slug: "billing-test-${expected}"`,
      'status: "complete"',
      'commit: null',
      'files_changed: []',
      'tests_run: null',
      'tests_passed: true',
      `provider_model_used: "${provider_model_used}"`,
      'new_gaps: []',
      'next_action: null',
      'notes: null',
      '```',
    ].join('\n')

    const { root, exitCode } = runHookSubprocess({
      hook_event_name: 'PostToolUse',
      tool_name: 'Agent',
      tool_input: { subagent_type: 'openralph-builder', prompt: 'build' },
      tool_response: `Done.\n\n${personaYaml}\n`,
      session_id: 'billing-heuristic-sess',
      cwd: 'test-cwd',
      transcript_path: 'test-transcript',
    })

    expect(exitCode).toBe(0)
    const ledgerPath = join(root, '.openclaude', 'ralph', 'ledger', 'outcomes.jsonl')
    const record = JSON.parse(readFileSync(ledgerPath, 'utf8').trim()) as Record<string, unknown>
    expect(record.billing_model).toBe(expected)
  }
})

// ── Gap 3: LedgerEntry shape ──────────────────────────────────────────────────

test('LedgerEntry type accepts all six new token/billing fields', () => {
  // Import and verify the TypeScript type accepts the fields at compile time.
  // We do this by constructing a valid LedgerEntry with all six fields and
  // asserting the values survive a JSONL round-trip through readLedgerEntries.
  const { readLedgerEntries, LEDGER_RELATIVE_PATH } = require('./../../utils/model/outcomeLedger.js') as typeof import('../../utils/model/outcomeLedger.js')

  const dir = mkdtempSync(join(tmpdir(), 'openralph-ledger-shape-'))
  const ledgerPath = join(dir, LEDGER_RELATIVE_PATH)
  mkdirSync(join(dir, '.limitless', 'ralph', 'ledger'), { recursive: true })

  const entry = {
    ts: '2026-06-10T00:00:00Z',
    session_id: 'shape-test',
    task_slug: 'shape-check',
    persona: 'openralph-builder',
    workload: 'long-running',
    provider_model_used: 'anthropic/claude-sonnet-4-6',
    status: 'complete',
    tests_passed: true,
    new_gaps: 0,
    duration_s: 120,
    goal_met: null,
    input_tokens: 500,
    output_tokens: 100,
    cache_read_tokens: 200,
    cache_write_tokens: 25,
    service_tier: 'standard',
    billing_model: 'metered' as const,
  }

  writeFileSync(ledgerPath, JSON.stringify(entry) + '\n', 'utf8')
  const [parsed] = readLedgerEntries(dir)

  expect((parsed as Record<string, unknown>).input_tokens).toBe(500)
  expect((parsed as Record<string, unknown>).output_tokens).toBe(100)
  expect((parsed as Record<string, unknown>).cache_read_tokens).toBe(200)
  expect((parsed as Record<string, unknown>).cache_write_tokens).toBe(25)
  expect((parsed as Record<string, unknown>).service_tier).toBe('standard')
  expect((parsed as Record<string, unknown>).billing_model).toBe('metered')

  // Clean up
  require('node:fs').rmSync(dir, { recursive: true })
})
