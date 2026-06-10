import { feature } from 'bun:bundle'
import * as React from 'react'

import { resetCostState } from '../../bootstrap/state.js'
import {
  clearTrustedDeviceToken,
  enrollTrustedDevice,
} from '../../bridge/trustedDevice.js'
import type { LocalJSXCommandContext } from '../../commands.js'
import { ConfigurableShortcutHint } from '../../components/ConfigurableShortcutHint.js'
import {
  ConsoleOAuthFlow,
  type ConsoleOAuthFlowResult,
} from '../../components/ConsoleOAuthFlow.js'
import { ProviderManager } from '../../components/ProviderManager.js'
import { Dialog } from '../../components/design-system/Dialog.js'
import { useMainLoopModel } from '../../hooks/useMainLoopModel.js'
import { Text } from '../../ink.js'
import { refreshGrowthBookAfterAuthChange } from '../../services/analytics/growthbook.js'
import { refreshPolicyLimits } from '../../services/policyLimits/index.js'
import { refreshRemoteManagedSettings } from '../../services/remoteManagedSettings/index.js'
import type { LocalJSXCommandOnDone } from '../../types/command.js'
import { stripSignatureBlocks } from '../../utils/messages.js'
import {
  checkAndDisableAutoModeIfNeeded,
  checkAndDisableBypassPermissionsIfNeeded,
  resetAutoModeGateCheck,
  resetBypassPermissionsCheck,
} from '../../utils/permissions/bypassPermissionsKillswitch.js'
import { ensureClaudeMaxOAuthProxyProfileActive } from '../../utils/providerProfiles.js'
import { resetUserCache } from '../../utils/user.js'
import { resolveLoginTarget } from './loginTarget.js'

type LoginCompletion =
  | ConsoleOAuthFlowResult
  | {
      type: 'cancel'
    }

export async function call(
  onDone: LocalJSXCommandOnDone,
  context: LocalJSXCommandContext,
): Promise<React.ReactNode> {
  const target = resolveLoginTarget()

  // OpenAI subscription (ChatGPT/Codex OAuth): run the Codex OAuth flow
  // directly. ProviderManager owns the full success path — saving the
  // profile, persisting credentials securely, and switching the session.
  if (target.kind === 'codex') {
    return (
      <ProviderManager
        mode="codex-login"
        onDone={result => {
          if (result?.action === 'saved') {
            onDone(result.message ?? 'OpenAI subscription login successful', {
              display: 'system',
            })
            return
          }
          onDone(result?.message ?? 'Login interrupted')
        }}
      />
    )
  }

  // Local providers (Ollama, LM Studio, Atomic Chat) have no login —
  // /login refreshes the local model list feeding the /model picker.
  if (target.kind === 'local') {
    const { discoverModelsForRoute } = await import(
      '../../integrations/discoveryService.js'
    )
    const result = await discoverModelsForRoute(target.routeId, {
      baseUrl: process.env.OPENAI_BASE_URL,
      forceRefresh: true,
    })
    if (!result || result.source === 'error') {
      onDone(
        `Could not reach ${target.label} to refresh local models${
          result?.error ? `: ${result.error.message}` : ''
        }. Check that it is running, then retry /login or press r in /model.`,
      )
      return null
    }
    const count = result.models.length
    onDone(
      `${target.label}: ${count} local model${count === 1 ? '' : 's'} available in the /model picker.`,
      { display: 'system' },
    )
    return null
  }

  // API-key providers (OpenRouter, Gemini, etc.) have no login flow.
  if (target.kind === 'api-key-provider') {
    onDone(
      `${target.label} authenticates with an API key, not a login. Use /provider to add or update credentials, or switch to a subscription provider first.`,
    )
    return null
  }

  // Anthropic first-party and the Claude Max OAuth proxy both sign in
  // with the Anthropic OAuth flow. On the Max proxy route, force the
  // claude.ai subscription method — the proxy bills the subscription and
  // cannot use Console API-key auth.
  const claudeMaxTarget = target.kind === 'claude-max' ? target : null

  return (
    <Login
      forceLoginMethod={claudeMaxTarget ? 'claudeai' : undefined}
      startingMessage={
        claudeMaxTarget
          ? 'Sign in with your Claude subscription account. The local Claude Max proxy will use these credentials.'
          : undefined
      }
      onDone={async result => {
        if (result.type === 'cancel') {
          onDone('Login interrupted')
          return
        }

        if (result.type === 'provider-setup') {
          onDone(result.message, { display: 'system' })
          return
        }

        context.onChangeAPIKey()
        // Signature-bearing blocks (thinking, connector_text) are bound to the
        // API key. Strip them so the new key doesn't reject stale signatures.
        context.setMessages(stripSignatureBlocks)

        // Post-login refresh logic. Keep in sync with onboarding in
        // src/interactiveHelpers.tsx.
        resetCostState()
        void refreshRemoteManagedSettings()
        void refreshPolicyLimits()
        resetUserCache()
        refreshGrowthBookAfterAuthChange()

        // Clear any stale trusted device token from a previous account before
        // re-enrolling to avoid sending the old token while enrollment is
        // in flight.
        clearTrustedDeviceToken()
        void enrollTrustedDevice()

        resetBypassPermissionsCheck()
        const appState = context.getAppState()
        void checkAndDisableBypassPermissionsIfNeeded(
          appState.toolPermissionContext,
          context.setAppState,
        )

        if (feature('TRANSCRIPT_CLASSIFIER')) {
          resetAutoModeGateCheck()
          void checkAndDisableAutoModeIfNeeded(
            appState.toolPermissionContext,
            context.setAppState,
            appState.fastMode,
          )
        }

        context.setAppState(prev => ({
          ...prev,
          authVersion: prev.authVersion + 1,
        }))

        if (result.loginWithClaudeAi) {
          const activeProfile = ensureClaudeMaxOAuthProxyProfileActive()
          if (!activeProfile) {
            onDone(
              'Login successful, but the Claude Max OAuth proxy provider profile could not be activated. Use /provider and select Anthropic (Subscription).',
            )
            return
          }

          const { ensureClaudeMaxProxyRunning, describeEnsureResult } =
            await import(
              '../../integrations/anthropicProxies/claudeMaxProxyRuntime.js'
            )
          const ensureResult = await ensureClaudeMaxProxyRunning()
          const warning = describeEnsureResult(ensureResult)
          if (warning) {
            onDone(`Login successful, but ${warning}`)
            return
          }
          onDone(
            `Login successful. ${activeProfile.name} is active and the Claude Max proxy is running.`,
          )
          return
        }

        onDone('Login successful')
      }}
    />
  )
}

export function Login(props: {
  onDone: (result: LoginCompletion, mainLoopModel: string) => void
  startingMessage?: string
  forceLoginMethod?: 'claudeai' | 'console'
}): React.ReactNode {
  const mainLoopModel = useMainLoopModel()

  return (
    <Dialog
      title="Login"
      onCancel={() => props.onDone({ type: 'cancel' }, mainLoopModel)}
      color="permission"
      inputGuide={exitState =>
        exitState.pending ? (
          <Text>Press {exitState.keyName} again to exit</Text>
        ) : (
          <ConfigurableShortcutHint
            action="confirm:no"
            context="Confirmation"
            fallback="Esc"
            description="cancel"
          />
        )
      }
    >
      <ConsoleOAuthFlow
        onDone={result =>
          props.onDone(result ?? { type: 'cancel' }, mainLoopModel)
        }
        startingMessage={props.startingMessage}
        forceLoginMethod={props.forceLoginMethod}
      />
    </Dialog>
  )
}
