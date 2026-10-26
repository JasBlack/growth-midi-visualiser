// Vendors the MediaPipe WASM runtime + the face / hand landmarkers into public/
// (only needed for webcam gestures). public/mediapipe is gitignored; run once
// after `yarn install`.
import { mkdirSync, copyFileSync, existsSync, readdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const wasmSrc = 'node_modules/@mediapipe/tasks-vision/wasm'
const wasmDst = 'public/mediapipe/wasm'
const modelDst = 'public/mediapipe/models'
mkdirSync(wasmDst, { recursive: true })
mkdirSync(modelDst, { recursive: true })
for (const f of readdirSync(wasmSrc)) copyFileSync(path.join(wasmSrc, f), path.join(wasmDst, f))
console.log(`copied ${readdirSync(wasmSrc).length} wasm runtime files`)

const MODELS = {
  'face_landmarker.task': 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',
  'hand_landmarker.task': 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',
}
for (const [name, url] of Object.entries(MODELS)) {
  const dst = path.join(modelDst, name)
  if (existsSync(dst)) {
    console.log(`have ${name}`)
    continue
  }
  const r = await fetch(url)
  if (!r.ok) throw new Error(`${name}: ${r.status}`)
  writeFileSync(dst, Buffer.from(await r.arrayBuffer()))
  console.log(`downloaded ${name}`)
}
