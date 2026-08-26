const HEX_COLOR = /^#(?:[0-9a-f\d]{3}|[0-9a-f\d]{6})$/i

export function isWidgetHexColor(value: string): boolean {
  return HEX_COLOR.test(value.trim())
}

export function normalizeWidgetHexColor(value: string): string | null {
  const color = value.trim().toLowerCase()
  if (!HEX_COLOR.test(color)) return null
  if (color.length === 4) {
    return `#${color[1]}${color[1]}${color[2]}${color[2]}${color[3]}${color[3]}`
  }
  return color
}

function rgb(color: string): [number, number, number] {
  const normalized = normalizeWidgetHexColor(color) ?? '#000000'
  return [
    Number.parseInt(normalized.slice(1, 3), 16),
    Number.parseInt(normalized.slice(3, 5), 16),
    Number.parseInt(normalized.slice(5, 7), 16),
  ]
}

function luminance(color: string): number {
  const channels = rgb(color).map((value) => {
    const channel = value / 255
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * channels[0]! + 0.7152 * channels[1]! + 0.0722 * channels[2]!
}

export function widgetContrastRatio(a: string, b: string): number {
  const light = Math.max(luminance(a), luminance(b))
  const dark = Math.min(luminance(a), luminance(b))
  return (light + 0.05) / (dark + 0.05)
}

/** Picks the more readable neutral for text/icons placed on the brand colour. */
export function widgetForeground(color: string): '#ffffff' | '#18181b' {
  return widgetContrastRatio(color, '#ffffff') >= widgetContrastRatio(color, '#18181b')
    ? '#ffffff'
    : '#18181b'
}

/** Darkens a brand colour only where it is used as text on white. */
export function widgetAccessibleAccent(color: string): string {
  const normalized = normalizeWidgetHexColor(color) ?? '#6366f1'
  if (widgetContrastRatio(normalized, '#ffffff') >= 4.5) return normalized
  const [red, green, blue] = rgb(normalized)
  for (let amount = 0.9; amount >= 0; amount -= 0.05) {
    const candidate = `#${[red, green, blue]
      .map((channel) => Math.round(channel * amount).toString(16).padStart(2, '0'))
      .join('')}`
    if (widgetContrastRatio(candidate, '#ffffff') >= 4.5) return candidate
  }
  return '#18181b'
}
