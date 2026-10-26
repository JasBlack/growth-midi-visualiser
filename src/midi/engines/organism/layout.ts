// Pitch → space, harmony → structure, velocity → weight (k1 Idea 5): what you play is legible in
// the shape, not only in the colour.
//   - A pitch layout decides where a note roots. Strata: register → height, and bass tips reach
//     down while treble tips reach up. Helix: pitch class goes round a loose spiral that climbs an
//     octave per turn. Fifths: the circle of fifths, so consonant notes root near each other.
//     Every mapping is a bias, never a chart: angles and heights are jittered, radii random, the
//     frame gets its own yaw and a slight lean on every Reset, cohesion still grafts onto the
//     organism, and a reference, a skin or a camera path decides instead (organism.ts newPlant).
//   - Harmony: a note grafts onto (and its tips reach for) growths it sits well with, a unison,
//     octave, fifth or third before a merely close one; a minor second or a tritone keeps its
//     distance and leans away. Notes struck together (a chord) root in one area and fuse first.
//   - Velocity: strong notes grow thicker and hotter, soft ones thinner and dimmer.
// The engine calls in directly (newPlant, nextDir); the chord tracking is O(1) a note, the graft
// search samples at most 24 growths.

import * as THREE from 'three'
import { ctl } from '../../engine'
import type { EngineControl } from '../../engine'
import { pitchClass } from '../../music'
import type { FeatureControl, OrganismFeature, OrganismHost } from './feature'
import type { Plant, Seg } from './types'

const G = 'Growth'
/** Indices are stored by looks and presets: append only. */
export const LAYOUTS = [
  'off — free (the organism decides)',
  'strata — bass roots low and reaches down, treble high and reaches up',
  'helix — pitch class round a loose spiral, octaves climb',
  'fifths — circle of fifths: consonant notes root together',
]
export const LAYOUT = { off: 0, strata: 1, helix: 2, fifths: 3 } as const

/** How well two notes sit together, by interval class (semitones mod 12): unison / octave 1, fifth .9, thirds .7, seconds and sevenths low, tritone lowest. */
export const CONSONANCE = [1, 0.1, 0.3, 0.65, 0.7, 0.8, 0.05, 0.9, 0.65, 0.7, 0.3, 0.1]
/** below this an interval is a clash: it pulls less, and past harmony 0.5 pushes a little */
export const CLASH = 0.25
/** a note-on this soon after the last one joins its chord ... */
const CHORD_GAP = 0.06
/** ... while the chord is younger than this (a rolled chord, not an arpeggio) */
const CHORD_SPAN = 0.15
/** a chord tone this far (semitones) from every chord in progress starts its own: two hands, two clusters */
const CHORD_RANGE = 12
/** graft candidates sampled per note */
const SAMPLES = 24

const rnd = () => Math.random() - 0.5
export const interval = (a: number, b: number) => (((a - b) % 12) + 12) % 12

interface Chord {
  id: number
  pitch: number
  at: THREE.Vector3
}

export class PitchLayout implements OrganismFeature {
  readonly id = 'layout'
  readonly controls: FeatureControl[] = [
    { key: 'layout', label: 'pitch layout: where a note roots', min: 0, max: LAYOUTS.length - 1, step: 1, value: LAYOUT.off, options: LAYOUTS, group: G },
    { key: 'layoutSpread', label: 'pitch layout: spread (how far apart the registers sit)', min: 0.3, max: 2.5, step: 0.05, value: 1, group: G },
    { key: 'harmony', label: 'harmony: chord tones root together and fuse, dissonant notes keep apart (0 = off)', min: 0, max: 1, step: 0.05, value: 0.6, group: G },
    { key: 'velocityLook', label: 'velocity: strong notes thick and hot, soft ones thin and dim (0 = thickness only)', min: 0, max: 2, step: 0.05, value: 1, group: G },
  ]
  mode = 0
  spread = 1
  harmony = 0.6
  private vel = 1
  /**
   * Squared-distance factor per interval class for the tips' reach (engine nearestEndpoint): below 1
   * a tip reaches further for that growth, above 1 less far. `chordW` multiplies it for the tip's
   * own chord, `minW` is the smallest of all (the scan's early out).
   */
  readonly distW = new Float32Array(12).fill(1)
  chordW = 1
  minW = 1
  private wFor = -1
  /** the layout's own frame: a yaw and a slight lean, new on every Reset, so it is never axis-aligned or the same twice */
  private yaw = Math.random() * Math.PI * 2
  private readonly lean = new THREE.Quaternion()
  private host: OrganismHost | null = null
  private readonly chords: Chord[] = []
  private chordId = 0
  private chordT0 = -1e9
  private chordLast = -1e9
  private readonly axis = new THREE.Vector3()

  constructor() {
    this.tilt()
  }

  mount(e: OrganismHost) {
    this.host = e
    this.read(e.controls)
  }

  unmount() {
    this.host = null
  }

  clear() {
    this.tilt()
    this.chords.length = 0
    this.chordT0 = this.chordLast = -1e9
  }

  onControl(_key: string, _value: number, e: OrganismHost) {
    this.read(e.controls)
  }

  beforeFrame() {
    if (this.host) this.read(this.host.controls)
  }

  private read(c: EngineControl[]) {
    this.mode = Math.round(ctl(c, 'layout'))
    this.spread = ctl(c, 'layoutSpread')
    this.harmony = ctl(c, 'harmony')
    this.vel = ctl(c, 'velocityLook')
    if (this.harmony !== this.wFor) this.weights()
  }

  private tilt() {
    this.yaw = Math.random() * Math.PI * 2
    this.axis.set(rnd(), 0, rnd()).normalize()
    this.lean.setFromAxisAngle(this.axis, 0.08 + Math.random() * 0.12)
  }

  private weights() {
    const h = (this.wFor = this.harmony)
    let min = Infinity
    for (let i = 0; i < 12; i++) {
      const a = CONSONANCE[i]
      // a clash only attracts from close by; consonance widens the reach (a fifth ≈ 20% further at h = 1)
      const m = a < CLASH ? 1 + 2.5 * h : 1 + h * (1.2 * (1 - a) - 0.35)
      this.distW[i] = m * m
      min = Math.min(min, m * m)
    }
    this.chordW = (1 - 0.35 * h) ** 2
    this.minW = min * this.chordW
  }

  // ------------------------------------------------------------ pitch → space

  /**
   * Where a note roots in the layout, around the world origin: false when the layout is off.
   * `scale` is the organism size (/ 14, or the shell's); cohesion draws the roots in sideways only,
   * so the height stays the note's.
   */
  target(pitch: number, scale: number, cohesion: number, out: THREE.Vector3): boolean {
    if (!this.mode) return false
    // octaves from middle C; a piano's outer octaves stay inside the organism
    const reg = Math.max(-3, Math.min(3, (pitch - 60) / 12))
    const side = 1.6 - cohesion
    let ang: number
    let rad: number
    let y: number
    if (this.mode === LAYOUT.strata) {
      // anywhere around, a little narrower toward the extremes (a spindle, not a column)
      ang = Math.random() * Math.PI * 2
      rad = (0.3 + Math.random() * 2.1) * (1 - 0.1 * Math.min(3, Math.abs(reg)))
      y = reg * 1.9 + rnd() * 0.9
    } else {
      const pc = pitchClass(pitch)
      const k = this.mode === LAYOUT.fifths ? (pc * 7) % 12 : pc
      // helix: a semitone turns 1/12 and climbs 1/12 of an octave; each octave twists a little
      // further on, so the same pitch class does not stack into a column
      ang = (k / 12) * Math.PI * 2 + (this.mode === LAYOUT.helix ? Math.floor(pitch / 12) * 0.4 : 0) + rnd() * 0.7
      // some roots near the axis: a wheel with an empty hub would read as a diagram
      rad = 2.3 * (0.2 + Math.random() * Math.random() * 1.1 + Math.random() * 0.2)
      y = reg * (this.mode === LAYOUT.helix ? 1.6 : 0.9) + rnd() * 0.8
    }
    ang += this.yaw
    out.set(Math.cos(ang) * rad * side, y, Math.sin(ang) * rad * side)
    out.multiplyScalar(this.spread * scale).applyQuaternion(this.lean)
    return true
  }

  /** How far a graft may land from the note's place and still count as in it (its register). */
  reach(scale: number) {
    return 1.3 * this.spread * scale
  }

  /** Per growth step, how much its tips lean up (+) or down (−): bass reaches down, treble up. */
  lift(pitch: number): number {
    if (!this.mode) return 0
    const reg = Math.max(-1, Math.min(1, (pitch - 60) / 24))
    return reg * (this.mode === LAYOUT.strata ? 0.32 : 0.12)
  }

  // ------------------------------------------------------------ harmony → structure

  /**
   * A played note-on at t: the chord it joins (struck within CHORD_GAP of the previous note, within
   * an octave of that chord's first tone), or null when it starts its own. `struck` records it.
   */
  chordFor(pitch: number, t: number): Chord | null {
    if (this.harmony <= 0) return null
    if (t - this.chordLast > CHORD_GAP || t - this.chordT0 > CHORD_SPAN) {
      this.chords.length = 0
      this.chordT0 = t
    }
    this.chordLast = t
    let best: Chord | null = null
    let bestD = CHORD_RANGE + 1
    for (const c of this.chords) {
      const d = Math.abs(pitch - c.pitch)
      if (d < bestD) {
        bestD = d
        best = c
      }
    }
    return best
  }

  /**
   * Where a chord tone roots: by the chord's first tone, a little above or below it by its interval;
   * a clashing tone (a cluster's minor second, a tritone) sprouts a little apart.
   */
  chordRoot(c: Chord, pitch: number, scale: number, out: THREE.Vector3) {
    const apart = 1 + 2.5 * this.harmony * (1 - CONSONANCE[interval(pitch, c.pitch)])
    out.set(rnd(), rnd(), rnd()).normalize().multiplyScalar((0.2 + 0.35 * Math.random()) * apart * scale)
    out.y += ((pitch - c.pitch) / 12) * (this.mode ? this.spread * (this.mode === LAYOUT.strata ? 0.9 : 0.5) : 0.3) * scale
    return out.add(c.at)
  }

  /** A played note has rooted: it joins `chord`, or starts a new one where it stands. */
  struck(p: Plant, chord: Chord | null) {
    if (this.harmony <= 0) return
    if (chord) {
      p.chord = chord.id
      return
    }
    if (this.chords.length >= 4) this.chords.shift()
    p.chord = ++this.chordId
    this.chords.push({ id: p.chord, pitch: p.pitch, at: p.root.clone() })
  }

  /**
   * A joint to graft a new note onto, or null (nothing fits: the note roots on its own). Of up to
   * SAMPLES growths the best sits well with the note (harmony), is recent and, with a layout, stands
   * near `near`; a dissonant best is often declined. Then of a few of its joints, the one nearest
   * `near` (or any), and with a layout only if it lies within `reach` of it.
   */
  graft(pitch: number, t: number, near: THREE.Vector3 | null, reach: number, plants: readonly Plant[]): Seg | null {
    const n = plants.length
    if (!n) return null
    const h = this.harmony
    let best: Plant | null = null
    let bestS = 0
    const tries = Math.min(n, SAMPLES)
    for (let i = 0; i < tries; i++) {
      const p = n <= SAMPLES ? plants[i] : plants[(Math.random() * n) | 0]
      // a soft species' skeleton is hidden: nothing grafts onto it (it would root in empty space)
      if (p.dying || p.isText || p.level > 0 || p.sp.soft || p.segs.length < 2 || p.segs[0].growth < 1) continue
      const aff = 1 - h + h * CONSONANCE[interval(pitch, p.pitch)]
      const recent = 0.35 + 0.65 * Math.exp(-(t - p.birth) / 10)
      const d = near ? p.root.distanceTo(near) / (reach * 2) : 0
      const s = aff * recent * Math.exp(-d * d) * (0.75 + 0.5 * Math.random())
      if (s > bestS) {
        bestS = s
        best = p
      }
    }
    if (!best) return null
    const a = CONSONANCE[interval(pitch, best.pitch)]
    if (Math.random() < h * (1 - a) * (1 - a)) return null
    let seg: Seg | null = null
    let segD = Infinity
    for (let i = 0; i < 12; i++) {
      const s = best.segs[(Math.random() * best.segs.length) | 0]
      if (s.growth < 1) continue
      const d = near ? s.b.distanceToSquared(near) : i
      if (d < segD) {
        segD = d
        seg = s
      }
    }
    return seg && near && segD > reach * reach ? null : seg
  }

  // ------------------------------------------------------------ velocity → weight

  /** Radius factor: 1 at a computer key's 0.75, thicker above, thinner below (on top of the engine's own). */
  heft(velocity: number) {
    return Math.min(1.2, Math.max(0.4, 1 + 0.4 * this.vel * (velocity - 0.75)))
  }

  /** Colour: a soft note dims, a strong one runs a little hot (toward white); 0.75 unchanged. */
  shine(c: THREE.Color, velocity: number, white: THREE.Color) {
    const d = velocity - 0.75
    if (d < 0) c.multiplyScalar(Math.max(0.35, 1 + 0.9 * this.vel * d))
    else c.lerp(white, Math.min(0.3, 0.45 * this.vel * d))
  }
}
