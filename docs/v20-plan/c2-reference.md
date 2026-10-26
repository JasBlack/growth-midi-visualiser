# C2: Picture/video/camera 3D reference growth. Porting spec (v0.16.0, v0.17.1, v0.17.2, v0.19.0 → TypeScript v0.20)

Source of truth (target): `C:\Users\User\Desktop\code\growth-midi-visualiser` (tag v0.15.0).
Patch lineage analysed: `C:\Users\User\Downloads\growth-v0190` (bundle `assets/index-BWYXfAkm.js`, 1,457,690 chars).

> **Read this first: the embedded code differs from the maintenance files.**
> The *effective* v19 code is what is embedded in the bundle, and it is **not** always what is in `maintenance/*.js`:
> - `maintenance/reference-field.js`: matches the bundle byte for byte (bundle offset 1370680).
> - `maintenance/reference-growth.js`: matches the bundle byte for byte (offset 1380206). It already includes the v0.17.2 edits made by `patch_music_focus.py`.
> - `maintenance/reference-ui.js`: **does NOT match the bundle.** It still has `referenceSet('videoBuild',1)` and the v0.16 hint texts. The bundle has `videoBuild` 0 and the v0.17.2 hint texts (patched in by `patch_music_focus.py` lines 22–24), plus a `refScatter` row and handler (added by `patch_seed_fix.py` lines 163–165). Port from the **bundle** text (quoted in §4.3). Do not port from the maintenance file.
>
> **Verified live** (Chrome, WebGPU backend, v0.19.0 standalone served from a scratch copy, frames driven through `window.__viz.engine.frame()`). Four confirmed defects:
> 1. The reference backdrop material is **`BackSide`**, so it is invisible from the front.
> 2. The calm orbit camera views the reference plane **exactly edge-on** (0°).
> 3. Simple-mode "Trace details" **kills 68% of attempted segments** at depth cliffs.
> 4. Eight new controls are filed under the **"More"** panel group, not "Video".
>
> Details are in §7.

---

## 1. Summary

**What it does for the user.** The user loads a still picture, a video file or a live camera as a *reference*. The Organism engine then grows onto a 2.5D **luminance relief** of that source:
- XY is the image plane.
- Z = (brightness − 0.5) × depth (optionally inverted).
- Tips are steered along and toward Sobel edges.
- New plants seed on the image.
- Grown geometry is **anchored in image UV**, so it can follow live video frames and survive Size/Depth/Invert changes.
- An optional "Build shape" auto-fill seeds short-lived plants without music.
- A textured backdrop plane can show the source behind the relief.
- The orbit camera frames the reference rectangle instead of the growth centroid.

There is no AI depth estimation and no 360° reconstruction. The owner-facing notes say so honestly (NOTES_V0160.md:20–22, NOTES_FOR_CLAUDE.md:70–73).

**Version history in the patch lineage**

| Version | Patch script | What changed in this cluster |
|---|---|---|
| v0.16.0 | `maintenance/patch_reference.py` | New `aJ` (VideoField) class, engine methods `fieldZ/projectToField/referenceAnchor/referencePoint/rebuildBackdrop/updateReference`, `addSeg`/`finishSegment`/`clearGrowth` wrappers, controls `videoBuild/videoFollow/videoInvert`, camera framing edits, newPlant birth-offset guards, auto-geometry decay exemption, 3D-reference panel markup + `reference-ui.js`, `activateReference()` after loads |
| v0.17.0 | (NOTES_V0170) | Soft species sample the reference relief (soft-growth.js:66–69); cinematic camera mode 8 uses `referenceFrameRadius` (cinematic-camera.js:22) |
| v0.17.1 | `maintenance/patch_seed_fix.py` | **Starburst fix**: anchors are taken from `segment.a/b`, not from caller scratch vectors. Weighted-reservoir seeding with a 12×12 crowding map, the `videoScatter` control plus `refScatter` slider, and depth-cliff segment rejection |
| v0.17.2 | `maintenance/patch_music_focus.py` (lines 18–38, 53) | `videoBuildPace` control. Auto-fill is off by default when activating. Auto-fill paced at 1/pace s, 2 s lifetime, ≤4 live. Still-image dirty tracking. Multi-batch resize completion. Auto plants get no "fresh" highlight or tip glow when musicFocus>0 |
| v0.18.0 | stage-motion.js:25 | Screen-bounce bounds include the reference box corners |
| v0.19.0 | `maintenance/patch_consolidation.py` (lines 35–39, 47, 66–69) + `simple-ui.js` | `activateReference` uses videoMode **3** (was 4). Simple-mode "Draw a source" intents (`simpleReference`). `#referenceTools` hidden in Simple mode. "Show / hide source" and "Fit source" buttons |

---

## 2. Behaviours (exact algorithms and constants)

### 2.1 Reference field (`class aJ` in the bundle; `maintenance/reference-field.js`; replaces TS `VideoField`, `src/midi/videoField.ts`)

**Construction** (`reference-field.js:4–17`)
- `targetW = 192` is the analysis size. In v19 it bounds **both** axes (TS bounded width only).
- A muted, `playsInline`, looping `<video>`. **No `crossOrigin`**; TS set `'anonymous'`, which is irrelevant for blob/stream sources.
- A `still` canvas for pictures, and an analysis `canvas` whose ctx uses `{willReadFrequently:true}`.
- State: `stream`, `objectURL`, `request` (source generation counter), `revision` (map revision counter), `active`, `isStill`, `source ∈ {'none','image','file','camera'}`, `name`, `aspect=16/9`, `lastT=-Infinity`, `w=h=0`, `edgeCells`, `visitedCells`, `onStatus`.
- Buffers `depthBuf, edgeBuf, gxBuf, gyBuf, prev` (Float32Array) and `visited` (Uint8Array).

**`resetField()`** (18–21): `w=h=0`, `lastT=-Infinity`, `edgeCells=visitedCells=0`, `seedCounts=new Float32Array(144)`, `revision++`.

**`stopCamera()`** (22–25): clears each track's `onended`, stops the track, sets `stream=null`.

**`stop()`** (26–33), in this order:
1. `request++`
2. `video.pause()`, `stopCamera()`, `video.srcObject=null`
3. `video.removeAttribute('src')`, `video.load()` (releases the decoder)
4. Revoke `objectURL`
5. `active=false`, `isStill=false`, `source='none'`, `name=''`
6. `resetField()`

**`openImage(file)`** (34–49)
1. `stop()`, then capture `request`.
2. Create an object URL, decode an `Image`.
3. If `request` changed, return `'picture load cancelled'`.
4. Scale the still so its longest side is ≤ **1536 px** (`Math.min(1, 1536/max(nw,nh))`, each side at least 2). Draw it into `still`.
5. Set `isStill=true, source='image', name, active=true`.
6. `update(performance.now()/1000)` immediately.
7. Return `` `picture: ${file.name}` ``. On error return `` `image failed: ${msg}` ``. Always revoke the URL.
- TS capped the width at 1024 and did not analyse immediately.

**`openFile(file)`** (50–63)
1. `stop()`, capture `request`, create `objectURL`, `video.src=url`, `await video.play()`.
2. If the request is stale, return `'video load cancelled'`.
3. Otherwise set `source='file'`, `name`, `active=true`, call `update(...)`, return `` `video: ${name}` ``.
4. On failure: `stop()` (only if the request is still current) and return `` `video unavailable: ${msg}` ``.

**`openCamera(deviceId?)`** (64–86)
- `getUserMedia({video: deviceId ? {deviceId:{exact}} : {width:640,height:360,facingMode:'user'}})`.
- After the permission resolves **and** after `play()`: if the request is stale, stop all tracks and return `'camera cancelled'`.
- `name = track.label || 'camera'`. Each video track gets `onended`: if the request is still current, `stop()` and `onStatus('camera disconnected')`.
- Returns `` `video: ${name}` `` or `` `camera unavailable: ${msg}` ``.

**`listCameras()`**: unchanged from TS. **`togglePlay()`**: file sources only; a play() error goes to `onStatus('video: '+msg)`.

**`frameSource`**: `isStill ? still : video`. **`ready`**: `active && w>0`.

**`update(time)`** (99–139), rate-gated to 30 Hz:
1. Return early if not active; or if still and already analysed (`isStill && w`); or if video and `readyState<2`.
2. Return if `time - lastT < 1/30`.
3. `dt = isFinite(lastT) ? max(0, time-lastT) : 1`, then `lastT = time`.
4. Source size `(width, height)`. Set `aspect=width/height`.
5. `scale = min(192/width, 192/height)`. `w = max(2, round(width·scale))`, `h = max(2, round(height·scale))`.
6. `fresh = (w,h) changed`. If fresh, reallocate all buffers (`visited` is zeroed).
7. `drawImage(frameSource,0,0,w,h)`, then `getImageData`. On exception: `stop()` and `onStatus('cannot read reference: '+msg)`.
8. **Luminance with alpha:** `prev[i] = (0.299R + 0.587G + 0.114B)/255 · A/255`. Transparent pixels count as black, i.e. far.
9. **Temporal factor:** `alpha = (fresh || isStill) ? 1 : 1 − exp(−dt·9)` (≈0.26 at 30 Hz). TS used a fixed 0.35.
10. For each pixel, 3×3 with clamped borders via the `at(x,y)` closure:
    - `smooth = (tl+tr+bl+br + 2(tc+ml+mr+bc) + 4mc)/16`
    - `depthBuf[i] += (smooth − depthBuf[i])·alpha`
    - `gx = tr+2mr+br−tl−2ml−bl`, `gy = bl+2bc+br−tl−2tc−tr`
    - `edgeBuf[i] = min(1, hypot(gx,gy)·0.9)`
    - Live only: if `|smooth − depthBuf[i]| > 0.025` (evaluated *after* easing), set `visited[i]=0`. Moving pixels lose coverage.
    - If `edgeBuf[i] ≥ 0.3`: `edgeCells++`, and `visitedCells++` if visited. Both counts are recomputed every update.
11. `revision++`.

**Sampling** (140–149)
- `idx(u,v)`: nearest texel with clamping.
- `sample(buf,u,v)`: **bilinear**, u and v clamped to [0,1]. Returns 0 if `w==0`.
- `depth`, `edge` and `grad` are all bilinear. TS was nearest-neighbour.

**`visit(u,v)`** (150–158): ignored if `!w` or u,v are outside [0,1]. Marks the **3×3 neighbourhood** as visited. Each newly visited cell with `edgeBuf≥0.3` increments `visitedCells`.

**`coverage()`**: `edgeCells ? min(1, visitedCells/edgeCells) : 0`.

**`pickPoint(edges=true, tries=32)`** (160–180): weighted reservoir sampling with crowd control.
- `seedCounts ??= Float32Array(144)` (a 12×12 tile map).
- `scatter = clamp01(this.seedScatter ?? 0.7)`.
- Start with `chosen = random (u,v)`, `total = 0`. For each of the 32 candidates at uniform random `(u,v)`:
  - `tile = min(11,floor(v·12))·12 + min(11,floor(u·12))`
  - `detail = edges ? 0.15 + edge(u,v)·2 : 0.25 + depth(u,v)`
  - `coverage = visited[idx(u,v)] ? 0.3 : 1`
  - `weight = (scatter + (1−scatter)·detail)·coverage / (1 + seedCounts[tile]·0.8)`
  - `total += weight`. If `random()·total < weight`, then `chosen = (u,v)`.
- `seedCounts[tile(chosen)]++`. Then **every** tile count decays by `×0.998` on each pick (per pick, not per second).
- The caller must set `field.seedScatter`. The engine sets it every frame from `videoScatter`.

### 2.2 Relief height, projection and normals (`reference-growth.js:4–23`; replace TS `organism.ts:920–947`)

- **`fieldZ(u,v)`**: 0 if there is no field or `videoMode===2` (lines only). Otherwise `(field.depth(u,v) − 0.5) · videoDepth · (videoInvert>0 ? −1 : 1)`.
  - The TS mimic term `+ edge·depth·0.45` for mode 4 is **removed**, so modes 3 and 4 have identical height.
- **`projectToField(point, normal)`**
  - `{w,h}=fieldSize()` (TS 914–917: `w=videoSize`, `h=w/aspect`).
  - **Clamp** `point.x` to `±0.499w` and `point.y` to `±0.499h` (TS did not clamp).
  - `u = x/w + 0.5`, `v = 0.5 − y/h`.
  - `stick = videoMode===4 ? 1 : videoStick`. Then `point.z += (fieldZ(u,v) − point.z)·stick`.
  - Normal by central differences over **one analysis texel**: `du = 1/max(2, field.w)`, `dv = 1/max(2, field.h)`. TS used a fixed 1/96.
    - `dx = (Z(u+du,v) − Z(u−du,v)) / (2·du·w)`
    - `dy = (Z(u,v+dv) − Z(u,v−dv)) / (2·dv·h)`
    - `normal.set(−dx, dy, 1).normalize()`. The sign is correct because v runs opposite to y.
- **`referenceAnchor(point)`**: `{u: clamp01(x/w+0.5), v: clamp01(0.5−y/h)}`.
- **`referencePoint(point, anchor, alpha=1)`**: `x=(u−0.5)w`, `y=(0.5−v)h`, `z += (fieldZ(u,v) − z)·alpha`. XY snap exactly; only Z eases.
- `steerByLines` (TS 949–986) is **not modified** by any patch. It benefits from bilinear `edge()`/`grad()`. Its mode-4 "turn back" branch is dead code now that projection clamps XY.

### 2.3 Anchoring of new geometry (`reference-growth.js:124–148`)

**`addSeg` wrapper** (replace TS `organism.ts:1670–1686`)
1. **Cliff rejection** applies when `videoOn && !plant.isText`: `maxLength = max(0.75, min(3, w·0.06, (plant.segLen||0.5)·3))`. If `a.distanceTo(b) > maxLength`, **return null**.
   - The caller `startSegment` (TS 2012–2019) then calls `dropTip`, so the tip dies.
   - The typography path (TS 1942–1957) also drops on null, but text bypasses the check.
2. Call the original `addSeg`.
3. If a segment was created and `videoOn`:
   - `segment.referenceUV = {a: referenceAnchor(segment.a), b: referenceAnchor(segment.b)}`. The anchor **must** come from the stored clones: `writeSeg` (TS 1721 `const d = this.v1.subVectors(B, A)`) clobbers `this.v1`, which callers pass as `b` (TS 1960).
   - `plant.referenceRoot ??= referenceAnchor(plant.root)`.
   - `field.visit(referenceUV.b)`.
   - Text segments are **not** excluded from anchoring (bug B6).
4. The original TS `addSeg` still visits when `field.isStill && videoOn` (TS 1673–1677), which double-visits stills.

**`finishSegment` wrapper**: after the original runs, if the segment had `referenceUV`, set `tip.referenceUV = segment.referenceUV.b` (a shared object). If `segment.plant.referenceAuto`, set `segment.permanent = true`.

**`clearGrowth` wrapper**: after the original, `referenceCursor=0`, `referenceSeedT=null`, `field.visited.fill(0)`, `visitedCells=0`, `seedCounts.fill(0)`. TS `clear()` (749) calls `clearGrowth`, and so does cycle mode 0 (TS 2345).

**newPlant birth** (TS 1600–1610, v19 anchor `if(c.dir0&&!this.videoOn&&(T.x+=Be()*6),this.skin&&!this.videoOn&&!r.root)`)
- The music-plant root choice is unchanged from TS: when `videoOn && !opt.root`, use `pick = videoSpawn>0 ? field.pickPoint(videoMode!==1) : uniform`, place the root on the plane and `projectToField` it.
- **New:** the `sp.dir0` random x offset (±3) and the skin-surface start are skipped while `videoOn`.

### 2.4 Per-frame reference update (`updateReference(state, globals)`, `reference-growth.js:61–121`)

Called at the **very start of `frame()`**, immediately after `this.lastG=g; this.lastGTime=m.time` and before note events. The v19 bundle anchor is `this.lastG=t,this.lastGTime=e.time;this.performanceState=e;this.updateDynamicMaterials(e);this.updateReference(e,t);`. The old end-of-frame `field.update + backdrop` (TS 2536–2539) is **removed**.

1. Return if there is no field.
2. `field.seedScatter = videoScatter`. Call `field.update(state.time)`, then `rebuildBackdrop()` (every frame; it is idempotent).
3. If `!videoOn`: `release(plant, t, 0, true)` every `referenceAuto` plant that is held or auto-growing, then return.
4. **New source:** if `referenceSourceRequest !== field.request`, store it and set `referenceFrameRadius = (w² + h² + videoDepth²)/4`.
   - Default 16:9 at size 22 and depth 8 gives **175.285**; the camera sits at ≈32.8 units.
5. **Signature** = `[w, h, videoDepth, videoInvert, field.request].join(':')`. On change: `referenceResizePending = true`, `referenceCursor = 0`.
6. `follow = videoFollow>0`. If `follow && ((isStill && referenceRevision !== field.revision) || !referenceWasFollowing)`: store the revision, set resize pending and cursor 0. Then `referenceWasFollowing = follow`.
7. **Geometry pass** runs if `t − referenceGeometryT ≥ 1/30` and `((follow && !isStill) || referenceResizePending)`:
   - `alpha = pending ? 1 : 1 − exp(−(1/30)·12)` ≈ **0.330**.
   - Walk `this.segs` from `referenceCursor`, at most **min(count, 4000)** entries. On wrap: `cursor=0`, `completed=true`, and break if pending.
   - Skip segments without `referenceUV`. Otherwise `referencePoint(seg.a, uv.a, alpha)`, `referencePoint(seg.b, uv.b, alpha)`, `writeSeg(seg)`.
   - Save the cursor. If `cursor≥count || completed`, set pending false.
   - Then, for **every** plant: `referencePoint(plant.root, plant.referenceRoot, alpha)` if the plant has an anchor. For each tip: if `tip.seg?.referenceUV`, `tip.pos.copy(tip.seg.a)`; else if `tip.referenceUV`, `referencePoint(tip.pos, tip.referenceUV, alpha)`.
8. **Auto-fill ("Build shape")**
   - If `videoBuild ≤ 0`: release active `referenceAuto` plants (`lignify=0`, final) and return.
   - `active` = plants with `held || autoUntil>t`. **All** plants count, including music. Return if `active ≥ min(4, maxLive)` or `segs.length ≥ min(16000, budgetCap()·0.8)`.
   - The first time, set `referenceSeedT = t` and return, so there is an initial delay.
   - Return if `t − referenceSeedT < 1/max(0.2, videoBuildPace || 0.8)`.
   - `uv = field.pickPoint(true)`; `root = ((u−.5)w, (.5−v)h, fieldZ(u,v))`.
   - `plant = newPlant(48 + floor(random·24), 0.65, globals, t, {root, autoUntil: t + 2})`. The random pitch 48–71 picks the species and colour. This fires `onEvent('spawn')` and therefore sound-back.
   - Set `plant.held = false`, `plant.referenceAuto = true`, `plant.referenceRoot = uv`, then `field.visit(uv)`.

**Auto-geometry persistence** (decay loop, TS 2442–2450; v19 anchor `if(!ge&&q.referenceAuto&&!q.dying&&!this.reversing)continue;let ne=c*2.2;`)
- After the "newest non-permanent segment" search: if there is **no** non-permanent target and the plant is `referenceAuto`, not `dying` and not `reversing`, **skip** it.
- Such plants never silence-decay and are never picked for recycle pruning (`pruneLeft`).
- They leave only via Reset/clear, cycle reset/reverse, or `makeRoom` when `addSeg` hits the cap.

### 2.5 Backdrop (`rebuildBackdrop`, `reference-growth.js:33–60`; replaces TS 989–1013)

- Runs every frame. `opacity = videoShow`.
- If `!field?.ready || opacity ≤ 0`: hide the plane. If the field is also inactive (source stopped), dispose `videoTex` and null it. Then return.
  - **`videoMode` is no longer consulted.** TS hid the backdrop when videoMode==0.
- The texture is (re)created when absent or `videoTex.image !== frameSource`: `CanvasTexture(still)` or `VideoTexture(video)`, with `colorSpace = SRGBColorSpace`.
- **One reused mesh:** `new Mesh(new PlaneGeometry(1,1), new MeshBasicMaterial({transparent:true, depthWrite:false, toneMapped:false, side: Et}))`, with `raycast=()=>{}`, `frustumCulled=false`, added to the scene.
  - **`Et` is `THREE.BackSide`** (bundle constants `fn=0,Et=1,yi=2`). See bug B1.
- Scale `(w,h,1)`, `position.z = −videoDepth/2 − 0.6`. Assign the map if it changed (`needsUpdate`). Set the opacity.
- For stills, when `referenceTextureRevision !== field.revision`, set `videoTex.needsUpdate = true` and store the revision. This matters because the same `still` canvas is reused for new pictures.
- **Not disposed on engine `unmount()`** (bug B10).

### 2.6 Camera framing (TS 2574–2590; v19 anchors quoted in §5)

These apply in **camMode 0 (orbit)** only, and only while `videoOn`. The whole camera simulation is skipped when `cameraLockPose` is set (the calm-camera cluster; Simple "Still" is locked).
- The centre target `c` is forced to **(0,0,0)**, which overrides the centroid, `camFollow` and the tunnel.
- The radius is `r2 = max(4, referenceFrameRadius ?? (w²+h²+depth²)/4)`. The per-segment extent loop is skipped (`if(Ls!==2&&!(this.videoOn&&Ls===0))`).
- The orbit distance is `(sqrt(r2)·2.1 + 5)/zoomNow`. The orbit angle is `theta + manTheta + rotNow·0.5 (+ sway unless calm)` and **starts at 0, which places the camera on +X** (bug B2).
- The Fit button (§4) resets `referenceFrameRadius`, `zoomMul=1`, `pan=0` and `camMode=0`. It does **not** touch `theta` or `manTheta`, and it does nothing while the camera is locked.
- Cinematic mode 8 (cinematic-camera.js:22) starts its extent at `sqrt(referenceFrameRadius||0)`. Stage-motion bounds (stage-motion.js:25) add the 8 corners `(±w/2, ±h/2, ±depth/2)`.

### 2.7 Activation flow (main.ts UI; the effective bundle code is in §4.3)

- **Picture load** (`m5`, TS `openImage` main.ts:668–674): set the status. Then `videoStop.hidden = !active`. If there is a `videoMode` ctl for the current engine, `set(4)`. Then `activateReference()`.
- **Video/camera load** (`g5`, TS `afterVideoOpened` main.ts:680–685): if `videoMode==0`, `set(4)`, then `activateReference()`.
- **`activateReference()`**: return if the source is not active. Switch to organism if needed (`await selectEngine('organism')`), and return if that fails. Then set `videoMode=3, videoStick=1, videoSpawn=1, videoFollow=1, videoBuild=0` and sync the panel. Net result after any load: **mode 3 ("depth + lines"), stick 1, auto-fill off**.
  - It does **not** set `videoEdge` (stays 1.2) or `videoScatter` (stays 0.7), so it differs from both Simple intents (bug B11/B27).
- Drag-and-drop of image/video files goes through the same `openImage`/`openVideo` (TS main.ts:763–779).

### 2.8 Simple-mode source intents (`simple-ui.js:45–63, 108–109`)

`simpleReference(mode)`: if the engine is not organism, the status is `'Choose Organism before using source guidance.'`

| intent (button) | controls written |
|---|---|
| `off` ("Music only", `#simpleFree`) | videoMode 0, videoBuild 0, shellMode 0. Status `'Source guidance off — music grows freely.'` |
| `model` ("Skin 3D model") | shell cluster; out of scope |
| trace/relief without an active source | status `'Load a picture, video or camera first.'` |
| `trace` ("Trace details", `#simpleTrace`) | videoMode **3**, videoStick 1, videoFollow 1, videoEdge **2.5**, videoScatter **0.22**, videoSpawn 1, videoBuild 0, branch **0.22**, wiggle **0.25**, length **0.55**, join **0.15**, musicAmount **0.38**, fillRate **180**. Status `'Detail trace — music draws along edges and relief.'` |
| `relief` ("Grow over relief", `#simpleRelief`) | videoMode **4**, videoStick 1, videoFollow 1, videoEdge **1.35**, videoScatter **0.55**, videoSpawn 1, videoBuild 0, branch **0.45**, wiggle **0.5**, length **0.72**, join **0.35**, musicAmount **0.38**, fillRate **180**. Status `'Living relief — music grows across the source surface.'` |

- `#simpleReferenceVisible` toggles `videoShow` between 0 and **0.45**. The Advanced toggle uses a remembered value, initially 0.55.
- `#simpleFit` calls `Y('refFit').click()`.
- Every Simple look (`simpleApplyLook`) forces `videoBuild: 0`.

### 2.9 Interplay with other clusters (keep in mind; do not own)

- **Music focus** (music-focus.js:24–30): `focusLevel` gives `referenceAuto` segments `fresh = 0`, so they are dimmed. The tip-glow loop skips `referenceAuto` plants when musicFocus>0 (patch_music_focus.py:53). "Music-led settings" sets `videoBuild=0` (music-focus-ui.js:20). The `#buildPace` slider is bound to `videoBuildPace`.
- **Soft species** (soft-growth.js:66–69): when `videoOn`, vertices are clamped to ±w/2, ±h/2. If `videoFollow`, `z = fieldZ(...) + (z−root.z)·0.18`.
- **Calm camera / lock**: see B2 and B12. The first-run lock is captured 700 ms after load. In a background tab no frame has run yet, so the lock captures `camera.position = (0,0,0)` (observed live).
- **Generic helpers:** `referenceSet` and `referenceValue` (reference-ui) are reused as *generic* organism-control setters and getters by `dynamic-material-ui.js`, `extra-controls.js`, `music-focus-ui.js` and `simple-ui.js`.

---

## 3. Controls

All are organism engine controls, persisted in `settings.engineCtl.organism[key]` (localStorage `midiviz_settings_v3`) and captured in presets (`midiviz_presets_v1`, morphable). "TS line" is `src/midi/engines/organism.ts`.

**Intended group vs. actual group:** `mount()` (TS 571; bundle `l.group=l.key.startsWith("sp:")?"Species":CK[l.key]??"More"`) **overwrites** the inline `group:"Video"` from the patch. The `GROUP` map (TS 237–238) was never extended. **Live-verified:** `musicAmount, musicFocus, musicTrail, videoBuildPace, videoScatter, videoBuild, videoFollow, videoInvert` all report `group === "More"`.

| key | label (v19) | min | max | step | default | options | intended group | read by |
|---|---|---|---|---|---|---|---|---|
| videoMode | **"reference guides growth"** (TS: "video / picture guides the growth") | 0 | 4 | 1 | 0 | `off` · `depth — growth rides the relief` · `lines — growth traces the edges` · `depth + lines` · **`3D shape — fill the reference relief`** (TS: `mimic — growth draws the picture in 3D`) | Video (TS 237) | `videoOn` (TS 909); `fieldZ` (2→flat); `projectToField` (4→stick 1); `steerByLines` (1→none, 4→×1.6); newPlant edge-vs-depth seeding (`!==1`); refHint; activateReference (→3); simple (3/4/0) |
| videoBuildPace (v0.17.2) | "background starts per second" | 0.2 | 3 | 0.1 | 0.8 | – | none given (→More) | auto-fill interval `1/max(.2,pace||.8)`; `#buildPace` |
| videoScatter (v0.17.1) | "new strand spread (0 = favour details, 1 = anywhere)" | 0 | 1 | 0.05 | 0.7 | – | Video (lost) | `field.seedScatter` → `pickPoint`; `#refScatter`; simple (0.22/0.55) |
| videoBuild (v0.16) | "build the shape without music" | 0 | 1 | 1 | 0 | – | Video (lost) | auto-fill on/off, release of auto plants; `#refBuild`; hint; set 0 by activate / simple / musicLed |
| videoFollow (v0.16) | "existing growth follows live frames" | 0 | 1 | 1 | 1 | – | Video (lost) | geometry pass; soft-growth z; `#refFollow`; activate/simple set 1 |
| videoInvert (v0.16) | "invert relief depth" | 0 | 1 | 1 | 0 | – | Video (lost) | `fieldZ` sign; signature; `#refInvert` |
| videoSize | "video: how wide the picture is" | 4 | 60 | 1 | 22 | – | Video | `fieldSize`; signature; backdrop scale; frame radius; `#refSize` |
| videoDepth | "video: how deep the relief is" | 0 | 25 | 0.5 | 8 | – | Video | `fieldZ`; backdrop z; frame radius; signature; stage bounds; `#refDepth` |
| videoEdge | "video: how hard growth clings to lines" | 0 | 3 | 0.05 | 1.2 | – | Video | `steerByLines` strength; simple (2.5/1.35) |
| videoStick | "video: how tightly growth hugs the surface" | 0 | 1 | 0.05 | 0.9 | – | Video | `projectToField` (modes ≠4); activate/simple set 1 |
| videoSpawn | "video: new growth starts on the subject (0 / 1)" | 0 | 1 | 1 | 1 | – | Video | newPlant seeding |
| videoShow | "video: show the picture behind (0 = hidden)" | 0 | 1 | 0.05 | 0.55 | – | Video | backdrop opacity; `#refVisible`; `#simpleReferenceVisible` |

**Bundle definition order**, inserted after `camFollow`: `videoMode, musicAmount, musicFocus, musicTrail, videoBuildPace, videoScatter, videoBuild, videoFollow, videoInvert, videoSize, videoDepth, videoEdge, videoStick, videoSpawn, videoShow`. The three `music*` keys belong to the music-focus cluster.

**Other controls this cluster reads or writes**
- `maxLive`: auto-fill cap `min(4, maxLive)`.
- `budget`: via `budgetCap()·0.8`.
- `camMode`: framing only in 0; Fit sets 0.
- `musicFocus`: dims auto plants and hides their glow.
- Simple writes `branch, wiggle, length, join, musicAmount, fillRate, shellMode`.

**Non-control state:** `referenceOpacity` (in memory, initial 0.55; reference-ui).

---

## 4. UI

### 4.1 Markup (v19 `index.html:219–232`, Input section, directly after `#videoStatus`). TS target: `index.html:146`

```html
<div id="referenceTools" style="border:1px solid #384b43;border-radius:8px;padding:10px;margin:10px 0">
  <strong>3D reference</strong>
  <div class="row"><button id="refEnable" type="button">Use as 3D shape</button><button id="refFit" type="button">Fit view</button></div>
  <div class="row">
    <button id="refBuild" type="button" aria-pressed="false">Build shape</button>
    <button id="refFollow" type="button" aria-pressed="true">Follow live</button>
    <button id="refVisible" type="button" aria-pressed="true">Show reference</button>
    <button id="refInvert" type="button" aria-pressed="false">Invert depth</button>
  </div>
  <label class="slider" for="refSize"><span>Size</span><output id="refSizeValue" for="refSize">22</output><input id="refSize" type="range" min="4" max="60" step="1" value="22"></label>
  <label class="slider" for="refDepth"><span>Depth</span><output id="refDepthValue" for="refDepth">8</output><input id="refDepth" type="range" min="0" max="25" step="0.5" value="8"></label>
  <label class="slider" for="refScatter"><span>New strand spread</span><output id="refScatterValue" for="refScatter">0.7</output><input id="refScatter" type="range" min="0" max="1" step="0.05" value="0.7"></label>
  <p class="note">Higher spread starts strands anywhere; lower spread favours image details.</p>
  <p id="refHint" class="note"></p>
  <!-- v0.17.2 inserted <section aria-label="Music growth"> … (#musicLed, #musicAmount, #musicFocus, #musicTrail, #buildPace) HERE — music-focus cluster; move it out (B19) -->
  <p class="note">Depth comes from image brightness. Middle-drag to orbit and see the relief.</p>
</div>
```

**CSS added** (v19 index.html:122–123, before `</style>`):
- `button:disabled {opacity:.45;cursor:default;}`
- `#referenceTools output {text-align:right;color:#aee6c8;}`
- The TS `.slider` rule (index.html:47) is a 2-column grid, so `<label class="slider"><span/><output/><input/></label>` lays out the same as the `div.slider` widgets.

**Simple mode** (patch_consolidation.py:47, v19 index.html:131): `body.simple-ui #referenceTools{display:none!important}`.

**Simple home card** (v19 index.html:178–181):
- `<h3>Draw a source</h3>`, then `.intent-grid` holding buttons `#simpleTrace` "Trace details", `#simpleRelief` "Grow over relief", `#simpleModel` "Skin 3D model", `#simpleFree` "Music only".
- Model file input `#simpleModelFile` and status `#simpleModelStatus` (other cluster).
- `.row` holding `#simpleReferenceVisible` "Show / hide source" and `#simpleFit` "Fit source".
- Note: "Load a picture, video, camera or model in Input below. Music starts and extends strands; automatic background filling stays off."
- CSS: `#simpleHome .intent-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:5px}`.

Unchanged TS elements used: `#videoFile`, `#videoCam`, `#videoImage`, `#videoStop`, `#videoDeviceRow` / `#videoDevice`, `#videoStatus`.

### 4.2 Handlers

| element | handler (effective v19 bundle) |
|---|---|
| `#refEnable` | `activateReference()` (§2.7). Disabled when there is no active source |
| `#refFit` | If organism and `xn.ready`: `te.referenceFrameRadius = (w²+h²+videoDepth²)/4`; `te.zoomMul=1`; `te.pan.set(0,0,0)`; `camMode ← 0`. Disabled unless source active and organism. Accesses the TS-`private` `fieldSize`, `zoomMul` and `pan` |
| `#refBuild`, `#refFollow`, `#refInvert` | toggle the key 0↔1 via `referenceSet` |
| `#refVisible` | `v = videoShow`. If v>0, remember it in `referenceOpacity` and set 0; else set `referenceOpacity` (initially 0.55) |
| `#refSize`, `#refDepth`, `#refScatter` `oninput` | `referenceSet(key, +value)` |
| `xn.onStatus` | `setVideoStatus(msg)`; `videoStop.hidden = !xn.active`; `referenceSync()` |
| `referenceSync()` | Every 400 ms (`setInterval`) and after every `referenceSet`. Enables the buttons/sliders only when the source is active and the engine is organism. Sets the `.active` class and `aria-pressed` from the values. Sliders and `…Value` outputs show the current engine value (fallbacks 22 / 8 / 0.7). `#refEnable` is disabled if there is no source |
| `#refHint` text | see the verbatim strings below |
| `#simpleTrace` / `#simpleRelief` / `#simpleFree` | `simpleReference('trace' / 'relief' / 'off')` |
| `#simpleReferenceVisible` | `videoShow ← (videoShow>0 ? 0 : .45)` |
| `#simpleFit` | `Y('refFit').click()`. A no-op while `refFit` is disabled; visually a no-op while the camera is locked |

**`#refHint` strings, in priority order:**
1. `'Choose a picture, video or camera above.'`
2. `'Use as 3D shape switches to the Organism pattern.'`
3. `'Guidance is off. Use as 3D shape to enable it.'` (videoMode 0)
4. `'Background fill is on: it grows without music. Turn Build shape off for music-only growth.'` (videoBuild>0)
5. `'Music-led: play notes or audio to grow. Build shape adds independent background growth.'`

**Helpers:**
- `referenceSet(key, v)` = `ctls.get('e:organism:'+key)?.set(v)` followed by `referenceSync()`. `Ctl.set` clamps, rounds when step≥1, applies `engine.setControl` and saves settings.
- `referenceValue(key, fb)` = the ctl's `c.value` if the engine is organism, else `fb`.

### 4.3 Effective bundle text of the reference UI (port source; differs from `maintenance/reference-ui.js`)

- `activateReference`: `referenceSet('videoMode',3);referenceSet('videoStick',1);referenceSet('videoSpawn',1);referenceSet('videoFollow',1);referenceSet('videoBuild',0);`
- `referenceSync` slider list: `[['refSize','videoSize',22],['refDepth','videoDepth',8],['refScatter','videoScatter',.7]]`
- Appended: `Y('refScatter').oninput=event=>referenceSet('videoScatter',+event.target.value);`
- Hint strings: as listed in §4.2.

---

## 5. Integration points: minified anchor → TS location → required change

TS paths are relative to `C:\Users\User\Desktop\code\growth-midi-visualiser`.

| # | Patch (file:line) | Minified anchor (verbatim) | TS location | What must change |
|---|---|---|---|---|
| 1 | patch_reference.py:84–86 | `class aJ{` … up to `const LM=` (replaced with reference-field.js + reference-growth.js) | `src/midi/videoField.ts:16–285` (`class VideoField`) | Rewrite the class per §2.1, preferably split per §8. Keep the public API: `openImage/openFile/openCamera/stop/listCameras/togglePlay/frameSource/ready/depth/edge/grad/visit/coverage/pickPoint/update`, plus new `request`, `revision`, `seedScatter`, `w`, `h`, `visited`, `visitedCells`, `seedCounts` |
| 2 | patch_reference.py:87; patch_seed_fix:162; others | `"0.15.1"` → … `const LM="0.19.0"` | `src/midi/version.ts:2` | Version bump (release cluster) |
| 3 | patch_reference.py:88 | `label:"video / picture guides the growth"` | `organism.ts:407` | Label → "reference guides growth" (or better, §8) |
| 4 | patch_reference.py:89 | `"mimic — growth draws the picture in 3D"` | `organism.ts:407` options[4] | → "3D shape — fill the reference relief" |
| 5 | patch_reference.py:90; patch_seed_fix:163; patch_music_focus:18–19 | `{key:"videoSize",` / `{key:"videoBuild",` / `{key:"videoScatter",` | `organism.ts:408` (insert before `videoSize`) **and** `GROUP` map `organism.ts:237–238` | Add the `videoBuild`, `videoFollow`, `videoInvert`, `videoScatter`, `videoBuildPace` defs. **Also add the keys to `GROUP` as `'Video'`**; the patch forgot, see B5 |
| 6 | patch_reference.py:91; patch_performance.py:33 | `this.lastG=t,this.lastGTime=e.time;` → `…;this.updateReference(e,t);` | `organism.ts:2276–2277` (`frame()`) | Insert `this.updateReference(m, g)` right after `this.lastGTime = m.time`. **Ordering:** after lastG/lastGTime; **before** the note-event loop (2292) and before shell/cycle/maxLive/growth. The field must be analysed and anchors refreshed before `newPlant` seeds or `startSegment` projects |
| 7 | patch_reference.py:92 | `this.field&&(this.field.update(n),this.videoOn&&!this.backdrop&&G(this.controls,"videoShow")>0&&this.rebuildBackdrop()),` → removed | `organism.ts:2536–2539` | Delete (moved into `updateReference`) |
| 8 | patch_reference.py:93 | `this.center.lerp(Lr,1-Math.exp(-s*.8));` → prefixed `this.videoOn&&Ls===0&&Lr.set(0,0,0),` | `organism.ts:2588` (`c`=`this.v1`, `mode`) | Before the lerp: `if (this.videoOn && mode === 0) c.set(0,0,0)`. **Replace with the facing-framing design in §8.4** |
| 9 | patch_reference.py:94–95 | `let ab=this.shell?G(this.controls,"shellSize")**2*.6:4;if(Ls!==2)` | `organism.ts:2589–2590` | When `videoOn`: `r2 = max(4, referenceFrameRadius ?? (w²+h²+depth²)/4)`, and skip the per-seg loop when `videoOn && mode===0` |
| 10 | patch_reference.py:97 | `if(c.dir0&&(T.x+=Be()*6),this.skin&&!r.root)` | `organism.ts:1609–1610` (`newPlant`) | `if (sp.dir0 && !this.videoOn) root.x += rnd()*6` and `if (this.skin && !this.videoOn && !opt.root)` |
| 11 | patch_reference.py:99–100 | `let ne=c*2.2;const Pe=t.decay*this.seasonF.decay;` | `organism.ts:2449–2450` (after the target search 2442–2448 in the decay loop) | Insert `if (!target && p.refAuto && !p.dying && !this.reversing) continue` |
| 12 | patch_reference.py:101 | `xn.active&&e&&e.set(4)}Y("videoImage")` → `…,xn.active&&activateReference()}` | `src/midi/main.ts:668–674` (`openImage`) | After a successful load, call the single activation routine (§8.5). Remove the `c.set(4)` then `set(3)` double write |
| 13 | patch_reference.py:102 | `xn.active&&e&&e.c.value===0&&e.set(3)}Y("videoFile")` → `e.set(4),xn.active&&activateReference()` | `src/midi/main.ts:680–685` (`afterVideoOpened`) | Same as #12 |
| 14 | patch_reference.py:103; patch_seed_fix:164–165; patch_music_focus:22–24 | appended `reference-ui.js` text | `src/midi/main.ts` after the video block (after line 710) | Port the §4.2 handlers (event-driven, not 400 ms polling) |
| 15 | patch_reference.py:121–124; patch_seed_fix:167–169 | HTML after `<div id="videoStatus" class="note">…</div>`; CSS before `</style>` | `index.html:146` and `index.html:83` | Insert the §4.1 markup and CSS |
| 16 | reference-growth.js:124–142 (prototype wrapper) | `tw.prototype.addSeg=function(plant,a,b,r,time){…}` over bundle `addSeg(e,t,s,n,r){…}` (offset 1135889) | `organism.ts:1670–1686` | Inline it: anchor from `seg.a/seg.b` after creation. Skip anchoring for `isText`. Replace the cliff *rejection* with slope limiting in `startSegment` (§8.3). Remove the still-only `visit` at 1673–1677 (anchor-based visit replaces it) |
| 17 | reference-growth.js:143–148 | `tw.prototype.finishSegment=…` | `organism.ts:2023–2030` | After `tip.pos.copy(seg.b)`: `tip.anchor = seg.anchor?.b`. If `p.refAuto`, `seg.permanent = true`. **Also** give the branch tips created in `spawn()` (2058) the same anchor (B7) |
| 18 | reference-growth.js:149–154 | `tw.prototype.clearGrowth=…` | `organism.ts:742–747` | Reset the cursor, seed timer, coverage and crowd map |
| 19 | reference-growth.js:3–122 (`Object.assign(tw.prototype,{…})`) | `fieldZ`, `projectToField`, `referenceAnchor`, `referencePoint`, `rebuildBackdrop`, `updateReference` | `organism.ts:914–1013` (video section) | Replace `fieldZ` (920–927), `projectToField` (934–947) and `rebuildBackdrop` (989–1013). Add the new methods, or better, delegate to `ReferenceGuide` (§8) |
| 20 | patch_music_focus.py:53 | `q.sp.glow<=0` → `(q.sp.glow<=0&&…musicFocus<=0)||(q.referenceAuto&&…musicFocus>0)` | `organism.ts:2552` (tip-glow loop) | Music-focus cluster; keep the auto-plant exclusion |
| 21 | patch_consolidation.py:36–39 | `referenceSet('videoMode',4);referenceSet('videoStick',1);` → mode 3 | main.ts (activation) | Folded into §8.5 |
| 22 | not patched, relevant | TS `setControl`, line 767: `if (key.startsWith('video') && this.renderer) this.rebuildBackdrop()` | `organism.ts:767` | Keep; the backdrop is idempotent. Also mark the reference as dirty for key ∈ {videoSize, videoDepth, videoInvert, videoMode} |
| 23 | not patched, relevant | TS `unmount()` | `organism.ts:2776–2789` | **Dispose the backdrop mesh, material, geometry and the VideoTexture** (B10) |
| 24 | not patched, relevant | TS `stats()` | `organism.ts:1406` | Keep the picture coverage %; consider showing it for video as well |
| 25 | not patched, root cause | TS `writeSeg`: `const d = this.v1.subVectors(B, A)` | `organism.ts:1721` | Use a dedicated private scratch (`this.wsDir`) so callers' `this.v1` (`startSegment` 1960, typography 1950) is never clobbered. This also fixes `p.reach` at 2015 (B24) |
| 26 | startSegment projection | (TS only) | `organism.ts:1960–1966` | Place slope limiting and border reflection here (§8.3) |

**Ordering constraints**
1. `updateReference` runs first in `frame()`, before events, cycles, maxLive, growth and deform.
2. `deform()` (TS ~2542) runs after it and rewrites segments with offsets, so deform wins visually for that frame. That is acceptable.
3. The geometry follow-pass must run before `startSegment`, so new segments start from the updated `tip.pos`.
4. `field.update` must use the same clock as the engine (`performance.now()/1000`, music.ts:136–137). `openImage`/`openFile`/`openCamera` also call `update(performance.now()/1000)`; if the engine clock ever changes (for example deterministic offline recording), those calls must be removed.

---

## 6. State & lifecycle

**New engine fields** (v19, all on the `tw` instance, none declared)
- `referenceSourceRequest`, `referenceFrameRadius`, `referenceSignature`, `referenceResizePending`
- `referenceCursor`, `referenceWasFollowing`, `referenceRevision`, `referenceGeometryT`
- `referenceSeedT` (null = not started), `referenceTextureRevision`
- Existing: `backdrop`, `videoTex`

**Per object**
- `Seg.referenceUV?: {a:{u,v}, b:{u,v}}`
- `Plant.referenceRoot?: {u,v}`, `Plant.referenceAuto?: boolean`
- `Tip.referenceUV?: {u,v}` (the same object as the finished segment's `b` anchor)

**Field fields:** `request, revision, seedScatter, seedCounts(Float32Array 144), visited(Uint8Array w·h), edgeCells, visitedCells, objectURL, stream, lastT, still, canvas/ctx, buffers`.

**Reset / clear**
- `clearGrowth()` (Reset button → `resetEngine` main.ts:991 → `engine.clear()`, plus cycle mode 0) resets `referenceCursor`, `referenceSeedT`, `visited`, `visitedCells` and `seedCounts`.
- It does **not** reset `referenceFrameRadius` or the signature.
- `clear()` is wrapped by music-focus to preserve a locked camera.

**Source stop** (`#videoStop` → `field.stop()`)
- Next frame: `!videoOn` releases auto plants; the backdrop hides and its texture is disposed (`!field.active`).
- Anchored geometry stays at its last positions.
- `onStatus` is **not** called, so the UI catches up on the next 400 ms poll.

**Source replace**
- `request` changes, so the signature changes, so there is a full re-projection (alpha = 1) of *all* anchored segments onto the new source (B9), and `referenceFrameRadius` is recomputed.

**Engine switch / unmount**
- The field is shared (main.ts:39, `setVideoField` at 258). A new engine gets the same field.
- The old engine's backdrop and **VideoTexture are never disposed** (B10).

**Persistence**
- The engine controls in §3 persist in `midiviz_settings_v3` → `engineCtl.organism.*` and in preset slots `midiviz_presets_v1`.
- `referenceOpacity` is memory-only.
- The Simple/Advanced UI mode is `growth-ui-mode`; the first-run key is `growth-good-start-v0190` (simple-ui.js:68, 119).
- Nothing about the source (file, camera id) persists.

---

## 7. Bugs, weaknesses and questionable decisions (critical review)

Severity: **C**ritical / **H**igh / **M**edium / **L**ow. "LIVE" means verified in Chrome today against the real v19 bundle.

**B1 (C, LIVE). The reference backdrop is BackSide, so it is invisible from the front.**
- `reference-growth.js:48` uses `side:Et`. The bundle's own three constants are `const md="185",…,fn=0,Et=1,yi=2`, i.e. **FrontSide=0, BackSide=1, DoubleSide=2**. The leaf mesh and shell material correctly use `yi`.
- Live: `engine.backdrop.material.side === 1`.
- The author intended DoubleSide (NOTES_V0160.md:67 "Use double-sided reference material").
- The unit test hid the bug by stubbing `Et:2` (test-reference.cjs:29).
- Effect: "Show reference" / "Show / hide source" appears to do nothing from the front. From behind you see a mirrored picture.
- **Fix:** `THREE.DoubleSide`, or `FrontSide` with the camera guaranteed in front (§8.4). Add a test that asserts against the real three constant.

**B2 (C, LIVE). The orbit and "still" camera sees the XY reference plane edge-on.**
- The orbit position is `(cos(ang)cosφ·d, sinφ·d, sin(ang)cosφ·d)` with `theta=0` initially (TS 498) and calm `orbit=0` (calm-camera.js).
- Live: with the calm camera unlocked, after 3 s `camPos=(30.72, 9.5, 0)` and `camLook=(0,0,0)`. The view direction · plane normal = **0.000**, i.e. exactly edge-on.
- Simple "Still" locks the pose about 0.7 s after first load, by which time the camera has moved ≈98% of the way (`1−e^{−6·0.7}`) toward that +X position.
- "Fit view" / "Fit source" reset radius, zoom and pan but **not the angle**, and do nothing while locked.
- "Very slow orbit" circles 360° around a 2.5D relief, so half the time it is seen edge-on or from behind.
- Combined with B1, the user sees a thin sliver of growth: the side profile of the relief. This is very likely a root cause of "picture growth doesn't look like the picture" and of the lead's framing complaint.
- **Fix:** when the reference is active, the orbit/still camera frames **facing** the plane: `ang = π/2` (camera on +Z), `φ ≈ 0.12`, distance from `frameRadius`. Optional sway of ±30° instead of full orbit. Fit also re-captures the lock pose.

**B3 (H, LIVE). The depth-cliff rejection kills tips at image edges, i.e. exactly where trace steering sends them.**
- The rule `a.distanceTo(b) > maxLength ⇒ addSeg returns null ⇒ startSegment drops the tip`.
- With `videoDepth=8`, `w=22`:
  - **Trace** (length 0.55): segLen = 0.42·0.55·1.043 = 0.241, so maxLength = 0.75. A tip dies when |Δz| > ≈0.70, i.e. **Δluminance > ≈0.09 across one ~2-texel step**.
  - For a Sobel ramp, `edge = min(1, 7.2·slope)`, so the kill threshold ≈ **edge 0.3**. That is the same threshold used to define "edge cells".
- Live measurement on a synthetic face picture, 3 held notes for 2 s (120 frames), Roots species:

| setting | segments added | segments rejected by cliff |
|---|---|---|
| Simple **Trace details** | 25 | **52** (68% of attempts killed) |
| default activate (mode 3, edge 1.2) | 63 | 1 |
| Simple Grow over relief | 58 | 2 |
| reference off (videoMode 0) | 54 | 0 |

  - Rejected |Δz| samples: 0.85–2.71.
- Branches spawned off a contour (branch angles 0.6–1.3 rad) immediately cross the edge and die. Growth stalls exactly where the picture has detail.
- **Fix:** never reject. Limit the slope in `startSegment`: `b.z = a.z + clamp(b.z − a.z, −k·len, k·len)` with k≈1.2–2, so growth climbs a cliff over a few segments. Compute z from a **smoother relief map** (separable Gaussian σ≈2–3 texels, or a half-res mip) and keep the sharp map only for steering.

**B4 (H, LIVE). Seeding ignores the subject; ~78–80% of roots start on empty background.**
- The synthetic face covers 19.8% of the frame (depth>0.3); edges cover 4.4%.
- Share of seeds on the subject with the coverage feedback that happens in use:

| scatter | 1 | 0.7 (default) | 0.55 | 0.22 | 0 |
|---|---|---|---|---|---|
| on subject | 19.9% | 21.0% | 20.6% | 23.2% | 25.4% |

  - On-edge hits at the default 0.7: 6.6%.
  - Pure weights without penalties: 0.7 → 22.9%, 0.22 → 27.6%, 0 → 34.6%.
- Why: edge-mode weight `0.15+2·edge` ignores brightness/subject; the 144-tile crowd penalty and the ×0.3 visited penalty deliberately flatten the distribution; only 32 candidates.
- `test-seeding.cjs:136–138` *asserts* uniformity (≥140/144 tiles, every quadrant >15%, centre <10%) as success, which is the wrong goal for "draw this picture".
- **Fix:** importance sampling from a per-revision CDF over a saliency map, e.g. `s = edge·wE + |relief − backgroundLevel|·wS + ε`, with `backgroundLevel` = median of border texels.
  - Keep crowding as a soft multiplier on a coarse grid.
  - `scatter` blends toward uniform.
  - O(log n) per pick via binary search on a prefix-sum array (192×108 = 20,736 floats), rebuilt only when `revision` changes (stills: once).

**B5 (H, LIVE). The new controls are in the "More" section, not "Video".**
- `mount()` overwrites `group` from the `GROUP` map (TS 571; bundle `CK[l.key]??"More"`). The patch put `group:"Video"` inline and never touched `CK`.
- Live: `videoScatter, videoBuild, videoFollow, videoInvert, videoBuildPace` (and `musicAmount/Focus/Trail`) → "More".
- **Fix:** add the keys to `GROUP` (TS 237–238).

**B6 (M, LIVE). Typography written while a reference is active gets anchored and flattened onto the relief.**
- The wrapper anchors every segment when `videoOn`, including `isText` (only the cliff check skips text).
- Live: `growText('HI')`. All 6 text segments received `referenceUV`. A Size change 22→23 moved all of them (max 7.06 units) and flattened z from 3.81 to −3.25.
- With live video + Follow, this happens every frame.
- **Fix:** do not anchor `isText` plants, and do not anchor nested children whose `bound` sits off-plane unless projected.

**B7 (M). Branch, re-sprout and burst tips have no anchor.**
- Only the tip passed to `finishSegment` gets `referenceUV`.
- Tips created in `spawn()` (TS 2058), re-sprout (TS 2412–2418), wild bursts (TS 2520) and tunnel get `pos = seg.b.clone()` with no anchor.
- Under Follow live their `pos` goes stale, so the next segment starts from an old position: visible gaps or kinks at branch points on moving video.
- **Fix:** store the anchor on every tip whose `pos` comes from a segment endpoint (`tip.anchor = seg.anchor.b`), or derive it at `startSegment` time from the `(u,v)` of `tip.pos`.

**B8 (M). Anchors store only (u,v), so any height above or below the relief is lost.**
- `referencePoint` eases z toward `fieldZ`. With `videoStick < 1` (modes 1–3 at the TS default 0.9), growth deliberately hovering off the surface collapses onto it after the first follow or resize pass.
- "Follow live = off" is violated whenever Size, Depth or Invert changes: the resize pass sets z to the *current* frame with alpha=1.
- **Fix:** anchor `{u, v, h}` with `h = z − fieldZ(u,v)` at capture. Place with `z = fieldZ + h`. On a resize with follow off, rescale z by `newDepth/oldDepth` rather than resampling.

**B9 (M). Replacing the source re-projects all old anchored growth onto the new picture.**
- The signature includes `field.request`. Old growth "morphs" into picture B at alpha 1. This is surprising for stills and never documented.
- **Fix:** on a source change, either detach old anchors (freeze) or make it an explicit option ("morph existing growth to new source").

**B10 (M). Resource leak on engine switch.**
- TS `unmount()` (2776) and v19 never dispose `backdrop` or `videoTex`.
- three's `VideoTexture` runs a `requestVideoFrameCallback` loop on the **shared** `<video>` element (bundle `class FU … e.requestVideoFrameCallback(h)`), cancelled only by `dispose()`.
- Every organism re-mount (`selectEngine('organism')` is called by activateReference, Simple looks, presets) can leave a live callback chain plus a GPU texture behind.
- **Fix:** dispose in unmount.

**B11 (M). Modes 3 and 4 and the two Simple intents barely differ; the docs disagree.**
- With the mimic spike removed, mode 4 = mode 3 with stick forced to 1 and edge strength ×1.6. Simple "Grow over relief" (mode 4, edge 1.35 → effective 2.16) clings to lines about as hard as "Trace details" (edge 2.5), and both force stick 1.
- NOTES_FOR_CLAUDE.md:61–63 and START_HERE_v0190.md:23–24 call them "Trace silhouette" / "Sculpt relief"; the buttons say "Trace details" / "Grow over relief".
- Loading a picture applies a **third** parameter set (mode 3, edge 1.2, scatter 0.7), which the notes call "Trace silhouette … the default" (NOTES_FOR_CLAUDE.md:63), and that is not true.
- **Fix:** define 2–3 intents with distinct guidance (§8.5). Loading a source applies the currently selected intent.

**B12 (M). Fit and framing do not work with the Simple "Still" camera (locked).**
- The camera simulation is skipped entirely while `cameraLockPose` is set (patch_music_focus.py:44–45). `#simpleFit` changes values that are never used.
- **Fix:** `fitReference()` must compute the facing pose and, if locked, re-capture the lock pose to it.

**B13 (L–M, needs browser). Clamping XY to the rectangle makes border-crawling lines.**
- `projectToField` clamps to ±0.499. A tip heading outward is pinned to the border and keeps extending along it, drawing the frame rectangle.
- **Fix:** reflect the direction at the border (like the shell `bounce`, TS 1460). If still outside, drop the tip.

**B14 (L). The backdrop is shown when guidance is off.**
- v19 ignores `videoMode` (TS hid it at mode 0). Simple "Music only" still shows the picture at opacity 0.55.
- **Decide:** probably hide it when mode 0 unless the user explicitly toggled "Show source".

**B15 (L). Double coverage visits for stills.**
- TS `addSeg` 1673–1677 plus the wrapper's 3×3 visit on `referenceUV.b`. Harmless but redundant. Keep one (anchor-based).

**B16 (L). Auto-fill side effects.**
- (a) Each auto seed fires `onEvent('spawn')`, so sound-back plays notes the user did not play.
- (b) Auto plants are never pruned by recycling (only `makeRoom` at the cap). Up to `min(16000, 0.8·budget)` permanent segments squeeze music growth under budget pressure.
- (c) Finished auto plants stay in `this.plants` forever: hundreds of objects scanned every frame.
- (d) The random pitch 48–71 decides the species and colour; there is no musical meaning.
- **Fix:** suppress sound-back for auto plants; let recycling take auto plants after music plants; optionally drive auto seeds from beats (§8.6).

**B17 (L).** The show toggles are inconsistent: Advanced remembers 0.55, Simple uses 0.45.

**B18 (L). Polling UI.**
- `setInterval(referenceSync, 400)` (plus `syncMusicControls` and others at 400 ms).
- `referenceSet`/`referenceValue` are misnamed generic helpers used by four other modules.
- **Fix:** subscribe to control changes (`onControlValue` / a `ctls` change event) and create generic `setOrganismCtl`/`getOrganismCtl` helpers in main.ts.

**B19 (L).** The Music-growth section (musicLed, amount, focus, trail, buildPace) was inserted *inside* `#referenceTools` (patch_music_focus.py:67), so it is hidden in Simple mode and reads as reference-only.

**B20 (L, perf). Analysis cost and timing.**
- Analysis runs every 1/30 s whenever a source is active, **even with guidance off** (`updateReference` calls `field.update` before the `videoOn` check).
- It uses a per-pixel closure `at()` with 9 clamped reads (≈190k calls per update at 192×108).
- It analyses on a fixed timer rather than on new video frames: 24 fps video is re-analysed, and the dt-based coverage reset is jittery.
- **Fix:** gate on `videoMode>0 || needsMapsForSoft`. Precompute neighbour indices as in the TS version. Use `video.requestVideoFrameCallback` to mark frames dirty. On weak machines drop to 128 px (hook into auto quality).

**B21 (L, needs browser).** The same `still` canvas is reused at a **different size** for a new picture, with only `needsUpdate` set. Resizing an existing texture may not reallocate the GPU texture on the WebGPU backend. **Fix:** create a new `CanvasTexture` (or a new canvas) per picture.

**B22 (L).** `openImage` calls `stop()` before decoding, so a picture that fails to decode kills the running camera or video. **Fix:** decode first, then swap.

**B23 (L).** For live video with >4000 anchored segments, the cursor-batched follow updates neighbouring segments on different ticks, so branch joints split for a frame or two. **Fix:** update joints by plant, or position endpoints from shared anchor records rather than per segment.

**B24 (pre-existing TS, M).** `writeSeg` clobbers `this.v1` (TS 1721), so after `addSeg`, `startSegment`'s `b` holds a normalised direction. Consequences:
- `p.reach = max(p.reach, b.distanceTo(p.root))` (TS 2015) is computed from garbage in every mode.
- This was the root cause of the v0.16 "central starburst" (NOTES_V0171.md:7–11).
- **Fix at the source:** a dedicated scratch in `writeSeg`.

**B25 (process). The tests encoded or masked the defects.**
- `Et:2` stub (B1).
- The uniformity goal (B4).
- The cliff test only checks a 15-unit spike (test-seeding.cjs:125), never the common 0.7–2.7 range.
- Stubs `newPlant`, `writeSeg` and `release`, so the real `startSegment`/`dropTip` path never ran.
- The author notes no browser run (NOTES_V0160.md:94, NOTES_FOR_CLAUDE.md:96–99).

**B26 (L).** `referenceFrameRadius` survives `clear()` and is only recomputed on a new source or Fit. After Size 22→60 the camera does not re-frame. This is intentional ("so enlargement is visible") but surprising; an auto-fit toggle may be better.

**B27 (L).** `activateReference` silently overrides `videoStick`, `videoSpawn` and `videoFollow` on every load, discarding the user's Advanced choices and preset values.

**B28 (interplay, calm-camera cluster).** If the first-run 700 ms timer fires before any frame has rendered (for example the page opened in a background tab), the lock captures `camera.position=(0,0,0)`. Observed live: `cameraLockPose.position = [0,0,0]`.

---

## 8. Recommended TypeScript design

### 8.1 Modules

```
src/midi/reference/
  referenceSource.ts   // ReferenceSource: owns <video>/still canvas/stream, request generation, open*/stop/listCameras/togglePlay,
                       //   rVFC-driven "frameDirty", onStatus. DOM-bound.
  referenceMaps.ts     // PURE: analyse(rgba: Uint8ClampedArray, w, h, prev: RefMaps|null, dt, isStill) -> RefMaps
                       //   relief (σ≈2 blur, alpha-premultiplied luminance), reliefSharp (3×3), edge, gx, gy, saliency,
                       //   backgroundLevel (border median). Precomputed neighbour indices. No closures in the hot loop.
  referenceSampling.ts // PURE: bilinear sample(), ImportanceSampler (prefix sums over saliency, rebuilt per revision),
                       //   Coverage (visited bitmap + 12×12 crowd grid with time-based decay), pickSeed({scatter, band?, rng})
  referenceField.ts    // ReferenceField = source + maps + sampler + coverage; update(time) -> boolean (changed); ready; revision
src/midi/engines/organism/referenceGuide.ts
                       // ReferenceGuide (owned by OrganismEngine): settings snapshot from ctl(), fieldSize, fieldZ, project,
                       //   limitStep, anchor/place, steer (moved steerByLines), followPass, autoFill, backdrop, framing, dispose
```

`videoField.ts` is kept as a thin re-export (or renamed) so `engine.ts:76` `setVideoField?(f)` keeps working. Rename the optional hook to `setReference?(f: ReferenceField | null)`.

### 8.2 Types

```ts
export interface RefAnchor { u: number; v: number; h: number } // h = height above relief at capture
export interface RefMaps { w: number; h: number; relief: Float32Array; reliefSharp: Float32Array; edge: Float32Array;
  gx: Float32Array; gy: Float32Array; saliency: Float32Array; background: number; revision: number }
export interface RefSettings { mode: 0|1|2|3|4; size: number; depth: number; invert: boolean; stick: number; edge: number;
  spawn: boolean; follow: boolean; build: boolean; buildPace: number; scatter: number; show: number }
// organism.ts additions
interface Seg  { /* … */ anchor?: { a: RefAnchor; b: RefAnchor } }
interface Tip  { /* … */ anchor?: RefAnchor }
interface Plant{ /* … */ refAuto?: boolean; rootAnchor?: RefAnchor }
```

### 8.3 Engine integration (no monkey patches)

- **`frame()`:** `this.ref.update(m, g)` right after `lastGTime` (§5 #6). Delete TS 2536–2539.
- **`addSeg()`:** after creating `seg`, when `this.ref.on && !plant.isText`, set `seg.anchor = {a: ref.anchor(seg.a), b: ref.anchor(seg.b)}`, `plant.rootAnchor ??= ref.anchor(plant.root)`, and `ref.coverage.visit(seg.anchor.b)`. **No rejection.**
- **`startSegment()`** (TS 1961–1966), after `projectToField(b, n)`:
  - Border: if `b` would leave the rectangle, reflect `dir` on that axis and recompute `b`. If still outside, `dropTip`.
  - Slope limit: `dz = b.z − tip.pos.z`; `lim = SLOPE_MAX·len` (start with `SLOPE_MAX = 1.5`); `b.z = tip.pos.z + clamp(dz, −lim, lim)`.
  - Z comes from `relief` (smooth). Steering keeps using `edge`/`grad` (sharp).
- **`finishSegment()` and every tip creation from a segment endpoint:** `tip.anchor = seg.anchor?.b` (spawn, re-sprout, burst).
- **`followPass`:** place `a/b` from anchors (`z = fieldZ + h·stickFactor`). Place `plant.root` from `rootAnchor`. Place `tip.pos` from `tip.anchor`, or from `tip.seg.a`. Keep the 4000-per-tick budget.
  - With follow off, only a size/invert change triggers a pass: XY rescale plus z rescale by the depth ratio, with no resampling of the live frame.
- **Decay:** `if (!target && p.refAuto && !p.dying && !this.reversing) continue` (TS 2450). Let recycling pick auto plants after music plants: sort or second-pass.
- **`clearGrowth()`:** `this.ref.onClear()`.
- **`unmount()`:** `this.ref.dispose()` (backdrop geometry/material, texture).
- **`setControl()`:** `this.ref.onControl(key)` marks dirty. The backdrop is updated in `ref.update`.
- **`GROUP`:** add `videoBuild, videoFollow, videoInvert, videoScatter, videoBuildPace` as `'Video'`.

### 8.4 Backdrop and framing

- `ReferenceBackdrop`: one `PlaneGeometry(1,1)` and one `MeshBasicMaterial({transparent, depthWrite:false, toneMapped:false, side: THREE.DoubleSide})`.
- A **new `CanvasTexture` per still picture**; `VideoTexture` for video/camera. Dispose on source change, stop and unmount.
- Hide when `show ≤ 0`, or (decision) when `mode === 0`.
- `ReferenceGuide.framing(): {center: Vector3(0,0,0), radius: sqrt((w²+h²+depth²)/4), normal: +Z}`. The orbit branch (TS 2574–2610; `mode === 0` at 2595) uses it when the reference is on.
- `fitReference()` (public engine method, replacing UI pokes at private fields):
  - Sets `theta` so `theta + manTheta = π/2` (camera on +Z), `manPhi = 0`, a small elevation (φ≈0.12), `zoomMul=1`, `pan=0`, `camMode=0`, and the distance from the radius.
  - If the camera lock is active, snaps `camPos/camLook` and **re-captures** the lock pose.
- Call `fitReference()` automatically on the first activation of a new source.
- Replace calm "gentle orbit" with a ±30° pendulum around +Z while the reference is on.

### 8.5 Activation and intents (one place)

`applyReferenceIntent(intent: 'trace' | 'relief' | 'off')` in main.ts is the only routine that writes the guidance preset.
- Loading a source calls `applyReferenceIntent(lastIntent ?? 'trace')` and then `fitReference()`.
- Keep the Simple values from §2.8, but make them genuinely different:
  - **trace:** mode 3, edge 2.5, scatter 0.25, stick 1, low branching.
  - **relief:** mode 1 ("depth" — no line steering, so the surface fills) or a new mode 4 meaning "relief fill": stick 1, edge 0.4, scatter 0.6, more branching.
- Never touch the user's `videoSize/videoDepth/videoShow`.
- `#refEnable` = "apply the current intent". Remove the `set(4)` followed by `set(3)` double write.

### 8.6 Make it an obvious music visualiser (optional, all toggleable; owner priority)

- **Pitch → region:** when `videoSpawn` is on, the note pitch selects a vertical band of the picture (low notes at the bottom, high notes at the top; the band width scales with the playing range). `pickSeed({band})` samples saliency within that band. Playing a melody visibly "paints" different parts of the image.
- **Velocity → strand thickness and speed** (already partly via `r0` and rate).
- **Build shape on the beat:** auto seeds fire on `m.beat.hit > 0.9` or on onsets, at most `videoBuildPace` per second, instead of on a free-running timer. No sound-back for auto seeds.
- **Relief pulse** (optional): backdrop opacity or relief depth breathes slightly with bass. It is off by default, per the calm-camera preference.

### 8.7 UI (main.ts + index.html)

- Port the §4.1 markup as a `<details class="sec" id="sec-reference">` directly under Input (not nested with music-growth controls). Keep the ids so presets, docs and tests line up.
- Use generic helpers `setOrganismCtl(key, v)` / `getOrganismCtl(key, fallback)`, plus a `syncReferencePanel()` invoked from `Ctl.set`/`sync` for `video*` keys and from `field.onStatus`. **No `setInterval`.**
- In Simple mode, expose Show source, Fit, Size and Depth (two sliders), not only the intents.
- Assign `field.onStatus` in main.ts (TS never did).
- Replace `c.set(4)` in `openImage` and the conditional `set(3)` in `afterVideoOpened` (main.ts:672–684) with `applyReferenceIntent`.

### 8.8 Do NOT port as-is

- `Object.assign(tw.prototype, …)` and prototype wrappers around `addSeg/finishSegment/clearGrowth/writeColor/clear`.
- Returning `null` from `addSeg` for depth cliffs (tip death).
- The `side:Et` literal; use the named `THREE.DoubleSide`.
- Clamp-to-border without reflection.
- Uniform-coverage seeding as the objective (and `test-seeding.cjs`'s uniformity assertions).
- 400 ms polling. UI code reaching into private engine fields (`fieldSize`, `zoomMul`, `pan`, `referenceFrameRadius`).
- `activateReference`'s silent 5-control override. The `c.set(4)`-then-`set(3)` sequence.
- Re-projecting old growth onto a newly loaded source without an explicit option.
- The duplicate still-only `visit` in `addSeg` (TS 1673–1677).
- `update(performance.now()/1000)` inside `open*` (clock coupling); let the engine's update analyse on the next frame.

---

## 9. Acceptance tests

### 9.1 Unit-testable (node / vitest; add `vitest` as a devDependency: the repo has no test runner, package.json:8–13)

**referenceMaps**
1. A 4×2 RGBA fixture with alpha=0 pixels gives relief 0 there.
2. A uniform grey 0.5 image gives relief 0.5 everywhere and edge ≈ 0.
3. A horizontal ramp with slope s gives edge ≈ min(1, 7.2·s) (for the 3×3 map).
4. Portrait 2×100 bounds to h=192, w≥2 (both axes capped).
5. Live temporal easing: the second update with dt=1/30 gives relief between the old and new value by factor `1−e^{−0.3}`. A still gives alpha 1.

**Sampling**
6. Bilinear `sample` at texel centres returns exact values and clamps outside [0,1].
7. `pickSeed` on the synthetic-face fixture with `scatter=0.2`: ≥ **60%** of 2000 seeds land where saliency > median (vs. 21% today). With `scatter=1`, the distribution is within ±3 pp of uniform per quadrant.
8. The band option: all seeds have v inside the band.
9. The crowd grid decays by time, not by call count.

**Geometry**
10. `anchor(place(anchor(p)))` round-trips within 1e-9, including `h`.
11. With `stick=0.5`, a point 1 unit above the relief keeps `h=1` after a follow pass.
12. With follow off, a Size change rescales XY and z by the depth ratio without sampling a new frame.
13. The step limiter: with a depth cliff of 8 and step length 0.25, `|b.z − a.z| ≤ 1.5·0.25` and **no tip is dropped**.
14. Border reflection: a tip at x=0.49w heading +x ends inside with reflected dir.x < 0.

**Engine (with a fake renderer or headless three objects)**
15. `startSegment` with a reference on never calls `dropTip` for slope reasons. Over 120 frames × 3 notes, segments added with the reference on ≥ 80% of those with it off (today: 25 vs 54 for trace).
16. `isText` segments are never anchored and do not move on a Size change.
17. The anchor comes from `seg.a/seg.b` even when the caller passes `this.v1` (regression for the starburst; also assert `writeSeg` no longer mutates `this.v1`).
18. All tips created from a segment endpoint carry an anchor.
19. `clearGrowth` resets coverage, crowd grid, cursor and seed timer.
20. Auto-fill:
    - off ⇒ no plants;
    - on ⇒ first seed only after `1/pace`;
    - ≤ `min(4, maxLive)` active;
    - stops at `min(16000, 0.8·budget)`;
    - turning it off releases active auto plants and keeps finished segments;
    - no `onEvent('spawn')` for auto seeds.
21. `GROUP` contains every `video*` key, so the mount-time group of each is `'Video'`.
22. `unmount()` disposes the backdrop material, geometry and texture (spy on `dispose`).
23. The backdrop material side equals `THREE.DoubleSide` (**assert against the real three constant, not a stub**).

### 9.2 Needs a browser (Chrome WebGPU and Safari/Firefox WebGL2, visible tab)

24. Load a face photo in Simple mode with the Still camera. The camera faces the picture (view dir · +Z ≤ −0.9). The source is visible at the Show-source opacity, and "Show / hide source" visibly toggles it from the front.
25. Play 3 notes for 2 s in Trace. Growth visibly runs along the eyes and jaw outline and does not stop at edges. The segment count is within 20% of reference-off.
26. "Fit source" works with the camera locked: the view re-frames facing the whole picture and the lock is preserved.
27. Load a portrait, then a landscape. The backdrop texture has the right aspect with no stale or stretched image. The frame radius updates. Old growth either freezes or morphs per the chosen option.
28. A live camera with Follow on: growth depth follows a moving hand, and branch joints stay connected (no gaps at branch points). With Follow off, moving the Size slider does not resample depth.
29. Stop the camera during the permission prompt: the late permission stops its tracks, and the status is correct. Unplug the camera: the status says "camera disconnected".
30. Switch engine away and back 10 times with a video loaded. The rVFC callback count and GPU memory do not grow (DevTools Performance monitor).
31. A transparent PNG logo: transparent areas stay at the far plane and the logo outline is traced.
32. Weak-laptop check: with a 1080p video reference and guidance on, the analysis cost is ≤ 1 ms per analysed frame at 192 px. With guidance off, no analysis runs (profiler).
33. Recording (other cluster): a take with the reference visible opens in QuickTime and VLC and shows the backdrop.
34. The panel shows all reference controls under the "Video" section in Advanced, and the Simple mode reference card works without Advanced.

### 9.3 Evidence gathered for this report (reproducible)

Environment: the v0.19.0 standalone copied to scratch and served on localhost, Chrome WebGPU backend, frames driven via `window.__viz.engine.frame(__viz.clock.state, __viz.g)` with `dt = 1/60`. The synthetic 384×216 face picture was loaded via `__viz.videoField.openImage(File)` followed by `#refEnable.click()`.
- `backdrop.material.side = 1 (BackSide)`, texture `IU` (CanvasTexture).
- Unlocked calm orbit after 3 s: `camPos = (30.72, 9.5, 0)`, `camLook = (0,0,0)`, `referenceFrameRadius = 175.285`, `theta = 0`, **0.0° from edge-on**.
- Cliff kills: the §7 B3 table.
- Seeding: the §7 B4 numbers.
- Text flattening: the §7 B6 numbers.
- Groups: the §7 B5 list.
- An attempt to capture a pixel snapshot of the backdrop returned black for both BackSide and DoubleSide, because the pane was hidden and the WebGPU snapshot was empty. The visibility claim in B1 therefore rests on three's documented `side` semantics and the verified constant value, not on a screenshot.
