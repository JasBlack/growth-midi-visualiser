// Music breath: every strand and shape reaches out with the music and draws back toward its roots
// when it goes quiet, in every look and camera mode. One envelope follows the music (energy, onsets
// and the notes struck: fast in, slow out); the contraction is breath × (1 − envelope). The growth
// shader (shaders.ts reactify) turns it into a reach along the branches: segments beyond it collapse
// onto their start, so a branch withdraws toward its root and reaches out again on the next phrase.
// A held key keeps its own growth out (the conduction table's per-pitch rows say which are held).
// Soft surfaces scale with the share of their skeleton inside the reach (organism/soft.ts), tip
// markers beyond it hide (organism/tips.ts). The CPU work is one envelope per frame and, for those
// two, one reach per plant: nothing per segment.

import { ctl } from '../../engine'
import type { MusicState } from '../../music'
import { BREATH_HOLD_ATTACK, BREATH_HOLD_RELEASE, breathReach, condRows, uBreath } from '../../shaders'
import type { FeatureControl, OrganismFeature, OrganismHost } from './feature'
import type { Plant } from './types'

/** the envelope's time constants (s): in on the attack, out over the release */
export const BREATH_ATTACK = 0.08
export const BREATH_RELEASE = 0.6
/** a single key at moderate velocity reaches most of the way out; a struck note lifts it at once */
const ENERGY_GAIN = 1.6
const ONSET_GAIN = 0.5
const NOTE_GAIN = 0.35

/** What the envelope heads for: 0 in silence … 1 when the music is full. */
export function breathTarget(energy: number, onset: number, struck: number) {
  return Math.min(1, Math.max(0, ENERGY_GAIN * energy + ONSET_GAIN * onset + NOTE_GAIN * struck))
}

/** One step of the envelope toward `target` (frame-rate independent). */
export function breathEase(env: number, target: number, dt: number) {
  const tau = target > env ? BREATH_ATTACK : BREATH_RELEASE
  return env + (target - env) * (1 - Math.exp(-Math.max(0, dt) / tau))
}

/**
 * How firmly a held key keeps its growth out, from its conduction row (x: last launch, w: note-off,
 * far ahead while held; both on the shaders' clock): the shader's formula.
 */
export function holdStrength(launch: number, off: number, now: number) {
  const attack = Math.min(1, Math.max(0, (now - launch) / BREATH_HOLD_ATTACK))
  return Math.min(attack, Math.exp(-Math.max(0, now - off) / BREATH_HOLD_RELEASE))
}

/** The share 0..1 of a skeleton reaching `extent` arc units from its root that lies within `reach`. */
export const breathShareOf = (reach: number, extent: number) => (extent <= 1e-6 ? 1 : Math.min(1, Math.max(0, reach / extent)))

export interface BreathHooks {
  /** the engine clock's zero: the shaders' times are stored relative to it */
  epoch(): number
}

export class Breath implements OrganismFeature {
  readonly id = 'breath'
  readonly controls: FeatureControl[] = [
    {
      key: 'breath',
      label: 'music breath: strands and shapes reach out with the music and draw back toward their roots when it goes quiet (held notes stay out; 0 = off)',
      min: 0,
      max: 1,
      step: 0.05,
      value: 0.55,
      group: 'Notes',
    },
  ]
  /** the music envelope, 0 quiet … 1 full */
  env = 0
  /** breath × (1 − env), × the reaction master: what the shader reads */
  contract = 0
  private host: OrganismHost | null = null
  private now = 0

  constructor(private readonly hooks: BreathHooks) {}

  mount(e: OrganismHost) {
    this.host = e
  }

  unmount() {
    uBreath.value = this.contract = 0
    this.host = null
  }

  clear() {
    this.env = 0
  }

  beforeFrame(m: MusicState, _g: unknown, dt: number, t: number) {
    const c = this.host?.controls
    if (!c) return
    this.now = t - this.hooks.epoch()
    let struck = 0
    for (const ev of m.events) if (ev.kind === 'on' && !ev.regrow) struck = Math.max(struck, 0.5 + 0.5 * ev.velocity)
    // the beat tracker and the onset tail keep going a moment after the music: only trust them while something sounds
    const sounding = m.energy > 0.03 || m.active.size > 0
    this.env = breathEase(this.env, breathTarget(m.energy, sounding ? m.onset : 0, struck), Math.min(0.1, dt))
    const amt = Math.min(1, ctl(c, 'breath') * ctl(c, 'react'))
    this.contract = uBreath.value = Math.max(0, amt) * (1 - this.env)
  }

  /**
   * How far `p` reaches now, in arc units from its own root (Infinity: all of it is out). The
   * shader's reach, less how far along its host the plant was grafted.
   */
  reach(p: Plant): number {
    if (this.contract <= 0 || p.isText || p.refAuto) return Infinity
    const row = condRows[p.pitch & 127]
    const hold = p.ambient ? 0 : holdStrength(row.x, row.w, this.now)
    const c = this.contract * (1 - hold)
    return c <= 1e-3 ? Infinity : breathReach(c) - (p.arcBase ?? 0)
  }
}
