import { expect, test } from 'bun:test'
import { TeamMessageBus } from './teamMessageBus.js'

test('a teammate receives a message addressed to it', async () => {
  const bus = new TeamMessageBus('team-1')
  const received: string[] = []
  bus.subscribe('worker-a', m => { received.push(m.body) })
  bus.send({ from: 'orchestrator', to: 'worker-a', body: 'do X' })
  expect(received).toEqual(['do X'])
})

test('broadcast reaches all teammates except the sender', () => {
  const bus = new TeamMessageBus('team-1')
  const a: string[] = []; const b: string[] = []
  bus.subscribe('a', m => a.push(m.body))
  bus.subscribe('b', m => b.push(m.body))
  bus.broadcast({ from: 'a', body: 'hello team' })
  expect(a).toEqual([])
  expect(b).toEqual(['hello team'])
})

test('the orchestrator can read replies addressed to it', () => {
  const bus = new TeamMessageBus('team-1')
  const inbox: string[] = []
  bus.subscribe('orchestrator', m => inbox.push(m.body))
  bus.send({ from: 'worker-a', to: 'orchestrator', body: 'done' })
  expect(inbox).toEqual(['done'])
})
