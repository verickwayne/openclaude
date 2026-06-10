#!/usr/bin/env bun
// Dump the fully-rendered system prompt limitless sends to the LLM.
// Stubs build-time globals so we can call getSystemPrompt without going
// through the full bundler.
// Run: NODE_ENV=test bun run scripts/dump-system-prompt.ts

;(globalThis as Record<string, unknown>).MACRO = {
  VERSION: '0.14.0',
  DISPLAY_VERSION: '0.14.0',
  BUILD_TIME: new Date().toISOString(),
  ISSUES_EXPLAINER: 'report the issue at https://github.com/Gitlawb/openclaude/issues',
  FEEDBACK_CHANNEL: 'https://github.com/Gitlawb/openclaude/issues',
  PACKAGE_URL: '@gitlawb/limitless',
  NATIVE_PACKAGE_URL: undefined,
}

const { getSystemPrompt } = await import('../src/constants/prompts.js')

const model = process.env.OPENAI_MODEL || 'qwen3-30b-abliterated-q6:latest'
const sections = await getSystemPrompt([], model, [], [])
const joined = sections.join('\n\n')

console.log('===== SYSTEM PROMPT (joined with \\n\\n, as sent to Ollama) =====\n')
console.log(joined)
console.log(`\n===== END (${sections.length} sections, ${joined.length} chars) =====`)
