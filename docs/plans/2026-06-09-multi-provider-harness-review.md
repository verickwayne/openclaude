# Plan Review — Multi-Provider Harness (2026-06-09)

Reviewed against the actual codebase (not the subagent reports). Findings below; the plan file has been patched for every Blocker, Critical, and Security item.

## Executive summary

The plan is architecturally sound — it correctly leans on the existing per-request `providerOverride` seam. But several cited symbols/paths were imprecise (subagent reports had the right shape, wrong details), and there is **one critical correctness bug** in the M4 routing design that would make "pick Opus 4.8 while OpenAI is the active env" silently authenticate wrong. All Blocker/Critical/Security items are now fixed in the plan.

## Blockers (fixed in plan)

1. **Wrong import path for `parseModelList`.** It lives at `src/utils/providerModels.ts:14` — *not* `src/utils/model/providerModels.ts` (that file does not exist). Fixed in Tasks 1.3 and 3.1.
2. **Wrong function/signature for auth gating.** `shouldUseFirstPartyAnthropicAuth(providerOverride?)` is a thin wrapper; the real logic is `shouldUseFirstPartyAnthropicAuthForProvider({ providerOverride, apiProvider, isFirstPartyBaseUrl, routeId })` (`authRouting.ts:13`), whose first line is `if (providerOverride || apiProvider !== 'firstParty') return false`. That short-circuit is what must become kind-aware. The Task 2.1 test signature `(process.env, override)` was wrong. Fixed.
3. **`baseURL` vs `baseUrl` casing collision.** The existing `ProviderOverride` is `{ model; baseURL; apiKey }` (capital URL, `authRouting.ts:11`) and the shim/client read `.baseURL`. `ProviderProfile` uses `baseUrl`. To avoid touching every reader (error-prone), `ResolvedProvider` now uses **`baseURL`** (matching the existing readers); the profile builder maps `profile.baseUrl → baseURL`. Fixed in Task 1.1 and all downstream tasks.

## Critical correctness (fixed in plan)

4. **First-party-returns-null breaks multi-provider auth.** Original Task 4.1 returned `null` for first-party models, relying on the global env being Anthropic. But in multi-provider use the global env may be OpenAI when the user picks Opus 4.8 — then `getAPIProvider()` returns `'openai'`, no override, and `shouldUseFirstPartyAnthropicAuthForProvider` returns `false`, so an Opus request would NOT use Anthropic auth. Fix: `resolveMainLoopOverride` returns `null` only when the model is first-party **and** the global route is already first-party; otherwise it returns an explicit `anthropic-native` override. Routing no longer depends on global env once a non-default model is selected. Patched Task 4.1.
6. **Bootstrap dedup early-return must be scope-aware.** `bootstrap.ts:231-238` compares the shared `additionalModelOptionsCache`/`...Scope`. After splitting first-party into its own field, that comparison would wrongly skip/allow writes. Added a step to make the unchanged-check read the correct field per scope. Patched Task 0.4.

## Security (fixed in plan)

5. **Credential-forwarding via a malicious `anthropic-native` override.** The new native-Anthropic override branch (Task 2.2) must only attach the Claude OAuth token / `ANTHROPIC_API_KEY` when the override `baseURL` is trusted (default `api.anthropic.com` or a loopback Claude Max proxy). A profile with `provider:'anthropic'` but an attacker-controlled `baseURL` would otherwise receive the subscription token. Added a `isTrustedAnthropicBaseUrl()` guard to Task 2.2; untrusted → no Anthropic creds attached. This mirrors the existing SSRF mitigation at `client.ts:283-288` (which must be preserved — it is security, not alignment).

## Important gaps (added to plan)

7. **M6 conflated in-process bus with cross-process teammates.** `TeamMessageBus` is in-process; subprocess teammates (`spawnMultiAgent`) are separate OS processes and cannot receive from an in-process bus directly. Scoped M6: the bus serves **in-process** sub-agents and the orchestrator; **subprocess** teammate↔teammate/orchestrator messaging rides the existing `SendMessage`/team IPC, which the bus bridges to on the orchestrator side. Task 6.3 reworded to stop implying cross-process in-memory delivery.
8. **No kill switch.** Added `OPENCLAUDE_MULTI_PROVIDER` env flag (default on) gating the new main-loop/dispatch routing, so a bad release falls back to single-provider behavior without a revert. Added to HARD CONSTRAINTS + Task 4.1.
9. **Startup restore of a persisted cross-provider model.** Selecting GPT-5.5 persists `mainLoopModel`, but on next launch the provider must re-resolve from the registry. Added a note to Task 4.2 to resolve the persisted model → override at startup (the main-loop resolver already does this per request, so this is a verification step, not new code).
10. **`getFirstPartyModelIds` is tier-dependent.** Clarified it must derive from the same first-party branch `getModelOptionsBase` uses, plus `firstPartyAdditionalModelOptionsCache` values — not a hardcoded list.

## Verified correct (no change needed)

- `ProviderProfile` has exactly the fields the Task 1.1 builder uses (`apiKey?`, `apiFormat?`, `authHeader?`, `authScheme?`, `authHeaderValue?`). Builder must use the real types `OpenAICompatibleApiFormat` / `OpenAICompatibleAuthScheme` (noted in Task 1.1).
- `resolveProviderRequest` already accepts `apiFormat?` (`providerConfig.ts:613`) — Task 2.3 premise holds.
- `ModelOption` is exported from `src/utils/model/modelOptions.ts:49` — import paths correct.
- Bootstrap already branches `scope === 'firstParty'` vs `openai:` (`bootstrap.ts:206-218`) — the split-field fix lands cleanly there.
- AgentTool `model` schema is `z.enum(['sonnet','opus','haiku']).optional()` at `:86` — widen-to-string is straightforward.
- Credentials genuinely coexist per provider in secure storage — multi-login is real.

## Risk posture

The change is high-blast-radius (core request routing) but well-contained by: (a) the kill-switch flag, (b) first-party-default-path preserved for single-provider users, (c) per-milestone build gates, (d) pure-function unit tests on every resolver plus manual E2E at M4/M5/M6. Recommend executing M0→M1→M2 (no behavior change to the main loop until M4) and pausing for a real two-provider manual test before M4 lands.
