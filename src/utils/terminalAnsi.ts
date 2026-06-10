const ESC = '\x1b['

export const ANSI_RESET = `${ESC}0m`
export const ANSI_DIM = `${ESC}2m`

/**
 * Whether the terminal supports 24-bit truecolor.
 *
 * Apple Terminal.app is 256-color only and leaves COLORTERM unset; emitting
 * `38;2;r;g;b` to it mis-parses (the RGB numbers leak as stray SGR codes and
 * the banner renders as colored garbage). Truecolor terminals (iTerm2,
 * Ghostty, kitty, WezTerm, VTE-based) set COLORTERM=truecolor|24bit, so we
 * gate on that and downsample to xterm-256 otherwise.
 */
export function supportsTrueColor(): boolean {
  const ct = process.env.COLORTERM
  return ct === 'truecolor' || ct === '24bit'
}

/** Convert 8-bit-per-channel RGB to the nearest xterm-256 palette index. */
export function rgbToAnsi256(r: number, g: number, b: number): number {
  // Grayscale ramp (232-255) when the channels are equal.
  if (r === g && g === b) {
    if (r < 8) return 16
    if (r > 248) return 231
    return Math.round(((r - 8) / 247) * 24) + 232
  }
  // 6x6x6 color cube (16-231).
  return (
    16 +
    36 * Math.round((r / 255) * 5) +
    6 * Math.round((g / 255) * 5) +
    Math.round((b / 255) * 5)
  )
}

export function ansiRgb(r: number, g: number, b: number): string {
  if (supportsTrueColor()) {
    return `${ESC}38;2;${r};${g};${b}m`
  }
  return `${ESC}38;5;${rgbToAnsi256(r, g, b)}m`
}
