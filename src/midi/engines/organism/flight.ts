// The flight (camera mode flight, with any look): what grows where while the camera flies on for
// ever (the path itself is organism/camera.ts). The look stays the look: its species, materials
// and world; the haze, threads, ribbons and debris are the Webs look's own choices.
//   - Played notes (and audio onsets) grow in a tube AHEAD of the camera, inside the frame: pitch
//     is an angle round the axis (low notes lower left, over the top, high notes lower right),
//     loud notes land nearer, with an organic jitter. A held note whose tips fell behind sends a
//     new shoot from the tube ahead (the engine asks `place`). Growth retracts on release like
//     anywhere else (unless it lignified).
//   - The ambient web (opt-in, Webs): threads appear at the far end of the tube while the music
//     sounds, per distance flown and with the energy; never in silence, when it draws back.
//   - Ribbons (opt-in, Webs): an accented note (loud for this player, or a strong onset) sweeps a
//     chrome ribbon across the path; about a third start close enough to pass by the lens.
//   - Recycling: growth the camera has passed is culled out of view, and what a turn left far off
//     to the side once it has melted into the haze, so the world is endless and the segment budget
//     never fills with what nobody can see.
// The threads species lives here too: long, very thin strands steered by a smooth divergence-free
// flow (curl-like), rarely branching, ink on a light world.

import * as THREE from 'three'
import type { GlobalParams } from '../../engine'
import { ctl } from '../../engine'
import type { MusicState } from '../../music'
import { CAM, type CameraRig } from './camera'
import type { FeatureControl, OrganismFeature, OrganismHost } from './feature'
import { CHROME_SPECIES } from './soft'
import type { Plant, Seg, Species } from './types'

const G = 'Flight'
/** how far ahead the web reaches (world units): the ambient web appears here, the haze hides it until then */
export const FLIGHT_FAR = 26
/** FogExp2 density: with the haze's gain, ~75% of a strand 10 units ahead survives, ~15% at the far end */
export const FLIGHT_FOG = 1.05 / FLIGHT_FAR
/** the ambient web's radius round the axis, and where a strand is drawn back toward the axis */
const TUBE_R = 7
export const TUBE_PULL = 11
/** played notes: depth ahead (nearest for the loudest), share of the frame they may reach from its centre */
const NOTE_NEAR = 8
const NOTE_FAR = 17
/**
 * ...at this flight speed (world units / s); faster, they land up to NOTE_LEAD_MAX times further
 * ahead (inside the tube), so a note has about as long to grow into view before the camera reaches it
 */
const NOTE_PACE = 4.5
const NOTE_LEAD_MAX = 1.45
/** culled once this far behind the camera along its heading (and behind the drawn view), or this far away at all */
const BEHIND = 2.5
const CULL_FAR = FLIGHT_FAR * 2.2
/** a ribbon's surface reaches up to ~16 units from its root: its skeleton goes only once the root is this far behind */
const RIBBON_BEHIND = 18
/**
 * ambient web: strands per unit flown, and per second in place (at fill 1); at most this many alive.
 * W3 raised W2's rate about 3x against the reference, which is several times denser, with a tangled core.
 */
const FILL_PER_UNIT = 12
const FILL_PER_S = 6
const FILL_MAX = 600
/**
 * ...and at most this share of the segment budget (passed growth is culled, so played notes still
 * find room), times the quality tier's load: segments are what a slow machine pays for
 */
const FILL_BUDGET = 0.55
/** strands started per frame at most; a fresh flight first fills the tube this deep in one go (at fill 1) */
const FILL_PER_FRAME = 6
const PREFILL = 150
/** an ambient strand grows for this long (s, plus up to the second figure): its length, with no cap on new segments */
const STRAND_S = [0.6, 0.8] as const
/** ribbons: spawn tokens per second and burst, live ribbons at most (both at amount 1) */
const RIBBON_PER_S = 1.2
const RIBBON_BURST = 3
const RIBBON_MAX = 12
const CULL_EVERY = 4

/**
 * Threads (species 37, opt-in): long, very thin strands curving through 3D like hair or wire,
 * rarely branching; thickness varies a lot from strand to strand; ink on a light world.
 */
export const THREADS: Species = {
  name: 'threads',
  icon: '🕸️',
  hue: 0.6,
  // short segments, gently turned: a strand near the lens is a smooth curve, not a polyline (W2's
  // 0.16 / 0.4 kinked visibly up close); taper, branching and depth keep their rates per length
  segLen: 0.12,
  thickness: 0.16,
  taper: 0.999,
  branchTaper: 0.8,
  wiggle: 0.45,
  branch: 0.016,
  branchAngle: [0.3, 0.9],
  turn: 'curl',
  turnAngle: 0.22,
  node: 'none',
  nodeScale: 0,
  gravity: 0,
  radial: 0,
  maxTips: 4,
  maxDepth: 200,
  speed: 1.7,
  glow: 0, // no tip markers: a strand ends in a hair, not a bead
  brighten: 0,
  join: 0, // never fuse: and the endpoint search per new segment is skipped
  avoid: 0,
  initTips: 2,
  optIn: true,
  ink: true,
  thickVary: 0.65,
  seamless: true,
}

/**
 * Ink (linear): mostly near black and charcoal, some pewter, a little dusty pink and steel blue, as
 * in the reference's web. On the haze the lighter ones turn metal (shaders.ts wireOnLight).
 */
const INKS: [number, number, number, number][] = [
  [0.014, 0.012, 0.016, 0.38],
  [0.045, 0.042, 0.048, 0.2],
  [0.2, 0.2, 0.215, 0.16],
  [0.3, 0.15, 0.17, 0.14],
  [0.11, 0.135, 0.2, 0.12],
]

/** An ink colour for a new strand on a light world (rand in 0..1), written into `out`. */
export function inkTint(rand: number, out: THREE.Color) {
  let r = rand
  for (const [cr, cg, cb, w] of INKS) {
    if (r < w) return out.setRGB(cr, cg, cb)
    r -= w
  }
  return out.setRGB(INKS[0][0], INKS[0][1], INKS[0][2])
}

/** A strand's thickness factor: lognormal-ish round 1, `vary` wide (r1, r2 in 0..1). */
export const thickFactor = (vary: number, r1: number, r2: number) => Math.exp((r1 + r2 - 1) * 1.6 * vary)

/**
 * Where a played note lands, in the view's frame: `x` right and `y` up in units of the frame's half
 * height at depth `d` ahead. Pitch (0 low … 1 high) is the angle round the axis, from lower left over
 * the top to lower right; the loudest notes land nearest. r1-r3: random 0..1 (the jitter).
 */
export function tubeSpot(pitchN: number, velocity: number, aspect: number, r1: number, r2: number, r3: number) {
  const p = Math.min(1, Math.max(0, pitchN))
  const a = Math.PI * (1.25 - 1.5 * p) + (r1 - 0.5) * 0.6
  // some land near the axis: the flight passes through their branches, not only beside them
  const rho = 0.15 + 0.6 * r2
  const v = Math.min(1, Math.max(0, velocity))
  return {
    x: Math.cos(a) * rho * Math.min(aspect, 1.8) * 0.85,
    y: Math.sin(a) * rho * 0.85,
    d: NOTE_FAR - (NOTE_FAR - NOTE_NEAR) * v + (r3 - 0.5) * 5,
  }
}

/**
 * How much the music sounds for the ambient web, 0 … 1: nothing below a whisper of energy with no
 * key down (the web grows from the music, never in silence), full with a few notes or real energy.
 */
export function musicLevel(energy: number, active: number) {
  if (energy <= 0.03 && active === 0) return 0
  return Math.min(1, energy * 2 + 0.35 * active)
}

/** ABC flow (Arnold–Beltrami–Childress): smooth, divergence-free, its streamlines curl and tangle. */
export function abcFlow(x: number, y: number, z: number, out: THREE.Vector3) {
  return out.set(Math.sin(z) + 0.6 * Math.cos(y), 0.8 * Math.sin(x) + Math.cos(z), 0.6 * Math.sin(y) + 0.8 * Math.cos(x))
}

export interface FlightHooks {
  readonly cam: CameraRig
  /** a growth no key holds, rooted at `root`, its first shoots along `dir`, growing for `seconds` */
  grow(o: { pitch: number; velocity: number; root: THREE.Vector3; dir: THREE.Vector3; sp: Species; seconds: number; ambient: boolean }, g: GlobalParams, t: number): Plant
  /** remove a segment now (the camera has passed it) */
  cull(seg: Seg): void
  budget(): number
}

export class Flight implements OrganismFeature {
  readonly id = 'flight'
  readonly controls: FeatureControl[] = [
    { key: 'flightWander', label: 'flight: how much the path wanders and turns', min: 0, max: 2, step: 0.05, value: 1, group: G },
    { key: 'flightRoll', label: 'flight: bank into the turns', min: 0, max: 2, step: 0.05, value: 1, group: G },
    { key: 'flightReact', label: 'flight: speed follows the music (energy, tempo, hits; camera speed sets the pace)', min: 0, max: 1.5, step: 0.05, value: 0.8, group: G },
    { key: 'flightFill', label: 'flight: ambient web — threads appear ahead while the music sounds, drawing back in silence (0 = off)', min: 0, max: 2, step: 0.05, value: 0, group: G },
    { key: 'flightRibbons', label: 'flight: accented notes sweep chrome ribbons across the path (0 = off)', min: 0, max: 2, step: 0.05, value: 0, group: G },
  ]
  /** camera mode flight: notes grow in the tube ahead, the web fills in, passed growth is culled */
  on = false
  /** share of the optional scenery the quality tier keeps (organism/quality.ts) */
  load = 1
  /** what the ambient web and the ribbons grow as */
  private readonly threads: Species = THREADS
  private readonly ribbons: readonly Species[] = CHROME_SPECIES
  private fillAcc = 0
  /** strands still to place through the whole tube (-1: a fresh flight, counted on its first fill) */
  private prefill = -1
  private ribbonTokens = RIBBON_BURST
  private velEma = 0.6
  private tick = 0
  private aspect = 16 / 9
  private tanHalf = Math.tan((24 * Math.PI) / 180)
  private readonly right = new THREE.Vector3()
  private readonly up = new THREE.Vector3()
  private readonly v1 = new THREE.Vector3()
  private readonly v2 = new THREE.Vector3()
  private readonly root = new THREE.Vector3()
  private readonly dir = new THREE.Vector3()

  constructor(private readonly hooks: FlightHooks) {}

  clear() {
    this.fillAcc = 0
    this.prefill = -1
    this.ribbonTokens = RIBBON_BURST
  }

  /** the view's frame from the drawn camera (last frame's: good enough to place growth ahead) */
  private frame(e: OrganismHost) {
    const cam = e.camera
    this.aspect = cam.aspect
    this.tanHalf = Math.tan((cam.fov * Math.PI) / 360)
    this.right.setFromMatrixColumn(cam.matrixWorld, 0).normalize()
    this.up.setFromMatrixColumn(cam.matrixWorld, 1).normalize()
  }

  beforeFrame(m: MusicState, g: GlobalParams, dt: number, t: number, e: OrganismHost) {
    const was = this.on
    this.on = ctl(e.controls, 'camMode') === CAM.flight
    if (this.on && !was) this.prefill = -1
    if (!this.on) return
    this.frame(e)
    const c = e.controls
    const ribbons = ctl(c, 'flightRibbons')
    this.ribbonTokens = Math.min(RIBBON_BURST, this.ribbonTokens + RIBBON_PER_S * ribbons * Math.min(0.1, dt))
    for (const ev of m.events) {
      if (ev.kind !== 'on' || ev.regrow) continue
      // an accent is loud for this player: above their recent level, or plainly loud
      const v = ev.velocity
      const accent = v >= 0.85 || v >= Math.max(0.5, this.velEma + 0.1)
      this.velEma += (v - this.velEma) * 0.15
      if (!accent || ribbons <= 0 || this.ribbonTokens < 1) continue
      if (Math.random() > Math.min(1, ribbons * 0.75)) continue
      let live = 0
      for (const p of e.plants) if (p.sp.chrome) live++
      if (live >= RIBBON_MAX * ribbons) continue
      this.ribbonTokens--
      this.ribbon(ev.pitch, v, g, t)
    }
    this.fill(m, g, dt, t, e)
  }

  /** Every few frames: what the camera has passed goes, out of view (the haze has it by then). */
  afterGrowth(_m: MusicState, _g: GlobalParams, _dt: number, _t: number, e: OrganismHost) {
    if (!this.on || ++this.tick % CULL_EVERY !== 0) return
    const cam = this.hooks.cam
    const pos = cam.pos
    const h = cam.heading
    const f = cam.fwd
    const far2 = CULL_FAR * CULL_FAR
    const gone: Seg[] = []
    const d = this.v1
    for (const s of e.segs) {
      const p = s.plant
      if (p.sp.soft) {
        // a ribbon's surface stands on its root: all of it goes once the root is well behind
        d.subVectors(p.root, pos)
        if ((d.dot(h) < -RIBBON_BEHIND && d.dot(f) < 0) || d.lengthSq() > far2) gone.push(s)
        continue
      }
      d.subVectors(s.a, pos)
      const behind = d.dot(h) < -BEHIND && d.dot(f) < -1
      if (behind || d.lengthSq() > far2) {
        d.subVectors(s.b, pos)
        if ((d.dot(h) < -BEHIND && d.dot(f) < -1) || d.lengthSq() > far2) gone.push(s)
      }
    }
    for (const s of gone) this.hooks.cull(s)
  }

  /**
   * A played note in flight: its root in the tube ahead (pitch → angle round the axis, loud nearer)
   * and its first shoot's direction: round the axis, a little toward it and toward the camera, so
   * strands cross the path instead of running along it.
   */
  place(pitch: number, velocity: number, root: THREE.Vector3, dir: THREE.Vector3) {
    const cam = this.hooks.cam
    const s = tubeSpot((pitch - 24) / 72, velocity, this.aspect, Math.random(), Math.random(), Math.random())
    const d = Math.min(FLIGHT_FAR * 0.95, s.d * Math.min(NOTE_LEAD_MAX, Math.max(1, cam.flySpeed / NOTE_PACE)))
    const k = d * this.tanHalf
    root.copy(cam.pos).addScaledVector(cam.fwd, d).addScaledVector(this.right, s.x * k).addScaledVector(this.up, s.y * k)
    this.across(root, dir, Math.random() < 0.5 ? 1 : -1, 0.5, 0.3)
  }

  /**
   * The lateral offset of `p` from the flight's axis (the camera's line of travel), into `out`: the
   * engine's radial drift and tube bound use it instead of the offset from a centre point.
   */
  lateral(p: THREE.Vector3, out: THREE.Vector3) {
    const cam = this.hooks.cam
    out.subVectors(p, cam.pos)
    return out.addScaledVector(cam.heading, -out.dot(cam.heading))
  }

  /** A direction round the axis at `root` (side ±1), leaning `inward` toward the axis and `back` toward the camera. */
  private across(root: THREE.Vector3, dir: THREE.Vector3, side: number, inward: number, back: number) {
    const h = this.hooks.cam.heading
    const rad = this.lateral(root, this.v2)
    if (rad.lengthSq() < 1e-6) rad.copy(this.right)
    rad.normalize()
    dir.crossVectors(h, rad).multiplyScalar(side).addScaledVector(rad, -inward).addScaledVector(h, -back)
    dir.x += (Math.random() - 0.5) * 0.6
    dir.y += (Math.random() - 0.5) * 0.6
    dir.z += (Math.random() - 0.5) * 0.6
    return dir.normalize()
  }

  /** A chrome ribbon sweeping across the path; a third start near the lens and pass close by. */
  private ribbon(pitch: number, velocity: number, g: GlobalParams, t: number) {
    const cam = this.hooks.cam
    const close = Math.random() < 0.35
    const d = close ? 2.5 + Math.random() * 2.5 : 6 + Math.random() * 8
    const a = Math.PI * (1.25 - 1.5 * Math.min(1, Math.max(0, (pitch - 24) / 72))) + (Math.random() - 0.5) * 0.8
    const rho = close ? 0.5 + Math.random() : 1.5 + Math.random() * 2.5
    const root = this.root.copy(cam.pos).addScaledVector(cam.fwd, d)
    root.addScaledVector(this.right, Math.cos(a) * rho).addScaledVector(this.up, Math.sin(a) * rho)
    const dir = this.across(root, this.dir, Math.random() < 0.5 ? 1 : -1, 0.9, 0.35)
    const sp = this.ribbons[Math.random() < 0.7 ? 0 : this.ribbons.length - 1]
    this.hooks.grow({ pitch, velocity, root, dir, sp, seconds: 0.8 + 1.1 * velocity, ambient: false }, g, t)
  }

  /**
   * The ambient web: threads at the far end of the tube while the music sounds, per distance flown
   * and with the energy; none in silence. The first music of a fresh flight (or a cleared one)
   * fills the whole tube.
   */
  private fill(m: MusicState, g: GlobalParams, dt: number, t: number, e: OrganismHost) {
    const amt = ctl(e.controls, 'flightFill') * this.load
    const level = musicLevel(m.energy, m.active.size)
    if (amt <= 0 || level <= 0) {
      this.fillAcc = 0
      // silence: strands still growing stop here (the engine releases them, and they draw back)
      if (level <= 0) for (const p of e.plants) if (p.ambient && p.autoUntil > t) p.autoUntil = t
      return
    }
    if (this.prefill < 0) this.prefill = Math.round(PREFILL * amt)
    const cam = this.hooks.cam
    this.fillAcc += amt * level * (FILL_PER_UNIT * cam.flySpeed + FILL_PER_S) * Math.min(0.1, dt)
    if (this.fillAcc < 1 && !this.prefill) return
    let alive = 0
    let segs = 0
    for (const p of e.plants) {
      if (!p.ambient) continue
      alive++
      segs += p.segs.length
    }
    for (let k = 0; k < FILL_PER_FRAME && (this.fillAcc >= 1 || this.prefill > 0); k++) {
      const early = this.prefill > 0
      if (early) this.prefill--
      else this.fillAcc--
      if (alive >= FILL_MAX * amt || segs >= this.hooks.budget() * FILL_BUDGET * this.load) {
        this.fillAcc = Math.min(this.fillAcc, 1)
        this.prefill = 0
        return
      }
      alive++
      const d = early ? 3 + (FLIGHT_FAR - 3) * Math.random() : FLIGHT_FAR * (0.7 + 0.3 * Math.random())
      const a = Math.random() * Math.PI * 2
      // denser toward the axis: the far centre of the tunnel reads as a tangle
      const r = TUBE_R * Math.random()
      const root = this.root.copy(cam.pos).addScaledVector(cam.heading, d)
      root.addScaledVector(this.right, Math.cos(a) * r).addScaledVector(this.up, Math.sin(a) * r)
      const dir = this.across(root, this.dir, Math.random() < 0.5 ? 1 : -1, 0.2 * Math.random(), 0.2 * Math.random())
      this.hooks.grow({ pitch: 36 + ((Math.random() * 60) | 0), velocity: 0.25 + 0.4 * Math.random(), root, dir, sp: this.threads, seconds: STRAND_S[0] + STRAND_S[1] * Math.random(), ambient: true }, g, t)
    }
  }
}
