import { describe, expect, it } from 'vitest'
import { reflectedStep } from './bounce'

const step = (position: number, direction: number, distance: number, limit: number) =>
  reflectedStep(position, direction, distance, limit, { position: NaN, direction: NaN })

describe('reflectedStep', () => {
  it('speed 0 holds the position (clamped into the frame) and the heading', () => {
    expect(step(0.3, -1, 0, 0.5)).toEqual({ position: 0.3, direction: -1 })
    expect(step(0.9, 1, 0, 0.5)).toEqual({ position: 0.5, direction: 1 })
    expect(step(-2, 1, -1, 0.5)).toEqual({ position: -0.5, direction: 1 })
  })

  it('no room to travel (the picture fills the frame): centred', () => {
    expect(step(0.4, 1, 0.1, 0).position).toBe(0)
  })

  it('travels freely inside the limits', () => {
    expect(step(0, 1, 0.2, 1).position).toBeCloseTo(0.2, 12)
    expect(step(0, -1, 0.2, 1)).toMatchObject({ direction: -1 })
    expect(step(0, -1, 0.2, 1).position).toBeCloseTo(-0.2, 12)
  })

  it('reflects off an edge and turns round', () => {
    const r = step(0.9, 1, 0.3, 1)
    expect(r.position).toBeCloseTo(0.8, 12)
    expect(r.direction).toBe(-1)
    const l = step(-0.5, -1, 2, 1) // down 0.5 to the edge, back up 1.5
    expect(l.position).toBeCloseTo(0.5, 12)
    expect(l.direction).toBe(1)
  })

  it('one long step equals many small ones (closed form, however many reflections)', () => {
    const small = { position: 0.1, direction: 1 }
    for (let i = 0; i < 1000; i++) reflectedStep(small.position, small.direction, 0.0137, 0.7, small)
    const big = step(0.1, 1, 13.7, 0.7)
    expect(big.position).toBeCloseTo(small.position, 9)
    expect(big.direction).toBe(small.direction)
  })

  it('stays inside the frame over a long run with uneven frame times', () => {
    const s = { position: 0, direction: 1 }
    let seed = 7
    let worst = 0
    let headings = true
    for (let i = 0; i < 200000; i++) {
      seed = (seed * 16807) % 2147483647
      const dt = (seed / 2147483647) * 0.05 // the engine bounds a frame to 50 ms
      reflectedStep(s.position, s.direction, dt * 0.5, 0.41, s)
      worst = Math.max(worst, Math.abs(s.position))
      headings &&= Math.abs(s.direction) === 1
    }
    expect(worst).toBeLessThanOrEqual(0.41 + 1e-12)
    expect(worst).toBeGreaterThan(0.4) // it did reach the edges
    expect(headings).toBe(true)
    // a huge jump lands inside too
    expect(Math.abs(step(0.2, -1, 1e7 + 0.123, 0.41).position)).toBeLessThanOrEqual(0.41)
  })
})
