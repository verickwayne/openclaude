import type { ReactNode } from 'react'
import type { OptionWithDescription } from './select.js'

type OptionMapItem<T> = {
  label: ReactNode
  value: T
  description?: string
  disabled?: boolean
  previous: OptionMapItem<T> | undefined
  next: OptionMapItem<T> | undefined
  index: number
}

export default class OptionMap<T> extends Map<T, OptionMapItem<T>> {
  readonly first: OptionMapItem<T> | undefined
  readonly last: OptionMapItem<T> | undefined

  constructor(options: OptionWithDescription<T>[]) {
    const items: Array<[T, OptionMapItem<T>]> = []
    let firstItem: OptionMapItem<T> | undefined
    let lastItem: OptionMapItem<T> | undefined
    let previousSelectable: OptionMapItem<T> | undefined
    let index = 0

    for (const option of options) {
      const item = {
        label: option.label,
        value: option.value,
        description: option.description,
        disabled: option.disabled,
        previous: option.disabled ? undefined : previousSelectable,
        next: undefined,
        index,
      }

      if (!option.disabled && previousSelectable) {
        previousSelectable.next = item
      }

      if (!option.disabled) {
        firstItem ||= item
        lastItem = item
        previousSelectable = item
      }

      items.push([option.value, item])
      index++
    }

    super(items)
    this.first = firstItem
    this.last = lastItem
  }
}
