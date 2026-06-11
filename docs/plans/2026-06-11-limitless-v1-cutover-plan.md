# Limitless v1 — Independence Cutover Plan (consolidated)

Date: 2026-06-11. Supersedes the worktree handoff `…/openclaude-xharness/docs/superpowers/plans/2026-06-11-v1-cutover-handoff.md`. Pairs with Codex's `2026-06-11-limitless-independence-harvest.md` (enrichment roadmap, Workstream B below).

Built from four read-only audits (full detail in session transcript): config/state paths, product-name branding, external identity/phone-home, KEEP-zone allowlist.

## Two workstreams — keep them separate
- **Workstream A — Cutover to v1 (this plan):** independent `limitless` config files, scrub product-name leaks, decouple from old repo/telemetry, ship to a **private** GitHub repo. This is the immediate "official v1."
- **Workstream B — Harvest/enrichment (Codex's doc):** port capabilities (memory lifecycle, deterministic command API, sanitized MCP profiles, browser relay, prompt-contract skills, session search). Mostly **post-v1**. Public-core vs optional-pack vs personal-overlay decisions required.

---

## Workstream A

### A1 — Config independence (the foundation)
**Master gate:** `src/utils/envUtils.ts:204` `resolveClaudeConfigHomeDir` STILL defaults to `~/.openclaude` (a recent commit on the cross-harness branch flips it to `~/.limitless`, but the main tree does not). Fixing this one default covers ~150 callers via `getClaudeConfigHomeDir()`. Also add a `~/.openclaude → ~/.limitless` dir-level copy-migration (file-level migration exists; dir-level missing).

**Add `LIMITLESS_CONFIG_DIR` env alias** (read before `CLAUDE_CONFIG_DIR`) in `getClaudeConfigHomeDir`. Same for `LIMITLESS_REMOTE_MEMORY_DIR`, `LIMITLESS_FEATURE_FLAGS_FILE` aliases.

**Project-level hardcodes still writing `.claude/` (MUST use `resolveProjectStateDirname`):**
- `src/tools/AgentTool/agentMemory.ts:43,59,80,97` + `agentMemorySnapshot.ts:32` (agent memory)
- `src/utils/cronTasks.ts:74` + `cronTasksLock.ts:23` (scheduled tasks)
- `src/utils/worktree.ts:235` (worktrees — structural; needs migration care)
- `src/utils/claudemd.ts:916,927,975,986,1290,1309,1357` (only reads `.claude/CLAUDE.md`+`/rules`, doesn't iterate branded names)
- `src/skills/loadSkillsDir.ts:753,788,962`; `src/utils/plugins/addDirPluginSettings.ts:40,63`; `src/screens/Doctor.tsx:169`
- `src/utils/completionCache.ts:27`; `src/services/analytics/growthbook.ts:33` (hardcode `~/.claude` instead of config home)
- `src/utils/permissions/filesystem.ts:117-126` (skill scope: project `.claude/skills`, global `~/.openclaude/skills` — both wrong post-flip)
- `src/tools/FileEditTool/constants.ts:5` `CLAUDE_FOLDER_PERMISSION_PATTERN='/.claude/**'` (emit dynamic)

**User-visible path strings to fix** (show wrong dir): `AddPermissionRules.tsx:35`, `hooksSettings.ts:173`, `MemoryFileSelector.tsx:93`, `MemoryStep.tsx:40,58`, `SkillsMenu.tsx:109`, `tipRegistry.ts:379,394`, `scripts/provider-recommend.ts:116`.

**OS-level identifiers (persist outside config home — coordinate w/ signing):**
- `claude-cli://` scheme → `limitless-cli://` (`deepLink/parseDeepLink.ts:23`, `settings/types.ts:858`, checked in `main.tsx:675`, `protocolHandler.ts:90`)
- bundle IDs `com.anthropic.*` → `com.limitless.*` (`deepLink/registerProtocol.ts:33`, `computerUse/common.ts:13`, `claudeInChrome/setup.ts:36`)
- MDM domain `com.anthropic.claudecode` (`settings/mdm/constants.ts:12`)
- temp prefixes `openclaude-clipboard` (`ink/termio/osc.ts:220`), `claude-code-screenshots` (`screenshotClipboard.ts:21`)
- VSCode profile file `.openclaude-profile.json` (`vscode-extension/.../extension.js:21`) → `.limitless-profile.json` + legacy fallback

**KEEP as legacy READ fallbacks (do NOT change):** `migrateLegacyClaudeConfigHome` (.claude→.openclaude), `resolveGlobalClaudeFile` `.openclaude.json` fallback, `productStateDir.ts` `.openclaude` fallback, `markdownConfigLoader.ts:47` `PROJECT_CONFIG_DIR_NAMES=['.claude','.openclaude','.limitless']`, `providerProfile.ts:46` legacy profile, `permissions/filesystem.ts` 3-brand security checks, `FileEditTool/constants.ts:12,15` legacy permission patterns, `localInstaller`/`nativeInstaller` `~/.claude/local` reads.

### A2 — Branding scrub (~100 product-name hits; full list in transcript)
Highest priority (user-visible): CLI error/help/usage strings in `src/main.tsx` (796,3287,3413,3437,3549,4352), `cli/handlers/*` (auth.ts:323, autoMode.ts:86, plugins.ts:355, mcp.tsx:236/253/377), `cli/print.ts:5029`, `bridge/bridgeEnabled.ts:73/76/79`, `bridge/initReplBridge.ts:422/463`, `utils/auth.ts:1992-3/2023`, `utils/teleport.tsx:469/481`, `utils/gracefulShutdown.ts:181`, `utils/doctorDiagnostic.ts:50` (`getCliBinaryName` fallback `'openclaude'`→`'limitless'`), `services/tips/tipRegistry.ts:379`. Slash commands `src/commands/openclaude-aliases/index.ts:27,32,37,42` (`/openclaude*`→`/limitless*`). External originator headers `'openclaude'`→`'limitless'` (`codexShim.ts:619`, `codexUsage.ts:449`, `WebSearchTool.ts:469`, `xaiOAuthShared.ts:23`, `system-check.ts:354`). Co-author email `attribution.ts:97` `openclaude@gitlawb.com`. ~25 product-naming comments. VSCode ext UI (`presentation.js:36/111/112/179`, `chatRenderer.js:639`, `processManager.js:33` default binary, `extension.js:294`). Web (`web/src/content.ts:1` install cmd, `web/src/App.tsx` `openclaude.png` + localStorage key). **Stale tests that will FAIL** (source already says Limitless): `providerCustomHeaders.test.ts`, `codexOAuth.test.ts`, `provider.test.tsx`, `ProviderManager.test.tsx` — update assertions.

### A3 — External identity / decouple / phone-home
Single macro source: `scripts/build.ts:137-141` (ISSUES_EXPLAINER, FEEDBACK_CHANNEL, PACKAGE_URL). Plus: `package.json` name/repository/homepage/bugs/keywords; gRPC `src/proto/openclaude.proto:3` `openclaude.v1`→`limitless.v1` + `grpc/server.ts:12,23`; `.github/workflows/release.yml:14,88,89`, `ISSUE_TEMPLATE/config.yml:4`.
**Active phone-home to OLD project (must flip before publish):** `src/utils/releaseNotes.ts:21` (startup GET to `api.github.com/repos/Gitlawb/openclaude/releases`) + UA `:178`; `src/utils/version.ts:6` releases URL; `autoUpdater.ts` PACKAGE_URL update-check.
**Anthropic-owned, NEEDS-DECISION (not ours to repoint):** native-installer GCS bucket `autoUpdater.ts:33`/`nativeInstaller/download.ts:25-26`; official-plugin CDN `officialMarketplaceGcs.ts:29`; `/install-github-app` template `github-app.ts` (anthropics/claude-code-action); UA `claude-cli`/`claude-code` (`http.ts:35/50`, `userAgent.ts:9` — Anthropic log routing); `opengateway.gitlawb.com` provider fallback (`providerAutoDetect.ts:271-313`).

### A4 — Repo cutover (LAST, after explicit go)
New **private** repo + remote, push, npm scope. Decide CHANGELOG (preserve old links vs rewrite).

### KEEP-ZONE (never scrub — models/auth/resume)
`src/services/api/*`, `src/utils/model/*`, ANTHROPIC_* env, claude-* model ids, `getMarketingNameForModel`; all OAuth (`constants/oauth.ts`, `services/oauth/`, `utils/auth.ts`, claude-max-proxy); resume/cross-harness (`sessionStorage.ts`, `conversationRecovery.ts`, `crossProjectResume.ts`, `commands/resume/`, `services/crossHarness/`); `claude-code-guide` agent + `claude-api` skill; model-identity layer; WebSearch native `web_search_20250305` (firstParty/vertex/foundry); `constants/product.ts` claude.ai base URLs (remote-session links). Valuable inherited subsystems to preserve: multi-provider routing, OpenRalph, plugins, swarm, claude-max-proxy, outcome-ledger routing, loop-discipline, bundled skills.

---

## Workstream B — Harvest (Codex's doc), post-v1
Public-core candidates: memory lifecycle plugin iface (Mnemo as one impl), deterministic command/plugin API (OpenClaw `/pulse` pattern), sanitized MCP profile templates, opt-in browser relay, prompt-contract review skills, session-search + procedure memory. **Already partly built this session: cross-harness transcript discovery + search + resume** (`src/services/crossHarness/` on branch `feat/cross-harness-resume`) — delivers the discovery/search half of harvest #6; procedure-memory + redaction still to do. Optional packs (PM, data-eng, frontend, finance) and personal overlays (Ralph, Pulse, private MCP creds, CFI) stay out of public core.

---

## DECISIONS REQUIRED before executing A (gating)
1. Private repo URL/org + npm scope + git remote name.
2. VSCode publisher + whether to rename ext config keys/command ids (`openclaude.*`→`limitless.*`, breaking for existing users).
3. Native installer + auto-update: provision own GCS bucket, or **drop native-install path** for v1 (npm-only)?
4. Official-plugin marketplace CDN (downloads.claude.ai): keep / remove / replace?
5. `/install-github-app` template: rewrite to own action / remove for v1?
6. User-agent `claude-cli`/`claude-code`: keep (Anthropic log routing) or change?
7. `opengateway.gitlawb.com` provider fallback: keep / remove?
8. CHANGELOG: preserve old Gitlawb links (history) or rewrite?
9. Branch strategy: cut on a fresh `feat/limitless-v1` off the merge of `feat/multi-provider` + `feat/cross-harness-resume` (Codex is live on multi-provider — coordinate).

## LOCKED DECISIONS (2026-06-11)
North star: **ZERO runtime/identity/network link back to openclaude or the old project after cutover.**
1. GitHub `verickwayne/limitless` (PRIVATE); local dir `~/Projects/Limitless`; npm name `@verickwayne/limitless`. **Disable auto-update + release-notes fetch for v1** (private repo, native-installer dropped → no phone-home until a real release pipeline exists).
2. Rename VSCode ext config keys/command ids `openclaude.*`→`limitless.*`.
3. npm-only; **drop native-installer path** (removes Anthropic GCS dependency).
4. Remove official-plugin CDN fetch — but FIRST audit what it provides and **bundle any plugins Limitless depends on** locally.
5. Remove `/install-github-app` template for v1.
6. UA mirrors the provider API on its OAuth path: `claude-cli`/`claude-code` for Anthropic-OAuth, Codex UA for Codex-OAuth, `limitless` elsewhere (MCP/WebFetch/generic).
7. **Remove/disable `opengateway.gitlawb.com`** by default (gitlawb domain = link back; conflicts with zero-link). Re-add later under own domain if desired.
8. **Fresh CHANGELOG starting at Limitless v1**; archive old OpenClaude changelog to `docs/history/openclaude-changelog.md`.
9. Work on `feat/limitless-v1`; before push, **collapse to a fresh/squashed history (orphan initial commit)** on `main` of the new private repo — no inherited openclaude git log.

## Execution sequence (after decisions)
1. Branch `feat/limitless-v1` off merged base (coordinate Codex). 2. Parallel scrub agents by disjoint territory (edit-only, orchestrator commits): [A] config paths+env alias, [B] CLI/UI branding strings, [C] external-id macros+urls+gRPC, [D] OS identifiers, [E] VSCode ext + web, [F] stale tests. 3. Merge cross-harness. 4. Rebuild dist, full suite + `bun run build`. 5. Manual smoke (`limitless` launches, `/resume` works, no startup fetch to old repo). 6. LAST: create private repo + push on explicit go.
