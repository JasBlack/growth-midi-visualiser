// 3D reference growth: a picture, video or camera (VideoField) becomes a 2.5D luminance relief
// the Organism grows onto. XY is the picture plane, centred on the origin and videoSize wide;
// z = (brightness − 0.5) × depth, flipped by Invert. Tips are steered along and toward the
// picture's lines, new growths start on it, and growth made while it guides is anchored in
// picture coordinates, so it follows live frames and Size / Depth / Invert changes. Build shape
// adds a quiet background fill that grows without music.

import * as THREE from 'three'
import { ctl } from '../../engine'
import type { EngineControl, GlobalParams } from '../../engine'
import type { MusicState } from '../../music'
import type { VideoField } from '../../videoField'
import type { RefBox } from './camera'
import type { FeatureControl, OrganismFeature, OrganismHost } from './feature'
import type { Plant, RefAnchor, Seg, Tip } from './types'

/** Saved values are indices: never reorder. 4 was "mimic" (v0.15); it now fills the relief. */
export const REFERENCE_MODES = ['off', 'depth — growth rides the relief', 'lines — growth traces the edges', 'depth + lines', '3D shape — fill the reference relief']

/** Anchored segments re-placed per follow tick (at most 30 ticks a second): big scenes follow in batches. */
const PASS = 4000
/** A step climbs at most this much relief per unit of length: a cliff is ramped over a few segments. */
const CLIMB = 1.5
/** Build shape: new background growths per second, how long each grows, how many build at once. */
const BUILD_RATE = 0.8
const BUILD_LIFE = 2
const BUILD_LIVE = 4
/** Build shape pauses here, leaving the rest of the budget to the music. */
const BUILD_SEGS = 16000
const BUILD_BUDGET = 0.8

const clamp = (x: number, a: number, b: number) => (x < a ? a : x > b ? b : x)
const clamp01 = (x: number) => clamp(x, 0, 1)

/** What the reference needs from the engine beyond OrganismHost. */
export interface ReferenceHooks {
  /** re-write a segment's instance after its ends moved */
  writeSeg(seg: Seg): void
  /** Build shape: a background growth rooted at `root`, growing until `until`, without sound-back */
  seed(root: THREE.Vector3, until: number, t: number, g: GlobalParams): Plant
  /** stop a growth for good (its finished segments stay) */
  release(p: Plant, t: number): void
  /** the segment budget */
  budget(): number
  /** a new source started guiding: frame it */
  fit(): void
}

const V = 'Video'

export class ReferenceGuide implements OrganismFeature {
  readonly id = 'reference'
  readonly controls: FeatureControl[] = [
    { key: 'videoMode', label: 'reference guides growth', min: 0, max: 4, step: 1, value: 0, options: REFERENCE_MODES, group: V },
    { key: 'videoSize', label: 'video: how wide the picture is', min: 4, max: 60, step: 1, value: 22, group: V },
    { key: 'videoDepth', label: 'video: how deep the relief is', min: 0, max: 25, step: 0.5, value: 8, group: V },
    { key: 'videoInvert', label: 'invert relief depth: dark comes forward (0 / 1)', min: 0, max: 1, step: 1, value: 0, group: V },
    { key: 'videoEdge', label: 'video: how hard growth clings to lines', min: 0, max: 3, step: 0.05, value: 1.2, group: V },
    { key: 'videoStick', label: 'video: how tightly growth hugs the surface', min: 0, max: 1, step: 0.05, value: 0.9, group: V },
    { key: 'videoSpawn', label: 'video: new growth starts on the subject (0 / 1)', min: 0, max: 1, step: 1, value: 1, group: V },
    { key: 'videoScatter', label: 'new strand spread (0 = favour details, 1 = anywhere)', min: 0, max: 1, step: 0.05, value: 0.7, group: V },
    { key: 'videoFollow', label: 'existing growth follows live frames (0 / 1)', min: 0, max: 1, step: 1, value: 1, group: V },
    { key: 'videoBuild', label: 'build the shape without music (0 / 1)', min: 0, max: 1, step: 1, value: 0, group: V },
    { key: 'videoShow', label: 'video: show the picture behind (0 = hidden)', min: 0, max: 1, step: 0.05, value: 0.55, group: V },
  ]

  field: VideoField | null = null
  /** control snapshot: growth reads these per segment, far too often for a lookup each */
  private readonly s = { mode: 0, size: 22, depth: 8, sign: 1, edge: 1.2, stick: 0.9, spawn: true, scatter: 0.7, follow: true, build: false, show: 0.55, maxLive: 24 }
  /** world size of the picture plane */
  private W = 22
  private H = 22 / (16 / 9)
  // follow: what the anchored growth was last placed for, and the batched pass
  private readonly sig = [NaN, NaN, NaN, NaN, NaN]
  private pending = false
  private dirty = false
  private wasLive = false
  private cursor = 0
  private sweepRev = -1
  private passT = -Infinity
  private fitGen = -1
  private seedT: number | null = null
  // backdrop: one plane and material for the engine's life, a texture per source
  private mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial> | null = null
  private tex: THREE.Texture | null = null
  private texGen = -1
  private readonly boxOut: RefBox = { hw: 0, hh: 0, hd: 0 }
  private readonly g2 = { x: 0, y: 0 }

  constructor(
    private readonly engineControls: EngineControl[],
    private readonly hooks: ReferenceHooks,
  ) {}

  setField(f: VideoField | null) {
    this.field = f
    this.refresh()
  }

  /** A source is analysed and guidance is on. */
  get on() {
    return !!this.field?.ready && this.s.mode > 0
  }

  /** The picture's box (centred on the origin) while it guides growth, for the camera; reused object. */
  box(): RefBox | null {
    if (!this.on) return null
    const b = this.boxOut
    b.hw = this.W / 2
    b.hh = this.H / 2
    b.hd = this.s.depth / 2 + 0.6 // the backdrop sits 0.6 behind the deepest relief
    return b
  }

  /** HUD: how much of a picture's linework the growth has traced. */
  statsNote() {
    const f = this.field
    return f && this.on && f.isStill ? ` · picture ${Math.round(f.coverage() * 100)}%` : ''
  }

  private refresh() {
    const c = this.engineControls
    const s = this.s
    s.mode = ctl(c, 'videoMode')
    s.size = ctl(c, 'videoSize')
    s.depth = ctl(c, 'videoDepth')
    s.sign = ctl(c, 'videoInvert') > 0 ? -1 : 1
    s.edge = ctl(c, 'videoEdge')
    s.stick = ctl(c, 'videoStick')
    s.spawn = ctl(c, 'videoSpawn') > 0
    s.scatter = ctl(c, 'videoScatter')
    s.follow = ctl(c, 'videoFollow') > 0
    s.build = ctl(c, 'videoBuild') > 0
    s.show = ctl(c, 'videoShow')
    s.maxLive = ctl(c, 'maxLive')
    this.measure()
  }

  private measure() {
    this.W = this.s.size
    this.H = this.s.size / (this.field?.aspect || 16 / 9)
  }

  // ------------------------------------------------------------ the relief

  /** Height of relief brightness r (flat in "lines" mode). */
  private zOf(r: number) {
    const s = this.s
    return s.mode === 2 ? 0 : (r - 0.5) * s.depth * s.sign
  }

  /** Height of the relief at picture coordinates. */
  z(u: number, v: number) {
    return this.field ? this.zOf(this.field.depth(u, v)) : 0
  }

  /** Relief height under world (x, y), held inside the picture (soft surfaces lie on it). */
  reliefZ(x: number, y: number) {
    return this.z(clamp01(x / this.W + 0.5), clamp01(0.5 - y / this.H))
  }

  /**
   * Pull a point onto the picture (XY kept inside it) and its relief, and hand back the surface
   * normal (central differences over one analysis texel).
   */
  project(p: THREE.Vector3, nOut: THREE.Vector3) {
    const f = this.field
    if (!f) return
    const W = this.W
    const H = this.H
    p.x = clamp(p.x, -W * 0.499, W * 0.499)
    p.y = clamp(p.y, -H * 0.499, H * 0.499)
    const u = p.x / W + 0.5
    const v = 0.5 - p.y / H
    const stick = this.s.mode === 4 ? 1 : this.s.stick
    p.z += (this.z(u, v) - p.z) * stick
    const du = 1 / Math.max(2, f.w)
    const dv = 1 / Math.max(2, f.h)
    const dx = (this.z(u + du, v) - this.z(u - du, v)) / (2 * du * W)
    const dy = (this.z(u, v + dv) - this.z(u, v - dv)) / (2 * dv * H)
    nOut.set(-dx, dy, 1).normalize() // + because v runs opposite to y
  }

  /**
   * A tip's next segment under guidance: from `from` along `dir` for `len`, reflected at the
   * picture's border instead of pinned to it, projected onto the relief, and climbing a depth
   * cliff by at most CLIMB × len, so a tip crossing an edge ramps up over a few segments rather
   * than bridging it with a spear (or dying there, as v0.19 did). Writes `b` and the unit
   * `dir`; returns the step length.
   */
  step(from: THREE.Vector3, dir: THREE.Vector3, len: number, b: THREE.Vector3, nOut: THREE.Vector3): number {
    const hw = this.W * 0.499
    const hh = this.H * 0.499
    b.copy(from).addScaledVector(dir, len)
    if (Math.abs(from.x) <= hw && Math.abs(from.y) <= hh) {
      if (Math.abs(b.x) > hw && b.x * dir.x > 0) dir.x = -dir.x
      if (Math.abs(b.y) > hh && b.y * dir.y > 0) dir.y = -dir.y
      b.copy(from).addScaledVector(dir, len)
    }
    this.project(b, nOut)
    // a tip still off the picture (it was growing before guidance began) walks onto it, no jump
    const dx = b.x - from.x
    const dy = b.y - from.y
    const dxy = Math.hypot(dx, dy)
    if (dxy > 2 * len) {
      b.x = from.x + (dx / dxy) * len
      b.y = from.y + (dy / dxy) * len
    }
    const lim = CLIMB * len
    b.z = from.z + clamp(b.z - from.z, -lim, lim)
    dir.subVectors(b, from)
    const l = dir.length()
    if (l < 1e-6) {
      // pinned in a corner: head back across the picture
      dir.set(-from.x, -from.y, 0)
      if (dir.lengthSq() < 1e-12) dir.set(1, 0, 0)
      dir.normalize()
      return 0.02
    }
    dir.divideScalar(l)
    return Math.max(0.02, l)
  }

  /** Steer a tip along the lines in the picture, and toward them. */
  steer(pos: THREE.Vector3, dir: THREE.Vector3, out: THREE.Vector3) {
    const f = this.field
    const mode = this.s.mode
    if (!f || mode === 1) return
    let strength = this.s.edge
    if (strength <= 0) return
    const u = pos.x / this.W + 0.5
    const v = 0.5 - pos.y / this.H
    if (mode === 4) strength *= 1.6
    f.grad(u, v, this.g2)
    const gx = this.g2.x
    const gy = this.g2.y
    const mag = Math.hypot(gx, gy)
    if (mag > 0.05) {
      // the line runs perpendicular to the image gradient; take whichever way agrees with the tip
      let tx = gy
      let ty = gx
      if (tx * dir.x + ty * dir.y < 0) {
        tx = -tx
        ty = -ty
      }
      const k = (strength * Math.min(1, mag)) / Math.hypot(tx, ty, 1e-6)
      out.x += tx * k
      out.y += ty * k
    }
    // and climb toward stronger lines, so growth finds them and stays on them
    const e = 0.02
    const ex = f.edge(u + e, v) - f.edge(u - e, v)
    const ey = f.edge(u, v + e) - f.edge(u, v - e)
    out.x += ex * strength * 1.5
    out.y += -ey * strength * 1.5
  }

  /** A new growth's root: on the picture's lines or relief (videoSpawn), otherwise anywhere on it. */
  pickRoot(out: THREE.Vector3) {
    const f = this.field!
    const pick = this.s.spawn ? f.pickPoint(this.s.mode !== 1) : { u: Math.random(), v: Math.random() }
    out.set((pick.u - 0.5) * this.W, (0.5 - pick.v) * this.H, this.z(pick.u, pick.v))
  }

  // ------------------------------------------------------------ anchors

  /** Hold a point in picture coordinates, with its height above the relief. */
  private anchor(p: THREE.Vector3): RefAnchor {
    const f = this.field!
    const u = clamp01(p.x / this.W + 0.5)
    const v = clamp01(0.5 - p.y / this.H)
    const r = f.depth(u, v)
    return { u, v, r, h: p.z - this.zOf(r), gen: f.generation }
  }

  /**
   * Put an anchored point back: XY for the current size, z on the relief it was last placed
   * on (Size / Depth / Invert rescale it), or on the live frame's relief when following.
   */
  private place(p: THREE.Vector3, a: RefAnchor, live: boolean) {
    if (live) a.r = this.field!.depth(a.u, a.v)
    p.set((a.u - 0.5) * this.W, (0.5 - a.v) * this.H, this.zOf(a.r) + a.h)
  }

  /** A segment grown from a tip shares the tip's anchor, so the joint stays closed when it follows. */
  join(tip: Tip, seg: Seg) {
    const a = tip.anchor
    if (a && seg.anchor && a.gen === seg.anchor.a.gen) seg.anchor.a = a
  }

  // ------------------------------------------------------------ feature hooks

  mount() {
    this.refresh()
  }

  onControl(key: string) {
    if (key.startsWith('video') || key === 'maxLive') this.refresh()
  }

  onPlantCreated(p: Plant) {
    if (!this.on || p.isText) return
    const a = (p.rootAnchor = this.anchor(p.root))
    for (const tip of p.tips) tip.anchor = a
  }

  onSegmentAdded(seg: Seg) {
    const p = seg.plant
    // typography keeps its letterforms: never anchored, never flattened onto the relief
    if (!this.on || p.isText) return
    // from the segment's own copies: callers pass scratch vectors that later code reuses (v0.17.1)
    const b = this.anchor(seg.b)
    seg.anchor = { a: this.anchor(seg.a), b }
    p.rootAnchor ??= this.anchor(p.root)
    this.field!.visit(b.u, b.v)
  }

  /** The growth was wiped (Reset, a cycle reset): nothing of the picture is drawn any more. */
  resetGrowth() {
    this.cursor = 0
    this.seedT = null
    this.field?.resetCoverage()
  }

  beforeFrame(_m: MusicState, g: GlobalParams, _dt: number, t: number, e: OrganismHost) {
    this.refresh()
    const f = this.field
    if (!f) return
    f.seedScatter = this.s.scatter
    if (this.s.mode > 0) f.update(t) // guidance off: no analysis
    this.measure() // a new source can change the aspect
    this.backdrop(e.scene)
    if (!this.on) {
      this.releaseAuto(t, e)
      return
    }
    if (this.fitGen !== f.generation) {
      this.fitGen = f.generation
      this.hooks.fit()
    }
    this.follow(t, e)
    this.build(g, t, e)
  }

  unmount(e: OrganismHost) {
    if (this.mesh) {
      e.scene.remove(this.mesh)
      this.mesh.geometry.dispose()
      this.mesh.material.dispose()
      this.mesh = null
    }
    // a VideoTexture keeps a frame callback on the shared <video> until disposed
    this.tex?.dispose()
    this.tex = null
  }

  // ------------------------------------------------------------ per frame

  /**
   * Re-place the current source's anchored growth when what it was placed for changed: Size,
   * Depth, Invert or flat lines, or a new live frame (Follow on). A still never re-places for its
   * own sake, and growth from an earlier source keeps its shape. At most PASS segments per tick,
   * 30 ticks a second.
   */
  private follow(t: number, e: OrganismHost) {
    const f = this.field!
    const s = this.s
    const sig = this.sig
    const flat = s.mode === 2 ? 1 : 0
    if (sig[0] !== this.W || sig[1] !== this.H || sig[2] !== s.depth || sig[3] !== s.sign || sig[4] !== flat) {
      sig[0] = this.W
      sig[1] = this.H
      sig[2] = s.depth
      sig[3] = s.sign
      sig[4] = flat
      this.pending = true
      this.cursor = 0
    }
    const live = s.follow && !f.isStill
    if (live && (!this.wasLive || f.revision !== this.sweepRev)) this.dirty = true
    this.wasLive = live
    if ((!this.pending && !this.dirty) || t - this.passT < 1 / 30) return
    this.passT = t
    const gen = f.generation
    const segs = e.segs
    const n = segs.length
    if (this.cursor >= n) this.cursor = 0
    if (this.cursor === 0) this.sweepRev = f.revision
    let i = this.cursor
    for (const end = Math.min(n, i + PASS); i < end; i++) {
      const sg = segs[i]
      const an = sg.anchor
      if (!an || an.b.gen !== gen) continue
      this.place(sg.a, an.a, live)
      this.place(sg.b, an.b, live)
      this.hooks.writeSeg(sg)
    }
    if (i >= n) {
      this.cursor = 0
      this.pending = this.dirty = false
    } else this.cursor = i
    for (const p of e.plants) {
      const ra = p.rootAnchor
      if (ra?.gen === gen) this.place(p.root, ra, live)
      for (const tip of p.tips) {
        if (tip.seg) {
          if (tip.seg.anchor?.b.gen === gen) tip.pos.copy(tip.seg.a)
        } else if (tip.anchor?.gen === gen) this.place(tip.pos, tip.anchor, live)
      }
    }
  }

  /** Build shape: bounded background growth without music (rate, lifetime, how many at once, budget). */
  private build(g: GlobalParams, t: number, e: OrganismHost) {
    if (!this.s.build) {
      this.releaseAuto(t, e)
      this.seedT = null
      return
    }
    // music-led first: every building growth counts, so the fill waits while you play
    let active = 0
    for (const p of e.plants) if (p.held || p.autoUntil > t) active++
    if (active >= Math.min(BUILD_LIVE, this.s.maxLive) || e.segs.length >= Math.min(BUILD_SEGS, this.hooks.budget() * BUILD_BUDGET)) return
    if (this.seedT === null) {
      this.seedT = t // the first one waits a beat too
      return
    }
    if (t - this.seedT < 1 / BUILD_RATE) return
    this.seedT = t
    const f = this.field!
    const uv = f.pickPoint(true)
    const root = new THREE.Vector3((uv.u - 0.5) * this.W, (0.5 - uv.v) * this.H, this.z(uv.u, uv.v))
    this.hooks.seed(root, t + BUILD_LIFE, t, g)
    f.visit(uv.u, uv.v)
  }

  private releaseAuto(t: number, e: OrganismHost) {
    for (const p of e.plants) if (p.refAuto && (p.held || p.autoUntil > t)) this.hooks.release(p, t)
  }

  /** The picture behind the relief: one double-sided plane, so it shows from the front and from behind. */
  private backdrop(scene: THREE.Scene) {
    const f = this.field
    if (this.tex && !f?.active) {
      // the source stopped: let the texture (and a video's frame callback) go
      if (this.mesh) this.mesh.material.map = null
      this.tex.dispose()
      this.tex = null
    }
    const show = this.s.show
    if (!f || !this.on || show <= 0) {
      if (this.mesh) this.mesh.visible = false
      return
    }
    if (!this.tex || this.texGen !== f.generation) {
      // a texture per source: a new picture reuses the same canvas, possibly at another size
      this.tex?.dispose()
      this.tex = f.isStill ? new THREE.CanvasTexture(f.still) : new THREE.VideoTexture(f.video)
      this.tex.colorSpace = THREE.SRGBColorSpace
      this.texGen = f.generation
    }
    if (!this.mesh) {
      const mat = new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, toneMapped: false, fog: false, side: THREE.DoubleSide })
      this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat)
      this.mesh.raycast = () => {}
      this.mesh.frustumCulled = false
      scene.add(this.mesh)
    }
    const mat = this.mesh.material
    if (mat.map !== this.tex) {
      mat.map = this.tex
      mat.needsUpdate = true
    }
    mat.opacity = show
    this.mesh.scale.set(this.W, this.H, 1)
    this.mesh.position.z = -this.s.depth / 2 - 0.6
    this.mesh.visible = true
  }
}
