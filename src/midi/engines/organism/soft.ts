// Soft species: a plant of one of these draws ONE deforming surface (a blob, a ribbon, a sheet,
// a bell, a torus …) instead of its tubes. The skeleton stays and does what it always did (it
// grows while the note is held, retracts, ages into permanence and counts against the budget),
// but its instances are hidden while a surface stands for it, and the surface's size follows the
// skeleton's grown length, so it grows and shrinks with its note.
//
// v0.17-v0.18 shipped this with BackSide materials (sheets culled from the front), a non-indexed
// icosphere (flat normals: a faceted liquid) and every shape on world axes from its root (a chord
// became a row of identical upright strips). Here: DoubleSide, indexed grids with shared seams
// and one normal per pole, and each surface leaning along its own first shoot, rolled by its note.
//
// The chrome species (the Webs ribbons, opt-in) draw in mirror chrome with a thin-film sheen whatever
// the growth shader: on the haze world they reflect its light in blue-violet and pink.
//
// CPU cost is bounded: a fixed grid per plant rewritten in place, at most UPDATES rewrites a
// frame round-robin (each surface ~30 Hz, its normals ~15 Hz), at most MAX_SURFACES surfaces
// (further soft plants show their plain skeleton until one frees). Between rewrites the mesh
// transform (root, orientation, size, attack bloom) still moves every frame.

import * as THREE from 'three'
import { MeshPhysicalNodeMaterial, MeshStandardNodeMaterial } from 'three/webgpu'
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { ctl } from '../../engine'
import type { GlobalParams } from '../../engine'
import type { MusicState } from '../../music'
import { octave, pitchClass } from '../../music'
import { attribute, dot, float, min, mix, mx_noise_float, output, positionLocal, smoothstep, vec3, vec4 } from 'three/tsl'
import { GROWTH_SHADERS, SEG_DATA, chromeEnvironment, reactify, uLight } from '../../shaders'
import { breathShareOf } from './breath'
import { noteCode } from './conduction'
import type { RefBox } from './camera'
import type { FeatureControl, OrganismFeature, OrganismHost } from './feature'
import type { Plant, Seg, SoftKind, Species } from './types'

/** Geometry rewrites per frame, shared by every surface (a new surface's first one included). */
const UPDATES = 16
/** Surfaces at once; later soft plants keep their skeleton until one frees. */
const MAX_SURFACES = 64
/** Fine grids while fewer surfaces than this exist (the liquid is then a detail-8 icosphere, 812 vertices). */
const FINE_BELOW = 16
const REWRITE = 1 / 30
const RENORMAL = 1 / 15
/** a frame early is on time (60 fps then rewrites every 2nd frame, not every 2nd or 3rd) */
const SLACK = 0.004
/** framing points handed to the camera: each surface's bounding-box corners (8 × MAX_SURFACES) */
const SAMPLES = 512
/** On a reference relief: how much of a shape's depth survives, and its lift off the picture. */
const FLAT = 0.35
const LIFT = 0.04

// ------------------------------------------------------------ species

type Skeleton = Pick<Species, 'segLen' | 'thickness' | 'taper' | 'branch' | 'branchTaper' | 'branchAngle' | 'wiggle' | 'gravity' | 'radial' | 'maxTips' | 'maxDepth' | 'speed' | 'avoid' | 'join'>
/** v0.17's three: a few long, thin, nearly straight wandering strands (the surface's size comes from their length) */
const STRANDS_A: Skeleton = { segLen: 0.22, thickness: 0.7, taper: 0.997, branch: 0.035, branchTaper: 0.92, branchAngle: [0.12, 0.4], wiggle: 0.35, gravity: 0, radial: 0.05, maxTips: 4, maxDepth: 140, speed: 0.8, avoid: 0.1, join: 0.2 }
/** v0.18's ten */
const STRANDS_B: Skeleton = { segLen: 0.24, thickness: 0.65, taper: 0.998, branch: 0.025, branchTaper: 0.92, branchAngle: [0.12, 0.35], wiggle: 0.3, gravity: 0, radial: 0, maxTips: 3, maxDepth: 140, speed: 0.75, avoid: 0.1, join: 0.15 }
const soft = (name: string, icon: string, kind: SoftKind, hue: number, s: Skeleton): Species => ({
  name,
  icon,
  hue,
  soft: kind,
  ...s,
  turn: 'smooth',
  turnAngle: 0,
  node: 'none',
  nodeScale: 0,
  glow: 0,
  brighten: 0,
})

/** Species 24-36, in v0.17-v0.19's order (settings and presets address species by index: never reorder). */
export const SOFT_SPECIES: Species[] = [
  soft('liquid', '🫧', 'liquid', 0.08, STRANDS_A),
  soft('silk ribbon', '🎀', 'ribbon', 0.32, STRANDS_A),
  soft('wave blanket', '🏳️', 'blanket', 0.56, STRANDS_A),
  soft('jelly bell', '🎐', 'jelly', 0.14, STRANDS_B),
  soft('kelp frond', '🥬', 'kelp', 0.28, STRANDS_B),
  soft('manta sail', '⛵', 'manta', 0.43, STRANDS_B),
  soft('spiral streamer', '➰', 'spiral', 0.56, STRANDS_B),
  soft('breathing torus', '⭕', 'torus', 0.7, STRANDS_B),
  soft('wave tube', '🧪', 'tube', 0.82, STRANDS_B),
  soft('anemone fan', '🐚', 'fan', 0.06, STRANDS_B),
  soft('pleated silk', '👘', 'pleats', 0.36, STRANDS_B),
  soft('liquid droplet', '💧', 'droplet', 0.62, STRANDS_B),
  soft('ripple disc', '💿', 'disc', 0.92, STRANDS_B),
]

/** the chrome ribbons' skeleton: a few long strands that grow fast, so a ribbon sweeps out within its note */
const STRANDS_C: Skeleton = { segLen: 0.3, thickness: 0.7, taper: 0.998, branch: 0.02, branchTaper: 0.92, branchAngle: [0.12, 0.35], wiggle: 0.3, gravity: 0, radial: 0, maxTips: 3, maxDepth: 160, speed: 1.4, avoid: 0.1, join: 0 }

/** Species 38-39 (the Webs ribbons): appended after the threads (37), off until toggled. */
export const CHROME_SPECIES: Species[] = [
  { ...soft('chrome ribbon', '🪞', 'ribbon', 0.62, STRANDS_C), chrome: true, optIn: true },
  { ...soft('chrome coil', '➿', 'spiral', 0.7, STRANDS_C), chrome: true, optIn: true },
]
/** chrome finishes (linear): cool silver mirror most often (white to navy in the haze), pink, and glossy black */
const CHROME_TINTS: [number, number, number, number][] = [
  [0.8, 0.84, 0.98, 0.55],
  [0.95, 0.58, 0.66, 0.25],
  [0.045, 0.045, 0.055, 0.2],
]
/** the chrome's thin film (nm): thinnest, thickest */
const FILM = [230, 350] as const
/** the chrome's brightest (linear, before tone mapping): on a dark world, on a light one */
const CHROME_CAP = [1, 2.4] as const
/** share of the growth glows (reactify's emissive) a chrome surface keeps */
const CHROME_GLOW = 0.2
/** A chrome finish for a new chrome growth (rand in 0..1), written into `out`. */
export function chromeTint(rand: number, out: THREE.Color) {
  let r = rand
  for (const [cr, cg, cb, w] of CHROME_TINTS) {
    if (r < w) return out.setRGB(cr, cg, cb)
    r -= w
  }
  const [cr, cg, cb] = CHROME_TINTS[0]
  return out.setRGB(cr, cg, cb)
}

// ------------------------------------------------------------ forms

/** One rewrite's inputs (a reused object). */
interface FormIn {
  size: number
  /** the soft clock plus the plant's phase */
  t: number
  wave: number
  /** smoothed bass / treble response, the idle floor in silence */
  e: number
  /** attack: the plant's own note-on, then onsets while it is held */
  k: number
  /** v0.18's deformation amplitude wave × (0.15 + 0.4 e), plus the attack */
  amp: number
  /** spatial frequency: higher notes ripple finer */
  f: number
  /** 1 for a chrome species: its ribbon twists tighter and curls across its width */
  chrome: number
}

/**
 * Local position of grid point (u, v) ∈ [-.5, .5]² (the liquid: unit-sphere point (u, v, w)),
 * already × size. The root is the origin and the growth runs along +y; sheets face +z.
 */
type FormFn = (u: number, v: number, w: number, p: FormIn, o: Float32Array, i: number) => void

interface Form {
  /** grid segments across (u) and along (v) */
  u: number
  v: number
  /** an icosphere instead of a grid */
  sphere?: boolean
  wrapU?: boolean
  wrapV?: boolean
  /** the whole first / last row is one point: it gets one normal */
  pole0?: boolean
  pole1?: boolean
  /** v runs from the root to the free end, so the far end is the fresh growth */
  streamer?: boolean
  /** the wet material (liquid, droplet) */
  glossy?: boolean
  at: FormFn
}

const PI = Math.PI
const TAU = PI * 2
const X_AXIS = new THREE.Vector3(1, 0, 0)
const Y_AXIS = new THREE.Vector3(0, 1, 0)

// The v0.17 / v0.18 formulas, with: sway and sheet waves relative to the size (they were world
// units, so small shapes crumpled and big ones went flat), streamers pinned at the root, a
// quieter floor in silence, the attack term k, and the root moved to the shape's base.
const FORMS: Record<SoftKind, Form> = {
  liquid: {
    u: 0,
    v: 0,
    sphere: true,
    glossy: true,
    at(x, y, z, p, o, i) {
      const f = p.f
      const t = p.t
      const pulse = 1 + p.wave * (0.06 + 0.22 * p.e + 0.35 * p.k) * (Math.sin(x * 3 * f + t) * Math.cos(y * 2 * f - t * 0.7) + 0.45 * Math.sin(z * 4 * f + t * 1.2))
      const r = p.size * 0.45 * pulse
      o[i] = x * r
      o[i + 1] = y * r + p.size * 0.45
      o[i + 2] = z * r
    },
  },
  ribbon: {
    u: 4,
    v: 96,
    streamer: true,
    at(u, v, _w, p, o, i) {
      const s = p.size
      const t = p.t
      const b = v + 0.5
      const along = b * s * 2
      const twist = along * (0.6 + 0.8 * p.chrome) + Math.sin(t * 0.4) * 0.7
      const w = Math.min(1.4, s * 0.2)
      const width = w * u * (1 + 0.25 * Math.sin(along * 1.1 + t))
      // chrome: a gutter across the strip, so the mirror sweeps from light to dark instead of one flat tone
      const cup = p.chrome * u * u * w * 1.6
      const sway = p.wave * Math.min(s, 4) * 0.5 * b
      o[i] = Math.sin(along * 0.55 * p.f - t * 0.45) * sway * (0.4 + p.e + 1.2 * p.k) + Math.cos(twist) * width - Math.sin(twist) * cup
      o[i + 1] = along
      o[i + 2] = Math.cos(along * 0.4 * p.f - t * 0.3) * sway * (0.3 + p.e + p.k) + Math.sin(twist) * width + Math.cos(twist) * cup
    },
  },
  blanket: {
    u: 36,
    v: 26,
    at(u, v, _w, p, o, i) {
      const s = p.size
      const f = p.f
      const t = p.t
      o[i] = u * s * 1.6
      o[i + 1] = (v + 0.5) * s * 1.15
      o[i + 2] = p.wave * (0.1 + p.e + 0.8 * p.k) * Math.min(s, 4) * 0.35 * (Math.sin(u * 5 * f + t) * Math.cos(v * 4 * f - t * 0.7) + 0.45 * Math.sin((u + v) * 8 * f - t * 1.3))
    },
  },
  jelly: {
    u: 40,
    v: 18,
    wrapU: true,
    pole0: true,
    at(u, v, _w, p, o, i) {
      const s = p.size
      const t = p.t
      const a = (u + 0.5) * TAU
      const b = v + 0.5
      const lat = b * PI * 0.52 * (1 - 0.2 * p.k) // the attack contracts the bell
      const r = Math.sin(lat) * (0.65 + 0.07 * Math.min(1.5, p.wave) * Math.sin(t * 1.2))
      const b2 = b * b
      o[i] = Math.cos(a) * r * s
      o[i + 1] = (Math.cos(lat) * 0.7 + b2 * b2 * p.amp * Math.sin(a * 6 - t) * 0.3) * s
      o[i + 2] = Math.sin(a) * r * s
    },
  },
  kelp: {
    u: 6,
    v: 72,
    streamer: true,
    at(u, v, _w, p, o, i) {
      const s = p.size
      const t = p.t
      const b = v + 0.5
      const pinch = Math.sin(PI * b)
      o[i] = (u * (0.35 + 0.6 * b) * pinch + p.amp * 0.4 * Math.sin(3 * b - t * 0.7) * b * b) * s
      o[i + 1] = 2 * b * s
      o[i + 2] = (p.amp * Math.sin(7 * b * p.f - t) * b + u * 0.3 * Math.cos(t + 4 * b) * pinch) * s
    },
  },
  manta: {
    u: 40,
    v: 20,
    at(u, v, _w, p, o, i) {
      const s = p.size
      const au = Math.abs(u)
      o[i] = 2 * u * s
      o[i + 1] = (0.8 * v + 0.3 * au + 0.4) * s
      o[i + 2] = (p.amp * Math.sin(5 * au * p.f - p.t) * (0.3 + 2 * au) + 0.4 * v * v) * s
    },
  },
  spiral: {
    u: 6,
    v: 128,
    streamer: true,
    at(u, v, _w, p, o, i) {
      const s = p.size
      const t = p.t
      const b = v + 0.5
      const ang = 4 * PI * b + 0.25 * t
      const r = (0.35 + 0.22 * u) * Math.min(1, 0.25 + 3 * b)
      o[i] = (Math.cos(ang) * r + p.amp * 0.3 * Math.sin(3 * b * p.f - t) * b) * s
      o[i + 1] = 1.8 * b * s
      o[i + 2] = (Math.sin(ang) * r + p.amp * 0.15 * Math.sin((u + 0.5) * TAU + t)) * s
    },
  },
  torus: {
    u: 48,
    v: 18,
    wrapU: true,
    wrapV: true,
    at(u, v, _w, p, o, i) {
      const s = p.size
      const t = p.t
      const A = p.amp
      const a = (u + 0.5) * TAU
      const q = (v + 0.5) * TAU
      const tube = 0.18 * (1 + A * 0.6 * Math.sin(3 * a - t) + 0.5 * p.k)
      const r = 0.6 * (1 + 0.06 * A * Math.sin(2 * a + t * 0.7)) + tube * Math.cos(q)
      o[i] = r * Math.cos(a) * s
      o[i + 1] = (tube * Math.sin(q) + A * 0.12 * Math.sin(2 * a - t) + 0.25) * s
      o[i + 2] = r * Math.sin(a) * s
    },
  },
  tube: {
    u: 16,
    v: 64,
    wrapU: true,
    streamer: true,
    at(u, v, _w, p, o, i) {
      const s = p.size
      const t = p.t
      const A = p.amp
      const a = (u + 0.5) * TAU
      const b = v + 0.5
      const r = (0.25 + A * 0.08 * Math.sin(8 * b * p.f - t)) * (0.7 + 0.3 * Math.min(1, 4 * b)) * (1 + 0.3 * p.k)
      o[i] = (r * Math.cos(a) + A * 0.3 * Math.sin(5 * b - t) * b) * s
      o[i + 1] = 1.8 * b * s
      o[i + 2] = (r * Math.sin(a) + A * 0.15 * Math.cos(4 * b - t) * b) * s
    },
  },
  fan: {
    u: 40,
    v: 18,
    pole0: true,
    streamer: true,
    at(u, v, _w, p, o, i) {
      const s = p.size
      const t = p.t
      const b = v + 0.5
      const ang = 1.5 * PI * u
      const r = 0.95 * b
      o[i] = Math.sin(ang) * r * s
      o[i + 1] = Math.cos(ang) * r * s
      o[i + 2] = (p.amp * b * Math.sin(6 * ang * p.f - t) * 0.4 + p.k * 0.3 * b * Math.sin(12 * r - 3 * t)) * s
    },
  },
  pleats: {
    u: 64,
    v: 16,
    at(u, v, _w, p, o, i) {
      const s = p.size
      const t = p.t
      const A = p.amp
      o[i] = 1.6 * u * s
      o[i + 1] = (1.3 * v + 0.65) * s
      o[i + 2] = ((0.06 + 0.25 * A) * Math.sin(25 * u * p.f + 0.6 * t) + 0.2 * A * Math.sin(6 * v - t)) * s
    },
  },
  droplet: {
    u: 36,
    v: 28,
    wrapU: true,
    pole0: true,
    pole1: true,
    glossy: true,
    at(u, v, _w, p, o, i) {
      const s = p.size
      const t = p.t
      const A = p.amp
      const a = (u + 0.5) * TAU
      const lat = PI * (v + 0.5)
      const sl = Math.sin(lat)
      const r = sl * (0.5 - 0.25 * Math.cos(lat)) * (1 + 0.3 * p.k)
      o[i] = (r * Math.cos(a) + A * 0.25 * Math.sin(2 * lat - t) * sl) * s
      o[i + 1] = (0.9 * Math.cos(lat) + 0.9) * s
      o[i + 2] = (r * Math.sin(a) + A * 0.15 * Math.cos(2 * lat - 1.3 * t) * sl) * s
    },
  },
  disc: {
    u: 48,
    v: 14,
    wrapU: true,
    pole0: true,
    at(u, v, _w, p, o, i) {
      const s = p.size
      const t = p.t
      const a = (u + 0.5) * TAU
      const b = v + 0.5
      const r = 0.85 * b
      o[i] = r * Math.cos(a) * s
      o[i + 1] = (p.amp * 0.3 * Math.sin(12 * r * p.f - 1.4 * t) * b + p.k * 0.25 * Math.sin(12 * r - 6 * t) * b + 0.3) * s
      o[i + 2] = r * Math.sin(a) * s
    },
  },
}

// ------------------------------------------------------------ grids

interface Grid {
  /** per vertex: u, v (stride 2), or a unit-sphere point (stride 3) */
  base: Float32Array
  stride: number
  count: number
  index: Uint16Array | Uint32Array
  /** rows that are one point: [first vertex, vertices] */
  poles: [number, number][]
}

/** One per kind and detail, shared by every plant of it (each copies the index into its own geometry). */
const GRIDS = new Map<string, Grid>()

function gridFor(kind: SoftKind, fine: boolean): Grid {
  const key = `${kind}${fine ? '+' : '-'}`
  const hit = GRIDS.get(key)
  if (hit) return hit
  const f = FORMS[kind]
  let grid: Grid
  if (f.sphere) {
    // welded: shared vertices give smooth normals (the unwelded icosphere shades flat)
    const ico = new THREE.IcosahedronGeometry(1, fine ? 8 : 5)
    ico.deleteAttribute('normal')
    ico.deleteAttribute('uv')
    const welded = mergeVertices(ico)
    ico.dispose()
    const pos = welded.getAttribute('position').array as Float32Array
    const idx = welded.getIndex()!.array
    const count = pos.length / 3
    grid = { base: Float32Array.from(pos), stride: 3, count, index: count > 65535 ? Uint32Array.from(idx) : Uint16Array.from(idx), poles: [] }
    welded.dispose()
  } else {
    const U = fine ? f.u : Math.max(f.wrapU ? 12 : 2, f.u >> 1) // a ring under 12 sides reads as a polygon
    const V = fine ? f.v : Math.max(2, f.v >> 1)
    // a wrapped direction has no duplicate seam column / row: the seam shares its vertices
    const nu = f.wrapU ? U : U + 1
    const nv = f.wrapV ? V : V + 1
    const count = nu * nv
    const base = new Float32Array(count * 2)
    for (let j = 0; j < nv; j++) {
      for (let i = 0; i < nu; i++) {
        base[(j * nu + i) * 2] = i / U - 0.5
        base[(j * nu + i) * 2 + 1] = j / V - 0.5
      }
    }
    const index = count > 65535 ? new Uint32Array(U * V * 6) : new Uint16Array(U * V * 6)
    let k = 0
    for (let j = 0; j < V; j++) {
      const j1 = (j + 1) % nv
      for (let i = 0; i < U; i++) {
        const i1 = (i + 1) % nu
        const a = j * nu + i
        const b = j * nu + i1
        const c = j1 * nu + i
        const d = j1 * nu + i1
        index[k++] = a
        index[k++] = b
        index[k++] = d
        index[k++] = a
        index[k++] = d
        index[k++] = c
      }
    }
    const poles: [number, number][] = []
    if (f.pole0) poles.push([0, nu])
    if (f.pole1 && !f.wrapV) poles.push([(nv - 1) * nu, nu])
    grid = { base, stride: 2, count, index, poles }
  }
  GRIDS.set(key, grid)
  return grid
}

/** Area-weighted smooth normals on raw arrays; a pole row gets its mean. */
function computeNormals(pos: Float32Array, index: ArrayLike<number>, out: Float32Array, poles: readonly [number, number][]) {
  out.fill(0)
  for (let f = 0; f < index.length; f += 3) {
    const a = index[f] * 3
    const b = index[f + 1] * 3
    const c = index[f + 2] * 3
    const ax = pos[a]
    const ay = pos[a + 1]
    const az = pos[a + 2]
    const ux = pos[b] - ax
    const uy = pos[b + 1] - ay
    const uz = pos[b + 2] - az
    const vx = pos[c] - ax
    const vy = pos[c + 1] - ay
    const vz = pos[c + 2] - az
    const nx = uy * vz - uz * vy
    const ny = uz * vx - ux * vz
    const nz = ux * vy - uy * vx
    out[a] += nx
    out[a + 1] += ny
    out[a + 2] += nz
    out[b] += nx
    out[b + 1] += ny
    out[b + 2] += nz
    out[c] += nx
    out[c + 1] += ny
    out[c + 2] += nz
  }
  // a collapsed row: each of its vertices only saw its own wedge
  for (const [first, n] of poles) {
    let x = 0
    let y = 0
    let z = 0
    for (let i = first * 3, e = (first + n) * 3; i < e; i += 3) {
      x += out[i]
      y += out[i + 1]
      z += out[i + 2]
    }
    for (let i = first * 3, e = (first + n) * 3; i < e; i += 3) {
      out[i] = x
      out[i + 1] = y
      out[i + 2] = z
    }
  }
  for (let i = 0; i < out.length; i += 3) {
    const l = Math.hypot(out[i], out[i + 1], out[i + 2])
    if (l > 1e-12) {
      out[i] /= l
      out[i + 1] /= l
      out[i + 2] /= l
    } else out[i + 1] = 1
  }
}

// ------------------------------------------------------------ surfaces

/** What the surfaces need from the engine beyond OrganismHost. */
export interface SoftHooks {
  /** re-write a segment's instances (hidden while its plant has a surface) */
  writeSeg(seg: Seg): void
  /** the engine clock's zero: the growth material's birth times are stored relative to it */
  epoch(): number
  /** the reference while one guides growth: surfaces lie on its relief */
  relief(): SoftRelief | null
  /** how far the growth reaches out now, in arc units from its root (organism/breath.ts) */
  reach?(p: Plant): number
}

export interface SoftRelief {
  box(): RefBox | null
  /** relief height under world (x, y), held inside the picture */
  reliefZ(x: number, y: number): number
}

interface Surface {
  plant: Plant
  form: Form
  grid: Grid
  mesh: THREE.Mesh
  pos: THREE.BufferAttribute
  nrm: THREE.BufferAttribute
  col: THREE.BufferAttribute
  /** per vertex SEG_DATA: birth, arc from the root (up the surface), 0, note */
  data: THREE.BufferAttribute
  /** next geometry rewrite / normal refresh on the engine clock */
  next: number
  nextN: number
  kick: number
  /** size from the skeleton at the last rewrite; eased every frame; what the vertices hold */
  sizeT: number
  sizeS: number
  sizeAt: number
  /** how far the skeleton reached from its root at the last rewrite (arc units): the music breath's share is of this */
  extent: number
  /** orientation from the last rewrite, eased toward every frame */
  readonly qT: THREE.Quaternion
  readonly q: THREE.Quaternion
  placed: boolean
  roll: number
  phase: number
  f: number
  /** vertices in world space, lying on a reference relief (the transform is then identity) */
  world: boolean
  /** the vertices' bounds at the last rewrite (min xyz, max xyz, in the mesh's own space): what the camera frames */
  readonly box: Float32Array
  bornAt: number
  cr: number
  cg: number
  cb: number
}

export class SoftSurfaces implements OrganismFeature {
  readonly id = 'soft'
  readonly controls: FeatureControl[] = [
    { key: 'softWave', label: 'soft: wave amplitude', min: 0, max: 3, step: 0.05, value: 1, group: 'Soft species' },
    { key: 'softReact', label: 'soft: audio response', min: 0, max: 3, step: 0.05, value: 1, group: 'Soft species' },
    { key: 'softSpeed', label: 'soft: flow speed', min: 0, max: 3, step: 0.05, value: 0.8, group: 'Soft species' },
    { key: 'softIdle', label: 'soft: motion in silence', min: 0, max: 0.3, step: 0.01, value: 0.05, group: 'Soft species' },
    { key: 'softFollow', label: 'soft: lean along the growth (0 = all upright, as v0.19)', min: 0, max: 1, step: 1, value: 1, group: 'Soft species' },
  ]
  private readonly surfaces: Surface[] = []
  private readonly byPlant = new Map<Plant, Surface>()
  /** soft plants without a surface (not reached yet, or over the cap), oldest born first */
  private waiting: Plant[] = []
  /** each plant's first shoot: a surface leans along that side of its skeleton */
  private readonly dir0 = new WeakMap<Plant, THREE.Vector3>()
  private cursor = 0
  private clock = 0
  private bass = 0
  private treble = 0
  private host: OrganismHost | null = null
  private cloth: THREE.Material | null = null
  private wet: THREE.Material | null = null
  /** the chrome species' mirror (never replaced by the growth shader) */
  private chrome: THREE.Material | null = null
  /** the selected growth shader, made for the surfaces (null = standard) */
  private shader: THREE.Material | null = null
  /** framing points (xyz triples) for the camera, refreshed every frame */
  readonly samples = new Float32Array(SAMPLES * 3)
  sampleN = 0
  /** geometry rewrites in the last frame (perf check) */
  rewrites = 0
  /** reshape rate, 1 = full (~30 Hz); the engine's quality tier halves it on a struggling machine */
  rate = 1
  private readonly fin: FormIn = { size: 1, t: 0, wave: 1, e: 0, k: 0, amp: 0, f: 1, chrome: 0 }
  private readonly v1 = new THREE.Vector3()
  private readonly v2 = new THREE.Vector3()
  private readonly v3 = new THREE.Vector3()
  private readonly v4 = new THREE.Vector3()
  private readonly m4 = new THREE.Matrix4()
  private readonly one = new THREE.Vector3(1, 1, 1)

  constructor(private readonly hooks: SoftHooks) {}

  /** The plant draws a surface: its segments must draw nothing. */
  owns(p: Plant) {
    return this.byPlant.has(p)
  }

  get count() {
    return this.surfaces.length
  }

  mount(e: OrganismHost) {
    this.host = e
    const make = (wet: boolean) => reactify(new MeshStandardNodeMaterial({ roughness: wet ? 0.16 : 0.45, metalness: wet ? 0.25 : 0.08, side: THREE.DoubleSide, vertexColors: true }))
    this.cloth = make(false)
    this.wet = make(true)
    // the sheen: thin-film interference over a mirror of a contrasty studio, tinted by the plant
    // colour (silver, pink, black). The film's thickness drifts over the surface, blue-violet where
    // thin and pink where thick; and the mirror is capped, so the note light and the strips glint
    // on a dark world instead of blooming into a white blot
    const chrome = new MeshPhysicalNodeMaterial({ metalness: 1, roughness: 0.1, iridescence: 1, iridescenceIOR: 1.3, side: THREE.DoubleSide, vertexColors: true })
    chrome.envNode = chromeEnvironment()
    chrome.iridescenceThicknessNode = mix(float(FILM[0]), float(FILM[1]), mx_noise_float(positionLocal.mul(0.6)).mul(0.5).add(0.5))
    // on the glossy black finish the film was all there was to see, and it read gold: less of it there
    const tint = dot(attribute('color', 'vec3'), vec3(0.2126, 0.7152, 0.0722))
    chrome.iridescenceNode = mix(float(0.25), float(0.85), smoothstep(0.05, 0.35, tint))
    chrome.outputNode = vec4(min(output.rgb, mix(float(CHROME_CAP[0]), float(CHROME_CAP[1]), uLight)), output.a)
    this.chrome = reactify(chrome)
    // a mirror does not glow: the fresh-growth glow, flashes and pulses only tint it (on black
    // space and dark hazes they turned a new ribbon into a flat white blade)
    chrome.emissiveNode = (chrome.emissiveNode as ReturnType<typeof float>).mul(CHROME_GLOW)
    this.setShader(ctl(e.controls, 'shader'))
  }

  unmount() {
    this.clear()
    for (const m of [this.cloth, this.wet, this.shader, this.chrome]) m?.dispose()
    this.cloth = this.wet = this.shader = this.chrome = null
    this.host = null
  }

  clear() {
    while (this.surfaces.length) this.drop(this.surfaces[this.surfaces.length - 1])
    this.waiting = []
    this.sampleN = 0
  }

  onControl(key: string, value: number) {
    if (key === 'shader' && this.host) this.setShader(value)
  }

  onPlantCreated(p: Plant) {
    if (!p.sp.soft) return
    this.dir0.set(p, (p.tips[0]?.dir ?? p.n).clone())
    this.waiting.push(p) // plants are created in birth order
  }

  onPlantRemoved(p: Plant) {
    const s = this.byPlant.get(p)
    if (s) this.drop(s)
    else if (p.sp.soft) {
      const i = this.waiting.indexOf(p)
      if (i >= 0) this.waiting.splice(i, 1)
    }
  }

  /** Every growth shader applies to the surfaces too (v0.17.3 skipped shaders 1-21). */
  private setShader(index: number) {
    let mat: THREE.Material | null = null
    try {
      const made = GROWTH_SHADERS[index]?.make() ?? null
      if (made) {
        made.side = THREE.DoubleSide
        made.vertexColors = true
        mat = reactify(made)
      }
    } catch (err) {
      console.warn('soft surface shader failed:', err)
    }
    const old = this.shader
    this.shader = mat
    for (const s of this.surfaces) s.mesh.material = this.materialFor(s.form, s.plant.sp)
    old?.dispose()
  }

  private materialFor(form: Form, sp: Species): THREE.Material {
    if (sp.chrome && this.chrome) return this.chrome
    return this.shader ?? (form.glossy ? this.wet! : this.cloth!)
  }

  afterGrowth(m: MusicState, _g: GlobalParams, dt: number, t: number, e: OrganismHost) {
    this.rewrites = 0
    if (!this.host || (!this.surfaces.length && !this.waiting.length)) {
      this.sampleN = 0
      return
    }
    const c = e.controls
    const d = Math.min(0.1, Math.max(0, dt))
    const ease = 1 - Math.exp(-d * 8)
    this.bass += (m.bass - this.bass) * ease
    this.treble += (m.treble - this.treble) * ease
    const react = ctl(c, 'softReact')
    const energy = (ctl(c, 'softIdle') + this.bass * 0.7 + this.treble * 0.25) * react
    // accumulated: moving the speed slider never jumps the phase (v0.17 scaled absolute time)
    this.clock += d * ctl(c, 'softSpeed') * (1 + 0.5 * energy)
    const wave = ctl(c, 'softWave')
    const follow = ctl(c, 'softFollow') > 0
    const relief = this.hooks.relief()
    const kickGain = Math.min(2, react)

    // attack and size move every frame; the geometry catches up on its rewrite
    const kd = Math.exp(-d * 7)
    const grow = 1 - Math.exp(-d * 6)
    for (const s of this.surfaces) {
      const p = s.plant
      s.kick = Math.max(s.kick * kd, p.held || p.autoUntil > t ? 0.8 * m.onset : 0)
      s.sizeS += (s.sizeT - s.sizeS) * grow
    }

    let work = 0
    const updates = Math.max(1, Math.round(UPDATES * this.rate))
    // newest first: at the cap, the note just played gets a surface before old dormant ones
    while (this.waiting.length && work < updates) {
      const p = this.waiting[this.waiting.length - 1]
      if (this.surfaces.length >= MAX_SURFACES && !this.evictFor(p, t)) break
      this.waiting.pop()
      const s = this.adopt(p)
      if (this.rewrite(s, t, wave, energy, kickGain, follow, relief)) work++
    }
    const n = this.surfaces.length
    let last = -1
    for (let i = 0; i < n && work < updates; i++) {
      const k = (this.cursor + i) % n
      const s = this.surfaces[k]
      if (t < s.next) continue
      if (this.rewrite(s, t, wave, energy, kickGain, follow, relief)) work++
      last = k
    }
    if (last >= 0) this.cursor = last + 1
    this.rewrites = work

    // transforms, and framing points for the camera: the corners of each surface's box, so every
    // vertex it draws (sway, bloom and all) is inside what the camera keeps in view
    const turn = 1 - Math.exp(-d * 2.5)
    const out = this.samples
    let sn = 0
    for (const s of this.surfaces) {
      const mesh = s.mesh
      s.q.slerp(s.qT, turn)
      mesh.visible = s.sizeAt > 0 && s.sizeS > 0.02
      if (!mesh.visible) continue
      if (s.world) {
        mesh.position.set(0, 0, 0)
        mesh.quaternion.identity()
        mesh.scale.setScalar(1)
      } else {
        // the music breath: the share of its skeleton inside the reach, as a size (size ~ √length)
        const reach = this.hooks.reach?.(s.plant) ?? Infinity
        const breath = reach === Infinity ? 1 : Math.max(0.04, Math.sqrt(breathShareOf(reach, s.extent)))
        mesh.position.copy(s.plant.root)
        mesh.quaternion.copy(s.q)
        mesh.scale.setScalar((s.sizeS / s.sizeAt) * (1 + 0.15 * s.kick * kickGain) * breath)
      }
      mesh.updateMatrix()
      const me = mesh.matrix.elements
      const bx = s.box
      for (let j = 0; j < 8 && sn < SAMPLES; j++) {
        const x = bx[j & 1 ? 3 : 0]
        const y = bx[j & 2 ? 4 : 1]
        const z = bx[j & 4 ? 5 : 2]
        out[sn * 3] = me[0] * x + me[4] * y + me[8] * z + me[12]
        out[sn * 3 + 1] = me[1] * x + me[5] * y + me[9] * z + me[13]
        out[sn * 3 + 2] = me[2] * x + me[6] * y + me[10] * z + me[14]
        sn++
      }
    }
    this.sampleN = sn
  }

  /** A surface for `p`: its own fixed grid, rewritten in place from now on; its segments go dark. */
  private adopt(p: Plant): Surface {
    const kind = p.sp.soft!
    const form = FORMS[kind]
    const grid = gridFor(kind, this.surfaces.length < FINE_BELOW)
    const geo = new THREE.BufferGeometry()
    const n = grid.count
    const attr = (size: number) => new THREE.BufferAttribute(new Float32Array(n * size), size)
    const pos = attr(3)
    const nrm = attr(3)
    const col = attr(3)
    const data = attr(4)
    geo.setAttribute('position', pos)
    geo.setAttribute('normal', nrm)
    geo.setAttribute('color', col)
    geo.setAttribute(SEG_DATA, data) // the growth material's highlight, age grade and conduction pulses
    geo.setIndex(new THREE.BufferAttribute(grid.index.slice(), 1))
    const mesh = new THREE.Mesh(geo, this.materialFor(form, p.sp))
    mesh.frustumCulled = false
    mesh.visible = false
    mesh.matrixAutoUpdate = false // set in afterGrowth
    this.host!.group.add(mesh)
    const octN = (Math.min(8, Math.max(1, octave(p.pitch))) - 1) / 7
    const s: Surface = {
      plant: p,
      form,
      grid,
      mesh,
      pos,
      nrm,
      col,
      data,
      next: -Infinity,
      nextN: -Infinity,
      kick: p.held ? 0.4 + 0.6 * p.velocity : 0, // a note-on blooms; a surface given back later does not
      sizeT: 0,
      sizeS: 0,
      sizeAt: 0,
      extent: 0,
      qT: new THREE.Quaternion(),
      q: new THREE.Quaternion(),
      placed: false,
      // the note turns it about its growth, with a little chance on top
      roll: (pitchClass(p.pitch) / 12) * TAU + (Math.random() - 0.5) * 0.8,
      phase: p.id * 1.731,
      f: 0.8 + 0.4 * octN,
      world: false,
      box: new Float32Array(6),
      bornAt: NaN,
      cr: -1,
      cg: -1,
      cb: -1,
    }
    this.surfaces.push(s)
    this.byPlant.set(p, s)
    for (const seg of p.segs) this.hooks.writeSeg(seg)
    return s
  }

  /** Remove a surface; its plant is gone, or goes back to its skeleton (evict). */
  private drop(s: Surface) {
    this.host?.group.remove(s.mesh)
    s.mesh.geometry.dispose()
    this.byPlant.delete(s.plant)
    const i = this.surfaces.indexOf(s)
    if (i >= 0) this.surfaces.splice(i, 1)
  }

  /** At the cap: the oldest dormant surface, if older than `p`, returns to its skeleton to make room. */
  private evictFor(p: Plant, t: number): boolean {
    let victim: Surface | null = null
    for (const s of this.surfaces) {
      const q = s.plant
      if (q.held || q.autoUntil > t || q.birth >= p.birth) continue
      if (!victim || q.birth < victim.plant.birth) victim = s
    }
    if (!victim) return false
    const q = victim.plant
    this.drop(victim)
    for (const seg of q.segs) this.hooks.writeSeg(seg)
    let i = this.waiting.length
    while (i > 0 && this.waiting[i - 1].birth > q.birth) i--
    this.waiting.splice(i, 0, q)
    return true
  }

  /** Re-shape one surface from its skeleton and the music. False when there was nothing to draw. */
  private rewrite(s: Surface, t: number, wave: number, energy: number, kickGain: number, follow: boolean, relief: SoftRelief | null): boolean {
    s.next = t + REWRITE / this.rate - SLACK
    const p = s.plant
    const root = p.root
    // the skeleton: grown length (the size), newest birth, and where the first shoot has gone
    const d0 = this.dir0.get(p) ?? p.n
    const side = this.v1.set(0, 0, 0)
    let len = 0
    let wsum = 0
    let newest = p.birth
    let extent = 0
    for (const sg of p.segs) {
      const g = sg.growth < 0 ? 0 : sg.growth > 1 ? 1 : sg.growth
      const l = sg.a.distanceTo(sg.b) * g
      len += l
      if (sg.arc + l > extent) extent = sg.arc + l
      if (sg.born > newest) newest = sg.born
      const bx = sg.b.x - root.x
      const by = sg.b.y - root.y
      const bz = sg.b.z - root.z
      if (bx * d0.x + by * d0.y + bz * d0.z > 0) {
        side.x += bx * l
        side.y += by * l
        side.z += bz * l
        wsum += l
      }
    }
    s.sizeT = Math.min(8, Math.sqrt(len) * 0.8)
    s.extent = extent
    if (!s.placed) s.sizeS = s.sizeT

    // orientation: up along the first shoot's side of the skeleton, facing the plant's own normal
    const ref = relief?.box() ? relief : null
    const up = this.v2
    if (!follow) up.set(0, 1, 0)
    else {
      up.copy(d0).multiplyScalar(0.5)
      if (wsum > 1e-6) up.addScaledVector(side, 1 / wsum)
      if (ref) up.z = 0 // growth on a reference runs along the picture
      if (up.lengthSq() < 1e-8) up.set(0, 1, 0)
      up.normalize()
    }
    const fwd = this.v3
    if (!follow || ref) fwd.set(0, 0, 1)
    else fwd.copy(p.n)
    fwd.addScaledVector(up, -fwd.dot(up))
    if (fwd.lengthSq() < 1e-6) fwd.crossVectors(up, Math.abs(up.x) < 0.9 ? X_AXIS : Y_AXIS) // the normal lies along the growth
    fwd.normalize()
    const right = this.v4.crossVectors(up, fwd)
    if (follow && !ref) {
      const cr = Math.cos(s.roll)
      const sr = Math.sin(s.roll)
      const rx = right.x * cr + fwd.x * sr
      const ry = right.y * cr + fwd.y * sr
      const rz = right.z * cr + fwd.z * sr
      fwd.set(fwd.x * cr - right.x * sr, fwd.y * cr - right.y * sr, fwd.z * cr - right.z * sr)
      right.set(rx, ry, rz)
    }
    s.qT.setFromRotationMatrix(this.m4.makeBasis(right, up, fwd))
    if (!s.placed) {
      s.q.copy(s.qT)
      s.placed = true
    }

    if (s.sizeS <= 0.02) {
      s.sizeAt = 0
      return false
    }

    // vertices, at the size the plant has on screen right now (the per-frame scale restarts at 1)
    const fin = this.fin
    const size = s.sizeS
    s.sizeAt = size
    fin.size = size
    fin.t = this.clock + s.phase
    fin.wave = wave
    fin.e = energy
    fin.k = s.kick * kickGain
    fin.amp = wave * (0.15 + 0.4 * energy + 0.5 * fin.k)
    fin.f = s.f
    fin.chrome = s.plant.sp.chrome ? 1 : 0
    const at = s.form.at
    const base = s.grid.base
    const out = s.pos.array as Float32Array
    const cnt = s.grid.count
    if (s.grid.stride === 3) for (let i = 0; i < cnt; i++) at(base[i * 3], base[i * 3 + 1], base[i * 3 + 2], fin, out, i * 3)
    else for (let i = 0; i < cnt; i++) at(base[i * 2], base[i * 2 + 1], 0, fin, out, i * 3)

    // on a reference: into world space, flattened onto the relief under each vertex
    const world = !!ref
    if (world !== s.world) s.nextN = -Infinity // the normals changed space
    s.world = world
    if (ref) {
      const me = this.m4.compose(root, s.q, this.one).elements
      for (let i = 0; i < cnt * 3; i += 3) {
        const x = out[i]
        const y = out[i + 1]
        const z = out[i + 2]
        const wx = me[0] * x + me[4] * y + me[8] * z + me[12]
        const wy = me[1] * x + me[5] * y + me[9] * z + me[13]
        const wz = me[2] * x + me[6] * y + me[10] * z + me[14]
        out[i] = wx
        out[i + 1] = wy
        out[i + 2] = ref.reliefZ(wx, wy) + (wz - root.z) * FLAT + LIFT * size
      }
    }
    const bx = s.box
    bx[0] = bx[1] = bx[2] = Infinity
    bx[3] = bx[4] = bx[5] = -Infinity
    for (let i = 0; i < cnt * 3; i += 3) {
      const x = out[i]
      const y = out[i + 1]
      const z = out[i + 2]
      if (x < bx[0]) bx[0] = x
      if (x > bx[3]) bx[3] = x
      if (y < bx[1]) bx[1] = y
      if (y > bx[4]) bx[4] = y
      if (z < bx[2]) bx[2] = z
      if (z > bx[5]) bx[5] = z
    }
    s.pos.needsUpdate = true
    if (t >= s.nextN) {
      computeNormals(out, s.grid.index, s.nrm.array as Float32Array, s.grid.poles)
      s.nrm.needsUpdate = true
      s.nextN = t + RENORMAL / this.rate - SLACK
    }

    // colour: the plant's (seasons included), dimmed while it is being recycled, like its segments
    const pc = p.color
    const dim = p.dying ? 0.45 : 1
    const r = pc.r * dim
    const g = pc.g * dim
    const b = pc.b * dim
    if (r !== s.cr || g !== s.cg || b !== s.cb) {
      const a = s.col.array as Float32Array
      for (let i = 0; i < a.length; i += 3) {
        a[i] = r
        a[i + 1] = g
        a[i + 2] = b
      }
      s.cr = r
      s.cg = g
      s.cb = b
      s.col.needsUpdate = true
    }
    // birth times: a streamer's far end is as new as the newest segment, its base as old as the plant.
    // Arc: up the surface from its root end, so a note's pulse sweeps over it as it runs up a branch
    if (newest !== s.bornAt) {
      const ep = this.hooks.epoch()
      const a = s.data.array as Float32Array
      const code = noteCode(p)
      const st = s.grid.stride
      for (let i = 0; i < cnt; i++) {
        const up = st === 2 ? base[i * 2 + 1] + 0.5 : (base[i * 3 + 1] + 1) * 0.5
        a[i * 4] = (s.form.streamer ? p.birth + (newest - p.birth) * up : newest) - ep
        a[i * 4 + 1] = up * size
        a[i * 4 + 2] = 0
        a[i * 4 + 3] = code // no radius: a surface does not swell with the pulse
      }
      s.bornAt = newest
      s.data.needsUpdate = true
    }
    return true
  }
}
