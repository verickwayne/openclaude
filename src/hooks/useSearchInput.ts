import { useCallback, useRef, useState } from 'react'
import { KeyboardEvent } from '../ink/events/keyboard-event.js'
// eslint-disable-next-line custom-rules/prefer-use-keybindings -- backward-compat bridge until consumers wire handleKeyDown to <Box onKeyDown>
import { useInput } from '../ink.js'
import {
  Cursor,
  getLastKill,
  pushToKillRing,
  recordYank,
  resetKillAccumulation,
  resetYankState,
  updateYankLength,
  yankPop,
} from '../utils/Cursor.js'
import { useTerminalSize } from './useTerminalSize.js'

type UseSearchInputOptions = {
  isActive: boolean
  onExit: () => void
  /** Esc + Ctrl+C abandon (distinct from onExit = Enter commit). When
   *  provided: single-Esc calls this directly (no clear-first-then-exit
   *  two-press). When absent: current behavior — Esc clears non-empty
   *  query, exits on empty; Ctrl+C silently swallowed (no switch case). */
  onCancel?: () => void
  onExitUp?: () => void
  columns?: number
  passthroughCtrlKeys?: string[]
  initialQuery?: string
  /** Backspace (and ctrl+h) on empty query calls onCancel ?? onExit — the
   *  less/vim "delete past the /" convention. Dialogs that want Esc-only
   *  cancel set this false so a held backspace doesn't eject the user. */
  backspaceExitsOnEmpty?: boolean
}

type UseSearchInputReturn = {
  query: string
  setQuery: (q: string) => void
  cursorOffset: number
  handleKeyDown: (e: KeyboardEvent) => void
}

function isKillKey(e: KeyboardEvent): boolean {
  if (e.ctrl && (e.key === 'k' || e.key === 'u' || e.key === 'w')) {
    return true
  }
  if (e.meta && e.key === 'backspace') {
    return true
  }
  return false
}

function isYankKey(e: KeyboardEvent): boolean {
  return (e.ctrl || e.meta) && e.key === 'y'
}

// Special key names that fall through the explicit handlers above the
// text-input branch (return/escape/arrows/home/end/tab/backspace/delete
// all early-return). Reject these so e.g. PageUp doesn't leak 'pageup'
// as literal text. The length>=1 check below is intentionally loose —
// batched input like stdin.write('abc') arrives as one multi-char e.key,
// matching the old useInput(input) behavior where cursor.insert(input)
// inserted the full chunk.
const UNHANDLED_SPECIAL_KEYS = new Set([
  'pageup',
  'pagedown',
  'insert',
  'wheelup',
  'wheeldown',
  'mouse',
  'f1',
  'f2',
  'f3',
  'f4',
  'f5',
  'f6',
  'f7',
  'f8',
  'f9',
  'f10',
  'f11',
  'f12',
])

export function useSearchInput({
  isActive,
  onExit,
  onCancel,
  onExitUp,
  columns,
  passthroughCtrlKeys = [],
  initialQuery = '',
  backspaceExitsOnEmpty = true,
}: UseSearchInputOptions): UseSearchInputReturn {
  const { columns: terminalColumns } = useTerminalSize()
  const effectiveColumns = columns ?? terminalColumns
  const [query, setQueryState] = useState(initialQuery)
  const [cursorOffset, setCursorOffset] = useState(initialQuery.length)
  const queryRef = useRef(initialQuery)
  const cursorOffsetRef = useRef(initialQuery.length)

  const setQueryAndRef = useCallback((q: string) => {
    queryRef.current = q
    setQueryState(q)
  }, [])

  const setCursorOffsetAndRef = useCallback((offset: number) => {
    cursorOffsetRef.current = offset
    setCursorOffset(offset)
  }, [])

  const setQuery = useCallback((q: string) => {
    setQueryAndRef(q)
    setCursorOffsetAndRef(q.length)
  }, [setCursorOffsetAndRef, setQueryAndRef])

  const handleKeyDown = (e: KeyboardEvent): void => {
    if (!isActive) return

    const currentQuery = queryRef.current
    const currentCursorOffset = cursorOffsetRef.current
    const cursor = Cursor.fromText(currentQuery, effectiveColumns, currentCursorOffset)

    // Check passthrough ctrl keys
    if (e.ctrl && passthroughCtrlKeys.includes(e.key.toLowerCase())) {
      return
    }

    // Reset kill accumulation for non-kill keys
    if (!isKillKey(e)) {
      resetKillAccumulation()
    }

    // Reset yank state for non-yank keys
    if (!isYankKey(e)) {
      resetYankState()
    }

    // Exit conditions
    if (e.key === 'return' || e.key === 'down') {
      e.preventDefault()
      onExit()
      return
    }
    if (e.key === 'up') {
      e.preventDefault()
      if (onExitUp) {
        onExitUp()
      }
      return
    }
    if (e.key === 'escape') {
      e.preventDefault()
      if (onCancel) {
        onCancel()
      } else if (currentQuery.length > 0) {
        setQueryAndRef('')
        setCursorOffsetAndRef(0)
      } else {
        onExit()
      }
      return
    }

    // Backspace/Delete
    if (e.key === 'backspace') {
      e.preventDefault()
      if (e.meta) {
        // Meta+Backspace: kill word before
        const { cursor: newCursor, killed } = cursor.deleteWordBefore()
        pushToKillRing(killed, 'prepend')
        setQueryAndRef(newCursor.text)
        setCursorOffsetAndRef(newCursor.offset)
        return
      }
      if (currentQuery.length === 0) {
        // Backspace past the / — cancel (clear + snap back), not commit.
        // less: same. vim: deletes the / and exits command mode.
        if (backspaceExitsOnEmpty) (onCancel ?? onExit)()
        return
      }
      const newCursor = cursor.backspace()
      setQueryAndRef(newCursor.text)
      setCursorOffsetAndRef(newCursor.offset)
      return
    }

    if (e.key === 'delete') {
      e.preventDefault()
      const newCursor = cursor.del()
      setQueryAndRef(newCursor.text)
      setCursorOffsetAndRef(newCursor.offset)
      return
    }

    // Arrow keys with modifiers (word jump)
    if (e.key === 'left' && (e.ctrl || e.meta || e.fn)) {
      e.preventDefault()
      const newCursor = cursor.prevWord()
      setCursorOffsetAndRef(newCursor.offset)
      return
    }
    if (e.key === 'right' && (e.ctrl || e.meta || e.fn)) {
      e.preventDefault()
      const newCursor = cursor.nextWord()
      setCursorOffsetAndRef(newCursor.offset)
      return
    }

    // Plain arrow keys
    if (e.key === 'left') {
      e.preventDefault()
      const newCursor = cursor.left()
      setCursorOffsetAndRef(newCursor.offset)
      return
    }
    if (e.key === 'right') {
      e.preventDefault()
      const newCursor = cursor.right()
      setCursorOffsetAndRef(newCursor.offset)
      return
    }

    // Home/End
    if (e.key === 'home') {
      e.preventDefault()
      setCursorOffsetAndRef(0)
      return
    }
    if (e.key === 'end') {
      e.preventDefault()
      setCursorOffsetAndRef(currentQuery.length)
      return
    }

    // Ctrl key bindings
    if (e.ctrl) {
      e.preventDefault()
      switch (e.key.toLowerCase()) {
        case 'a':
          setCursorOffsetAndRef(0)
          return
        case 'e':
          setCursorOffsetAndRef(currentQuery.length)
          return
        case 'b':
          setCursorOffsetAndRef(cursor.left().offset)
          return
        case 'f':
          setCursorOffsetAndRef(cursor.right().offset)
          return
        case 'd': {
          if (currentQuery.length === 0) {
            ;(onCancel ?? onExit)()
            return
          }
          const newCursor = cursor.del()
          setQueryAndRef(newCursor.text)
          setCursorOffsetAndRef(newCursor.offset)
          return
        }
        case 'h': {
          if (currentQuery.length === 0) {
            if (backspaceExitsOnEmpty) (onCancel ?? onExit)()
            return
          }
          const newCursor = cursor.backspace()
          setQueryAndRef(newCursor.text)
          setCursorOffsetAndRef(newCursor.offset)
          return
        }
        case 'k': {
          const { cursor: newCursor, killed } = cursor.deleteToLineEnd()
          pushToKillRing(killed, 'append')
          setQueryAndRef(newCursor.text)
          setCursorOffsetAndRef(newCursor.offset)
          return
        }
        case 'u': {
          const { cursor: newCursor, killed } = cursor.deleteToLineStart()
          pushToKillRing(killed, 'prepend')
          setQueryAndRef(newCursor.text)
          setCursorOffsetAndRef(newCursor.offset)
          return
        }
        case 'w': {
          const { cursor: newCursor, killed } = cursor.deleteWordBefore()
          pushToKillRing(killed, 'prepend')
          setQueryAndRef(newCursor.text)
          setCursorOffsetAndRef(newCursor.offset)
          return
        }
        case 'y': {
          const text = getLastKill()
          if (text.length > 0) {
            const startOffset = cursor.offset
            const newCursor = cursor.insert(text)
            recordYank(startOffset, text.length)
            setQueryAndRef(newCursor.text)
            setCursorOffsetAndRef(newCursor.offset)
          }
          return
        }
        case 'g':
        case 'c':
          // Cancel (abandon search). ctrl+g is less's cancel key. Only
          // fires if onCancel provided — otherwise falls through and
          // returns silently (11 call sites, most expect ctrl+c to no-op).
          if (onCancel) {
            onCancel()
            return
          }
      }
      return
    }

    // Meta key bindings
    if (e.meta) {
      e.preventDefault()
      switch (e.key.toLowerCase()) {
        case 'b':
          setCursorOffsetAndRef(cursor.prevWord().offset)
          return
        case 'f':
          setCursorOffsetAndRef(cursor.nextWord().offset)
          return
        case 'd': {
          const newCursor = cursor.deleteWordAfter()
          setQueryAndRef(newCursor.text)
          setCursorOffsetAndRef(newCursor.offset)
          return
        }
        case 'y': {
          const popResult = yankPop()
          if (popResult) {
            const { text, start, length } = popResult
            const before = currentQuery.slice(0, start)
            const after = currentQuery.slice(start + length)
            const newText = before + text + after
            const newOffset = start + text.length
            updateYankLength(text.length)
            setQueryAndRef(newText)
            setCursorOffsetAndRef(newOffset)
          }
          return
        }
      }
      return
    }

    // Tab: ignore
    if (e.key === 'tab') {
      return
    }

    // Regular character input. Accepts multi-char e.key so batched writes
    // (stdin.write('abc') in tests, or paste outside bracketed-paste mode)
    // insert the full chunk — matching the old useInput behavior.
    if (e.key.length >= 1 && !UNHANDLED_SPECIAL_KEYS.has(e.key)) {
      e.preventDefault()
      const newCursor = cursor.insert(e.key)
      setQueryAndRef(newCursor.text)
      setCursorOffsetAndRef(newCursor.offset)
    }
  }

  // Backward-compat bridge: existing consumers don't yet wire handleKeyDown
  // to <Box onKeyDown>. Subscribe via useInput and adapt InputEvent →
  // KeyboardEvent until all 11 call sites are migrated (separate PRs).
  // TODO(onKeyDown-migration): remove once all consumers pass handleKeyDown.
  useInput(
    (_input, _key, event) => {
      handleKeyDown(new KeyboardEvent(event.keypress))
    },
    { isActive },
  )

  return { query, setQuery, cursorOffset, handleKeyDown }
}
