import { afterEach, expect, test } from 'bun:test'

import { clearBundledSkills, getBundledSkills } from '../bundledSkills.js'
import {
  LIMITLESS_TEAM_FILES,
  registerLimitlessTeamSkills,
} from './limitlessTeam.js'

const testGlobal = globalThis as typeof globalThis & {
  MACRO?: { VERSION: string }
}
testGlobal.MACRO ??= { VERSION: 'test' }

afterEach(() => {
  clearBundledSkills()
})

test('registers Limitless team skills and aliases', async () => {
  registerLimitlessTeamSkills()

  const skills = getBundledSkills()
  const names = skills.map(skill => skill.name)
  expect(names).toContain('limitless-team')
  expect(names).toContain('limitless-plan-review')
  expect(names).toContain('limitless-ship')
  expect(names).toContain('limitless-qa')
  expect(names).toContain('limitless-learn')
  expect(names).toContain('limitless-founder')
  expect(names).toContain('limitless-gtm')
  expect(names).toContain('limitless-finance')
  expect(names).toContain('limitless-ops')
  expect(names).toContain('limitless-integrations')
  expect(names).toContain('limitless-self-improve')

  const team = skills.find(skill => skill.name === 'limitless-team')
  expect(team?.aliases).toContain('gstack')
  expect(team?.aliases).toContain('agent-team')
  expect(team?.skillRoot).toBeDefined()

  const blocks = await team!.getPromptForCommand('build provider routing', {} as never)
  const text = (blocks[0] as { text: string }).text
  expect(text).toContain('# /limitless-team')
  expect(text).toContain('build provider routing')
  expect(text).toContain('limitless-founder-os')
  expect(text).toContain('limitless-product')
  expect(text).toContain('limitless-gtm')
  expect(text).toContain('limitless-integrations')
  expect(text).toContain('limitless-eng-lead')
  expect(text).toContain('.limitless/longtask.json')
})

test('Limitless team support files document routing and provider model usage', () => {
  expect(LIMITLESS_TEAM_FILES['README.md']).toContain('Limitless Team')
  expect(LIMITLESS_TEAM_FILES['team-map.md']).toContain('Provider/model routing')
  expect(LIMITLESS_TEAM_FILES['team-map.md']).toContain('Gmail')
  expect(LIMITLESS_TEAM_FILES['team-map.md']).toContain('limitless-reviewer')
  expect(LIMITLESS_TEAM_FILES['team-map.md']).toContain(
    'limitless-harness-improver',
  )
})

test('/limitless-integrations prompt covers MCP and Gmail tool design', async () => {
  registerLimitlessTeamSkills()
  const skill = getBundledSkills().find(
    command => command.name === 'limitless-integrations',
  )
  expect(skill).toBeDefined()
  expect(skill?.aliases).toContain('gmail-tools')
  expect(skill?.aliases).toContain('mcp')

  const blocks = await skill!.getPromptForCommand(
    'pull Gmail threads into a CRM follow-up workflow',
    {} as never,
  )
  const text = (blocks[0] as { text: string }).text
  expect(text).toContain('limitless-integrations')
  expect(text).toContain('MCP')
  expect(text).toContain('Gmail')
  expect(text).toContain('additionalProperties: false')
})

test('/limitless-self-improve prompt schedules a durable 4am harness review', async () => {
  registerLimitlessTeamSkills()
  const skill = getBundledSkills().find(
    command => command.name === 'limitless-self-improve',
  )
  expect(skill).toBeDefined()
  expect(skill?.aliases).toContain('nightly-improvement')

  const blocks = await skill!.getPromptForCommand('setup', {} as never)
  const text = (blocks[0] as { text: string }).text
  expect(text).toContain('0 4 * * *')
  expect(text).toContain('durable: true')
  expect(text).toContain('limitless-harness-improver')
  expect(text).toContain('.limitless/improvement/backlog.md')
  expect(text).toContain('Gmail')
  expect(text).toContain('MCP')
  expect(text).toContain('Do not edit harness code')
})
