// The Organism data model: species traits and the growth graph (plants → segments
// + growing tips). OrganismEngine owns the data; feature modules import the shapes.

import type * as THREE from 'three'

/** curl: steered by a smooth divergence-free flow field, so strands curve and tangle like hair (threads) */
export type Turn = 'smooth' | 'lattice' | 'helix' | 'jagged' | 'straight' | 'hex' | 'curl'
export type NodeShape = 'sphere' | 'cube' | 'none'
/** The surface a soft species draws in place of its tubes (organism/soft.ts). */
export type SoftKind = 'liquid' | 'ribbon' | 'blanket' | 'jelly' | 'kelp' | 'manta' | 'spiral' | 'torus' | 'tube' | 'fan' | 'pleats' | 'droplet' | 'disc'

export interface Species {
  name: string
  icon: string
  /** palette phase shift so species differ in colour, not only in shape */
  hue: number
  /** vertical offset of the root (stalactites hang from above, stalagmites rise from below) */
  rootY?: number
  /** fixed start direction instead of random */
  dir0?: 'down' | 'up'
  /** surface style: ribbed segments, crystal shards, or tube + leaf quads at the joints */
  skin?: 'ribbed' | 'crystal' | 'leafy'
  segLen: number // base segment length (world units)
  thickness: number // radius multiplier
  taper: number // radius multiplier per finished segment
  branchTaper: number // radius multiplier for a new branch
  wiggle: number
  branch: number // branch probability per finished segment
  branchAngle: [number, number] // radians
  turn: Turn
  turnAngle: number // helix / jagged turn size
  node: NodeShape
  nodeScale: number // relative to radius
  gravity: number // + down, − up
  radial: number // outward drift from the organism centre
  maxTips: number
  maxDepth: number
  speed: number
  glow: number
  brighten: number // mix toward white (negative = darken)
  join: number // attraction multiplier
  /** Growth confined to a plane per growth (fern, snowflake, kelp). */
  planar?: boolean
  /** Regular branching every N segments, alternating sides (fern) — replaces random branching. */
  branchEvery?: number
  /** With branchEvery: branch on both sides at once (snowflake). */
  branchBoth?: boolean
  /** Initial tips (default 2–3); snowflake = 6 at 60°. */
  initTips?: number
  /** Self-avoidance: tips steer away from this growth's own nearby endpoints (0..1). Corals, trees, mycelium. */
  avoid?: number
  /** Y-splits: on a branch the parent tip also deviates, both children taper by Murray's law (2^-1/3). */
  dichotomous?: boolean
  /** Apical dominance (0..1): side shoots live shorter and thinner, the leader keeps going. */
  dominance?: number
  /** Soft species: the skeleton grows hidden and one deforming surface of this kind stands for it. */
  soft?: SoftKind
  /** Off until toggled: the panel's default set, "Rigid only" and an empty selection leave it out (the Webs species). */
  optIn?: boolean
  /** On a light world its colour is ink (near black, some dusty pink and steel blue) instead of the palette's. */
  ink?: boolean
  /** A soft surface in mirror chrome with a thin-film sheen instead of the growth shader (organism/soft.ts). */
  chrome?: boolean
  /** Thickness varies this much per growth (a lognormal spread: 0.6 ≈ ×0.5 … ×2). */
  thickVary?: number
  /** Each segment overlaps its joints by about its radius (no node shape to hide the bends). */
  seamless?: boolean
}

/**
 * A point held in reference-picture coordinates (organism/reference.ts): u, v across the picture,
 * r the relief brightness under it when last placed, h its height above that relief, gen the
 * source it belongs to (growth from an earlier source keeps its shape instead of morphing).
 */
export interface RefAnchor {
  u: number
  v: number
  r: number
  h: number
  gen: number
}

export interface Plant {
  id: number
  pitch: number
  level: number // nesting depth (0 = played)
  bound: { c: THREE.Vector3; r: number } | null // per-growth soft sphere (nested children)
  autoUntil: number // grows without a held key until this time (children, text)
  baseColor: THREE.Color // colour before seasons
  isText: boolean
  /** grown by an audio stem (0 drums … 3 other): regrowth keeps the stem's species */
  stem?: number
  dying: boolean // being recycled: dimmed and retracting to make room
  children: boolean
  root: THREE.Vector3
  reach: number // furthest point from the root so far (physics)
  attach: { mesh: THREE.Mesh; vi: number; base: THREE.Vector3; shift: THREE.Vector3 } | null // rides an animated model
  velocity: number
  color: THREE.Color
  sp: Species
  segs: Seg[]
  tips: Tip[]
  held: boolean
  fused: boolean
  birth: number
  released: number
  segLen: number
  /** start radius of the first tips; tip death is relative to it */
  r0: number
  /** plane basis for planar species */
  n: THREE.Vector3
  u: THREE.Vector3
  v: THREE.Vector3
  /** the root, held on the reference picture */
  rootAnchor?: RefAnchor
  /** a Build shape background growth (no music made it) */
  refAuto?: boolean
  /**
   * The attack a played note started it with (organism/ignition.ts): t0 the note-on, s its
   * strength 0..1 (velocity, or an audio onset's strength), up the note-off (-1 while held).
   * Absent for growth no key started (nested children, typography, Build shape, regrowth).
   */
  ign?: { t0: number; s: number; up: number; audio: boolean }
  /** notes struck together share an id (organism/layout.ts): they root in one area and reach for each other first */
  chord?: number
  /** per growth step, how far its tips lean up (+) or down (−): the pitch layout's register */
  lift?: number
  /** the flight's ambient web (organism/flight.ts): no note made it, it follows the music and goes once the camera passes */
  ambient?: boolean
  /** grafted: how far along its host's branches (from the host's own roots) it was rooted (organism/breath.ts) */
  arcBase?: number
}

export interface Seg {
  idx: number // instance index (position in the engine's segs); -1 once removed
  a: THREE.Vector3
  b: THREE.Vector3
  r: number
  growth: number // 0..1 visible fraction of a→b
  born: number
  /** distance from the plant's root along the branch to `a` (conduction pulses run along it) */
  arc: number
  permanent: boolean
  plant: Plant
  lq?: THREE.Quaternion // leaf orientation (leafy skins)
  /** grown while a reference guided: both ends follow it (a joint shares one anchor with the next segment) */
  anchor?: { a: RefAnchor; b: RefAnchor }
}

export interface Tip {
  pos: THREE.Vector3
  dir: THREE.Vector3
  axis: THREE.Vector3 // helix axis
  r: number
  depth: number
  /** distance from the plant's root along the branch to `pos` */
  arc: number
  seg: Seg | null
  plant: Plant
  path?: THREE.Vector3[] // typography: waypoints to follow
  pathI?: number
  n?: THREE.Vector3 // skin mode: surface normal at the tip
  side: number // alternating branch side
  sinceBranch: number
  wob: THREE.Vector3 // slowly drifting bend — smooth organic curves instead of jitter
  turn?: Turn // wild: a tip that changed its mind about how to grow
  /** where `pos` sits on the reference (the anchor of the joint it grows from) */
  anchor?: RefAnchor
}
