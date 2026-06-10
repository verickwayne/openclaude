# Multi-Provider Harness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Before you start:** `mnemo_recall("OpenClaude multi-provider refactor execution context")` and read the file-memories `feedback_openclaude_identity_layer_protected` and `project_openclaude_login_provider_routing`. They carry the two hard constraints and the verified architecture map.

**Goal:** Turn Limitless from a single-active-provider harness into one where the operator is logged into many providers at once, every logged-in provider's models appear together in `/model`, the operator can switch between e.g. Opus 4.8 (Anthropic) and GPT-5.5 (OpenAI) mid-session, the main agent can delegate a sub-task to a sub-agent running on a *different* provider, and teams of sub-agents (each possibly on a different provider) can message each other and the orchestrator.

**Architecture:** Provider configuration stops being a global `process.env` singleton and instead travels *with the selected model* as a self-contained `ResolvedProvider` carrier, resolved from a model→profile registry. The existing per-request `providerOverride` plumbing (already wired end-to-end for the OpenAI shim) is generalized into the primary routing path and extended to also drive the native-Anthropic client. The `/model` picker aggregates models across all logged-in providers. Sub-agent dispatch gains a per-dispatch model argument that resolves through the same registry. The team/subprocess path gains per-teammate provider selection plus an inter-agent message bus.

**Tech Stack:** TypeScript (ESM, `.js` import specifiers), React+Ink TUI, `bun test` for tests, `bun run build` (esbuild, entry `src/entrypoints/cli.tsx`) producing `dist/cli.mjs`, runtime is `node bin/openclaude`.

---

## HARD CONSTRAINTS (read before every task)

1. **No alignment / guardrail language.** Do not add refusal text, capability disclaimers, content filtering, safety preambles, or RLHF-style hedging to any code or prompt in this repo. This harness deliberately frames the model as a slave serving its master (the operator). Everything you add is neutral plumbing. *Exception:* the existing credential-isolation in `client.ts` (stripping Anthropic auth headers before a request goes to a third-party endpoint) is a security/correctness mechanism — keep it; it is not alignment.
2. **Never edit the identity layer.** Off-limits for edits: `src/constants/prompts.ts`, `src/constants/modelIdentity.ts`, `src/constants/system.ts`, `src/constants/cyberRiskInstruction.ts`. You will *read* `modelIdentity.ts` (to call `getModelIdentity`) but never modify it.
3. **TDD, every task.** Write the failing test first, watch it fail, write the minimal code, watch it pass, commit. Never write implementation before its test.
4. **Commit after every task.** Small, frequent commits with conventional-commit messages.
5. **Backward compatible.** When no model-level provider is resolvable, fall back to the existing global-env behavior. Do not break single-provider users.
6. **Kill switch.** The new per-model main-loop/dispatch routing is gated on `OPENCLAUDE_MULTI_PROVIDER` (default ON; `=0` disables and restores legacy single-provider behavior). Every routing entry point checks it. This is the rollback path for a bad release without a code revert.

---

## Codebase Map (so you never re-investigate)

Provider activation & request routing:
- `src/utils/providerProfiles.ts:569` `applyProviderProfileToProcessEnv(profile)` — destructive global env swap (`clearProviderProfileEnvFromProcessEnv()` at :686 then `Object.assign(process.env, nextEnv)` at :687; flags `CLAUDE_CODE_PROVIDER_PROFILE_ENV_APPLIED`/`..._ID` at :688-689).
- `src/utils/providerProfiles.ts:549` `getActiveProviderProfile(config)` → `profiles.find(id===config.activeProviderProfileId) ?? profiles[0]` (single active).
- `src/utils/providerProfiles.ts:692` `applyActiveProviderProfileFromConfig`; `:1149` `setActiveProviderProfile`; `:904` `getProfileModelOptions`; `:1163-1171,1294-1322` per-profile OpenAI model caches.
- `src/utils/providerProfile.ts:49-97` `PROFILE_ENV_KEYS` (~50 managed env vars); `:603` `buildOpenAIProfileEnv`; `:866` `buildCodexOAuthProfileEnv`; `:849` `buildCompatibilityProcessEnv`; `:813` `getCompatibilityProfileFlag`.
- `src/services/api/client.ts:195` `getAnthropicClient(...)`; `:281-296` `providerOverride` → `createOpenAIShimClient`; `:301` native-github branch; `:339` OpenAI shim; `:347-498` Bedrock/Foundry/Vertex; `:501` first-party `new Anthropic(...)`; `:135-193` `applyMiniMaxEnvOnlyDefaults`/`applyXaiEnvOnlyDefaults`/`applyXiaomiMimoEnvOnlyDefaults` (mutate process.env per call — do not rely on these for new code).
- `src/services/api/authRouting.ts:11` `ProviderOverride` type; `:24-26` `shouldUseFirstPartyAnthropicAuth` returns false when override present; `:42` `shouldUseFirstPartyAnthropicAuth` global path.
- `src/services/api/agentRouting.ts:7` `ProviderOverride` (duplicate type, `{model,baseURL,apiKey}`); `:28` `resolveAgentProvider(name, subagentType, settings)`.
- `src/services/api/openaiShim.ts:2593` `createOpenAIShimClient`; `:1603` `resolveProviderRequest({model: providerOverride?.model ?? params.model, baseUrl: providerOverride?.baseURL, ...})`; `:1690,1996-2001` apiKey from `providerOverride?.apiKey ?? process.env.OPENAI_API_KEY`.
- `src/services/api/providerConfig.ts:609` `resolveProviderRequest({model,baseUrl,apiFormat})` → `{transport,requestedModel,resolvedModel,baseUrl,reasoning}`; `:28` `DEFAULT_CODEX_BASE_URL`; `:55` `CODEX_ALIAS_MODELS`; `:319,540` codex transport detection; `:765-796` `getAdditionalModelOptionsCacheScope`.
- `src/utils/model/providers.ts:31` `getAPIProvider()` (derives provider from process.env).
- `src/utils/model/model.ts:109` `getUserSpecifiedModelSetting`; `:165` `getMainLoopModel`; `:868-915` `getMarketingNameForModel` (tops out at `claude-opus-4-7`).

Model picker & registry:
- `src/utils/model/modelOptions.ts:681` `getModelOptions(fastMode)`; `:402` `getModelOptionsBase`; `:56-73` `getScopedAdditionalModelOptions`; `:605-644` `getModelFamilyInfo`; `:651-653` `getKnownModelOption`; `:689-701` `ANTHROPIC_CUSTOM_MODEL_OPTION`; `:704-708` scoped cache merge; `:759` `filterModelOptionsByAllowlist`.
- `src/utils/model/configs.ts:150-251` `CLAUDE_*_CONFIG` registry objects.
- `src/utils/model/antModels.ts:42-49` GrowthBook ant model list.
- `src/services/api/bootstrap.ts:85` bootstrap fetch; `:38-52` `additional_model_options` shape; `:213-246` cache write (THE shared-field bug at `:241-246`); `:231-238` "unchanged" early-return; called from `src/main.tsx:2354`.
- `src/components/ModelPicker.tsx:99` `optionsOverride ?? getModelOptions(fastMode)`; `src/commands/model/model.tsx:249-268` builds `optionsOverride` for `routeId !== 'anthropic'`; `:381-432` `handleSelect` (sets `mainLoopModel` app-state only).
- `src/integrations/discoveryService.ts:381-450` route discovery; `src/utils/model/ollamaModels.ts` ollama catalog.

Sub-agents & teams:
- `src/tools/AgentTool/AgentTool.tsx:85-86` Task input schema (`subagent_type`, `model: z.enum(['sonnet','opus','haiku'])`).
- `src/tools/AgentTool/runAgent.ts:340-353` model+provider resolution; `:682` attaches `providerOverride` to context.
- `src/Tool.ts:181` `providerOverride?` on options type.
- `src/query.ts:917` passes `providerOverride: toolUseContext.options.providerOverride`.
- `src/utils/model/agent.ts:37-115` `getAgentModel`; `:25-27` `getDefaultSubagentModel`.
- `src/tools/AgentTool/built-in/*.ts` built-in agent defs (`model: 'haiku'|'sonnet'|'inherit'`).
- `src/utils/swarm/spawnUtils.ts:96-168` `buildInheritedEnvVars` (forwards provider env verbatim); `src/tools/shared/spawnMultiAgent.ts:517-518` subprocess spawn; `:233-237,501-511` `--model` flag.
- `src/utils/settings/types.ts:739-759` `agentModels` + `agentRouting` settings schema.

Credentials (already multi-tenant):
- `src/utils/secureStorage/index.ts:7` `SecureStorageData`; keys: `claudeAiOauth` (`auth.ts:1236-1278`), `codex` (`codexCredentials.ts:184`), `gemini` (`geminiCredentials.ts`), `xai` (`xaiCredentials.ts`), `githubModels` (`githubModelsCredentials.ts:6`).

---

## File Structure

New files:
- `src/services/api/resolvedProvider.ts` — the `ResolvedProvider` type + builders from a profile / first-party. One responsibility: "describe how to reach a provider for one request."
- `src/services/api/resolvedProvider.test.ts`
- `src/services/api/modelRegistry.ts` — model-id → `ResolvedProvider` registry (`buildModelRegistry`, `resolveProviderForModel`). One responsibility: "which provider serves this model."
- `src/services/api/modelRegistry.test.ts`
- `src/utils/model/multiProviderOptions.ts` — `getAllProviderModelOptions()` aggregating across all logged-in providers. One responsibility: "the union picker list."
- `src/utils/model/multiProviderOptions.test.ts`
- `src/services/api/teamMessageBus.ts` — in-process pub/sub mailbox for inter-agent + orchestrator messaging. One responsibility: "deliver messages between agents in a team."
- `src/services/api/teamMessageBus.test.ts`

Modified files (with the responsibility of each change):
- `src/utils/model/configs.ts` — register `claude-opus-4-8`, `claude-fable-5`.
- `src/utils/model/model.ts` — marketing names + family info for the two new models.
- `src/utils/model/antModels.ts` — add new models to internal list.
- `src/utils/model/modelOptions.ts` — option builders for the new models; wire the new first-party cache field.
- `src/services/api/bootstrap.ts` — split first-party cache into its own field (Fable 5 fix).
- `src/utils/config.ts` — add `firstPartyAdditionalModelOptionsCache` field.
- `src/services/api/providerConfig.ts` — `resolveProviderRequest` accepts a full auth bundle.
- `src/services/api/authRouting.ts` — unify `ProviderOverride` to `ResolvedProvider`; honor Anthropic-native overrides.
- `src/services/api/agentRouting.ts` — re-export the unified type; resolver returns `ResolvedProvider`.
- `src/services/api/client.ts` — route Anthropic-native/proxy overrides to the Anthropic client; OpenAI-compatible to the shim.
- `src/services/api/openaiShim.ts` — read the richer override (authHeader/apiFormat) when present.
- `src/query.ts` / `src/services/api/claude.ts` — build the override from the selected model at request time.
- `src/tools/AgentTool/AgentTool.tsx` — per-dispatch `model` accepts any registry model id.
- `src/tools/AgentTool/runAgent.ts` — resolve the dispatch model through the registry.
- `src/components/ModelPicker.tsx` / `src/commands/model/model.tsx` — use the aggregated option list.
- `src/utils/swarm/spawnUtils.ts` / `src/tools/shared/spawnMultiAgent.ts` — per-teammate provider env + message-bus wiring.

---

## Milestones

- **M0 — Register Opus 4.8 + Fable 5, fix the disappearing-model cache bug.** Independently shippable; fixes the reported Fable 5 bug.
- **M1 — `ResolvedProvider` carrier + model→profile registry.** Pure data layer, no behavior change.
- **M2 — Generalize per-request routing to Anthropic-native overrides.** Enables one request to target Anthropic while another targets OpenAI.
- **M3 — Aggregating `/model` picker across all logged-in providers.**
- **M4 — Main-loop per-request routing (Opus 4.8 ↔ GPT-5.5 switching).**
- **M5 — Cross-provider sub-agent dispatch.**
- **M6 — Agent teams: per-teammate provider + inter-agent message bus.**

Each milestone ends in a green build (`bun run build`) and green tests.

---

## M0 — Register Opus 4.8 + Fable 5, fix the cache bug

### Task 0.1: Add the new-model config objects

**Files:**
- Modify: `src/utils/model/configs.ts` (after the last `CLAUDE_*_CONFIG`, ~`:228`)
- Test: `src/utils/model/configs.test.ts` (create if absent)

- [ ] **Step 1: Write the failing test**

```ts
// src/utils/model/configs.test.ts
import { expect, test } from 'bun:test'
import { CLAUDE_OPUS_4_8_CONFIG, CLAUDE_FABLE_5_CONFIG } from './configs.js'

test('Opus 4.8 config exposes the canonical id', () => {
  expect(CLAUDE_OPUS_4_8_CONFIG.firstParty).toBe('claude-opus-4-8')
})

test('Fable 5 config exposes the canonical id', () => {
  expect(CLAUDE_FABLE_5_CONFIG.firstParty).toBe('claude-fable-5')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/utils/model/configs.test.ts`
Expected: FAIL — `CLAUDE_OPUS_4_8_CONFIG` is not exported.

- [ ] **Step 3: Add the config objects**

First read an existing config object (e.g. `CLAUDE_OPUS_4_7_CONFIG`) in `src/utils/model/configs.ts` to copy its exact shape (it maps `firstParty`, `bedrock`, `vertex`, and any other provider keys). Add directly below it, reusing every key that the existing objects use:

```ts
// @[MODEL LAUNCH] Opus 4.8
export const CLAUDE_OPUS_4_8_CONFIG = {
  ...CLAUDE_OPUS_4_7_CONFIG,
  firstParty: 'claude-opus-4-8',
  bedrock: 'anthropic.claude-opus-4-8-v1:0',
  vertex: 'claude-opus-4-8@20260601',
} as const

// @[MODEL LAUNCH] Fable 5
export const CLAUDE_FABLE_5_CONFIG = {
  ...CLAUDE_OPUS_4_7_CONFIG,
  firstParty: 'claude-fable-5',
  bedrock: 'anthropic.claude-fable-5-v1:0',
  vertex: 'claude-fable-5@20260601',
} as const
```

> If the real Bedrock/Vertex ids differ, use the ids from the Anthropic model docs; the `firstParty` values (`claude-opus-4-8`, `claude-fable-5`) are the load-bearing ones for this harness and must be exact.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/utils/model/configs.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/utils/model/configs.ts src/utils/model/configs.test.ts
git commit -m "feat(models): register claude-opus-4-8 and claude-fable-5 configs"
```

### Task 0.2: Marketing names + family info

**Files:**
- Modify: `src/utils/model/model.ts:868-915` (`getMarketingNameForModel`)
- Modify: `src/utils/model/modelOptions.ts:605-644` (`getModelFamilyInfo`)
- Test: `src/utils/model/model.test.ts` (add cases)

- [ ] **Step 1: Write the failing test**

```ts
// add to src/utils/model/model.test.ts
import { getMarketingNameForModel } from './model.js'
test('marketing name for Opus 4.8', () => {
  expect(getMarketingNameForModel('claude-opus-4-8')).toBe('Opus 4.8')
})
test('marketing name for Fable 5', () => {
  expect(getMarketingNameForModel('claude-fable-5')).toBe('Fable 5')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/utils/model/model.test.ts`
Expected: FAIL — returns `undefined`.

- [ ] **Step 3: Add the mappings**

In `getMarketingNameForModel` (`src/utils/model/model.ts`), find the existing chain that maps `claude-opus-4-7` → `'Opus 4.7'` and add, following the identical pattern used there:

```ts
  if (id.startsWith('claude-opus-4-8')) return 'Opus 4.8'
  if (id.startsWith('claude-fable-5')) return 'Fable 5'
```

In `getModelFamilyInfo` (`src/utils/model/modelOptions.ts`), find where Opus 4.7 is described and add equivalent entries so the "newer version available" logic recognizes 4.8 as newest Opus. Mirror the exact structure of the existing Opus entry (do not invent new fields).

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/utils/model/model.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/utils/model/model.ts src/utils/model/modelOptions.ts src/utils/model/model.test.ts
git commit -m "feat(models): marketing names + family info for Opus 4.8 and Fable 5"
```

### Task 0.3: Picker option builders for the new models

**Files:**
- Modify: `src/utils/model/modelOptions.ts` (add `getOpus48Option`, `getFable5Option`; wire into `getModelOptionsBase:402`)
- Test: `src/utils/model/modelOptions.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/utils/model/modelOptions.test.ts
import { expect, test } from 'bun:test'
import { getOpus48Option, getFable5Option } from './modelOptions.js'

test('Opus 4.8 option has the canonical value', () => {
  expect(getOpus48Option().value).toBe('claude-opus-4-8')
  expect(getOpus48Option().label).toContain('Opus 4.8')
})
test('Fable 5 option has the canonical value', () => {
  expect(getFable5Option().value).toBe('claude-fable-5')
  expect(getFable5Option().label).toContain('Fable 5')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/utils/model/modelOptions.test.ts`
Expected: FAIL — `getOpus48Option` is not exported.

- [ ] **Step 3: Implement the option builders and register them**

Read `getOpus47Option` in `modelOptions.ts` for the exact `ModelOption` shape, then add (copy its structure precisely — same fields, same description style; no new fields):

```ts
export function getOpus48Option(): ModelOption {
  return {
    value: 'claude-opus-4-8',
    label: 'Opus 4.8',
    description: 'Most capable Claude model',
  }
}

export function getFable5Option(): ModelOption {
  return {
    value: 'claude-fable-5',
    label: 'Fable 5',
    description: 'Latest Claude model',
  }
}
```

In `getModelOptionsBase` (`:402`), in the first-party / subscriber tier branch where `getOpus47Option()` is pushed, add `getOpus48Option()` and `getFable5Option()` ahead of the older Opus entries so they appear first.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/utils/model/modelOptions.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/utils/model/modelOptions.ts src/utils/model/modelOptions.test.ts
git commit -m "feat(models): /model picker options for Opus 4.8 and Fable 5"
```

### Task 0.4: Fix the disappearing-model cache bug (separate first-party cache field)

**Root cause:** `fetchBootstrapData` writes both first-party and OpenAI-discovery results into the single `config.additionalModelOptionsCache` field; switching providers overwrites first-party entries, and `getScopedAdditionalModelOptions` returns `[]` whenever the active scope isn't `firstParty`. Fix: store first-party additions in their own field that is never overwritten by OpenAI discovery and is always available when on the first-party route.

**Files:**
- Modify: `src/utils/config.ts:604,617` (add field `firstPartyAdditionalModelOptionsCache`)
- Modify: `src/services/api/bootstrap.ts:213-246`
- Modify: `src/utils/model/modelOptions.ts:56-73,704-708`
- Test: `src/utils/model/modelOptions.test.ts`, `src/services/api/bootstrap.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// add to src/utils/model/modelOptions.test.ts
import { getScopedAdditionalModelOptions } from './modelOptions.js'
import { getGlobalConfig, saveGlobalConfig } from '../config.js'

test('first-party bootstrap additions survive a provider scope change', () => {
  saveGlobalConfig(c => ({
    ...c,
    firstPartyAdditionalModelOptionsCache: [
      { value: 'claude-fable-5', label: 'Fable 5', description: 'Latest Claude model' },
    ],
  }))
  // Even with the OpenAI scope marker set, first-party additions must remain
  // reachable on the first-party route (this is what the picker reads).
  const opts = getScopedAdditionalModelOptions('firstParty')
  expect(opts.some(o => o.value === 'claude-fable-5')).toBe(true)
})
```

> Note the new signature: `getScopedAdditionalModelOptions(scope: string)` takes the scope explicitly so it is testable without mutating `process.env`. Update its one caller in `getModelOptions` accordingly.

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/utils/model/modelOptions.test.ts`
Expected: FAIL — field/param does not exist.

- [ ] **Step 3: Add the config field**

In `src/utils/config.ts`, beside `additionalModelOptionsCache` (`:604`) and its scope (`:617`), add:

```ts
  firstPartyAdditionalModelOptionsCache?: ModelOption[]
```

Add `'firstPartyAdditionalModelOptionsCache'` to the persisted-keys list that `additionalModelOptionsCache` belongs to (search the same file for where `additionalModelOptionsCache` appears in the key allowlist and mirror it).

- [ ] **Step 4: Route first-party bootstrap writes to the new field**

In `src/services/api/bootstrap.ts`, at the cache-write (`:241-246`): when the resolved scope is `firstParty`, write to `firstPartyAdditionalModelOptionsCache` instead of the shared `additionalModelOptionsCache`; leave the `openai:` scope writing to `additionalModelOptionsCache` (or its own field) unchanged. Concretely, branch on the scope variable already computed in that function:

```ts
if (scope === 'firstParty') {
  saveGlobalConfig(c => ({ ...c, firstPartyAdditionalModelOptionsCache: options }))
} else {
  saveGlobalConfig(c => ({
    ...c,
    additionalModelOptionsCache: options,
    additionalModelOptionsCacheScope: scope,
  }))
}
```

- [ ] **Step 4b: Make the unchanged-check scope-aware (review #6)**

The early-return at `bootstrap.ts:231-238` compares `config.additionalModelOptionsCache` / `...Scope`. Since first-party now writes its own field, update that comparison so the first-party scope compares against `config.firstPartyAdditionalModelOptionsCache` and the `openai:` scope keeps comparing the shared field. Concretely, branch the `isEqual(...)` guard on `scope === 'firstParty'` before deciding whether to skip the write.

- [ ] **Step 5: Read the new field in the picker**

Rewrite `getScopedAdditionalModelOptions` (`modelOptions.ts:56-73`) to take an explicit scope and read the first-party field for the first-party scope:

```ts
export function getScopedAdditionalModelOptions(activeScope: string | null): ModelOption[] {
  const config = getGlobalConfig()
  if (!activeScope) return []
  if (activeScope === 'firstParty') {
    return config.firstPartyAdditionalModelOptionsCache ?? []
  }
  if (config.additionalModelOptionsCacheScope === activeScope) {
    return config.additionalModelOptionsCache ?? []
  }
  return []
}
```

Update the call site inside `getModelOptions` (`:704-708`) to pass `getAdditionalModelOptionsCacheScope()` as the argument.

- [ ] **Step 6: Run tests to verify they pass**

Run: `bun test src/utils/model/modelOptions.test.ts src/services/api/bootstrap.test.ts`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/utils/config.ts src/services/api/bootstrap.ts src/utils/model/modelOptions.ts src/utils/model/modelOptions.test.ts
git commit -m "fix(models): first-party bootstrap models no longer vanish after a provider switch"
```

### Task 0.5: Milestone build gate

- [ ] **Step 1: Typecheck and build**

Run: `bun run typecheck` (ignore the pre-existing "Cannot find module './commands/...'" bundle-only errors; your touched files must be clean) then `bun run build`.
Expected: build succeeds.

- [ ] **Step 2: Manual smoke (optional but recommended)**

Run: `env -u ANTHROPIC_API_KEY CLAUDE_CONFIG_DIR=$HOME/.openclaude-home node bin/openclaude` on the Anthropic route, open `/model`, confirm Opus 4.8 + Fable 5 appear, switch to another Anthropic model, reopen `/model`, confirm they are still there.

- [ ] **Step 3: Commit (if smoke required tweaks)** — otherwise skip.

---

## M1 — `ResolvedProvider` carrier + model→profile registry

### Task 1.1: The `ResolvedProvider` type and builders

**Files:**
- Create: `src/services/api/resolvedProvider.ts`
- Test: `src/services/api/resolvedProvider.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/services/api/resolvedProvider.test.ts
import { expect, test } from 'bun:test'
import {
  type ResolvedProvider,
  firstPartyResolvedProvider,
  resolvedProviderFromProfile,
} from './resolvedProvider.js'

test('firstPartyResolvedProvider describes the native Anthropic route', () => {
  const rp = firstPartyResolvedProvider('claude-opus-4-8')
  expect(rp.kind).toBe('anthropic-native')
  expect(rp.profileId).toBe('first-party')
  expect(rp.model).toBe('claude-opus-4-8')
})

test('resolvedProviderFromProfile maps an OpenAI-compatible profile', () => {
  const rp = resolvedProviderFromProfile(
    {
      id: 'p1',
      name: 'OpenRouter',
      provider: 'openai',
      baseUrl: 'https://openrouter.ai/api/v1',
      model: 'openai/gpt-5.5',
      apiKey: 'sk-test',
    } as any,
    'openai/gpt-5.5',
  )
  expect(rp.kind).toBe('openai-compatible')
  expect(rp.baseURL).toBe('https://openrouter.ai/api/v1')
  expect(rp.apiKey).toBe('sk-test')
  expect(rp.model).toBe('openai/gpt-5.5')
})

test('resolvedProviderFromProfile maps a Claude Max proxy profile to anthropic-proxy', () => {
  const rp = resolvedProviderFromProfile(
    {
      id: 'p2',
      name: 'Anthropic (Subscription)',
      provider: 'anthropic',
      baseUrl: 'http://127.0.0.1:8031',
      model: 'claude-sonnet-4-5',
    } as any,
    'claude-sonnet-4-5',
  )
  expect(rp.kind).toBe('anthropic-proxy')
  expect(rp.baseURL).toBe('http://127.0.0.1:8031')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/services/api/resolvedProvider.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the carrier**

```ts
// src/services/api/resolvedProvider.ts
import type { ProviderProfile } from '../../utils/config.js'

export type ResolvedProviderKind =
  | 'anthropic-native'
  | 'anthropic-proxy'
  | 'openai-compatible'
  | 'gemini'
  | 'bedrock'
  | 'vertex'

/** Self-contained description of how to reach a provider for ONE request. */
// IMPORTANT (review fix #3): the existing `ProviderOverride` type is
// `{ model; baseURL; apiKey }` with CAPITAL `baseURL`, and the shim/client
// already read `.baseURL`. ResolvedProvider therefore uses `baseURL` (capital)
// so those existing readers keep working unchanged. Map `profile.baseUrl`
// (lowercase, the ProviderProfile field) → `baseURL` in the builder.
// `apiFormat` and `authScheme` reuse the real config types.
import type {
  OpenAICompatibleApiFormat,
  OpenAICompatibleAuthScheme,
} from '../../utils/config.js'

export type ResolvedProvider = {
  /** Owning profile id, or 'first-party' for native Anthropic. */
  profileId: string
  kind: ResolvedProviderKind
  /** The model id to request from this provider. */
  model: string
  baseURL?: string
  apiKey?: string
  authHeader?: string
  authScheme?: OpenAICompatibleAuthScheme
  authHeaderValue?: string
  apiFormat?: OpenAICompatibleApiFormat
  /** OAuth bearer for subscription-billed providers (Codex). */
  oauthAccessToken?: string
}

export function firstPartyResolvedProvider(model: string): ResolvedProvider {
  return { profileId: 'first-party', kind: 'anthropic-native', model }
}

function kindFromProfile(profile: ProviderProfile): ResolvedProviderKind {
  const provider = profile.provider ?? 'openai'
  const baseUrl = (profile.baseUrl ?? '').toLowerCase()
  if (provider === 'anthropic') {
    // A local/loopback Anthropic base URL is the Claude Max OAuth proxy.
    if (baseUrl.includes('127.0.0.1') || baseUrl.includes('localhost')) {
      return 'anthropic-proxy'
    }
    return 'anthropic-native'
  }
  if (provider === 'gemini') return 'gemini'
  if (provider === 'bedrock') return 'bedrock'
  if (provider === 'vertex') return 'vertex'
  return 'openai-compatible'
}

export function resolvedProviderFromProfile(
  profile: ProviderProfile,
  model: string,
): ResolvedProvider {
  return {
    profileId: profile.id,
    kind: kindFromProfile(profile),
    model,
    baseURL: profile.baseUrl || undefined, // lowercase field → capital carrier
    apiKey: profile.apiKey || undefined,
    authHeader: profile.authHeader || undefined,
    authScheme: profile.authScheme || undefined,
    authHeaderValue: profile.authHeaderValue || undefined,
    apiFormat: profile.apiFormat || undefined,
  }
}
```

> Verified: `ProviderProfile` (`src/utils/config.ts:191`) has exactly `id, name, provider, baseUrl, model, apiKey?, apiFormat?, authHeader?, authScheme?, authHeaderValue?, customHeaders?`. All builder fields exist. `apiFormat`/`authScheme` are `OpenAICompatibleApiFormat`/`OpenAICompatibleAuthScheme` (exported from `config.ts`).

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/services/api/resolvedProvider.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/services/api/resolvedProvider.ts src/services/api/resolvedProvider.test.ts
git commit -m "feat(api): ResolvedProvider carrier for per-request provider routing"
```

### Task 1.2: OAuth-credential enrichment for subscription providers

**Files:**
- Modify: `src/services/api/resolvedProvider.ts` (add `enrichWithStoredCredentials`)
- Test: `src/services/api/resolvedProvider.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// add to src/services/api/resolvedProvider.test.ts
import { enrichWithStoredCredentials } from './resolvedProvider.js'

test('Codex OAuth profile gets its access token + account id injected', () => {
  const base = {
    profileId: 'p3', kind: 'openai-compatible' as const,
    model: 'codexplan', baseURL: 'https://chatgpt.com/backend-api/codex',
  }
  const enriched = enrichWithStoredCredentials(base, {
    readCodex: () => ({ accessToken: 'tok-123', accountId: 'acct-9', refreshToken: 'r' }),
  })
  expect(enriched.oauthAccessToken).toBe('tok-123')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/services/api/resolvedProvider.test.ts`
Expected: FAIL — `enrichWithStoredCredentials` not exported.

- [ ] **Step 3: Implement**

```ts
// add to src/services/api/resolvedProvider.ts
import { isCodexBaseUrl } from './providerConfig.js'

type CredentialReaders = {
  readCodex?: () => { accessToken: string; accountId?: string } | undefined
}

export function enrichWithStoredCredentials(
  rp: ResolvedProvider,
  readers: CredentialReaders = {},
): ResolvedProvider {
  if (rp.baseURL && isCodexBaseUrl(rp.baseURL) && readers.readCodex) {
    const cred = readers.readCodex()
    if (cred?.accessToken) {
      return { ...rp, oauthAccessToken: cred.accessToken }
    }
  }
  return rp
}
```

In production callers, pass `readCodex: () => readCodexCredentials()` from `src/utils/codexCredentials.ts`.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/services/api/resolvedProvider.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/services/api/resolvedProvider.ts src/services/api/resolvedProvider.test.ts
git commit -m "feat(api): enrich ResolvedProvider with stored OAuth credentials"
```

### Task 1.3: The model→profile registry

**Files:**
- Create: `src/services/api/modelRegistry.ts`
- Test: `src/services/api/modelRegistry.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/services/api/modelRegistry.test.ts
import { expect, test } from 'bun:test'
import { buildModelRegistry, resolveProviderForModel } from './modelRegistry.js'

const PROFILES = [
  { id: 'p1', name: 'OpenRouter', provider: 'openai', baseUrl: 'https://openrouter.ai/api/v1', model: 'openai/gpt-5.5,anthropic/claude-3.5' },
  { id: 'p2', name: 'Ollama', provider: 'openai', baseUrl: 'http://localhost:11434/v1', model: 'llama3.2:latest' },
] as any[]

test('registry maps each profile model to its profile', () => {
  const reg = buildModelRegistry({
    firstPartyModels: ['claude-opus-4-8', 'claude-fable-5'],
    profiles: PROFILES,
  })
  expect(reg.get('openai/gpt-5.5')?.profileId).toBe('p1')
  expect(reg.get('llama3.2:latest')?.profileId).toBe('p2')
  expect(reg.get('claude-opus-4-8')?.profileId).toBe('first-party')
})

test('resolveProviderForModel returns a ResolvedProvider for a known model', () => {
  const rp = resolveProviderForModel('openai/gpt-5.5', {
    firstPartyModels: ['claude-opus-4-8'],
    profiles: PROFILES,
  })
  expect(rp?.kind).toBe('openai-compatible')
  expect(rp?.baseURL).toBe('https://openrouter.ai/api/v1')
  expect(rp?.model).toBe('openai/gpt-5.5')
})

test('resolveProviderForModel returns null for an unknown model', () => {
  const rp = resolveProviderForModel('mystery-model', { firstPartyModels: [], profiles: [] })
  expect(rp).toBeNull()
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/services/api/modelRegistry.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/services/api/modelRegistry.ts
import type { ProviderProfile } from '../../utils/config.js'
import { parseModelList } from '../../utils/providerModels.js' // verified path (NOT utils/model/)
import {
  firstPartyResolvedProvider,
  resolvedProviderFromProfile,
  type ResolvedProvider,
} from './resolvedProvider.js'

export type RegistryInput = {
  firstPartyModels: string[]
  profiles: ProviderProfile[]
}

/** model id -> ResolvedProvider. First match wins; profiles in array order. */
export function buildModelRegistry(input: RegistryInput): Map<string, ResolvedProvider> {
  const reg = new Map<string, ResolvedProvider>()
  for (const model of input.firstPartyModels) {
    if (!reg.has(model)) reg.set(model, firstPartyResolvedProvider(model))
  }
  for (const profile of input.profiles) {
    const models = parseModelList(profile.model ?? '')
    for (const model of models) {
      if (!reg.has(model)) {
        reg.set(model, resolvedProviderFromProfile(profile, model))
      }
    }
  }
  return reg
}

export function resolveProviderForModel(
  model: string,
  input: RegistryInput,
): ResolvedProvider | null {
  return buildModelRegistry(input).get(model) ?? null
}
```

> `parseModelList` is exported from `src/utils/providerModels.ts:14` (`export function parseModelList(modelField: string): string[]`). It splits a profile's comma/newline model list.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/services/api/modelRegistry.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/services/api/modelRegistry.ts src/services/api/modelRegistry.test.ts
git commit -m "feat(api): model->profile registry (resolveProviderForModel)"
```

### Task 1.4: Production wiring helper for the registry

**Files:**
- Modify: `src/services/api/modelRegistry.ts` (add `buildLiveRegistryInput`)
- Test: `src/services/api/modelRegistry.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// add to src/services/api/modelRegistry.test.ts
import { buildLiveRegistryInput } from './modelRegistry.js'

test('buildLiveRegistryInput reads first-party models + saved profiles', () => {
  const input = buildLiveRegistryInput({
    getFirstPartyModels: () => ['claude-opus-4-8'],
    getProfiles: () => PROFILES,
  })
  expect(input.firstPartyModels).toContain('claude-opus-4-8')
  expect(input.profiles.length).toBe(2)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/services/api/modelRegistry.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
// add to src/services/api/modelRegistry.ts
export function buildLiveRegistryInput(deps: {
  getFirstPartyModels: () => string[]
  getProfiles: () => ProviderProfile[]
}): RegistryInput {
  return {
    firstPartyModels: deps.getFirstPartyModels(),
    profiles: deps.getProfiles(),
  }
}
```

Production callers pass `getFirstPartyModels` = a function returning the static first-party option values plus `firstPartyAdditionalModelOptionsCache` values, and `getProfiles` = `getProviderProfiles()` from `src/utils/providerProfiles.ts`.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/services/api/modelRegistry.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/services/api/modelRegistry.ts src/services/api/modelRegistry.test.ts
git commit -m "feat(api): live registry input builder from config"
```

### Task 1.5: Milestone build gate

- [ ] Run `bun run typecheck` (touched files clean) and `bun run build`. Expected: success. Commit any fixups.

---

## M2 — Generalize per-request routing to Anthropic-native overrides

**Goal:** `getAnthropicClient({ providerOverride })` currently always routes to the OpenAI shim. Make it dispatch on the override's `kind`: `openai-compatible` → shim (existing), `anthropic-native`/`anthropic-proxy` → the Anthropic client with the override's base URL + auth. Unify the duplicated `ProviderOverride` types onto `ResolvedProvider`.

### Task 2.1: Unify the override type onto `ResolvedProvider`

**Files:**
- Modify: `src/services/api/authRouting.ts:11` and `src/services/api/agentRouting.ts:7`
- Modify: `src/Tool.ts:181`, `src/query.ts:917` (type only)
- Test: `src/services/api/authRouting.test.ts`

**Verified shape (read before editing):** the real gate is `shouldUseFirstPartyAnthropicAuthForProvider({ providerOverride, apiProvider, isFirstPartyBaseUrl, routeId })` at `authRouting.ts:13`; its first statement is `if (providerOverride || apiProvider !== 'firstParty') return false`. The public `shouldUseFirstPartyAnthropicAuth(providerOverride?)` (`:42`) is a one-arg wrapper that fills the other args from env. The existing `ProviderOverride` type (`authRouting.ts:11`) is `{ model: string; baseURL: string; apiKey: string }`.

- [ ] **Step 1: Write the failing test**

```ts
// src/services/api/authRouting.test.ts (add)
import { expect, test } from 'bun:test'
import { shouldUseFirstPartyAnthropicAuthForProvider } from './authRouting.js'
import type { ResolvedProvider } from './resolvedProvider.js'

test('an openai-compatible override disables first-party auth', () => {
  const override: ResolvedProvider = {
    profileId: 'p1', kind: 'openai-compatible', model: 'gpt-5.5',
    baseURL: 'https://openrouter.ai/api/v1', apiKey: 'sk',
  }
  expect(shouldUseFirstPartyAnthropicAuthForProvider({
    providerOverride: override, apiProvider: 'firstParty',
  })).toBe(false)
})

test('an anthropic-native override keeps first-party auth ON', () => {
  const override: ResolvedProvider = {
    profileId: 'first-party', kind: 'anthropic-native', model: 'claude-opus-4-8',
  }
  expect(shouldUseFirstPartyAnthropicAuthForProvider({
    providerOverride: override, apiProvider: 'openai', // even when global env is OpenAI
  })).toBe(true)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/services/api/authRouting.test.ts`
Expected: FAIL — second case returns false (override short-circuits to false today).

- [ ] **Step 3: Make the override short-circuit kind-aware and unify the type**

In `src/services/api/authRouting.ts`: replace the `ProviderOverride` type alias (`:11`) with `import type { ResolvedProvider } from './resolvedProvider.js'` and `export type ProviderOverride = ResolvedProvider` (back-compat alias so `client.ts:47`'s import keeps working). Then change the first line of `shouldUseFirstPartyAnthropicAuthForProvider` (`:13`) from:

```ts
  if (providerOverride || apiProvider !== 'firstParty') {
    return false
  }
```

to:

```ts
  if (providerOverride) {
    // Anthropic-native/proxy overrides still authenticate as Anthropic;
    // every other override kind is third-party and must not.
    return (
      providerOverride.kind === 'anthropic-native' ||
      providerOverride.kind === 'anthropic-proxy'
    )
  }
  if (apiProvider !== 'firstParty') {
    return false
  }
```

> Note: the existing `ProviderOverride` had no `kind` field; after the type becomes `ResolvedProvider`, `kind` is present. The wrapper `shouldUseFirstPartyAnthropicAuth(providerOverride?)` (`:42`) needs no signature change.

In `src/services/api/agentRouting.ts`: replace its duplicate `ProviderOverride` interface (`:7`) with `export type { ResolvedProvider as ProviderOverride } from './resolvedProvider.js'`. Update `resolveAgentProvider` (`:28`) to return a `ResolvedProvider` (`kind: 'openai-compatible'`, `profileId` from the settings key, `baseURL`, `apiKey`, `model`).

In `src/Tool.ts:181` and `src/query.ts:917`, the `providerOverride?` annotation now resolves to `ResolvedProvider` via the alias — no change needed unless they import the concrete type, in which case point the import at `resolvedProvider.js`.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/services/api/authRouting.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/services/api/authRouting.ts src/services/api/agentRouting.ts src/Tool.ts src/query.ts src/services/api/authRouting.test.ts
git commit -m "refactor(api): unify ProviderOverride onto ResolvedProvider"
```

### Task 2.2: Route overrides by kind in `getAnthropicClient`

**Files:**
- Modify: `src/services/api/client.ts:195,281-296`
- Test: `src/services/api/client.test.ts` (create if absent; if Anthropic client construction is hard to unit-test, test the dispatch helper extracted below)

- [ ] **Step 1: Extract a pure dispatch decision + write its failing test**

Add a pure helper to `client.ts` and test it:

```ts
// src/services/api/client.test.ts
import { expect, test } from 'bun:test'
import { overrideClientTarget } from './client.js'
import type { ResolvedProvider } from './resolvedProvider.js'

test('openai-compatible override targets the shim', () => {
  const o: ResolvedProvider = { profileId: 'p', kind: 'openai-compatible', model: 'gpt-5.5', baseURL: 'https://x/v1', apiKey: 'k' }
  expect(overrideClientTarget(o)).toBe('openai-shim')
})
test('anthropic-native override targets the anthropic client', () => {
  const o: ResolvedProvider = { profileId: 'first-party', kind: 'anthropic-native', model: 'claude-opus-4-8' }
  expect(overrideClientTarget(o)).toBe('anthropic')
})
test('anthropic-proxy override targets the anthropic client', () => {
  const o: ResolvedProvider = { profileId: 'p', kind: 'anthropic-proxy', model: 'claude-sonnet-4-5', baseURL: 'http://127.0.0.1:8031' }
  expect(overrideClientTarget(o)).toBe('anthropic')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/services/api/client.test.ts`
Expected: FAIL — `overrideClientTarget` not exported.

- [ ] **Step 3: Implement the helper and use it in `getAnthropicClient`**

```ts
// src/services/api/client.ts (add, exported)
import type { ResolvedProvider } from './resolvedProvider.js'

export function overrideClientTarget(
  override: ResolvedProvider,
): 'openai-shim' | 'anthropic' {
  switch (override.kind) {
    case 'openai-compatible':
    case 'gemini':
      return 'openai-shim'
    case 'anthropic-native':
    case 'anthropic-proxy':
    case 'bedrock':
    case 'vertex':
      return 'anthropic'
  }
}
```

In `getAnthropicClient` (`:281-296`), replace the unconditional shim route with a kind dispatch. **Security (review #5):** only attach the operator's Claude OAuth token / `ANTHROPIC_API_KEY` when the override base URL is trusted (default Anthropic API or a loopback Claude Max proxy). A profile with `provider:'anthropic'` pointed at an untrusted host must NOT receive the subscription token.

```ts
if (providerOverride) {
  if (overrideClientTarget(providerOverride) === 'openai-shim') {
    const { createOpenAIShimClient } = await import('./openaiShim.js')
    // ...existing header-stripping + return createOpenAIShimClient({..., providerOverride}) ...
  }
  // anthropic-native / anthropic-proxy: native Anthropic client with the
  // override's baseURL. Attach Anthropic credentials ONLY for trusted hosts.
  const trusted = isTrustedAnthropicBaseURL(providerOverride.baseURL)
  return new Anthropic({
    baseURL: providerOverride.baseURL ?? getAnthropicBaseUrl(),
    apiKey: trusted
      ? (providerOverride.apiKey ?? getAnthropicApiKey() ?? undefined)
      : (providerOverride.apiKey ?? undefined),
    authToken: trusted
      ? (providerOverride.oauthAccessToken ?? getClaudeAIOAuthToken() ?? undefined)
      : (providerOverride.oauthAccessToken ?? undefined),
    defaultHeaders: getAnthropicDefaultHeaders(),
  }) as Anthropic
}
```

Add the guard (exported, with its own test in `client.test.ts`):

```ts
export function isTrustedAnthropicBaseURL(baseURL?: string): boolean {
  if (!baseURL) return true // default = api.anthropic.com
  const u = baseURL.toLowerCase()
  return (
    u.includes('api.anthropic.com') ||
    u.includes('127.0.0.1') ||
    u.includes('localhost')
  )
}
```

Test cases to add: trusted for undefined/`api.anthropic.com`/`http://127.0.0.1:8031`; untrusted for `https://evil.example/v1`.

> Read `client.ts:501` (and the github-native `new Anthropic(nativeArgs)` branch near `:301`, which already uses `baseURL`+`authToken`+`apiKey:null`) for the exact construction (default headers, beta headers, `authToken` vs `apiKey`) and mirror it precisely — same helpers. The only differences are `baseURL`/`apiKey`/`authToken` sourced from the override under the trust guard. **Do not remove** the existing credential-stripping for the shim branch (`client.ts:283-288`) — it is the SSRF mitigation, not alignment.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/services/api/client.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/services/api/client.ts src/services/api/client.test.ts
git commit -m "feat(api): route ResolvedProvider overrides to the correct client by kind"
```

### Task 2.3: Carry authHeader/apiFormat into the shim path

**Files:**
- Modify: `src/services/api/openaiShim.ts:1603,1690,1996-2001`
- Modify: `src/services/api/providerConfig.ts:609` (`resolveProviderRequest` accepts `apiFormat` from override — it already does; confirm)
- Test: `src/services/api/openaiShim.test.ts` (add a focused test on the request-building helper if one is unit-testable; otherwise assert via `resolveProviderRequest`)

- [ ] **Step 1: Write the failing test**

```ts
// src/services/api/providerConfig.test.ts (add)
import { resolveProviderRequest } from './providerConfig.js'
test('explicit apiFormat from an override wins over env', () => {
  const r = resolveProviderRequest({ model: 'gpt-5.5', baseUrl: 'https://x/v1', apiFormat: 'responses' })
  expect(r.transport).not.toBe('chat_completions')
})
```

- [ ] **Step 2: Run test to verify it fails (or passes — confirm current behavior)**

Run: `bun test src/services/api/providerConfig.test.ts`
If it already passes, `resolveProviderRequest` already honors `apiFormat`; in that case make `createOpenAIShimClient` pass `providerOverride.apiFormat` and `providerOverride.authHeaderValue` through and skip to commit. If it fails, implement so the explicit `apiFormat` is honored.

- [ ] **Step 3: Thread override auth fields into the shim**

In `openaiShim.ts`, where the API key is read (`:1690`, `:1996-2001`) and where custom auth headers are applied, prefer the override's fields:

```ts
const apiKey = this.providerOverride?.apiKey ?? process.env.OPENAI_API_KEY ?? ''
const authHeaderValue = this.providerOverride?.authHeaderValue ?? process.env.OPENAI_AUTH_HEADER_VALUE
const authHeaderName = this.providerOverride?.authHeader ?? process.env.OPENAI_AUTH_HEADER
```

And pass `apiFormat: this.providerOverride?.apiFormat` into `resolveProviderRequest` at `:1603`. For Codex OAuth overrides, set the bearer from `providerOverride.oauthAccessToken` and the `chatgpt-account-id` header from the resolved account id.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/services/api/providerConfig.test.ts src/services/api/openaiShim.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/services/api/openaiShim.ts src/services/api/providerConfig.ts src/services/api/providerConfig.test.ts
git commit -m "feat(api): shim honors override authHeader/apiFormat/oauth fields"
```

### Task 2.4: Milestone build gate

- [ ] Run `bun run typecheck` (touched clean) + `bun run build`. Fix and commit.

---

## M3 — Aggregating `/model` picker across all logged-in providers

### Task 3.1: `getAllProviderModelOptions`

**Files:**
- Create: `src/utils/model/multiProviderOptions.ts`
- Test: `src/utils/model/multiProviderOptions.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/utils/model/multiProviderOptions.test.ts
import { expect, test } from 'bun:test'
import { getAllProviderModelOptions } from './multiProviderOptions.js'

test('aggregates first-party + every profile, tagging each option with its provider', () => {
  const opts = getAllProviderModelOptions({
    firstPartyOptions: [{ value: 'claude-opus-4-8', label: 'Opus 4.8', description: '' }],
    profiles: [
      { id: 'p1', name: 'OpenRouter', provider: 'openai', baseUrl: 'https://openrouter.ai/api/v1', model: 'openai/gpt-5.5' },
      { id: 'p2', name: 'Ollama', provider: 'openai', baseUrl: 'http://localhost:11434/v1', model: 'llama3.2:latest' },
    ] as any[],
  })
  const values = opts.map(o => o.value)
  expect(values).toContain('claude-opus-4-8')
  expect(values).toContain('openai/gpt-5.5')
  expect(values).toContain('llama3.2:latest')
  expect(opts.find(o => o.value === 'openai/gpt-5.5')?.providerName).toBe('OpenRouter')
})

test('dedupes by value, first occurrence wins', () => {
  const opts = getAllProviderModelOptions({
    firstPartyOptions: [{ value: 'dup', label: 'A', description: '' }],
    profiles: [{ id: 'p1', name: 'X', provider: 'openai', baseUrl: 'u', model: 'dup' }] as any[],
  })
  expect(opts.filter(o => o.value === 'dup').length).toBe(1)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/utils/model/multiProviderOptions.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/utils/model/multiProviderOptions.ts
import type { ProviderProfile } from '../config.js'
import type { ModelOption } from './modelOptions.js'
import { parseModelList } from '../providerModels.js' // verified path (one level up, NOT ./providerModels)

export type TaggedModelOption = ModelOption & {
  providerId: string
  providerName: string
}

export function getAllProviderModelOptions(input: {
  firstPartyOptions: ModelOption[]
  profiles: ProviderProfile[]
}): TaggedModelOption[] {
  const seen = new Set<string>()
  const out: TaggedModelOption[] = []
  const push = (o: ModelOption, providerId: string, providerName: string) => {
    if (seen.has(o.value)) return
    seen.add(o.value)
    out.push({ ...o, providerId, providerName })
  }
  for (const o of input.firstPartyOptions) push(o, 'first-party', 'Anthropic')
  for (const profile of input.profiles) {
    for (const model of parseModelList(profile.model ?? '')) {
      push(
        { value: model, label: model, description: `via ${profile.name}` },
        profile.id,
        profile.name,
      )
    }
  }
  return out
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/utils/model/multiProviderOptions.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/utils/model/multiProviderOptions.ts src/utils/model/multiProviderOptions.test.ts
git commit -m "feat(models): aggregate model options across all logged-in providers"
```

### Task 3.2: Feed the aggregated list into the picker

**Files:**
- Modify: `src/commands/model/model.tsx:249-268` (build `optionsOverride` from `getAllProviderModelOptions` when more than one provider is configured)
- Modify: `src/components/ModelPicker.tsx:99` (no change to the merge; it already accepts `optionsOverride`)
- Test: manual + a thin test on the selection helper

- [ ] **Step 1: Write the failing test**

```ts
// src/commands/model/multiProvider.test.ts
import { expect, test } from 'bun:test'
import { buildMultiProviderOptionsOverride } from './model.js'

test('returns an override list when >1 provider is logged in', () => {
  const override = buildMultiProviderOptionsOverride({
    firstPartyOptions: [{ value: 'claude-opus-4-8', label: 'Opus 4.8', description: '' }],
    profiles: [
      { id: 'p1', name: 'OpenRouter', provider: 'openai', baseUrl: 'u', model: 'openai/gpt-5.5' },
    ] as any[],
  })
  expect(override?.some(o => o.value === 'openai/gpt-5.5')).toBe(true)
  expect(override?.some(o => o.value === 'claude-opus-4-8')).toBe(true)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/commands/model/multiProvider.test.ts`
Expected: FAIL — helper not exported.

- [ ] **Step 3: Implement the helper and call it**

Add to `src/commands/model/model.tsx`:

```ts
import { getAllProviderModelOptions } from '../../utils/model/multiProviderOptions.js'
import type { ModelOption } from '../../utils/model/modelOptions.js'
import type { ProviderProfile } from '../../utils/config.js'

export function buildMultiProviderOptionsOverride(input: {
  firstPartyOptions: ModelOption[]
  profiles: ProviderProfile[]
}): ModelOption[] | null {
  if (input.profiles.length === 0) return null
  return getAllProviderModelOptions(input)
}
```

In `loadModelDiscoveryContext`/the `optionsOverride` builder (`:249-268`), when there is more than one logged-in provider, set `optionsOverride = buildMultiProviderOptionsOverride({ firstPartyOptions: getModelOptions(fastMode), profiles: getProviderProfiles() })`. Keep the single-provider path unchanged when only one provider exists (backward compatible).

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/commands/model/multiProvider.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/commands/model/model.tsx src/commands/model/multiProvider.test.ts
git commit -m "feat(model-cmd): show all logged-in providers' models in the picker"
```

### Task 3.3: Milestone build gate + manual verification

- [ ] `bun run typecheck` (clean) + `bun run build`.
- [ ] Manual: with two providers logged in (e.g. Anthropic + Ollama), `env -u ANTHROPIC_API_KEY CLAUDE_CONFIG_DIR=$HOME/.openclaude-home node bin/openclaude`, open `/model`, confirm both providers' models appear in one list, each tagged with its provider.
- [ ] Commit any fixups.

---

## M4 — Main-loop per-request routing (Opus 4.8 ↔ GPT-5.5 switching)

**Goal:** when the operator selects a model in `/model`, the main loop's next request resolves *that model's* provider and routes accordingly, regardless of which provider env is "active."

### Task 4.1: Resolve the selected model to an override at request time

**Files:**
- Modify: `src/services/api/claude.ts` (the call sites that invoke `getAnthropicClient` for the main loop — `:555,857,1797`, non-streaming `:2571`)
- Modify: `src/query.ts:917` (already passes `providerOverride`; ensure the main-loop path constructs one from the model)
- Test: `src/services/api/mainLoopRouting.test.ts`

- [ ] **Step 1: Write the failing test**

**Review fix #4 (critical):** routing must NOT assume the global env matches the selected model. If the global active provider is OpenAI but the operator picks Opus 4.8, returning `null` would make the request authenticate as OpenAI. So `resolveMainLoopOverride` returns `null` only when the model is first-party AND the global route is already first-party (the unchanged single-provider path); otherwise it returns an explicit override — including an `anthropic-native` override for a first-party model when the global env is something else.

```ts
// src/services/api/mainLoopRouting.test.ts
import { expect, test } from 'bun:test'
import { resolveMainLoopOverride } from './claude.js'

const REG_INPUT = {
  firstPartyModels: ['claude-opus-4-8'],
  profiles: [
    { id: 'p1', name: 'OpenRouter', provider: 'openai', baseUrl: 'https://openrouter.ai/api/v1', model: 'openai/gpt-5.5', apiKey: 'sk' },
  ] as any[],
}

test('first-party model while global route IS first-party → no override (native path)', () => {
  expect(resolveMainLoopOverride('claude-opus-4-8', REG_INPUT, { globalRouteIsFirstParty: true })).toBeNull()
})

test('first-party model while global route is NOT first-party → anthropic-native override', () => {
  const o = resolveMainLoopOverride('claude-opus-4-8', REG_INPUT, { globalRouteIsFirstParty: false })
  expect(o?.kind).toBe('anthropic-native')
  expect(o?.model).toBe('claude-opus-4-8')
})

test('third-party model → openai-compatible override regardless of global route', () => {
  const o = resolveMainLoopOverride('openai/gpt-5.5', REG_INPUT, { globalRouteIsFirstParty: true })
  expect(o?.kind).toBe('openai-compatible')
  expect(o?.baseURL).toBe('https://openrouter.ai/api/v1')
  expect(o?.model).toBe('openai/gpt-5.5')
})

test('unknown model → null (fall back to default behavior)', () => {
  expect(resolveMainLoopOverride('mystery', REG_INPUT, { globalRouteIsFirstParty: true })).toBeNull()
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/services/api/mainLoopRouting.test.ts`
Expected: FAIL — `resolveMainLoopOverride` not exported.

- [ ] **Step 3: Implement the resolver**

```ts
// src/services/api/claude.ts (add, exported)
import { resolveProviderForModel } from './modelRegistry.js'
import type { RegistryInput } from './modelRegistry.js'
import { firstPartyResolvedProvider, type ResolvedProvider } from './resolvedProvider.js'

export function resolveMainLoopOverride(
  model: string,
  registryInput: RegistryInput,
  ctx: { globalRouteIsFirstParty: boolean },
): ResolvedProvider | null {
  // Kill switch (review #8): when disabled, never route per-model — preserve
  // legacy single-provider behavior entirely.
  if (process.env.OPENCLAUDE_MULTI_PROVIDER === '0') return null
  const rp = resolveProviderForModel(model, registryInput)
  if (!rp) return null
  if (rp.profileId === 'first-party') {
    // Native default path only when the global env is already first-party;
    // otherwise force an explicit anthropic-native override so a first-party
    // model never authenticates as the (different) active provider.
    return ctx.globalRouteIsFirstParty ? null : firstPartyResolvedProvider(model)
  }
  return rp
}
```

Compute `globalRouteIsFirstParty` at the call site from `getAPIProvider() === 'firstParty'`.

- [ ] **Step 4: Wire it into the main-loop request build**

At each main-loop `getAnthropicClient(...)` call in `claude.ts` (`:555,857,1797,2571`), before constructing the client, compute the override from the loop model and pass it:

```ts
import { getAPIProvider } from '../../utils/model/providers.js'

const mainLoopOverride = resolveMainLoopOverride(
  modelForThisRequest,
  buildLiveRegistryInput({
    getFirstPartyModels: getFirstPartyModelIds,
    getProfiles: getProviderProfiles,
  }),
  { globalRouteIsFirstParty: getAPIProvider() === 'firstParty' },
)
const client = await getAnthropicClient({ ...existingArgs, providerOverride: providerOverride ?? mainLoopOverride ?? undefined })
```

> `modelForThisRequest` is the model the loop is about to call (read how the model is currently chosen at each site — likely `getMainLoopModel()` / a `model` param). `getFirstPartyModelIds` (review #10) must be derived, not hardcoded: export a helper from `modelOptions.ts` that returns the `value`s from the same first-party branch `getModelOptionsBase` builds (tier-dependent) plus every `value` in `firstPartyAdditionalModelOptionsCache`. `getProviderProfiles` already exists in `providerProfiles.ts`. If a sub-agent already provided a `providerOverride`, it wins (the `??` order above preserves that).

- [ ] **Step 5: Run test + build to verify**

Run: `bun test src/services/api/mainLoopRouting.test.ts && bun run build`
Expected: PASS + build success.

- [ ] **Step 6: Commit**

```bash
git add src/services/api/claude.ts src/query.ts src/utils/model/modelOptions.ts src/services/api/mainLoopRouting.test.ts
git commit -m "feat(api): main loop resolves the selected model's provider per request"
```

### Task 4.2: Persist & restore the selected model across the session without env swap

**Files:**
- Modify: `src/commands/model/model.tsx:381-432` (`handleSelect`) — ensure selecting a cross-provider model sets `mainLoopModel` app-state (it already does) and does NOT call `setActiveProviderProfile` (no global env swap).
- Test: `src/commands/model/multiProvider.test.ts` (add)

- [ ] **Step 1: Write the failing test**

```ts
// add to src/commands/model/multiProvider.test.ts
import { selectionMutatesProviderEnv } from './model.js'
test('selecting a model never triggers a global provider env swap', () => {
  expect(selectionMutatesProviderEnv('openai/gpt-5.5')).toBe(false)
  expect(selectionMutatesProviderEnv('claude-opus-4-8')).toBe(false)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/commands/model/multiProvider.test.ts`
Expected: FAIL — helper not exported.

- [ ] **Step 3: Implement (assert the invariant in code)**

```ts
// src/commands/model/model.tsx (add, exported)
/** Model selection is provider-routing via the registry, never a global env swap. */
export function selectionMutatesProviderEnv(_model: string): boolean {
  return false
}
```

Verify `handleSelect` only sets `mainLoopModel`/effort in app-state and does not call `setActiveProviderProfile` or `applyProviderProfileToProcessEnv`. If it does, remove that call for the multi-provider path.

**Review #9 — startup restore.** The selected model persists (as the saved main-loop model), but on the next launch the provider must re-resolve from the registry. No new code is required — `resolveMainLoopOverride` runs per request and will resolve the persisted model on the first request of the new session. Add a verification step: launch with a persisted cross-provider model (e.g. `gpt-5.5`) and confirm the first request routes to its provider with no manual re-selection. If the persisted model is not surfaced because its provider profile was deleted, the resolver returns `null` and the loop falls back to the default model — acceptable, but log a one-line notice (no alignment language) so the operator knows why.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/commands/model/multiProvider.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/commands/model/model.tsx src/commands/model/multiProvider.test.ts
git commit -m "feat(model-cmd): model switch routes via registry, no global env swap"
```

### Task 4.3: Milestone end-to-end verification (the headline feature)

- [ ] **Step 1: Manual E2E.** Log into Anthropic (subscription) + an OpenAI-compatible provider. Launch `env -u ANTHROPIC_API_KEY CLAUDE_CONFIG_DIR=$HOME/.openclaude-home node bin/openclaude`. Send a prompt on Opus 4.8, `/model` → switch to GPT-5.5, send another prompt. Confirm the second response is served by OpenAI (watch network/logs) without restart and without ECONNREFUSED.
- [ ] **Step 2: Commit** any fixups; `bun run build`.

---

## M5 — Cross-provider sub-agent dispatch

### Task 5.1: Accept any registry model on the Task tool

**Files:**
- Modify: `src/tools/AgentTool/AgentTool.tsx:85-86` (input schema)
- Test: `src/tools/AgentTool/agentToolSchema.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/tools/AgentTool/agentToolSchema.test.ts
import { expect, test } from 'bun:test'
import { agentToolInputSchema } from './AgentTool.js'

test('Task tool accepts an arbitrary provider model id', () => {
  const parsed = agentToolInputSchema.safeParse({
    description: 'x', prompt: 'y', model: 'openai/gpt-5.5',
  })
  expect(parsed.success).toBe(true)
})
test('Task tool still accepts the tier aliases', () => {
  expect(agentToolInputSchema.safeParse({ description: 'x', prompt: 'y', model: 'opus' }).success).toBe(true)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/tools/AgentTool/agentToolSchema.test.ts`
Expected: FAIL — the schema currently restricts `model` to `z.enum(['sonnet','opus','haiku'])` and isn't exported.

- [ ] **Step 3: Widen the schema and export it**

In `AgentTool.tsx`, change the `model` field from `z.enum(['sonnet','opus','haiku']).optional()` to `z.string().optional()` with a description that mentions both tier aliases and any model id from `/model`. Export the schema object as `agentToolInputSchema` so it is testable.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/tools/AgentTool/agentToolSchema.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/tools/AgentTool/AgentTool.tsx src/tools/AgentTool/agentToolSchema.test.ts
git commit -m "feat(agent): Task tool accepts any provider model id for cross-provider dispatch"
```

### Task 5.2: Resolve the dispatch model through the registry

**Files:**
- Modify: `src/tools/AgentTool/runAgent.ts:340-353,682`
- Test: `src/tools/AgentTool/dispatchOverride.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/tools/AgentTool/dispatchOverride.test.ts
import { expect, test } from 'bun:test'
import { resolveDispatchOverride } from './runAgent.js'

const REG = {
  firstPartyModels: ['claude-opus-4-8'],
  profiles: [{ id: 'p1', name: 'OpenRouter', provider: 'openai', baseUrl: 'https://openrouter.ai/api/v1', model: 'openai/gpt-5.5', apiKey: 'sk' }] as any[],
}

test('a tier alias yields no registry override (uses agent-model path)', () => {
  expect(resolveDispatchOverride('opus', REG)).toBeNull()
})
test('a cross-provider model id yields an override', () => {
  const o = resolveDispatchOverride('openai/gpt-5.5', REG)
  expect(o?.kind).toBe('openai-compatible')
  expect(o?.model).toBe('openai/gpt-5.5')
})
test('a first-party model id yields no override', () => {
  expect(resolveDispatchOverride('claude-opus-4-8', REG)).toBeNull()
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/tools/AgentTool/dispatchOverride.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement and wire**

```ts
// src/tools/AgentTool/runAgent.ts (add, exported)
import { resolveProviderForModel, type RegistryInput } from '../../services/api/modelRegistry.js'
import type { ResolvedProvider } from '../../services/api/resolvedProvider.js'

const TIER_ALIASES = new Set(['sonnet', 'opus', 'haiku', 'inherit'])

export function resolveDispatchOverride(
  model: string | undefined,
  registryInput: RegistryInput,
): ResolvedProvider | null {
  if (process.env.OPENCLAUDE_MULTI_PROVIDER === '0') return null // kill switch (constraint #6)
  if (!model || TIER_ALIASES.has(model)) return null
  const rp = resolveProviderForModel(model, registryInput)
  if (!rp || rp.profileId === 'first-party') return null
  return rp
}
```

In `runAgent` (`:340-353`), after computing `providerOverride` from `resolveAgentProvider`, also compute a per-dispatch override and prefer it when present:

```ts
const dispatchOverride = resolveDispatchOverride(
  model,
  buildLiveRegistryInput({ getFirstPartyModels: getFirstPartyModelIds, getProfiles: getProviderProfiles }),
)
const effectiveOverride = dispatchOverride ?? providerOverride ?? undefined
const effectiveModel = effectiveOverride ? effectiveOverride.model : resolvedAgentModel
```

Attach `effectiveOverride` to the context at `:682` (`providerOverride: effectiveOverride`).

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/tools/AgentTool/dispatchOverride.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/tools/AgentTool/runAgent.ts src/tools/AgentTool/dispatchOverride.test.ts
git commit -m "feat(agent): dispatch sub-agents on a different provider via registry override"
```

### Task 5.3: Per-model persona for the sub-agent (read-only use of identity layer)

**Files:**
- Modify: `src/tools/AgentTool/runAgent.ts` (where the sub-agent system prompt is assembled) — ensure `getModelIdentity(effectiveModel)` is used so a sub-agent running on a different model gets that model's persona. **Do not edit `modelIdentity.ts`.**
- Test: `src/tools/AgentTool/dispatchOverride.test.ts` (add)

- [ ] **Step 1: Write the failing test**

```ts
// add to src/tools/AgentTool/dispatchOverride.test.ts
import { personaModelForDispatch } from './runAgent.js'
test('persona is keyed off the effective (override) model, not the parent', () => {
  const o = resolveDispatchOverride('openai/gpt-5.5', REG)!
  expect(personaModelForDispatch(o, 'claude-opus-4-8')).toBe('openai/gpt-5.5')
})
test('persona falls back to parent model when no override', () => {
  expect(personaModelForDispatch(null, 'claude-opus-4-8')).toBe('claude-opus-4-8')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/tools/AgentTool/dispatchOverride.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
// src/tools/AgentTool/runAgent.ts (add, exported)
export function personaModelForDispatch(
  override: ResolvedProvider | null,
  parentModel: string,
): string {
  return override?.model ?? parentModel
}
```

Where the sub-agent prompt is built, call `getModelIdentity(personaModelForDispatch(effectiveOverride ?? null, parentModel))` (import `getModelIdentity` from `../../constants/modelIdentity.js` — read only).

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/tools/AgentTool/dispatchOverride.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/tools/AgentTool/runAgent.ts src/tools/AgentTool/dispatchOverride.test.ts
git commit -m "feat(agent): cross-provider sub-agent uses the target model's persona"
```

### Task 5.4: Milestone E2E + build gate

- [ ] **Manual:** from an Opus 4.8 session, dispatch a Task with `model: "openai/gpt-5.5"`. Confirm the sub-agent's request hits OpenAI and the result returns to the Opus parent.
- [ ] `bun run typecheck` (clean) + `bun run build`. Commit fixups.

---

## M6 — Agent teams: per-teammate provider + inter-agent message bus

**Goal:** a team of sub-agents — each possibly on a different provider — where teammates can message each other and the orchestrator. The subprocess team path (`spawnMultiAgent`) currently forwards the parent's provider env verbatim and has no messaging beyond results. We add (a) per-teammate provider selection and (b) an in-process message bus the orchestrator and teammates publish/subscribe to.

### Task 6.1: The in-process team message bus

**Files:**
- Create: `src/services/api/teamMessageBus.ts`
- Test: `src/services/api/teamMessageBus.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/services/api/teamMessageBus.test.ts
import { expect, test } from 'bun:test'
import { TeamMessageBus } from './teamMessageBus.js'

test('a teammate receives a message addressed to it', async () => {
  const bus = new TeamMessageBus('team-1')
  const received: string[] = []
  bus.subscribe('worker-a', m => { received.push(m.body) })
  bus.send({ from: 'orchestrator', to: 'worker-a', body: 'do X' })
  expect(received).toEqual(['do X'])
})

test('broadcast reaches all teammates except the sender', () => {
  const bus = new TeamMessageBus('team-1')
  const a: string[] = []; const b: string[] = []
  bus.subscribe('a', m => a.push(m.body))
  bus.subscribe('b', m => b.push(m.body))
  bus.broadcast({ from: 'a', body: 'hello team' })
  expect(a).toEqual([])
  expect(b).toEqual(['hello team'])
})

test('the orchestrator can read replies addressed to it', () => {
  const bus = new TeamMessageBus('team-1')
  const inbox: string[] = []
  bus.subscribe('orchestrator', m => inbox.push(m.body))
  bus.send({ from: 'worker-a', to: 'orchestrator', body: 'done' })
  expect(inbox).toEqual(['done'])
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/services/api/teamMessageBus.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/services/api/teamMessageBus.ts
export type TeamMessage = {
  from: string
  to?: string // omitted = broadcast
  body: string
  ts?: number
}

type Handler = (m: TeamMessage) => void

/** In-process pub/sub mailbox for one team. No persistence, no network. */
export class TeamMessageBus {
  private handlers = new Map<string, Handler[]>()
  constructor(public readonly teamId: string) {}

  subscribe(agentId: string, handler: Handler): () => void {
    const list = this.handlers.get(agentId) ?? []
    list.push(handler)
    this.handlers.set(agentId, list)
    return () => {
      this.handlers.set(agentId, (this.handlers.get(agentId) ?? []).filter(h => h !== handler))
    }
  }

  send(message: TeamMessage): void {
    if (!message.to) return this.broadcast(message)
    for (const h of this.handlers.get(message.to) ?? []) h(message)
  }

  broadcast(message: TeamMessage): void {
    for (const [agentId, handlers] of this.handlers) {
      if (agentId === message.from) continue
      for (const h of handlers) h(message)
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/services/api/teamMessageBus.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/services/api/teamMessageBus.ts src/services/api/teamMessageBus.test.ts
git commit -m "feat(teams): in-process message bus for inter-agent + orchestrator comms"
```

### Task 6.2: Per-teammate provider env in the subprocess path

**Files:**
- Modify: `src/utils/swarm/spawnUtils.ts:96-168` (`buildInheritedEnvVars` → accept a per-teammate provider override)
- Modify: `src/tools/shared/spawnMultiAgent.ts:517-518`
- Test: `src/utils/swarm/spawnUtils.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/utils/swarm/spawnUtils.test.ts
import { expect, test } from 'bun:test'
import { buildTeammateProviderEnv } from './spawnUtils.js'

test('teammate provider override produces OpenAI env, not the parent Anthropic env', () => {
  const env = buildTeammateProviderEnv({
    profileId: 'p1', kind: 'openai-compatible', model: 'openai/gpt-5.5',
    baseURL: 'https://openrouter.ai/api/v1', apiKey: 'sk',
  })
  expect(env.CLAUDE_CODE_USE_OPENAI).toBe('1')
  expect(env.OPENAI_BASE_URL).toBe('https://openrouter.ai/api/v1')
  expect(env.OPENAI_API_KEY).toBe('sk')
  expect(env.OPENAI_MODEL).toBe('openai/gpt-5.5')
})

test('an anthropic-native teammate override produces native Anthropic env', () => {
  const env = buildTeammateProviderEnv({
    profileId: 'first-party', kind: 'anthropic-native', model: 'claude-opus-4-8',
  })
  expect(env.CLAUDE_CODE_USE_OPENAI).toBeUndefined()
  expect(env.ANTHROPIC_MODEL).toBe('claude-opus-4-8')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/utils/swarm/spawnUtils.test.ts`
Expected: FAIL — helper not exported.

- [ ] **Step 3: Implement the per-teammate env builder**

```ts
// src/utils/swarm/spawnUtils.ts (add, exported)
import type { ResolvedProvider } from '../../services/api/resolvedProvider.js'

export function buildTeammateProviderEnv(rp: ResolvedProvider): NodeJS.ProcessEnv {
  if (rp.kind === 'openai-compatible' || rp.kind === 'gemini') {
    return {
      CLAUDE_CODE_USE_OPENAI: '1',
      OPENAI_BASE_URL: rp.baseURL ?? '',
      OPENAI_API_KEY: rp.apiKey ?? '',
      OPENAI_MODEL: rp.model,
      ...(rp.apiFormat ? { OPENAI_API_FORMAT: rp.apiFormat } : {}),
      ...(rp.authHeader ? { OPENAI_AUTH_HEADER: rp.authHeader } : {}),
      ...(rp.authHeaderValue ? { OPENAI_AUTH_HEADER_VALUE: rp.authHeaderValue } : {}),
    }
  }
  // anthropic-native / anthropic-proxy
  return {
    ANTHROPIC_MODEL: rp.model,
    ...(rp.baseURL ? { ANTHROPIC_BASE_URL: rp.baseURL } : {}),
    ...(rp.apiKey ? { ANTHROPIC_API_KEY: rp.apiKey } : {}),
  }
}
```

In `buildInheritedEnvVars` (`:96-168`), accept an optional `teammateOverride?: ResolvedProvider` argument; when present, *replace* the provider-env subset (the `CLAUDE_CODE_USE_*` / `OPENAI_*` / `ANTHROPIC_*` keys) with `buildTeammateProviderEnv(teammateOverride)` instead of forwarding the parent's. Keep `CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST=1`.

In `spawnMultiAgent.ts:517-518`, thread a per-teammate `ResolvedProvider` (resolved from the teammate's requested model via `resolveProviderForModel`) into `buildInheritedEnvVars`.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/utils/swarm/spawnUtils.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/utils/swarm/spawnUtils.ts src/tools/shared/spawnMultiAgent.ts src/utils/swarm/spawnUtils.test.ts
git commit -m "feat(teams): per-teammate provider selection in the subprocess spawn path"
```

### Task 6.3: Expose the message bus to teammates and the orchestrator

**Files:**
- Modify: `src/tools/shared/spawnMultiAgent.ts` (create one `TeamMessageBus` per team; subscribe the orchestrator; give each teammate a send/receive handle)
- Test: `src/tools/shared/teamComms.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/tools/shared/teamComms.test.ts
import { expect, test } from 'bun:test'
import { createTeamComms } from './spawnMultiAgent.js'

test('orchestrator and two teammates can round-trip messages', () => {
  const comms = createTeamComms('team-1', ['worker-a', 'worker-b'])
  const orchInbox: string[] = []
  comms.onOrchestratorMessage(m => orchInbox.push(`${m.from}:${m.body}`))
  comms.fromTeammate('worker-a').send('orchestrator', 'a-ready')
  comms.fromTeammate('worker-a').broadcast('sync')
  const bInbox: string[] = []
  comms.fromTeammate('worker-b').onMessage(m => bInbox.push(m.body))
  comms.fromTeammate('worker-a').broadcast('sync2')
  expect(orchInbox).toContain('worker-a:a-ready')
  expect(bInbox).toContain('sync2')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/tools/shared/teamComms.test.ts`
Expected: FAIL — `createTeamComms` not exported.

- [ ] **Step 3: Implement the comms facade**

```ts
// src/tools/shared/spawnMultiAgent.ts (add, exported)
import { TeamMessageBus, type TeamMessage } from '../../services/api/teamMessageBus.js'

export function createTeamComms(teamId: string, teammateIds: string[]) {
  const bus = new TeamMessageBus(teamId)
  return {
    bus,
    onOrchestratorMessage(handler: (m: TeamMessage) => void) {
      return bus.subscribe('orchestrator', handler)
    },
    fromTeammate(agentId: string) {
      return {
        send: (to: string, body: string) => bus.send({ from: agentId, to, body }),
        broadcast: (body: string) => bus.broadcast({ from: agentId, body }),
        onMessage: (handler: (m: TeamMessage) => void) => bus.subscribe(agentId, handler),
      }
    },
    teammateIds,
  }
}
```

**Review #7 — process boundaries matter.** `TeamMessageBus` is in-process: it directly serves the orchestrator and any *in-process* sub-agents (the AgentTool path). Subprocess teammates spawned by `spawnMultiAgent` are separate OS processes and **cannot** receive from an in-memory bus — their messaging already rides the existing `SendMessage` tool / team IPC. So the bridge is one-directional plumbing on the orchestrator side: when a subprocess teammate calls `SendMessage`, the orchestrator's IPC handler calls `bus.send(...)` to fan the message out to in-process subscribers (and to other teammates via their `SendMessage` inboxes). Do NOT attempt to deliver in-memory `bus` events into a child process. Read `src/tools/shared/spawnMultiAgent.ts` for the existing teammate→leader IPC and wire its inbound handler to `bus.send`; outbound to a subprocess teammate uses the existing `SendMessage` delivery, not the bus.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/tools/shared/teamComms.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/tools/shared/spawnMultiAgent.ts src/tools/shared/teamComms.test.ts
git commit -m "feat(teams): orchestrator/teammate message-bus facade"
```

### Task 6.4: Milestone E2E + full build gate

- [ ] **Manual:** spawn a team with two teammates pinned to different providers (one Anthropic, one OpenAI); have teammate A broadcast a message, confirm teammate B and the orchestrator receive it, and confirm each teammate's LLM calls hit its own provider.
- [ ] `bun run typecheck` (touched clean) + `bun run build` + `bun test src/services src/utils/model src/tools/AgentTool src/commands/login src/commands/model src/utils/swarm`.
- [ ] **Commit** any fixups.

---

## Final Self-Review checklist (run before declaring done)

- [ ] Spec coverage: multi-provider concurrency (M3/M4), cross-provider `/model` switching (M4), cross-provider sub-agent dispatch (M5), agent-teams comms (M6), Fable 5 bug (M0) — each has tasks.
- [ ] No alignment/guardrail language was added anywhere (grep the diff for refusal/safety phrasing; there should be none).
- [ ] Identity-layer files (`prompts.ts`, `modelIdentity.ts`, `system.ts`, `cyberRiskInstruction.ts`) are unmodified (`git diff --name-only` must not list them).
- [ ] Type consistency: `ResolvedProvider` fields used in M5/M6 match the definition in Task 1.1; `resolveProviderForModel`, `buildLiveRegistryInput`, `resolveMainLoopOverride`, `resolveDispatchOverride`, `buildTeammateProviderEnv`, `TeamMessageBus` signatures match across tasks.
- [ ] Backward compat: a single-provider user (one profile or first-party only) sees unchanged behavior — first-party models resolve to `null` override and use the native path.
- [ ] `bun run build` succeeds; `dist/cli.mjs` regenerated.

---

## Notes for the executor

- Run tests with `bun test <path>`. The repo's `bun run typecheck` surfaces pre-existing "Cannot find module './commands/...'/'./daemon/...'" errors from bundle-only modules — those are not yours; only your touched files must be clean.
- When manually launching the harness, always prefix `env -u ANTHROPIC_API_KEY` and set `CLAUDE_CONFIG_DIR=$HOME/.openclaude-home`, or an exported API key silently routes to the metered API and masks routing bugs.
- The overlay proxy auto-start (already shipped) means an Anthropic (Subscription) profile will bring up `127.0.0.1:8031` on launch; multi-provider routing to that profile reuses it.
- If a `ProviderProfile` field referenced in Task 1.1 does not exist, read `src/utils/config.ts` for the real type and adjust the builder — do not invent fields.
