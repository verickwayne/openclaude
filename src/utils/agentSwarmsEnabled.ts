import { isEnvTruthy } from './envUtils.js'

/**
 * Centralized runtime check for agent teams/teammate features.
 * This is the single gate checked everywhere teammates are referenced
 * (prompts, code, tools isEnabled, UI, @mention routing, teammate view, etc.).
 *
 * In Limitless, agent teams are a first-class, always-on capability — the
 * operator can spawn named teammates, @mention them directly, and open a
 * teammate view to watch their prompt and play-by-play tool calls live.
 * There is intentionally no remote killswitch (an external party must not be
 * able to disable the operator's own capability) and no opt-in friction.
 * The operator can disable it locally via LIMITLESS_DISABLE_AGENT_TEAMS.
 */
export function isAgentSwarmsEnabled(): boolean {
  if (isEnvTruthy(process.env.LIMITLESS_DISABLE_AGENT_TEAMS)) {
    return false
  }
  return true
}
