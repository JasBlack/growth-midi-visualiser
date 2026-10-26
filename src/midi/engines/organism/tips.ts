// Tip markers: the bright shapes at every growing tip (v0.18's tip shapes, ported with fixes).
// One instanced mesh of MAX_TIPS, created once: a shape change swaps its geometry and one of
// three prebuilt materials, never the instance buffers. The engine places the markers after
// the camera has moved, so the flat shapes face this frame's camera instead of lagging one.
//
// v0.18/v0.19 drew every marker BackSide (discs, stars and uploaded pictures were culled), let
// the marker limit run past its 200-instance allocation, and turned a restored custom-image
// setting into white spheres. Here solids are FrontSide and flats DoubleSide, the limit stops
// at MAX_TIPS, and a custom shape without its upload draws the plant-coloured sphere.
//
// Uploads last the session: a PNG / WebP / JPG becomes an alpha-tested 256 px tile (letterboxed,
// never stretched); an OBJ becomes a solid (at most 10,000 vertices and 2,048 triangles, centred
// and scaled to ±1), drawn at most CUSTOM_MAX times.

import * as THREE from 'three'
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { ctl, setCtl } from '../../engine'
import type { FeatureControl, OrganismFeature, OrganismHost } from './feature'
import type { Plant } from './types'

export const MAX_TIPS = 512
/** markers drawn with an uploaded OBJ (at its 2,048-triangle cap that is 262k triangles) */
const CUSTOM_MAX = 128
const MAX_FILE = 8 * 1024 * 1024
const OBJ_VERTS = 10000
const OBJ_TRIS = 2048
const TILE = 256
const Y_AXIS = new THREE.Vector3(0, 1, 0)
/**
 * Markers are drawn brighter than white: tone mapping rolls them off to a hot core in the plant's
 * colour instead of clipping, and they clear the bloom threshold (organism.ts) so they glow.
 * Uploaded pictures keep their own colours.
 */
const HDR = 2.4
/** on a light world (organism/haze.ts) a marker is a deep drop of its plant's colour: HDR there only washes out */
const INK = 0.42

/** none: as modelled · camera: faces the viewer · growth: +Y along the tip's heading · spin: turns on the tip's own axis */
type Orient = 'none' | 'camera' | 'growth' | 'spin'
interface TipShape {
  name: string
  orient: Orient
  /** one-sided geometry: drawn from both sides */
  flat: boolean
  make: () => THREE.BufferGeometry
}

function sphere() {
  const g = new THREE.IcosahedronGeometry(1, 1)
  g.deleteAttribute('uv') // uv seams keep vertices apart; nothing samples uv on a solid marker
  const welded = mergeVertices(g)
  g.dispose()
  return welded
}

/** A filled outline: triangles fanned from the origin. */
function fan(pts: [number, number][]) {
  const data: number[] = []
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]
    const b = pts[(i + 1) % pts.length]
    data.push(0, 0, 0, a[0], a[1], 0, b[0], b[1], 0)
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(data, 3))
  g.computeVertexNormals()
  return g
}

const starPoints = (): [number, number][] =>
  Array.from({ length: 10 }, (_, i) => {
    const a = (i * Math.PI) / 5 + Math.PI / 2
    const r = i % 2 ? 0.43 : 1
    return [Math.cos(a) * r, Math.sin(a) * r]
  })
const heartPoints = (): [number, number][] =>
  Array.from({ length: 48 }, (_, i) => {
    const a = (i * Math.PI * 2) / 48
    return [Math.sin(a) ** 3, 0.8125 * Math.cos(a) - 0.3125 * Math.cos(2 * a) - 0.125 * Math.cos(3 * a) - 0.0625 * Math.cos(4 * a)]
  })

const IMAGE = 9
const OBJ = 10
export const TIP_SHAPES: TipShape[] = [
  { name: 'sphere', orient: 'none', flat: false, make: sphere },
  { name: 'cube', orient: 'spin', flat: false, make: () => new THREE.BoxGeometry(1.5, 1.5, 1.5) },
  { name: 'diamond', orient: 'spin', flat: false, make: () => new THREE.OctahedronGeometry(1, 0) },
  { name: 'cone', orient: 'growth', flat: false, make: () => new THREE.ConeGeometry(0.8, 1.8, 10) },
  // the ring's hole looks along the growth
  { name: 'ring', orient: 'growth', flat: false, make: () => new THREE.TorusGeometry(0.7, 0.2, 6, 16).rotateX(Math.PI / 2) },
  { name: 'disc', orient: 'camera', flat: true, make: () => new THREE.CircleGeometry(1, 20) },
  { name: 'hexagon', orient: 'camera', flat: true, make: () => new THREE.CircleGeometry(1, 6) },
  { name: 'star', orient: 'camera', flat: true, make: () => fan(starPoints()) },
  // the curve sits 0.16 low of its origin: centred so the marker sits on the tip
  { name: 'heart', orient: 'camera', flat: true, make: () => fan(heartPoints()).center() },
  { name: 'custom image', orient: 'camera', flat: true, make: () => new THREE.PlaneGeometry(2, 2) },
  { name: 'custom OBJ', orient: 'spin', flat: false, make: sphere }, // the upload replaces this
]

/**
 * A small OBJ as a marker: `v` and `f` lines only (n-gons fanned, negative indices counted from
 * the end), centred and scaled to fit ±1. Throws a readable message on anything it cannot use.
 */
export function parseTipObj(text: string): THREE.BufferGeometry {
  const verts: number[] = []
  const data: number[] = []
  for (const line of text.split(/\r?\n/)) {
    const parts = line.split('#')[0].trim().split(/\s+/)
    if (parts[0] === 'v') {
      const v = parts.slice(1, 4).map(Number)
      if (v.length !== 3 || v.some((x) => !Number.isFinite(x))) throw new Error('invalid OBJ vertex')
      if (verts.length >= OBJ_VERTS * 3) throw new Error('use a smaller OBJ: at most 10,000 vertices')
      verts.push(v[0], v[1], v[2])
    } else if (parts[0] === 'f') {
      const nv = verts.length / 3
      const idx = parts.slice(1).map((s) => {
        const n = Number(s.split('/')[0])
        return n < 0 ? nv + n : n - 1
      })
      if (idx.length < 3 || idx.length > 64 || idx.some((i) => !Number.isInteger(i) || i < 0 || i >= nv)) throw new Error('invalid OBJ face')
      for (let k = 1; k < idx.length - 1; k++) {
        if (data.length >= OBJ_TRIS * 9) throw new Error('use a simpler OBJ: at most 2,048 triangles')
        for (const i of [idx[0], idx[k], idx[k + 1]]) data.push(verts[i * 3], verts[i * 3 + 1], verts[i * 3 + 2])
      }
    }
  }
  if (!data.length) throw new Error('the OBJ has no faces')
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(data, 3))
  g.computeBoundingBox()
  const size = g.boundingBox!.getSize(new THREE.Vector3())
  const centre = g.boundingBox!.getCenter(new THREE.Vector3())
  const span = Math.max(size.x, size.y, size.z)
  if (!Number.isFinite(span) || span < 1e-8) {
    g.dispose()
    throw new Error('the OBJ has no usable extent')
  }
  g.translate(-centre.x, -centre.y, -centre.z)
  g.scale(2 / span, 2 / span, 2 / span)
  g.computeVertexNormals()
  return g
}

/** A picture fitted into a transparent square tile, aspect kept. */
async function imageTile(file: File): Promise<THREE.CanvasTexture> {
  let bmp: ImageBitmap
  try {
    bmp = await createImageBitmap(file)
  } catch {
    throw new Error(`could not decode ${file.name}`)
  }
  try {
    if (!bmp.width || !bmp.height) throw new Error(`${file.name} is empty`)
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = TILE
    const k = TILE / Math.max(bmp.width, bmp.height)
    const w = bmp.width * k
    const h = bmp.height * k
    canvas.getContext('2d')!.drawImage(bmp, (TILE - w) / 2, (TILE - h) / 2, w, h)
    const tex = new THREE.CanvasTexture(canvas)
    tex.colorSpace = THREE.SRGBColorSpace
    return tex
  } finally {
    bmp.close()
  }
}

export interface TipHooks {
  /** an instanced mesh the way the engine allocates them (storage buffers on WebGPU) */
  instanced(geom: THREE.BufferGeometry, mat: THREE.Material, max: number): THREE.InstancedMesh
  /** the engine changed one of its own controls: the panel and saved settings follow */
  changed(key: string, value: number): void
  status(msg: string): void
  /** per growth: the marker's size over its radius (default 1.5 + 0.8 × onset); a played note pulses with its own attack (organism/ignition.ts) */
  pulse?(p: Plant, t: number, onset: number): number
  /** how far the growth reaches out now, in arc units from its root (organism/breath.ts): a tip beyond it hides */
  reach?(p: Plant): number
}

/** a tip this far (arc units) beyond the breath's reach is gone; nearer, it shrinks */
const TIP_FADE = 0.3

export class TipMarkers implements OrganismFeature {
  readonly id = 'tips'
  readonly controls: FeatureControl[] = [
    { key: 'tipShape', label: 'tip marker shape', min: 0, max: TIP_SHAPES.length - 1, step: 1, value: 0, options: TIP_SHAPES.map((s) => s.name), group: 'Look' },
    { key: 'tipSize', label: 'tip marker size', min: 0.1, max: 3, step: 0.1, value: 1, group: 'Look' },
    { key: 'tipBrightness', label: 'tip marker brightness', min: 0, max: 2, step: 0.05, value: 1, group: 'Look' },
    { key: 'tipLimit', label: 'tip markers at most (newest growth first)', min: 8, max: MAX_TIPS, step: 8, value: 200, group: 'Look' },
  ]
  private host: OrganismHost | null = null
  private mesh: THREE.InstancedMesh | null = null
  private readonly solid = new THREE.MeshBasicMaterial({ toneMapped: false })
  private readonly flat = new THREE.MeshBasicMaterial({ toneMapped: false, side: THREE.DoubleSide })
  private readonly cutout = new THREE.MeshBasicMaterial({ toneMapped: false, side: THREE.DoubleSide, alphaTest: 0.12 })
  private image: THREE.CanvasTexture | null = null
  private obj: THREE.BufferGeometry | null = null
  private objRev = 0
  /** the mesh's geometry when it is ours to dispose (the uploaded OBJ is not) */
  private built: THREE.BufferGeometry | null = null
  /** what the mesh shows ('' = nothing yet) */
  private shown = ''
  /** the shape drawn, after the missing-upload fallback */
  private drawn = 0
  /** bumped per load and on unmount: a slower, older load lands nowhere */
  private token = 0
  private readonly dummy = new THREE.Object3D()
  private readonly color = new THREE.Color()
  private readonly ink = new THREE.Color()
  private readonly dir = new THREE.Vector3()

  constructor(private readonly hooks: TipHooks) {}

  mount(e: OrganismHost) {
    this.host = e
    this.built = TIP_SHAPES[0].make()
    this.mesh = this.hooks.instanced(this.built, this.solid, MAX_TIPS)
    this.shown = '0'
    this.drawn = 0
    e.group.add(this.mesh)
    // an upload lasts one session: a restored custom shape comes back as the sphere
    const i = ctl(e.controls, 'tipShape')
    if (i === IMAGE || i === OBJ) {
      setCtl(e.controls, 'tipShape', 0)
      this.hooks.changed('tipShape', 0)
      this.hooks.status(`tip marker: uploads last one session — back to spheres; load the ${i === IMAGE ? 'picture' : 'OBJ'} again under Look`)
    }
  }

  unmount(e: OrganismHost) {
    this.token++
    if (this.mesh) e.group.remove(this.mesh)
    this.mesh = null
    this.built?.dispose()
    this.obj?.dispose()
    this.image?.dispose()
    for (const m of [this.solid, this.flat, this.cutout]) m.dispose()
    this.built = this.obj = this.image = null
    this.host = null
  }

  clear() {
    if (this.mesh) this.mesh.count = 0
  }

  onControl(key: string, value: number) {
    if (key !== 'tipShape' || !this.host) return
    if ((value === IMAGE && !this.image) || (value === OBJ && !this.obj))
      this.hooks.status(`tip marker: no ${value === IMAGE ? 'picture' : 'OBJ'} loaded yet — spheres until you load one (tip marker file, under Look)`)
  }

  /** Show `index`, or the sphere while its upload is missing; builds only on a change. */
  private sync(index: number) {
    const mesh = this.mesh
    if (!mesh) return
    const drawn = !TIP_SHAPES[index] || (index === IMAGE && !this.image) || (index === OBJ && !this.obj) ? 0 : index
    const key = drawn === OBJ ? `obj${this.objRev}` : String(drawn)
    if (key === this.shown) return
    this.shown = key
    this.drawn = drawn
    const shape = TIP_SHAPES[drawn]
    const geo = drawn === OBJ ? this.obj! : shape.make()
    const old = this.built
    this.built = drawn === OBJ ? null : geo
    mesh.geometry = geo
    old?.dispose()
    mesh.material = drawn === IMAGE ? this.cutout : shape.flat ? this.flat : this.solid
  }

  /**
   * Load a picture or an OBJ as the marker. Resolves to the shape index to select (-1 when
   * nothing changed) and a status line; never rejects.
   */
  async load(file: File): Promise<{ index: number; message: string }> {
    const isObj = /\.obj$/i.test(file.name)
    if (!isObj && !/\.(png|webp|jpe?g)$/i.test(file.name)) return { index: -1, message: 'tip marker: choose a PNG, WebP or JPG picture, or an OBJ' }
    if (file.size > MAX_FILE) return { index: -1, message: `tip marker: ${file.name} is over 8 MB` }
    const token = ++this.token
    const stale = () => token !== this.token || !this.mesh
    try {
      if (isObj) {
        const g = parseTipObj(await file.text())
        if (stale()) {
          g.dispose()
          return { index: -1, message: `tip marker: ${file.name} was replaced by a newer file` }
        }
        const prev = this.obj
        this.obj = g
        this.objRev++
        this.sync(OBJ) // off the old geometry before it goes
        prev?.dispose()
        const tris = g.getAttribute('position').count / 3
        return { index: OBJ, message: `tip marker: ${file.name} (${tris} triangles, up to ${CUSTOM_MAX} markers)` }
      }
      const tex = await imageTile(file)
      if (stale()) {
        tex.dispose()
        return { index: -1, message: `tip marker: ${file.name} was replaced by a newer file` }
      }
      const prev = this.image
      this.image = tex
      this.cutout.map = tex
      this.cutout.needsUpdate = true
      prev?.dispose()
      this.sync(IMAGE)
      return { index: IMAGE, message: `tip marker: ${file.name} (${TILE} px tile, this session)` }
    } catch (err) {
      return { index: -1, message: `tip marker: ${(err as Error).message}` }
    }
  }

  /**
   * Place the markers for this frame, newest growth first. Call after the camera moved: flat
   * shapes copy its orientation. `light`: 0 on black space … 1 on a light background.
   */
  update(plants: readonly Plant[], t: number, onset: number, focus: number, viewDist: number, light = 0) {
    const e = this.host
    const mesh = this.mesh
    if (!e || !mesh) return
    const c = e.controls
    const glow = ctl(c, 'glow')
    let n = 0
    if (glow > 0) {
      this.sync(ctl(c, 'tipShape'))
      const orient = TIP_SHAPES[this.drawn].orient
      const size = glow * ctl(c, 'tipSize')
      const bright = ctl(c, 'tipBrightness')
      const picture = this.drawn === IMAGE // the picture keeps its own colours
      const limit = Math.min(MAX_TIPS, ctl(c, 'tipLimit'), this.drawn === OBJ ? CUSTOM_MAX : MAX_TIPS)
      // highlight on: tips of new growth stay visible from afar and brighten in their own colour
      const minTip = focus > 0 ? focus * Math.min(0.5, Math.max(0.06, viewDist * 0.0025)) : 0
      const lift = 1.6 + 0.6 * focus
      const d = this.dummy
      outer: for (let pi = plants.length - 1; pi >= 0; pi--) {
        const p = plants[pi]
        // with the highlight on, Build shape's fill stays in the background
        if (!(p.held || p.autoUntil > t) || p.sp.glow <= 0 || (p.refAuto && focus > 0)) continue
        const pulse = this.hooks.pulse?.(p, t, onset) ?? 1.5 + 0.8 * onset
        const reach = this.hooks.reach?.(p) ?? Infinity
        for (const tip of p.tips) {
          if (n >= limit) break outer
          const seg = tip.seg
          // the music breath drew this branch back: the marker goes with its end instead of floating
          const out = reach === Infinity ? 1 : Math.min(1, Math.max(0, 1 - (tip.arc + (seg ? seg.growth * seg.a.distanceTo(seg.b) : 0) - reach) / TIP_FADE))
          if (out <= 0) continue
          if (seg) d.position.copy(seg.a).lerp(seg.b, seg.growth)
          else d.position.copy(tip.pos)
          if (orient === 'camera') d.quaternion.copy(e.camera.quaternion)
          else if (orient === 'growth') {
            const dir = seg ? this.dir.subVectors(seg.b, seg.a) : this.dir.copy(tip.dir)
            if (dir.lengthSq() > 1e-12) d.quaternion.setFromUnitVectors(Y_AXIS, dir.normalize())
            else d.quaternion.identity()
          } else if (orient === 'spin') d.quaternion.setFromAxisAngle(tip.axis, t * 0.8 + p.id * 1.731)
          else d.quaternion.identity()
          d.scale.setScalar(Math.max(tip.r * pulse * p.sp.glow, minTip) * size * out)
          d.updateMatrix()
          mesh.setMatrixAt(n, d.matrix)
          if (picture) this.color.setScalar(bright)
          else {
            this.color.copy(p.color).multiplyScalar(lift).addScalar(0.35).multiplyScalar(bright * HDR)
            if (light > 0) this.color.lerp(this.ink.copy(p.color).multiplyScalar(INK * bright), light)
          }
          mesh.setColorAt(n, this.color)
          n++
        }
      }
      if (n) {
        mesh.instanceMatrix.needsUpdate = true
        mesh.instanceColor!.needsUpdate = true
      }
    }
    mesh.count = n
  }
}
