import { expect, test } from 'bun:test'
import type { Command } from '../../types/command.js'
import { searchLocalSkills, LocalSkillSearchTool } from './LocalSkillSearchTool.js'

const command = (name: string, disabled = false): Command => ({
  name, description: `Workflow for ${name}`, type: 'prompt', source: 'plugin',
  disableModelInvocation: disabled, contentLength: 100, progressMessage: name,
  async getPromptForCommand() { throw new Error('Discovery must not execute skills') },
})

test('search ranks exact names and excludes manual-only skills', () => {
  const result = JSON.parse(searchLocalSkills([command('finance-report'), command('finance'), command('finance-private', true)], 'finance'))
  expect(result.skills.map((s: { name: string }) => s.name)).toEqual(['finance', 'finance-report'])
})

test('all native names remain reachable across bounded pages', () => {
  const commands = Array.from({ length: 93 }, (_, i) => command(`plugin:workflow-${i}`))
  const names = new Set<string>()
  let offset: number | null = 0
  while (offset !== null) {
    const raw = searchLocalSkills(commands, '', offset, 20)
    expect(raw.length).toBeLessThanOrEqual(6000)
    const result = JSON.parse(raw)
    for (const row of result.skills) names.add(row.name)
    offset = result.next_offset
  }
  expect(names.size).toBe(93)
  expect(LocalSkillSearchTool.inputSchema.safeParse({ offset: -1 }).success).toBe(false)
})
