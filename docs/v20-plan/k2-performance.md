# K2: Performance architecture review for Growth (organism engine)

Role: performance architect. Goal: roughly 10× more scene capacity and frame-time headroom, so dense organisms hold 60 fps on a weak laptop and look rich on a good GPU.

Sources read (read-only):
- TS source (v0.15.0): `C:\Users\User\Desktop\code\growth-midi-visualiser\src\midi\engines\organism.ts` (2790 lines), `src/midi/engine.ts`, `src/midi/shaders.ts`, `src/midi/videoField.ts`, `src/midi/main.ts`, `src/midi/recorder.ts`, and three r185.1 internals in `node_modules/three/src/renderers/{webgpu,webgl-fallback}/utils/*AttributeUtils.js` and `src/nodes/accessors/Instance.js`.
- Patch lineage (v0.19.0): `C:\Users\User\Downloads\growth-v0190\maintenance\{soft-growth.js, soft-species-extra.js, music-focus.js, stage-motion.js, cinematic-camera.js, dynamic-material-runtime.js, patch_performance.py}` and the minified bundle `assets/index-BWYXfAkm.js`. I used grep only; the bundle was not modified.

Measurements: I wrote a CPU micro-benchmark that runs the real three r185 core and copies the hot paths line for line (`writeSeg`, `writeColor`, `nearestEndpoint`, the camera passes, `segs.filter`). It is at `...\scratchpad\v20\k2bench\bench.mjs` and `bench2.mjs`. I ran it on the dev box (i9-14900K, Node 20). A weak laptop (i5-8250U / UHD 620 class) is typically 3–5× slower on this kind of JS. I estimated GPU costs by counting vertices from the geometry the code builds. They are not timestamp-measured; idea P0 adds that measurement.

---

## 1. Executive summary

The organism engine has four separate problems. Each one alone costs 60 fps on a weak laptop well before the 60k default budget is reached:

1. **The whole instance buffers are uploaded every frame.** Every `writeSeg` sets `needsUpdate = true` on the instance matrices of all 6 segment meshes (`organism.ts:1741-1772`). Every `writeColor` does the same on all 6 colour buffers (`1695-1700`). Nothing calls `addUpdateRange`, and three r185 then does `device.queue.writeBuffer(buffer, 0, array)` on the **whole allocation** (`WebGPUAttributeUtils.js:227-236`), or `gl.bufferSubData(…, 0, array)` on WebGL2 (`WebGLAttributeUtils.js:205-209`). The size is capacity × 64 B × 6 meshes, not the live count:
   - cap 20k: **7.7 MB/frame**, even with 100 segments on screen.
   - cap 40k: **15.4 MB/frame**.
   - cap 60k: **23 MB/frame**.
   - Plus 1.4–4.3 MB/frame of colours. In v0.19, `refreshMusicFocus` rewrites 800 colours on every frame (`maintenance/music-focus.js`), so this now happens every frame.
   - At 60 fps that is roughly 0.5–1.6 GB/s of CPU→GPU traffic, for data that is at most a few KB of real change.
2. **Every segment slot is drawn by every mesh, as zero-scale waste.** The 7 InstancedMeshes share one index space. Each slot holds a real matrix in one skin mesh and one node mesh, and `ZERO_M` in the others (`1741-1745`, `1765-1770`). Every visible mesh draws `count = segs.length` instances (`2483`), and with species "random" (the default) all of them are nearly always visible (`2485-2504`).
   - The node sphere is `IcosahedronGeometry(1,1)`, which is **non-indexed: 240 vertex invocations per instance** (`677`).
   - One slot costs about **425 vertex invocations** at cap ≤ 50k, and 173 at cap > 50k. For a tube + sphere segment, only 58 would be needed with an indexed sphere.
   - At 40k segments that is about 17 M vertex invocations and 12 M submitted triangles per frame. My estimate is 15–30 ms on a UHD 620-class iGPU.
3. **O(N) scans inside O(tips) loops.** `nearestEndpoint` (`1895-1911`) scans every segment for every new segment started (`1873`). Measured on the fast box at 60k segments:
   - 25 new segments/frame: **7.4 ms**.
   - 200 tips with fillRate 0: **55 ms**.
   - At 250k segments: **81 ms and 600 ms**.
   - Three smaller O(N) passes also run on every frame or every note: two camera passes over all segments (`2577-2590`, 1.0 ms at 60k and 5.9 ms at 250k), `segs.filter` per note-on (`1583`, 0.74 ms / 4.2 ms), and the lignify scan per held plant (`2422`).
4. **Per-segment matrices rebuilt on the CPU for motion.** `writeSeg` measured **1.0–1.6 µs** per call. `deform()` (wild sway / physics / nerves) rewrites up to 25k segments per frame (`2103`), which is 5.4 ms on the fast box and ~15–25 ms weak. Physics still only reaches 1/stride of the skeleton per frame.
   - Seasons rewrite **every** colour ×6 every ~0.4 s (`2175`). At 60k that is a ~21 ms spike on the fast box, and ~60 ms on a weak laptop: a periodic hitch.
   - `growCapacity` (`704-714`) rebuilds all materials (a pipeline/node rebuild) and rewrites every segment at 20k→40k→60k. That is a 100–300 ms freeze early in every set, and a visible stutter in recordings.

`autoQuality` only lowers the pixel ratio (`2721-2734`). None of the four costs above depend on pixel count, so on a weak laptop auto quality drives the render scale down to 0.5. The picture gets blurry and stays slow.

**The 10× plan:**
- Move from "7 meshes × full matrices, uploaded whole, rebuilt on the CPU" to "one compact instance record per segment (about 48 B instead of 520 B), in per-kind lists, uploaded as dirty ranges, with the transform, growth animation, sway, droop, wind, pulse, focus and colour all computed in the TSL vertex shader from uniforms and a small per-plant table".
- Replace the O(N) queries with a spatial hash and incremental statistics.
- Make adaptive quality steer sim and geometry cost, not just pixels.

Expected results:
- CPU per frame: O(changes) instead of O(N), about 1–3 ms at any N.
- Upload: from about 10–25 MB/frame to under 50 KB/frame.
- GPU vertex work: 3–7× lower at the same N.
- Headroom: 150k+ segments at 60 fps on a weak laptop (with a detail tier), and 500k–1M on a good GPU (`CAP_MAX` can rise).

There is also a visual payoff for the owner's main complaint. Once motion lives in the shader, **every** segment can respond to the music every frame at zero CPU cost: per-note chroma swell, onset ripples running from the root, and freshness glow. Today that is either impossible or is limited to 25k young segments.

---

## 2. As-is architecture (TS source, with line refs)

| Piece | Where | What it does |
|---|---|---|
| Capacities | `organism.ts:50-52` | `CAP_START=20000`, `CAP_MAX=250000`, `MAX_TIPS=200`; the budget default is 60k (`415`) |
| Seg record | `196-206` | a JS object per segment: 2× `Vector3`, a `plant` ref, an optional `lq` Quaternion. At 60k segments that is about 180k live heap objects |
| Meshes | `663-701` | `segMesh` (open cylinder), `segRib` (lathe), `segCrys` (squashed octahedron), `leafMesh` (plane), `sphereMesh` (icosahedron), `cubeMesh` (box), `tipMesh`. Detail drops at cap >50k/120k (`672-674`). Three materials; `mat` is shared by cyl/sphere/rib |
| Instancing | `716-727` | on WebGPU `instanceMatrix` → `StorageInstancedBufferAttribute(max*16)`; `instanceColor` is a normal instanced vertex attribute with `DynamicDrawUsage`; `frustumCulled=false` |
| Capacity growth | `704-714` | doubles `cap` and calls `buildMeshes` (new geometry and materials; `applyShaders` and `rebuildEnv` again), then `writeColor` and `writeSeg` for **all** segs |
| writeSeg | `1717-1773` | quaternion from the unit vector, 3× `Object3D.updateMatrix()`, 7× `setMatrixAt` (3 skins, 1 leaf, 2 nodes), a linear-search `ctl('nodes')`, `needsUpdate` on 6 buffers |
| writeColor | `1687-1701` | 6× `setColorAt` (allocates `new THREE.Color(1,1,1)` for crystal), `needsUpdate` on 6 buffers |
| removeSeg | `1703-1714` | swap-remove into the vacated slot (rewrites the last segment ×7 + colours ×6); `plant.segs.indexOf` scans from the front |
| Growth loop | `2377-2423` | per held plant, per tip: `startSegment` (with `nextDir` → `nearestEndpoint`, which is O(N)), then `growth +=` and `writeSeg` **every frame for every growing tip** |
| Retract loop | `2440-2479` | per released plant, one segment shrinks per frame (`writeSeg`), `removeSeg` at 0 |
| Deform | `2075-2137` | wild sway on segments younger than 9 s (newest first), physics/nerves on everything at stride `ceil(N/25000)` with parity; `writeSeg` with displaced endpoints |
| Seasons | `2140-2176` | on each 0.004 phase step: `applySeasonColor` for all plants, then **`writeColor` for every segment** |
| Camera | `2575-2590` | the centroid of all `s.a` plus the max distance, two full passes per frame |
| Model attach | `1276-1307` | a per-frame translate of every segment of attached plants, plus `writeSeg` |
| Morph shell | `1310-1360` | per-vertex JS displacement of every morph mesh, plus a **BVH `refit()` per frame** |
| Auto quality | `2721-2734` | an EMA of 1/dt; pixel ratio ×0.85 under 45 fps, ×1.1 over 57, every 1.5 s, which calls `renderer.setSize` (swapchain / MSAA / bloom realloc) |
| Controls | `engine.ts:78-81` | `ctl()` = `controls.find()` linear search (~134 controls in v19); 107 call sites in organism.ts, several in per-segment paths |
| Loop | `main.ts:1041` | rAF-driven, so sim + upload run at display rate (twice as often on 120 Hz panels) |

v0.19 additions that matter for performance:
- `draw()` now starts with `this.refreshMusicFocus(); this.updateSoftGrowth(...)` (bundle anchor `draw(){this.refreshMusicFocus();this.updateSoftGrowth(this.performanceState);`).
- `refreshMusicFocus` (`maintenance/music-focus.js`) calls the wrapped `writeColor` on 800 segments per frame. The wrapper calls `focusLevel` → `G(controls,'musicFocus')` and `G(controls,'musicTrail')`, both linear searches. **This forces the full ×6 colour upload on every frame.**
- The soft species (`maintenance/soft-growth.js`, `soft-species-extra.js`):
  - Each soft plant gets its own `Mesh` + material. `kp` = `IcosahedronGeometry(1,2)` for liquid (confirmed in the bundle: `class kp extends Wx{constructor(e=1,t=0){…` is PolyhedronGeometry/Icosahedron), or `PlaneGeometry(1,1,24,16)`.
  - Per-vertex JS on up to 16 meshes/frame at ≤30 Hz, plus `computeVertexNormals()` at 15 Hz.
  - `IcosahedronGeometry` is **non-indexed**, so `computeVertexNormals` gives **flat per-face normals**. That is exactly the faceted low-poly look the lead saw in "Liquid". Detail 2 is also only 320 triangles.
  - A `writeSeg` wrapper still writes the soft plants' skeleton segments with growth forced to 0. They take budget, instance slots and zero-scale vertex work while contributing no pixels.
- `stage-motion.js` `updateBounceBounds` (about 768 projected points at 4 Hz) and `cinematic-camera.js` mode 8 (stride ≤512) are already sampled and bounded. They are fine.

---

## 3. Measured / estimated per-frame cost inventory

CPU micro-benchmark (fast box). Multiply by about 3–5 for a weak laptop.

| Hot path | N=60k | N=250k | Frequency in real use |
|---|---|---|---|
| `writeSeg` per call | 1.0–1.6 µs | same | each growing tip every frame (~200–500 calls) + deform (≤25k) + attach + removals |
| `writeSeg` ×25 000 (deform cap) | 5.4 ms | 5.1 ms | every frame when wild>0 or physics/nerves on |
| `writeColor` ×800 (v19 focus sweep) | 0.28 ms | 0.44 ms | every frame in v19 |
| seasons: `writeColor` × all | ~21 ms | ~90 ms | every ~0.4 s at `seasons` 1 → periodic hitch |
| `nearestEndpoint` ×1 | 0.6 ms | 3.0–3.8 ms | per `startSegment` (join>0 is almost always true) |
| `nearestEndpoint` ×25 (fillRate 1500 @60fps) | **7.4 ms** | **81 ms** | v15 default fillRate 1500 |
| `nearestEndpoint` ×200 (fillRate 0) | **55 ms** | **600 ms** | "as fast as it can" |
| same with a uniform hash, cell = radius (27 cells) ×25 / ×200 | 0.66 / 3.8 ms | 4.2 / 34 ms | shows the scaling; capped-bucket variant (below) gives O(1) |
| camera centroid + radius passes | 1.0 ms | 5.9 ms | every frame |
| `segs.filter(growth>=1)` in `newPlant` | 0.74 ms + GC | 4.2 ms + GC | every note-on (a 10-note chord = ×10) |
| memcpy of 6 matrix buffers (lower bound for the upload path) | 3.8 ms | 16.4 ms | every frame anything is written. The real upload adds a GPU-process copy and IPC |
| compact SoA write ×25 000 (12 floats, no matrix math) | **0.19 ms** | 0.20 ms | what the proposed format costs |

GPU vertex work per segment slot (all 6 segment meshes visible, which is the default random-species case):

| Geometry | cap ≤ 50k | cap > 50k | Note |
|---|---|---|---|
| Cylinder open (radial 7/5) | 16 v / 14 t | 12 v / 10 t | indexed |
| Icosahedron node (detail 1/0) | **240 v** / 80 t | 60 v / 20 t | **non-indexed**: an indexed detail 1 is 42 v |
| Box node | 24 v / 12 t | 24 / 12 | |
| Lathe rib (13/7 rings × 9/7) | 117 v / 192 t | 49 v / 72 t | |
| Octahedron shard | 24 v / 8 t | 24 / 8 | flat is intended |
| Leaf plane | 4 v / 2 t | 4 / 2 | |
| **Total per slot** | **425 v / 308 t** | **173 v / 122 t** | useful for a tube+sphere species: 256 v now, 58 v indexed |

- At 40k segments: about 17 M vertex invocations and 12 M triangles per frame. Shadows (env 3) render 5 of these meshes a second time (`825`).
- The cap threshold means **40k segments is the heaviest point**: a 20k→40k doubling keeps full detail, and 60k switches to low detail with a visible pop.

Data sizes per segment:
- Now: 7 matrices (448 B) + 6 colours (72 B) = **520 B**, plus ~200 B of JS heap.
- Proposed: about **48 B** per list membership (≈1.5 memberships on average), with no JS objects.

---

## 4. Ideas

Each idea lists impact (1–10), effort (S/M/L/XL), the user-visible result, the design with code locations, risks, and how it stays optional and lightweight.

### P0: Performance HUD + reproducible stress test (measure before and after)
- **Impact 6 (enabling) · Effort S**
- **User-visible:**
  - A "Performance" HUD line: `fps 60 · cpu 3.1 ms · gpu 7.9 ms · upload 42 KB · segs 61k/250k · tier High (auto)`.
  - A "Stress test" button that plays a built-in 30 s scripted MIDI burst (chords, fast arpeggios, held pads), then prints avg/p95/max frame ms. The owner can compare laptops and versions, and it becomes the regression gate for v20.
- **Design:**
  - Wrap `frame()` sim work and `draw()` in `performance.now()` pairs.
  - GPU time on WebGPU: create the renderer with `trackTimestamp: true` and call `renderer.resolveTimestampsAsync()` every ~0.5 s. It is supported in r185; WebGL2 falls back to `EXT_disjoint_timer_query_webgl2` when present, otherwise "n/a".
  - Upload bytes: a counter added in the new flush function (P1).
  - The stress script is a list of timed `{on/off, pitch, vel}` events injected into `clock` (main.ts) in place of real MIDI, with a fixed RNG seed (see P13), so runs are comparable.
- **Risks:** timestamp queries need the `timestamp-query` feature. Guard it, and show "gpu n/a".
- **Optional:** the HUD line is hidden unless Performance is expanded, and the stress test runs only on click.

### P1: Dirty-range uploads + write only the meshes that changed
- **Impact 8 · Effort S** (a drop-in on the current architecture, and the biggest win per line of code)
- **User-visible:**
  - Smooth frame times at any segment count on the current renderer. Safari/Firefox (WebGL2 `bufferSubData`) benefit most.
  - At cap 60k, per-frame uploads drop from about 23–27 MB to tens of KB.
- **Design:**
  1. Add `private dirty = new Map<THREE.InstancedBufferAttribute, {lo:number, hi:number}>()`, or better, two `Int32Array(8)` per attribute holding up to 4 coalesced ranges. Add `markDirty(attr, idx)` in place of every `instanceMatrix.needsUpdate = true` (`1744, 1756, 1771-1772`) and `instanceColor!.needsUpdate = true` (`1695-1700`), and `tipMesh` stays as-is.
  2. Add `flushUploads()`, called once at the end of `frame()` just before `draw()` (`2736`). For each dirty attribute: `attr.clearUpdateRanges(); for (r of ranges) attr.addUpdateRange(r.lo*itemSize, (r.hi-r.lo+1)*itemSize); attr.needsUpdate = true`. If the ranges cover more than 50% of `count`, skip ranges and upload `count*itemSize` only (one range 0..count), **never the whole capacity**. three r185 honours `updateRanges` on both backends (`WebGPUAttributeUtils.js:243-268`, `WebGLAttributeUtils.js:213-220`), including `StorageInstancedBufferAttribute`.
  3. **Skip the redundant zero writes.** Keep `slotSkin = new Uint8Array(cap)` and `slotNode = new Uint8Array(cap)`. In `writeSeg`, write `ZERO_M` into the *other* meshes only when the slot's kind changed: on `addSeg` into a slot last used by another kind, or on `removeSeg` swaps (`1706-1709`). That drops 7 `setMatrixAt` + 6 `markDirty` per call to 2–3.
  4. Also in `writeColor`, write only the meshes this segment's kind uses. Precompute the crystal white-mix and leaf ×1.15 colours per **plant** once, not per segment, and remove the `new THREE.Color(1,1,1)` at `1693`.
  5. v19 port: `refreshMusicFocus` must use `markDirty`, and it becomes unnecessary after P6 (focus moves to the shader).
- **Risks:**
  - Swap-remove produces scattered indices. Coalescing to ≤4 ranges plus the "cover >50% → count-range" fallback keeps it bounded.
  - On WebGPU the storage buffer is not padded for 16-float items, so ranges map 1:1.
  - `growCapacity` must mark the full `count` dirty.
- **Optional:** none needed. This is transparent.

### P2: Kill the O(N) queries (spatial hash + incremental stats)
- **Impact 8 · Effort S–M**
- **User-visible:** high fill rates ("0 = as fast as it can", big chords, "wild" bursts) no longer freeze a dense scene, and the recycle limit stops being a CPU cliff.
- **Design:**
  1. **`EndpointGrid`**: a uniform hash of finished segment endpoints (`s.b`) with cell = 2 world units. Key: the existing 30-bit packing from `updateCoverage` (`1386`). Buckets hold **capped rings of the K=8 most recent segment ids** (Int32Array slots, overwrite oldest).
     - Insert in `finishSegment` (`2023`), when growth reaches 1.
     - Removal is lazy: store `seg.gen` and validate on read (segment still alive, same plant not excluded, `growth>=1`).
     - `nearestEndpoint(tip, maxD)` (`1895`) visits ⌈maxD/cell⌉ neighbourhoods (27 cells at the default cohesion) × ≤8 entries, so it is **O(1), ≤216 distance tests**, whatever N is. Attraction only needs *a* nearby endpoint, not the exact global nearest, so the capped buckets do not change the look.
     - Also reuse this grid for `updateCoverage` (`1380-1401`, which rebuilds a Set of all segments every 90 frames) and for self-avoidance (`1833-1852`, currently a 160-step backwards scan).
  2. **`newPlant` graft pick** (`1583-1588`): replace `this.segs.filter(s => s.growth >= 1)` with up to 8 random picks of `this.segs[(Math.random()*n)|0]` until one has `growth>=1`. No allocation, O(1).
  3. **Camera statistics** (`2577-2590`): keep a running `sumA` (add in `addSeg`, subtract in `removeSeg`; re-sum from scratch every ~10 s against float drift). For the radius, take a strided sample of ≤1024 segments per frame into a decaying max (`r2 = max(r2*0.995, sample)`). This is the same pattern v19 `cinematic-camera.js` already uses (stride 512).
  4. **Lignify** (`2422`): segments are pushed in birth order, so keep `p.lignifyCursor`, advance while `t - segs[cur].born > lignify`, and mark them permanent. O(new) instead of O(plant) per frame.
  5. **`removeSeg`** (`1712`): use `lastIndexOf` (the target is almost always last), or store `seg.pidx` and swap-remove within `plant.segs`. The tunnel cull (`2630-2638`) then goes from O(k·n) to O(k).
  6. **`inside()` / `projectToSurface()`** (`1448`, `1238`): about 10 BVH raycasts per new segment in skin mode, each allocating an intersections array. Use `mesh.geometry.boundsTree.raycastFirst(ray)` directly with a reused Ray, which avoids `intersectObject`'s array+sort. Cache `matrixWorld` inverses per shell mesh.
- **Risks:** the capped buckets change which endpoint a tip is drawn to (same neighbourhood, so low visual risk). The grid must be cleared in `clearGrowth` (`742`).
- **Optional:** internal. The cell size follows `size`/cohesion.

### P3: Indexed and smoother geometry (nodes, tips, Liquid)
- **Impact 6 · Effort S**
- **User-visible:**
  - About 40% less GPU vertex work immediately.
  - **Liquid stops looking faceted:** smooth normals and more subdivision at no extra cost.
- **Design:**
  - `buildMeshes` (`677`, `683`): `const s = new THREE.IcosahedronGeometry(1, blob); s.deleteAttribute('uv'); const si = mergeVertices(s)` (from `three/examples/jsm/utils/BufferGeometryUtils.js`). Detail 1 goes from 240 to 42 invocations; detail 2 (a rounder node on good GPUs) is 162 instead of 960. No shader uses `uv()` (grep of `shaders.ts` and `dynamic-materials.js`), so dropping uv is safe. Do the same for `tipMesh`.
  - Liquid (v19 `soft-growth.js`, `new kp(1,2)`): use an indexed sphere (`mergeVertices(new IcosahedronGeometry(1,4))`, 2562 verts) so `computeVertexNormals` yields smooth normals. The proper fix is P9.
  - Octahedron shards stay non-indexed on purpose (flat facets).
- **Risks:** `mergeVertices` needs identical normals at merge points. The icosahedron's normals equal its normalised positions (PolyhedronGeometry `normalizeNormals` for detail>0), so they match. For detail 0 it calls `computeVertexNormals` (flat), so recompute normals after merging.
- **Optional:** detail becomes a quality-tier setting (P8).

### P4: Controls cache + GC hygiene
- **Impact 4 · Effort S**
- **User-visible:** fewer micro-stutters (GC pauses), which matters most in recordings.
- **Design:**
  - `ctl()` is `Array.find` over ~134 controls (`engine.ts:78`). Add a `Map<string, EngineControl>` built in `mount` and after `onControlsChanged`, and make `ctl`/`setCtl` Map lookups. Better still, have `frame()` snapshot the ~40 controls it reads into a plain object `k` once per frame (`k.nodes`, `k.join`…), passed to `nextDir` / `writeSeg` / `deform`. In v19 the same applies to `G(this.controls, …)` inside `focusLevel` and `updateSoftGrowth`.
  - Remove per-call allocations:
    - `new THREE.Color` (`1693`).
    - `[...p.tips]` per plant per frame (`2383`): iterate backwards instead.
    - The `sway`/`phys` closures created per frame (`2084-2100`).
    - `new A()` inside `updateBounceBounds`'s corner loops (v19).
    - Per-frame `this.plants.filter` (`2482`): compact in place.
- **Risks:** a stale cache if controls are replaced (rebuild the Map on `onControlsChanged`).
- **Optional:** internal.

### P5: Per-kind instance lists (stop drawing zero-scale instances)
- **Impact 7 · Effort M** (a stepping stone; P6 subsumes it)
- **User-visible:** random-species scenes cost about half the GPU time. Room to raise detail on good GPUs.
- **Design:**
  - Each drawable kind (tube, rib, crystal, leaf, sphere node, cube node, later soft) owns its own slot space: `kindCount[k]`, `kindSeg[k]: Int32Array(cap)` (slot → segment id), and on the segment `seg.slot[k]` (or `-1`).
  - `addSeg` inserts into its skin kind, into its node kind if `sp.node!=='none'`, and into leaf if leafy and finished.
  - `removeSeg` swap-removes per kind: O(1), and writes only the moved slot.
  - `mesh.count = kindCount[k]`, and `visible = kindCount[k] > 0` replaces the per-plant any-scan at `2485-2504`.
  - `ZERO_M` disappears entirely.
- **Risks:** the leaf appears only once the segment is finished (insert on `finishSegment`, remove on retract below 1). Colours move to per-kind slots.
- **Optional:** transparent.

### P6: GPU-driven segments: compact records, transform + growth in the TSL vertex shader
- **Impact 10 · Effort L** (the core of the 10×)
- **User-visible:**
  - Large, dense worlds: the budget slider can go to 500k–1M on good GPUs, and the default can rise to about 150k on a weak laptop at the right tier.
  - Growth animation is perfectly smooth even when the CPU hiccups.
  - Changing **thickness / node size / leaf size** re-shapes the *whole* world live. Today it only affects newly written segments.
  - No capacity-doubling freezes (P10).
- **Design:**
  1. **Records.** Per kind list (P5), `InstancedBufferAttribute`s (they work on both WebGPU and the WebGL2 fallback, and support `addUpdateRange`):
     - `iA: vec4 = (a.xyz, r)`
     - `iB: vec4 = (b.xyz, plantSlot)`
     - `iG: vec4 = (g0, t0, rate, born)`, a growth **keyframe**: `growth(t) = clamp(g0 + (t - t0)·rate, 0, 1)`
     - Optional `iF: uint/float flags`: depth-from-root, per-segment hash seed.
     - That is 48–64 B per membership, against 520 B per slot today. Use `THREE.Mesh` + `THREE.InstancedBufferGeometry` (`geometry.instanceCount = kindCount[k]`) instead of `InstancedMesh`, so three's `InstanceNode` matrix path is skipped entirely.
  2. **Plant table.** A `DataTexture` (RGBA32F, 256×16 texels, 2 texels per plant slot, recycled via a free list), readable in vertex shaders on both backends with `textureLoad`:
     - texel 0: `color.rgb, dyingDim`
     - texel 1: `root.xyz, reach` (for physics); later an `attachOffset` translation for rigged-model riding
     - Plant colour, season recolour, dying dim and v19 "music focus" become **one texel write per plant**, not N×6. `seasons()` (`2174-2175`) drops from ~21 ms to microseconds.
  3. **Vertex shader** (a TSL `positionNode` on the cloned per-kind material, wrapped through `reactify`):
     ```ts
     const uT = uniform(0)                      // engine clock (m.time), not TSL `time`: deterministic for recording
     const iA = instancedBufferAttribute(attrA) // vec4
     const iB = instancedBufferAttribute(attrB)
     const iG = instancedBufferAttribute(attrG)
     const g  = clamp(iG.x.add(uT.sub(iG.y).mul(iG.z)), 0, 1)
     const A  = iA.xyz.add(motion(iA.xyz))       // P7: sway / droop / wind, same fn for both ends -> joints stay welded
     const B  = iB.xyz.add(motion(iB.xyz))
     const d  = B.sub(A), L = length(d), y = d.div(max(L, 1e-6))
     // branchless orthonormal basis (Duff et al. 2017) — no quaternions
     const s = select(y.z.greaterThanEqual(0), float(1), float(-1))
     const k = float(-1).div(s.add(y.z)), m = y.x.mul(y.y).mul(k)
     const x = vec3(float(1).add(s.mul(y.x).mul(y.x).mul(k)), s.mul(m), s.negate().mul(y.x))
     const z = vec3(m, s.add(y.y.mul(y.y).mul(k)), y.y.negate())
     const r = iA.w.mul(uThickLive).mul(pulse)  // pulse = old uPulse swell, now a radius multiplier
     // skin kinds (cylinder/lathe/shard): unit geometry spans y∈[-.5,.5]
     const P = A.add(y.mul(positionLocal.y.add(0.5).mul(L.mul(g))))
               .add(x.mul(positionLocal.x.mul(r))).add(z.mul(positionLocal.z.mul(r)))
     // node kinds: centre = mix(A,B,g), scale = r·nodeScale·uNodes (cube keeps the y basis for facets)
     // leaf kind: centre = B, orientation from hash(segId), scale = uLeaf·clamp(r*5,.06,.55)·step(1,g)
     material.positionNode = P
     material.normalNode = transformNormalToView(x.mul(normalLocal.x).add(y.mul(normalLocal.y)).add(z.mul(normalLocal.z)))
     material.colorNode  = plantColor(iB.w).mul(kindTint)   // crystal: mix to white .25, leaf ×1.15
     ```
     `hidden` (len<1e-4) handling is implicit: `g=0` collapses the skin to a ring at A, and the node gets `scale·step(1e-4, L·g)`.
  4. **CPU side** writes only on events:
     - `startSegment` → one record plus a keyframe `(0, t, rate)`.
     - The music-driven rate changes by more than ±15%: re-key `(g_now, t, rate')`. The per-frame speed still follows the music; it is quantised to one write per change.
     - `finishSegment` (from the CPU's own `tFinish = t0 + (1-g0)/rate`).
     - Retract start: `(g_now, t, -rate)`, then `removeSeg` at `tZero`.
     - Fuse (`1913-1927`: b moves, g=1).
     - The growth loop (`2377-2395`) then does no `writeSeg` for mid-growth tips; it only checks `t >= tFinish`. The retract loop (`2474-2478`) is the same.
  5. **CPU mirror = upload buffer:** with the SoA store (P12), `seg.a` etc. become indices into the same Float32Arrays that are uploaded, so there is no double bookkeeping.
  6. `buildMeshes` / `growCapacity`: allocate the **budget** capacity once (at 48 B, 250k = 12 MB total, versus 105 MB for today's 7×matrices+6×colours at 250k). Realloc only when the budget slider rises, and then copy the typed arrays (`set`), with no material rebuild.
  7. Shadows (env 3): set `material.castShadowPositionNode = P` (r185 supports it) so the shadow pass uses the same transform.
- **Risks:**
  - The normal transform must be verified on both backends. An alternative is a small custom `Node` subclass mirroring `Instance.js:setup()` that assigns `positionLocal`/`normalLocal` before the model-view transform. Needs visual tests for thin segments and view-aligned segments (ONB degeneracy is handled by the branchless basis).
  - `bloom`/`PostProcessing` are unaffected.
  - Frustum culling stays off (as now) until P11.
  - The WebGL2 fallback lacks storage buffers, which is why this uses instanced attributes and a DataTexture, not storage.
  - It is a large refactor of `writeSeg`/`writeColor` callers (the 121 `seg`/`segs` references in organism.ts), and the v19 JS patches (music focus, soft writeSeg wrapper, reference growth) must be ported into TS at the same time.
- **Optional/lightweight:** keep the current `writeSeg` path behind a hidden `?legacyRender=1` for one release as a fallback and A/B check. The weak-laptop tier uses the same shader with lower geometry detail.

### P7: Motion and music reaction in the shader (replaces `deform()` CPU writes)
- **Impact 9 · Effort M** (after P6)
- **User-visible:**
  - Wild sway, physics droop + wind and nerve pulses now reach **every** segment every frame (today physics touches 1/stride of the skeleton per frame, and sway only segments under 9 s old).
  - Zero CPU cost, so they can be **on by default at a low level**, directly addressing "growth must visibly follow the music":
    - **Per-note chroma swell:** `uChroma[12]`, and each plant's pitch class is in the plant table, so a held C thickens every C-growth.
    - **Onset ripple:** a thickness/brightness wave travelling from each plant's root outward on hits. The nerves effect is generalised to all species with `rootDist` stored per segment.
    - **Freshness glow:** the v19 "music focus" is computed from `born` (`fresh = 1 - (uT-born)/trail`), so there is no 800-per-frame colour sweep.
- **Design:** port `sway()`, `phys()` and the nerve pulse from `deform()` (`2084-2134`) 1:1 to TSL `Fn`s evaluated on each endpoint's world position:
  - `fade = exp(-(uT - born)·0.35)`
  - `frac = distance(q, plantRoot)/max(.5, reach)`
  - `thin = max(0, 1 - r/0.18)`
  - Uniforms: `uWild, uEnergy, uOnset, uBass, uTreble, uGravity, uWind, uNerveSpeed`, from `setShaderMusic` (`shaders.ts`).

  Because A and B are displaced with the same function of their own positions, adjacent segments that share an endpoint stay welded, exactly as the CPU version does today. `deform()` shrinks to setting uniforms. The CPU logic (tips, fusing, shell) keeps using undeformed positions, which is the current semantics.
- **Risks:**
  - Vertex-shader ALU grows. That is fine on GPU, and the weak-laptop tier can compile a cheaper variant without wind noise (a `uMotionTier` define). Recompile once per tier change, never per frame.
  - The model-attach offsets (`1276-1307`) move to a per-plant translation in the plant table.
- **Optional:** every effect keeps its existing slider (`wild`, `physics`, `gravity`, `wind`, `pulse`, `flash`); new ones (`chromaSwell`, `ripple`) default low and can be set to 0.

### P8: Adaptive quality 2.0: steer CPU, vertex and fill costs separately
- **Impact 8 · Effort M**
- **User-visible:**
  - On a weak laptop the picture stays sharp and stays at 60 fps. The engine drops the *right* cost instead of blurring everything.
  - HUD: `Q: High (auto)`. It is locked while recording, as now (`lockQuality`).
- **Design:**
  - Inputs: the P0 CPU ms and GPU ms (timestamp queries), plus `fpsEma`.
  - Tiers (Ultra / High / Medium / Low / Potato), each a bundle of:
    - geometry detail: radial 9/7/5/4, sphere detail 2/1/1/0, lathe rings 12/8/6
    - MSAA: chosen at startup only, since `antialias` needs a renderer re-init
    - motion variant (P7)
    - shadow map size / off
    - bloom on/off
    - pixel ratio range
    - **sim caps:** max tips advanced per frame, `fillRate` ceiling, soft-mesh updates per frame
    - **a soft budget ceiling:** recycling starts earlier on low tiers
  - Decision rule:
    - GPU-bound (gpu ms > 0.8·frame budget): lower geometry detail / pixel ratio / bloom.
    - CPU-bound: lower sim caps.
    - Hysteresis: 3 s over the threshold to step down, 10 s under 70% to step up. Swap geometry only (no material rebuild) to avoid hitches.
  - Replace the per-1.5 s `renderer.setSize` pixel-ratio churn (`2729-2733`, it reallocates the swapchain, MSAA and bloom targets) with fewer, larger steps. On WebGPU, prefer rendering into a scaled render target with a final upscale pass so steps do not reallocate the canvas.
  - Add an **optional 60 fps sim/render cap** for 120/144 Hz panels (the loop is rAF-driven at `main.ts:1041`, so a 144 Hz laptop does 2.4× the work for no visible gain). With P6 the growth animation is time-based in the shader, so capping is invisible.
  - The first-run tier comes from a 3 s silent warm-up benchmark plus `adapter.info` (integrated vs discrete), stored in localStorage (per-viewer convenience only).
- **Risks:** tier oscillation (the hysteresis handles it). Recordings must lock the tier as well as the pixel ratio.
- **Optional:** `autoQuality` stays a toggle, with a manual "Quality tier" select next to it.

### P9: Soft species (Liquid / Silk / blanket + 10 extras) on the GPU
- **Impact 6 · Effort M**
- **User-visible:**
  - **Liquid finally looks liquid:** high-res, smooth normals, fresnel/specular that moves.
  - Silk ribbons are smooth, double-sided and correctly lit.
  - All 13 soft forms animate at 60 fps with no JS vertex loops, and more than 64 can be alive at once.
- **Design:**
  - Replace the per-plant `Mesh`+material+CPU loop (`maintenance/soft-growth.js` `updateSoftGrowth`, `softFormXYZ`) with **one instanced mesh per soft form**: an indexed sphere (ico detail 5 merged) for blobs, and an indexed `PlaneGeometry(1,1,64,24)` for ribbons and sheets.
  - Per-instance record: `(root.xyz, size) (plantSlot, phase, kind, born)`.
  - The TSL vertex shader implements `softFormXYZ` (it is already pure math on `(u,v,t,phase,wave,energy)`).
  - **Normals by finite differences in the shader:** evaluate the form at `(u+ε,v)` and `(u,v+ε)` and take the cross product. This removes `computeVertexNormals` at 15 Hz and gives correct smooth normals on every frame.
  - Liquid shading: `MeshPhysicalNodeMaterial` with `transmission` off (too costly), clearcoat on, roughness 0.05–0.15, and emissive fresnel from `uFlash`.
  - Stop writing zero-growth skeleton segments for soft plants: the v19 `writeSeg` wrapper today still costs budget and vertex work. Let soft plants keep their tips' logical path in CPU-only arrays, or skip the skeleton entirely.
  - `updateBounceBounds` (v19 `stage-motion.js`) then needs the analytic bound (`root ± size`), not `computeBoundingBox` on a CPU geometry.
- **Risks:** video-follow `fieldZ` clamping (in the soft loop) must move to the shader as a depth-texture lookup (the video field's `depthBuf` becomes a `DataTexture`; see P14).
- **Optional:** soft species remain toggles in Species.

### P10: Hitch-free capacity and pipelines
- **Impact 6 · Effort S–M**
- **User-visible:** no freeze when a set crosses 20k and 40k segments. No hitch when switching shader, species, or env (shadows) mid-performance or mid-recording.
- **Design:**
  - With P6, allocate for the budget up front (it is cheap). Until then, stop recreating materials in `buildMeshes` (`675-694`): keep the materials and swap `mesh.geometry` + attributes, so node materials do not rebuild.
  - Warm up at mount: call `await renderer.compileAsync(scene, camera)` after building every kind mesh (including cube, crystal, leaf, soft, bloom and shadow variants) with `count = 1` and a hidden instance, so first use never compiles mid-set. r185 has `compileAsync` for WebGPURenderer.
  - Make `growCapacity`'s re-file a typed-array `set()` (P12) rather than N× `writeSeg`/`writeColor`.
- **Risks:** a longer initial load (show "warming shaders…" in the status line; ~0.3–1 s).
- **Optional:** internal.

### P11: Spatial chunks for frustum culling + distance LOD
- **Impact 5 · Effort L**
- **User-visible:** the fly-through cameras (weave / tunnel / drift / sit inside / chase / tip glide) run about 1.5–2.5× faster in dense worlds, and far growth uses cheaper geometry.
- **Design:**
  - Assign each segment at creation to a spatial chunk (an 8-unit grid cell). Each chunk owns per-kind list ranges and a bounding sphere (grown on insert). Draw chunks as separate `InstancedBufferGeometry` draw ranges (one mesh per chunk × kind, with `frustumCulled = true` and `boundingSphere` set).
  - LOD: per chunk, pick the geometry variant by projected size (chunk radius / distance), with 2–3 variants per kind.
  - WebGPU-only alternative: a compute pass that frustum-culls instances into a compacted index buffer plus indirect draw args (`geometry.setIndirect(IndirectStorageBufferAttribute)`, r185). That is more elegant but WebGPU-only, and the WebGL2 path would keep full draws.
- **Risks:**
  - Draw-call count rises (at most a few hundred; fine on WebGPU, watch WebGL2).
  - Sway/physics displacement can move instances slightly outside chunk bounds: pad the sphere by the maximum displacement.
  - The chunk index conflicts with swap-remove (each chunk keeps its own list).
- **Optional:** automatic; only active when the camera is inside or near the organism or N is above a threshold.

### P12: SoA segment store (typed arrays, no per-segment objects)
- **Impact 6 · Effort L**
- **User-visible:** no GC pauses. Major GCs over about 180k retained objects at 60k segments (and 750k at 250k) cause 5–30 ms stalls that show up as stutter in recordings.
- **Design:**
  - `SegStore { ax, ay, az, bx, by, bz, r, g0, t0, rate, born: Float32Array; plant, flags, gen, slot[k]: Int32Array; count }`.
  - Segments are referenced by index. `Tip.seg` becomes an index, `Plant.segs` an `Int32Array` ring or a (start, count) span. Plant segments are contiguous in birth order most of the time; recycling makes them non-contiguous, so keep a per-plant index list.
  - Hot accessors inline as `S.bx[i]`.
  - This is the natural companion of P6 (these arrays *are* the upload sources for `iA/iB/iG` if laid out as interleaved Float32Array per kind), and of P2 (the grid stores indices).
- **Risks:** it touches almost every growth-model function (121 references). Do it in the same branch as P6, with the P0 stress test as the behavioural regression check (segment counts and plant counts over a seeded run).
- **Optional:** internal.

### P13: Deterministic fixed-step sim + "render take offline" for recordings
- **Impact 8 (for the recording complaint) · Effort L** (coordinate with the recording/export lead)
- **User-visible:** a "Render take" mode:
  - Play live as usual. The app records the *performance*: MIDI/pseudo-note events, audio-file offsets, control changes and camera input, with a seed.
  - "Render" then re-runs it at a fixed dt of 1/fps at any resolution (e.g. 4K60), with no dropped or uneven frames. The output timing is CFR by construction, regardless of laptop speed.
- **Design:**
  - Seed all `Math.random` use in the engine through a `rng()` (mulberry32).
  - Clock `m.time`/`m.dt` from the renderer loop in offline mode.
  - For audio-file input, precompute analysis frames with `OfflineAudioContext` + the same FFT pipeline.
  - Encode with WebCodecs `VideoEncoder` (v0.15 path) with backpressure: render the next frame only when `encodeQueueSize < 4`. This decouples the render cost from real time entirely.
- **Risks:**
  - Mic/tab audio must be recorded to a buffer first.
  - Full determinism requires P4's per-frame control snapshot and the seeded RNG.
- **Optional:** a separate button. Live recording stays.

### P14: Video/reference field on the GPU (low priority)
- **Impact 3 · Effort M**
- **User-visible:** webcam-driven growth leaves more CPU headroom (small).
- **Design:** `videoField.update` (`videoField.ts:169-232`) is 192×~108 pixels at ≤32 Hz: a blur + Sobel pass costing about 0.3–0.6 ms plus `getImageData`, which is already bounded. Only worth moving if P9 needs a depth texture in the shader: upload `depthBuf` as a `DataTexture` (R32F, 20k texels) after each update, and let the soft shader and a possible "relief" shader sample it. Keep CPU sampling for `pickPoint`/`steerByLines`.
- **Risks:** none significant.
- **Optional:** only when video is active.

### P15: Morph shell on the GPU + throttled BVH refit
- **Impact 5 (with big GLBs) · Effort M**
- **User-visible:** "model moves to the music" works on 200k-triangle scans without dropping frames.
- **Design:**
  - `morphShell` (`1310-1360`) does a per-vertex JS loop over every morph mesh and **a BVH `refit()` every frame** (`1358`), which is several ms for a big GLB.
  - Move the visual displacement to a TSL `positionNode` on the shell material (all four modes are closed-form in `phY, phR, rnd`; upload those as vertex attributes once).
  - For CPU containment and skin projection, keep the BVH of the *undeformed* mesh and refit it at ≤10 Hz from the same formula in a strided CPU pass, or skip the refit and accept the ≤10% of shell size mismatch in "contain" mode.
- **Risks:** skin mode wants growth to hug the moving surface; the 10 Hz refit covers that.
- **Optional:** only when `morph > 0`.

### P16: Worker offload of the growth simulation (not recommended now)
- **Impact 4 · Effort XL**
- **Why not now:** after P2+P6+P7, the main-thread sim is about 1–3 ms per frame, so a worker gains little. The costs are real:
  - SharedArrayBuffer needs COOP/COEP headers, which the **single-file offline HTML (file://) cannot provide**, so every frame's changes would go through `postMessage` transfers.
  - The shell BVH, GLB models and video field would have to move too.
- **If ever needed:** an inline Blob worker (Vite `?worker&inline`) running the SoA sim and posting dirty ranges back as transferables. Revisit only if the stress test shows sim above 4 ms/frame on the weak tier after P2/P6.

### P17: GPU verlet skeleton (future visual upgrade)
- **Impact 5 · Effort XL**
- **User-visible:** true soft-body behaviour: branches with inertia that whip on kicks and settle, with chains of springs from the root.
- **Design:** a TSL compute pass (WebGPU only) over segment endpoints with parent links (`parentIdx` per segment), a Verlet integration plus distance constraints (2–4 iterations), writing displaced endpoints into a storage buffer that the P6 vertex shader reads in place of `motion()`. WebGL2 falls back to the P7 analytic motion.
- **Risks:** a WebGPU-only look difference, and it needs a parent graph (fusion makes it a DAG). Future work.

---

## 5. Expected gains (weak-laptop estimates, UHD 620 class, 60k segments, random species, default look)

| Stage | CPU/frame | Upload/frame | GPU vertex/frame | Notes |
|---|---|---|---|---|
| v15/v19 today | 8–35 ms (fill- and wild-dependent) + 20–60 ms season/capacity hitches | 10–27 MB | ~10–17 M invocations | auto quality blurs the image and does not fix it |
| + P1, P2, P3, P4 (all S) | 2–6 ms | < 0.2 MB | ~6–9 M | about 2–4× headroom, low risk, a few days |
| + P5 | same | same | ~3–5 M | |
| + P6, P7 | 1–3 ms at any N | < 50 KB | ~3–5 M at 60k; ~8–12 M at 150k (Medium tier) | budget 150k weak / 500k–1M good GPU: **the 10×** |
| + P8 | holds 60 fps by trading detail, not sharpness | | | |

---

## 6. Porting notes for the v0.19 JS patches (so performance work does not regress features)

- `music-focus.js` `refreshMusicFocus`/`focusLevel`: replace with the shader freshness term (P7). Keep the `musicFocus`/`musicTrail` controls as uniforms. Remove the 800-per-frame `writeColor` sweep.
- `soft-growth.js` / `soft-species-extra.js`: port `softFormXYZ` to TSL (P9). Delete the `writeSeg` wrapper and the per-plant meshes and materials. `syncSoftMaterial` becomes per-kind material selection.
- `stage-motion.js` `updateBounceBounds`: keep it (already sampled). Replace the soft-mesh `computeBoundingBox` calls with analytic bounds.
- `cinematic-camera.js`, `calm-camera.js`: no performance issue. The locked still camera not framing growth is a camera/UX concern for the camera lead; the P2 incremental centroid/radius statistics give it a cheap, always-current bound to frame.
- `patch_performance.py` changed recording to MediaRecorder. P13 provides a CFR alternative that also removes the real-time dependency.

---

## 7. Recommended top 8, in priority order

1. **P1: Dirty-range uploads + write only the changed meshes** (impact 8, S). Removes 10–27 MB/frame of uploads with a local change in `writeSeg`/`writeColor` plus one flush. Largest win per line of code, and no visual risk.
2. **P2: Spatial hash + incremental statistics for the O(N) queries** (impact 8, S–M). Removes the `nearestEndpoint` cliff (7–600 ms/frame) and the other full scans. Makes high fill rates safe.
3. **P0 + P3 + P4: Measurement HUD/stress test, indexed geometry, controls cache and GC hygiene** (impact 6, S). A proper benchmark for v20, about 40% less vertex work, and smooth Liquid normals as a bonus.
4. **P6: GPU-driven compact segments** (impact 10, L), done with **P5** per-kind lists and **P12** SoA store. The architectural 10×: 48 B records, transform and growth in TSL, a plant table for colour, live-editable thickness/nodes.
5. **P7: Motion and music reaction in the shader** (impact 9, M). Every segment sways and pulses with the music at zero CPU cost. The performance work that most directly answers "make it an obvious music visualiser".
6. **P8: Adaptive quality 2.0 (+ optional 60 fps cap)** (impact 8, M). Weak laptops stay sharp at 60 fps by trading geometry, sim caps and effects instead of resolution. The tier is locked during recording.
7. **P10: Hitch-free capacity and pipeline warm-up** (impact 6, S–M). No 100–300 ms freezes at 20k/40k segments, or on first use of a species or shader, mid-set or mid-recording.
8. **P9: Soft species on the GPU** (impact 6, M). Liquid and Silk become smooth, high-res and 60 fps. Fixes the faceted-blob look the lead observed, and removes the per-vertex JS and `computeVertexNormals`.

Honourable mention: **P13** (deterministic offline "render take") is the strongest fix for the owner's stutter-free-recording demand. It belongs with the recording lead, but P4's control snapshot and a seeded RNG should be designed in from the start of the P6 refactor.

Suggested sequencing:
- v0.20.0: P0, P1, P2, P3, P4, P10-lite (no material rebuild on growth). Low risk, shippable fast, and measurable with the stress test.
- v0.21: P5/P6/P12/P7 as one branch with a `?legacyRender` fallback.
- Then P8 and P9, then P11/P13 as needed.
