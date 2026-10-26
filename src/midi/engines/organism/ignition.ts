// Note-on ignition (k1 Idea 2): a played note is an event you see in the frame it arrives, not
// only as new geometry a few frames later.
//   - A flare where the growth starts: soft and additive, its size and heat from the velocity,
//     its hue nudged by the pitch around the plant's own palette colour. A faint ember stays at
//     the root while the note sounds and fades with its release.
//   - A thin shock ring spreading from the root, in the growth's plane (planar species) or across
//     its first shoot.
//   - An attack lunge: the note's first segments grow several times faster, then settle.
// A growth envelope per note (attack / decay / sustain / release presets) shapes how fast it grows
// after that; its tip markers pulse with its own attack and shrink with its release. Note-off also
// leaves a small glint where the tips were (k1 Idea 10's articulation mark, the light version).
// Audio onsets ignite too, scaled by their strength, without the ember and the note-off marks.
//
// Two pooled instanced quads, additive (HDR: the WebGPU renderer tone-maps the whole frame, so
// cores roll off rather than clip, and they clear the bloom threshold): no allocation per note, at
// most MAX_FLARES + MAX_RINGS instances, spawns rate-limited and merged when close so dense audio
// onsets cannot fill the screen. On a light world (the haze, organism/haze.ts) the same quads lay
// ink in the note's colour instead of adding light, and melt into the haze with distance.

import * as THREE from 'three'
import { MeshBasicNodeMaterial } from 'three/webgpu'
import { attribute, uv, dot, exp, max, mix, pow, clamp, smoothstep, float, vec3, vec4, mx_noise_float, diffuseColor } from 'three/tsl'
import { ctl } from '../../engine'
import { hazeClear, uLight } from '../../shaders'
import type { MusicState, NoteEvent } from '../../music'
import { octave, pitchClass } from '../../music'
import type { FeatureControl, OrganismFeature, OrganismHost } from './feature'
import type { Plant, Tip } from './types'

const MAX_FLARES = 96
const MAX_RINGS = 32
/** spawn budget: at most this many new flares a second on average, in bursts of up to TOKENS_MAX */
const TOKENS_PER_S = 24
const TOKENS_MAX = 12
/** rings are the accent mark: sparser still */
const RING_TOKENS_PER_S = 10
const RING_TOKENS_MAX = 5
/** segments of each first shoot that lunge (the push eases out over them) */
const LUNGE_SEGS = 4
/** a note's first segments skip the segment-credit queue: tips this shallow, this young */
const FREE_DEPTH = 2
const FREE_AGE = 0.5
const RING_LIFE = 0.55
const DATA = 'igData'
/** on a light world: ink coverage per unit of light, and how deep the colour goes (1 = as bright as the note's) */
const INK_GAIN = 1.8
const INK_DEPTH = 0.16
const Z_AXIS = new THREE.Vector3(0, 0, 1)
const G = 'Notes'

interface GrowthEnvelope {
  name: string
  /** attack: seconds to the peak (0 = at once), rising from `from` × sustain */
  a: number
  from: number
  peak: number
  /** decay time constant from the peak to the sustain level (s) */
  d: number
  s: number
  /** release time constant after note-off (s) */
  r: number
  /** flare burst decay (s) */
  tau: number
  /** v0.20's growth speed (the engine keeps its energy term) */
  flat?: boolean
}

/** Growth-speed multipliers over a note's life. Indices are stored by looks and presets: append only. */
export const ENVELOPES: readonly GrowthEnvelope[] = [
  { name: 'flat — steady growth (v0.20)', a: 0, from: 1, peak: 1, d: 1, s: 1, r: 0.6, tau: 0.22, flat: true },
  { name: 'pluck — burst, short creep, stops soon after release', a: 0, from: 1, peak: 2.4, d: 0.16, s: 0.6, r: 0.4, tau: 0.16 },
  { name: 'strike — burst, steady hold, eases out on release', a: 0, from: 1, peak: 1.9, d: 0.3, s: 0.85, r: 0.8, tau: 0.24 },
  { name: 'swell — builds while held (pads, strings)', a: 0.6, from: 0.35, peak: 1.5, d: 0.8, s: 1.1, r: 1.2, tau: 0.42 },
  { name: 'pad — slow bloom, long fade', a: 1.2, from: 0.3, peak: 1.3, d: 1.5, s: 1, r: 2.2, tau: 0.65 },
]

interface Flare {
  live: boolean
  readonly pos: THREE.Vector3
  readonly color: THREE.Color
  t0: number
  /** quad size per unit of camera distance: an event reads the same close up or zoomed out */
  size: number
  /**
   * Drawn up to this far toward the camera (a depth bias, same size on screen): the light bleeds
   * through the branches right around its root instead of being swallowed by them.
   */
  lift: number
  /** burst peak (HDR) and decay */
  heat: number
  tau: number
  /** held while its plant's note sounds, then released with it */
  ember: number
  plant: Plant | null
  seed: number
  /** this frame: intensity, and how far the burst has opened (0..1, the shader's) */
  now: number
  open: number
}

interface Ring {
  live: boolean
  readonly pos: THREE.Vector3
  readonly q: THREE.Quaternion
  readonly color: THREE.Color
  t0: number
  /** full-grown quad size per unit of camera distance */
  size: number
  heat: number
  seed: number
  now: number
  prog: number
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x))

/** A note-on's strength 0..1: its velocity, or an audio onset's strength (pseudo-notes carry 0.35 + 0.65 × strength). */
export const isAudioNote = (ev: NoteEvent) => ev.source === 'audio' || ev.source === 'stem'
export const attackStrength = (ev: NoteEvent) => (isAudioNote(ev) ? clamp01((ev.velocity - 0.35) / 0.65) : clamp01(ev.velocity))

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type N = any

/** uv as -1..1 around the quad centre: offset, squared radius, radius, unit direction */
function polar() {
  const p: N = uv().sub(0.5).mul(2)
  const r2: N = dot(p, p)
  const r: N = r2.sqrt()
  return { r2, r, dir: p.div(max(r, 1e-4)) as N }
}

/**
 * `shape`: the light (HDR) at this pixel; `inkShape`: its coverage when it becomes ink. The instance
 * colour (colour × intensity) arrives in diffuseColor. Premultiplied "over" blending does both: alpha
 * 0 adds (black space, exactly the old additive glow), alpha a lays the event's own colour, deepened,
 * over a light world, where added light would only wash out (uLight, organism/haze.ts).
 */
function glowMaterial(shape: N, inkShape: N) {
  const m = new MeshBasicNodeMaterial()
  m.transparent = true
  m.depthWrite = false
  m.blending = THREE.CustomBlending
  m.blendSrc = m.blendSrcAlpha = THREE.OneFactor
  m.blendDst = m.blendDstAlpha = THREE.OneMinusSrcAlphaFactor
  m.toneMapped = false
  m.fog = false // an event far off must still read on black; in the haze it melts by hazeClear below
  m.side = THREE.DoubleSide
  const c: N = diffuseColor.rgb
  const fade: N = hazeClear()
  const glow = c.mul(shape).mul(fade).mul(float(1).sub(uLight))
  // intensity rides in the colour: its brightest channel; the hue is what is left
  const peak = max(c.r, max(c.g, c.b))
  const a = clamp(inkShape.mul(peak).mul(INK_GAIN), 0, 1).mul(fade).mul(uLight)
  const ink = c.div(max(peak, 1e-4)).mul(INK_DEPTH)
  m.outputNode = vec4(glow.add(ink.mul(a)), a)
  return m
}

/** Hot core, soft halo and a few irregular filaments: noise sampled round a circle (no seam, no n-fold star). */
function flareMaterial() {
  const d: N = attribute(DATA, 'vec2')
  const { r2, r, dir } = polar()
  const core = exp(r2.mul(-90)).mul(1.4)
  const halo = exp(r2.mul(-9)).mul(0.5)
  const n: N = mx_noise_float(vec3(dir.mul(2.3), d.y.mul(19).add(d.x.mul(0.6))))
  const fil = pow(clamp(n.mul(0.5).add(0.5), 0, 1), 5).mul(exp(r.mul(mix(-9, -3.2, d.x)))).mul(2.4)
  const edge = float(1).sub(smoothstep(0.75, 1, r))
  // as ink the halo is a faint stain and the filaments carry it: a blot with tendrils, not a disc
  return glowMaterial(core.add(halo).add(fil).mul(edge), core.mul(0.8).add(halo.mul(0.3)).add(fil.mul(0.8)).mul(edge))
}

/** A thin wobbling band that thins as it spreads, with a faint wake inside. */
function ringMaterial() {
  const d: N = attribute(DATA, 'vec2')
  const { r2, r, dir } = polar()
  const wob = mx_noise_float(vec3(dir.mul(1.7), d.y.mul(23))).mul(0.06)
  const x = r.sub(wob.add(0.8)).div(mix(0.06, 0.022, d.x))
  const band = exp(x.mul(x).mul(-1))
  const wake = exp(r2.mul(-3)).mul(0.1).mul(float(1).sub(d.x))
  const shape = band.add(wake).mul(float(1).sub(smoothstep(0.9, 1, r)))
  return glowMaterial(shape, shape)
}

export interface IgnitionHooks {
  /** an instanced mesh the way the engine allocates them (storage buffers on WebGPU) */
  instanced(geom: THREE.BufferGeometry, mat: THREE.Material, max: number): THREE.InstancedMesh
}

export class Ignition implements OrganismFeature {
  readonly id = 'ignition'
  readonly controls: FeatureControl[] = [
    { key: 'ignite', label: 'note ignition: a flare where each note starts (0 = off)', min: 0, max: 2, step: 0.05, value: 1, group: G },
    { key: 'igniteRing', label: 'ignition: shock ring spreading from the flare (0 = off)', min: 0, max: 2, step: 0.05, value: 0.6, group: G },
    { key: 'lunge', label: "attack lunge: a note's first segments shoot out (0 = off)", min: 0, max: 2, step: 0.05, value: 1, group: G },
    { key: 'envelope', label: 'growth envelope: how a note grows, holds and fades after release', min: 0, max: ENVELOPES.length - 1, step: 1, value: 2, options: ENVELOPES.map((e) => e.name), group: G },
  ]
  private host: OrganismHost | null = null
  private flareMesh: THREE.InstancedMesh | null = null
  private ringMesh: THREE.InstancedMesh | null = null
  private flareData: THREE.InstancedBufferAttribute | null = null
  private ringData: THREE.InstancedBufferAttribute | null = null
  private readonly flares: Flare[] = Array.from({ length: MAX_FLARES }, () => ({ live: false, pos: new THREE.Vector3(), color: new THREE.Color(), t0: 0, size: 1, lift: 0, heat: 0, tau: 0.2, ember: 0, plant: null, seed: 0, now: 0, open: 0 }))
  private readonly rings: Ring[] = Array.from({ length: MAX_RINGS }, () => ({ live: false, pos: new THREE.Vector3(), q: new THREE.Quaternion(), color: new THREE.Color(), t0: 0, size: 1, heat: 0, seed: 0, now: 0, prog: 0 }))
  private tokens = TOKENS_MAX
  private ringTokens = RING_TOKENS_MAX
  // control values, read once a frame (the growth loop asks per tip)
  private amt = 1
  private ringAmt = 0.6
  private lungeAmt = 1
  private env: GrowthEnvelope = ENVELOPES[2]
  private readonly dummy = new THREE.Object3D()
  private readonly col = new THREE.Color()
  private readonly nrm = new THREE.Vector3()
  private readonly hsl = { h: 0, s: 0, l: 0 }
  private readonly tipAt = new THREE.Vector3()

  constructor(private readonly hooks: IgnitionHooks) {}

  mount(e: OrganismHost) {
    this.host = e
    const make = (mat: THREE.Material, max: number) => {
      const geom = new THREE.PlaneGeometry(1, 1)
      const data = new THREE.InstancedBufferAttribute(new Float32Array(max * 2), 2)
      data.setUsage(THREE.DynamicDrawUsage)
      geom.setAttribute(DATA, data)
      const mesh = this.hooks.instanced(geom, mat, max)
      mesh.renderOrder = 2 // after the tip markers: glow adds onto them
      mesh.visible = false
      e.group.add(mesh)
      return { mesh, data }
    }
    const f = make(flareMaterial(), MAX_FLARES)
    const r = make(ringMaterial(), MAX_RINGS)
    this.flareMesh = f.mesh
    this.flareData = f.data
    this.ringMesh = r.mesh
    this.ringData = r.data
    this.readControls()
  }

  unmount(e: OrganismHost) {
    for (const mesh of [this.flareMesh, this.ringMesh]) {
      if (!mesh) continue
      e.group.remove(mesh)
      mesh.geometry.dispose()
      ;(mesh.material as THREE.Material).dispose()
    }
    this.flareMesh = this.ringMesh = null
    this.flareData = this.ringData = null
    this.clear()
    this.host = null
  }

  clear() {
    for (const f of this.flares) {
      f.live = false
      f.plant = null
    }
    for (const r of this.rings) r.live = false
    for (const mesh of [this.flareMesh, this.ringMesh]) {
      if (!mesh) continue
      mesh.count = 0
      mesh.visible = false
    }
  }

  onPlantRemoved(p: Plant) {
    for (const f of this.flares) if (f.plant === p) f.plant = null
  }

  private readControls() {
    const c = this.host?.controls
    if (!c) return
    this.amt = ctl(c, 'ignite')
    this.ringAmt = ctl(c, 'igniteRing')
    this.lungeAmt = ctl(c, 'lunge')
    this.env = ENVELOPES[Math.round(ctl(c, 'envelope'))] ?? ENVELOPES[2]
  }

  beforeFrame(_m: MusicState, _g: unknown, dt: number) {
    this.readControls()
    const step = Math.max(0, Math.min(0.1, dt))
    this.tokens = Math.min(TOKENS_MAX, this.tokens + TOKENS_PER_S * step)
    this.ringTokens = Math.min(RING_TOKENS_MAX, this.ringTokens + RING_TOKENS_PER_S * step)
  }

  // ------------------------------------------------------------ growth shaping (the engine asks)

  /**
   * A played note's attack: the plant carries it (envelope, lunge, credit bypass), and a flare and
   * ring go off at its root this frame. A Reset re-send (regrow) is not a new attack.
   */
  noteOn(p: Plant, ev: NoteEvent, t: number) {
    if (ev.regrow) return
    const audio = isAudioNote(ev)
    const s = attackStrength(ev)
    p.ign = { t0: t, s, up: -1, audio }
    if (this.amt <= 0 || !this.flareMesh) return
    const octN = (Math.min(8, Math.max(1, octave(p.pitch))) - 1) / 7
    // pitch → hue: a nudge round the plant's colour along the circle of fifths, so neighbouring
    // keys differ and the palette still owns the colour (a mono palette gets a hint of hue)
    const c = this.col.copy(p.color)
    c.getHSL(this.hsl)
    const fifth = (pitchClass(p.pitch) * 7) % 12
    c.setHSL((this.hsl.h + (fifth / 12 - 0.5) * 0.14 + 1) % 1, Math.max(this.hsl.s, 0.3), Math.min(0.62, Math.max(this.hsl.l, 0.5)))
    const heat = this.amt * (audio ? 0.45 + 0.8 * s : 0.7 + 0.9 * s)
    // low notes bloom wider, high ones tighter
    const size = (0.2 + 0.22 * s) * (1.2 - 0.4 * octN) * (0.85 + 0.3 * Math.random()) * (0.6 + 0.4 * Math.min(1.5, this.amt))
    const f = this.spark(p.root, c, t, heat, size, p.segLen * 6, this.env.tau)
    if (!f) return // merged into a flare close by, or over the spawn budget: the lunge still shows it
    // a pseudo-note's length is a timer, not the music: no ember to hold
    if (!audio) {
      f.plant = p
      f.ember = 0.2 * this.amt * (0.6 + 0.4 * s)
    }
    // soft notes and weak onsets make no ring: it is the accent mark
    const ringHeat = this.ringAmt * (audio ? s * s : 0.25 + 0.75 * s) * 0.9
    if (ringHeat > 0.05 && this.ringTokens >= 1) {
      this.ringTokens--
      const n = this.nrm.copy(p.sp.planar ? p.n : (p.tips[0]?.dir ?? p.n))
      n.x += (Math.random() - 0.5) * 0.3
      n.y += (Math.random() - 0.5) * 0.3
      n.z += (Math.random() - 0.5) * 0.3
      const r = this.claim(this.rings)
      r.live = true
      r.pos.copy(p.root)
      r.q.setFromUnitVectors(Z_AXIS, n.normalize())
      r.color.copy(c)
      r.t0 = t
      r.size = size * (0.9 + 0.6 * s) * (0.85 + 0.3 * Math.random())
      r.heat = ringHeat
      r.seed = Math.random()
      r.now = ringHeat
      r.prog = 0
    }
  }

  /** Note-off on a key or MIDI note: a small glint where each tip is, the note's full stop. */
  noteOff(p: Plant, t: number) {
    const ig = p.ign
    if (!ig) return
    if (ig.up < 0) ig.up = t
    // audio pseudo-notes end on a timer, not a musical release: no mark
    if (ig.audio || this.amt <= 0 || !this.flareMesh) return
    // staccato leaves a brighter, longer-lived spore; a long note a quiet seal
    const staccato = t - ig.t0 < 0.18
    const heat = this.amt * (staccato ? 0.7 : 0.4) * (0.6 + 0.4 * ig.s)
    let n = 0
    for (const tip of p.tips) {
      if (n >= (staccato ? 1 : 3)) break
      const at = tip.seg ? this.tipAt.copy(tip.seg.a).lerp(tip.seg.b, tip.seg.growth) : tip.pos
      if (!this.spark(at, p.color, t, heat, staccato ? 0.09 : 0.06, p.segLen * 2, staccato ? 0.5 : 0.2)) break
      n++
    }
  }

  /** A flare at `pos` in the plant's colour without a note (song response: a drop). Budgeted like a note's. */
  accent(p: Plant, pos: THREE.Vector3, t: number, s: number) {
    if (this.amt <= 0 || !this.flareMesh) return
    const size = (0.18 + 0.14 * s) * (0.6 + 0.4 * Math.min(1.5, this.amt))
    this.spark(pos, p.color, t, this.amt * (0.6 + 0.8 * s), size, p.segLen * 4, 0.35)
  }

  /** Growth-speed factor from the note's envelope; null for growth no key started, and for the flat envelope. */
  envelope(p: Plant, t: number): number | null {
    const ig = p.ign
    const e = this.env
    if (!ig || e.flat) return null
    if (ig.up < 0 && !p.held) ig.up = t
    const age = t - ig.t0
    let v: number
    if (age < e.a) {
      const k = age / e.a
      v = e.s * e.from + (e.peak - e.s * e.from) * k * k * (3 - 2 * k)
    } else v = e.s + (e.peak - e.s) * Math.exp(-(age - e.a) / e.d)
    if (ig.up >= 0) v *= Math.exp(-(t - ig.up) / e.r)
    return v
  }

  /** Speed factor for a tip: a note's first segments shoot out, easing back to 1 over LUNGE_SEGS. */
  lunge(p: Plant, tip: Tip, t: number): number {
    const ig = p.ign
    if (!ig || this.lungeAmt <= 0 || tip.depth >= LUNGE_SEGS || t - ig.t0 > 1.5) return 1
    const k = 1 - tip.depth / LUNGE_SEGS
    return 1 + 3 * this.lungeAmt * (ig.audio ? 0.4 + 0.6 * ig.s : 0.6 + 0.4 * ig.s) * k * k
  }

  /** The first segments of a note just played start this frame, whatever the segment credit says. */
  freeStart(p: Plant, tip: Tip, t: number): boolean {
    const ig = p.ign
    return !!ig && tip.depth < FREE_DEPTH && t - ig.t0 < FREE_AGE
  }

  /**
   * Tip-marker size over the tip radius. A played note's tips pulse with its own attack instead
   * of every onset in the room, and shrink as it is released; other growth keeps the global pulse.
   */
  tipPulse(p: Plant, t: number, onset: number): number {
    const ig = p.ign
    if (!ig || this.amt <= 0) return 1.5 + 0.8 * onset
    const punch = Math.min(1, this.amt * (0.5 + 0.5 * ig.s)) * Math.exp(-(t - ig.t0) / (this.env.tau * 1.5))
    const rel = ig.up >= 0 ? Math.max(0.45, Math.exp(-(t - ig.up) / this.env.r)) : 1
    return (1.5 + 0.8 * punch) * rel
  }

  // ------------------------------------------------------------ pool

  /** A free record, or the faintest one (the pool never grows). */
  private claim<T extends { live: boolean; now: number }>(pool: T[]): T {
    let best = pool[0]
    for (const r of pool) {
      if (!r.live) return r
      if (r.now < best.now) best = r
    }
    return best
  }

  /**
   * Start a flare, or feed one still bursting close by (merged: a chord on one spot or a flurry
   * of onsets stays one light). Null when the spawn budget is spent.
   */
  private spark(pos: THREE.Vector3, color: THREE.Color, t: number, heat: number, size: number, lift: number, tau: number): Flare | null {
    const dist = this.host ? pos.distanceTo(this.host.camera.position) : 10
    for (const f of this.flares) {
      if (!f.live || t - f.t0 > 0.15) continue
      const near = f.size * dist * 0.2
      if (f.pos.distanceToSquared(pos) > near * near) continue
      f.heat = Math.min(3, Math.max(f.heat * Math.exp(-(t - f.t0) / f.tau), heat) + 0.25 * Math.min(f.heat, heat))
      f.t0 = t
      return null
    }
    if (this.tokens < 1) return null
    this.tokens--
    const f = this.claim(this.flares)
    f.live = true
    f.pos.copy(pos)
    f.color.copy(color)
    f.t0 = t
    f.size = size
    f.lift = lift
    f.heat = heat
    f.tau = tau
    f.ember = 0
    f.plant = null
    f.seed = Math.random()
    f.now = heat
    f.open = 0
    return f
  }

  /** Age the pool: burst decay, the ember following its note, rings spreading. */
  afterGrowth(_m: MusicState, _g: unknown, _dt: number, t: number) {
    const rel = this.env.r
    for (const f of this.flares) {
      if (!f.live) continue
      const age = t - f.t0
      let ember = 0
      const p = f.plant
      if (p?.ign) {
        const ig = p.ign
        if (ig.up < 0 && !p.held) ig.up = t
        // rises with the attack, holds while the key is down, fades with the release
        const rise = clamp01((t - ig.t0) / Math.max(0.08, this.env.a))
        const fade = ig.up >= 0 ? Math.exp(-(t - ig.up) / rel) : 1
        ember = f.ember * rise * fade
        if (fade < 0.02) f.plant = null
        else f.pos.copy(p.root)
      }
      f.now = f.heat * Math.exp(-age / f.tau) + ember
      f.open = 1 - Math.exp(-age / 0.12)
      if (f.now < 0.006 && !f.plant) f.live = false
    }
    for (const r of this.rings) {
      if (!r.live) continue
      r.prog = (t - r.t0) / RING_LIFE
      if (r.prog >= 1) {
        r.live = false
        r.now = 0
        continue
      }
      // fades in as it leaves the root: born small and bright it reads as a target mark, not a wave
      r.now = r.heat * Math.min(1, r.prog / 0.18) * Math.pow(1 - r.prog, 1.5)
    }
  }

  /** Place the quads for this frame's camera: flares face it, sizes follow its distance. */
  beforeDraw(e: OrganismHost) {
    const fm = this.flareMesh
    const rm = this.ringMesh
    if (!fm || !rm || !this.flareData || !this.ringData) return
    const cam = e.camera
    const d = this.dummy
    let n = 0
    const fd = this.flareData.array as Float32Array
    for (const f of this.flares) {
      if (!f.live || f.now < 0.004) continue
      const toCam = this.nrm.subVectors(cam.position, f.pos)
      const dist = Math.max(1e-3, toCam.length())
      const lift = Math.min(f.lift, dist * 0.3)
      d.position.copy(f.pos).addScaledVector(toCam, lift / dist)
      d.quaternion.copy(cam.quaternion)
      d.scale.setScalar(f.size * (dist - lift) * (0.75 + 0.35 * f.open))
      d.updateMatrix()
      fm.setMatrixAt(n, d.matrix)
      fm.setColorAt(n, this.col.copy(f.color).multiplyScalar(f.now))
      fd[n * 2] = f.open
      fd[n * 2 + 1] = f.seed
      n++
    }
    this.show(fm, this.flareData, n)
    n = 0
    const rd = this.ringData.array as Float32Array
    for (const r of this.rings) {
      if (!r.live) continue
      const ease = 1 - Math.pow(1 - r.prog, 3)
      d.position.copy(r.pos)
      d.quaternion.copy(r.q)
      d.scale.setScalar(r.size * r.pos.distanceTo(cam.position) * (0.2 + 0.8 * ease))
      d.updateMatrix()
      rm.setMatrixAt(n, d.matrix)
      rm.setColorAt(n, this.col.copy(r.color).multiplyScalar(r.now))
      rd[n * 2] = r.prog
      rd[n * 2 + 1] = r.seed
      n++
    }
    this.show(rm, this.ringData, n)
  }

  private show(mesh: THREE.InstancedMesh, data: THREE.InstancedBufferAttribute, n: number) {
    mesh.count = n
    mesh.visible = n > 0
    if (!n) return
    mesh.instanceMatrix.needsUpdate = true
    mesh.instanceColor!.needsUpdate = true
    data.needsUpdate = true
  }
}
