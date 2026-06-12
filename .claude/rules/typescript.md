---
paths: ["src/**/*.ts"]
description: TypeScript invariants for Limitless source
---

# TypeScript rules

- The bundler, not `tsc`, is the build authority. `tsc --noEmit` is red by design (flag-gated
  `require`s + type-only imports of DCE'd modules). Judge type health with `bun run typecheck:ci`.
- Type debt may only decrease. The ratchet (`scripts/tsc-ratchet.ts` / `.tsc-baseline.json`) fails
  CI on any *new* (file, error-code) fingerprint. Fix it or it blocks merge.
- Imports use `.js` extensions on relative paths (bundler resolves `.ts`); `allowImportingTsExtensions`
  is on. Don't "fix" a `.js` import to `.ts`.
- Prefer `import type { ... }` for type-only imports (erased at bundle; keeps the graph clean).
