# Claude Max OAuth Proxy

Limitless can route Anthropic-native requests through the local Claude Max
OAuth proxy packaged in:

`/Users/verickwayne/Projects/research/ClaudeMax-OAuth-Overlay`

This path is for Claude subscription billing via stored Claude.ai OAuth login,
not direct `ANTHROPIC_API_KEY` usage.

## One-time login

```bash
limitless auth login --claudeai
```

## Fastest local launch

From the Limitless repo:

```bash
bun run dev:claude-max
```

That command:

- checks the local Claude.ai login state
- points the external proxy at Limitless's `CLAUDE_CONFIG_DIR`
- starts the proxy if it is not already running
- launches Limitless with `ANTHROPIC_BASE_URL=http://127.0.0.1:8031`

## Manual launch

Start the proxy:

```bash
bun run claude-max:proxy
```

In another shell:

```bash
ANTHROPIC_BASE_URL=http://127.0.0.1:8031 \
ANTHROPIC_MODEL=claude-sonnet-4-5 \
limitless
```

## Saved provider profile

Inside Limitless, run `/provider` and choose `Claude Max OAuth Proxy` to save
it as an active provider profile.

Note:

- the proxy package must exist locally
- the proxy reads Limitless's OAuth credentials through `CLAUDE_CONFIG_DIR`
- normal `bun run dev` does not auto-start the proxy; use `bun run dev:claude-max`
  when you want the managed local launch path
