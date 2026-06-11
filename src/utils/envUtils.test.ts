import { describe, expect, it } from 'bun:test'
import { readBrandedEnv } from './envUtils.js'

describe('readBrandedEnv', () => {
  it('prefers the LIMITLESS_ name when both are set', () => {
    expect(
      readBrandedEnv('MULTI_PROVIDER', {
        LIMITLESS_MULTI_PROVIDER: 'new',
        OPENCLAUDE_MULTI_PROVIDER: 'old',
      }),
    ).toBe('new')
  })

  it('ignores the previous-brand name when LIMITLESS_ is absent', () => {
    expect(
      readBrandedEnv('MULTI_PROVIDER', { OPENCLAUDE_MULTI_PROVIDER: 'old' }),
    ).toBeUndefined()
  })

  it('returns the LIMITLESS_ value when only it is set', () => {
    expect(
      readBrandedEnv('MULTI_PROVIDER', { LIMITLESS_MULTI_PROVIDER: 'new' }),
    ).toBe('new')
  })

  it('returns undefined when neither name is set', () => {
    expect(readBrandedEnv('MULTI_PROVIDER', {})).toBeUndefined()
  })

  it('treats an empty-string LIMITLESS_ value as defined (does not fall back)', () => {
    // ?? only falls back on null/undefined, so an explicitly-empty LIMITLESS_
    // value intentionally shadows the legacy name.
    expect(
      readBrandedEnv('MULTI_PROVIDER', {
        LIMITLESS_MULTI_PROVIDER: '',
        OPENCLAUDE_MULTI_PROVIDER: 'old',
      }),
    ).toBe('')
  })
})
