# K1: Visual and musical design review for Growth v0.20

Role: visual and musical design critic. Scope: make the organism an obviously musical 3D visualiser with complex growth systems. It must stay organic, non-kaleidoscopic, optional via toggles and light enough for a weak laptop.

Sources read:
- TS source (v0.15.0): `src/midi/engines/organism.ts` (all 2790 lines), `src/midi/shaders.ts`, `src/midi/music.ts`, `src/midi/beat.ts`, `src/midi/color.ts`, `src/midi/engine.ts`, and the loop/global modulation in `src/midi/main.ts` (lines 1041-1103).
- v19 modules: `maintenance/soft-growth.js`, `soft-species-extra.js`, `dynamic-materials.js`, `dynamic-material-runtime.js`, `music-focus.js`, `calm-camera.js`, `cinematic-camera.js`, `stage-motion.js`, `tip-shapes.js`, `simple-ui.js`, `patch_music_focus.py`.
- Handoff notes `NOTES_FOR_CLAUDE.md`, `NOTES_V0160/0173/0180.md`, and anchors in the minified bundle `assets/index-BWYXfAkm.js`.

Line references without a path are `organism.ts` in the TS source, e.g. "L2382".

---

## 0. Diagnosis: why v19 does not read as a music visualiser

The ideas below target specific mechanisms. The live observation (3 held notes × 2 s ≈ 300 segments, locked camera, faceted Liquid, Silk out of frame) has these causes.

### 0.1 Every reaction is global, and the note you play has no signature of its own
- **Swell** is one uniform, `uPulse` (`shaders.ts:48,59`), added along `normalLocal` *after* instancing (three's `NodeMaterial.setupPosition` runs the instancing node before `positionNode`). It is therefore a constant **world-unit** offset on every segment, old and new, of every pitch. The result reads as one global throb, not "that note did that". Thin twigs balloon while trunks barely change.
- **Flash** is one uniform too, `uFlash` (`shaders.ts:60-61`): `emissive = diffuseColor * uFlash` on everything.
- **Point light**: there is one, placed at the organism centre and coloured by `m.rootPc` (L2715-2719).
- **Tip glow** scales every held tip by the global `m.onset` (L2556).
- **Result:** the only causal signal per note is new geometry appearing. The v19 pacing limits that heavily (next point).

### 0.2 The v19 "calm" defaults dampen what signal remains
`simple-ui.js:21-25` base values: `pulse .15, flash .08, bloom .35, musicAmount .42, fillRate 240, sustain .2`, camera `still` and locked. For comparison the TS defaults were `pulse .6 / flash .6 / kick .5`.
- `uFlash = 2.5 × 0.08 × (0.35·hit + 0.15·bass) ≤ 0.10` emissive. That is invisible, especially with no tone mapping and bloom threshold 0.6 (`ensureBloom`, L861).
- `fillRate 240` is a **global** per-second quota shared by every tip of every note. The v19 anchor is `let x=this.segmentAllowance(g,s)` (`patch_music_focus.py:40`, `music-focus.js:18-23`). Credit is capped at 64 and there is no minimum of one per frame. A chord of four notes, each with 2-3 tips, therefore shares 240 segments/s. A new note can wait in the quota (`if(x<=0)continue`) before its first segment even starts, so **note-on latency is not guaranteed**.
- `musicAmount .42` multiplies the per-tip speed (anchor `const ge=G(this.controls,"musicAmount")*r*...`).
- In MIDI mode `energy` decays while a key is held: `env = velocity·exp(-held·0.35)` (`music.ts:484`). Held chords lose reaction strength over time, and growth speed uses `(0.75 + 0.5·energy)` (L2382).

### 0.3 The camera cannot frame the action in the default mode
- With `cameraLockPose` set, the whole camera block is skipped (bundle anchor `if(!this.cameraLockPose){const ya=G(this.controls,"orbit")...`). Still mode has no framing at all.
- Calm camera also sets fog to 0.002 (`NOTES_FOR_CLAUDE.md`), which removes the depth cue that separates foreground from background in black space.
- Orbit framing, where used, runs over **all** segments twice per frame (centroid L2576-2582, farthest point L2590). A single outlier sets the distance, and the cost is O(n) per frame.

### 0.4 Pitch is weakly legible
- **Colour.** Colour is the main pitch channel: `noteRgb(g.palette, pitch, …)` at L1545. The curated looks choose palettes with little or no pitch spread. Roots uses palette 4 "forest" (`pitchSpread 0.5`, small `b` amplitude, `color.ts:135`). Crystal and Silk use palette 5 "mono" with **`pitchSpread 0`** (`color.ts:136`), so in those looks pitch has no effect on colour at all.
- **Species.** Each look enables exactly one species (`simpleSpecies([...])`), so every note is the same shape.
- **Position.** Root placement uses the pitch-class angle only on the non-graft path (L1591). With `cohesion .35`, about 30% of notes graft onto a **uniformly random** finished segment (L1586-1589), which erases pitch→space.

### 0.5 Soft species are low quality by construction
- **Liquid faceting.** `soft-growth.js:32` uses `new kp(1,2)`; `kp` is `IcosahedronGeometry` (verified in the bundle: `class kp extends Wx`, the PolyhedronGeometry). PolyhedronGeometry is **non-indexed**, so `computeVertexNormals()` (`soft-growth.js:72`) returns per-face normals. That is the flat, faceted "low-poly blob". Detail 2 is also only 320 triangles.
- **Liquid ignores the skeleton.** The mesh is a single blob at `plant.root` scaled by `sqrt(total length)` (`soft-growth.js:41-52`). The plant's segments are hidden (`softWrite` forces `growth=0`, lines 81-88).
- **Silk goes out of frame.** Silk is a `PlaneGeometry(1,1,24,16)` swept **straight up +Y** from the root to `size·2 ≤ 16` world units (`soft-growth.js:53-57`), regardless of where the skeleton grew. With a still camera about 14 units away it leaves the frame.
- **Cost.** All thirteen soft forms deform on the CPU at 30 Hz and recompute normals at 15 Hz (`soft-growth.js:40,72`).

### 0.6 Performance headroom is wasted
This matters because every visual idea below needs GPU and CPU budget.
- **Full-buffer uploads.** `writeSeg` (L1717-1773) sets `needsUpdate = true` on **all seven** instance-matrix buffers for any single segment change. At cap 60k that is about 60k × 64 B × 6 meshes ≈ 23 MB re-uploaded per frame whenever anything grows. `writeColor` (L1687-1701) does the same for six colour buffers.
- **v19 colour sweep.** `refreshMusicFocus` (`music-focus.js:31-37`) re-writes 800 colours per frame, which again marks all colour buffers dirty.
- **Node spheres dominate vertex cost.** Every segment writes a sphere node (Icosahedron detail 1 = 80 triangles, L677), plus zero-scaled instances in the sibling meshes. That is about 5× the tube's 14 triangles.
- **CPU per-frame loops.** The nerves pulse (L2125-2134) and wild sway (L2081-2089) rewrite up to 25k matrices per frame on the CPU.
- **Fusion search.** `nearestEndpoint` (L1895-1911) scans all segments for every tip on every new segment.

---

## 1. Ideas

Each idea lists impact (1-10), effort (S/M/L/XL), the user-visible result, the technical design with code locations, risks, and how it stays optional and light.

---

### Idea 1: Conduction and Resonance, a per-segment GPU attribute layer
**Impact 10 · Effort M**

**User-visible result:**
- Every note-on sends a **pulse of light travelling from the root to the tips** of that note's growth, like bioluminescent sap.
- Replaying a pitch class later **re-lights all older growth of that pitch class**, and faintly its fifth and fourth. The organism becomes a harmonic memory map: play C, and every C structure in the scene answers.
- Each beat sends a faint global wave through everything.
- Fresh growth glows hot and cools as it ages into bark.
- Loud notes are brighter and thicker.

This single feature makes "music → growth" causal and obvious without moving the camera.

**Technical design:**
1. **Per-instance data**, written once per segment and never per frame:
   - `aSeg` (vec4): arc distance from the plant root, birth time (seconds since mount), MIDI pitch, velocity.
   - `aSeg2` (vec4): base radius, plant hash, depth fraction (`tip.depth / sp.maxDepth`), flags (fused, text, auto).
   - Allocate both in `buildMeshes` (L663-701) as `THREE.InstancedBufferAttribute(new Float32Array(cap*4), 4)`. Call `geometry.setAttribute('aSeg', attr)` on **all six** segment/node/leaf geometries. They share the index space `seg.idx`, so one attribute object serves all of them, and a single shared material (`applyShaders` L794) keeps working.
   - Arc distance: add `dist: number` to `Tip` (L208). The segment start distance is `tip.dist`. `finishSegment` (L2023) does `tip.dist += len`, and branch spawns copy `tip.dist` (L2058, L2418, L2520).
   - Write the attribute in `addSeg` (L1670-1685) and re-write it on the swap in `removeSeg` (L1703-1714). Mark only the touched range (see Idea 13).
   - `growCapacity` (L704-714) already re-writes every segment and must also re-write `aSeg`.
2. **Uniforms**, in `shaders.ts` next to `uPulse` and `uFlash`:
   - `uT`: engine time. Use `m.time - t0`, not TSL `time`, so it matches CPU birth times.
   - `uPcHitT = uniformArray(Array(12).fill(-1e3))` and `uPcHitV = uniformArray(Array(12).fill(0))`, set in the `m.events` loop (L2292).
   - `uBeatT`: last `beat.hit` rising edge.
   - Gains: `uWaveGain`, `uResGain`, `uFreshGain`, `uWaveSpeed`, `uWaveWidth`.
3. **Shader.** Extend `reactify` (`shaders.ts:56-63`) so it applies to the base material and to every `GROWTH_SHADERS` / dynamic material through the same `reactify` call (L788 / `dynamic-material-runtime.js:24`):
   ```ts
   const a = attribute('aSeg', 'vec4'), b = attribute('aSeg2', 'vec4')
   const pc = mod(a.z, 12)
   const dtHit = uT.sub(uPcHitT.element(int(pc)))
   const head = dtHit.mul(uWaveSpeed)
   const wave = exp(a.x.sub(head).pow(2).negate().div(uWaveWidth)).mul(exp(dtHit.mul(-0.8))).mul(uPcHitV.element(int(pc)))
   const res  = exp(dtHit.mul(-2.5)).mul(uResGain)                                    // whole-structure answer
            .add(exp(uT.sub(uPcHitT.element(int(mod(pc.add(7),12)))).mul(-3)).mul(uResGain.mul(0.35)))
   const beatW = exp(a.x.sub(uT.sub(uBeatT).mul(uWaveSpeed)).pow(2).negate().div(uWaveWidth)).mul(0.25)
   const fresh = exp(uT.sub(a.y).mul(-0.9))                                           // hot newborn growth
   const glow  = wave.mul(uWaveGain).add(res).add(beatW).add(fresh.mul(uFreshGain)).mul(a.w.mul(0.7).add(0.3))
   emissive += diffuseColor.rgb.mul(glow).mul(b.z.mul(0.6).add(0.4))                  // tips glow more than trunks
   position += normalLocal.mul(wave.mul(uWaveSwell).mul(b.x))                          // swell is local and radius-relative
   ```
   The swell becomes **local** (it rides the wave) and **radius-relative** (`b.x`), replacing the global `uPulse` throb. Keep `uPulse` as a small global bass term.
4. **Remove CPU work this replaces:**
   - `refreshMusicFocus` / the `focusLevel` colour sweep (`music-focus.js:24-50`). Fresh vs old becomes `fresh` in the shader, and "dim old" becomes `emissive/colour × mix(1-focus·0.6, 1, fresh)`.
   - The CPU nerves pulse (L2125-2134) becomes the same wave with `uWaveSpeed` taken from energy.
5. **Mycelium extension.** When `fuse` happens (L1913), give the fused plant a `distOffset` so its new segments continue the host's arc distance. Waves then cross from one plant into the next, like signals through a network. Effort +S.

**Risks:**
- `attribute()` on an `InstancedBufferAttribute` in three r185 WebGPU and WebGL2 needs a quick verification. The fallback is `instancedBufferAttribute(attr)` per mesh, which then needs per-mesh material clones (six materials; acceptable).
- Dynamic indexing of a 12-element uniform array is legal in WGSL and GLSL ES 3.0.
- Float32 time precision is fine for hours when relative to mount.
- Bloom must be on for the waves to *glow* (Idea 6), though they are visible without it.

**Optional / light:**
- Panel controls under React: `conduct` (wave gain), `resonance`, `fresh glow`, `wave speed`.
- The shader cost is two `exp` calls and three uniform lookups per vertex/fragment, which is negligible.
- It **reduces** CPU load: it deletes an 800-colour-per-frame sweep and a 25k-matrix nerves loop.

---

### Idea 2: Note-on "Ignition", an immediate event language with ADSR growth envelopes
**Impact 10 · Effort S-M**

**User-visible result:**
- Within one frame of a key press you see:
  1. a seed flare at the root (a soft additive star whose size follows velocity),
  2. a thin shock ring expanding in the plant's plane,
  3. a lunge: the first segments shoot out 3-4× faster, then settle to a slower creep (the note's sustain).
- On release, the tip seals with a bud. Short (staccato) notes leave small spores; long notes leave buds that open into petals (see Idea 10).
- Rhythm and articulation become readable in the structure itself.

**Technical design:**
1. **Guaranteed first segment.** In the growth loop (L2383-2388; bundle `if(!ne.seg){if(x<=0)continue;x--,...}`), bypass the `fillRate` / `musicCredit` quota for tips of plants younger than 80 ms or with `tip.depth < 2`. This caps extra cost at about 3 segments per note.
2. **Growth ADSR** replaces the flat `rate` (L2381-2382). Per plant:
   ```ts
   const age = t - p.birth
   const env = p.held || p.autoUntil > t
     ? sustainLvl + (attackBoost - sustainLvl) * Math.exp(-age / attackTime)   // A+D
     : 1                                                                   // R handled by retract
   rate *= env * (0.6 + 0.8 * p.velocity)
   ```
   - Defaults: `attackBoost 3.5`, `attackTime 0.25 s`, `sustainLvl 0.8`.
   - This uses the **note's own** envelope instead of the global `m.energy`, fixing the `music.ts:484` decay coupling.
   - Keep `fillRate` as a safety ceiling but make it **per note**: `budget_p = fillRate·dt·(0.4+0.6·velocity)/sqrt(liveNotes)`. Polyphony then no longer starves each note.
3. **Flares.** Add one `InstancedMesh(PlaneGeometry, MeshBasicNodeMaterial)` in `buildMeshes`:
   - additive, `toneMapped:false`, `depthWrite:false`, 96 instances;
   - radial falloff `pow(1-2·length(uv-.5), 2)`;
   - billboarded like `orientTip` (`tip-shapes.js:43-46`, copies the camera quaternion).
   - A tiny CPU list `{pos, color, t0, life, size, kind}` is updated each frame (at most 96 matrices, trivial).
   - Emitters:
     - `newPlant` (L1654, next to `onEvent('spawn')`): seed flare.
     - `fuse` (L1917, `onEvent('fuse')`): spark at `other.b`.
     - `release` (L2739): bud flash.
     - Section drops (Idea 8).
4. **Shock ring:** a second 32-instance mesh using `RingGeometry(0.9,1,48)`, oriented to `p.n` (planar species) or the camera. Scale over 0.35 s from 0 to `2·segLen·(1+2v)` while alpha fades.
5. **Tip glow per note.** Scale the glow by `p.velocity` and the plant's own attack envelope (L2556) instead of the global `m.onset`.

**Risks:**
- Too many flares with dense audio pseudo-notes. Mitigate by throttling to at most 24 flares per second and merging flares closer than `segLen`.
- The ring can look like UI chrome. Keep it faint and thin, or make it optional.

**Optional / light:**
- Controls: `ignite` (flare and ring amount), `attack lunge`, `attack time`.
- About two draw calls, at most 128 instances.

---

### Idea 3: Auto-framing and a musical camera director
**Impact 9 · Effort M**

**User-visible result:**
- The action is always in frame. The camera frames recent growth, the bounding volume of the last few seconds, with some context around it.
- In "Director" mode it changes shots on bars: wide establishing view, medium on the newest cluster, a slow close-up tracking a live tip, a low hero angle. Busy passages cut every 2 bars, calm ones every 8. Silence gives a slow wide drift.
- "Still" becomes **Still + fit**: the angle stays fixed, and only a slow dolly keeps the growth in frame. This fixes Silk leaving the frame.

**Technical design:**
1. **Incremental bounds instead of O(n) loops** (replaces L2576-2591 and the bundle equivalent):
   - `addSeg` (L1670) pushes `b` into a ring buffer of the last 512 endpoints with birth times.
   - Keep a running global AABB, expanded on add and rebuilt lazily every 2 s by stride-sampling.
   - Focus sphere: centre = recency-weighted mean of the ring; radius = 85th-percentile distance, which ignores outliers.
   - Soft meshes contribute their bounds. `stage-motion.js:27` already computes them for screen bounce; reuse that.
2. **Fit distance.** `d = r / sin(fovY/2) × margin`, with `fovY` using `min(fovY, fovX)` for portrait. Ease with a critically damped spring (`dist += (target-dist)·(1-exp(-dt·1.5))`).
   - For Still + fit, apply only `dist` along the locked view direction, keeping the direction of `cameraLockPose` (`music-focus.js:5-17`).
   - Frame the focus with a slight rule-of-thirds bias: offset `camLook` by `-0.12·r` along camera-right when the action drifts to one side.
3. **Director state machine** (a new `camMode`, and the default in Simple "Stage" mode):
   - Shots: `WIDE` (global AABB, orbit 0.05 rad/s), `FOCUS` (focus sphere, 0.6× distance), `DETAIL` (newest held plant's leading tip, distance `3+2·segLen`, like chase L2649-2664), `LOW` (focus sphere from elevation -0.35).
   - Cut policy: only on `m.beat.barHit > 0.9 && beat.confidence > 0.4` (the existing field, `beat.ts:113`). Minimum shot length is `lerp(8, 2, energyLong)` bars.
   - Without tempo: cut on an onset > 0.7 after at least 4 s.
   - Section events (Idea 8) force `WIDE` on a drop.
   - Calm variant: eased 0.8 s transitions, never hard cuts, no `kick` or `shake`.
   - Choose the next shot by weighted random, never repeating, and biased to `DETAIL` when a single note is held for a long time (the melody case).
4. **Collision.** In `DETAIL`/`LOW`, keep the near plane at 0.4 (as in fly modes, L2285) to avoid clipping into thick trunks.

**Risks:**
- Hard cuts in recordings can be unwanted, so keep a "cuts: hard / soft / none" option.
- Beat confidence is weak for rubato MIDI; the onset fallback covers it.

**Optional / light:**
- Director is a mode, and the existing modes and the lock remain.
- Cost is O(512) per frame, **cheaper** than today's O(n) passes.

---

### Idea 4: A "Music reaction" macro and retuned Simple looks
**Impact 9 · Effort S**

**User-visible result:**
- One slider in Simple mode, **Reaction: calm ↔ show**, defaulting to 0.65. It makes the difference between a pretty screensaver and an obvious music visualiser.
- Each look keeps its identity, but pitch always shows as colour and height.

**Technical design:**
1. **Macro mapping in `simple-ui.js`** (next to `simpleGrowth`, lines 74-77). Each target is `lerp(calm, show, x)`:

   | control | calm (x=0) | show (x=1) | source |
   |---|---|---|---|
   | pulse | .15 | .6 | L423 |
   | flash | .08 | .7 | L424 |
   | conduct / resonance (Idea 1) | .3 / .2 | 1.5 / 1 | new |
   | ignite (Idea 2) | .3 | 1 | new |
   | attack lunge | 1.5 | 4 | new |
   | musicAmount | .42 | 1.0 | v19 |
   | fillRate (per-note ceiling) | 300 | 2000 | L399 |
   | bloom | .35 | 1.0 | L428 |
   | director cut rate | none | every 2 bars | Idea 3 |
   | kick | 0 | .35 (only if not calm camera) | L425 |

2. **Colour mapping fix** in `newPlant` (L1545). Replace pure `noteRgb` with a two-axis mapping that works for every palette, including mono:
   - hue = look base hue + `(pc on circle of fifths)/12 · spread`, where `spread` is at least 0.35 even for mono and forest;
   - lightness from octave (low notes darker, high notes brighter);
   - saturation from velocity.
   Pitch is then always visible, but stays within the look's colour window, so looks do not turn into rainbow soup.
3. **Species per register, per look.** Allow a look to specify `bass / mid / treble` species, e.g. Roots = roots / vines / fungi and Coral = staghorn / corals / anemone. Use `speciesFor` (L1512), where mode 1 "by octave" already exists: set `species: 1` with 2-3 toggled species.

**Risks:** Established users' saved state. Apply only on a new first-run key (`growth-good-start-v0200`), as v19 does.

**Optional / light:** Pure parameter mapping with zero runtime cost.

---

### Idea 5: Pitch → space and harmony → structure
**Impact 8 · Effort M**

**User-visible result:**
- Bass notes root **downward** into the dark and melodies branch **upward** into a canopy.
- Notes of a chord graft onto each other and **visibly fuse** into one structure, with a spark where they join. A dissonant note sprouts apart, restless and crooked.
- Chord quality tints behaviour:
  - major: rising, smooth;
  - minor: drooping, cooler;
  - diminished: jagged;
  - augmented: spiralling;
  - sus: flattened into fans.

**Technical design:**
1. **Layout control** `layout`: `organic (current) | pitch helix | circle of fifths | register strata`.
   - Replace the root placement at L1591-1593: angle = `pc·7 mod 12` (fifths) or `pc`, and height = `(oct-4)·layerGap`. Helix: `angle += oct·30°`.
   - Keep the jitter (`rnd()*0.6`) and the random radius so it never becomes a regular ring. This preserves the non-kaleidoscope rule.
2. **Register direction.** In `nextDir` (L1863), add `out.y += (octN - 0.45)·registerLift` (default 0.25), with `octN` stored on the Plant. This is subtle per step and strong in aggregate.
3. **Harmonic grafting.** At L1583-1589 the graft host is chosen uniformly from `finished`, which also allocates an O(n) filter array on every note. Replace it with:
   - sample 24 random live or recent plants;
   - score each: `consonance(pcNew, pcHost)` (unison/octave 1, fifth/fourth .8, major/minor third .6, seconds/tritone .1) × recency;
   - pick the best, then pick a random finished segment of *that* plant.
   Chords then cluster into one organism and dissonances stand apart.
4. **Chord state every frame.** Lift `chordName` (L308-329), currently used only inside `typography` (L2186-2203), into a `harmony()` step that runs whether or not text is on. It exposes `{root, quality, tension, changedAt}`.
   - On chord change: set `joinBoost = 3` for 0.8 s for held plants. The existing attraction/fuse code (L1871-1883) then pulls chord tones together. Fusion sparks come from Idea 2.
   - Quality modifiers go into `nextDir` / `newPlant`: small deltas to gravity (±0.2), turn type for dim/aug (a per-plant override via `tip.turn`, as `wild` already does at L1788), and hue ±0.04.
   - Tension (roughness of intervals: m2, M7, tritone) → wiggle ×(1+tension) and saturation −20%.

**Risks:**
- Over-structuring can make it look diagrammatic. Keep all effects as biases with jitter, and keep "organic" as an option.
- Chord detection from audio chroma is noisy. Gate on `m.chroma` max > 0.6 and require the chord to hold for 250 ms, as typography already does.

**Optional / light:** Each part is a control (`layout`, `register lift`, `harmonic graft`, `chord fusion`). The CPU cost is lower than today's `finished` filter.

---

### Idea 6: Lighting and post for black space (tone mapping, rim, HDR glow, bloom by default, note lights, focus fog/DoF)
**Impact 8 · Effort S-M**

**User-visible result:**
- Structures read as 3D forms against black: silhouettes have a thin coloured rim, tips and pulses glow and bloom, and old growth recedes into soft darkness.
- Each playing note carries its own coloured light that illuminates its surroundings.
- Optional depth of field focuses on the action.

**Technical design:**
1. **Tone mapping.** In `mount` (L579-584), set `renderer.toneMapping = THREE.AgXToneMapping` (or ACES) and `toneMappingExposure = 1.1`. Emissive > 1 from Ideas 1 and 2 then rolls off gracefully instead of clipping. The bloom path through `PostProcessing` (L859-863) applies the output transform.
2. **Fresnel rim in `reactify`.** `emissive += diffuseColor.rgb × fresnel(3) × uRim × (0.35 + uTreble)`; the `fresnel` helper already exists at `shaders.ts:77`. This is the biggest win for form legibility on black.
3. **Bloom on by default**, auto-managed:
   - lower the threshold to about 0.45 so only emissive and tips bloom (`bloom(node, strength, 0.45, 0.45)`, L861);
   - drive strength from sustain (already at L876);
   - auto-quality (L2721-2734) disables bloom first when fps < 40 and restores it after 5 s at > 55.
4. **Note lights.** A pool of 3 `PointLight`s, 2 on low quality, replacing the single centre light (L2715-2719):
   - assign each to the newest held plants: position = the plant's leading-tip centroid, colour = `p.color`, intensity = `velocity·(0.4 + 1.6·exp(-age·3))`, distance ≈ 3·segLen·10;
   - when a note releases, its light fades over 0.6 s.
5. **Camera-relative key light.** Parent `dirLight` to the camera at about 35° up and to the left, and point `backLight` opposite the camera for rim light. The fixed `(5,9,6)` and `(-6,-3,-5)` directions (L590-597) leave the far side flat as the camera orbits.
6. **Focus fog / DoF.** Replace calm-camera fog 0.002 with distance-to-focus fog: `density = k / (focusDist + focusRadius)`, keeping the L2712 formula but always on.
   - Optional DoF via `three/addons/tsl/display/DepthOfFieldNode.js` (`dof(...)`), focused at the director's focus sphere (Idea 3).
   - High quality only; auto-quality drops it first.

**Risks:**
- The tone-mapping change shifts all existing looks; retune palettes once.
- Point lights cost per fragment on the forward renderer, so keep the pool small and make it scale with quality.

**Optional / light:** Every item is a control. Bloom, DoF and note lights are gated by quality tier.

---

### Idea 7: Soft species rebuilt as skeleton-following GPU sweeps
**Impact 7 · Effort M**

This fixes faceted Liquid and out-of-frame Silk.

**User-visible result:**
- Liquid becomes a smooth, glossy, peristaltic tube that flows **along the path the note actually grew**, with bulges travelling root→tip on the bass.
- Silk is a twisting ribbon that follows the growth and stays in frame.
- Kelp, manta and pleats become sheets swept along real paths.
- Normals are smooth, and there is no CPU vertex loop.

**Technical design:**
1. **Immediate hotfix** (S), even before the rebuild:
   - replace `new kp(1,2)` (`soft-growth.js:32`) with `mergeVertices(new IcosahedronGeometry(1,4))` from `BufferGeometryUtils`, or with an indexed `SphereGeometry(1,48,32)`;
   - `computeVertexNormals` then gives smooth normals;
   - set Liquid roughness to about 0.08, add the Idea 6 fresnel rim, and use a clearcoat-style specular (`MeshPhysicalNodeMaterial` with `clearcoat 1` on high quality).
2. **GPU sweep (proper fix):**
   - Each soft plant keeps a control polyline of up to 32 points (`vec4 pos+radius`), sampled from its main path. Follow the leader tip by storing a `path[]` on Plant: push `seg.b` in `finishSegment` (L2023) when `tip` is the leader, i.e. the first tip.
   - Upload these points as a per-mesh `uniformArray(32, 'vec4')` (or a 32×N DataTexture for all soft plants).
   - One shared geometry: a (u ∈ [0,1] along, v ∈ [0,2π) around) grid, 64×16.
   - Vertex shader:
     - evaluate Catmull-Rom at u;
     - build a frame from the tangent plus a reference up vector (a parallel-transport approximation);
     - cross-section by type: circle (liquid/tube), flat line with twist (ribbon/silk), wide sheet (kelp/manta);
     - radius `r(u)·(1 + wave·sin(2π(u·k − t·speed)))`, where the wave amplitude is driven by bass and by the Idea 1 conduction wave at the matching arc distance.
   - Normals come analytically from the frame, plus a finite-difference derivative of the radius term.
3. **Framing.** Soft bounds come from the control points and feed the Idea 3 focus sphere.
4. **Keep the 13 v19 soft forms** (`softFormXYZ`) as "blossom" shapes placed *at* tips (jelly bell, fan, disc) using the same GPU approach. They then decorate the skeleton instead of replacing it.

**Risks:**
- Parallel-transport flips on tight turns: clamp the curvature and smooth the control points.
- Uniform-array size limits: 32 vec4 per mesh is fine on both backends.

**Optional / light:**
- Removes the 30 Hz CPU deformation and 15 Hz `computeVertexNormals` of 16 meshes per frame (`soft-growth.js:40-72`).
- The cap of 64 soft meshes can rise to 128.

---

### Idea 8: Energy arcs → scene evolution (build, drop, breakdown)
**Impact 8 · Effort M**

**User-visible result:** Over a track the world has dramaturgy:
- During a **build-up**, growth tension rises: tips gather light, bloom thickens, the camera slowly pushes in, and colour saturates.
- On the **drop**, every held tip bursts into side shoots, a white bloom flash passes and the camera cuts wide.
- In a **breakdown or silence**, the organism breathes in slow bioluminescent waves while the camera drifts.
- **Section changes** can rotate the look (roots → coral) or shed the oldest half (the existing `shedOldest`, L1499).

**Technical design:**
1. **ArcTracker** in `music.ts`, updated in `MusicClock.tick` (after L510), exposes `m.arc = {short, long, tension, drop, breakdown, novelty, section}`:
   - `eS` (τ 0.4 s) and `eL` (τ 10 s) energy EMAs, plus density (`s.density`) and polyphony.
   - `tension`: `clamp((eS − eL)/max(.05,eL))` smoothed over 2 s while `eS` rises monotonically.
   - `drop`: an impulse when `eS > 1.8·eL` after at least 2 s with `eS < 0.6·eL`, or when the bass jumps after a low-bass stretch. Snap it to the next `barHit` if tempo is known.
   - `breakdown`: `eS < 0.4·eL` for more than 3 s.
   - `novelty`: cosine distance between 4 s chroma windows (reusing `m.chroma`) combined with a density change. A section boundary fires when novelty exceeds a threshold at a bar.
2. **Engine hooks** in `frame` (L2274):
   - tension → `uFreshGain`, bloom strength, director push-in speed;
   - drop → reuse the wild burst code (L2510-2523) independently of `wild` with n = 3-6 per held plant, plus flares (Idea 2) and Director `WIDE`;
   - breakdown → `uBeatT` waves every 2 s even without beats (a breathing heartbeat);
   - section → optional `evolve` control: none / rotate species in the look / palette shift by a fifth / shed oldest.

**Risks:**
- False drops on dynamic acoustic music. Use a sensitivity control and require bar alignment when tempo is known.

**Optional / light:** This is an analysis-only O(1) addition and every consequence is a toggle.

---

### Idea 9: Space-colonisation growth, where attractors are the music's "food"
**Impact 8 · Effort M-L**

**User-visible result:**
- New species families (**canopy tree, leaf venation, river delta, lung bronchi**) that fill a volume with branching that looks botanically believable, instead of wandering random walks.
- Musical control over the volume: bass notes grow downward root systems into an inverted cone; treble notes grow a canopy dome; velocity sets the volume size; each onset while a note is held **drops a fresh cloud of attractors** where the growth is heading.
- Growth never "stalls at a limit" while food remains, and **how full the volume is shows how long the note was held**.

**Technical design (Runions et al. 2007, simplified per plant):**
1. Add Turn type `'colonize'` (L55) and species entries such as `S({name:'canopy', turn:'colonize', ...})` in `SPECIES` (L105).
2. **Attractors.** Each plant gets `attr: Float32Array(3·N)`, N ≤ 300, plus an `alive` bitmask, generated in `newPlant` (L1529) inside an envelope chosen by register: cone down (octN < .3), ellipsoid (mid), cone up (octN > .7). Radius = `size·0.22·(0.6+velocity)`.
3. **Steering in `nextDir`** (L1789 switch) for `'colonize'`: sum the normalised vectors to attractors within `di = 5·segLen`, kill attractors within `dk = 1.2·segLen`, and add the sum weighted `1.2`. Wobble stays small for organic irregularity.
4. **Branching emerges.** In `finishSegment` (L2023), when the attractor set near a tip splits (two clusters with angle > 50°), spawn a child toward the second cluster instead of branching randomly.
5. **Feeding.** On an onset or beat while the note is held, add 20 attractors in a cone around the leading tip direction. This is the music literally feeding the growth.
6. **Radius.** Pipe-model thickening is optional: on a leaf-ward finish, walk back 6 parent segments and grow `r` (Murray's law) so trunks thicken as the canopy expands. It is visible and lovely. Requires a `parent` pointer on Seg.

**Risks:**
- O(tips × N) per new segment, at most 300 × maxTips (40), called only when segments start. Fine.
- Risk of a "lollipop" look. Mitigate with anisotropic envelopes and noise in attractor placement.

**Optional / light:** New species toggles only, with bounded arrays.

---

### Idea 10: Articulation marks, buds on note-off and sprouts on hits
**Impact 7 · Effort S-M**

**User-visible result:**
- **Staccato** notes leave glowing spores.
- **Legato or long** notes end in a bud that opens into 3-6 petals (leaf quads), scaled by the held duration.
- **Drum hits** make short-lived twigs flicker out of recent growth and retract after about a second, like a sprout storm.
- The rhythm is legible as texture.

**Technical design:**
1. **Buds.** In `release` (L2739), on the final release of a non-text plant: for each tip (at most 4), queue `{pos, dir, size = clamp(heldDur/2,0.2,1)·segLen, t0}`.
   - Render petals by reusing `leafMesh`. It is indexed per segment, so give it a separate small pool: an InstancedMesh with 64×6 petals whose rotation opens over 0.5 s (quaternion slerp from closed to open).
   - Spores for held < 150 ms: a single sphere instance in a pool, plus the Idea 2 flare.
   - Buds become permanent when the plant is lignified, otherwise they fade with it.
2. **Sprouts on hits.** Make the burst logic (L2507-2524) independent of `wild` via a `sprout` control (default .5):
   - trigger on `m.onset > 0.55` (drums) or beat hits;
   - target only the 3 most recently played plants, not every held plant;
   - tips get `ephemeral: t + 1.2`, their segments are never made permanent, and a retract pass removes them after expiry. Add a small check in the retract loop (L2440-2479) that treats ephemeral segments like non-permanent ones regardless of `held`.
   - In audio stem mode (`inputAudio.ts:410-428`), drum-stem onsets drive sprouts, bass-stem onsets drive Idea 1 beat waves, and treble "other" onsets drive tip sparkles.

**Risks:**
- Clutter. Ephemeral sprouts must die, and petals must stay small relative to `segLen`.

**Optional / light:** Controls `buds` and `sprout`, with pools of at most 400 instances.

---

### Idea 11: Seamless mitered tubes, a continuous organic surface with no beads
**Impact 7 · Effort M**

**User-visible result:**
- Branches read as continuous living tubes instead of strings of cylinders joined by spheres ("sausages and beads").
- Close-ups from the Idea 3 Director look like real roots and coral, not CAD.
- Node spheres become an optional style (roe/bead species keep them).

**Technical design:**
1. **Per-instance neighbour directions.** Add `aDirs` (vec4 × 2: previous and next unit directions, packed as two vec3 plus radius-at-end).
   - When a segment starts in `startSegment` (L2013-2020), write the new segment's `prevDir` = the parent direction (`tip.dir` before update).
   - Write the **parent segment's** `nextDir` = the new direction and `rEnd` = the new radius. That is one extra single-index write.
2. **Vertex shader** for the tube mesh (positionNode, which runs after instancing):
   - for vertices with `positionGeometry.y > 0` (top ring), intersect the ring with the bisector plane `normalize(dir + nextDir)` through B;
   - use radius `rEnd` so the taper is continuous;
   - bottom ring mirrored with `prevDir`.
   - The tube uses `CylinderGeometry(1,1,1,radial,1,true)` (L676), so ring identification by `y = ±0.5` is trivial.
3. **LOD.** Radial segments go from 7 to 10 when cap < 50k, and down to 5 above that.
4. **Nodes.** Set `nodes` to default 0 for tube species (keep it for bacteria, rocks and crystals). This cuts about 80 triangles per segment, about 6× the vertex load, which funds bloom and DoF.

**Risks:**
- Bisector degeneracy at sharp turns (> 120°): fall back to no miter.
- The shader must also work with `segRib` (ribbed lathe) and crystal skins. Apply only to `segMesh` first.

**Optional / light:** A `seamless` toggle, and a net performance gain.

---

### Idea 12: Beat-locked GPU breathing and sway
**Impact 6 · Effort S**

**User-visible result:** The whole organism sways and breathes **on the quarter-note grid**, with tips moving more than trunks and a phase lag along the arc distance so motion ripples outward. There is no jitter, and no CPU cost at 250k segments.

**Technical design:**
- `positionNode += swayDir(seed) × uSway × sin(2π·uBeatPhase − aSeg.x·k + seed) × aSeg2.z²`, where `aSeg2.z` is the depth fraction. Use `m.beat.phase` (`beat.ts:113`) when `bpm > 0`, else a slow free-running phase.
- `swayDir` is a hash of the plant seed → a unit vector perpendicular to world up.
- Keep CPU `deform` (L2075-2137) only for physics droop, which must displace real positions for fusion and physics, and for wild.

**Risks:** Seams at joints if the sway differs per segment. Using the continuous arc distance and the plant-level seed keeps adjacent segments coherent.

**Optional / light:** A `breathe` slider (default .3), costing one `sin` per vertex.

---

### Idea 13: Performance headroom (dirty-range uploads, compacted meshes, spatial hash)
**Impact 7, as an enabler · Effort M**

**User-visible result:** The same weak laptop runs bloom, rim lighting and conduction at 60 fps with larger worlds. Auto-quality drops the render scale less often.

**Technical design:**
1. **Dirty ranges.** Replace every `instanceMatrix.needsUpdate = true` / `instanceColor.needsUpdate = true` in `writeSeg` / `writeColor` (L1741-1772, L1695-1700) with a per-frame `dirtyMin/dirtyMax`.
   - Before `draw()` (L2736), call `attr.clearUpdateRanges(); attr.addUpdateRange(min*16, (max-min+1)*16); attr.needsUpdate = true` once per buffer.
   - Growth is append-mostly, so ranges are small. Verify the WebGPU backend honours `updateRanges` for `StorageInstancedBufferAttribute` (it does for BufferAttribute in r16x+; check r185).
2. **Stop writing zero matrices.** Stop writing ZERO_M into sibling meshes for every segment (L1741-1745, L1767-1770).
   - Give each skin and node mesh its own compact index space, e.g. per-mesh `slot` arrays on Seg (`seg.slots[mesh]`) with swap-remove. Instanced draws then process only live instances.
   - Alternative (cheaper refactor): sort plants by skin and keep one instanced mesh per skin with contiguous ranges.
3. **Spatial hash.** Put finished segment endpoints into a grid hash (cell = 2·segLen, reusing the pattern of `updateCoverage` L1386) and query 27 cells in `nearestEndpoint` (L1895) and the Idea 9 attractor queries.
4. **CPU passes removed** by Ideas 1, 3 and 12: centroid and radius loops, focus colour sweep, nerves pulse.

**Risks:** Refactoring the index spaces touches removeSeg, growCapacity and recycling. Use regression tests (count parity, removal order).

**Optional / light:** Invisible to the user, pure gain.

---

### Idea 14: Phyllotaxis heads, where notes are counted as florets
**Impact 6 · Effort S-M**

**User-visible result:** A "bloom head" species. Each note-on of a pitch class (or each beat while it is held) adds the next floret to that class's head at the golden angle (137.508°) and radius `c·√n`, on a tilted dome that faces a random direction. A hi-hat 16th pattern visibly builds a sunflower spiral, so you can *see* the count of notes.

**Technical design:**
- A special Plant mode (`sp.phyllo`) where `startSegment` places zero-length segments with a node at `root + R(tilt)·(√n·c·cos(nφ), domeZ(n), √n·c·sin(nφ))`. The existing `nodeScale` and sphere/cube meshes render florets; velocity sets floret size.
- Heads are few (at most 12, one per pitch class) and spaced by the Idea 5 layout.
- **Non-kaleidoscope safeguards:** tilt each head, add ±8% radius jitter, vary the floret shape per head, and do not mirror or replicate.

**Risks:** Reads as "graphic" if overused. It is a species, off by default.

**Optional / light:** At most 12 × 400 florets through existing meshes.

---

### Idea 15: Differential-growth membranes (brain coral and lettuce edges)
**Impact 6 · Effort L**

**User-visible result:** A sustained pad or held chord grows a frilled membrane edge that buckles and folds as it lengthens. It is the most "alive" 3D growth motif and complements the branching species.

**Technical design:**
- A per-plant closed polyline of up to 1500 nodes in 3D. Each frame:
  - neighbour attraction;
  - repulsion within R via the Idea 13 spatial hash;
  - edge split when longer than `maxLen`;
  - small noise.
- Growth rate is driven by the plant's ADSR envelope and `m.mid`.
- Render via the Idea 7 GPU sweep (a ribbon along the closed curve with width `w(u)`) or as instanced tubes (rewriting at most 1500 matrices per frame within dirty ranges).
- Freeze (lignify) when the note is released. The node count is capped, so it stops at its cap and becomes permanent.

**Risks:** CPU cost of about 1500 × (neighbours + hash). Limit to 2 active membranes; freeze beyond that.

**Optional / light:** A species toggle, off by default.

---

### Idea 16: Channel and stem layers, an ecosystem per instrument
**Impact 6 · Effort S**

**User-visible result:** With multi-channel MIDI or audio stems, the drums become ground-level coral bursts, the bass becomes roots below, pads become canopy above and the lead becomes lightning and vines in front. The band is readable as a layered ecosystem.

**Technical design:**
- Extend `speciesFor` (L1512-1527), which today uses channels 2-5 only for audio stems. Add `channelMap` controls for MIDI channels 1-16 → {species, layer height, colour offset}.
- Layer height feeds the Idea 5 root placement.
- Flares and conduction colour follow the channel's hue offset.

**Risks:** Channel numbering conventions differ; add a "learn" button that picks up the last channel played.

**Optional / light:** Auto (the current behaviour) stays the default.

---

### Idea 17: Age grading, where bark cools and new growth is hot
**Impact 6 · Effort S**

**User-visible result:** A clear time axis in the structure. Old skeleton desaturates toward a cool bark tone while new growth is saturated and bright. The present moment is always the most vivid, and history remains visible rather than dimmed to near-black as v19's `musicFocus` does (`music-focus.js:24-30`).

**Technical design:**
- In the shader: `colour = mix(barkTint(colour), colour, fresh)`, with `fresh` from Idea 1's `aSeg.y`. Bark tint = colour desaturated 70% and shifted 0.04 toward the look's cool pole.
- On a key change (chord root moves by a fifth or more for 4+ bars), slowly rotate the global grade hue: a `uGradeHue` uniform, again in shader.

**Risks:** Minimal; it reuses Idea 1 data.

**Optional / light:** An `age grade` slider, with zero CPU cost.

---

### Idea 18: A music-legibility QA harness
**Impact 6 for the process, and important given v16-v19 were never rendered · Effort S-M**

**Result:** Every release proves "obvious music reaction" with numbers instead of claims.

**Design:**
- A headless Chrome script (Playwright or the Claude Browser) loads the single-file HTML with a `?qa=1` flag that exposes `window.__growthQA = {push(ev), frameStats()}`.
- It pushes a scripted sequence: a C major triad for 2 s, 8 staccato 16ths, a bass pulse at 120 bpm, silence, then a drop.
- Metrics:
  1. note-on → first visible luminance change near the projected root within 2 frames;
  2. segments per second per note ≥ threshold;
  3. projected bounding box of the last 3 s of growth within [−0.95, 0.95] (framing);
  4. frame time p95 at 1080p on the low tier;
  5. soft-mesh normal smoothness: angle between adjacent face normals < 15°.
- Save screenshot strips for the owner.

**Risks:** GPU availability in CI; run locally on the owner's machines.

---

## 2. Non-kaleidoscope and aesthetic safeguards (apply across ideas)

- No mirror or replicate folds. `g.symmetryNow` stays unused by the organism.
- Every structural mapping (layout, phyllotaxis, attractor envelopes) carries jitter, tilt and random radius.
- Event visuals (flares, rings) are soft, warm and additive. Keep them sparse: under 24 per second, merged when close.
- Black stays black. Rim light, tone mapping and fog must never lift the background. Keep `scene.background` at 0x000000 and fog colour black.
- Conduction and resonance use the plant's **own** colour (`diffuseColor`), so the glow belongs to the organism rather than a UI overlay.

## 3. Weak-laptop budget plan

| Feature | GPU cost | CPU cost | Auto-quality behaviour |
|---|---|---|---|
| Conduction/resonance/fresh (1, 12, 17) | ~2 exp + 1 sin per vertex/fragment | removes existing loops | always on |
| Ignition flares/rings (2) | 2 draws, ≤128 quads, additive | ≤128 matrices/frame | always on |
| Director/auto-frame (3) | 0 | O(512) | always on |
| Rim + tone mapping (6) | trivial | 0 | always on |
| Bloom (6) | ~1-2 ms iGPU 1080p | 0 | first thing dropped (<40 fps) |
| Note lights (6) | per-fragment ×N | 0 | 3 → 2 → 0 |
| DoF (6) | ~1-2 ms | 0 | high tier only |
| GPU sweeps (7) | 64×16 verts/soft plant | removes CPU deform | cap count |
| Mitered tubes, no nodes (11) | about −6× vertices | 1 extra write/seg | always |
| Dirty ranges / compaction (13) | less bandwidth | less | always |

Net: **cheaper** than v19 at the same scene size, while visibly far more reactive.

## 4. Where v19 modules intersect (porting notes)

- `music-focus.js`:
  - `segmentAllowance` → replaced by the per-note budget and first-segment bypass (Idea 2).
  - `focusLevel` / `refreshMusicFocus` → shader `fresh` (Ideas 1 and 17).
  - `toggleCameraLock` / `applyCameraLock` stay and are extended with "Still + fit" (Idea 3).
- `calm-camera.js` → the calm variant of Director (Idea 3). Calm means no shake, kick or hard cuts, **not** no framing.
- `cinematic-camera.js` modes 6-8 fold into Director shots. The extent computation there (lines 22-26) is replaced by the incremental focus sphere.
- `soft-growth.js` / `soft-species-extra.js` → hotfix `mergeVertices` now, then GPU sweeps (Idea 7). Forms become tip blossoms.
- `dynamic-materials.js` materials already go through `bf(...)` (= `reactify`), so they automatically gain conduction, rim and fresh glow once `reactify` is extended.
- `simple-ui.js` looks → the Reaction macro, colour-mapping fix and per-register species (Idea 4).
- `stage-motion.js` screen bounce stays. Its projected-bounds code (`updateBounceBounds`) is a good base for the Idea 3 screen-space fit check.

---

## 5. Recommended top 8, in priority order

1. **Conduction and Resonance GPU attribute layer (Idea 1):** impact 10, M. The biggest single "this is obviously the music" upgrade. Every note lights its own growth root→tip, and replayed pitches re-light their history. It removes CPU work. Includes step 0 of Idea 13 (dirty-range uploads), because this idea adds attributes.
2. **Note-on Ignition and ADSR growth envelope (Idea 2):** impact 10, S-M. It guarantees an immediate, legible event for every key press (flare, lunge, per-note budget) and fixes the v19 quota starvation and held-note energy decay.
3. **Reaction macro and retuned looks (Idea 4):** impact 9, S. The cheapest large win: undoes the v19 over-damping (flash ≤ 0.10, pulse .15) behind one calm↔show slider, and makes pitch visible in every look (mono/forest palettes currently hide it).
4. **Auto-framing and musical Director camera (Idea 3):** impact 9, M. The camera always frames recent action (fixes Silk out of frame and the dead locked Still), with bar-synced cuts. "Calm" stays available but still frames.
5. **Lighting and post for black space (Idea 6):** impact 8, S-M. Tone mapping, fresnel rim, HDR tips, bloom on by default with auto-quality, note lights. This makes Ideas 1-2 glow and gives forms depth on black.
6. **Pitch → space and harmony → structure (Idea 5):** impact 8, M. Bass roots down and melody canopy up; chords fuse into one structure with sparks, and dissonance sprouts apart. It uses the existing chord detector.
7. **Soft species as skeleton-following GPU sweeps (Idea 7):** impact 7, M. Ship the `mergeVertices` smooth-normal hotfix immediately (S). The sweep then makes Liquid and Silk follow the real growth, smooth and in frame, with no CPU vertex loops.
8. **Energy arcs → scene evolution (Idea 8):** impact 8, M. Build-ups, drops and breakdowns become visible dramaturgy, from push-ins to burst and cut to breathing. This makes long sets feel composed.

Next tier: Idea 9 (space colonisation, the richest new growth system), Idea 11 (seamless mitered tubes), Idea 10 (buds and sprouts), Idea 13 (full compaction and hash), Idea 12 (beat-locked GPU sway), Idea 17 (age grading), Idea 16 (channel layers), Idea 14 (phyllotaxis), Idea 15 (differential growth), Idea 18 (QA harness; strongly recommended in parallel since nothing from v16-v19 was browser-verified).
