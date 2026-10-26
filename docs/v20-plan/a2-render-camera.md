# A2 — Organism engine: rendering, camera, shell, morph, video, lights, env, post

Scope: `C:\Users\User\Desktop\code\growth-midi-visualiser\src\midi\engines\organism.ts` (TS source, v0.15.0, three r185.1) and `src\midi\shaders.ts`, cross-checked against the v0.19.0 compiled patch lineage in `C:\Users\User\Downloads\growth-v0190` (bundle `assets/index-BWYXfAkm.js`, modules in `maintenance/*.js`).
Line numbers are TS source lines. "v19:" notes say whether the patch lineage touched the issue.

I verified the three.js internals that several findings depend on in `node_modules/three/build/three.webgpu.js` (r185.1):
- Attribute uploads write the WHOLE buffer when `updateRanges` is empty (WebGPU `device.queue.writeBuffer(buffer, 0, array, 0)` around line 81165; WebGL `gl.bufferSubData(bufferType, 0, array)` around line 67102).
- `createInstanceMatrixNode` (line ~18309) takes the storage path for `StorageInstancedBufferAttribute`, and otherwise a uniform or instanced-attribute path.
- three's `Mesh.raycast` and three-mesh-bvh's `acceleratedRaycast` both cull triangles by `material.side`: FrontSide culls back faces and BackSide culls front faces.

---

## Findings, most severe first

### 1. CRITICAL (perf): every frame re-uploads the full instance buffers of 6 to 7 meshes at CAPACITY size
**Where:** `writeSeg` 1717–1773 (`mm.instanceMatrix.needsUpdate = true` at 1744, 1756, 1771–1772). `writeColor` 1687–1701 (six `instanceColor.needsUpdate = true`). `makeInstanced` 716–727. `growCapacity` 704–714.
**Scenario:** any frame where a single segment grows, retracts, sways or gets recoloured. That covers every frame while music plays. Every `writeSeg` flags the matrix buffers of segMesh, segRib, segCrys, leafMesh, sphereMesh and cubeMesh. Every `writeColor` flags all six colour buffers. None of them sets `updateRanges`, so three uploads `cap × 64 B` per matrix buffer and `cap × 12 B` per colour buffer. `cap` is the allocated capacity, not `segs.length`.
- At cap = 80k: 6 × 5.1 MB of matrices plus 6 × 0.96 MB of colours comes to about 36 MB per frame, or about 2.2 GB/s at 60 fps.
- At cap = 160k–250k: about 72–115 MB per frame. No integrated GPU sustains that.

This is almost certainly why dense scenes crawl on weak laptops. It also explains why auto-quality (which only lowers the pixel ratio) does not recover the frame rate (see #19).
**Evidence:** three r185 `updateAttribute`/`updateBinding` fall back to full-array `writeBuffer`/`bufferSubData` when `updateRanges.length === 0`. Nothing in the TS or the v19 app code calls `addUpdateRange` (the 3 hits in the bundle are three internals).
**Fix (incremental):**
- Track a dirty `[min,max]` instance range per mesh during the frame (update it in `writeSeg`/`writeColor`/`removeSeg`).
- At the end of `frame()`, before `draw()`, call `attr.clearUpdateRanges(); attr.addUpdateRange(min*16, (max-min+1)*16)` (×3 for colour), and set `needsUpdate` only on meshes that were actually touched. Leaf and node meshes need updating only when their instance changed.
- A tighter variant: keep a small list of dirty spans and coalesce them. Growth writes cluster at the tail, and `deform` writes cluster around recent indices.
- Even `addUpdateRange(0, segs.length*16)` alone saves up to 50% right after every capacity doubling.

**Fix (structural, larger win):** give each mesh type its own instance pool (see #22). Also consider moving segment growth onto the GPU: store `a`, `b`, `r`, `bornTime`, `rate` once per instance, and let a TSL `positionNode` compute the matrix from `time`. The CPU then writes a segment twice (spawn and finish) instead of every frame.
**v19:** not addressed.

### 2. HIGH (bug): shell looks "solid" and "silhouette" break containment and skin mode (raycasts inherit the display material's `side`)
**Where:** `shellMaterial` 1413–1441 (look 5 = `MeshStandardMaterial`, default FrontSide; look 6 = `side: BackSide`). Consumers: `inside` 1448–1457, `bounce` 1460–1476, `projectToSurface` 1238–1267, skin samples 1203–1212.
**Scenario A (solid, contain mode):** a point inside the shell casts `rayDir`. The only surface ahead is a back face, and FrontSide culls it, so there is no hit. `inside()` then returns `shellInvert` (false), meaning "outside".
- `newPlant` tries `randomPointInside` 40 times, fails every time, and falls back to (0,0,0).
- `startSegment` finds `b` outside, bounces, is still outside, heads to the centre, is still outside, and calls `dropTip`.

Net effect: **nothing grows** inside a solid shell.

**Scenario B (silhouette):** from outside, the entering front face is culled and the far exit face is hit, so `exiting` is true and the point counts as inside. Growth leaks out of the model along `rayDir`. Skin projection snaps to far-side faces, so growth teleports across the model.
**Fix:** decouple physics from display.
- Raycast against a collider that always uses a `DoubleSide` material. One way: keep the shell group for display and build a parallel hidden collider group that shares the geometries/BVH with a single DoubleSide `MeshBasicMaterial`, placed on a layer the camera does not render. Point `inside`/`bounce`/`projectToSurface` at that group.
- Alternatively, temporarily set `side = DoubleSide` on the shell material around ray queries. That is fragile.

**v19:** not addressed (the rebuildShell code is unchanged in the bundle).

### 3. HIGH (bug): the "inverted normals" sanity test can never fire, so flipped, mirrored or open models misclassify every point
**Where:** `rebuildShell` 1196–1201: `this.inside(this.v3.set(1e3, 37, 11))`.
**Scenario:** the ray starts at (1000, 37, 11) and travels along `rayDir` = (0.31, 0.72, 0.62) normalised. That is away from the model, so it hits nothing and `inside` returns `shellInvert`, which is still false. Inverted winding is therefore never detected. For a model with flipped winding, including GLB nodes with a negative-scale mirror (common in Blender exports) where `face.normal.transformDirection(matrixWorld)` also flips, every interior point reads as "outside". The result is the same as #2A: nothing grows inside the model.
**Evidence:** geometry of the ray; `inside` returns `this.shellInvert` on a miss (line 1453).
**Fix:**
- Test orientation with rays aimed AT the model. From `far·d` toward the origin for about 8 random `d`, take the first hit. A correctly wound surface gives `n·dir < 0` (front face). Majority-vote to set `shellInvert`.
- Handle `matrixWorld.determinant() < 0` per mesh by negating the normal.
- Better, replace ray parity with the three-mesh-bvh query `bvh.closestPointToPoint(localP)` plus the sign of `(p − closest)·faceNormal`. That handles open and self-intersecting GLB parts far better.
- For robustness on non-manifold models, vote over 3 fixed directions in `inside()`.

**v19:** not addressed.

### 4. HIGH (perf): rigged / skinned models make every containment and skin query a full CPU skinning pass
**Where:**
- `rebuildShell` 1103–1111 (BVH is skipped for SkinnedMesh).
- `inside` 1448, `bounce` 1460, `projectToSurface` 1238 (10 rays per call).
- `randomPointInside` 1478 (up to 40 `inside` calls).
- Skin samples 1203–1212 (400 rays on every rebuild).
- `newPlant` skin placement 1614–1617 (up to 12 × 10 rays).

**Scenario:** load a 30–60k-triangle rigged GLB, choose skin mode, play. Each ray on a SkinnedMesh goes through three's skinned `_computeIntersections`, which skins every triangle's vertices on the CPU. A single ray costs milliseconds. `projectToSurface` fires 10 rays per segment start, and there are hundreds of segment starts per second. The frame time collapses to seconds, and each `shellSize` slider tick stalls the UI (400 skinned rays).
**Fix:** bake the animated pose into a static proxy geometry at 10–15 Hz and `refit()` its BVH. three-mesh-bvh's `StaticGeometryGenerator` does exactly this for skinned meshes. Raycast only against the proxy, and take the skin normal from the proxy too, because `face.normal` on a SkinnedMesh is the bind-pose normal (line 1265). Also reuse an intersections array: `ray.intersectObject(obj, true, this.hits)` with `hits.length = 0`, to stop allocating arrays and Intersection objects per ray.
**v19:** not addressed.

### 5. HIGH (bug, music visibility): `deform()` assumes segments are ordered by age; swap-removal breaks that, so wild sway and pulse silently stop and segments snap back
**Where:** `deform` 2103–2111 (`if (!young && !physics && !nerves) break`, "newest first"). `removeSeg` 1703–1714 swaps the last segment into the freed slot.
**Scenario:** wild > 0, physics off. Once anything retracts or is recycled, which happens constantly near the budget, `removeSeg` moves the newest segment into an old, low index. The backwards loop hits an old segment at the tail region and `break`s, so relocated young segments are never swayed or pulsed again.
- Relocated segments that are still growing get rewritten undisplaced by the growth loop (2394), so they visibly jump from their swayed pose back to rest.
- Over a long set, a growing fraction of young growth stops reacting.

**Fix:**
- Keep a separate `young: Seg[]` list: push in `addSeg`, prune by `t - born > 9`, and remove on `removeSeg` via a `seg.youngIdx` back-pointer.
- Iterate that list for sway and pulse. Keep the strided full pass only for physics and nerves.

**v19:** not addressed.

### 6. HIGH (bug): kick, shake and wild-shake mutate the camera STATE, so they are frame-rate dependent and accumulate
**Where:** 2673 (`this.camPos.add(... wild*onset*0.25)`), 2679 (`camPos.lerp(camLook, min(0.5, 0.2*kick*hitEnv))`), 2680 (shake adds random to `camPos`).
**Scenario:** the offsets are applied to `camPos` every frame without `dt`, and the mode smoothing (e.g. `1-exp(-dt*6)` at 2605) then has to pull them back.
- **Frame-rate dependence:** at 120 Hz the kick is applied twice as often, so the punch is roughly twice as strong as at 60 Hz. At 30 fps (weak laptop, or while recording) it is half as strong. Shake is a random walk, so its amplitude also varies with frame rate.
- **Accumulation:** with dense drums `hitEnv` stays around 0.8. The per-frame kick fraction (~0.08) is comparable to the per-frame restore (~0.095 at 60 fps), so the camera settles at about half its distance and stays zoomed in.
- **Side effects:** because `camPos` is state, `camFwd` and `growAtCam` root placement inherit the jitter.

**Fix:** keep `camPos`/`camLook` as clean smoothed state and apply music offsets only when setting `camera.position`/`camera.fov` for this frame:
- `camera.position = camPos + (camLook − camPos) · kickAmt·hitEnv + shakeVec·bassS`.
- `shakeVec` should be smooth noise (sin sums of `t`), not `Math.random` per frame.
- Optionally add an FOV punch: `camera.fov = 48 − 6·kick·hitEnv`, then `updateProjectionMatrix` when it changes.

This gives an obvious, bounded, frame-rate-independent music punch.
**v19:** `calm-camera.js` sets `kick=0`, `shake=0` and `calmCamera=1` by default. That hides the bug but also removes the most legible music reaction, which matches the lead's "much less obvious" observation. Port the offset-based version and turn the punch back on by default at a moderate level.

### 7. HIGH (design/UX): the camera does not frame the action (outlier-driven radius, aspect-blind distance, and v19's frozen "still" pose)
**Where:** centre/radius 2575–2591, orbit distance 2598. v19: `calm-camera.js` (`setCalmCamera('still')` → `toggleCameraLock()`), `music-focus.js` `applyCameraLock`, `simple-ui.js:32`.
**Scenario A (outliers):** `r2 = max over ALL segments of |a − centre|²`. One long lightning bolt, a nested child, a text plant placed in front of the camera (`growText` 2256), or a stray bounds-none shoot sets the orbit distance. The organism then shrinks to a dot.
**Scenario B (aspect):** `targetDist = (radius·2.1 + 5)/zoomNow` ignores FOV and aspect. In portrait or 9:16 output, the horizontal half-FOV is about 14° instead of about 38°, so a fit needs about 4.1·r and anything wider than the centre is cut off. That matters for social-video exports.
**Scenario C (v19 Simple mode):** Simple mode calls `setCalmCamera('still')`, which captures the pose once at startup (camPos (0,2,12) looking at the origin, visible half-height about 5.3 units). Growth spans up to ±`size` = 14 (plus ribbons, see #17), so it grows out of frame. That is the "Silk ribbons grow mostly out of frame" observation. The pose persists across Reset (`music-focus.js` line 55–57).
**Scenario D:** the centroid is the mean of every `a` endpoint, which is dominated by old permanent skeleton, not by where the music is creating growth now. `newCenter.lerp(b, 0.06)` per added segment is rate dependent: at high fillRate it jumps; with many concurrent plants it jitters.
**Fix:**
- Maintain two bounding spheres incrementally:
  - Whole organism: running sum of endpoints updated in `addSeg`/`removeSeg` (O(1) centroid, no per-frame pass), plus a strided robust extent such as the 90th-percentile distance over ≤512 samples, like v17's wide-pulse stride at `cinematic-camera.js:41`.
  - Action: a recency-weighted sphere of segments born in the last ~3 s. Include soft-mesh bounds and text plants.
- Fit distance with FOV and aspect: `d = R / sin(min(vHalf, hHalf))` plus a margin, where `hHalf = atan(tan(vHalf)·aspect)`.
- Drive camPos with a critically damped spring on distance and target, which does not overshoot like stacked lerps.
- Redefine "Still" as fixed orientation, no audio motion, but slow auto-dolly and re-centre (a "framed still"). Keep the hard lock only as an explicit user action.
- Replace the unconditional 2.1·r with a user "framing: tight ↔ wide" slider.

### 8. HIGH (reliability): no WebGPU device-lost or WebGL context-lost handling
**Where:** `mount` 578–583. There is no `renderer.onDeviceLost` and no `webglcontextlost` listener, in the TS or in the v19 app code (the 5 bundle hits for `onDeviceLost` are three internals).
**Scenario:** a GPU driver reset (Windows TDR under heavy load, which is likely given #1), sleep/wake, or dual-GPU switching on a MacBook in the middle of a live set. The canvas goes black permanently, with no status message and no recovery. The only way out is a page reload, which loses the growth and any session-only model.
**Fix:** set `renderer.onDeviceLost = (info) => { setStatus('GPU reset — restoring…'); remount }`. Remount the engine with its current `controls` (main.ts `selectEngine`), keep the loaded `models`, and re-add the shell. Also consider `powerPreference: 'high-performance'` in the `WebGPURenderer` options, so dual-GPU laptops pick the discrete GPU where the browser honours it.

### 9. HIGH (perf): capacity doubling rebuilds every material and geometry, recompiling pipelines exactly when the scene gets busy; it also leaks materials
**Where:** `growCapacity` 704–714 → `buildMeshes` 663–701 → `applyShaders()` + `rebuildEnv()` 697–700.
**Scenario:** at 20k→40k→80k→160k segments, `buildMeshes` disposes and recreates all 7 geometries and 4 node materials. It then calls `applyShaders`, which builds a new growth-shader material, and `rebuildEnv`, which builds a new floor material and geometry. WebGPU compiles new pipelines, typically 100–800 ms with `mx_fractal_noise` shaders, and then re-files every segment (`writeColor` + `writeSeg` × n). The result is a visible freeze at dense musical moments, and a stutter in recordings.
**Leaks:**
- When a growth shader is active, `mesh.material` is the shared `shaderMat`, so the 4 base materials in `baseMats` are never disposed. `dispose()` is instead called on `shaderMat` three times.
- `rebuildEnv` removes the floor and ceiling (820–821) but never disposes their geometry or material. That leaks on every env change and every doubling.

**Fix:**
- Create the materials once and reuse them across reallocations. Only swap `instanceMatrix`/`instanceColor` buffers, or allocate at `budgetCap()` from the start: the attribute is only uploaded up to its dirty range once #1 lands.
- Do not call `applyShaders`/`rebuildEnv` from `buildMeshes`.
- Pre-compile with `await renderer.compileAsync(scene, camera)` after mount and after shader switches (see #25).

### 10. MEDIUM-HIGH (bug, visual): `reactify` pushes vertices along `normalLocal`, so cubes and crystals crack open on every bass hit
**Where:** `shaders.ts` 56–63 (`positionLocal.add(normalLocal.mul(uPulse))`). Meshes: BoxGeometry cubes (organism.ts 678–682), squashed OctahedronGeometry crystals (691–693). Both are non-indexed with per-face normals.
**Scenario:** pulse > 0 (default 0.6) plus bass or hits. Each face's vertex copies move along that face's own normal, so the faces separate and dark seams open on rocks, crystals, lightning (crystal skin), snowflake and every cube node, in time with the beat. The same effect happens on the flat-shaded `cubeMesh`.
**Fix:** for these centred convex primitives, scale instead of offsetting: `positionLocal.mul(vec3(uPulse.add(1), 1, uPulse.add(1)))` for tubes, ribs and crystals, and a uniform scale for nodes. Alternatively displace along `normalize(positionLocal.xz)`. Tubes keep their exact thickening behaviour. Also, the comment on `uPulse` says "world units", but the value is in instance-local units, so it is a relative 0–18% swell. Document it, and consider raising the ceiling so hits read clearly.

### 11. MEDIUM-HIGH (UX): manual camera is unreachable on a Mac trackpad; no touch; wheel is dead in most modes
**Where:** pointer handlers 609–645.
**Scenario:**
- Orbit is middle-drag only (button 1). A MacBook trackpad has no middle button, so the owner cannot orbit by hand. v17's Shift+middle pan still needs a middle button.
- Left-drag on the canvas does nothing. I found no other left-click use of the stage in `main.ts`.
- There is no touch or pinch handling, and no `touch-action: none` on the canvas, so a pinch zooms the whole page UI.
- `zoomMul`, `manTheta`, `manPhi` and `pan` are only read in orbit mode (2595–2606) and in v17's cinematic modes. In weave, tunnel, drift, sit and chase, dragging and the wheel silently do nothing.
- `deltaY` is not normalised for `deltaMode === 1` (Firefox line mode, ~3 per notch), so Firefox wheel zoom barely moves.

**Fix:**
- Map left-drag to orbit and Shift+left or right-drag to pan.
- Add two-finger pinch/rotate via pointer events, plus `touch-action: none` on the canvas.
- Double-click resets the manual offsets.
- Apply `zoomMul`/`pan` as generic offsets in every mode.
- Normalise the wheel with `deltaMode` (×16 for lines, ×innerHeight for pages).

**v19:** v17 fixed pan direction (camera up, actual distance) and added `lostpointercapture` (`patch_performance.py` lines 254–258). Port those two edits as well.

### 12. MEDIUM (bug): the tunnel cull can delete a tip's live segment; later writes then corrupt another instance. The cull is also O(n²)
**Where:** tunnel cull 2630–2638 → `removeSeg` 1703–1714. Growth loop 2389–2394.
**Scenario:** camMode = tunnel. Tips of held plants that fall 25 units behind the camera keep their `tip.seg`, and the cull removes that segment. `removeSeg` gives its slot to `last`, but the removed `seg.idx` is left unchanged. The next frame, the tip does `seg.growth += …; writeSeg(seg)` into the slot now owned by `last`, which overwrites that segment's matrix (flicker or ghost segment) until the tip finishes. `finishSegment` then continues from a dead segment. Also, each `removeSeg` does `plant.segs.indexOf` + `splice` (1712–1713). A cull of 5k segments from a 12k-segment plant costs about 60M operations, a hitch every 30 frames.
**Fix:**
- Give `Seg` a `tip` back-pointer, or on removal scan the owning plant's tips and drop any tip whose `seg === removed`.
- Set `seg.idx = -1` and make `writeSeg` a no-op for `idx < 0`.
- Store `seg.pIdx` (index in `plant.segs`) and swap-remove there too. Plant order only matters for "newest first" retract, which can use `born`.

### 13. MEDIUM (bug): sky shaders are evaluated in world space while the sky sphere follows the camera
**Where:** `shaders.ts` ENV shaders 220, 235, 247, 258, 273, 286 (`const d = normalize(pw)`, where `pw = positionWorld`). organism.ts 809–811 (radius 180) and 2541 (`sky.position.copy(this.camPos)`).
**Scenario:** `positionWorld = camPos + 180·dir`, so `normalize(pw)` is the view direction only when `camPos ≈ 0`.
- In orbit at 35 units, the directions skew by up to ~11°. Stars, nebula and aurora slide non-rigidly as the camera orbits instead of sitting at infinity.
- In tunnel mode `camPos` grows without bound (~1.5 u/s). After about 2 minutes `normalize(pw)` collapses toward the heading, and the starfield and grid horizon smear into a streak.
- Separately, the sky position is copied before the camera update, a one-frame lag.

**Fix:** use `normalize(positionLocal)`. The sphere is centred on the camera, so its local position is the direction. Alternatively use `positionWorld.sub(cameraPosition)`. Move the `sky.position` copy after the camera block.

### 14. MEDIUM (bug): snapshots are blurry under auto-quality, can exceed GPU texture limits, and resize the canvas under a running recording
**Where:** `snapshot` 889–899.
**Scenario A:** auto-quality has dropped `pixelNow` to 0.5, so a "2×" still renders at 1.0× CSS size, a soft image from a weak laptop.
**Scenario B:** on a 2560-wide CSS window at dpr 2, 2× gives 10240 px, above WebGPU's default `maxTextureDimension2D` of 8192, which raises a validation error or device loss (see #8).
**Scenario C:** a still taken during a recording resizes the captured canvas mid-take, which is the exact thing `lockQuality` exists to prevent. There is also a race: the auto-quality step in a concurrent `frame()` can change `pixelNow` between the resize and the restore, and then `was` is restored.
**Fix:**
- Base the ratio on `min(quality, dpr) × scale` (not `pixelNow`) and clamp it to `renderer.backend` limits (`device.limits.maxTextureDimension2D` / `gl.MAX_TEXTURE_SIZE`).
- During a recording, render the still into a `RenderTarget` and read it back with `renderer.readRenderTargetPixelsAsync` into an OffscreenCanvas, leaving the visible canvas untouched. Or refuse the still with a status message.
- Set `lockQuality` for the duration of the snapshot.

### 15. MEDIUM (bug): `resize()` ignores `lockQuality`, and v17 capture produces arbitrary, odd output sizes
**Where:** `resize` 729–739. main.ts 1146 (`window.addEventListener('resize', …)`). v19 `recording-ui.js` (`captureRatio = min(4, target/height, 3840/width)`).
**Scenario:**
- Resizing or moving the window across displays (dpr change) during a take changes the recorded stream's resolution, which is one cause of files that stutter or fail in Resolve and QuickTime. v17 notes admit "Resizing the browser during recording is not locked".
- v17's pixel-ratio approach yields sizes like 1727×1080 or odd widths, which H.264 encoders pad or reject. Chrome MediaRecorder silently crops or scales.

**Fix:** add an engine API `setOutputSize(w, h | null)`. While it is set, `resize()` keeps the drawing buffer at exactly w×h (even numbers, e.g. 1920×1080 or 1080×1920), uses `setSize(w, h, false)`, and lets CSS letterbox. The camera aspect comes from w/h, not the window. Recording and stills use this, so window changes only affect CSS.

### 16. MEDIUM (perf/bug): `rebuildShell` runs on every slider tick; it is expensive and leaks geometry and BVHs, including during `shellCycle`
**Where:** `setControl` 764 (`shell`/`shellSize`/`shellLook` all trigger a full rebuild). `rebuildShell` 1072–1213. `smoothNormals` 253–293. Shell cycle 2306–2334.
**Scenario:**
- Dragging `shellSize` with a 150k-vertex model runs, per input event: `smoothNormals` (one template-string key and Map lookup per vertex, ~150–400 ms), `computeBoundingBox`, three `Float32Array(n)` allocations, 400 skin-sample raycasts, and the inversion test. The panel stutters.
- Every rebuild of a built-in shape creates a new `SphereGeometry`/`BoxGeometry`/… and computes a new BVH. The old geometries and BVHs, and the old group's meshes, are never disposed.
- With `shellCycle = 10` s across a 3-hour set, that is about 1,000 leaked geometries plus their BVHs and GPU buffers.

**Fix:**
- `shellSize` → only rescale the group (`s`, position, `shellBase`) and regenerate skin samples lazily.
- `shellLook` → only swap the material.
- Cache the built-in geometries and their BVHs per kind (they are unit-sized).
- Cache `nrm/phY/phR/rnd` per geometry in the existing `geomBase` WeakMap.
- Replace the string keys with `BufferGeometryUtils.mergeVertices` or a numeric spatial hash.
- `disposeBoundsTree` + `dispose` on unmount.

### 17. MEDIUM (bug, v19-only): "Liquid" renders faceted, and ribbon/blanket soft meshes ignore the skeleton and the camera
**Where:** v19 `maintenance/soft-growth.js` 32–34 (`new kp(1,2)` = `IcosahedronGeometry(1,2)`), 72 (`computeVertexNormals` at 15 Hz), 52–57 (ribbon `y = along`, straight up from `plant.root`).
**Scenario:**
- `IcosahedronGeometry` is non-indexed (80 × 4 = 320 faces, each with its own three vertices). `computeVertexNormals` on non-indexed geometry therefore yields flat face normals, the low-poly faceted blobs the lead saw.
- The size reaches up to 8, with radius 3.6 on 320 faces, so the silhouette is also visibly polygonal.
- Ribbons and blankets are built in plant-local +Y from the root, up to `size·2` = 16 units, regardless of where the skeleton grows. Camera framing (#7) uses skeleton segments only, so the fabric leaves the frame.
- Normals are recomputed at only 15 Hz while positions update at 30 Hz, so the shading lags the shape.

**Fix:**
- Short term: `mergeVertices(new IcosahedronGeometry(1, 4))` (indexed, 5k tris), or an indexed `SphereGeometry(1, 48, 32)`. Move the deformation into a TSL `positionNode` with analytic normals (radial displacement of a sphere), so there is no CPU loop and no `computeVertexNormals`.
- Real liquid: metaballs. three's `MarchingCubes` addon, fed by the plant's segment endpoints as balls, gives merging droplets that follow the growth.
- Ribbons: sweep along a `CatmullRomCurve3` through the plant's `seg.b` points (a strip version of `TubeGeometry`), so they grow organically where the skeleton grows.
- Add the soft-mesh bounding spheres to the camera-framing sphere.

### 18. MEDIUM (bug): Reset during the "reverse" cycle leaves `reversing = true`, so held keys un-grow after Reset
**Where:** `clear` 749–760 (does not touch `reversing`/`cycleT`). Growth loop 2380. Retract loop 2441, 2459–2462.
**Scenario:** cycleMode = reverse. Press Reset during the reverse half. New notes spawn, but `if (this.reversing) continue` stops them growing, and the retract loop unwinds them at `retract·6` for up to `cycleEvery` seconds. It looks as if the app is broken right after Reset.
**Fix:** in `clear()`, reset `reversing = false`, `cycleT = 0`, `shellCycleT = 0`, `hitEnv = bassS = explEnv = 0` and `spawnRate = 0`, and call `restoreShell()` if `morphed`.

### 19. MEDIUM (design/perf): auto-quality only lowers the pixel ratio, which does not help CPU- or upload-bound frames
**Where:** 2721–2734.
**Scenario:** when a dense scene is bound by #1, #25 or `nearestEndpoint` (see the cross-scope notes), lowering resolution does not raise fps. The ratio ratchets to 0.5 and stays there, so the output (and any recording started now, with the ratio locked) is blurry while fps stays low.
- Every step calls `setPixelRatio`, which calls `setSize` internally, and then `resize()` calls `setSize` again. That is two swapchain and bloom-target reallocations per step.
- With the 45/57 hysteresis on a 60 Hz display, it can oscillate.

**Fix:** a tiered governor on measured CPU frame time (`performance.now()` around `frame()` body) versus total frame time:
- GPU-bound: lower the pixel ratio, turn bloom off, then shadows off.
- CPU-bound: reduce the deform stride, lower `fillRate`, stop leaf and node meshes past N instances, lower `maxLive`.
- Never go below ~0.75 while recording.
- Call `setPixelRatio` once, not `setPixelRatio` then `resize()`.

### 20. MEDIUM (perf): morph modes 2–5 run a CPU per-vertex loop, a full-geometry upload and a full BVH refit every frame; boil and spikes tear STL/OBJ meshes
**Where:** `morphShell` 1340–1359. Table build 1153–1160.
**Scenario:**
- For a 150k-vertex model at 60 fps: 150k × sin, a 1.8 MB position upload, and a `boundsTree.refit()` (O(tris)) every frame. The explode mode keeps looping even when `explEnv ≈ 0`.
- `phR` and `rnd` are random per raw vertex, but STL and most OBJ files are non-indexed, so coincident corner vertices get different random values. In boil, spikes and explode, the surface splits into loose triangles. `smoothNormals` deduplicates for the normals, but these tables are not deduplicated.

**Fix:**
- Put the displacement in the shell material's TSL `positionNode` (same formulas; per-vertex attributes `phR`/`rnd`) so the display costs no CPU.
- Refit the BVH at ≤10 Hz, and only when the shell is used for physics (contain or skin).
- Skip the loop when `amt ≈ 0`.
- Derive `phR`/`rnd` per deduplicated slot (reuse the `slot` array from `smoothNormals`).
- Show a status message when morph is unavailable (`verts > 150000`) instead of silently doing nothing.

### 21. MEDIUM (bug): skin mode leaks when projection fails, and uses a stale `lastHit` for attach
**Where:** `startSegment` 1967–1973. `newPlant` 1614–1623.
**Scenario:**
- When `projectToSurface` returns false (thin parts, or a model larger than `shellSize·4` ray reach), `b` stays unprojected. The size-sphere bound is skipped (`!this.skin` at 1989), so the tip walks off into space permanently.
- In `newPlant`, if all 12 projections fail, `this.lastHit` still holds a hit from an earlier call, possibly on a previous shell's mesh. The plant then attaches to that stale mesh and vertex, and `animateModel` drags it by that vertex's motion.

**Fix:** drop the tip (or fall back to `bounce`) when projection fails. Set `this.lastHit = null` before the placement loop and attach only when a projection succeeded.

### 22. MEDIUM (perf/design): every segment occupies a slot in all 7 meshes, most of them holding zero-scale matrices
**Where:** `writeSeg` 1741–1772 (writes `ZERO_M` into the non-selected tube meshes, the leaf mesh and the other node mesh). Visibility flags 2485–2504.
**Scenario:** in a mixed scene (roots plus crystals plus a leafy species), segMesh, segRib, segCrys, leafMesh, sphereMesh and cubeMesh are all visible and all draw `segs.length` instances. Most of those are degenerate, but they still cost vertex shading (e.g. 80 triangles per icosphere × every segment). Memory is 6 × cap × 76 B, about 114 MB of CPU arrays at a 250k budget, mirrored on the GPU. That is heavy for integrated-GPU laptops with shared memory.
**Fix:** allocate an independent index per mesh type, with a free-list or swap-remove per pool. Store `seg.tubeIdx`, `seg.nodeIdx` and `seg.leafIdx` (−1 when unused). Each mesh then draws only its real instances. Combined with #1, this cuts upload and vertex work several-fold.

### 23. MEDIUM (design, music visibility): bloom is off by default and does not react to hits; there is no tone mapping, so flashes clip
**Where:** control `bloom` value 0 (428). `draw` 871–879 (`strength·(0.5 + 0.7·sustain)`, where `sustain` is a 0.6 /s slow EMA). The renderer's default `NoToneMapping`. `uFlash` up to about 1.25× diffuse as emissive (2535).
**Scenario:** in a black void, bloom on tips and flashes is the cheapest strong "music visualiser" cue, but it is off. When it is on, it only follows slow sustained energy. Without tone mapping, emissive flash and tip colours (×1.6 + 0.35) hard-clip to white, and hues wash out on hits.
**Fix:**
- Bloom on by default at about 0.5 (auto-quality may drop it).
- `strength = base·(0.6 + 0.6·sustain + 1.2·hitEnv)`, and optionally dip the threshold on hits.
- `renderer.toneMapping = AgXToneMapping` (or ACES) with `toneMappingExposure ≈ 1`, so flashes bloom instead of clipping. Keep `toneMapped: false` on the tip glow if it is meant to stay hot.

### 24. MEDIUM (UX/bug): GLB loading has no DRACO/Meshopt/KTX2 decoders and throws away the model's own materials
**Where:** `loadShell` 1043–1047. `rebuildShell` 1106 (`m.material = mat`).
**Scenario:**
- Many Sketchfab and Blender GLBs are Draco- or Meshopt-compressed, and fail with "No DRACOLoader instance provided".
- A `.gltf` with external `.bin` files fails with a generic error, because it is parsed with an empty path.
- The model's textures and materials are overwritten and never disposed (a leak). An artist loading a textured sculpture cannot show it as is.

**Fix:**
- Register `MeshoptDecoder` (small, inline-able JS/wasm; fits the single-file constraint) and optionally a Draco decoder (wasm, inlined as a data URL for offline use).
- Give a clear message for multi-file glTF ("drop a .glb").
- Add a shell look "original" that keeps the loaded materials. Keep the originals in `LoadedModel`.

### 25. MEDIUM (perf): hot-loop allocations and linear `ctl()` lookups
**Where:**
- `writeSeg` 1741 (`for (const mm of [a,b,c])` allocates an array per call) and 1758 (`ctl('nodes')` on every write).
- `writeColor` 1693 (`new THREE.Color(1,1,1)` per call).
- `ctl` in engine.ts 79–82 is a `controls.find` linear scan (TS ~75 controls, v19 ~134 plus 37 species).
- `newPlant` 1583 (`this.segs.filter(s => s.growth >= 1)`, an O(n) copy of up to 250k entries on EVERY note-on).
- `frame` 2383 (`[...p.tips]` per plant per frame) and 2482 (`plants.filter` per frame).
- `seasons` 2174–2175 rewrites every segment's colour (plus full colour uploads) each time the phase moves 0.004. At seasons speed 1 that is every ~0.4 s.

**Scenario:** with physics on at 100k segments, `deform` calls `writeSeg` about 25k times per frame, which means 25k array allocations and 25k control scans per frame, plus GC pauses that show up as stutter in recordings.
**Fix:**
- Preallocate `this.tubeMeshes`, a module-level `WHITE`, and a `Map` or struct cache of control values refreshed in `setControl`.
- In `newPlant`, do rejection sampling of random indices (up to 8 tries for `growth >= 1`).
- Apply the season tint as a uniform in the material (hue, saturation and brightness in TSL) instead of per-instance rewrites.

### 26. MEDIUM (perf/UX): switching shaders freezes the frame while the new pipeline compiles; the growth shader breaks leaf double-siding
**Where:** `applyShaders` 783–813. `setControl` 768.
**Scenario:**
- A VJ switches the growth or sky shader live, and WebGPU compiles the pipeline synchronously on first draw (hundreds of ms for noise shaders). The hitch is visible on stream and in recordings.
- The shader material replaces the leaf material (794) but keeps the default FrontSide, while the base leaf material is `DoubleSide` (694). Leafy species (tree, moss, vines, fern, kelp) therefore lose every leaf seen from behind when any growth shader is active.
- Crystal and cube meshes lose `flatShading`.

**Fix:** build the new materials, `await renderer.compileAsync(scene, camera)` with them attached to hidden proxy meshes, then swap. Build per-mesh variants (`leaf: side = DoubleSide`; crystal/cube: `flatShading = true`) from the shader definition.

### 27. MEDIUM (bug): video backdrop keeps stale pixels and aspect when a second still or a different video is loaded; it is rebuilt on every slider tick
**Where:** `rebuildBackdrop` 989–1014. `frame` 2536–2539. `setControl` 767. VideoField `openImage` redraws into the same `still` canvas (videoField.ts 63–65).
**Scenario:**
- Load picture A, then picture B. `videoTex.image === src` (same canvas), so no new texture, and a CanvasTexture is never flagged `needsUpdate` again. The backdrop keeps showing A.
- `frame` only rebuilds when `!this.backdrop`, so the plane also keeps A's aspect while the relief uses B's `fieldSize()`, and the picture and growth drift apart.
- Every `video*` slider event (depth, edge, stick, show) disposes and recreates the mesh and material.

**v19:** addressed in `maintenance/reference-growth.js` 33–64. It keeps a persistent mesh (scale set from w,h; opacity and z updated in place) and uses a `field.revision` counter to set `videoTex.needsUpdate`. Port it and add `revision` to VideoField.

### 28. LOW-MEDIUM (visual): open-ended cylinders give visible cracks at bends for node-less species
**Where:** `buildMeshes` 676 (`CylinderGeometry(1,1,1,radial,1,true)`, open ended). Species with `node: 'none'`: lightning, sea fan, fern, brambles, plus the v19 soft species' fallback skeletons.
**Scenario:** consecutive segments meet at an angle, so a wedge-shaped gap opens on the outer side of each bend. From some angles you can also see into the tube through its open end (back faces culled). Lightning and brambles look like chains of pipes rather than continuous growth.
**Fix:**
- Extend each tube by `r·0.5` at both ends, or always write a tiny hidden joint sphere (scale `r`) even when `node: 'none'`.
- Longer term: bake finished, permanent chains into merged `TubeGeometry` meshes, one per plant, rebuilt on lignify. That gives smooth, continuous organic tubes and frees thousands of instances, a quality and performance win together.

### 29. LOW-MEDIUM (leak): `unmount` releases little besides instanced meshes and the renderer
**Where:** `unmount` 2776–2789. main.ts `selectEngine` creates a fresh engine per switch (231–267).
**Not disposed:**
- `post` (PostProcessing and its render targets)
- floor/ceiling geometry and material
- sky geometry and material (removed only)
- backdrop mesh and material
- `videoTex`: three's VideoTexture keeps a `requestVideoFrameCallback` loop on the shared VideoField `<video>` alive until `dispose()`, so every engine switch adds another loop
- shell groups, built-in geometries and BVHs (`disposeBoundsTree`)
- loaded model scenes, their textures and mixers
- `shellMat` and the points material

Also, if `renderer.init()` throws during `mount` (574–580), the appended canvas is left in the host.
**Fix:** a single `disposeAll()` that walks these objects. In `mount`, wrap init in try/catch and remove the canvas on failure.

### 30. LOW-MEDIUM (bug): camera far plane is fixed at 400
**Where:** 452. Orbit distance 2598–2602 (`dist·zoomMul`, `zoomMul` up to 5).
**Scenario:** with bounds = none, size 60 and the wheel zoomed out (`zoomMul` 5), the orbit distance passes 400 and the organism is clipped by the far plane. The 180-unit sky sphere can also end up between the camera and distant growth.
**Fix:** each frame, `camera.far = max(400, dist·zoomMul + radius·2 + 50)` (update the projection only when it changes). Scale the sky radius to `0.9·far`, or render the sky with `depthTest: false` first (`renderOrder = -1`) so it never occludes.

### 31. LOW-MEDIUM (bug): attach uses translation only and rewrites every segment of every attached plant every frame; `rebuildShell` makes attached growth jump
**Where:** `animateModel` 1289–1306. `newPlant` 1619–1623.
**Scenario:**
- With a mixer playing or morph on, each attached plant rewrites all of its segments every frame (up to 12k per plant). That is CPU heavy, and it also triggers #1 uploads.
- A rotating limb makes growth slide instead of rotating with it.
- After a `shellSize` change or shell cycle, the reused `model.scene` has a new scale, `vertexWorld` jumps, and attached plants teleport by the difference.

**Fix:**
- Store a per-plant offset in a small storage or uniform array indexed by a per-instance `plantSlot` attribute, and add it in the TSL `positionNode`. Moving a plant then costs one vec3 write.
- On `rebuildShell`, rebase `at.base` and zero `at.shift`.
- For rotation, attach to a triangle frame (3 vertices) and apply a rigid transform.

### 32. LOW (UX): the weave "cut on the bar" is a whip-pan, not a cut
**Where:** 2613 (`theta += 1.3`, then `camPos.lerp` at rate 4).
**Scenario:** beatLock is sold as "camera cuts on the beat", but the camera swings for about 0.5 s instead. **Fix:** on that frame, set `camPos`/`camLook` straight to the new path point (no lerp), so it reads as an editorial hard cut in time with the bar.

### 33. LOW (bug): the shadow camera is fixed at the origin; the key light direction stays wrong after leaving the shadow env
**Where:** `rebuildEnv` 842–853.
**Scenario:** the shadow box is ±`size·1.6` around the origin. Growth drifts with `center`/`newCenter` or grows with bounds none, and shadows clip off. After env = 3, `dirLight.position` stays at the shadow placement even after switching back to env 0, which changes the look. `castShadow` on up to 250k instances also doubles vertex cost.
**Fix:** re-centre the shadow camera on `this.center` about once a second and scale it with the framing radius. Restore `dirLight.position` (5, 9, 6) when shadows turn off. Let auto-quality drop shadows first.

### 34. LOW (bug): float precision drifts in long tunnel sessions
**Where:** tunnel 2621–2638 (`camPos` grows without limit).
**Scenario:** about 1.5 u/s × 3 h ≈ 16k units. float32 ULP at that range is about 0.002, so thin segments (r ≈ 0.01–0.02) shimmer.
**Fix:** a floating origin. When `|camPos| > 1000`, subtract the offset from every seg a/b, tip pos, plant root, centre, newCenter and camPos, and re-write the segments over a few frames.

### 35. LOW (design): `hasGpu` / `'gpu' in navigator` is used to choose the storage instance attribute
**Where:** 578, 721.
**Scenario:** `navigator.gpu` exists but the adapter request fails (blocklisted GPU, Linux Chrome), so three falls back to the WebGL2 backend while the meshes still get `StorageInstancedBufferAttribute`. It still renders through three's WebGL storage emulation (PBO texture path), but slower, and each full-buffer update (#1) becomes a full texture upload.
**Fix:** after `init()`, decide with `renderer.backend.isWebGPUBackend`. Show the active backend in the HUD, because it matters for support ("Safari/Firefox via WebGL2").

### 36. LOW (bug): saved shell index points at a session-only model; `rebuildShell('none')` leaves stale tables
**Where:** main.ts 255–256 restores `shell` before mount. `rebuildShell` 1082–1095.
**Scenario:** the settings saved `shell = 10` (a GLB from last session). On the next launch `this.models[1]` is undefined, so there is no shell, but the select shows a blank option. When `kind === 0`, `morphMeshes`, `skinSamples` and `shellTris` are left stale.
**Fix:** clamp `shell` to `BASE_SHELLS.length − 1 + models.length` on mount and on load. Clear the tables on 'none'.

### 37. LOW (quality): the video relief uses nearest-neighbour sampling, so growth zig-zags in z
**Where:** `fieldZ` 920–927 and `projectToField` 934–946 via `VideoField.idx` (videoField.ts 238–242, `Math.round`).
**Scenario:** the relief is stair-stepped at the analysis resolution. `projectToField` snaps `b.z` to the steps, and finite-difference normals with e = 1/96 flip between plateaus, so video-guided growth looks jagged.
**Fix:** bilinear `depth()`/`edge()` sampling in VideoField, which is cheap.

---

## Cross-scope notes (belong to other audits, but they dominate frame time here)
- `nearestEndpoint` (1895–1911) is O(total segments) per segment start for every species with `join > 0`. At 100k segments and 1,500 segments/s that is about 150M distance checks per second, the single largest CPU cost at scale. Use a uniform spatial hash (cell ≈ max join reach 3.5), updated in `addSeg`/`removeSeg`.
- `makeRoom`/`removeSeg` use `indexOf` + `splice` per removal (1712–1713), which is quadratic under heavy recycling. Store a per-plant index.

## What v19 already addresses in this scope
- Pan uses the camera's up vector and the real shot distance, plus `lostpointercapture` (`patch_performance.py` 254–258): port it.
- Video backdrop stale texture, aspect and rebuild churn (`reference-growth.js` 33–64): port it.
- Tip-shape geometry survives capacity rebuilds (`tip-shapes.js` 435–449).
- Cinematic modes 6–8 with sampled extent (`cinematic-camera.js`). This partly addresses framing (#7), but Simple mode's default "still" lock overrides it.
- Kick and shake disabled under `calmCamera` (#6). This hides the bug and loses the music reaction; do not port as is.
- Newly introduced in v19: faceted Liquid and skeleton-blind ribbons (#17).

## Quick wins (each well under a day, large payoff)
1. Dirty-range `addUpdateRange` on instance matrix and colour buffers, and set `needsUpdate` only for meshes actually touched (#1).
2. Collider material that is always `DoubleSide`, independent of shell look (#2). Inversion test with inward rays and majority vote (#3).
3. A young-segment list for `deform` (#5).
4. Camera kick and shake as per-frame render offsets or FOV punch, not state mutation. Re-enable them by default at moderate levels (#6).
5. `normalize(positionLocal)` in the 6 sky shaders (#13).
6. `reactify` scales instead of pushing along `normalLocal` (#10).
7. `renderer.onDeviceLost` → auto-remount with the current controls (#8). `powerPreference: 'high-performance'`.
8. Left-drag orbit, pinch zoom, `touch-action: none`, wheel `deltaMode` normalisation, and manual offsets in all camera modes (#11).
9. Keep materials across `growCapacity`; do not re-run `applyShaders`/`rebuildEnv` there; dispose floor and ceiling (#9).
10. Aspect- and FOV-correct fit distance with a robust (percentile) radius. Make "Still" a framed still (auto-dolly), not a pose frozen at startup (#7).
11. `clear()` resets `reversing`, `cycleT`, the envelopes and the morph (#18).
12. Snapshot clamps to texture limits, bases on `min(quality, dpr)`, and does not resize the canvas during a recording (#14). `resize()` honours a locked output size (#15).
13. Liquid: indexed, higher-detail sphere (`mergeVertices`), so normals are smooth (#17).
14. Preallocated mesh arrays, a `WHITE` constant, a cached control map, and rejection-sampled graft picks (#25).
15. Bloom on by default with hit-driven strength, plus AgX tone mapping (#23).
