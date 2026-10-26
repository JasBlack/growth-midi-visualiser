import { describe, expect, it } from 'vitest'
import { RunningMax, TimeWindow, onsetParams } from './inputAudio'

describe('onsetParams', () => {
  it('0.5 is the v0.15 detector, reached from both halves of the scale', () => {
    const mid = onsetParams(0.5)
    expect(mid.k).toBeCloseTo(1.9, 12)
    expect(mid.gap).toBeCloseTo(0.12, 12)
    expect(mid.gate).toBeCloseTo(0.04, 12)
    expect(mid.floor).toBeCloseTo(0.001, 12)
    expect(20 * Math.log10(mid.rms)).toBeCloseTo(-50, 1)
    const above = onsetParams(0.5 + 1e-9) // the other branch
    for (const key of ['k', 'gap', 'gate', 'floor', 'rms'] as const) expect(above[key]).toBeCloseTo(mid[key], 6)
  })

  it('more sensitive = lower threshold, shorter gap, lower gate and noise gate; clamped to 0..1', () => {
    let prev = onsetParams(0)
    for (let x = 0.1; x <= 1.0001; x += 0.1) {
      const p = onsetParams(x)
      expect(p.k).toBeLessThan(prev.k)
      expect(p.gap).toBeLessThan(prev.gap)
      expect(p.gate).toBeLessThan(prev.gate)
      expect(p.rms).toBeLessThan(prev.rms)
      expect(p.floor).toBeLessThanOrEqual(prev.floor)
      prev = p
    }
    expect(onsetParams(-3)).toEqual(onsetParams(0))
    expect(onsetParams(7)).toEqual(onsetParams(1))
    // the noise gate spans ±12 dB around the middle
    expect(onsetParams(0).rms / onsetParams(0.5).rms).toBeCloseTo(4, 9)
    expect(onsetParams(0.5).rms / onsetParams(1).rms).toBeCloseTo(4, 9)
  })
})

describe('onset detector windows are time-based', () => {
  it('TimeWindow: the median of the last `span` seconds, whatever the frame rate', () => {
    const median = (fps: number) => {
      const w = new TimeWindow(0.4)
      let m = 0
      for (let f = 0; f <= 3 * fps; f++) {
        const t = f / fps
        w.push(t, t < 2 ? 1 : 5) // the level steps up at 2 s
        if (Math.abs(t - 2.1) < 0.5 / fps) m = w.median()
      }
      return [m, w.median()]
    }
    // 0.1 s after the step, a 0.4 s window still mostly holds the old level; at 3 s only the new
    for (const fps of [24, 60, 144]) expect(median(fps)).toEqual([1, 5])
  })

  it('TimeWindow keeps at least the newest sample after a long gap; empty is 0', () => {
    const w = new TimeWindow(0.4)
    expect(w.median()).toBe(0)
    w.push(0, 9)
    w.push(100, 3)
    expect(w.median()).toBe(3)
  })

  it('RunningMax: a loud passage is forgotten with the same time constant at any frame rate', () => {
    const decayed = (fps: number) => {
      const m = new RunningMax(1e-4)
      m.push(1, 1 / fps)
      for (let i = 0; i < 5.5 * fps; i++) m.push(0, 1 / fps)
      return m.v
    }
    for (const fps of [24, 60, 144]) expect(decayed(fps)).toBeCloseTo(Math.exp(-1), 6)
    const m = new RunningMax(0.01)
    expect(m.push(0.001, 1 / 60)).toBeCloseTo(0.1, 12) // never normalised against less than the floor
    expect(m.push(0.5, 1 / 60)).toBe(1) // a new peak reads as full
  })
})
