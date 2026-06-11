# Cross-Harness Transcript Discovery & Resume — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Limitless its own `limitless`-named config/state files decoupled from Claude's, then add a custom subsystem that discovers chat transcripts from any harness on disk, indexes them with a harness tag, and lets `/resume` search by id/name and reconstruct a foreign session into a live Limitless session (full transcript or summary).

**Architecture:** Four phases, each a working, testable milestone. (1) Finalize `limitless` config nomenclature + one-time home migration. (2) A discovery service that walks known harness roots + a pruned `$HOME` scan, runs per-harness detectors, and persists a cached, mtime-incremental index. (3) Per-harness adapters that reconstruct any transcript into Limitless's on-disk `TranscriptMessage` JSONL format (Claude = passthrough, Codex = `rollout` translation, generic = best-effort). (4) Extend the existing `/resume` command to merge index entries (tagged by harness) into the existing `LogSelector` picker, and on selecting a foreign session, materialize it via an adapter then hand off to the existing `context.resume()` path — with a full-vs-summary choice.

**Tech Stack:** TypeScript (Bun runtime), Ink (React TUI), `bun test`. New code lives under `src/services/crossHarness/`. Reuses existing `sessionStorage.ts`, `conversationRecovery.ts`, `LogSelector.tsx`, and the `/resume` command infra.

---

## Scope Check

This spec spans four subsystems. They are **sequentially dependent** (Phase 4 needs 2+3; all assume Phase 1's config home), so this is one plan with four phased milestones rather than four independent plans. Each phase ends green and committable.

## Ground-Truth Reference (verified on disk 2026-06-11)

**Limitless/Claude transcript** — `getClaudeConfigHomeDir()/projects/<sanitizePath(cwd)>/<sessionId>.jsonl`. Message line:
```json
{"parentUuid":"<uuid|null>","isSidechain":false,"type":"user|assistant","message":{"role":"user|assistant","content":"..."|[...]},"uuid":"<uuid>","timestamp":"<iso>","userType":"external","entrypoint":"cli","cwd":"/abs/path","sessionId":"<uuid>","version":"0.14.0","gitBranch":"main"}
```
Metadata lines: `{"type":"last-prompt","lastPrompt":"...","sessionId":"..."}`, `{"type":"custom-title","customTitle":"...","sessionId":"..."}`, `{"type":"summary","summary":"...","leafUuid":"...","sessionId":"..."}`.

**Codex transcript** — `~/.codex/sessions/YYYY/MM/DD/rollout-<iso>-<uuid>.jsonl`. Lines are `{"timestamp","type","payload"}`:
- `type:"session_meta"` → `payload:{id, timestamp, cwd, originator?}`
- `type:"response_item"` + `payload.type:"message"` → `payload:{type:"message", role:"developer|user|assistant", content:[{type:"input_text|output_text", text}]}`
- `type:"event_msg"` → control events (ignore for reconstruction).
Names index: `~/.codex/session_index.jsonl` lines `{"id","thread_name","updated_at"}`.

**Key existing symbols to reuse:**
- `getClaudeConfigHomeDir()` — `src/utils/envUtils.ts:228`
- `getProjectsDir()` — `src/utils/envUtils.ts:264` (`join(getClaudeConfigHomeDir(),'projects')`)
- `sanitizePath(projectDir)` — `src/utils/sessionStorage.ts:432`
- `TranscriptMessage` / `SerializedMessage` types — `src/types/logs.ts:221` / `:8`
- `LogOption` type (has `tag`, `customTitle`, `firstPrompt`, `sessionId`, `messages`, `modified`, `projectPath`, `entrypoint`) — `src/types/logs.ts:19`
- `LogSelector` (filters by `log.tag`, tag tabs) — `src/components/LogSelector.tsx:45`
- `/resume` command — `src/commands/resume/index.ts`, `src/commands/resume/resume.tsx`; registered in `src/commands.ts:50,336`
- `context.resume(sessionId, log, entrypoint)` — `src/types/command.ts:80`
- `loadConversationForResume()` — `src/utils/conversationRecovery.ts:556`
- Home-dir resolver `resolveClaudeConfigHomeDir()` (hardcodes `.openclaude`) — `src/utils/envUtils.ts:204`; `productStateDir.ts` consts `LIMITLESS_DIRNAME='.limitless'`.

---

## File Structure

```
src/services/crossHarness/
  harnessTypes.ts        # HarnessId, DiscoveredTranscript, HarnessAdapter, CrossHarnessIndex (types only)
  detectors.ts           # detectHarness(path, sampledLines) -> DiscoveredTranscript|null  (claude, codex, generic)
  scanner.ts             # scanForTranscripts(): walk known roots + pruned $HOME, return DiscoveredTranscript[]
  transcriptIndex.ts     # load/save/refresh/search the persisted index (mtime-incremental)
  adapters/
    claudeAdapter.ts     # native passthrough (already TranscriptMessage shape)
    codexAdapter.ts      # rollout -> TranscriptMessage[]; summarize()
    genericAdapter.ts    # best-effort role/text extraction; summarize()
    index.ts             # adapterFor(harness): HarnessAdapter
  materialize.ts         # foreign DiscoveredTranscript + mode -> writes new Limitless .jsonl, returns {sessionId, log}
tests/services/crossHarness/
  detectors.test.ts
  scanner.test.ts
  transcriptIndex.test.ts
  codexAdapter.test.ts
  materialize.test.ts
src/commands/resume/resume.tsx   # MODIFY: merge cross-harness entries, harness tag, full/summary choice
src/utils/envUtils.ts            # MODIFY (Phase 1): default home .openclaude -> .limitless + migration
```

---

## Phase 1 — `limitless` Config Nomenclature

**Outcome:** Fresh installs use `~/.limitless/` + `~/.limitless.json`; existing `~/.openclaude` users are migrated by copy (non-destructive); `.claude` is never touched.

### Task 1.1: Flip default config-home dirname to `.limitless`

**Files:**
- Modify: `src/utils/envUtils.ts:204-216` (`resolveClaudeConfigHomeDir`)
- Test: `tests/utils/envUtils.configHome.test.ts`

- [ ] **Step 1: Write the failing test**
```typescript
import { expect, test } from 'bun:test'
import { resolveClaudeConfigHomeDir } from '../../src/utils/envUtils.js'

test('default config home is ~/.limitless when no env + no legacy dirs', () => {
  const r = resolveClaudeConfigHomeDir({ homeDir: '/tmp/none-exist-xyz' })
  expect(r.endsWith('/.limitless')).toBe(true)
})
test('explicit CLAUDE_CONFIG_DIR still wins', () => {
  const r = resolveClaudeConfigHomeDir({ configDirEnv: '/custom/dir', homeDir: '/tmp/x' })
  expect(r).toBe('/custom/dir')
})
```
- [ ] **Step 2: Run to verify it fails** — `bun test tests/utils/envUtils.configHome.test.ts` → FAIL (returns `.openclaude`).
- [ ] **Step 3: Implement** — in `resolveClaudeConfigHomeDir`, change `const openClaudeDir = join(homeDir, '.openclaude')` to `const limitlessDir = join(homeDir, '.limitless')` and return it. Keep the explicit-env branch first.
- [ ] **Step 4: Run to verify it passes.**
- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat(config): default config home to ~/.limitless"`

### Task 1.2: Migrate `~/.openclaude` → `~/.limitless` (copy, idempotent)

**Files:**
- Modify: `src/utils/envUtils.ts` — extend `getClaudeConfigHomeDir` memoized resolver (`:228`) to call a new `migrateLegacyOpenClaudeHome()` before resolving; add the function mirroring `migrateLegacyClaudeConfigHome` (copy-not-move, skip if target exists, never delete source).
- Test: `tests/utils/envUtils.migrate.test.ts`

- [ ] **Step 1: Write the failing test** — create temp home with `.openclaude/` containing a marker file; call `migrateLegacyOpenClaudeHome({homeDir})`; assert `.limitless/` now contains the marker AND `.openclaude/` still exists.
```typescript
import { expect, test } from 'bun:test'
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { migrateLegacyOpenClaudeHome } from '../../src/utils/envUtils.js'

test('copies .openclaude -> .limitless without deleting source', () => {
  const home = mkdtempSync(join(tmpdir(), 'lh-'))
  mkdirSync(join(home, '.openclaude', 'projects'), { recursive: true })
  writeFileSync(join(home, '.openclaude', 'history.jsonl'), 'x')
  migrateLegacyOpenClaudeHome({ homeDir: home })
  expect(readFileSync(join(home, '.limitless', 'history.jsonl'), 'utf8')).toBe('x')
  expect(existsSync(join(home, '.openclaude', 'history.jsonl'))).toBe(true)
})
```
- [ ] **Step 2: Run to verify it fails** (function not exported).
- [ ] **Step 3: Implement** `migrateLegacyOpenClaudeHome` using a recursive copy that skips existing target files (reuse the `copyMissingPathSync` helper already used by `migrateLegacyOpenClaudeGlobalConfigFiles` at `envUtils.ts:138`); guard: no-op if `configDirEnv` set or `.openclaude` absent or `.limitless` already populated. Wire the call into `getClaudeConfigHomeDir` before resolution.
- [ ] **Step 4: Run to verify it passes.**
- [ ] **Step 5: Commit** — `git commit -m "feat(config): one-time copy-migrate ~/.openclaude -> ~/.limitless"`

### Task 1.3: Point the launcher at `~/.limitless`

**Files:**
- Modify: `~/.zshrc` (the `limitless` alias) and `~/.local/bin/limitless` — change `CLAUDE_CONFIG_DIR=/Users/verickwayne/.openclaude-home` → `CLAUDE_CONFIG_DIR=$HOME/.limitless`. **Pre-step:** one-time `cp -R ~/.openclaude-home/ ~/.limitless/` (non-destructive) so the current session history/projects carry over.

- [ ] **Step 1:** `cp -Rn ~/.openclaude-home/. ~/.limitless/` (copy, no-clobber).
- [ ] **Step 2:** Edit both launcher definitions to `CLAUDE_CONFIG_DIR=$HOME/.limitless`.
- [ ] **Step 3:** `exec zsh -l && limitless --version` → boots; `ls ~/.limitless/projects` shows carried-over transcripts.
- [ ] **Step 4: Commit** (repo changes only; `.zshrc` is outside the repo — note it in the commit body).

> NOTE: `~/.openclaude-home` and `~/.openclaude` are distinct (launcher used `-home`). Migration must cover whichever the user actually runs; Task 1.3 copies `~/.openclaude-home`, Task 1.2 covers default `~/.openclaude`.

---

## Phase 2 — Discovery & Index

### Task 2.1: Shared types

**Files:** Create `src/services/crossHarness/harnessTypes.ts`

- [ ] **Step 1: Write the types** (no test — type-only module):
```typescript
export type HarnessId = 'limitless' | 'claude' | 'codex' | 'unknown'

export type DiscoveredTranscript = {
  harness: HarnessId
  /** Absolute path to the transcript file on disk. */
  path: string
  /** Stable id used for search/resume (sessionId for claude/limitless/codex). */
  sessionId: string
  /** Human-facing name: custom title / codex thread_name / first prompt. */
  sessionName: string
  firstPrompt: string
  /** Working directory the session ran in, if known. */
  cwd: string | null
  messageCount: number
  /** File mtime epoch ms — used for incremental refresh + sort. */
  modifiedMs: number
}

export type ResumeMode = 'full' | 'summary'

export interface HarnessAdapter {
  readonly harness: HarnessId
  /** Reconstruct the foreign transcript into Limitless TranscriptMessage records (root->leaf). */
  toLimitlessTranscript(t: DiscoveredTranscript, newSessionId: string): import('../../types/logs.js').TranscriptMessage[]
  /** Produce a plain-text summary seed (no LLM dependency at this layer). */
  summarize(t: DiscoveredTranscript): string
}

export type CrossHarnessIndex = {
  version: 1
  generatedMs: number
  entries: DiscoveredTranscript[]
}
```
- [ ] **Step 2: Commit** — `git commit -m "feat(xharness): shared types"`

### Task 2.2: Detectors

**Files:** Create `src/services/crossHarness/detectors.ts`; Test `tests/services/crossHarness/detectors.test.ts`

- [ ] **Step 1: Write failing tests** — feed sampled JSON lines for each format, assert harness + extracted fields:
```typescript
import { expect, test } from 'bun:test'
import { detectHarness } from '../../../src/services/crossHarness/detectors.js'

test('detects limitless/claude transcript', () => {
  const lines = [JSON.stringify({type:'user',message:{role:'user',content:'hi'},uuid:'u1',sessionId:'S1',cwd:'/p',timestamp:'2026-01-01T00:00:00Z'})]
  const r = detectHarness('/x/S1.jsonl', lines, 1000)
  expect(r?.harness === 'limitless' || r?.harness === 'claude').toBe(true)
  expect(r?.sessionId).toBe('S1')
  expect(r?.cwd).toBe('/p')
})

test('detects codex rollout', () => {
  const lines = [
    JSON.stringify({timestamp:'t',type:'session_meta',payload:{id:'C1',cwd:'/c',timestamp:'t'}}),
    JSON.stringify({timestamp:'t',type:'response_item',payload:{type:'message',role:'user',content:[{type:'input_text',text:'hello codex'}]}}),
  ]
  const r = detectHarness('/x/rollout-2026-01-01T00-00-00-C1.jsonl', lines, 1000)
  expect(r?.harness).toBe('codex')
  expect(r?.sessionId).toBe('C1')
  expect(r?.firstPrompt).toContain('hello codex')
})

test('non-transcript json returns null', () => {
  expect(detectHarness('/x/package.json', [JSON.stringify({name:'x',version:'1'})], 1000)).toBeNull()
})
```
- [ ] **Step 2: Run to verify they fail.**
- [ ] **Step 3: Implement** `detectHarness(path, sampledLines: string[], modifiedMs: number): DiscoveredTranscript | null`:
  - Parse up to N sampled lines as JSON; bail to `null` if <1 parse.
  - **Codex:** any line with `type==='session_meta'` (→ id, cwd) OR path matches `/rollout-.*\.jsonl$/`. firstPrompt = first `response_item` `payload.type==='message'`, role `user`, `content[].text`. sessionName from `~/.codex/session_index.jsonl` lookup by id (lazy-load + cache that file once), else firstPrompt.
  - **Limitless/Claude:** any line with `message.role` and `sessionId`. Distinguish by whether `path` is under the limitless home (`getClaudeConfigHomeDir()`) → `limitless`, else `claude`. firstPrompt from `type==='last-prompt'` (`lastPrompt`) or first `type==='user'` message content. sessionName from `type==='custom-title'` (`customTitle`) else firstPrompt. cwd from a message's `cwd`.
  - **messageCount** = count of lines whose parsed record is a user/assistant message (claude) or `response_item` message (codex).
  - Else `null`.
- [ ] **Step 4: Run to verify they pass.**
- [ ] **Step 5: Commit** — `git commit -m "feat(xharness): harness detectors"`

### Task 2.3: Scanner (known roots + pruned $HOME)

**Files:** Create `src/services/crossHarness/scanner.ts`; Test `tests/services/crossHarness/scanner.test.ts`

- [ ] **Step 1: Write failing test** — build a temp tree with a fake claude `.jsonl`, a codex `rollout-*.jsonl`, a `node_modules/x.json` (must be skipped), assert scanner finds the two transcripts and not the node_modules file. Inject the root list + home via params for testability:
```typescript
import { expect, test } from 'bun:test'
import { scanForTranscripts } from '../../../src/services/crossHarness/scanner.js'
// build temp dirs... (full setup in impl)
test('finds transcripts, skips node_modules/.git', async () => {
  // arrange temp home with .codex/sessions/.../rollout-*.jsonl + projects/x/S.jsonl + node_modules/a.json
  const found = await scanForTranscripts({ roots: [tmpHome], maxDepth: 8 })
  const harnesses = found.map(f => f.harness).sort()
  expect(found.some(f => f.path.includes('node_modules'))).toBe(false)
  expect(found.length).toBeGreaterThanOrEqual(2)
})
```
- [ ] **Step 2: Run to verify it fails.**
- [ ] **Step 3: Implement** `scanForTranscripts(opts?: { roots?: string[]; maxDepth?: number }): Promise<DiscoveredTranscript[]>`:
  - Default `roots` = known harness roots (`getClaudeConfigHomeDir()/projects`, `~/.claude/projects`, `~/.codex/sessions`) PLUS `$HOME` for the generic pass.
  - Recursive walk with prune set: `node_modules`, `.git`, `Library`, `.Trash`, `.cache` (except the harness session caches), `.npm`, `dist`, `build`, `.next`, any dir starting with a dot that is NOT a known harness home. Cap `maxDepth` (default 8).
  - For each `*.jsonl`/`*.json` candidate: read first ~5 lines (streamed, cap bytes), `stat` for mtime, call `detectHarness`. Collect non-null.
  - Dedupe by `path`.
- [ ] **Step 4: Run to verify it passes.**
- [ ] **Step 5: Commit** — `git commit -m "feat(xharness): pruned transcript scanner"`

### Task 2.4: Persisted incremental index

**Files:** Create `src/services/crossHarness/transcriptIndex.ts`; Test `tests/services/crossHarness/transcriptIndex.test.ts`

Index path: `join(getClaudeConfigHomeDir(), 'cross-harness-index.json')`.

- [ ] **Step 1: Write failing tests** — `saveIndex`/`loadIndex` round-trip; `refreshIndex` only re-detects files whose mtime changed vs cached entry; `searchIndex(q)` matches sessionId substring AND sessionName/firstPrompt (case-insensitive).
- [ ] **Step 2: Run to verify they fail.**
- [ ] **Step 3: Implement**:
  - `loadIndex(): CrossHarnessIndex` (empty default if missing/corrupt).
  - `saveIndex(idx)` (atomic write to temp + rename).
  - `async refreshIndex(): Promise<CrossHarnessIndex>` — run `scanForTranscripts`, but reuse cached entry when `modifiedMs` unchanged (skip re-reading unchanged files by stat-ing first; keep entries whose path still exists). Persist + return.
  - `searchIndex(idx, query): DiscoveredTranscript[]` — rank: exact sessionId > sessionId prefix > name/firstPrompt contains; sort ties by `modifiedMs` desc.
- [ ] **Step 4: Run to verify they pass.**
- [ ] **Step 5: Commit** — `git commit -m "feat(xharness): persisted incremental index + search"`

---

## Phase 3 — Harness Adapters

### Task 3.1: Adapter registry + Claude/Limitless passthrough

**Files:** Create `src/services/crossHarness/adapters/claudeAdapter.ts`, `adapters/index.ts`; Test `tests/services/crossHarness/claudeAdapter.test.ts`

- [ ] **Step 1: Write failing test** — given a temp limitless `.jsonl`, `toLimitlessTranscript(t, 'NEW')` returns records with rewritten `sessionId='NEW'` and a valid root→leaf `parentUuid` chain; content preserved.
- [ ] **Step 2: Run to verify it fails.**
- [ ] **Step 3: Implement** `claudeAdapter`:
  - `toLimitlessTranscript`: read the file, parse user/assistant message lines into `TranscriptMessage[]`, **rewrite** `sessionId=newSessionId`, regenerate `uuid`s while preserving order and re-linking `parentUuid` (root=null then each points to prior), set `cwd` from source (fallback `getCwd()`), `version=MACRO.VERSION`, `userType=getUserType()`, `entrypoint='cross-harness-resume'`, `isSidechain=false`.
  - `summarize`: join the last ~20 user/assistant text contents into a bounded plain-text digest with a header line `Resumed from Claude session <id> (<name>)`.
  - `adapters/index.ts`: `adapterFor(h: HarnessId): HarnessAdapter` mapping limitless/claude→claudeAdapter, codex→codexAdapter, unknown→genericAdapter.
- [ ] **Step 4: Run to verify it passes.**
- [ ] **Step 5: Commit** — `git commit -m "feat(xharness): claude/limitless passthrough adapter"`

### Task 3.2: Codex adapter

**Files:** Create `src/services/crossHarness/adapters/codexAdapter.ts`; Test `tests/services/crossHarness/codexAdapter.test.ts`

- [ ] **Step 1: Write failing test** — given a temp codex rollout `.jsonl` (`session_meta` + several `response_item` messages with `input_text`/`output_text`), `toLimitlessTranscript` returns alternating user/assistant `TranscriptMessage`s with text content, valid parent chain, `sessionId='NEW'`, `cwd` from `session_meta`. `developer` role maps to a system/meta user message (skipped from the visible chain or tagged `isMeta:true`).
```typescript
import { expect, test } from 'bun:test'
import { codexAdapter } from '../../../src/services/crossHarness/adapters/codexAdapter.js'
test('reconstructs codex rollout into limitless records', () => {
  const t = { harness:'codex', path:fixturePath, sessionId:'C1', sessionName:'x', firstPrompt:'hi', cwd:'/c', messageCount:2, modifiedMs:1 } as const
  const recs = codexAdapter.toLimitlessTranscript(t, 'NEW')
  expect(recs[0].sessionId).toBe('NEW')
  expect(recs.find(r => r.message.role === 'assistant')).toBeTruthy()
  expect(recs[0].parentUuid).toBeNull()
})
```
- [ ] **Step 2: Run to verify it fails.**
- [ ] **Step 3: Implement** `codexAdapter`:
  - Read rollout lines; take `session_meta` for cwd/id/timestamp.
  - For each `response_item` with `payload.type==='message'`: flatten `payload.content[]` `text` (concat `input_text`+`output_text`); map role `developer`→ skip or `isMeta` system note, `user`→user, `assistant`→assistant.
  - Build `TranscriptMessage[]`: order preserved, fresh `uuid`s, `parentUuid` chain (root null), `message:{role, content}`, `cwd` from meta, `sessionId=newSessionId`, `version=MACRO.VERSION`, `userType=getUserType()`, `entrypoint='cross-harness-resume'`, `timestamp` from each line, `isSidechain:false`.
  - `summarize`: header `Resumed from Codex thread <id> (<thread_name>)` + bounded digest of message texts.
- [ ] **Step 4: Run to verify it passes.**
- [ ] **Step 5: Commit** — `git commit -m "feat(xharness): codex rollout adapter"`

### Task 3.3: Generic fallback adapter

**Files:** Create `src/services/crossHarness/adapters/genericAdapter.ts`; extend tests.

- [ ] **Step 1: Write failing test** — given an unknown JSONL where lines have `{role, text|content}`, generic adapter extracts a best-effort user/assistant chain; if nothing extractable, `toLimitlessTranscript` returns a single system message "Imported transcript (unrecognized format)" + raw text blob, and `summarize` returns first ~2KB.
- [ ] **Step 2: Run to verify it fails.**
- [ ] **Step 3: Implement** generic best-effort extraction (look for `role`+`content/text` per line; else dump raw).
- [ ] **Step 4: Run to verify it passes.**
- [ ] **Step 5: Commit** — `git commit -m "feat(xharness): generic fallback adapter"`

---

## Phase 4 — Cross-Harness `/resume`

### Task 4.1: Materialize a foreign transcript into a Limitless session

**Files:** Create `src/services/crossHarness/materialize.ts`; Test `tests/services/crossHarness/materialize.test.ts`

- [ ] **Step 1: Write failing test** — given a codex `DiscoveredTranscript` + mode `'full'`, `materialize()` writes a new `<newSessionId>.jsonl` under `getProjectsDir()/<sanitizePath(cwd)>/`, returns `{ sessionId, log }` where `log` is a valid `LogOption` (tag=`codex`, customTitle set), and the file is loadable by `loadConversationForResume(sessionId)`.
- [ ] **Step 2: Run to verify it fails.**
- [ ] **Step 3: Implement** `materialize(t: DiscoveredTranscript, mode: ResumeMode): Promise<{ sessionId: string; log: LogOption }>`:
  - `newSessionId = randomUUID()`.
  - `adapter = adapterFor(t.harness)`.
  - If `mode==='full'`: `recs = adapter.toLimitlessTranscript(t, newSessionId)`.
  - If `mode==='summary'`: build one synthetic user `TranscriptMessage` whose content is `adapter.summarize(t)` (chain root), `sessionId=newSessionId`.
  - Target dir = `join(getProjectsDir(), sanitizePath(t.cwd ?? getCwd()))`; mkdir -p; write JSONL = recs (each `jsonStringify(rec)+'\n'`) followed by a `{type:'custom-title', customTitle:'[`+t.harness+`] '+t.sessionName, sessionId:newSessionId}` and `{type:'tag', tag:t.harness, sessionId:newSessionId}` metadata lines (so the picker shows the harness tag + title).
  - Build + return the `LogOption` (sessionId, tag, customTitle, firstPrompt, messages=recs as SerializedMessage[], modified=now, projectPath).
- [ ] **Step 4: Run to verify it passes.**
- [ ] **Step 5: Commit** — `git commit -m "feat(xharness): materialize foreign transcript into limitless session"`

### Task 4.2: Wire cross-harness entries into the `/resume` picker

**Files:** Modify `src/commands/resume/resume.tsx` (the `ResumeCommand` component + `call`); Test: manual + a unit test on the merge helper.

- [ ] **Step 1: Write failing test** for a pure merge helper `mergeCrossHarnessLogs(nativeLogs, indexEntries): LogOption[]` (new exported function) — native logs keep their tag; index entries become `LogOption`s tagged by harness, deduped against native by sessionId; sorted by modified desc.
- [ ] **Step 2: Run to verify it fails.**
- [ ] **Step 3: Implement**:
  - Add `mergeCrossHarnessLogs()` and call it in `ResumeCommand` after native logs load: `const idx = await refreshIndex(); const merged = mergeCrossHarnessLogs(nativeLogs, idx.entries)`. Pass `merged` to `<LogSelector>` (it already renders `log.tag` tabs).
  - On select: if the chosen `LogOption` is a native limitless session → existing path (`onResume(sessionId, log, 'slash_command_picker')`). If it carries a cross-harness marker (add `log.crossHarness?: DiscoveredTranscript` to the option) → go to Task 4.3 mode-picker.
- [ ] **Step 4: Run unit test pass; build `bun run build`; smoke `/resume` in a dev session — codex sessions appear under a `codex` tab.**
- [ ] **Step 5: Commit** — `git commit -m "feat(resume): merge cross-harness transcripts into picker"`

### Task 4.3: Full-vs-summary choice + foreign resume hand-off

**Files:** Modify `src/commands/resume/resume.tsx`.

- [ ] **Step 1:** After selecting a foreign entry, render a small `Select` (reuse `src/components/CustomSelect/select.tsx`): options "Resume from full transcript + last turn" (`full`) / "Resume from summary" (`summary`).
- [ ] **Step 2:** On choice: `const { sessionId, log } = await materialize(entry.crossHarness, mode); await context.resume?.(sessionId, log, 'slash_command_picker')`. The existing resume path adopts the freshly-written `.jsonl` exactly like a native session.
- [ ] **Step 3:** Error handling: wrap in try/catch → `onDone('Failed to resume <harness> session: '+msg)`.
- [ ] **Step 4:** `bun run build`; smoke: resume a real Codex session both ways; verify the transcript loads and a new turn continues.
- [ ] **Step 5: Commit** — `git commit -m "feat(resume): full/summary cross-harness resume hand-off"`

### Task 4.4: `/resume <query>` direct cross-harness search

**Files:** Modify `src/commands/resume/resume.tsx` (`call` arg handling).

- [ ] **Step 1:** When `/resume <arg>` is given and no native session matches, `searchIndex(await refreshIndex(), arg)`; if exactly one → go straight to the mode-picker for it; if many → open the picker pre-filtered to `arg`.
- [ ] **Step 2:** `bun run build`; smoke `/resume <codex-session-id>` and `/resume <thread name fragment>`.
- [ ] **Step 3: Commit** — `git commit -m "feat(resume): /resume <query> searches cross-harness index"`

---

## Subagent Delegation Matrix (for subagent-driven-development)

Dispatch a **fresh `engineering-mts` subagent per task** (end-to-end PRs with tests + observability). Two-stage review between tasks (build + targeted test, then a reviewer pass). Parallelize only where file territories are disjoint.

| Wave | Tasks (parallel within wave) | Agent | Depends on |
|------|------|------|------|
| W1 | 1.1, 1.2 (envUtils) → then 1.3 (launcher) | `engineering-mts` (1 agent; same file `envUtils.ts`, so sequential 1.1→1.2; 1.3 after) | — |
| W2 | 2.1 types | `engineering-mts` | W1 |
| W3 (parallel) | 2.2 detectors • 2.3 scanner • 2.4 index | 3× `engineering-mts` (disjoint files; 2.3/2.4 stub-import 2.2's `detectHarness` interface from 2.1 types) | 2.1 |
| W4 (parallel) | 3.1 claude adapter • 3.2 codex adapter • 3.3 generic adapter | 3× `engineering-mts` (disjoint files under `adapters/`) | 2.1 |
| W5 | 4.1 materialize | `engineering-mts` | W3+W4 |
| W6 | 4.2 → 4.3 → 4.4 (same file `resume.tsx`, sequential) | 1× `engineering-mts` | 4.1 |

**Adversarial verification (required before "done"):** after W3–W6, dispatch a `superpowers:verification-before-completion` pass per phase + a focused reviewer (`majestic-engineer:test-reviewer`) on the codex adapter and materialize (the highest-risk reconstruction code). Confirm with a real Codex rollout file from `~/.codex/sessions/` (not just fixtures).

**Orchestrator keeps (do NOT delegate):** the decision to flip the launcher (Task 1.3 touches `~/.zshrc` outside the repo — needs a human-visible step), and the final end-to-end smoke (`/resume` a real foreign session) which must be eyeballed.

---

## Self-Review

- **Spec coverage:** distinct limitless config files (Phase 1 ✓), search local drive for transcript JSON (2.3 ✓ pruned $HOME), bookmark + note harness (2.4 index + 2.2 tag ✓), `/resume` search by id or name (4.4 ✓), tag of creating harness in picker (4.2 ✓ via `LogOption.tag`), resume from full transcript+last turn OR summary (4.3 ✓), custom-built not relying on the accidental Claude-only path (new `crossHarness/` service + adapters ✓), full reconstruction for all harnesses (Phase 3 adapters ✓).
- **Placeholder scan:** schemas and key function bodies are specified from verified on-disk formats; the only deferred detail is exact prune-list tuning (acceptable, enumerated in 2.3).
- **Type consistency:** `DiscoveredTranscript`, `HarnessAdapter`, `ResumeMode`, `CrossHarnessIndex` defined once in 2.1 and referenced by name throughout; `LogOption.crossHarness?` is the one additive field on the existing type (declare it in `src/types/logs.ts` as part of Task 4.2).
- **Open risk to flag at execution:** "full reconstruction" of a Codex session into a Limitless session yields a faithful *message transcript*, but tool-call state and model identity are not portable — the resumed session continues as a Limitless session seeded with the foreign history. This matches the honest ceiling of the format; surface it in the resume confirmation copy.
