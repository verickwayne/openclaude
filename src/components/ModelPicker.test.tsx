import { describe, expect, test } from 'bun:test'

import type { ModelOption } from '../utils/model/modelOptions.js'
import {
  ADD_REMOVE_MODELS_VALUE,
  makeGroupHeaderValue,
} from '../utils/model/multiProviderOptions.js'
import {
  getLikelyProviderGroupForModelValue,
  insertCurrentModelIntoProviderSection,
} from './ModelPicker.js'

describe('ModelPicker option placement', () => {
  test('inserts missing OpenRouter current models into the OpenRouter section', () => {
    const current: ModelOption = {
      value: 'anthropic/claude-opus-4.5',
      label: 'anthropic/claude-opus-4.5',
      description: 'Current model',
    }
    const options: ModelOption[] = [
      {
        value: makeGroupHeaderValue('openrouter'),
        label: 'OpenRouter',
        description: '',
      },
      {
        value: 'minimax/minimax-m3',
        label: 'MiniMax M3',
        description: 'OpenRouter',
      },
      {
        value: makeGroupHeaderValue('local'),
        label: 'Local',
        description: '',
      },
      {
        value: 'dolphin3:8b',
        label: 'Dolphin',
        description: 'Local',
      },
      {
        value: ADD_REMOVE_MODELS_VALUE,
        label: 'Add models',
        description: '',
      },
    ]

    const next = insertCurrentModelIntoProviderSection(options, current)
    expect(next.map(option => option.value)).toEqual([
      makeGroupHeaderValue('openrouter'),
      'minimax/minimax-m3',
      'anthropic/claude-opus-4.5',
      makeGroupHeaderValue('local'),
      'dolphin3:8b',
      ADD_REMOVE_MODELS_VALUE,
    ])
  })

  test('classifies slash model IDs as OpenRouter and colon model IDs as local', () => {
    expect(getLikelyProviderGroupForModelValue('qwen/qwen3-coder')).toBe(
      'openrouter',
    )
    expect(getLikelyProviderGroupForModelValue('dolphin3:8b')).toBe('local')
  })
})
