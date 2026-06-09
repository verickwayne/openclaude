import { expect, test } from 'bun:test'

import { buildOpenClaudeCliArgs } from './dev-claude-max.ts'

test('Claude Max launcher forces default permission mode when none is specified', () => {
  expect(buildOpenClaudeCliArgs([])).toEqual(['--permission-mode', 'default'])
  expect(buildOpenClaudeCliArgs(['--version'])).toEqual([
    '--permission-mode',
    'default',
    '--version',
  ])
})

test('Claude Max launcher preserves explicit permission-mode selection', () => {
  expect(
    buildOpenClaudeCliArgs(['--permission-mode', 'auto', '--version']),
  ).toEqual(['--permission-mode', 'auto', '--version'])
  expect(
    buildOpenClaudeCliArgs(['--permission-mode=acceptEdits', '--version']),
  ).toEqual(['--permission-mode=acceptEdits', '--version'])
})

test('Claude Max launcher preserves explicit dangerous permission flags', () => {
  expect(
    buildOpenClaudeCliArgs(['--dangerously-skip-permissions', '--version']),
  ).toEqual(['--dangerously-skip-permissions', '--version'])
  expect(
    buildOpenClaudeCliArgs([
      '--allow-dangerously-skip-permissions',
      '--version',
    ]),
  ).toEqual(['--allow-dangerously-skip-permissions', '--version'])
})
