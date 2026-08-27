import {
  WIDGET_POSITIONS,
  WIDGET_THEMES,
  WIDGET_LOCALES,
  WIDGET_CONVERSATION_PERSISTENCE,
  MAX_WELCOME_MESSAGE_CHARS,
  MAX_WIDGET_COPY_CHARS,
  MAX_WIDGET_PATH_RULES,
  DEFAULT_WIDGET_APPEARANCE,
  type WidgetAppearance,
  type WidgetPosition,
} from '@ayooda/shared'

type Fail = { ok: false; error: string }
const fail = (error: string): Fail => ({ ok: false, error })

const POSITIONS = WIDGET_POSITIONS.map((p) => p.id) as readonly WidgetPosition[]

/** #rgb or #rrggbb. Deliberately strict: the value is interpolated straight into
 *  the widget's stylesheet, so anything else is both a styling and an injection risk. */
const HEX_COLOR = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/

function copy(a: Record<string, unknown>, key: string): string {
  return typeof a[key] === 'string' ? a[key].trim() : ''
}

function boundedNumber(a: Record<string, unknown>, key: string, fallback: number, min: number, max: number): number | null {
  const value = a[key] === undefined ? fallback : Number(a[key])
  return Number.isFinite(value) && value >= min && value <= max ? value : null
}

function pathRules(a: Record<string, unknown>, key: string): string[] | null {
  const values = Array.isArray(a[key]) ? a[key] as unknown[] : []
  if (values.length > MAX_WIDGET_PATH_RULES) return null
  const rules = [...new Set(values.map((value) => typeof value === 'string' ? value.trim() : '').filter(Boolean))]
  return rules.every((rule) => rule.startsWith('/') && rule.length <= 120 && /^[/a-zA-Z0-9._~!*?&=\-{}:]+$/.test(rule))
    ? rules
    : null
}

export function validateWidgetAppearance(
  raw: unknown,
): { ok: true; value: WidgetAppearance } | Fail {
  if (!raw || typeof raw !== 'object') return fail('Appearance settings are required.')
  const a = raw as Record<string, unknown>

  const color = typeof a.widgetColor === 'string' ? a.widgetColor.trim() : ''
  if (!HEX_COLOR.test(color)) return fail('Pick a colour as a hex value, e.g. #6366f1.')

  const position = a.widgetPosition as WidgetPosition
  if (!POSITIONS.includes(position)) return fail('Choose where the widget sits on the page.')

  const welcome = typeof a.welcomeMessage === 'string' ? a.welcomeMessage.trim() : ''
  if (!welcome) return fail('Add a welcome message.')
  if (welcome.length > MAX_WELCOME_MESSAGE_CHARS) {
    return fail(`Keep the welcome message under ${MAX_WELCOME_MESSAGE_CHARS} characters.`)
  }

  // Defaults to showing the line: an older client that omits the field, or a
  // malformed value, must never be read as permission to hide attribution.
  const showBranding = a.showBranding !== false
  const rawDomains = Array.isArray(a.allowedDomains) ? a.allowedDomains : []
  if (rawDomains.length > 20) return fail('Add no more than 20 allowed domains.')
  const allowedDomains = [...new Set(rawDomains.map((value) => typeof value === 'string' ? value.trim().toLowerCase() : ''))]
    .filter(Boolean)
  const hostname = /^(?:\*\.)?(?:localhost|(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63})$/
  if (allowedDomains.some((domain) => !hostname.test(domain))) {
    return fail('Use hostnames such as example.com or *.example.com, without paths.')
  }

  const textFields = ['headerTitle', 'statusText', 'inputPlaceholder', 'launcherGreeting', 'privacyNotice'] as const
  if (textFields.some((key) => copy(a, key).length > MAX_WIDGET_COPY_CHARS)) {
    return fail(`Keep widget labels under ${MAX_WIDGET_COPY_CHARS} characters.`)
  }

  const privacyPolicyURL = copy(a, 'privacyPolicyURL')
  if (privacyPolicyURL) {
    try {
      const url = new URL(privacyPolicyURL)
      if (url.protocol !== 'https:' && url.protocol !== 'http:') return fail('Use an HTTP or HTTPS privacy policy URL.')
    } catch { return fail('Enter a valid privacy policy URL.') }
  }

  const launcherGreetingDelaySeconds = boundedNumber(a, 'launcherGreetingDelaySeconds', DEFAULT_WIDGET_APPEARANCE.launcherGreetingDelaySeconds, 0, 60)
  const autoOpenDelaySeconds = boundedNumber(a, 'autoOpenDelaySeconds', DEFAULT_WIDGET_APPEARANCE.autoOpenDelaySeconds, 0, 60)
  const horizontalOffset = boundedNumber(a, 'horizontalOffset', DEFAULT_WIDGET_APPEARANCE.horizontalOffset, 8, 96)
  const verticalOffset = boundedNumber(a, 'verticalOffset', DEFAULT_WIDGET_APPEARANCE.verticalOffset, 8, 96)
  const persistenceDays = boundedNumber(a, 'persistenceDays', DEFAULT_WIDGET_APPEARANCE.persistenceDays, 1, 30)
  if ([launcherGreetingDelaySeconds, autoOpenDelaySeconds, horizontalOffset, verticalOffset, persistenceDays].some((value) => value === null)) {
    return fail('Check the widget timing, offset, and persistence values.')
  }

  const includePaths = pathRules(a, 'includePaths')
  const excludePaths = pathRules(a, 'excludePaths')
  if (!includePaths || !excludePaths) return fail('Use up to 20 path patterns beginning with /.')

  const theme = WIDGET_THEMES.includes(a.theme as typeof WIDGET_THEMES[number])
    ? a.theme as WidgetAppearance['theme']
    : DEFAULT_WIDGET_APPEARANCE.theme
  const locale = WIDGET_LOCALES.includes(a.locale as typeof WIDGET_LOCALES[number])
    ? a.locale as WidgetAppearance['locale']
    : DEFAULT_WIDGET_APPEARANCE.locale
  const conversationPersistence = WIDGET_CONVERSATION_PERSISTENCE.includes(a.conversationPersistence as typeof WIDGET_CONVERSATION_PERSISTENCE[number])
    ? a.conversationPersistence as WidgetAppearance['conversationPersistence']
    : DEFAULT_WIDGET_APPEARANCE.conversationPersistence

  return {
    ok: true,
    value: {
      widgetColor: color.toLowerCase(),
      widgetPosition: position,
      welcomeMessage: welcome,
      showBranding,
      allowedDomains,
      enabled: a.enabled !== false,
      theme,
      headerTitle: copy(a, 'headerTitle'),
      statusText: copy(a, 'statusText'),
      inputPlaceholder: copy(a, 'inputPlaceholder'),
      launcherGreeting: copy(a, 'launcherGreeting'),
      launcherGreetingDelaySeconds: launcherGreetingDelaySeconds!,
      autoOpenDelaySeconds: autoOpenDelaySeconds!,
      autoOpenOncePerSession: a.autoOpenOncePerSession !== false,
      showOnDesktop: a.showOnDesktop !== false,
      showOnMobile: a.showOnMobile !== false,
      includePaths,
      excludePaths,
      horizontalOffset: horizontalOffset!,
      verticalOffset: verticalOffset!,
      locale,
      privacyNotice: copy(a, 'privacyNotice'),
      privacyPolicyURL,
      soundEnabled: a.soundEnabled === true,
      conversationPersistence,
      persistenceDays: persistenceDays!,
    },
  }
}
