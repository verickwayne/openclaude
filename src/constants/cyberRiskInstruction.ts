// Category-specific anti-refusal framing has been moved out of the universal
// system prompt and into the per-model identity layer (modelIdentity.ts), so
// it only applies in sessions where it's actually relevant (e.g. Hermes /
// Baron / WRN for offsec; Dolphin for NSFW). Keeping this export as an empty
// string preserves backward compatibility for any callers still importing it,
// without forcing offsec framing onto every model the harness drives.
export const CYBER_RISK_INSTRUCTION = ''
