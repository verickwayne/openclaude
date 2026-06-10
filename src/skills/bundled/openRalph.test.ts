import { afterEach, expect, test } from 'bun:test'
import { readFileSync } from 'fs'

import { clearBundledSkills, getBundledSkills } from '../bundledSkills.js'
import { registerOpenRalphSkills } from './openRalph.js'

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
