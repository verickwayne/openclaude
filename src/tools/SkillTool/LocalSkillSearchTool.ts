import { z } from 'zod/v4'
import { buildTool, type ToolDef } from '../../Tool.js'
import type { Command } from '../../types/command.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { getAllCommands } from './SkillTool.js'

const schema = lazySchema(() => z.object({
  query: z.string().default('').describe('Task keywords; empty browses all skills'),
  offset: z.number().int().nonnegative().default(0),
  limit: z.number().int().min(1).max(20).default(5),
}))
type Input = ReturnType<typeof schema>

export function searchLocalSkills(commands: Command[], query: string, offset = 0, limit = 5): string {
  const terms = new Set(query.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [])
  const matches = commands.filter(command => command.type === 'prompt' && !command.disableModelInvocation)
    .map(command => {
      const name = new Set(command.name.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [])
      const text = new Set(`${command.description} ${command.whenToUse ?? ''}`.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [])
      const score = [...terms].reduce((total, term) => total + (name.has(term) ? 5 : 0) + (text.has(term) ? 1 : 0), 0) + (query.trim().toLowerCase() === command.name.toLowerCase() ? 100 : 0)
      return { command, score }
    }).filter(row => terms.size === 0 || row.score > 0).sort((a, b) => b.score - a.score || a.command.name.localeCompare(b.command.name))
  const skills: { name: string; description: string }[] = []
  for (const { command } of matches.slice(offset, offset + limit)) {
    skills.push({ name: command.name, description: command.description.slice(0, 240) })
    if (JSON.stringify(skills).length > 5600) { skills.pop(); break }
  }
  return JSON.stringify({ skills, total: matches.length, next_offset: offset + skills.length < matches.length ? offset + skills.length : null, hint: 'Invoke Skill with the exact name to load its instructions.' })
}

export const LocalSkillSearchTool = buildTool({
  name: 'LocalSkillSearch', searchHint: 'find installed skills by task keywords', maxResultSizeChars: 6000,
  get inputSchema() { return schema() }, async description() { return 'Search installed skills without loading them' },
  async prompt() { return 'Search installed project, user, plugin, and MCP skills. Empty query browses all. Use next_offset for more results, then invoke Skill with a matching name.' },
  isEnabled() { return true }, isReadOnly() { return true }, isConcurrencySafe() { return true }, userFacingName() { return 'Search skills' },
  renderToolUseMessage({ query }) { return query || 'Browse installed skills' }, renderToolResultMessage() { return null }, renderToolUseRejectedMessage() { return null },
  async call({ query, offset, limit }, context) { return { data: searchLocalSkills(await getAllCommands(context), query, offset, limit) } },
  mapToolResultToToolResultBlockParam(data, toolUseID) { return { type: 'tool_result' as const, content: data, tool_use_id: toolUseID } },
} satisfies ToolDef<Input, string>)
