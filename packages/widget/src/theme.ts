/**
 * Акцентный цвет приходит из админки строкой вида `#2F6BFF` и должен
 * работать без пересборки виджета. Поэтому он не зашит в CSS, а раскладывается
 * на переменные:
 *
 *   --accent      сам цвет
 *   --accent-rgb  «47, 107, 255» — из него собираются полупрозрачные заливки
 *   --accent-ink  текст на акценте: белый или почти чёрный, по яркости фона
 *   --accent-deep затемнённый вариант для наведения и мелкого текста
 *
 * Тёмный текст на светлом акценте (жёлтый, салатовый) — не украшательство:
 * иначе надпись на кнопке не пройдёт по контрасту и просто не читается.
 */

export interface AccentTheme {
  accent: string
  accentRgb: string
  accentInk: string
  accentDeep: string
}

const FALLBACK = '#E61D25'

export function buildAccentTheme(raw: string): AccentTheme {
  const rgb = parseHex(raw) ?? parseHex(FALLBACK)!
  const [red, green, blue] = rgb
  const luminance = relativeLuminance(rgb)

  return {
    accent: toHex(rgb),
    accentRgb: `${red}, ${green}, ${blue}`,
    // Порог 0.45 подобран так, чтобы белый текст оставался на синем и красном,
    // но уходил с жёлтого и мятного.
    accentInk: luminance > 0.45 ? '#12151A' : '#FFFFFF',
    accentDeep: toHex(mix(rgb, luminance > 0.45 ? [0, 0, 0] : [12, 16, 28], 0.22)),
  }
}

function parseHex(value: string): [number, number, number] | null {
  const match = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value.trim())
  if (!match) return null
  const hex = match[1]!
  const full =
    hex.length === 3
      ? hex
          .split('')
          .map((char) => char + char)
          .join('')
      : hex
  return [
    Number.parseInt(full.slice(0, 2), 16),
    Number.parseInt(full.slice(2, 4), 16),
    Number.parseInt(full.slice(4, 6), 16),
  ]
}

function toHex(rgb: [number, number, number]): string {
  return `#${rgb.map((channel) => clamp(channel).toString(16).padStart(2, '0')).join('')}`
}

function mix(base: [number, number, number], target: [number, number, number], amount: number): [number, number, number] {
  return [
    Math.round(base[0] + (target[0] - base[0]) * amount),
    Math.round(base[1] + (target[1] - base[1]) * amount),
    Math.round(base[2] + (target[2] - base[2]) * amount),
  ]
}

/** Яркость по WCAG — по ней и решается, каким цветом писать поверх акцента. */
function relativeLuminance([red, green, blue]: [number, number, number]): number {
  const channel = (value: number): number => {
    const normalized = value / 255
    return normalized <= 0.03928 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel(red) + 0.7152 * channel(green) + 0.0722 * channel(blue)
}

function clamp(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)))
}
