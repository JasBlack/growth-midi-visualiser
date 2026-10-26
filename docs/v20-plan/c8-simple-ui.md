# C8 — Simple/Advanced UI, six authored looks, Surprise me, calm defaults, quick panels, panel IA

Porting specification: v0.19.0 compiled-patch lineage → TypeScript source (v0.15.0 tag).

- v19 tree (READ-ONLY): `C:\Users\User\Downloads\growth-v0190`
- TS tree (READ-ONLY, target): `C:\Users\User\Desktop\code\growth-midi-visualiser`
- Evidence harness written for this report (scratchpad only): `...\scratchpad\v20\c8\probe.cjs` (runs `maintenance/simple-ui.js` + `calm-camera.js` in a stub VM; results quoted in §7).

Conventions: `v19:<file>:<line>` = file in the v19 tree; `TS:<file>:<line>` = file in the TS tree. Minified anchors are quoted verbatim in backticks.

---

## 1. Summary

### What the cluster does for the user

1. **Simple / Advanced panel tiers** (v0.19.0). The app opens in "Simple" mode. A CSS class `body.simple-ui` hides 15 panel regions. What remains: the pinned top bar (reset, performance, hide UI, rec, still), a new **"Make something"** card, and the Input section without its reference tools. An **"Advanced controls"** button in the top bar switches tiers. The choice persists in `localStorage['growth-ui-mode']`.
2. **Six authored looks** (v0.19.0): Roots, Coral, Neural, Crystal, Liquid, Silk. Each one sets one species, a palette index, a growth-shader index and a fixed "calm" base of ~30 engine controls. It also forces a still camera that is locked in place, and it clears the growth.
3. **Surprise me** (v0.19.0). It picks a random look that is different from the one Surprise picked last, and varies `branch/wiggle/length/thickness` by ×0.88–1.12. It **replaces** the legacy "random mix" button handler. The legacy randomiser is still in the bundle but nothing can reach it.
4. **Calm defaults** (v0.17.2 + v0.19.0):
   - v0.17.2 lowered the engine defaults: `sustain` 1.5→0.25, `fillRate` 1500→300, and added `musicAmount` 0.45.
   - v0.19.0 added a `calmCamera` control, default 1. It removes the camera breathe, sway, kick and shake, and sets fog to a constant 0.002.
   - The v0.19.0 looks use an even more restrained base: `speed .75`, `musicAmount .42`, `sustain .2`, `fillRate 240`, `pulse .15`, `flash .08`, `bloom .35`.
   - A **first-run** timer applies Roots 700 ms after load, once per browser (`localStorage['growth-good-start-v0190']`).
5. **Simple macros** (v0.19.0), all plain DOM sliders:
   - "How much the music grows" → `musicAmount`, `speed`, `sustain`
   - "Branching detail" → `branch`, `wiggle`, `length`
   - "Audio attack sensitivity" → a `globalThis` value read by the audio onset detector
   - "Camera movement" select: Still, Very slow orbit, Manual only
6. **Source intents** (v0.19.0): Trace details, Grow over relief, Skin 3D model, Music only. There is also a model picker, a Show/hide source button and a Fit source button.
7. **Quick panels** (v0.15.1–v0.18.0). Hand-written DOM cards that duplicate engine controls and poll the engine every 400 ms:
   - Find-a-setting search and the Show-controls button (v0.15.1, `interface.js`)
   - 3D reference box (v0.16.0/v0.17.1, `reference-ui.js`)
   - Flow & camera card (v0.17.0, `performance-ui.js`)
   - Camera lock button and the "Music growth" box (v0.17.2, `music-focus-ui.js`)
   - Animated materials card (v0.17.3, `dynamic-material-ui.js`)
   - Screen bounce & tip shapes card, plus the Editor MP4 and Recording report buttons (v0.18.0, `extra-controls.js`)
8. **Panel IA consolidation** (v0.19.0). Two specialist cards get ids and become collapsed. "Presets" is renamed "Saved slots". "🎲 random mix" becomes "✨ curated surprise".

### Versions

| Version | Patch script | Quick-UI module(s) | IA-relevant changes |
|---|---|---|---|
| 0.15.1 | `maintenance/patch_release.py` | `interface.js`, `interface.css` | search, returnUi, F2/Tab, inert panel, aria-labels, larger type, storage error handling |
| 0.16.0 | `patch_reference.py` | `reference-ui.js` | 3D reference box inside Input; `videoBuild/videoFollow/videoInvert` controls |
| 0.17.0 | `patch_performance.py` | `performance-ui.js` | "Flow & camera" card; soft species default off; camMode 6–8; rec audio/res/fps/quality selects |
| 0.17.1 | `patch_seed_fix.py` | (inline line) | `refScatter` slider; `videoScatter` control |
| 0.17.2 | `patch_music_focus.py` | `music-focus-ui.js` | fixed top-right camera lock button; "Music growth" box; **sustain/fillRate default cuts**; `musicAmount/Focus/Trail/videoBuildPace` |
| 0.17.3 | `patch_dynamic_materials.py` | `dynamic-material-ui.js` | "Animated materials" card at panel top; `materialSpeed/Scale/React` |
| 0.18.0 | `patch_species_stage.py` | `extra-controls.js` | "Screen bounce & tip shapes" card at panel top; rec editor/report/compat; `screenBounce`, `bounce*`, `tip*` |
| 0.19.0 | `patch_consolidation.py` | `simple-ui.js`, `calm-camera.js` | Simple/Advanced, looks, Surprise, calm camera, first run, audio sensitivity, label renames |

### Diff against the TS target (v0.15.0)

None of this cluster exists in TS:
- no tiers, looks, Surprise, calm camera, audio-sensitivity control or quick panels
- no search, returnUi or camera lock
- no `inert`, and no aria-labels on generated widgets

TS has the legacy `randomMix()` (TS:src/midi/main.ts:462-495) and the original section order (TS:index.html:110-247). Everything in §§2–5 has to be ported. §7 and §8 recommend what to port differently.

### Headline verdict

The v19 implementation hits the owner's two main complaints directly:
- **The music no longer visibly drives the growth.** The effective growth rate is 0.315× v0.15, and new segments are capped at 16% of v0.15.
- **The camera does not frame the action.** The default "Still" camera is a pose lock captured at load time, and it also disables mouse orbit and zoom.

Port the *intent* (tiers, curated looks, Surprise, calm lens option, single-sourced quick controls). Do not port the mechanics (see §8 "Do not port as-is").

---

## 2. Behaviours (exact algorithms and constants)

### 2.1 Look recipes — `v19:maintenance/simple-ui.js:1-8`

| id | label | species (by `SPECIES[i].name`) | palette idx → name (TS:src/midi/color.ts:15-23) | shader idx → name | per-look values |
|---|---|---|---|---|---|
| roots | Roots | `roots` (TS idx 1) | 4 → forest | 2 → marble | branch .7, wiggle 1.15, length .85, thickness 1.15, nodes .7, softWave 0 |
| coral | Coral | `corals` (idx 7) | 3 → candy | 4 → mottle | branch .9, wiggle .65, length .8, thickness 1.25, nodes .8, softWave 0 |
| neural | Neural | `neuron` (idx 17) | 6 → spectrum | 6 → veins | branch .8, wiggle 1.2, length .8, thickness .8, nodes 1.15, softWave 0 |
| crystal | Crystal | `crystals` (idx 5) | 5 → mono | 14 → chrome | branch .55, wiggle .35, length 1.15, thickness .9, nodes .85, softWave 0 |
| liquid | Liquid | `liquid` (v0.17 soft species, bundle idx 24) | 1 → ocean | 22 → tidal glass (v0.17.3 dynamic material #0) | branch .2, wiggle .5, length .75, thickness 1.2, nodes 0, softWave .8, softReact .75, softSpeed .45 |
| silk | Silk | `silk ribbon` (bundle idx 25) | 5 → mono | 27 → silk shimmer (dynamic material #5) | branch .15, wiggle .4, length .75, thickness .9, nodes 0, softWave .65, softReact .7, softSpeed .35 |

Shader index map (verified from bundle `I_=[...]`): 0 standard, 1 stripes, 2 marble, 3 cells, 4 mottle, 5 scales, 6 veins, 7 lava, 8 iridescent, 9 hologram, 10 toon, 11 checker, 12 height rainbow, 13 plasma, 14 chrome, 15 neon, 16 cracks, 17 rainbow flow, 18 dots, 19 fire, 20 x-ray, 21 pulse (= TS `GROWTH_SHADERS`, TS:src/midi/shaders.ts:97-213). The dynamic materials are appended at 22–31: tidal glass, pearl currents, mercury ribbons, biolume, oil slick, silk shimmer, molten gold, ripple rings, aurora weave, electric filaments (`v19:maintenance/dynamic-materials.js`).

**Liquid and Silk depend on two other clusters**: soft species (v0.17 `soft-growth.js`) and dynamic materials (v0.17.3). Neither exists in TS.

### 2.2 Base values applied by every look — `simple-ui.js:21-25`

```
species:0 (mode 'by note'), wild:0, nested:0, physics:0, seasons:0, cycleEvery:0,
speed:.75, branch:.65, wiggle:.7, length:.85, thickness:1, nodes:.8,
shader:<recipe>, env:0, bloom:.35, pulse:.15, flash:.08,
musicAmount:.42, musicFocus:.7, musicTrail:2, sustain:.2, fillRate:240,
videoBuild:0, screenBounce:0, materialSpeed:.45, materialReact:.65
```
The recipe `values` override the base (`{...base,...recipe.values}`).

### 2.3 `simpleApplyLook(id, {vary=false, clear=false})` — `simple-ui.js:16-37`

1. If `te?.id!=='organism'`, run `await Fm('organism')` (selectEngine). If it is still not organism, return silently. `Fm` returns immediately while a mount is in progress (`if(tT)return;`), so this bails during startup (see §7 B4).
2. Look up the recipe by id. Fall back to `simpleLooks[0]` (Roots).
3. `simpleSpecies(recipe.species)`: for every `i` in `js` (all 37 species), call `Zt.get('e:organism:sp:'+i).set(wanted.has(js[i].name)?1:0)`. Each set goes through the widget/icon `set`, then `engine.setControl`, which triggers **`respawnHeld()` 37 times** (TS:src/midi/engines/organism.ts:765).
4. `Im(recipe.palette)` = setPalette (TS:src/midi/main.ts:430-435).
5. For each `[key,value]` of `{...base,...recipe.values}`: when `vary` is on and the key is one of `branch|wiggle|length|thickness`, multiply by `.88+Math.random()*.24`. Then `Zt.get('e:organism:'+key)?.set(value)`. The widget's `set` clamps to min/max and rounds only when `step>=1`. It then calls `engine.setControl`, writes `settings.engineCtl`, and calls `save()`.
6. Set globals: `g:zoomReact`=0, `g:beatZoom`=0, `g:rotSpeed`=0 (widget set, persisted).
7. `te.setCalmCamera?.('still')` (§2.8). It **locks the camera at its current pose**.
8. If `clear`, run `M5()` = resetEngine (TS:src/midi/main.ts:991-995). It clears the growth and re-pushes held notes. The v0.17.2 `clear` wrapper keeps a locked camera in place.
9. Toggle `.active` on the `[data-simple-look]` buttons. Set `#simpleLookName` to the label and `#status` to `"<Label> look · stable camera · play a note"`.

The call sites differ in what they pass: look buttons use `{clear:true}`, Surprise uses `{vary:true, clear:true}`, and first run uses no options (no clear).

### 2.4 `simpleSurprise()` — `simple-ui.js:38-44`

```
index = floor(random*6)
if (6>1 && index===simpleLastLook) index = (index + 1 + floor(random*5)) % 6   // uniform over the other 5
simpleLastLook = index
await simpleApplyLook(looks[index].id, {vary:true, clear:true})
#presetStatus = `curated surprise: ${label} · shift+click a slot to save`
```
`simpleLastLook` starts at −1 and is only written here. Clicking a look by hand does not update it.

Both `#simpleSurprise` and `#randomMix` call it (`simple-ui.js:72-73`). The legacy `randomMix` (bundle `mJ`, = TS:src/midi/main.ts:473-494) can no longer be reached.

### 2.5 `simpleReference(mode)` — `simple-ui.js:45-63`

- Not organism: status `"Choose Organism before using source guidance."`, then return.
- `off` ("Music only"): `videoMode=0, videoBuild=0, shellMode=0`, status `"Source guidance off — music grows freely."`. The video field keeps running (camera stays live). A loaded shell remains as a *contain* boundary.
- `model` ("Skin 3D model"): `shellMode=1 (skin), skinStick=1, morph=0, attach=1, branch=.32, wiggle=.35, length=.55, join=.25`, status `"3D skin mode — drop a GLB, GLTF, OBJ or STL; growth follows its surface."`. It does **not** check that a shell or model is loaded.
- `trace` or `relief` require `xn.active` (a video field source). Otherwise status `"Load a picture, video or camera first."`.

| key | trace ("Trace details") | relief ("Grow over relief") |
|---|---|---|
| videoMode | 3 (depth + lines) | 4 (3D shape / mimic) |
| videoStick | 1 | 1 |
| videoFollow | 1 | 1 |
| videoEdge | 2.5 | 1.35 |
| videoScatter | .22 | .55 |
| videoSpawn | 1 | 1 |
| videoBuild | 0 | 0 |
| branch | .22 | .45 |
| wiggle | .25 | .5 |
| length | .55 | .72 |
| join | .15 | .35 |
| musicAmount | .38 | .38 |
| fillRate | 180 | 180 |

After that it calls `referenceSync()` and sets a status: `"Detail trace — music draws along edges and relief."` or `"Living relief — music grows across the source surface."`. It does not reset `shellMode`. The Simple sliders are not updated.

### 2.6 Macro sliders — `simple-ui.js:74-86`

- `#simpleGrowth` v ∈ [0.1, 1.2] step .05, HTML default .42:
  - `musicAmount = v`
  - `speed = .5 + .65·v`
  - `sustain = max(.08, .35·v)`
  - The value label shows `v.toFixed(2)`.
  - At v = .42 this gives speed .773 and sustain .147. That does not match the look base (speed .75, sustain .2), so the first touch makes the values jump.
  - **`fillRate` is not touched**, so the 240/s cap stays in place however high the slider goes.
- `#simpleDetail` v ∈ [0,1] step .05, default .6:
  - `branch = .12 + .9·v`
  - `wiggle = .2 + .9·v`
  - `length = 1.05 − .45·v`
  - These are absolute values, so they overwrite each look's authored identity (for example Crystal's wiggle .35 becomes .74 at the default).
- `#simpleAudio` v ∈ [0,1] step .05, default .45: `globalThis.__growthAudioSensitivity = v`. The value is also initialised from the slider at module load (`simple-ui.js:86`).

### 2.7 Audio attack sensitivity — patch anchor in `patch_consolidation.py:32-34`

The v0.15 onset rule (TS:src/midi/inputAudio.ts:399-409), with `s = __growthAudioSensitivity ?? .45`:

| quantity | v0.15.0 TS | v19 formula | s=0 | s=.45 (default) | s=1 |
|---|---|---|---|---|---|
| threshold | `median(fluxHist)·1.9 + 1e-3` | `median·(2.55 − 1.45·s) + .0015` | ×2.55 | ×1.8975 | ×1.10 |
| min onset gap (s) | .12 | `.18 − .1·s` | .18 | .135 | .08 |
| min energy | .04 | `.055 − .025·s` | .055 | .04375 | .03 |

The stems path (TS:src/midi/inputAudio.ts:410-428) is **not** affected. MIDI is not affected.

### 2.8 Calm camera — `v19:maintenance/calm-camera.js` + bundle edits

`setCalmCamera(mode='still')` is added to the engine prototype. It sets controls through `this.setControl` directly, which bypasses the panel registry:

```
calmCamera=1, camFollow=0, growAtCam=0, kick=0, shake=0
mode==='still':  camMode=0, orbit=0, and if not locked → toggleCameraLock()   (captures current pose)
else:            if locked → toggleCameraLock() (unlock); camMode=0; orbit = (mode==='gentle' ? .08 : 0)
```
`toggleCameraLock` (`v19:maintenance/music-focus.js:3-9`) stores `{position, quaternion, look, near, far, fov}` of the camera **at call time**. While locked:
- the whole automatic camera block is skipped and `applyCameraLock()` restores the pose
- pointerdown, pointermove and wheel return early, so there is no orbit, pan or zoom
- `clear()` keeps the camera

Frame-time effect of `calm = ctl('calmCamera')>0` (bundle; TS equivalents in §5):
- orbit "breathe" `C5 = calm ? 1 : 1+.03·energy+.05·onset`
- orbit sway `+(calm?0:sin(t·.37)·.04)` on the angle, `+(calm?0:.25·sin(t·.11))` on the elevation
- kick and shake master `react·(calm?0:1)`
- fog `calm ? .002 : <orbit-scaled formula>`. This overrides the cave ×1.6, the lightReact sustain fog and the tunnel fog alike.
- **Not** gated by calm:
  - orbit speed `theta += dt·orbit·(.18+.35·energy)` — still energy-driven, so "gentle" is not constant
  - `g.zoomNow`, which includes `zoomReact` and `1+.025·sin(t·.35)` (TS:src/midi/main.ts:1059-1062)
  - wild onset jitter
  - cinematic modes 6–8 (`cinematic-camera.js:30-31`, bass pulse −7% radius)

Simple camera select `#simpleCamera` (`simple-ui.js:87-92`): `still` → `setCalmCamera('still')`, `gentle` → `setCalmCamera('gentle')`, `manual` → unlock and then `setCalmCamera('manual')` (orbit 0). With the camera unlocked and orbit 0, "Manual" **still auto-frames**: distance follows the growth extent and the centre follows the centroid (TS:src/midi/engines/organism.ts:2575-2606). That is good behaviour, but it contradicts the notes, which say "no automatic motion".

### 2.9 Simple/Advanced toggle — `simple-ui.js:64-70, 117-118`

`simpleSetMode(advanced)`:
- toggles `body.simple-ui` (on when simple)
- sets `#uiMode` text to `advanced ? 'Simple controls' : 'Advanced controls'` (the label names the *other* mode)
- sets `aria-pressed = advanced`
- `localStorage['growth-ui-mode'] = 'advanced'|'simple'`, with the write wrapped in try/catch

Boot reads the key, and anything other than `'advanced'` means simple. The class is applied only when the module runs, which is after the whole module is parsed (see B21).

### 2.10 First run — `simple-ui.js:119-123`

`setTimeout(700)` reads `localStorage['growth-good-start-v0190']`. If the key is absent, it sets it to `'1'` **before** applying and then calls `simpleApplyLook('roots')`. That is neither vary nor clear, and it still locks the camera. When storage throws, `first=true` on every load.

### 2.11 Model loading and drop — `simple-ui.js:97-115`

- `#simpleModelFile` change:
  1. ensure organism
  2. status "Loading model…"
  3. `await te.loadShell(file)` (TS:src/midi/engines/organism.ts:1033-1070)
  4. show the message
  5. `simpleReference('model')`
  6. `M5()` (reset)
  7. on error: "Could not load model: …"
  8. finally: clear the input value
- `window` drop listener, which runs after the main drop handler: if the file matches `/\.(glb|gltf|obj|stl)$/i` **and** the body is in simple mode → `setTimeout(()=>simpleReference('model'),250)`. The main handler (TS:src/midi/main.ts:772) does the actual `loadShell`.

### 2.12 Source visibility and fit — `simple-ui.js:108-109`

- `#simpleReferenceVisible` toggles `videoShow` between 0 and **.45**. By contrast `#refVisible` remembers the last opacity, default .55 (`reference-ui.js:48-53`).
- `#simpleFit` runs `Y('refFit').click()`. `refFit` sets `referenceFrameRadius=(w²+h²+videoDepth²)/4`, `zoomMul=1`, `pan=0` and `camMode=0` (`reference-ui.js:39-44`). It has **no visible effect while the camera is locked**, which is the default. When `refFit` is disabled (no source, or not organism), `click()` is a no-op.

### 2.13 Quick panels (pre-v19 modules also in this cluster)

- **Search** (`interface.js`). `growthFilterControls()`:
  - For each `#panel details.sec`, remember `open` when the query starts.
  - Set `hidden = !textContent.toLowerCase().includes(query)` and force matches open.
  - On clear, restore the remembered open states.
  - Help text: `"${n} matching sections · clear to show all"` or `'No matching settings. Try "species", "camera" or "decay".'`. With no query: `'Hold A–K to grow · F2 hides controls · Esc brings them back'`.
  - Esc clears the field and blurs it.
  - A MutationObserver on `#engineControls` (childList) re-filters.
  - `#returnUi` click → `pd(false)`.
  - `body.capture-output` is set when `?ui=0`.
  - It filters **sections only**, not individual controls.
- **3D reference** (`reference-ui.js`):
  - `activateReference()` sets `videoMode=3` (was 4 before v19), `videoStick=1`, `videoSpawn=1`, `videoFollow=1`, `videoBuild=0` (was 1 before v17.2).
  - `referenceSync()`: enables or disables the buttons and sets aria-pressed; syncs `refSize/refDepth/refScatter` from the controls; sets the `refHint` text.
  - Handlers: refBuild, refFollow and refInvert toggle 0/1; refVisible toggles with the remembered opacity; refSize and refDepth sliders.
  - `xn.onStatus` is overridden to `Lm(msg); videoStop.hidden=!xn.active; referenceSync()`.
  - `setInterval(referenceSync, 400)`.
  - The hint strings are at `reference-ui.js:32-36`; v17.2 replaced two of them (`patch_music_focus.py:23-24`).
- **Music growth** (`music-focus-ui.js`, inside `#referenceTools`):
  - Sliders `musicAmount` (.1–1.5, .05, .45), `musicFocus` (0–1, .05, .8), `musicTrail` (.5–8, .5, 2), `buildPace`→`videoBuildPace` (.2–3, .1, .8).
  - `#musicLed` sets `videoBuild 0, musicAmount .45, sustain .25, musicFocus .8, musicTrail 2, fillRate 300`.
  - `#cameraLock` (fixed top-right) toggles the pose lock. Its text is `'🔒 Camera locked'` or `'🔓 Lock camera'`, and its title explains Reset.
  - 400 ms poll.
- **Flow & camera** (`performance-ui.js`):
  - `#softOnly`: species toggles = soft species matching `#softChoice` ('all' or a `soft` kind). It writes `settings.engineCtl` directly, then `respawnHeld(); renderEngineControls(te); save()`.
  - `#cameraPreset` change → `camMode` set (0, 6, 7, 8, 5) and `cameraLabel()`. The select is never synced back from the engine.
- **Animated materials** (`dynamic-material-ui.js`):
  - The select is filled from `I_` (all 32 shaders).
  - `#dynamicNext` cycles within 22..31 and jumps to 22 if the current shader is < 22.
  - Three sliders: `materialSpeed/Scale/React`.
  - 400 ms poll.
- **Screen bounce & tip shapes** (`extra-controls.js`):
  - `#softChoice` gains the 10 extra soft species. `#tipShapeSelect` is filled from `tipShapeNames` (11 entries).
  - `#tipFile` upload → `engine.loadTipFile` → `tipShape` index.
  - `#screenBounceToggle` flips 0/1. Sliders `bounceSpeed, bounceSize, tipSize, tipBrightness, tipLimit`.
  - `#recReport` downloads `hl.lastReport` JSON.
  - `#recEditor` picks the MP4 format and sets `recCompat` checked, `recResolution` 1080 and `recFps` 30, then `Hi()`.
  - 400 ms poll, which also enables and disables the rec buttons.

---

## 3. Controls

### 3.1 Engine (Organism) controls added or changed in this cluster

"Declared group" = the `group:` in the patch. "v19 actual group" = what renders. `mount()` overwrites every `c.group` with `CK[key] ?? 'More'` (bundle, = TS:src/midi/engines/organism.ts:571), and `CK` (= TS `GROUP`, TS:src/midi/engines/organism.ts:227-244) was never extended. So **all 24 post-v0.15 controls render in "More"**.

| key | label (v19) | min | max | step | default | options | declared → v19 actual group | recommended TS group | read by / written by | origin |
|---|---|---|---|---|---|---|---|---|---|---|
| calmCamera | stable presentation camera | 0 | 1 | 1 | **1** | – | none → More | Camera (replace with `lensReact`, §8) | frame() camera block (breathe, sway, kick/shake, fog); written by setCalmCamera, **not** via registry | 0.19.0 |
| musicAmount | music growth amount | .1 | 1.5 | .05 | .45 | – | none → More | Growth | growth rate multiplier `rate·musicAmount` (v17.2); looks .42; simpleGrowth v; trace/relief .38; musicLed .45; `#musicAmount` | 0.17.2 |
| musicFocus | highlight music / dim old growth | 0 | 1 | .05 | .8 | – | none → More | Growth | `focusLevel()` colour; tip depthTest; looks .7; musicLed .8 | 0.17.2 |
| musicTrail | fresh growth trail (seconds) | .5 | 8 | .5 | 2 | – | none → More | Growth | `focusLevel()`; looks 2; musicLed 2 | 0.17.2 |
| videoBuildPace | background starts per second | .2 | 3 | .1 | .8 | – | none → More | Video/Source | reference auto-fill pacing; `#buildPace` | 0.17.2 |
| videoScatter | new strand spread (0 = favour details, 1 = anywhere) | 0 | 1 | .05 | .7 | – | Video → More | Video/Source | seed sampler; trace .22 / relief .55; `#refScatter` | 0.17.1 |
| videoBuild | build the shape without music | 0 | 1 | 1 | 0 | – | Video → More | Video/Source | auto-fill; looks 0; intents 0; musicLed 0; `#refBuild` | 0.16.0 |
| videoFollow | existing growth follows live frames | 0 | 1 | 1 | 1 | – | Video → More | Video/Source | anchored geometry refresh; intents 1; `#refFollow` | 0.16.0 |
| videoInvert | invert relief depth | 0 | 1 | 1 | 0 | – | Video → More | Video/Source | `fieldZ`; `#refInvert` | 0.16.0 |
| camDistance | camera shot distance | 2 | 40 | .5 | 9 | – | Camera → More | Camera | cinematic modes 6–8 | 0.17.0 |
| camSmooth | camera tracking response | 0 | 1 | .05 | .35 | – | Camera → More | Camera | cinematic modes 6–8 | 0.17.0 |
| softWave | soft wave amplitude | 0 | 3 | .05 | 1 | – | Soft motion → More | Soft motion (new group) | soft meshes; looks 0 / .8 / .65 | 0.17.0 |
| softReact | soft audio response | 0 | 3 | .05 | 1 | – | Soft motion → More | Soft motion | soft meshes; liquid .75, silk .7 | 0.17.0 |
| softSpeed | soft flow speed | 0 | 3 | .05 | .8 | – | Soft motion → More | Soft motion | soft meshes; liquid .45, silk .35 | 0.17.0 |
| screenBounce | bounce sculpture around screen | 0 | 1 | 1 | 0 | – | none → More | Camera | stage-motion draw wrapper; looks 0; `#screenBounceToggle` | 0.18.0 |
| bounceSpeed | screen bounce speed | 0 | .5 | .01 | .08 | – | none → More | Camera | stage motion; `#bounceSpeed` | 0.18.0 |
| bounceSize | bouncing sculpture screen size | .2 | .85 | .05 | .55 | – | none → More | Camera | stage motion; `#bounceSize` | 0.18.0 |
| tipShape | tip marker shape | 0 | 10 | 1 | 0 | `tipShapeNames` (sphere, cube, diamond, cone, ring, disc, hexagon, star, heart, custom image, custom OBJ) | none → More | Look | tip mesh; `#tipShapeSelect`, `#tipFile` | 0.18.0 |
| tipSize | tip marker size | .1 | 3 | .1 | 1 | – | none → More | Look | tip transforms | 0.18.0 |
| tipBrightness | tip marker brightness | 0 | 2 | .05 | 1 | – | none → More | Look | tip colour | 0.18.0 |
| tipLimit | visible tip limit | 32 | 512 | 32 | 256 | – | none → More | Look (or Performance) | tip count cap | 0.18.0 |
| materialSpeed | new materials: motion speed | 0 | 3 | .05 | .8 | – | none → More | Look | dynamic material clock; looks .45 | 0.17.3 |
| materialScale | new materials: pattern scale | .25 | 3 | .05 | 1 | – | none → More | Look | dynamic material scale | 0.17.3 |
| materialReact | new materials: audio response | 0 | 2 | .05 | 1 | – | none → More | Look | dynamic material audio; looks .65 | 0.17.3 |

### 3.2 Existing TS controls whose default, label or options changed, or that looks/intents write

TS reference: TS:src/midi/engines/organism.ts:371-446.

| key | TS v0.15 default | v19 default | written by in this cluster (value) |
|---|---|---|---|
| `sp:<i>` (icons) | 1 for all 24 | `e.soft?0:1` (soft species off; 37 total) | looks: 1 for recipe species, 0 otherwise; `#softOnly` |
| species (mode) | 2 ('random') | 2 | looks 0 ('by note') |
| speed | 1 | 1 | looks .75; simpleGrowth `.5+.65v` |
| branch | 1 | 1 | looks .15–.9; detail `.12+.9v`; model .32; trace .22 / relief .45 |
| wiggle | 1 | 1 | looks .35–1.2; detail `.2+.9v`; model .35; trace .25 / relief .5 |
| length | 1 | 1 | looks .75–1.15; detail `1.05−.45v`; model .55; trace .55 / relief .72 |
| thickness | 1 | 1 | looks .8–1.25 (×.88–1.12 in Surprise) |
| nodes | 1 | 1 | looks 0–1.15 |
| sustain | **1.5** | **.25** (v17.2) | looks .2; simpleGrowth `max(.08,.35v)`; musicLed .25 |
| fillRate | **1500** | **300** (v17.2) | looks **240**; trace/relief **180**; musicLed 300 |
| join | 1 | 1 | model .25; trace .15 / relief .35 |
| pulse | .6 | .6 | looks **.15** |
| flash | .6 | .6 | looks **.08** |
| kick | .5 | .5 | setCalmCamera 0 (not persisted) |
| shake | .15 | .15 | setCalmCamera 0 (not persisted) |
| bloom | 0 | 0 | looks **.35** (turns on a post pass, TS:src/midi/engines/organism.ts:873-878) |
| env | 0 | 0 | looks 0 |
| shader | 0 | 0 (32 options) | looks 2/4/6/14/22/27; `#dynamicMaterial` |
| wild / nested / physics / seasons / cycleEvery | 0 | 0 | looks 0 |
| camMode | 0 (6 options) | 0 (9 options, v17.0) | setCalmCamera 0; `#cameraPreset`; refFit 0 |
| orbit | .5 | .5 | setCalmCamera 0 or .08 (not persisted) |
| camFollow | .5 | .5 | setCalmCamera 0 (not persisted) |
| growAtCam | 1 | 1 | setCalmCamera 0 (not persisted) |
| videoMode | 0; label "video / picture guides the growth"; opt 4 "mimic — growth draws the picture in 3D" | label "reference guides growth"; opt 4 "3D shape — fill the reference relief" (v16) | off 0; trace 3; relief 4; activateReference 3 |
| videoStick / videoSpawn | .9 / 1 | same | intents 1 / 1 |
| videoEdge | 1.2 | 1.2 | trace 2.5 / relief 1.35 |
| videoShow | .55 | .55 | `#simpleReferenceVisible` 0↔.45; `#refVisible` 0↔remembered |
| shellMode / skinStick / morph / attach | 0 / 1 / 0 / 1 | same | model: 1/1/0/1; off: shellMode 0 |

### 3.3 Global / non-engine controls

| id | label | min | max | step | default | stored | read by |
|---|---|---|---|---|---|---|---|
| `g:zoomReact` | zoom reacts to energy | 0 | 1 | .02 | .5 (TS:src/midi/main.ts:73) | settings | looks set 0; loop zoom (TS:src/midi/main.ts:1060) |
| `g:beatZoom` | beat sync: zoom kick on the beat | 0 | 1 | .02 | 0 | settings | looks set 0 |
| `g:rotSpeed` | rotation | −1 | 1 | .02 | 0 | settings | looks set 0 |
| palette | (select) | 0 | 6 | 1 | 0 | settings.palette | looks: 4/3/6/5/1/5 |
| audio sensitivity (`globalThis.__growthAudioSensitivity`) | "Audio attack sensitivity" | 0 | 1 | .05 | .45 | **not stored** | AudioInput onset (bundle `O5.analyze`) |
| `#simpleGrowth` | "How much the music grows" | .1 | 1.2 | .05 | .42 | **not stored** | writes musicAmount/speed/sustain |
| `#simpleDetail` | "Branching detail" | 0 | 1 | .05 | .6 | **not stored** | writes branch/wiggle/length |
| `#simpleCamera` | "Movement" | – | – | – | still | **not stored** | setCalmCamera |
| UI tier | "Advanced controls" / "Simple controls" | – | – | – | simple | `localStorage['growth-ui-mode']` | body class |

---

## 4. UI

### 4.1 v19 panel tree (order as rendered) and visibility per tier

`S` = visible in Simple, `A` = visible in Advanced. Line numbers refer to `v19:index.html`.

1. `#panelTop` (148-167, sticky) — S A
   - h1 "Growth v… — midi / music visualiser"
   - row: `#clear` "↺ reset", `#perf` "▶ performance", `#hideUi` "hide UI" (title F2), **`#uiMode`** "Advanced controls" (button, `aria-pressed="false"`, CSS `margin-left:auto`)
   - row: `#record` "● rec", `#recMode` select, `#still` "📷 still", `#camCycle` "🎥 orbit" (**hidden in S**)
   - `#controlSearch` text input "Find a setting…" and `#searchHelp` (role=status) (**both hidden in S**)
2. **`#simpleHome`** `details.sec open` "Make something" (169-182) — S A
3. `#sec-specialist-motion` "Screen bounce & tip shapes" (183; collapsed; no `.body` wrapper) — A only
4. `#sec-specialist-materials` "Animated materials" (183; collapsed; no `.body`) — A only
5. `#sec-input` "Input" (183-240) — S A. Inside it, `#referenceTools` (219-232), which contains **"Music growth"** (230), is **hidden in S**, and `#stemsRow` is **hidden in S**.
6. `#sec-pattern` "Pattern" — A
7. `#engineControls` → generated `details.sec` in this order: Growth(15), Species(38: mode + 37 icons + all/none), React(6), Model & shell(14 + "load model" file row), Video(7), Camera(4), Look(6), Life(12), Stems(4), Performance(4), **More(24)** — A only
8. `#sec-fluid` "Flow & camera" (253-260) — A
9. `#sec-global` "Shared" — A
10. `#sec-presets` "**Saved slots**" (273-282; `#randomMix` text "✨ curated surprise") — A
11. `#sec-play`, `#sec-output` (with rec editor/report/compat, audio/resolution/fps/quality), `#sec-keys` — A
12. Outside the panel: `#hud`, `#returnUi` (146; fixed top-right, z 5, shown only with `body.hide-ui`), **`#cameraLock`** (355; fixed top-right, z 1000, always visible)

Total in Advanced: 22 collapsible sections and 134 organism controls (97 non-species + 37 species).

### 4.2 DOM added by v0.19.0

All of this sits inside `#simpleHome .body` unless stated otherwise.

| id / selector | element | text / attrs | handler (simple-ui.js line) |
|---|---|---|---|
| `#uiMode` (in `#panelTop` first row, after `#hideUi`) | button | "Advanced controls", `aria-pressed=false` | onclick → `simpleSetMode(body has simple-ui)` (70) |
| `#simpleHome` | details.sec open | summary "Make something" | open state remembered by `rememberSection` (bundle `d5`, TS:src/midi/main.ts:298-304) |
| `#simpleSurprise` | button.primary | "✨ Surprise me — coherent look" | `simpleSurprise()` (72) |
| `#simpleLookName` | span.note | "Roots" (static default) | written by applyLook |
| h3 | | "Look" | – |
| `.look-grid` | div (3-col grid) | 6 buttons `data-simple-look=roots|coral|neural|crystal|liquid|silk`, text = label | onclick → `simpleApplyLook(id,{clear:true})` (71) |
| h3 | | "Response" | – |
| `label.slider[for=simpleGrowth]` | span "How much the music grows", `output#simpleGrowthValue` "0.42", `input#simpleGrowth` range .1–1.2/.05/.42 | | oninput (74-77) |
| `label.slider[for=simpleDetail]` | "Branching detail", `#simpleDetailValue` "0.60", range 0–1/.05/.6 | | oninput (78-81) |
| `label.slider[for=simpleAudio]` | "Audio attack sensitivity", `#simpleAudioValue` "0.45", range 0–1/.05/.45 | | oninput (82-85) |
| h3 | | "Camera" | – |
| `#simpleCamera` | select inside label "Movement" | options still "Still — growth moves", gentle "Very slow orbit", manual "Manual only" | onchange (87-92) |
| h3 | | "Draw a source" | – |
| `.intent-grid` | 2-col grid | `#simpleTrace` "Trace details", `#simpleRelief` "Grow over relief", `#simpleModel` "Skin 3D model", `#simpleFree` "Music only" | `simpleReference(...)` (93-96) |
| `#simpleModelFile` | input file in label "Load 3D model", accept `.glb,.gltf,.obj,.stl` | | onchange (97-107) |
| `#simpleModelStatus` | p.note | "GLB is best; OBJ and STL geometry also work." | written by the model load |
| `.row` | `#simpleReferenceVisible` "Show / hide source", `#simpleFit` "Fit source" | | (108-109) |
| p.note | | "Load a picture, video, camera or model in Input below. Music starts and extends strands; automatic background filling stays off." | – |
| window `drop` listener | – | – | (110-115) |

Label changes (`patch_consolidation.py:77-78`):
- `<summary>Presets <span class="hint">` → `Saved slots` (TS:index.html:178)
- `🎲 random mix` → `✨ curated surprise` (TS:index.html:182). The title is still the old "randomise the look and behaviour…".

ids added to existing cards (`patch_consolidation.py:75-76`): `sec-specialist-motion` and `sec-specialist-materials`. Both lose `open`.

### 4.3 CSS added by v0.19.0 (`<style id="simpleUiStyle">`, `v19:index.html:126-140`)

```css
body.simple-ui #controlSearch, #searchHelp, #camCycle, #sec-specialist-motion, #sec-specialist-materials,
  #sec-pattern, #engineControls, #sec-fluid, #sec-global, #sec-presets, #sec-play, #sec-output, #sec-keys,
  #referenceTools, #stemsRow { display:none !important }        /* each selector prefixed with body.simple-ui */
#uiMode { margin-left:auto }
#simpleHome .look-grid { display:grid; grid-template-columns:repeat(3,1fr); gap:5px }
#simpleHome .look-grid button { min-width:0 }
#simpleHome .look-grid button.active { background:#285440; border-color:#84dbad }
#simpleHome h3 { font-size:11px; text-transform:uppercase; letter-spacing:.08em; color:#8d98a8; margin:12px 0 6px }
#simpleHome .intent-grid { display:grid; grid-template-columns:repeat(2,1fr); gap:5px }
body.simple-ui #panel { width:340px }
body.simple-ui #sec-input>summary { font-size:12px; color:#9da7b8 }
body.simple-ui #sec-input .note { font-size:11px }
body.simple-ui #simpleHome { display:block }                    /* redundant */
@media (max-width:600px) { body.simple-ui #panel { width:calc(100% - 16px) } }
```

### 4.4 DOM, CSS and handlers from the earlier quick-UI modules (to port as registry-bound widgets, see §8)

| module | markup (v19 index.html line) | ids | handlers |
|---|---|---|---|
| interface (0.15.1) | 146, 147, 165-166; `interface.css` appended to the head style (83-123) | `returnUi`, `controlSearch`, `searchHelp`; `#panel role=region aria-label`; `#status role=status`; aria-labels on midiDevice, micDevice, file, seek, videoDevice, textIn, castUrl, playBtn, prevBtn, nextBtn | §2.13; plus `pd()` sets `#panel.inert`; generated sliders and selects get `aria-label=c.label` |
| reference (0.16.0/0.17.1) | 219-232 | `referenceTools`, `refEnable`, `refFit`, `refBuild`, `refFollow`, `refVisible`, `refInvert`, `refSize(+Value)`, `refDepth(+Value)`, `refScatter(+Value)`, `refHint`; CSS `button:disabled{opacity:.45}`, `#referenceTools output{…}` | §2.13 |
| music focus (0.17.2) | 230 (section "Music growth" with a bare `<h3>`), 126 (style), 355 | `musicLed`, `musicAmount(+Value)`, `musicFocus(+Value)`, `musicTrail(+Value)`, `buildPace(+Value)`, `cameraLock` | §2.13 |
| performance (0.17.0) | 253-260, 316-320 | `sec-fluid`, `softChoice`, `softOnly`, `cameraPreset`; `recAudio`, `recResolution`, `recFps`, `recQuality` | §2.13 |
| dynamic materials (0.17.3) | 183 | `dynamicMaterial`, `dynamicNext`, `materialSpeed/Scale/React(+Value)` | §2.13 |
| extra (0.18.0) | 183, 315 | `screenBounceToggle`, `bounceSpeed/Size`, `tipSize/Brightness/Limit(+Value)`, `tipShapeSelect`, `tipFile`, `tipUploadStatus`; `recEditor`, `recReport`, `recCompat` | §2.13 |

Note: quick-panel ids such as `musicAmount`, `materialSpeed` and `tipSize` are the same strings as engine control keys. That is harmless today because generated widgets have no ids, but in TS they should be namespaced (§8).

---

## 5. Integration points (minified anchor → TS location → required change)

### 5.1 `patch_consolidation.py` (v0.19.0)

| # | anchor (verbatim) | TS location | what must change | ordering |
|---|---|---|---|---|
| C1 | `const LM="0.18.0"` → `"0.19.0"` | TS:src/midi/version.ts:2 `VERSION` | bump (e.g. `0.20.0`); keep the `#ver` / `#hudVer` / title writes (TS:src/midi/main.ts:1147-1149) | – |
| C2 | insert `calm-camera.js` right after the `music-focus.js` text (engine prototype augmentation) | TS:src/midi/engines/organism.ts class `OrganismEngine`; put new camera-style methods next to `setControl` (762-778) | Do **not** monkeypatch. Add a real method `setCameraStyle(style)` (§8) or make camera style a control handled in `frame()`. The pose lock (`toggleCameraLock/applyCameraLock`) belongs to the music-focus/camera cluster and must be ported first if kept. | camera style after `clear()` (TS clear resets camera, TS:src/midi/engines/organism.ts:749-760) |
| C3 | `{key:"camMode",label:"camera",` (insert `calmCamera` before it) | TS:src/midi/engines/organism.ts:403 (controls array) **and** `GROUP` at 236 | Add the control, preferably `lensReact` 0..1 (see §8) instead of the binary `calmCamera`. Add it to `GROUP` → 'Camera', otherwise it falls into 'More'. | – |
| C4 | `const Ls=G(this.controls,"camMode");if(!this.cameraLockPose){` → adds `,calm=G(this.controls,"calmCamera")>0` | TS:src/midi/engines/organism.ts:2573 `const mode = ctl(this.controls, 'camMode')` | read the lens/calm value once here | before 2592 (breathe) and 2676 (kick/shake) and 2712 (fog) |
| C5 | `const Pl=Math.sqrt(ab),C5=1+.03*e.energy+.05*e.onset,xa=` → `C5=calm?1:…` | TS:src/midi/engines/organism.ts:2591-2592 `const radius…; const breathe = 1 + 0.03*m.energy + 0.05*m.onset` | `breathe = 1 + lens*(0.03*m.energy + 0.05*m.onset)` | – |
| C6 | `const ge=this.theta+this.manTheta+t.rotNow*.5+Math.sin(n*.37)*.04,ne=Math.max(-1.4,Math.min(1.4,.3+.25*Math.sin(n*.11)+this.manPhi)),Pe=` | TS:src/midi/engines/organism.ts:2600-2601 (`ang`, `phi`) | multiply the sway terms by `lens`. **Also** (not done in v19) make orbit speed at 2597 independent of energy when lens=0: `theta += dt*camSpeed*(0.18 + 0.35*m.energy*lens)` | – |
| C7 | `const q=G(this.controls,"react"),ge=G(this.controls,"kick")*q,ne=G(this.controls,"shake")*q;` | TS:src/midi/engines/organism.ts:2676-2678 | `react*lens`. Keep the React sliders meaningful: when lens=0 the React section must say so (hint) or disable kick/shake | – |
| C8 | fog `this.scene.fog.density=(Ls===0||Ls>=6?.55/(this.camPos.distanceTo(this.center)+(this.focusCameraExtent??2)+4):.05)*(1+.8*this.sustain*Tu)*(G(this.controls,"env")===2?1.6:1)` → `calm?.002:…` | TS:src/midi/engines/organism.ts:2712 (TS form: `(mode===0 ? .55/(dist+radius+4) : .05)*(1+.8*sustain*react)*(env===2?1.6:1)`) | Do not hard-code .002. Add a `fog` multiplier control (0..2, default 1; looks may set ~.3) and apply it to the existing formula. Keep tunnel mode's fog (it hides culling, TS:2630-2638). | – |
| C9 | `const x=[...this.fluxHist].sort((w,S)=>w-S),T=(x[x.length>>1]??0)*1.9+.001;let v=0;if(f>T&&t-this.lastOnsetT>.12&&this.features.energy>.04&&` | TS:src/midi/inputAudio.ts:401-405 | Add a `sensitivity` field on `AudioInput` (0..1, default .45) and a pure `onsetParams(s)` giving `{mul: 2.55-1.45s, add: .0015, gap: .18-.1s, minEnergy: .055-.025s}`. Apply the same scaling to the stems gate (410-428): `lv > med*(1.35·k)+…`, `minGap[k]·(1.5-s)` or similar. | `audio.analyze()` runs first in `loop()` (TS:src/midi/main.ts:1043). Set sensitivity from settings before `loop()` starts (1174). |
| C10 | `referenceSet('videoMode',4);referenceSet('videoStick',1);` → mode 3 (in `reference-ui.js` `activateReference`) | TS:src/midi/main.ts:668-674 (`openImage` sets 4) and 680-685 (`afterVideoOpened` sets 3 when 0) | Unify into one `activateSource(kind)` that applies the chosen **intent** (trace = 3, relief = 4) and remembers the last intent. Default to trace. | after `videoField.open*` resolves |
| C11 | `code+='\n'+simple-ui.js` (appended after boot) | TS:src/midi/main.ts boot 1145-1157 | New modules `ui/looks.ts`, `ui/simpleMode.ts` (§8), initialised after `renderGlobalControls/renderEngineButtons/renderPresets` (1151-1153). First run happens after `selectEngine(...).then(applyParams)` (1156). | see §6 |
| H1 | `</head>` (insert `simpleUiStyle`) | TS:index.html:83 (end of `<style>`) | Add tier CSS based on `data-tier` attributes (§8), not id lists | – |
| H2 | `<button id="hideUi" title="F2">hide UI</button>` (+`#uiMode`) | TS:index.html:96 (TS still has `title="Tab"`; F2 comes from 0.15.1) | Add the tier toggle button. Use a constant label with `aria-pressed` (for example "Advanced" pressed/unpressed), or a 2-segment switch. | – |
| H3 | `<!-- 1. where the music comes from -->` (insert card before) | TS:index.html:110 | Insert the Look card (`#lookCard`) first in the panel | – |
| H4 | `<details class="sec" open><summary>Screen bounce &amp; tip shapes</summary>` | none in TS (v0.18 card) | Do not recreate as a card. Bounce and tip controls go into Camera/Look groups (§8). | – |
| H5 | `<details class="sec" open><summary>Animated materials</summary>` | none in TS (v0.17.3 card) | Material picker becomes a pinned control in the Look group | – |
| H6 | `<summary>Presets <span class="hint">` → Saved slots | TS:index.html:178 | rename to "Saved slots" | – |
| H7 | `🎲 random mix` → `✨ curated surprise` | TS:index.html:182 and `$('randomMix').onclick = randomMix` at TS:src/midi/main.ts:495 | Keep **two** buttons in Advanced: "✨ Surprise (curated)" and "🎲 Wild mix" (legacy `randomMix`, with the extended `NO_RANDOM`, §8) | – |

### 5.2 Minified names used by the quick-UI modules → TS

| minified | TS |
|---|---|
| `Zt` (Map of Ctl) | `ctls` TS:src/midi/main.ts:124 (Ctl interface 114-123) |
| `Zt.get(id).set(v)` | `Ctl.set` from `widget()` TS:src/midi/main.ts:168-203, or icon `set` TS:src/midi/main.ts:359-363 |
| `Zt.get(id).c.value` | `Ctl.c.value` (the same `EngineControl` object as `engine.controls[i]`) |
| `te` | `engine` TS:src/midi/main.ts:242 |
| `tT` | `mounting` TS:src/midi/main.ts:243 |
| `Fm` | `selectEngine` TS:src/midi/main.ts:245-280 |
| `lR` | `renderEngineControls` TS:src/midi/main.ts:306-395 |
| `d5` | `rememberSection` TS:src/midi/main.ts:298-304 |
| `uJ` | `OPEN_BY_DEFAULT` TS:src/midi/main.ts:295 |
| `l5` | `widget` TS:src/midi/main.ts:134-224 |
| `hJ` | `renderGlobalControls` TS:src/midi/main.ts:397-416 |
| `Im` | `setPalette` TS:src/midi/main.ts:430-435 |
| `dJ` / `PM` / `gJ` / `rb` | `snapshotPreset` / `renderPresets` / `savePreset` / `loadPreset` TS:src/midi/main.ts:441-534 |
| `mJ` / `fJ` / `pJ` | `randomMix` / `NO_RANDOM` / `RANDOM_CAP` TS:src/midi/main.ts:462-495 |
| `_u` | `setMode` TS:src/midi/main.ts:582-608 |
| `Lm` / `g5` | `setVideoStatus` / `afterVideoOpened` TS:src/midi/main.ts:676-685 |
| `_5` / `T5` / `w5` | `cameraCtl` / `cameraLabel` / `cycleCamera` TS:src/midi/main.ts:879-894 |
| `pd` | `setUiHidden` TS:src/midi/main.ts:971-975 |
| `S5` | `performanceMode` TS:src/midi/main.ts:976-983 |
| `M5` | `resetEngine` TS:src/midi/main.ts:991-995 |
| keydown handler | TS:src/midi/main.ts:998-1029 |
| `SJ` | `applyParams` TS:src/midi/main.ts:1133-1143 |
| `vs` | `setStatus` TS:src/midi/main.ts:127-129 |
| `Y` | `$` TS:src/midi/main.ts:26 |
| `he` / `Hi` / `a5` | `settings` / `save` / `LS='midiviz_settings_v3'` TS:src/midi/main.ts:46-99 |
| `zt` | `g` (GlobalParams) TS:src/midi/main.ts:101-111 |
| `xn` | `videoField` TS:src/midi/main.ts:39 (VideoField has `active`, `onStatus`, `ready`: TS:src/midi/videoField.ts:21,26,234) |
| `js` | `SPECIES` TS:src/midi/engines/organism.ts:105-129 (exported) |
| `tw` | `OrganismEngine` TS:src/midi/engines/organism.ts:366 |
| `CK` / `YC` | `GROUP` / `GROUP_ORDER` TS:src/midi/engines/organism.ts:226-244 |
| `G` / `sl` | `ctl` / `setCtl` TS:src/midi/engine.ts:79-87 |
| `tl` | `PALETTES` TS:src/midi/color.ts:15 |
| `I_` | `GROWTH_SHADERS` TS:src/midi/shaders.ts:97 |
| `Tx` / `em` | `download` / `stamp` (src/midi/recorder.ts) |
| `hl`, `Qa`, `recordingBusy` | `recorder`, `VIDEO_FORMATS` (TS:src/midi/main.ts:34, 836); `recordingBusy` comes from the v0.17 recording-ui (recording cluster) |
| `referenceSet/referenceValue/referenceSync/activateReference` | no TS equivalent (0.16 module). Replace with registry calls. |
| `te.cameraLockPose/toggleCameraLock/applyCameraLock` | no TS equivalent (0.17.2 music-focus cluster) |
| `te.loadShell` | TS:src/midi/engines/organism.ts:1033-1070 (calls `refreshShellOptions` → `onControlsChanged` → panel re-render) |

### 5.3 Anchors of the earlier quick-UI patches (UI surface only; engine internals belong to other clusters)

| patch | anchor | TS location |
|---|---|---|
| release 0.15.1 | `function pd(i){document.body.classList.toggle("hide-ui",i),` (+`Y("panel").inert=i`) | TS:src/midi/main.ts:971-975 |
| release | `c.style.gridColumn="1 / span 2",t.options.forEach` / `u.type="range",u.min=String(t.min)` (+aria-label) | TS:src/midi/main.ts:151-152 / 180-181 |
| release | `i.addEventListener("toggle",()=>{he.openSecs[e]=i.open,Hi()})` (ignore while searching) | TS:src/midi/main.ts:300-303 |
| release | keydown: early returns for modifiers, repeat, Escape, F2; remove the `Tab` branch | TS:src/midi/main.ts:998-1013 |
| release | `function IK(i){localStorage.setItem(dL,…)}`, `gJ`, `Hi` try/catch | TS:src/midi/presets.ts:129-131; TS:src/midi/main.ts:497-503, 96-99 |
| release HTML | `</style>`, `<div id="panel">`, `      </div>\n\n      <!-- 1.`, `<kbd>Tab</kbd> hide UI`, `id="…"` aria-labels, `<div id="status">` | TS:index.html:83, 90, 107-110, 240, 121-221, 151 |
| reference 0.16 | `xn.active&&e&&e.set(4)}Y("videoImage")` / `xn.active&&e&&e.c.value===0&&e.set(3)}Y("videoFile")` (+`activateReference()`) | TS:src/midi/main.ts:673 / 684 |
| reference HTML | after the `<div id="videoStatus" class="note">…</div>` | TS:index.html:146 |
| performance 0.17.0 | `async function Fm(i){var t;if(tT)return;` (+block pattern switching while recording) | TS:src/midi/main.ts:245-246 |
| performance | `label:e.name,icon:e.icon,min:0,max:1,step:1,value:1` → `value:e.soft?0:1` | TS:src/midi/engines/organism.ts:373 |
| performance HTML | `<div id="engineControls"></div>` (+Flow & camera after); `<div id="recFormatNote" class="note"></div>` (+rec selects after) | TS:index.html:165, 219 |
| seed fix 0.17.1 | `<p id="refHint" class="note"></p>` (+refScatter before) | (inside the reference markup) |
| music focus 0.17.2 | `{key:"videoScatter",` (+4 music controls before) → in TS terms after `videoMode` | TS:src/midi/engines/organism.ts:407 |
| music focus | `min:0,max:10,step:.1,value:1.5},{key:"fillRate"` → .25; `min:0,max:8e3,step:100,value:1500` → 300 | TS:src/midi/engines/organism.ts:398-399 |
| music focus HTML | `</body>` (+`#cameraLock`), `</head>` (+style), `<p id="refHint" class="note"></p>` (+Music growth) | TS:index.html:253, 83 |
| dynamic materials 0.17.3 | `{key:"shader",` (+3 material controls before) | TS:src/midi/engines/organism.ts:430 |
| dynamic HTML | first `<details class="sec"` (card inserted before) | TS:index.html:111 |
| species/stage 0.18.0 | `{key:"glow",label:"tip glow",min:0,max:2,step:.05,value:1},{key:"budget",` (+7 controls before) | TS:src/midi/engines/organism.ts:414-415 |
| species/stage HTML | first `<details class="sec"`; `<div id="recFormatNote"` | TS:index.html:111, 219 |

---

## 6. State and lifecycle

### 6.1 New state in v19 (this cluster)

| state | where | lifetime | persisted |
|---|---|---|---|
| `simpleLastLook` | module global | session | no |
| `globalThis.__growthAudioSensitivity` | global | session | **no** (resets to .45 on every reload) |
| `referenceOpacity` | reference-ui global | session | no |
| `body.simple-ui` | DOM | session | via `localStorage['growth-ui-mode']` |
| first-run flag | – | – | `localStorage['growth-good-start-v0190']='1'` (set **before** the look succeeds) |
| `calmCamera` control | engine controls | per engine instance | only if changed through the panel. setCalmCamera bypasses `settings.engineCtl`. |
| camFollow/growAtCam/kick/shake/camMode/orbit written by setCalmCamera | engine controls | until reload | **no** (they revert to saved or default values on reload) |
| `cameraLockPose` | engine | session; survives `clear()`; lost on engine switch or reload | no |
| look id / active button / look name | DOM only | session | **no** (after reload the card shows "Roots" and no active button) |
| macro slider positions | DOM only | session | **no** |
| `#simpleCamera` value | DOM | session | **no** (shows "Still" after reload while the camera orbits at the restored `orbit`) |
| section open states incl. `simpleHome`, `sec-specialist-*`, `sec-fluid`, `organism:More` | `settings.openSecs` | persistent | yes (`midiviz_settings_v3`) |
| rec audio/resolution/fps/quality/compat selects | DOM | session | **no** (only `recFormat` and `recMode` persist) |

### 6.2 Lifecycle interactions

- **Engine switch** (`selectEngine`) removes every `e:` ctl (TS:src/midi/main.ts:253). Simple handlers either force organism (`Fm('organism')`) or no-op with a status. Keyboard keys 1–5 still switch engines in Simple, even though Pattern is hidden.
- **Reset** (`resetEngine`): looks call it when `clear`. TS `clear()` resets `dist=14`, `camPos=(0,2,12)`, pan and zoom (TS:src/midi/engines/organism.ts:749-760). In v19 a lock wrapper preserves the camera. The TS port must apply the camera style *after* clear.
- **Unmount**: nothing to dispose in this cluster. The four 400 ms intervals are never cleared (they run for the life of the page).
- **Presets**: `snapshotPreset` (TS:src/midi/main.ts:441-447) captures every `g:` ctl and every engine control, so a saved slot captures a look's values. It does **not** capture look id, macro positions, audio sensitivity, camera style/lock or UI tier.
- **URL params** (`applyParams`, TS:src/midi/main.ts:1133-1143) run after `selectEngine`. The 700 ms first-run timer is not ordered relative to them (B4).

### 6.3 Required lifecycle in TS (see §8 for types)

1. Boot:
   1. Read `settings`. New fields: `uiMode`, `look`, `macros`, `audioSensitivity`, `cameraStyle`, `firstRunDone`.
   2. Migrate from `growth-ui-mode` and `growth-good-start-v0190` if present.
   3. Set `document.body.dataset.ui` **before first paint**, using an inline `<script>` in `<head>`, or `data-ui="simple"` in the markup as the default.
2. After `renderGlobalControls/renderEngineButtons/renderPresets`, register the macro ctls (`m:growth`, `m:detail`, `m:reaction`) and the audio-sensitivity ctl (`g:audioSens`, or `m:audioSens`, see §8.4) in `ctls`.
3. After `selectEngine(...).then(applyParams)`: if `shouldApplyFirstRun({settings, params, storageOk})`, apply the default look and **only then** set `firstRunDone=true`.
4. On look apply: follow the ordering in §8.3.
5. On reload: restore the look card from `settings.look` (active button and name), set the macros' DOM from `settings.macros` via `sync` (not `set`), and apply camera style from `settings.cameraStyle`.

---

## 7. Bugs, weaknesses and questionable decisions (v19 patch implementation)

Severity: **H** = harms the owner's core goals; **M** = visible defect or data loss; **L** = polish.

**B1 (H) "Still" = pose lock at an arbitrary moment. Growth leaves the frame, and mouse navigation dies.**
- Evidence: `simple-ui.js:32` (every look calls `setCalmCamera('still')`); `calm-camera.js:8-10` (locks the *current* pose); bundle guards `"pointerdown",l=>{if(this.cameraLockPose)return;`, `if(this.cameraLockPose||this.dragBtn<0)return;`, `"wheel",l=>{if(this.cameraLockPose){l.preventDefault();return;}`. On first run the pose is captured 700 ms after load, before any growth exists.
- The lead's observation fits this: Silk ribbons grow out of frame. It also contradicts `START_HERE_v0190.md` ("Middle-drag orbits … wheel zooms"), because in the default state they are disabled.
- `#simpleFit` → `refFit` also does nothing visible while locked.
- Better: "Still" = no rotation and no music-driven lens motion, **but keep auto-framing**. TS orbit mode 0 with `orbit=0` already frames by distance and centroid (TS:src/midi/engines/organism.ts:2595-2606). Make the pose lock a separate explicit action that is never on by default.

**B2 (H) Looks override the user's camera choice.** `simpleApplyLook` always calls `setCalmCamera('still')`. Probe: with camera "gentle", clicking Silk leaves the camera locked with orbit 0 while the select still shows "Very slow orbit". The select is also never synced with the top-right lock button. Better: looks never touch camera style. Camera style is its own persisted setting.

**B3 (M) `setCalmCamera` bypasses the control registry.** It calls `this.setControl` directly (`calm-camera.js:5`). The Advanced widgets for camMode, orbit, camFollow, growAtCam, kick and shake show stale values, and none of it reaches `settings.engineCtl`. After reload, `orbit .5` and `camFollow .5` come back and the lock is gone, while the Simple select shows "Still". Better: every write goes through the registry (`ctls.set`). Camera style is persisted.

**B4 (H) The first-run look can fail permanently and can override capture URLs.**
- `setTimeout(700)` fires regardless of engine state. If WebGPU init takes longer than 700 ms (a weak laptop), `te` is null, `Fm('organism')` returns immediately (`if(tT)return;`) and the look is skipped. The flag is already written, so it never retries.
- Probe: `first-run key stored: 1 | roots applied (fillRate=240)? false`.
- On a fresh browser profile (an OBS Browser Source has its own storage), a capture URL with `?engine=cells` gets switched to organism/Roots after 700 ms.
- When storage is blocked, Roots is re-applied on every load.
- Better: run after `selectEngine().then(applyParams)`, skip when URL params exist or saved organism settings exist, and set the flag only after success.

**B5 (M) The Simple sliders drift out of sync, are not persisted, and cannot be MIDI-learned.**
- Looks, trace/relief and "Music-led settings" write `musicAmount`, `branch` and the rest without updating the Simple sliders. Probe: after Growth=1.0, clicking Coral gives `musicAmount=0.42` while the slider still shows "1.00".
- The slider formulas do not match the look bases, so the first touch makes the value jump (for example Crystal's wiggle .35 becomes .74 at Detail=.6).
- The sliders are plain inputs, so there is no right-click CC-learn, which matters for a VJ.
- Better: macros are registry ctls (`m:*`) that act as relative multipliers around the look's authored values (v=.5 means as authored). They are persisted, synced from controls, and CC-learnable.

**B6 (H) The "How much the music grows" macro cannot lift the segment cap.**
- Looks set `fillRate 240` and trace/relief set 180. `simpleGrowth` never touches fillRate (`simple-ui.js:76`).
- The v17.2 allowance caps new segments at `fillRate` per second in total (`music-focus.js:18-23`). With chords, tips wait for credit, so growth stalls exactly where the owner complains ("growth should not stall at limits").
- Better: the growth macro scales fillRate as well (§8.4), and the Simple defaults sit at or above v0.15 throughput.

**B7 (H) The calm defaults hide the music.**
- Against v0.15.0 TS defaults:
  - growth rate multiplier `speed .75 × musicAmount .42 = 0.315×`
  - fill cap `240/1500 = 16%`
  - `sustain .2` vs 1.5
  - swell `pulse .15` = 25%, since `uPulse = .12·pulse·…`, TS:src/midi/engines/organism.ts:2534
  - hit flash `flash .08` = 13% (TS:2535)
  - kick/shake 0
  - `musicFocus .7` dims growth older than 2 s to `1−.7·.8 = 44%` brightness
- This matches the lead's "3 held notes for 2 s grow only ~300 segments".
- `bloom .35` also turns on a post-processing pass in every look (TS:873-878), against the weak-laptop requirement.
- Better:
  - The default Simple response reproduces v0.15.0 reactivity (speed 1, musicAmount 1, fillRate ≥1500, sustain ~.6–1.5, pulse ~.5, flash ~.35).
  - "Calm" is the low end of a macro, not the default.
  - Bloom follows a quality tier and is off when auto-quality has dropped the render scale.

**B8 (M) `calmCamera=1` is global and its meaning is inconsistent.**
- It defaults to 1 for everyone, including Advanced users and upgraders whose saved settings have no `calmCamera` key.
- It silently zeroes kick and shake, so the React sliders appear broken.
- It forces fog to .002 in *every* camera mode: tunnel culling becomes visible, and the cave multiplier and sustain fog are ignored.
- It does **not** gate:
  - energy-scaled orbit speed (so "gentle" is not constant)
  - `zoomReact` / `zoomNow` breathing
  - cinematic modes 6–8, including the bass radius pulse (`cinematic-camera.js:30-31`)
- Better: one continuous `lensReact` (0..1) applied uniformly to all modes, and a separate `fog` multiplier.

**B9 (M) Every post-v0.15 control lands in "More".** `mount()` overwrites `c.group` (bundle = TS:src/midi/engines/organism.ts:571) and `CK` was never extended. The 24 controls listed in §3.1 end up in one closed "More" section, and the declared `group:"Video"`, `"Camera"` and `"Soft motion"` are ignored. NOTES_V0160 claims they went to Video. Better: extend `GROUP` (§8.6) and add a unit test that no key falls through.

**B10 (M) The legacy random mix was removed without saying so.** `simple-ui.js:73` rebinds `#randomMix`. The owner's "everything optional" preference argues for keeping it as "Wild mix". Separately, `NO_RANDOM` (TS:src/midi/main.ts:463-469, bundle `fJ`) was never extended. If the old mix were reachable it would randomise `calmCamera`, `screenBounce`, `tipShape` (incl. "custom OBJ"), `videoBuild`, `videoBuildPace`, `tipLimit`, `camDistance` and the rest. Better: restore it and extend `NO_RANDOM` (§8.5).

**B11 (M) Surprise has little variety, keeps each look to a single species, and always destroys the growth.**
- It picks one of six looks and varies four parameters by ±12% (`simple-ui.js:28`). Each look is one species, which makes it uniform, the opposite of the owner's "never uniform".
- The non-repeat check ignores looks picked by hand.
- Surprise and look buttons always `M5()`, which is destructive mid-performance.
- Better: looks declare allowed palettes, shaders, secondary species and ranges, with seeded variation. Changes morph over ~1.5 s using the existing `Morph` (TS:src/midi/presets.ts:135-162). Clearing is an option ("fresh canvas").

**B12 (M) Looks are partial overlays, so "coherent" depends on history.** The base leaves these untouched:
- `envShader`, `beatLock`, `text`/typography, `shell`/`shellLook`/`shellMode`, `morph`
- `lightReact`, `react`, `speedReact`, `glow`, `lignify`, `join`, `retract`, `maxLive`, `cohesion`, `size`, `bounds`
- `tipShape`/`tipSize`, `bounceSpeed/Size`, `materialScale`, `videoMode`/`videoShow`, `camDistance`, stems
- `g:decay`, `g:growth`, `g:zoom` (the organism reads `g.growth` as a speed multiplier and `g.decay` for dormant decay, TS:src/midi/engines/organism.ts:2280, 2450)

After loading a wild preset, "Roots" can still have a nebula sky, typography, beat-lock cuts and a global growth multiplier of 0.3. Better: a canonical `LOOK_BASE` that sets every "look" control, with an explicit **preserve** list (source/model/input/performance/output).

**B13 (M) Recipes use numeric indices.** Palette and shader are indices (`palette:4, shader:22`), and shader 22/27 assumes dynamic materials are appended at exactly 22. Any reorder silently changes looks. Better: resolve by name at apply time and fail loudly in tests.

**B14 (H, dependency) The Liquid look is faceted, not liquid.**
- Soft liquid uses `new kp(1,2)`. `kp` is `IcosahedronGeometry` (Polyhedron = **non-indexed**, 320 triangles).
- It calls `computeVertexNormals()` at 15 Hz after deformation (`soft-growth.js:32, 70`). On non-indexed geometry that gives flat face normals, so the blob is visibly faceted.
- It is also one sphere per plant, centred on the root, rather than a merging surface.
- Better (soft-growth cluster): an indexed sphere (e.g. `SphereGeometry(1,48,32)` or `mergeVertices(IcosahedronGeometry(1,4))`) with analytic normals for the radial displacement. Until fixed, the Liquid look should use a rigid species plus the tidal-glass shader.

**B15 (M, dependency) Silk ribbons are outside the camera's extent.** The ribbon mesh runs up to `size·2 = 16` units along +y from the root, independent of the skeleton direction (`soft-growth.js:56-61`). Framing measures only skeleton segments (TS:src/midi/engines/organism.ts:2589-2591), and soft meshes hide their skeleton. Better: include the soft-mesh bounding spheres in the framing extent, and orient ribbons along the skeleton.

**B16 (M) Audio sensitivity is a `globalThis` value.** It is not persisted, not in presets, not CC-learnable, has no effect on stems, and is shown in MIDI mode, where it does nothing. Better: `settings.audioSensitivity` → `audio.sensitivity`, registered as a ctl, with a note when the input is MIDI.

**B17 (M) Four 400 ms pollers.**
- Pollers: `reference-ui.js:58`, `music-focus-ui.js:23`, `dynamic-material-ui.js:23`, `extra-controls.js:29`.
- Together they make about 75 DOM property writes (disabled, value, textContent, aria-pressed, class) every 400 ms, forever, even when the UI is hidden.
- The sync is delayed up to 400 ms, and the logic is duplicated.
- Better: the control registry emits change events (`set`, `sync`, and the engine's `onControlValue`), and quick widgets subscribe.

**B18 (M) One control, several UI surfaces with different ranges and defaults.**

| setting | UI surfaces |
|---|---|
| musicAmount | `#simpleGrowth` (.1–1.2, default .42), `#musicAmount` (.1–1.5, .45), engine slider in More |
| camera | `#simpleCamera`, `#cameraPreset` (never synced), `#camCycle`, Camera group `camMode`, `#cameraLock`, `calmCamera` in More |
| species | look buttons, `#softChoice/#softOnly`, Species grid |
| source visibility | `#simpleReferenceVisible` (.45), `#refVisible` (remembered .55), `videoShow` |
| material | `#dynamicMaterial`, `shader` |
| tips / bounce | quick card and More |

Better: one widget factory bound to the registry, and quick panels are pinned views of the same ctls.

**B19 (M) The core music-growth controls sit under the image tools.** "Music growth" is nested in `#referenceTools` inside Input (`v19:index.html:230`). It is hidden in Simple and has an unstyled bare `<h3>`. Better: the Growth group (Advanced) plus the Response macros (Simple).

**B20 (M) The camera-lock button covers "Show controls" and appears in captures.** `#cameraLock` is `position:fixed; top:12px; right:12px; z-index:1000` (`v19:index.html:126`). `#returnUi` is at the same spot with `z-index:5` (`v19:index.html:108-112`). When the UI is hidden (F2 or performance) the Show-controls button is covered. The lock button is also not hidden by `body.hide-ui` or `body.capture-output` (?ui=0), so it shows in OBS page captures. Better: put the lock in the top bar and the HUD, hide it under `hide-ui`/`capture-output`, and add a keyboard shortcut (e.g. L).

**B21 (L) The Advanced panel flashes on load.** `body.simple-ui` is only applied when the ~1.4 MB module has executed (module scripts are deferred), so the full Advanced panel paints first. Better: default `data-ui="simple"` in markup and fix it up with a tiny inline head script that reads the setting.

**B22 (L) Tier CSS is a brittle id list.** It hides 15 ids with `!important` (`v19:index.html:127-132`), so any new section is visible in Simple by default. The Simple card stays in Advanced (fine), and the specialist cards have no `.body` wrapper. Better: `data-tier` on sections.

**B23 (M) The model and source intents are fragile.**
- `simpleReference('model')` does not check that a shell is loaded.
- The drop hook uses a 250 ms timeout and **only runs in Simple mode**, so dropping a model gives different growth parameters depending on the tier.
- `simpleModelFile` resets the growth without warning.
- "Music only" leaves the webcam/video running and being analysed (privacy and CPU). It should offer "stop source".
- trace/relief do not reset `shellMode`, so skin and reference conflict, and they set musicAmount .38 and fillRate 180 without updating the sliders.

**B24 (L) The docs and the UI disagree.** NOTES_FOR_CLAUDE.md, START_HERE_v0190.md and README.txt use different names from the actual UI:

| docs say | UI says |
|---|---|
| "Advanced" | "Advanced controls" |
| "Audio sensitivity" | "Audio attack sensitivity" |
| "Growth" / "Detail" | "How much the music grows" / "Branching detail" |
| "Gentle orbit" | "Very slow orbit" |
| "Trace silhouette" | "Trace details" |
| "Sculpt relief" | "Grow over relief" |
| "Choose 3D model" | "Load 3D model" |
| "Source visible" | "Show / hide source" |
| `musicGrowth` / `musicSustain` | real keys `musicAmount` / `sustain` |

The docs also say "Manual: no automatic motion" (it still auto-frames) and "Gentle: constant orbit" (it is energy-scaled).

**B25 (M) Validation gaps.**
- `maintenance/validate.py` checks ids only for `Y("…")` with double quotes (`re.findall(r'Y\("([\w-]+)"\)'…)`), so every `Y('…')` in simple-ui and the quick modules is unchecked.
- `test-consolidation.cjs` runs the module in stubs (the engine mock locks, and `Fm` is always ready). It cannot catch B1, B2, B4 or B5.
- The notes admit v0.16–v0.19 were never rendered.

**B26 (L) Accessibility.**
- `#uiMode` flips its label *and* `aria-pressed` (anti-pattern).
- Look buttons have no `aria-pressed`, radiogroup or current-state semantics.
- `<h3>` inside a details body breaks heading order.
- "✨" in labels.
- The Simple panel is fixed at 340px, which overrides `min(370px,…)`.

**B27 (L) Presets and looks do not mix well.**
- Surprise writes `#presetStatus`, which is hidden in Simple, and tells the user to "shift+click a slot", but slots are hidden in Simple.
- Slots do not store the look id, macros, camera style or audio sensitivity.

**B28 (L) Keyboard shortcuts act invisibly in Simple.** Keys 1–5 switch engines while the Pattern section is hidden. C cycles `camMode` invisibly, and under the lock it has no effect.

**B29 (M) Applying a look is expensive.**
- 37× `respawnHeld()` (one per species toggle, TS:src/midi/engines/organism.ts:765). With held notes that is 37×N plant releases and creations.
- Plus `applyShaders` (shader compile), `rebuildBackdrop` for every `video*` key, and ~30 `save()` debounces.
- Better: a batch API on the engine (§8.2).

**B30 (M, recording cluster UI) Recording settings are hidden and forgotten.** `recAudio`, `recResolution`, `recFps`, `recQuality` and `recCompat` are not persisted (only `he.recFormat` and `he.recMode` exist in the bundle). Simple hides Output entirely, so users cannot see the format they will get. That matters given the owner's QuickTime/Resolve complaints. Better: a one-line recording summary in the Simple top bar ("MP4 · 1080p30 · editor-safe").

**B31 (L) Search only filters sections.** With 37 species and 24 items in "More", matching a section still leaves the user scanning. The search is also hidden in Simple. Better: control-level filtering with highlight (§8.7).

---

## 8. Recommended TypeScript design

### 8.1 Modules

| file | contents |
|---|---|
| `src/midi/controls.ts` (new; extract from main.ts) | `ControlRegistry`: `get(id)`, `set(id,v)`, `sync(id,v)`, `batch(fn)`, `on(id | '*', cb)`, `ids(prefix)`. The existing `Ctl` (TS:src/midi/main.ts:114-123) gains an event emit in `set` and `sync`. `widget()` and the icon grid become registry-bound renderers usable in any host (engine sections, quick views, Look card). |
| `src/midi/ui/looks.ts` (new, pure) | `LookRecipe`, `LOOK_BASE`, `LOOK_PRESERVE`, `LOOKS`, `resolveLook()`, `varyLook()`, `pickSurprise()`, `macroMap()`. No DOM, so it is unit-testable. |
| `src/midi/ui/lookCard.ts` (new) | builds the Look card DOM, binds to the registry and settings, and applies looks (ordering in §8.3) |
| `src/midi/ui/tiers.ts` (new) | `uiMode` state, `data-ui` attribute, toggle button, persistence and migration, `shouldApplyFirstRun()` (pure) |
| `src/midi/ui/search.ts` (new) | control-level search (port of `interface.js`, improved) |
| `src/midi/ui/quick.ts` (new) | `pinControls(host, ids)` renders registry-bound widgets for quick views (source, music) with no polling |
| `src/midi/engines/organism.ts` | new controls (`lensReact`, `fog`, `cameraStyle` or equivalent); `GROUP` additions; `beginBatch/endBatch`; framing includes soft bounds (when soft growth is ported) |
| `src/midi/inputAudio.ts` | `sensitivity` field and a pure exported `onsetParams(s)` |
| `src/midi/presets.ts` | `Preset` gains optional `look?: {id: string; seed: number}`, `macros?: Record<string, number>` and `ui?: {cameraStyle?: string; audioSensitivity?: number}`. Backward compatible. |
| `index.html` | Look card markup (or empty host `#lookCard`), tier toggle in `#panelTop`, `data-tier` attributes, inline head script for FOUC |

### 8.2 Key types

```ts
// engine.ts additions
export interface Engine {
  /** Coalesce side effects (respawnHeld, applyShaders, rebuildBackdrop, rebuildEnv) until endBatch. */
  beginBatch?(): void
  endBatch?(): void
}

// ui/looks.ts
export type CameraStyle = 'stage' | 'drift' | 'manual'      // stage = still + auto-framed; drift = slow constant orbit + framing
export interface LookRecipe {
  id: string
  label: string
  /** primary species first; optional accents distributed by register (speciesMode 'by octave') */
  species: string[]                 // SPECIES[].name
  speciesMode: 0 | 1 | 2 | 3        // 'by note' | 'by octave' | 'random' | 'cycle'
  palettes: string[]                // PALETTES[].name; [0] = authored default, rest = Surprise candidates
  shaders: string[]                 // GROWTH_SHADERS[].name
  values: Partial<Record<string, number>>        // organism control key → authored value
  vary?: Partial<Record<string, [number, number]>> // absolute ranges for Surprise (clamped to control min/max)
  globals?: Partial<Record<'zoomReact' | 'beatZoom' | 'rotSpeed' | 'decay' | 'symmetry' | 'growth', number>>
  requires?: ('softSpecies' | 'dynamicMaterials')[] // hide or disable the look when the dependency is not ported
}
export interface ResolvedLook { speciesOn: Set<number>; palette: number; shader: number; values: Record<string, number>; globals: Record<string, number> }
export function resolveLook(r: LookRecipe, ctx: { species: string[]; palettes: string[]; shaders: string[] }): ResolvedLook // throws on unknown name
export function varyLook(r: LookRecipe, rng: () => number): LookRecipe
export function pickSurprise(count: number, recent: number[], rng: () => number): number
export function macroMap(kind: 'growth' | 'detail' | 'reaction', v: number, base: Record<string, number>): Record<string, number>
```

### 8.3 Look application: ordering (replaces `simpleApplyLook`)

1. `await ensureEngine('organism')`. If `mounting`, **await the in-flight mount promise**; do not bail (fixes B4). If recording, refuse with a status.
2. `resolveLook(varyLook?(recipe, seededRng))`.
3. `registry.batch(() => { … })` with `engine.beginBatch()`:
   - all `sp:i` toggles and `species` mode (one `respawnHeld` at `endBatch`)
   - `LOOK_BASE` ∪ recipe values; never keys in `LOOK_PRESERVE`
   - shader last (one `applyShaders` at `endBatch`)
4. `setPalette(palette)`; set globals via the registry.
5. Either morph the numeric values over 1.5 s with `Morph` (TS:src/midi/presets.ts:135) in "blend" mode, or apply instantly with `resetEngine()` in "fresh canvas" mode (user option, default fresh for clicks and blend for MIDI program change).
6. **After** reset: `engine.setCameraStyle(settings.cameraStyle)`. The look never changes the camera style.
7. Update the Look card:
   - the active button (`aria-pressed`)
   - the name
   - `settings.look = {id, seed}`
   - reset the macros to 0.5 (authored) via `sync`
8. `save()`.

### 8.4 Suggested constants (to be tuned in a browser, see §9)

`LOOK_BASE`. This is the canonical reset. Everything not in `LOOK_PRESERVE` must be listed.

```
species mode per look; wild 0; nested 0; physics 0; seasons 0; cycleEvery 0; beatLock 0; text 0;
speed 1; musicAmount 1; sustain .8; fillRate 1500; lignify 1.6; join 1; retract 1; maxLive 24; cohesion .35;
react 1; pulse .45; flash .35; speedReact .6; lightReact 1; glow 1; bloom 0 (quality tier may raise);
env 0; envShader 0; musicFocus .5; musicTrail 3; materialSpeed .6; materialReact .8; materialScale 1;
screenBounce 0; tipShape 0; tipSize 1; tipBrightness 1; lensReact 0; fog .35
globals: zoomReact 0, beatZoom 0, rotSpeed 0, decay .15, symmetry 1, growth 1
```

`LOOK_PRESERVE` (never touched by looks or Surprise):
- `shell*`, `modelAnim`, `animSpeed`, `attach`, `morph*`, `skinStick`
- `video*` (the source intent owns these)
- `budget`, `recycle`, `quality`, `autoQuality`, `bounds`, `size`
- `stem*`, `camMode`, `orbit`, `camFollow`, `growAtCam`, `camDistance`, `camSmooth` (the camera style owns these)
- `tipLimit`, `bounceSpeed`, `bounceSize`, `textHold`, `cycleMode`

Macros:
- Growth `v∈[0,1]`, default .5 = authored. Each target is scaled by f(v) with f(0)=.33, f(.5)=1, f(1)=2 (e.g. `f = 2^((v-.5)·3.2)`, clamped):
  - `musicAmount`: base·f (clamped .1–1.5)
  - `speed`: base·√f
  - `sustain`: base·f
  - `fillRate`: base·f (≥ 240, ≤ 6000)
  - The v=0 end ≈ the v19 "calm" rate.
- Detail `v`: `branch` and `wiggle` × f(v); `length` × 1/√f(v) (preserves each look's identity).
- Reaction `v`: `pulse`, `flash`, `speedReact` × f(v); `musicFocus` = lerp(.2, .8, v).
- Audio sensitivity: keep v19's formula (§2.7). Default .45 ≈ v0.15 behaviour. Apply the analogous scaling to stems.

Looks (by name):
- **Roots**: roots + fungi accent, by octave; forest palette; marble shader
- **Coral**: corals + staghorn coral + sea fan; candy; mottle
- **Neural**: neuron + veins; spectrum; veins
- **Crystal**: crystals + snowflake; mono; chrome
- **Liquid**: requires `softSpecies` and the B14 fix; otherwise slime mould + tidal glass
- **Silk**: requires `softSpecies` and the B15 framing fix

Surprise candidates: 2–3 palettes and 2–3 shaders per look.

`NO_RANDOM` extension for Wild mix: add `calmCamera`/`lensReact`, `fog`, `screenBounce`, `bounceSpeed`, `bounceSize`, `tipShape`, `tipLimit`, `videoBuild`, `videoBuildPace`, `videoFollow`, `videoInvert`, `videoScatter`, `camDistance`, `camSmooth`, `camMode`. Add `RANDOM_CAP` for `fillRate` (≤ 4000) and `bloom` (≤ .6 on low tier).

### 8.5 Camera style (replaces `calmCamera` + `setCalmCamera`)

- Controls:
  - `lensReact` (0..1, step .05, default 1 for legacy/Advanced users, 0 in Simple styles) replaces `calmCamera`. Migration: `calmCamera===1 → lensReact 0`, `0 → 1`.
  - `fog` (0..2, .05, default 1).
- `cameraStyle` is a **setting**, not an engine control:
  - `stage` → camMode 0, orbit 0, camFollow .35, growAtCam 0, lensReact 0
  - `drift` → camMode 0, orbit .12, and orbit speed independent of energy when `lensReact=0` (C6)
  - `manual` → camMode 0, orbit 0, camFollow 0
  - `legacy` → whatever the Advanced Camera group says
- Writes go through the registry.
- The pose lock (if ported from the camera cluster) is an explicit button in `#panelTop`/HUD with `aria-pressed`, hidden under `hide-ui`/`capture-output`, shortcut L. Never on by default. When locked, a "Fit" action unlocks first (or re-captures the pose after fitting).
- Framing (TS:src/midi/engines/organism.ts:2589-2591): use a robust extent (the max over sampled endpoints `s.b` as well as `s.a`, plus soft-mesh bounding spheres, plus reference bounds), and cap how quickly the frame can shrink.

### 8.6 GROUP additions (TS:src/midi/engines/organism.ts:226-244)

```
musicAmount:'Growth', musicFocus:'Growth', musicTrail:'Growth',
lensReact:'Camera', fog:'Look', camDistance:'Camera', camSmooth:'Camera',
screenBounce:'Camera', bounceSpeed:'Camera', bounceSize:'Camera',
softWave:'Soft motion', softReact:'Soft motion', softSpeed:'Soft motion',
videoBuild:'Video', videoBuildPace:'Video', videoFollow:'Video', videoInvert:'Video', videoScatter:'Video',
tipShape:'Look', tipSize:'Look', tipBrightness:'Look', tipLimit:'Performance',
materialSpeed:'Look', materialScale:'Look', materialReact:'Look'
GROUP_ORDER = ['Growth','Species','Soft motion','React','Look','Camera','Video','Model & shell','Life','Stems','Performance','More']
```

Rename the "Video" label to "Source (picture / video / camera)". Keep the key `Video` for `openSecs` compatibility, or migrate it. Add `OPEN_BY_DEFAULT` = Growth, Species.

### 8.7 Panel IA for TS (both tiers share one DOM; `data-tier` controls visibility)

```
#panelTop  [version] [↺ reset] [▶ perform] [hide UI] [Simple|Advanced switch]
           [● rec][rec mode][📷 still][recording summary: "MP4 · 1080p30 · editor-safe"] [🔒 lock view]
           [search (Advanced only)]
#lookCard  (both)   Look: 6 buttons (radiogroup) · ✨ Surprise · [x] fresh canvas
                    Response: Growth · Detail · Reaction · Audio sensitivity (hidden in MIDI mode)
                    Camera: Stage | Drift | Manual
#sec-input (both)   MIDI / Audio file / Mic / Tab · devices · transport · status
#sec-source (both)  picture / video / camera / model buttons; intents Trace | Relief | Skin model | Music only (+stop source)
                    Show source · Fit · (Advanced: size/depth/spread/build/follow/invert pinned from Video group)
#sec-pattern, #engineControls (Advanced)   Growth, Species, Soft motion, React, Look, Camera, Video, Model & shell, Life, Stems, Performance
#sec-global, #sec-presets (Saved slots + ✨ Surprise + 🎲 Wild mix), #sec-play, #sec-output, #sec-keys (Advanced)
```

Delete the "Flow & camera", "Animated materials", "Screen bounce & tip shapes" and "Music growth" cards. Their controls live in the proper groups, or are *pinned* views of the same registry ctls.

Search (Advanced):
- Filter **rows** (`.slider`, `.icons button`, `.row`) whose label, title or option text matches.
- Hide non-matching rows and open the parent section.
- Show a count.
- Esc clears and restores the open states. Keep the `rememberSection` guard while a query is active.

### 8.8 Do **not** port as-is

- `globalThis.__growthAudioSensitivity`
- prototype monkeypatches (`Object.assign(tw.prototype…)`, draw/clear/writeColor wrappers)
- the four `setInterval(…,400)` pollers
- `setCalmCamera` writing through `setControl`
- binary `calmCamera` with a hard-coded fog `.002`
- look recipes with numeric palette or shader indices
- auto pose-lock as the default "Still"
- the 700 ms first-run timer, and setting the flag before success
- the 250 ms simple-only drop hook
- raw duplicate DOM sliders with their own min/max (`#musicAmount`, `#simpleGrowth`, …)
- quick-panel ids equal to control keys (namespace them: `q-`, `look-`)
- the id-list `display:none!important` tier CSS
- rebinding `#randomMix` to Surprise
- the v19 "calm" base numbers as defaults

---

## 9. Acceptance tests

### 9.1 Unit-testable (pure TS; add `vitest` as a devDependency, since the TS repo has no test runner today, see TS:package.json)

1. `resolveLook` resolves every recipe in `LOOKS` against `SPECIES`, `PALETTES` and `GROWTH_SHADERS` names. An unknown name throws. A snapshot of the resolved indices guards against reorders (B13).
2. For every look: `LOOK_BASE ∪ values` sets **every** key not in `LOOK_PRESERVE` (enumerated against `OrganismEngine.controls`), and never touches a preserved key (B12).
3. `varyLook` with a seeded RNG is deterministic. Every varied value stays within its `vary` range and the control's min/max. At least 4 distinct parameters vary.
4. `pickSurprise(6, recent=[k], rng)` never returns k. Over 60 000 draws each other index gets 20 % ± 1 %. Manual picks are recorded in `recent`.
5. `macroMap`:
   - v=.5 returns exactly the authored base
   - monotonic in v
   - outputs clamped to control ranges
   - Growth v=1 raises `fillRate` (B6); Growth v=0 gives ≈ .33× rate
6. `onsetParams(.45)` = `{mul≈1.8975, gap≈.135, minEnergy≈.04375}`. Monotonic: higher s means a lower threshold, a shorter gap and a lower energy gate. s=0 and s=1 match §2.7.
7. `shouldApplyFirstRun`:
   - false when URL has `engine|preset|cam|ui`
   - false when `settings.engineCtl.organism` exists
   - false when already done
   - when storage throws: apply once per session only
   - the flag is written only after a successful apply (B4)
8. Registry batch: toggling 37 species inside `batch()` calls `engine.respawnHeld` exactly once and `applyShaders` at most once (spy) (B29).
9. `GROUP` covers every organism control key except `sp:*`, and every group appears in `GROUP_ORDER`. "More" is empty or intentional (B9).
10. Camera math (extract pure helpers from TS:src/midi/engines/organism.ts:2592-2606 and 2676-2680):
    - with `lensReact=0`, the target pose does not depend on `energy`, `onset` or `hitEnv`, and orbit angular speed is constant
    - with `lensReact=1`, it equals the v0.15 formulas
11. Framing helper: given segment endpoints, soft-mesh spheres and reference bounds, the target distance keeps all of them inside a 48° FOV with margin (B1/B15).
12. Settings migration: `growth-ui-mode='advanced'` → `settings.uiMode='advanced'`; `calmCamera=1` → `lensReact=0`; old presets without `look`/`macros` load unchanged.
13. Wild mix never changes any key in the extended `NO_RANDOM` (B10).
14. Search: a query that matches one slider label hides non-matching rows, opens the section, reports a count, and restores the open states on clear.

### 9.2 Needs a browser (Chrome primary; repeat the core checks in Safari 26/Firefox WebGL2)

1. Fresh profile, then open the single-file HTML: the Simple tier paints first with **no Advanced flash** (B21). The Roots look is active and highlighted after reload too. The camera is **not** locked. Middle-drag orbits and the wheel zooms (B1).
2. CPU-throttle ×6 (DevTools) on a fresh profile: the first-run look is still applied (B4).
3. `?engine=cells&ui=0` on a fresh profile: the engine stays `cells` and no look is applied (B4). The lock button is not visible in `?ui=0` (B20).
4. Scripted MIDI: hold 3 notes (C3/E3/G3, vel 100) for 2 s on each look. Record `engine.segs.length` via `window.__viz.engine`. Target: at least the v0.15.0 defaults' count on the same machine (record the baseline). The lead measured ~300 with v19 Roots (B7).
5. Scripted 8-note chord held 4 s: no tip starvation. Tips waiting for credit are < 10 % of frames. There is no visible freeze (B6).
6. Each look, 20 s of scripted MIDI in "Stage" camera: the projected bounding sphere of growth, including soft meshes, stays inside 95 % of the viewport (B1/B15). Silk ribbons stay in frame.
7. Liquid look (after the soft-growth fix): screenshot shows smooth shading and no facets at 1080p (B14).
8. Surprise ×10: never the same look twice in a row. Looks are visibly distinct. With "fresh canvas" off, values morph over ~1.5 s without clearing. The longest frame during apply is < 100 ms (B29).
9. Camera style select, lock button, Advanced camMode and `#camCycle` label stay consistent after every change and after reload (B2/B3).
10. F2 → the "Show controls" button is clickable and not covered (B20). Esc restores.
11. Macros:
    - move Growth to 1.0, click Coral → the macro resets to "authored" and the displayed value matches the controls (B5)
    - right-click Growth → CC-learn works
    - reload → macro positions restored
12. Audio file with clear transients: raising sensitivity from 0 to 1 increases onset count monotonically. The value survives reload. In MIDI mode the slider is hidden or marked inactive (B16).
13. Advanced: each group section contains the keys in §8.6, and "More" is empty. Search "fog" finds the Look → fog row only (B9/B31).
14. Record 20 s in Simple mode. The recording summary is visible, and the file opens in QuickTime and Finder Quick Look without stutter (ties to the recording cluster, B30).
15. Weak-laptop check (integrated GPU): with auto quality on, looks do not enable bloom once the render scale has dropped (B7), and the fps HUD stays ≥ 45 during test 4.
