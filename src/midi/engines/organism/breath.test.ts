import { describe, expect, it } from 'vitest'
import { BREATH_ARC, BREATH_HOLD_RELEASE, BREATH_MIN, breathReach } from '../../shaders'
import { BREATH_ATTACK, BREATH_RELEASE, breathEase, breathShareOf, breathTarget, holdStrength } from './breath'
import { musicLevel } from './flight'

/** the envelope after `s` seconds of `target` at 60 fps, from `env` */
const run = (env: number, target: number, s: number) => {
  for (let i = 0; i < Math.round(s * 60); i++) env = breathEase(env, target, 1 / 60)
  return env
}

describe('music breath: the envelope', () => {
  it('silence is 0, a moderate key reaches most of the way, loud music is full', () => {
    expect(breathTarget(0, 0, 0)).toBe(0)
    expect(breathTarget(0.42, 0, 0)).toBeGreaterThan(0.6)
    expect(breathTarget(1, 1, 1)).toBe(1)
    expect(breathTarget(0, 0.9, 0)).toBeGreaterThan(0.4) // an onset alone lifts it
  })

  it('fast in, slow out: ~80 ms attack, ~600 ms release', () => {
    // one time constant gets ~63% of the way, whatever the frame rate
    expect(run(0, 1, BREATH_ATTACK)).toBeCloseTo(1 - Math.exp(-1), 1)
    expect(run(1, 0, BREATH_RELEASE)).toBeCloseTo(Math.exp(-1), 1)
    // in 0.25 s it is nearly all the way out, but only part of the way back
    expect(run(0, 1, 0.25)).toBeGreaterThan(0.95)
    expect(run(1, 0, 0.25)).toBeGreaterThan(0.6)
  })

  it('frame-rate independent and never overshoots (no flicker)', () => {
    let a = 0
    let b = 0
    for (let i = 0; i < 30; i++) a = breathEase(a, 1, 1 / 30)
    for (let i = 0; i < 240; i++) b = breathEase(b, 1, 1 / 240)
    expect(a).toBeCloseTo(b, 6)
    let e = 0.3
    for (let i = 0; i < 100; i++) {
      const next = breathEase(e, 0.8, 0.1)
      expect(next).toBeGreaterThanOrEqual(e)
      expect(next).toBeLessThanOrEqual(0.8)
      e = next
    }
    expect(breathEase(0.5, 1, 0)).toBe(0.5)
  })
})

describe('music breath: the reach', () => {
  it('no contraction reaches everything; full contraction leaves a stub at the roots', () => {
    expect(breathReach(0)).toBeGreaterThan(1000)
    expect(breathReach(1)).toBeCloseTo(BREATH_MIN, 12)
    // the default (0.55) in silence draws a strand back to a few units from its root (a big tree
    // to its inner core, a short note's growth hardly at all); soft playing keeps most of it out
    expect(breathReach(0.55)).toBeGreaterThan(3)
    expect(breathReach(0.55)).toBeLessThan(6)
    expect(breathReach(0.55 * (1 - breathTarget(0.25, 0, 0)))).toBeGreaterThan(8)
    expect(breathReach(0.5)).toBeCloseTo(BREATH_ARC + BREATH_MIN, 12)
  })

  it('more contraction never reaches further', () => {
    let prev = Infinity
    for (let c = 0.01; c <= 1; c += 0.01) {
      const r = breathReach(c)
      expect(r).toBeLessThan(prev)
      prev = r
    }
  })

  it('a held key stays out; on release it lets go over the hold release; a fresh strike eases in', () => {
    const HELD = 1e6
    const FAR = -1e4
    expect(holdStrength(10, HELD, 20)).toBe(1)
    expect(holdStrength(FAR, FAR, 20)).toBe(0) // never played
    expect(holdStrength(10, 20, 20 + BREATH_HOLD_RELEASE)).toBeCloseTo(Math.exp(-1), 12)
    expect(holdStrength(20, HELD, 20)).toBe(0)
    expect(holdStrength(20, HELD, 20.04)).toBeCloseTo(0.5, 12)
    expect(holdStrength(20, HELD, 20.2)).toBe(1)
  })

  it('a soft surface keeps the share of its skeleton inside the reach', () => {
    expect(breathShareOf(Infinity, 5)).toBe(1)
    expect(breathShareOf(2, 4)).toBe(0.5)
    expect(breathShareOf(-1, 4)).toBe(0) // grafted beyond the reach
    expect(breathShareOf(1, 0)).toBe(1) // nothing grown yet
  })
})

describe('the flight ambient web follows the music', () => {
  it('nothing in silence, more with energy and notes', () => {
    expect(musicLevel(0, 0)).toBe(0)
    expect(musicLevel(0.02, 0)).toBe(0)
    expect(musicLevel(0.2, 0)).toBeGreaterThan(0)
    expect(musicLevel(0, 1)).toBeGreaterThan(0)
    expect(musicLevel(1, 4)).toBe(1)
  })
})
