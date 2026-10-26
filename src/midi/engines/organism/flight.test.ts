import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { FLIGHT_FAR, FLIGHT_FOG, THREADS, abcFlow, inkTint, thickFactor, tubeSpot } from './flight'
import { CHROME_SPECIES, chromeTint } from './soft'

describe('tubeSpot: where a played note lands ahead of the flight', () => {
  const at = (pitchN: number, velocity = 0.6) => tubeSpot(pitchN, velocity, 16 / 9, 0.5, 0.5, 0.5)

  it('low notes on the left, high notes on the right, the middle over the top', () => {
    expect(at(0).x).toBeLessThan(0)
    expect(at(0.1).x).toBeLessThan(0)
    expect(at(0.9).x).toBeGreaterThan(0)
    expect(at(1).x).toBeGreaterThan(0)
    expect(at(0.5).y).toBeGreaterThan(0)
    expect(Math.abs(at(0.5).x)).toBeLessThan(1e-9)
  })

  it('pitch sweeps the angle one way round the axis', () => {
    const ang = (p: number) => Math.atan2(at(p).y, at(p).x)
    // from lower left (-135°) up over the top to lower right (-45°): unwrap to one rising sweep
    const unwrap = (a: number) => (a < -Math.PI / 2 ? a + 2 * Math.PI : a)
    let prev = Infinity
    for (let p = 0; p <= 1; p += 0.1) {
      const a = unwrap(ang(p))
      expect(a).toBeLessThan(prev)
      prev = a
    }
  })

  it('loud notes land nearer; every spot is ahead and inside the frame', () => {
    expect(at(0.5, 1).d).toBeLessThan(at(0.5, 0.2).d)
    for (const r of [0, 0.5, 0.999]) {
      for (const p of [0, 0.3, 0.7, 1]) {
        const s = tubeSpot(p, r, 16 / 9, r, r, r)
        expect(s.d).toBeGreaterThan(4)
        expect(s.d).toBeLessThan(FLIGHT_FAR)
        // x in units of the frame's half height: inside a 16:9 frame, y inside its height
        expect(Math.abs(s.x)).toBeLessThan(16 / 9)
        expect(Math.abs(s.y)).toBeLessThan(1)
      }
    }
  })
})

describe('the web', () => {
  it('ABC flow is divergence-free (strands swirl, they do not pile up or thin out)', () => {
    const f = (x: number, y: number, z: number) => abcFlow(x, y, z, new THREE.Vector3())
    const h = 1e-4
    for (const [x, y, z] of [[0.3, 1.1, -2], [4, -0.7, 0.2], [-1.3, 2.2, 5.5]]) {
      const div =
        (f(x + h, y, z).x - f(x - h, y, z).x) / (2 * h) + (f(x, y + h, z).y - f(x, y - h, z).y) / (2 * h) + (f(x, y, z + h).z - f(x, y, z - h).z) / (2 * h)
      expect(Math.abs(div)).toBeLessThan(1e-6)
    }
  })

  it('thickness varies round 1, wider with more spread', () => {
    expect(thickFactor(0.65, 0.5, 0.5)).toBeCloseTo(1, 12)
    expect(thickFactor(0.65, 0.9, 0.9)).toBeGreaterThan(1.5)
    expect(thickFactor(0.65, 0.1, 0.1)).toBeLessThan(0.65)
    expect(thickFactor(0, 0.9, 0.9)).toBe(1)
  })

  it('ink is mostly near black, with some pink and blue; chrome mostly silver-blue', () => {
    const c = new THREE.Color()
    let dark = 0
    let tinted = 0
    for (let i = 0; i < 100; i++) {
      inkTint(i / 100, c)
      if (Math.max(c.r, c.g, c.b) < 0.1) dark++
      else tinted++
    }
    expect(dark).toBeGreaterThan(55)
    expect(tinted).toBeGreaterThan(20)
    chromeTint(0.1, c)
    expect(c.b).toBeGreaterThan(c.r)
  })

  it('the Webs species are opt-in, and the threads leave no beads at their tips', () => {
    expect(THREADS.optIn).toBe(true)
    expect(THREADS.glow).toBe(0)
    expect(THREADS.ink).toBe(true)
    for (const sp of CHROME_SPECIES) {
      expect(sp.optIn).toBe(true)
      expect(sp.chrome).toBe(true)
      expect(sp.soft).toBeTruthy()
    }
  })

  it('the haze hides the far end of the tube, not what is close', () => {
    // haze.ts multiplies the engine's density by 1.3 (its gain) and fogs by exp(-(k·d)²)
    const clear = (d: number) => Math.exp(-((FLIGHT_FOG * 1.3 * d) ** 2))
    expect(clear(5)).toBeGreaterThan(0.9)
    expect(clear(FLIGHT_FAR)).toBeLessThan(0.2)
  })
})
