import { expect, test } from 'bun:test'
import { detectHarness } from '../../../src/services/crossHarness/detectors.js'

test('detects limitless/claude transcript', () => {
  const lines = [JSON.stringify({type:'user',message:{role:'user',content:'hi'},uuid:'u1',sessionId:'S1',cwd:'/p',timestamp:'2026-01-01T00:00:00Z'})]
  const r = detectHarness('/x/S1.jsonl', lines, 1000)
  expect(r?.harness === 'limitless' || r?.harness === 'claude').toBe(true)
  expect(r?.sessionId).toBe('S1'); expect(r?.cwd).toBe('/p')
})

test('detects codex rollout', () => {
  const lines = [
    JSON.stringify({timestamp:'t',type:'session_meta',payload:{id:'C1',cwd:'/c',timestamp:'t'}}),
    JSON.stringify({timestamp:'t',type:'response_item',payload:{type:'message',role:'user',content:[{type:'input_text',text:'hello codex'}]}}),
  ]
  const r = detectHarness('/x/rollout-2026-01-01T00-00-00-C1.jsonl', lines, 1000)
  expect(r?.harness).toBe('codex'); expect(r?.sessionId).toBe('C1'); expect(r?.firstPrompt).toContain('hello codex')
})

test('non-transcript json returns null', () => {
  expect(detectHarness('/x/package.json', [JSON.stringify({name:'x',version:'1'})], 1000)).toBeNull()
})
