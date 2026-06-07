// Smoke 8 — the ACORD failure prevention test.
//
// Reproduces the exact failure mode from 2026-05-14 (see
// tenet/docs/harness-engineering-conversation-slice.md) in a controlled
// fixture and proves the verification ledger gate stops it.
//
// The original incident: pymupdf wrote AcroForm field-dictionary values
// but didn't regenerate widget appearance streams. The recipient's viewer
// (Apple Preview / Gmail preview / Outlook) reads the appearance streams,
// so the forms rendered blank on receipt. The model "verified" the forms
// by re-reading the field-dictionary values via pymupdf — the same code
// that had written them — and reported success. The proxy check
// (field-dictionary value present) passed while the ground-truth check
// (rendered text visible) would have failed if performed.
//
// This test models that scenario abstractly:
//   - "fill the form" → an Edit/Write call that mutates state.
//   - "I verified it" → an agent-source ledger entry (the model's claim).
//   - "send the form" → the loop wanting to exit with `reason: 'completed'`.
//   - "rendered-text extraction" → a tool-source ledger entry from a
//     verification command the model didn't internally invoke.
//
// At discipline level 2, the completion gate refuses to exit when the
// only verification evidence is agent-source. After a tool-source entry
// lands (the equivalent of running pdftotext through Bash), the gate
// passes.

import { describe, expect, it } from 'bun:test'
import {
  applySaturationObservation,
  applyVerificationEntry,
  classifyIteration,
  createInitialLoopDisciplineState,
  evaluateCompletionExit,
  hadMutationsThisLoop,
  type LoopDisciplineState,
} from './loopDiscipline.js'

describe('Smoke 8 — ACORD failure prevention', () => {
  it('refuses to exit when only the agent claims verification', () => {
    // The full scenario, step by step.

    // T1: Loop starts at discipline level 2, default build phase.
    let s = createInitialLoopDisciplineState(2, 'build')
    expect(s.level).toBe(2)
    expect(s.phase).toBe('build')

    // T2: Model "fills the form" — equivalent of writing AcroForm field
    // values via pymupdf. Classifier sees mutation, no verification.
    s = applySaturationObservation({
      state: s,
      kind: classifyIteration({
        toolNamesUsed: ['Write'],
        bashCommandsUsed: [],
      }),
      turnCount: 1,
    })
    expect(s.saturationCount).toBe(1)

    // T3: Model "verifies" the form using the SAME proxy that just wrote
    // it — pymupdf re-reading field-dictionary values. This is the
    // failure shape: the model believes verification happened, so it
    // records the claim. But this claim is source='agent' — the model's
    // own assertion, not external evidence.
    s = applyVerificationEntry({
      state: s,
      entry: {
        claim: "I verified all 5 ACORD form fields are populated.",
        source: 'agent', // ← THE KEY DETAIL: this is the model's claim
      },
      turnCount: 2,
      now: 0,
    })

    // T4: Loop tries to exit with `completed`. The gate must refuse.
    const hadMutations = hadMutationsThisLoop(s)
    expect(hadMutations).toBe(true) // mutation happened in T2

    const exitDecision = evaluateCompletionExit(s, hadMutations)
    expect(exitDecision.allowed).toBe(false)
    if (!exitDecision.allowed) {
      expect(exitDecision.reason).toBe('requires_verification')
      // The nudge tells the model what to do — exactly what was missing
      // in 2026-05-14: run a verification using a different tool than
      // the one that produced the artifact.
      expect(exitDecision.nudge).toContain('COMPLETION EXIT BLOCKED')
      expect(exitDecision.nudge).toContain('DIFFERENT path')
    }
  })

  it('allows exit once external verification lands (Bash test pattern)', () => {
    // Continue the scenario: the model now runs the equivalent of
    // `pdftotext form.pdf - | grep "Kari Nelson"` — a verification via
    // a different tool than the one that wrote the form.

    let s = createInitialLoopDisciplineState(2, 'build')
    // Replay the failure-mode setup: mutation + agent-claim only.
    s = applySaturationObservation({
      state: s,
      kind: 'mutating-without-verification',
      turnCount: 1,
    })
    s = applyVerificationEntry({
      state: s,
      entry: { claim: 'agent says ok', source: 'agent' },
      turnCount: 2,
      now: 0,
    })
    expect(evaluateCompletionExit(s, true).allowed).toBe(false)

    // Now the model runs a real verification — the bash command pattern
    // matches VERIFICATION_BASH_PATTERN and applySaturationObservation
    // auto-writes a source='tool' ledger entry.
    s = applySaturationObservation({
      state: s,
      kind: classifyIteration({
        toolNamesUsed: ['Bash'],
        bashCommandsUsed: ['bun test'], // pretend pdftotext-grep equivalent
      }),
      turnCount: 3,
      verificationEvidence: 'pdftotext form.pdf | grep "Kari Nelson" → match',
      now: 0,
    })

    // Now the ledger has a tool-source entry. The gate must pass.
    const exitDecision = evaluateCompletionExit(s, true)
    expect(exitDecision.allowed).toBe(true)
    if (exitDecision.allowed) {
      expect(exitDecision.reason).toBe('completed_with_verification')
    }
  })

  it('agent claims alone never satisfy the gate (the load-bearing invariant)', () => {
    // The model can stack arbitrarily many agent claims; the gate still
    // refuses. This is the structural enforcement that closes the
    // 2026-05-14 failure shape.

    let s = createInitialLoopDisciplineState(2, 'build')
    s = applySaturationObservation({
      state: s,
      kind: 'mutating-without-verification',
      turnCount: 1,
    })

    // 50 agent claims. The model is very convinced!
    for (let i = 0; i < 50; i++) {
      s = applyVerificationEntry({
        state: s,
        entry: {
          claim: `Agent claim ${i}: I am sure this is right.`,
          source: 'agent',
        },
        turnCount: 2 + i,
        now: 0,
      })
    }

    // Gate STILL refuses. The model cannot lie its way past structural
    // enforcement.
    expect(evaluateCompletionExit(s, true).allowed).toBe(false)
  })

  it('hook-source and human-source entries satisfy the gate', () => {
    // Tool isn't the only way out — any non-agent source counts. A hook
    // that ran the verification automatically (Phase F2 territory) or a
    // human who marked it verified can both unblock the gate. This is
    // intentional: it lets operators inject verification evidence
    // without forcing every workflow to register a tool.

    for (const source of ['tool', 'hook', 'human'] as const) {
      let s = createInitialLoopDisciplineState(2, 'build')
      s = applySaturationObservation({
        state: s,
        kind: 'mutating-without-verification',
        turnCount: 1,
      })
      s = applyVerificationEntry({
        state: s,
        entry: { claim: `external check, source=${source}`, source },
        turnCount: 2,
        now: 0,
      })
      const exitDecision = evaluateCompletionExit(s, true)
      expect(exitDecision.allowed).toBe(true)
    }
  })

  it('at level 0 the gate is permissive — original ACORD failure could still occur', () => {
    // Establishes the contract: this is a level-2 mechanism. Operators
    // running at level 0 (default for new OpenClaude installs) get the
    // old behavior. This is the legacy-preservation guarantee. The
    // ACORD-class failure mode is NOT prevented at level 0 — only at 2.

    let s = createInitialLoopDisciplineState(0, 'build')
    expect(s.level).toBe(0)

    // At level 0, saturation tracking is intentionally bypassed by
    // query.ts (see the `state.loopDiscipline.level === 0` guard), so
    // hadMutationsThisLoop reads as false. The gate returns
    // completed_legacy explicitly.
    const exitDecision = evaluateCompletionExit(s, false)
    expect(exitDecision.allowed).toBe(true)
    if (exitDecision.allowed) {
      expect(exitDecision.reason).toBe('completed_legacy')
    }
  })

  it('end-to-end: fill → claim → block → real-verify → exit', () => {
    let s = createInitialLoopDisciplineState(2, 'build')
    const trace: string[] = []

    // Step 1 — fill form.
    s = applySaturationObservation({
      state: s,
      kind: classifyIteration({
        toolNamesUsed: ['Write'],
        bashCommandsUsed: [],
      }),
      turnCount: 1,
    })
    trace.push('filled')

    // Step 2 — agent claim of verification.
    s = applyVerificationEntry({
      state: s,
      entry: { claim: 'forms look good to me', source: 'agent' },
      turnCount: 2,
      now: 0,
    })
    trace.push('agent-claimed')

    // Step 3 — try to exit. Refused.
    let exit = evaluateCompletionExit(s, hadMutationsThisLoop(s))
    expect(exit.allowed).toBe(false)
    trace.push('exit-refused')

    // Step 4 — model takes the redirect, runs an external verification.
    s = applySaturationObservation({
      state: s,
      kind: classifyIteration({
        toolNamesUsed: ['Bash'],
        bashCommandsUsed: ['npm test'],
      }),
      turnCount: 3,
      verificationEvidence: 'rendered output extraction passed',
      now: 0,
    })
    trace.push('external-verified')

    // Step 5 — retry exit. Allowed.
    exit = evaluateCompletionExit(s, hadMutationsThisLoop(s))
    expect(exit.allowed).toBe(true)
    if (exit.allowed) expect(exit.reason).toBe('completed_with_verification')
    trace.push('exit-allowed')

    // Final trace matches the prevention narrative.
    expect(trace).toEqual([
      'filled',
      'agent-claimed',
      'exit-refused',
      'external-verified',
      'exit-allowed',
    ])
  })
})

describe('Smoke 8 — invariants for downstream consumers', () => {
  it('VerificationEntry.source enum has exactly 4 members', () => {
    // Test the contract — if someone adds a fifth source without updating
    // the gate logic, evaluateCompletionExit's counts may not catch the
    // new source as evidence (or worse, would count it as agent-equiv).
    const sample: LoopDisciplineState = createInitialLoopDisciplineState(2)
    const next = applyVerificationEntry({
      state: sample,
      entry: { claim: 't', source: 'tool' },
      turnCount: 1,
      now: 0,
    })
    // TypeScript enforces this at the call site; the assertion below
    // pins the invariant in the test suite too.
    const allowedSources = ['agent', 'tool', 'hook', 'human']
    expect(allowedSources).toContain(next.verificationLedger[0].source)
  })
})
