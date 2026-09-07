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
  const skills = commands.filter(cmd => cmd.type === 'prompt' && !cmd.disableModelInvocation)
    .map(cmd => {
      const name = new Set(cmd.name.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [])
      const words = new Set(`${cmd.description} ${cmd.whenToUse ?? ''}`.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [])
      const score = [...terms].reduce((n, word) => n + (name.has(word) ? 5 : 0) + (words.has(word) ? 1 : 0), 0)
        + (query.trim().toLowerCase() === cmd.name.toLowerCase() ? 100 : 0)
      return { cmd, score }
    }).filter(row => !terms.size || row.score > 0)
    .sort((a, b) => b.score - a.score || a.cmd.name.localeCompare(b.cmd.name))
  const page: { name: string; description: string }[] = []
  const encode = () => JSON.stringify({ skills: page, total: skills.length,
    next_offset: offset + page.length < skills.length ? offset + page.length : null,
    hint: 'Invoke Skill with the exact name to load full instructions and linked files.' })
  for (const { cmd } of skills.slice(offset, offset + limit)) {
    page.push({ name: cmd.name, description: cmd.description.slice(0, 240) })
    if (encode().length > 6000) { page.pop(); break }
  }
  return encode()
}

export const LocalSkillSearchTool = buildTool({
  name: 'LocalSkillSearch',
  searchHint: 'find installed skills by task keywords',
  maxResultSizeChars: 6000,
  get inputSchema() { return schema() },
  async description() { return 'Search installed skills' },
  async prompt() { return 'Search installed project, user, plugin and MCP skills by task keywords. Empty query browses all. Follow next_offset to retrieve more results. Invoke the native Skill tool with a matching name to load instructions. Search does not execute skills.' },
  isEnabled() { return true },
  isReadOnly() { return true },
  isConcurrencySafe() { return true },
  userFacingName() { return 'Search skills' },
  renderToolUseMessage({ query }) { return query || 'Browse installed skills' },
  renderToolResultMessage() { return null },
  renderToolUseRejectedMessage() { return null },
  async call({ query, offset, limit }, context) {
    return { data: searchLocalSkills(await getAllCommands(context), query, offset, limit) }
  },
  mapToolResultToToolResultBlockParam(data, toolUseID) {
    return { type: 'tool_result' as const, content: data, tool_use_id: toolUseID }
  },
} satisfies ToolDef<Input, string>)
