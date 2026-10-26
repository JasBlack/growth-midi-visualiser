// Palettes. Shader engines use IQ cosine palettes (a + b*cos(2π(c t + d)));
// canvas engines use the same family sampled on the CPU. The pitch class
// rotates the phase, so the colour world shifts with the harmony.

export interface Palette {
  name: string
  a: [number, number, number]
  b: [number, number, number]
  c: [number, number, number]
  d: [number, number, number]
  /** How much the pitch class rotates the phase (0 = colour ignores pitch). */
  pitchSpread: number
}

export const PALETTES: Palette[] = [
  { name: 'ember', a: [0.5, 0.5, 0.5], b: [0.5, 0.5, 0.5], c: [1, 1, 1], d: [0.0, 0.1, 0.2], pitchSpread: 1 },
  { name: 'ocean', a: [0.5, 0.5, 0.5], b: [0.5, 0.5, 0.5], c: [1, 1, 1], d: [0.3, 0.2, 0.2], pitchSpread: 0.6 },
  { name: 'acid', a: [0.5, 0.5, 0.5], b: [0.5, 0.5, 0.5], c: [1, 1, 0.5], d: [0.8, 0.9, 0.3], pitchSpread: 1 },
  { name: 'candy', a: [0.8, 0.5, 0.4], b: [0.2, 0.4, 0.2], c: [2, 1, 1], d: [0, 0.25, 0.25], pitchSpread: 0.8 },
  { name: 'forest', a: [0.2, 0.5, 0.3], b: [0.3, 0.4, 0.2], c: [1, 1, 0.8], d: [0.1, 0.3, 0.1], pitchSpread: 0.5 },
  { name: 'mono', a: [0.6, 0.6, 0.65], b: [0.4, 0.4, 0.35], c: [1, 1, 1], d: [0, 0, 0], pitchSpread: 0 },
  { name: 'spectrum', a: [0.5, 0.5, 0.5], b: [0.5, 0.5, 0.5], c: [1, 1, 1], d: [0.0, 0.33, 0.67], pitchSpread: 1 },
  // the Webs look's: silver greys leaning dusty pink and steel blue (appended: saved palettes are indices)
  { name: 'smoke', a: [0.6, 0.58, 0.62], b: [0.16, 0.1, 0.12], c: [1, 1, 1], d: [0.0, 0.33, 0.6], pitchSpread: 0.7 },
]

export function cosPalette(p: Palette, t: number, phase = 0): [number, number, number] {
  const out: [number, number, number] = [0, 0, 0]
  for (let i = 0; i < 3; i++) {
    out[i] = Math.min(1, Math.max(0, p.a[i] + p.b[i] * Math.cos(2 * Math.PI * (p.c[i] * t + p.d[i] + phase))))
  }
  return out
}

/** Colour for a MIDI pitch under palette `p`; `t` shifts along the palette. */
export function noteRgb(p: Palette, pitch: number, t = 0): [number, number, number] {
  const phase = ((((pitch % 12) + 12) % 12) / 12) * p.pitchSpread
  return cosPalette(p, t, phase)
}

export function noteCss(p: Palette, pitch: number, t = 0, alpha = 1): string {
  return rgbCss(noteRgb(p, pitch, t), alpha)
}

export function rgbCss(c: [number, number, number], alpha = 1) {
  return `rgba(${(c[0] * 255) | 0},${(c[1] * 255) | 0},${(c[2] * 255) | 0},${alpha})`
}
