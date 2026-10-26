// Reference field: a picture, a video file or a camera turned into small maps the growth
// reads every frame —
//
//   depth   a height field. Real monocular depth needs a ~50 MB network; this uses
//           luminance instead, which for a lit subject on a darker background reads as
//           relief in exactly the way we want (bright = near). It is a look, not a
//           measurement. Transparent pixels count as black, so a cut-out PNG stands on
//           the far plane.
//   edge    Sobel magnitude plus its gradient, so growth can crawl ALONG the lines of a
//           face, a hand, a building — the line-art idea.
//
// Both axes of the analysis canvas are capped at 192 px (portrait too), frames are analysed
// at most 30 times a second and only while the picture changes, so a frame costs well
// under a millisecond. Every open / stop starts a new request: a load that completes after
// a newer one (or after Stop) is dropped, and a late camera permission stops its stream.

const TARGET = 192
/** longest side of a still picture (the backdrop texture) */
const STILL_MAX = 1536
/** edge strength that counts as linework for the "picture drawn" percentage */
const EDGE_CELL = 0.3
/** new-strand density map: TILES × TILES over the picture */
const TILES = 12

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v)
const stopTracks = (s: MediaStream) => s.getTracks().forEach((t) => t.stop())

/**
 * A picture file's pixels. createImageBitmap first: Image.decode() never settles while the tab
 * is hidden (Chrome waits until it is shown). An <img> load covers what it cannot read (SVG).
 */
async function decodePicture(file: File): Promise<{ src: CanvasImageSource; w: number; h: number; close: () => void }> {
  try {
    const bmp = await createImageBitmap(file)
    return { src: bmp, w: bmp.width, h: bmp.height, close: () => bmp.close() }
  } catch {
    const url = URL.createObjectURL(file)
    try {
      const img = new Image()
      await new Promise<void>((ok, fail) => {
        img.onload = () => ok()
        img.onerror = () => fail(new Error('the picture cannot be decoded'))
        img.src = url
      })
      if (!img.naturalWidth || !img.naturalHeight) throw new Error('the picture has no size')
      return { src: img, w: img.naturalWidth, h: img.naturalHeight, close: () => {} }
    } finally {
      URL.revokeObjectURL(url)
    }
  }
}
const tile = (u: number, v: number) => Math.min(TILES - 1, Math.floor(clamp01(v) * TILES)) * TILES + Math.min(TILES - 1, Math.floor(clamp01(u) * TILES))

export class VideoField {
  readonly video: HTMLVideoElement
  /** a still picture, when one is loaded instead of a video */
  readonly still = document.createElement('canvas')
  isStill = false
  active = false
  source: 'none' | 'file' | 'camera' | 'image' = 'none'
  name = ''
  /** width / height of the source */
  aspect = 16 / 9
  /** a live source ended by itself (camera unplugged) or became unreadable */
  onStatus: (s: string) => void = () => {}
  /** bumps when a source goes live or stops: growth anchored to an older source keeps its shape */
  generation = 0
  /** bumps whenever the maps change */
  revision = 0
  /** where new strands start: 0 = favour details … 1 = anywhere (the engine sets it) */
  seedScatter = 0.7

  private request = 0
  private objectURL: string | null = null
  private stream: MediaStream | null = null
  private canvas = document.createElement('canvas')
  private ctx: CanvasRenderingContext2D
  private mw = 0
  private mh = 0
  private depthBuf = new Float32Array(0)
  private edgeBuf = new Float32Array(0)
  private gxBuf = new Float32Array(0)
  private gyBuf = new Float32Array(0)
  private lum = new Float32Array(0)
  private visited = new Uint8Array(0)
  private edgeCells = 0
  private visitedCells = 0
  private seedCounts = new Float32Array(TILES * TILES)
  /** mean brightness of the border: what "background" looks like in this picture */
  private background = 0
  private lastT = -Infinity
  /** video time of the last analysed frame, and whether the maps had caught up with it */
  private frameTime = -1
  private settled = false

  constructor() {
    this.video = document.createElement('video')
    this.video.muted = true // the audio side has its own inputs; never double up
    this.video.playsInline = true
    this.video.loop = true
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: true })!
  }

  /** Analysis size (0 until the first frame of a source is analysed). */
  get w() {
    return this.mw
  }
  get h() {
    return this.mh
  }

  get ready() {
    return this.active && this.mw > 0
  }

  /** What to draw as the backdrop: the video element or the still canvas. */
  get frameSource(): HTMLVideoElement | HTMLCanvasElement {
    return this.isStill ? this.still : this.video
  }

  /** A still picture: decoded first, so a picture that fails leaves the running source alone. */
  async openImage(file: File): Promise<string> {
    const request = ++this.request
    let pic: Awaited<ReturnType<typeof decodePicture>>
    try {
      pic = await decodePicture(file)
    } catch (e) {
      return `image failed: ${(e as Error).message}`
    }
    try {
      if (request !== this.request) return 'picture load cancelled'
      this.release()
      const k = Math.min(1, STILL_MAX / Math.max(pic.w, pic.h))
      this.still.width = Math.max(2, Math.round(pic.w * k))
      this.still.height = Math.max(2, Math.round(pic.h * k))
      this.still.getContext('2d')!.drawImage(pic.src, 0, 0, this.still.width, this.still.height)
      this.isStill = true
      this.live('image', file.name)
      return `picture: ${file.name}`
    } finally {
      pic.close()
    }
  }

  async openFile(file: File): Promise<string> {
    const request = ++this.request
    this.release()
    const url = URL.createObjectURL(file)
    this.objectURL = url
    this.video.src = url
    try {
      await this.video.play()
      if (request !== this.request) {
        if (this.objectURL === url) this.release() // nothing newer has claimed the element yet
        return 'video load cancelled'
      }
      this.live('file', file.name)
      return `video: ${file.name}`
    } catch (e) {
      if (request === this.request) this.release()
      return `video unavailable: ${(e as Error).message}`
    }
  }

  /** The running source stays until the permission is granted, so a denied camera changes nothing. */
  async openCamera(deviceId?: string): Promise<string> {
    const request = ++this.request
    let stream: MediaStream | null = null
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: deviceId ? { deviceId: { exact: deviceId } } : { width: 640, height: 360, facingMode: 'user' },
      })
      if (request !== this.request) {
        stopTracks(stream)
        return 'camera cancelled'
      }
      this.release()
      this.stream = stream
      this.video.srcObject = stream
      await this.video.play()
      if (request !== this.request) {
        if (this.stream === stream) this.release()
        else stopTracks(stream)
        return 'camera cancelled'
      }
      this.live('camera', stream.getVideoTracks()[0]?.label || 'camera')
      const mine = stream
      for (const t of stream.getVideoTracks()) {
        t.onended = () => {
          if (this.stream !== mine) return
          this.release()
          this.onStatus('camera disconnected')
        }
      }
      return `video: ${this.name}`
    } catch (e) {
      if (stream) {
        if (this.stream === stream) this.release()
        else stopTracks(stream)
      }
      return `camera unavailable: ${(e as Error).message}`
    }
  }

  /** Cameras available for the picker (labels appear once permission is granted). */
  async listCameras(): Promise<{ id: string; label: string }[]> {
    try {
      const devs = await navigator.mediaDevices.enumerateDevices()
      return devs.filter((d) => d.kind === 'videoinput').map((d, i) => ({ id: d.deviceId, label: d.label || `camera ${i + 1}` }))
    } catch {
      return []
    }
  }

  /** Stop the source and cancel any load still on its way. */
  stop() {
    this.request++
    this.release()
  }

  togglePlay() {
    if (this.source !== 'file') return
    if (this.video.paused) this.video.play().catch((e: Error) => this.onStatus(`video: ${e.message}`))
    else this.video.pause()
  }

  private live(source: 'file' | 'camera' | 'image', name: string) {
    this.source = source
    this.name = name
    this.active = true
    this.generation++
  }

  private stopCamera() {
    this.stream?.getTracks().forEach((t) => {
      t.onended = null
      t.stop()
    })
    this.stream = null
  }

  /** Let go of the current source and its maps (pending loads are the request counter's business). */
  private release() {
    this.video.pause()
    this.stopCamera()
    this.video.srcObject = null
    this.video.removeAttribute('src')
    this.video.load() // frees the decoder
    if (this.objectURL) URL.revokeObjectURL(this.objectURL)
    this.objectURL = null
    if (this.active) this.generation++
    this.active = false
    this.isStill = false
    this.source = 'none'
    this.name = ''
    this.mw = this.mh = 0
    this.lastT = -Infinity
    this.frameTime = -1
    this.settled = false
    this.edgeCells = this.visitedCells = 0
    this.seedCounts.fill(0)
    this.revision++
  }

  /** Grab and analyse a frame: at most 30 Hz, and a paused video is left alone once the maps caught up. */
  update(now: number) {
    if (!this.active) return
    if (this.isStill) {
      if (this.mw) return // analysed once, stays put
    } else if (this.video.readyState < 2) return
    if (now - this.lastT < 1 / 30) return
    const frame = this.isStill ? 0 : this.video.currentTime
    if (!this.isStill && frame === this.frameTime && this.settled) return
    const sw = this.isStill ? this.still.width : this.video.videoWidth
    const sh = this.isStill ? this.still.height : this.video.videoHeight
    if (!sw || !sh) return
    const dt = Number.isFinite(this.lastT) ? Math.max(0, now - this.lastT) : 1
    this.lastT = now
    this.frameTime = frame
    this.aspect = sw / sh
    const k = Math.min(TARGET / sw, TARGET / sh)
    const w = Math.max(2, Math.round(sw * k))
    const h = Math.max(2, Math.round(sh * k))
    const fresh = w !== this.mw || h !== this.mh
    const n = w * h
    if (fresh) {
      this.mw = w
      this.mh = h
      this.canvas.width = w
      this.canvas.height = h
      this.depthBuf = new Float32Array(n)
      this.edgeBuf = new Float32Array(n)
      this.gxBuf = new Float32Array(n)
      this.gyBuf = new Float32Array(n)
      this.lum = new Float32Array(n)
      this.visited = new Uint8Array(n)
    }
    let px: Uint8ClampedArray
    try {
      this.ctx.clearRect(0, 0, w, h)
      this.ctx.drawImage(this.frameSource, 0, 0, w, h)
      px = this.ctx.getImageData(0, 0, w, h).data
    } catch (e) {
      this.stop()
      this.onStatus(`cannot read reference: ${(e as Error).message}`)
      return
    }
    const lum = this.lum
    // premultiplied by alpha: see-through counts as black (far)
    for (let i = 0, p = 0; i < n; i++, p += 4) lum[i] = ((px[p] * 0.299 + px[p + 1] * 0.587 + px[p + 2] * 0.114) / 255) * (px[p + 3] / 255)
    let border = 0
    for (let x = 0; x < w; x++) border += lum[x] + lum[n - w + x]
    for (let y = 1; y < h - 1; y++) border += lum[y * w] + lum[y * w + w - 1]
    this.background = border / (2 * w + 2 * (h - 2))
    // live frames ease in over time (sensor noise must not jitter the growth); a new size or a still lands at once
    const a = fresh || this.isStill ? 1 : 1 - Math.exp(-dt * 9)
    const depth = this.depthBuf
    const edge = this.edgeBuf
    const visited = this.visited
    let lagMax = 0
    let edgeCells = 0
    let visitedCells = 0
    for (let y = 0; y < h; y++) {
      const ym = (y > 0 ? y - 1 : 0) * w
      const y0 = y * w
      const yp = (y < h - 1 ? y + 1 : h - 1) * w
      for (let x = 0; x < w; x++) {
        const i = y0 + x
        const xm = x > 0 ? x - 1 : 0
        const xp = x < w - 1 ? x + 1 : w - 1
        const tl = lum[ym + xm]
        const tc = lum[ym + x]
        const tr = lum[ym + xp]
        const ml = lum[y0 + xm]
        const mc = lum[i]
        const mr = lum[y0 + xp]
        const bl = lum[yp + xm]
        const bc = lum[yp + x]
        const br = lum[yp + xp]
        const blur = (tl + tr + bl + br + 2 * (tc + ml + mr + bc) + 4 * mc) / 16
        const d = depth[i] + (blur - depth[i]) * a
        depth[i] = d
        const lag = Math.abs(blur - d)
        if (lag > lagMax) lagMax = lag
        const gx = tr + 2 * mr + br - (tl + 2 * ml + bl)
        const gy = bl + 2 * bc + br - (tl + 2 * tc + tr)
        this.gxBuf[i] = gx
        this.gyBuf[i] = gy
        const e = Math.min(1, Math.hypot(gx, gy) * 0.9)
        edge[i] = e
        // what moved in a live picture is undrawn again, so new strands go there
        if (!this.isStill && lag > 0.025) visited[i] = 0
        if (e >= EDGE_CELL) {
          edgeCells++
          if (visited[i]) visitedCells++
        }
      }
    }
    this.edgeCells = edgeCells
    this.visitedCells = visitedCells
    this.settled = lagMax < 0.004
    this.revision++
  }

  private idx(u: number, v: number) {
    return Math.round(clamp01(v) * (this.mh - 1)) * this.mw + Math.round(clamp01(u) * (this.mw - 1))
  }

  /** Bilinear, so growth reading the maps between texels moves smoothly. */
  private sample(buf: Float32Array, u: number, v: number) {
    const w = this.mw
    const h = this.mh
    if (!w) return 0
    const x = clamp01(u) * (w - 1)
    const y = clamp01(v) * (h - 1)
    const x0 = Math.floor(x)
    const y0 = Math.floor(y)
    const x1 = Math.min(w - 1, x0 + 1)
    const r0 = y0 * w
    const r1 = Math.min(h - 1, y0 + 1) * w
    const fx = x - x0
    const fy = y - y0
    return (buf[r0 + x0] * (1 - fx) + buf[r0 + x1] * fx) * (1 - fy) + (buf[r1 + x0] * (1 - fx) + buf[r1 + x1] * fx) * fy
  }

  /** 0 (far / dark) .. 1 (near / bright) at normalised picture coordinates. */
  depth(u: number, v: number) {
    return this.sample(this.depthBuf, u, v)
  }

  /** 0 .. 1 edge strength. */
  edge(u: number, v: number) {
    return this.sample(this.edgeBuf, u, v)
  }

  /** Image gradient at (u, v). Its perpendicular is the direction a line runs in. */
  grad(u: number, v: number, out: { x: number; y: number }) {
    out.x = this.sample(this.gxBuf, u, v)
    out.y = this.sample(this.gyBuf, u, v)
  }

  /** Growth touched this spot (and its neighbours): for the "picture drawn" percentage and for seeding. */
  visit(u: number, v: number) {
    if (!this.mw || u < 0 || u > 1 || v < 0 || v > 1) return
    const i = this.idx(u, v)
    const x = i % this.mw
    const y = (i - x) / this.mw
    for (let dy = -1; dy <= 1; dy++) {
      const yy = y + dy
      if (yy < 0 || yy >= this.mh) continue
      for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx
        if (xx < 0 || xx >= this.mw) continue
        const j = yy * this.mw + xx
        if (this.visited[j]) continue
        this.visited[j] = 1
        if (this.edgeBuf[j] >= EDGE_CELL) this.visitedCells++
      }
    }
  }

  /** How much of the picture's linework growth has traced, 0..1. */
  coverage() {
    return this.edgeCells ? Math.min(1, this.visitedCells / this.edgeCells) : 0
  }

  /** Reset: nothing is drawn yet and no area is crowded. */
  resetCoverage() {
    this.visited.fill(0)
    this.visitedCells = 0
    this.seedCounts.fill(0)
  }

  /**
   * Where a new strand starts: weighted reservoir sampling over random (continuous) points.
   * Detail (lines and whatever stands out from the border's level, or brightness) weighs in
   * as far as seedScatter allows; already drawn spots and crowded tiles of the density map
   * weigh less, so strands spread over the picture instead of piling up.
   */
  pickPoint(preferEdges = true, tries = 32): { u: number; v: number } {
    const scatter = clamp01(this.seedScatter)
    const counts = this.seedCounts
    let cu = Math.random()
    let cv = Math.random()
    let total = 0
    for (let i = 0; i < tries; i++) {
      const u = Math.random()
      const v = Math.random()
      const d = this.depth(u, v)
      const detail = preferEdges ? 0.15 + 2 * this.edge(u, v) + Math.abs(d - this.background) : 0.25 + d
      const drawn = this.mw && this.visited[this.idx(u, v)] ? 0.3 : 1
      const w = ((scatter + (1 - scatter) * detail) * drawn) / (1 + counts[tile(u, v)] * 0.8)
      total += w
      if (Math.random() * total < w) {
        cu = u
        cv = v
      }
    }
    counts[tile(cu, cv)]++
    // slowly forget old roots, so long sessions and changing footage stay varied
    for (let i = 0; i < counts.length; i++) counts[i] *= 0.998
    return { u: cu, v: cv }
  }
}
