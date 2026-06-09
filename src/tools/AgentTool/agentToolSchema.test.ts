// src/tools/AgentTool/agentToolSchema.test.ts
import { expect, test } from 'bun:test'
import { agentToolInputSchema } from './AgentTool.js'

test('Task tool accepts an arbitrary provider model id', () => {
  const parsed = agentToolInputSchema.safeParse({
    description: 'x', prompt: 'y', model: 'openai/gpt-5.5',
  })
  expect(parsed.success).toBe(true)
})
test('Task tool still accepts the tier aliases', () => {
  expect(agentToolInputSchema.safeParse({ description: 'x', prompt: 'y', model: 'opus' }).success).toBe(true)
})
