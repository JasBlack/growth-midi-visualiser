// Gesture input: webcam → MediaPipe face + hand landmarkers (the repo's own
// VisionEngine) → head offset (parallax camera), hand position, pinch and
// open-palm flags. Runs on the main thread at ~20 Hz; models come from
// /mediapipe (yarn vendor).

import { VisionEngine, DEFAULT_ENGINE_PATHS } from '../vision/engine'

export interface Hand {
  x: number // -1..1, mirrored (move right = +x)
  y: number // -1..1, up = +y
  pinch: boolean
  open: boolean
}

export interface Gesture {
  present: boolean
  head: { x: number; y: number } // -1..1 mirrored / up = +y
  hands: Hand[]
}

export class GestureInput {
  readonly gesture: Gesture = { present: false, head: { x: 0, y: 0 }, hands: [] }
  running = false
  private video: HTMLVideoElement | null = null
  private stream: MediaStream | null = null
  private engine: VisionEngine | null = null
  private timer = 0

  async start(onStatus: (s: string) => void) {
    if (this.running) return
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ video: { width: 320, height: 240, facingMode: 'user' } })
    } catch (e) {
      onStatus(`camera denied: ${(e as Error).message}`)
      return
    }
    const v = document.createElement('video')
    v.srcObject = this.stream
    v.muted = true
    v.playsInline = true
    await v.play()
    this.video = v
    this.engine = new VisionEngine()
    try {
      await this.engine.init({ ...DEFAULT_ENGINE_PATHS, face: true, pose: false, hand: true, numPoses: 1 }, onStatus)
    } catch (e) {
      onStatus(`vision failed (run yarn vendor?): ${(e as Error).message}`)
      this.stop()
      return
    }
    this.running = true
    onStatus('gestures live — head steers, pinch rotates, open palm pushes')
    const loop = () => {
      if (!this.running) return
      this.step()
      this.timer = window.setTimeout(loop, 50)
    }
    loop()
  }

  private step() {
    const v = this.video
    const e = this.engine
    if (!v || !e || v.readyState < 2) return
    let res
    try {
      res = e.detect(v as unknown as ImageBitmap, performance.now())
    } catch {
      return
    }
    if (!res) return
    const g = this.gesture
    const face = res.faceLandmarks[0]
    if (face) {
      const nose = face[1]
      const hx = (0.5 - nose.x) * 2
      const hy = (0.5 - nose.y) * 2
      g.head.x += (hx - g.head.x) * 0.35
      g.head.y += (hy - g.head.y) * 0.35
      g.present = true
    } else g.present = false
    g.hands = res.handLandmarks.map((lm) => {
      const d = (a: number, b: number) => Math.hypot(lm[a].x - lm[b].x, lm[a].y - lm[b].y)
      const pinch = d(4, 8) < 0.06
      const spread = (d(0, 8) + d(0, 12) + d(0, 16) + d(0, 20)) / 4
      return { x: (0.5 - lm[9].x) * 2, y: (0.5 - lm[9].y) * 2, pinch, open: !pinch && spread > 0.3 }
    })
  }

  stop() {
    this.running = false
    clearTimeout(this.timer)
    this.engine?.close()
    this.engine = null
    this.stream?.getTracks().forEach((t) => t.stop())
    this.stream = null
    this.video = null
    this.gesture.present = false
    this.gesture.hands = []
  }
}
