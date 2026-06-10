/**
 * Color palettes for the startup splash logo.
 * Selected via /logo, persisted in GlobalConfig.logoColor.
 */

export type RGB = readonly [number, number, number]

export type LogoPalette = {
  /** Gradient stops painted top→bottom across the ASCII logo rows. */
  gradient: readonly RGB[]
  /** Highlight color for tagline, version label, and the ✦ marker. */
  accent: RGB
  /** Soft body text color (tagline value, label values). */
  cream: RGB
  /** Dim color for label names and the openclaude prefix. */
  dim: RGB
  /** Box-drawing border color. */
  border: RGB
}

export const LOGO_PALETTES = {
  purple: {
    gradient: [
      [196, 181, 253],
      [167, 139, 250],
      [139, 92, 246],
      [124, 58, 237],
      [109, 40, 217],
      [76, 29, 149],
    ],
    accent: [167, 139, 250],
    cream: [221, 214, 254],
    dim: [120, 100, 160],
    border: [88, 70, 130],
  },
  sunset: {
    gradient: [
      [255, 92, 92],
      [238, 55, 70],
      [220, 38, 38],
      [190, 24, 38],
      [153, 27, 27],
      [110, 20, 24],
    ],
    accent: [255, 92, 92],
    cream: [235, 205, 205],
    dim: [135, 90, 90],
    border: [115, 55, 60],
  },
  forest: {
    gradient: [
      [180, 240, 170],
      [130, 215, 130],
      [85, 180, 95],
      [55, 145, 75],
      [40, 110, 60],
      [25, 80, 45],
    ],
    accent: [120, 200, 120],
    cream: [200, 220, 190],
    dim: [90, 120, 90],
    border: [70, 95, 70],
  },
  ocean: {
    gradient: [
      [170, 220, 255],
      [125, 185, 240],
      [80, 150, 220],
      [55, 115, 190],
      [40, 85, 150],
      [25, 55, 110],
    ],
    accent: [110, 180, 230],
    cream: [195, 215, 235],
    dim: [90, 115, 145],
    border: [70, 90, 115],
  },
  monochrome: {
    gradient: [
      [225, 225, 225],
      [195, 195, 195],
      [160, 160, 160],
      [125, 125, 125],
      [95, 95, 95],
      [70, 70, 70],
    ],
    accent: [200, 200, 200],
    cream: [210, 210, 210],
    dim: [120, 120, 120],
    border: [95, 95, 95],
  },
} as const satisfies Record<string, LogoPalette>

export type LogoPaletteName = keyof typeof LOGO_PALETTES

export const LOGO_PALETTE_NAMES = Object.keys(LOGO_PALETTES) as LogoPaletteName[]

export const DEFAULT_LOGO_PALETTE: LogoPaletteName = 'purple'

export const LOGO_PALETTE_LABELS: Record<LogoPaletteName, string> = {
  purple: 'Limitless purple (default)',
  sunset: 'Sunset red',
  forest: 'Forest green',
  ocean: 'Ocean blue',
  monochrome: 'Monochrome',
}

export function isLogoPaletteName(value: unknown): value is LogoPaletteName {
  return (
    typeof value === 'string' &&
    Object.prototype.hasOwnProperty.call(LOGO_PALETTES, value)
  )
}

export function resolveLogoPalette(name: string | undefined): LogoPalette {
  return isLogoPaletteName(name)
    ? LOGO_PALETTES[name]
    : LOGO_PALETTES[DEFAULT_LOGO_PALETTE]
}
