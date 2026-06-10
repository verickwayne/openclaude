import { registerBundledSkill } from '../bundledSkills.js'

function buildLongTaskPrompt(args: string): string {
  const target = args.trim()
  const taskBlock = target
    ? `Use this as the long-task objective:\n\n--- BEGIN OBJECTIVE ---\n${target}\n--- END OBJECTIVE ---`
    : 'Infer the long-task objective from the current conversation.'

  return `# /longtask — durable work ledger

${taskBlock}

Use this skill when the work is large enough that a future context window may need to resume it. If the task is a one-turn answer or a tiny edit, say that a ledger is unnecessary and do the direct work instead.

## Artifact

Create or update \`.limitless/longtask.json\` in the current repo (if a legacy \`.openclaude/longtask.json\` already exists, keep updating that file in place instead). Keep it valid JSON:

\`\`\`json
{
  "objective": "",
  "status": "running",
  "required_items": [
    {
      "id": "LT-1",
      "description": "",
      "status": "pending",
      "verification": ""
    }
  ],
  "current_focus": "",
  "verification_commands": [],
  "handoff": ""
}
\`\`\`

## Operating Rules

1. Inspect existing artifacts first: \`.limitless/longtask.json\` (or a legacy \`.openclaude/longtask.json\`), git status, recent git log, project instructions, and test scripts.
2. Treat \`required_items\` as the mechanical source of truth. After each milestone, re-read it and continue while any item is not complete.
3. Work on one item at a time unless independent items can be delegated cleanly.
4. Use available providers and models intentionally: fast models for read-only search and summarization, stronger models for architecture, implementation, and review.
5. For implementation that changes behavior, run the listed verification command or update the ledger with the exact command that should verify it.
6. Update \`handoff\` whenever the next context window would need facts that are not obvious from git history.
7. When all required items are complete, set \`status\` to \`complete\` and include the final verification commands and results in \`handoff\`.

Do not replace existing user work in the ledger. Merge new facts into it.`
}

export function registerLongTaskSkill(): void {
  registerBundledSkill({
    name: 'longtask',
    aliases: ['long-task'],
    description:
      'Create or update a durable JSON work ledger for long-running implementation tasks.',
    whenToUse:
      'When a task is multi-step, autonomous, likely to span context windows, or needs a mechanical checklist for completion.',
    argumentHint: '[objective]',
    userInvocable: true,
    async getPromptForCommand(args) {
      return [{ type: 'text', text: buildLongTaskPrompt(args) }]
    },
  })
}
