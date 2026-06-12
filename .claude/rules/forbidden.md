---
alwaysApply: true
description: Agent-role-scoped forbidden operations (hard rules per persona)
---

# Forbidden operations, by agent role

Different agent personas have different blast radii. These are hard rules, not advice.

## All roles
- Never edit the model-identity/alignment layer beyond product-name strings (`src/constants/prompts.ts`).
- Never add a network call that breaks zero-phone-home (`bun run verify:privacy` must stay green).
- Never `rm -rf` source — `mv` to `~/.Trash/`, one reviewed deletion at a time.
- Never commit credentials; never overwrite shared OAuth credential files.

## builder (implements features/fixes)
- Never add a runtime dependency without it being in the task brief.
- Never delete Knip-flagged "dead" code without cross-checking `feature-flags-source-guard` (flag-gated
  `require`s look dead but are live behind a build flag).
- Never reformat files you didn't change.

## researcher (gathers information)
- Never write to `src/**`, never commit, never modify `package.json` or lockfiles. Read + report only.

## refiner (polish/quality)
- Never add new files or change a public API signature without a Failure-Ledger entry justifying it.
- Stay within the task's stated scope; polish ≠ new features.
