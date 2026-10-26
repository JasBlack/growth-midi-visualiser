# A4 audit: other engines, shaders, build and release, test setup

Scope: `src/midi/engines/{reactionDiffusion,branching,cells,crystal3d}.ts`, `src/midi/shaders.ts`,
`scripts/release.mjs`, `scripts/vendor.mjs`, `vite.config.ts`, `tsconfig.json`, `package.json`, `README.md`
(TS repo `C:\Users\User\Desktop\code\growth-midi-visualiser`, tag v0.15.0). I also covered shared code these
modules depend on (`engine.ts`, `presets.ts` Morph, the `widget()` setter in `main.ts`), plus the v19 soft-mesh
geometry, because it explains the lead's "Liquid looks faceted" observation.

v19 status: none of the `maintenance/*.py|*.js` patches touch the four secondary engines, `shaders.ts`'s ENV/GROWTH
tables or the release script. I grepped for voxel, Gray-Scott, uSeeds, mitosis, fork rate, kaleido, symmetry and hash
and got no hits. Everything below is still present in v19 unless a finding says otherwise.

Ground truth used: three `0.185.1` in `node_modules` (source checked for `transformNormal`, `NodeMaterial.setupPosition`,
TSL `hash`), `dist/` + `growth-visualiser-v0.15.0.zip` present in the TS repo (entry listing checked with `unzip -l`).

---

## Findings (most severe first)

### F1 [HIGH · design/build] The shipped product (v0.19.0) cannot be rebuilt from source. The release pipeline is pinned to one minified bundle
- **Where:** `scripts/release.mjs` (whole file); `C:\Users\User\Downloads\growth-v0190\maintenance\patch_release.py:24-26`
  (`expected = "287c8ed6…"` sha256 of `assets\index-BWYXfAkm.js`, read with a **backslash** zip path); `package.json:4` (`"version": "0.15.0"`).
- **Scenario:** Any TS change (for example fixing F3) produces a new bundle hash. Then every v19 `patch_*.py` refuses to apply
  (`once()` raises on 0 matches, and the sha check fails), so a v0.20 can come either from TS without v0.15.1–v0.19 features
  or from the bundle without source fixes. Also, the v19 folder is not a git repo (`fatal: not a git repository`).
- **Evidence:** the patch scripts do exact-string replacement on minified names (`tw`, `G`, `pd`, `Hi` …). The TS repo has no
  test, lint or CI step (package.json scripts: dev/build/preview/vendor).
- **Fix:** Make TS the only lineage again. Port each v19 module (`maintenance/*.js` is readable JS) into typed TS modules
  under `src/midi/features/…`, using the name map to find anchors. Tag v0.20.0 from git, and have `release.mjs` embed
  `git describe --dirty` into `version.ts` / the HTML `<meta name="build">`. Fail the release on a dirty tree or when
  `package.json.version !== VERSION`. Keep `maintenance/test-*.cjs` scenarios as vitest specs (see Test plan).

### F2 [HIGH · bug/build] The Windows-built release zip breaks the folder version on macOS (backslash entry names, no exec bit)
- **Where:** `scripts/release.mjs:60-61` (`powershell … Compress-Archive -Path 'dist\*'`).
- **Scenario:** The owner builds on Windows and opens the release on a Mac. Windows PowerShell 5.1's `Compress-Archive` writes
  entry names with `\`. macOS `unzip`/Archive Utility then create flat files literally named `assets\index-BWYXfAkm.js`,
  so `index.html` → `./assets/index-*.js` returns 404 and the "B) folder + server" path (the only one with gestures)
  shows a blank page. `start-mac.command` also loses its executable bit (zip made on Windows has no unix mode), so
  double-clicking it fails even though the README says "double-click".
- **Evidence:** `unzip -l growth-visualiser-v0.15.0.zip` →
  `assets\index-BWYXfAkm.js`, `mediapipe\models\face_landmarker.task`, … (every entry uses backslashes). The v19 patcher
  even depends on it (`source.read("assets\\index-BWYXfAkm.js")`).
- **Fix:** Zip in Node with forward slashes and unix modes. For example `fflate`'s `zipSync` with
  `{ 'start-mac.command': [bytes, { os: 3, attrs: (0o100755 << 16) }] }`, or `tar -a -cf x.zip -C dist .`
  (bsdtar on Windows 10+ writes `/`). Add a release self-check that re-opens the zip and asserts no entry contains `\`
  and that `start-mac.command` has mode 0755.

### F3 [HIGH · bug] Crystal 3D: changing *voxel shape* or *voxel gap* wipes the crystal visually, and a preset morph or MIDI CC does it every frame
- **Where:** `src/midi/engines/crystal3d.ts:97-125` (`buildMeshes`), `:152-155` (`setControl`), `:244`;
  `src/midi/main.ts:195-202` (`widget().set` always calls `onChange`), `:517-532` (preset queue); `src/midi/presets.ts:50-58` (`Morph.tick`).
- **Scenario:**
  1. Grow a crystal, then move *voxel gap* by one step. `buildMeshes()` creates a brand-new `InstancedMesh` whose
     `instanceMatrix` is identity on WebGL (`InstancedMesh` ctor) or all-zero on WebGPU
     (`new StorageInstancedBufferAttribute(new Float32Array(MAX*16))`). `setColorAt(0)` also allocates a fresh all-white
     `instanceColor`. `this.count` is kept (`syncCount`), so the result is N degenerate/invisible voxels (WebGPU) or N white
     cubes stacked at the origin (WebGL). `occ`/`pos` still claim the voxels exist, so new growth attaches to invisible voxels.
  2. `gap` has `step 0.02 < 1`, so `loadPreset` routes it through `Morph`. `Morph.tick` calls `apply()` **every frame for 2 s,
     even when from === to**, and `widget.set` calls `onChange → engine.setControl('gap')` unconditionally.
     That is ~120 rebuilds of 8 × `InstancedMesh(MAX = 14000)` (8 × 896 KB matrix arrays plus pipeline work) on every
     preset load in Crystal. The same happens for every MIDI CC message mapped to *gap*.
  3. Old meshes are removed from the group and their geometry disposed, but `InstancedMesh.dispose()` is never called, so the
     GPU instance buffers of the 7 replicas plus the main mesh are never released → a GPU memory leak per rebuild.
- **Fix:** Don't recreate meshes. Swap geometry only:
  `const g = this.geometry(); for (const m of this.meshes) { m.geometry = g }; old.dispose()`.
  Keep `appliedShape`/`appliedGap` in the engine and early-out when unchanged. Comparing against the control value is not
  enough, because `widget.set` has already mutated `c.value` (same object) before `setControl` runs. Debounce geometry swaps
  to at most one per 100 ms. In `Morph.tick` skip keys whose `from === to`. In `widget.set` skip `onChange` when
  `n === c.value` before the assignment.

### F4 [HIGH · bug · cross-scope, v19] "Liquid" renders faceted because the soft mesh is non-indexed and normals are recomputed flat
- **Where:** `growth-v0190/maintenance/soft-growth.js:32` (`plant.sp.soft==='liquid'?new kp(1,2):new Up(1,1,24,16)`),
  `:72` (`computeVertexNormals()` at 15 Hz). In the bundle `kp` = `IcosahedronGeometry`
  (`class kp extends Wx{constructor(e=1,t=0){const s=(1+Math.sqrt(5))/2…`).
- **Scenario:** `IcosahedronGeometry(1, 2)` is a non-indexed `PolyhedronGeometry` (320 separate triangles, no shared
  vertices). `computeVertexNormals()` on a non-indexed geometry produces one normal per face, so the deformed droplet shades as
  a 320-facet low-poly blob. This is exactly what the lead saw ("faceted low-poly blobs, flat-looking normals, low
  subdivision"). Normals also update at 15 Hz while positions update at 30 Hz, so lighting lags the wobble by up to one
  geometry step.
- **Fix:** Use an indexed sphere: `BufferGeometryUtils.mergeVertices(new IcosahedronGeometry(1, 5))` (≈10 k verts) or
  `new SphereGeometry(1, 64, 48)`, with detail picked by the quality tier. Compute normals analytically from the radial
  deformation, or at least call `computeVertexNormals()` on every geometry update (it is cheap on an indexed mesh). Add
  `MeshPhysicalNodeMaterial` with `transmission`/`clearcoat` and a fresnel rim so it reads as liquid. The TS port should live in
  `src/midi/engines/soft/` with the geometry factory unit-tested (index !== null).

### F5 [MEDIUM · bug] `reactify` pulse cracks flat-shaded meshes open on every bass hit
- **Where:** `src/midi/shaders.ts:56-63` (`positionLocal.add(normalLocal.mul(uPulse))`). It is applied in `organism.ts:678-693`
  to the `BoxGeometry` node cubes, the `OctahedronGeometry(1,0)` crystal shards, and `IcosahedronGeometry(1, blob)` where
  `blob = 0` once `cap > 50000` (`organism.ts:673`).
- **Scenario:** three's `NodeMaterial.setupPosition` runs instancing first and then `positionNode`
  (`node_modules/three/src/materials/nodes/NodeMaterial.js:796-805`). `transformNormal` normalises (`Normal.js:164-170`), so each
  vertex moves `uPulse` along its **own face normal**. Box faces and detail-0 polyhedra have per-face (unshared) vertices,
  so the faces separate and black slits open along every edge on each kick. `uPulse` peaks around
  `0.12·pulse·react·(0.7·bass+0.8·hit)`, which is large relative to thin shard radii. Once the segment budget passes 50 k, the
  joint spheres switch to detail 0 and start cracking too.
- **Fix:** Displace along a smooth direction. Add a per-geometry attribute `pulseDir` (normalised position for
  centred primitives, or normals from `mergeVertices(geom.clone()).computeVertexNormals()` transferred back), then
  `positionLocal.add(transformNormal(attribute('pulseDir'), instanceMatrixNode).mul(uPulse))`. Cheaper alternative:
  `reactify(m, { pulse: false })` for flat-shaded materials and pulse those through instance scale in the existing
  per-frame write. Also: `IcosahedronGeometry(1,0)` joints at high caps look like the "faceted blobs" complaint. Use
  detail ≥ 1 with `mergeVertices`, which gives 42 verts, still cheap.

### F6 [MEDIUM · bug] Sky shaders compute direction from the world origin, but the sky sphere follows the camera, so the sky swims and the horizon tilts
- **Where:** `src/midi/shaders.ts:220, 235, 247, 258, 273, 286` (`const d = normalize(pw)`, where `pw = positionWorld`);
  `organism.ts:2541` (`this.sky.position.copy(this.camPos)`); sky radius 180 (`organism.ts:809`).
- **Scenario:** With the camera at, say, (0, 2, 40) (typical orbit distances), a sky fragment's world position is
  `camPos + 180·dir`, so `normalize(pw)` is off by up to ~13°, and the error changes as the camera orbits. Stars, the nebula
  and the aurora slide relative to the true view direction, and the *grid horizon* line (`step(d.y, 0)`) rises and falls and
  tilts as the camera moves, which reads as a bug rather than an "infinite" backdrop.
- **Fix:** `const d = positionLocal.normalize()` (the sky mesh is unrotated and centred on the camera), or
  `positionWorld.sub(cameraPosition).normalize()`.

### F7 [MEDIUM · bug] *starfield*: `hash()` of negative seeds collapses to one value, so about half the sky has no stars
- **Where:** `src/midi/shaders.ts:221-223` (`cell = floor(d.mul(420))`, `hash(dot(cell, vec3(1, 57, 113)))`);
  TSL `hash` = `seed.toUint()…` (`node_modules/three/src/nodes/math/Hash.js:15`).
- **Scenario:** `dot(cell,(1,57,113))` is negative for most directions with z < 0 (and many with y < 0). `f32 → u32` is
  saturating in WGSL (every negative seed becomes 0) and undefined in GLSL ES. So every negative cell gets the same
  `hash(0)`, which is below 0.996, and roughly one hemisphere is empty. With orbiting cameras the stars "switch off"
  behind the organism.
- **Fix:** Offset into the positive range: `hash(dot(cell.add(512), vec3(1, 1031, 1031*1031 % 65521)))`, or hash each
  component: `hash(cell.x.add(512).add(cell.y.add(512).mul(1024)).add(cell.z.add(512).mul(1048576)))`. Also give stars a
  soft disc (`smoothstep` on distance to the cell centre) to stop the pixel-shimmer when the camera rotates.

### F8 [MEDIUM · bug] A failed engine mount leaves an orphan canvas and a black stage. Recording then captures the orphan
- **Where:** `src/midi/main.ts:245-278` (`selectEngine`: `engine?.unmount(); engine = null; … await e.mount(stage)`, and
  `catch` only calls `setStatus`); `reactionDiffusion.ts:162-169` (appends the canvas, then throws `'WebGL2 unavailable'` /
  `'EXT_color_buffer_float unavailable'`); `crystal3d.ts:65-71` (appends the canvas, then `await renderer.init()` can reject);
  `main.ts:784-786` (`stageCanvas()` falls back to `stage.querySelector('canvas')`).
- **Scenario:** In Safari/iOS or OBS's CEF without `EXT_color_buffer_float`, choosing Reaction–diffusion leaves the RD canvas
  in `#stage`, with no engine and the previous engine already unmounted, so the screen stays black. If the user then picks
  Branching, the new canvas is appended **after** the orphan. `stage.querySelector('canvas')` returns the orphan, so
  *record* and *still* capture a dead canvas, and the orphan also covers the stage on the z-axis.
- **Fix:** In `catch`: `try { e.unmount() } catch {}`, and remove any stray `stage > canvas` that isn't `e.canvasEl?.()`.
  Then re-select the previous engine id, or `organism`, with a visible banner. In the engines, create the context before
  appending the canvas. Give every engine `canvasEl()` so `stageCanvas()` never guesses.

### F9 [MEDIUM · bug] No GPU device-lost or context-lost recovery in any engine
- **Where:** `crystal3d.ts:69`, `organism.ts:579` (WebGPURenderer), `reactionDiffusion.ts:166` (raw WebGL2). A search for
  `device.lost|onDeviceLost|webglcontextlost` in `src/` returns nothing.
- **Scenario:** A laptop sleeps and wakes mid-gig, a Chrome GPU process crashes, or the driver resets on a weak iGPU under
  load. WebGPU's `device.lost` resolves, or WebGL fires `webglcontextlost`. Every frame after that renders nothing, and
  `loop()` keeps calling `frame()` into a dead context. The only recovery is a page reload, which loses settings that
  aren't saved yet and a take that is recording.
- **Fix:** For WebGPU, set `renderer.onDeviceLost = (info) => host.dispatchEvent(new CustomEvent('gpu-lost', { detail: info }))`.
  For RD, add `canvas.addEventListener('webglcontextlost', e => e.preventDefault())` plus `webglcontextrestored` → rebuild
  programs/FBOs. In `main.ts`, on `gpu-lost` call `selectEngine(engine.id)` (a fresh instance) and stop or roll over the
  recorder with a status message.

### F10 [MEDIUM · bug] Crystal 3D fades to black as it grows (fixed FogExp2 density versus a camera distance that scales with size)
- **Where:** `crystal3d.ts:74` (`new THREE.FogExp2(0x000000, 0.012)`), `:297` (`dist = ((radius + 3) * 2.3) / zoomNow`).
- **Scenario:** Fog factor = `1 − exp(−(0.012·d)²)`. Radius 20 → d ≈ 53 → 33 % fogged. Radius 35 → d ≈ 87 → 66 %.
  Radius 50 → d ≈ 122 → 88 %. At the ±60 voxel bound the whole structure is near-black, so the longer you play, the less
  you see (the owner's "growth must visibly follow the music").
- **Fix:** `fog.density = 0.55 / dist` each frame (constant relative haze). Alternatively fog only the far half of the
  crystal: `Fog(near = dist − radius·0.2, far = dist + radius·1.5)`.

### F11 [MEDIUM · perf] Crystal 3D: per-frame whole-structure rebuild of the occupancy map with string keys, and full-buffer GPU uploads
- **Where:** `crystal3d.ts:157-159` (`` `${x},${y},${z}` `` keys), `:185-201` (`removeOldest` rebuilds `occ` for all `count` voxels),
  `:277-280` (decay calls `removeOldest(n)` every frame while nothing is held), `:176-177` & `:195-196` (`needsUpdate = true`
  on the whole 14 000 × 16 float matrix and colour buffers).
- **Scenario:** Decay 0.5, 14 000 voxels, silence. `n = floor(0.5·240/60 + rand) ≥ 2` each frame, so each frame allocates
  14 000 template strings, rebuilds a 14 000-entry `Map` and re-uploads ~1.1 MB. At 60 fps that is ~840 k short-lived
  strings/s (GC hitches on a weak laptop) and ~66 MB/s of redundant uploads. While growing, each frame also re-uploads the
  full buffers for about 7 new voxels.
- **Fix:** Key voxels by integer (`((x+64)<<14)|((y+64)<<7)|(z+64)`) in a `Map<number, number>` or a 128³ `Int32Array`
  grid (8 MB). Store a monotonic **serial** per voxel and a `base` serial, so `index = serial − base`. `removeOldest(k)` then
  only deletes k keys (no rebuild) and the frontier arrays need no remap. Use `attr.clearUpdateRanges(); attr.addUpdateRange(start*16, n*16)`
  for appends, and a single full upload only after a compaction. Batch compaction, for example compact only when 512+ are
  dead, and draw the live range via `mesh.count` plus an offset uniform.

### F12 [MEDIUM · perf] `ctl()` is a linear `Array.find` and sits in per-tip hot paths (134+ controls in v19)
- **Where:** `src/midi/engine.ts:79-82`; hot callers `organism.ts:1784-1787, 1860-1871, 1888` (`nextDir`, run per tip per step), and
  `organism.ts:1520` (`` ctl(this.controls, `sp:${i}`) `` for every species on every spawn).
- **Scenario:** 200 tips × ~8 lookups × ~85 average comparisons over ~171 controls (134 organism + 37 species toggles) is
  ~136 k string comparisons per frame. The v19 minified `G(this.controls,key)` is the same function with more controls.
- **Fix:** `const idx = new WeakMap<EngineControl[], Map<string, EngineControl>>()` with lazy build and invalidation on
  `onControlsChanged`, so `ctl` becomes a single `Map.get`. In a dev build, `console.warn` once when a key is missing,
  because it currently returns 0 silently and hides typos.

### F13 [MEDIUM · perf/UX] Reaction–diffusion has no auto-quality and uses 4-channel 32-bit float targets for 2 values
- **Where:** `reactionDiffusion.ts:135-136` (res up to 1024, steps up to 32), `:277` (`steps = speed · g.growth`, growth up to 3 → **96
  sim passes/frame**), `:200-201` (`RGBA32F`/`RGBA16F`), `:38-42` (9 taps per pass).
- **Scenario:** A weak laptop at res 1024 (16:9 → 1024×576), speed 32, growth 2 runs 64 passes × 590 k px × 9 taps, about 340 M
  fetches/frame at 16 B/texel. It drops to single-digit fps with no feedback, and there is no `lockQuality` or auto step
  reduction like organism has.
- **Fix:** Use `RG32F`/`RG16F` targets (both colour-renderable with `EXT_color_buffer_float`), which halves bandwidth. Adapt
  `steps` to measured frame time (for example cap the sim at 6 ms of GPU budget using `EXT_disjoint_timer_query_webgl2` or the
  rAF delta EMA). Reuse the `lockQuality` flag. In the show pass, fetch `texture(uState, uv).xy` once instead of twice
  (`:84-85`).

### F14 [MEDIUM · bug/UX] Cells: a sustained note swells its cell without limit, and at the 320-cell cap new notes do nothing
- **Where:** `cells.ts:141-144` (`c.target += 26 · size · growth · dt` while held, no cap, and it applies to **every** gen-0 cell of that
  pitch, including old ones from earlier presses), `:137` (`if (… && this.cells.length < cap) this.birth(...)`), `:102/108`.
- **Scenario:** A 30 s pad with growth 1 gives target +780 px. With `lighter` compositing the polygon becomes a screen-filling
  white slab. In a busy track the colony hits 320 cells and further note-ons are ignored until cells shrink, so the image
  stops following the music, which is the owner's "growth stalls at limits" complaint in another engine.
- **Fix:** Cap `target ≤ base · 0.18 · size`, and swell only the newest cell per pitch (keep `pitch → cell` in a Map on
  note-on). At the cap, evict the smallest or oldest cell (fade it out over 0.3 s) instead of dropping the birth.

### F15 [MEDIUM · perf/bug] Unbounded `symmetryNow` (auto = polyphony) multiplies draw work, and Crystal only has 8 replicas
- **Where:** `main.ts:1063-1070` (`symmetryNow = symHold = m.polyphony` when symmetry = 0); `branching.ts:158,174-185,225`;
  `cells.ts:210,216`; `crystal3d.ts:114` (7 replicas + main = 8), `:284-289`.
- **Scenario:** With symmetry set to "auto", sustain pedal down and a 12-note cluster, sym = 12. Branching then issues
  700 tips × 12 separate `beginPath/stroke` calls (8 400 strokes/frame plus 8 400 arcs), and Cells 320 × 12 × 3 path fills.
  In Crystal, `mesh.visible = i < sym` shows only 8 meshes while the rotation uses `i/sym·2π`, so with sym = 12 you get 8
  copies at 30° spacing and a 120° gap, which looks broken.
- **Fix:** `sym = clamp(round(symmetryNow), 1, 8)` inside each engine. In Branching, batch strokes: build one `Path2D` per
  colour per frame and stroke each replica with `setTransform`, which gives about 12 strokes instead of 8 400.

### F16 [MEDIUM · build/size] The release zip carries ~34 MB of unused MediaPipe WASM. The "nosimd" fallback cannot work
- **Where:** `scripts/vendor.mjs:8-14` (copies **every** file from `@mediapipe/tasks-vision/wasm` into `public/mediapipe/wasm`);
  `src/vision/engine.ts:18-20,43` (the runtime actually loads the **Vite-bundled** `?url` copies in `assets/`); zip listing
  (60 MB total).
- **Scenario:** `dist/mediapipe/wasm/*` (vision_wasm_internal.wasm 11.1 MB, vision_wasm_module_internal.wasm 11.1 MB,
  vision_wasm_nosimd_internal.wasm 10.5 MB, plus the JS glue) is never referenced, but it is shipped a second time next to
  `assets/vision_wasm_internal-*.wasm`. The zip is 60 MB where about 26 MB is needed. The nosimd *glue* is also tried as a
  fallback (`engine.ts:52`), but `WASM_FILESET.wasmBinaryPath` always points at the SIMD binary, so the fallback would load a
  SIMD binary with non-SIMD glue.
- **Fix:** Have `vendor.mjs` vendor only `models/`. If the nosimd path matters, import its `.wasm?url` and choose the pair
  together. Also `DEFAULT_ENGINE_PATHS` uses absolute `/mediapipe/models/...` (`engine.ts:34-38`), which breaks when the folder
  is served from a sub-path (the build uses `base: './'`). Use `new URL('mediapipe/models/…', document.baseURI)`. The
  `pose_landmarker_lite.task` path is referenced but never vendored. Make `release.mjs` fail if the models are missing,
  since otherwise README.txt promises gestures that 404.

### F17 [LOW-MEDIUM · UX] Crystal 3D: chords grow one note at a time (the voxel budget is spent sequentially per job)
- **Where:** `crystal3d.ts:268-275`.
- **Scenario:** A 4-note chord at velocity 1 needs 4 × 14 voxels, and the budget is `ceil(400·dt) ≈ 7`/frame. The first job
  (Map insertion order) takes all 7 each frame for 2 frames, then the next one, and so on. The chord shows as a quick
  sequence of arms rather than a simultaneous burst. Held notes add `deposit·0.5` per second to *every* job, so earlier
  pitches keep priority.
- **Fix:** Round-robin: `while (budget > 0 && anyRemaining) for (const job of jobs) if (job.remaining >= 1) { grow(job); … budget-- }`.
  Also precompute the six neighbour weights per job at creation (`grow()` allocates `weights: number[]` per attempt, `:215`).

### F18 [LOW-MEDIUM · design] Secondary engines still advertise and auto-trigger kaleidoscopic folding
- **Where:** `reactionDiffusion.ts:4-5,133` (blurb "chords fold the display into a kaleidoscope"), `:69-75,81` (`kaleido` fold),
  `branching.ts:28`, `crystal3d.ts:36`, `main.ts:1063-1070` (auto symmetry from polyphony).
- **Scenario:** The owner's hard rule is "never kaleidoscopic/uniform". The default symmetry is 1 (`main.ts:76`), so this is
  opt-in, but choosing "auto" (0) in *Shared* folds every secondary engine into N-fold radial mirror images as soon as a chord
  is played, and the blurbs present this as a feature.
- **Fix:** Rename "symmetry" to "replicate", remove the auto-from-polyphony mode (or make auto map polyphony to growth
  *density* instead of mirror folds), cap at 3, and rewrite the blurbs. For RD, replace the display `kaleido` with a gentle
  domain warp.

### F19 [LOW · bug] RD/Branching/Cells don't guard a 0-height host. RD allocates zero-sized textures and uploads `Infinity` uniforms. Any resize wipes RD/Branching
- **Where:** `reactionDiffusion.ts:184-213` (`h = round(res/aspect)`; with host height 0, `fitCanvas` gives h = 1 → aspect 1500 → h = 0),
  `:280, 312` (`1/this.simH`); `branching.ts:61-71` (clears `acc` on any size change); RD `allocSim` clears the state on resize.
- **Scenario:** An OBS browser source that starts at 0×0, a minimised window, or entering performance mode/fullscreen. RD
  logs `GL_INVALID_FRAMEBUFFER_OPERATION` until the host has a size. Entering fullscreen wipes the whole RD pattern and the
  Branching accumulation, while Organism/Crystal skip `w < 2 || h < 2` and keep their state.
- **Fix:** Return early when `host.clientWidth < 2 || host.clientHeight < 2` (as crystal/organism do), and use `Math.max(1, …)`
  for sim dims. On resize, copy the old content: RD can blit the old texture into the new FBO with the SHOW-less copy pass
  (`blitFramebuffer`). Branching can `drawImage(oldAcc, 0, 0, w, h)` into the new buffer.

### F20 [LOW · bug] `reactify` flash does nothing on toon/neon/x-ray. Surface shaders run on wall-clock `time`
- **Where:** `shaders.ts:60-61` (sets `emissiveNode` on any node material), `:143-151, 166-173, 195-204` (`MeshBasicNodeMaterial`
  has no emissive term); `time` used in `:99, 127, 133, 138, 156, 160, 182, 190, 208, 224, 236, 274, 287`.
- **Scenario:** With the *neon* shader, *flash* has no visible effect, so the "React" section seems broken for 3 of 20
  shaders. Pausing the audio (Space) does not pause surface animation, and any future offline or deterministic render
  (fixed-timestep export) cannot reproduce the animation.
- **Fix:** For basic materials, fold flash into `colorNode` (`colorNode.add(diffuseColor.rgb.mul(uFlash))` via `outputNode`).
  Replace `time` with an engine-driven `uTime` uniform advanced by `m.dt` (so it pauses and stays deterministic).

### F21 [LOW · leak · cross-scope] `organism.buildMeshes` leaks the base materials when a growth shader is active
- **Where:** `organism.ts:665-670` disposes `mesh.material`. When a growth shader is active, that is the shared `shaderMat`,
  not the base `reactify(MeshStandardNodeMaterial)` instances in `baseMats`, which are then cleared at `:671` without disposal.
- **Scenario:** A growth shader selected plus a budget that doubles 20 k → 40 k → 80 k → 160 k → 250 k leaks 4 × 4 node
  materials (and their pipelines). The leak is small but unbounded across resets that call `buildMeshes`.
- **Fix:** Dispose `new Set(this.baseMats.values())` before `this.baseMats.clear()`.

### F22 [LOW · build] `release.mjs` hardening gaps
- **Where:** `scripts/release.mjs:13-17, 8, 19-43`.
- **Issues and fixes:**
  - `readdirSync(...).find(/^index-.*\.js$/)` picks an arbitrary chunk if Vite ever splits (a dynamic import or a worker).
    Parse the `<script type="module" src>` from `dist/index.html` instead, and assert that exactly one module chunk exists.
  - There is no guard against `</script` or `<!--` inside the inlined bundle. Neither occurs today (checked: 0 occurrences),
    but three or a new dependency could add one and silently truncate the single file. Assert both are absent, or escape with
    `.replace(/<\/script/gi, '<\\/script')`.
  - The single-file output still contains relative `./assets/vision_wasm_internal-*.js/wasm` URLs. That is intentional, but
    add an assertion listing every remaining `./assets/` reference, so an accidental external dependency (a CSS or font chunk)
    fails the release instead of shipping a broken offline file.
  - `README.txt` keys list is hard-coded, and v19 changed Tab → F2. Generate it from one `KEYS` table shared with `main.ts`.
  - Emit `SHA256SUMS.txt` and embed the build id, so the owner can see which build is running (owner rule: "versions visible
    in UI").
  - `VERSION` exists twice (`package.json:4`, `src/midi/version.ts`). Read `package.json` in Vite (`define: { __VERSION__ }`)
    and delete the regex scrape.

### F23 [LOW · perf] 2D engines allocate strings and paths per element per frame
- **Where:** `cells.ts:232, 236, 241` (3 `rgbCss()` strings per cell per replica per frame, up to 320 × 8 × 3 = 7 680/frame);
  `branching.ts:172-185` (one `beginPath/stroke` per tip per replica); `branching.ts:191` (`{...t}` spread per fork);
  `cells.ts:157-176` (O(n²) repulsion, 51 k pairs at the cap).
- **Fix:** Cache `fillCss`/`strokeCss`/`nucCss` per cell at birth (alpha is constant per control; rebuild on the `fill`
  change). Batch Branching strokes per colour with `Path2D`. Use a uniform grid (cell size = 2·max r) for Cells repulsion.

---

## Test infrastructure: current state and proposal

**TS repo:** no test runner, no lint, no CI. `yarn build` = `tsc --noEmit && vite build && release`.
**v19 lineage:** `maintenance/test-*.cjs` run readable module text in a `vm` context with stubs, and first assert
`bundle.includes(code)`. They check that the module was inserted and exercise it against mocks. They never import the real
bundle's integration points, and nothing was rendered in a browser (confirmed by NOTES).

### Proposed setup
```
devDependencies: vitest ^3, happy-dom ^15, @playwright/test ^1.5x, fflate (release zip)
vitest.config.ts: { test: { environment: 'node', environmentMatchGlobs: [['src/**/*.dom.test.ts','happy-dom']] },
                    resolve: { alias: [{ find: /^three$/, replacement: 'three/webgpu' }] } }
scripts: "test": "vitest run", "test:e2e": "playwright test", "check": "tsc --noEmit && vitest run"
CI (GitHub Actions, windows-latest + macos-latest): yarn --frozen-lockfile → check → build → test:e2e
```
three's scene graph, `InstancedMesh` and TSL node construction all run in Node with no GPU, so most engine logic is
unit-testable once the render call is behind `if (this.renderer)`.

### Highest-value unit tests (in order)
1. **Release artefact contract** (`scripts/release.test.ts`, runs after build): the single HTML has exactly one inline module
   script, no `</script`/`<!--` inside it, and no `./assets/` references other than the MediaPipe allow-list. Zip entries
   contain no `\`, `start-mac.command` has mode 0755, and `package.json.version === VERSION`. (Guards F2, F16, F22.)
2. **Crystal voxel store invariants** (after extracting `VoxelStore`): after random `add`/`removeOldest` sequences,
   `occ.size === count`, every `occ` entry maps back to matching `pos`, frontier indices are `< count`, and
   **changing shape/gap keeps `instanceMatrix.array` contents** (regression for F3).
3. **Widget/Morph contract:** `Morph.tick` never applies keys with `from === to`, and `widget.set` does not call `onChange`
   for an unchanged value (F3 root cause, and it benefits every engine).
4. **MusicClock** (`music.ts`): dt clamp `[0.001, 0.05]`; note-on/off drain into `events` and `active`; `onset` decays;
   `register`/bands never NaN with no notes; negative pitch `pitchClass` ∈ [0, 11].
5. **Shader catalogue smoke:** every `GROWTH_SHADERS[i].make()` and `ENV_SHADERS[i].make()` constructs without throwing.
   `reactify(reactify(m))` does not double the flash (make it idempotent via a WeakSet). ENV shaders must not reference
   `positionWorld` (F6), checked by a string or node-graph check.
6. **Soft geometry factory (v19 port):** the liquid geometry is indexed (`geometry.index !== null`) and vertex count ≥
   2 000 at the default tier (F4).
7. **Cells/Branching bounds:** with 1 000 note-ons in one frame, `tips.length ≤ 700` and `cells.length ≤ 320`. A held note for
   60 s keeps `target ≤ cap` (F14). Run on a stub `CanvasRenderingContext2D` (happy-dom plus a no-op 2D ctx shim).
8. **RD Pearson map:** extract `fkFor(register, pattern)` as a pure function. Endpoints equal `FK_STOPS[0]`/`FK_STOPS[4]`,
   it is continuous across stop boundaries, and it is never NaN for register ∈ [0, 1].
9. **Recorder pure parts:** even dimensions, `formatFor(mime)`, monotonic timestamps (port `test-recording.cjs`).
10. **Presets:** load/save round-trip when `localStorage` throws (port the v19 `IK` try/catch semantics).

### One Playwright smoke test (the missing piece v16–v19 never had)
Launch Chromium with `--enable-unsafe-webgpu --use-angle=swiftshader` (and a second project with `--disable-gpu` for the
WebGL2 fallback). Open `dist/growth-visualiser-vX.html` via `file://` and assert no console errors. Press `A`,`D`,`G`
(keyboard piano) for 2 s, read `window.__growth?.stats()` (expose a tiny debug hook) and assert segments > N. Screenshot
the canvas and assert more than 2 % non-black pixels. Switch through all 5 engines (`1`–`5`) and assert exactly one
`#stage > canvas` after each switch (guards F8). Record 3 s and run `ffprobe` on the download: H.264 High, `moov` before
`mdat`, constant frame rate, AAC stream present. That encodes the owner's Finder/QuickTime/Resolve requirement as a test.

---

## Quick wins (each ≤ 30 min)
1. `widget.set`: `if (n === prev) return` before `onChange`. `Morph.tick`: skip `from === to`. (Removes the per-frame
   `setControl` storm for every engine.)
2. Crystal `setControl('shape'|'gap')`: swap `mesh.geometry` on the existing meshes instead of `buildMeshes()` (fixes F3).
3. Liquid: `mergeVertices(new IcosahedronGeometry(1, 4))` and normals on every geometry update (fixes F4's facets).
4. ENV shaders: `normalize(pw)` → `positionLocal.normalize()` (F6). Starfield: `cell.add(512)` before hashing (F7).
5. Crystal fog: `this.scene.fog.density = 0.55 / dist` per frame (F10).
6. `selectEngine` catch: unmount the failed engine and remove stray canvases (F8).
7. `ctl()` via a cached `Map` (F12).
8. Clamp `sym` to [1, 8] in branching/cells/crystal (F15).
9. `vendor.mjs`: copy models only. Drop `public/mediapipe/wasm` (−34 MB zip, F16).
10. Replace `Compress-Archive` with `tar -a -cf` or fflate (F2), and assert `/`-only entry names.
11. Cells: cap held swell. Evict the oldest cell at the cap instead of ignoring the note (F14).
12. RD: `RG16F/RG32F` targets and one `texture()` fetch in SHOW (F13, partial).
