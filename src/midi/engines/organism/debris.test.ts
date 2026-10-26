import { describe, expect, it } from 'vitest'
import { DEBRIS_MAX, debrisCount, debrisTable } from './debris'
import { QUALITY_TIERS } from './quality'

/** a seeded stand-in for Math.random */
function lcg(seed: number) {
  let s = seed >>> 0
  return () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296
}

describe('debris', () => {
  it('count follows the amount and the quality tier, never past the allocation', () => {
    expect(debrisCount(0, 1)).toBe(0)
    expect(debrisCount(1, 1)).toBe(DEBRIS_MAX)
    expect(debrisCount(2, 1)).toBe(DEBRIS_MAX)
    expect(debrisCount(0.5, 1)).toBe(DEBRIS_MAX / 2)
    expect(debrisCount(1, QUALITY_TIERS[QUALITY_TIERS.length - 1].load)).toBeLessThan(DEBRIS_MAX / 4)
  })

  it('the scenery is the first thing a tier gives up, and never comes back lower down', () => {
    expect(QUALITY_TIERS[0].load).toBe(1)
    expect(QUALITY_TIERS[1].load).toBeLessThan(1)
    for (let i = 1; i < QUALITY_TIERS.length; i++) expect(QUALITY_TIERS[i].load).toBeLessThanOrEqual(QUALITY_TIERS[i - 1].load)
  })

  it('the particle table: places in the box, unit tumble axes, flat flakes and a few crystals', () => {
    const n = 20000
    const t = debrisTable(n, lcg(7))
    let crystals = 0
    let bad = 0
    for (let i = 0; i < n; i++) {
      for (let k = 0; k < 4; k++) if (!(t.a[i * 4 + k] >= 0 && t.a[i * 4 + k] < 1)) bad++
      if (Math.abs(Math.hypot(t.b[i * 4], t.b[i * 4 + 1], t.b[i * 4 + 2]) - 1) > 1e-5) bad++
      if (t.c[i * 4 + 3] === 1) crystals++
      else if (t.c[i * 4 + 1] >= t.c[i * 4] * 0.2) bad++ // a flake is thin
      if (Math.hypot(t.d[i * 3], t.d[i * 3 + 1], t.d[i * 3 + 2]) >= 0.4) bad++ // a slow drift
    }
    expect(bad).toBe(0)
    expect(crystals / n).toBeGreaterThan(0.002)
    expect(crystals / n).toBeLessThan(0.012)
  })

  it('is the same field for the same seed', () => {
    expect(debrisTable(50, lcg(3)).a).toEqual(debrisTable(50, lcg(3)).a)
  })
})
