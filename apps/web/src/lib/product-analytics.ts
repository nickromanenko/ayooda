'use client'

import mixpanel from 'mixpanel-browser'

const MIXPANEL_TOKEN = '8a369be75a1879a51cc7fd8a7f368284'

type AuthMethod = 'email' | 'google' | 'account_link'
type AnalyticsContext = 'onboarding' | 'dashboard'

export interface ProductEventMap {
  'Marketing CTA Clicked': { cta: string; destination: string; page: string }
  'Sign Up Completed': { method: AuthMethod }
  'Sign In Completed': { method: AuthMethod }
  'Agent Created': { role: string; has_logo: boolean }
  'Knowledge Source Added': { source_type: 'website' | 'file'; context: AnalyticsContext }
  'Agent Test Started': { tools_enabled: boolean }
  'Channel Connected': {
    channel_type: 'web_widget' | 'telegram' | 'email' | 'slack' | 'sms'
    context: AnalyticsContext
  }
  'Connector Installed': {
    provider: string
    install_method: 'token' | 'oauth'
    actions_installed?: number
  }
  'MCP Server Connected': { transport: string; auth_type: string }
  'Checkout Started': { tier: string }
  'Checkout Completed': Record<string, never>
}

declare global {
  interface Window {
    __ayoodaMixpanelInitialized?: boolean
  }
}

export function initializeProductAnalytics() {
  if (typeof window === 'undefined' || window.__ayoodaMixpanelInitialized) return

  try {
    mixpanel.init(MIXPANEL_TOKEN, {
      autocapture: true,
      record_sessions_percent: 100,
      api_host: 'https://api-eu.mixpanel.com',
    })
    window.__ayoodaMixpanelInitialized = true
  } catch (error) {
    console.warn('[mixpanel] initialization failed:', error)
  }
}

export function trackProductEvent<EventName extends keyof ProductEventMap>(
  event: EventName,
  properties: ProductEventMap[EventName],
) {
  try {
    initializeProductAnalytics()
    mixpanel.track(event, properties, event === 'Checkout Started'
      ? { transport: 'sendBeacon', send_immediately: true }
      : undefined)
  } catch (error) {
    console.warn(`[mixpanel] failed to track ${event}:`, error)
  }
}

export function identifyProductUser(userId: string) {
  try {
    initializeProductAnalytics()
    mixpanel.identify(userId)
  } catch (error) {
    console.warn('[mixpanel] identification failed:', error)
  }
}

export function resetProductAnalytics() {
  try {
    if (typeof window !== 'undefined' && window.__ayoodaMixpanelInitialized) mixpanel.reset()
  } catch (error) {
    console.warn('[mixpanel] reset failed:', error)
  }
}
