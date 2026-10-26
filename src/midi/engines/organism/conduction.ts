// Conduction and age grading (k1 Ideas 1 and 17): the music runs THROUGH the structure instead of
// only adding to it.
//   - Each note-on sends a pulse of light from the roots to the tips of the growth that pitch has
//     made (the plant it just started and every earlier one), in the growth's own colour, with a
//     slight swell riding its front; a chord is several independent pulses. Other octaves of the
//     same pitch class answer faintly. A held note's growth keeps a slow shimmer running outward
//     and lets it go with the note's release.
//   - Optionally every beat (or every onset) sends a faint wave through everything, stronger
//     through the notes that are sounding.
//   - New growth runs hot; older growth cools toward a desaturated bark tone at the pace of the
//     fresh trail, and a passing pulse brings its colour back.
// All of it runs in the growth shaders (shaders.ts reactify) from per-segment data written once
// when a segment is filed (organism.ts writeColor: birth, arc from the root, length, note) and a
// 141-row table written here only when a note or beat arrives. No per-frame work per segment.

import { ctl } from '../../engine'
import type { MusicState } from '../../music'
import { pitchClass } from '../../music'
import { COND_BEAT, COND_PC, condGroup, condRows, uCondGain, uCondLife, uCondRelease, uCondSpeed, uGrade } from '../../shaders'
import { ENVELOPES, attackStrength } from './ignition'
import type { FeatureControl, OrganismFeature, OrganismHost } from './feature'
import type { Plant } from './types'

const G = 'Notes'
/** "long ago" on the table's clock: every pulse from it has faded */
const FAR = -1e4
/** a release time while the note is still held */
const HELD = 1e6
/** a pitch struck again sooner than this feeds the pulse in flight instead of restarting it */
const REFIRE = 0.12
/** a pulse fades after running about this far along a branch, whatever its speed (arc units) */
const REACH = 12
/** and lives between these (s) */
const LIFE_MIN = 0.6
const LIFE_MAX = 4
/** onsets closer than this are one wave */
const ONSET_GAP = 0.09

/**
 * The note a plant's segments answer to (shaders.ts SEG_DATA.w): its pitch; -2 for the flight's
 * ambient web (no note, but it breathes with the music); -1 for typography and Build shape growth.
 */
export const noteCode = (p: Plant) => (p.isText || p.refAuto ? -1 : p.ambient ? -2 : p.pitch)

export interface ConductionHooks {
  /** the engine clock's zero: the shaders' times are stored relative to it */
  epoch(): number
}

export class Conduction implements OrganismFeature {
  readonly id = 'conduction'
  readonly controls: FeatureControl[] = [
    { key: 'conduct', label: 'conduction: each note sends light from its roots to its tips (0 = off)', min: 0, max: 2, step: 0.05, value: 1, group: G },
    { key: 'conductSpeed', label: 'conduction: pulse speed along the branches', min: 1, max: 20, step: 0.5, value: 7, group: G },
    { key: 'conductBeat', label: 'conduction: the music pulses through everything too', min: 0, max: 2, step: 1, value: 1, options: ['off', 'on the beat', 'on every onset'], group: G },
    { key: 'ageGrade', label: 'age grading: new growth hot, old growth cools to bark (pace = fresh trail)', min: 0, max: 1, step: 0.05, value: 0.6, group: G },
  ]
  private host: OrganismHost | null = null
  private dirty = false
  private lastBeat = -1
  private prevOnset = 0
  private lastWave = FAR

  constructor(private readonly hooks: ConductionHooks) {}

  mount(e: OrganismHost) {
    this.host = e
    this.clear()
  }

  unmount() {
    uCondGain.value = 0
    uGrade.value = 0
    this.host = null
  }

  clear() {
    for (const r of condRows) r.set(FAR, FAR, 0, FAR)
    this.lastWave = FAR
    this.dirty = true
  }

  beforeFrame(m: MusicState, _g: unknown, _dt: number, t: number) {
    const c = this.host?.controls
    if (!c) return
    const now = t - this.hooks.epoch()
    uCondGain.value = ctl(c, 'conduct') * ctl(c, 'react')
    const speed = Math.max(0.5, ctl(c, 'conductSpeed'))
    uCondSpeed.value = speed
    uCondLife.value = 1 / Math.min(LIFE_MAX, Math.max(LIFE_MIN, REACH / speed))
    uGrade.value = ctl(c, 'ageGrade')
    // the shimmer lets go with the growth envelope's release (organism/ignition.ts)
    uCondRelease.value = 1 / Math.max(0.2, (ENVELOPES[Math.round(ctl(c, 'envelope'))] ?? ENVELOPES[2]).r)

    for (const ev of m.events) {
      const row = condRows[ev.pitch & 127]
      if (ev.kind === 'on') {
        row.w = HELD
        // a Reset re-send (regrow) holds the note again but is not a new attack
        if (!ev.regrow) {
          const s = 0.35 + 0.65 * attackStrength(ev)
          if (now - row.x < REFIRE) row.z = Math.max(row.z, s)
          else {
            // the previous pulse keeps running: fast repeats show as a train, not a restart
            row.y = row.x
            row.x = now
            row.z = s
          }
          condRows[COND_PC + pitchClass(ev.pitch)].set(now, s, 0, 0)
        }
      } else if (!m.active.has(ev.pitch)) row.w = now // another source may still hold the pitch
      this.dirty = true
    }

    const mode = ctl(c, 'conductBeat')
    // the beat tracker keeps predicting after the music stops: only trust it while something sounds
    const sounding = m.energy > 0.03 || m.active.size > 0
    if (mode === 1 && m.beat.bpm > 0 && m.beat.beat !== this.lastBeat) {
      this.lastBeat = m.beat.beat
      if (sounding) this.wave(now, m.beat.barHit > 0.9 ? 1 : 0.65)
    } else if (mode === 2 && m.onset > 0.45 && m.onset - this.prevOnset > 0.25 && now - this.lastWave > ONSET_GAP) this.wave(now, 0.4 + 0.6 * m.onset)
    this.prevOnset = m.onset

    if (this.dirty) {
      condGroup.needsUpdate = true // the table uploads once, on the next draw
      this.dirty = false
    }
  }

  /** A wave through everything at `t` (engine clock), strength s (song response: a drop). */
  surge(t: number, s: number) {
    this.wave(t - this.hooks.epoch(), s)
  }

  private wave(now: number, s: number) {
    // two waves in one moment (a drop on the beat) are one: the stronger
    if (now - this.lastWave < ONSET_GAP) s = Math.max(s, condRows[COND_BEAT].y)
    condRows[COND_BEAT].set(now, s, 0, 0)
    this.lastWave = now
    this.dirty = true
  }
}
