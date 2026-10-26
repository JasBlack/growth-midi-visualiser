// Song response (k1 Idea 8): the energy arcs (arcs.ts) give the scene a little dramaturgy.
//   - A build-up (tension): growing tips quicken, fresh growth gathers light and old growth dims.
//   - A drop: every growing plant bursts into side shoots with a flare at its tip, a wave of light
//     runs through all the branches, the whole organism flashes (and bloom kicks when it is on).
//   - A breakdown: growth slows, old growth dims further and the organism glows in slow breaths,
//     two bars (or four seconds) each.
// One control scales all of it, and it only reuses what exists (the engine's side-shoot burst,
// ignition flares, conduction waves, the flash / highlight uniforms): no new draws, O(plants) on a
// drop, O(1) otherwise.

import * as THREE from 'three'
import { ctl } from '../../engine'
import type { MusicState } from '../../music'
import type { FeatureControl, OrganismFeature, OrganismHost } from './feature'
import type { Ignition } from './ignition'
import type { Conduction } from './conduction'
import type { Plant } from './types'

/** side shoots a drop may start in total (on top of each species' own tip limit) */
const MAX_SHOOTS = 60

export interface SongHooks {
  /** side shoots from a growing plant's finished joints (the wild burst), even past its tip limit; returns how many started */
  sprout(p: Plant, n: number): number
}

export class SongResponse implements OrganismFeature {
  readonly id = 'song'
  readonly controls: FeatureControl[] = [
    { key: 'songResponse', label: 'song response: builds quicken the tips, drops burst and flash, breakdowns slow and breathe (0 = off)', min: 0, max: 2, step: 0.05, value: 0.5, group: 'Notes' },
  ]
  /** this frame, for the engine: growth-speed factor, and what adds to the highlight, the flash and the bloom */
  rate = 1
  focus = 0
  flash = 0
  bloom = 0
  /** where the song is, for the HUD: build, drop, breakdown or nothing */
  mood = ''
  private host: OrganismHost | null = null
  private drops = 0
  private breath = 0
  private readonly at = new THREE.Vector3()

  constructor(
    private readonly hooks: SongHooks,
    private readonly ignition: Ignition,
    private readonly conduction: Conduction,
  ) {}

  mount(e: OrganismHost) {
    this.host = e
  }

  unmount() {
    this.host = null
  }

  beforeFrame(m: MusicState, _g: unknown, dt: number, t: number) {
    const c = this.host?.controls
    if (!c) return
    const amt = ctl(c, 'songResponse') * ctl(c, 'react')
    const a = m.arc
    const fresh = a.drops !== this.drops
    this.drops = a.drops
    this.mood = a.drop > 0.3 ? 'drop' : a.breakdown > 0.5 ? 'breakdown' : a.tension > 0.35 ? `build ${Math.round(a.tension * 100)}%` : ''
    if (amt <= 0) {
      this.rate = 1
      this.focus = this.flash = this.bloom = 0
      return
    }
    this.rate = Math.max(0.3, 1 + amt * (0.6 * a.tension - 0.5 * a.breakdown))
    this.focus = amt * (0.4 * a.tension + 0.3 * a.breakdown)
    // a breath: a slow swell and fade of the organism's own glow, two bars long when there is a tempo
    const period = m.beat.bpm > 0 ? (8 * 60) / m.beat.bpm : 4
    this.breath = (this.breath + dt / period) % 1
    const breathe = a.breakdown * (0.5 - 0.5 * Math.cos(this.breath * Math.PI * 2))
    this.flash = amt * (1.8 * a.drop + 0.6 * breathe)
    this.bloom = amt * (1.5 * a.drop + 0.3 * a.tension)
    // a drop seen late (switched on afterwards) is only consumed
    if (fresh && a.drop > 0.3) this.burst(t, a.drop, amt)
  }

  /** The drop: side shoots and a flare on every growing plant, and a wave of light through everything. */
  private burst(t: number, s: number, amt: number) {
    const plants = this.host?.plants ?? []
    const n = Math.round(1 + 4 * s * Math.min(1.5, amt))
    let left = MAX_SHOOTS
    for (let i = plants.length - 1; i >= 0 && left > 0; i--) {
      const p = plants[i]
      if (!(p.held || p.autoUntil > t) || p.segs.length < 2) continue
      left -= this.hooks.sprout(p, Math.min(n, left))
      const tip = p.tips[p.tips.length - 1]
      const pos = tip?.seg ? this.at.copy(tip.seg.a).lerp(tip.seg.b, Math.min(1, tip.seg.growth)) : (tip?.pos ?? p.root)
      this.ignition.accent(p, pos, t, s)
    }
    this.conduction.surge(t, Math.min(1, 0.5 + 0.5 * s * Math.min(1, amt * 2)))
  }
}
