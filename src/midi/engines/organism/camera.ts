// The Organism camera: what it looks at (a robust, recent-weighted focus volume of the
// growth), the camera modes, manual orbit / pan / zoom, the pose lock and the music's
// camera reaction.
//
// Modes 0-5 are the original paths; orbit and chase now keep the growth in frame. Modes 6-9
// share one circling rig: focus, distance and elevation are critically damped springs and the
// azimuth is orbit's own `theta` (same convention), so switching between them never swings
// through the scene. Mode 10, Director, rides the same rig and cuts between shots on the music's
// bars and energy arcs. Music reaction (kick, shake, jolt, bass push) is an offset on the drawn
// pose only, so the smoothed path is the same at any frame rate. While the panel covers part of
// the window, the projection's centre moves into the uncovered part and every fit uses its size.
// Mode 11, flight (any look; the Webs look's own camera), flies forward for ever along a gently
// wandering path, banking into its turns, faster with the music; the engine grows the notes ahead
// of it and retires what it passed.

import * as THREE from 'three'
import type { EngineControl, GlobalParams } from '../../engine'
import { ctl } from '../../engine'
import type { MusicState } from '../../music'
import type { Gesture } from '../../vision'
import type { Plant, Seg, Tip } from './types'

/** The saved value is the index: never reorder, only append (presets, ?cam=). 6-8 keep their v0.17-v0.19 meaning. */
export const CAM_MODES = ['orbit', 'weave through', 'tunnel', 'drift inside', 'sit inside', 'chase the newest growth', 'tip glide', 'cinematic tour', 'wide pulse', 'framed', 'director', 'flight (through the growth)']
export const CAM = { orbit: 0, weave: 1, tunnel: 2, drift: 3, sit: 4, chase: 5, tipGlide: 6, tour: 7, wide: 8, framed: 9, director: 10, flight: 11 } as const

/** Modes that fly on for ever: no shell, no bounds, growth culled once the camera has passed it. */
export const endless = (mode: number) => mode === CAM.tunnel || mode === CAM.flight

/** Modes that travel among the growth: "grow around the camera path" places new growth ahead of them. */
export const travels = (mode: number) => mode >= CAM.weave && mode <= CAM.chase

const Y_AXIS = new THREE.Vector3(0, 1, 0)
const rnd = () => Math.random() - 0.5
const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x))
/** Whole-structure samples per frame (strided over every segment) and fresh-growth samples. */
const ALL_N = 320
const FRESH_N = 192
/** "Fresh" growth: born within this many seconds. */
const FRESH_S = 3
/** chase keeps its old offset (cos θ·d, 0.35·d, sin θ·d), written as elevation and length */
const CHASE_EL = Math.atan(0.35)
const CHASE_LEN = Math.hypot(1, 0.35)

/**
 * Camera distance at which a sphere of radius r fills the frame to 1/margin. The narrower of
 * the vertical and horizontal half-angles decides, so portrait output is limited by its width.
 * inX / inY: the share of the width / height a panel covers (the view is centred in the rest).
 */
export function fitDistance(r: number, fovY: number, aspect: number, margin = 1.12, inX = 0, inY = 0) {
  const ty = Math.tan((fovY * Math.PI) / 360)
  return (r * margin) / Math.sin(Math.atan(Math.min(ty * (1 - inY), ty * aspect * (1 - inX))))
}

/** Smooth tremble, unit RMS per axis: a slow sway plus a fast shiver, never visibly repeating. */
function tremble(t: number, ph: number, out: THREE.Vector3) {
  return out.set(
    Math.sin(t * 13.1 + ph) + Math.sin(t * 41.7 + 2 * ph),
    Math.sin(t * 11.7 + 1.3 + ph) + Math.sin(t * 47.3 + 0.4 + 3 * ph),
    Math.sin(t * 14.9 + 2.6 + ph) + Math.sin(t * 37.9 + 1.9 + ph),
  )
}

/** Point on the orbit sphere (x = cos az, z = sin az: the orbit mode's convention). */
function sph(out: THREE.Vector3, az: number, el: number, d: number) {
  return out.set(Math.cos(az) * Math.cos(el) * d, Math.sin(el) * d, Math.sin(az) * Math.cos(el) * d)
}

/** Critically damped spring (SmoothDamp): frame-rate independent, starts and stops without a jolt. */
class Spring {
  v = 0
  constructor(public x = 0) {}
  to(target: number, time: number, dt: number) {
    const w = 2 / Math.max(1e-3, time)
    const k = w * dt
    const e = 1 / (1 + k + 0.48 * k * k + 0.235 * k * k * k)
    const d = this.x - target
    const tmp = (this.v + w * d) * dt
    this.v = (this.v - w * tmp) * e
    this.x = target + (d + tmp) * e
  }
  set(x: number) {
    this.x = x
    this.v = 0
  }
}

class Spring3 {
  private readonly s = [new Spring(), new Spring(), new Spring()]
  readonly x = new THREE.Vector3()
  to(target: THREE.Vector3, time: number, dt: number) {
    this.s[0].to(target.x, time, dt)
    this.s[1].to(target.y, time, dt)
    this.s[2].to(target.z, time, dt)
    this.x.set(this.s[0].x, this.s[1].x, this.s[2].x)
  }
  set(p: THREE.Vector3) {
    this.s[0].set(p.x)
    this.s[1].set(p.y)
    this.s[2].set(p.z)
    this.x.copy(p)
  }
}

const growing = (p: Plant, t: number) => (p.held || p.autoUntil > t) && p.tips.length > 0
const tipPos = (tip: Tip, out: THREE.Vector3) => (tip.seg ? out.copy(tip.seg.a).lerp(tip.seg.b, Math.min(1, tip.seg.growth)) : out.copy(tip.pos))
const wrapPi = (a: number) => a - Math.PI * 2 * Math.round(a / (Math.PI * 2))

/** Director shots: all of it, the fresh growth, the newest tips, a faster circle, a low hero angle. */
const SHOTS = ['wide', 'medium', 'close', 'orbit', 'low'] as const
type Shot = (typeof SHOTS)[number]
/** per shot: elevation, and azimuth drift in rad/s at the default camera speed */
const SHOT_EL: Record<Shot, number> = { wide: 0.38, medium: 0.2, close: 0.12, orbit: 0.28, low: -0.3 }
const SHOT_AZ: Record<Shot, number> = { wide: 0.05, medium: 0.08, close: 0.1, orbit: 0.24, low: 0.06 }
/** no shot is shorter than this (s), however busy; a glide eases between shots over about this long */
const MIN_SHOT = 2
const GLIDE = 1.6

/** flight: world units / s per unit of camera speed at rest (camera speed 0.5 → 3 u/s); the music adds to it */
export const FLY_BASE = 6
/** largest turn rate (rad/s) and pitch (rad) at wander 1, and the bank (rad) per rad/s of turn at roll 1 */
const FLY_TURN = 0.2
const FLY_PITCH = 0.2
const FLY_BANK = 1.6
/** the drawn camera's near plane in flight: ribbons pass within a hand's width of the lens */
const FLY_NEAR = 0.06
/** Smooth wander in about -1..1: three incommensurate sines, never visibly repeating. */
const wander = (t: number, ph: number) => (Math.sin(t * 0.61 + ph) + 0.7 * Math.sin(t * 0.27 + 2.1 * ph) + 0.45 * Math.sin(t * 1.13 + 0.7 + ph)) / 2.15

/** Half extents of the 3D reference (organism/reference.ts): a picture plane centred on the origin, facing +Z. */
export interface RefBox {
  hw: number
  hh: number
  hd: number
}
/** Facing a reference: camera on +Z (azimuth π/2 in the orbit convention), a little above it. */
const REF_FACE = Math.PI / 2
const REF_EL = 0.12
/** framed / wide pulse swing this far either side of face-on instead of circling to the picture's edge */
const REF_SWING = 0.45

/** What the engine hands the camera each frame. */
export interface CameraInput {
  segs: readonly Seg[]
  /** segments of the last seconds in birth order; removed ones have idx -1 */
  young: readonly Seg[]
  plants: readonly Plant[]
  /** a shell sits at the origin: the focus leans 70% toward it (skin: all the way); 1 without a shell */
  shellLean: number
  /** the smallest framing radius (the shell's reach, or an empty scene) */
  minRadius: number
  /** music envelopes from the engine: hits and smoothed bass */
  hitEnv: number
  bassS: number
  wild: number
  gesture: Gesture | null
  /** organism size (gesture parallax scale) */
  size: number
  /** the 3D reference while it guides growth: the framing keeps all of it in view */
  ref: RefBox | null
  /** points on surfaces drawn instead of segments (soft species, xyz triples): every one stays in view */
  surface: Float32Array
  surfaceN: number
  /** the plant draws a surface: its (hidden) segments only steer the fresh centre, they are not framed */
  surfaced: (p: Plant) => boolean
}

export class CameraRig {
  /** the smoothed camera path: no music offsets, no gesture parallax */
  readonly pos = new THREE.Vector3(0, 2, 12)
  readonly look = new THREE.Vector3()
  /** where the drawn view faces (growth placed ahead of the camera uses it) */
  readonly fwd = new THREE.Vector3(0, 0, -1)
  /** tunnel / flight direction of travel */
  readonly heading = new THREE.Vector3(0, 0, -1)
  /** flight: the current speed (world units / s) */
  flySpeed = 0
  /**
   * Centre of the growth, leaning toward fresh growth by camFollow. Growth logic reads it too
   * (root placement, radial drift, bounds), so it keeps updating while the view is locked.
   */
  readonly center = new THREE.Vector3()
  /** robust radius of the growth around `center`: 95th percentile of the structure, 98th of fresh growth */
  radius = 2
  /** orbit azimuth, shared by every circling mode */
  private theta = 0
  private dist = 14
  private prevMode = -1
  private t = 0
  // manual camera: middle-drag orbits, right-drag / Shift+middle-drag pans, wheel zooms
  private manTheta = 0
  private manPhi = 0
  private readonly pan = new THREE.Vector3()
  private zoomMul = 1
  private zoomS = 1
  private dragBtn = -1
  private dragX = 0
  private dragY = 0
  // focus samples (xyz triples)
  private readonly pts = new Float32Array(ALL_N * 3)
  private readonly fpts = new Float32Array(FRESH_N * 3)
  private readonly dists = new Float32Array(Math.max(ALL_N, FRESH_N))
  private nAll = 0
  private nFresh = 0
  private surf: Float32Array = new Float32Array(0)
  private surfN = 0
  private phase = 0
  /** recency-weighted centre of fresh growth; holds its place while nothing grows */
  private readonly fresh = new THREE.Vector3()
  // circling modes (6-9)
  private readonly focus = new Spring3()
  private readonly sDist = new Spring(10)
  private readonly sEl = new Spring(0.3)
  /** framing distance with hysteresis: out at once, in only after the growth has fitted a while */
  private fitT = 10
  private fitHold = 0
  private cutNow = false
  // cinematic tour
  private tourPlant: Plant | null = null
  private tourSince = 0
  private tourBars = 0
  private visited = new WeakMap<Plant, number>()
  private lastBeat = -1
  // director (mode 10): the shot, when it started, bars since, the arc events already acted on,
  // the rest of a glide (time and turn) and the build's push-in
  private dShot: Shot = 'wide'
  private dSince = 0
  private dBars = 0
  private dDrops = 0
  private dSection = 0
  private dSectionDue = false
  private dBreak = false
  private dGlide = 0
  private dTurn = 0
  private readonly dPush = new Spring(1)
  /** shot changes so far (a debug count) */
  dCuts = 0
  // fly-through modes
  private readonly driftTarget = new THREE.Vector3()
  private driftT = 0
  // flight (mode 11): the heading's yaw (orbit convention), pitch and bank springs, speed, the path's clock
  private yaw = 0
  private readonly sPitch = new Spring(0)
  private readonly sRoll = new Spring(0)
  private readonly sSpeed = new Spring(0)
  private flyT = 0
  private flyE = 0
  // music reaction: hitEnv with a short attack, the wild jolt, the cinematic bass push, this frame's offset
  private kickEnv = 0
  private joltEnv = 0
  private bassEnv = 0
  private readonly off = new THREE.Vector3()
  private pinchX: number | null = null
  private lockPose: { pos: THREE.Vector3; look: THREE.Vector3; up: THREE.Vector3; near: number } | null = null
  /** the drawn pose before transient offsets (what a lock freezes) */
  private readonly rPos = new THREE.Vector3(0, 2, 12)
  private readonly rLook = new THREE.Vector3()
  private readonly v1 = new THREE.Vector3()
  private readonly v2 = new THREE.Vector3()
  private readonly v3 = new THREE.Vector3()
  private readonly v4 = new THREE.Vector3()
  private readonly target = new THREE.Vector3()
  private readonly lookT = new THREE.Vector3()
  // the 3D reference (this frame's), the global rotation and zoom of the last update, and the face-on swing phase
  private box: RefBox | null = null
  private rot = 0
  private zoomG = 1
  private swing = 0
  // the panel's share of the view (left, top), eased toward the wanted one: the projection is
  // shifted so the framing centres in the uncovered part, and every fit uses that part's size
  private inX = 0
  private inY = 0
  private inWantX = 0
  private inWantY = 0

  constructor(
    private readonly camera: THREE.PerspectiveCamera,
    private readonly controls: EngineControl[],
  ) {}

  get locked() {
    return this.lockPose !== null
  }

  /** Distance from the camera to what it looks at. */
  get viewDist() {
    return this.pos.distanceTo(this.look)
  }

  /** Freeze exactly this view (Reset keeps it) or release it. Only the pose freezes: the focus and growth go on. */
  toggleLock(): boolean {
    if (this.lockPose) {
      // the path was paused while locked, so it resumes from the frozen view without a swing
      this.lockPose = null
      return false
    }
    this.lockPose = { pos: this.rPos.clone(), look: this.rLook.clone(), up: this.camera.up.clone(), near: this.camera.near }
    this.dragBtn = -1
    return true
  }

  /** Reset: back to the start pose, manual offsets cleared. The engine skips this while locked. */
  resetView() {
    this.pos.set(0, 2, 12)
    this.look.set(0, 0, 0)
    this.rPos.copy(this.pos)
    this.rLook.copy(this.look)
    this.dist = 14
    this.heading.set(0, 0, -1)
    this.manTheta = this.manPhi = 0
    this.pan.set(0, 0, 0)
    this.zoomMul = this.zoomS = 1
    this.prevMode = -1 // the next frame adopts the start pose
  }

  /** The growth was wiped: forget where it was. */
  resetFocus() {
    this.center.set(0, 0, 0)
    this.fresh.set(0, 0, 0)
    this.radius = 2
    this.nAll = this.nFresh = 0
    this.tourPlant = null
  }

  /**
   * Fit view for the 3D reference: face the picture (camera on +Z, slightly above) at the
   * distance that fits it and the growth, manual orbit / pan / zoom cleared. Snaps the path and
   * the circling springs so nothing swings in; a locked view is re-aimed and stays locked.
   */
  faceOn(box: RefBox) {
    this.box = box
    this.manTheta = this.manPhi = 0
    this.pan.set(0, 0, 0)
    this.zoomMul = this.zoomS = 1
    this.swing = 0
    this.center.set(0, 0, 0)
    const dir = sph(this.v3, REF_FACE, REF_EL, 1)
    const d = this.viewFit(this.center, dir, 1.06, 2) / this.zoomG
    this.theta = REF_FACE - this.rot
    this.look.set(0, 0, 0)
    this.pos.copy(dir).multiplyScalar(d)
    this.rPos.copy(this.pos)
    this.rLook.copy(this.look)
    this.dist = d
    this.focus.set(this.look)
    this.sDist.set(d)
    this.sEl.set(REF_EL)
    this.fitT = d
    this.fitHold = 1.2
    if (this.lockPose) {
      this.lockPose.pos.copy(this.pos)
      this.lockPose.look.copy(this.look)
    }
  }

  /** Where the panel covers the view (shares of width / height, 0 = none). `snap` goes there at once (a take starts). */
  setInset(x: number, y: number, snap: boolean) {
    this.inWantX = clamp(x, 0, 0.5)
    this.inWantY = clamp(y, 0, 0.5)
    if (snap) {
      this.inX = this.inWantX
      this.inY = this.inWantY
    }
  }

  /** A still is the picture without the panel: centred. The next update puts the shift back. */
  dropInset() {
    if (this.camera.view?.enabled) this.camera.clearViewOffset()
  }

  /** Ease toward the wanted inset and shift the projection's centre into the uncovered part. */
  private applyInset(dt: number) {
    const k = 1 - Math.exp(-dt * 5)
    this.inX += (this.inWantX - this.inX) * k
    this.inY += (this.inWantY - this.inY) * k
    if (Math.abs(this.inX - this.inWantX) < 1e-4) this.inX = this.inWantX
    if (Math.abs(this.inY - this.inWantY) < 1e-4) this.inY = this.inWantY
    const cam = this.camera
    const v = cam.view
    if (this.inX < 1e-4 && this.inY < 1e-4) {
      if (v?.enabled) cam.clearViewOffset()
      return
    }
    // a sub-view in aspect units (setViewOffset sets aspect = fullWidth / fullHeight): moving the
    // window left / up by half the covered share puts the centre in the middle of the rest
    const a = cam.aspect
    const ox = (-this.inX * a) / 2
    const oy = -this.inY / 2
    if (v?.enabled && v.fullWidth === a && v.fullHeight === 1 && v.offsetX === ox && v.offsetY === oy) return
    cam.setViewOffset(a, 1, ox, oy, a, 1)
  }

  /** fitDistance for the uncovered part of the view. */
  private fitR(r: number, margin: number) {
    return fitDistance(r, this.camera.fov, this.camera.aspect, margin, this.inX, this.inY)
  }

  /** The director's current shot, or null in other modes. */
  get directorShot(): string | null {
    return this.prevMode === CAM.director && !this.box ? this.dShot : null
  }

  /** The clock of the last update (screen bounce steps with it; a snapshot redraw does not move it). */
  get time() {
    return this.t
  }

  attach(c: HTMLCanvasElement) {
    c.addEventListener('contextmenu', (e) => e.preventDefault())
    c.addEventListener('pointerdown', (e) => {
      // Alt/Option + left-drag orbits too: a trackpad has no middle button
      const alt = e.button === 0 && e.altKey
      if (e.button !== 1 && e.button !== 2 && !alt) return
      e.preventDefault() // no middle-click autoscroll, locked or not
      if (this.lockPose) return
      this.dragBtn = alt ? 1 : e.button
      this.dragX = e.clientX
      this.dragY = e.clientY
      try {
        c.setPointerCapture(e.pointerId)
      } catch {
        /* synthetic events have no active pointer */
      }
    })
    c.addEventListener('pointermove', (e) => {
      if (this.lockPose || this.dragBtn < 0) return
      const dx = e.clientX - this.dragX
      const dy = e.clientY - this.dragY
      this.dragX = e.clientX
      this.dragY = e.clientY
      // Shift is read on every move, so pressing it mid-drag switches orbit ↔ pan
      if (this.dragBtn === 1 && !e.shiftKey) {
        this.manTheta += dx * 0.006
        this.manPhi = clamp(this.manPhi + dy * 0.006, -1.2, 1.2)
      } else {
        // along the screen: the drawn camera's right and up, scaled by how far away the focus is
        const m = this.camera.matrixWorld
        const k = Math.max(0.5, this.viewDist) * 0.0012
        this.pan.addScaledVector(this.v1.setFromMatrixColumn(m, 0), -dx * k).addScaledVector(this.v1.setFromMatrixColumn(m, 1), dy * k)
      }
    })
    const end = () => (this.dragBtn = -1)
    c.addEventListener('pointerup', end)
    c.addEventListener('pointercancel', end)
    c.addEventListener('lostpointercapture', end)
    c.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault()
        if (this.lockPose) return
        // Firefox reports lines (and some mice pages): normalise to pixels
        const px = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? window.innerHeight : 1)
        this.zoomMul = clamp(this.zoomMul * Math.exp(px * 0.0012), 0.2, 5)
      },
      { passive: false },
    )
    // double-click: undo the manual orbit / pan / zoom
    c.addEventListener('dblclick', () => {
      if (this.lockPose) return
      this.manTheta = this.manPhi = 0
      this.pan.set(0, 0, 0)
      this.zoomMul = 1
    })
  }

  /** One frame: focus, then (unless locked) the mode's path, the drawn pose and the near plane. Returns the mode. */
  update(m: MusicState, g: GlobalParams, dt: number, t: number, w: CameraInput): number {
    const c = this.controls
    const mode = ctl(c, 'camMode')
    this.t = t
    this.box = w.ref
    this.surf = w.surface
    this.surfN = w.surfaceN
    this.rot = g.rotNow * 0.5
    this.zoomG = g.zoom
    const bar = m.beat.barHit > 0.95 && m.beat.beat !== this.lastBeat
    if (bar) this.lastBeat = m.beat.beat
    this.bassEnv += (m.bass - this.bassEnv) * (1 - Math.exp(-dt * 3))
    this.kickEnv += (w.hitEnv - this.kickEnv) * (1 - Math.exp(-dt * 18)) // ~50 ms attack: a punch, not a cut
    this.joltEnv = Math.max(this.joltEnv * Math.exp(-dt * 6), w.wild > 0 && m.onset > 0.3 ? w.wild * m.onset : 0)
    this.sample(w, t)
    this.focusOn(w, mode, dt)
    this.applyInset(dt)
    if (this.lockPose) {
      const p = this.lockPose
      this.camera.position.copy(p.pos)
      this.camera.up.copy(p.up)
      this.camera.lookAt(p.look)
      this.setNear(p.near)
      return mode
    }

    const calm = ctl(c, 'calmCamera') > 0
    const speed = ctl(c, 'orbit')
    // calm: the music no longer steers the path (an average energy, no onsets, no zoom breathing)
    const energy = calm ? 0.35 : m.energy
    const zoomNow = calm ? g.zoom : g.zoomNow
    this.zoomS += (this.zoomMul - this.zoomS) * (1 - Math.exp(-dt * 8))
    if (mode !== this.prevMode && mode === CAM.orbit) {
      // continue from wherever the last mode left the camera
      const off = this.v1.subVectors(this.pos, this.look)
      this.dist = Math.max(0.5, off.length()) / Math.max(0.2, this.zoomMul)
      this.theta = Math.atan2(off.z, off.x) - this.manTheta - g.rotNow * 0.5
    }
    const radius = this.radius
    const target = this.target
    const look = this.lookT
    const cam = this.camera
    if (mode === CAM.orbit) {
      this.theta += dt * speed * (0.18 + 0.35 * energy)
      const wob = calm ? 0 : 1
      const breathe = calm ? 1 : 1 + 0.03 * m.energy + 0.05 * m.onset
      const ang = this.theta + this.manTheta + g.rotNow * 0.5 + wob * Math.sin(t * 0.37) * 0.04
      const phi = clamp(0.3 + wob * 0.25 * Math.sin(t * 0.11) + this.manPhi, -1.4, 1.4)
      // fit the growth to the frame from this direction (fov and aspect); zoom out faster than in
      const want = this.viewFit(this.center, sph(this.v3, ang, phi, 1), 1.1, w.minRadius) / zoomNow
      this.dist += (want - this.dist) * (1 - Math.exp(-dt * (want > this.dist ? 3 : 1.2)))
      sph(target, ang, phi, (this.dist / breathe) * this.zoomMul).add(this.center).add(this.pan)
      look.copy(this.center).add(this.pan)
      this.pos.lerp(target, 1 - Math.exp(-dt * 6))
      this.look.lerp(look, 1 - Math.exp(-dt * 6))
    } else if (mode === CAM.weave) {
      // weave: a smooth incommensurate curve through the structure, looking ahead
      this.theta += dt * speed * (0.25 + 0.4 * energy)
      const R = Math.max(1.5, radius * 0.55) / zoomNow
      const path = (u: number, out: THREE.Vector3) => out.set(Math.sin(u * 0.61) * R, Math.sin(u * 0.37 + 1.3) * R * 0.45, Math.cos(u * 0.47) * R).add(this.center)
      if (!calm && bar && ctl(c, 'beatLock') > 0) this.theta += 1.3 // cut on the bar
      path(this.theta, target)
      // look ahead along the path, but lean toward the heart of the organism so
      // the view weaves through growth instead of staring out along the tangent
      path(this.theta + 0.6, look)
      look.lerp(this.center, 0.55)
      this.pos.lerp(target, 1 - Math.exp(-dt * 4))
      this.look.lerp(look, 1 - Math.exp(-dt * 4))
    } else if (mode === CAM.tunnel) {
      // tunnel: fly forward forever, slowly turning (the engine grows ahead and culls behind)
      const h = this.heading
      h.x += Math.sin(t * 0.23) * 0.35 * dt
      h.y += Math.sin(t * 0.17 + 2) * 0.25 * dt
      h.z += Math.cos(t * 0.19 + 1) * 0.35 * dt
      h.normalize()
      this.pos.addScaledVector(h, (dt * speed * (2.2 + 2 * energy)) / zoomNow)
      this.look.copy(this.pos).addScaledVector(h, 6)
    } else if (mode === CAM.drift) {
      // drift: slow random walk inside the organism, looking at its centre
      this.driftT -= dt
      if (this.driftT <= 0) {
        this.driftT = 3 + Math.random() * 4
        this.driftTarget.set(rnd() * 2, rnd() * 1.2, rnd() * 2).multiplyScalar(Math.max(2, radius * 0.7) / zoomNow).add(this.center)
      }
      this.pos.lerp(this.driftTarget, 1 - Math.exp(-dt * 0.35 * (0.5 + speed)))
      look.copy(this.center).add(this.v1.set(Math.sin(t * 0.3), 0.2 * Math.sin(t * 0.21), Math.cos(t * 0.26)).multiplyScalar(radius * 0.3))
      this.look.lerp(look, 1 - Math.exp(-dt * 2))
    } else if (mode === CAM.chase) {
      // chase: ride just behind the newest growing tip, far enough back to keep its growth in view
      let aim: THREE.Vector3 | null = null
      let spread = 0
      for (let i = w.plants.length - 1; i >= 0 && !aim; i--) {
        const p = w.plants[i]
        if (!growing(p, t)) continue
        aim = tipPos(p.tips[p.tips.length - 1], this.v2)
        for (const tip of p.tips) spread = Math.max(spread, tipPos(tip, this.v1).distanceTo(aim))
      }
      aim ??= this.fresh
      this.theta += dt * speed * 0.35
      const d = Math.max(3 + radius * 0.35, this.fitR(spread, 1.1)) / zoomNow
      sph(target, this.theta + this.manTheta, clamp(CHASE_EL + this.manPhi, -1.4, 1.4), d * CHASE_LEN * this.zoomMul).add(aim).add(this.pan)
      look.copy(aim).add(this.pan)
      this.pos.lerp(target, 1 - Math.exp(-dt * 2.2))
      this.look.lerp(look, 1 - Math.exp(-dt * 3))
    } else if (mode === CAM.flight) this.fly(m, dt, w, calm, speed)
    else if (mode === CAM.sit) {
      // sit inside: near the centre, slowly turning to look around
      this.theta += dt * speed * 0.3
      target.copy(this.center).add(this.v1.set(Math.sin(t * 0.13), 0.3 * Math.sin(t * 0.09), Math.cos(t * 0.11)).multiplyScalar(Math.max(0.5, radius * 0.25) / zoomNow))
      this.pos.lerp(target, 1 - Math.exp(-dt * 2))
      look.copy(this.pos).add(this.v1.set(Math.cos(this.theta), 0.35 * Math.sin(t * 0.2), Math.sin(this.theta)).multiplyScalar(5))
      this.look.lerp(look, 1 - Math.exp(-dt * 3))
    } else this.circle(mode, m, g, dt, t, w, calm, speed, zoomNow, bar)
    this.prevMode = mode

    // the drawn pose: the path, plus the manual offsets for the fly-through modes
    const rPos = this.rPos.copy(this.pos)
    const rLook = this.rLook.copy(this.look)
    if ((mode >= CAM.weave && mode <= CAM.sit) || mode === CAM.flight) this.flyThroughOffsets(rPos, rLook)
    this.fwd.subVectors(rLook, rPos).normalize()
    // flight banks into its turns: the view's up leans about the view direction; every other mode stands upright
    if (mode === CAM.flight) cam.up.copy(Y_AXIS).applyAxisAngle(this.fwd, this.sRoll.x)
    else if (cam.up.y !== 1) cam.up.copy(Y_AXIS)

    // music reaction: punch in on hits, tremble with the bass, jolt on wild onsets, lean in with
    // the bass (cinematic shots). On this frame's camera only (sizes match the old per-frame
    // nudges at 60 fps in orbit).
    const react = calm ? 0 : ctl(c, 'react')
    const kick = ctl(c, 'kick') * react
    const shake = ctl(c, 'shake') * react
    const off = this.off.set(0, 0, 0)
    if (kick > 0) off.subVectors(rLook, rPos).multiplyScalar(Math.min(0.5, 1.1 * kick * this.kickEnv))
    if (shake > 0) off.add(tremble(t, 0, this.v1).multiplyScalar(shake * w.bassS * 0.4))
    if (!calm && this.joltEnv > 1e-3) off.add(tremble(t * 1.7, 2.1, this.v1).multiplyScalar(this.joltEnv * 0.2))
    if (!calm && mode >= CAM.tipGlide && mode <= CAM.wide) off.addScaledVector(this.v1.subVectors(rLook, rPos), 0.07 * this.bassEnv)
    cam.position.copy(rPos).add(off)

    // gestures: head parallax moves the drawn camera, a pinch-drag orbits (an open palm is the engine's)
    const gs = w.gesture
    if (gs && gs.present) {
      const right = this.v1.crossVectors(this.fwd, Y_AXIS).normalize()
      cam.position.addScaledVector(right, gs.head.x * w.size * 0.18).addScaledVector(Y_AXIS, gs.head.y * w.size * 0.12)
      let pinching = false
      for (const h of gs.hands) {
        if (!h.pinch) continue
        pinching = true
        if (this.pinchX !== null) this.theta += (h.x - this.pinchX) * 2.5
        this.pinchX = h.x
      }
      if (!pinching) this.pinchX = null
    }
    cam.lookAt(rLook)
    // fly-through modes pass through thick growth: a bigger near plane. Close circling shots scale it.
    const near = mode === CAM.orbit ? 0.05 : mode === CAM.flight ? FLY_NEAR : mode >= CAM.tipGlide ? clamp(Math.round(rPos.distanceTo(rLook) * 2) / 100, 0.05, 0.4) : 0.4
    this.setNear(near)
    return mode
  }

  private setNear(near: number) {
    if (this.camera.near === near) return
    this.camera.near = near
    this.camera.updateProjectionMatrix()
  }

  /**
   * Sample the growth: up to ALL_N segment ends strided over the whole structure (the offset
   * rotates, so every segment is visited) and up to FRESH_N of those born in the last FRESH_S
   * seconds. Bounded work per frame, however big the organism gets.
   */
  private sample(w: CameraInput, t: number) {
    const segs = w.segs
    const n = segs.length
    const pts = this.pts
    let k = 0
    if (n) {
      const stride = Math.ceil(n / ALL_N)
      for (let i = stride > 1 ? this.phase++ % stride : 0; i < n && k < ALL_N; i += stride) {
        const s = segs[i]
        if (s.plant.sp.soft && w.surfaced(s.plant)) continue
        const b = s.b
        pts[k * 3] = b.x
        pts[k * 3 + 1] = b.y
        pts[k * 3 + 2] = b.z
        k++
      }
    }
    this.nAll = k
    // the young list is in birth order: the fresh window is a tail, found by bisection
    const young = w.young
    const since = t - FRESH_S
    let lo = 0
    let hi = young.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (young[mid].born < since) lo = mid + 1
      else hi = mid
    }
    const stride = Math.max(1, Math.ceil((young.length - lo) / FRESH_N))
    const fpts = this.fpts
    const sum = this.v1.set(0, 0, 0)
    let wsum = 0
    let f = 0
    for (let i = young.length - 1; i >= lo && f < FRESH_N; i -= stride) {
      const s = young[i]
      if (s.idx < 0) continue
      const b = s.b
      if (!(s.plant.sp.soft && w.surfaced(s.plant))) {
        fpts[f * 3] = b.x
        fpts[f * 3 + 1] = b.y
        fpts[f * 3 + 2] = b.z
        f++
      }
      const wt = Math.exp(-(t - s.born) / 1.2) // the newest counts most
      sum.addScaledVector(b, wt)
      wsum += wt
    }
    this.nFresh = f
    if (wsum > 0) this.fresh.copy(sum).divideScalar(wsum)
  }

  /** Centre (smoothed, what growth reads) and robust radius from this frame's samples. */
  private focusOn(w: CameraInput, mode: number, dt: number) {
    const tgt = this.v2.set(0, 0, 0)
    const n = this.nAll
    const pts = this.pts
    for (let i = 0; i < n; i++) tgt.x += pts[i * 3], tgt.y += pts[i * 3 + 1], tgt.z += pts[i * 3 + 2]
    const sp = this.surf
    const sn = this.surfN
    for (let i = 0; i < sn; i++) tgt.x += sp[i * 3], tgt.y += sp[i * 3 + 1], tgt.z += sp[i * 3 + 2]
    if (n + sn) tgt.divideScalar(n + sn)
    tgt.multiplyScalar(w.shellLean)
    // follow the action: bias the focus toward where growth is appearing
    const follow = ctl(this.controls, 'camFollow')
    if (follow > 0 && w.segs.length) tgt.lerp(this.fresh, follow * 0.75)
    if (endless(mode)) tgt.copy(this.pos).addScaledVector(this.heading, 5) // the organism lives ahead of us
    else if (w.ref) tgt.set(0, 0, 0) // growth lives on the reference: frame the picture, not where it drifts
    this.center.lerp(tgt, 1 - Math.exp(-dt * 0.8))
    // percentiles, not the max: one stray shoot must not shrink the organism to a dot. Fresh
    // growth gets a higher one, so what the music just made stays in view.
    const b = w.ref
    this.radius =
      endless(mode)
        ? w.minRadius
        : Math.max(w.minRadius, b ? Math.hypot(b.hw, b.hh, b.hd) : 0, this.quantile(pts, n, this.center, 0.95), this.quantile(this.fpts, this.nFresh, this.center, 0.98), this.farthest(sp, sn, this.center))
  }

  /** Largest distance from `from` to the first n points of `pts`. */
  private farthest(pts: Float32Array, n: number, from: THREE.Vector3) {
    let m = 0
    for (let i = 0; i < n; i++) m = Math.max(m, (pts[i * 3] - from.x) ** 2 + (pts[i * 3 + 1] - from.y) ** 2 + (pts[i * 3 + 2] - from.z) ** 2)
    return Math.sqrt(m)
  }

  /** q-quantile of the distances from `from` to the first n points of `pts`. */
  private quantile(pts: Float32Array, n: number, from: THREE.Vector3, q: number) {
    if (!n) return 0
    const d = this.dists
    for (let i = 0; i < n; i++) {
      const x = pts[i * 3] - from.x
      const y = pts[i * 3 + 1] - from.y
      const z = pts[i * 3 + 2] - from.z
      d[i] = x * x + y * y + z * z
    }
    const s = d.subarray(0, n).sort()
    return Math.sqrt(s[Math.min(n - 1, Math.round(q * (n - 1)))])
  }

  /**
   * Modes 6-9. framed: the whole growth fitted to the frame, a slow constant orbit (camera
   * speed; 0 = still), no music in the path. wide pulse: the same, looser (at least the shot
   * distance), leaning in with the bass. tip glide: a close shot of the newest growing tips.
   * cinematic tour: a close shot moving between growing plants every 3-5 s, or cutting on
   * every 2nd bar with beat lock.
   */
  private circle(mode: number, m: MusicState, g: GlobalParams, dt: number, t: number, w: CameraInput, calm: boolean, speed: number, zoomNow: number, bar: boolean) {
    const c = this.controls
    if (this.prevMode < CAM.tipGlide || this.prevMode === CAM.flight) this.adopt(g)
    // idle drift of the elevation: time, not music, but a still camera stays still
    const wob = calm ? 0 : Math.min(1, speed / 0.2)
    const tgt = this.v2
    this.cutNow = false
    // with a reference the director frames it face-on like framed: seen from its edge a picture is a sliver
    if (mode === CAM.director && !w.ref) return this.direct(m, g, dt, t, w, calm, speed, bar)
    const spread = mode === CAM.tipGlide || mode === CAM.tour ? this.shot(mode, m, t, w, tgt, speed, bar) : -1
    const framed = mode === CAM.framed || mode === CAM.director
    // a reference is a picture: seen from its edge it is a sliver, so these swing around facing it
    const facing = !!w.ref && (framed || mode === CAM.wide)
    const el = facing ? REF_EL : framed ? 0.3 : 0.25 + wob * 0.16 * Math.sin(t * 0.21)
    if (this.cutNow) this.theta += 0.9 // a real cut: new subject, new angle, no glide
    if (facing) {
      this.swing += dt * speed * 0.24
      const want = REF_FACE + REF_SWING * Math.sin(this.swing) - this.rot
      this.theta += wrapPi(want - this.theta) * (1 - Math.exp(-dt * 1.2))
    } else this.theta += dt * speed * (framed ? 0.12 : mode === CAM.wide ? 0.14 : 0.3)
    this.sEl.to(el, 0.8, dt)
    const az = this.theta + this.manTheta + g.rotNow * 0.5
    const phi = clamp(this.sEl.x + this.manPhi, -1.2, 1.2)
    let distT: number
    let focusTime: number
    if (spread >= 0) {
      distT = Math.max(ctl(c, 'camDistance'), this.fitR(spread, 1.15)) / zoomNow
      focusTime = 1 - 0.85 * ctl(c, 'camSmooth') // tracking response 0..1 → 1 s … 0.15 s
      // a fit that resumes when the tips stop starts from here
      this.fitT = this.sDist.x
      this.fitHold = 1.2
    } else {
      // the whole growth (framed, wide, or a shot with nothing growing), as seen from where the
      // camera is about to be. Framed never breathes with the music's zoom: it is the view that
      // keeps everything in frame.
      tgt.copy(this.center)
      const need = this.viewFit(this.center, sph(this.v3, az, phi, 1), framed ? 1.06 : 1.3, w.minRadius) / (framed ? g.zoom : zoomNow)
      distT = this.hysteresis(mode === CAM.wide ? Math.max(ctl(c, 'camDistance') / zoomNow, need) : need, dt)
      focusTime = framed ? 0.35 : 0.8
    }
    if (this.cutNow) {
      this.focus.set(tgt)
      this.sDist.set(distT)
    } else {
      this.focus.to(tgt, focusTime, dt)
      this.sDist.to(distT, distT > this.sDist.x ? 0.35 : spread >= 0 ? 0.6 : 1.2, dt)
    }
    this.look.copy(this.focus.x).add(this.pan)
    sph(this.pos, az, phi, this.sDist.x * this.zoomS).add(this.look)
  }

  /**
   * Camera distance from `from` along `dir` (unit, toward the camera) at which 95% of the
   * structure samples, 98% of the fresh ones and all of a reference and of the soft surfaces sit inside the frame shrunk by `margin`: each
   * point's own need, from its offset across the view and its depth. Tighter than a bounding
   * sphere, and exactly what the frame shows; never closer than the sphere of `minRadius`.
   */
  private viewFit(from: THREE.Vector3, dir: THREE.Vector3, margin: number, minRadius: number) {
    const cam = this.camera
    const ty = Math.tan((cam.fov * Math.PI) / 360)
    const kx = margin / (ty * cam.aspect * (1 - this.inX))
    const ky = margin / (ty * (1 - this.inY))
    const right = this.v1.crossVectors(Y_AXIS, dir).normalize()
    const up = this.v4.crossVectors(dir, right)
    const need = (pts: Float32Array, n: number, q: number) => {
      if (!n) return 0
      const d = this.dists
      for (let i = 0; i < n; i++) {
        const x = pts[i * 3] - from.x
        const y = pts[i * 3 + 1] - from.y
        const z = pts[i * 3 + 2] - from.z
        const u = Math.abs(x * right.x + y * right.y + z * right.z)
        const v = Math.abs(x * up.x + y * up.y + z * up.z)
        d[i] = x * dir.x + y * dir.y + z * dir.z + Math.max(u * kx, v * ky)
      }
      const s = d.subarray(0, n).sort()
      return s[Math.min(n - 1, Math.round(q * (n - 1)))]
    }
    // the reference box: every corner, not a percentile
    let box = 0
    const b = this.box
    if (b) {
      for (let i = 0; i < 8; i++) {
        const x = (i & 1 ? b.hw : -b.hw) - from.x
        const y = (i & 2 ? b.hh : -b.hh) - from.y
        const z = (i & 4 ? b.hd : -b.hd) - from.z
        const u = Math.abs(x * right.x + y * right.y + z * right.z)
        const v = Math.abs(x * up.x + y * up.y + z * up.z)
        box = Math.max(box, x * dir.x + y * dir.y + z * dir.z + Math.max(u * kx, v * ky))
      }
    }
    // soft surfaces: every sample (they are few, and each is a visible surface, never a stray shoot)
    const sp = this.surf
    for (let i = 0; i < this.surfN; i++) {
      const x = sp[i * 3] - from.x
      const y = sp[i * 3 + 1] - from.y
      const z = sp[i * 3 + 2] - from.z
      const u = Math.abs(x * right.x + y * right.y + z * right.z)
      const v = Math.abs(x * up.x + y * up.y + z * up.z)
      box = Math.max(box, x * dir.x + y * dir.y + z * dir.z + Math.max(u * kx, v * ky))
    }
    return Math.max(this.fitR(minRadius, margin), box, need(this.pts, this.nAll, 0.95), need(this.fpts, this.nFresh, 0.98))
  }

  /**
   * Director (mode 10): framed's fit, cut into shots on the music. Cuts land on a bar hit every
   * few bars (sooner when the music is busy), or on a strong onset when there is no tempo. A drop
   * cuts to wide at once, a breakdown glides into a slow close drift, a build creeps the shot in,
   * and new harmony (a section change) cuts at the next bar. Calm camera or "glides" never cut:
   * shots ease into each other. Silence settles into a slow wide drift.
   */
  private direct(m: MusicState, g: GlobalParams, dt: number, t: number, w: CameraInput, calm: boolean, speed: number, bar: boolean) {
    const arc = m.arc
    const soft = calm || ctl(this.controls, 'dirCuts') > 0
    if (this.prevMode !== CAM.director) {
      // enter on the establishing shot, gliding from wherever the last mode left the camera
      this.dShot = 'wide'
      this.dSince = t
      this.dBars = 0
      this.dDrops = arc.drops
      this.dSection = arc.section
      this.dBreak = arc.breakdown > 0.5
      this.dGlide = GLIDE
    }
    const growingNow = w.plants.some((p) => growing(p, t))
    const sounding = m.energy > 0.03 || m.active.size > 0
    const inBreak = arc.breakdown > 0.5
    let want: Shot | null = null
    // a breakdown only drifts: its shot changes glide
    let hard = !soft && !inBreak
    if (arc.drops !== this.dDrops) {
      this.dDrops = arc.drops
      // a drop seen late (the view was locked, or another mode ran) is only consumed
      if (arc.drop > 0.3) {
        want = 'wide'
        hard = !soft
      }
    }
    if (inBreak && !this.dBreak && !want && this.dShot !== 'close' && this.dShot !== 'low') {
      const drift: Shot = growingNow ? 'close' : this.lowOk ? 'low' : 'wide'
      if (drift !== this.dShot) {
        want = drift
        hard = false
      }
    }
    this.dBreak = inBreak
    if (arc.section !== this.dSection) {
      this.dSection = arc.section
      this.dSectionDue = true
    }
    if (bar) this.dBars++
    let now = want !== null
    // the beat tracker keeps predicting after the music stops: only trust it while something sounds
    const tempo = m.beat.bpm > 0 && m.beat.confidence > 0.2 && sounding
    // "bars per shot" is the middle: calm passages hold twice as long, busy ones half, a breakdown longer still
    const bars = Math.max(1, Math.round(ctl(this.controls, 'dirBars') * (2 - 1.5 * clamp(arc.long * 1.4, 0, 1)) * (1 + arc.breakdown) * (calm ? 2 : 1)))
    const age = t - this.dSince
    if (!now && age >= MIN_SHOT) {
      if (!sounding && !growingNow) {
        // silence: settle into a slow wide drift and stay there
        if (this.dShot !== 'wide' && age >= 4) {
          want = 'wide'
          now = true
          hard = false
        }
      } else if (tempo) now = bar && (this.dBars >= bars || this.dSectionDue)
      else {
        // no tempo: a strong onset once the bars would have passed at 120 bpm, or anyway after twice that
        const sec = bars * 2
        now = (age >= sec && m.onset > 0.6) || age >= 2 * sec
      }
    }
    if (now) {
      this.dShot = want ?? this.pickShot(m, t, growingNow)
      this.dSince = t
      this.dBars = 0
      this.dSectionDue = false
      this.dCuts++
      // always a new angle, so a drop to wide from wide still reads as a cut
      const turn = (0.7 + Math.random() * 0.7) * (Math.random() < 0.5 ? -1 : 1)
      if (hard) {
        this.theta += turn
        this.cutNow = true
        this.dGlide = 0
        this.dTurn = 0
      } else {
        this.dTurn += turn * 0.5
        this.dGlide = GLIDE
      }
    }
    const shot = this.dShot
    const glide = this.dGlide > 0
    this.dGlide = Math.max(0, this.dGlide - dt)
    if (this.dTurn) {
      const d = this.dTurn * (1 - Math.exp(-dt * 1.4))
      this.theta += d
      this.dTurn = Math.abs(this.dTurn - d) < 1e-3 ? 0 : this.dTurn - d
    }
    // a breakdown drifts at half pace; camera speed 0 holds the angle between cuts
    this.theta += dt * SHOT_AZ[shot] * (inBreak ? 0.5 : 1) * speed * 2
    const el = SHOT_EL[shot] + (shot === 'orbit' && !calm ? 0.1 * Math.sin(t * 0.2) : 0)
    if (this.cutNow) this.sEl.set(el)
    else this.sEl.to(el, glide ? 1.3 : 0.8, dt)
    const az = this.theta + this.manTheta + g.rotNow * 0.5
    const phi = clamp(this.sEl.x + this.manPhi, -1.2, 1.2)
    // every shot is measured against the whole growth seen from this angle (framed's fit, a little looser)
    const whole = this.hysteresis(this.viewFit(this.center, sph(this.v3, az, phi, 1), 1.12, w.minRadius) / g.zoom, dt)
    const tgt = this.v2
    let distT: number
    let focusTime = 0.8
    if (shot === 'medium') {
      tgt.copy(this.fresh).lerp(this.center, 0.25)
      distT = clamp(this.fitR(this.quantile(this.fpts, this.nFresh, tgt, 0.9), 1.3) / g.zoom, whole * 0.4, whole * 0.75)
      focusTime = 0.6
    } else if (shot === 'close') {
      const spread = this.shot(CAM.tipGlide, m, t, w, tgt, speed, false)
      if (spread < 0) {
        tgt.copy(this.fresh)
        distT = whole * 0.45
      } else distT = clamp(this.fitR(spread, 1.3) / g.zoom, 1.8, whole * 0.55)
      focusTime = 0.45
    } else {
      tgt.copy(this.center)
      if (shot === 'orbit') tgt.lerp(this.fresh, 0.3)
      distT = whole * (shot === 'wide' ? 1.1 : shot === 'orbit' ? 0.82 : 0.9)
    }
    // a build creeps the shot in over bars; a breakdown's close shots drift nearer
    const push = 1 - (calm ? 0.12 : 0.28) * arc.tension * (shot === 'close' ? 0.6 : 1) - (shot === 'close' || shot === 'low' ? 0.12 * arc.breakdown : 0)
    this.dPush.to(push, 2.5, dt)
    distT *= this.dPush.x
    if (this.cutNow) {
      this.focus.set(tgt)
      this.sDist.set(distT)
    } else {
      this.focus.to(tgt, glide ? Math.max(focusTime, 1.1) : focusTime, dt)
      this.sDist.to(distT, glide ? 1.3 : distT > this.sDist.x ? 0.35 : 1, dt)
    }
    this.look.copy(this.focus.x).add(this.pan)
    sph(this.pos, az, phi, this.sDist.x * this.zoomS).add(this.look)
  }

  /** A floor or cave (the environment) would hide the growth from a low angle. */
  private get lowOk() {
    return ctl(this.controls, 'env') === 0
  }

  /** The director's next shot: weighted by what there is to see and where the music is, never the current one. */
  private pickShot(m: MusicState, t: number, growingNow: boolean): Shot {
    const arc = m.arc
    const wt: Record<Shot, number> = { wide: 1, medium: this.nFresh >= 6 ? 1.2 : 0, close: growingNow ? 1 : 0, orbit: 0.7, low: this.lowOk ? 0.6 : 0 }
    // one note held a while is a melody line: follow its tip
    if (m.active.size === 1) for (const n of m.active.values()) if (t - n.t0 > 1.5) wt.close *= 3
    wt.medium *= 1 + 1.5 * arc.tension
    wt.close *= 1 + arc.tension + 1.5 * arc.breakdown
    wt.low *= 1 + arc.breakdown
    wt.wide *= Math.max(0.2, 1 + 0.6 * arc.long - 0.5 * arc.breakdown)
    wt.orbit *= 1 + 0.8 * arc.long
    wt[this.dShot] = 0
    let r = 0
    for (const s of SHOTS) r += wt[s]
    r *= Math.random()
    for (const s of SHOTS) {
      if (wt[s] <= 0) continue
      r -= wt[s]
      if (r <= 0) return s
    }
    return this.dShot === 'wide' ? 'orbit' : 'wide'
  }

  /** Zoom out as soon as the growth outgrows the frame (with 6% headroom); zoom in only after it has fitted for 1.2 s. */
  private hysteresis(need: number, dt: number) {
    if (need > this.fitT) {
      this.fitT = need * 1.06
      this.fitHold = 1.2
    } else if ((this.fitHold -= dt) <= 0) this.fitT += (need * 1.06 - this.fitT) * (1 - Math.exp(-dt * 0.5))
    return this.fitT
  }

  /** Entering the circling modes: start the springs at the current view, so nothing jumps. */
  private adopt(g: GlobalParams) {
    const off = this.v1.subVectors(this.pos, this.look)
    const d = Math.max(0.5, off.length())
    this.focus.set(this.v3.copy(this.look).sub(this.pan))
    this.zoomS = this.zoomMul
    this.sDist.set(d / Math.max(0.2, this.zoomS))
    this.fitT = this.sDist.x
    this.fitHold = 1.2
    this.sEl.set(Math.asin(clamp(off.y / d, -1, 1)) - this.manPhi)
    this.theta = Math.atan2(off.z, off.x) - this.manTheta - g.rotNow * 0.5
  }

  /**
   * Tip glide / tour subject: the centre of the active tips (tip glide: of the 3 newest growing
   * plants, the newest weighted most, so it does not jump with every new branch). Returns their
   * weighted RMS spread (a close shot keeps the bulk of the tips, not every stray one in view),
   * or -1 when nothing grows.
   */
  private shot(mode: number, m: MusicState, t: number, w: CameraInput, out: THREE.Vector3, speed: number, bar: boolean): number {
    const plants = w.plants
    out.set(0, 0, 0)
    if (mode === CAM.tipGlide) {
      let wsum = 0
      let k = 0
      for (let i = plants.length - 1; i >= 0 && k < 3; i--) {
        const p = plants[i]
        if (!growing(p, t)) continue
        const wp = 1 / (1 << k)
        for (const tip of p.tips) out.addScaledVector(tipPos(tip, this.v1), wp / p.tips.length)
        wsum += wp
        k++
      }
      if (!k) return -1
      out.divideScalar(wsum)
      let ss = 0
      for (let i = plants.length - 1, j = 0; i >= 0 && j < k; i--) {
        const p = plants[i]
        if (!growing(p, t)) continue
        const wp = 1 / (1 << j) / p.tips.length
        for (const tip of p.tips) ss += tipPos(tip, this.v1).distanceToSquared(out) * wp
        j++
      }
      return Math.sqrt(ss / wsum)
    }
    // tour: hold a plant, then move to the one visited longest ago (never visited first, newest on ties)
    const cur = this.tourPlant
    const alive = !!cur && growing(cur, t) && plants.includes(cur)
    const beatLock = ctl(this.controls, 'beatLock') > 0 && m.beat.bpm > 0
    let next = !alive
    let cut = false
    if (alive && beatLock) {
      if (bar && ++this.tourBars >= 2) next = cut = true
    } else if (alive && t - this.tourSince >= 3 + 2 * (1 - Math.min(2, speed) / 2)) next = true
    if (next) {
      let pick: Plant | null = null
      let best = Infinity
      let big = false
      for (let i = plants.length - 1; i >= 0; i--) {
        const p = plants[i]
        if (!growing(p, t)) continue
        const isBig = p.segs.length >= 8 // a plant with something to see beats a fresh sprout
        const v = this.visited.get(p) ?? -Infinity
        if ((isBig && !big) || (isBig === big && v < best)) {
          pick = p
          best = v
          big = isBig
        }
      }
      if (pick) {
        this.cutNow = cut && pick !== cur
        this.tourPlant = pick
        this.visited.set(pick, t)
        this.tourSince = t
        this.tourBars = 0
      }
    }
    const p = this.tourPlant
    if (!p || !growing(p, t)) return -1
    for (const tip of p.tips) out.add(tipPos(tip, this.v1))
    out.divideScalar(p.tips.length)
    let ss = 0
    for (const tip of p.tips) ss += tipPos(tip, this.v1).distanceToSquared(out)
    return Math.sqrt(ss / p.tips.length)
  }

  /**
   * Flight: forward for ever along a gently wandering path. The heading turns at a rate that
   * wanders (yaw) and leans up and down a little (pitch, eased toward a wandering level), the view
   * banks into each turn, and the speed follows camera speed (the Motion macro), the energy, the
   * tempo and the hits through a spring: no cut, no jolt. The path's clock runs slower when the
   * flight does, so a slow flight is not a tight spiral. Calm camera: a steady speed.
   */
  private fly(m: MusicState, dt: number, w: CameraInput, calm: boolean, speed: number) {
    const c = this.controls
    const h = this.heading
    if (this.prevMode !== CAM.flight) {
      // carry on along whatever the view faced, nearly level
      const f = this.v1.subVectors(this.look, this.pos)
      if (f.lengthSq() < 1e-8) f.copy(h)
      f.normalize()
      this.yaw = Math.atan2(f.z, f.x)
      this.sPitch.set(clamp(Math.asin(clamp(f.y, -1, 1)), -0.5, 0.5))
      this.sRoll.set(0)
      this.flyE = m.energy
    }
    const react = calm ? 0 : ctl(c, 'flightReact')
    this.flyE += ((calm ? 0.35 : m.energy) - this.flyE) * (1 - Math.exp(-dt * 1.5))
    // the beat tracker keeps predicting after the music stops: only trust it while something sounds
    const sounding = m.energy > 0.03 || m.active.size > 0
    const tempo = m.beat.bpm > 0 && m.beat.confidence > 0.2 && sounding ? clamp(m.beat.bpm / 110, 0.7, 1.5) : 1
    const want = speed * FLY_BASE * Math.max(0.2, 1 + react * (tempo - 1 + 1.6 * this.flyE + 0.7 * w.hitEnv))
    this.sSpeed.to(want, 0.9, dt)
    const v = Math.max(0, this.sSpeed.x)
    this.flySpeed = v
    this.flyT += dt * (0.3 + 0.7 * Math.min(2, v / FLY_BASE))
    const amt = ctl(c, 'flightWander')
    const T = this.flyT
    const turn = amt * FLY_TURN * wander(T, 0)
    this.yaw += turn * dt
    this.sPitch.to(amt * FLY_PITCH * wander(T * 0.8, 1.7), 2.5, dt)
    // bank into the turn (a rising yaw turns right: right = heading × up), and a slow sway of its own
    this.sRoll.to(ctl(c, 'flightRoll') * (FLY_BANK * turn + 0.1 * wander(T * 0.55, 3.1)), 1.2, dt)
    const p = this.sPitch.x
    h.set(Math.cos(this.yaw) * Math.cos(p), Math.sin(p), Math.sin(this.yaw) * Math.cos(p))
    this.pos.addScaledVector(h, v * dt)
    this.look.copy(this.pos).addScaledVector(h, 6)
  }

  /** Weave / tunnel / drift / sit / flight: manual orbit turns the view, pan shifts it, zoom dollies along it. */
  private flyThroughOffsets(pos: THREE.Vector3, look: THREE.Vector3) {
    if (!this.manTheta && !this.manPhi && Math.abs(this.zoomS - 1) < 1e-4 && !this.pan.lengthSq()) return
    const dir = this.v1.subVectors(look, pos)
    const len = dir.length() || 1
    dir.applyAxisAngle(Y_AXIS, -this.manTheta)
    const right = this.v3.crossVectors(dir, Y_AXIS)
    if (right.lengthSq() > 1e-8) {
      const pitched = this.v2.copy(dir).applyAxisAngle(right.normalize(), -this.manPhi)
      if (Math.abs(pitched.y) < 0.98 * len) dir.copy(pitched) // never tip over the pole
    }
    pos.add(this.pan).addScaledVector(dir, (-(this.zoomS - 1) * 3) / len)
    look.copy(pos).add(dir)
  }
}
