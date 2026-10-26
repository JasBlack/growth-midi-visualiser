// Debris ("Webs" W2): thousands of small flakes, petals and ash tumbling through the space, and a
// few glassy faceted crystals. Ink on a light world, faint glints on a dark one, fogged into the
// haze like the growth, densest just after an onset.
//
// One instanced draw and no per-frame CPU work per particle: each particle is a fixed point in a box
// that wraps round the camera (plus its own slow drift), so the field is endless and parallax with
// the flight comes for free; the vertex shader tumbles it, wraps it and shrinks it to nothing at the
// box's edge (no popping). The music only moves three uniforms: the clock, how many of the particles
// show (a puff on onsets swells more of them in) and their size. Each particle tears its own outline
// from one shared shape in the shader; facets come from flat shading.

import * as THREE from 'three'
import { MeshStandardNodeMaterial } from 'three/webgpu'
import { Fn, abs, attribute, cameraPosition, clamp, cos, cross, dot, float, floor, fract, max, mix, positionLocal, sin, smoothstep, step, uniform, vec3 } from 'three/tsl'
import { ctl } from '../../engine'
import type { GlobalParams } from '../../engine'
import type { MusicState } from '../../music'
import { uLight } from '../../shaders'
import type { FeatureControl, OrganismFeature, OrganismHost } from './feature'

const G = 'Debris'
/** particles at full amount on the top quality tier, and the wrap box round the camera (world units) */
export const DEBRIS_MAX = 8000
const BOX = 40
/** share of the particles that are glassy crystals */
const CRYSTALS = 0.006
const A = 'dbA'
const B = 'dbB'
const C = 'dbC'
const D = 'dbD'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type N = any
/** 0..1 from a float (TSL's hash() truncates its seed to an integer) */
const hash01 = (x: N): N => fract(sin(x).mul(43758.5453))

/** Particles drawn for a debris amount (0..1) on a quality tier that keeps `load` of the scenery. */
export const debrisCount = (amount: number, load: number) => Math.round(DEBRIS_MAX * Math.min(1, Math.max(0, amount)) * Math.min(1, Math.max(0, load)))

/** The fixed per-particle table: place, tumble, shape, drift. Deterministic for a seed (tests). */
export function debrisTable(n: number, rand: () => number) {
  const a = new Float32Array(n * 4)
  const b = new Float32Array(n * 4)
  const c = new Float32Array(n * 4)
  const d = new Float32Array(n * 3)
  for (let i = 0; i < n; i++) {
    // place in the box (0..1) and the seed that decides when it shows (puffs reveal the higher ones)
    a[i * 4] = rand()
    a[i * 4 + 1] = rand()
    a[i * 4 + 2] = rand()
    a[i * 4 + 3] = rand()
    // tumble: a random axis, 0.4-3 rad/s either way
    let x = rand() - 0.5
    let y = rand() - 0.5
    let z = rand() - 0.5
    const l = Math.hypot(x, y, z) || 1
    b[i * 4] = x / l
    b[i * 4 + 1] = y / l
    b[i * 4 + 2] = z / l
    b[i * 4 + 3] = (0.4 + 2.6 * rand() * rand()) * (rand() < 0.5 ? -1 : 1)
    const crystal = rand() < CRYSTALS
    if (crystal) {
      const s = 0.12 + 0.2 * rand()
      c[i * 4] = s * (0.8 + 0.4 * rand())
      c[i * 4 + 1] = s * (0.7 + 0.5 * rand())
      c[i * 4 + 2] = s * (0.8 + 0.4 * rand())
      c[i * 4 + 3] = 1
    } else {
      // flakes and petals (flat, long) and ash (small, near square): sizes skew small, a few big
      const s = (0.05 + 0.2 * rand() * rand()) * (rand() < 0.05 ? 2.4 : 1)
      const petal = rand() < 0.35
      c[i * 4] = s * (petal ? 1.5 : 1)
      c[i * 4 + 1] = s * (0.05 + 0.08 * rand())
      c[i * 4 + 2] = s * (petal ? 0.45 + 0.2 * rand() : 0.6 + 0.4 * rand())
      c[i * 4 + 3] = 0
    }
    // drift: slow, any way, with a faint settle
    x = rand() - 0.5
    y = rand() - 0.5
    z = rand() - 0.5
    const v = (0.05 + 0.25 * rand()) / (Math.hypot(x, y, z) || 1)
    d[i * 3] = x * v
    d[i * 3 + 1] = y * v - 0.03
    d[i * 3 + 2] = z * v
  }
  return { a, b, c, d }
}

export class Debris implements OrganismFeature {
  readonly id = 'debris'
  readonly controls: FeatureControl[] = [
    { key: 'debris', label: 'debris: flakes, ash and a few crystals drifting through the space (0 = off)', min: 0, max: 1, step: 0.05, value: 0, group: G },
    { key: 'debrisSize', label: 'debris: size', min: 0.3, max: 3, step: 0.05, value: 1, group: G },
    { key: 'debrisReact', label: 'debris: onsets puff more of it in', min: 0, max: 2, step: 0.05, value: 1, group: G },
    { key: 'debrisDrift', label: 'debris: drift and tumble speed', min: 0, max: 3, step: 0.05, value: 1, group: G },
  ]
  /** share of the optional scenery the quality tier keeps (organism/quality.ts): debris is the first to go */
  load = 1
  private mesh: THREE.Mesh | null = null
  private geom: THREE.InstancedBufferGeometry | null = null
  private readonly uClock = uniform(0)
  private readonly uShow = uniform(0.6)
  private readonly uSize = uniform(1)
  private readonly uEmber = uniform(0)
  private puff = 0
  private energy = 0

  mount(e: OrganismHost) {
    // a vertex up: squashed flat (local y), the outline is a ring of ten points the shader tears
    const ico = new THREE.IcosahedronGeometry(1, 0).rotateX(-Math.atan((1 + Math.sqrt(5)) / 2))
    const geom = new THREE.InstancedBufferGeometry()
    geom.setAttribute('position', ico.getAttribute('position'))
    geom.setAttribute('normal', ico.getAttribute('normal'))
    ico.dispose()
    let seed = 0x2f6b4e1d
    const rand = () => {
      // mulberry32: the same field every session
      seed = (seed + 0x6d2b79f5) | 0
      let x = Math.imul(seed ^ (seed >>> 15), 1 | seed)
      x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x
      return ((x ^ (x >>> 14)) >>> 0) / 4294967296
    }
    const tb = debrisTable(DEBRIS_MAX, rand)
    geom.setAttribute(A, new THREE.InstancedBufferAttribute(tb.a, 4))
    geom.setAttribute(B, new THREE.InstancedBufferAttribute(tb.b, 4))
    geom.setAttribute(C, new THREE.InstancedBufferAttribute(tb.c, 4))
    geom.setAttribute(D, new THREE.InstancedBufferAttribute(tb.d, 3))
    geom.instanceCount = 0
    const mesh = new THREE.Mesh(geom, this.material())
    mesh.frustumCulled = false
    mesh.visible = false
    e.group.add(mesh)
    this.mesh = mesh
    this.geom = geom
  }

  unmount(e: OrganismHost) {
    if (!this.mesh) return
    e.group.remove(this.mesh)
    this.mesh.geometry.dispose()
    ;(this.mesh.material as THREE.Material).dispose()
    this.mesh = this.geom = null
  }

  private material() {
    const m = new MeshStandardNodeMaterial({ flatShading: true, side: THREE.DoubleSide })
    const a: N = attribute(A, 'vec4')
    const b: N = attribute(B, 'vec4')
    const c: N = attribute(C, 'vec4')
    const d: N = attribute(D, 'vec3')
    const t = this.uClock
    m.positionNode = Fn(() => {
      // its own shape: each corner pushed in or out by a hash of the corner and the particle (shared
      // corners hash alike, so it stays closed), some bitten deep (torn), petals cupped. W2's plain
      // squashed icosahedra all read as the same hexagon
      const seed: N = a.w.mul(917.3)
      const h1: N = hash01(dot(positionLocal, vec3(12.9898, 78.233, 37.719)).add(seed))
      const h2: N = hash01(dot(positionLocal, vec3(39.346, 11.135, 83.155)).add(seed.mul(0.37)))
      const solid: N = float(1).sub(c.w)
      const jag: N = mix(float(0.15), float(0.55), fract(a.w.mul(71.9))).mul(float(1).sub(c.w.mul(0.6)))
      const bite: N = step(0.78, h2).mul(0.5).mul(solid)
      const s0: N = positionLocal.mul(float(1).add(h1.sub(0.5).mul(2).mul(jag)).mul(float(1).sub(bite))).mul(c.xyz)
      const cup: N = step(fract(a.w.mul(13.37)), 0.35).mul(solid).mul(0.7)
      const v: N = vec3(s0.x, s0.y.add(s0.x.mul(s0.x).div(max(c.x, 1e-3)).mul(cup)), s0.z)
      // tumble about its own axis (Rodrigues)
      const ang: N = b.w.mul(t).add(a.w.mul(40))
      const cs: N = cos(ang)
      const k: N = b.xyz
      const turned: N = v.mul(cs).add(cross(k, v).mul(sin(ang))).add(k.mul(dot(k, v).mul(float(1).sub(cs))))
      // its place, drifting, wrapped into the box round the camera
      const p: N = a.xyz.mul(BOX).add(d.mul(t)).sub(cameraPosition).add(BOX / 2)
      const rel: N = p.sub(floor(p.div(BOX)).mul(BOX)).sub(BOX / 2)
      const edge: N = max(abs(rel.x), max(abs(rel.y), abs(rel.z))).div(BOX / 2)
      // shrink to nothing at the box's edge; show the share the music asks for, swelling in over a band
      const show: N = clamp(this.uShow.sub(a.w).mul(12), 0, 1)
      // and never a flake across the lens: they thin out within a metre of the camera
      const near: N = smoothstep(0.25, 1.2, rel.length())
      const s: N = float(1).sub(smoothstep(0.75, 1, edge)).mul(show).mul(near).mul(this.uSize)
      return cameraPosition.add(rel).add(turned.mul(s))
    })()
    // ink on a light world (some dusty pink and steel blue), dark ash with pale glints on a dark one; crystals pale glass
    const tint: N = fract(a.w.mul(97.13))
    const ink: N = mix(mix(vec3(0.018, 0.016, 0.02), vec3(0.36, 0.17, 0.19), step(0.78, tint)), vec3(0.09, 0.13, 0.24), step(0.9, tint))
    const ash: N = vec3(0.05, 0.042, 0.038)
    const glass: N = vec3(0.78, 0.8, 0.86)
    const crystal: N = c.w
    m.colorNode = mix(mix(ash, ink, uLight), glass, crystal)
    m.roughnessNode = mix(float(0.7), float(0.05), crystal)
    m.metalnessNode = mix(float(0.05), float(0.55), crystal)
    // a few flakes glint on a dark world: a slow flicker, brighter with the music (pale rose, not
    // ember orange: the Webs night is silver, pink and steel)
    const glint: N = step(0.8, fract(a.w.mul(53.7))).mul(sin(t.mul(2.3).add(a.w.mul(310))).mul(0.5).add(0.5))
    m.emissiveNode = vec3(0.75, 0.5, 0.48).mul(glint).mul(this.uEmber).mul(float(1).sub(uLight)).mul(float(1).sub(crystal))
    return m
  }

  beforeFrame(m: MusicState, _g: GlobalParams, dt: number, _t: number, e: OrganismHost) {
    const mesh = this.mesh
    const geom = this.geom
    if (!mesh || !geom) return
    const c = e.controls
    const n = debrisCount(ctl(c, 'debris'), this.load)
    geom.instanceCount = n
    mesh.visible = n > 0
    if (!n) return
    const step = Math.min(0.1, Math.max(0, dt))
    this.energy += (m.energy - this.energy) * (1 - Math.exp(-step * 3))
    this.puff = Math.max(this.puff * Math.exp(-step * 2.2), m.onset * ctl(c, 'debrisReact'))
    this.uClock.value += step * ctl(c, 'debrisDrift') * (0.6 + 0.8 * this.energy + 0.6 * this.puff)
    this.uShow.value = Math.min(1.1, 0.5 + 0.25 * this.energy + 0.45 * this.puff)
    this.uSize.value = ctl(c, 'debrisSize') * (1 + 0.15 * this.puff)
    this.uEmber.value = 0.25 + 0.5 * this.energy + 0.6 * this.puff
  }
}
