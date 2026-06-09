import type { Command } from '../../commands.js'
import { hasAnthropicApiKeyAuth } from '../../utils/auth.js'
import { isEnvTruthy } from '../../utils/envUtils.js'
import { resolveLoginTarget } from './loginTarget.js'

function describeLogin(): string {
  switch (resolveLoginTarget().kind) {
    case 'codex':
      return 'Sign in with your ChatGPT account (OpenAI subscription)'
    case 'claude-max':
      return 'Sign in with your Claude account (Max subscription via local proxy)'
    case 'local':
      return 'Refresh local models for the /model picker'
    case 'api-key-provider':
      return 'Provider sign-in (API-key providers configure via /provider)'
    default:
      return hasAnthropicApiKeyAuth()
        ? 'Switch Anthropic accounts'
        : 'Sign in with your Anthropic account'
  }
}

export default () =>
  ({
    type: 'local-jsx',
    name: 'login',
    // Computed once at registration (COMMANDS is memoized). The call()
    // handler re-resolves the target at invocation, so behavior is always
    // current even if this label goes stale after a provider switch.
    description: describeLogin(),
    isEnabled: () => !isEnvTruthy(process.env.DISABLE_LOGIN_COMMAND),
    load: () => import('./login.js'),
  }) satisfies Command
