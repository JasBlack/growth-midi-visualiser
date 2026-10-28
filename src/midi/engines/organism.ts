// Organism: a black 3D space where every note spawns a growth that expands
// while the key is held and retracts when released. Growth older than the
// "lignify" time becomes permanent, so long-held notes leave a skeleton;
// growing tips are attracted to other growths and fuse on contact, locking
// both into one structure.
//
// What a growth looks like is a SPECIES (bacteria, roots, fungi, lightning,
// rocks, crystals, spirals, corals, vines, fern, antlers, neuron, snowflake,
// veins, kelp, brambles, staghorn coral, sea fan, tree, slime mould, moss,
// anemone): segment length, thickness, taper, how the direction
// turns (smooth / lattice / helix / jagged / straight / hex), planar or not,
// node shape (sphere / cube / none), branching (random or regular
// alternating), gravity and outward drift. The species is chosen from the
// panel, or mapped from the note's pitch class / octave.
//
// COHESION pulls the separate growths into one organism: new growths spawn
// near (or graft straight onto) existing ones and tips are attracted to each
// other from further away. A PITCH LAYOUT (organism/layout.ts) can put the
// registers in space (strata, helix, circle of fifths), and harmony decides
// which growths join. An optional SHELL (sphere / cube / torus, or a
// GLB / OBJ / STL you load) is an invisible boundary: growth that would leave
// it bounces off the surface and drifts back toward the centre.

import * as THREE from 'three' // runtime → three/webgpu (vite alias)
import { WebGPURenderer, StorageInstancedBufferAttribute } from 'three/webgpu'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js'
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js'
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { RenderPipeline } from 'three/webgpu'
import { NodeUpdateType, pass } from 'three/tsl'
import { bloom } from 'three/addons/tsl/display/BloomNode.js'
import type { Gesture } from '../vision'
import type { VideoField } from '../videoField'
import { GROWTH_SHADERS, ENV_SHADERS, HAZE_ENV, setShaderMusic, uPulse, uFlash, uNow, uFocus, uTrail, uRim, uSwellRel, SEG_DATA, SEG_T, SEG_BASE, reactify, wireOnLight } from '../shaders'
import { updateMaterialUniforms } from '../materials'
import { MeshStandardNodeMaterial } from 'three/webgpu'
import { computeBoundsTree, disposeBoundsTree, acceleratedRaycast } from 'three-mesh-bvh'

// Shell raycasts (containment, skin projection, coverage) go through a BVH so a
// 200k-triangle GLB costs about the same per ray as a sphere.
;(THREE.BufferGeometry.prototype as unknown as { computeBoundsTree: typeof computeBoundsTree }).computeBoundsTree = computeBoundsTree
;(THREE.BufferGeometry.prototype as unknown as { disposeBoundsTree: typeof disposeBoundsTree }).disposeBoundsTree = disposeBoundsTree
THREE.Mesh.prototype.raycast = acceleratedRaycast
import type { Engine, EngineAction, EngineControl, GlobalParams } from '../engine'
import { ctl, setCtl } from '../engine'
import type { MusicState } from '../music'
import { pitchClass, octave, noteKey } from '../music'
import { noteRgb, cosPalette } from '../color'
import type { NodeShape, Plant, Seg, Species, Tip, Turn } from './organism/types'
import type { OrganismFeature, OrganismHost } from './organism/feature'
import { SegmentCredits } from './organism/pacing'
import { DirtySlots } from './organism/uploads'
import { CAM, CAM_MODES, CameraRig, endless, travels, type CameraInput } from './organism/camera'
import { ScreenBounce } from './organism/bounce'
import { ReferenceGuide } from './organism/reference'
import { CHROME_SPECIES, SOFT_SPECIES, SoftSurfaces, chromeTint } from './organism/soft'
import { FLIGHT_FOG, Flight, THREADS, TUBE_PULL, abcFlow, inkTint, thickFactor } from './organism/flight'
import { Debris } from './organism/debris'
import { Breath } from './organism/breath'
import { TipMarkers } from './organism/tips'
import { Ignition } from './organism/ignition'
import { Conduction, noteCode } from './organism/conduction'
import { SongResponse } from './organism/song'
import { QualityGovernor } from './organism/quality'
import { HAZE_TONES, HazeWorld } from './organism/haze'
import { CLASH, CONSONANCE, PitchLayout, interval } from './organism/layout'

export type { Species } from './organism/types'

// Instance buffers start here and DOUBLE on demand up to the panel's segment
// budget, so the scene is never capped by an allocation — only by the budget
// you set (and what the GPU can draw).
const CAP_START = 20000
const CAP_MAX = 250000
const Y_AXIS = new THREE.Vector3(0, 1, 0)
/**
 * Look → tone mapping: HDR (tips, flares, pulses) rolls off to a hot core in its own colour instead
 * of clipping to white. ACES is the default: AgX washed the palettes out to pastel on black,
 * neutral keeps them but is flatter.
 */
const TONE_MAPS = ['off (clip at white)', 'AgX', 'ACES filmic', 'neutral']
const TONE_MAP_IDS: THREE.ToneMapping[] = [THREE.NoToneMapping, THREE.AgXToneMapping, THREE.ACESFilmicToneMapping, THREE.NeutralToneMapping]
/** Performance → frame cap, by option (main.ts skips the display frames above it) */
export const FRAME_CAPS = [0, 60, 30]
/** bloom's soft knee above the threshold: glow fades in over this much extra brightness */
const BLOOM_KNEE = 0.6
/**
 * Flying among the growth in black space, a branch by the lens fills the frame: bloom keeps this
 * share of its strength and blooms only above this brightness (tips, flares, pulses), and the note
 * light (which sits in the growth just ahead) this share of its intensity. The haze adapts on its own.
 */
const CLOSE_BLOOM = 0.55
const CLOSE_BLOOM_FLOOR = 1.25
const CLOSE_LIGHT = 0.4

const S = (o: Species) => o
export const SPECIES: Species[] = [
  S({ name: 'bacteria', skin: 'ribbed', icon: '🦠', hue: 0.05, segLen: 0.28, thickness: 2.2, taper: 1.0, branchTaper: 0.95, wiggle: 1.6, branch: 0.55, branchAngle: [0.8, 1.6], turn: 'smooth', turnAngle: 0, node: 'sphere', nodeScale: 1.35, gravity: 0, radial: 0.15, maxTips: 14, maxDepth: 14, speed: 0.8, glow: 0.6, brighten: 0.1, join: 0.6 }),
  S({ name: 'roots', icon: '🌱', hue: 0.0, segLen: 0.42, thickness: 1.0, taper: 0.99, branchTaper: 0.72, wiggle: 0.8, branch: 0.22, branchAngle: [0.6, 1.3], turn: 'smooth', turnAngle: 0, node: 'sphere', nodeScale: 1.02, gravity: 0.35, radial: 0.1, maxTips: 10, maxDepth: 60, speed: 1, glow: 1, brighten: 0, join: 1, avoid: 0.4 }),
  S({ name: 'fungi', icon: '🍄', hue: 0.12, segLen: 0.36, thickness: 0.45, taper: 0.995, branchTaper: 0.85, wiggle: 1.1, branch: 0.4, branchAngle: [0.5, 1.2], turn: 'smooth', turnAngle: 0, node: 'sphere', nodeScale: 1.0, gravity: -0.05, radial: 0.45, maxTips: 24, maxDepth: 80, speed: 1.3, glow: 0.8, brighten: 0.35, join: 1.8 , avoid: 0.5 }),
  S({ name: 'lightning', skin: 'crystal', icon: '⚡', hue: 0.45, segLen: 0.7, thickness: 0.35, taper: 0.97, branchTaper: 0.6, wiggle: 0.4, branch: 0.3, branchAngle: [0.3, 0.8], turn: 'jagged', turnAngle: 0.7, node: 'none', nodeScale: 0, gravity: 0.6, radial: 0, maxTips: 12, maxDepth: 40, speed: 3.2, glow: 2.2, brighten: 0.75, join: 0.3 }),
  S({ name: 'rocks', skin: 'crystal', icon: '🪨', hue: 0.3, segLen: 0.3, thickness: 3.2, taper: 0.97, branchTaper: 0.85, wiggle: 1.2, branch: 0.5, branchAngle: [0.9, 1.8], turn: 'jagged', turnAngle: 1.2, node: 'cube', nodeScale: 1.5, gravity: 0.25, radial: 0.1, maxTips: 8, maxDepth: 9, speed: 0.45, glow: 0.2, brighten: -0.25, join: 0.5 }),
  S({ name: 'crystals', skin: 'crystal', icon: '💎', hue: 0.55, segLen: 0.55, thickness: 0.9, taper: 0.985, branchTaper: 0.8, wiggle: 0.5, branch: 0.3, branchAngle: [0.7, 1.2], turn: 'lattice', turnAngle: 0, node: 'cube', nodeScale: 1.25, gravity: -0.15, radial: 0.35, maxTips: 10, maxDepth: 40, speed: 1.1, glow: 1.2, brighten: 0.3, join: 1 }),
  S({ name: 'spirals', icon: '🌀', hue: 0.62, segLen: 0.32, thickness: 0.7, taper: 0.992, branchTaper: 0.75, wiggle: 0.3, branch: 0.1, branchAngle: [0.8, 1.4], turn: 'helix', turnAngle: 0.5, node: 'sphere', nodeScale: 1.02, gravity: -0.1, radial: 0.2, maxTips: 6, maxDepth: 90, speed: 1.2, glow: 1, brighten: 0.1, join: 0.6 }),
  S({ name: 'corals', icon: '🪸', hue: 0.18, segLen: 0.3, thickness: 1.6, taper: 0.985, branchTaper: 0.82, wiggle: 0.45, branch: 0.4, branchAngle: [0.5, 0.9], turn: 'smooth', turnAngle: 0, node: 'sphere', nodeScale: 1.15, gravity: -0.5, radial: 0.25, maxTips: 40, maxDepth: 30, speed: 0.9, glow: 0.9, brighten: 0.15, join: 0.6, avoid: 0.8, dichotomous: true }),
  S({ name: 'staghorn coral', icon: '🦌', hue: 0.22, segLen: 0.36, thickness: 1.4, taper: 0.99, branchTaper: 0.85, wiggle: 0.3, branch: 0.22, branchAngle: [0.55, 0.85], turn: 'smooth', turnAngle: 0, node: 'sphere', nodeScale: 1.25, gravity: -0.7, radial: 0.35, maxTips: 40, maxDepth: 40, speed: 1, glow: 1.1, brighten: 0.25, join: 0.3, avoid: 1, dichotomous: true }),
  S({ name: 'sea fan', icon: '🪭', hue: 0.7, segLen: 0.24, thickness: 0.5, taper: 0.985, branchTaper: 0.8, wiggle: 0.35, branch: 0.45, branchAngle: [0.6, 1.1], turn: 'smooth', turnAngle: 0, node: 'none', nodeScale: 0, gravity: -0.4, radial: 0.3, maxTips: 80, maxDepth: 45, speed: 1.2, glow: 0.6, brighten: -0.05, join: 1.4, planar: true, avoid: 0.9, dichotomous: true, initTips: 1 }),
  S({ name: 'tree', skin: 'leafy', icon: '🌳', hue: 0.08, segLen: 0.4, thickness: 2.4, taper: 0.985, branchTaper: 0.62, wiggle: 0.4, branch: 0.28, branchAngle: [0.6, 1.1], turn: 'smooth', turnAngle: 0, node: 'sphere', nodeScale: 1.0, gravity: -0.8, radial: 0.15, maxTips: 30, maxDepth: 50, speed: 0.9, glow: 0.3, brighten: -0.15, join: 0.2, avoid: 0.6, dominance: 0.6, initTips: 1 }),
  S({ name: 'slime mould', icon: '🫠', hue: 0.38, segLen: 0.3, thickness: 0.6, taper: 1.0, branchTaper: 0.9, wiggle: 1.0, branch: 0.35, branchAngle: [0.6, 1.4], turn: 'smooth', turnAngle: 0, node: 'sphere', nodeScale: 1.2, gravity: 0, radial: 0.4, maxTips: 30, maxDepth: 90, speed: 1.3, glow: 1.2, brighten: 0.2, join: 2, avoid: 0.4 }),
  S({ name: 'moss', skin: 'leafy', icon: '🌿', hue: 0.15, segLen: 0.16, thickness: 1.2, taper: 0.93, branchTaper: 0.9, wiggle: 1.2, branch: 0.8, branchAngle: [0.5, 1.3], turn: 'smooth', turnAngle: 0, node: 'sphere', nodeScale: 1.2, gravity: -0.4, radial: 0.4, maxTips: 60, maxDepth: 7, speed: 1.1, glow: 0.5, brighten: 0.05, join: 0.8, avoid: 0.5, initTips: 8 }),
  S({ name: 'anemone', icon: '🌸', hue: 0.8, segLen: 0.3, thickness: 1.3, taper: 0.975, branchTaper: 0.8, wiggle: 0.9, branch: 0, branchAngle: [0.5, 1], turn: 'smooth', turnAngle: 0, node: 'sphere', nodeScale: 1.05, gravity: -0.35, radial: 0.5, maxTips: 30, maxDepth: 30, speed: 1, glow: 1.3, brighten: 0.2, join: 0.2, avoid: 0.9, initTips: 14 }),
  S({ name: 'vines', skin: 'leafy', icon: '🍃', hue: 0.1, segLen: 0.3, thickness: 0.6, taper: 0.995, branchTaper: 0.7, wiggle: 0.5, branch: 0.08, branchAngle: [0.6, 1.1], turn: 'helix', turnAngle: 0.22, node: 'sphere', nodeScale: 1.0, gravity: -0.35, radial: 0.15, maxTips: 6, maxDepth: 120, speed: 1.1, glow: 0.8, brighten: 0, join: 2 }),
  S({ name: 'fern', skin: 'leafy', icon: '🌾', hue: 0.13, segLen: 0.3, thickness: 0.7, taper: 0.975, branchTaper: 0.55, wiggle: 0.15, branch: 0, branchAngle: [0.95, 1.15], turn: 'helix', turnAngle: 0.06, node: 'none', nodeScale: 0, gravity: -0.25, radial: 0.1, maxTips: 30, maxDepth: 40, speed: 1.2, glow: 0.7, brighten: 0.1, join: 0.4, planar: true, branchEvery: 2, initTips: 1 }),
  S({ name: 'antlers', icon: '🦴', hue: 0.02, segLen: 0.38, thickness: 1.7, taper: 0.965, branchTaper: 0.8, wiggle: 0.35, branch: 0.25, branchAngle: [0.5, 0.9], turn: 'smooth', turnAngle: 0, node: 'sphere', nodeScale: 1.08, gravity: -0.6, radial: 0.2, maxTips: 8, maxDepth: 26, speed: 0.9, glow: 0.5, brighten: 0.2, join: 0.4 }),
  S({ name: 'neuron', icon: '🧠', hue: 0.5, segLen: 0.34, thickness: 0.4, taper: 0.99, branchTaper: 0.8, wiggle: 0.9, branch: 0.3, branchAngle: [0.7, 1.5], turn: 'smooth', turnAngle: 0, node: 'sphere', nodeScale: 1.3, gravity: 0, radial: 0.35, maxTips: 30, maxDepth: 45, speed: 1.4, glow: 1.6, brighten: 0.4, join: 2 }),
  S({ name: 'snowflake', skin: 'crystal', icon: '❄️', hue: 0.66, segLen: 0.3, thickness: 0.45, taper: 0.97, branchTaper: 0.65, wiggle: 0.2, branch: 0, branchAngle: [1.0472, 1.0472], turn: 'hex', turnAngle: 0, node: 'sphere', nodeScale: 1.0, gravity: 0, radial: 0.4, maxTips: 60, maxDepth: 18, speed: 1.4, glow: 1.4, brighten: 0.7, join: 0.2, planar: true, branchEvery: 3, branchBoth: true, initTips: 6 }),
  S({ name: 'veins', icon: '🫀', hue: 0.9, segLen: 0.32, thickness: 1.3, taper: 0.985, branchTaper: 0.7, wiggle: 0.6, branch: 0.35, branchAngle: [0.3, 0.7], turn: 'smooth', turnAngle: 0, node: 'sphere', nodeScale: 1.0, gravity: 0, radial: 0.3, maxTips: 20, maxDepth: 50, speed: 1.1, glow: 0.6, brighten: -0.1, join: 1.6 }),
  S({ name: 'kelp', skin: 'leafy', icon: '🌊', hue: 0.2, segLen: 0.5, thickness: 1.1, taper: 0.99, branchTaper: 0.8, wiggle: 0.6, branch: 0.12, branchAngle: [0.3, 0.6], turn: 'helix', turnAngle: 0.18, node: 'sphere', nodeScale: 1.35, gravity: -0.9, radial: 0.05, maxTips: 5, maxDepth: 60, speed: 1, glow: 0.5, brighten: -0.15, join: 0.3, planar: true }),
  S({ name: 'stalactites', skin: 'ribbed', icon: '🔻', hue: 0.27, segLen: 0.45, thickness: 5.5, taper: 0.93, branchTaper: 0.45, wiggle: 0.02, branch: 0.04, branchAngle: [0.1, 0.3], turn: 'straight', turnAngle: 0, node: 'sphere', nodeScale: 0.9, gravity: 2.5, radial: 0, maxTips: 5, maxDepth: 22, speed: 0.55, glow: 0.4, brighten: -0.05, join: 0.15, initTips: 3, rootY: 5, dir0: 'down' }),
  S({ name: 'stalagmites', skin: 'ribbed', icon: '🔺', hue: 0.3, segLen: 0.4, thickness: 6.5, taper: 0.93, branchTaper: 0.45, wiggle: 0.02, branch: 0.04, branchAngle: [0.1, 0.3], turn: 'straight', turnAngle: 0, node: 'sphere', nodeScale: 0.9, gravity: -2.5, radial: 0, maxTips: 5, maxDepth: 20, speed: 0.5, glow: 0.3, brighten: -0.15, join: 0.15, initTips: 3, rootY: -5, dir0: 'up' }),
  S({ name: 'brambles', icon: '🌵', hue: 0.35, segLen: 0.36, thickness: 0.8, taper: 0.99, branchTaper: 0.42, wiggle: 0.8, branch: 0.7, branchAngle: [1.0, 1.8], turn: 'jagged', turnAngle: 0.5, node: 'none', nodeScale: 0, gravity: 0.1, radial: 0.3, maxTips: 24, maxDepth: 70, speed: 1.1, glow: 0.4, brighten: -0.1, join: 1.2 }),
  // 24-36: one deforming surface per growth instead of tubes (organism/soft.ts), off by default
  ...SOFT_SPECIES,
  // 37-39, the Webs species (opt-in, off by default): threads (organism/flight.ts), chrome ribbon and coil (soft.ts)
  THREADS,
  ...CHROME_SPECIES,
]
const SPECIES_MODES = ['by note', 'by octave', 'random', 'cycle']
const BASE_SHELLS = ['none', 'sphere', 'cube', 'torus', 'cylinder', 'cone', 'capsule', 'octahedron', 'knot']
const SHELL_LOOKS = ['invisible', 'faint wireframe', 'wireframe', 'glowing wireframe', 'glass', 'solid', 'silhouette', 'points']

interface LoadedModel {
  name: string
  geoms: THREE.BufferGeometry[]
  scene: THREE.Group | null
  clips: THREE.AnimationClip[]
  mixer: THREE.AnimationMixer | null
  tris: number
}

const LATTICE_DIRS: THREE.Vector3[] = []
for (const [x, y, z] of [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1],
  [1, 1, 0],
  [-1, 1, 0],
  [1, -1, 0],
  [-1, -1, 0],
  [0, 1, 1],
  [0, 1, -1],
  [0, -1, 1],
  [0, -1, -1],
  [1, 0, 1],
  [-1, 0, 1],
  [1, 0, -1],
  [-1, 0, -1],
])
  LATTICE_DIRS.push(new THREE.Vector3(x, y, z).normalize())

/** Panel sections, in the order they appear. */
const GROUP_ORDER = ['Growth', 'Species', 'Soft species', 'React', 'Notes', 'Model & shell', 'Video', 'Camera', 'Flight', 'Look', 'Debris', 'Life', 'Stems', 'Performance', 'More']
const GROUP: Record<string, string> = {
  speed: 'Growth', musicAmount: 'Growth', musicFocus: 'Growth', musicTrail: 'Growth', sustain: 'Growth', fillRate: 'Growth', maxLive: 'Growth', bounds: 'Growth', thickness: 'Growth', nodes: 'Growth', length: 'Growth', branch: 'Growth',
  wiggle: 'Growth', lignify: 'Growth', join: 'Growth', retract: 'Growth', cohesion: 'Growth', size: 'Growth',
  species: 'Species',
  shellCycle: 'Model & shell', shellCycleBeat: 'Model & shell', shellCycleSize: 'Model & shell',
  shell: 'Model & shell', shellSize: 'Model & shell', shellMode: 'Model & shell', skinStick: 'Model & shell',
  shellLook: 'Model & shell', modelAnim: 'Model & shell', animSpeed: 'Model & shell', attach: 'Model & shell',
  morph: 'Model & shell', morphAmt: 'Model & shell', morphBand: 'Model & shell',
  react: 'React', pulse: 'React', flash: 'React', kick: 'React', shake: 'React', speedReact: 'React',
  camMode: 'Camera', orbit: 'Camera', growAtCam: 'Camera', camFollow: 'Camera', camDistance: 'Camera', camSmooth: 'Camera', calmCamera: 'Camera', dirBars: 'Camera', dirCuts: 'Camera',
  shader: 'Look', materialSpeed: 'Look', materialScale: 'Look', materialReact: 'Look', envShader: 'Look', env: 'Look', bloom: 'Look', lightReact: 'Look', glow: 'Look',
  bloomThreshold: 'Look', toneMap: 'Look', exposure: 'Look', rim: 'Look',
  wild: 'Life', beatLock: 'Life', physics: 'Life', gravity: 'Life', wind: 'Life', seasons: 'Life', season: 'Life',
  nested: 'Life', text: 'Life', textHold: 'Life', cycleEvery: 'Life', cycleMode: 'Life',
  stemDrums: 'Stems', stemBass: 'Stems', stemVoice: 'Stems', stemOther: 'Stems',
  budget: 'Performance', recycle: 'Performance', quality: 'Performance', autoQuality: 'Performance', fpsCap: 'Performance',
}

/**
 * Music response. SHOW is the default: v0.15's growth per note, new growth highlighted.
 * CALM is v0.17's restrained music-led set (less growth per event, short sustain, 300
 * segments/s, strong highlight), one click away in the Growth section.
 */
const MUSIC_SHOW = { musicAmount: 1, sustain: 1.5, fillRate: 1500, musicFocus: 0.5, musicTrail: 2.5 }
const MUSIC_CALM = { musicAmount: 0.45, sustain: 0.25, fillRate: 300, musicFocus: 0.8, musicTrail: 2 }

const rnd = () => Math.random() - 0.5
/** An engine action: the haze world in one of its tones (organism/haze.ts). */
const hazeLook = (k: keyof typeof HAZE_TONES) => {
  const t = HAZE_TONES[k]
  return { envShader: HAZE_ENV, hazeHue: t.hue, hazeSat: t.sat, hazeBright: t.bright, hazeGlow: t.glow }
}
/** Side effects of a control change that setControl defers inside a batch. */
type Rebuild = 'shell' | 'respawn' | 'env' | 'shaders'
/** sp:i toggles for a one-click species set */
const speciesMask = (on: (sp: Species) => boolean) => Object.fromEntries(SPECIES.map((sp, i) => [`sp:${i}`, on(sp) ? 1 : 0]))

/**
 * Smooth per-vertex normals from positions alone, sharing across coincident
 * vertices (STL and many OBJ files repeat every corner, and their stored
 * normals are often flat or zero). Used for the model morph, never for shading.
 */
function smoothNormals(pos: Float32Array, index: ArrayLike<number> | null): Float32Array {
  const n = pos.length / 3
  const key = (i: number) => `${Math.round(pos[i * 3] * 1e4)},${Math.round(pos[i * 3 + 1] * 1e4)},${Math.round(pos[i * 3 + 2] * 1e4)}`
  const slot = new Int32Array(n)
  const ids = new Map<string, number>()
  for (let i = 0; i < n; i++) {
    const k = key(i)
    let id = ids.get(k)
    if (id === undefined) {
      id = ids.size
      ids.set(k, id)
    }
    slot[i] = id
  }
  const acc = new Float32Array(ids.size * 3)
  const tris = index ? index.length / 3 : n / 3
  for (let f = 0; f < tris; f++) {
    const a = index ? index[f * 3] : f * 3
    const b = index ? index[f * 3 + 1] : f * 3 + 1
    const c = index ? index[f * 3 + 2] : f * 3 + 2
    const ax = pos[a * 3], ay = pos[a * 3 + 1], az = pos[a * 3 + 2]
    const ux = pos[b * 3] - ax, uy = pos[b * 3 + 1] - ay, uz = pos[b * 3 + 2] - az
    const vx = pos[c * 3] - ax, vy = pos[c * 3 + 1] - ay, vz = pos[c * 3 + 2] - az
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx // area-weighted
    for (const i of [a, b, c]) {
      const s = slot[i] * 3
      acc[s] += nx
      acc[s + 1] += ny
      acc[s + 2] += nz
    }
  }
  const out = new Float32Array(n * 3)
  for (let i = 0; i < n; i++) {
    const s = slot[i] * 3
    const l = Math.hypot(acc[s], acc[s + 1], acc[s + 2]) || 1
    out[i * 3] = acc[s] / l
    out[i * 3 + 1] = acc[s + 1] / l
    out[i * 3 + 2] = acc[s + 2] / l
  }
  return out
}
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
const CHORDS: [string, number[]][] = [
  ['', [0, 4, 7]],
  ['m', [0, 3, 7]],
  ['dim', [0, 3, 6]],
  ['aug', [0, 4, 8]],
  ['sus4', [0, 5, 7]],
  ['sus2', [0, 2, 7]],
  ['7', [0, 4, 7, 10]],
  ['maj7', [0, 4, 7, 11]],
  ['m7', [0, 3, 7, 10]],
  ['5', [0, 7]],
]
/** Best-matching chord name for a set of pitch classes ('' when nothing fits). */
export function chordName(pcs: number[]): string {
  if (!pcs.length) return ''
  if (pcs.length === 1) return NOTE_NAMES[pcs[0]]
  const set = new Set(pcs)
  let best = ''
  let bestScore = -1e9
  for (let root = 0; root < 12; root++) {
    for (const [suffix, iv] of CHORDS) {
      const notes = iv.map((i) => (root + i) % 12)
      let hit = 0
      for (const n of notes) if (set.has(n)) hit++
      const extra = pcs.length - hit
      const miss = notes.length - hit
      const score = hit * 2 - extra * 1.5 - miss * 1.2 + (set.has(root) ? 0.5 : 0)
      if (score > bestScore) {
        bestScore = score
        best = NOTE_NAMES[root] + suffix
      }
    }
  }
  return bestScore > 0 ? best : ''
}
const ZERO_M = new THREE.Matrix4().makeScale(0, 0, 0)
const WHITE = new THREE.Color(1, 1, 1)
// The six segment meshes share one index space (slot = segment idx). A segment draws in
// its skin mesh, its node mesh and, leafy and finished, the leaf mesh; bit k of a slot's
// mask says mesh k holds a live matrix there.
const TUBE = 0
const RIB = 1
const CRYS = 2
const LEAF = 3
const SPHERE = 4
const CUBE = 5
const SEG_KINDS = 6

/**
 * Icosphere for nodes. From detail 1 its normals are the normalised positions,
 * so welding the duplicated vertices changes nothing on screen and cuts the vertex work
 * per instance from 240 to 42. Detail 0 has flat per-face normals and stays as it is.
 */
function blobGeometry(detail: number): THREE.BufferGeometry {
  const g = new THREE.IcosahedronGeometry(1, detail)
  if (detail < 1) return g
  g.deleteAttribute('uv') // uv seams would keep vertices apart; nothing here samples uv
  const welded = mergeVertices(g)
  g.dispose()
  return welded
}

const TURNS: Turn[] = ['smooth', 'lattice', 'helix', 'jagged', 'straight']
const NODES: NodeShape[] = ['sphere', 'cube', 'none']
const between = (a: number, b: number) => a + Math.random() * (b - a)

/** Wild: a one-off mutant of a species — every trait nudged or flipped. */
function mutate(sp: Species): Species {
  const m: Species = { ...sp, name: sp.name + '*', branchAngle: [sp.branchAngle[0] * between(0.5, 1.6), sp.branchAngle[1] * between(0.8, 1.8)] }
  m.segLen *= between(0.4, 2.2)
  m.thickness *= between(0.35, 2.8)
  m.taper = Math.min(1.0, sp.taper * between(0.97, 1.02))
  m.wiggle *= between(0.2, 3)
  m.branch = Math.min(1, sp.branch * between(0.3, 3) + (Math.random() < 0.2 ? 0.3 : 0))
  if (Math.random() < 0.5) m.turn = TURNS[(Math.random() * TURNS.length) | 0]
  m.turnAngle = between(0.1, 1.3)
  if (Math.random() < 0.4) m.node = NODES[(Math.random() * NODES.length) | 0]
  m.nodeScale = sp.nodeScale * between(0.5, 2.6)
  m.gravity = between(-1.6, 1.6)
  m.radial = between(-0.5, 0.9)
  m.maxDepth = Math.round(sp.maxDepth * between(0.5, 2))
  m.maxTips = Math.round(sp.maxTips * between(0.6, 2))
  m.speed *= between(0.6, 2.2)
  m.glow *= between(0.3, 2.5)
  m.hue = Math.random()
  m.brighten = between(-0.3, 0.35)
  m.planar = Math.random() < 0.3
  m.dichotomous = Math.random() < 0.4
  m.dominance = Math.random() < 0.3 ? Math.random() : 0
  m.avoid = Math.random() < 0.5 ? Math.random() : 0
  m.branchEvery = Math.random() < 0.25 ? 1 + ((Math.random() * 3) | 0) : undefined
  m.branchBoth = Math.random() < 0.5
  m.initTips = 1 + ((Math.random() * 8) | 0)
  return m
}
const randDir = () => new THREE.Vector3(rnd(), rnd(), rnd()).normalize()

/**
 * Tips thinner than this stop. Relative to the growth's start radius, so thin species,
 * soft notes, low thickness, nested levels and text still grow; never stricter than the
 * old absolute 0.008 (thick species unchanged), never below 0.0015.
 */
const tipMinR = (p: Plant) => Math.min(0.008, Math.max(0.0015, p.r0 * 0.15))

export class OrganismEngine implements Engine, OrganismHost {
  readonly id = 'organism'
  readonly name = 'Organism'
  readonly blurb =
    'Hold a key: a growth appears and expands. Release: it retracts. Hold longer and it stays; tips that touch fuse. Species = shape family; cohesion binds growths; a shell bounds them.'
  controls: EngineControl[] = [
    { key: 'species', label: 'species choice (from the toggled shapes below)', min: 0, max: SPECIES_MODES.length - 1, step: 1, value: 2, options: SPECIES_MODES },
    ...SPECIES.map((sp, i) => ({ key: `sp:${i}`, label: sp.name, icon: sp.icon, min: 0, max: 1, step: 1, value: sp.soft || sp.optIn ? 0 : 1 })),
    { key: 'cohesion', label: 'cohesion (spawn near / graft onto / pull together)', min: 0, max: 1, step: 0.02, value: 0.1 },
    { key: 'bounds', label: 'bounds when there is no shell', min: 0, max: 1, step: 1, value: 0, options: ['sphere of the organism size', 'none — grow forever'] },
    { key: 'size', label: 'organism size (the sphere above, and where growth is pulled back)', min: 4, max: 60, step: 1, value: 14 },
    { key: 'shell', label: 'shell', min: 0, max: BASE_SHELLS.length - 1, step: 1, value: 0, options: [...BASE_SHELLS] },
    { key: 'shellSize', label: 'shell size', min: 2, max: 14, step: 0.5, value: 6 },
    { key: 'shellMode', label: 'shell mode', min: 0, max: 2, step: 1, value: 0, options: ['contain (growth bounces inside)', 'skin (growth builds the surface)', 'nerves (nervous system + veins under the skin)'] },
    { key: 'modelAnim', label: 'model animation (rigged GLB)', min: 0, max: 2, step: 1, value: 1, options: ['off', 'play', 'beat-synced'] },
    { key: 'animSpeed', label: 'model animation speed', min: 0.1, max: 3, step: 0.05, value: 1 },
    { key: 'attach', label: 'growth rides the moving model (0 / 1)', min: 0, max: 1, step: 1, value: 1 },
    { key: 'morph', label: 'model moves to the music', min: 0, max: 5, step: 1, value: 0, options: ['off', 'breathe — the whole model swells', 'ripple — waves run over the surface', 'boil — the surface seethes', 'spikes — points shoot out', 'explode — hits scatter the surface'] },
    { key: 'morphAmt', label: 'model: how far it moves', min: 0, max: 2, step: 0.05, value: 0.6 },
    { key: 'morphBand', label: 'model: what drives it', min: 0, max: 4, step: 1, value: 0, options: ['bass', 'energy', 'mids', 'treble', 'hits'] },
    { key: 'skinStick', label: 'skin: how tightly growth hugs the surface', min: 0, max: 1, step: 0.05, value: 1 },
    { key: 'shellLook', label: 'shell look', min: 0, max: SHELL_LOOKS.length - 1, step: 1, value: 0, options: SHELL_LOOKS },
    { key: 'shellCycle', label: 'shell cycle: change every N seconds (0 = off)', min: 0, max: 60, step: 1, value: 0 },
    { key: 'shellCycleBeat', label: 'shell cycle: wait for the next bar (0 / 1)', min: 0, max: 1, step: 1, value: 1 },
    { key: 'shellCycleSize', label: 'shell cycle: randomise the size too (0 / 1)', min: 0, max: 1, step: 1, value: 1 },
    { key: 'speed', label: 'growth speed', min: 0.2, max: 3, step: 0.05, value: 1 },
    { key: 'musicAmount', label: 'growth per musical event (speed and segments / s)', min: 0.1, max: 2, step: 0.05, value: MUSIC_SHOW.musicAmount },
    { key: 'musicFocus', label: 'highlight new / dim old growth (0 = off)', min: 0, max: 1, step: 0.05, value: MUSIC_SHOW.musicFocus },
    { key: 'musicTrail', label: 'fresh trail: seconds new growth stays bright', min: 0.5, max: 8, step: 0.5, value: MUSIC_SHOW.musicTrail },
    { key: 'thickness', label: 'thickness', min: 0.2, max: 4, step: 0.05, value: 1 },
    { key: 'nodes', label: 'node size', min: 0, max: 3, step: 0.05, value: 1 },
    { key: 'length', label: 'segment length', min: 0.3, max: 3, step: 0.05, value: 1 },
    { key: 'branch', label: 'branchiness', min: 0, max: 3, step: 0.05, value: 1 },
    { key: 'wiggle', label: 'wiggle', min: 0, max: 3, step: 0.05, value: 1 },
    { key: 'lignify', label: 'seconds until growth is permanent', min: 0, max: 6, step: 0.1, value: 1.6 },
    { key: 'sustain', label: 'keep growing after release (s) — makes short notes big', min: 0, max: 10, step: 0.1, value: MUSIC_SHOW.sustain },
    { key: 'fillRate', label: 'new segments per second (0 = as fast as it can)', min: 0, max: 8000, step: 100, value: MUSIC_SHOW.fillRate },
    { key: 'maxLive', label: 'growths building at once (older ones finish early)', min: 2, max: 120, step: 1, value: 24 },
    { key: 'join', label: 'attraction / fusing', min: 0, max: 2, step: 0.05, value: 1 },
    { key: 'retract', label: 'retract speed', min: 0.2, max: 4, step: 0.05, value: 1 },
    { key: 'camMode', label: 'camera', min: 0, max: CAM_MODES.length - 1, step: 1, value: CAM.framed, options: [...CAM_MODES] },
    { key: 'orbit', label: 'camera speed', min: 0, max: 2, step: 0.05, value: 0.5 },
    { key: 'growAtCam', label: 'grow around the camera path (0 / 1: weave … chase, and flight: notes grow in the tube ahead)', min: 0, max: 1, step: 1, value: 1 },
    { key: 'camFollow', label: 'camera follows new growth', min: 0, max: 1, step: 0.05, value: 0.5 },
    { key: 'camDistance', label: 'shot distance (tip glide, tour, wide pulse)', min: 2, max: 40, step: 0.5, value: 9 },
    { key: 'camSmooth', label: 'tracking response (tip glide, tour)', min: 0, max: 1, step: 0.05, value: 0.35 },
    { key: 'calmCamera', label: 'calm camera: the music never zooms, punches or shakes it (0 / 1)', min: 0, max: 1, step: 1, value: 0 },
    { key: 'dirBars', label: 'director: bars per shot (busy passages cut sooner, calm ones later)', min: 1, max: 16, step: 1, value: 4 },
    { key: 'dirCuts', label: 'director: how shots change', min: 0, max: 1, step: 1, value: 0, options: ['hard cuts on the bar', 'glides on the bar'] },
    // the video* controls (picture / video / camera reference) belong to organism/reference.ts
    { key: 'glow', label: 'tip glow', min: 0, max: 2, step: 0.05, value: 1 },
    { key: 'budget', label: 'segment budget (thousands) — how big the world can get', min: 10, max: CAP_MAX / 1000, step: 10, value: 60 },
    { key: 'recycle', label: 'recycle at the limit (oldest growth dies to fund new)', min: 0, max: 2, step: 0.05, value: 1 },
    { key: 'quality', label: 'render scale (lower = lighter)', min: 0.5, max: 1.5, step: 0.05, value: 1 },
    { key: 'autoQuality', label: 'auto quality (under 45 fps: lighter bloom, no bloom, lower render scale, lighter effects; locked while recording)', min: 0, max: 1, step: 1, value: 1 },
    { key: 'fpsCap', label: 'frame cap (a 120 / 144 Hz laptop draws half the frames; off while recording)', min: 0, max: FRAME_CAPS.length - 1, step: 1, value: 0, options: FRAME_CAPS.map((c) => (c ? `${c} fps` : 'off')) },
    { key: 'wild', label: 'wild (mutants, style shifts, bursts, sway, pulse)', min: 0, max: 2, step: 0.05, value: 0 },
    { key: 'beatLock', label: 'beat lock (bursts + camera cuts on the beat)', min: 0, max: 1, step: 1, value: 0 },
    { key: 'lightReact', label: 'light reacts (bass warms, treble rims, sustain fogs)', min: 0, max: 1, step: 0.05, value: 1 },
    { key: 'react', label: 'music reaction: master intensity', min: 0, max: 2, step: 0.05, value: 1 },
    { key: 'pulse', label: 'swell — every growth thickens on the bass and on hits', min: 0, max: 1, step: 0.05, value: 0.6 },
    { key: 'flash', label: 'flash — everything lights up on hits', min: 0, max: 1, step: 0.05, value: 0.6 },
    { key: 'kick', label: 'kick — the camera punches in on hits (off by default)', min: 0, max: 1, step: 0.05, value: 0 },
    { key: 'shake', label: 'shake — the camera trembles with the bass', min: 0, max: 1, step: 0.05, value: 0.15 },
    { key: 'speedReact', label: 'growth speed follows the energy', min: 0, max: 1, step: 0.05, value: 0.6 },
    { key: 'bloom', label: 'bloom strength (0 = off; follows the sustained energy)', min: 0, max: 2, step: 0.05, value: 0.8 },
    { key: 'bloomThreshold', label: 'bloom threshold (only brighter glows: tips, flares, pulses; kept above a light sky)', min: 0, max: 3, step: 0.05, value: 0.7 },
    { key: 'toneMap', label: 'tone mapping (ACES becomes neutral on a light world)', min: 0, max: TONE_MAPS.length - 1, step: 1, value: 2, options: TONE_MAPS },
    { key: 'exposure', label: 'exposure', min: 0.2, max: 3, step: 0.05, value: 1 },
    { key: 'rim', label: 'rim light: edges glow in the growth colour (treble opens it)', min: 0, max: 2, step: 0.05, value: 0.8 },
    { key: 'env', label: 'environment', min: 0, max: 3, step: 1, value: 0, options: ['none', 'floor', 'cave', 'floor + shadows'] },
    { key: 'shader', label: 'growth shader', min: 0, max: GROWTH_SHADERS.length - 1, step: 1, value: 0, options: GROWTH_SHADERS.map((s) => s.name) },
    // the ten animated surfaces (growth shaders 22-31, materials.ts)
    { key: 'materialSpeed', label: 'animated surfaces: motion speed', min: 0, max: 3, step: 0.05, value: 0.8 },
    { key: 'materialScale', label: 'animated surfaces: pattern scale (higher = finer)', min: 0.25, max: 3, step: 0.05, value: 1 },
    { key: 'materialReact', label: 'animated surfaces: audio response (0 + speed 0 = still)', min: 0, max: 2, step: 0.05, value: 1 },
    { key: 'envShader', label: 'environment shader (sky)', min: 0, max: ENV_SHADERS.length - 1, step: 1, value: 0, options: ENV_SHADERS.map((s) => s.name) },
    { key: 'physics', label: 'physics (droop + wind on the skeleton)', min: 0, max: 1, step: 1, value: 0 },
    { key: 'gravity', label: 'physics: gravity droop', min: 0, max: 2, step: 0.05, value: 0.6 },
    { key: 'wind', label: 'physics: wind', min: 0, max: 2, step: 0.05, value: 0.5 },
    { key: 'seasons', label: 'seasons: cycle speed (0 = off / manual)', min: 0, max: 1, step: 0.02, value: 0 },
    { key: 'season', label: 'season: spring → summer → autumn → winter', min: 0, max: 1, step: 0.01, value: 0 },
    { key: 'nested', label: 'nested organisms (depth, 0 = off)', min: 0, max: 3, step: 1, value: 0 },
    { key: 'text', label: 'typography', min: 0, max: 2, step: 1, value: 0, options: ['off', 'chord names', 'typed text'] },
    { key: 'textHold', label: 'typography: seconds before it dissolves', min: 1, max: 20, step: 0.5, value: 6 },
    { key: 'cycleEvery', label: 'cycle: every N seconds (0 = off)', min: 0, max: 120, step: 1, value: 0 },
    { key: 'cycleMode', label: 'cycle: what happens', min: 0, max: 2, step: 1, value: 1, options: ['reset — clear and start again', 'reverse — everything retracts, then regrows', 'shed — the oldest half dies off'] },
    { key: 'stemDrums', label: 'stems: drums grow as', min: 0, max: SPECIES.length, step: 1, value: 0, options: ['auto', ...SPECIES.map((s) => s.name)] },
    { key: 'stemBass', label: 'stems: bass grows as', min: 0, max: SPECIES.length, step: 1, value: 0, options: ['auto', ...SPECIES.map((s) => s.name)] },
    { key: 'stemVoice', label: 'stems: voice grows as', min: 0, max: SPECIES.length, step: 1, value: 0, options: ['auto', ...SPECIES.map((s) => s.name)] },
    { key: 'stemOther', label: 'stems: other grows as', min: 0, max: SPECIES.length, step: 1, value: 0, options: ['auto', ...SPECIES.map((s) => s.name)] },
  ]

  readonly actions: EngineAction[] = [
    { group: 'Growth', label: 'Calm / music-led', title: 'less growth per note, short sustain, 300 segments/s, strong highlight', values: MUSIC_CALM },
    { group: 'Growth', label: 'Obvious (default)', title: 'full growth per note, 1.5 s sustain, 1500 segments/s, highlight on', values: MUSIC_SHOW },
    { group: 'Soft species', label: 'Soft only', title: 'grow only the soft species (every rigid one off)', values: speciesMask((sp) => !!sp.soft && !sp.optIn) },
    { group: 'Soft species', label: 'Rigid only (default)', title: 'grow only the branching species (every soft one off)', values: speciesMask((sp) => !sp.soft && !sp.optIn) },
    { group: 'Look', label: 'Haze: mist', title: 'the haze world: warm pale mauve, light at the end of the tunnel', values: hazeLook('mist') },
    { group: 'Look', label: 'Haze: dusk', title: 'the haze world, dark: deep mauve haze, a dim far light', values: hazeLook('dusk') },
    { group: 'Look', label: 'Haze: ink', title: 'the haze world, near black: fog and a faint far light', values: hazeLook('ink') },
  ]

  constructor() {
    // before main applies saved values, so feature controls load and save like any other
    for (const f of this.features) if (f.controls) this.controls.push(...f.controls)
  }

  private host!: HTMLElement
  private canvas!: HTMLCanvasElement
  renderer: WebGPURenderer | null = null
  readonly scene = new THREE.Scene()
  readonly camera = new THREE.PerspectiveCamera(48, 1, 0.05, 400)
  /** camera modes, framing, manual navigation, lock (organism/camera.ts) */
  private readonly cam = new CameraRig(this.camera, this.controls)
  /** what the rig reads each frame (one object, refreshed in place) */
  private readonly camIn: CameraInput = { segs: [], young: [], plants: [], shellLean: 1, minRadius: 2, hitEnv: 0, bassS: 0, wild: 0, gesture: null, size: 14, ref: null, surface: new Float32Array(0), surfaceN: 0, surfaced: (p) => this.soft.owns(p) }
  /** picture / video / camera reference (organism/reference.ts) */
  private readonly ref = new ReferenceGuide(this.controls, {
    writeSeg: (s) => this.writeSeg(s),
    seed: (root, until, t, g) => {
      // a background growth: the random pitch only picks species and colour
      const p = this.newPlant(48 + ((Math.random() * 24) | 0), 0.65, g, t, { root, autoUntil: until, quiet: true })
      p.held = false
      p.refAuto = true
      return p
    },
    release: (p, t) => this.release(p, t, 0, true),
    budget: () => this.budgetCap(),
    fit: () => {
      // a new source frames itself, unless the view is locked or the camera is travelling
      const mode = ctl(this.controls, 'camMode')
      const box = this.ref.box()
      if (box && !this.cam.locked && (mode === CAM.orbit || mode === CAM.framed || mode === CAM.wide || mode === CAM.director)) this.cam.faceOn(box)
    },
  })
  /** soft species' surfaces (organism/soft.ts) */
  private readonly soft = new SoftSurfaces({
    writeSeg: (s) => this.writeSeg(s),
    epoch: () => this.epoch,
    relief: () => (this.ref.on ? this.ref : null),
    reach: (p) => this.breath.reach(p),
  })
  /** tip marker shapes and uploads (organism/tips.ts) */
  private readonly tips = new TipMarkers({
    instanced: (geom, mat, max) => this.makeInstanced(geom, mat, max),
    changed: (key, value) => this.onControlValue?.(key, value),
    status: (msg) => this.onStatus?.(msg),
    pulse: (p, t, onset) => this.ignition.tipPulse(p, t, onset),
    reach: (p) => this.breath.reach(p),
  })
  /** note-on flares, shock rings, attack lunge and growth envelopes (organism/ignition.ts) */
  private readonly ignition = new Ignition({ instanced: (geom, mat, max) => this.makeInstanced(geom, mat, max) })
  /** note-on pulses of light along the branches, and age grading (organism/conduction.ts) */
  private readonly conduction = new Conduction({ epoch: () => this.epoch })
  /** music breath: growth reaches out with the music, draws back when it is quiet (organism/breath.ts) */
  private readonly breath = new Breath({ epoch: () => this.epoch })
  /** the energy arcs steer the scene: builds, drops, breakdowns (organism/song.ts) */
  private readonly song = new SongResponse({ sprout: (p, n) => this.sprout(p, n, n) }, this.ignition, this.conduction)
  /** pitch layout, harmonic grafting, chords, velocity weight (organism/layout.ts) */
  private readonly layout = new PitchLayout()
  /** the haze world and how light the background reads (organism/haze.ts) */
  private readonly haze = new HazeWorld()
  /** flight mode's tube: notes ahead, the ambient web, ribbons, culling what was passed (organism/flight.ts) */
  private readonly flight = new Flight({
    cam: this.cam,
    grow: (o, g, t) => {
      const p = this.newPlant(o.pitch, o.velocity, g, t, { root: o.root, aim: o.dir, sp: o.sp, autoUntil: t + o.seconds, quiet: true })
      p.held = false
      p.ambient = o.ambient
      return p
    },
    cull: (s) => this.removeSeg(s),
    budget: () => this.budgetCap(),
  })
  /** flakes, ash and crystals drifting through the space (organism/debris.ts) */
  private readonly debris = new Debris()
  /**
   * Feature modules (see organism/feature.ts), called in this order (haze first: the others read its
   * light; song before conduction: a drop's wave uploads that frame).
   */
  private readonly features: OrganismFeature[] = [this.haze, new ScreenBounce(this.cam), this.ref, this.soft, this.tips, this.song, this.ignition, this.conduction, this.breath, this.layout, this.flight, this.debris]
  readonly group = new THREE.Group()
  private segMesh!: THREE.InstancedMesh
  private segRib!: THREE.InstancedMesh
  private segCrys!: THREE.InstancedMesh
  private leafMesh!: THREE.InstancedMesh
  private ambient!: THREE.AmbientLight
  private hemi!: THREE.HemisphereLight
  private dirLight!: THREE.DirectionalLight
  private backLight!: THREE.DirectionalLight
  private post: RenderPipeline | null = null
  private bloomNode: ReturnType<typeof bloom> | null = null
  private bloomFailed = false
  /** bloom strength, smoothed */
  private bloomS = 0
  /** flying through the growth in black space (CLOSE_BLOOM, CLOSE_LIGHT) */
  private closeUp = false
  /** adaptive quality tier (organism/quality.ts) */
  private readonly quality = new QualityGovernor()
  private trebleS = 0
  /** the note light's intensity, smoothed */
  private noteLight = 0
  private floor: THREE.Mesh | null = null
  private ceiling: THREE.Mesh | null = null
  private sustain = 0
  private gesture: Gesture | null = null
  private repel: THREE.Vector3 | null = null
  onEvent?: (kind: 'fuse' | 'burst' | 'spawn', pitch: number, velocity: number) => void
  lockQuality = false
  private seasonPhase = -1
  private baseMats = new Map<THREE.InstancedMesh, THREE.Material>()
  private shaderMat: THREE.Material | null = null
  private sky: THREE.Mesh | null = null
  private seasonF = { speed: 1, leaf: 1, decay: 1, hue: 0, sat: 1, bright: 0 }
  private leafScale = 1
  private lastChord = ''
  private chordSince = 0
  private lastText = 0
  private deformParity = 0
  private cap = CAP_START
  private dimColor = new THREE.Color()
  private spawnRate = 0 // segments per second being created, smoothed
  private spawnCount = 0
  private dyingNow = 0
  private cycleT = 0
  private reversing = false
  private sphereMesh!: THREE.InstancedMesh
  private cubeMesh!: THREE.InstancedMesh
  /** segMesh, segRib, segCrys, leafMesh, sphereMesh, cubeMesh: indexed TUBE..CUBE */
  private segMeshes: THREE.InstancedMesh[] = []
  /** made once and kept across reallocations (TUBE..CUBE order) */
  private segMats: THREE.Material[] = []
  /** per slot: which segment meshes hold a live (non-zero) matrix there */
  private slotMask = new Uint8Array(0)
  /** per segment mesh: no live slot at or above this index */
  private meshHi = new Int32Array(SEG_KINDS)
  private dirtyM = Array.from({ length: SEG_KINDS }, () => new DirtySlots())
  private dirtyC = Array.from({ length: SEG_KINDS }, () => new DirtySlots())
  /**
   * per slot: the segment's birth time, arc from its root, length and note (shaders.ts SEG_DATA),
   * shared by the six segment geometries: the GPU fades new → old, grades age and runs the pulses
   */
  private dataAttr: THREE.InstancedBufferAttribute | null = null
  private dirtyB = new DirtySlots()
  /** per slot: how far along its host the segment's plant was grafted (shaders.ts SEG_BASE), filed with the data */
  private baseAttr: THREE.InstancedBufferAttribute | null = null
  private dirtyBase = new DirtySlots()
  /** births are stored relative to this, so float32 keeps millisecond precision however long the page runs */
  private readonly epoch = performance.now() / 1000
  /** instances in storage buffers (WebGPU backend); the WebGL2 backend reads them as attributes */
  private gpuStorage = false
  /** bytes of segment instance data handed to three for upload by the last render (perf check) */
  uploadBytes = 0
  private pointLight!: THREE.PointLight
  segs: Seg[] = []
  plants: Plant[] = []
  /** segments of the last 9 s in birth order (swap-removal scrambles `segs`); removed ones have idx -1 */
  private young: Seg[] = []
  private credits = new SegmentCredits()
  /** set when no segment fits and nothing dormant is left to recycle; cleared each frame and on removal */
  private noRoom = false
  /** per frame: the segment budget, and a growth's fair share of it (budget / growths building) */
  private budgetNow = 60000
  private plantShare = 5000
  /** the growth each held note is building, by noteKey (source, channel, pitch) */
  private byNote = new Map<number, Plant>()
  private nextId = 1
  private ready = false
  /** the growth's centre as the camera frames it; growth logic reads it too */
  private get center() {
    return this.cam.center
  }
  /** the flight's direction of travel (the haze keeps its light there), null in other camera modes */
  get travel() {
    return ctl(this.controls, 'camMode') === CAM.flight ? this.cam.heading : null
  }
  private cullTick = 0
  private fpsEma = 60
  private pixelNow = 1
  /** a recording's fixed frame size; null = follow the window */
  private outSize: { width: number; height: number } | null = null
  /** the panel's share of the view (setFrameInset); the camera centres its framing in the rest */
  private readonly insetWant = { x: 0, y: 0 }
  /** beginBatch depth, and the heavy rebuilds waiting for endBatch */
  private batching = 0
  private readonly deferred = new Set<Rebuild>()
  private lastBurst = 0
  private lastG: GlobalParams | null = null
  private dA = new THREE.Vector3()
  private dB = new THREE.Vector3()
  private dummy = new THREE.Object3D()
  private q = new THREE.Quaternion()
  private v1 = new THREE.Vector3()
  private v2 = new THREE.Vector3()
  private v3 = new THREE.Vector3()
  /** writeSeg's own: callers pass v1 as a segment end and read it afterwards */
  private segDir = new THREE.Vector3()
  private tmpColor = new THREE.Color()
  // shell
  private shell: THREE.Group | null = null
  private models: LoadedModel[] = []
  private activeScene: THREE.Group | null = null
  /** music envelopes: hitEnv spikes on onsets, beats and note-ons; bassS is the bass, smoothed */
  private hitEnv = 0
  private bassS = 0
  /** the animated surfaces' smoothed energy */
  private readonly matPulse = { energy: 0 }
  private explEnv = 0
  private shellBase = { s: 1, c: new THREE.Vector3() }
  private morphMeshes: { mesh: THREE.Mesh; base: Float32Array; nrm: Float32Array; phY: Float32Array; phR: Float32Array; rnd: Float32Array }[] = []
  private geomBase = new WeakMap<THREE.BufferGeometry, Float32Array>()
  private morphed = false
  private shellPointsList: THREE.Points[] = []
  private shellCycleT = 0
  private shellCycleDue = false
  onControlsChanged?: () => void
  onControlValue?: (key: string, value: number) => void
  onStatus?: (msg: string) => void
  onDeviceLost?: (reason: string) => void
  private shellMat = new THREE.MeshBasicMaterial({ color: 0x5a6a90, wireframe: true, transparent: true, opacity: 0.16, depthWrite: false, side: THREE.DoubleSide })
  private shellInvert = false
  private skinSamples: THREE.Vector3[] = []
  private lastHit: THREE.Intersection | null = null
  private mixer: THREE.AnimationMixer | null = null
  private animT = 0
  private coverage = 0
  private coverTick = 0
  private shellOn = true // false while tunnelling (the organism is endless there)
  private shellTris = 0
  private ray = (() => {
    const r = new THREE.Raycaster()
    ;(r as unknown as { firstHitOnly: boolean }).firstHitOnly = true // we only ever use the nearest hit
    return r
  })()
  private rayDir = new THREE.Vector3(0.31, 0.72, 0.62).normalize()

  async mount(host: HTMLElement) {
    // feature controls arrive with their own group
    for (const c of this.controls) c.group ??= c.key.startsWith('sp:') ? 'Species' : (GROUP[c.key] ?? 'More')
    // stable sort: controls keep their relative order inside each section; unknown sections go last
    const rank = (g?: string) => {
      const i = GROUP_ORDER.indexOf(g ?? '')
      return i < 0 ? GROUP_ORDER.length : i
    }
    this.controls.sort((a, b) => rank(a.group) - rank(b.group))
    this.host = host
    this.canvas = document.createElement('canvas')
    host.appendChild(this.canvas)
    // No WebGPU (Safari < 26, older Firefox): three falls back to its WebGL2 backend. Slower, same picture.
    const hasGpu = typeof navigator !== 'undefined' && 'gpu' in navigator
    const renderer = new WebGPURenderer({ canvas: this.canvas, antialias: true, forceWebGL: !hasGpu })
    await renderer.init()
    this.renderer = renderer
    // a GPU reset (driver timeout, sleep, GPU switch) would leave the canvas black for good: stop
    // drawing and let the app mount a fresh engine (its own dispose() reports 'destroyed', not this)
    renderer.onDeviceLost = (info) => {
      if (this.renderer !== renderer || !this.ready) return
      this.ready = false
      this.onDeviceLost?.(`${info.api}: ${info.message}`)
    }
    // the backend actually running: WebGPU can be present yet fail to start (three then falls back)
    this.gpuStorage = (renderer.backend as { isWebGPUBackend?: boolean }).isWebGPUBackend === true
    this.pixelNow = this.pixelMax()
    renderer.setPixelRatio(this.pixelNow)
    this.scene.background = new THREE.Color(0x000000)
    this.scene.fog = new THREE.FogExp2(0x000000, 0.02)
    this.scene.add(this.group)
    this.ambient = new THREE.AmbientLight(0xffffff, 0.35)
    this.scene.add(this.ambient)
    this.hemi = new THREE.HemisphereLight(0xbfd0ff, 0x1a1a24, 1.5)
    this.scene.add(this.hemi)
    const dir = new THREE.DirectionalLight(0xffffff, 2.2)
    dir.position.set(5, 9, 6)
    this.dirLight = dir
    this.scene.add(dir)
    const back = new THREE.DirectionalLight(0x8090ff, 0.9)
    back.position.set(-6, -3, -5)
    this.backLight = back
    this.scene.add(back)
    this.pointLight = new THREE.PointLight(0xffffff, 0, 50, 1.6)
    this.scene.add(this.pointLight)

    this.buildMeshes(Math.min(CAP_START, this.budgetCap()))
    this.rebuildEnv()
    this.applyShaders()
    this.resize()
    for (const f of this.features) f.mount?.(this)
    this.clear()
    this.rebuildShell()
    this.ready = true
    // middle-drag orbits, right-drag / Shift+middle-drag pans, wheel zooms (organism/camera.ts)
    this.cam.attach(this.canvas)
  }

  /** Segments the panel allows (the slider), independent of what is allocated. */
  private budgetCap() {
    return Math.max(5000, Math.min(CAP_MAX, Math.round(ctl(this.controls, 'budget') * 1000)))
  }

  /**
   * A growth is full at half the budget, or at its fair share once the world has reached
   * the budget — from the budget, not the current allocation (which only grows when the
   * world fills it). Its tips wait, and growth resumes when room frees up.
   */
  private plantFull(p: Plant) {
    const n = p.segs.length
    return n >= this.budgetNow * 0.5 || (n >= this.plantShare && this.segs.length >= this.budgetNow - 1)
  }

  /** Room for one more segment: grow the allocation, else recycle dormant growth. */
  private roomForSeg(t: number) {
    if (this.segs.length < this.cap - 1) return true
    if (this.noRoom) return false // already tried this frame, nothing dormant left
    if (!this.growCapacity()) this.makeRoom(600, t)
    this.noRoom = this.segs.length >= this.cap - 1
    return !this.noRoom
  }

  /**
   * (Re)allocate the instanced meshes at `cap` instances. Geometry detail drops
   * as the capacity rises — at 100k segments a 20-triangle blob and a
   * 20-triangle tube look the same on screen but cost a quarter as much.
   * Materials are made once: a doubling swaps geometry and instance buffers only,
   * so it does not rebuild shaders, sky or floor in the middle of a set.
   */
  private buildMeshes(cap: number) {
    this.cap = cap
    for (const mesh of this.segMeshes) {
      this.group.remove(mesh)
      mesh.geometry.dispose() // materials stay: they are reused below
    }
    this.baseMats.clear()
    if (!this.segMats.length) {
      // (on a light world the tubes turn glossy wire: the Webs threads)
      const mat = wireOnLight(reactify(new MeshStandardNodeMaterial({ roughness: 0.5, metalness: 0.1 }), true))
      const cube = reactify(new MeshStandardNodeMaterial({ roughness: 0.35, metalness: 0.3, flatShading: true }), true)
      const crys = reactify(new MeshStandardNodeMaterial({ roughness: 0.25, metalness: 0.45, flatShading: true }), true)
      const leaf = reactify(new MeshStandardNodeMaterial({ roughness: 0.7, metalness: 0, side: THREE.DoubleSide }), true)
      this.segMats = [mat, mat, crys, leaf, mat, cube]
    }
    // a slot is the same segment in every mesh, so one data buffer serves them all
    const data = new Float32Array(cap * 4)
    for (let i = 0; i < data.length; i += 4) data[i] = -1e6
    this.dataAttr = new THREE.InstancedBufferAttribute(data, 4)
    this.baseAttr = new THREE.InstancedBufferAttribute(new Float32Array(cap), 1)
    const radial = cap > 120000 ? 4 : cap > 50000 ? 5 : 7
    const blob = cap > 50000 ? 0 : 1
    const ribN = cap > 50000 ? 6 : 12
    this.segMesh = this.makeSegMesh(new THREE.CylinderGeometry(1, 1, 1, radial, 1, true), TUBE, cap)
    this.sphereMesh = this.makeSegMesh(blobGeometry(blob), SPHERE, cap)
    this.cubeMesh = this.makeSegMesh(new THREE.BoxGeometry(1.6, 1.6, 1.6), CUBE, cap)
    // skins: ribbed lathe, crystal shard (octahedron squashed to unit height), leaf quad
    const ribPts: THREE.Vector2[] = []
    for (let i = 0; i <= ribN; i++) {
      const y = i / ribN - 0.5
      ribPts.push(new THREE.Vector2(1 + 0.3 * Math.sin(y * Math.PI * 6), y))
    }
    this.segRib = this.makeSegMesh(new THREE.LatheGeometry(ribPts, radial + 1), RIB, cap)
    const crys = new THREE.OctahedronGeometry(1, 0)
    crys.scale(1.1, 0.5, 1.1)
    this.segCrys = this.makeSegMesh(crys, CRYS, cap)
    this.leafMesh = this.makeSegMesh(new THREE.PlaneGeometry(1, 1.4), LEAF, cap)
    this.segMeshes = [this.segMesh, this.segRib, this.segCrys, this.leafMesh, this.sphereMesh, this.cubeMesh]
    this.group.add(this.segMesh, this.segRib, this.segCrys, this.leafMesh, this.sphereMesh, this.cubeMesh)
    // fresh buffers are all zero: nothing is live and nothing is waiting to upload
    this.slotMask = new Uint8Array(cap)
    this.meshHi.fill(0)
    for (const d of this.dirtyM) d.reset()
    for (const d of this.dirtyC) d.reset()
    this.dirtyB.reset()
    this.dirtyBase.reset()
  }

  /** Out of room: double the allocation (up to the budget) and re-file every segment. */
  private growCapacity(): boolean {
    const limit = this.budgetCap()
    if (this.cap >= limit) return false
    this.buildMeshes(Math.min(limit, this.cap * 2))
    for (const seg of this.segs) {
      this.writeColor(seg)
      this.writeSeg(seg)
    }
    return true
  }

  private makeInstanced(geom: THREE.BufferGeometry, mat: THREE.Material, max: number) {
    const mesh = new THREE.InstancedMesh(geom, mat, max)
    // storage attribute: three's WebGPU uniform path is sized from the first
    // render's count and breaks once a growing mesh exceeds 64 KB
    // (WebGL backend has no storage buffers; its instancing goes through attributes and has no such cap)
    if (this.gpuStorage) mesh.instanceMatrix = new StorageInstancedBufferAttribute(new Float32Array(max * 16), 16) as unknown as THREE.InstancedBufferAttribute
    mesh.setColorAt(0, new THREE.Color(1, 1, 1))
    mesh.instanceColor!.setUsage(THREE.DynamicDrawUsage)
    mesh.frustumCulled = false
    mesh.count = 0
    return mesh
  }

  /**
   * A segment mesh (`k` = TUBE..CUBE). Its instances upload only where written (see
   * flushInstances), so neither buffer may be DynamicDraw: three re-sends dynamic
   * buffers whole every frame.
   */
  private makeSegMesh(geom: THREE.BufferGeometry, k: number, cap: number) {
    const base = this.segMats[k]
    geom.setAttribute(SEG_DATA, this.dataAttr!)
    geom.setAttribute(SEG_BASE, this.baseAttr!)
    // how far along the segment each vertex sits: skins span a → b (unit height round the origin);
    // nodes and leaves sit at the moving end as a whole (2: the breath shrinks them, not their length)
    const pos = geom.getAttribute('position')
    const along = new Float32Array(pos.count)
    const skin = k === TUBE || k === RIB || k === CRYS
    for (let i = 0; i < pos.count; i++) along[i] = skin ? Math.min(1, Math.max(0, pos.getY(i) + 0.5)) : 2
    geom.setAttribute(SEG_T, new THREE.BufferAttribute(along, 1))
    // one instance, then real buffers: the default would be `cap` identity matrices, a unit
    // shape at the origin in every slot this mesh never writes (ours start at zero scale)
    const mesh = new THREE.InstancedMesh(geom, this.shaderMat ?? base, 1)
    if (this.gpuStorage) {
      // see makeInstanced for the matrices. Colours are storage too so they upload in the same
      // pass as the matrices (three syncs the attribute copy a frame late); 4 floats per colour
      // because a WGSL array<vec3f> has a 16-byte stride
      mesh.instanceMatrix = new StorageInstancedBufferAttribute(new Float32Array(cap * 16), 16) as unknown as THREE.InstancedBufferAttribute
      mesh.instanceColor = new StorageInstancedBufferAttribute(new Float32Array(cap * 4).fill(1), 4) as unknown as THREE.InstancedBufferAttribute
    } else {
      mesh.instanceMatrix = new THREE.InstancedBufferAttribute(new Float32Array(cap * 16), 16)
      mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3).fill(1), 3)
    }
    mesh.frustumCulled = false
    mesh.count = 0
    mesh.castShadow = k !== LEAF && ctl(this.controls, 'env') === 3
    this.baseMats.set(mesh, base)
    return mesh
  }

  resize() {
    if (!this.renderer) return
    const o = this.outSize
    if (o) {
      // a take: the drawing buffer is the file's frame, whatever the window does; CSS letterboxes the preview
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

  setOutputSize(size: { width: number; height: number } | null) {
    this.outSize = size ? { width: size.width, height: size.height } : null
    if (!this.renderer) return
    this.renderer.setPixelRatio(size ? 1 : this.pixelNow)
    this.resize()
  }

  /** Wipe the growth, leave the camera and shell alone. */
  private clearGrowth() {
    if (this.features.length) for (const p of this.plants) this.plantRemoved(p)
    this.segs = []
    this.plants = []
    this.young = []
    this.byNote.clear()
    this.credits.reset()
    this.ref.resetGrowth() // the picture is undrawn again
    for (const m of this.segMeshes) m.count = 0
    this.tips.clear()
  }

  clear() {
    this.clearGrowth()
    this.cam.resetFocus()
    // a locked view is the user's "keep exactly this": Reset leaves it
    if (!this.cam.locked) this.cam.resetView()
    for (const f of this.features) f.clear?.(this)
  }

  get cameraLocked() {
    return this.cam.locked
  }

  /** Freeze the camera pose (growth goes on; Reset keeps the view) or release it. */
  toggleCameraLock() {
    return this.cam.toggleLock()
  }

  /** Keep the plants `keep` accepts; features hear about the rest. */
  private prunePlants(keep: (p: Plant) => boolean) {
    const kept: Plant[] = []
    for (const p of this.plants) {
      if (keep(p)) kept.push(p)
      else this.plantRemoved(p)
    }
    this.plants = kept
  }

  private plantRemoved(p: Plant) {
    for (const f of this.features) f.onPlantRemoved?.(p, this)
  }

  beginBatch() {
    this.batching++
  }

  endBatch() {
    if (this.batching === 0 || --this.batching > 0) return
    const due = [...this.deferred]
    this.deferred.clear()
    for (const k of due) this.rebuild(k)
  }

  /** A heavy rebuild now — or once, at endBatch, while a batch is open (a look sets 37 species and a shader). */
  private rebuild(k: Rebuild) {
    if (this.batching > 0) this.deferred.add(k)
    else if (k === 'shell') this.rebuildShell()
    else if (k === 'respawn') this.respawnHeld()
    else if (k === 'env' && this.renderer) this.rebuildEnv()
    else if (k === 'shaders' && this.renderer) this.applyShaders()
  }

  setFrameInset(x: number, y: number) {
    this.insetWant.x = x
    this.insetWant.y = y
  }

  setControl(key: string, value: number) {
    setCtl(this.controls, key, value)
    if (key === 'shell' || key === 'shellSize' || key === 'shellLook') this.rebuild('shell')
    if (key.startsWith('sp:') || key === 'species') this.rebuild('respawn')
    if (key === 'env') this.rebuild('env')
    if (key === 'shader' || key === 'envShader') this.rebuild('shaders')
    if (key === 'budget' && this.renderer) {
      const over = this.segs.length - this.budgetCap()
      if (over > 0) this.makeRoom(over, performance.now() / 1000)
    }
    if (key === 'quality' && this.renderer) {
      this.pixelNow = 0 // forces the new ratio through
      this.applyQuality()
    }
    for (const f of this.features) f.onControl?.(key, value, this)
  }

  // ------------------------------------------------------------ shaders

  /** Swap the growth surface material and the sky sphere for the selected shaders. */
  private applyShaders() {
    const gi = ctl(this.controls, 'shader')
    let mat: THREE.Material | null = null
    try {
      const made = GROWTH_SHADERS[gi]?.make() ?? null
      mat = made ? reactify(made, true) : null
    } catch (e) {
      console.warn('growth shader failed:', e)
    }
    this.shaderMat?.dispose()
    this.shaderMat = mat
    for (const [mesh, base] of this.baseMats) mesh.material = mat ?? base
    if (this.sky) {
      this.scene.remove(this.sky)
      this.sky.geometry.dispose()
      ;(this.sky.material as THREE.Material).dispose()
      this.sky = null
    }
    const ei = ctl(this.controls, 'envShader')
    let env: THREE.Material | null = null
    try {
      env = ENV_SHADERS[ei]?.make() ?? null
    } catch (e) {
      console.warn('env shader failed:', e)
    }
    if (env) {
      this.sky = new THREE.Mesh(new THREE.SphereGeometry(180, 32, 20), env)
      this.sky.frustumCulled = false
      this.scene.add(this.sky)
    }
  }

  // ------------------------------------------------------------ environment / bloom / hooks

  private rebuildEnv() {
    if (!this.renderer) return
    const env = ctl(this.controls, 'env')
    if (this.floor) (this.floor.material as THREE.Material).dispose() // shared with the ceiling
    for (const m of [this.floor, this.ceiling]) {
      if (!m) continue
      this.scene.remove(m)
      m.geometry.dispose()
    }
    this.floor = this.ceiling = null
    const shadows = env === 3
    this.renderer.shadowMap.enabled = shadows
    this.dirLight.castShadow = shadows
    for (const m of [this.segMesh, this.segRib, this.segCrys, this.sphereMesh, this.cubeMesh]) m.castShadow = shadows
    if (env === 0) return
    const size = ctl(this.controls, 'size')
    const mat = new THREE.MeshStandardMaterial({ color: 0x0d0e13, roughness: 0.95, metalness: 0 })
    const floor = new THREE.Mesh(new THREE.CircleGeometry(size * 5, 56), mat)
    floor.rotation.x = -Math.PI / 2
    floor.position.y = -size - 1.5
    floor.receiveShadow = shadows
    this.scene.add(floor)
    this.floor = floor
    if (env === 2) {
      const ceiling = new THREE.Mesh(new THREE.CircleGeometry(size * 5, 56), mat)
      ceiling.rotation.x = Math.PI / 2
      ceiling.position.y = size + 1.5
      this.scene.add(ceiling)
      this.ceiling = ceiling
    }
    if (shadows) {
      const cam = this.dirLight.shadow.camera as THREE.OrthographicCamera
      cam.left = cam.bottom = -size * 1.6
      cam.right = cam.top = size * 1.6
      cam.near = 1
      cam.far = size * 6
      this.dirLight.shadow.mapSize.set(1024, 1024)
      this.dirLight.position.set(size * 0.6, size * 1.4, size * 0.8)
      this.dirLight.target.position.set(0, 0, 0)
      this.scene.add(this.dirLight.target)
      cam.updateProjectionMatrix()
    }
  }

  private ensureBloom() {
    if (this.post || this.bloomFailed || !this.renderer) return
    try {
      const post = new RenderPipeline(this.renderer)
      // the pass keeps the canvas's MSAA: without it thin branches crawl. It is HDR (half float), so
      // the threshold sees tips and pulses above 1 and tone mapping runs once, after the glow is added
      const scenePass = pass(this.scene, this.camera, { samples: this.renderer.samples })
      const b = bloom(scenePass.getTextureNode('output'), 0, 0.5, ctl(this.controls, 'bloomThreshold'))
      // Both render on every post.render(), not once per animation frame (three's default): a still
      // draws between two frames, and got the last frame's picture back (a 2x still was the 1x frame
      // upscaled, with the panel inset; while the animation loop sleeps, the first frame's, which
      // just after a reload has no growth yet). The loop renders once a frame, so nothing is drawn twice.
      scenePass.updateBeforeType = NodeUpdateType.RENDER
      b.updateBeforeType = NodeUpdateType.RENDER
      b.setResolutionScale(this.quality.current.bloomRes || 0.5)
      post.outputNode = scenePass.add(b)
      this.post = post
      this.bloomNode = b
    } catch (e) {
      this.bloomFailed = true
      console.warn('bloom unavailable:', e)
    }
  }

  private draw() {
    if (this.canvas.width < 2 || this.canvas.height < 2) return // nothing to draw into
    const fs = this.features
    if (!fs.length) return this.render()
    // afterDraw undoes what beforeDraw set up, so it runs even when rendering throws
    const tokens: unknown[] = []
    try {
      for (const f of fs) tokens.push(f.beforeDraw?.(this))
      this.render()
    } finally {
      for (let i = tokens.length - 1; i >= 0; i--) fs[i].afterDraw?.(this, tokens[i])
    }
  }

  /**
   * Right before rendering, once: tight draw counts, then the slots written since the last
   * upload go to three as a few ranges. A mesh not drawn this frame keeps its marks, because
   * three only uploads (and consumes ranges) for what it draws.
   * On WebGL2, three r185 splits an instance matrix into four vec4 columns over one buffer:
   * the first column consumes the ranges and the other three re-send the buffer whole. Still
   * correct, just dearer there; the colours and untouched meshes do get the full saving.
   */
  private flushInstances() {
    const n = this.segs.length
    const live = this.slotMask
    let bytes = 0
    for (let k = 0; k < SEG_KINDS; k++) {
      const mesh = this.segMeshes[k]
      const bit = 1 << k
      // draw up to the highest slot this mesh is live in, not the whole segment count
      let hi = Math.min(this.meshHi[k], n)
      while (hi > 0 && !(live[hi - 1] & bit)) hi--
      this.meshHi[k] = hi
      mesh.count = hi
      mesh.visible = hi > 0
      if (!hi) continue
      bytes += this.dirtyM[k].flush(mesh.instanceMatrix)
      bytes += this.dirtyC[k].flush(mesh.instanceColor!)
    }
    // shared by every segment mesh: uploaded once, by whichever draws first (one does whenever n > 0)
    if (n > 0 && this.dataAttr) bytes += this.dirtyB.flush(this.dataAttr)
    if (n > 0 && this.baseAttr) bytes += this.dirtyBase.flush(this.baseAttr)
    this.uploadBytes = bytes
  }

  private render() {
    this.flushInstances()
    // the tier can drop the pass; a faded-out strength skips it too
    const on = this.bloomS > 0.005 && this.quality.current.bloomRes > 0
    if (on) this.ensureBloom()
    if (on && this.post && this.bloomNode) {
      const b = this.bloomNode
      // above the sky's brightest, so on a light world only what outshines it glows
      const th = Math.max(ctl(this.controls, 'bloomThreshold'), this.haze.bloomFloor, this.closeUp ? CLOSE_BLOOM_FLOOR : 0)
      b.strength.value = this.bloomS
      b.threshold.value = th
      b.smoothWidth.value = BLOOM_KNEE * (0.25 + 0.75 * Math.min(1, th))
      this.post.render()
    } else this.renderer!.render(this.scene, this.camera)
  }

  /** The pixel ratio the render scale knob allows on this display. */
  private pixelMax() {
    return Math.min(ctl(this.controls, 'quality'), window.devicePixelRatio || 1)
  }

  /** Apply the quality tier: bloom resolution, render scale, effect rates. */
  private applyQuality() {
    const q = this.quality.current
    if (q.bloomRes > 0) this.bloomNode?.setResolutionScale(q.bloomRes)
    this.soft.rate = q.fx ? 1 : 0.5
    // the optional scenery goes first
    this.debris.load = this.flight.load = q.load
    const px = Math.max(0.5, this.pixelMax() * q.px)
    if (Math.abs(px - this.pixelNow) < 0.01) return
    this.pixelNow = px
    // during a take the frame size is fixed; the new ratio applies afterwards
    if (this.renderer && !this.outSize) {
      this.renderer.setPixelRatio(px)
      this.resize()
    }
  }

  setGesture(g: Gesture | null) {
    this.gesture = g
  }

  canvasEl() {
    return this.canvas ?? null
  }

  async snapshot(scale: number): Promise<Blob | null> {
    if (!this.renderer) return null
    const was = this.renderer.getPixelRatio()
    this.renderer.setPixelRatio(was * scale)
    this.resize()
    this.cam.dropInset()
    this.draw()
    if (typeof VideoFrame === 'undefined') {
      const blob = await new Promise<Blob | null>((res) => this.canvas.toBlob(res, 'image/png'))
      this.renderer.setPixelRatio(was)
      this.resize()
      return blob
    }
    // Copy the pixels in this task (a WebGPU canvas is unreadable after it; toBlob copies too late)
    // and restore the size before any frame can run, so a recording never sees the enlarged canvas.
    let frame: VideoFrame | null = null
    try {
      frame = new VideoFrame(this.canvas, { timestamp: 0, alpha: 'discard' })
    } catch {
      /* nothing drawn */
    }
    this.renderer.setPixelRatio(was)
    this.resize()
    if (!frame) return null
    const out = new OffscreenCanvas(frame.displayWidth, frame.displayHeight)
    out.getContext('2d')!.drawImage(frame, 0, 0)
    frame.close()
    return out.convertToBlob({ type: 'image/png' })
  }

  // ------------------------------------------------------------ picture / video / camera reference (organism/reference.ts)

  /** The panel owns the source; the engine grows onto its maps. */
  setVideoField(f: VideoField | null) {
    this.ref.setField(f)
  }

  get videoOn() {
    return this.ref.on
  }

  /** Fit view: the reference picture face-on. A locked view is re-aimed and stays locked. False when no reference guides. */
  fitReference(): boolean {
    const box = this.ref.box()
    if (!box) return false
    const mode = ctl(this.controls, 'camMode')
    if (mode !== CAM.orbit && mode !== CAM.framed && mode !== CAM.wide && mode !== CAM.director) {
      setCtl(this.controls, 'camMode', CAM.framed)
      this.onControlValue?.('camMode', CAM.framed)
    }
    this.cam.faceOn(box)
    return true
  }

  /** A picture or OBJ as the tip marker (organism/tips.ts); selects it once loaded. Resolves to a status line. */
  async loadTipMarker(file: File): Promise<string> {
    const r = await this.tips.load(file)
    if (r.index >= 0) {
      setCtl(this.controls, 'tipShape', r.index)
      this.onControlValue?.('tipShape', r.index)
    }
    return r.message
  }

  // ------------------------------------------------------------ shell

  /** Load a GLB / glTF / OBJ / STL as the boundary shell. Resolves to a status line. */
  /** Shell names for the panel: the built-in shapes plus every model loaded this session. */
  private shellNames() {
    return [...BASE_SHELLS, ...this.models.map((m) => m.name)]
  }

  private refreshShellOptions(select?: number) {
    const c = this.controls.find((x) => x.key === 'shell')
    if (!c) return
    c.options = this.shellNames()
    c.max = c.options.length - 1
    if (select !== undefined) c.value = select
    this.onControlsChanged?.()
  }

  async loadShell(file: File): Promise<string> {
    const name = file.name.toLowerCase()
    const geoms: THREE.BufferGeometry[] = []
    try {
      if (name.endsWith('.stl')) {
        geoms.push(new STLLoader().parse(await file.arrayBuffer()))
      } else if (name.endsWith('.obj')) {
        new OBJLoader().parse(await file.text()).traverse((o) => {
          if ((o as THREE.Mesh).isMesh) geoms.push((o as THREE.Mesh).geometry)
        })
      } else {
        const buf = await file.arrayBuffer()
        const gltf = await new Promise<{ scene: THREE.Group; animations: THREE.AnimationClip[] }>((res, rej) =>
          new GLTFLoader().parse(buf, '', (g) => res(g as unknown as { scene: THREE.Group; animations: THREE.AnimationClip[] }), rej),
        )
        // keep the live scene: skinned meshes stay skinned, animations stay playable
        const clips = gltf.animations ?? []
        const mixer = clips.length ? new THREE.AnimationMixer(gltf.scene) : null
        if (mixer) mixer.clipAction(clips[0]).play()
        gltf.scene.updateMatrixWorld(true)
        gltf.scene.traverse((o) => {
          const m = o as THREE.Mesh
          if (m.isMesh) geoms.push(m.geometry)
        })
        this.models.push({ name: file.name, geoms, scene: gltf.scene, clips, mixer, tris: 0 })
        this.refreshShellOptions(BASE_SHELLS.length + this.models.length - 1)
        this.rebuildShell()
        return `model ${this.models.length}: ${file.name} (${geoms.length} mesh${geoms.length > 1 ? 'es' : ''}, ${(this.shellTris / 1000).toFixed(0)}k triangles${clips.length ? `, ${clips.length} animation${clips.length > 1 ? 's' : ''}` : ''})`
      }
    } catch (e) {
      return `shell: could not read ${file.name} — ${(e as Error).message}`
    }
    if (!geoms.length) return `shell: no meshes in ${file.name}`
    this.models.push({ name: file.name, geoms, scene: null, clips: [], mixer: null, tris: 0 })
    this.refreshShellOptions(BASE_SHELLS.length + this.models.length - 1)
    this.rebuildShell()
    return `model ${this.models.length}: ${file.name} (${geoms.length} mesh${geoms.length > 1 ? 'es' : ''}, ${(this.shellTris / 1000).toFixed(0)}k triangles, BVH)`
  }

  private rebuildShell() {
    if (this.shell) {
      this.scene.remove(this.shell)
      this.shell = null
    }
    for (const pt of this.shellPointsList) pt.parent?.remove(pt)
    if (this.shellPointsList.length) (this.shellPointsList[0].material as THREE.Material).dispose()
    this.shellPointsList = []
    const kind = ctl(this.controls, 'shell')
    const size = ctl(this.controls, 'shellSize')
    const model = kind >= BASE_SHELLS.length ? this.models[kind - BASE_SHELLS.length] : null
    this.mixer = model?.mixer ?? null
    this.activeScene = model?.scene ?? null
    let geoms: THREE.BufferGeometry[] | null = null
    if (kind === 1) geoms = [new THREE.SphereGeometry(1, 28, 18)]
    else if (kind === 2) geoms = [new THREE.BoxGeometry(2, 2, 2)]
    else if (kind === 3) geoms = [new THREE.TorusGeometry(1, 0.42, 14, 36)]
    else if (kind === 4) geoms = [new THREE.CylinderGeometry(1, 1, 2.4, 26, 1)]
    else if (kind === 5) geoms = [new THREE.ConeGeometry(1.2, 2.6, 26, 1)]
    else if (kind === 6) geoms = [new THREE.CapsuleGeometry(0.9, 1.6, 8, 20)]
    else if (kind === 7) geoms = [new THREE.OctahedronGeometry(1.3, 1)]
    else if (kind === 8) geoms = [new THREE.TorusKnotGeometry(0.9, 0.3, 90, 14)]
    else if (model) geoms = model.geoms
    if (!geoms) return
    const mat = this.shellMaterial(ctl(this.controls, 'shellLook'))
    let group: THREE.Group
    let tris = 0
    if (model?.scene) {
      // animated / skinned model: use the live scene; BVH only on static meshes
      // (a skinned mesh raycasts through its skinning instead — slower but correct)
      group = model.scene
      group.traverse((o) => {
        const m = o as THREE.Mesh
        if (!m.isMesh) return
        m.material = mat
        m.frustumCulled = false
        const g = m.geometry as THREE.BufferGeometry & { boundsTree?: unknown; computeBoundsTree: () => void }
        if (!(m as THREE.SkinnedMesh).isSkinnedMesh && !g.boundsTree) g.computeBoundsTree()
        tris += (g.index ? g.index.count : g.attributes.position.count) / 3
      })
    } else {
      group = new THREE.Group()
      for (const g of geoms) {
        const bg = g as THREE.BufferGeometry & { boundsTree?: unknown; computeBoundsTree: () => void }
        if (!bg.boundsTree) bg.computeBoundsTree()
        tris += (g.index ? g.index.count : g.attributes.position.count) / 3
        group.add(new THREE.Mesh(g, mat))
      }
    }
    this.shellTris = Math.round(tris)
    // morph tables: base positions + normals per geometry, so the surface can move to the music and come back
    this.morphMeshes = []
    this.morphed = false
    let verts = 0
    group.traverse((o) => {
      const mm = o as THREE.Mesh
      if (mm.isMesh && !(mm as THREE.SkinnedMesh).isSkinnedMesh) verts += mm.geometry.attributes.position.count
    })
    if (verts <= 150000) {
      const seen = new Set<THREE.BufferGeometry>()
      group.traverse((o) => {
        const mm = o as THREE.Mesh
        if (!mm.isMesh || (mm as THREE.SkinnedMesh).isSkinnedMesh) return
        const bg = mm.geometry
        if (seen.has(bg)) return
        seen.add(bg)
        const pos = bg.attributes.position as THREE.BufferAttribute
        let base = this.geomBase.get(bg)
        if (!base) {
          base = Float32Array.from(pos.array as Float32Array)
          this.geomBase.set(bg, base)
        } else {
          ;(pos.array as Float32Array).set(base) // a previous morph may have left it displaced
          pos.needsUpdate = true
          ;(bg as THREE.BufferGeometry & { boundsTree?: { refit: () => void } }).boundsTree?.refit()
        }
        const nrm = smoothNormals(base, bg.index ? (bg.index.array as ArrayLike<number>) : null)
        bg.computeBoundingBox()
        const y0 = bg.boundingBox!.min.y
        const ext = Math.max(1e-6, bg.boundingBox!.max.y - y0)
        const n = pos.count
        const phY = new Float32Array(n)
        const phR = new Float32Array(n)
        const rnd = new Float32Array(n)
        for (let i = 0; i < n; i++) {
          phY[i] = ((base[i * 3 + 1] - y0) / ext) * Math.PI * 6
          phR[i] = Math.random() * Math.PI * 2
          rnd[i] = Math.random()
        }
        mm.frustumCulled = false
        this.morphMeshes.push({ mesh: mm, base, nrm, phY, phR, rnd })
      })
    }
    // normalise: centre at origin, longest side = 2·size
    group.scale.setScalar(1)
    group.position.set(0, 0, 0)
    group.updateMatrixWorld(true)
    const box = new THREE.Box3().setFromObject(group)
    const c = box.getCenter(new THREE.Vector3())
    const ext = box.getSize(new THREE.Vector3())
    const s = (2 * size) / Math.max(1e-6, Math.max(ext.x, ext.y, ext.z))
    group.scale.setScalar(s)
    group.position.copy(c).multiplyScalar(-s)
    group.updateMatrixWorld(true)
    this.shellBase.s = s
    this.shellBase.c.copy(c)
    if (ctl(this.controls, 'shellLook') === 7) {
      // points: the mesh still raycasts (colorWrite off); a Points child per mesh shares its
      // geometry, so the dots follow any morph or animation for free
      const meshes: THREE.Mesh[] = []
      group.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh)
      })
      const pm = new THREE.PointsMaterial({ color: 0x8fa4d8, size: 0.06 * size, sizeAttenuation: true, transparent: true, opacity: 0.8 })
      for (const mm of meshes) {
        const pts = new THREE.Points(mm.geometry, pm)
        pts.raycast = () => {} // display only — never interferes with containment
        pts.frustumCulled = false
        mm.add(pts)
        this.shellPointsList.push(pts)
      }
    }
    this.shell = group
    this.scene.add(group)
    // sanity: a point far outside must test outside; if not, the model's normals point inward
    this.shellInvert = false
    const was = this.shellOn
    this.shellOn = true
    if (this.inside(this.v3.set(1e3, 37, 11))) this.shellInvert = true
    this.shellOn = was
    // skin coverage samples: 400 surface points seen from random directions
    this.skinSamples = []
    this.coverage = 0
    const far = size * 6
    for (let i = 0; i < 400; i++) {
      const d = randDir()
      this.ray.set(this.v2.copy(d).multiplyScalar(far), this.v3.copy(d).negate())
      this.ray.far = far * 2
      const hit = this.ray.intersectObject(group, true)[0]
      if (hit) this.skinSamples.push(hit.point.clone())
    }
  }

  get skin() {
    return !!this.shell && this.shellOn && ctl(this.controls, 'shellMode') >= 1
  }

  get nerves() {
    return !!this.shell && this.shellOn && ctl(this.controls, 'shellMode') === 2
  }

  private static PROJ_DIRS = [
    new THREE.Vector3(1, 0, 0),
    new THREE.Vector3(-1, 0, 0),
    new THREE.Vector3(0, 1, 0),
    new THREE.Vector3(0, -1, 0),
    new THREE.Vector3(0, 0, 1),
    new THREE.Vector3(0, 0, -1),
  ]

  /**
   * Move p onto the (approximately) nearest shell surface point: the closest hit
   * over ten rays — through the shell centre both ways, the six axes, and along
   * the previous surface normal both ways. Works for non-star shapes (torus,
   * loaded models) unlike a single centre ray. Returns false when nothing is hit.
   */
  private projectToSurface(p: THREE.Vector3, nOut: THREE.Vector3, prevN?: THREE.Vector3): boolean {
    if (!this.shell) return false
    const far = ctl(this.controls, 'shellSize') * 4
    let best: THREE.Intersection | null = null
    const test = (dx: number, dy: number, dz: number) => {
      this.ray.set(p, this.v3.set(dx, dy, dz).normalize())
      this.ray.far = far
      const h = this.ray.intersectObject(this.shell!, true)[0]
      if (h && (!best || h.distance < best.distance)) best = h
    }
    const c = this.v2.copy(p).negate()
    if (c.lengthSq() > 1e-6) {
      test(c.x, c.y, c.z)
      test(-c.x, -c.y, -c.z)
    }
    for (const d of OrganismEngine.PROJ_DIRS) test(d.x, d.y, d.z)
    if (prevN && prevN.lengthSq() > 0.5) {
      test(prevN.x, prevN.y, prevN.z)
      test(-prevN.x, -prevN.y, -prevN.z)
    }
    const hit = best as THREE.Intersection | null
    if (!hit || !hit.face) return false
    this.lastHit = hit
    // nerves sit just under the skin
    const stick = ctl(this.controls, 'skinStick')
    p.lerp(hit.point, stick)
    if (this.nerves) p.addScaledVector(this.v3.copy(hit.face.normal).transformDirection(hit.object.matrixWorld).normalize(), -0.08 * ctl(this.controls, 'shellSize') * 0.15)
    nOut.copy(hit.face.normal).transformDirection(hit.object.matrixWorld).normalize()
    return true
  }

  /** World position of a mesh vertex, skinning / morphs applied (three ≥ r155). */
  private vertexWorld(mesh: THREE.Mesh, vi: number, out: THREE.Vector3) {
    mesh.getVertexPosition(vi, out)
    return mesh.localToWorld(out)
  }

  /** Advance the model animation and carry attached growth with the moving surface. */
  private animateModel(m: MusicState, dt: number) {
    if (!this.shell) return
    if (this.mixer && this.activeScene) {
      const mode = ctl(this.controls, 'modelAnim')
      if (mode !== 0) {
        let speed = ctl(this.controls, 'animSpeed')
        if (mode === 2 && m.beat.bpm > 0) speed *= m.beat.bpm / 120
        this.mixer.update(dt * speed)
        this.activeScene.updateMatrixWorld(true)
        this.animT += dt
      }
    }
    this.morphShell(m, dt)
    if (ctl(this.controls, 'attach') === 0 || !(this.mixer || this.morphed)) return
    const cur = this.v1
    const d = this.v2
    for (const p of this.plants) {
      const at = p.attach
      if (!at) continue
      this.vertexWorld(at.mesh, at.vi, cur)
      d.subVectors(cur, at.base).sub(at.shift)
      if (d.lengthSq() < 1e-8) continue
      at.shift.add(d)
      p.root.add(d)
      for (const s of p.segs) {
        s.a.add(d)
        s.b.add(d)
        this.writeSeg(s)
      }
      for (const tip of p.tips) tip.pos.add(d)
    }
  }

  /** Move the model to the music: a whole-model swell, or per-vertex displacement along the normals. */
  private morphShell(m: MusicState, dt: number) {
    const group = this.shell
    if (!group) return
    const mode = ctl(this.controls, 'morph')
    if (mode === 0) {
      if (this.morphed) this.restoreShell()
      return
    }
    const bandI = ctl(this.controls, 'morphBand')
    const band = bandI === 0 ? this.bassS : bandI === 1 ? m.energy : bandI === 2 ? m.mid : bandI === 3 ? m.treble : this.hitEnv
    const amtCtl = ctl(this.controls, 'morphAmt')
    const amt = amtCtl * Math.min(1.5, band)
    const t = this.lastGTime
    const { s, c } = this.shellBase
    this.morphed = true
    if (mode === 1) {
      const k = 1 + 0.2 * amt
      group.scale.setScalar(s * k)
      group.position.copy(c).multiplyScalar(-s * k)
      group.updateMatrixWorld(true)
      return
    }
    if (group.scale.x !== s) {
      group.scale.setScalar(s)
      group.position.copy(c).multiplyScalar(-s)
      group.updateMatrixWorld(true)
    }
    if (mode === 5) this.explEnv = Math.max(this.explEnv * Math.exp(-dt * 2.5), this.hitEnv)
    const amp = (0.1 * ctl(this.controls, 'shellSize')) / s // a tenth of the shell, in model units
    const explode = amtCtl * 2.5 * this.explEnv
    for (const mm of this.morphMeshes) {
      const pos = mm.mesh.geometry.attributes.position as THREE.BufferAttribute
      const arr = pos.array as Float32Array
      const { base, nrm, phY, phR, rnd } = mm
      const n = pos.count
      for (let i = 0; i < n; i++) {
        let d: number
        if (mode === 2) d = amt * Math.sin(phY[i] - t * 5)
        else if (mode === 3) d = amt * Math.sin(t * 4 + phR[i])
        else if (mode === 4) d = rnd[i] > 0.92 ? amt * 2 * (0.5 + 0.5 * Math.sin(t * 25 + phR[i])) : 0
        else d = explode * rnd[i]
        d *= amp
        const j = i * 3
        arr[j] = base[j] + nrm[j] * d
        arr[j + 1] = base[j + 1] + nrm[j + 1] * d
        arr[j + 2] = base[j + 2] + nrm[j + 2] * d
      }
      pos.needsUpdate = true
      ;(mm.mesh.geometry as THREE.BufferGeometry & { boundsTree?: { refit: () => void } }).boundsTree?.refit()
    }
  }

  private restoreShell() {
    this.morphed = false
    const group = this.shell
    const { s, c } = this.shellBase
    if (group) {
      group.scale.setScalar(s)
      group.position.copy(c).multiplyScalar(-s)
      group.updateMatrixWorld(true)
    }
    for (const mm of this.morphMeshes) {
      const pos = mm.mesh.geometry.attributes.position as THREE.BufferAttribute
      ;(pos.array as Float32Array).set(mm.base)
      pos.needsUpdate = true
      ;(mm.mesh.geometry as THREE.BufferGeometry & { boundsTree?: { refit: () => void } }).boundsTree?.refit()
    }
  }

  /** How much of the shell surface has growth on it (0..1), refreshed every ~1.5 s. */
  private updateCoverage() {
    if (!this.skin || !this.skinSamples.length) return
    if (++this.coverTick % 90 !== 0) return
    // hash every segment end into 0.9-unit cells once, then each sample only
    // looks at its own cell and the 26 around it — O(segments), not O(n × m)
    const cell = 0.9
    const key = (x: number, y: number, z: number) => (((x + 512) & 1023) << 20) | (((y + 512) & 1023) << 10) | ((z + 512) & 1023)
    const grid = new Set<number>()
    for (const s of this.segs) grid.add(key(Math.floor(s.b.x / cell), Math.floor(s.b.y / cell), Math.floor(s.b.z / cell)))
    let hit = 0
    for (const q of this.skinSamples) {
      const gx = Math.floor(q.x / cell)
      const gy = Math.floor(q.y / cell)
      const gz = Math.floor(q.z / cell)
      let found = false
      for (let dx = -1; dx <= 1 && !found; dx++)
        for (let dy = -1; dy <= 1 && !found; dy++)
          for (let dz = -1; dz <= 1 && !found; dz++) if (grid.has(key(gx + dx, gy + dy, gz + dz))) found = true
      if (found) hit++
    }
    this.coverage = hit / this.skinSamples.length
  }

  stats(): string {
    const every = ctl(this.controls, 'cycleEvery')
    const cyc = every > 0 ? ` · ${this.reversing ? 'reversing' : 'cycle'} ${Math.max(0, Math.ceil(every - (this.lastGTime - this.cycleT)))}s` : ''
    const pic = this.ref.statsNote()
    const soft = this.soft.count ? ` · ${this.soft.count} soft` : ''
    const shot = this.cam.directorShot
    const q = this.quality.note(this.lastGTime)
    const segs = `${(this.segs.length / 1000).toFixed(1)}k/${Math.round(this.budgetCap() / 1000)}k segs${soft}${this.dyingNow ? ` · recycling ${this.dyingNow}` : ''}${cyc}${pic}${shot ? ` · ${shot} shot` : ''}${this.song.mood ? ` · ${this.song.mood}` : ''}${q ? ` · ${q}` : ''}`
    return this.skin ? `${segs} · skin ${Math.round(this.coverage * 100)}%` : segs
  }


  /** One material per shell look. The mesh always stays raycastable; 'invisible' just stops drawing it. */
  private shellMaterial(look: number): THREE.Material {
    this.shellMat?.dispose()
    let m: THREE.Material
    if (look === 5) m = new THREE.MeshStandardMaterial({ color: 0x14171d, roughness: 0.9, metalness: 0.05 })
    else if (look === 6) m = new THREE.MeshBasicMaterial({ color: 0x2b3550, side: THREE.BackSide, transparent: true, opacity: 0.55 })
    else if (look === 4) m = new THREE.MeshBasicMaterial({ color: 0x9fb4e8, transparent: true, opacity: 0.1, depthWrite: false, side: THREE.DoubleSide })
    else if (look === 3)
      m = new THREE.MeshBasicMaterial({
        color: 0x7fd8ff,
        wireframe: true,
        transparent: true,
        opacity: 0.9,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      })
    else
      m = new THREE.MeshBasicMaterial({
        color: 0x5a6a90,
        wireframe: true,
        transparent: true,
        opacity: look === 2 ? 0.5 : 0.16,
        depthWrite: false,
        side: THREE.DoubleSide,
      })
    m.colorWrite = look !== 0 && look !== 7 // invisible / points: raycast only
    this.shellMat = m as THREE.MeshBasicMaterial
    return m
  }

  /**
   * Point-in-shell: shoot a ray and look at the FIRST surface it meets — leaving
   * through a back face means we started inside. Robust to the double hits ray
   * parity suffers on shared edges. No shell → always inside.
   */
  private inside(p: THREE.Vector3): boolean {
    if (!this.shell || !this.shellOn) return true
    this.ray.set(p, this.rayDir)
    this.ray.far = 1000
    const hit = this.ray.intersectObject(this.shell, true)[0]
    if (!hit || !hit.face) return this.shellInvert
    const n = this.v2.copy(hit.face.normal).transformDirection(hit.object.matrixWorld)
    const exiting = n.dot(this.rayDir) > 0
    return this.shellInvert ? !exiting : exiting
  }

  /** Reflect `dir` off the shell surface ahead of `from`, with a nudge back toward the centre. */
  private bounce(from: THREE.Vector3, dir: THREE.Vector3, reach: number) {
    if (!this.shell || !this.shellOn) return
    this.ray.set(from, dir)
    this.ray.far = reach * 4
    const hit = this.ray.intersectObject(this.shell, true)[0]
    const n = this.v3
    if (hit && hit.face) {
      n.copy(hit.face.normal).transformDirection(hit.object.matrixWorld).normalize()
      if (n.dot(dir) > 0) n.negate()
    } else {
      n.copy(from).negate().normalize() // fallback: toward the origin
    }
    dir.addScaledVector(n, -2 * dir.dot(n)) // reflect
    dir.addScaledVector(n, 0.5) // and lean back inside
    dir.addScaledVector(this.v2.copy(this.center).sub(from).normalize(), 0.35)
    dir.normalize()
  }

  private randomPointInside(center: THREE.Vector3, radius: number, out: THREE.Vector3) {
    for (let i = 0; i < 40; i++) {
      out.set(rnd() * 2, rnd() * 2, rnd() * 2).multiplyScalar(radius).add(center)
      if (this.inside(out)) return out
    }
    return out.set(0, 0, 0)
  }

  /** Species selection changed: notes still held retract and regrow as the new choice. */
  private respawnHeld() {
    const g = this.lastG
    if (!g) return
    const t = performance.now() / 1000
    const lignify = ctl(this.controls, 'lignify')
    for (const [key, p] of [...this.byNote]) {
      this.release(p, t, lignify, true)
      const np = this.newPlant(p.pitch, p.velocity, g, t, { stem: p.stem })
      if (p.ign) np.ign = { ...p.ign } // the same note: its envelope goes on, no second attack (a copy: the old plant's release must not end it)
      this.byNote.set(key, np)
    }
  }

  /** Retire the oldest half of the dormant growths (the timed 'shed' cycle). */
  private shedOldest(t: number) {
    const dormant = this.plants.filter((p) => !p.held && p.autoUntil <= t && !p.dying && p.segs.length)
    for (let i = 0; i < Math.ceil(dormant.length / 2); i++) {
      const p = dormant[i]
      p.dying = true
      for (const sg of p.segs) this.writeColor(sg)
    }
  }

  // ------------------------------------------------------------ growth model

  private cycleI = 0

  private speciesFor(pitch: number, stem?: number): Species {
    // stems: drums / bass / voice / other can each have their own species
    if (stem !== undefined && stem >= 0 && stem <= 3) {
      const pick = ctl(this.controls, ['stemDrums', 'stemBass', 'stemVoice', 'stemOther'][stem])
      if (pick > 0) return SPECIES[pick - 1]
    }
    const mode = ctl(this.controls, 'species')
    let on: Species[] = []
    for (let i = 0; i < SPECIES.length; i++) if (ctl(this.controls, `sp:${i}`) > 0) on.push(SPECIES[i])
    // none toggled: the branching species, as before the soft ones existed
    if (!on.length) on = SPECIES.filter((s) => !s.soft && !s.optIn)
    if (mode === 1) return on[Math.min(on.length - 1, Math.round(((octave(pitch) - 1) / 7) * (on.length - 1)))]
    if (mode === 2) return on[(Math.random() * on.length) | 0]
    if (mode === 3) return on[this.cycleI++ % on.length]
    // by note: the full pitch, so every octave reaches a different slice of the list
    return on[pitch % on.length]
  }

  private newPlant(
    pitch: number,
    velocity: number,
    g: GlobalParams,
    t: number,
    opt: { stem?: number; level?: number; bound?: { c: THREE.Vector3; r: number }; autoUntil?: number; scale?: number; root?: THREE.Vector3; aim?: THREE.Vector3; sp?: Species; isText?: boolean; quiet?: boolean; played?: boolean } = {},
  ): Plant {
    const pc = pitchClass(pitch)
    const oct = Math.min(8, Math.max(1, octave(pitch)))
    const octN = (oct - 1) / 7 // 0 low .. 1 high
    let sp = opt.sp ?? (this.nerves ? SPECIES[this.nextId % 3 === 0 ? SPECIES.findIndex((x) => x.name === 'veins') : SPECIES.findIndex((x) => x.name === 'neuron')] : this.speciesFor(pitch, opt.stem))
    const wild = ctl(this.controls, 'wild')
    if (wild > 0 && Math.random() < wild * 0.45) sp = mutate(sp)
    const cohesion = ctl(this.controls, 'cohesion')
    const level = opt.level ?? 0
    const scale = opt.scale ?? 1
    const rgb = noteRgb(g.palette, pitch, 0.15 + octN * 0.5 + sp.hue + level * 0.23)
    const color = new THREE.Color(rgb[0], rgb[1], rgb[2])
    if (sp.brighten > 0) color.lerp(new THREE.Color(1, 1, 1), sp.brighten)
    else if (sp.brighten < 0) color.multiplyScalar(1 + sp.brighten)
    const lay = this.layout
    // velocity → weight, for a note someone played (not nested children, typography or Build shape)
    const weighed = level === 0 && !opt.isText && !opt.quiet
    if (weighed) lay.shine(color, velocity, WHITE)
    // the Webs species: mirror finishes for chrome, and ink for threads once the world is light
    if (sp.chrome) chromeTint(Math.random(), color)
    else if (sp.ink && this.haze.light > 0.35) inkTint(Math.random(), color)
    const n = randDir()
    const u = new THREE.Vector3().crossVectors(n, Math.abs(n.y) < 0.9 ? Y_AXIS : new THREE.Vector3(1, 0, 0)).normalize()
    const v = new THREE.Vector3().crossVectors(n, u).normalize()
    // radius ≈ ¼ of a segment at most, or growth turns into sausages
    const vary = sp.thickVary ? thickFactor(sp.thickVary, Math.random(), Math.random()) : 1
    const r0 = (0.014 + 0.05 * velocity) * (weighed ? lay.heft(velocity) : 1) * ctl(this.controls, 'thickness') * sp.thickness * (1.4 - 0.6 * octN) * scale * vary
    const plant: Plant = {
      id: this.nextId++,
      pitch,
      velocity,
      color,
      level,
      bound: opt.bound ?? null,
      autoUntil: opt.autoUntil ?? 0,
      baseColor: color.clone(),
      isText: !!opt.isText,
      stem: opt.stem,
      dying: false,
      children: false,
      root: new THREE.Vector3(),
      reach: 0.1,
      attach: null,
      sp,
      segs: [],
      tips: [],
      held: true,
      fused: false,
      birth: t,
      released: 0,
      segLen: sp.segLen * ctl(this.controls, 'length') * (1.3 - 0.6 * octN) * scale,
      r0,
      n,
      u,
      v,
    }

    // Where it starts: with cohesion, graft straight onto an existing growth
    // (joined from birth) or spawn close to the organism; otherwise out in the dark.
    // The pitch layout says where the note belongs, harmony which growth it joins and whether it
    // roots with the chord it was struck in (organism/layout.ts); a reference, a skin or the
    // camera's path decides instead.
    const root = new THREE.Vector3()
    let graft: Plant | null = null
    let host: Seg | null = null
    const free = !opt.root && sp.rootY === undefined && !this.videoOn && !this.skin && !this.pathGrowth()
    const room = this.layoutRoom()
    const chord = free && opt.played ? lay.chordFor(pitch, t) : null
    const want = free && !chord && lay.target(pitch, room, cohesion, this.layoutAt) ? this.layoutAt : null
    // flight: in the tube ahead, never grafted onto growth the camera may already have passed
    const aim = opt.aim ?? (!opt.root && this.flight.on && this.pathGrowth() && !this.videoOn ? new THREE.Vector3() : null)
    if (opt.root) root.copy(opt.root)
    else if (aim) this.flight.place(pitch, velocity, root, aim)
    else if (chord) this.keepInside(lay.chordRoot(chord, pitch, room, root))
    else if (sp.rootY === undefined && Math.random() < cohesion * 0.85 && (host = this.graftHost(pitch, t, want, room))) {
      root.copy(host.b)
      graft = host.plant
    } else if (want) this.keepInside(root.copy(want))
    else {
      const ang = (pc / 12) * Math.PI * 2 + rnd() * 0.6
      const rad = (0.6 + Math.random() * 1.2) * (1 + 3.5 * (1 - cohesion)) * (ctl(this.controls, 'size') / 14)
      root.set(Math.cos(ang) * rad, (oct - 4) * (1.1 - 0.7 * cohesion) + rnd() * 1.5 + (sp.rootY ?? 0), Math.sin(ang) * rad)
      if (this.pathGrowth()) {
        // grow where the camera is heading: ahead of it, off to the sides
        root.multiplyScalar(0.5).addScaledVector(this.cam.fwd, 3 + Math.random() * 5).add(this.cam.pos)
      } else if (this.segs.length) root.add(this.center)
      if (!this.inside(root)) this.randomPointInside(this.center, ctl(this.controls, 'shellSize'), root)
    }
    // start where the picture has something to say: a line, or the relief
    if (this.videoOn && !opt.root) this.ref.pickRoot(root)
    // on a reference, a root stays where the picture put it
    if (sp.dir0 && !this.videoOn) root.x += rnd() * 6
    if (this.skin && !this.videoOn && !opt.root) {
      // skin mode: start on the surface
      const size = ctl(this.controls, 'shellSize')
      const nrm = new THREE.Vector3()
      for (let i = 0; i < 12; i++) {
        root.set(rnd() * 2, rnd() * 2, rnd() * 2).multiplyScalar(size)
        if (this.projectToSurface(root, nrm)) break
      }
      const hit = this.lastHit
      if (hit && hit.face && ctl(this.controls, 'attach') > 0 && (this.mixer || ctl(this.controls, 'morph') > 0)) {
        const mesh = hit.object as THREE.Mesh
        const vi = hit.face.a
        plant.attach = { mesh, vi, base: this.vertexWorld(mesh, vi, new THREE.Vector3()), shift: new THREE.Vector3() }
      }
    }
    if (graft && host) {
      plant.fused = true
      graft.fused = true
      for (const s of graft.segs) s.permanent = true
      // it breathes with its host: drawn back with the branch it stands on, never left in mid-air
      plant.arcBase = (graft.arcBase ?? 0) + host.arc + host.a.distanceTo(host.b)
    }

    plant.root.copy(root)
    if (free) {
      plant.lift = lay.lift(pitch)
      if (opt.played) lay.struck(plant, chord)
    }
    this.applySeasonColor(plant)
    const nTips = sp.initTips ?? 2 + (Math.random() < velocity ? 1 : 0)
    const dir0 = aim
      ? aim.clone()
      : sp.dir0
        ? new THREE.Vector3(rnd() * 0.15, sp.dir0 === 'down' ? -1 : 1, rnd() * 0.15).normalize()
        : new THREE.Vector3(rnd(), Math.random() - 0.2 - sp.gravity * 0.5 + 2 * (plant.lift ?? 0), rnd()).normalize()
    if (sp.planar) dir0.addScaledVector(n, -dir0.dot(n)).normalize()
    for (let i = 0; i < nTips; i++) {
      let dir: THREE.Vector3
      if (sp.planar && nTips > 2) {
        const a = (i / nTips) * Math.PI * 2
        dir = u.clone().multiplyScalar(Math.cos(a)).addScaledVector(v, Math.sin(a))
      } else if (i === 0) dir = dir0
      else if (sp.dir0) dir = dir0.clone().add(randDir().multiplyScalar(0.25)).normalize()
      else {
        dir = dir0.clone().negate().add(randDir().multiplyScalar(0.8)).normalize()
        if (sp.planar) dir.addScaledVector(n, -dir.dot(n)).normalize()
      }
      plant.tips.push({ pos: root.clone(), dir, axis: randDir(), r: r0, depth: 0, arc: 0, seg: null, plant, side: 1, sinceBranch: 0, wob: randDir().multiplyScalar(0.3) })
    }
    this.plants.push(plant)
    for (const f of this.features) f.onPlantCreated?.(plant, this)
    if (!opt.quiet) this.onEvent?.('spawn', pitch, velocity)
    return plant
  }

  private readonly layoutAt = new THREE.Vector3()

  /** New growth is placed along the travelling camera's path (flight: in its tube ahead). */
  private pathGrowth() {
    const mode = ctl(this.controls, 'camMode')
    return (travels(mode) || mode === CAM.flight) && ctl(this.controls, 'growAtCam') > 0
  }

  /** The pitch layout's scale: the organism size, or a containing shell's when that is smaller. */
  private layoutRoom() {
    const size = ctl(this.controls, 'size') / 14
    return this.shell && this.shellOn ? Math.min(size, ctl(this.controls, 'shellSize') / 5) : size
  }

  /** A root outside the shell is drawn toward the centre (it keeps its bearing), else put anywhere inside. */
  private keepInside(root: THREE.Vector3) {
    for (let i = 0; i < 5 && !this.inside(root); i++) root.lerp(this.center, 0.35)
    if (!this.inside(root)) this.randomPointInside(this.center, ctl(this.controls, 'shellSize'), root)
  }

  /**
   * The joint a new note grafts onto. With no layout and no harmony: any finished joint, as always;
   * otherwise the layout picks by harmony, recency and where the note belongs.
   */
  private graftHost(pitch: number, t: number, want: THREE.Vector3 | null, room: number): Seg | null {
    const lay = this.layout
    if (lay.mode || lay.harmony > 0) return lay.graft(pitch, t, want, lay.reach(room), this.plants)
    // a soft species' skeleton is hidden: nothing grafts onto it (it would root in empty space)
    const finished = this.segs.filter((s) => s.growth >= 1 && !s.plant.sp.soft)
    return finished.length ? finished[(Math.random() * finished.length) | 0] : null
  }

  /** Budget full: recycle the oldest dormant growth so new notes always have room. */
  private makeRoom(n: number, t: number) {
    for (const p of this.plants) {
      if (n <= 0) break
      if (p.held || p.autoUntil > t) continue
      while (p.segs.length && n > 0) {
        this.removeSeg(p.segs[p.segs.length - 1])
        n--
      }
    }
  }

  private addSeg(plant: Plant, a: THREE.Vector3, b: THREE.Vector3, r: number, t: number, arc: number): Seg | null {
    if (!this.roomForSeg(t)) return null
    this.spawnCount++
    const seg: Seg = { idx: this.segs.length, a: a.clone(), b: b.clone(), r, growth: 0, born: t, arc, permanent: false, plant }
    this.segs.push(seg)
    plant.segs.push(seg)
    this.young.push(seg)
    this.writeColor(seg)
    this.writeSeg(seg)
    const fs = this.features
    for (let i = 0; i < fs.length; i++) fs[i].onSegmentAdded?.(seg, this)
    return seg
  }

  /** Colour the slot in the meshes this segment's species can draw in (a plant keeps its species). */
  private writeColor(seg: Seg) {
    const i = seg.idx
    if (i < 0) return // removed; its slot belongs to another segment now
    // every (re)filing of a slot comes through here, so the slot's data travels with it
    const d = this.dataAttr!.array
    const o = i * 4
    d[o] = seg.born - this.epoch
    d[o + 1] = seg.arc
    d[o + 2] = seg.a.distanceTo(seg.b)
    d[o + 3] = noteCode(seg.plant) + (0.999 * seg.r) / (1 + seg.r)
    this.dirtyB.mark(i)
    this.baseAttr!.array[i] = seg.plant.arcBase ?? 0
    this.dirtyBase.mark(i)
    const c = seg.plant.dying ? this.dimColor.copy(seg.plant.color).multiplyScalar(0.45) : seg.plant.color
    const sp = seg.plant.sp
    if (sp.skin === 'crystal') this.setColor(CRYS, i, this.tmpColor.copy(c).lerp(WHITE, 0.25))
    else this.setColor(sp.skin === 'ribbed' ? RIB : TUBE, i, c)
    // coloured up front: writeSeg shows the leaf later without recolouring
    if (sp.skin === 'leafy') this.setColor(LEAF, i, this.tmpColor.copy(c).multiplyScalar(1.15))
    if (sp.node !== 'none') this.setColor(sp.node === 'cube' ? CUBE : SPHERE, i, c)
  }

  private setColor(k: number, i: number, c: THREE.Color) {
    const attr = this.segMeshes[k].instanceColor!
    const a = attr.array
    const o = i * attr.itemSize // 4 floats per colour in a WebGPU storage buffer, 3 as an attribute
    a[o] = c.r
    a[o + 1] = c.g
    a[o + 2] = c.b
    this.dirtyC[k].mark(i)
  }

  private setMatrix(k: number, i: number, m: THREE.Matrix4) {
    m.toArray(this.segMeshes[k].instanceMatrix.array, i * 16)
    this.dirtyM[k].mark(i)
  }

  private removeSeg(seg: Seg) {
    if (seg.idx < 0) return
    const last = this.segs[this.segs.length - 1]
    if (last !== seg) {
      this.segs[seg.idx] = last
      last.idx = seg.idx
      this.writeColor(last)
      this.writeSeg(last)
    }
    this.segs.pop()
    seg.idx = -1
    this.noRoom = false
    const p = seg.plant
    // callers remove from the end of a growth, so search from there
    const pi = p.segs.lastIndexOf(seg)
    if (pi >= 0) p.segs.splice(pi, 1)
    // a live growth losing segments (reverse cycle, tunnel cull): its tips retreat with it
    // instead of writing into a slot that now belongs to another segment
    for (const tip of p.tips) {
      if (tip.seg === seg || (!tip.seg && tip.pos.distanceToSquared(seg.b) < 1e-8)) {
        tip.seg = null
        tip.pos.copy(seg.a)
        tip.arc = seg.arc
        tip.anchor = seg.anchor?.a
      }
    }
  }

  /**
   * Write the instance matrices: skin along a→b·growth, node at its moving end, leaf at a
   * finished joint. Only the meshes the segment draws in are written; a mesh that drew this
   * slot before (another species swapped in, a leaf that retracted) gets one zero.
   */
  private writeSeg(seg: Seg, dA?: THREE.Vector3, dB?: THREE.Vector3, rs = 1) {
    const i = seg.idx
    if (i < 0) return
    // a soft species' surface stands for its skeleton: the segments still grow and count, unseen
    if (seg.plant.sp.soft && this.soft.owns(seg.plant)) {
      const live = this.slotMask[i]
      if (live) for (let k = 0; k < SEG_KINDS; k++) if (live & (1 << k)) this.setMatrix(k, i, ZERO_M)
      this.slotMask[i] = 0
      return
    }
    const A = dA ? this.dA.copy(seg.a).add(dA) : seg.a
    const B = dB ? this.dB.copy(seg.b).add(dB) : seg.b
    const rr = seg.r * rs
    const d = this.segDir.subVectors(B, A)
    const full = d.length()
    const len = full * seg.growth
    const hidden = len < 1e-4 || full < 1e-6
    if (hidden) {
      this.dummy.scale.set(0, 0, 0)
      this.dummy.position.copy(A)
      this.dummy.quaternion.identity()
      this.q.identity()
    } else {
      d.divideScalar(full)
      this.q.setFromUnitVectors(Y_AXIS, d)
      this.dummy.quaternion.copy(this.q)
      this.dummy.position.copy(A).addScaledVector(d, len / 2)
      // a seamless species (threads) overlaps its joints: a curling strand shows no gaps at its bends
      const ext = seg.plant.sp.seamless ? Math.min(rr * 0.9, len) : 0
      this.dummy.scale.set(rr, len + 2 * ext, rr)
    }
    this.dummy.updateMatrix()
    const sp = seg.plant.sp
    const skin = sp.skin
    const skinK = skin === 'ribbed' ? RIB : skin === 'crystal' ? CRYS : TUBE
    this.setMatrix(skinK, i, this.dummy.matrix)
    let mask = 1 << skinK
    // leaf quad at the joint for leafy skins
    if (skin === 'leafy' && !hidden && seg.growth >= 1 && this.leafScale > 0.02) {
      if (!seg.lq) seg.lq = new THREE.Quaternion().setFromEuler(new THREE.Euler(rnd() * 3, rnd() * 6, rnd() * 3))
      const ls = Math.min(0.55, Math.max(0.06, rr * 5)) * this.leafScale
      this.dummy.position.copy(B)
      this.dummy.quaternion.copy(seg.lq)
      this.dummy.scale.set(ls, ls, ls)
      this.dummy.updateMatrix()
      this.setMatrix(LEAF, i, this.dummy.matrix)
      mask |= 1 << LEAF
    }
    // node at the moving end
    if (sp.node !== 'none') {
      const ns = hidden ? 0 : rr * sp.nodeScale * ctl(this.controls, 'nodes')
      this.dummy.position.copy(A).lerp(B, seg.growth)
      // crystals / rocks: keep the cube aligned with the segment so facets read
      if (sp.node === 'cube') this.dummy.quaternion.copy(this.q)
      else this.dummy.quaternion.identity()
      this.dummy.scale.set(ns, ns, ns)
      this.dummy.updateMatrix()
      const nodeK = sp.node === 'cube' ? CUBE : SPHERE
      this.setMatrix(nodeK, i, this.dummy.matrix)
      mask |= 1 << nodeK
    }
    const stale = this.slotMask[i] & ~mask
    if (stale) for (let k = 0; k < SEG_KINDS; k++) if (stale & (1 << k)) this.setMatrix(k, i, ZERO_M)
    this.slotMask[i] = mask
    for (let k = 0; k < SEG_KINDS; k++) if ((mask & (1 << k)) !== 0 && this.meshHi[k] <= i) this.meshHi[k] = i + 1
  }

  private toPlane(p: Plant, v: THREE.Vector3) {
    v.addScaledVector(p.n, -v.dot(p.n))
    if (v.lengthSq() < 1e-8) v.copy(p.u)
    v.normalize()
  }

  private nextDir(tip: Tip, m: MusicState, out: THREE.Vector3) {
    const p = tip.plant
    const sp = p.sp
    const wiggle = ctl(this.controls, 'wiggle') * sp.wiggle
    const cohesion = ctl(this.controls, 'cohesion')
    out.copy(tip.dir)
    const wildNow = ctl(this.controls, 'wild')
    if (wildNow > 0 && Math.random() < wildNow * 0.035) tip.turn = TURNS[(Math.random() * TURNS.length) | 0]
    switch (tip.turn ?? sp.turn) {
      case 'smooth':
        // drifting bend: the curve keeps its tendency for a few segments, then changes its mind
        tip.wob.addScaledVector(this.v2.set(rnd(), rnd(), rnd()), 0.6).multiplyScalar(0.72)
        out.addScaledVector(tip.wob, wiggle * 1.4)
        break
      case 'lattice': {
        let best = LATTICE_DIRS[0]
        let bestScore = -Infinity
        for (const d of LATTICE_DIRS) {
          const s = d.dot(tip.dir) + Math.random() * wiggle * 0.9
          if (s > bestScore) {
            bestScore = s
            best = d
          }
        }
        out.copy(best)
        break
      }
      case 'hex': {
        // six in-plane directions; mostly keep going, sometimes turn ±60°
        const a = Math.atan2(out.dot(p.v), out.dot(p.u))
        let k = Math.round(a / (Math.PI / 3))
        if (Math.random() < wiggle * 0.5) k += Math.random() < 0.5 ? 1 : -1
        const b = k * (Math.PI / 3)
        out.copy(p.u).multiplyScalar(Math.cos(b)).addScaledVector(p.v, Math.sin(b))
        break
      }
      case 'helix':
        out.applyAxisAngle(sp.planar ? p.n : tip.axis, sp.turnAngle + wiggle * 0.2)
        if (!sp.planar) tip.axis.addScaledVector(this.v2.set(rnd(), rnd(), rnd()), 0.12).normalize()
        break
      case 'jagged':
        if (Math.random() < 0.35 + wiggle * 0.15) {
          const axis = this.v2.set(rnd(), rnd(), rnd()).normalize()
          out.applyAxisAngle(axis, (Math.random() - 0.5) * 2 * sp.turnAngle)
        }
        break
      case 'straight':
        if (Math.random() < 0.05 * wiggle) out.set(rnd(), rnd(), rnd())
        break
      case 'curl': {
        // threads: follow a smooth swirling flow (each growth its own phase and scale of it, drifting
        // slowly), plus a gentle bend of their own, so strands sweep, curl, loop and tangle like hair
        const ph = p.id * 2.399
        const k = 0.45 * (1 + 2.2 * ((p.id * 0.618) % 1))
        const flow = abcFlow(tip.pos.x * k + ph, tip.pos.y * k + ph * 0.7, tip.pos.z * k - ph * 1.3 + this.lastGTime * 0.05, this.v2)
        out.addScaledVector(flow.normalize(), sp.turnAngle)
        // the bend of its own drifts slowly: a strand never kinks from one segment to the next
        tip.wob.addScaledVector(this.v2.set(rnd(), rnd(), rnd()), 0.15).multiplyScalar(0.9)
        out.addScaledVector(tip.wob, wiggle * 0.5)
        break
      }
    }
    // self-avoidance: steer away from this growth's own nearby endpoints (even spacing)
    const avoid = sp.avoid ?? 0
    if (avoid > 0 && p.segs.length > 3) {
      const reach = p.segLen * 2.2
      const r2max = reach * reach
      const push = this.v2.set(0, 0, 0)
      let k = 0
      for (let i = p.segs.length - 1; i >= 0 && k < 160; i--, k++) {
        const s = p.segs[i]
        if (s.growth < 1 || s === tip.seg) continue
        const dx = tip.pos.x - s.b.x
        const dy = tip.pos.y - s.b.y
        const dz = tip.pos.z - s.b.z
        const d2 = dx * dx + dy * dy + dz * dz
        if (d2 < 1e-6 || d2 > r2max) continue
        const w = (1 - d2 / r2max) / Math.sqrt(d2)
        push.x += dx * w
        push.y += dy * w
        push.z += dz * w
      }
      if (push.lengthSq() > 1e-8) out.addScaledVector(push.normalize(), avoid * 0.9)
    }
    // expansion: bass pushes away from the organism centre, treble pulls in;
    // cohesion pulls far-flung tips back toward it
    // (in flight: away from the line of travel, and drawn back into the tube)
    const radial = this.flight.on ? this.flight.lateral(tip.pos, this.v2) : this.v2.subVectors(tip.pos, this.center)
    const rl = radial.length()
    if (rl > 1e-3) {
      radial.divideScalar(rl)
      out.addScaledVector(radial, sp.radial + (m.bass * 0.8 - m.treble * 0.6) * 0.5)
      const reach = this.flight.on ? TUBE_PULL : ctl(this.controls, 'bounds') === 0 ? ctl(this.controls, 'size') : ctl(this.controls, 'size') * 4
      if (rl > reach) out.addScaledVector(radial, -(0.15 + cohesion * 0.35) * Math.min(1, (rl - reach) / 4))
    }
    out.y -= sp.gravity * 0.35
    // the pitch layout's register: bass reaches down, treble up
    if (p.lift) out.y += p.lift
    if (this.repel) {
      const away = this.v2.subVectors(tip.pos, this.repel)
      const dl = away.length()
      const R = ctl(this.controls, 'size') * 0.5
      if (dl < R && dl > 1e-3) out.addScaledVector(away.divideScalar(dl), 1.2 * (1 - dl / R))
    }
    // attraction to other growths' endpoints (fusing); cohesion widens the reach
    const join = ctl(this.controls, 'join') * sp.join
    // not for a shoot's first two segments: a grafted note starts ON its host's joint, and fused
    // there at once, so about a third of the notes (cohesion 0.35) grew nothing at all
    if (join > 0 && tip.depth >= 2) {
      const h = this.layout.harmony
      const reach = 1 + 2.5 * cohesion
      const target = h > 0 ? this.harmonicEndpoint(tip, reach) : this.nearestEndpoint(tip, reach)
      if (target) {
        const d = this.v2.subVectors(target.point, tip.pos)
        const dl = d.length()
        if (dl < tip.r + target.seg.r + 0.05) {
          this.fuse(tip, target.seg)
          return false
        }
        // a clashing note (minor second, tritone) pulls less and, past harmony 0.5, pushes a little
        const clash = h > 0 && CONSONANCE[interval(target.seg.plant.pitch, p.pitch)] < CLASH ? 1 - 2 * h : 1
        out.addScaledVector(d.divideScalar(dl), clash * join * (0.15 + 0.35 * cohesion))
      }
    }
    if (sp.planar && sp.turn !== 'hex') this.toPlane(p, out)
    if (this.videoOn) this.ref.steer(tip.pos, tip.dir, out)
    if (tip.n && this.skin) {
      // skin: crawl along the surface — strip the normal component
      out.addScaledVector(tip.n, -out.dot(tip.n) * ctl(this.controls, 'skinStick'))
      if (out.lengthSq() < 1e-6) out.copy(randDir())
    }
    out.normalize()
    return true
  }

  private nearestEndpoint(tip: Tip, maxD: number): { point: THREE.Vector3; seg: Seg } | null {
    let best: Seg | null = null
    let bestD = maxD * maxD
    const p = tip.pos
    for (const s of this.segs) {
      if (s.plant === tip.plant || s.growth < 1 || s.plant.sp.soft) continue // hidden soft skeletons neither attract nor fuse
      const dx = s.b.x - p.x
      const dy = s.b.y - p.y
      const dz = s.b.z - p.z
      const d2 = dx * dx + dy * dy + dz * dz
      if (d2 < bestD) {
        bestD = d2
        best = s
      }
    }
    return best ? { point: best.b, seg: best } : null
  }

  /**
   * nearestEndpoint, heard (organism/layout.ts): distance is scaled per interval, so a tip reaches
   * further for a unison, octave or fifth, further still for its own chord, and only close by for a
   * minor second or tritone.
   */
  private harmonicEndpoint(tip: Tip, maxD: number): { point: THREE.Vector3; seg: Seg } | null {
    const lay = this.layout
    const w = lay.distW
    const minW = lay.minW
    const chordW = lay.chordW
    const own = tip.plant
    // + 1200: the interval class with one modulo (pitches never differ by 100 octaves)
    const base = 1200 - own.pitch
    const chord = own.chord ?? -1
    let best: Seg | null = null
    let bestD = maxD * maxD
    const p = tip.pos
    for (const s of this.segs) {
      const q = s.plant
      if (q === own || s.growth < 1 || q.sp.soft) continue
      const dx = s.b.x - p.x
      const dy = s.b.y - p.y
      const dz = s.b.z - p.z
      const d2 = dx * dx + dy * dy + dz * dz
      if (d2 * minW >= bestD) continue
      const k = q.chord === chord ? w[(q.pitch + base) % 12] * chordW : w[(q.pitch + base) % 12]
      if (d2 * k < bestD) {
        bestD = d2 * k
        best = s
      }
    }
    return best ? { point: best.b, seg: best } : null
  }

  private fuse(tip: Tip, other: Seg) {
    const a = tip.plant
    const b = other.plant
    a.fused = b.fused = true
    this.onEvent?.('fuse', a.pitch, 0.7)
    for (const s of a.segs) s.permanent = true
    for (const s of b.segs) s.permanent = true
    if (tip.seg) {
      tip.seg.b.copy(other.b)
      tip.seg.growth = 1
      tip.seg.permanent = true
      this.writeSeg(tip.seg)
    }
    this.dropTip(tip)
  }

  private dropTip(tip: Tip) {
    const i = tip.plant.tips.indexOf(tip)
    if (i >= 0) tip.plant.tips.splice(i, 1)
  }

  private startSegment(tip: Tip, m: MusicState, t: number) {
    const p = tip.plant
    if (tip.r < tipMinR(p) || tip.depth > p.sp.maxDepth) {
      this.dropTip(tip)
      return
    }
    // out of room (this growth's share, or the whole budget): the tip waits and retries
    // next frame — checked before nextDir, whose endpoint search scans every segment
    if (this.plantFull(p) || !this.roomForSeg(t)) return
    const dir = new THREE.Vector3()
    let len = p.segLen * (0.7 + Math.random() * 0.6)
    if (tip.path) {
      const i = tip.pathI ?? 0
      if (i >= tip.path.length) {
        this.dropTip(tip)
        return
      }
      dir.subVectors(tip.path[i], tip.pos)
      len = Math.max(0.02, dir.length())
      dir.normalize()
      const b = this.v1.copy(tip.path[i])
      tip.dir.copy(dir)
      const seg = this.addSeg(p, tip.pos, b, tip.r, t, tip.arc)
      if (!seg) return // no room yet: retry this waypoint
      tip.pathI = i + 1
      tip.seg = seg
      return
    }
    if (!this.nextDir(tip, m, dir)) return // fused
    const b = this.v1.copy(tip.pos).addScaledVector(dir, len)
    if (this.videoOn) {
      // on the picture and its relief: reflected at the border, a depth cliff climbed over a few steps
      len = this.ref.step(tip.pos, dir, len, b, tip.n ?? (tip.n = new THREE.Vector3()))
    } else if (this.skin) {
      const n = tip.n ?? (tip.n = new THREE.Vector3())
      if (this.projectToSurface(b, n, n)) {
        dir.subVectors(b, tip.pos)
        len = Math.max(0.02, dir.length())
        dir.normalize()
      }
    } else if (this.shell && this.shellOn && !this.inside(b)) {
      // bounce off the shell; if the corner is too tight, head for the centre
      this.bounce(tip.pos, dir, len)
      b.copy(tip.pos).addScaledVector(dir, len)
      if (!this.inside(b)) {
        dir.copy(this.center).sub(tip.pos).normalize()
        b.copy(tip.pos).addScaledVector(dir, len)
        if (!this.inside(b)) {
          this.dropTip(tip)
          return
        }
      }
    }
    // organism size: a soft sphere around the centre — tips that would leave it
    // bounce back inward (not while tunnelling, and not when a shell bounds growth)
    if (!(this.shell && this.shellOn) && !this.skin && !this.videoOn && ctl(this.controls, 'bounds') === 0 && !endless(ctl(this.controls, 'camMode'))) {
      const size = ctl(this.controls, 'size')
      if (b.distanceToSquared(this.center) > size * size) {
        const nrm = this.v3.subVectors(tip.pos, this.center).normalize() // outward normal
        dir.addScaledVector(nrm, -2 * Math.max(0, dir.dot(nrm))).addScaledVector(nrm, -0.6).normalize()
        b.copy(tip.pos).addScaledVector(dir, len)
        if (b.distanceToSquared(this.center) > size * size * 1.2) {
          this.dropTip(tip)
          return
        }
      }
    }
    if (p.bound && !tip.path) {
      const bd = p.bound
      if (b.distanceToSquared(bd.c) > bd.r * bd.r) {
        const nrm = this.v3.subVectors(tip.pos, bd.c).normalize()
        dir.addScaledVector(nrm, -2 * Math.max(0, dir.dot(nrm))).addScaledVector(nrm, -0.6).normalize()
        b.copy(tip.pos).addScaledVector(dir, len)
        if (b.distanceToSquared(bd.c) > bd.r * bd.r * 1.3) {
          this.dropTip(tip)
          return
        }
      }
    }
    tip.dir.copy(dir)
    const seg = this.addSeg(p, tip.pos, b, tip.r, t, tip.arc)
    if (!seg) return // no room: the tip waits
    this.ref.join(tip, seg)
    p.reach = Math.max(p.reach, b.distanceTo(p.root))
    tip.seg = seg
  }

  private finishSegment(tip: Tip) {
    const p = tip.plant
    const sp = p.sp
    const seg = tip.seg!
    seg.growth = 1
    this.writeSeg(seg)
    tip.pos.copy(seg.b)
    tip.arc = seg.arc + seg.a.distanceTo(seg.b)
    tip.anchor = seg.anchor?.b // follows the reference with the joint it grows from
    if (p.refAuto) seg.permanent = true // Build shape: what it built stays
    tip.seg = null
    tip.depth++
    tip.sinceBranch++
    tip.r *= sp.taper
    const branchCtl = p.isText || tip.path ? 0 : ctl(this.controls, 'branch')
    const [a0, a1] = sp.branchAngle
    const dominance = sp.dominance ?? 0
    const spawn = (side: number) => {
      if (p.tips.length >= sp.maxTips) return
      const ang = a0 + Math.random() * (a1 - a0)
      let nd: THREE.Vector3
      let axis: THREE.Vector3
      if (sp.planar) {
        axis = p.n.clone()
        nd = tip.dir.clone().applyAxisAngle(p.n, ang * side).normalize()
      } else {
        axis = randDir()
        nd = tip.dir.clone().applyAxisAngle(axis, ang).normalize()
      }
      let r = tip.r * sp.branchTaper
      if (sp.dichotomous) {
        // Y-split: the leader deviates the other way; both children by Murray's law
        tip.dir.applyAxisAngle(axis, sp.planar ? -ang * side * 0.6 : -ang * 0.6).normalize()
        r = tip.r * 0.79
        tip.r *= 0.79
      }
      // apical dominance: side shoots start "older", so they stop sooner and stay thin
      const depth = tip.depth + Math.round(dominance * sp.maxDepth * 0.5)
      p.tips.push({ pos: tip.pos.clone(), dir: nd, axis, r: r * (1 - dominance * 0.3), depth, arc: tip.arc, seg: null, plant: p, side: 1, sinceBranch: 0, wob: randDir().multiplyScalar(0.3), anchor: tip.anchor })
    }
    if (sp.branchEvery) {
      // regular branching (fern / snowflake): every N segments, alternating sides
      const every = Math.max(1, Math.round(sp.branchEvery / Math.max(0.2, branchCtl)))
      if (tip.sinceBranch >= every) {
        tip.sinceBranch = 0
        spawn(tip.side)
        if (sp.branchBoth) spawn(-tip.side)
        tip.side = -tip.side
      }
    } else if (Math.random() < branchCtl * sp.branch) spawn(Math.random() < 0.5 ? 1 : -1)
  }

  // ------------------------------------------------------------ deform (wild sway + physics), seasons, typography

  /** Displace segments: wild sway on young growth, physics droop + wind on everything. */
  private deform(m: MusicState, t: number, wild: number) {
    // the young list is in birth order: drop what aged out or was removed from the front
    const recent = this.young
    let k = 0
    while (k < recent.length && (recent[k].idx < 0 || t - recent[k].born >= 9)) k++
    if (k) recent.splice(0, k)
    const physics = ctl(this.controls, 'physics') > 0
    const nerves = this.nerves
    if (wild <= 0 && !physics && !nerves) return
    const gravity = physics ? ctl(this.controls, 'gravity') : 0
    const wind = physics ? ctl(this.controls, 'wind') : 0
    const amp = wild * (0.12 + 0.5 * m.energy + 0.4 * m.onset)
    const w1 = 1.7 + 2.5 * m.bass
    const w2 = 2.3 + 3 * m.treble
    const sway = (q: THREE.Vector3, out: THREE.Vector3, k: number, fade: number) =>
      out.set(
        Math.sin(0.55 * q.y + w1 * t + k) * 0.8 + Math.sin(0.9 * q.z - w2 * t),
        Math.sin(0.5 * q.x + w2 * t + 2 + k) * 0.6,
        Math.cos(0.6 * q.x + 0.4 * q.y + w1 * t + 1 + k) * 0.8,
      ).multiplyScalar(amp * fade)
    // physics: droop grows with distance from the root (squared) and thinness; wind is a slow field
    const phys = (q: THREE.Vector3, out: THREE.Vector3, sg: Seg) => {
      const p = sg.plant
      const frac = Math.min(1, q.distanceTo(p.root) / Math.max(0.5, p.reach))
      const thin = Math.max(0, 1 - sg.r / 0.18)
      const f2 = frac * frac
      out.y -= gravity * 0.9 * f2 * (0.3 + 0.7 * thin)
      const w = wind * (0.25 + 0.75 * thin) * frac * (0.6 + 0.6 * m.energy)
      out.x += w * (Math.sin(t * 1.1 + q.y * 0.5 + p.id * 0.3) * 0.6 + 0.4)
      out.z += w * Math.sin(t * 0.8 + q.x * 0.4 + p.id * 0.7) * 0.5
    }
    // alternate halves when physics touches the whole skeleton (cost / 2, motion is smooth)
    // however many segments exist, only ~25k are re-written per frame
    const stride = Math.max(2, Math.ceil(this.segs.length / 25000))
    this.deformParity++
    // wild alone only moves young growth; physics and nerves walk the whole skeleton
    const all = physics || nerves
    const list = all ? this.segs : recent
    for (let i = list.length - 1; i >= 0; i--) {
      const sg = list[i]
      if (sg.idx < 0) continue // removed (young list only)
      const age = t - sg.born
      const young = age < 9
      if (!young && !all) continue
      if (all && !young && i % stride !== this.deformParity % stride) continue
      const fade = young ? Math.exp(-age * 0.35) : 0
      const k = sg.plant.id * 1.7
      if (wild > 0 && young) {
        sway(sg.a, this.v2, k, fade)
        sway(sg.b, this.v3, k, fade)
      } else {
        this.v2.set(0, 0, 0)
        this.v3.set(0, 0, 0)
      }
      if (physics) {
        phys(sg.a, this.v2, sg)
        phys(sg.b, this.v3, sg)
      }
      let pulse = wild > 0 && young ? 1 + 0.9 * wild * m.onset * m.chroma[pitchClass(sg.plant.pitch)] * fade : 1
      if (nerves) {
        // a signal runs from the root outward along every nerve, on the beat when there is one
        const p = sg.plant
        const period = p.reach + 3
        const speedN = 6 + 8 * m.energy
        const head = ((t * speedN + p.id * 1.3) % period)
        const dist = sg.a.distanceTo(p.root)
        const x = dist - head
        pulse *= 1 + 1.2 * Math.exp(-(x * x) / 0.35) * (0.5 + m.energy + m.beat.hit)
      }
      this.writeSeg(sg, this.v2, this.v3, pulse)
    }
  }

  /** Season phase 0..1: spring → summer → autumn → winter → spring. */
  private seasons(t: number) {
    const speed = ctl(this.controls, 'seasons')
    let phase = ctl(this.controls, 'season')
    if (speed > 0) {
      phase = (t * speed * 0.01) % 1
      setCtl(this.controls, 'season', phase)
    }
    if (Math.abs(phase - this.seasonPhase) < 0.004) return
    this.seasonPhase = phase
    // keyframes: speed, leaf, decay, hue shift, saturation, brightness
    const K = [
      [1.3, 0.7, 0.7, 0.08, 1.1, 0.1], // spring: fresh, pink-green
      [1.0, 1.0, 1.0, 0.0, 1.0, 0.0], // summer
      [0.7, 0.6, 1.6, -0.12, 1.2, -0.05], // autumn: oranges, leaves thin
      [0.35, 0.0, 3.0, -0.35, 0.25, 0.15], // winter: pale, bare, dissolving
    ]
    const x = phase * 4
    const i = Math.floor(x) % 4
    const j = (i + 1) % 4
    const u = x - Math.floor(x)
    const uu = u * u * (3 - 2 * u)
    const mix = (a: number, b: number) => a + (b - a) * uu
    const f = this.seasonF
    f.speed = mix(K[i][0], K[j][0])
    f.leaf = mix(K[i][1], K[j][1])
    f.decay = mix(K[i][2], K[j][2])
    f.hue = mix(K[i][3], K[j][3])
    f.sat = mix(K[i][4], K[j][4])
    f.bright = mix(K[i][5], K[j][5])
    if (speed === 0 && phase === 0) {
      f.speed = f.leaf = f.decay = f.sat = 1
      f.hue = f.bright = 0
    }
    this.leafScale = f.leaf
    for (const p of this.plants) this.applySeasonColor(p)
    for (const sg of this.segs) this.writeColor(sg)
  }

  private applySeasonColor(p: Plant) {
    const f = this.seasonF
    const hsl = { h: 0, s: 0, l: 0 }
    p.baseColor.getHSL(hsl)
    p.color.setHSL((hsl.h + f.hue + 1) % 1, Math.min(1, hsl.s * f.sat), Math.min(1, Math.max(0, hsl.l + f.bright)))
  }

  /** Chord-name detection from held notes / chroma, spawning letterforms when the chord changes. */
  private typography(m: MusicState, t: number) {
    if (ctl(this.controls, 'text') !== 1) return
    const pcs: number[] = []
    if (m.active.size) {
      const set = new Set<number>()
      for (const n of m.active.values()) set.add(pitchClass(n.pitch))
      pcs.push(...set)
    } else for (let i = 0; i < 12; i++) if (m.chroma[i] > 0.6) pcs.push(i)
    const name = chordName(pcs)
    if (pcs.length) this.lastChordRoot = NOTE_NAMES.indexOf(name.replace(/[^A-G#]/g, '').slice(0, 2)) >= 0 ? NOTE_NAMES.indexOf(name.match(/^[A-G]#?/)?.[0] ?? 'C') : 0
    if (name !== this.lastChord) {
      this.lastChord = name
      this.chordSince = t
    } else if (name && t - this.chordSince > 0.25 && t - this.lastText > 1.2 && !this.plants.some((p) => p.isText && (p.held || p.autoUntil > t))) {
      this.lastText = t
      this.growText(name)
    }
  }

  /** Grow a string as letterforms: rasterise, sample strokes, chain into polylines, plant them in front of the camera. */
  growText(text: string) {
    const g = this.lastG
    if (!g || !text.trim()) return
    const cv = document.createElement('canvas')
    const ctx2 = cv.getContext('2d')!
    const font = 'bold 72px system-ui, sans-serif'
    ctx2.font = font
    const w = Math.ceil(ctx2.measureText(text).width) + 20
    const h = 96
    cv.width = w
    cv.height = h
    ctx2.font = font
    ctx2.fillStyle = '#fff'
    ctx2.textBaseline = 'middle'
    ctx2.fillText(text, 10, h / 2)
    const img = ctx2.getImageData(0, 0, w, h).data
    const step = 5
    const pts: { x: number; y: number; used: boolean }[] = []
    for (let y = 0; y < h; y += step) for (let x = 0; x < w; x += step) if (img[(y * w + x) * 4 + 3] > 128) pts.push({ x, y, used: false })
    if (!pts.length) return
    // greedy chaining into strokes
    const strokes: { x: number; y: number }[][] = []
    for (const start of pts) {
      if (start.used) continue
      start.used = true
      const line = [start]
      let cur = start
      for (;;) {
        let best: (typeof pts)[0] | null = null
        let bd = step * step * 3.2
        for (const q of pts) {
          if (q.used) continue
          const d = (q.x - cur.x) ** 2 + (q.y - cur.y) ** 2
          if (d < bd) {
            bd = d
            best = q
          }
        }
        if (!best) break
        best.used = true
        line.push(best)
        cur = best
      }
      if (line.length > 2) strokes.push(line)
    }
    // place on a plane facing the camera
    const size = ctl(this.controls, 'size')
    const fwd = new THREE.Vector3().subVectors(this.cam.look, this.cam.pos).normalize()
    const right = new THREE.Vector3().crossVectors(fwd, Y_AXIS).normalize()
    const up = new THREE.Vector3().crossVectors(right, fwd).normalize()
    const origin = new THREE.Vector3().copy(this.cam.pos).addScaledVector(fwd, Math.min(this.cam.viewDist * 0.7, size * 1.6))
    const W = size * 0.9
    const sc = W / w
    const to3 = (q: { x: number; y: number }) => origin.clone().addScaledVector(right, (q.x - w / 2) * sc).addScaledVector(up, (h / 2 - q.y) * sc)
    const t = this.lastGTime
    const plant = this.newPlant(60 + (this.lastChordRoot ?? 0), 0.8, g, t, { autoUntil: t + ctl(this.controls, 'textHold'), isText: true, root: to3(strokes[0][0]), sp: SPECIES[1] })
    plant.tips = []
    const r = 0.03 * ctl(this.controls, 'thickness') * (size / 14)
    plant.r0 = r
    for (const line of strokes) {
      const path = line.map(to3)
      plant.tips.push({ pos: path[0].clone(), dir: new THREE.Vector3(0, 1, 0), axis: randDir(), r, depth: 0, arc: 0, seg: null, plant, path, pathI: 1, side: 1, sinceBranch: 0, wob: new THREE.Vector3() })
    }
  }
  private lastGTime = 0
  private lastChordRoot: number | null = null

  /**
   * Up to n side shoots from random finished joints of p (wild bursts, a drop), within its species'
   * tip limit plus `over` (short-lived: they start near the depth limit). Returns how many started.
   */
  private sprout(p: Plant, n: number, over = 0): number {
    n = Math.min(n, p.sp.maxTips + over - p.tips.length)
    let k = 0
    for (let i = 0; i < n; i++) {
      const from = p.segs[(Math.random() * p.segs.length) | 0]
      if (from.growth < 1) continue
      p.tips.push({ pos: from.b.clone(), dir: randDir(), axis: randDir(), r: Math.max(0.01, from.r * 0.6), depth: Math.max(0, p.sp.maxDepth - 6), arc: from.arc + from.a.distanceTo(from.b), seg: null, plant: p, side: 1, sinceBranch: 0, wob: randDir().multiplyScalar(0.3), turn: TURNS[(Math.random() * TURNS.length) | 0], anchor: from.anchor?.b })
      k++
    }
    return k
  }

  // ------------------------------------------------------------ frame

  frame(m: MusicState, g: GlobalParams) {
    if (!this.ready || !this.renderer) return
    this.lastG = g
    this.lastGTime = m.time
    const dt = m.dt
    const t = m.time
    this.noRoom = false
    for (const f of this.features) f.beforeFrame?.(m, g, dt, t, this)
    const speed = ctl(this.controls, 'speed') * g.growth
    const lignify = ctl(this.controls, 'lignify')
    const camModeNow = ctl(this.controls, 'camMode')
    this.shellOn = !endless(camModeNow)
    const retract = ctl(this.controls, 'retract')

    for (const ev of m.events) {
      const key = noteKey(ev)
      if (ev.kind === 'on') {
        const prev = this.byNote.get(key)
        if (prev) this.release(prev, t, lignify, true)
        const p = this.newPlant(ev.pitch, ev.velocity, g, t, { stem: ev.source === 'stem' ? ev.stem : undefined, played: !ev.regrow })
        this.byNote.set(key, p)
        this.ignition.noteOn(p, ev, t)
      } else {
        const p = this.byNote.get(key)
        if (p) {
          this.ignition.noteOff(p, t)
          this.release(p, t, lignify)
          this.byNote.delete(key)
        }
      }
    }

    // shell cycle: swap to another shape (and size) every N seconds, on the bar when asked
    const shellEvery = ctl(this.controls, 'shellCycle')
    if (shellEvery > 0) {
      if (this.shellCycleT === 0) this.shellCycleT = t
      if (t - this.shellCycleT >= shellEvery) this.shellCycleDue = true
      const onBeat = ctl(this.controls, 'shellCycleBeat') > 0 && m.beat.bpm > 0
      if (this.shellCycleDue && (!onBeat || m.beat.barHit > 0.9)) {
        this.shellCycleDue = false
        this.shellCycleT = t
        const n = this.shellNames().length
        if (n > 2) {
          const cur = ctl(this.controls, 'shell')
          let pick = cur
          for (let i = 0; i < 8 && pick === cur; i++) pick = 1 + ((Math.random() * (n - 1)) | 0)
          setCtl(this.controls, 'shell', pick)
          this.onControlValue?.('shell', pick)
          if (ctl(this.controls, 'shellCycleSize') > 0) {
            const sz = 3 + Math.round(Math.random() * 9)
            setCtl(this.controls, 'shellSize', sz)
            this.onControlValue?.('shellSize', sz)
          }
          this.rebuildShell()
        }
      }
    } else if (this.shellCycleT) {
      this.shellCycleT = 0
      this.shellCycleDue = false
    }

    // timed cycle: every N seconds the world resets, reverses, or sheds its oldest half
    const every = ctl(this.controls, 'cycleEvery')
    if (every > 0) {
      if (this.cycleT === 0) this.cycleT = t
      if (t - this.cycleT >= every) {
        this.cycleT = t
        const mode = ctl(this.controls, 'cycleMode')
        if (mode === 0) {
          // start over, but a key you are still holding grows again immediately
          const held = [...this.byNote].map(([key, pl]) => ({ key, pitch: pl.pitch, velocity: pl.velocity, stem: pl.stem, ign: pl.ign }))
          this.clearGrowth()
          for (const h of held) {
            const np = this.newPlant(h.pitch, h.velocity, g, t, { stem: h.stem })
            if (h.ign) np.ign = { ...h.ign }
            this.byNote.set(h.key, np)
          }
        } else if (mode === 1) this.reversing = !this.reversing
        else this.shedOldest(t)
      }
    } else if (this.cycleT || this.reversing) {
      this.cycleT = 0
      this.reversing = false
    }

    // only so many growths build at once: the oldest are released early, which
    // keeps the scene legible and stops the budget filling in a couple of seconds
    // (the flight's ambient web is scenery: it never makes a played note finish early)
    const maxLive = ctl(this.controls, 'maxLive')
    let live = 0
    for (const p of this.plants) if ((p.held || p.autoUntil > t) && !p.ambient) live++
    if (live > maxLive) {
      for (const p of this.plants) {
        if (live <= maxLive) break
        if (!(p.held || p.autoUntil > t) || p.ambient) continue
        this.release(p, t, lignify, true)
        live--
      }
    }
    this.budgetNow = this.budgetCap()
    this.plantShare = Math.max(800, this.budgetNow / Math.max(2, live))

    // budget pressure only drives recycling (below): growth keeps its full speed up to the
    // limit while old dormant growth retracts to make room, so a late note never grows slower
    const pressure = this.segs.length / this.budgetNow
    const speedReact = ctl(this.controls, 'speedReact') * ctl(this.controls, 'react')
    // growth per musical event scales both how fast segments extend and how many may start
    const amount = ctl(this.controls, 'musicAmount')
    let allowance = this.credits.begin(ctl(this.controls, 'fillRate') * amount, dt)
    // grow held plants (and self-growing ones: nested children, text), NEWEST first so the
    // note just played gets its segments before older growths spend this frame's credit
    // (children pushed by release() below start next frame)
    for (let pi = this.plants.length - 1; pi >= 0; pi--) {
      const p = this.plants[pi]
      if (!p.held && p.autoUntil > 0 && t >= p.autoUntil) this.release(p, t, p.isText ? 0 : lignify, true)
      if (!p.held && !(p.autoUntil > t)) continue
      if (this.reversing) continue // the cycle is running growth backwards
      // a played note's own envelope (attack, decay, sustain, release) sets its pace; without one,
      // v0.20's global energy term
      const env = this.ignition.envelope(p, t)
      const rate =
        amount * speed * this.seasonF.speed * p.sp.speed * (1.4 + 2.6 * p.velocity) * (env ?? 0.75 + 0.5 * m.energy) * (1 + speedReact * (0.8 * m.energy + 1.5 * this.hitEnv)) * this.song.rate
      for (const tip of [...p.tips]) {
        if (!tip.seg) {
          // a note's first segments never queue for credit: the attack shows in the frame it arrives
          if (allowance <= 0 && !this.ignition.freeStart(p, tip, t)) continue // this frame's quota is spent; the tip waits
          this.startSegment(tip, m, t)
          if (tip.seg && allowance > 0) allowance-- // a start that waited or ended the tip costs nothing
        }
        const seg = tip.seg
        if (!seg) continue
        const len = seg.a.distanceTo(seg.b)
        seg.growth += (rate * this.ignition.lunge(p, tip, t) * dt) / Math.max(0.05, len)
        if (seg.growth >= 1) this.finishSegment(tip)
        else this.writeSeg(seg)
      }
      // tunnel / flight: a held note keeps growing AHEAD of the camera — once its tips fall
      // behind, it sends a new shoot forward from the camera's path (flight: into its tube)
      if (endless(camModeNow) && !p.ambient && !p.sp.soft && !this.plantFull(p)) {
        let aheadTips = 0
        for (const tip of p.tips) if (this.v2.subVectors(tip.pos, this.cam.pos).dot(this.cam.fwd) > -1) aheadTips++
        if (aheadTips === 0) {
          const pos = new THREE.Vector3()
          const dir = randDir()
          if (camModeNow === CAM.flight) this.flight.place(p.pitch, p.velocity, pos, dir)
          else {
            pos.copy(this.cam.pos).addScaledVector(this.cam.fwd, 3 + Math.random() * 4)
            pos.x += rnd() * 3
            pos.y += rnd() * 3
            pos.z += rnd() * 3
          }
          const r = Math.max(camModeNow === CAM.flight ? tipMinR(p) * 2 : 0.02, (p.segs[p.segs.length - 1]?.r ?? 0.05) * 0.9)
          p.tips.push({ pos, dir, axis: randDir(), r, depth: 1, arc: 0, seg: null, plant: p, side: 1, sinceBranch: 0, wob: randDir().multiplyScalar(0.3) })
        }
      }
      // a held plant keeps expanding: re-sprout from an existing joint when tips run out
      if (p.tips.length < 3 && p.segs.length > 0 && !this.plantFull(p)) {
        const from = p.segs[(Math.random() * p.segs.length) | 0]
        if (from.growth >= 1) {
          const axis = randDir()
          const nd = this.v2.subVectors(from.b, from.a).normalize().applyAxisAngle(axis, 0.5 + Math.random()).normalize()
          if (p.sp.planar) this.toPlane(p, nd)
          if (p.sp.dir0) nd.set(rnd() * 0.2, p.sp.dir0 === 'down' ? -1 : 1, rnd() * 0.2).normalize()
          p.tips.push({ pos: from.b.clone(), dir: nd.clone(), axis, r: Math.max(0.01, from.r * 0.8), depth: 1, arc: from.arc + from.a.distanceTo(from.b), seg: null, plant: p, side: 1, sinceBranch: 0, wob: randDir().multiplyScalar(0.3), anchor: from.anchor?.b })
        }
      }
      // while held, growth ages into permanence (the flight's ambient web never does: it follows the music)
      if (lignify > 0 && !p.ambient) for (const s of p.segs) if (!s.permanent && t - s.born > lignify) s.permanent = true
    }
    this.credits.end(allowance)

    // retract released plants (newest non-permanent growth first)
    const silent = m.active.size === 0
    const sounding = m.energy > 0.03 || !silent
    // Recycling: near the budget, the OLDEST growths are retired to fund the new
    // ones. Enough of them retract at once to free segments at least as fast as
    // they are being created, so there is always room for the next note.
    this.spawnRate += (this.spawnCount / dt - this.spawnRate) * (1 - Math.exp(-dt * 2))
    this.spawnCount = 0
    const recycle = ctl(this.controls, 'recycle')
    const startAt = 0.8
    const urgency = Math.min(1, Math.max(0, (pressure - startAt) / (1 - startAt)))
    const pruneRate = retract * (6 + 10 * urgency) // how fast a retiring growth unwinds
    // one retiring growth frees roughly pruneRate / segment-length segments a second
    const perPlant = Math.max(1, pruneRate / 0.35)
    const freeRate = this.spawnRate * recycle * (0.6 + urgency) + urgency * 40
    let pruneLeft = recycle > 0 && urgency > 0 ? Math.min(60, Math.ceil(freeRate / perPlant)) : 0
    for (const p of this.plants) {
      if ((p.held || p.autoUntil > t) && !this.reversing) continue
      // Build shape's fill outlasts the silence; the flight's ambient web stays while the music
      // sounds and draws back in silence (recycling at the limit can still retire either)
      const kept = (!!p.refAuto || (!!p.ambient && sounding)) && !this.reversing
      let target: Seg | null = null
      if (!(kept && p.ambient)) {
        for (let i = p.segs.length - 1; i >= 0; i--) {
          if (!p.segs[i].permanent) {
            target = p.segs[i]
            break
          }
        }
      }
      let rate = retract * 2.2
      const decayNow = g.decay * this.seasonF.decay
      if (!target && !kept && decayNow > 0 && (silent || this.seasonF.decay > 1.5) && !p.fused) {
        // dormant skeleton slowly dissolves when nothing plays (faster in winter)
        target = p.segs[p.segs.length - 1] ?? null
        rate = retract * decayNow * 0.8
      } else if (!target && !kept && g.decay > 0 && silent && p.fused && t - p.released > 20 / g.decay) {
        target = p.segs[p.segs.length - 1] ?? null
        rate = retract * g.decay * 0.5
      }
      if (!target && (this.reversing || p.dying) && p.segs.length) {
        // reversing, or already retiring: keep unwinding whatever is left
        target = p.segs[p.segs.length - 1]
        rate = this.reversing ? retract * 6 : pruneRate
      }
      if (!target && pruneLeft > 0 && p.segs.length) {
        pruneLeft--
        if (!p.dying) {
          // fade it out once, so a retiring structure reads as old rather than blinking away
          p.dying = true
          for (const sg of p.segs) this.writeColor(sg)
        }
        target = p.segs[p.segs.length - 1]
        rate = pruneRate
      }
      if (!target) continue
      const len = Math.max(0.05, target.a.distanceTo(target.b))
      target.growth -= (rate * dt) / len
      if (target.growth <= 0) this.removeSeg(target)
      else this.writeSeg(target)
    }
    this.dyingNow = 0
    for (const p of this.plants) if (p.dying) this.dyingNow++
    this.prunePlants((p) => p.held || p.autoUntil > t || p.segs.length > 0)
    for (const f of this.features) f.afterGrowth?.(m, g, dt, t, this)
    // segment mesh counts and visibility are set right before rendering (flushInstances)

    // ---- wild: spike bursts on hits, sway + pulse of young growth
    const wild = ctl(this.controls, 'wild')
    if (wild > 0) {
      const beatLock = ctl(this.controls, 'beatLock') > 0 && m.beat.bpm > 0
      const trigger = beatLock ? m.beat.hit > 0.9 : m.onset > 0.55
      if (trigger && t - this.lastBurst > 0.25) {
        this.lastBurst = t
        for (const p of this.plants) {
          if (!p.held || p.segs.length < 2) continue
          this.onEvent?.('burst', p.pitch, m.onset)
          this.sprout(p, Math.round(wild * 3 * m.onset))
        }
      }
    }
    setShaderMusic(m.energy, m.onset, m.bass, m.treble, m.beat.hit)
    // the song response lifts the highlight during builds and breakdowns (fresh brighter, old dimmer)
    const focus = Math.min(1, ctl(this.controls, 'musicFocus') + this.song.focus)
    uNow.value = t - this.epoch
    uFocus.value = focus
    uTrail.value = Math.max(0.5, ctl(this.controls, 'musicTrail'))
    // music envelopes: hits come from onsets, beats and the notes you play
    // (the beat tracker keeps predicting after the music stops — only trust it while something sounds)
    let hit = Math.max(m.onset, sounding ? m.beat.hit : 0)
    for (const ev of m.events) if (ev.kind === 'on') hit = Math.max(hit, 0.5 + 0.5 * ev.velocity)
    this.hitEnv = Math.max(this.hitEnv * Math.exp(-dt * 7), hit)
    this.bassS += (m.bass - this.bassS) * (1 - Math.exp(-dt * 12))
    const reactAmt = ctl(this.controls, 'react')
    uPulse.value = 0.12 * ctl(this.controls, 'pulse') * reactAmt * (0.7 * this.bassS + 0.8 * this.hitEnv)
    // a light world's hairline threads breathe with the bass instead of turning into pipes
    uSwellRel.value = this.haze.on ? 1 : 0
    uFlash.value = 2.5 * ctl(this.controls, 'flash') * reactAmt * (0.35 * this.hitEnv + 0.15 * this.bassS) + this.song.flash
    updateMaterialUniforms(this.matPulse, dt, ctl(this.controls, 'materialSpeed'), ctl(this.controls, 'materialScale'), ctl(this.controls, 'materialReact'), m.energy, this.hitEnv)
    this.animateModel(m, dt)
    this.deform(m, t, wild)
    this.seasons(t)
    this.typography(m, t)
    this.updateCoverage()

    // ---- camera (organism/camera.ts). The growth group never rotates or scales (local == world,
    // so the shell test is exact); every movement is the camera's.
    const ci = this.camIn
    ci.segs = this.segs
    ci.young = this.young
    ci.plants = this.plants
    ci.shellLean = this.shell ? (this.skin ? 0 : 0.3) : 1
    ci.minRadius = this.shell ? ctl(this.controls, 'shellSize') * Math.sqrt(0.6) : 2
    ci.hitEnv = this.hitEnv
    ci.bassS = this.bassS
    ci.wild = wild
    ci.gesture = this.gesture
    ci.size = ctl(this.controls, 'size')
    ci.ref = this.ref.box()
    ci.surface = this.soft.samples
    ci.surfaceN = this.soft.sampleN
    // centre the framing beside the panel — never in a take (its frame has no panel; it starts
    // centred at once) or while screen bounce owns the whole frame
    const inset = !this.outSize && !this.lockQuality && ctl(this.controls, 'screenBounce') === 0
    this.cam.setInset(inset ? this.insetWant.x : 0, inset ? this.insetWant.y : 0, !!this.outSize || this.lockQuality)
    const mode = this.cam.update(m, g, dt, t, ci)
    if (this.sky) this.sky.position.copy(this.camera.position)
    // after the camera: flat markers face this frame's view
    this.tips.update(this.plants, t, m.onset, focus, this.cam.viewDist, this.haze.light)
    if (mode === CAM.tunnel && ++this.cullTick % 30 === 0) {
      // tunnel: growth far behind the camera is culled
      const behind: Seg[] = []
      for (const s of this.segs) if (this.v2.subVectors(s.a, this.cam.pos).dot(this.cam.heading) < -25) behind.push(s)
      for (const s of behind) this.removeSeg(s)
      if (behind.length) this.prunePlants((p) => p.held || p.segs.length > 0)
    }
    // gestures: an open palm repels growth (head parallax and pinch-orbit are the camera's)
    this.repel = null
    const gs = this.gesture
    if (gs && gs.present) {
      const right = this.v3.crossVectors(this.cam.fwd, Y_AXIS).normalize()
      for (const h of gs.hands) if (!h.pinch && h.open) this.repel = new THREE.Vector3().copy(this.center).addScaledVector(right, h.x * ci.size * 0.8).addScaledVector(Y_AXIS, h.y * ci.size * 0.6)
    }
    // light + colour react: bass warms the sky, treble opens the rim, sustained energy fogs and blooms
    const react = ctl(this.controls, 'lightReact')
    this.sustain += (m.energy - this.sustain) * (1 - Math.exp(-dt * 0.6))
    this.hemi.color.setRGB(0.75 + 0.25 * m.bass * react, 0.82 - 0.05 * m.bass * react, 1 - 0.4 * m.bass * react)
    this.backLight.intensity = 0.9 + 2.5 * m.treble * react
    this.dirLight.intensity = 2.2 - 0.6 * this.sustain * react
    this.trebleS += (m.treble - this.trebleS) * (1 - Math.exp(-dt * 8))
    // a light world (organism/haze.ts): a glowing rim only pales thin growth against it, and the
    // haze's reflections light everything already, so the flat fill lights step back
    const light = this.haze.light
    uRim.value = ctl(this.controls, 'rim') * (0.55 + 0.9 * this.trebleS * react) * (1 - light)
    this.ambient.intensity = 0.35 * (1 - 0.7 * light)
    this.hemi.intensity = 1.5 * (1 - 0.6 * light)
    // tone mapping and bloom (the output pass rebuilds only when the mapping changes). ACES darkens
    // and greys a light sky; neutral passes it through and rolls off only what is brighter
    const toneMap = TONE_MAP_IDS[ctl(this.controls, 'toneMap')] ?? THREE.ACESFilmicToneMapping
    this.renderer.toneMapping = light > 0.5 && toneMap === THREE.ACESFilmicToneMapping ? THREE.NeutralToneMapping : toneMap
    this.renderer.toneMappingExposure = ctl(this.controls, 'exposure')
    this.closeUp = mode === CAM.flight && !this.haze.on
    const bloomWant = ctl(this.controls, 'bloom') * (0.5 + 0.7 * this.sustain + this.song.bloom) * (this.closeUp ? CLOSE_BLOOM : 1)
    this.bloomS += (bloomWant - this.bloomS) * (1 - Math.exp(-dt * 5))
    if (this.floor) this.floor.position.y = -ctl(this.controls, 'size') - 1.5
    if (this.ceiling) this.ceiling.position.y = ctl(this.controls, 'size') + 1.5
    // fog scaled to the view so a big organism never fades to black
    const circling = mode === CAM.orbit || (mode >= CAM.tipGlide && mode <= CAM.director)
    // (flight: the web melts into the haze just before the far end of its tube, where it appears)
    const flying = mode === CAM.flight
    const fogBase = circling ? 0.55 / (this.cam.pos.distanceTo(this.center) + this.cam.radius + 4) : flying ? FLIGHT_FOG : 0.05
    ;(this.scene.fog as THREE.FogExp2).density = fogBase * (1 + (flying ? 0.25 : 0.8) * this.sustain * react) * (ctl(this.controls, 'env') === 2 ? 1.6 : 1)

    this.placeNoteLight(m, g, dt, t)

    // ---- auto quality (organism/quality.ts): bloom, then render scale, then effects; frozen in a take
    this.fpsEma += (1 / Math.max(1e-3, dt) - this.fpsEma) * 0.05
    if (ctl(this.controls, 'autoQuality') > 0) {
      const cap = FRAME_CAPS[ctl(this.controls, 'fpsCap')] ?? 0
      if (!this.lockQuality && !this.outSize && this.quality.update(this.fpsEma, cap || 60, dt, t)) this.applyQuality()
    } else if (this.quality.reset(t)) this.applyQuality()

    this.draw()
  }

  /**
   * The note light: the newest held note's growth lights its surroundings in its own colour, bright
   * on the attack, and lets go over about 0.6 s. With nothing held (or on the lightest quality tier)
   * it sits at the centre in the palette's colour and follows the energy, as before.
   */
  private placeNoteLight(m: MusicState, g: GlobalParams, dt: number, t: number) {
    const light = this.pointLight
    let lit: Plant | null = null
    if (this.quality.current.fx)
      for (let i = this.plants.length - 1; i >= 0 && !lit; i--) {
        const p = this.plants[i]
        if (p.held && p.ign && p.ign.up < 0 && p.tips.length) lit = p
      }
    let want: number
    const at = this.v2
    if (lit) {
      // the leading tips' centroid: where this note is growing now
      at.set(0, 0, 0)
      for (const tip of lit.tips) {
        if (tip.seg) at.add(this.v3.copy(tip.seg.a).lerp(tip.seg.b, tip.seg.growth))
        else at.add(tip.pos)
      }
      at.divideScalar(lit.tips.length)
      light.color.lerp(lit.color, 1 - Math.exp(-dt * 12))
      want = 24 * lit.ign!.s * (0.4 + 1.6 * Math.exp(-(t - lit.ign!.t0) * 3))
    } else {
      at.copy(this.center)
      const pc = m.rootPc >= 0 ? m.rootPc : 0
      const lc = cosPalette(g.palette, 0.5, (pc / 12) * g.palette.pitchSpread)
      light.color.setRGB(lc[0], lc[1], lc[2])
      want = 25 * (m.energy * 0.5 + m.onset)
    }
    // a hit lands at once; a release fades
    this.noteLight += (want - this.noteLight) * (1 - Math.exp(-dt * (want > this.noteLight ? 30 : 5)))
    // on a light world a coloured point light only paints a hot spot on the chrome: it steps back
    light.intensity = this.noteLight * (1 - 0.7 * this.haze.light) * (this.closeUp ? CLOSE_LIGHT : 1)
    light.position.lerp(at, 1 - Math.exp(-dt * 10))
  }

  private release(p: Plant, t: number, lignify: number, final = false) {
    p.held = false
    const sustain = ctl(this.controls, 'sustain')
    if (!final && !p.isText && sustain > 0 && !(p.autoUntil > t)) {
      // sustain: keep growing for a while after the key is up, then retract
      p.autoUntil = t + sustain
      return
    }
    p.autoUntil = 0
    p.released = t
    p.tips = []
    // the flight's ambient web never lignifies: it follows the music (organism/flight.ts)
    if (!p.ambient) for (const s of p.segs) if (!p.isText && (p.fused || (lignify > 0 && t - s.born > lignify))) s.permanent = true
    // nested: a finished growth becomes the shell of smaller organisms inside it
    const depth = ctl(this.controls, 'nested')
    if (depth > 0 && p.level < depth && !p.children && !p.isText && p.segs.filter((s) => s.permanent).length >= 60 && this.lastG) {
      p.children = true
      const c = new THREE.Vector3()
      for (const s of p.segs) c.add(s.b)
      c.divideScalar(Math.max(1, p.segs.length))
      let r2 = 0.25
      for (const s of p.segs) r2 = Math.max(r2, s.b.distanceToSquared(c))
      const r = Math.sqrt(r2) * 0.85
      const n = 2 + Math.round(Math.random())
      for (let i = 0; i < n; i++) {
        const root = new THREE.Vector3(rnd(), rnd(), rnd()).multiplyScalar(r * 0.8).add(c)
        const child = this.newPlant(p.pitch + 12, 0.7, this.lastG, t, {
          level: p.level + 1,
          bound: { c: c.clone(), r },
          autoUntil: t + 5 + 3 * Math.random(),
          scale: Math.pow(0.45, p.level + 1),
          root,
        })
        child.fused = false
      }
    }
  }

  unmount() {
    for (const f of this.features) f.unmount?.(this)
    this.ready = false
    for (const mesh of this.segMeshes) {
      this.group.remove(mesh)
      mesh.geometry.dispose()
    }
    // the base materials (the growth shader, when on, is shaderMat below)
    for (const mat of new Set(this.segMats)) mat.dispose()
    if (this.shell) this.scene.remove(this.shell)
    this.shaderMat?.dispose()
    if (this.sky) this.scene.remove(this.sky)
    this.post?.dispose()
    this.post = this.bloomNode = null
    try {
      this.renderer?.dispose()
    } catch {
      /* a lost device can refuse to release what it no longer has */
    }
    this.renderer = null
    this.canvas.remove()
  }
}
