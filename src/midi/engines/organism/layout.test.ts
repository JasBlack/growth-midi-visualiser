import { describe, expect, it, vi } from 'vitest'
import * as THREE from 'three'
import type { OrganismHost } from './feature'
import { CLASH, CONSONANCE, LAYOUT, PitchLayout, interval } from './layout'
import type { Plant } from './types'

/** A layout with its own controls set (the engine hands them in through onControl). */
function layout(values: { layout?: number; harmony?: number; velocityLook?: number; layoutSpread?: number } = {}) {
  const l = new PitchLayout()
  for (const c of l.controls) if (c.key in values) c.value = values[c.key as keyof typeof values]!
  l.onControl('', 0, { controls: l.controls } as unknown as OrganismHost)
  return l
}

/** Just the fields the chord and graft logic read. */
function plant(pitch: number, extra: Partial<Plant> = {}): Plant {
  const seg = { growth: 1, b: new THREE.Vector3(pitch, 0, 0) }
  return { pitch, root: new THREE.Vector3(), birth: 0, dying: false, isText: false, level: 0, sp: { soft: undefined }, segs: [seg, seg], ...extra } as unknown as Plant
}

describe('interval and consonance', () => {
  it('interval is the semitone class 0..11 of a over b', () => {
    expect(interval(67, 60)).toBe(7)
    expect(interval(60, 67)).toBe(5)
    expect(interval(72, 60)).toBe(0)
    expect(interval(-1, 0)).toBe(11)
  })

  it('unison and octave sit best, the fifth next; the tritone and the seconds clash', () => {
    expect(CONSONANCE).toHaveLength(12)
    expect(Math.max(...CONSONANCE)).toBe(CONSONANCE[0])
    expect(Math.min(...CONSONANCE)).toBe(CONSONANCE[6])
    expect(CONSONANCE[7]).toBe(Math.max(...CONSONANCE.slice(1)))
    for (const clash of [1, 6, 11]) expect(CONSONANCE[clash]).toBeLessThan(CLASH)
    for (const good of [0, 3, 4, 5, 7, 8, 9]) expect(CONSONANCE[good]).toBeGreaterThan(CLASH)
  })
})

describe('pitch → space', () => {
  it('off: no target, no lift', () => {
    const l = layout()
    expect(l.target(60, 1, 0.35, new THREE.Vector3())).toBe(false)
    expect(l.lift(30)).toBe(0)
  })

  it('strata: height follows the register exactly (jitter aside), clamped at ±3 octaves', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5) // no jitter, no lean
    const l = layout({ layout: LAYOUT.strata, layoutSpread: 1.5 })
    const y = (p: number) => {
      const out = new THREE.Vector3()
      l.target(p, 2, 0.35, out)
      return out.y
    }
    expect(y(60)).toBeCloseTo(0, 12)
    expect(y(72)).toBeCloseTo(1.9 * 1.5 * 2, 12) // an octave up, × spread × scale
    const ys = [0, 24, 36, 48, 60, 72, 84, 96, 127].map(y)
    expect(ys[0]).toBe(ys[1]) // below three octaves down: clamped
    for (let i = 2; i < ys.length - 1; i++) expect(ys[i]).toBeGreaterThan(ys[i - 1])
    expect(ys[8]).toBe(ys[7])
  })

  it('strata with real jitter and lean: every bass root lies below every treble root', () => {
    const l = layout({ layout: LAYOUT.strata })
    const out = new THREE.Vector3()
    for (let i = 0; i < 300; i++) {
      l.clear() // a new yaw and lean each time
      l.target(36, 1, 0.35, out)
      const bass = out.y
      l.target(84, 1, 0.35, out)
      expect(bass).toBeLessThan(out.y)
    }
  })

  it('helix walks the semitones round the circle; fifths puts C next to G', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5)
    const angle = (mode: number, pitch: number) => {
      const out = new THREE.Vector3()
      layout({ layout: mode }).target(pitch, 1, 0.35, out)
      return Math.atan2(out.z, out.x)
    }
    const step = (mode: number, a: number, b: number) => {
      const d = angle(mode, b) - angle(mode, a)
      return (((d % (2 * Math.PI)) + 3 * Math.PI) % (2 * Math.PI)) - Math.PI
    }
    expect(step(LAYOUT.helix, 60, 61)).toBeCloseTo(Math.PI / 6, 9) // one semitone = 1/12 turn
    expect(step(LAYOUT.fifths, 60, 67)).toBeCloseTo(Math.PI / 6, 9) // C → G: neighbours
    expect(Math.abs(step(LAYOUT.fifths, 60, 66))).toBeCloseTo(Math.PI, 9) // C → F#: opposite
  })

  it('lift: bass reaches down, treble up, bounded', () => {
    const s = layout({ layout: LAYOUT.strata })
    expect(s.lift(36)).toBeLessThan(0)
    expect(s.lift(84)).toBeGreaterThan(0)
    expect(s.lift(0)).toBeCloseTo(-0.32, 12)
    expect(s.lift(127)).toBeCloseTo(0.32, 12)
    expect(Math.abs(layout({ layout: LAYOUT.helix }).lift(127))).toBeCloseTo(0.12, 12)
  })
})

describe('harmony → structure', () => {
  it('reach weights: off at harmony 0; with harmony a clash reaches least and consonance further', () => {
    const off = layout({ harmony: 0 })
    expect([...off.distW]).toEqual(new Array(12).fill(1))
    expect(off.chordW).toBe(1)
    const h = layout({ harmony: 1 })
    for (let i = 0; i < 12; i++)
      for (let j = 0; j < 12; j++) if (CONSONANCE[i] > CONSONANCE[j]) expect(h.distW[i]).toBeLessThanOrEqual(h.distW[j])
    expect(h.distW[7]).toBeLessThan(1)
    expect(h.distW[6]).toBeGreaterThan(1)
    // the early-out bound is a true lower bound of every weight the scan uses
    for (let i = 0; i < 12; i++) expect(h.minW).toBeLessThanOrEqual(Math.min(h.distW[i], h.distW[i] * h.chordW))
  })

  it('chords: notes struck together join; a late note, an arpeggio or a far hand start their own', () => {
    const l = layout({ harmony: 0.6 })
    const c = plant(60)
    expect(l.chordFor(60, 10)).toBeNull()
    l.struck(c, null)
    expect(l.chordFor(64, 10.03)?.id).toBe(c.chord) // within 60 ms
    expect(l.chordFor(79, 10.05)).toBeNull() // more than an octave from the chord: the other hand
    expect(l.chordFor(67, 10.2)).toBeNull() // too late
    // an arpeggio: every gap is short, but the chord would outlast 150 ms
    const a = layout({ harmony: 0.6 })
    const first = plant(60)
    a.chordFor(60, 0)
    a.struck(first, null)
    let joined = 0
    for (const t of [0.05, 0.1, 0.15, 0.2, 0.25]) if (a.chordFor(64, t)?.id === first.chord) joined++
    expect(joined).toBe(3)
    // harmony off: no chord tracking at all
    const off = layout({ harmony: 0 })
    off.struck(plant(60), null)
    expect(off.chordFor(60, 0.01)).toBeNull()
  })

  it('graft: a unison is never declined; with harmony 1 a tritone mostly is; dying and soft growth never take one', () => {
    const l = layout({ harmony: 1 })
    const unison = [plant(48)]
    for (let i = 0; i < 100; i++) expect(l.graft(60, 1, null, 1, unison)).not.toBeNull()
    const tritone = [plant(66)]
    let took = 0
    for (let i = 0; i < 1000; i++) if (l.graft(60, 1, null, 1, tritone)) took++
    expect(took).toBeLessThan(200) // declined with p = (1 - 0.05)² ≈ 0.9
    const unusable = [plant(60, { dying: true }), plant(60, { sp: { soft: 'liquid' } } as unknown as Partial<Plant>), plant(60, { isText: true })]
    expect(l.graft(60, 1, null, 1, unusable)).toBeNull()
    expect(l.graft(60, 1, null, 1, [])).toBeNull()
  })
})

describe('velocity → weight', () => {
  it('heft: 1 at a computer key (0.75), thicker when harder, bounded; 0 = no velocity look', () => {
    const l = layout()
    expect(l.heft(0.75)).toBe(1)
    expect(l.heft(1)).toBeGreaterThan(1)
    expect(l.heft(0.2)).toBeLessThan(1)
    for (let v = 0; v <= 1; v += 0.05) expect(l.heft(v)).toBeLessThanOrEqual(l.heft(v + 0.05))
    expect(layout({ velocityLook: 2 }).heft(0)).toBe(0.4)
    expect(layout({ velocityLook: 2 }).heft(1)).toBe(1.2)
    expect(layout({ velocityLook: 0 }).heft(0.1)).toBe(1)
  })

  it('shine: soft notes dim (never to black), strong ones run toward white, 0.75 unchanged', () => {
    const l = layout({ velocityLook: 2 })
    const white = new THREE.Color(1, 1, 1)
    const base = new THREE.Color(0.8, 0.2, 0.1)
    const same = base.clone()
    l.shine(same, 0.75, white)
    expect(same.equals(base)).toBe(true)
    const soft = base.clone()
    l.shine(soft, 0, white)
    expect(soft.r).toBeCloseTo(0.8 * 0.35, 12)
    const hard = base.clone()
    l.shine(hard, 1, white)
    expect(hard.b).toBeGreaterThan(base.b)
    expect(hard.b).toBeLessThanOrEqual(base.b + 0.3 * (1 - base.b) + 1e-12)
  })
})
