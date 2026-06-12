import { describe, expect, test } from 'bun:test'
import { TaskSchema, normalizeTaskDataForRead } from './tasks.js'

describe('task data normalization', () => {
  test('recovers a blank subject from activeForm', () => {
    const normalized = normalizeTaskDataForRead(
      {
        id: '10',
        subject: '',
        description: '',
        activeForm: 'Auditing outbound Vapi flow',
        status: 'in_progress',
        blocks: [],
        blockedBy: [],
        owner: '',
      },
      '10',
    )

    const parsed = TaskSchema().parse(normalized)
    expect(parsed.subject).toBe('Auditing outbound Vapi flow')
    expect(parsed.owner).toBeUndefined()
  })

  test('recovers a blank subject from description', () => {
    const normalized = normalizeTaskDataForRead(
      {
        id: '12',
        subject: '',
        description:
          'ACORD 137 byte-boundary guard diff is locally green. Keep separate from Wave 2 PR merge path.',
        status: 'completed',
        blocks: [],
        blockedBy: [],
      },
      '12',
    )

    const parsed = TaskSchema().parse(normalized)
    expect(parsed.subject).toBe(
      'ACORD 137 byte-boundary guard diff is locally green.',
    )
  })
})
