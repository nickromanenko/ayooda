import {
  WIDGET_POSITIONS,
  MAX_WELCOME_MESSAGE_CHARS,
  type WidgetAppearance,
  type WidgetPosition,
} from '@ayooda/shared'

type Fail = { ok: false; error: string }
const fail = (error: string): Fail => ({ ok: false, error })

const POSITIONS = WIDGET_POSITIONS.map((p) => p.id) as readonly WidgetPosition[]

/** #rgb or #rrggbb. Deliberately strict: the value is interpolated straight into
 *  the widget's stylesheet, so anything else is both a styling and an injection risk. */
const HEX_COLOR = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/

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

  return {
    ok: true,
    value: { widgetColor: color.toLowerCase(), widgetPosition: position, welcomeMessage: welcome },
  }
}
