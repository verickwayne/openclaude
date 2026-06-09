import { expect, test } from 'bun:test'

import { createTeamComms } from './spawnMultiAgent.js'

test('orchestrator and two teammates can round-trip messages', () => {
  const comms = createTeamComms('team-1', ['worker-a', 'worker-b'])
  const orchInbox: string[] = []
  comms.onOrchestratorMessage(m => orchInbox.push(`${m.from}:${m.body}`))
  comms.fromTeammate('worker-a').send('orchestrator', 'a-ready')
  comms.fromTeammate('worker-a').broadcast('sync')
  const bInbox: string[] = []
  comms.fromTeammate('worker-b').onMessage(m => bInbox.push(m.body))
  comms.fromTeammate('worker-a').broadcast('sync2')
  expect(orchInbox).toContain('worker-a:a-ready')
  expect(bInbox).toContain('sync2')
})
