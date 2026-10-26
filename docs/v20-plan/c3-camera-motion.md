# C3: Cameras & motion (v0.17.0 → v0.19.0), porting specification

**Cluster:** cinematic camera modes (tip glide, cinematic tour, wide pulse), Shift+middle-drag pan and the pointer fixes, camera lock (including across Reset), calm camera plus the Simple-mode camera presets, and screen bounce.
**Target:** TypeScript source `C:\Users\User\Desktop\code\growth-midi-visualiser` at tag `v0.15.0` (commit 42083cc).
**Origin:** compiled-patch lineage `C:\Users\User\Downloads\growth-v0190`. The bundle is `assets/index-BWYXfAkm.js` (1,457,993 bytes, `LM="0.19.0"`).
**Status of the origin code:** never rendered in a browser by its author (NOTES_V0170 "What was verified", NOTES_V0172, NOTES_V0180, NOTES_FOR_CLAUDE "Verification and limits"). All four related node suites pass today: `test-motion.cjs`, `test-music-focus.cjs`, `test-stage-tips.cjs` and `test-consolidation.cjs`. I ran them read-only. Their coverage is thin (see §7, B22).

### Files read in full

- **v19 cluster modules:** `maintenance/cinematic-camera.js`, `performance-ui.js`, `calm-camera.js`, `music-focus.js`, `music-focus-ui.js`, `stage-motion.js`.
- **v19 patch scripts:** `maintenance/patch_performance.py`, `patch_music_focus.py`, `patch_species_stage.py`, `patch_consolidation.py`.
- **v19 tests:** `maintenance/test-motion.cjs`, `test-music-focus.cjs`, `test-stage-tips.cjs`, `test-consolidation.cjs`.
- **Related v19 UI files:** `maintenance/simple-ui.js`, `extra-controls.js`, `interface.js`, `interface.css`, `reference-ui.js` (refFit only), `validate.py`.
- **Notes and docs:** `NOTES_V0170.md`, `NOTES_V0172.md`, `NOTES_V0180.md`, `NOTES_FOR_CLAUDE.md`, `START_HERE_v0190.md`, `README.txt`.
- **v19 markup:** `index.html`.
- **Relevant slices of the v19 bundle:** the camera block, pointer handlers, `clear()`, `draw()`, the stageDraw wrapper, the keydown handler, the GROUP map, the `mount()` group assignment, `T5`/`w5`/`_5`, `referenceSet` and `referenceValue`.
- **TS source:** `src/midi/engines/organism.ts` (controls, fields, `mount()` pointer handlers, `clear()`, `setControl()`, `draw()`, `snapshot()`, and the whole of `frame()`, including the camera section at 2571–2737), `src/midi/main.ts` (widget/ctls, selectEngine, renderEngineControls, camera cycle, keydown, loop zoomNow/rotNow, URL params, presets), `src/midi/engine.ts`, `src/midi/music.ts` (dt clamp), `src/midi/inputMidi.ts` (piano key row), `index.html`.

### Notation

- **Offsets:** `bundle@N` is the character offset of an anchor in the v19 bundle (Python `str.find`).
- **Line numbers:** TS line numbers refer to v0.15.0.
- **Minified names inside `OrganismEngine.frame()`:**
  - Music and timing: `e`=m (MusicState), `t`=g (GlobalParams), `s`=dt, `n`=t (time), `a`=camModeNow.
  - Camera block: `Ls`=mode, `ya`=camSpeed (`orbit`), `Lr`=c (centroid scratch, which is `this.v1`), `ob`=segment count, `HM`=follow, `ab`=r2, `Pl`=radius, `C5`=breathe, `xa`=`this.camTarget`, `rr`=`this.camLookT`.
  - Other: `Te`=wild, `Be`=rnd, `Gd`=gesture, `Tu`=lightReact (TS `react` at 2704).
  - Library aliases: `A`=THREE.Vector3, `Pa`=Y_AXIS, `Se`=THREE.Color, `G`=ctl, `sl`=setCtl.
- **Minified names in the `mount()` pointer handlers:** `o`=canvas, `l`=event, `c`=dx, `u`=dy, `h`=fwd (`this.v2`), `d`=right (`this.v3`), `f`=pan scale k, `a`=end().
- **Minified names in main:** `Zt`=ctls, `te`=engine, `Y`=$, `vs`=setStatus, `Fm`=selectEngine, `M5`=resetEngine, `_5`=cameraCtl, `T5`=cameraLabel, `w5`=cycleCamera, `pd`=setUiHidden, `Hi`=save.

---

## 1. Summary

### What the user gets

1. **Three extra camera modes, appended at indices 6–8:**
   - **Tip glide:** a smoothed orbit around the newest growing tip.
   - **Cinematic tour:** the same orbit, hopping between the currently growing plants every 3–5 s.
   - **Wide pulse:** a slow orbit framing the whole structure, with the distance pushed slightly by smoothed bass.

   New controls: `camDistance` (shot distance) and `camSmooth` (tracking response). `orbit` still sets the speed. Manual orbit, pan and zoom offsets work in these modes. **C** cycles all nine modes. A new "Flow & camera" panel section has a `cameraPreset` select offering 5 of the 9 modes. *(v0.17.0)*
2. **Shift + middle-drag pans.** Middle-drag orbits and right-drag still pans. Pan now moves along the camera's screen-up axis and scales with the actual shot distance. Losing pointer capture ends a drag. *(v0.17.0)*
3. **Camera lock:** a floating top-right button (`#cameraLock`) freezes the exact camera pose (position, quaternion, look, near, far, fov). While locked:
   - all automatic camera motion stops, and so do tunnel culling and gesture head parallax;
   - mouse orbit, pan and zoom are ignored;
   - Reset keeps the view.

   The lock lasts for the session only. *(v0.17.2)*
4. **Screen bounce, the "DVD logo" effect:** the rendered sculpture is scaled down to a target screen size and translated across the frame by a lens shift in the projection matrix, reflecting at the edges. Controls: speed and screen size. It appears in recordings and snapshots. *(v0.18.0)*
5. **Calm camera** (`calmCamera`, default **on**). When on:
   - the orbit's audio "breathe" distance and its sine wobbles are removed;
   - kick and shake are gated off;
   - fog is forced to 0.002.

   Simple mode adds a Camera select with three choices:
   - **Still:** camMode 0, orbit 0, and **the camera lock turned on**.
   - **Very slow orbit:** orbit 0.08, unlocked.
   - **Manual only:** orbit 0, unlocked.

   Every Simple "look" button and the Surprise button force Still and lock the camera. *(v0.19.0)*

### Net effect today (lead's observations, confirmed by analysis)

The default first-run camera is a **hard pose lock captured about 0.7 s after load**, before anything has grown. From that pose, roughly ±5 units of the scene are visible vertically, while growth can reach 14 units from the centre. Growth, silk ribbons especially, leaves the frame, and nothing ever reframes. The v0.17 cinematic modes are reachable only through Advanced controls or the C key.

---

## 2. Behaviours (exact algorithms and constants)

### 2.1 Pointer navigation (v0.17.0 edits and v0.17.2 lock guards)

Baseline: TS `organism.ts:608-645`. The v19 handlers are at bundle@1112660 and are equivalent to the following.

```text
contextmenu → preventDefault                                    (unchanged, TS 610)
pointerdown(ev):
  if (cameraLockPose) return                                    (v0.17.2)
  if (ev.button !== 1 && ev.button !== 2) return                (unchanged: middle / right only)
  dragBtn = ev.button; dragX = ev.clientX; dragY = ev.clientY
  try canvas.setPointerCapture(ev.pointerId); ev.preventDefault()
pointermove(ev):
  if (cameraLockPose || dragBtn < 0) return                     (v0.17.2 adds the lock test)
  dx = ev.clientX - dragX; dy = ev.clientY - dragY; dragX/Y = ev.clientX/Y
  if (dragBtn === 1 && !ev.shiftKey)                            (v0.17.0: Shift tested on EVERY move)
     manTheta += dx * 0.006
     manPhi    = clamp(manPhi + dy * 0.006, -1.2, 1.2)
  else                                                          (right-drag, or Shift+middle-drag)
     fwd   = normalize(camLook - camPos)                        (this.v2)
     right = normalize(fwd × Y_AXIS)                            (this.v3)
     k     = |camPos - camLook| * 0.0012                        (v0.17.0; was this.dist * 0.0012)
     up    = normalize(right × fwd)                             (v0.17.0; was world Y_AXIS; allocates new Vector3 per move)
     pan  += right * (-dx * k) + up * (dy * k)
pointerup / pointercancel / lostpointercapture → dragBtn = -1   (v0.17.0 adds lostpointercapture)
wheel(ev) {passive:false}:
  if (cameraLockPose) { ev.preventDefault(); return }           (v0.17.2)
  zoomMul = clamp(zoomMul * exp(ev.deltaY * 0.0012), 0.2, 5); ev.preventDefault()
```

- Pressing or releasing Shift in the middle of a drag switches between orbit and pan without starting a new drag. NOTES_V0170 documents this as intended.
- `toggleCameraLock()` sets `dragBtn = -1` when it locks.
- **Where the manual offsets take effect:**
  - Mode 0, orbit (TS 2600–2604): `ang += manTheta`, `phi += manPhi`, `d *= zoomMul`, `+ pan`.
  - Modes 6–8, cinematic: the same four terms (§2.3).
  - Modes 1–5 (weave, tunnel, drift, sit, chase) ignore all four, but the values still accumulate (B14).

### 2.2 Camera mode list and the guards added around the legacy camera (v0.17.0)

- **Control definition** (TS `organism.ts:403`): `camMode` `max` goes from 5 to 8. The options become `["orbit","weave through","tunnel","drift inside","sit inside","chase the newest growth","tip glide","cinematic tour","wide pulse"]`. Indices 0–5 keep their meanings, so presets and the `?cam=` URL parameter stay compatible.
- **Sit-inside fall-through fixed** (TS 2665): the final bare `else { … sit inside … }` became `else if (mode === 4) { … }`. Modes 6–8 therefore run none of the legacy branches. Every branch still shares the centre/radius computation that precedes it (TS 2575–2592).
- **growAtCam** (TS 1594, inside `newPlant()` root placement): the condition changed from `camMode > 0 && growAtCam > 0` to `camMode > 0 && camMode < 6 && growAtCam > 0`. The cinematic modes never spawn roots ahead of the camera.
- **Fog** (TS 2712): the view-scaled orbit fog rule `0.55 / (|camPos − center| + radius + 4)` now applies when `mode === 0 || mode >= 6`. Other modes keep `0.05`. The later v0.17.2 and v0.19.0 fog changes are in §2.6 and §2.7.
- **Unchanged near plane** (TS 2285): `near = camModeNow === 0 ? 0.05 : 0.4`, so **modes 6–8 use near = 0.4** (B11).
- **Unchanged shell** (TS 2283): `shellOn = camModeNow !== 2`.
- **Ordering:** `this.updateCinematic(m, g)` is called **after** the wild-jitter and kick/shake blocks (TS 2673–2681) and **before** `this.repel = null` and the gesture block (TS 2682–2701). In the v19 bundle it follows `this.focusCameraExtent = Pl` (v0.17.2).

### 2.3 `updateCinematic(state, globals)`: exact algorithm (source `maintenance/cinematic-camera.js`, 37 lines)

```text
mode = camMode; if mode < 6 return
time = state.time; dt = min(0.1, state.dt)               // state.dt is already clamped to [0.001, 0.05] by music.ts:149
speed = ctl('orbit')            // 0..2, default 0.5
smooth = ctl('camSmooth')       // 0..1, default 0.35
distance = ctl('camDistance')   // 2..40, default 9
alive = plants.filter(p => (p.held || p.autoUntil > time) && p.tips.length)     // allocates per frame
target = newCenter.clone()                                                      // default focus
tipPosition(p) = let tip = p.tips[p.tips.length-1]
                 tip.seg ? lerp(tip.seg.a, tip.seg.b, min(1, tip.seg.growth)) : tip.pos   (clones)
if mode == 6 (tip glide) and alive.length:  target = tipPosition(alive[alive.length-1])      // newest alive plant's LAST tip
if mode == 7 (tour) and alive.length:
     if (!alive.includes(tourPlant) || time > (tourSwitch ?? 0)):
          tourIndex = (tourIndex ?? -1) + 1
          tourPlant = alive[tourIndex % alive.length]
          tourSwitch = time + max(2, 5 - speed)          // 5 s at speed 0 … 3 s at speed 2 (the max(2,…) never binds)
     target = tipPosition(tourPlant)
radius = distance * zoomMul / max(0.2, globals.zoomNow)
if mode == 8 (wide pulse):
     target = center.clone()
     extent = sqrt(referenceFrameRadius || 0)            // referenceFrameRadius stores a SQUARED radius (v0.16 reference code)
     stride = max(1, ceil(segs.length / 512))
     for i in 0, stride, 2*stride …: extent = max(extent, |segs[i].b − target|)
     radius = max(distance, extent * 2.2 + 5) * zoomMul / max(0.2, globals.zoomNow)
cinematicAngle = (cinematicAngle ?? 0) + dt * speed * (mode == 8 ? 0.14 : 0.30)
angle     = cinematicAngle + manTheta
elevation = clamp(0.25 + manPhi + 0.16 * sin(time * 0.21), -1.2, 1.2)                  // NOT gated by calmCamera
cinematicBass += (state.bass − cinematicBass) * (1 − exp(−dt * 3))                      // ~0.33 s EMA
radius *= 1 − 0.07 * cinematicBass                        // applies to ALL of 6/7/8, NOT gated by calmCamera
position = (sin(angle)·cos(elev), sin(elev), cos(angle)·cos(elev)) * radius + target + pan
target  += pan
alpha = 1 − exp(−dt * (1 + smooth * 7))                   // rate 1 (τ=1 s) … 8 (τ=0.125 s); default 3.45 (τ≈0.29 s)
camPos.lerp(position, alpha); camLook.lerp(target, alpha)
```

**Derived numbers:**

- **Revolution times at the default `orbit` 0.5:** modes 6/7 take about 42 s per revolution and mode 8 about 90 s.
- **Tour interval:** 5 s at orbit 0, 4.5 s at the default, 3 s at orbit 2.
- **Azimuth convention differs from orbit mode 0:** orbit uses `x = cos(ang)`, `z = sin(ang)` with its own accumulator `theta`. The cinematic modes use `x = sin`, `z = cos` with `cinematicAngle`. Switching between mode 0 and modes 6–8 therefore swings the camera across the scene, and the Cartesian lerp cuts through the orbit sphere on the way (B9).
- **The camera block also moves the camera in the cinematic modes:** the kick/shake and wild perturbations applied to `camPos` just before `updateCinematic` survive largely intact, because the lerp only removes `alpha` of them per frame.

### 2.4 Camera lock (v0.17.2, `maintenance/music-focus.js` lines 3–17, with `patch_music_focus.py` lines 44–48)

```text
toggleCameraLock():
  if (cameraLockPose) { cameraLockPose = null; return false }
  if (!camera) return false
  cameraLockPose = { position: camera.position.clone(), quaternion: camera.quaternion.clone(),
                     look: camLook.clone(), near: camera.near, far: camera.far, fov: camera.fov }
  dragBtn = -1; return true
applyCameraLock():
  pose = cameraLockPose; if (!pose) return
  camPos.copy(pose.position); camLook.copy(pose.look)
  camera.position.copy(pose.position); camera.quaternion.copy(pose.quaternion)
  if (camera.near/far/fov differ from pose) { assign; camera.updateProjectionMatrix() }
```

**Frame integration** (the patch at bundle@1157470):

- The **entire** camera section is wrapped in `if (!this.cameraLockPose) { … } else this.applyCameraLock()`. The wrapper runs from `const camSpeed = …` (TS 2574) through `this.camera.lookAt(this.camLook)` (TS 2702).
- While locked, all of the following are skipped:
  - the centroid and `this.center` update (TS 2575–2588);
  - the radius (2589–2591) and `this.dist`;
  - every mode branch, including tunnel culling (2630–2638);
  - wild jitter (2673) and kick/shake (2674–2681);
  - `focusCameraExtent`;
  - `updateCinematic`;
  - **`this.repel = null` and the whole gesture block** (2683–2701);
  - `lookAt`.
- The aspect ratio keeps working, because `resize()` is outside the wrapper and the lock does not store aspect.
- Code after the wrapper still runs: lights, fog (with the frozen `focusCameraExtent`), `camFwd` from the locked `camPos`/`camLook`, `pointLight.position = center` (frozen), auto quality, and `draw()`.
- The near-plane code at the top of `frame()` (TS 2285) still runs first. If the camera was locked in a mode with a different near value, the projection is updated twice per frame (B20).
- Captured `camera.position` includes any gesture head-parallax offset present when the lock was taken.

**Input:** pointerdown, pointermove and wheel all return early when locked (§2.1).

### 2.5 Lock across Reset (v0.17.2, `music-focus.js` lines 51–58, a prototype wrapper on `clear()`)

```text
clear():
  keys    = ['center','newCenter','camPos','camLook','heading','pan','camTarget','camLookT']   (Vector3 clones)
  scalars = ['dist','manTheta','manPhi','zoomMul','theta','cinematicAngle']
  saved   = cameraLockPose ? snapshot(keys, scalars) : null
  original clear()     // TS 749-760: clearGrowth + reset center/newCenter/dist/camPos/camLook/heading/manTheta/manPhi/pan/zoomMul
  musicCredit = 0; focusCursor = 0      // music-focus cluster
  if (saved) { restore keys and scalars; applyCameraLock() }
```

- If not locked, Reset resets the camera exactly as in v0.15: camPos (0, 2, 12), dist 14, and so on.
- `cinematicAngle`, `cinematicBass`, the `tour*` fields and all `bounce*` fields are **never** reset by `clear()`.
- After Reset, `tourPlant` points at a discarded plant, so `alive.includes(tourPlant)` is false and the tour immediately re-picks.

### 2.6 `focusCameraExtent` (v0.17.2)

- Inside the unlocked block, the patch adds `this.focusCameraExtent = radius` (`Pl`) just before `updateCinematic`.
- The fog formula (TS 2712), which sits outside the block, reads `this.focusCameraExtent ?? 2` instead of `radius`, because `Pl` is now block-scoped.
- While locked, the fog therefore uses the last unlocked extent.

### 2.7 Calm camera (v0.19.0, `patch_consolidation.py` lines 21–31)

Control: `calmCamera` (0/1, **default 1**), inserted just before `camMode`. Read once per frame, `calm = ctl('calmCamera') > 0`, before the lock test. The edits:

| Term | TS line | v19 expression |
|---|---|---|
| breathe (orbit distance) | 2592 | `breathe = calm ? 1 : 1 + 0.03*energy + 0.05*onset` |
| orbit azimuth wobble | 2600 | `ang = theta + manTheta + g.rotNow*0.5 + (calm ? 0 : sin(t*0.37)*0.04)` |
| orbit elevation wobble | 2601 | `phi = clamp(0.3 + (calm ? 0 : 0.25*sin(t*0.11)) + manPhi, -1.4, 1.4)` |
| kick / shake | 2676-2678 | `react = ctl('react') * (calm ? 0 : 1)`, so `kick = ctl('kick')*react` and `shake = ctl('shake')*react` |
| fog | 2712 | `density = calm ? 0.002 : (<orbit/cinematic rule or 0.05>) * (1 + 0.8*sustain*lightReact) * (env==2 ? 1.6 : 1)` |

**Not gated by calm** (B5):

- Orbit speed stays energy-modulated: `theta += dt*orbit*(0.18 + 0.35*energy)`.
- Weave speed `(0.25 + 0.4*energy)` and the weave beatLock bar cut `+1.3 rad`.
- Tunnel speed `(2.2 + 2*energy)`.
- Wild jitter `camPos += rnd3 * wild*onset*0.25` when `onset > 0.3`.
- The cinematic bass push (`radius *= 1 - 0.07*bassEnv`) and the cinematic elevation wobble.
- `g.zoomNow` from `main.ts:1059-1062`: `zoomReact` and `beatZoom`, plus a permanent `1 + 0.025*sin(t*0.35)` breathing.
- `g.rotNow` from `main.ts:1071`, which includes pitch bend and CC1. That one is arguably performer control rather than audio.

### 2.8 `setCalmCamera(mode)` and the Simple camera select (v0.19.0, `calm-camera.js` and `simple-ui.js` lines 31–32 and 87–92)

```text
setCalmCamera(mode = 'still'):              // engine method; writes controls through this.setControl (engine-side only!)
  set calmCamera 1; camFollow 0; growAtCam 0; kick 0; shake 0
  if mode == 'still': camMode 0; orbit 0; if (!cameraLockPose) toggleCameraLock()      // LOCK at whatever pose exists now
  else:               if (cameraLockPose) toggleCameraLock()                            // unlock
                      camMode 0; orbit = (mode == 'gentle' ? 0.08 : 0)
#simpleCamera onchange: if engine != organism → return
  'manual' → if locked, toggleCameraLock(); then setCalmCamera('manual')     (redundant unlock)
  otherwise → setCalmCamera(value)
simpleApplyLook(id, …)  [every look button, Surprise, and first run]:
  … sets look controls through Zt (persisted) …
  simpleGlobal zoomReact 0, beatZoom 0, rotSpeed 0      (through Zt, persisted)
  te.setCalmCamera('still')                              (engine-side, NOT persisted; locks)
  if clear → M5()  (resetEngine → clear wrapper keeps the lock)
first run: setTimeout(700 ms) → if localStorage 'growth-good-start-v0190' is absent → set it → simpleApplyLook('roots')
```

**Consequences, all verified against the code:**

1. **The first-run Still pose is taken about 0.7 s after load**, while the orbit is still converging from (0, 2, 12):
   - `dist` lerps from 14 toward `(2*2.1 + 5)/zoomNow ≈ 9.2` at rate 1.2 s⁻¹, so it is about 11.2 at 0.75 s.
   - Visible half-height ≈ 11.2 · tan 24° ≈ 5.0 units.
   - Organism size defaults to 14 (TS 376), and the sphere bound pulls tips back only beyond 14 (TS 1989–1998). Most growth leaves the frame.
2. **Control changes made by `setCalmCamera` are not persisted.**
   - `setControl` does not update `settings.engineCtl`; only the widget `apply` path does (main.ts 332–336), or the engine's `onControlValue` hook (main.ts 261–266).
   - After a reload: the lock is gone, orbit is back to 0.5, camFollow 0.5, growAtCam 1, kick 0.5, shake 0.15, and the Still one-shot does not run again.
   - The select still shows "Still — growth moves" while the camera orbits.
3. **Stale Advanced widgets.** The Advanced panel widgets for camMode, orbit, kick, shake, camFollow, growAtCam and calmCamera keep showing their old values. Only `#camCycle` refreshes, because `cameraLabel()` runs every 6th frame in the HUD loop (main.ts 1106; `T5()` in the bundle loop).
4. **Look buttons fight the select.** Choosing Gentle or Manual and then clicking any look re-locks the camera into Still without changing the select.
5. **"Manual only" is not manual:** mode-0 orbit still auto-frames. `dist` follows the radius and `center` follows the centroid; only the azimuth is static.

### 2.9 Screen bounce (v0.18.0, `maintenance/stage-motion.js` plus the draw wrapper in `patch_species_stage.py` lines 21–28)

**Pure step function:**

```text
reflectedStep(position, direction, distance, limit):
  if limit <= 0: return {position: 0, direction}
  if distance <= 0: return {position: clamp(position, -limit, limit), direction}
  x = position + direction*distance; span = 2*limit
  phase = ((x + limit) mod (2*span) + 2*span) mod (2*span)     // triangle-wave fold
  if phase > span: x = limit - (phase - span); direction = -direction
  else x = phase - limit
  return {position: x, direction}
```

This is correct for any start inside [−limit, limit], either direction, and any distance (verified by reasoning and by `test-stage-tips.cjs`).

**Bounds estimate**, `updateBounceBounds(time)`, refreshed at most every 0.25 s:

- Call `camera.updateMatrixWorld()`, then project sample points with the **current (un-bounced) projection** into NDC.
- Skip a point if its view-space z ≥ −near (at or behind the near plane), if it is non-finite, or if |ndc| > 100.
- **Samples:**
  - both endpoints of every `stride = max(1, ceil(segs.length/384))`-th segment;
  - if `videoOn`: the 8 corners of the box ±w/2, ±h/2, ±videoDepth/2, where `{w,h} = fieldSize()`, centred on the origin;
  - else if `shell`: the 8 corners of ±shellSize·1.3;
  - for each visible soft mesh: `geometry.computeBoundingBox()`, then its 8 corners (soft-mesh vertices are in world space).
- **Result:** `bounceBounds = {x: midX, y: midY, hx: max(0.1, (maxX−minX)/2)*1.05, hy: max(0.1, (maxY−minY)/2)*1.05}`, or `{0, 0, 1, 1}` if there are no points.

**`beginScreenBounce()`**, called before every `draw()`, including snapshot draws:

```text
if !screenBounce: bounceLastTime = null; return null
time = performanceState?.time ?? 0
dt = bounceLastTime == null ? 0 : clamp(time - bounceLastTime, 0, 0.05); bounceLastTime = time
updateBounceBounds(time)
bounceSmooth ??= copy(bounceBounds)           // never reset afterwards
alpha = 1 - exp(-dt*6); bounceSmooth[x,y,hx,hy] += (bounceBounds - bounceSmooth) * alpha
scale  = min(1, bounceSize / max(b.hx, b.hy))          // never enlarges
limitX = max(0, 0.96 - b.hx*scale); limitY = max(0, 0.96 - b.hy*scale)
speed  = bounceSpeed * 2                               // NDC units / s (x); y uses speed*0.71
X = reflectedStep(clamp(bounceX||0, ±limitX), bounceDX ?? 1, dt*speed, limitX)
Y = reflectedStep(clamp(bounceY||0, ±limitY), bounceDY ?? 1, dt*speed*0.71, limitY)
store bounceX/DX/Y/DY
original = projectionMatrix.clone(); m = projectionMatrix.elements
for i in [0,4,8,12, 1,5,9,13]: m[i] *= scale            // scale NDC x and y rows
m[8] -= X.position - b.x*scale; m[9] -= Y.position - b.y*scale      // lens shift: NDC += (pos − centre·scale)
projectionMatrixInverse = inverse(projectionMatrix)
return original
endScreenBounce(original): if original → projectionMatrix.copy(original); inverse recomputed
```

**Draw wrapper**, a prototype monkeypatch:

```js
const stageDraw = tw.prototype.draw
tw.prototype.draw = function () {
  if (!this.camera || !this.renderer) return stageDraw.call(this)
  const original = this.beginScreenBounce()
  try { return stageDraw.call(this) } finally { this.endScreenBounce(original) }
}
```

**Effect:** the sculpture's projected centre moves to (X, Y) in NDC and its projected half-size is at most `bounceSize`. In NDC terms the travel is ±(0.96 − h·scale).

**Speed:** the default 0.08 gives 0.16 NDC/s horizontally and 0.114 NDC/s vertically. Because NDC is not square in pixels, the path looks different at 16:9 and 9:16.

**Interactions:**

- With lock: no conflict, since bounce only changes the projection. NOTES_V0180 recommends lock for a "DVD" look.
- With moving cameras: the bounds lag by up to 0.25 s plus the smoothing.

### 2.10 Camera cycle, C key and `cameraPreset` (v0.17.0; no code change to the cycle itself)

- **Cycle** (TS main.ts 879–895): it uses `options.length`, so it wraps through all nine modes automatically.
- **C / c keys** (TS main.ts 1017): unchanged.
- **Keydown guards** (v0.15.1 bundle, see NOTES_V0151): the handler ignores Ctrl, Meta, Alt, composition, `defaultPrevented` and repeats, and returns early when focus is inside `input, select, textarea, button, summary, a, [role=button]`.
- **`#cameraPreset`** (`performance-ui.js` lines 12–15), a `<select>` in "Flow & camera":
  - options `0` Orbit, `6` Tip glide, `7` Cinematic tour, `8` Wide pulse, `5` Chase newest;
  - onchange: if the engine is not organism, show the status "Choose the Organism pattern for these camera modes."; otherwise `Zt.get('e:organism:camMode').set(value)` followed by `T5()`, which is persisted;
  - it is never synced back from camMode.
- **Simple mode:** both `#camCycle` and `#sec-fluid` are hidden (the simple-ui CSS), but the C key still cycles camMode silently.

### 2.11 Camera behaviour from other clusters that lives inside the camera block

These belong to other clusters but must be carried along when this block is restructured.

- **v0.16 reference** (`patch_reference.py` lines 35–37):
  - When `videoOn && mode === 0`, the centroid is forced to (0,0,0), giving `c.set(0,0,0)` before `center.lerp` (TS 2588).
  - When `videoOn`, `r2 = max(4, referenceFrameRadius ?? (w² + h² + videoDepth²)/4)`, and the per-segment radius loop is skipped for `videoOn && mode === 0` (TS 2589–2590).
  - `refFit` (`reference-ui.js` lines 38–44) sets `referenceFrameRadius`, `zoomMul = 1`, `pan = 0` and `camMode = 0`.
- **v0.17.2 music focus:** when `musicFocus > 0`, the tip marker's minimum size is `clamp(|camPos − camLook| * 0.0025, 0.06, 0.5)` (TS 2556 region). Tip `depthTest` is off and `renderOrder` is 10 (`refreshMusicFocus`).
- **v0.17.0 soft growth:** `updateSoftGrowth(performanceState)` runs at the top of `draw()`, before the render. Screen bounce reads the soft-mesh bounds from the previous frame's geometry.
- **Other sources of `this.center`:** besides the camera, growth logic reads `this.center` at TS 1474 (shell bounce lean), 1597–1598 (root placement), 1855–1862 (bass/treble radial expansion and cohesion reach), 1979 and 1991–1995 (sphere bounds). `this.repel` is read at 1864. The lock freezes both (B3).

---

## 3. Controls (every engine or global control added or changed by this cluster)

Engine controls live in `OrganismEngine.controls` (TS `organism.ts:371-446`). The "declared group" column shows the `group:` field in the v19 definition. **v19 never added these keys to the GROUP map** (`CK`, bundle@1095657), and `mount()` overwrites `c.group` from that map (TS 571; bundle@1111539 `l.group=…CK[l.key]??"More"`). As a result, every new control below renders in the **"More"** section, not in Camera.

| key | label (v19) | min | max | step | default | options | declared group → actual | version | read by |
|---|---|---|---|---|---|---|---|---|---|
| `camMode` (changed) | camera | 0 | **8** (was 5) | 1 | 0 | orbit, weave through, tunnel, drift inside, sit inside, chase the newest growth, **tip glide, cinematic tour, wide pulse** | Camera (in GROUP) → Camera | 0.17.0 | frame(): near plane (2285), shellOn (2283), tunnel growth (2398), sphere bound (1989), growAtCam (1594), camera branches, fog (2712); updateCinematic; cameraPreset; camCycle/C; `?cam=`; refFit; setCalmCamera |
| `camDistance` | camera shot distance | 2 | 40 | 0.5 | 9 | – | Camera → **More** | 0.17.0 | updateCinematic: radius for 6/7, minimum for 8 |
| `camSmooth` | camera tracking response | 0 | 1 | 0.05 | 0.35 | – | Camera → **More** | 0.17.0 | updateCinematic: alpha rate `1 + 7·camSmooth` |
| `calmCamera` | stable presentation camera | 0 | 1 | 1 | **1** | – | none → **More** (inserted before camMode) | 0.19.0 | frame(): breathe, orbit wobbles, kick/shake gate, fog 0.002; set by setCalmCamera |
| `screenBounce` | bounce sculpture around screen | 0 | 1 | 1 | 0 | – | none → **More** | 0.18.0 | beginScreenBounce; `#screenBounceToggle`; simpleApplyLook sets 0 |
| `bounceSpeed` | screen bounce speed | 0 | 0.5 | 0.01 | 0.08 | – | none → **More** | 0.18.0 | beginScreenBounce (`×2` NDC/s x, `×1.42` y); `#bounceSpeed` slider |
| `bounceSize` | bouncing sculpture screen size | 0.2 | 0.85 | 0.05 | 0.55 | – | none → **More** | 0.18.0 | beginScreenBounce scale cap; `#bounceSize` slider |
| `orbit` (unchanged def) | camera speed | 0 | 2 | 0.05 | 0.5 | – | Camera | – | all modes; the cinematic angle rate (×0.3 or ×0.14); tour interval `max(2, 5 − orbit)`; set to 0 or 0.08 by setCalmCamera |
| `camFollow` (unchanged def) | camera follows new growth | 0 | 1 | 0.05 | 0.5 | – | Camera | – | centre bias toward newCenter (TS 2586); **set to 0 by setCalmCamera** |
| `growAtCam` (unchanged def) | grow around the camera path | 0 | 1 | 1 | 1 | – | Camera | – | root placement (TS 1594, now `< 6`); **set to 0 by setCalmCamera** |
| `kick` / `shake` (unchanged defs) | kick… / shake… | 0 | 1 | 0.05 | 0.5 / 0.15 | – | React | – | TS 2677–2680, gated by calm; **both set to 0 by setCalmCamera** |
| global `zoomReact`, `beatZoom`, `rotSpeed` | (main.ts 402–407) | – | – | – | 0.5 / 0 / 0 | – | Shared | – | `g.zoomNow` / `g.rotNow`; **set to 0 by simpleApplyLook** (through `Zt`, persisted) |

*Not added as controls:* the camera lock is a runtime field (`cameraLockPose`), and the Simple camera choice is a DOM select with no control behind it.

---

## 4. UI (DOM, handlers, CSS)

| id / selector | type | text / attributes | position | handler | version |
|---|---|---|---|---|---|
| `#sec-fluid` | `<details class="sec" open>` | summary "Flow &amp; camera" | right after `<div id="engineControls"></div>` (TS index.html:165) | – | 0.17.0 |
| `#cameraPreset` | `<select>` in `<label>camera …</label>` | options: `0` Orbit, `6` Tip glide, `7` Cinematic tour, `8` Wide pulse, `5` Chase newest | inside `#sec-fluid`, after the soft-species row | onchange: guard organism, else status "Choose the Organism pattern for these camera modes."; `Zt.get('e:organism:camMode')?.set(+value)`; `T5()` | 0.17.0 |
| note `<p class="note">` | text | "Middle-drag to orbit · Shift + middle-drag to pan · wheel to zoom. C cycles camera modes." | `#sec-fluid` | – | 0.17.0 |
| Keys help line | text replace | "mouse: middle-drag orbit · Shift + middle-drag or right-drag pan · wheel zoom" | `#sec-keys` (TS index.html:244) | – | 0.17.0 |
| `#cameraLock` | `<button type="button" aria-pressed>` | "🔓 Lock camera" / "🔒 Camera locked"; title "Freeze this view, including across Reset" / "Unlock to move the camera. Reset keeps this view." | appended just before `</body>`, so outside `#panel`; fixed top-right | onclick: if organism, `te.toggleCameraLock()`, then `syncMusicControls()`; disabled when the engine is not organism; label and aria refreshed by `setInterval(syncMusicControls, 400)` | 0.17.2 |
| CSS (head) | `<style>` | `#cameraLock{position:fixed;top:12px;right:12px;z-index:1000;cursor:pointer;background:#171d26;border:1px solid #7799aa;padding:9px 12px;border-radius:8px;color:#eefaff}#cameraLock[aria-pressed="true"]{background:#254c40;border-color:#8cdeb7}` | – | – | 0.17.2 |
| `#sec-specialist-motion` | `<details class="sec">` (open in v0.18; closed and given its id in v0.19) | summary "Screen bounce &amp; tip shapes". **No `<div class="body">` wrapper**, unlike the other sections | before `#sec-specialist-materials`, which comes before `#sec-input`; below `#simpleHome` in v19 | – | 0.18.0 / 0.19.0 |
| `#screenBounceToggle` | `<button aria-pressed>` | "Bounce around screen" / "Bouncing on" | first item in the card | onclick: `referenceSet('screenBounce', referenceValue('screenBounce') ? 0 : 1)` | 0.18.0 |
| `#bounceSpeed`, `#bounceSpeedValue` | `<label class="slider"><span>Bounce speed</span><output/><input type=range min=0 max=0.5 step=0.01 value=0.08>` | – | card | oninput: `referenceSet('bounceSpeed', +value)` | 0.18.0 |
| `#bounceSize`, `#bounceSizeValue` | same, "Sculpture screen size", 0.2–0.85, step 0.05, value 0.55 | – | card | oninput: `referenceSet('bounceSize', +value)` | 0.18.0 |
| note | text | "Bounce moves the whole sculpture in the view, including in recordings. Lock the camera for a steady DVD-style path. Screen size leaves space to travel." | card end | – | 0.18.0 |
| `syncExtraControls` | JS | disables the toggle when not organism; sets aria-pressed and text; syncs slider values and outputs | – | `setInterval(…, 400)` | 0.18.0 |
| `#simpleCamera` | `<select>` in `<label>Movement …</label>` under `<h3>Camera</h3>` | options `still` "Still — growth moves", `gentle` "Very slow orbit", `manual` "Manual only" | `#simpleHome` "Make something" card | onchange (§2.8) | 0.19.0 |
| Simple CSS | `<style id="simpleUiStyle">` | `body.simple-ui #camCycle, body.simple-ui #sec-fluid, body.simple-ui #sec-specialist-motion, … {display:none!important}` | head | – | 0.19.0 |

**Existing TS UI that interacts with this cluster:**

- `#camCycle` (index.html:106; the label comes from `cameraLabel`, main.ts 882–887).
- The `C` key.
- `#returnUi`, from v0.15.1 `interface.css`: `position:fixed; top:12px; right:12px; z-index:5`, shown in `body.hide-ui` and hidden in `body.capture-output`. It sits exactly under `#cameraLock` (B4).

---

## 5. Integration points: each patched anchor mapped to its TS location

Patch-script line numbers refer to the files in `maintenance/`. For each edit, the "TS change" column says what to do in a faithful port. §8 describes the recommended redesign, which supersedes many of these edits.

### v0.17.0, `patch_performance.py`

| # | script lines | minified anchor (before → after) | TS location | TS change |
|---|---|---|---|---|
| P1 | 25–26 | `…this.dragBtn===1)` → `…this.dragBtn===1&&!l.shiftKey)` | `organism.ts:629`, inside `mount()` pointermove (623–638) | `if (this.dragBtn === 1 && !e.shiftKey)` |
| P2 | 27–28 | `f=this.dist*.0012;this.pan.addScaledVector(d,-c*f).addScaledVector(Pa,u*f)` → `f=this.camPos.distanceTo(this.camLook)*.0012;const panUp=new A().crossVectors(d,h).normalize();…addScaledVector(panUp,u*f)` | `organism.ts:633-636` | k = \|camPos − camLook\|·0.0012; up = normalize(right × fwd), using a dedicated scratch vector instead of `new`. Better still, take right and up from `camera.matrixWorld` columns 0 and 1 (B23). |
| P3 | 29 | `o.addEventListener("pointercancel",a),` → add `o.addEventListener("lostpointercapture",a),` | `organism.ts:639-641` | `c.addEventListener('lostpointercapture', end)` |
| P4 | 30–31 | camMode definition → max 8, options +3, then `camDistance`, `camSmooth` (and the soft-growth `softWave`/`softReact`/`softSpeed`, another cluster) | `organism.ts:403` (plus GROUP at 236) | extend options; add both controls after `camFollow` (406); **add `camDistance: 'Camera', camSmooth: 'Camera'` to GROUP** |
| P5 | 33–34 | `this.lastG=t,this.lastGTime=e.time;this.updateReference(e,t);` → insert `this.performanceState=e;` | `organism.ts:2276-2277`, start of `frame()` | not needed if `draw()` receives the time or state explicitly (§8) |
| P6 | 35 | `draw(){if(this.canvas.width<2` → `draw(){this.updateSoftGrowth(this.performanceState);…` | `organism.ts:871-872` | soft cluster; ordering note: soft meshes must update before the bounce bounds are sampled |
| P7 | 36 | `else this.theta+=s*ya*.3,xa.copy(this.center)` → `else if(Ls===4)…` | `organism.ts:2665` `} else {` (sit inside) | `} else if (mode === 4) {` |
| P8 | 37 | `this.repel=null;const Gd=this.gesture;` → prefix `this.updateCinematic(e,t);` | `organism.ts:2682-2684`, between the kick/shake block and the gestures | call `this.updateCinematic(m, g)` there, or the rig (§8) |
| P9 | 38 | `(Ls===0?.55/(…+Pl+4):.05)` → `(Ls===0\|\|Ls>=6?…)` | `organism.ts:2712` | `mode === 0 \|\| mode >= 6` |
| P10 | 39–40 | `camMode>0&&growAtCam>0?T.multiplyScalar` → add `&&camMode<6` | `organism.ts:1594` (`newPlant` root) | `mode > 0 && mode < 6 && growAtCam > 0` |
| P11 | 43–44 | module insertion before `const LM=` (soft-growth.js, cinematic-camera.js) | `src/midi/version.ts` bump; new code as class methods or modules | – |
| P12 | 47 | append `performance-ui.js` (`#softOnly` and `#cameraPreset` handlers) | `main.ts`, near the camera cycle (879–895) | port only if the duplicate select is kept (§8 recommends merging it) |
| P13 | 55–63, 67 | HTML `#sec-fluid` after `<div id="engineControls"></div>` | `index.html:165` | as above |
| P14 | 68 | keys help text | `index.html:244` | "middle-drag orbit · Shift + middle-drag or right-drag pan · wheel zoom" |
| P15 | 41–42 | `async function Fm(i){…` recording guard | `main.ts:245-247` `selectEngine` | recording cluster, listed only for completeness |

### v0.17.2, `patch_music_focus.py`

| # | script lines | minified anchor | TS location | TS change |
|---|---|---|---|---|
| M1 | 44 | `const Ls=G(this.controls,"camMode"),ya=` → `const Ls=…;if(!this.cameraLockPose){const ya=` | `organism.ts:2573-2574` | faithful: wrap 2574–2702. **Recommended: do not wrap the focus/centre computation or the repel reset** (B3, §8.4) |
| M2 | 45 | `this.camera.lookAt(this.camLook);const Tu=` → `…lookAt(this.camLook);}else this.applyCameraLock();const Tu=` | `organism.ts:2702-2704` | lock applied as the last pose write, before lights, fog and `camFwd` |
| M3 | 46 | `if(this.dragBtn<0)return;` → `if(this.cameraLockPose\|\|this.dragBtn<0)return;` | `organism.ts:624` | as shown |
| M4 | 47 | `"pointerdown",l=>{if(!(l.button` → prefix `if(this.cameraLockPose)return;` | `organism.ts:611-612` | as shown |
| M5 | 48 | `"wheel",l=>{this.zoomMul` → `if(this.cameraLockPose){l.preventDefault();return;}` | `organism.ts:642-643` | as shown |
| M6 | 50 | `this.updateCinematic(e,t);` → `this.focusCameraExtent=Pl;this.updateCinematic(e,t);` | `organism.ts:2682` | unnecessary once the focus is computed outside the lock guard |
| M7 | 51 | `…distanceTo(this.center)+Pl+4` → `…+(this.focusCameraExtent??2)+4` | `organism.ts:2712` | read the focus radius |
| M8 | 37 | `music-focus.js` appended after `reference-growth.js`: `toggleCameraLock`, `applyCameraLock`, the `clear` wrapper (plus music-cluster methods) | new `OrganismEngine` methods; `clear()` at 749–760 | see §8.4: split `clear()` into `clearGrowth()` and `resetCamera()` |
| M9 | 61–62 | HTML `#cameraLock` before `</body>`; `<style>` before `</head>` | `index.html` | move into the panel top row (§8.7) |
| M10 | 59 | append `music-focus-ui.js` (the lock button part is lines 1–8 and 15) | `main.ts` | event-driven sync instead of polling |

### v0.18.0, `patch_species_stage.py`

| # | script lines | anchor | TS location | TS change |
|---|---|---|---|---|
| S1 | 21–29 | `stage-motion.js` plus the `stageDraw` wrapper inserted after `dynamic-material-runtime.js` | `organism.ts:871-879` `draw()` | integrate directly into the render path; see §8.6 (view offset instead of the matrix-element hack) |
| S2 | 30–31 | `screenBounce`, `bounceSpeed`, `bounceSize` inserted before `{key:"glow",…}` | `organism.ts:414` | add the definitions **and GROUP entries** |
| S3 | 38 | append `extra-controls.js` (lines 10, 11, 12–19 for bounce) | `main.ts` | these controls are ordinary engine controls, so the generic widgets suffice; drop the bespoke card, or keep it and sync on change |
| S4 | 40–44 | HTML card inserted before the first `<details class="sec"` | `index.html:111` (before `#sec-input`) | only if a curated card is wanted |

### v0.19.0, `patch_consolidation.py`

| # | script lines | anchor | TS location | TS change |
|---|---|---|---|---|
| C1 | 18–20 | `calm-camera.js` inserted after `music-focus.js` | new code | recommended: a UI-side camera preset through ctls, not an engine method (§8.5) |
| C2 | 21 | insert the `calmCamera` definition before `{key:"camMode",…` | `organism.ts:403` | recommended: replace it with `camReact` 0..1 (§8.5); migrate `calmCamera` |
| C3 | 22–23 | `…;if(!this.cameraLockPose){` → `…,calm=G(this.controls,"calmCamera")>0;if(!this.cameraLockPose){` | `organism.ts:2573` | – |
| C4 | 24–25 | `C5=1+.03*e.energy+.05*e.onset` → `C5=calm?1:…` | `organism.ts:2592` | multiply by `camReact` |
| C5 | 26–27 | the orbit `ge`/`ne` wobble terms gated by calm | `organism.ts:2600-2601` | tie the wobble to idle motion, not to calm (§8.5) |
| C6 | 28–29 | `const q=G(this.controls,"react")` → `…*(calm?0:1)` | `organism.ts:2676` | `react * camReact`, applied as a render-time offset (see A2 report #6) |
| C7 | 30–31 | `this.scene.fog.density=` → `calm?.002:` + original | `organism.ts:2712` | decouple: a separate `fog` amount control |
| C8 | 40 | append `simple-ui.js` (camera parts: lines 31–32 and 87–92) | `main.ts` (Simple UI cluster) | camera presets applied through ctls; select derived from state |
| C9 | 42–56, 57–70 | Simple CSS and the `#simpleHome` card with `#simpleCamera` | `index.html` | per the Simple-UI cluster |

### v0.16.0, `patch_reference.py` (another cluster, but inside the camera block)

| # | script lines | anchor | TS location |
|---|---|---|---|
| R1 | 35 | `this.center.lerp(Lr,1-Math.exp(-s*.8));` → prefix `this.videoOn&&Ls===0&&Lr.set(0,0,0),` | `organism.ts:2588` |
| R2 | 36–37 | radius from `referenceFrameRadius` when `videoOn`; skip the segment loop for `videoOn && mode 0` | `organism.ts:2589-2590` |

### Ordering constraints

1. **Frame time for bounce.** `performanceState` (or an explicit time argument to `draw()`) must be set at the start of `frame()`, before any `draw()`. Snapshot draws reuse the last time and therefore have dt = 0, so the bounce does not move.
2. **Order inside `frame()`:**
   1. note events and growth (the existing TS order);
   2. the tip-glow loop, which reads `camPos`/`camLook` from the previous frame for musicFocus sizing;
   3. the focus computation (centroid, newCenter bias, radius) → mode branches → wild jitter → kick/shake → `focusCameraExtent` → `updateCinematic`;
   4. `repel = null` → gestures (head parallax writes `camera.position`) → `camera.lookAt`;
   5. lock override;
   6. lights, fog, `camFwd`, `pointLight`;
   7. auto quality (may call `resize()`, which updates the projection);
   8. `draw()`.
3. **Cinematic update position.** `updateCinematic` must come after the centre and radius are updated, because mode 8 reads `this.center` and modes 6/7 fall back to `this.newCenter`. It must come before the gesture block and `lookAt`.
4. **Lock override.** It must be the final write to `camera.position`/`quaternion` (after gestures) and must come before `camFwd`, which `growAtCam` and the tunnel spawn read in the next frame.
5. **Screen bounce.** It must be applied after the last `updateProjectionMatrix()` of the frame (the near change at 2285, `resize()` from auto quality at 2732). It must cover **both** render paths (`post.render()` for bloom and `renderer.render()`). Its bounds must be measured with the un-bounced projection.
6. **Stale previous-frame reads.** `newPlant()` (during note events at the start of `frame()`) reads the previous frame's `camPos`/`camFwd`, and growth reads the previous frame's `center`. Keep that one-frame-lag semantic.
7. **Reset.** `resetEngine()` (main.ts 991–996) calls `engine.clear()` and then re-pushes held notes. The lock must survive `clear()`.

---

## 6. State and lifecycle

| field (v19 name) | type | written | reset / cleared | persisted |
|---|---|---|---|---|
| `performanceState` | MusicState reference (the clock reuses one object) | start of `frame()` | never | no |
| `cinematicAngle` | number (rad) | `updateCinematic` | never (saved and restored by the clear wrapper when locked); lost on engine switch | no |
| `cinematicBass` | number | `updateCinematic` | never | no |
| `tourIndex`, `tourPlant`, `tourSwitch` | number, Plant reference, number | `updateCinematic` (mode 7) | never; after `clear()`, `tourPlant` is stale and is re-picked | no |
| `focusCameraExtent` | number | unlocked camera block | never; frozen while locked | no |
| `cameraLockPose` | `{position: Vector3, quaternion: Quaternion, look: Vector3, near, far, fov}` or null | `toggleCameraLock`; `setCalmCamera('still')`, `'gentle'` and `'manual'`; `simpleApplyLook` | survives `clear()`; lost on engine switch or unmount (new instance) | **no** (session only; NOTES_V0172) |
| `dragBtn` | number | pointer handlers; set to −1 when locking | – | no |
| `bounceBounds`, `bounceBoundsT` | `{x,y,hx,hy}`, number | `updateBounceBounds`, at most every 0.25 s | never | no |
| `bounceSmooth` | `{x,y,hx,hy}` | `beginScreenBounce` (`??=` on first use) | **never** (stale after a toggle or reset) | no |
| `bounceLastTime` | number or null | `beginScreenBounce` | null while `screenBounce = 0` | no |
| `bounceX`, `bounceY`, `bounceDX`, `bounceDY` | numbers | `beginScreenBounce` | never; the position is continuous across toggles | no |
| existing TS navigation state: `theta`, `dist`, `center`, `newCenter`, `camPos`, `camLook`, `heading`, `manTheta`, `manPhi`, `pan`, `zoomMul` | – | – | TS `clear()` (749–760), unless locked (the v19 wrapper restores them) | no |

**Persistence and storage:**

- **Engine controls** are persisted in `localStorage['midiviz_settings_v3']` (`main.ts:68`), under `settings.engineCtl.organism[key]`, but **only when changed through a panel widget, `ctls.set` or `onControlValue`**. Engine-side `setControl` calls, such as `setCalmCamera`, are not persisted.
- **Presets** (`localStorage['midiviz_presets_v1']`, `presets.ts:13`) capture every engine control value, including `calmCamera`, the cinematic controls and the bounce controls, but not the lock.
- **Simple UI keys:** `growth-ui-mode` (`simple`/`advanced`) and `growth-good-start-v0190` (first-run one-shot).
- **URL parameter:** `?cam=<index>` (main.ts 1120–1121 and 1138–1139) supports 6–8 automatically. It does not carry the lock, calm setting or pose.
- **Single-file origin sharing:** the v19 and v20 single files, both opened from `file://`, share one origin in Chrome, so v20 will read v19's localStorage (settings, presets, `growth-good-start-v0190`). Plan a migration (§8.8).

**Unmount:** there is no camera-specific cleanup. Canvas listeners disappear with the canvas (TS 2788). The v19 tip-shape unmount wrapper is another cluster.

---

## 7. Bugs, weaknesses and questionable decisions (critical review)

Severity is from the owner's point of view. "Evidence" cites the code; "Better" is the recommended alternative.

**B1 (HIGH) The default "Still" camera is a hard pose lock that never frames the growth.**
- *Evidence:*
  - `simple-ui.js:32` calls `te.setCalmCamera?.('still')` on every look apply, and the first run runs it 700 ms after load (`simple-ui.js:119-123`).
  - `calm-camera.js:8-10` → `toggleCameraLock()` captures whatever pose exists.
  - First-run pose: distance ≈ 11.2 and visible half-height ≈ 5.0 units (dist lerp at 1.2 s⁻¹ toward (2·2.1 + 5)/zoomNow = 9.2 from 14).
  - Growth reaches `size` = 14 (TS 376 and 1989–1998). Soft ribbons extend further (A2 report #17).
  - This matches the lead's observation that silk ribbons grow out of frame.
- *Better:* make "Still" a **static-angle, auto-framed** camera (fixed azimuth and elevation, no orbit) whose look target and distance follow the growth bounds, with slow, hysteretic damping (§8.3). Keep lock as a separate, explicit "freeze exactly this view" action.

**B2 (HIGH) `setCalmCamera` writes controls behind the UI's back, so the first run and later runs differ.**
- *Evidence:*
  - `calm-camera.js:5` uses `this.setControl`. TS `setControl` (762–778) only calls `setCtl`.
  - Persistence happens only in the widget `apply` path (main.ts 332–336) or `onControlValue` (main.ts 261–266).
  - After a reload: orbit 0.5, camFollow 0.5, growAtCam 1, kick 0.5 and shake 0.15 come back, and the lock is gone, yet `#simpleCamera` shows "Still".
  - The Advanced widgets for these keys go stale immediately.
  - `test-consolidation.cjs:20` stubs `setControl` to write into the UI map, which **masks** this bug.
- *Better:* apply camera presets from the UI layer through `ctls.get(id).set(v)`, which updates the widget and persists. Any engine-initiated change must call `this.onControlValue?.(key, v)`, the existing TS hook (engine.ts 73–74). Derive the Simple select's displayed value from the control values (§8.7).

**B3 (HIGH) The lock freezes simulation state, not just the view.**
- *Evidence:* the `if (!this.cameraLockPose)` guard (`patch_music_focus.py:44-45`) also skips:
  - the `this.center` update. Growth reads `center` for root placement (TS 1597–1598), the **bass-push / treble-pull radial expansion** (1855–1862, so the music reaction itself changes), sphere bounds (1991–1995) and the shell lean (1474);
  - `this.repel = null` (2683). An open-palm repel point active at lock time persists for the whole lock;
  - the gesture pinch;
  - `pointLight` tracking (2719 uses the frozen centre);
  - `focusCameraExtent` for the fog.
- *Better:* always compute the scene focus (centre, radius, newCenter, repel). The lock replaces only the final camera pose (and blocks input).

**B4 (HIGH for VJ use) The floating `#cameraLock` button breaks hidden-UI, performance and capture output.**
- *Evidence:*
  - It sits at `top:12px; right:12px; z-index:1000` (`patch_music_focus.py:62`), the same spot as `#returnUi` (`interface.css` line 27, `z-index:5`). When the UI is hidden it **covers the "Show controls · Esc" button**.
  - It has no `body.capture-output` or `hide-cursor` rule, so it is visible in fullscreen performance mode (TS main.ts 976–982) and in `?ui=0` OBS captures.
  - It keeps focus after a click. The v0.15.1 keydown handler returns early when focus is in `button` (bundle keydown `e.closest?.("input,select,textarea,button,summary,a,[role=button]")`). Space and Enter then **activate the focused lock button**, toggling the lock (Space is also play/pause), and C, R, Backspace and the digit keys stop working until the user clicks elsewhere.
- *Better:* put the lock toggle in the panel's top row next to `#camCycle` and add a keyboard shortcut (`V`; `L` is a piano key, inputMidi.ts:102 `KEY_ROW = 'awsedftgyhujkolp;'`). If a floating control is wanted while the UI is hidden, show it only on mouse movement (like `#returnUi` with `hide-cursor`), never in `capture-output`, and below `#returnUi`. Call `button.blur()` after the click, or use `pointerdown` with `preventDefault` so it does not take focus.

**B5 (MEDIUM-HIGH) `calmCamera` is only partly calm and contradicts the documentation.**
- *Evidence:* the terms that are not gated are listed in §2.7 (orbit, weave and tunnel energy speed; beatLock cut; wild jitter; cinematic bass push and elevation wobble; `zoomNow` with zoomReact, beatZoom and the constant 2.5% sine). README.txt:29–30 claims "none zoom or jump with the music", and NOTES_FOR_CLAUDE claims "camera distance, orbit angle and elevation do not react to audio".
- *Better:* one continuous `camReact` (0..1) that multiplies **every** audio-driven camera term in one place (§8.5).

**B6 (MEDIUM) Calm forces fog to 0.002.**
- *Evidence:* `patch_consolidation.py:30-31`. With calm on by default, the view-scaled depth fog the owner's "roots in black space" look relies on is disabled everywhere, and depth cueing is lost.
- *Better:* a separate fog amount control (0–1.5 multiplier on the existing rule), or keep the TS rule and simply stop scaling it with `sustain` when `camReact = 0`.

**B7 (MEDIUM) Destructive and conflicting preset side effects.**
- *Evidence:*
  - `setCalmCamera` zeroes `kick`, `shake`, `camFollow` and `growAtCam`. Calm already gates kick and shake, so the zeroing is redundant, and turning calm off later leaves them at 0.
  - `camFollow = 0` removes the one mechanism that biases the orbit centre toward new growth (TS 2586). That is the opposite of "frame the action".
  - `simpleApplyLook` always forces Still (`simple-ui.js:32`) even when the select says Gentle or Manual.
- *Better:* camera presets touch only camera keys, never zero user values they do not own, and never override the user's camera choice when a look is applied.

**B8 (MEDIUM) New controls land in the "More" section.**
- *Evidence:* GROUP map `CK` (bundle@1095657) has no entry for `camDistance`, `camSmooth`, `calmCamera`, `screenBounce`, `bounceSpeed` or `bounceSize`. `mount()` overwrites `c.group` (TS 571; bundle@1111539), so the declared `group:"Camera"` is discarded.
- *Better:* add GROUP entries (Camera; "Stage" for bounce, or Camera), or change `mount()` to `c.group ??= GROUP[c.key] ?? 'More'`.

**B9 (MEDIUM) Cinematic motion quality.**
- *Evidence:*
  - **The tip-glide target is unstable.** It is "the last tip of the newest alive plant". Every branch pushes a new tip at the end of `p.tips` (TS 2058), and every new note creates a new last plant, so the look target jumps many times per second with polyphony.
  - **Motion starts with a jolt.** Exponential lerp gives a velocity discontinuity at each jump, which reads as a snap start.
  - **Mode switches swing the camera.** The Cartesian lerp of `camPos` cuts through the orbit sphere on large target changes. The azimuth convention (x = sin, z = cos) and the separate `cinematicAngle` accumulator differ from orbit mode (x = cos, z = sin with `theta`), so switching between mode 0 and modes 6–8 produces a large swing.
- *Better:*
  - Focus on a recency- and velocity-weighted centroid of active tips.
  - Use a critically damped spring (SmoothDamp) for the focus.
  - Smooth in spherical coordinates (azimuth, elevation, distance), not Cartesian.
  - Use one shared azimuth state and convention for all orbit-family modes (§8.2 and §8.3).

**B10 (MEDIUM) The framing math ignores field of view and aspect ratio.**
- *Evidence:* orbit uses `2.1R + 5` (TS 2598) and wide pulse uses `2.2R + 5` (`cinematic-camera.js:25`). With fov 48°, a sphere of radius R needs `R / sin(half-FOV)`, where half-FOV is the smaller of the vertical and horizontal half-angles.

  | Scene | Sphere size relative to the frame's limiting edge |
  |---|---|
  | 16:9, R = 2 | 0.49 (half the frame is empty) |
  | 16:9, R = 20 | 1.00 |
  | 16:9, R = 30 | 1.05 (clipped) |
  | **9:16 portrait**, R = 5 | 1.31 |
  | **9:16 portrait**, R = 10 | 1.59 |
  | **9:16 portrait**, R = 30 | 1.86 (heavily cropped) |

  Vertical social-media recordings crop badly.
- *Better:* `fitDistance(R, fovY, aspect, margin)` (§8.3), measured on a robust radius (see A2 #7 on outliers).

**B11 (MEDIUM) Near plane 0.4 in the cinematic modes.**
- *Evidence:* TS 2285 `camModeNow === 0 ? 0.05 : 0.4`. The tip-glide radius can be `camDistance(2) · zoomMul(0.2) · (1 − 0.07·bass) ≈ 0.37`, which puts the focus tip at or inside the near plane, so it is clipped.
- *Better:* derive near adaptively: `clamp(0.02 · |pos − look|, 0.05, 0.4)` for the orbit family, and 0.4 only for the fly-through modes 1–4.

**B12 (MEDIUM) "Fit source" and reference activation do nothing under the default Still lock.**
- *Evidence:* `simple-ui.js:109` → `refFit` → sets `zoomMul`, `pan` and camMode 0 (`reference-ui.js:38-44`), all of which the locked frame ignores. NOTES_V0172 says to "unlock before … fitting the reference", but Simple mode locks by default and the Fit button gives no feedback.
- *Better:* Fit should unlock (or temporarily release the lock) and frame. With B1 fixed, Still auto-frames and Fit becomes "reset manual offsets".

**B13 (LOW-MEDIUM) Camera UI is duplicated and silent.**
- *Evidence:* there are five camera controls for one concept:
  - `camMode` in the engine panel;
  - `#camCycle`;
  - the C key;
  - `#cameraPreset`, which is one-way, offers only 5 of the 9 modes and is never synced back;
  - `#simpleCamera`.

  In Simple mode, C still cycles camMode (the keydown handler has no guard), with no status message and no visible change while locked.
- *Better:* one camera model, with every UI element deriving its display from the controls, and C showing the mode name in the status line.

**B14 (LOW-MEDIUM) Manual offsets are ignored in modes 1–5 but keep accumulating.**
- *Evidence:* `manTheta`, `manPhi`, `pan` and `zoomMul` are used only in mode 0 (TS 2600–2604) and in modes 6–8. Dragging in weave or tunnel does nothing visible, then jumps in when the user switches to orbit.
- *Better:* apply them in every mode (as look offsets for the fly-through modes), or ignore input with a status hint and do not accumulate.

**B15 (MEDIUM for this owner) There is no trackpad or touch navigation, and Firefox wheel zoom is broken.**
- *Evidence:*
  - Orbit needs a middle button (TS 612), so Mac trackpad users cannot orbit. Two-finger click pans.
  - Touch (button 0) is ignored.
  - Wheel uses raw `deltaY`. Firefox reports `deltaMode` 1 (lines, about 3 per notch) instead of about 100 px, so zoom is roughly 30× slower (TS 643, pre-existing).
- *Better:* §8.6 input mapping: Alt/Option+left-drag orbit, Alt+Shift+left-drag pan, pinch (ctrlKey wheel) zoom, `deltaMode` normalisation, touch gestures, and double-click to reset the view. A2 #11 agrees.

**B16 (LOW-MEDIUM) Screen-bounce implementation hazards.**
- *Evidence:*
  1. **Restoring the snapshot can undo legitimate projection updates made during the render.** An example is three's one-time coordinate-system switch on the first WebGPU render, if `screenBounce = 1` is restored from settings before that first frame. Once restored, the projection would stay WebGL-convention until the next `resize()`. This is plausible, not reproduced.
  2. Points behind the near plane are dropped, so bounds are underestimated for fly-through modes.
  3. `bounceSmooth` is never reset.
  4. `new Vector3` is allocated per sample corner.
  5. The bounds assume the reference and shell are centred on the origin (shell or model offsets break this).
  6. Travel is in NDC, so the pixel speed differs between x and y and between aspect ratios.
  7. It is not music-aware at all. The obvious VJ variant would pace wall hits to the beat.
- *Better:* use `camera.setViewOffset` plus `camera.zoom` (native lens shift that survives `updateProjectionMatrix`), bounds computed in camera space from fov and aspect, optional tempo sync, and a reflection callback (§8.6).

**B17 (LOW) The integration style is fragile.**
- *Evidence:*
  - Three prototype monkeypatch chains (`clear`, `draw` and `writeColor`) whose order depends on insertion order.
  - Two `setInterval(…, 400)` polling loops (`music-focus-ui.js:23`, `extra-controls.js:29`).
  - The clear wrapper saves the scratch vectors `camTarget`/`camLookT`, which is pointless.
- *Better:* plain methods and event-driven UI sync.

**B18 (LOW) Tour logic.**
- *Evidence:*
  - The `max(2, 5 − speed)` clamp never binds.
  - `tourIndex % alive.length` over a list that changes can revisit or skip plants.
  - The tour switches immediately when the current plant stops being alive. With v19's 0.2 s sustain, that is on every note release, so the tour degenerates into "follow the latest note".
  - It is not tempo-aware.
- *Better:* least-recently-visited selection among plants with enough growth, a minimum hold time, and switching on bar boundaries when a tempo is known (§8.2).

**B19 (LOW) Waste.**
- *Evidence:* `updateCinematic` allocates per frame (`filter`, 2–3 `clone`s and a new Vector3). Wide pulse re-samples the segments even though the radius was just computed (`Pl`). In the tip loop, `ctl()` is a linear `find` over about 170 controls (the tip-shape cluster multiplies this; see A2 #25).
- *Better:* scratch vectors and a per-frame snapshot of the camera controls.

**B20 (LOW) Smaller interactions.**
- *Evidence:*
  - Changing mode while locked updates the projection twice per frame (near 0.4 versus the pose's near).
  - Gesture pinch rotates `theta`, which modes 6–8 ignore.
  - Wild jitter is not gated by calm.
  - Kick and shake mutate `camPos` state, so they depend on frame rate and accumulate (A2 #6).
- *Better:* covered by the rig design (§8).

**B21 (LOW) "Very slow orbit" is imperceptible and not constant.**
- *Evidence:* at orbit 0.08, one revolution takes 436 s in silence and 148 s at full energy.
- *Better:* a constant angular speed of about 0.05 rad/s (roughly 2 minutes per revolution) with audio decoupled.

**B22 (LOW) The tests are weak or misleading.**
- *Evidence:*
  - `test-motion.cjs:37-41` checks only finiteness and a movement under 5 units after one frame for modes 6–8.
  - The lock test runs the compiled block with stubs.
  - `test-consolidation.cjs` stubs the very thing that is broken (B2).
  - Nothing asserts that growth stays in frame, that mode switches are continuous, or that calm means no audio influence.
- *Better:* §9.

**B23 (LOW) Pan basis.**
- *Evidence:* `right = fwd × Y` degenerates when looking straight up or down (chase and sit modes can get close), and every pointermove allocates a Vector3.
- *Better:* take the basis vectors from `camera.matrixWorld` columns.

**B24 (INFO) Chase (5) and tip glide (6) are near-duplicates.** Both orbit the newest tip, at `(3 + 0.35R)/zoomNow` versus `camDistance`. Merge them internally and keep both indices for compatibility.

**What is good and worth keeping:**

- appending modes without reordering existing indices;
- Shift+middle-drag pan with a screen-up basis and distance scaling;
- the `lostpointercapture` cleanup;
- dt-correct smoothing, `1 − exp(−k·dt)`;
- growAtCam disabled for the cinematic modes;
- the sit-inside fall-through fix;
- the lens-shift idea for screen bounce (perspective preserved, no scene mutation) and the modulo reflection;
- try/finally restoration;
- strided bounds sampling;
- the notion that a user-chosen lock survives Reset.

---

## 8. Recommended TypeScript design

### 8.1 Modules and where the code lives

```
src/midi/engines/camera/
  math.ts        pure: damp, SmoothDamp (scalar + Vector3), fitDistance, reflectedStep, sphericalToCartesian, cartesianToSpherical
  focus.ts       FocusSampler: structure centre/radius (robust), fresh-growth centre/radius, active-tip set (engine supplies data)
  rig.ts         CameraRig: all camera state + update(ctx) + applyTo(camera); mode policies; lock; reset semantics
  bounce.ts      ScreenBounce: bounds in camera space, reflected travel, apply via setViewOffset/zoom
  input.ts       CameraInput: pointer/wheel/touch/dblclick → intents on the rig (orbit, pan, zoom, reset), lock-aware
src/midi/cameraUi.ts   main-side: camera cycle + lock toggle + keys (C, Shift+C, V, 0) + Simple camera presets via ctls
```

`organism.ts` keeps ownership of `this.camera` and supplies the focus data. The camera section at TS 2571–2702 shrinks to about 20 lines. `crystal3d.ts` (lines 291–300 hold a simpler orbit) can adopt `CameraRig` later.

### 8.2 Types

```ts
export const CAM_MODES = ['orbit','weave through','tunnel','drift inside','sit inside',
  'chase the newest growth','tip glide','cinematic tour','wide'] as const   // indices stable; keep label "wide pulse" only if desired
export const enum Cam { Orbit, Weave, Tunnel, Drift, Sit, Chase, TipGlide, Tour, Wide }
export const isOrbitFamily = (m: number) => m === Cam.Orbit || m >= Cam.TipGlide   // 0, 6, 7, 8 (chase can join)

export interface CameraControls {          // snapshot read ONCE per frame (no ctl() in hot paths)
  mode: number; speed: number /*orbit*/; follow: number /*camFollow*/; growAtCam: number
  distance: number /*camDistance*/; response: number /*camSmooth*/; react: number /*camReact 0..1*/
  kick: number; shake: number; wild: number; beatLock: boolean
  screenBounce: boolean; bounceSpeed: number; bounceSize: number
}
export interface CameraMusic { energy: number; onset: number; bass: number; hitEnv: number; bassS: number; barHit: number; bpm: number }
export interface FocusSample {
  center: Vector3; radius: number              // whole structure (robust radius, e.g. 90th percentile of ≤512 samples + soft-mesh spheres)
  fresh: Vector3; freshRadius: number; freshWeight: number   // growth born within ~musicTrail s, weighted by recency
  tips: ReadonlyArray<{ pos: Vector3; plantId: number; weight: number }>   // active tips, weight = velocity·exp(-(t−birth)/1.5)
}
export interface CameraPose { position: Vector3; quaternion: Quaternion; look: Vector3; fov: number; near: number; far: number }
```

### 8.3 The CameraRig algorithm

**State:**

- `azimuth` and `elevationBase`: one shared convention for all orbit-family modes, `x = cos(az)·cos(el)`, `y = sin(el)`, `z = sin(az)·cos(el)`, which is the TS orbit convention.
- The manual offsets `manAz`, `manEl`, `pan` and `zoomMul`.
- Smoothed spherical parameters: `focus` (SpringVec3), `dist` (SpringScalar), `az` and `el` (SpringScalar).
- The fly-through state, moved unchanged from TS 2607–2672.
- `lockPose`.

**Orbit-family policy table** (the only differences between modes 0, 6, 7 and 8):

| mode | focus target | distance target | azimuth rate (rad/s) | notes |
|---|---|---|---|---|
| 0 orbit | `lerp(center, fresh, follow·0.75)` (TS 2586 semantics) | `fit(radius)` with hysteresis | `speed·(0.18 + 0.35·energy·react)` | "Still" = speed 0 |
| 6 tip glide | weighted centroid of tips of the 1–3 newest alive plants | `distance·zoomMul/zoomNow` (shot size), floored at `fit(freshRadius)` | `speed·0.30` | spring smoothTime = `lerp(1.0, 0.15, response)` |
| 7 tour | centroid of the selected plant's active tips | as for tip glide | `speed·0.30` | switch at a bar (`barHit > 0.95 && bpm > 0`) after a minimum hold of 2 bars, else every `3 + 2·(1 − speed/2)` s; least-recently-visited pick among plants with ≥ 8 segments; transition smoothTime 0.8 s |
| 8 wide | `center` | `max(distance, fit(radius, margin 1.25))` | `speed·0.14` | keeps v17's slow drift |

**Framing:**

```ts
export function fitDistance(r: number, fovYdeg: number, aspect: number, margin = 1.12) {
  const ty = Math.tan((fovYdeg * Math.PI) / 360)
  const half = Math.atan(Math.min(ty, ty * aspect))       // limiting half-angle (portrait uses horizontal)
  return (r * margin) / Math.sin(half)
}
// hysteresis: zoom OUT fast when content exceeds the safe frame; zoom IN slowly and only after it has fitted for 1.2 s
if (req > dist.target) { dist.target = req; holdT = 1.2 } else if ((holdT -= dt) <= 0) dist.target += (req - dist.target) * damp(0.35, dt)
dist.update(dist.target, smoothTime = req > dist.value ? 0.35 : 1.6, dt)
```

**Audio terms**, all multiplied by `react = camReact · ctl('react')` and **applied as per-frame render offsets, not written into the smoothed state** (this fixes the frame-rate dependence and accumulation in A2 #6):

- `breathe = 1 + react·(0.03·energy + 0.05·onset)`, which divides the distance;
- `bassPush = 1 − 0.07·react·bassEnv`, the v17 cinematic push, now in every orbit-family mode;
- kick: `renderPos = lerp(pos, look, min(0.5, 0.2·kick·react·hitEnv))`;
- shake: `renderPos += rnd3 · shake·react·bassS·0.6` (seeded noise rather than `Math.random`, so it is continuous);
- wild: `renderPos += rnd3 · wild·onset·0.25·react` when `onset > 0.3`;
- beat cuts: weave's `+1.3` becomes a hard cut, as in A2 #32.

**Idle wobble** (`sin(t·0.37)·0.04`, `0.25·sin(t·0.11)`, `0.16·sin(t·0.21)`) is **time-based, not audio**. Scale it by `min(1, speed / 0.2)`, so a still camera (speed 0) never wobbles and a moving one keeps its organic drift. This replaces the `calm` gating without adding a control.

**Position:** `pos = focus + spherical(az + manAz + g.rotNow·0.5, clamp(el + manEl, −1.2, 1.2), dist·zoomMul) + pan`, and `look = focus + pan`. Because all smoothing happens on the spherical parameters and the focus, mode switches cannot cut through the sphere.

**Near plane:** `near = isOrbitFamily ? clamp(0.02·dist, 0.05, 0.4) : 0.4`. Call `updateProjectionMatrix` only when it changes. Also apply A2 #30's far-plane rule.

### 8.4 Lock and reset semantics

- `lock(camera)` captures a `CameraPose`.
- While locked:
  - `update()` still runs the **focus** computation, and the engine still clears and recomputes `repel` every frame;
  - `applyTo()` writes the pose;
  - input intents are rejected with a single status hint: "View locked — press V to unlock".
- `unlock()` **adopts the current pose** so there is no swing: `focus = pose.look`, `dist = |pos − look|`, and `az`/`el` are derived from `pos − look`. The springs start at those values with zero velocity.
- Split `clear()` (TS 749–760) into `clearGrowth()` (already exists, 742–747) and `rig.resetView()`. `clear()` calls `resetView()` only when `!rig.locked`. No wrapper is needed.
- **Persistence (lead decision):** optionally store `settings.cameraView = {p, q, look, fov}` and a `settings.cameraLocked` flag, so that a performer's framed and locked view survives a reload. At minimum, "Still" must no longer depend on the lock (B1).

### 8.5 Replace `calmCamera` with `camReact` (and a separate fog amount)

- `camReact`:
  - label "camera moves with the music";
  - range 0–1, step 0.05;
  - suggested default **0.3** (subtle breathe and bass push, no shake because the `shake` default should drop to 0). The lead may prefer 0 for recording-first defaults;
  - GROUP `Camera`;
  - scales every audio term listed in §8.3.
- `fog`: label "fog / depth fade", range 0–1.5, step 0.05, default 1, GROUP `Look`. It multiplies the TS fog rule (2712). This replaces the `.002` coupling.
- **Migration:** if saved `engineCtl.organism.calmCamera === 1` and `camReact` is absent, set `camReact = 0`. If `calmCamera === 0`, use the default. Ignore `calmCamera` after migrating.
- **Do not zero `kick`, `shake`, `camFollow` or `growAtCam` in any preset.** `camReact = 0` already neutralises the first two, and `growAtCam` is irrelevant for the orbit family.

### 8.6 Screen bounce and input

**ScreenBounce** (`bounce.ts`):

- **Bounds:** transform the sample points with `camera.matrixWorldInverse` and compute NDC from the base fov and aspect, `ndcX = (x/−z)/(tan(fov/2)·aspect)` and `ndcY = (y/−z)/tan(fov/2)`. This is independent of any applied lens shift.
- **Sample points:** strided segment endpoints (≤ 768), reference corners (use the actual backdrop and field transform, not the origin), shell world-space AABB corners, and soft-mesh bounding spheres. Refresh every 0.25 s. Smooth at rate 6.
- **Travel:** keep `reflectedStep` verbatim (it is correct and tested). Optional additions:
  - a `bounceSync` mode that picks the speed so a wall crossing takes N beats;
  - an `onReflect(axis)` callback so the engine can flash or pulse on wall hits.
- **Apply:** `camera.zoom = scale` and `camera.setViewOffset(2, 2, −X + bx·scale, Y − by·scale, 2, 2)`, then `camera.updateProjectionMatrix()` when the values change. When off, `camera.clearViewOffset(); camera.zoom = 1`.

  With fullWidth = fullHeight = width = height = 2, three's `updateProjectionMatrix` shifts the content by −offsetX in NDC x and by +offsetY in NDC y, and the zoom scales about the centre. The result equals v19's element edits, but it survives `resize()`, snapshots, bloom and the coordinate-system switch without a snapshot and restore. Verify the signs with a unit test that projects a known point.
- Reset the smoothing state when toggled on and on `clear()`.

**CameraInput** (`input.ts`):

| gesture | action |
|---|---|
| middle-drag | orbit |
| Shift + middle-drag, or right-drag | pan |
| Alt/Option + left-drag | orbit (trackpads) |
| Alt/Option + Shift + left-drag | pan |
| wheel | zoom, with `deltaMode` normalised: ×16 for lines, ×`innerHeight` for pages |
| ctrl + wheel (trackpad pinch) | zoom with a finer factor of 0.01 |
| touch, 1 finger | orbit |
| touch, 2 fingers | pinch zoom plus pan |
| double-click | reset view: `manAz = manEl = 0`, `pan = 0`, `zoomMul = 1` |
| `lostpointercapture`, `pointercancel` | end the drag |

- Orbit and pan scales are as in v19: 0.006 rad/px, and `k = 0.0012·|pos − look|` with the pan basis taken from the `camera.matrixWorld` columns.
- While locked, reject intents and do not accumulate them.
- In modes 1–5, apply the offsets as a look offset or ignore them; never accumulate invisibly.

### 8.7 UI (main.ts plus index.html)

- **Top row** (index.html:98–107): `#camCycle` (label from the mode) plus a new `#camLock` toggle (🔓/🔒, `aria-pressed`, title). Neither should keep focus.
- **Keys:** `C` next mode (existing), `Shift+C` previous mode, `V` lock toggle, `0` reset view. `V` and `0` are free: they are not in the piano row `awsedftgyhujkolp;` and not in the engine keys 1–9. Every key press shows its result in the status line, e.g. "camera: tip glide", "view locked".
- **Advanced:** a single **Camera** group containing `camMode`, `orbit` (label it "camera speed"), `camDistance` ("shot size (tip glide / tour)"), `camSmooth` ("tracking response"), `camFollow`, `camReact`, `growAtCam` (shown only for modes 1–5, or leave the label as is), `screenBounce`, `bounceSpeed` and `bounceSize`. Drop `#cameraPreset` and `#sec-fluid`'s camera part.
- **Simple camera select**, applied through `ctls.set` so it is persisted, with the displayed option **derived from the control values** on every change and never stored separately:

  | option | camMode | orbit | camReact | camFollow | other |
  |---|---|---|---|---|---|
  | Still (framed) | 0 | 0 | 0 | 0.6 | auto-frame on; unlocks |
  | Slow orbit | 0 | 0.15 (constant because camReact is 0) | 0 | – | – |
  | Follow growth | 6 | – | – | – | `camSmooth` 0.3 |
  | Tour | 7 | – | – | – | – |
  | Wide | 8 | – | – | – | – |
  | Manual | 0 | 0 | 0 | – | `camFollow` 0; distance stays at the current value (a `camFit` 0/1 switch, or "freeze fit" while manual) |

  Look buttons must **not** change the camera.
- **Engine → UI:** anything the engine changes itself goes through `this.onControlValue?.(key, value)` (TS engine.ts 73–74; main.ts 261–266 already syncs the widget and persists).
- **CSS:** no fixed-position camera element is needed. If one is kept for hidden-UI use, add `body.capture-output #camLockFloat{display:none}`, `body.hide-cursor #camLockFloat{opacity:0}`, and place it at `top: 56px` so it does not collide with `#returnUi`.

### 8.8 Migration and compatibility

- Keep the camMode indices 0–8 and the option labels, since presets and `?cam=` depend on them.
- Accept the v19 keys `camDistance`, `camSmooth`, `screenBounce`, `bounceSpeed` and `bounceSize` as they are. Migrate `calmCamera` (§8.5).
- Rename the internal `referenceFrameRadius` (which stores r²) to `referenceFrameRadiusSq` in TS (reference cluster).
- The `growth-good-start-v0190` key is a one-shot that forced the lock. Do not honour its semantics; if a first-run look is ported, use a new key.

### 8.9 What not to port as-is

- `setCalmCamera` as an engine method writing controls (B2, B7).
- The `calmCamera` boolean and the fog `.002` coupling (B5, B6).
- The "skip the whole camera block when locked" guard (B3). Lock the pose only.
- The `clear`, `draw` and `writeColor` prototype wrappers, and the `focusCameraExtent` side channel (B17).
- Hand-edited projection matrix elements with a snapshot and restore (B16). Use `setViewOffset` and `zoom`.
- The fixed-position `#cameraLock` with `z-index:1000` (B4).
- `#cameraPreset` (the duplicate, one-way select) and the 400 ms polling loops (B13, B17).
- The tour's index modulo and the tip glide's "last tip" target (B9, B18).
- The `2.1R + 5` and `2.2R + 5` framing constants (B10).
- Near 0.4 for close shots (B11).

---

## 9. Acceptance tests

### 9.1 Unit tests (vitest or node; pure logic, no GPU)

1. **`reflectedStep`:**
   - bounded after 10,000 steps of 0.017 at limit 0.6, in both directions;
   - |Δ| ≤ distance per step;
   - distance 0 returns the clamped position;
   - limit 0 returns 0;
   - distance 500 stays bounded;
   - the direction flip parity matches the number of wall crossings (port `test-stage-tips.cjs:16-20` and extend it).
2. **`fitDistance`:** for aspects 16:9, 1:1 and 9:16 and R in {1, 5, 20, 60}, place a sphere at the returned distance and project its extreme points. Assert max |ndc| ∈ [1/margin − 0.02, 1/margin + 0.02]. As a regression, show that `2.2R + 5` fails at 9:16.
3. **Frame-rate independence:** run the rig for 2 s at 30, 60, 120 and 144 fps with an identical focus trajectory. The final `pos` and `look` must agree within 1e-3·dist. Run this for springs and exponential damps, for every mode.
4. **Mode-switch continuity:** cycle 0→6→7→8→0 with a static scene. For every frame, `|Δpos| < 0.05·dist` and `|pos − look| > 0.5·dist_min` (no pass-through).
5. **Tip-glide stability:** feed a synthetic plant whose last tip alternates between two branches 2 units apart at 10 Hz. The look direction's angular velocity must stay below 60°/s at the default response.
6. **Tour:**
   - with bpm = 120, switches happen only on frames with `barHit > 0.95` and at least 2 bars apart;
   - without tempo, the interval is within `[3, 5]` s;
   - least-recently-visited: with 3 alive plants, each is visited once before any repeats.
7. **`camReact = 0`:** run a loud synthetic sequence (energy 1, onsets, bass, bar hits, wild 1) and silence for 5 s in every mode 0–8. The two camera pose sequences must be identical. With `camReact = 1` they must differ.
8. **Lock:**
   - the pose stays identical while locked, and across `clear()`;
   - the focus centre keeps updating while locked (move the growth and assert that `center` changes);
   - `repel` is null when the gesture is absent while locked;
   - unlocking produces no jump: pose Δ < 1e-6 on the first unlocked frame;
   - pointer, wheel and touch intents are rejected while locked and nothing accumulates.
9. **Persistence:**
   - applying each Simple camera preset through the UI layer updates `settings.engineCtl` and the widget values;
   - a simulated reload yields the same control values and the same derived select option;
   - the stub must be the real `ctls` path, not a stubbed `setControl` (B22).
10. **Input mapping:**
    - middle-drag orbits;
    - Shift+middle-drag, right-drag and Alt+Shift+left-drag pan (screen-up basis);
    - Alt+left-drag orbits;
    - `lostpointercapture` ends a drag;
    - wheel with `deltaMode` 1 (deltaY 3) gives the same zoom factor as `deltaMode` 0 (deltaY 48, ±10%).
11. **ScreenBounce via view offset:**
    - a point at the bounds centre projects to (X, Y), within 1e-4;
    - `updateProjectionMatrix()` (simulating a resize) does not lose the offset;
    - turning bounce off restores the plain projection;
    - bounds are unaffected by the currently applied offset.
12. **GROUP:** every new camera or bounce key maps to the Camera group, and no camera control ends up in "More".

### 9.2 Browser tests (Chrome with WebGPU, Chrome with `forceWebGL`, Safari/Firefox WebGL2)

Expose a debug hook such as `window.__growth.debug.frameStats()` that returns the fraction of segment endpoints inside NDC ±0.95 and the camera pose.

1. **First run in Simple mode:**
   - hold 3 notes for 5 s for each look (Roots, Coral, Neural, Crystal, Liquid, Silk);
   - at least 90% of endpoints (and soft-mesh bound corners) are in frame at 16:9 and at 9:16 (resize the window or set the output size);
   - after a reload, the camera behaviour and select state are identical.
2. **Each mode 0–8:** play a 20-s MIDI file and log poses. Check:
   - no NaN;
   - look angular velocity < 90°/s (except the deliberate weave hard cut);
   - near-plane clipping of the focus tip never occurs at `camDistance` 2 and `zoomMul` 0.2.
3. **Lock:**
   - lock, then Reset: the view is unchanged;
   - growth radial behaviour keeps responding to bass (visual check: growth keeps expanding off-centre when played on one side);
   - unlock: no swing;
   - press Space right after clicking the lock control: the lock is not toggled and play/pause works;
   - with the UI hidden (F2) and in `?ui=0`, no camera control is visible and "Show controls" is clickable.
4. **Fit source** under every Simple camera option visibly reframes the reference.
5. **Screen bounce** with bloom on and off, WebGPU and WebGL2:
   - the sculpture travels and reflects;
   - no near-geometry clipping on the first frame after reloading with `screenBounce = 1` saved;
   - a snapshot and a 10-s recording both show the bounce, and the projection is correct afterwards.
6. **Input:**
   - Mac trackpad: Option+drag orbits, pinch zooms, two-finger click-drag pans;
   - Firefox: wheel zoom rate is comparable to Chrome;
   - iPad Safari: one-finger orbit, two-finger pinch.
7. **Performance:** on a weak laptop profile (Chrome CPU 4× slowdown) with 60k segments, the camera plus focus plus bounce costs less than 1 ms per frame (measure `performance.now()` around the rig update).

---

## Appendix A: v19 camera-block de-minification (bundle@1157470; for reference while porting)

```js
this.tipMesh.count = nt
const mode = ctl('camMode'), calm = ctl('calmCamera') > 0                                  // v0.19 calm
if (!this.cameraLockPose) {                                                               // v0.17.2 lock
  const camSpeed = ctl('orbit'), c = this.v1.set(0, 0, 0); let n = 0
  for (const s of this.segs) { c.add(s.a); n++ }
  n ? c.divideScalar(n) : c.set(0, 0, 0)
  if (this.shell) c.multiplyScalar(this.skin ? 0 : 0.3)
  const follow = ctl('camFollow'); if (follow > 0 && this.segs.length) c.lerp(this.newCenter, follow * 0.75)
  if (mode === 2) c.copy(this.camPos).addScaledVector(this.heading, 5)
  if (this.videoOn && mode === 0) c.set(0, 0, 0)                                          // v0.16 reference
  this.center.lerp(c, 1 - Math.exp(-dt * 0.8))
  let r2 = this.shell ? ctl('shellSize') ** 2 * 0.6 : 4
  if (this.videoOn) { const f = this.fieldSize(); r2 = Math.max(4, this.referenceFrameRadius ?? (f.w**2 + f.h**2 + ctl('videoDepth')**2) / 4) }  // v0.16
  if (mode !== 2 && !(this.videoOn && mode === 0)) for (const s of this.segs) r2 = Math.max(r2, s.a.distanceToSquared(this.center))
  const radius = Math.sqrt(r2), breathe = calm ? 1 : 1 + 0.03 * m.energy + 0.05 * m.onset
  const target = this.camTarget, look = this.camLookT
  if (mode === 0) {
    this.theta += dt * camSpeed * (0.18 + 0.35 * m.energy)
    const targetDist = (radius * 2.1 + 5) / g.zoomNow
    this.dist += (targetDist - this.dist) * (1 - Math.exp(-dt * 1.2))
    const ang = this.theta + this.manTheta + g.rotNow * 0.5 + (calm ? 0 : Math.sin(t * 0.37) * 0.04)
    const phi = Math.max(-1.4, Math.min(1.4, 0.3 + (calm ? 0 : 0.25 * Math.sin(t * 0.11)) + this.manPhi))
    const d = this.dist / breathe * this.zoomMul
    target.set(Math.cos(ang) * Math.cos(phi) * d, Math.sin(phi) * d, Math.sin(ang) * Math.cos(phi) * d).add(this.center).add(this.pan)
    look.copy(this.center).add(this.pan)
    this.camPos.lerp(target, 1 - Math.exp(-dt * 6)); this.camLook.lerp(look, 1 - Math.exp(-dt * 6))
  } else if (mode === 1) { /* weave — identical to TS 2607-2620 */ }
  else if (mode === 2) { /* tunnel — identical to TS 2621-2638 (incl. cull every 30 frames) */ }
  else if (mode === 3) { /* drift — identical to TS 2639-2648 */ }
  else if (mode === 5) { /* chase — identical to TS 2649-2664 */ }
  else if (mode === 4) { /* sit inside — TS 2665-2672; was bare `else` (v0.17.0) */ }
  if (wild > 0 && m.onset > 0.3) this.camPos.add(v(rnd(), rnd(), rnd()).multiplyScalar(wild * m.onset * 0.25))   // not gated by calm
  { const react = ctl('react') * (calm ? 0 : 1), kick = ctl('kick') * react, shake = ctl('shake') * react
    if (kick > 0) this.camPos.lerp(this.camLook, Math.min(0.5, 0.2 * kick * this.hitEnv))
    if (shake > 0) this.camPos.add(v(rnd(), rnd(), rnd()).multiplyScalar(shake * this.bassS * 0.6)) }
  this.focusCameraExtent = radius                                                         // v0.17.2
  this.updateCinematic(m, g)                                                              // v0.17.0
  this.repel = null
  /* gestures — identical to TS 2684-2701 (head parallax → camera.position; pinch → theta; open palm → repel) */
  this.camera.lookAt(this.camLook)
} else this.applyCameraLock()                                                             // v0.17.2
/* lights TS 2704-2710 unchanged */
this.scene.fog.density = calm ? 0.002
  : (mode === 0 || mode >= 6 ? 0.55 / (this.camPos.distanceTo(this.center) + (this.focusCameraExtent ?? 2) + 4) : 0.05)
    * (1 + 0.8 * this.sustain * lightReact) * (ctl('env') === 2 ? 1.6 : 1)
this.camFwd.subVectors(this.camLook, this.camPos).normalize()
```

**Start of `frame()` in v19 (bundle@1149442 region):**

```js
this.lastG = g; this.lastGTime = m.time; this.performanceState = m; this.updateDynamicMaterials(m); this.updateReference(m, g)
const camModeNow = ctl('camMode'); this.shellOn = camModeNow !== 2
const near = camModeNow === 0 ? 0.05 : 0.4; if (this.camera.near !== near) { this.camera.near = near; this.camera.updateProjectionMatrix() }
```

**`draw()` in v19 (bundle@1118835), wrapped by `stageDraw` at bundle@1401701:**

```js
draw() { this.refreshMusicFocus(); this.updateSoftGrowth(this.performanceState); if (this.canvas.width < 2 || this.canvas.height < 2) return; /* bloom or plain render */ }
```

## Appendix B: verbatim v19 cluster sources

The later engineer can copy these from the cited files. They are all short:

- `maintenance/cinematic-camera.js`: 37 lines, algorithm in §2.3.
- `maintenance/music-focus.js`: lines 3–17 (lock) and 51–58 (clear wrapper), §2.4 and §2.5. Lines 18–50 are the music-focus cluster.
- `maintenance/music-focus-ui.js`: lines 1–8 and 15 (lock button). The rest is the music cluster.
- `maintenance/calm-camera.js`: 16 lines, §2.8.
- `maintenance/stage-motion.js`: 50 lines, plus the wrapper text in `maintenance/patch_species_stage.py` lines 22–27, §2.9.
- `maintenance/performance-ui.js`: lines 12–15 (`#cameraPreset`).
- `maintenance/simple-ui.js`: lines 31–32 and 87–92 (camera parts).
- `maintenance/extra-controls.js`: lines 10–19 (bounce UI).
- Tests to port or replace: `maintenance/test-motion.cjs` lines 10–17 (pan versus orbit, using the compiled handler) and 37–41 (cinematic modes); `maintenance/test-music-focus.cjs` lines 10–19 (lock); `maintenance/test-stage-tips.cjs` lines 16–27 (reflection and wrapper restore).

**Cross-reference.** Sibling report `a2-render-camera.md` covers these related issues from the TS side, and they agree with this spec:

- #6: kick and shake mutate camera state;
- #7: framing (outliers, aspect, the v19 Still lock);
- #11: trackpad and touch;
- #17: soft meshes ignored by framing;
- #30: far plane;
- #32: the weave cut.
