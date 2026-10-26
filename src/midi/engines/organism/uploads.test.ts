import { describe, expect, it } from 'vitest'
import type * as THREE from 'three'
import { DirtySlots } from './uploads'

interface Range {
  start: number
  count: number
}

/** The part of a BufferAttribute that DirtySlots touches. Pending ranges stand for writes three has not uploaded yet. */
function fakeAttr(itemSize = 16, pending: Range[] = [], bytesPer = 4) {
  const a = {
    itemSize,
    array: { BYTES_PER_ELEMENT: bytesPer },
    updateRanges: pending.map((r) => ({ ...r })),
    needsUpdate: false,
    addUpdateRange(start: number, count: number) {
      a.updateRanges.push({ start, count })
    },
    clearUpdateRanges() {
      a.updateRanges.length = 0
    },
  }
  return a
}
const asAttr = (a: ReturnType<typeof fakeAttr>) => a as unknown as THREE.BufferAttribute

/** mulberry32: a seeded generator, so a failure reproduces */
function prng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Slot ranges (in items, not floats) of the ranges added after `skip`. */
const slots = (a: ReturnType<typeof fakeAttr>, skip = 0) =>
  a.updateRanges.slice(skip).map((r) => [r.start / a.itemSize, (r.start + r.count) / a.itemSize - 1])

describe('DirtySlots', () => {
  it('nothing marked: no ranges, no upload, 0 bytes', () => {
    const a = fakeAttr()
    expect(new DirtySlots().flush(asAttr(a))).toBe(0)
    expect(a.updateRanges).toEqual([])
    expect(a.needsUpdate).toBe(false)
  })

  it('one slot: one range of itemSize floats, flagged, bytes returned', () => {
    const d = new DirtySlots()
    const a = fakeAttr(16)
    d.mark(5)
    expect(d.flush(asAttr(a))).toBe(16 * 4)
    expect(a.updateRanges).toEqual([{ start: 80, count: 16 }])
    expect(a.needsUpdate).toBe(true)
  })

  it('coalesces nearby marks (unsorted, duplicated) and splits distant ones', () => {
    const d = new DirtySlots()
    const a = fakeAttr(4)
    // gaps of at most 16 slots share a span (re-sending a few clean slots beats another upload call)
    for (const i of [44, 12, 10, 20, 12, 30, 3000]) d.mark(i)
    const bytes = d.flush(asAttr(a))
    expect(slots(a)).toEqual([
      [10, 44],
      [3000, 3000],
    ])
    expect(bytes).toBe((35 + 1) * 4 * 4)
  })

  it('never makes more than 8 spans a frame: the gap widens until they fit', () => {
    const d = new DirtySlots()
    const a = fakeAttr(1)
    // three far clusters of marks 40 apart: 9 spans at the first gap, 3 once it has doubled twice
    for (const base of [0, 10000, 20000]) for (const k of [0, 40, 80]) d.mark(base + k)
    d.flush(asAttr(a))
    expect(slots(a)).toEqual([
      [0, 80],
      [10000, 10080],
      [20000, 20080],
    ])
  })

  it('random marks: at most 8 disjoint sorted spans that cover every mark; bytes match', () => {
    const rand = prng(12345)
    for (let trial = 0; trial < 50; trial++) {
      const d = new DirtySlots()
      const a = fakeAttr(3, [], 2)
      const marks = Array.from({ length: 1 + Math.floor(rand() * 300) }, () => Math.floor(rand() * 50000))
      for (const m of marks) d.mark(m)
      const bytes = d.flush(asAttr(a))
      const spans = slots(a)
      expect(spans.length).toBeLessThanOrEqual(8)
      for (let i = 1; i < spans.length; i++) expect(spans[i][0]).toBeGreaterThan(spans[i - 1][1])
      for (const m of marks) expect(spans.some(([lo, hi]) => m >= lo && m <= hi)).toBe(true)
      expect(bytes).toBe(spans.reduce((s, [lo, hi]) => s + (hi - lo + 1), 0) * 3 * 2)
    }
  })

  it('past 4096 marks in a frame: one span from the lowest to the highest', () => {
    const d = new DirtySlots()
    const a = fakeAttr(16)
    d.mark(90000) // outside the kept list once it overflows, still inside [min, max]
    for (let i = 0; i < 5000; i++) d.mark(100 + i)
    d.mark(7)
    expect(d.flush(asAttr(a))).toBe((90000 - 7 + 1) * 16 * 4)
    expect(slots(a)).toEqual([[7, 90000]])
  })

  it('flush forgets the marks; reset drops them unflushed', () => {
    const d = new DirtySlots()
    const a = fakeAttr()
    d.mark(1)
    d.flush(asAttr(a))
    expect(d.flush(asAttr(fakeAttr()))).toBe(0)
    d.mark(2)
    d.reset()
    expect(d.flush(asAttr(fakeAttr()))).toBe(0)
  })

  // regression (5c7bafc): flush cleared the ranges three had not uploaded yet, so those writes
  // were lost and most segments rendered black
  it('keeps pending ranges three has not consumed yet', () => {
    const d = new DirtySlots()
    const a = fakeAttr(16, [{ start: 0, count: 16 }])
    d.mark(1000)
    const bytes = d.flush(asAttr(a))
    expect(a.updateRanges).toEqual([
      { start: 0, count: 16 },
      { start: 16000, count: 16 },
    ])
    expect(bytes).toBe(16 * 4) // only this frame's writes count
  })

  it('an attribute not drawn for many frames: pending ranges pile up, then collapse into one covering span', () => {
    const d = new DirtySlots()
    const a = fakeAttr(1)
    for (let frame = 0; frame < 200; frame++) {
      d.mark(frame * 100)
      d.flush(asAttr(a)) // never consumed: three did not draw it
      expect(a.updateRanges.length).toBeLessThanOrEqual(50)
      // every write so far is still covered by some range
      for (let f = 0; f <= frame; f++) expect(a.updateRanges.some((r) => f * 100 >= r.start && f * 100 < r.start + r.count)).toBe(true)
    }
  })

  it('collapses only past 48 pending ranges', () => {
    const pending = Array.from({ length: 48 }, (_, i) => ({ start: i * 100, count: 10 }))
    const d = new DirtySlots()
    const a = fakeAttr(1, pending)
    d.mark(99999)
    d.flush(asAttr(a))
    expect(a.updateRanges.length).toBe(49) // 48 kept as they were + the new one

    const b = fakeAttr(1, [...pending, { start: 4800, count: 10 }])
    d.mark(99999)
    d.flush(asAttr(b))
    expect(b.updateRanges).toEqual([
      { start: 0, count: 4810 },
      { start: 99999, count: 1 },
    ])
  })
})
