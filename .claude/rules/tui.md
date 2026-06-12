---
paths: ["src/**/*.tsx", "src/components/**", "src/screens/**"]
description: Ink terminal-UI rules (under-represented in model training — read carefully)
---

# Ink TUI rules

- This is Ink (React for the terminal), not the DOM. No HTML elements — use `Box`/`Text` from
  `src/ink.js`. Layout is flexbox via Ink props, not CSS.
- Colors must survive 256-color terminals (Terminal.app has no truecolor). Use the `theme.ts`
  tokens and the `ansiRgb`/`rgbToAnsi256` downsample path — never emit raw 24-bit truecolor
  directly (it renders as garbage on 256-color terminals).
- `useInput` handlers: gate by mode and `stopPropagation` deliberately; multiple handlers stack
  (transcript, search bar, teammate selection). Adding a global keybinding can deadlock input —
  check `screens/REPL.tsx` keybinding ownership first.
- Keep components focused; the render tree is reconciled every frame.
