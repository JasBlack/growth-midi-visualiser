// Screen bounce (v0.18, the "DVD logo"): the picture is scaled down and slid around the frame
// by a lens shift in the projection matrix, reflecting off the edges. Only the projection of
// the one render changes, so it shows in snapshots and recordings and never touches the scene.

import * as THREE from 'three'
import { ctl } from '../../engine'
import type { FeatureControl, OrganismFeature, OrganismHost } from './feature'

/** Where the growth is, and the frame clock (the camera rig provides both). */
export interface FramingVolume {
  readonly center: THREE.Vector3
  readonly radius: number
  readonly time: number
}

interface Axis {
  position: number
  direction: number
}

const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x))
/** projection-matrix elements of the clip x and y rows (column-major) */
const XY_ROWS = [0, 4, 8, 12, 1, 5, 9, 13]

/**
 * Travel `distance` from `position` inside ±limit, reflecting at the ends. A triangle wave in
 * closed form, so however long the frame, there is no bounce loop. Writes into `out`.
 */
export function reflectedStep(position: number, direction: number, distance: number, limit: number, out: Axis): Axis {
  out.direction = direction
  if (limit <= 0) out.position = 0
  else if (distance <= 0) out.position = clamp(position, -limit, limit)
  else {
    const span = limit * 2
    const phase = ((((position + direction * distance + limit) % (span * 2)) + span * 2) % (span * 2))
    if (phase > span) {
      out.position = limit - (phase - span)
      out.direction = -direction
    } else out.position = phase - limit
  }
  return out
}

export class ScreenBounce implements OrganismFeature {
  readonly id = 'screenBounce'
  readonly controls: FeatureControl[] = [
    { key: 'screenBounce', label: 'screen bounce: the sculpture travels around the frame (0 / 1)', min: 0, max: 1, step: 1, value: 0, group: 'Camera' },
    { key: 'bounceSpeed', label: 'screen bounce: speed', min: 0, max: 0.5, step: 0.01, value: 0.08, group: 'Camera' },
    { key: 'bounceSize', label: 'screen bounce: sculpture size on screen', min: 0.2, max: 0.85, step: 0.05, value: 0.55, group: 'Camera' },
  ]
  private last: number | null = null
  /** the growth on screen (NDC centre and half-size), smoothed */
  private readonly b = { x: 0, y: 0, hx: 1, hy: 1 }
  private measured = false
  private readonly x: Axis = { position: 0, direction: 1 }
  private readonly y: Axis = { position: 0, direction: 1 }
  private readonly v = new THREE.Vector3()

  constructor(private readonly vol: FramingVolume) {}

  clear() {
    this.measured = false
  }

  beforeDraw(e: OrganismHost): boolean {
    const c = e.controls
    if (!(ctl(c, 'screenBounce') > 0)) {
      this.last = null
      this.measured = false
      return false
    }
    const cam = e.camera
    const time = this.vol.time
    // bounded: a stall never teleports it; a snapshot redraw (same clock) does not move it
    const dt = this.last === null ? 0 : clamp(time - this.last, 0, 0.05)
    this.last = time
    // the framing sphere on screen, from fov and aspect (independent of any shift applied before)
    cam.updateMatrixWorld()
    const p = this.v.copy(this.vol.center).applyMatrix4(cam.matrixWorldInverse)
    const z = -p.z
    const r = this.vol.radius
    const ty = Math.tan((cam.fov * Math.PI) / 360) / cam.zoom
    const tx = ty * cam.aspect
    // the camera inside the growth (fly-through modes): the whole view travels
    let bx = 0
    let by = 0
    let hx = 1
    let hy = 1
    if (z > r * 1.05) {
      const tanA = r / Math.sqrt(z * z - r * r)
      bx = clamp(p.x / z / tx, -1, 1)
      by = clamp(p.y / z / ty, -1, 1)
      hx = Math.max(0.05, tanA / tx)
      hy = Math.max(0.05, tanA / ty)
    }
    const b = this.b
    const a = this.measured ? 1 - Math.exp(-dt * 6) : 1
    this.measured = true
    b.x += (bx - b.x) * a
    b.y += (by - b.y) * a
    b.hx += (hx - b.hx) * a
    b.hy += (hy - b.hy) * a
    const scale = Math.min(1, ctl(c, 'bounceSize') / Math.max(b.hx, b.hy)) // never enlarges
    const limX = Math.max(0, 0.96 - b.hx * scale)
    const limY = Math.max(0, 0.96 - b.hy * scale)
    const speed = ctl(c, 'bounceSpeed') * 2 // NDC per second; slower vertically so the path is not one diagonal
    reflectedStep(clamp(this.x.position, -limX, limX), this.x.direction, dt * speed, limX, this.x)
    reflectedStep(clamp(this.y.position, -limY, limY), this.y.direction, dt * speed * 0.71, limY, this.y)
    // NDC' = NDC·scale + (travel − centre·scale): scale the x and y rows, shift through the w column
    const m = cam.projectionMatrix.elements
    for (const i of XY_ROWS) m[i] *= scale
    m[8] -= this.x.position - b.x * scale
    m[9] -= this.y.position - b.y * scale
    cam.projectionMatrixInverse.copy(cam.projectionMatrix).invert()
    return true
  }

  afterDraw(e: OrganismHost, bounced: unknown) {
    // recompute instead of restoring a copy: the render itself may have rebuilt the projection
    // (three moves a camera to the WebGPU clip convention on its first render)
    if (bounced) e.camera.updateProjectionMatrix()
  }
}
