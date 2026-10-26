# R2: data-oriented, GPU-driven core for Growth v0.20

Angle: store segments as struct-of-arrays (SoA) typed buffers and upload only the ranges that changed. Build each instance's transform in a TSL vertex shader. Keep plants and tips as lightweight records. Growth, retract, recycle, reference anchoring, wind and emphasis become systems that run over those buffers. The TypeScript tree (v0.15.0) hosts all v0.15.1–v0.19.0 features, and the migration never needs a big-bang rewrite.

Sources read: `src/midi/engines/organism.ts` (2790 lines), `src/midi/main.ts`, `src/midi/engine.ts`, `src/midi/shaders.ts`, `index.html` (TS repo, tag v0.15.0). From the v19 distribution: every `NOTES_*.md`, `START_HERE_v0190.md`, `maintenance/*.js` (reference-growth, reference-field API, music-focus, soft-growth, soft-species-extra, stage-motion, tip-shapes, cinematic-camera, calm-camera, dynamic-material(s|-runtime), extra-controls, simple-ui), the patch anchors in the bundle `assets/index-BWYXfAkm.js`, and `node_modules/three` r185.1. Nothing in either tree was modified.

---

## 0. Summary

- **Verdict: recommended as the core of v0.20.** It fits the problem well, but only if the migration is staged (section 6). The current engine's main costs and several v19 defects come from the same thing: every visual effect is done by rewriting per-segment 4×4 matrices and colours on the CPU, then re-uploading whole GPU buffers. Seven of the v0.16–v0.19 features either rewrite segments in CPU loops or patch `writeSeg`/`writeColor`: reference follow, music focus, soft surfaces, model attach, wild sway, physics and nerves. In this design they become shader terms driven by a few small columns and a plant table. Their per-frame CPU cost drops to about zero, and they no longer need wrappers around the same methods.
- **Growth simulation stays on the CPU.** Branching is sequential, random and small: hundreds of tips, not millions. WebGL2 has no compute shaders, so a WebGPU-only growth path would split behaviour between browsers. "GPU-driven" here means that rendering, deformation, colour, emphasis and soft surfaces run on the GPU, while the CPU runs growth decisions over typed arrays.
- **Main benefit for the owner:** the same laptop can afford much larger budgets and higher `fillRate`, which directly addresses "growth should visibly follow the music" and "growth should not stall at limits". Music reactions also become free for every segment, for example each note's organism throbbing with its own pitch class. A deterministic sim clock plus a seeded RNG then allow offline constant-frame-rate (CFR) re-renders of a performance, which is the cleanest long-term answer to the recording complaints.

---

## 1. Evidence from the current code

Line numbers refer to `C:\Users\User\Desktop\code\growth-midi-visualiser\src\midi\engines\organism.ts` unless stated otherwise.

### 1.1 Whole-buffer uploads on every frame

- `writeSeg` (1717–1773) writes a matrix into **six** InstancedMeshes per segment: the chosen body mesh, zero-matrices into the other two body meshes, the leaf mesh, and the sphere and cube node meshes (the unused ones get zero matrices). It then sets `instanceMatrix.needsUpdate = true` on all six (1744, 1756, 1771–1772).
- `writeColor` (1687–1701) writes six colours and sets `instanceColor.needsUpdate` on all six (1695–1700).
- None of this code calls `addUpdateRange`. In three r185, an attribute with an empty `updateRanges` list is uploaded **in full**:
  - WebGL: `if(l.length===0)s.bufferSubData(a,0,n)`.
  - WebGPU: `if(u.length===0)n.queue.writeBuffer(o,0,a,0)`, in `WebGPUAttributeUtils.js:225-243`.
- Estimate (arithmetic from the code, not a measurement). At the default budget of 60k, capacity reaches 60k. Six matrix buffers × 60k × 64 B = **23 MB**. Colours add six × 60k × 12 B = 4.3 MB. That is **≈27 MB/frame, ≈1.6 GB/s at 60 fps**, whenever at least one segment grows, which is every frame while music plays.
- v17.2's `refreshMusicFocus` (maintenance/music-focus.js) calls `writeColor` on 800 segments on every draw, so the colour buffers are also uploaded in full every frame.
- Seasons recolour **every** segment whenever the phase moves by 0.004 (line 2175).
- On a weak laptop this bus traffic is a leading suspect for frame time. M0 adds a counter to confirm it before anything is claimed to users.

### 1.2 O(n) or O(n·m) CPU loops per frame or per event

| Where | What | Cost |
|---|---|---|
| `nearestEndpoint` 1895–1911 | Scans **all** segments for every `startSegment` whose species has `join>0`. | O(starts × segs). At 60k segments and 1500 starts/s that is about 90 M distance checks per second. |
| `newPlant` 1583 | `this.segs.filter(s => s.growth >= 1)` on every note. | Allocates an array of up to 60k entries per note-on. |
| `removeSeg` 1712–1714 | `plant.segs.indexOf` + `splice`. | O(plant size) per removal. Retraction removes one or more segments per frame per retiring plant. |
| lignify 2422 | Loops over every segment of every held plant, every frame. | O(held segments) per frame. |
| Camera 2577–2590 | Two full passes over `this.segs` for the centroid and radius. | O(n) per frame. |
| `deform` 2075–2138 | Rewrites up to 25k segments per frame through `writeSeg` whenever wild, physics or nerves is on. | 25k × six-matrix writes, plus full uploads. |
| `ctl()` (engine.ts:81) | `controls.find` over about 134 controls (v19), called inside per-segment and per-tip code (`writeSeg` calls `ctl(...,'nodes')` at 1759; `nextDir` makes 5+ calls). | About 70 string comparisons per call. Deform alone makes 25k calls per frame. |
| `growCapacity` 704–714 | Rebuilds meshes, then runs `writeColor` and `writeSeg` for every segment. | A spike on each doubling. |

Added by v0.16–v0.18 (maintenance modules):

- **Reference follow:** `updateReference` rewrites up to **4000 segments at 30 Hz** through `writeSeg`.
- **Soft surfaces:** `updateSoftGrowth` deforms up to 16 meshes of 425 vertices per frame on the CPU and calls `computeVertexNormals()` at 15 Hz.
- **Screen bounce:** `updateBounceBounds` allocates `new A()` inside loops and projects 768 points four times a second.
- **Wide camera framing:** the `mode===8` branch of `updateCinematic` samples 512 segments per frame.

### 1.3 v19 defects this design fixes structurally

- **Liquid looks faceted.** `soft-growth.js` builds Liquid from `new kp(1,2)`, which is `IcosahedronGeometry`, so all 13 soft species inherit the path described next. three's `PolyhedronGeometry` is **non-indexed**, so `computeVertexNormals()` produces **flat per-face normals**. Detail level 2 means 320 triangles. That matches the lead's observation of faceted low-poly blobs. A parametric TSL surface with analytic or finite-difference normals on an indexed grid (section 4.6) fixes it.
- **Silk and soft surfaces grow out of frame.** Camera framing reads skeleton segment endpoints only (organism.ts 2577–2590; `updateCinematic` also samples `segments[i].b`). Soft surfaces extend well beyond their skeleton: ribbon length is `size*2` from the root. In v19 the default Still camera is also pose-locked (`calm-camera.js` calls `toggleCameraLock()`), so nothing reframes. A single `SceneBounds` that includes analytic soft-surface bounds and feeds the camera `framing` module fixes this (section 4.8).
- **Wrapper stacking on the same methods.** v19 patches `writeSeg` (soft), `writeColor` (focus), `addSeg`, `finishSegment` and `clearGrowth` (reference, plus soft, plus focus `clear`) by prototype wrapping. The order of those wrappers carries behaviour. v17.1 already hit one resulting bug, an anchor captured from a scratch vector after `addSeg`; see NOTES_V0171. In this design each of those features is a registered column, system or shader term, so nothing intercepts the draw path.
- **Species, shader and camera indices are append-only positional.** Species are stored as `sp:${i}` (organism.ts:367), shaders as index 0–31, and camMode as 0–8. v17 and v18 had to append to keep saved indices meaningful. Two engineers adding species in parallel would collide. Stable string ids are part of this design (section 4.9).

---

## 2. Design principles

1. **One source of truth per datum.** Segment geometry lives in SoA columns indexed by a stable `SegId`. GPU buffers mirror it and are synchronised once per frame from a dirty set.
2. **CPU keeps rest positions; the GPU computes displayed positions.** Rest position is the undeformed a/b. Displayed position is rest plus the displacement stack, radius stack and colour stack. This already matches today's semantics: `deform()` passes offsets into `writeSeg` without mutating `seg.a/b` (2127). Two features currently do mutate a/b, model attach (1296–1304) and reference follow. Both become parameters (a plant offset; a UV anchor plus a relief texture) and get a CPU mirror function for the rare CPU consumers.
3. **Records for few, columns for many.** Plants (hundreds) and tips (hundreds to low thousands) are plain TS records with numeric fields and no per-object `THREE.Vector3`. Segments (up to 250k) are columns.
4. **Systems are pure functions over a `World`**, run in a declared phase order. Features register systems, columns, controls and shader terms from their own files, so there is no central file to edit.
5. **Deterministic:** an injected RNG and sim time instead of `performance.now()` (lines 771, 1490). That enables golden tests and offline re-render.
6. **The same code path on WebGPU and WebGL2.** Core data uses instanced vertex attributes (`instancedDynamicBufferAttribute`) and `DataTexture` + `textureLoad`. Both exist in r185 (`src/nodes/accessors/BufferAttributeNode.js`, `TextureNode.js`). Storage buffers and compute are optional WebGPU-only extras, never required.

---

## 3. Module and file layout

```
src/
  app/                               ← main.ts (1174 lines) split; engine-agnostic shell
    main.ts                          boot + wiring only (≤150 lines)
    loop.ts                          rAF + SimClock (fixed-step option), engine.frame, recorder hook, HUD tick
    settings.ts                      persistence with safe storage (v15.1 Hi/IK fixes), key migrations
    engines.ts                       registry + selectEngine (Fm), guarded against switching mid-recording (v17)
    shortcuts.ts                     v15.1 guards (composition, modifiers, repeat, F2/Tab/Escape, C = camera cycle)
    hud.ts
    panel/
      render.ts                      schema-driven sections, sliders (l5 → widget), icons, a11y names (v15.1)
      search.ts                      "Find a setting" (maintenance/interface.js)
      views/simple.ts                v19 Simple mode: looks, Growth/Detail/Sensitivity, calm cameras
      views/advanced.ts
      quick/reference.ts             v16 quick reference controls (maintenance/reference-ui.js)
      quick/output.ts                v17/v18 recording controls (recording-ui.js, extra-controls.js)
      quick/materials.ts             v17.3 material picker + "Next new" (dynamic-material-ui.js)
      quick/tips.ts                  v18 tip shape and upload
    presets/
      slots.ts                       8 saved slots (savePreset IK)
      looks.ts                       v19 curated looks (simple-ui.js simpleLooks) as data
      surprise.ts                    v19 Surprise (±12 % jitter)
      morph.ts                       existing Morph
    inputs/
      midi.ts  keyboardPiano.ts      v15.1 D5 fixes (visibilitychange release, form-field guard)
      audio/AudioInput.ts            v15.1 request generations, speaker disconnect, onended guards (audio-methods.js)
      audio/recordTap.ts             v17 input-only tap versus full mix
    sources/
      VideoField.ts                  v16/v17.1 reference-field.js (bilinear, generations, seed density map, 192 px cap)
    output/
      recorder/webcodecs.ts          v15.0 muxer path, repaired (resample/upmix AudioData instead of dropping it)
      recorder/native.ts             v17/v18 MediaRecorder path (recorder-native.js), kept as fallback
      recorder/report.ts             v18 recording report
      offlineRender.ts               NEW: deterministic CFR re-render from an event log (enabled by SimClock + Rng)
      snapshot.ts  cast.ts
  core/
    engine.ts                        Engine interface (unchanged shape + optional `world()` for tests)
    music.ts beat.ts color.ts
    rng.ts                           seedable PRNG (sfc32), `rng()` default-seeded from crypto
    clock.ts                         SimClock: sim time, dt clamp, fixed-step mode
    controls/schema.ts               ControlDef, stable keys, legacy index maps, typed snapshot
  engines/organism/
    index.ts                         OrganismEngine facade: implements Engine, owns World, runs pipeline (≈300 lines)
    world.ts                         World: stores, params snapshot, scratch, event bus
    features.ts                      the ONLY list of features (one import per line, append-only)
    pipeline.ts                      phase enum + ordered system execution (no feature knowledge)
    params.ts                        aggregates feature controls → Params snapshot (O(1) access)
    data/
      segmentStore.ts                SoA columns, free-list SegId, column registry
      idList.ts                      growable Int32 list (plant → segs), tombstones + compaction
      plantTable.ts                  Plant records + GPU plant texture mirror
      tipPool.ts                     Tip records (pooled objects, no Vector3)
      spatialHash.ts                 finished-endpoint grid (fusion, avoid, graft, coverage)
      sceneBounds.ts                 incremental centroid, AABB, activity centre, soft and reference bounds
      dirty.ts                       dirty-id set → coalesced slot ranges
    species/
      types.ts                       Species (+ soft?: SoftKind, id: string)
      rigid.ts                       24 v15 species (unchanged numbers)
      soft.ts                        3 (v17) + 10 (v18) soft species
      mutate.ts                      wild mutants
      registry.ts                    id ↔ legacy index table (sp:0..36)
    systems/
      events.ts                      note on/off → spawn/release (byPitch)
      spawn.ts                       newPlant (root placement, graft via finished list)
      liveLimit.ts                   maxLive early release
      pacing.ts                      v17.2 fractional start credits (segmentAllowance)
      growth.ts                      startSegment / finishSegment / branching
      steering/{turns,avoid,attract,radial,planar,video}.ts   nextDir split into composable terms
      constrain/{bounds,shell,skin,reference,nestedBound}.ts
      lignify.ts                     watermark instead of per-frame loop
      retract.ts                     release retraction + silence decay
      recycle.ts                     budget pressure → dying plants (+ makeRoom)
      cycle.ts shellCycle.ts         timed reset/reverse/shed; shell cycling
      wild.ts                        bursts (CPU part; sway lives in the shader)
      typography.ts nested.ts
      referenceSeed.ts               v16/v17.1/v17.2 auto-fill (bounded), seed density
      tunnel.ts                      tunnel respawn + cull behind the camera
      renderSync.ts                  dirty ids → pool slots → updateRanges (last system before draw)
    render/
      renderer.ts                    WebGPURenderer lifecycle, pixel ratio, auto quality, capture density (v17)
      pools.ts                       archetype pools (skin × node), packed vec4 arrays, swap-remove
      segmentNode.ts                 TSL instance transform (a, b, r, growth → position, normal)
      stacks.ts                      registries: displacement / radius / colour / emissive terms
      stackOrder.ts                  numeric order constants (owned by core; features only reference them)
      displacement/{attach,reference,physics,sway}.ts
      radius/{nerves,pulse,wildPulse}.ts
      color/{plantColor,focus,seasons,dying,flash}.ts
      surfaces/softSurfaces.ts       v17/v18 soft species as instanced TSL parametric surfaces
      surfaces/forms.ts              13 soft forms (TS + TSL twin of softFormXYZ)
      tips.ts                        tip glow + v18 shapes / image / OBJ (tip-shapes.js)
      stageBounce.ts                 v18 projection offset (stage-motion.js)
      env.ts bloom.ts sky.ts backdrop.ts shellView.ts
      materials/{library,classic,dynamic}.ts   22 classic + 10 v17.3 materials, keyed by id
    camera/
      rig.ts                         manual orbit/pan/zoom, Shift+middle pan (v17), lock (v17.2), calm (v19)
      framing.ts                     target framing from SceneBounds (all / action / reference / soft)
      modes/{orbit,weave,tunnel,drift,sit,chase,glide,tour,wide}.ts
    shell/
      loader.ts containment.ts morph.ts attach.ts skinSamples.ts
  engines/{reactionDiffusion,branching,cells,crystal3d}.ts     unchanged
tests/
  unit/        vitest, node
  sim/         golden + musical-response traces (headless World, no GPU)
  browser/     Playwright: Chrome WebGPU, Chrome WebGL2 (--disable-features=Vulkan / forceWebGL), Firefox
  perf/        frame-time and upload-bytes budgets
```

---

## 4. Key interfaces (TypeScript)

These are sketches: names and shapes are the proposal. TSL snippets are written against r185 exports that were verified to exist, but they have not been compiled.

### 4.1 Ids, columns, store

```ts
// data/segmentStore.ts
export type SegId = number            // stable for the segment's lifetime; recycled via free-list
export type PlantId = number          // index into PlantTable (≤ MAX_PLANTS, e.g. 4096)
export const NO_SEG = -1

export const enum SegFlag {
  Finished = 1 << 0,     // growth reached 1 (eligible for fusion/graft/avoid)
  Permanent = 1 << 1,    // lignified / fused — retraction skips it
  Anchored = 1 << 2,     // has reference UV anchors (v16)
  Auto = 1 << 3,         // background reference fill (never "fresh" in music focus, v17.2)
}

export interface CoreColumns {
  ax: Float32Array; ay: Float32Array; az: Float32Array   // rest endpoint A
  bx: Float32Array; by: Float32Array; bz: Float32Array   // rest endpoint B
  r: Float32Array                                        // radius
  growth: Float32Array                                   // 0..1 visible fraction
  born: Float32Array                                     // sim time of creation
  plant: Int32Array                                      // PlantId
  flags: Uint8Array
  archetype: Uint8Array                                  // pool key (skin × node), see pools.ts
  seed: Float32Array                                     // per-segment random 0..1 (leaf orientation, sway phase)
}

export interface ColumnDef<T extends Float32Array | Int32Array | Uint8Array = Float32Array> {
  name: string              // e.g. 'refUV' (feature-owned, namespaced)
  width: number             // components per segment
  type: new (n: number) => T
  gpu?: { attribute: string; pack: (store: SegmentStore, id: SegId, out: Float32Array, o: number) => void }
}

export interface SegmentStore {
  readonly cols: CoreColumns
  readonly count: number                 // live segments
  readonly capacity: number              // allocated rows (grows ×2, like buildMeshes)
  alloc(plant: PlantId, ax: number, ay: number, az: number, bx: number, by: number, bz: number, r: number, t: number): SegId | typeof NO_SEG
  free(id: SegId): void
  isAlive(id: SegId): boolean
  defineColumn<T extends Float32Array | Int32Array | Uint8Array>(def: ColumnDef<T>): T   // feature columns
  column<T>(name: string): T
  markDirty(id: SegId): void             // geometry/growth changed → renderSync
  onAlloc(cb: (id: SegId) => void): void // hash, bounds, feature hooks
  onFree(cb: (id: SegId) => void): void
}
```

### 4.2 Plants and tips as records

```ts
// data/plantTable.ts
export const enum PlantFlag { Held = 1, Dying = 2, Fused = 4, Text = 8, RefAuto = 16, Surface = 32, Children = 64 }

export interface Plant {
  id: PlantId
  gen: number                  // generation counter so stale handles are detectable
  pitch: number; velocity: number; channel: number
  level: number                // nesting depth
  flags: number                // PlantFlag
  birth: number; released: number; autoUntil: number
  species: Species             // shared object, or a mutant owned by this plant
  segLen: number
  rootX: number; rootY: number; rootZ: number
  reach: number
  // resolved render params (so wild mutants render correctly without a species lookup)
  nodeScale: number; glow: number; hue: number
  baseR: number; baseG: number; baseB: number   // colour before seasons (applied in shader)
  // plane basis for planar species
  nx: number; ny: number; nz: number; ux: number; uy: number; uz: number; vx: number; vy: number; vz: number
  segs: IdList                 // SegIds in creation order (retraction pops from the tail)
  lignified: number            // watermark: segs[0..lignified) are permanent
  tips: Tip[]
  bound: { cx: number; cy: number; cz: number; r: number } | null   // nested
  attach: { mesh: THREE.Mesh; vi: number; baseX: number; baseY: number; baseZ: number } | null
  offX: number; offY: number; offZ: number                         // attach shift → shader (no seg rewrite)
  refRoot: { u: number; v: number } | null                          // v16
  surface: SurfaceSlot | null                                       // v17/v18 soft
}

export interface PlantTable {
  readonly live: readonly Plant[]
  create(init: Partial<Plant>): Plant
  retire(p: Plant): void                  // frees id when p.segs is empty and not held
  byPitch: Map<number, Plant>
  markDirty(p: Plant): void               // → GPU plant texture row(s)
  readonly gpu: THREE.DataTexture         // RGBA32F, 4 texels per plant (see 4.5)
}

// data/tipPool.ts
export interface Tip {
  plant: Plant
  x: number; y: number; z: number        // position (rest space)
  dx: number; dy: number; dz: number     // direction
  axX: number; axY: number; axZ: number  // helix axis
  wx: number; wy: number; wz: number     // wobble
  r: number; depth: number; side: number; sinceBranch: number
  seg: SegId                              // NO_SEG when between segments
  turn?: Turn
  path?: Float32Array; pathI?: number     // typography
  nX?: number; nY?: number; nZ?: number   // skin / reference surface normal
  refUV?: { u: number; v: number }        // v16
}
```

Plants and tips stay as objects. They are few, their logic is branchy, and readability matters more than cache lines at hundreds of items. What changes is that they hold no `THREE.Vector3` instances (today every tip allocates `pos/dir/axis/wob` clones, 1646–1649 and 2059) and they reference segments by id.

### 4.3 Spatial hash and scene bounds

```ts
// data/spatialHash.ts — finished endpoints (b) only; lazy deletes
export interface SpatialHash {
  cell: number                                   // world units (≈1.0; ≥ max attract radius / 3)
  insert(id: SegId, x: number, y: number, z: number): void
  nearest(x: number, y: number, z: number, maxD: number, reject: (id: SegId) => boolean): SegId   // replaces nearestEndpoint
  forEachWithin(x: number, y: number, z: number, r: number, fn: (id: SegId, d2: number) => void): void  // avoid, coverage
  randomFinished(rng: Rng): SegId                // graft host (replaces segs.filter at 1583)
  rebuildIfStale(store: SegmentStore): void      // when tombstones > 30 %
}

// data/sceneBounds.ts — O(1) per alloc/free, O(occupied cells) refresh at 4 Hz
export interface SceneBounds {
  centroid(out: Vec3): Vec3                      // running Σa / n (replaces the 2577 loop)
  radiusAround(c: Vec3): number                  // from occupied hash cells (replaces 2590)
  activity(out: Vec3): Vec3                      // EMA of new endpoints (newCenter)
  activeTips(out: Box3): Box3                    // growing tips only: "frame the action"
  softSurfaces(out: Box3): Box3                  // analytic from plant.surface size (fixes the Silk framing)
  reference(out: Box3): Box3                     // v16 rect ± depth
  all(out: Box3): Box3                           // union: used by wide camera, stage bounce, fit view
}
```

### 4.4 Params, systems, pipeline, features

```ts
// core/controls/schema.ts
export interface ControlDef {
  key: string                    // stable id, e.g. 'musicAmount', 'sp.roots' (legacy 'sp:1' mapped)
  label: string; min: number; max: number; step: number; value: number
  options?: { id: string; label: string }[]   // stored by id; legacy index map below
  legacyIndex?: string[]                      // position → id for settings/presets from ≤ v0.19
  icon?: string
  group: string
  views?: ('simple' | 'advanced')[]
  live?: boolean                              // needs onChange side effects (shell rebuild…)
}

// engines/organism/params.ts
export type Params = Readonly<Record<string, number>>        // generated type from schema in practice
export interface ParamStore {
  readonly P: Params                    // plain object, refreshed on change → O(1) reads in hot loops
  set(key: string, v: number): void     // → onChange listeners of the owning feature
  onChange(key: string | RegExp, fn: (v: number) => void): void
}

// engines/organism/pipeline.ts
export const enum Phase { Input, Spawn, Grow, Constrain, Retract, Recycle, Derive, Animate, Camera, Sync, Draw }

export interface FrameCtx {
  m: MusicState; g: GlobalParams
  t: number; dt: number                 // sim time (never performance.now)
  rng: Rng
  P: Params
}
export interface System {
  id: string
  phase: Phase
  order?: number                        // within phase; default 0
  enabled?(w: World, c: FrameCtx): boolean
  run(w: World, c: FrameCtx): void
}

// engines/organism/world.ts
export interface World {
  store: SegmentStore; plants: PlantTable; hash: SpatialHash; bounds: SceneBounds
  params: ParamStore
  field: VideoField | null
  shell: ShellState
  cam: CameraState
  env: MusicEnvelopes                   // hitEnv, bassS, sustain, softBass… (one place, not six copies)
  bus: EventBus                         // 'spawn' | 'fuse' | 'burst' | 'segAlloc' | 'segFree' | 'plantRetired' | 'clear'
  render: RenderContext | null          // null in headless tests
}

// engines/organism/features.ts — the ONLY shared list
export interface FeatureModule {
  id: string
  controls?: ControlDef[]
  columns?: ColumnDef<any>[]
  systems?: System[]
  shader?: ShaderContribution[]         // displacement / radius / colour / emissive terms
  install?(w: World): void | (() => void)   // listeners, resources; the return value disposes
}
export const FEATURES: FeatureModule[] = [
  core, growth, fusion, retract, recycle, lignify, cycle, shellCycle, wild, physics, nerves,
  seasons, typography, nested, stems, shell, skin, modelAttach, morph,
  reference, referenceSeed,             // v16/v17.1
  pacing, musicFocus,                   // v17.2
  softSurfaces,                         // v17/v18
  dynamicMaterials,                     // v17.3
  tips, stageBounce,                    // v18
  cameraModes, cameraLock, calmCamera,  // v17/v17.2/v19
]
```

### 4.5 GPU layout: pools, plant texture, dirty ranges

```ts
// render/pools.ts
// A pool per archetype = skin (tube | ribbed | crystal | leafy | hidden) × node (sphere | cube | none).
// At most 12 pools, created lazily. Each live, rendered segment sits in exactly one pool slot,
// so no instance is drawn as a zero-scale matrix (today every segment is drawn by all 6 meshes).
export interface Pool {
  key: number
  count: number
  segAt: Int32Array                       // slot → SegId
  // packed per-instance data, shared by the pool's body, node and leaf meshes (one data, many views)
  A: THREE.InstancedBufferAttribute       // vec4(a.xyz, r)
  B: THREE.InstancedBufferAttribute       // vec4(b.xyz, growth)
  M: THREE.InstancedBufferAttribute       // vec4(born, plantId, flags, seed)
  extra: Map<string, THREE.InstancedBufferAttribute>   // feature columns with gpu.attribute (e.g. refUV)
  meshes: THREE.Mesh[]                    // Mesh + InstancedBufferGeometry (instanceCount = count)
}
export interface RenderPools {
  slotOf: Int32Array                      // SegId → slot (−1 when not rendered)
  place(id: SegId): void                  // append to pool tail
  remove(id: SegId): void                 // swap-remove: moves the tail slot, 1 dirty slot
  flush(dirty: DirtySet): void            // coalesce slots (gap < 64) → attr.addUpdateRange(); needsUpdate
  bytesThisFrame: number                  // perf counter (tests + HUD)
}
```

- **Per-instance bytes:** 48 B for core data, plus 16 B when a reference is used. Today it is 456 B (six matrices plus six colours). Colour is no longer per segment: it comes from the plant texture.
- **Plant texture:** `MAX_PLANTS × 4` RGBA32F texels.
  - Texel 0: root.xyz, reach.
  - Texel 1: baseRGB, flags.
  - Texel 2: attach offset.xyz, phase.
  - Texel 3: pitchClass, velocity, nodeScale, glow.
  - It is uploaded with `updateRanges` over the dirty rows: at most 64 KB, typically far less.
- **Why instanced attributes rather than storage buffers:** WebGL2 guarantees 16 vertex attributes. Position, normal and uv use 3, and the core uses 3 vec4 plus 1 optional, which leaves headroom. `instancedArray` / `storage()` are reserved for an optional WebGPU compute path later.
- **Steady-state upload estimate:** growing segments (≤ one per tip, about 200–600), retracting segments (≤ one per retiring plant), one slot per swap-remove, and the plant rows that changed. That is roughly 10–40 KB/frame against about 27 MB today.
- **Capacity doubling** re-uploads each pool once. It no longer rewrites every segment through `writeSeg`.

### 4.6 Segment shader (TSL): transform, normal and stacks

```ts
// render/segmentNode.ts — sketch
import { instancedDynamicBufferAttribute as inst, positionLocal, normalLocal, textureLoad, ivec2, int,
         vec3, vec4, float, cross, normalize, length, max, mix, select, abs, step, Fn } from 'three/tsl'

export function segmentPosition(pool: Pool, stacks: Stacks, part: 'body' | 'node' | 'leaf') {
  return Fn(() => {
    const A0 = inst(pool.A), B0 = inst(pool.B), M = inst(pool.M)
    const plant = int(M.y)
    const P = (k: number) => textureLoad(plantTex, ivec2(plant.mul(4).add(k).mod(TEX_W), plant.mul(4).add(k).div(TEX_W)))
    // 1. displacement stack on the rest endpoints (attach, reference, physics, sway), in stackOrder order
    const A = stacks.displace(A0.xyz, { end: 0, M, P })
    const B = stacks.displace(B0.xyz, { end: 1, M, P })
    const growth = B0.w
    const d = B.sub(A), len = max(length(d), 1e-6), dir = d.div(len)
    const up = select(abs(dir.y).greaterThan(0.99), vec3(1, 0, 0), vec3(0, 1, 0))
    const t1 = normalize(cross(up, dir)), t2 = cross(dir, t1)
    // 2. radius stack (nerve pulse, wild pulse, music swell, per-plant chroma throb)
    const r = stacks.radius(A0.w, { M, P })
    const hidden = step(len.mul(growth), 1e-4).max(stacks.hidden({ M, P }))   // Surface plants, dying=0…
    const L = positionLocal
    const pos =
      part === 'body' ? A.add(dir.mul(L.y.add(0.5).mul(len).mul(growth))).add(t1.mul(L.x.mul(r))).add(t2.mul(L.z.mul(r)))
      : part === 'node' ? mix(A, B, growth).add(L.mul(r.mul(P(3).z).mul(uNodes)))            // nodeScale × panel 'nodes'
      : /* leaf */       B.add(leafBasis(M.w).mul(L).mul(leafSize(r)))                         // seed → orientation
    return pos.mul(float(1).sub(hidden))                                                          // collapse = degenerate
  })()
}
// normalNode = t1*n.x + dir*n.y + t2*n.z (fixes today's slightly wrong normals on scaled lathe ribs)
// colorNode  = stacks.color(plantRGB, …) : seasons (uniform HSL shift), dying ×0.45, focus(fresh(born)), skin tint
// emissive   = reactify flash + focus boost; composed with any material from the library (see 4.7)
```

```ts
// render/stacks.ts
export interface ShaderContribution {
  kind: 'displace' | 'radius' | 'color' | 'emissive' | 'hidden'
  order: number                                 // from stackOrder.ts, e.g. ATTACH=100, REFERENCE=200, PHYSICS=300, SWAY=400
  enabledUniform?: THREE.UniformNode<number>    // 0/1 → the branch costs ~nothing when off, no recompile
  node: (inp: StackInput) => Node
  cpuMirror?: (w: World, id: SegId, end: 0 | 1, out: Vec3) => void   // for CPU consumers (framing, fusion)
}
```

- **One compiled program per (archetype part × material).** Features are switched with uniforms rather than `#define`s, so toggling physics, wild or focus causes no pipeline recompile or stutter. That is the owner's "everything optional" preference without hitches.
- **Species-specific looks stay CPU data** (skin, node and taper select the pool and the radius). The shader never branches on species name.

### 4.7 Materials, soft surfaces, tips

```ts
// render/materials/library.ts
export interface MaterialDef { id: string; label: string; legacyIndex?: number; make(ctx: MaterialCtx): NodeMaterial }
// MaterialCtx exposes stack outputs (position/normal/colour) so every classic (22) and dynamic (10, v17.3)
// material works on segments, nodes, leaves and soft surfaces alike (v17.3 needed a special soft path).

// render/surfaces/softSurfaces.ts — v17 (3) + v18 (10) soft species
export interface SurfaceSlot { plant: Plant; kind: SoftKind; size: number; phase: number; idx: number }
// One InstancedBufferGeometry per kind family: indexed (u,v) grid 24×16, or 32×24 for liquid/droplet.
// Per instance: vec4(root.xyz, size), vec4(phase, plantId, kindParam, 0).
// positionNode = softForm(kind, u, v, size, uSoftTime + phase, wave, energy) (TSL twin of softFormXYZ)
// normalNode   = normalize(cross(∂f/∂u, ∂f/∂v)) by central differences in the shader → smooth, fixes Liquid
// size         = CPU per plant from Σ segment length (updated on alloc/free, O(1)), not re-summed per frame
// caps         = instances are cheap: no 64-mesh cap, no 16-per-frame round-robin, no CPU vertex loop
// reference    = optional displacement term clamps xy to the source rect and follows relief (uniforms)
export interface SoftForm { id: SoftKind; grid: [number, number]; cpu(u: number, v: number, s: number, t: number, out: Float32Array): void; tsl(u: Node, v: Node, s: Node, t: Node): Node; boundsRadius(size: number): number }

// render/tips.ts — v18
export interface TipRenderer { setShape(id: TipShapeId | { image: THREE.Texture } | { obj: THREE.BufferGeometry }): void; write(tips: Iterable<Tip>, P: Params, cam: THREE.Camera): void }
```

### 4.8 Camera and framing

```ts
// camera/framing.ts
export interface Framing { target: Vec3; radius: number; up?: Vec3 }
export type FrameSubject = 'all' | 'action' | 'reference' | 'model'
export function frame(bounds: SceneBounds, subject: FrameSubject, out: Framing): Framing

// camera/modes/*.ts
export interface CameraMode {
  id: string                     // 'orbit' | 'weave' | 'tunnel' | 'drift' | 'sit' | 'chase' | 'glide' | 'tour' | 'wide'
  legacyIndex: number            // 0..8 for presets from ≤ v0.19
  label: string
  update(cam: CameraState, w: World, c: FrameCtx): void    // writes cam.posTarget / cam.lookTarget only
}
// camera/rig.ts applies, in order: mode → manual offsets (manTheta/manPhi/pan/zoomMul) → calm gate
// (v19: skips kick/shake/audio zoom) → music kick/shake → gesture parallax → lock (v17.2: pose override).
```

Calm and "Still" should become auto-frame without audio: a slow dolly and re-aim toward `frame(bounds,'action')`, which is still calm, instead of a frozen pose lock. The frozen lock stays an explicit button. That removes the "Silk grows out of frame" failure mode without bringing back audio-driven camera motion.

### 4.9 Stable ids and legacy maps

- **Species:** `id: 'roots'`. `species/registry.ts` holds the 37 legacy names in v19 order. Persisted keys become `sp.roots`. `settings.ts` migrates `sp:${i}` through that table, and `stemX` options migrate the same way.
- **Materials:** by `id`, with `legacyIndex` 0–31. **Camera modes:** `id`, with `legacyIndex` 0–8. **Cycle, shell, video and morph options:** option ids.
- **Result:** two engineers can add species, materials or modes in the same week without an index collision, and old presets and URL params keep loading.

---

## 5. Per-frame pipeline (replaces `frame()` 2274–2737)

| Phase | Systems (file) | Replaces |
|---|---|---|
| Input | `events` (note on/off → spawn/release), `referenceUpdate` (field.update + backdrop, v16 moved before events) | 2292–2304, v16 `updateReference` head |
| Spawn | `shellCycle`, `cycle`, `liveLimit`, `referenceSeed` (bounded auto-fill), `nested` (on release), `typography` | 2306–2367, v16 tail |
| Grow | `pacing` (credits), `growth` (tips: start/finish/branch; steering terms), `tunnel` respawn, `resprout`, `wild` bursts | 2369–2421, 2507–2524 |
| Constrain | inside `growth.startSegment`: `constrain/*` terms in fixed order: reference → skin → shell → bounds → nested | 1962–2014 |
| Retract | `lignify` (watermark), `retract` (release, silence decay, reverse) | 2422–2480 |
| Recycle | `recycle` (pressure → dying), `makeRoom`, plant retirement | 2430–2482 |
| Derive | `bounds.refresh` (4 Hz), `hash.rebuildIfStale`, `coverage` (skin), `surfaceSize` | 2577–2590, 1380 |
| Animate | `envelopes` (hitEnv, bassS, sustain, soft/material smoothing: one copy), `uniforms` (pulse, flash, focus, seasons, wind, sway, nerves, chroma, material clock v17.3), `modelAnim`/`morph` (+ attach offsets) | 2525–2540, 1276–1360, `dynamic-material-runtime.js` |
| Camera | `camera.rig` (+ modes, framing, calm, lock, gestures), lights, fog | 2571–2712, cinematic/calm/lock modules |
| Sync | `renderSync` (dirty → pools → ranges), plant texture, tips, soft instances, auto quality | `writeSeg`/`writeColor` everywhere, 2545–2569, 2721–2734 |
| Draw | `stageBounce.begin` → post/bloom or render → `stageBounce.end` | 871–879, `stage-motion.js` |

---

## 6. How the v0.15.1–v0.19.0 feature clusters map

| Feature cluster (version, readable module) | Lands in | CPU/GPU after | What disappears |
|---|---|---|---|
| Audio input races, speaker disconnect, onended guards (v15.1, `audio-methods.js`) | `app/inputs/audio/AudioInput.ts` | CPU (unrelated to core) | none; a straight port |
| Keyboard/visibility release, shortcut guards, F2/Tab, inert panel (v15.1) | `app/shortcuts.ts`, `app/inputs/keyboardPiano.ts` | none | none |
| Panel search, a11y, CSS (v15.1, `interface.js/.css`) | `app/panel/search.ts`, `render.ts` | none | hand-written markup is replaced by schema-driven sections |
| Safe storage, preset errors (v15.1) | `app/settings.ts`, `presets/slots.ts` | none | none |
| Reference field: generations, bilinear, portrait caps, seed density map, spread (v16/v17.1, `reference-field.js`) | `app/sources/VideoField.ts` (+ `depthTexture()` giving a 192 px R16F/RGBA texture, revisioned) | CPU analysis at ≤30 Hz, as today | none |
| Reference anchoring and live follow (v16, `reference-growth.js` `updateReference` loop) | `refUV` column (vec4 uA,vA,uB,vB, flag `Anchored`) + `render/displacement/reference.ts` (vertex texture fetch; xy from uniforms w,h; z = relief(u,v) with follow α, invert, depth) + `cpuMirror` | **GPU**. Resize, depth, invert and follow become uniform changes: zero writes | the 4000-segment × 30 Hz `writeSeg` loop, resize cursors, `referenceResizePending`, still-image dirty tracking (v17.2) |
| Reference constraints: xy clamp, stick, cliff rejection (v16/v17.1) | `systems/constrain/reference.ts` (in `startSegment`), cliff limit as a pure function | CPU | the `addSeg` wrapper and its scratch-vector anchor bug (the v17.1 root cause); anchors are taken from store columns after `alloc` |
| Reference auto-fill (v16, retuned v17.2: 0.8/s, 2 s life, ≤4 live) | `systems/referenceSeed.ts` | CPU, bounded | none |
| Backdrop plane reuse (v16) | `render/backdrop.ts` | GPU | none |
| MediaRecorder recorder, input-only tap, resolution/fps/bitrate, editor MP4, report (v17/v18, `recorder-native.js`, `recording-ui.js`) | `app/output/recorder/native.ts` + `webcodecs.ts` (v15 muxer with AudioData resample/upmix fixed: that was the actual v17 motive) + `offlineRender.ts` | none | ffmpeg conversion becomes optional rather than required |
| Capture pixel density lock (v17) | `render/renderer.ts` (`lockQuality`, `captureScale`) | none | none |
| Cinematic cameras glide/tour/wide, Shift+middle pan (v17, `cinematic-camera.js`) | `camera/modes/{glide,tour,wide}.ts`, `camera/rig.ts` | CPU O(1) | the 512-segment sampling in wide (uses `bounds.all`) |
| Camera lock (v17.2), calm camera and Still/Gentle/Manual (v19, `calm-camera.js`) | `camera/rig.ts` (lock = last override; calm = gate flag), `app/panel/views/simple.ts` | CPU | the `clear()` save/restore wrapper; camera state lives in `World.cam` and `clear` does not reset it while locked |
| Soft species Liquid/Silk/Wave (v17) + 10 forms (v18) (`soft-growth.js`, `soft-species-extra.js`) | `species/soft.ts` (data), `render/surfaces/*` (instanced TSL), plant flag `Surface` hides the skeleton in the shader | **GPU** | CPU vertex loops, `computeVertexNormals` (faceting), the 64-mesh and 16/frame caps, the `writeSeg` growth=0 wrapper, per-plant materials (`syncSoftMaterial`) |
| Soft motion controls softWave/React/Speed (v17) | uniforms in `surfaces` | GPU | none |
| Music-led pacing, fractional credits (v17.2 `segmentAllowance`) | `systems/pacing.ts` | CPU O(1) | none (the existing test ports directly) |
| Music focus, fresh trail, cyan tips on top (v17.2 `focusLevel`, `refreshMusicFocus`) | `render/color/focus.ts`: `fresh = 1 − (uTime − born)/trail`, `Auto` flag excluded; tips `depthTest` toggle in `tips.ts` | **GPU** | the 800/frame `writeColor` sweep, the plant.color swap wrapper, full colour uploads |
| Budget throttle removed (v17.2) | `systems/growth.ts` (no pressure multiplier) + `recycle.ts` | CPU | none |
| 10 animated materials + speed/scale/react (v17.3, `dynamic-materials.js`, `-runtime.js`) | `render/materials/dynamic.ts` (ids, legacy 22–31), clock uniforms from the Animate phase | GPU | the special soft-material ownership path (surfaces use the same material library) |
| Screen bounce (v18, `stage-motion.js`) | `render/stageBounce.ts` (projection-offset approach kept as is: it is sound) | CPU O(1) | its sampling of 384 segments and allocations (uses `bounds.all` projected: 8 corners) |
| Tip shapes, image/OBJ markers (v18, `tip-shapes.js`) | `render/tips.ts` + `app/panel/quick/tips.ts` | CPU ≤200 records | the `syncTipShape` capacity-replacement detection (the tips mesh is no longer rebuilt by `buildMeshes`) |
| Simple mode, 6 looks, Surprise, sensitivity (v19, `simple-ui.js`) | `app/presets/looks.ts` (data), `app/panel/views/simple.ts`; the sensitivity setting belongs to AudioInput | none | the direct `Zt.get('e:organism:…')` pokes are replaced by `params.set` with ids |
| Convert-for-Resolve helper, launch.py (v18/v15.1) | `scripts/` (not the app) | none | none |

Not changed by this design: the other four engines and the MediaPipe gestures pipeline (only `setGesture` feeds `camera/rig` and the `repel` steering term).

---

## 7. Migration: each step ships a working app

The rule: every step ends with `yarn build` green, the single-file HTML working offline, golden traces within tolerance, and the Playwright smoke passing on WebGPU and WebGL2. Steps M3–M5 keep `?core=legacy` as an A/B escape hatch until M11.

| Step | Work | Behaviour change | Exit criteria |
|---|---|---|---|
| **M0: safety net** (≈2–3 d) | vitest; `core/rng.ts` (default is Math.random-equivalent, seedable via `?seed=`); replace the two `performance.now()` calls in the engine with sim time; headless engine mode (skip `WebGPURenderer` in `mount`, keep three core objects); **golden trace** recorder (per frame: seg count, plant count, Σa checksum, bounds); Playwright smoke that loads `dist` single-file in Chrome (WebGPU), Chrome forced WebGL2 and Firefox, plays a scripted chord, screenshots, and asserts no console errors and non-black coverage; perf counters (`uploadBytes`, `writeSeg` calls, frame ms) in the HUD (`?debug=1`) | none | baseline traces and screenshots committed; measured upload bytes confirm or refute §1.1 |
| **M1: pure extractions** (≈2 d) | Move `SPECIES`/`mutate` → `species/`, `chordName` → `typography`, control list + `GROUP` → `controls.ts`, `smoothNormals` → `shell/`. Split `main.ts` into `app/*` (settings, engines, panel, shortcuts, hud, inputs). Start the parallel app-shell port (v15.1 audio/keyboard/search/storage) | none | traces identical; organism.ts < 2300 lines; main.ts < 300 lines |
| **M2: params snapshot** (≈1 d) | `ctl(this.controls,'x')` → `this.P.x` in hot paths; control schema supports stable ids + `legacyIndex`; settings migration for `sp:i` → `sp.<id>` (read both, write both for one release) | none | traces identical; frame CPU down (measured) |
| **M3: SegmentStore + pools + TSL segment shader** (≈4–6 d) | `Seg` objects gain `id` and store their data in the SoA columns (they become thin: `a/b` getters read columns into scratch vectors; hot paths are migrated to read columns directly). `writeSeg`/`writeColor` → `store.markDirty(id)`. `renderSync` + `pools.ts` + `segmentNode.ts` replace the six InstancedMeshes; legacy path kept behind `?core=legacy` | intended none. Minor: segment twist differs from `setFromUnitVectors` (octahedral crystals rotate about their axis; cubes stay segment-aligned) | screenshot diff within tolerance (visual review of crystal and cube nodes); upload bytes < 100 KB/frame steady; FPS ≥ legacy on the weakest target laptop |
| **M4: plant texture + colour stack** (≈2–3 d) | Colour from the plant texture; seasons as a uniform HSL shift (delete the all-segment recolour at 2175); dying flag; **port v17.2 music focus** as a shader term; **port v17.2 pacing** (credits) and the removal of the budget throttle | music focus and pacing arrive (v17.2 parity) | `test-music-focus` assertions ported (credit pacing 30/60/120 fps, background fill not "fresh") |
| **M5: displacement and radius stacks + reference** (≈4–5 d) | `deform()` → `sway`, `physics`, `nerves`, `wildPulse` shader terms (delete the 25k CPU loop); attach → plant offset; **port v16/v17.1 reference**: `VideoField.ts` (parallel stream B can have it ready), `refUV` column, relief texture, `cpuMirror`, constraints, `referenceSeed`, backdrop | v16/v17.1 parity. Physics/wind now apply to **every** segment every frame (today: strided halves beyond 25k): smoother | `test-reference` / `test-seeding` assertions ported (bilinear, invert, bounds, cliff rejection, seed coverage 144 cells); GPU readback test: a vertex at a known UV lands at relief z ± ε |
| **M6: spatial hash, bounds, lignify watermark** (≈3 d) | Replace `nearestEndpoint`, the `finished` filter, camera loops, `indexOf/splice`; `SceneBounds` with soft and reference bounds; **port cameras** v17 (glide/tour/wide), v17.2 lock, v19 calm/Still/Gentle/Manual on `camera/` | v17/v17.2/v19 camera parity; framing now includes the reference and soft bounds | hash `nearest` == brute force (property test); traces: fusion events within ±2 % (RNG consumption order is kept) |
| **M7: systems split** (≈3 d) | `frame()` body → `systems/*` + `pipeline.ts`; `FEATURES` registry; organism.ts becomes `index.ts` facade | none | traces identical; the facade holds no growth logic |
| **M8: Seg objects → ids** (≈3–4 d, one engineer, one PR) | `Tip.seg: SegId`, `plant.segs: IdList`, delete the `Seg` interface and getters; tips lose `THREE.Vector3` fields | none | traces identical; zero allocations per frame in steady growth (Chrome heap sampling) |
| **M9: soft surfaces on GPU** (≈4 d) | Port v17 + v18 soft species as instanced TSL surfaces with smooth normals; `Surface` flag hides the skeleton; the soft size is kept incrementally | v17/v18 parity, **Liquid no longer faceted**, no 64-surface cap | forms test: CPU twin finite and bounded (port `test-motion`); screenshot review of all 13 forms |
| **M10: tips, bounce, materials, Simple UI** (≈3–5 d, parallel) | v18 tips/bounce, v17.3 dynamic materials in the library, v19 Simple mode/looks/Surprise on the schema panel | v18/v17.3/v19 parity | `test-stage-tips`, `test-dynamic-materials`, `test-consolidation` ported |
| **M11: remove legacy, release v0.20** | Delete `?core=legacy`, retune defaults for the new cost envelope (see §10) | defaults | full browser matrix + ffprobe recording checks |

Recording (v15 WebCodecs repair, v17 native fallback, v18 editor MP4, offline render) is independent of the core. It can run from M1 onwards in parallel; `offlineRender` needs M0's SimClock and Rng.

**Ordering rationale.** Features that rewrite segments (focus, reference follow, soft, attach, deform) are ported **after** the store and shader exist (M3–M5, M9), so they are written once, as shader terms, instead of first being ported as CPU loops. Features that don't touch segment data (audio, keyboard, panel, recording, VideoField analysis, camera-mode math, Simple looks) are ported **immediately and in parallel** from M1.

---

## 8. Parallel porting: hotspots and how to avoid them

### 8.1 Current hotspot files

| File | Why it conflicts | Mitigation |
|---|---|---|
| `engines/organism.ts` (2790 lines, one class) | Every feature edits `frame()`, the `controls` literal, `writeSeg`, `newPlant` and `clear`. | M1 extractions and M7 systems split. After M7 a feature touches only its own directory plus one line in `features.ts`. Until M7, **one owner** merges changes to this file. Everyone else lands code in new files that the owner wires in. |
| The `controls` array literal (367–445) | Every feature appends controls. | Each feature declares `controls` in its module; `params.ts` aggregates them. Section order comes from `group` + `GROUP_ORDER`, not from array position. |
| `SPECIES` order and `sp:${i}` keys | Appending species collides on index. | Stable ids + legacy table (§4.9). `species/soft.ts` and `rigid.ts` are separate files. |
| `GROWTH_SHADERS` array (`shaders.ts`) | Index-positional. | `materials/` registry keyed by id, one file per family. |
| `frame()` phase ordering | Everyone inserts "before X / after Y". | `Phase` + `order` numbers; `pipeline.ts` sorts. Reserve order bands per stream (e.g. reference 200–299, camera 600–699). |
| Segment shader graph | Everyone wants to add displacement or colour. | `stacks.ts` registration + `stackOrder.ts` constants (owned by core). A feature adds a file in `render/displacement/`, never edits `segmentNode.ts`. |
| SoA schema | New columns. | `store.defineColumn` from the feature (namespaced names). The core schema (§4.1) is frozen after M3. |
| `main.ts` (1174 lines) | All UI wiring and loop. | Split in M1 into `app/*`. The `loop.ts` hook list is append-only. |
| `index.html` panel markup (v19: 356 lines, 102 ids) | v16–v19 hand-wrote quick panels. | Generate sections from the schema; quick panels are TS modules under `app/panel/quick/` that mount into one placeholder each. `index.html` keeps only static shell markup. |
| Settings keys / localStorage | Migrations from several streams. | `settings.ts` holds a single `MIGRATIONS` array (append-only, versioned). |

### 8.2 Suggested workstreams (after M3; before that only A works on the core)

- **A. Core** (store, pools, shader, stacks, pipeline, M8): 1 engineer, owns `data/`, `render/pools|segmentNode|stacks|stackOrder`, `pipeline.ts`, `features.ts`.
- **B. Reference:** `sources/VideoField.ts` from M1; `systems/referenceSeed`, `constrain/reference`, `displacement/reference` from M5; `panel/quick/reference.ts`.
- **C. Soft surfaces + materials:** `species/soft.ts`, `render/surfaces/*`, `render/materials/*`.
- **D. Camera + framing + bounce:** `camera/*`, `data/sceneBounds.ts` consumer side (A provides the interface in M3 as a stub that does full loops, and D swaps in the incremental version).
- **E. App shell:** `app/inputs/*`, `shortcuts`, `panel/*`, `presets/*`, `settings` (v15.1, v19 Simple).
- **F. Output:** `app/output/*` (WebCodecs repair, native fallback, offline render).
- **G. Music-feel:** `pacing`, `color/focus`, `radius/*` (chroma throb), `render/tips.ts`, defaults tuning with the owner.

Merge rules:

- Each PR touches one stream's directories, plus at most one line in `features.ts` and at most one `MIGRATIONS` entry.
- Interface changes to `World`, `SegmentStore` or `stacks` go through stream A with a short design note.
- Golden traces are re-baselined only in PRs labelled `rebaseline`, with before/after screenshots attached.

---

## 9. Testing strategy

1. **Unit, node (vitest):**
   - `SegmentStore` property tests with fast-check. Random alloc/free/markDirty sequences must hold these invariants: `slotOf`/`segAt` bijection, `count` equals live ids, each plant's `segs` equals the ids whose `plant` column points at it, dirty ranges cover every changed slot, and nothing outside capacity is touched.
   - `SpatialHash.nearest` equals brute force over 10k random points.
   - `SceneBounds` agrees with brute force within ε after random churn.
   - `pacing` credits: port `test-music-focus` (19–20 starts in 4 s at 5/s for 30/60/120 fps; stall capping).
   - VideoField: port `test-reference` / `test-seeding` (bilinear, invert, portrait caps, generations, 144-cell coverage).
   - Soft forms: the CPU twin is finite and bounded for all 13 kinds at random t; port `test-motion`.
   - Settings migrations: `sp:i` → `sp.<id>`, shader and camera index → id.
2. **Simulation goldens (headless World, seeded Rng, scripted MusicState):**
   - Scripts:
     - Three notes held 2 s (the lead's case).
     - A 16-bar MIDI groove.
     - A 5-minute dense run at the budget limit.
     - A reference still with auto-fill.
     - Skin on a sphere.
     - Nested + text.
   - Recorded per frame: segment/plant counts, bounds, fusion events, Σ positions.
   - **Musical-response assertions**, which encode the owner's complaints as tests:
     - Segments added within 250 ms of a note-on ≥ N (per look).
     - Growth rate in the 1 s after a hit ≥ k × the rate in silence.
     - After note-off, non-permanent growth retracts within the expected time.
     - **No stall**: at the budget limit, spawn rate never stays at 0 for more than 1 s while notes are held.
     - Camera framing: ≥ 95 % of active tips project inside the frustum (per camera mode, including Still/calm).
3. **GPU correctness (Playwright, real Chrome):**
   - Readback tests: a single segment with known a/b/r renders where expected (pixel probe); reference relief displacement matches `cpuMirror`; hidden and `Surface` instances produce no pixels.
   - Both backends: Chrome WebGPU and Chrome forced WebGL2 (`forceWebGL` URL flag).
   - Firefox and Safari run WebGL2 smoke only.
4. **Visual regression:** deterministic screenshots per look (6 v19 looks + all 13 soft forms + 32 materials). Diff tolerance is loose, because GPU rasterisation differs; the stable checks are non-black coverage, bounding box and colour histogram. Visual review by the owner is required for re-baselines.
5. **Performance budgets (Playwright + CDP):** 60k segments with physics + focus + reference follow. Assertions: frame CPU ms (systems timed with `performance.mark`), `uploadBytes` < 100 KB/frame steady-state, and zero per-frame JS allocations in steady growth (heap sampling). Run at `quality 0.75` on the CI GPU and on the owner's weakest laptop manually before a release.
6. **Recording:** Playwright triggers a 10 s recording of a scripted performance and saves the download; `ffprobe` asserts moov-before-mdat, H.264 High + AAC, even dimensions, CFR (`r_frame_rate == avg_frame_rate`), and an audio stream present. This was the owner's recurring complaint, and v17/v18 never verified it on real files.

---

## 10. What the owner gets, in plain terms

- **More growth for the same laptop.**
  - Removing about 27 MB/frame of uploads and the O(n) and O(n·m) CPU loops (estimate; M0 measures it) means the default `budget` and `fillRate` can be raised a lot without losing frame rate.
  - A suggested starting point to validate in M11: 120k budget, `fillRate` 1500–3000, auto-quality unchanged.
  - Currently v19's curated looks cap starts at 240/s (`simple-ui.js` base) and `musicAmount` at 0.42, which is why three held notes only grew about 300 segments in 2 s.
- **Music reactions become free for every segment.** Pulse, flash, focus trail, physics and sway run everywhere with no CPU cost. A new reaction becomes one shader file. Example: **per-plant chroma throb**, where each organism swells with the loudness of its own pitch class. `MusicState.chroma` already exists, and each plant's pitch class is in the plant texture.
- **Soft species look like what they are named.** Smooth-shaded liquid and silk, no 64-surface cap, and they stay in frame.
- **Offline CFR re-render** (optional, after M0 + F): record the performance as an event log plus the source audio, then re-render deterministically at exact 30/60 fps and any resolution through WebCodecs. The files open cleanly in QuickTime, Finder Quick Look, VLC and Resolve, even if the live frame rate dipped.

---

## 11. Honest cons and risks

1. **Duplicate math (TS + TSL).** Every displacement that a CPU consumer must agree with (reference relief, attach, soft bounds, physics for framing) exists twice. That brings a risk of drift, which is covered by `cpuMirror` + GPU readback tests, but it is ongoing tax. Most CPU consumers read **rest** positions, so wind and sway are not mirrored. As a consequence, fusion and attraction ignore visual sway, which is identical to today's behaviour.
2. **Harder to debug and to "vibe edit".** A TSL node graph plus SoA indices is less approachable than `seg.a.add(d); writeSeg(seg)`. The owner, or a future assistant without GPU access (as happened for v16–v19), can no longer patch visuals with plain JS on objects. Compile errors in TSL surface at first render. Mitigations: `cpuMirror` functions double as documentation, a `?core=legacy`-style debug view that draws CPU rest positions, and the Playwright smoke in CI.
3. **Shader compile stalls.** Programs per (archetype part × material) mean up to about 12 pools × 3 parts × 32 materials in theory. Only the pairs actually used get compiled, but switching materials or looks mid-set can hitch on first use (WebGPU pipeline creation). A warm-up pass on look selection is needed, and so is a rule that features toggle by uniform, never by `#define`.
4. **WebGL2 limits.** No storage buffers or compute. The design stays within 16 vertex attributes and vertex texture fetch. The plant texture needs float textures (RGBA32F is renderable/uploadable in WebGL2; linear filtering is not needed because of `textureLoad`). The reference relief needs manual bilinear (four `textureLoad`s) or an R16F texture. Safari/Firefox performance isn't validated until M0's browser matrix runs.
5. **The M3 visual delta.** The shader basis twist differs from `Quaternion.setFromUnitVectors`, so crystals and cube nodes rotate about their segment axis compared with v0.15–v0.19. This is unlikely to matter artistically, but screenshots won't match pixel-for-pixel, so golden images must be re-baselined by eye once.
6. **M8 is a single-owner step.** Converting `Seg` objects to ids touches all growth code at once. It can't be parallelised and it blocks other core-touching PRs for a few days. It could be skipped: `Seg` objects can survive as thin views with a small allocation cost, keeping about 80 % of the benefit.
7. **Growth is not GPU-driven.** The branching simulation is still CPU and single-threaded. Past roughly 1–2k simultaneous tips, CPU becomes the limit again. A Worker-based simulation (SoA columns in SharedArrayBuffer) is a natural follow-on that this layout enables. But SharedArrayBuffer needs cross-origin isolation, which a `file://` single-file HTML **can't** have. So the fallback is transferable buffers, with extra latency, and that is honestly awkward for the offline single-file constraint.
8. **Swap-remove reorders instances.** That is irrelevant for opaque surfaces. If translucent materials are ever added, draw order is no longer stable (it isn't sorted today either).
9. **Delivery time.** Roughly 30–40 engineer-days for M0–M11, with parallel streams bringing calendar time to about 2–3 weeks for 3–4 engineers (rough estimate). The pure "port v19 onto the old class" alternative is faster to v19 parity (no M3–M9). But it inherits every CPU loop and the wrapper stacking, and it would be refactored later anyway.
10. **Defaults and product feel are not fixed by architecture.** Calm defaults, the Still-camera lock and restrained looks are product decisions. This design makes bolder defaults affordable and adds auto-framing; it doesn't choose them. Tuning with the owner (stream G) is still required.
11. **Updates depend on three's `updateRanges` behaviour.** Verified in r185.1 for both backends (`WebGPUAttributeUtils.js:225-243`; the WebGL `bufferSubData` per range appears in the bundle). A three upgrade could change this, so the `uploadBytes` perf test guards it.

---

## 12. Decisions needed from the owner or lead

1. Accept a one-time visual re-baseline at M3 (crystal/cube twist, slightly different lathe normals)?
2. Replace the frozen Still camera with calm auto-framing (still no audio motion), keeping the lock as an explicit button?
3. Persist species, materials and camera modes by id from v0.20 (one-way migration of ≤v0.19 presets)?
4. Add offline CFR re-render as the "guaranteed editor-safe" recording path, keeping live recording as is?
5. Budget and `fillRate` defaults to target after M11: measure on the owner's weakest laptop first.
