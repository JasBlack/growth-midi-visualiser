import { describe, expect, it } from 'vitest'
import { SegmentCredits } from './pacing'

/** Run `seconds` of frames at `fps`, spending every start granted; returns the starts made. */
function run(c: SegmentCredits, rate: number, fps: number, seconds: number, demand = Infinity) {
  let starts = 0
  for (let f = 0; f < Math.round(seconds * fps); f++) {
    const granted = c.begin(rate, 1 / fps)
    const spent = Math.min(granted, demand)
    starts += spent
    c.end(granted - spent)
  }
  return starts
}

describe('SegmentCredits', () => {
  it('rate <= 0 (or NaN) means unlimited and banks nothing', () => {
    const c = new SegmentCredits()
    expect(c.begin(0, 1 / 60)).toBe(Infinity)
    c.end(0) // spending "everything" of an unlimited frame must not go negative or NaN
    expect(c.begin(-5, 1 / 60)).toBe(Infinity)
    expect(c.begin(Number.NaN, 1 / 60)).toBe(Infinity)
    // switching back to a finite rate starts from an empty bank
    expect(c.begin(10, 0)).toBe(0)
  })

  it.each([30, 60, 144])('holds the rate at %i fps (fractional credit carries across frames)', (fps) => {
    // 37 per second does not divide any of these frame rates
    expect(Math.abs(run(new SegmentCredits(), 37, fps, 4) - 148)).toBeLessThanOrEqual(1)
    // a rate far below one start per frame still gets its starts
    expect(Math.abs(run(new SegmentCredits(), 5, fps, 4) - 20)).toBeLessThanOrEqual(1)
  })

  it('accrues at most 50 ms per frame, so a stall is not a catch-up flood', () => {
    const c = new SegmentCredits()
    expect(c.begin(100, 2)).toBe(5) // a 2 s hitch earns 0.05 s × 100
    c.end(5)
    expect(c.begin(100, -1)).toBe(5) // a clock going backwards earns nothing
  })

  it('caps the bank at 64 starts', () => {
    const c = new SegmentCredits()
    expect(c.begin(1e6, 1 / 60)).toBe(64)
    // nothing spent for a while: still 64, never more
    for (let i = 0; i < 100; i++) {
      const g = c.begin(1500, 1 / 60)
      expect(g).toBeLessThanOrEqual(64)
      c.end(g)
    }
    expect(c.begin(1500, 1 / 60)).toBe(64)
  })

  it('charges only for starts made: an unspent allowance stays banked', () => {
    const c = new SegmentCredits()
    const g = c.begin(100, 0.05) // 5
    c.end(g - 2) // 2 starts made, 3 left
    expect(c.begin(100, 0)).toBe(3)
    c.end(3) // none spent
    expect(c.begin(100, 0.01)).toBe(4)
  })

  it('a waiting tip is served as soon as credit exists (demand below the rate)', () => {
    // 2 wanted per frame at 60 fps against a 60/s rate: one start per frame, not two, not zero
    expect(Math.abs(run(new SegmentCredits(), 60, 60, 2, 2) - 120)).toBeLessThanOrEqual(1)
  })

  it('reset empties the bank', () => {
    const c = new SegmentCredits()
    c.begin(1000, 0.05)
    c.end(50)
    c.reset()
    expect(c.begin(1000, 0)).toBe(0)
  })
})
