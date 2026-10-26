// MediaPipe engine — ported from sense-human/src/vision/visionEngine.ts.
// Differences: runs in a worker, takes ImageBitmap input with caller-owned
// timestamps (the rail's tap controls cadence), models/wasm are vendored
// locally (LAN demos must not depend on a CDN), and face/pose are
// individually toggleable (the hand marker only needs pose).

import { FaceLandmarker, PoseLandmarker, HandLandmarker } from '@mediapipe/tasks-vision'
// Vite-bundled MediaPipe runtime. Two problems forced this: (1) serving the glue
// from /public made the dev server refuse to import() it ("…should not be imported
// from source code" — same as the ort jsep runtime); (2) in a MODULE worker the
// CLASSIC glue's `var ModuleFactory` can't reach the global scope (importScripts
// is unavailable), and the "module" glue variant EXPORTS the factory rather than
// setting the global MediaPipe checks ("ModuleFactory not set."). Fix: fetch the
// CLASSIC glue from its bundled ?url and indirect-eval it so `var ModuleFactory`
// lands on the worker global; point the fileset at the same bundled assets so
// MediaPipe's own import() resolves. Bare specifiers are blocked by the package
// exports map → reference dist files by a relative node_modules ?url path.
import wasmLoaderUrl from '../../node_modules/@mediapipe/tasks-vision/wasm/vision_wasm_internal.js?url'
import wasmBinaryUrl from '../../node_modules/@mediapipe/tasks-vision/wasm/vision_wasm_internal.wasm?url'
import nosimdLoaderUrl from '../../node_modules/@mediapipe/tasks-vision/wasm/vision_wasm_nosimd_internal.js?url'
import { analyze, MovementTracker } from './analyze'
import type { VisionResult } from './types'

export interface EngineConfig {
  faceModel: string
  poseModel: string
  handModel: string
  face: boolean
  pose: boolean
  hand: boolean
  /** Max people for pose/OpenPose detection. */
  numPoses: number
}

export const DEFAULT_ENGINE_PATHS = {
  faceModel: '/mediapipe/models/face_landmarker.task',
  poseModel: '/mediapipe/models/pose_landmarker_lite.task',
  handModel: '/mediapipe/models/hand_landmarker.task',
}

// The Vite-bundled MediaPipe runtime; passed to every createFromOptions in place
// of FilesetResolver. Task models still load by URL (a fetch) from /public.
const WASM_FILESET = { wasmLoaderPath: wasmLoaderUrl, wasmBinaryPath: wasmBinaryUrl }

// Preload the glue so its `var ModuleFactory` lands on the worker global scope.
// MediaPipe CLEARS self.ModuleFactory after every task creation, so restore the
// cached factory before EACH createFromOptions. SIMD build first, nosimd fallback.
let cachedModuleFactory: unknown = null
async function ensureWasmGlue(): Promise<void> {
  const g = globalThis as Record<string, unknown>
  if (!cachedModuleFactory) {
    for (const url of [wasmLoaderUrl, nosimdLoaderUrl]) {
      try {
        const res = await fetch(url)
        if (!res.ok) continue
        const src = await res.text()
        ;(0, eval)(src) // indirect eval: global scope, sets self.ModuleFactory
        if (g.ModuleFactory) {
          cachedModuleFactory = g.ModuleFactory
          break
        }
      } catch {
        /* try next variant */
      }
    }
  }
  if (cachedModuleFactory) g.ModuleFactory = cachedModuleFactory
}

export class VisionEngine {
  private face: FaceLandmarker | null = null
  private pose: PoseLandmarker | null = null
  private hand: HandLandmarker | null = null
  private tracker = new MovementTracker()
  private fpsWindow: number[] = []
  private lastTs = 0

  async init(cfg: EngineConfig, onStatus: (msg: string) => void): Promise<void> {
    onStatus('loading vision runtime…')
    await ensureWasmGlue()
    const fileset = WASM_FILESET

    if (cfg.face) {
      onStatus('loading face landmarker…')
      await ensureWasmGlue()
      this.face = await FaceLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: cfg.faceModel, delegate: 'GPU' },
        runningMode: 'VIDEO',
        numFaces: 1,
        outputFaceBlendshapes: true,
        outputFacialTransformationMatrixes: true,
      })
    }
    if (cfg.pose) {
      onStatus('loading pose landmarker…')
      await ensureWasmGlue()
      this.pose = await PoseLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: cfg.poseModel, delegate: 'GPU' },
        runningMode: 'VIDEO',
        numPoses: Math.max(1, Math.min(8, cfg.numPoses || 1)), // multi-person (cost ~linear)
      })
    }
    if (cfg.hand) {
      onStatus('loading hand landmarker…')
      await ensureWasmGlue()
      this.hand = await HandLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: cfg.handModel, delegate: 'GPU' },
        runningMode: 'VIDEO',
        numHands: 2,
      })
    }
    onStatus('')
  }

  detect(input: ImageBitmap | VideoFrame, tsMs: number): VisionResult | null {
    // detectForVideo timestamps must increase monotonically.
    if (tsMs <= this.lastTs) tsMs = this.lastTs + 1
    this.lastTs = tsMs

    const t0 = performance.now()
    const faceResult = this.face ? this.face.detectForVideo(input, tsMs) : null
    const poseResult = this.pose ? this.pose.detectForVideo(input, tsMs) : null
    // Hands isolated: a hand-inference failure must not take down face/pose. On
    // error, disable hands (so it stops erroring every frame) and surface the real
    // reason ONCE — the worker turns the throw into a 'vision error:' log line.
    let handResult: ReturnType<HandLandmarker['detectForVideo']> | null = null
    if (this.hand) {
      try {
        handResult = this.hand.detectForVideo(input, tsMs)
      } catch (e) {
        const h = this.hand
        this.hand = null
        try {
          h.close()
        } catch {
          /* already gone */
        }
        throw new Error('hand landmarker failed (disabled): ' + (e instanceof Error ? e.message : String(e)))
      }
    }
    const inferenceMs = performance.now() - t0

    const now = performance.now()
    this.fpsWindow.push(now)
    while (this.fpsWindow.length > 0 && now - this.fpsWindow[0] > 1000) this.fpsWindow.shift()

    return {
      analysis: analyze(faceResult, poseResult, this.tracker, this.fpsWindow.length, inferenceMs),
      faceLandmarks: faceResult?.faceLandmarks ?? [],
      poseLandmarks: poseResult?.landmarks ?? [],
      poseWorldLandmarks: poseResult?.worldLandmarks ?? [],
      handLandmarks: handResult?.landmarks ?? [],
      tsMs,
    }
  }

  close(): void {
    this.face?.close()
    this.pose?.close()
    this.hand?.close()
    this.face = null
    this.pose = null
    this.hand = null
  }
}
