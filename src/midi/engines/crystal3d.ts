// 3D accretion. Notes deposit voxels onto a growing crystal: pitch class picks
// a growth direction around the vertical axis, octave tilts it up or down, and
// velocity sets how much material lands. Held notes keep depositing. The whole
// structure is replicated N-fold around the axis (chords), breathes with
// energy, and dissolves from the oldest voxel outward when decay is on.

import * as THREE from 'three' // runtime → three/webgpu (vite alias)
import { WebGPURenderer, StorageInstancedBufferAttribute } from 'three/webgpu'
import type { Engine, EngineControl, GlobalParams } from '../engine'
import { ctl, setCtl } from '../engine'
import type { MusicState } from '../music'
import { pitchClass, octave } from '../music'
import { noteRgb, cosPalette } from '../color'

const MAX = 14000
const NEIGH = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1],
] as const

interface GrowJob {
  pitch: number
  dir: THREE.Vector3
  color: THREE.Color
  remaining: number
  frontier: number[] // indices of voxels this job placed recently
}

export class Crystal3dEngine implements Engine {
  readonly id = 'crystal'
  readonly name = 'Crystal 3D'
  readonly blurb = 'Voxels accrete along note directions into a 3D structure. Chords replicate it around the axis; decay dissolves it.'
  controls: EngineControl[] = [
    { key: 'deposit', label: 'material per note', min: 1, max: 40, step: 1, value: 12 },
    { key: 'focus', label: 'direction focus', min: 0, max: 6, step: 0.1, value: 2.5 },
    { key: 'shape', label: 'voxel shape (0 cube · 1 octa · 2 ico)', min: 0, max: 2, step: 1, value: 0 },
    { key: 'orbit', label: 'orbit speed', min: 0, max: 2, step: 0.05, value: 0.6 },
    { key: 'breathe', label: 'breathe', min: 0, max: 1, step: 0.02, value: 0.4 },
    { key: 'gap', label: 'voxel gap', min: 0, max: 0.6, step: 0.02, value: 0.12 },
  ]

  private host!: HTMLElement
  private canvas!: HTMLCanvasElement
  private renderer: WebGPURenderer | null = null
  private scene = new THREE.Scene()
  private camera = new THREE.PerspectiveCamera(50, 1, 0.1, 500)
  private group = new THREE.Group()
  private meshes: THREE.InstancedMesh[] = []
  private material!: THREE.MeshStandardMaterial
  private pointLight!: THREE.PointLight
  private count = 0
  private pos = new Int16Array(MAX * 3)
  private occ = new Map<string, number>()
  private jobs = new Map<number, GrowJob>()
  private theta = 0
  private radius = 2
  private ready = false
  private dummy = new THREE.Object3D()
  private shapeNow = -1
  /** a recording's fixed frame size; null = follow the window */
  private outSize: { width: number; height: number } | null = null

  async mount(host: HTMLElement) {
    this.host = host
    this.canvas = document.createElement('canvas')
    host.appendChild(this.canvas)
    const renderer = new WebGPURenderer({ canvas: this.canvas, antialias: true, forceWebGL: !('gpu' in navigator) })
    await renderer.init()
    this.renderer = renderer
    renderer.setPixelRatio(this.ratio())
    this.scene.background = new THREE.Color(0x000000)
    this.scene.fog = new THREE.FogExp2(0x000000, 0.012)
    this.scene.add(this.group)
    this.scene.add(new THREE.HemisphereLight(0x8899bb, 0x221111, 0.7))
    const dir = new THREE.DirectionalLight(0xffffff, 1.4)
    dir.position.set(4, 8, 6)
    this.scene.add(dir)
    this.pointLight = new THREE.PointLight(0xffffff, 0, 60, 1.5)
    this.scene.add(this.pointLight)
    this.material = new THREE.MeshStandardMaterial({ roughness: 0.45, metalness: 0.25, flatShading: true })
    this.buildMeshes()
    this.resize()
    this.clear()
    this.ready = true
  }

  private geometry(): THREE.BufferGeometry {
    const s = 1 - ctl(this.controls, 'gap')
    const shape = ctl(this.controls, 'shape')
    if (shape === 1) return new THREE.OctahedronGeometry(s * 0.72)
    if (shape === 2) return new THREE.IcosahedronGeometry(s * 0.62)
    return new THREE.BoxGeometry(s, s, s)
  }

  private buildMeshes() {
    for (const m of this.meshes) {
      this.group.remove(m)
      m.geometry.dispose()
    }
    const geom = this.geometry()
    const main = new THREE.InstancedMesh(geom, this.material, MAX)
    // Storage buffer for the matrices: three's WebGPU path sizes the instance
    // uniform buffer from the count at first render, so a mesh that STARTS
    // small and grows to MAX would blow the 64 KB uniform limit. Storage has
    // no such cap and is the intended path for large dynamic instance sets.
    if ('gpu' in navigator) main.instanceMatrix = new StorageInstancedBufferAttribute(new Float32Array(MAX * 16), 16) as unknown as THREE.InstancedBufferAttribute
    main.setColorAt(0, new THREE.Color(1, 1, 1)) // allocates instanceColor
    main.instanceColor!.setUsage(THREE.DynamicDrawUsage)
    main.frustumCulled = false
    this.meshes = [main]
    // replicas share the instance buffers; each just rotates around Y
    for (let i = 1; i < 8; i++) {
      const rep = new THREE.InstancedMesh(geom, this.material, MAX)
      rep.instanceMatrix = main.instanceMatrix
      rep.instanceColor = main.instanceColor
      rep.frustumCulled = false
      rep.visible = false
      this.meshes.push(rep)
    }
    for (const m of this.meshes) this.group.add(m)
    this.shapeNow = ctl(this.controls, 'shape')
    this.syncCount()
  }

  private syncCount() {
    for (const m of this.meshes) m.count = this.count
  }

  private ratio() {
    return this.outSize ? 1 : Math.min(1.5, window.devicePixelRatio || 1)
  }

  setOutputSize(size: { width: number; height: number } | null) {
    this.outSize = size ? { width: size.width, height: size.height } : null
    if (!this.renderer) return
    this.renderer.setPixelRatio(this.ratio())
    this.resize()
  }

  resize() {
    if (!this.renderer) return
    const o = this.outSize
    if (o) {
      // a take: fixed drawing buffer, letterboxed preview (see OrganismEngine.resize)
      this.renderer.setSize(o.width, o.height, false)
      Object.assign(this.canvas.style, { width: '100%', height: '100%', objectFit: 'contain' })
      this.camera.aspect = o.width / o.height
      this.camera.updateProjectionMatrix()
      return
    }
    this.canvas.style.objectFit = ''
    const w = this.host.clientWidth
    const h = this.host.clientHeight
    // hidden pane / minimised window / an OBS source that starts at 0x0: keep the
    // last good size rather than asking the GPU for a zero-sized swapchain
    if (w < 2 || h < 2) return
    this.renderer.setSize(w, h, true)
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
  }

  clear() {
    this.count = 0
    this.occ.clear()
    this.jobs.clear()
    this.radius = 2
    this.addVoxel(0, 0, 0, new THREE.Color(0.6, 0.6, 0.7))
    this.syncCount()
  }

  setControl(key: string, value: number) {
    setCtl(this.controls, key, value)
    if ((key === 'shape' || key === 'gap') && this.renderer) this.buildMeshes()
  }

  private key(x: number, y: number, z: number) {
    return `${x},${y},${z}`
  }

  private addVoxel(x: number, y: number, z: number, color: THREE.Color): number {
    if (this.count >= MAX) this.removeOldest(256)
    const main = this.meshes[0]
    const idx = this.count++
    this.pos[idx * 3] = x
    this.pos[idx * 3 + 1] = y
    this.pos[idx * 3 + 2] = z
    this.occ.set(this.key(x, y, z), idx)
    this.dummy.position.set(x, y, z)
    this.dummy.rotation.set(0, 0, 0)
    const s = 0.85 + Math.random() * 0.25
    this.dummy.scale.set(s, s, s)
    this.dummy.updateMatrix()
    main.setMatrixAt(idx, this.dummy.matrix)
    main.setColorAt(idx, color)
    main.instanceMatrix.needsUpdate = true
    main.instanceColor!.needsUpdate = true
    this.radius = Math.max(this.radius, Math.sqrt(x * x + y * y + z * z))
    return idx
  }

  /** Drop the `k` oldest voxels (index 0..k-1) — one memmove of the instance
   *  buffers, then a rebuild of the occupancy map. Keeps strict age order so
   *  decay visibly dissolves the structure from where it started. */
  private removeOldest(k: number) {
    k = Math.min(k, this.count - 1)
    if (k <= 0) return
    const main = this.meshes[0]
    const n = this.count
    this.pos.copyWithin(0, k * 3, n * 3)
    const mat = main.instanceMatrix.array as Float32Array
    mat.copyWithin(0, k * 16, n * 16)
    const col = main.instanceColor!.array as Float32Array
    col.copyWithin(0, k * 3, n * 3)
    main.instanceMatrix.needsUpdate = true
    main.instanceColor!.needsUpdate = true
    this.count = n - k
    this.occ.clear()
    for (let i = 0; i < this.count; i++) this.occ.set(this.key(this.pos[i * 3], this.pos[i * 3 + 1], this.pos[i * 3 + 2]), i)
    for (const j of this.jobs.values()) j.frontier = j.frontier.map((i) => i - k).filter((i) => i >= 0)
  }

  private grow(job: GrowJob) {
    const focus = ctl(this.controls, 'focus')
    for (let attempt = 0; attempt < 6; attempt++) {
      let anchor: number
      if (job.frontier.length && Math.random() < 0.85) anchor = job.frontier[(Math.random() * job.frontier.length) | 0]
      else anchor = (Math.random() * this.count) | 0
      if (anchor >= this.count) continue
      const ax = this.pos[anchor * 3]
      const ay = this.pos[anchor * 3 + 1]
      const az = this.pos[anchor * 3 + 2]
      // weighted neighbour pick toward the growth direction
      let total = 0
      const weights: number[] = []
      for (const n of NEIGH) {
        const d = n[0] * job.dir.x + n[1] * job.dir.y + n[2] * job.dir.z
        const wgt = Math.exp(focus * d) + 0.05
        weights.push(wgt)
        total += wgt
      }
      let r = Math.random() * total
      let pick = 0
      for (; pick < NEIGH.length - 1; pick++) {
        r -= weights[pick]
        if (r <= 0) break
      }
      const n = NEIGH[pick]
      const x = ax + n[0]
      const y = ay + n[1]
      const z = az + n[2]
      if (Math.abs(x) > 60 || Math.abs(y) > 60 || Math.abs(z) > 60) continue
      if (this.occ.has(this.key(x, y, z))) continue
      const idx = this.addVoxel(x, y, z, job.color)
      job.frontier.push(idx)
      if (job.frontier.length > 24) job.frontier.shift()
      return true
    }
    return false
  }

  frame(m: MusicState, g: GlobalParams) {
    if (!this.ready || !this.renderer) return
    if (this.shapeNow !== ctl(this.controls, 'shape')) this.buildMeshes()
    const dt = m.dt
    const deposit = ctl(this.controls, 'deposit')

    for (const ev of m.events) {
      if (ev.kind === 'on') {
        const yaw = (pitchClass(ev.pitch) / 12) * Math.PI * 2
        const tilt = (octave(ev.pitch) - 4) * 0.42
        const dir = new THREE.Vector3(Math.cos(yaw) * Math.cos(tilt), Math.sin(tilt), Math.sin(yaw) * Math.cos(tilt)).normalize()
        const rgb = noteRgb(g.palette, ev.pitch, 0.2 + octave(ev.pitch) * 0.05)
        this.jobs.set(ev.pitch, {
          pitch: ev.pitch,
          dir,
          color: new THREE.Color(rgb[0], rgb[1], rgb[2]),
          remaining: 2 + deposit * ev.velocity,
          frontier: [],
        })
      }
    }
    // held notes keep depositing; finished jobs from released notes are dropped
    for (const [pitch, job] of this.jobs) {
      if (m.active.has(pitch)) job.remaining += deposit * 0.5 * g.growth * dt
      if (job.remaining < 1 && !m.active.has(pitch)) this.jobs.delete(pitch)
    }
    let budget = Math.ceil(400 * dt * g.growth) // voxels per frame, all jobs
    for (const job of this.jobs.values()) {
      while (job.remaining >= 1 && budget > 0) {
        job.remaining -= 1
        budget--
        this.grow(job)
      }
    }
    // decay: dissolve from the oldest voxel when nothing is playing
    if (g.decay > 0 && m.active.size === 0) {
      const n = Math.floor(g.decay * 240 * dt + Math.random())
      if (n > 0) this.removeOldest(n)
    }
    this.syncCount()

    // replication
    const sym = Math.max(1, Math.round(g.symmetryNow))
    for (let i = 0; i < this.meshes.length; i++) {
      const mesh = this.meshes[i]
      mesh.visible = i < sym
      mesh.rotation.y = (i / sym) * Math.PI * 2
    }

    // breathing + rotation + camera
    const breathe = ctl(this.controls, 'breathe')
    const s = 1 + breathe * (0.15 * m.energy + 0.25 * m.onset)
    this.group.scale.setScalar(s)
    this.group.rotation.y = g.rotNow * 0.5
    this.theta += dt * ctl(this.controls, 'orbit') * (0.25 + 0.6 * m.energy)
    const dist = ((this.radius + 3) * 2.3) / g.zoomNow
    const phi = 0.35 + 0.25 * Math.sin(m.time * 0.13) + m.register * 0.3 - 0.15
    this.camera.position.set(Math.cos(this.theta) * Math.cos(phi) * dist, Math.sin(phi) * dist, Math.sin(this.theta) * Math.cos(phi) * dist)
    this.camera.lookAt(0, 0, 0)

    const pc = m.rootPc >= 0 ? m.rootPc : 0
    const lc = cosPalette(g.palette, 0.5, (pc / 12) * g.palette.pitchSpread)
    this.pointLight.color.setRGB(lc[0], lc[1], lc[2])
    this.pointLight.intensity = 40 * (m.energy * 0.6 + m.onset)
    this.pointLight.distance = this.radius * 3 + 10

    // every so often, shrink the tracked radius so the camera re-fits a dissolved crystal
    if (((m.time * 2) | 0) % 4 === 0 && Math.random() < 0.05) {
      let r2 = 4
      for (let i = 0; i < this.count; i++) {
        const x = this.pos[i * 3]
        const y = this.pos[i * 3 + 1]
        const z = this.pos[i * 3 + 2]
        r2 = Math.max(r2, x * x + y * y + z * z)
      }
      this.radius = Math.sqrt(r2)
    }

    this.renderer.render(this.scene, this.camera)
  }

  unmount() {
    this.ready = false
    for (const mesh of this.meshes) {
      this.group.remove(mesh)
      mesh.geometry.dispose()
    }
    this.meshes = []
    this.material?.dispose()
    this.renderer?.dispose()
    this.renderer = null
    this.canvas.remove()
  }
}
