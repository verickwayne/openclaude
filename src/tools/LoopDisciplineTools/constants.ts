// Tool names for the loop-discipline tool surface (Phase E2 / F2 of
// docs/plans/20260606224012_in-loop-discipline.md).
//
// Kept in a separate file so the tool definitions, the gate hooks, and
// the phase allowlist in src/types/loopDiscipline.ts can all reference
// the same string identifiers without circular import risk.

export const EMIT_PLAN_TOOL_NAME = 'EmitPlan'
export const EMIT_PHASE_TRANSITION_TOOL_NAME = 'EmitPhaseTransition'
export const EMIT_VERIFICATION_TOOL_NAME = 'EmitVerification'
export const GET_LOOP_DISCIPLINE_STATUS_TOOL_NAME = 'GetLoopDisciplineStatus'
