import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { HAZE_TONES, HazeWorld, hazeTone, type HazeTone } from './haze'
import { ENV_SHADERS, HAZE_ENV } from '../../shaders'

const lum = (c: THREE.Color) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b
const tone = (t: HazeTone) => {
  const base = new THREE.Color()
  const glow = new THREE.Color()
  return { ...hazeTone(t, base, glow), base, glow }
}

describe('hazeTone', () => {
  it('mist is the reference: walls ~#a19192 in sRGB, read as a light world', () => {
    const m = tone(HAZE_TONES.mist)
    const srgb = m.base.clone().convertLinearToSRGB()
    expect(Math.round(srgb.r * 255)).toBeGreaterThan(155)
    expect(Math.round(srgb.r * 255)).toBeLessThan(168)
    // warm grey-mauve: red leads, green and blue close together
    expect(srgb.r).toBeGreaterThan(srgb.g)
    expect(Math.abs(srgb.g - srgb.b)).toBeLessThan(0.02)
    expect(m.light).toBe(1)
  })

  it('dusk and ink are dark worlds: glows keep adding light there', () => {
    expect(tone(HAZE_TONES.dusk).light).toBeLessThan(0.1)
    expect(tone(HAZE_TONES.ink).light).toBe(0)
  })

  it("the bloom floor sits above the sky's brightest point, whatever the tone", () => {
    for (const t of Object.values(HAZE_TONES)) {
      for (const glow of [0, 1, 3]) {
        const r = tone({ ...t, glow })
        expect(r.bloomFloor).toBeGreaterThan(lum(r.base) + lum(r.glow))
      }
    }
  })

  it('the light at the end of the tunnel grows with its control and is gone at 0', () => {
    const at = (glow: number) => lum(tone({ ...HAZE_TONES.mist, glow }).glow)
    expect(at(0)).toBe(0)
    expect(at(0.5)).toBeLessThan(at(1))
    expect(at(1)).toBeLessThan(at(2))
  })
})

describe('HazeWorld', () => {
  it('is an environment entry and its controls default to mist', () => {
    expect(ENV_SHADERS[HAZE_ENV]?.name).toBe('haze')
    const w = new HazeWorld()
    const v = (k: string) => w.controls.find((c) => c.key === k)?.value
    expect(v('hazeHue')).toBe(HAZE_TONES.mist.hue)
    expect(v('hazeBright')).toBe(HAZE_TONES.mist.bright)
    expect(v('hazeGlow')).toBe(HAZE_TONES.mist.glow)
    // a fresh world is off: nothing reads it as light until the haze is chosen
    expect(w.on).toBe(false)
    expect(w.light).toBe(0)
    expect(w.bloomFloor).toBe(0)
  })
})
