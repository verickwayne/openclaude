---
paths: ["src/services/api/**", "src/utils/model/**"]
description: Multi-provider routing + per-model context profiles
---

# Multi-model rules

- Limitless is provider-agnostic. Code in these paths must not assume Anthropic. New capabilities
  go through the provider abstraction, not a hard-coded Anthropic SDK call.
- First-party-only betas (advisor server tool, etc.) are gated by `shouldIncludeFirstPartyOnlyBetas()`;
  they no-op on non-Anthropic providers. Never make a feature *depend* on a first-party beta.
- The OpenAI/Codex path goes through `openaiShim.ts`. Gemini/Ollama have their own shims. Keep
  request/response shaping in the shim, not the call sites.

## Model Context Profiles (estimates — verify against live model cards before relying)
| Model family | Context budget (approx) | Strengths | Known gaps |
|---|---|---|---|
| claude-* | ~180–200K | long context, tool use | — |
| gpt-*/codex | ~128K | instruction-following | long multi-hop tool chains (>~8 steps) |
| gemini-* | ~900K–1M | large-file ingestion | rule dropout in very long context |
| ollama/* | varies (small) | local/offline, fast | route to a hosted model above ~50K context |
