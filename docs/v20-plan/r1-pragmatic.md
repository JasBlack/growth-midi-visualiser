# R1: A pragmatic modular engine for Growth v0.20

**Angle:** keep `OrganismEngine` as the orchestrator. Split the 2,790-line `organism.ts` into focused TypeScript modules connected by typed feature hooks. Put every v0.15.1–v0.19.0 feature in its own file, change behaviour as little as possible, make ports safe, and let several engineers port features in parallel without merge conflicts.

**Inputs read:**
- TS source at tag v0.15.0: `src/midi/engines/organism.ts` (all of it), `src/midi/main.ts` (all of it), `src/midi/engine.ts`, `index.html`, and skims of `recorder.ts`, `inputAudio.ts`, `videoField.ts`, `music.ts`, `shaders.ts`, `scripts/release.mjs`, `vite.config.ts` and `tsconfig.json`.
- v19 lineage: every `NOTES_*.md` file and `START_HERE_v0190.md`, all 21 readable `maintenance/*.js` modules, all 8 `patch_*.py` scripts (these hold the inline minified edits), one `test-*.cjs` in full and the head of another, and the v19 bundle's control-group map.

Everything below cites TS line numbers against `C:\Users\User\Desktop\code\growth-midi-visualiser` at v0.15.0. Minified anchors are quoted from the patch scripts.

---

## 0. Summary

1. **The v19 monkeypatches already define the hook API we need.** Each patch wraps an engine method (`addSeg`, `finishSegment`, `clearGrowth`, `clear`, `writeColor`, `writeSeg`, `draw`, `unmount`) or inserts code at a fixed point in `frame()`. Every wrapper and insertion becomes one named, typed hook. No feature ever needs to wrap a method again.
2. **Layout:** `engines/organism/` becomes a folder:
   - an orchestrator of about 450 lines;
   - `core/` for the world, segment meshes, the growth model, steering, pacing and envelopes;
   - `camera/` for the director, modes, modifiers and framing;
   - `render/` for the rig, environment and materials;
   - `model/` for types and the append-only species registry;
   - `features/<name>/` with one folder per optional system: reference, shell, soft, tips, emphasis, stage, life/*, stems.
3. **Features plug in through `OrganismFeature` and talk to each other only through services** with no-op defaults that exist from day one: emphasis, framing, materials, reference and camera. This is what lets five or six people port in parallel. The soft-species port does not wait for the music-focus port; it calls `ctx.services.emphasis.level(seg)`, which returns 1 until music-focus lands.
4. **Merge hotspots are removed in advance.** A one-person "WP0" pre-seeds:
   - the feature registry (one line per planned feature, pointing at stub files);
   - the group order list;
   - the panel section list;
   - entity extension points (TypeScript declaration merging).

   After WP0, a port only touches files inside its own folder.
5. **Every step keeps the app working.** Phase A adds a safety net: a seedable RNG, a headless simulation fingerprint and a Playwright smoke test. Phase B extracts code with bit-identical fingerprints and ends with v0.15.0 behaviour on the new layout. Phase C ports v16–v19 features in parallel. Phase D, which is separate, changes product behaviour: music visibility, the liquid look and framing.
6. **Main invariant for parallel work:** with every new feature's controls at off or neutral values, the simulation fingerprint must equal the baseline. That turns "everything optional" into a test.

---

## 1. Starting point

### 1.1 Section map of `organism.ts` (v0.15.0)

| Lines | Content | Target module |
|---|---|---|
| 22–45 | imports, BVH prototype patching | `render/RenderRig.ts`, `features/shell/bvh.ts` |
| 50–56 | CAP_START/CAP_MAX/MAX_TIPS, Turn/Node types | `core/SegmentMeshes.ts`, `model/types.ts` |
| 58–130 | `Species` interface + 24 rigid species (indices 0–23) | `model/species.rigid.ts` |
| 131–133 | SPECIES_MODES, BASE_SHELLS, SHELL_LOOKS | `model/species.ts`, `features/shell/shapes.ts` |
| 135–142 | LoadedModel | `features/shell/models.ts` |
| 144–165 | LATTICE_DIRS | `core/steering.ts` |
| 167–223 | Plant / Seg / Tip | `model/types.ts` |
| 226–244 | GROUP_ORDER / GROUP map | deleted: group moves onto each control def (see D1) |
| 253–293 | `smoothNormals` | `features/shell/geometry.ts` |
| 294–329 | NOTE_NAMES / CHORDS / `chordName` (exported) | `model/chords.ts` |
| 336–363 | `mutate` | `model/mutate.ts` |
| 371–446 | 73 control defs + 24 `sp:i` toggles | split: `controls/coreControls.ts` plus each feature's `controls.ts` |
| 448–568 | ~120 private fields | spread over World, Meshes, CameraDirector, RenderRig and feature state |
| 570–646 | `mount` (renderer init, lights, pointer handlers 608–645) | `RenderRig.mount`, `CameraDirector.attachInput` |
| 649–727 | budgetCap, maxPlantSegs, buildMeshes, growCapacity, makeInstanced | `core/GrowthWorld.ts`, `core/SegmentMeshes.ts` |
| 729–760 | resize, clearGrowth, clear | orchestrator + `RenderRig.resize` |
| 762–778 | `setControl` (rebuild dispatch) | orchestrator → `feature.onControl` |
| 783–879 | applyShaders, rebuildEnv, ensureBloom, draw | `render/materials/MaterialService.ts`, `render/environment.ts`, `RenderRig.draw` |
| 881–899 | setGesture, canvasEl, snapshot | orchestrator / RenderRig |
| 904–1014 | video field: fieldZ, projectToField, steerByLines, rebuildBackdrop | `features/reference/*` |
| 1020–1213 | shell names, loadShell, rebuildShell (morph tables, points, invert test, skin samples) | `features/shell/*` |
| 1215–1267 | skin/nerves getters, projectToSurface | `features/shell/skin.ts` |
| 1270–1377 | vertexWorld, animateModel, morphShell, restoreShell | `features/shell/morph.ts`, `features/shell/anim.ts` |
| 1380–1409 | updateCoverage, stats | `features/shell/coverage.ts`, orchestrator `stats()` |
| 1413–1484 | shellMaterial, inside, bounce, randomPointInside | `features/shell/*` |
| 1487–1506 | respawnHeld, shedOldest | `core/GrowthModel.ts`, `features/life/cycle.ts` |
| 1512–1656 | speciesFor, **newPlant** (root placement 1580–1624) | `core/GrowthModel.ts` + `placeRoot` hook chain |
| 1659–1773 | makeRoom, addSeg, writeColor, removeSeg, writeSeg | `core/GrowthWorld.ts`, `core/SegmentMeshes.ts` |
| 1775–1932 | toPlane, **nextDir**, nearestEndpoint, fuse, dropTip | `core/steering.ts` + `steerTip` hook |
| 1934–2070 | **startSegment** (constraints 1961–2012), finishSegment | `core/GrowthModel.ts` + `constrainEnd`, `acceptSegment`, `onSegmentFinished` |
| 2075–2137 | deform (wild sway, physics, nerve pulse) | `features/life/deform.ts` |
| 2140–2183 | seasons | `features/life/seasons.ts` |
| 2186–2270 | typography, growText | `features/life/typography.ts` |
| 2274–2737 | **frame()** (see 1.3) | orchestrator phase runner + core modules |
| 2739–2774 | release (+ nested children 2751–2773) | `core/GrowthModel.release` + `features/life/nested.ts` via `onPlantReleased` |
| 2776–2789 | unmount | orchestrator |

`main.ts` (1,174 lines):

| Lines | Content |
|---|---|
| 46–99 | settings |
| 134–224 | widget factory and `ctls` registry |
| 231–280 | engines and `selectEngine` |
| 306–395 | renderEngineControls |
| 397–416 | globals |
| 437–534 | presets, randomMix and morph (NO_RANDOM / RANDOM_CAP at 463–471) |
| 537–559 | MIDI CC learn |
| 561–711 | inputs and video |
| 713–781 | transport and drag-drop |
| 783–876 | recording |
| 878–896 | camera cycle |
| 898–916 | cast |
| 918–961 | interact |
| 963–996 | performance mode and reset |
| 998–1029 | keys |
| 1041–1110 | loop |
| 1112–1143 | URL params |
| 1145–1174 | boot |

### 1.2 How v19 attaches to the engine: the hook requirements

| v19 mechanism (file) | What it does | Hook that replaces it |
|---|---|---|
| `tw.prototype.addSeg` wrapper (reference-growth.js) | vetoes cliff-spanning segments before add; anchors UVs from `segment.a/b` after | `acceptSegment(plant,a,b)` + `onSegmentAdded(seg)` |
| `tw.prototype.finishSegment` wrapper (reference-growth.js) | tip inherits end UV; auto-built segment becomes permanent | `onSegmentFinished(tip, seg)` |
| `tw.prototype.clearGrowth` wrappers (reference-growth.js, soft-growth.js) | reset cursors/visited map; dispose soft meshes | `clear(ctx, 'growth')` |
| `tw.prototype.clear` wrapper (music-focus.js) | save/restore 8 vectors + 6 scalars when camera is locked | `CameraDirector.reset()` respects the lock; no wrapper |
| `tw.prototype.writeColor` wrapper (music-focus.js) | temporarily swaps `plant.color` for an emphasised copy | `segmentColor(seg, inout)` modifier chain |
| `tw.prototype.writeSeg` wrapper (soft-growth.js) | temporarily sets `growth=0` to hide the skeleton of meshed soft plants | `plant.skeletonHidden` flag honoured by `SegmentMeshes.writeSeg` |
| `tw.prototype.draw` wrapper (patch_species_stage.py) | screen-bounce projection edit with try/finally restore | `beforeDraw()` returns a token; `afterDraw(token)` runs in a `finally` inside RenderRig |
| `tw.prototype.unmount` wrappers (soft, tip-shapes) | dispose meshes, cancel uploads | `unmount(ctx)` |
| inline `this.updateReference(e,t)` after `this.lastGTime=e.time;` (organism.ts:2276–2277) | reference follow + auto-fill **before note events** | phase `input` |
| inline `this.updateDynamicMaterials(e)` at the same point | material clock and uniforms | phase `input` |
| inline `this.updateCinematic(e,t)` before `this.repel=null;` (≈2683) | camera modes 6–8 | `CameraMode` registry |
| inline `this.refreshMusicFocus();this.updateSoftGrowth(...)` at `draw(){` (871) | colour sweep, soft geometry | phase `preDraw` (moved out of `draw()`; see D4) |
| inline `this.syncTipShape()` before tip glow (2547) | tip geometry swap | `TipRenderer` owns tip mesh and shape |
| `let x=this.segmentAllowance(g,s);` replacing `let x=g>0?Math.max(1,g*s):1/0;` (2375) | fractional segment credit | `core/pacing.ts` |
| `m=1` replacing the throttle `m=1-.7*Math.min(...)` (2372) | removes budget slow-down | core change in `GrowthModel.grow` (data flag, see 5.6) |
| `G(this.controls,"musicAmount")*r*m*...` (2381–2382) | growth amount | `growthRate(plant)` multiplier; `musicAmount` is a core control |
| `if(!ge&&q.referenceAuto&&!q.dying&&!this.reversing)continue;` before `let ne=c*2.2` (2449) | auto-built reference growth survives retraction | `holdsSegments(plant)` veto |
| `if(c.dir0&&!this.videoOn&&...),this.skin&&!this.videoOn&&!r.root` (1609–1610) | reference wins at birth | `placeRoot` priority chain |
| `this.videoOn&&Ls===0&&Lr.set(0,0,0)` and `ab=Math.max(4,this.referenceFrameRadius…)` (2588–2590) | frame the reference in orbit | `FramingService` providers |
| `const Ls=...;if(!this.cameraLockPose){ … }else this.applyCameraLock();` (2573–2702) | camera lock skips simulation, culling and gestures | lock is the terminal step in CameraDirector |
| `calm?1:1+.03*e.energy…`, `(calm?0:Math.sin(n*.37)*.04)`, `react*(calm?0:1)`, `fog.density=calm?.002:…` (2592, 2600–2601, 2676, 2712) | stable presentation camera | `CalmModifier` + `mode.fog` rules |
| `if(this.cameraLockPose)return;` in pointerdown / pointermove / wheel (611, 624, 642) | block input when locked | `CameraDirector.attachInput` checks `locked` |
| `this.dragBtn===1&&!l.shiftKey`, pan by `camPos.distanceTo(camLook)` with screen-up vector, `lostpointercapture` (627–641) | Shift+middle pan | `CameraDirector.attachInput` |
| `G(this.controls,"camMode")<6` in root placement (1594) | new modes do not grow at the camera | `CameraMode.growAtCamera` flag |
| `else if(Ls===4)` (2665) | index guard so modes 6–8 skip "sit inside" | registry dispatch by index |
| tip glow edits: `(q.sp.glow<=0&&focus<=0)||(q.referenceAuto&&focus>0)`, min screen-size, cyan lerp, `tipLimit`, `orientTip`, `tipSize`, `tipBrightness` (2552–2567) | tip style | `decorateTip(plant, tip, style)` hook on `TipRenderer` |
| control inserts via string replace on the controls literal (patch_*.py) | new controls | each feature's own `controls.ts` |
| `label:e.name,icon:e.icon,…value:e.soft?0:1` (373) | soft species off by default | `SpeciesDef.defaultOn` |
| audio onset threshold replaced (inputAudio.ts:399–405) via `globalThis.__growthAudioSensitivity` | Simple-mode sensitivity | `AudioInput.sensitivity` property |
| `async function Fm(i){…if((hl.recording||recordingBusy)&&te?.id!==i)…` (main.ts:245–246) | block pattern switch while recording | `selectEngine` guard in `app/engines.ts` |
| UI code writing `te.zoomMul=1;te.pan.set(0,0,0);te.referenceFrameRadius=…` (reference-ui.js `refFit`), `sl(te.controls,…)` + `lR(te)` (performance-ui.js) | UI touches engine internals | typed `OrganismApi` facade (4.8) |

### 1.3 Order of `frame()` that must be preserved (v0.15 plus v19 inserts)

1. `lastG` / `lastGTime` (2276–2277). **v19:** `performanceState`, `updateDynamicMaterials`, `updateReference`.
2. Note events → `newPlant` / `release` (2292–2304).
3. Shell cycle (2306–2333), timed cycle (2335–2353), max-live (2355–2367).
4. Grow with pacing (2369–2423). **v19:** credit allocator, `musicAmount`, no throttle.
5. Retract and recycle (2425–2482). **v19:** `referenceAuto` veto and credit settlement at `const _=e.active.size===0`.
6. Mesh counts and visibility (2483–2504).
7. Wild bursts (2506–2524).
8. Shader music, `hitEnv`, `bassS`, `uPulse`, `uFlash` (2525–2535).
9. Field update (2536–2539; **v16 moved it to step 1**), `animateModel`, sky, deform, seasons, typography, coverage (2540–2545).
10. **v18:** `syncTipShape`. Tip glow (2547–2569), with v17.2 and v18 edits.
11. Camera (2571–2702). **v17:** `updateCinematic`. **v17.2:** lock. **v19:** calm.
12. Lights and fog (2703–2719), auto quality (2721–2734).
13. `draw()` (2736). **v17.2/v17.3/v18:** `refreshMusicFocus`, `updateSoftGrowth`, screen bounce.

### 1.4 Defects to fix structurally while restructuring

Fixing D1, D5, D6 and D14 is a side effect of the new layout. The rest become small, local, testable changes.

- **D1: every v16–v19 control appears under "More" in Advanced mode.** `mount()` overwrites any `group` set on a control: `c.group = c.key.startsWith('sp:') ? 'Species' : (GROUP[c.key] ?? 'More')` (organism.ts:571; same text in the bundle `l.group=…CK[l.key]??"More"`). The patches set `group:"Soft motion"` and `group:"Video"`, but the `CK` map was never extended. So `musicAmount`, `musicFocus`, `camDistance`, `softWave`, `materialSpeed`, `screenBounce`, `tipShape`, `calmCamera`, `videoBuild` and about 20 more all land in "More". **Fix:** the group lives on each control def and `mount` stops rewriting it.
- **D2: music growth is damped twice in Simple mode.** The Simple Growth slider sets `musicAmount=v`, `speed=.5+.65v` and `sustain=max(.08,.35v)`. `musicAmount` multiplies the rate on top of `speed` (patch_music_focus `const ge=G(…"musicAmount")*r*m*…`). At the default v=.42 the rate is 0.42 × 0.77 ≈ 0.32 of v15. `fillRate` 240 also caps new segment starts at 240/s (v15: 1500). This matches the lead's observation of about 300 segments for 3 notes held 2 s. It is a Phase D product fix, but in the new layout it becomes a single `pacing.ts` + `looks.ts` change.
- **D3: the Liquid look renders faceted.** `soft-growth.js` builds liquid with `new kp(1,2)`, i.e. `IcosahedronGeometry(1,2)`: 320 triangles and **non-indexed**. It then calls `computeVertexNormals()`, which on a non-indexed geometry gives per-face (flat) normals. **Fix:** an indexed sphere (`SphereGeometry(1,40,28)`, or `mergeVertices` + detail 4) and normals recomputed on the indexed mesh. The fix is local to `features/soft/softMesh.ts`.
- **D4: soft simulation and colour sweep run inside `draw()`.** `snapshot()` (889–899) also calls `draw()`, so a PNG still advances the soft animation and the emphasis sweep. **Fix:** move both to the `preDraw` phase. This is a deliberate tiny behaviour change and the only one in Phase C.
- **D5: four `setInterval(sync…, 400)` UI polls** (reference-ui, music-focus-ui, dynamic-material-ui, extra-controls). **Fix:** the `ctls` registry emits change events and quick controls subscribe to them.
- **D6: `ctl()` is a linear `Array.find` over ~170 controls** (engine.ts:79–82). It is called 111 times in organism.ts, including per segment in `writeSeg` (`ctl(this.controls,'nodes')` at 1758) and 4–6 times per tip in `nextDir` (1784–1871). The v19 reference code calls `G()` twice inside `fieldZ`, which runs 5× per `projectToField`. **Fix:** `ControlSet` with a Map index, plus `ControlHandle`s captured once.
- **D7: the camera scans every segment twice per frame** (centroid 2575–2582, radius 2590). At 250k segments that is about 0.5M vector ops per frame. **Fix:** a `FramingService` with stride sampling. The v18/v19 code already samples 384–512 points.
- **D8: `nearestEndpoint` is O(N) per segment start** (1895–1911). With `fillRate` 1500 and 60k segments that is about 90M distance checks/s, probably the main CPU cost at scale. **Fix:** a uniform spatial hash in `GrowthWorld`. `updateCoverage` (1385–1388) already uses the same idea.
- **D9: full instance buffers are flagged dirty on any change.** `writeSeg` sets `instanceMatrix.needsUpdate` on 5–7 meshes (1741–1772), so any change re-uploads whole buffers: at 60k capacity that is about 3.8 MB per mesh, roughly 27 MB/frame. **Fix:** dirty-range tracking with `addUpdateRange`. Support for `StorageInstancedBufferAttribute` on the WebGPU backend in r185 still needs checking. The change is confined to `SegmentMeshes`.
- **D10: `newPlant` copies the whole segment array per note-on** (`this.segs.filter(s=>s.growth>=1)`, 1583). **Fix:** pick random finished segments by rejection sampling from `world.segs`.
- **D11: Simple mode's still camera never re-frames.** The `still` preset locks the pose, so growth that leaves the view stays out of frame (the lead saw this with Silk). **Fix:** framing-aware calm modes on top of `FramingService` (Phase D).
- **D12: `globalThis.__growthAudioSensitivity`** is a cross-module global. **Fix:** an `AudioInput.sensitivity` field.
- **D13: the WebCodecs recorder hard-codes 2 channels at the context sample rate** (recorder.ts:147, 156, 198–200) and makes a silent take otherwise. v17 abandoned WebCodecs over this. **Fix:** an audio conformer, i.e. up/down-mix to stereo and resample before `AudioEncoder`. That keeps the verified H.264 High/AAC, moov-first, constant-frame-rate MP4 path.
- **D14: UI mutates engine internals** (`te.zoomMul`, `te.pan`, `te.referenceFrameRadius`, `sl(te.controls…)` bypassing `ctls`). **Fix:** the `OrganismApi` facade.
- **D15: the v19 `test-*.cjs` files assert substrings of the minified bundle** (e.g. `assert.ok(bundle.includes(code))`). They cannot be ported as-is. Their numeric cases (pacing across 30/60/120 fps, reflection sequences, OBJ limits, seed distribution) can.

---

## 2. Design principles

1. **Orchestrator, not framework.** `OrganismEngine` still implements `Engine` (engine.ts:42–77) unchanged, so `main.ts` and the other four engines are unaffected. It owns the phase order explicitly in code: one readable `frame()` about 30 lines long. There is no dependency-injection container and no event bus for hot paths.
2. **Data flags for hot paths, hooks for everything else.** Per-segment and per-tip hooks are compiled into direct function references (or `null`) once per frame. Cheap checks such as `plant.skeletonHidden` and `mode.growAtCamera` are plain fields.
3. **Features never import each other.** They talk through `ctx.services.*` interfaces that are defined in WP0 with no-op defaults.
4. **Append-only indices.** Presets, MIDI CC maps, URL `cam=` and saved settings store numeric option indices and `sp:<index>` keys. These stay frozen:
   - species 0–23 rigid, 24–36 soft;
   - `camMode` 0–8;
   - `shader` 0–31.

   A registry test snapshots them.
5. **Optional means zero cost when off.** A feature has `isActive(ctx)`. The host skips its hooks for the frame when that returns false.
6. **Parity first, then change.** Phase B commits must keep the fingerprint bit-identical. Behaviour changes happen only in explicitly labelled commits.
7. **No file over about 500 lines, and no feature touches the orchestrator.**

---

## 3. Module layout

```
src/midi/
  engine.ts                         Engine interface (unchanged API) + EngineControl gains optional
                                    `group`, `order`, `random`, `randomMax`, `persist`, `simple`
                                    ctl()/setCtl() accept EngineControl[] | ControlSet (compat)
  version.ts                        release manager only
  music.ts  beat.ts  color.ts  presets.ts  synth.ts  shaders.ts  vision.ts  cast.ts   (unchanged)

  inputs/                           (moved from src/midi/*.ts; old paths re-export during migration)
    inputAudio.ts                   + v0.15.1 request generations, speaker-only disconnect,
                                      + v0.17 cached input-only recordStream, + v0.19 `sensitivity`
    inputMidi.ts                    + v0.15.1 visibilitychange/contenteditable guards
    referenceField.ts               replaces videoField.ts (port of maintenance/reference-field.js;
                                      same public API + request, revision, seedScatter, density map)
    audioCtx.ts                     (unchanged; toRecordingOnly / recordingStream)

  engines/
    branching.ts cells.ts crystal3d.ts reactionDiffusion.ts   (unchanged)
    organism/
      index.ts                      export { OrganismEngine, SPECIES, chordName } (import path stays
                                      './engines/organism'; organism.ts is deleted at the end of B)
      OrganismEngine.ts             orchestrator (~450 lines): construct context, mount/unmount,
                                      frame() phase order, clear(), setControl() dispatch, stats(), api
      features.ts                   ORDERED feature list, pre-seeded in WP0 (one line per feature)
      api.ts                        OrganismApi facade for the UI

      controls/
        ControlSet.ts               Map-indexed controls, ControlHandle, change listeners, snapshot()
        groups.ts                   GROUP_ORDER, pre-seeded with every planned group
        coreControls.ts             growth / species / react / performance / look controls
                                      (the non-feature part of organism.ts:371-446 + musicAmount)

      model/
        types.ts                    Species, Plant, Seg, Tip, FrameCtx, *Ext extension interfaces
        species.ts                  SpeciesRegistry (append-only, index-asserted), SPECIES_MODES
        species.rigid.ts            24 rigid species (organism.ts:105-130), indices 0-23
        species.soft.ts             13 soft species (v0.17: 3, v0.18: 10), indices 24-36
        mutate.ts                   organism.ts:331-363
        chords.ts                   organism.ts:294-329
        rng.ts                      seedable rng(); default Math.random

      core/
        OrganismContext.ts          context object + typed service registry with no-op defaults
        FeatureHost.ts              compiles hooks per frame, runs phases, isolates feature errors
        GrowthWorld.ts              segs/plants/byPitch, addSeg/removeSeg/makeRoom, budgetCap,
                                      maxPlantSegs, spatial hash (D8), finished-seg sampler (D10)
        SegmentMeshes.ts            buildMeshes/growCapacity/makeInstanced/writeSeg/writeColor,
                                      visibility + counts, colour-modifier chain, skeletonHidden,
                                      dirty ranges (D9)
        GrowthModel.ts              speciesFor, newPlant (placeRoot chain), startSegment
                                      (constrainEnd chain), finishSegment, release, respawnHeld,
                                      applyEvents, enforceMaxLive, grow, retract
        steering.ts                 nextDir, toPlane, nearestEndpoint, fuse, dropTip, LATTICE_DIRS
        pacing.ts                   segment credit allocator (music-focus.js segmentAllowance) +
                                      credit settlement; legacy mode for the parity baseline
        Envelopes.ts                hitEnv, bassS, sustain, explEnv + shared smoothed bands used by
                                      camera, soft motion, materials (one place, one smoothing rule)

      render/
        RenderRig.ts                WebGPURenderer (WebGL2 fallback), lights, fog object, resize,
                                      draw(before/after chain), snapshot, auto quality, capture lock
        environment.ts              floor/cave/shadows + sky (organism.ts:817-854, 795-812)
        materials/
          MaterialService.ts        applyShaders (783-813) + owned per-mesh materials (soft) +
                                      catalogue = [...GROWTH_SHADERS, ...DYNAMIC_MATERIALS]
          dynamic.ts                10 animated materials, indices 22-31 (dynamic-materials.js)
          dynamicUniforms.ts        clock/scale/audio/attack uniforms (dynamic-material-runtime.js)

      camera/
        CameraDirector.ts           rig state (camPos, camLook, center, newCenter, pan, zoomMul,
                                      theta, manTheta, manPhi, dist, heading, …), mode dispatch,
                                      modifier chain, near plane, fog density rule, reset(),
                                      pointer/wheel input (Shift+middle pan, lostpointercapture)
        framing.ts                  FramingService: sampled centroid/extent + providers + projected
                                      screen bounds (shared by orbit, wide pulse, bounce, fit)
        lock.ts                     pose lock (music-focus.js toggle/apply) + reset preservation
        modes/classic.ts            0 orbit, 1 weave, 2 tunnel (+ culling), 3 drift, 4 sit, 5 chase
        modes/cinematic.ts          6 tip glide, 7 cinematic tour, 8 wide pulse (cinematic-camera.js)
        modifiers/react.ts          wild jitter, kick, shake (2673-2681)
        modifiers/calm.ts           calmCamera + presets still/gentle/manual (calm-camera.js)
        modifiers/gesture.ts        head parallax, pinch rotate, open-palm repel (2683-2701)

      features/
        reference/                  (v0.14/v0.16/v0.17.1/v0.17.2/v0.19)
          ReferenceFeature.ts       hooks + service implementation
          projection.ts             fieldZ, projectToField, steerByLines (pure over a field)
          anchors.ts                referenceAnchor/referencePoint, bounded follow sweep
          autofill.ts               Build shape seeding (pace, lifetime, caps)
          backdrop.ts               unit plane reuse, texture revision tracking
          controls.ts  ext.ts
        shell/                      (v0.12-v0.15 shell/skin/nerves/models/morph/cycle)
          ShellFeature.ts  shapes.ts  models.ts  skin.ts  morph.ts  anim.ts  coverage.ts
          cycle.ts  material.ts  geometry.ts (smoothNormals)  controls.ts
        soft/                       (v0.17/v0.18)
          SoftFeature.ts            round-robin update, caps, disposal, skeletonHidden
          forms.ts                  pure softFormXYZ incl. liquid/ribbon/blanket
          softMesh.ts               geometry choice (fixes D3), normal cadence
          controls.ts  ext.ts
        tips/                       (v0.18)
          TipRenderer.ts            owns tipMesh (independent of segment capacity), tip glow loop,
                                      decorateTip chain, orientation
          shapes.ts  objParser.ts (pure)  uploads.ts  controls.ts
        emphasis/                   (v0.17.2 music focus)
          EmphasisFeature.ts        focusLevel, segmentColor modifier, bounded 800/frame sweep,
                                      decorateTip (cyan, depthTest off, min screen size)
          controls.ts
        stage/                      (v0.18 screen bounce)
          ScreenBounce.ts  reflect.ts (pure reflectedStep)  controls.ts
        life/
          wild.ts (bursts 2506-2524)  deform.ts (2075-2137)  seasons.ts (2140-2183)
          nested.ts (2751-2773)  cycle.ts (2335-2353, shedOldest)  typography.ts (2186-2268)
        stems.ts                    speciesFor stems override (1513-1517) as `pickSpecies` hook

  output/
    recorder/
      index.ts                      Recorder facade: choose backend, report, status strings
      webcodecs.ts                  v0.15 WebCodecs + mp4-muxer/webm-muxer path (default for MP4)
      audioConform.ts               up/down-mix + resample AudioData → encoder config (fixes D13)
      mediaRecorder.ts              v0.17/v0.18 MediaRecorder backend (fallback / WebM)
      formats.ts                    VIDEO_FORMATS, explicit codec lists, editor profile
      report.ts                     recording report JSON
    cast.ts                         (moved)

  app/                              (main.ts split; main.ts itself ≈120 lines of boot)
    main.ts  settings.ts  loop.ts  engines.ts  keys.ts  performanceMode.ts
    controls/registry.ts            Ctl map + change events (replaces polling, D5) + CC learn
    controls/widget.ts              slider/select/icon factory with accessible names (v0.15.1)
    panel/order.ts                  pre-seeded section order
    panel/search.ts                 v0.15.1 find-a-setting (interface.js)
    panel/sections/                 one file per section, each renders its own DOM:
      simpleHome.ts  input.ts  reference.ts  music.ts  materials.ts  motionTips.ts
      pattern.ts  engineControls.ts  flowCamera.ts  global.ts  presets.ts  play.ts
      output.ts  keys.ts
    looks.ts                        v0.19 curated looks (data) + applyLook()
    presetsUi.ts  inputsUi.ts  recordUi.ts  castUi.ts  cameraLockButton.ts
```

`index.html` shrinks to static containers: the pinned bar, `#stage`, `#panel > #panelSections`, `#hud`, `#cameraLock` and `#returnUi`, plus CSS. Every section renders from TS, so a feature's UI change never touches `index.html`. The single-file build is unaffected because `release.mjs` inlines one bundle.

Approximate sizes after Phase C:

| File | Lines |
|---|---|
| OrganismEngine.ts | ~450 |
| GrowthModel.ts | ~480 |
| steering.ts | ~200 |
| SegmentMeshes.ts | ~260 |
| GrowthWorld.ts | ~200 |
| CameraDirector.ts | ~250 |
| modes/classic.ts | ~160 |
| ReferenceFeature and its split files | ~450 total |
| shell/* | ~650 total |
| soft/* | ~330 total |
| tips/* | ~260 total |

---

## 4. Key interfaces

### 4.1 Controls

```ts
// src/midi/engine.ts (additions only — existing fields untouched)
export interface EngineControl {
  key: string; label: string; min: number; max: number; step: number; value: number
  options?: string[]; icon?: string; group?: string
  /** stable order inside its group (panel only; presets are keyed, never ordered) */
  order?: number
  /** random mix / surprise: false = never touch (was NO_RANDOM, main.ts:463-469) */
  random?: boolean
  /** gentler random range (was RANDOM_CAP, main.ts:471) */
  randomMax?: number
  /** false = session only, never saved/preset (camera lock, upload-backed tipShape 9/10) */
  persist?: boolean
}
export function ctl(controls: EngineControl[] | ControlLookup, key: string): number
```

```ts
// engines/organism/controls/ControlSet.ts
import type { GroupName } from './groups'
export interface ControlDef extends EngineControl { group: GroupName }

export interface ControlHandle {
  readonly key: string
  readonly def: ControlDef
  /** hot-path read — no lookup */
  get value(): number
  get on(): boolean // value > 0
}

export class ControlSet implements ControlLookup {
  /** the array main.ts renders and persists; order = GROUP_ORDER then def.order then registration */
  readonly list: ControlDef[]
  private byKey = new Map<string, ControlDef>()
  private listeners = new Map<string, Set<(v: number) => void>>()
  constructor(defs: readonly ControlDef[][]) { /* flatten, assert unique keys, sort stable */ }
  get(key: string): number
  handle(key: string): ControlHandle // throws on unknown key → typos fail at mount, not silently 0
  set(key: string, v: number): void // setCtl semantics; notifies
  onChange(key: string, fn: (v: number) => void): () => void
  snapshot(): Record<string, number>
}
```

`groups.ts` is pre-seeded in WP0:

```ts
export const GROUP_ORDER = ['Growth', 'Music', 'Species', 'React', 'Model & shell', 'Reference', 'Soft motion',
  'Camera', 'Look', 'Materials', 'Tips', 'Screen', 'Life', 'Stems', 'Performance', 'More'] as const
export type GroupName = (typeof GROUP_ORDER)[number]
```

The v15 "Video" section label becomes "Reference". Section open/closed state is stored as `settings.openSecs['organism:Video']` (main.ts:324). Keep the key `Video` with display label "Reference" through a `GROUP_LABEL` map, or migrate one key on load. That is a single documented line.

### 4.2 Entities and extension without editing `types.ts`

```ts
// model/types.ts
export interface Seg extends SegExt {
  idx: number; a: THREE.Vector3; b: THREE.Vector3; r: number; growth: number; born: number
  permanent: boolean; plant: Plant; lq?: THREE.Quaternion
}
export interface Tip extends TipExt { pos; dir; axis; r; depth; seg: Seg | null; plant: Plant; path?; pathI?; n?; side; sinceBranch; wob; turn? }
export interface Plant extends PlantExt {
  id; pitch; velocity; level; bound; autoUntil; baseColor; isText; dying; children; root; reach; attach
  color; sp: Species; segs: Seg[]; tips: Tip[]; held; fused; birth; released; segLen; n; u; v
  /** set by a feature that draws this plant itself (soft meshes) — SegmentMeshes writes zero-growth */
  skeletonHidden: boolean
}
// Extension points — intentionally empty; features augment them from their own ext.ts.
export interface SegExt {}
export interface TipExt {}
export interface PlantExt {}
```

```ts
// features/reference/ext.ts — the ONLY place reference fields are declared
import type { UV } from './anchors'
declare module '../../model/types' {
  interface SegExt { referenceUV?: { a: UV; b: UV } }
  interface TipExt { referenceUV?: UV }
  interface PlantExt { referenceAuto?: boolean; referenceRoot?: UV }
}
```

`GrowthWorld.makeSeg()` and `GrowthModel.makePlant()` build the object literals. Feature fields are added lazily, exactly as in v19 today. If profiling shows polymorphic shapes hurting `writeSeg` at 60k+ segments, add an `initFields` hook later. That is a local change.

### 4.3 Frame context and phases

```ts
export interface FrameCtx {
  readonly m: MusicState
  readonly g: GlobalParams
  readonly t: number     // m.time
  readonly dt: number    // m.dt (raw)
  readonly dtc: number   // clamped for simulation: min(0.05, max(0, dt)) — one rule, used by
                         // pacing, materials, soft motion, bounce (v19 used .05 and .1 in places)
}

/** Phase order is fixed in OrganismEngine.frame(); features choose phases, never the order. */
export type Phase =
  | 'input'      // before note events: reference update, material clock, envelope pre-work
  | 'lifecycle'  // after events: shell cycle, timed cycle
  | 'react'      // after grow/retract: wild bursts
  | 'animate'    // model anim/morph, deform, seasons, typography, coverage
  | 'tips'       // tip markers (TipRenderer is a feature with order 0 here)
  | 'present'    // after camera: lights, fog adjustments
  | 'preDraw'    // emphasis sweep, soft geometry (moved from draw(), D4)
```

### 4.4 The feature interface

```ts
// model/types.ts (or core/feature.ts)
export interface OrganismFeature {
  readonly id: string
  /** lower runs first within a phase or a hook chain; default 100 */
  readonly order?: number
  readonly controls?: readonly ControlDef[]
  /** cheap gate evaluated once per frame; false ⇒ all hooks skipped this frame */
  isActive?(ctx: OrganismContext): boolean

  // lifecycle
  mount?(ctx: OrganismContext): void | Promise<void>
  unmount?(ctx: OrganismContext): void
  /** 'growth' = Reset button / timed reset; 'all' = engine clear */
  clear?(ctx: OrganismContext, scope: 'growth' | 'all'): void
  onControl?(key: string, value: number, ctx: OrganismContext): void
  onResize?(ctx: OrganismContext): void

  // phases (see Phase)
  input?(f: FrameCtx, ctx: OrganismContext): void
  lifecycle?(f: FrameCtx, ctx: OrganismContext): void
  react?(f: FrameCtx, ctx: OrganismContext): void
  animate?(f: FrameCtx, ctx: OrganismContext): void
  tips?(f: FrameCtx, ctx: OrganismContext): void
  present?(f: FrameCtx, ctx: OrganismContext): void
  preDraw?(f: FrameCtx, ctx: OrganismContext): void
  /** return a token to be handed back to afterDraw — always called, even when render throws */
  beforeDraw?(ctx: OrganismContext): unknown
  afterDraw?(ctx: OrganismContext, token: unknown): void

  // growth hooks — HOT: compiled into direct references each frame
  /** species choice override (stems); return null to defer */
  pickSpecies?(pitch: number, channel: number, ctx: OrganismContext): Species | null
  /** return true when the root was placed (stops the chain). Priority by `order`. */
  placeRoot?(req: RootRequest, ctx: OrganismContext): boolean
  steerTip?(tip: Tip, out: THREE.Vector3, f: FrameCtx, ctx: OrganismContext): void
  /** project/limit the new end point; 'drop' kills the tip; 'final' stops later constraints */
  constrainEnd?(tip: Tip, end: THREE.Vector3, dir: THREE.Vector3, len: number, ctx: OrganismContext): 'ok' | 'final' | 'drop'
  acceptSegment?(plant: Plant, a: THREE.Vector3, b: THREE.Vector3, ctx: OrganismContext): boolean
  onSegmentAdded?(seg: Seg, ctx: OrganismContext): void
  onSegmentFinished?(tip: Tip, seg: Seg, ctx: OrganismContext): void
  onPlantCreated?(plant: Plant, ctx: OrganismContext): void
  onPlantReleased?(plant: Plant, t: number, ctx: OrganismContext): void
  onPlantRemoved?(plant: Plant, ctx: OrganismContext): void
  /** true ⇒ this plant's segments are not retracted/decayed this frame */
  holdsSegments?(plant: Plant, t: number, ctx: OrganismContext): boolean
  /** multiplicative growth-rate factor */
  growthRate?(plant: Plant, f: FrameCtx, ctx: OrganismContext): number
  /** mutate `inout` (starts as plant.color or its dimmed variant) */
  segmentColor?(seg: Seg, inout: THREE.Color, ctx: OrganismContext): void
  decorateTip?(plant: Plant, tip: Tip, style: TipStyle, ctx: OrganismContext): void

  stats?(ctx: OrganismContext): string | null
}

export interface RootRequest {
  readonly pitch: number; readonly velocity: number; readonly sp: Species
  readonly opt: NewPlantOptions
  readonly root: THREE.Vector3   // in/out
  plant: Plant                   // partially built; features may set attach, referenceRoot…
  /** true once any earlier placer claimed it; later placers may still refine (skin on surface) */
  placed: boolean
}

export interface TipStyle {
  include: boolean; scale: number; minScreen: number
  color: THREE.Color; brightness: number; depthTest: boolean; renderOrder: number
}

export const defineFeature = <T extends OrganismFeature>(f: T) => f
```

The v15 root-placement order (1580–1624), expressed as `placeRoot` priorities:

| order | placer | source |
|---|---|---|
| 0 | explicit `opt.root` (text, nested, auto-fill) | 1585 |
| 20 | reference seed pick (`videoSpawn`), with v16 rule "reference wins, no dir0 offset, no skin" | 1600–1608 + patch_reference |
| 40 | skin surface start (+ attach to animated vertex) | 1610–1624 |
| 60 | cohesion graft | 1586–1589 |
| 80 | camera-path / organism-radial default + inside-shell correction | 1590–1599 |

Core applies the `dir0` x-jitter (1609) only when no placer at order ≤ 20 claimed the root.

The order is *not* free: v15 evaluates graft/default first, then overrides with reference, then skin. The chain reproduces the same result by claiming priority. A parity test covers it.

`constrainEnd` order for `startSegment` (1961–2012):

| order | constraint |
|---|---|
| 10 | reference `projectToField` → 'final' (v15: it skips the shell and sphere bounds) |
| 20 | skin `projectToSurface` → 'final' |
| 30 | shell contain `bounce` → 'ok' or 'drop' |
| 50 | core organism-size sphere (skipped when an earlier constraint returned 'final', or when camera mode is fly-through tunnel) |
| 60 | core nested `bound` |

### 4.5 Context and services

```ts
export interface OrganismContext {
  readonly controls: ControlSet
  readonly world: GrowthWorld
  readonly meshes: SegmentMeshes
  readonly growth: GrowthModel        // spawnPlant(), release(), respawnHeld(), speciesFor()
  readonly rig: RenderRig             // renderer, scene, group, camera (THREE), canvas, draw()
  readonly camera: CameraDirector
  readonly env: Envelopes
  readonly services: Services
  readonly events: EngineEvents        // onEvent (sound-back), controlValue(key,v), controlsChanged(), status(s)
  readonly rng: () => number
  /** scratch vectors per module — never shared across modules (v19 bug class: v17.1 starburst) */
  scratch(owner: string): Scratch
  lastG: GlobalParams | null
  time: number
}

export interface Services {
  emphasis: EmphasisService   // default: { level: () => 1 }
  framing: FramingService     // default: core implementation (always present)
  materials: MaterialService  // default: core implementation (always present)
  reference: ReferenceService // default: { active: false, … }
  shell: ShellService         // default: { present: false, skin: false, nerves: false, inside: () => true }
}
export interface EmphasisService { level(seg: Seg | { plant: Plant; born: number }): number }
export interface ReferenceService {
  readonly active: boolean                    // field ready && videoMode > 0  (old `videoOn`, 909-911)
  fieldSize(): { w: number; h: number }
  fieldZ(u: number, v: number): number
  toUV(p: THREE.Vector3): { u: number; v: number }
  followsLive(): boolean
}
export interface FramingService {
  addProvider(p: BoundsProvider): () => void
  /** world-space sampled centroid + extent; cached per frame; stride-sampled (D7) */
  sceneBounds(): { center: THREE.Vector3; radius: number; newest: THREE.Vector3 }
  /** NDC bounds for the current camera (screen bounce), cached at 4 Hz */
  screenBounds(camera: THREE.Camera, t: number): { x: number; y: number; hx: number; hy: number }
}
export interface BoundsProvider { id: string; addPoints(push: (p: THREE.Vector3) => void): void }
export interface MaterialService {
  readonly catalogue: readonly ShaderDef[]    // [...GROWTH_SHADERS, ...DYNAMIC_MATERIALS]
  applyGrowth(index: number): void           // old applyShaders
  /** material for an owned mesh (soft); returns base for legacy indices (v17.3 rule) */
  ownedFor(index: number, base: THREE.Material): THREE.Material
  release(mat: THREE.Material): void
}
```

The `scratch(owner)` rule addresses a real bug class. The v17.1 central-starburst bug happened because `writeSeg` reused `this.v1`, which the caller also passed in as the endpoint. With per-module scratch objects, a hook can never alias core scratch vectors.

### 4.6 Camera

```ts
export interface CameraRigState {
  camPos: THREE.Vector3; camLook: THREE.Vector3; center: THREE.Vector3; newCenter: THREE.Vector3
  camTarget: THREE.Vector3; camLookT: THREE.Vector3; heading: THREE.Vector3; pan: THREE.Vector3
  dist: number; theta: number; manTheta: number; manPhi: number; zoomMul: number
  camFwd: THREE.Vector3; driftTarget: THREE.Vector3; driftT: number
  /** extent computed this frame (v17.2 focusCameraExtent) */
  extent: number
  /** per-frame multipliers modifiers may zero (calm): breathe, wobble, react */
  breathe: number; wobble: number; react: number
}
export interface CameraMode {
  readonly index: number           // frozen 0..8
  readonly label: string
  readonly near: number            // 0.05 orbit, 0.4 fly-through (2285)
  readonly fog: 'orbit' | 'fly'    // density rule (2712; v17 put modes 6-8 on 'orbit')
  readonly growAtCamera: boolean   // modes 1-5 true; 0 and 6-8 false (1594 + v17 guard)
  readonly shellOff?: boolean      // tunnel: shellOn=false (2283)
  update(s: CameraRigState, f: FrameCtx, ctx: OrganismContext): void
}
export interface CameraModifier {
  readonly id: string; readonly order: number
  apply(s: CameraRigState, f: FrameCtx, ctx: OrganismContext): void
}
export class CameraDirector {
  readonly state: CameraRigState
  readonly modes: readonly CameraMode[]          // index-addressed
  readonly modifiers: CameraModifier[]           // react(10) → calm(5, runs first to zero react) → gesture(50)
  get locked(): boolean
  toggleLock(): boolean
  preset(p: 'still' | 'gentle' | 'manual'): void // calm-camera.js semantics
  fit(bounds?: { center: THREE.Vector3; radius: number }): void // replaces UI poking zoomMul/pan
  reset(): void                                   // clear(): no-op for the pose when locked
  update(f: FrameCtx, ctx: OrganismContext): void // centre/extent → mode → modifiers → apply (or lock)
  attachInput(canvas: HTMLCanvasElement): () => void
}
```

`update()` order, which matches v19:

1. Compute `center` and `extent` via framing, with the reference override in orbit.
2. If locked, `applyLock()` and return. This skips the modes, tunnel culling and gestures.
3. Otherwise run `modes[i].update`, then modifiers (calm zeroes `breathe`, `wobble` and `react`; then react's kick/shake; then gestures), then set `camera.position` and `lookAt`.

Calm reads `calmCamera` and forces fog density to 0.002 through a `fogOverride` field that RenderRig consults.

### 4.7 Species registry

```ts
export interface SpeciesDef extends Species {
  readonly index: number        // asserted equal to registration position
  readonly soft?: SoftKind      // 'liquid' | 'ribbon' | 'blanket' | 'jelly' | … | 'disc'
  readonly defaultOn?: boolean  // soft: false (v17 edit at 373)
  readonly curated?: boolean    // v19: experimental soft species excluded from looks
}
export class SpeciesRegistry {
  constructor(...lists: readonly SpeciesDef[][]) // asserts contiguous indices, unique names
  readonly all: readonly SpeciesDef[]            // SPECIES export (stems selects, simple looks)
  byName(name: string): SpeciesDef | undefined
  controls(): ControlDef[]                       // 'sp:<index>' toggles, group 'Species'
}
```

Keep the `sp:<index>` keys: saved `engineCtl` and presets depend on them. The v19 `performance-ui.js` "Use soft species" button becomes `api.species.selectSoft(kind)`.

### 4.8 Public API for the UI

```ts
export interface OrganismApi {
  camera: { readonly locked: boolean; toggleLock(): boolean; preset(p: 'still'|'gentle'|'manual'): void
            fitReference(): void; fitScene(): void }
  reference: { activate(mode: 'trace'|'relief'|'shape'): void; readonly active: boolean }
  species: { respawnHeld(): void; selectSoft(kind: SoftKind | 'all'): void; readonly list: readonly SpeciesDef[] }
  tips: { load(file: File): Promise<number | undefined> }
  shell: { load(file: File): Promise<string> }
}
// OrganismEngine: `readonly api: OrganismApi`; main narrows with `engine instanceof OrganismEngine`
```

This replaces the v19 UI code that set `te.zoomMul=1`, `te.pan.set(...)`, `te.referenceFrameRadius=…` (reference-ui.js) and `sl(te.controls,…)`+`lR(te)` (performance-ui.js). It keeps the UI stream (S5) independent of engine internals.

### 4.9 FeatureHost (sketch)

```ts
export class FeatureHost {
  private all: OrganismFeature[] = []
  private active: OrganismFeature[] = []
  // compiled per frame
  phase: Record<Phase, ((f: FrameCtx) => void)[]> = { input: [], lifecycle: [], react: [], animate: [], tips: [], present: [], preDraw: [] }
  segmentColor: ((s: Seg, c: THREE.Color) => void) | null = null
  steerTip: ((t: Tip, o: THREE.Vector3, f: FrameCtx) => void) | null = null
  placeRoot: ((r: RootRequest) => boolean)[] = []
  constrainEnd: ((t: Tip, e: THREE.Vector3, d: THREE.Vector3, l: number) => 'ok' | 'final' | 'drop')[] = []
  // … one field per hook

  refresh(ctx: OrganismContext) {
    const next = this.all.filter((x) => !this.failed.has(x.id) && (x.isActive?.(ctx) ?? true))
    if (sameList(next, this.active)) return // most frames: nothing to rebuild
    this.active = next
    this.segmentColor = chain(next, 'segmentColor', ctx) // null when none, direct fn when one
    // …
  }
  run(p: Phase, f: FrameCtx) {
    for (const fn of this.phase[p]) fn(f) // fn is wrapped once in guard(id) — see below
  }
  /** a throwing feature is disabled and reported; the frame and every other feature continue */
  private guard(id: string, fn: Function) { /* try { fn() } catch (e) { this.failed.add(id); ctx.events.status(`${id} disabled: ${e}`) } */ }
}
```

Error isolation matters here. v16–v19 code was never rendered, and today a single throw inside `frame()` becomes `frame error: …` (main.ts:1083–1087) on every frame, blanking the visualiser. With isolation, a broken tip upload disables tips and nothing else.

### 4.10 Orchestrator `frame()`

```ts
frame(m: MusicState, g: GlobalParams) {
  if (!this.ready) return
  const f = this.ctx.beginFrame(m, g)            // lastG/lastGTime (2276-2277), dtc
  this.host.refresh(this.ctx)
  this.host.run('input', f)                      // reference.update, dynamic uniforms  (v19: before events)
  this.growth.applyEvents(f)                     // 2292-2304
  this.host.run('lifecycle', f)                  // shell cycle, timed cycle           (2306-2353)
  this.growth.enforceMaxLive(f)                  // 2355-2367
  this.growth.grow(f)                            // 2369-2423 (+ pacing, growthRate hooks)
  this.growth.retract(f)                         // 2425-2482 (+ holdsSegments, credit settle)
  this.meshes.sync(this.world)                   // 2483-2504
  this.host.run('react', f)                      // wild bursts 2506-2524
  this.env.update(f)                             // 2525-2535 uniforms + envelopes
  this.host.run('animate', f)                    // model anim/morph, sky, deform, seasons, typography, coverage
  this.host.run('tips', f)                       // TipRenderer (order 0) + decorateTip chain
  this.camera.update(f, this.ctx)                // 2571-2702
  this.rig.present(f, this.camera)               // 2703-2734 lights, fog, point light, auto quality
  this.host.run('present', f)
  this.host.run('preDraw', f)                    // emphasis sweep, soft geometry (D4)
  this.rig.draw(this.host)                       // before/afterDraw (screen bounce), bloom/plain
}
```

---

## 5. Where each v19 feature cluster lands

Each subsection gives: the source to port, where it goes, the hooks it uses, its controls, its tests, and what needs care.

### 5.1 Reference guidance (v0.16.0, v0.17.1, parts of v0.17.2 and v0.19.0)

- **Sources:**
  - `maintenance/reference-field.js` (replaces class `aJ` = `VideoField`, videoField.ts);
  - `reference-growth.js`;
  - `reference-ui.js`;
  - the inline edits in `patch_reference.py`, `patch_seed_fix.py` (`videoScatter`), `patch_music_focus.py` (auto-fill pace, dirty tracking) and `patch_consolidation.py` (mode 3 default on activate).
- **Where it goes:**
  - `inputs/referenceField.ts` keeps VideoField's public API and adds `request`, `revision`, `seedScatter`, `seedCounts` (12×12), bilinear `sample`, `visit` neighbourhoods and `pickPoint(edges, tries)`.
  - `features/reference/*` holds the engine side.
- **Hooks:**
  - `input` (order 10): `updateReference`. Updates the field and backdrop; runs a bounded follow sweep of 4,000 segments per batch at 30 Hz with a cursor and resize-pending flag; keeps tips and roots coherent; runs auto-fill (pace `videoBuildPace`, lifetime 2 s, ≤ 4 live, ≤ min(16k, 0.8·budget) segments).
  - `placeRoot` (order 20). `steerTip` = `steerByLines` (949–986). `constrainEnd` (order 10, 'final') = `projectToField` with rectangle clamping and gradient normals.
  - `acceptSegment` = cliff rejection, with max length clamped to [0.75, 3] and bypassed for typography.
  - `onSegmentAdded` = UV anchors **from `seg.a` / `seg.b`**, plus `field.visit`. `onSegmentFinished` = `tip.referenceUV`, and auto segments become permanent.
  - `holdsSegments` = `plant.referenceAuto && !plant.dying && !world.reversing`.
  - `clear('growth')` = cursor, seedT, `visited`/`seedCounts` reset.
  - `onControl('video*')` = backdrop rebuild. `stats` = picture coverage (1406).
  - FramingService provider = reference rectangle corners ±depth/2 plus `referenceFrameRadius`, replacing the patched `center.set(0,0,0)` and radius override at 2588–2590.
- **Services:**
  - It provides `ReferenceService`. Soft uses it to clamp to the rectangle and follow the relief; stage uses it for bounds.
  - It uses `camera.fit()` for "Fit view".
- **Controls:** group "Reference". `videoMode` (option 4 relabelled "3D shape — fill the reference relief"), `videoBuild`, `videoFollow`, `videoInvert`, `videoScatter`, `videoBuildPace`, `videoSize`, `videoDepth`, `videoEdge`, `videoStick`, `videoSpawn`, `videoShow`.
- **UI:** `app/panel/sections/reference.ts` (3D reference card and Simple trace/relief buttons) calls `api.reference.activate(mode)`, which sets the control recipe: trace = mode 3, edge 2.5, scatter .22…; relief = mode 4…
- **Tests:** port test-reference.cjs (bilinear, inversion, rectangle bounds, live vs frozen anchors, 5,001-segment sweep completion) and test-seeding.cjs (anchor-aliasing regression, cliff rejection, 144-cell coverage) into `features/reference/*.test.ts` against the headless harness.

### 5.2 Soft species (v0.17.0 + v0.18.0)

- **Sources:** `soft-growth.js`, `soft-species-extra.js`, `performance-ui.js` (softOnly).
- **Where it goes:**
  - `model/species.soft.ts`: 13 defs, indices 24–36, all `defaultOn:false`; liquid/silk/blanket spread from `SPECIES[1]` as in v17.
  - `features/soft/forms.ts`: pure, allocation-free `softFormXYZ(kind,u,v,size,t,phase,wave,energy,out)`, with the liquid/ribbon/blanket formulas moved into the same switch.
  - `features/soft/SoftFeature.ts`.
- **Hooks:**
  - `onPlantCreated`: nothing yet, because the mesh is created lazily under the quota.
  - `preDraw`: round-robin, ≤ 16 updates per frame, ≤ 64 meshes, geometry at 30 Hz, normals at 15 Hz. It sets `plant.skeletonHidden=true` when a mesh is assigned and re-writes that plant's segments once.
  - `onPlantRemoved` disposes the item. This replaces the v19 per-frame `new Set(this.plants)` scan; core emits `onPlantRemoved` from the `plants.filter` at 2482 and from tunnel culling at 2635.
  - `clear('growth')` and `unmount` dispose everything.
  - FramingService provider = soft mesh bounding boxes, used by stage.
- **Services:**
  - `materials.ownedFor(shaderIndex, base)` (v17.3 rule: legacy indices use the base material; 22–31 use an owned effect material).
  - `emphasis.level(lastSeg ?? {plant, born})`.
  - `reference.fieldZ` when following.
- **Controls:** group "Soft motion": `softWave`, `softReact`, `softSpeed`.
- **Improvement slot (Phase D):** `softMesh.ts` chooses the geometry. Fixing D3, the faceted liquid, is a one-file change.
- **Tests:** port test-motion.cjs and test-stage-tips.cjs cases: all 13 forms finite, retraction, disposal, per-frame and total caps.

### 5.3 Animated materials (v0.17.3)

- **Where it goes:** `render/materials/dynamic.ts` exports `DYNAMIC_MATERIALS` (10 entries, which must land at indices 22–31; the registry test asserts `GROWTH_SHADERS.length===22`). `dynamicUniforms.ts` is updated from `Envelopes` in the `input` phase through a tiny core-owned `MaterialsClock` feature (order 20). Phase integration, dt clamp, the energy/attack smoothing and the silence rule from `dynamic-material-runtime.js` carry over as written.
- **Controls:** group "Materials": `materialSpeed`, `materialScale`, `materialReact`. The existing `shader` control stays in "Look" (same key, so presets and MIDI learn keep working).
- **UI:** `sections/materials.ts` (select, "Next new"), subscribing to `shader` changes. No polling.
- **Tests:** test-dynamic-materials.cjs evaluates the node expressions through a numeric model. Keep that approach: import `dynamic.ts` with a fake TSL module map (vitest `vi.mock('three/tsl')`).

### 5.4 Tip shapes (v0.18.0)

- **Why a separate TipRenderer:** in v15 `tipMesh` is rebuilt inside `buildMeshes` whenever segment capacity doubles (683). That is why tip-shapes.js has to detect `this.tipShapeMesh===this.tipMesh`. In the new layout `TipRenderer` owns its own `InstancedMesh`, sized to `max(tipLimit)`=512, independent of segment capacity, so the replacement-detection code disappears.
- **Where it goes:** `features/tips/`:
  - `TipRenderer.ts`, order 0 in the `tips` phase: the old loop at 2547–2569 plus `tipLimit`, the OBJ 128 cap, `orientTip` (flat shapes 5–9 face the camera), `tipSize` and `tipBrightness`;
  - `shapes.ts` (9 built-ins plus flat star and heart);
  - `objParser.ts`, pure: 10k vertices, 2,048 triangles, negative indices, normalisation;
  - `uploads.ts`: request generations, 8 MB cap, 256² canvas texture, disposal on unmount.
- **Hooks:** `decorateTip` from emphasis.
- **Controls:** group "Tips": `tipShape` (`persist:false` for values 9 and 10, which need uploads that are session-only), `tipSize`, `tipBrightness`, `tipLimit`, and `glow` (moved from Look; same key).
- **Tests:** port the OBJ and upload-replacement cases.

### 5.5 Camera: modes 6–8, Shift-pan, lock, calm, fit (v0.17.0, v0.17.2, v0.19.0)

- `camera/modes/cinematic.ts`: `updateCinematic` split into three `CameraMode` objects sharing a helper. They keep `cinematicAngle`, `tourPlant`/`tourIndex`/`tourSwitch` and `cinematicBass` in director state. Wide pulse uses `framing.sceneBounds()` instead of its own 512-sample scan.
- `camera/lock.ts`: pose `{position, quaternion, look, near, far, fov}`. `toggleLock` resets `dragBtn`. `applyLock` restores the pose. `CameraDirector.reset()` leaves the pose alone when locked, which replaces the 14-field save/restore in the `clear` wrapper. Aspect still follows resize.
- `camera/modifiers/calm.ts`: the `calmCamera` control (default 1, from v19) and `preset()` from calm-camera.js. Presets set `camFollow`, `growAtCam`, `kick`, `shake`, `camMode` and `orbit` via `controls.set`, which notifies the UI.
- `CameraDirector.attachInput`:
  - middle-drag orbits unless Shift is held;
  - Shift+middle and right-drag pan, using `camPos.distanceTo(camLook)*.0012` and a screen-up vector;
  - `lostpointercapture` ends the drag;
  - all input is blocked while locked.
- **Controls:** group "Camera": `camMode` (options extended to 9, max 8), `orbit`, `growAtCam`, `camFollow`, `camDistance`, `camSmooth`, `calmCamera`.
- **UI:** `cameraLockButton.ts` (fixed top-right, visible with the UI hidden, excluded from `?ui=0` capture) and `flowCamera.ts` (camera preset select).
- **Tests:**
  - lock survives reset and skips tunnel culling;
  - calm keeps the camera distance independent of audio (drive `energy` 0→1 and assert `|Δ camPos| < ε`);
  - Shift-pan direction;
  - every mode yields finite poses over 10 s.
- **Framing test for D11 (Phase D, but the harness is ready):** at least 90% of sampled segment endpoints are inside the frustum after 5 s of growth for modes 0 and 6–8.

### 5.6 Music emphasis and pacing credits (v0.17.2)

- `core/pacing.ts` holds core behaviour, not an optional feature:
  - `allowance(rate, dtc)`: fractional credit capped at 64, dt clamped to 0.05, `rate<=0` → ∞;
  - `settle(spent)`: the settlement from the `const _=e.active.size===0` insert.

  `GrowthModel.grow` uses it instead of `Math.max(1, fillRate*dt)`. The v15 throttle (2371–2372) is removed; keep it only in a `legacyPacing` flag used by the parity baseline so Phase B fingerprints stay comparable.
- `musicAmount` is a core control in group "Music", applied as a factor in `GrowthModel.grow`'s rate expression (2381–2382). The v17.2 default changes (`sustain` 1.5→0.25, `fillRate` 1500→300) are control-default edits in `coreControls.ts`. They land in the S4 PR, and the fingerprint baseline is updated once, as the only intentional core-behaviour change of Phase C.
- `features/emphasis/EmphasisFeature.ts`:
  - `level(seg)` = `1 - focus·.8 + focus·1.15·fresh`, with fresh = 0 for `referenceAuto`;
  - `segmentColor` multiplies `inout` by that level (replaces the `plant.color` swap);
  - `preDraw` does an 800-segment round-robin sweep (a cursor over `world.segs`);
  - `decorateTip` handles include rules, min screen size `clamp(.06,.5, dist·.0025)`, cyan lerp, and `depthTest=false`/`renderOrder=10` when focus > 0;
  - it provides `EmphasisService`.
- **Controls:** group "Music": `musicFocus`, `musicTrail`. `videoBuildPace` lives in Reference.
- **Tests:** port test-music-focus.cjs cases: 5 starts/s ±1 at 30/60/120 fps, stall bound, fresh/old/background separation.

### 5.7 Screen bounce (v0.18.0)

- **Where it goes:** `features/stage/ScreenBounce.ts`, which has `beforeDraw` and `afterDraw` only.
  - `beforeDraw` gets bounds from `framing.screenBounds(camera, t)`: 4 Hz, smoothed, with providers for segments, reference, shell and soft. It advances x/y with `reflect.ts` `reflectedStep` (a modulo triangle wave), scales and translates `projectionMatrix`, and returns the original.
  - `afterDraw` restores the matrix and its inverse. RenderRig guarantees `afterDraw` in a `finally`.
- **Controls:** group "Screen": `screenBounce`, `bounceSpeed`, `bounceSize`.
- **Tests:** long reflection sequences, speed 0 preserves position, restore on render throw.

### 5.8 Simple mode, looks and consolidation (v0.19.0)

- `app/looks.ts` holds the six looks as data (species names, palette, shader, values) plus the shared base recipe from `simple-ui.js`. `applyLook(ctls, look, {vary, clear})` sets everything through `ctls` so UI, presets and MIDI learn stay coherent. `surprise()` avoids repeating the previous look, and "vary" is ±12% on branch, wiggle, length and thickness.
- `sections/simpleHome.ts` holds the look grid, Growth/Detail/Audio sliders, camera select, source intents, the model picker, and source visibility/fit. It calls `api.*` only.
- `AudioInput.sensitivity` replaces `globalThis.__growthAudioSensitivity`. The threshold formula from patch_consolidation (`median*(2.55-1.45s)+.0015`, gap `.18-.1s`, energy gate `.055-.025s`) goes into `inputAudio.ts:399–405`. Keep v15 constants when `sensitivity` is undefined, so the other engines are unchanged.
- Advanced/Simple toggle: the `body.simple-ui` class plus `localStorage['growth-ui-mode']`. The first-run key `growth-good-start-v0190` is kept (Phase D may bump it to `…-v0200` alongside new defaults).
- Random mix: `random:false` / `randomMax` on the control defs replace `NO_RANDOM` / `RANDOM_CAP` in main.ts (463–471). "Random mix" and "Surprise" both route to `surprise()` as in v19; the legacy full random stays reachable in Advanced.

### 5.9 Input, keyboard and panel hygiene (v0.15.1)

- `inputs/inputAudio.ts`: `inputRequest` generations, `beginInputRequest()`, a stale-decode/permission discard, speaker-only disconnect (`outConnected`), `onended` identity checks and cleanup on setup failure (from `audio-methods.js`). In `inputsUi.ts`, choosing "Audio file" while a mic/tab is live calls `audio.stop()` first.
- `inputs/inputMidi.ts`: release on `visibilitychange` (hidden), and ignore contenteditable/form targets.
- `app/keys.ts`: ignore composition, `defaultPrevented`, Ctrl/Cmd/Alt, and repeats except arrows. **Tab → focus navigation, F2 → toggle UI**, Escape restores. `inert` on the hidden panel. A "Show controls" button.
- `app/panel/search.ts` (interface.js): search sections, restore open state, ignore toggle persistence while searching, re-filter on engine control re-render. It subscribes to a `panel:rendered` event, not a MutationObserver.
- `presetsUi.ts` and `settings.ts` catch storage errors and report "session only".
- `launch.py` and launchers go into `scripts/release.mjs` output (release manager).

### 5.10 Recording (v0.17.0, v0.18.0)

This is not engine code, but it has to fit.
- `output/recorder/webcodecs.ts` is the v15 path (H.264 High + AAC, `fastStart:'in-memory'`, even dimensions, CFR timestamps from the frame counter). It is the default for "Editor MP4" because it is the only path verified with ffprobe to open in Quick Look, QuickTime, VLC and Resolve.
- `audioConform.ts` configures `AudioEncoder` from the **first** `AudioData` (channels and rate), or converts to 2 channels at 48 kHz (copyTo per plane; mono duplicated; >2 downmixed). This removes the reason v17 dropped WebCodecs (D13).
- `mediaRecorder.ts` is the v17/v18 `recorder-native.js`: explicit codec list, strict mode, clone-owned tracks. It is the fallback when WebCodecs or the muxer is unavailable (Firefox/Safari), and the "WebM" choice.
- `recordUi.ts` (recording-ui.js):
  - audio bus: Input only (`AudioInput.recordStream()`, a cached `MediaStreamDestination` on the analyser) or Full mix;
  - resolution 1080 / 1440 / current (real render pixel ratio, ≤ 3840 wide, ≤ 4×);
  - fps 60/30; quality 12/24/40 Mbps;
  - control disabling, a cancellable countdown, the pattern-switch block, and quality restore on stop/error;
  - "Editor MP4 settings" and "Recording report".

  Engine touchpoints: `RenderRig.captureLock(ratio)` / `release()`. This replaces the UI setting `te.pixelNow` and `te.lockQuality` directly.
- **Tests:** mime selection, strict rejection, track ownership (port test-recording.cjs), audio conform (mono 44.1k → stereo 48k sample counts), and an e2e 3 s capture checked with ffprobe (see 8.4).

### 5.11 Existing v15 systems converted in Phase B (so v16–v19 ports never meet the old monolith)

| Feature file | Lines moved from organism.ts | Hooks used |
|---|---|---|
| `features/shell/*` | 1020–1484, parts of 1238–1267, 2306–2333, 2540 | `placeRoot`(40), `constrainEnd`(20/30), `steerTip` (skin crawl, 1886–1890), `animate` (anim, morph, coverage), `lifecycle` (cycle), `onControl`, `stats`; provides `ShellService` (`inside`, `skin`, `nerves`, `size`) used by core bounds and life/deform (nerve pulse) |
| `features/life/wild.ts` | 2506–2524; `mutate` usage in newPlant 1541; turn changes 1787–1788 | `react`; `pickSpecies` is not needed because wild mutation stays in core via the control |
| `features/life/deform.ts` | 2075–2137 | `animate` |
| `features/life/seasons.ts` | 2140–2183 | `animate`; provides `seasonF` (speed/decay/leaf) through `ctx.env.season` |
| `features/life/nested.ts` | 2751–2773 | `onPlantReleased` |
| `features/life/cycle.ts` | 2335–2353, 1499–1506 | `lifecycle`; sets `world.reversing` |
| `features/life/typography.ts` | 2186–2268 | `animate` (chord mode); public `growText` delegated by the orchestrator |
| `features/stems.ts` | 1513–1517 | `pickSpecies` |
| `features/tips/TipRenderer.ts` | 2547–2569 | `tips` |
| `features/reference/*` (v15 behaviour first) | 904–1014, 1600–1608, 1675–1678, 1885, 1961–1966 | as in 5.1 |

---

## 6. Migration plan: every step leaves a working app

The work runs on a branch from `v0.15.0` in `growth-midi-visualiser`. Each step is one PR: `tsc --noEmit`, vitest, the fingerprint test and the e2e smoke must pass, and the single-file HTML must be built and opened.

### Phase A: safety net (about 2–3 days, 1 engineer; no behaviour change)

- **A0: tooling.** Add `vitest`, `happy-dom` and `@playwright/test` as devDependencies, and `test` / `test:e2e` scripts. Keep `build` as it is.
- **A1: seedable RNG.** Add `model/rng.ts` (mulberry32 plus `setSeed`; default delegates to `Math.random`). Mechanically replace `Math.random()` and `rnd()` inside organism.ts (62 call sites) with `rng()`. Other engines are untouched.
- **A2: injectable renderer.** `new OrganismEngine({ rendererFactory? })`, defaulting to the current `WebGPURenderer` construction (579–580). The test factory is a stub with `init`, `setPixelRatio`, `setSize`, `render`, `dispose` and `shadowMap`, and `PostProcessing` is disabled (`bloom` 0).
- **A3: headless harness and fingerprint.** `test/harness/sim.ts` mounts into a happy-dom div and runs a scripted `MusicState` at fixed `dt=1/60` with seed 1:
  - 3 held notes for 2 s;
  - an arpeggio;
  - audio-like onsets every 0.5 s (channel 2–5 pseudo-notes);
  - silence for decay;
  - 12 s in total.

  The fingerprint is: `segs.length`, `plants.length`, rounded Σ of segment endpoints, `camPos`/`camLook` to 1e-4, the instance-matrix checksum of `segMesh`, and `stats()`. It is stored as a vitest snapshot, with separate snapshots for these profiles: default; shell sphere contain; skin; tunnel camera; physics + wild; reference with a synthetic 64×64 gradient field.
- **A4: controls snapshot.** Snapshot key, label, min, max, step, value, options and group for all 97 organism controls (73 + 24 `sp:`). Presets depend on these.
- **A5: e2e smoke.** Playwright against `vite preview`:
  - Chromium with WebGPU (`--enable-unsafe-webgpu`; headed CI runner or local);
  - Chromium forced to WebGL2 (no `navigator.gpu`: `addInitScript(() => delete navigator.gpu)` with `--use-angle=swiftshader`);
  - Firefox (WebGL2).

  The script pushes notes through `window.__viz.clock.push(...)` (main.ts:1159–1173) and asserts: no console errors; `engine.stats()` shows segments > 0; the canvas centre region is not all black (`readPixels` after `snapshot(1)`); key toggles work. It also opens `dist/growth-visualiser-v*.html` over `file://` to check the offline single-file build.

### Phase B: extraction with bit-identical fingerprints (about 6–9 engineer-days; 1 engineer, or 2 pairing)

| Step | What | Parity check |
|---|---|---|
| B1 | `controls/ControlSet.ts`, `groups.ts`, `coreControls.ts`. `ctl()` accepts a ControlSet. The hottest reads (`nodes` in writeSeg, nextDir's 6 keys, fieldZ) move to handles. Group on defs; delete the GROUP map (keep `GROUP_LABEL` for 'Video'→'Reference'). | controls snapshot (groups unchanged for v15 keys), fingerprint |
| B2 | `model/*`: types, species (registry + rigid), chords, mutate; `smoothNormals` → shell/geometry. `organism.ts` re-exports `SPECIES` and `chordName`. | fingerprint, species index snapshot |
| B3 | `core/OrganismContext.ts`, `core/FeatureHost.ts`, empty `features.ts` pre-seeded with **stub files for every planned feature** (each `defineFeature({ id })` with no hooks). `frame()` calls `host.run(...)` at the 1.3 points. | fingerprint (hooks empty) |
| B4 | `core/SegmentMeshes.ts` (663–727, 1687–1773, 2483–2504) incl. the colour chain (empty) and `skeletonHidden` (always false). | fingerprint incl. matrix checksum |
| B5 | `core/GrowthWorld.ts` (segs, plants, byPitch, addSeg/removeSeg/makeRoom, budgetCap, maxPlantSegs). Emits `onPlantRemoved` (no subscribers yet). | fingerprint |
| B6 | `core/GrowthModel.ts` + `core/steering.ts` + `core/Envelopes.ts`. Hook call sites for placeRoot, constrainEnd, steerTip, acceptSegment, onSegmentAdded/Finished, holdsSegments and growthRate exist; the v15 inline logic is still called directly. | fingerprint |
| B7 | `render/RenderRig.ts`, `environment.ts`, `materials/MaterialService.ts` (catalogue = GROWTH_SHADERS only). | fingerprint + e2e (real renderer) |
| B8 | `camera/CameraDirector.ts` + `modes/classic.ts` + `modifiers/react.ts`, `gesture.ts` + `framing.ts`. Framing computes **exactly** the old full-scan centroid and radius (2575–2590); sampling comes in Phase D. | fingerprint incl. camPos |
| B9a | `features/shell/*` (largest move): inline shell/skin logic in GrowthModel replaced by the hook implementations with the priorities in 4.4. | fingerprints: shell contain, skin, nerves |
| B9b | `features/reference/*` with **v15 behaviour** (fieldZ with mimic spikes, no anchors). | reference fingerprint |
| B9c | `features/life/*`, `features/stems.ts`, `features/tips/TipRenderer.ts` (plain glow). | fingerprints: physics + wild, cycle, seasons |
| B10 | delete `organism.ts`; `engines/organism/index.ts` exports. `main.ts` split into `app/*`, with `ctls` change events and panel sections rendered from TS; `index.html` reduced to containers. Keyboard/HUD/URL params unchanged. | e2e: all existing element IDs present, presets load, CC learn works (synthetic `midi.onCC`) |

**Checkpoint:** tag `v0.20.0-alpha.1`, which means v0.15.0 behaviour on the new layout. Ship it to the owner as a "nothing should look different" build and confirm on the real machine. This is the one manual gate before parallel work.

### Phase C: port v0.15.1 → v0.19.0 (parallel; see section 7)

Each workstream PR ports one cluster and converts its `test-*.cjs` cases to vitest. With the new controls at neutral values, the fingerprint must equal the Phase B baseline; the only planned exception is the S4 pacing/default PR (5.6). Suggested merge order when several are ready at once: S5 input fixes → S4 pacing/emphasis → S1 reference → S3 camera → S2 soft/materials → tips → stage → S5 simple mode (needs all APIs) → S6 recording. Tag `v0.20.0-beta.1` when all are in. This should equal v0.19.0 behaviour except D4.

### Phase D: product changes (out of scope here; this layout makes each one local)

| Change | File(s) |
|---|---|
| Music-visibility defaults (D2) | `looks.ts`, `pacing.ts`, `coreControls.ts` |
| Liquid geometry (D3) | `soft/softMesh.ts` |
| Framing-aware calm camera (D11) | `camera/modifiers/calm.ts` + `framing.ts` |
| Spatial hash (D8) | `GrowthWorld.ts` + `steering.ts` |
| Dirty ranges (D9) | `SegmentMeshes.ts` |
| Sampled framing (D7) | `framing.ts` |

Each change is followed by an intentional fingerprint update.

---

## 7. Parallel porting with few merge conflicts

### 7.1 Why WP0 (Phase A + B) must come first and be done by one person

The monolith is the single hotspot: every v19 cluster touches `frame()`, `newPlant`, `startSegment`, `writeSeg`/`writeColor`, the controls literal and `index.html`. Porting in parallel against the monolith would mean every PR conflicts with every other PR. WP0 spends about 1.5 weeks of one person to turn that single hotspot into roughly 25 owned files.

### 7.2 Hotspots and how each one is removed

| Hotspot | Why it conflicts | Mitigation |
|---|---|---|
| `frame()` / orchestrator | every feature inserts here | frozen after B3; features use phases; only the core owner edits `OrganismEngine.ts` |
| controls literal (371–446) + GROUP map | every feature adds keys | per-feature `controls.ts`; `groups.ts` pre-seeded with all 16 groups in B1 |
| feature registration | every feature appends | `features.ts` pre-seeded in B3 with **all** planned features pointing at stubs; ports only fill their stub file |
| `Plant`/`Seg`/`Tip` interfaces | reference, soft and emphasis add fields | declaration merging in each feature's `ext.ts` (4.2) |
| SPECIES array | soft adds 13 | `species.soft.ts` owned by S2; registry asserts indices; rigid list untouched |
| `GROWTH_SHADERS` | materials append 10 | `dynamic.ts` + composition line pre-seeded in B7 |
| `main.ts` (1,174 lines) | every UI port | `app/*` split in B10; one file per panel section; `panel/order.ts` pre-seeded |
| `index.html` | every quick panel | containers only after B10; sections render from TS |
| `inputAudio.ts` | v15.1 generations, v17 recordStream, v19 sensitivity | one owner (S5) for all three, in that order; S6 only calls `recordStream()` |
| `version.ts`, `package.json`, `release.mjs`, README | every release | release manager only; PRs add `changes/<id>.md` fragments assembled at release |
| test snapshots (fingerprint) | every behavioural change | snapshot per profile file; features add new profiles in their own test file; only the S4 PR may update the baseline |
| `shaders.ts` `reactify`/uniforms | materials, emphasis | read-only for ports; new uniforms live in the feature's own module |

### 7.3 Workstreams, ownership and interfaces

| Stream | Owner files | Depends on (always available as no-op defaults) | Provides |
|---|---|---|---|
| S1 Reference | `inputs/referenceField.ts`, `features/reference/**`, `app/panel/sections/reference.ts` | framing (provider API), camera.fit | ReferenceService, `api.reference` |
| S2 Soft + materials | `model/species.soft.ts`, `features/soft/**`, `render/materials/dynamic*.ts`, `sections/materials.ts`, `sections/flowCamera.ts` (softOnly part) | emphasis.level, reference.fieldZ, framing provider | MaterialService.ownedFor, `api.species.selectSoft` |
| S3 Camera + stage | `camera/modes/cinematic.ts`, `camera/lock.ts`, `camera/modifiers/calm.ts`, `camera/framing.ts` (screen bounds), `features/stage/**`, `app/cameraLockButton.ts` | framing providers from S1/S2 (optional) | `api.camera`, FramingService.screenBounds |
| S4 Tips + emphasis + pacing | `features/tips/**` (shapes, uploads), `features/emphasis/**`, `core/pacing.ts`, `coreControls.ts` (musicAmount + default edits, **only S4 may edit this file in Phase C**) | none | EmphasisService, `api.tips` |
| S5 App shell + inputs | `app/**` except files owned above, `inputs/inputAudio.ts`, `inputs/inputMidi.ts`, `app/looks.ts`, `sections/simpleHome.ts` | `api.*` from all (stubs until filled) | Simple mode, search, a11y, keys |
| S6 Output | `output/recorder/**`, `app/recordUi.ts`, `RenderRig.captureLock` (pre-seeded signature in B7) | `inputs/inputAudio.recordStream()` (S5 lands this first, or stubbed) | editor-safe MP4, report |

In B3, create every `api.*` method as a stub that sets a status message such as "not ported yet". That lets S5 build the complete Simple panel on day one.

### 7.4 Rules for each PR

1. Touch only the files you own, plus your own `features/<x>/*.test.ts` and `changes/<x>.md`.
2. Never edit `OrganismEngine.ts`, `FeatureHost.ts`, `types.ts`, `groups.ts`, `features.ts` or `panel/order.ts`. If a new hook seems necessary, open a core-owner issue. The hook set in 4.4 already covers every v19 insertion.
3. With your controls at their off/neutral values, the baseline fingerprint must not change (CI enforces this).
4. The feature contract test must pass (8.3).
5. Port the matching `test-*.cjs` numeric cases. Delete the bundle-substring assertions.

---

## 8. Testing strategy

### 8.1 Pyramid

1. **Pure unit tests (vitest, node).**
   - `chordName`; `mutate` ranges; the species registry (index→name snapshot for 0–36; soft `defaultOn` false); the controls snapshot.
   - `pacing.allowance` (from test-music-focus); `reflectedStep`; `objParser`; `softFormXYZ` finiteness across all kinds and a range of `t`.
   - referenceField sampling (bilinear, inversion, portrait caps, `pickPoint` spatial distribution over a 12×12 grid, `visit` coverage); the recorder mime/strict selection; `audioConform`.
2. **Headless engine simulation (vitest + happy-dom + stub renderer + seeded RNG).**
   - Fingerprint parity per profile.
   - Invariants on every scripted run:
     - no NaN in instance matrices or colours;
     - `segs.length ≤ budgetCap`;
     - `plants` with zero segments get removed;
     - `onPlantRemoved` fires exactly once per removed plant;
     - counts of `dispose()` equal counts of created geometries and materials (a tracking wrapper around `BufferGeometry.prototype.dispose` in tests).
   - Behaviour tests:
     - lock survives reset;
     - calm isolates the camera from audio;
     - reference anchors do not alias (v17.1 regression);
     - auto-fill caps;
     - soft caps (16/frame, 64 total);
     - emphasis levels;
     - a stall does not bank credit.
3. **Feature contract test**, parameterised over `features.ts`:
   - `mount` → `clear('growth')` → `clear('all')` → `unmount` is idempotent and leaves nothing in `scene`/`group` that the feature added (diff of `scene.children` recursively);
   - control keys are unique across all features and every def has a `group` in `GROUP_ORDER`;
   - with `isActive()` false, no hook of that feature is called during a 2 s run (spy);
   - a hook that throws disables only that feature (host isolation).
4. **Browser e2e (Playwright).**
   - Matrix: Chromium WebGPU, Chromium WebGL2 fallback, Firefox WebGL2, and WebKit smoke (best-effort).
   - Scripted scenarios:
     - boot in Simple mode (after Phase C);
     - play 3 held notes for 2 s → segments ≥ threshold;
     - switch every look;
     - load a fixture PNG → Trace → segments grow inside the reference rectangle;
     - load a fixture GLB → Skin → coverage > 0;
     - lock the camera → Reset → pose unchanged (`__viz.engine.api.camera`);
     - tip shape cycle;
     - screen bounce on for 3 s → canvas non-black and no errors;
     - record 3 s.
   - Assertions use metrics (stats, pixel luminance histograms, element state), not screenshot equality, because GPUs differ. Screenshots are saved as artefacts for human review.
5. **Manual acceptance on the owner's machines**, at each Phase B/C checkpoint. This is the checklist from NOTES_FOR_CLAUDE §"Suggested acceptance pass" plus the recording check below.

### 8.2 The "optional = zero cost" invariant

The baseline fingerprint with all v16–v19 controls neutral must equal Phase B's. Feature by feature, "neutral" means:
- reference: `videoMode` 0;
- soft: species toggles off;
- emphasis: `musicFocus` 0;
- stage: `screenBounce` 0;
- tips: `tipShape` 0, size and brightness 1;
- camera: `calmCamera` 0 and modes 0–5;
- materials: shader < 22.

This single test lets six people merge in any order.

### 8.3 Performance guard

- A headless micro-benchmark measures `frame()` CPU time at 20k, 60k and 120k segments with the stub renderer (median of 300 frames). It fails CI if a PR regresses by more than 15% against `main`.
- An e2e perf probe records `hudFps` and a `performance.now()` frame-time histogram for 20 s at the "Roots" look with 8 held notes. It reports only; it does not fail, because CI GPUs vary. The owner runs the same probe on the weak laptop at checkpoints.

### 8.4 Recording verification (the recurring owner complaint)

- An e2e job records 3 s in each backend (WebCodecs MP4, MediaRecorder MP4, MediaRecorder WebM) with a mono 44.1 kHz synthetic tone as input-only audio, and runs `ffprobe -show_streams -show_format -show_entries packet=pts_time`. It asserts:
  - an audio stream is present with non-silent RMS (`ffmpeg -af volumedetect`);
  - H.264 profile High (WebCodecs), AAC;
  - even dimensions;
  - `moov` before `mdat` (parse the first atoms);
  - frame-interval standard deviation < 1 ms for WebCodecs (CFR);
  - duration within ±5%.
- This is the check that would have caught both the v15 silent-take bug and the v17 fragmented-MP4 regression.

---

## 9. Honest cons and risks

1. **WP0 is a serial bottleneck of about 1.5–2 weeks.** Nobody can port v19 features in parallel until Phases A and B land. If the owner wants v19 features back quickly, this plan is slower to first result than porting straight into the monolith, and faster only after that.
2. **Shared mutable context is not real encapsulation.** Features still mutate `world.segs`, `camera.state`, plant fields and each other's plants (reference auto-fill creates plants; emphasis recolours them). This is pragmatic modularity: files are separate but the coupling is still semantic. A bad hook can still corrupt shared state. The host's error isolation stops crashes, not wrong behaviour.
3. **Phase order is a hidden contract.** v19 depends on subtle ordering: reference update before note events; the soft update after the camera (inside draw); the emphasis sweep after the tips. The fixed `frame()` order and hook `order` numbers make this explicit, but a wrong `order` value is an easy, silent bug. The fingerprint profiles catch some cases, not all. D4 is a deliberate ordering change that someone could still dispute.
4. **Hooks add indirection on hot paths.** `segmentColor`, `steerTip`, `constrainEnd` and `acceptSegment` run per segment or tip. Compiled direct references keep the cost small, but a feature author can still write an expensive hook such as reference `fieldZ` (5 samples per projection). This architecture does not fix per-segment CPU costs; D6–D10 are separate work.
5. **Declaration merging spreads the entity shape across files.** It is harder to see a Plant's full shape, and lazily added fields can make V8 object shapes polymorphic at 60k+ segments. This needs measuring; the fallback is an `initFields` hook, which is centralised again.
6. **Legacy indices are frozen for good:** species 0–36, `camMode` 0–8, shader 0–31 and `sp:<index>` keys. That is a permanent constraint on reordering the panel's option lists. Migrating to string ids would need a preset migration, which this plan deliberately does not do.
7. **Porting from minified patches carries interpretation risk.** Parts of v19 exist only as inline string replacements, e.g. the tip-glow edits and the calm-camera expressions. Mapping them back to TS lines, as in 1.2, is careful work but still inference. v16–v19 were never rendered, so a faithful port can faithfully reproduce bugs. The e2e scenarios are the first time these features will be seen working.
8. **It does not by itself deliver the "10× better" product.** Music visibility (D2), the liquid look (D3), camera framing (D11) and scale (D7–D9) are Phase D changes. The architecture makes them local and testable, but the owner will not notice anything from Phases A–B beyond "nothing broke". That is the point, and it is also a real cost.
9. **Headless fidelity is limited.** The stub renderer tests CPU logic. TSL/WebGPU shader compilation, bloom, WebGL2 fallback differences and GPU memory only appear in Playwright on real GPUs, and CI GPUs are unreliable. There will be manual checkpoints.
10. **Not a path to GPU-side growth.** If Growth later moves simulation to compute shaders (storage buffers, GPU instancing without CPU `writeSeg`), `GrowthWorld`/`SegmentMeshes` would be rewritten. Features built on per-segment CPU hooks (anchors, colour modifiers) would need GPU equivalents. This design optimises for porting v19 safely, not for that future.
11. **Service no-op defaults can hide missing wiring.** A stream can "work" against a no-op emphasis or reference service and then misbehave once the real one lands. The mitigation is an integration profile per service pair in the fingerprint suite (soft + emphasis, reference + soft, stage + reference). Someone has to remember to add them.

---

## 10. Appendix: minified anchor ↔ TS location (for porters)

| Minified anchor (v19 bundle / patch script) | TS v0.15.0 location |
|---|---|
| `this.lastG=t,this.lastGTime=e.time;` | organism.ts:2276–2277 |
| `let x=g>0?Math.max(1,g*s):1/0;` | 2375 |
| `m=1-.7*Math.min(1,Math.max(0,(p-.6)/.35))` | 2372 |
| `const ge=r*m*this.seasonF.speed` | 2381–2382 |
| `const _=e.active.size===0;` | 2426 |
| `let ne=c*2.2;const Pe=t.decay*this.seasonF.decay;` | 2449–2450 |
| `if(c.dir0&&(T.x+=Be()*6),this.skin&&!r.root)` | 1609–1610 |
| `G(this.controls,"camMode")>0&&G(this.controls,"growAtCam")>0?T.multiplyScalar` | 1594–1596 |
| `this.center.lerp(Lr,1-Math.exp(-s*.8));` | 2588 |
| `let ab=this.shell?G(this.controls,"shellSize")**2*.6:4;if(Ls!==2)` | 2589–2590 |
| `const Pl=Math.sqrt(ab),C5=1+.03*e.energy+.05*e.onset,xa=` | 2591–2593 |
| `const ge=this.theta+this.manTheta+t.rotNow*.5+Math.sin(n*.37)*.04,ne=…` | 2600–2601 |
| `else this.theta+=s*ya*.3,xa.copy(this.center)` | 2665–2668 |
| `this.repel=null;const Gd=this.gesture;` | 2683–2684 |
| `const q=G(this.controls,"react"),ge=G(this.controls,"kick")*q,ne=G(this.controls,"shake")*q;` | 2676–2678 |
| `this.camera.lookAt(this.camLook);const Tu=` | 2702–2704 |
| `(Ls===0?.55/(this.camPos.distanceTo(this.center)+Pl+4):.05)` | 2712 |
| `q.sp.glow<=0` / `Pe=ge.r*(1.5+.8*e.onset)*Dt*q.sp.glow` / `.multiplyScalar(1.6).addScalar(.35)` / `if(Hs>=XC)break;` | 2552 / 2556 / 2562 / 2554 |
| `const Dt=G(this.controls,"glow");` | 2548 |
| `draw(){if(this.canvas.width<2` | 871–872 |
| `if(this.dragBtn<0)return;` / `"pointerdown",l=>{if(!(l.button` / `"wheel",l=>{this.zoomMul` | 624 / 611–612 / 642–643 |
| `if(this.dragX=l.clientX,this.dragY=l.clientY,this.dragBtn===1)` / `f=this.dist*.0012;…addScaledVector(Pa,u*f)` / `o.addEventListener("pointercancel",a),` | 627–629 / 635–636 / 641 |
| `this.field&&(this.field.update(n),this.videoOn&&!this.backdrop&&…rebuildBackdrop())` | 2536–2539 |
| `label:e.name,icon:e.icon,min:0,max:1,step:1,value:1` | 373 |
| `l.group=l.key.startsWith("sp:")?"Species":CK[l.key]??"More"` | 571 (D1) |
| `{key:"camMode",label:"camera",min:0,max:5,…}` | 403 |
| `{key:"glow",label:"tip glow",…},{key:"budget",` | 414–415 |
| `min:0,max:10,step:.1,value:1.5},{key:"fillRate"` / `min:0,max:8e3,step:100,value:1500` | 398–399 |
| `recordStream(){return Gw()}` | inputAudio.ts:100–102 (returns the shared full-mix `recordingStream()`) |
| `const x=[...this.fluxHist].sort(...),T=(x[x.length>>1]??0)*1.9+.001;…t-this.lastOnsetT>.12&&this.features.energy>.04` | inputAudio.ts:399–405 |
| `async function Fm(i){var t;if(tT)return;` | main.ts:245–246 |
| `class aJ{` … `const LM=` | videoField.ts (whole class) → `inputs/referenceField.ts` |
| `class rZ{` … `function oZ(` | recorder.ts `Recorder` → `output/recorder/*` |
| `async function Vw(){` … `Y("recMode").value=` | main.ts:788–831 → `app/recordUi.ts` |
| `Zt` / `te` / `Fm` / `Im` / `M5` / `vs` / `Y` / `js` / `xn` / `je` / `Hi` / `IK` / `pd` / `_u` / `l5` / `LM` | `ctls` / `engine` / `selectEngine` / `setPalette` / `resetEngine` / `setStatus` / `$` / `SPECIES` / `videoField` / `audio` / `save` / `savePreset` / `setUiHidden` / `setMode` / `widget` / `VERSION` |
