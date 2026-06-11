import { afterEach, expect, test } from 'bun:test'

import { clearBundledSkills, getBundledSkills } from '../bundledSkills.js'
import { registerLongTaskSkill } from './longTask.js'

afterEach(() => {
  clearBundledSkills()
})

test('/longtask registers and emits a durable ledger prompt', async () => {
  registerLongTaskSkill()

  const skill = getBundledSkills().find(command => command.name === 'longtask')
  expect(skill).toBeDefined()
  expect(skill?.aliases).toContain('long-task')

  const blocks = await skill!.getPromptForCommand('ship the provider picker', {} as never)
  const text = (blocks[0] as { text: string }).text

  expect(text).toContain('# /longtask')
  expect(text).toContain('ship the provider picker')
  expect(text).toContain('.limitless/longtask.json')
  expect(text).toContain('"required_items"')
  expect(text).toContain('mechanical source of truth')
})
