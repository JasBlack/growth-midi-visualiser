# C4: Soft deforming species (Liquid, Silk ribbon, Wave blanket + 10 more): porting spec

Cluster: 13 "soft" species that swap the branching tube skeleton for one deforming surface per plant.
Origin: v0.17.0 (3 species), extended in v0.17.2 / v0.17.3 / v0.18.0 (10 more), surfaced by v0.19.0 Simple looks.
Target: TypeScript source `C:\Users\User\Desktop\code\growth-midi-visualiser` (tag v0.15.0). The TS source is the target. Nothing here exists in TS yet.

Evidence base (all read in full unless noted):

- v19 modules: `C:\Users\User\Downloads\growth-v0190\maintenance\soft-growth.js` (92 lines), `soft-species-extra.js` (34), `dynamic-material-runtime.js` (34, soft material ownership), `performance-ui.js` (15, soft UI handler), `extra-controls.js` (line 1, soft options), `stage-motion.js` (line 27, soft bounds), `simple-ui.js` (lines 6-7, Liquid/Silk looks), `music-focus.js` (`focusLevel`, used by soft colour), `calm-camera.js` / `cinematic-camera.js` (camera framing context).
- Patch builders: `patch_performance.py` (v0.17.0), `patch_music_focus.py` (v0.17.2), `patch_dynamic_materials.py` (v0.17.3), `patch_species_stage.py` (v0.18.0), `patch_consolidation.py` (v0.19.0).
- Tests: `test-motion.cjs`, `test-stage-tips.cjs`, `test-dynamic-materials.cjs` (soft part, lines 50-58).
- Notes: `NOTES_V0170.md`, `NOTES_V0172.md`, `NOTES_V0173.md`, `NOTES_V0180.md`, `START_HERE_v0180.md`, `NOTES_FOR_CLAUDE.md`, `START_HERE_v0190.md`, `README.txt`.
- Compiled bundle `assets/index-BWYXfAkm.js`. I checked that the combined `soft-growth.js` + `soft-species-extra.js` text appears verbatim at byte offset 1401971. `growth-visualiser-v0.17.0.html` holds the original v0.17.0 soft code, which I extracted for the history.
- TS: `src/midi/engines/organism.ts` (2790 lines; Species 58-102, SPECIES 105-130, Plant 167-194, Seg 196-206, controls 371-446, clearGrowth 742-747, clear 749-760, setControl 762-778, applyShaders 783-813, draw 871-879, respawnHeld 1487-1496, speciesFor 1512-1527, newPlant 1529-1656, addSeg 1670-1685, writeColor 1687-1701, removeSeg 1703-1714, writeSeg 1717-1773, frame 2274-2737, release 2739-2774, unmount 2776-2789), `src/midi/shaders.ts` (reactify 56-63, GROWTH_SHADERS 97-213), `src/midi/main.ts` (settings 45-99, ctls 115-125, widget 134, selectEngine 245-280, renderEngineControls 306-387), `src/midi/engine.ts` (EngineControl 27-40, Engine 42-78, ctl/setCtl 79-87), `index.html` (engineControls at line 165).
- A numeric harness I ran against the real three r185 `PlaneGeometry` / `IcosahedronGeometry` and the shipped `softFormXYZ`. Its source is in Appendix B, and its numbers appear in section 2.3 and Appendix A.

---

## 1. Summary

### What the user gets

- 13 species toggles appended to the Species grid, all **off by default**: Liquid, Silk ribbon, Wave blanket, Jelly bell, Kelp frond, Manta sail, Spiral streamer, Breathing torus, Wave tube, Anemone fan, Pleated silk, Liquid droplet, Ripple disc.
- When a note grows a plant of a soft species, the normal branching skeleton still runs but is **hidden**. It is replaced by **one parametric mesh per plant**: a sphere blob, a twisting strip, a sheet, a bell, a torus, and so on.
  - The mesh is anchored at the plant's root.
  - Its size is `min(8, 0.8·sqrt(total grown skeleton length))`, so it grows while the note is held and shrinks as the skeleton retracts.
  - It is deformed on the CPU every ~1/30 s by time plus smoothed bass and treble.
- Three sliders (`softWave`, `softReact`, `softSpeed`) set wave amplitude, audio response and flow speed.
- A "Flow & camera" panel section (`#sec-fluid`) has a soft-species picker and a "Use soft species" button. The button switches **every** species toggle so that only the chosen soft kind (or all soft kinds) stays on.
- In v0.19 the Simple-mode looks "Liquid" and "Silk" use these species, while `#sec-fluid` is hidden in Simple mode.

### Version history

| Version | Change to this cluster | Source |
|---|---|---|
| v0.17.0 | Liquid / Silk ribbon / Wave blanket. `IcosahedronGeometry(1,3)` and `PlaneGeometry(1,1,48,20)`. Every soft plant updated at up to 30 Hz, normals recomputed on every update. softWave/softReact/softSpeed controls, species default `value: e.soft?0:1`, `#sec-fluid` UI and `softOnly` handler. | `patch_performance.py` L30-35, L43-44, L55-67; `performance-ui.js` |
| v0.17.2 | Soft mesh colour multiplied by `focusLevel(lastSeg)`. Tip-marker rule changed so glow-0 species (all soft) now draw tip markers. | `patch_music_focus.py` L52-58 |
| v0.17.3 | Per-soft-mesh material ownership: `syncSoftMaterial` / `disposeSoftItem`. The ten new "animated materials" (shader index ≥ 22) apply to soft meshes. Original shaders 1-21 still do **not**. | `patch_dynamic_materials.py` L18-23; `dynamic-material-runtime.js` L15-33 |
| v0.18.0 | 10 more forms via `softFormXYZ`. Geometry detail **reduced** to `IcosahedronGeometry(1,2)` and `PlaneGeometry(1,1,24,16)`. Round-robin work quota of 16 mesh updates/creations per frame, 64-mesh cap, normals at ≤ 15 Hz. softChoice options extended. Screen bounce reads soft bounding boxes. | `patch_species_stage.py` L18-20, L38; `soft-species-extra.js`; `extra-controls.js` L1; `stage-motion.js` L27 |
| v0.19.0 | Simple looks `liquid` and `silk`; `#sec-fluid` hidden in Simple mode; the 10 v0.18 species are "experimental", Advanced-only. | `patch_consolidation.py` L42-48; `simple-ui.js` L6-7 |

### Verdict

The idea is worth keeping and improving: a note that grows something soft, fluid and fabric-like instead of branches. The v19 implementation should **not** be ported as-is. Three rendering defects explain the lead's live observations:

1. The soft material uses **`side: BackSide`**. The minified constant `Et` is `THREE.BackSide`, not DoubleSide (section 7, B1). Front-facing sheets (blanket, manta, fan, pleats, kelp) are culled from the default camera. Closed shapes (liquid, droplet, torus, tube, jelly) show their inside back wall with negated normals.
2. The liquid uses a **non-indexed** icosphere and calls `computeVertexNormals()`, which gives flat per-face normals, and v0.18 dropped its detail to 2. That is the "faceted low-poly blob" (B2).
3. Every form is laid out on **world axes from the plant root**:
   - Streamers (ribbon, kelp, spiral, tube) rise straight up +Y, up to 16 units at size 8.
   - Sheets all face ±Z.

   The camera frames the **hidden skeleton** instead, so the surfaces grow out of frame and look uniform (B4, B5).

Beyond those, the music mapping barely shows (B14), the "Soft motion" group label is thrown away so the sliders land in "More" (B7), and cyan tip markers float at invisible skeleton tips (B6).

---

## 2. Behaviours

### 2.1 Species registration

v19 code: `soft-growth.js` L1-7 (3 species) and `soft-species-extra.js` L1-12 (10 species), run at module scope before the engine is constructed. In the bundle the engine's `controls` field is built per instance, so `js.map` (= `SPECIES.map`) sees all 37 entries.

- Each entry is `{...js[1], <overrides>}`. `js[1]` is **roots** (organism.ts:107): `hue 0, segLen .42, thickness 1, taper .99, branchTaper .72, wiggle .8, branch .22, branchAngle [.6,1.3], turn 'smooth', turnAngle 0, node 'sphere', nodeScale 1.02, gravity .35, radial .1, maxTips 10, maxDepth 60, speed 1, glow 1, brighten 0, join 1, avoid .4`.
- The bundle has exactly the same 24 base species as TS v0.15.0 (bacteria … brambles, indices 0-23). I checked this in the bundle at byte 1087471. Soft species are therefore indices **24-36**.

Resolved species objects (fields not listed come from roots: `turnAngle 0`, `brighten 0`; `planar`, `initTips`, `dir0`, `rootY`, `dichotomous` and `dominance` are all undefined):

| idx | name | icon | `soft` kind | hue | group |
|---|---|---|---|---|---|
| 24 | liquid | 💧 | `liquid` | .08 | A |
| 25 | silk ribbon | 〰 | `ribbon` | .32 | A |
| 26 | wave blanket | 🌊 | `blanket` | .56 | A |
| 27 | jelly bell | 🪼 | `jelly` | .14 | B |
| 28 | kelp frond | 🌿 | `kelp` | .28 | B |
| 29 | manta sail | 🪽 | `manta` | .43 | B |
| 30 | spiral streamer | 🌀 | `spiral` | .56 | B |
| 31 | breathing torus | ⭕ | `torus` | .70 | B |
| 32 | wave tube | 🪈 | `tube` | .82 | B |
| 33 | anemone fan | 🪸 | `fan` | .06 | B |
| 34 | pleated silk | 🪭 | `pleats` | .36 | B |
| 35 | liquid droplet | 💧 | `droplet` | .62 | B |
| 36 | ripple disc | 💿 | `disc` | .92 | B |

Skeleton parameters, group A (idx 24-26):
`skin:'smooth', node:'none', nodeScale:0, segLen:.22, thickness:.7, taper:.997, branch:.035, branchTaper:.92, branchAngle:[.12,.4], wiggle:.35, gravity:0, radial:.05, maxTips:4, maxDepth:140, speed:.8, avoid:.1, join:.2, glow:0, turn:'smooth'`

Skeleton parameters, group B (idx 27-36):
`skin:'smooth', node:'none', nodeScale:0, segLen:.24, thickness:.65, taper:.998, branch:.025, branchTaper:.92, branchAngle:[.12,.35], wiggle:.3, gravity:0, radial:0, maxTips:3, maxDepth:140, speed:.75, avoid:.1, join:.15, glow:0, turn:'smooth'`

Notes:

- `skin:'smooth'` is not a legal `Species['skin']` value (`'ribbed'|'crystal'|'leafy'`, organism.ts:68). It only works because writeSeg (organism.ts:1740) and the visibility pass (organism.ts:2494-2497) treat anything unknown as the plain tube (`segMesh`).
- The skeleton parameters make a few long, thin, nearly straight wandering strands: 2-3 initial tips (organism.ts:1635), maxTips 3-4, almost no branching. Held plants re-sprout from random joints whenever `tips.length < 3` (organism.ts:2411-2420), so the skeleton, and with it the soft size, keeps growing while the note is held.
- `hue` feeds the plant colour: `noteRgb(g.palette, pitch, 0.15 + octN*.5 + sp.hue + level*.23)` (organism.ts:1545).

### 2.2 Per-frame soft update (`updateSoftGrowth(state)`, soft-growth.js L10-74)

Where it is called: first statement of `draw()` (after v0.17.2's `refreshMusicFocus()`). Bundle anchor: `draw(){this.refreshMusicFocus();this.updateSoftGrowth(this.performanceState);if(this.canvas.width<2` (byte ~1119002). `this.performanceState` is the current frame's `MusicState`, stored at the top of `frame()`.

Because `draw()` is also called by `snapshot()` (organism.ts:894), the update also runs during snapshots. The time throttle makes that call a no-op.

The algorithm, exactly as shipped:

```
if !state: return
softMeshes ??= new Map<Plant, Item>()
live = Set(this.plants)
for (plant, item) in softMeshes: if plant ∉ live → disposeSoftItem(item); delete
dt  = clamp(state.dt, 0, 0.1);  mix = 1 - exp(-dt*8)
softBass   += (state.bass   - softBass)   * mix      // EMA, time constant 1/8 s
softTreble += (state.treble - softTreble) * mix
wave = ctl('softWave'); react = ctl('softReact'); speed = ctl('softSpeed')
softPlants = plants.filter(p => p.sp.soft)              // spawn order
start = (softUpdateCursor || 0) % max(1, softPlants.length)
work = 0; softUpdateCursor = start + 16
softPoint ??= [0,0,0]
for step in 0 ..< softPlants.length:
  plant = softPlants[(start+step) % n]
  item = softMeshes.get(plant)
  if !item:
     if work >= 16: continue                      // creation gated by the quota…
     if softMeshes.size >= 64: continue           // …and by the 64-mesh cap → skeleton stays visible
     geometry = kind=='liquid' ? IcosahedronGeometry(1, 2) : PlaneGeometry(1, 1, 24, 16)
     material = reactify(new MeshStandardNodeMaterial({ color: plant.color,
                  roughness: liquid ? .16 : .45, metalness: liquid ? .25 : .08, side: Et /* = BackSide! */ }))
     mesh = new Mesh(geometry, material); mesh.frustumCulled = false; group.add(mesh)
     item = { mesh, base: position.array.slice(), last: -Infinity }; softMeshes.set(plant, item)
     for seg of plant.segs: writeSeg(seg)         // re-write → hidden (see 2.4)
  syncSoftMaterial(plant, item)                   // every frame, every soft plant with an item (2.6)
  if state.time - item.last < 1/30 || work >= 16: continue
  work++; item.last = state.time
  length = Σ_seg |seg.b - seg.a| * clamp(seg.growth, 0, 1)
  size = min(8, sqrt(length) * 0.8)
  mesh.visible = size > .02; if size <= .02: continue
  mesh.material.color?.copy(plant.color).multiplyScalar(focusLevel(plant.segs.at(-1) || {plant, born: plant.birth}))
  phase = plant.id * 1.731
  t = state.time * speed                          // absolute time × speed (phase jumps when speed changes, B8)
  energy = (0.18 + softBass*0.7 + softTreble*0.25) * react
  for each base vertex (bx, by, bz):
     (x,y,z) = FORM(kind)                         // 2.3
     x += root.x; y += root.y; z += root.z        // world space, no rotation
     if this.videoOn:                             // 2.8.4
        {w,h} = fieldSize(); x = clamp(x, -w/2, w/2); y = clamp(y, -h/2, h/2)
        if ctl('videoFollow') > 0: z = fieldZ(x/w + .5, .5 - y/h) + (z - root.z) * 0.18
     write position
  position.needsUpdate = true
  if state.time - (item.normalT ?? -Inf) >= 1/15: geometry.computeVertexNormals(); item.normalT = state.time
```

Effective cadence:

- Each mesh updates at **most** 30 Hz. At 60 fps the strict `<` test against accumulated frame times gives an irregular 2- or 3-frame cadence (20-30 Hz).
- Above 32 soft plants the 16-per-frame quota lowers it further, to `60·16/n` Hz (15 Hz at 64 plants).
- Normals refresh at ≤ 15 Hz, so they lag the positions by up to one update.

`focusLevel(seg)` (music-focus.js L77-83; music-focus cluster):

```
focus = ctl('musicFocus'); if focus <= 0: return 1
age   = max(0, lastGTime - seg.born)
trail = ctl('musicTrail') || 2
fresh = seg.plant.referenceAuto ? 0 : max(0, 1 - age/trail)
return 1 - focus*0.8 + focus*1.15*fresh
```

At the v0.17.2 default focus .8 this is 1.28 for fresh growth and 0.36 for old growth. The v0.19 Simple default of .7 gives 1.245 / 0.44. The soft mesh ignores `plant.dying`: skeleton plants dim to ×0.45 when retiring (organism.ts:1688), soft meshes do not (B20).

### 2.3 Parametric forms (exact)

Base geometry and coordinates:

- `IcosahedronGeometry(1,2)`: **non-indexed**, 540 vertices, 180 triangles. `(bx,by,bz)` lie on the unit sphere.
- `PlaneGeometry(1,1,24,16)`: indexed, 425 vertices, 768 triangles. `bx ∈ [-.5,.5]` has 24 segments, `by ∈ [-.5,.5]` has 16 segments, `bz = 0`.

**Liquid** (soft-growth.js L49-51):

```
pulse  = 1 + wave*(0.12 + energy*0.18) * ( sin(bx*3 + t + phase) * cos(by*2 - t*0.7) + 0.45*sin(bz*4 + t*1.2) )
radius = size * 0.45
p = (bx, by, bz) * radius * pulse
```

**Silk ribbon** (L52-57). Length runs along `by`, which has only 16 segments; width runs along `bx`, which has 24 segments but is linear, so those segments are wasted (B11).

```
along = (by + 0.5) * size * 2                      // 0 … 2·size, straight up +Y
twist = along*0.6 + sin(t*0.4 + phase)*0.7
width = min(1.4, size*0.2) * bx * (1 + 0.25*sin(along*1.1 + t))
x = sin(along*0.55 - t*0.45 + phase) * wave*(0.4 + energy) + cos(twist)*width   // sway NOT scaled by size
y = along
z = cos(along*0.4 - t*0.3 + phase) * wave*(0.3 + energy) + sin(twist)*width
```

**Wave blanket** (L61-63). The sheet faces +Z; z is not scaled by size.

```
x = bx*size*1.6;  y = by*size*1.15
z = wave*(0.25 + energy) * ( sin(bx*5 + t + phase)*cos(by*4 - t*0.7) + 0.45*sin((bx + by)*8 - t*1.3) )
```

**The other 10** use `softFormXYZ(kind, u=bx, v=by, size, time=t, phase, wave, energy, out)` (soft-species-extra.js L14-34):

```
a = (u + .5)*2π ;  b = v + .5 ;  t' = time + phase ;  amp = wave*(0.15 + energy*0.4)
jelly:   lat = b*π*0.52; r = sin(lat)*(0.65 + 0.07*sin(t'*1.2)); x = cos(a)*r; y = cos(lat)*0.7; z = sin(a)*r;
         y += b^4 * amp * sin(a*6 - t') * 0.3
kelp:    x = u*(0.35 + 0.6b)*sin(πb); y = 2b; z = amp*sin(7b - t') + u*0.3*cos(t' + 4b)
manta:   x = 2u; y = 0.8v + 0.3|u|; z = amp*sin(5|u| - t')*(0.3 + 2|u|) + 0.4v²
spiral:  ang = 4πb + 0.25t'; r = 0.35 + 0.22u; x = cos(ang)*r; y = 1.8b; z = sin(ang)*r + amp*0.15*sin(a + t')
torus:   tube = 0.18*(1 + amp*0.3*sin(t' + 6.283b)); q = 2πb; r = 0.6 + tube*cos(q); x = r cos a; y = tube sin q; z = r sin a
tube:    r = 0.25 + amp*0.08*sin(8b - t'); x = r cos a + amp*0.3*sin(5b - t'); y = 1.8b; z = r sin a + amp*0.15*cos(4b - t')
fan:     ang = 1.5πu; r = 0.95b; x = sin(ang)*r; y = cos(ang)*r; z = amp*b*sin(6ang - t')*0.4
pleats:  x = 1.6u; y = 1.3v; z = (0.06 + 0.25amp)*sin(25u + 0.6t') + 0.2amp*sin(6v - t')
droplet: lat = πb; r = sin(lat)*(0.5 - 0.25cos(lat)); x = r cos a; y = 0.9cos(lat); z = r sin a; x += amp*0.12*sin(2lat - t')*sin(lat)
disc:    r = 0.85b; x = r cos a; y = r sin a; z = amp*0.3*sin(12r - 1.4t')*b
out = (x, y, z) * size
```

Measured extents relative to the root, with wave 1, react 1, over time and both energy extremes (full table in Appendix A). At size 8:

| Form | Extents at size 8 | Direction |
|---|---|---|
| ribbon | y 0 → 16 | straight up |
| kelp | y 0 → 16 | straight up |
| spiral | y 0 → 14.4 | straight up |
| tube | y 0 → 14.4 | straight up |
| manta | x ±8 | sheet facing +Z |
| fan | x ±7.6 | sheet facing +Z |
| blanket | x ±6.4 | sheet facing +Z |
| liquid | radius ≈ 5 | centred on root |

Every plant of a kind has **the same orientation**; the only per-plant variation is `phase = id·1.731`.

Music contrast is the ratio of deformation amplitude, loud (energy 1.13) over silent (energy 0.18), at size 4:

- 2.1× for liquid, 2.8× for ribbon, 3.2× for blanket, 2.7× for the other ten.
- Shapes keep moving at 30-45 % of full amplitude in silence.
- Breathing torus and liquid droplet barely move: the maximum vertex displacement per 0.1 s at size 4, loud, is 0.013 and 0.026 world units.

Behaviour at `softWave = 0` (the "still" expectation fails):

- Jelly still breathes (`0.07·sin(1.2t')` is not scaled by wave).
- Spiral still rotates (`0.25t'`).
- Pleats still slide (the `0.06` term).
- Ribbon still twists and pulses in width.
- Only `softSpeed = 0` freezes the shapes.

### 2.4 Skeleton hiding (soft-growth.js L81-88)

```
writeSeg = function(segment, ...args) {
  if (segment.plant.sp.soft && this.softMeshes?.has(segment.plant)) {
    const growth = segment.growth; segment.growth = 0          // → writeSeg's `hidden` path (len < 1e-4)
    try { return original.call(this, segment, ...args) } finally { segment.growth = growth }
  }
  return original.call(this, segment, ...args)
}
```

With `growth = 0`, TS writeSeg (organism.ts:1723-1729) scales the tube to zero, and the node scale is `ns = 0` because of `hidden || node==='none'` (1758). Every writeSeg caller goes through the wrapper, including growCapacity 710, attach 1303, addSeg 1683, removeSeg swap 1709, fuse 1924, finishSegment 2028, deform 2135, grow 2394 and retract 2478.

Before a plant's mesh exists (the same frame it is created, or indefinitely beyond the 64 cap) its skeleton renders as a plain thin tube. That tube uses `segMesh` because `skin:'smooth'` falls to the default.

### 2.5 Fallback and caps

- A new mesh is created only while `work < 16` and `softMeshes.size < 64`.
- Plants that cannot get a mesh keep a visible thin-tube skeleton with no nodes. When an older mesh is freed they pop to a surface.
- The notes call this "additional organisms use their branching skeleton".

### 2.6 Material ownership (`dynamic-material-runtime.js` L15-33, v0.17.3)

```
syncSoftMaterial(plant, item):
  index = ctl('shader'); if item.materialIndex === index: return
  item.materialIndex = index
  item.baseMaterial ??= item.mesh.material
  if item.effectMaterial: item.effectMaterial.dispose(); item.effectMaterial = null
  if index >= dynamicMaterialStart (= 22) && index < GROWTH_SHADERS.length:
     try { item.effectMaterial = reactify(GROWTH_SHADERS[index].make()); item.effectMaterial.side = Et /* BackSide */ }
     catch (e) { console.warn('Animated soft material unavailable', e) }
  item.mesh.material = item.effectMaterial ?? item.baseMaterial
disposeSoftItem(item):
  group.remove(item.mesh); item.mesh.geometry.dispose(); item.effectMaterial?.dispose(); (item.baseMaterial ?? item.mesh.material).dispose()
```

- `dynamicMaterialStart = I_.length` at push time. TS `GROWTH_SHADERS` has 22 entries (standard … pulse, shaders.ts:97-213), so 22 is correct.
- Indices 22-31 are the v0.17.3 animated materials: 22 tidal glass, 23 pearl currents, 24 mercury ribbons, 25 biolume, 26 oil slick, 27 silk shimmer, 28 molten gold, 29 ripple rings, 30 aurora weave, 31 electric filaments.
- The Simple "Liquid" look uses shader 22 (tidal glass); the Simple "Silk" look uses 27 (silk shimmer).
- The effect material's colour comes from `materialColor`, i.e. `material.color`, which the soft update overwrites with `plant.color × focusLevel` on every update.
- Shaders 1-21 (stripes … pulse) **never** apply to soft meshes. `applyShaders()` (organism.ts:783-813) only iterates `baseMats`.

### 2.7 Disposal

- `clearSoftMeshes()` (L75-79) disposes every item and clears the Map.
- It runs from two wrappers:
  - the **clearGrowth wrapper** (L89-90), which is called by `clear()` (organism.ts:750) and by the timed "reset" cycle (organism.ts:2345);
  - the **unmount wrapper** (L91-92).
- The wrapper chain in the bundle is `soft → reference(clearGrowth)` and `soft → tipUpload(unmount) → original`.
- Items whose plant has left `this.plants` (fully retracted) are disposed at the start of the next soft update, which is the same frame's `draw()` because `this.plants` is filtered at organism.ts:2482.

### 2.8 Interaction with other systems

1. **Music focus (v0.17.2):** described in 2.2. The v0.17.2 tip-marker rule `(q.sp.glow<=0 && musicFocus<=0) || (q.referenceAuto && musicFocus>0)` (bundle byte ~1156249; TS equivalent organism.ts:2552 `p.sp.glow <= 0`) means that with `musicFocus > 0` (the default) **tip markers are drawn for soft plants at their hidden skeleton tips**. The marker size floor is `min(.5, max(.06, camDist·.0025))`. See B6.
2. **Screen bounce (v0.18, stage-motion.js L27):** for visible soft meshes it calls `geometry.computeBoundingBox()` every 0.25 s and projects the 8 corners into the bounce bounds. This is the only system that knows where soft surfaces are.
3. **Camera:** no camera mode accounts for soft surfaces.
   - TS orbit/weave/drift/sit centre and radius come from `this.segs[*].a` (organism.ts:2575-2591).
   - Wide pulse uses `segs[*].b` (cinematic-camera.js L38-41).
   - Tip glide, tour and chase target skeleton tips (cinematic-camera.js L24-35; organism.ts:2650-2658).
   - So every mode frames or chases the **invisible** skeleton.
4. **Reference / video field:** when `videoOn`, positions are clamped to the picture plane and, if `videoFollow > 0` (a reference-cluster control that does not exist in TS), z is flattened onto the relief with 18 % of the original depth offset.
5. **Growth shaders:** see 2.6. `reactify` still applies (shaders.ts:56-63): `positionNode = positionLocal + normalLocal·uPulse` and emissive `+ diffuseColor·uFlash`. This is the soft meshes' only onset or hit reaction, because `uPulse`/`uFlash` come from `hitEnv` (organism.ts:2529-2535). `uPulse` peaks around 0.12-0.2 world units, which is small next to a 4-unit blob.
6. **Wild / mutate** (organism.ts:336-363) spreads `...sp`, so mutants stay soft, and their node/turn mutations are irrelevant.
   - **Stems:** `stemDrums/Bass/Voice/Other` options include the soft names, and max becomes 37.
   - **Nested** children can be soft; their mesh ignores `bound`.
   - **Typography** uses `SPECIES[1]` (roots), so it is unaffected.
7. **Shell / skin / organism bounds:**
   - The skeleton obeys shell, bounds and skin; the soft mesh ignores them and pokes through shells.
   - In skin mode the soft shape floats at the surface root, not along the surface.
   - `attach` moves `p.root` (organism.ts:1300), so the mesh follows animated models.
8. **Budget and fusing:** hidden skeleton segments still count toward the segment budget. They still attract other growth (`join` .2/.15). They can fuse, making invisible bridges, and they can be picked as graft hosts (organism.ts:1583-1589). That places new rigid plants' roots in empty-looking space next to a soft surface.
9. **Species selection:** `speciesFor()` falls back to **all** SPECIES when none is toggled (organism.ts:1521), which includes soft. The Species "all" button turns on all 37.
10. **Shadows** (env 3): `rebuildEnv` sets `castShadow` only on the instanced meshes (organism.ts:825). Soft meshes neither cast nor receive shadows.

### 2.9 How the music reaches the soft surfaces

| Musical input | Effect on a soft surface |
|---|---|
| Note-on | Spawns a plant, which later becomes a surface. The surface starts at size 0 and grows with `sqrt(length)`, so it is slow to read. `hitEnv` gives a small `uPulse` swell and `uFlash` flash. |
| Note held | The skeleton grows (rate × `musicAmount`, fillRate/allowance-limited in v19), so the size grows. |
| Velocity | Affects skeleton growth rate (`1.4 + 2.6·vel`) and radius only. The surface shape itself ignores velocity. |
| Pitch | Colour (palette) and plant root position (by pitch class) only. |
| Bass / treble | EMA (1/8 s) into `energy`, which scales deformation. In MIDI mode these come from the register of held notes, so they follow which notes are held, not rhythm. |
| Onsets / beats | None, apart from reactify's `uPulse`/`uFlash`. |
| Release | Retraction of non-lignified segments shrinks the surface. After `lignify` (1.6 s) the segments are permanent, so the surface stays at its size. |

---

## 3. Controls

Engine controls on `OrganismEngine`, keys `e:organism:<key>`, persisted in `settings.engineCtl.organism` (localStorage `midiviz_settings_v3`, same key in v19) and in presets `engineCtl`:

| key | label (v19) | min | max | step | default | options | declared group → actual section | read by |
|---|---|---|---|---|---|---|---|---|
| `softWave` | soft wave amplitude | 0 | 3 | .05 | 1 | | `"Soft motion"` → **More** (overwritten by mount, B7) | updateSoftGrowth `wave` (all 13 forms) |
| `softReact` | soft audio response | 0 | 3 | .05 | 1 | | `"Soft motion"` → **More** | updateSoftGrowth `energy` multiplier |
| `softSpeed` | soft flow speed | 0 | 3 | .05 | .8 | | `"Soft motion"` → **More** | updateSoftGrowth `t = time·speed` |
| `sp:24` … `sp:36` | species name (table 2.1) | 0 | 1 | 1 | **0** | icon toggle | Species | `speciesFor()` (organism.ts:1520) |
| `sp:*` (changed) | default formula `value: e.soft ? 0 : 1` | | | | | | Species | organism.ts:373 |
| `stemDrums`, `stemBass`, `stemVoice`, `stemOther` (implicit) | unchanged labels | 0 | **37** | 1 | 0 | `['auto', …37 names]` | Stems | `speciesFor()` channel branch (organism.ts:1514-1517) |

Position in the v19 controls array (before mount's group sort): `camMode, camDistance, camSmooth, softWave, softReact, softSpeed, orbit, …` (patch_performance.py L31). Bundle byte ~1102642.

Controls read by the soft code that belong to other clusters:

| Control | Owning cluster | Status in TS |
|---|---|---|
| `shader` | TS, extended to index 31 by dynamic materials | exists (index 31 needs the dynamic-materials cluster) |
| `musicFocus`, `musicTrail` | music focus, v0.17.2 | missing in TS |
| `videoFollow` | reference, v0.16/0.17.1 | missing in TS |
| `videoMode`, `videoSize`, `videoDepth` | TS | exist in TS |

Simple-mode look values (simple-ui.js L6-7, applied through `ctls.set`; base values at L21-25):

| look | species | palette | shader | softWave | softReact | softSpeed | other |
|---|---|---|---|---|---|---|---|
| liquid | `['liquid']` | 1 | 22 tidal glass | .8 | .75 | .45 | branch .2, wiggle .5, length .75, thickness 1.2, nodes 0 |
| silk | `['silk ribbon']` | 5 | 27 silk shimmer | .65 | .7 | .35 | branch .15, wiggle .4, length .75, thickness .9, nodes 0 |
| roots / coral / neural / crystal | (rigid) | | | 0 | (unchanged) | (unchanged) | |

- Base values for every look: `speed .75, musicAmount .42, musicFocus .7, musicTrail 2, sustain .2, fillRate 240, materialSpeed .45, materialReact .65, bloom .35, pulse .15, flash .08`, plus calm camera "still" (camera locked).
- `thickness` and `nodes` have no effect on soft surfaces. `branch .2/.15` shrinks the surface, because less skeleton means less length and so a smaller size.

---

## 4. UI

### 4.1 DOM added

In v19 `index.html` L253-260, directly after `<div id="engineControls"></div>` (TS index.html:165). Inserted by patch_performance.py L55-67.

```html
<details class="sec" id="sec-fluid" open>
  <summary>Flow &amp; camera</summary><div class="body">
    <div class="row"><select id="softChoice" aria-label="Soft species">
      <option value="all">All soft species</option><option value="liquid">Liquid</option>
      <option value="ribbon">Silk ribbon</option><option value="blanket">Wave blanket</option></select>
      <button id="softOnly">Use soft species</button></div>
    <p class="note">Select, then play notes. Soft motion controls tune waves, speed and audio response. Existing species remain in Species.</p>
    <label>camera <select id="cameraPreset">…</select></label>          <!-- camera cluster, not C4 -->
    <p class="note">Middle-drag to orbit · Shift + middle-drag to pan · wheel to zoom. C cycles camera modes.</p>
  </div>
</details>
```

- `#softChoice` gets 10 more `<option value="{kind}">{name}</option>` at runtime from `extraSoftSpecies`: `extra-controls.js` L1, appended at the bundle end. Values: `jelly, kelp, manta, spiral, torus, tube, fan, pleats, droplet, disc`. The labels are the lower-case species names.
- The Species grid gains 13 icon buttons, rendered by `renderEngineControls` (main.ts:320-352). Icon clashes with existing species:
  - 🌿 kelp frond = moss
  - 🌀 spiral streamer = spirals
  - 🪸 anemone fan = corals
  - 🪭 pleated silk = sea fan
  - 💧 is used twice (liquid, liquid droplet)

  🪼 🪽 🪈 are Emoji 15.0 and render as empty boxes on Windows 10 and macOS < 13.3.
- The three sliders render in the **More** section (B7).
- v0.19 Simple-mode buttons `data-simple-look="liquid"` and `data-simple-look="silk"` live in `#simpleHome` (simple-UI cluster).

### 4.2 Handlers

`#softOnly.onclick` (`performance-ui.js` L1-11):

1. If the engine is not organism, `await selectEngine('organism')`; return if that failed.
2. `selected = #softChoice.value`.
3. For every species index `i`: `value = SPECIES[i].soft && (selected === 'all' || SPECIES[i].soft === selected) ? 1 : 0`, then `setCtl(engine.controls, 'sp:'+i, value)` and `settings.engineCtl.organism['sp:'+i] = value`. This turns **all rigid species off** with no undo.
4. `engine.respawnHeld()` (private in TS), `renderEngineControls(engine)` (full panel rebuild), `save()`.
5. `setStatus('Soft species selected — play notes or use Build shape with a reference.')`.

`#cameraPreset.onchange` (performance-ui.js L12-15) belongs to the camera cluster.

### 4.3 CSS

- No cluster-specific CSS. It reuses `.sec`, `.row`, `.note` and `.icons` (TS index.html:54-58).
- v0.19 adds `body.simple-ui #sec-fluid{display:none!important}` (patch_consolidation.py L45).

---

## 5. Integration points (minified anchor → TS location → required change)

Minified names used by this cluster:

| Minified | TS equivalent |
|---|---|
| `tw` | OrganismEngine |
| `js` | SPECIES |
| `G` / `sl` | `ctl` / `setCtl` (engine.ts:79/84) |
| `kp` | `THREE.IcosahedronGeometry` |
| `Up` | `THREE.PlaneGeometry` |
| `bf` | `reactify` (shaders.ts:56) |
| `Tc` | `MeshStandardNodeMaterial` |
| `$t` | `THREE.Mesh` |
| `A` | `THREE.Vector3` |
| **`Et`** | **`THREE.BackSide`** (see below) |
| `yi` | `THREE.DoubleSide` |
| `fn` | `THREE.FrontSide` |
| `I_` | GROWTH_SHADERS |
| `ks` | `std()` in shaders.ts |
| `xs` | `MeshBasicMaterial` |
| `he` | `settings` |
| `lR` | `renderEngineControls` |
| `Hi` | `save` |
| `vs` | `setStatus` |
| `Fm` | `selectEngine` |
| `te` | `engine` |
| `Zt` | `ctls` |
| `Y` | `$` |
| `CK` | GROUP |
| `YC` | GROUP_ORDER |

Evidence that `Et` is `THREE.BackSide`:

- The three r185 constants block at bundle byte 41538 reads `…,fn=0,Et=1,yi=2,Qo=0,Vn=1,…` (FrontSide, BackSide, DoubleSide, then NoBlending…).
- TS `look === 6 → side: THREE.BackSide, color 0x2b3550` (organism.ts:1417) compiles to `e===6?t=new xs({color:2831696,side:Et,…})`, and 0x2b3550 = 2831696.
- The TS shellMat `side: THREE.DoubleSide` (organism.ts:543) compiles to `side:yi` (byte 1110922).

| # | Patch (ver) | Exact minified anchor / insertion | TS location | What must change in TS |
|---|---|---|---|---|
| 1 | patch_performance.py L32 (0.17.0) | `label:e.name,icon:e.icon,min:0,max:1,step:1,value:1` → `…value:e.soft?0:1` (byte ~1099311) | organism.ts:373 `...SPECIES.map((sp, i) => ({ key: \`sp:${i}\`, …, value: 1 }))` | `value: sp.soft ? 0 : 1` |
| 2 | patch_performance.py L31 | `{key:"camMode",…options:[…"chase the newest growth"]}` → adds `softWave`, `softReact`, `softSpeed` with `group:"Soft motion"` | organism.ts:403 (array) and GROUP/GROUP_ORDER organism.ts:226-244 | Add the 3 controls (same keys, ranges and defaults). Add `softWave/softReact/softSpeed: 'Soft'` to `GROUP` and `'Soft'` to `GROUP_ORDER` right after `'Species'`. The `group:` field on a control is ignored because mount() overwrites it (organism.ts:571). |
| 3 | patch_performance.py L33-34 | `this.lastG=t,this.lastGTime=e.time;this.updateReference(e,t);` → inserts `this.performanceState=e;` | organism.ts:2276-2277 | Don't port. Pass `m` explicitly to the soft update from `frame()`. |
| 4 | patch_performance.py L35 | `draw(){if(this.canvas.width<2` → `draw(){this.updateSoftGrowth(this.performanceState);if(…` | organism.ts:871-872 | Don't put simulation in `draw()`. Call `this.soft.update(m, dt, …)` in `frame()` after the growth/retract loops and the plants filter (after 2482), after `hitEnv`/`uPulse` (2531-2535), and **before** the tip-glow block (2547) and the camera block (2571). The cleanest slot is right after `this.updateCoverage()` (2545). |
| 5 | patch_performance.py L43-44 | code inserted before `const LM="0.16.0"` (module scope, after the engine class) | new module(s) | Create `src/midi/engines/soft/softForms.ts` and `softSurfaces.ts` (section 8). Species go into `SPECIES` (next row). |
| 6 | soft-growth.js L1-7; soft-species-extra.js L1-12 (0.17.0 / 0.18.0) | `js.push({...js[1],name,icon,soft,hue,skin:'smooth',…})` | organism.ts:105-130 (append after `brambles`, 129) | Explicit `S({...})` entries at indices 24-36 in exactly the table-2.1 order. Add `soft?: SoftKind` to `Species` (organism.ts:58-102). No `skin:'smooth'`; leave `skin` undefined. |
| 7 | soft-growth.js L81-88 | `tw.prototype.writeSeg=function(segment,...args){if(segment.plant.sp.soft&&this.softMeshes?.has(segment.plant)){const growth=…;segment.growth=0;…` | organism.ts:1717-1773 `writeSeg` | Early branch at the top: `if (seg.plant.sp.soft && this.soft.owns(seg.plant)) { zero the 6 instanced matrices at seg.idx; return }`. Also skip soft plants in the visibility pass (organism.ts:2491-2498): `if (p.sp.soft && this.soft.owns(p)) continue`. |
| 8 | soft-growth.js L89-90 | `tw.prototype.clearGrowth=function(){this.clearSoftMeshes();return softClear.call(this);}` | organism.ts:742-747 | Add `this.soft?.clear()` inside `clearGrowth()`. |
| 9 | soft-growth.js L91-92 | `tw.prototype.unmount=function(){this.clearSoftMeshes();return softUnmount.call(this);}` | organism.ts:2776-2789 | `this.soft.dispose()` before `this.renderer?.dispose()` (2786): geometries, shared materials, instanced meshes. |
| 10 | patch_music_focus.py L52 (0.17.2) | `draw(){this.updateSoftGrowth(this.performanceState);` → `draw(){this.refreshMusicFocus();this.updateSoftGrowth(…);` | organism.ts:871 | Ordering only (music-focus cluster). The soft update runs in `frame()` and reads `focusLevel`, which only needs `lastGTime` (set at 2277). |
| 11 | patch_music_focus.py L56-58 | `item.mesh.material.color?.copy(plant.color);` → `…multiplyScalar(this.focusLevel(plant.segs[plant.segs.length-1]\|\|{plant,born:plant.birth}))` | soft layer colour | Colour = `plant.color × focusLevel(newest seg) × (plant.dying ? .45 : 1)`. Use an optional `focus` callback so C4 works before the music-focus cluster lands (default 1). |
| 12 | patch_music_focus.py L53-55 | `q.sp.glow<=0` → `(q.sp.glow<=0&&G(this.controls,"musicFocus")<=0)\|\|(q.referenceAuto&&…)` | organism.ts:2552 | Whoever ports music focus must keep soft plants out of the tip-marker loop, or place the marker at `soft.tipPoint(plant)` (the free end of a ribbon or streamer). |
| 13 | patch_dynamic_materials.py L18 (0.17.3) | `this.performanceState=e;` → `…this.updateDynamicMaterials(e);` | organism.ts:2277 | Dynamic-materials cluster. The soft update must run after it in the same frame. |
| 14 | patch_dynamic_materials.py L20-23; dynamic-material-runtime.js L15-33 | soft-growth text edits: `this.group.remove(item.mesh);…dispose();` → `this.disposeSoftItem(item);` and adds `this.syncSoftMaterial(plant,item);` before the throttle | shaders.ts / soft layer; organism.ts:783-813 `applyShaders` | Replace with **one material per soft kind** (or one shared material), rebuilt in `applyShaders()` for **every** shader index (0-31), with `side = DoubleSide`. |
| 15 | patch_species_stage.py L18-20 (0.18.0) | whole v0.17.3 `soft-growth.js` text → v0.18 text with `soft-species-extra.js` inserted before `Object.assign(tw.prototype,{` | see rows 5-6 | Port `softFormXYZ` as a pure, unit-tested function (with the fixes in section 8). |
| 16 | patch_species_stage.py L38; extra-controls.js L1 | `for(const species of extraSoftSpecies){…Y('softChoice').appendChild(option);}` | main.ts (UI) | See 8.6. Options come from `SPECIES.filter(s => s.soft)`. |
| 17 | patch_performance.py L55-67; performance-ui.js L1-11 | `#sec-fluid` markup; `Y('softOnly').onclick=…` | index.html:165; main.ts after `renderEngineControls` (306-387) | See 8.6. |
| 18 | stage-motion.js L27 (0.18.0) | `for(const [plant,item] of this.softMeshes\|\|[]){…computeBoundingBox…}` | stage cluster | Replace with the analytic `this.soft.bounds(box)` (no per-mesh `computeBoundingBox`). |
| 19 | patch_consolidation.py L45 (0.19.0) | `body.simple-ui … #sec-fluid{display:none!important}` | index.html | Simple-UI cluster. If `#sec-fluid` is removed (8.6), drop the selector. |
| 20 | simple-ui.js L6-7, L12-15 | looks `liquid` / `silk`; `simpleSpecies()` calls `ctls.set` once per species (37 × `respawnHeld`) | simple-UI cluster | Use the batch `setSpeciesMask()` (8.6). Look values in section 3. |

Ordering constraints (TS `frame()`):

1. `lastGTime` is set (2277), then the dynamic-materials update (another cluster), then events → spawn (2292-2304).
2. Grow loop (2377-2423), retract loop (2440-2479), plants filter (2482).
3. Instance counts and visibility (2483-2504). The soft plants must be excluded here.
4. hitEnv, uPulse, uFlash (2525-2535), deform (2542), seasons (2543, which updates `plant.color`).
5. **`soft.update(m, dt)`**.
6. Tip glow (2547-2569). It uses `soft.tipPoint`.
7. Camera (2571+). The centre and radius computation (2575-2591) must include `soft.bounds()`.
8. `draw()`.

`snapshot()` (889-899) must not advance the soft simulation. It will not once the update moves out of `draw()`.

---

## 6. State and lifecycle

### 6.1 Engine fields (v19, all lazily created on `tw` instances)

| field | type | set in | reset by |
|---|---|---|---|
| `performanceState` | MusicState | frame start | never (drop in TS) |
| `softMeshes` | `Map<Plant, Item>` | updateSoftGrowth | clearSoftMeshes (clear / cycle-reset / unmount) |
| `softBass`, `softTreble` | number (EMA) | updateSoftGrowth | never |
| `softUpdateCursor` | number | updateSoftGrowth | never |
| `softPoint` | `[x,y,z]` scratch | updateSoftGrowth | never |

`Item` fields:

| field | meaning |
|---|---|
| `mesh` | the soft `THREE.Mesh` |
| `base` | Float32Array copy of the rest positions |
| `last` | time of the last position update |
| `normalT` | time of the last normal recompute |
| `materialIndex` | shader index the materials were built for |
| `baseMaterial` | the plain per-plant material |
| `effectMaterial` | the per-plant animated material, if any |

### 6.2 Lifecycle

| Event | Soft behaviour |
|---|---|
| Plant created (`newPlant`) | No mesh yet. The mesh is created in the first soft update where quota and cap allow. |
| Held | Skeleton grows invisibly; size grows. |
| Released | Retraction shrinks the size; a lignified plant keeps its size; decay and recycle eventually shrink it. |
| Plant gone | Mesh and materials disposed in the same frame's update. |
| `clear()` / Reset | All meshes disposed. |
| Species toggle | `respawnHeld()` re-creates held plants (new meshes); the old ones retract and are disposed. |
| Shader change | Per-item effect material rebuilt lazily on the next frame (`syncSoftMaterial`). |
| `buildMeshes` / capacity growth | Soft meshes untouched; skeleton rewrite keeps them hidden. |
| `unmount` | All disposed before the renderer. |

### 6.3 Persistence

| Store | What it holds |
|---|---|
| `localStorage['midiviz_settings_v3'].engineCtl.organism` | `sp:24`…`sp:36`, `softWave`, `softReact`, `softSpeed` |
| Presets (`presets.ts` / `IK`) | Same keys in `engineCtl` |
| `growth-ui-mode`, `growth-good-start-v0190` | Simple-UI cluster; the first run applies Roots, not soft |

**Compatibility rule:** soft indices **must stay 24-36 in this order**, and the keys `softWave`, `softReact` and `softSpeed` must stay as they are. Otherwise v17-v19 settings and presets switch on the wrong species.

---

## 7. Bugs, weaknesses and questionable decisions

Severity: S1 = visibly broken, S2 = wrong or weak behaviour, S3 = code quality.

**B1 (S1). Soft materials are BackSide, not DoubleSide.**

- Evidence: section 5 (the constants block `fn=0,Et=1,yi=2`; the shell-look and shellMat mappings). The material is `side:Et` (soft-growth.js L34), and `item.effectMaterial.side=Et` (dynamic-material-runtime.js L24).
- three r185 `negateOnBackSide` flips normals for BackSide materials (`node_modules/three/src/nodes/display/FrontFacingNode.js:91-103`).
- The measured mean face normal at rest is +Z for blanket (0.80), manta (0.92), fan (0.95), pleats (0.71) and kelp (0.68), so from the default camera (z = +12) these sheets are **culled**.
- Disc winds the other way (−0.95), so it shows from the front and disappears from behind.
- Closed shapes (liquid, droplet, torus, tube, jelly) draw their far inner wall, lit as a concave bowl.
- `test-motion.cjs` L24 stubs `Et:2`, which hid the bug.
- Fix: `side: THREE.DoubleSide`, plus correct outward winding for the closed shapes. Cross-cluster: `reference-growth.js` L48 uses the same `side:Et` for the picture backdrop, so the reference backdrop is BackSide too. Report this to the reference-cluster owner.

**B2 (S1). Faceted liquid.**

- `IcosahedronGeometry` is non-indexed ("build non-indexed geometry", PolyhedronGeometry.js:60-72). `computeVertexNormals()` therefore yields per-face normals: the mean deviation from the smooth normal is **13.2°** on detail 2 (measured).
- v0.18 also lowered the detail from 3 to 2 (180 triangles).
- Fix: `mergeVertices(new IcosahedronGeometry(1, 5).deleteAttribute('normal').deleteAttribute('uv'))` for an indexed sphere, or analytic or GPU normals (section 8).

**B3 (S2). Lighting seams on wrapped forms.**

- Jelly, torus, tube, droplet and disc map `u ∈ [-.5,.5]` to angle `a ∈ [0, 2π]`. The first and last columns coincide (measured 17/17 rows at gap 0.0000) but are separate vertices, so `computeVertexNormals` leaves a crease.
- Torus also wraps in `v`.
- The poles of jelly and droplet, and the centres of disc and fan, collapse to one point, which gives degenerate triangles.
- Fix: dedicated indexed geometries with wrapped indices (share the seam vertices), or analytic normals.

**B4 (S1, owner constraint). Uniform, world-axis-aligned shapes.**

- Every streamer rises +Y from its root, every sheet faces ±Z, the torus lies flat in XZ, and plants differ only by phase.
- A chord of ribbons is a row of parallel vertical strips: the "uniform, kaleidoscopic" look the owner rejects.
- The engine already gives every plant a random basis `n`, `u`, `v` (organism.ts:1549-1551, 1575-1577), and the skeleton has real organic directions. Neither is used.
- Fix: in 8.3.

**B5 (S1). Surfaces grow out of frame.**

- Streamers reach 2·size = 16 units (Appendix A) while the camera frames the hidden skeleton (2.8.3).
- With the v19 Simple still camera (`calm-camera.js` L8-10, camera locked), nothing ever reframes. This matches the lead's "Silk ribbons grow mostly out of frame".
- Chase and tip glide follow invisible tips.
- Fix: `soft.bounds()` into the camera centre and radius (organism.ts:2575-2591) and into wide pulse; tip-following modes use `soft.tipPoint()`; the Simple still camera should auto-fit on first growth or use gentle orbit framing (camera cluster).

**B6 (S2). Floating tip markers.**

- Soft species have `glow:0`, but since v0.17.2 markers are drawn whenever `musicFocus > 0` (default .8; Simple .7).
- Markers land at hidden skeleton tips (up to ~16 units away from a ribbon's visible end), are depth-test off (music-focus.js L93) and cyan-tinted.
- Fix: skip soft plants, or anchor the marker on the surface tip.

**B7 (S2). "Soft motion" section never appears.**

- `mount()` sets `c.group = key.startsWith('sp:') ? 'Species' : (GROUP[c.key] ?? 'More')` (organism.ts:571; bundle byte 1111561). `CK` (GROUP) has no soft keys.
- The declared `group:"Soft motion"` is overwritten, so the 3 sliders sit at the bottom of **More**.
- The same applies to `camDistance` and `camSmooth` (camera cluster).
- Fix: add the keys to GROUP and GROUP_ORDER.

**B8 (S2). Phase jump on speed change.**

- `t = state.time * softSpeed` uses absolute time. Moving the slider from .8 to .45 at t = 600 s jumps the phase by 210 rad, so every surface snaps.
- The dynamic materials (same author) accumulate correctly: `dynamicClock += dt·speed` (dynamic-material-runtime.js L4).
- Fix: `softClock += dt * softSpeed`.

**B9 (S2). Mixed units.**

- Ribbon sway (`wave·(0.4+energy)`) and blanket z (`wave·(0.25+energy)`) are absolute world units, while their length and width scale with size.
- At size 1 the blanket (1.6 × 1.15) has ±2-unit waves (crumpled spikes); at size 8 it is nearly flat.
- The other 10 scale everything by size.
- Fix: multiply by size, or by a clamp of it.

**B10 (S1 for recordings). Stepped motion.**

- The 30 Hz cap (in practice an irregular 2/3-frame cadence at 60 fps), the 16-per-frame quota (15 Hz at 64 plants) and 15 Hz normals all give duplicated or held poses in 60 fps captures.
- Different plants step on different frames, so the result reads as judder. This is exactly the owner's recurring stutter complaint.
- Fix: GPU vertex deformation (8.4) updates every frame for free. Even on the CPU path, update every frame and budget by total vertices.

**B11 (S2). Resolution misallocated.**

- `PlaneGeometry(1,1,24,16)` puts 24 segments across `bx` and 16 along `by`.
  - Ribbon, kelp and spiral use `by` as their **length**, so a 16-unit ribbon gets 16 segments, and spiral streamer's 2 full turns get 16 segments (45° facets).
  - Their width is linear in `bx`, so 23 of the 24 width segments are useless.
  - Pleats' `sin(25u)` gets 6 samples per cycle.
- Fix: per-kind grid (for example ribbon 4 × 96, spiral 6 × 128, sheet 48 × 32, torus 48 × 24).

**B12 (S2). Per-vertex control lookups.**

- With a reference active, each vertex calls the `videoOn` getter (`ctl videoMode`), `fieldSize()` (`ctl videoSize`), `ctl('videoFollow')` and `fieldZ` (`ctl videoMode` + `videoDepth`).
- That is 5 linear `Array.find`s over ~134 controls **per vertex**: 16 meshes × 425 vertices × 5 ≈ 34k finds per frame.
- Fix: read the controls once per frame.

**B13 (S2). Per-plant materials.**

- Each soft plant gets its own `MeshStandardNodeMaterial`, plus another for the effect shader: up to 128 node materials, each built by the NodeBuilder.
- Structurally identical graphs may share pipelines, but the CPU build per material remains, and 16 new plants in one frame may hitch. **Needs browser profiling.**
- Shaders 1-21 are ignored on soft meshes, so selecting "chrome" makes the rigid species chrome and leaves the soft ones plain.
- Fix: one material per kind with per-instance colour (`instanceColor`) or `uniform().onObjectUpdate`, rebuilt in `applyShaders` for all indices.

**B14 (S1 against owner goal). Music reaction hard to see.**

- The shape has no onset, velocity or pitch response. The silent baseline `energy 0.18` keeps things moving at 30-45 % of full amplitude.
- Bands are smoothed over 1/8 s, and MIDI bass/treble follow register, not rhythm.
- The only hit response is reactify's ~0.12-0.2-unit normal swell.
- Size follows `sqrt(length)`, so a note four times longer is only twice as big.
- Torus and droplet barely move (0.013 and 0.026 units per 0.1 s at size 4, loud).
- The v19 Simple Liquid and Silk looks cut response further (`softReact .75/.7`, `softSpeed .45/.35`, `musicAmount .42`, `branch .2/.15`).

**B15 (S2). Invisible skeleton still acts.**

- Hidden segments consume budget, attract and fuse other plants (`join` .2/.15), and serve as graft roots for new rigid plants (cohesion, organism.ts:1583-1589).
- Rigid growth therefore bends toward, fuses with, and roots on empty space.
- Fix: exclude soft segments from `nearestEndpoint` (1895-1911) and graft hosts, or make the surface follow the skeleton so these events are visible (8.3).

**B16 (S2). Surfaces ignore containment.**

- They ignore shells, skin mode, organism bounds and nested `bound`.
- The video field clamp (`x,y` to the plane) shears geometry into flat walls, and the flatten factor is fixed at 0.18.

**B17 (S2). Fallback beyond 64 plants.**

- Soft plants over the cap show a different species (thin grey-ish tubes) and pop to a surface later.
- Owner: "growth should not stall at limits".
- Fix: with instancing the cap can be ~256 per kind; beyond that, recycle the oldest soft instance rather than switching representation.

**B18 (S3). Private-method and prototype coupling.**

- The code monkey-patches `writeSeg`, `clearGrowth` and `unmount` on the prototype, so behaviour depends on wrapper install order.
- `respawnHeld` (private in TS) is called from the UI.
- The species inherit by index (`{...js[1]}`), so reordering SPECIES silently changes all 13.
- Fix: explicit fields, explicit engine API.

**B19 (S2). `softOnly` UX.**

- It wipes the user's species mix with no undo.
- It writes `settings.engineCtl` directly, bypassing `setControl`, so `respawnHeld` has to be called by hand.
- It rebuilds the whole panel.
- The Simple equivalent calls `set` 37 times, which means 37 `respawnHeld`s while notes are held.

**B20 (S3). Dying plants don't dim.**

- The soft colour ignores `plant.dying` (skeleton plants use ×0.45, organism.ts:1688).
- The colour is only refreshed on a throttled update, so hidden meshes keep stale colours.

**B21 (S3). Per-frame allocations.**

- `new Set(this.plants)` and `this.plants.filter(...)` run every frame, even with no soft plants.
- `length` is recomputed as O(segs) per update.
- `frustumCulled=false` with world-space vertices means no culling is possible.

**B22 (S2 process). Tests validate stubs.**

- `test-motion.cjs` uses a 4-vertex fake geometry, `Et:2` and `bf: x=>x`. It asserts "finite", "changed", "hidden at growth 0", "disposed" and "caps".
- It cannot detect culling, flat normals, seams, framing or stutter, yet the notes describe "thirteen animated/retracting soft species" as verified.
- `test-stage-tips.cjs` does not exercise the soft bounds.
- The notes admit no browser run happened: NOTES_V0170 L73 and NOTES_FOR_CLAUDE "A browser executable was unavailable".

**B23 (S3). Documentation drift.**

- NOTES_V0180 says "a reused 24 by 16 plane grid (425 vertices)". Nothing is reused: every plant allocates its own geometry and its own `base` copy.
- It also says "Mesh creation is also bounded by the update quota". Creation itself does not increment `work`; the immediate first update does, which has the same effect.
- NOTES_V0173 says soft meshes "retain their old soft-surface behaviour" for old shaders. That is really "ignore the shader".

**B24 (S3). Skeleton flicker when more than 16 plants spawn in one frame.**

- Those plants show their thin skeleton tube for one or more frames before their mesh is created.

**B25 (S3). Icons and names.**

- Duplicate or confusable icons and names: kelp vs kelp frond, anemone vs anemone fan, liquid vs liquid droplet, and the shared icons listed in 4.1.
- Emoji 15 glyphs are missing on older OSes.

---

## 8. Recommended TypeScript design

### 8.1 Principles

- Port the **species contract**: 13 entries at indices 24-36, keys `soft*`, default off.
- Port the **formulas** as a pure, tested library.
- Do **not** port:
  - prototype wrapping;
  - `draw()`-time simulation;
  - `performanceState`;
  - the `growth=0` writeSeg hack;
  - BackSide;
  - non-indexed geometry;
  - the 30 Hz / 16-per-frame / 64-mesh throttling;
  - per-plant materials;
  - per-vertex `ctl` lookups;
  - `{...js[1]}`;
  - `skin:'smooth'`;
  - the `#sec-fluid` / `softOnly` UI as it stands.
- Keep all v19 parameter constants as the **default look**. Make orientation, framing and music reaction better on top of them.

### 8.2 Types and modules

```ts
// src/midi/engines/soft/softForms.ts — pure math, no three.js import, unit-tested
export type SoftKind = 'liquid'|'ribbon'|'blanket'|'jelly'|'kelp'|'manta'|'spiral'|'torus'|'tube'|'fan'|'pleats'|'droplet'|'disc'
export interface SoftParams { size: number; t: number; wave: number; energy: number; kick: number }  // t = accumulated clock + phase
export interface SoftFormDef {
  base: 'sphere' | 'grid'
  grid: [uSegs: number, vSegs: number]      // per-kind resolution (B11)
  wrapU?: boolean; wrapV?: boolean          // share seam vertices (B3)
  anchor: 'center' | 'base'                 // streamers start at the root, blobs are centred
  axis: 'up' | 'normal'                     // which local axis to align with the plant frame
  eval(u: number, v: number, p: SoftParams, out: Float32Array | number[], o?: number): void  // local, already × size
  extent(size: number, out: {min: [n,n,n]; max: [n,n,n]}): void   // analytic local AABB (camera / bounce)
}
export const SOFT_FORMS: Record<SoftKind, SoftFormDef>
```

- Formulas are copied from 2.3 verbatim, with two changes:
  1. Ribbon sway and blanket z are multiplied by `min(size, 2)`, which makes them size-relative (B9). Keep a `legacyUnits` flag only if the owner prefers the old look.
  2. An optional `kick` term per kind (8.5).
- `Species` gets `soft?: SoftKind`, and the soft entries are written out explicitly in SPECIES (row 6 of section 5).

```ts
// src/midi/engines/soft/softSurfaces.ts — owns all GPU resources for soft plants
export class SoftSurfaces {
  constructor(parent: THREE.Group)
  owns(p: Plant): boolean
  update(m: MusicState, plants: readonly Plant[], ctx: {
    wave: number; react: number; speed: number; hitEnv: number
    focus?: (p: Plant) => number                 // music-focus cluster hook (default 1)
    project?: (x: number, y: number, z: number, out: THREE.Vector3) => void  // reference hook
  }): void
  bounds(out: THREE.Box3): boolean               // union of analytic plant AABBs (camera, bounce)
  tipPoint(p: Plant, out: THREE.Vector3): boolean // free end for streamers, top for blobs
  setShader(make: () => THREE.Material | null, sideFix?: boolean): void // from applyShaders(), all indices
  clear(): void; dispose(): void
}
```

`OrganismEngine` owns `private soft = new SoftSurfaces(this.group)` and wires it in as in section 5 rows 4, 7, 8, 9 and 14.

### 8.3 Orientation and placement (fixes B4 and B5)

- **Per-plant frame:** use the plant's random basis `(u, v, n)` from newPlant (organism.ts:1549-1551).
  - Streamers (ribbon, kelp, spiral, tube) point along the skeleton's main direction: normalised `(newestTipPos − root)`, falling back to `n`. Smooth it per frame (slerp, ≈ 2/s) so it doesn't jitter.
  - Sheets and discs (blanket, manta, fan, pleats, disc) face along `n`.
  - Liquid, droplet, jelly and torus use `n` as their up axis.

  This keeps each plant distinct and follows the organic growth. It also costs nothing: one quaternion per plant.
- **Recommended upgrade, "follow the skeleton"** (tier 3, but it has the biggest payoff for "complex 3D growth"): for ribbon, kelp and tube, sweep the cross-section along the plant's **leader polyline** instead of a straight +Y line.
  - Data: add `trail: THREE.Vector3[]` to `Tip` for soft plants. `startSegment` and `finishSegment` push `seg.b`. A branch copies the parent's current point.
  - `removeSeg` pops the owning trail. Store `seg.trail` and `seg.trailIdx`; retraction always removes the newest non-permanent segment first (organism.ts:2443-2448), so trails shrink from the tip.
  - Resample the trail to N points (N ≤ 128) and build parallel-transport frames. Ribbon width and twist come from the v19 formulas using arc length `along`.
  - The surface then literally grows, curls and retracts with the notes, and fusion and attraction become visible.
  - For blanket and manta, the membrane can be lofted between the first two tips' trails (a bat-wing or seaweed-blade look). For fan, triangulate from the root across the tip trails.
- **Framing:** `bounds()` = the union over plants of the analytic `extent(size)` transformed by the plant frame, plus the root. The camera centre and radius (organism.ts:2575-2591) take the union of the skeleton (non-soft plants only) and `soft.bounds()`. The wide-pulse and bounce modules call `soft.bounds()` instead of `computeBoundingBox`.

### 8.4 Rendering (fixes B1-B3, B10-B13, B17, B21)

**Tier 2 (recommended): GPU deformation, one InstancedMesh per kind.**

- Geometry: one static, indexed grid per kind (resolution from `SOFT_FORMS[kind].grid`, seams shared), holding `(u, v)` as attributes. Liquid, droplet and jelly use a merged icosphere or UV-sphere topology.
- Per-instance attributes (`instancedDynamicBufferAttribute`, three r185 `src/nodes/accessors/Instance.js` / `BufferAttributeNode.js`): `size`, `phase`, `energy`, `kick`, orientation (use `instanceMatrix` for root + rotation), `instanceColor` (colour × focus × dying).
- Shared uniforms: `softClock`, `wave`.
- `positionNode` = the TSL port of `eval(u, v)` in local space.
- `normalNode` = normalize(cross(∂p/∂u, ∂p/∂v)) by finite differences in TSL. Evaluate `eval` at `u + ε` and `v + ε`, with ε = 1/(2·segments). That costs 3× the vertex math and gives smooth, seam-free normals every frame.
- Material: one per kind, from `GROWTH_SHADERS[shader].make() ?? new MeshStandardNodeMaterial({roughness, metalness})`, then `reactify`, then `side = DoubleSide`. Liquid roughness .16 / metalness .25; the rest .45 / .08.

  `reactify`'s `positionNode` would be overwritten, so compose instead: `positionNode = softPos.add(normalLocal.mul(uPulse))`.
- Result:
  - 13 draw calls maximum;
  - no CPU vertex loop;
  - every frame at display rate (no 30 Hz stepping, good for recordings);
  - capacity of about 256 instances per kind;
  - every shader applies.

  The TSL also compiles to the WebGL2 fallback (Safari and Firefox).
- CPU fallback (keep it for unit tests and as an emergency toggle): the same `eval`, every frame, capped by **total vertices per frame** (for example 60k) rather than per-mesh 30 Hz. Read controls once per frame (B12). Indexed geometry; `computeVertexNormals` every update.
- The path-following sweeps (8.3) need per-frame CPU geometry anyway (N × 2-8 vertices). Build them on the CPU into a pooled `BufferGeometry` per plant and do the flutter in TSL.

**Tier 3 (optional) liquid:** make "Liquid" actually liquid. Use a single shared `MarchingCubes` (`three/examples/jsm/objects/MarchingCubes.js`, present in r185) with blobs at the soft skeleton joints, so the blobs of different notes merge. Resolution 28-36, updated every frame, one material. Budget about 1-2 ms CPU; gate it behind auto-quality.

### 8.5 Music mapping (fixes B14; the owner wants it "obvious")

Keep the v19 parameters as the starting point, and add:

- `kick` per plant: `kick = max(kick · e^(−7dt), velocity)` on the plant's own note-on and on onsets while held. This matches the `hitEnv` constants (organism.ts:2531).

  Visual effects per kind, applied through the `kick` term:
  - liquid: pulse amplitude +0.35·kick;
  - jelly: contraction, `lat` scale −0.2·kick;
  - ribbon, kelp: travelling wave launched from the root;
  - torus: tube radius +0.5·kick;
  - disc, fan: a ring impulse `sin(12r − t)` gated by kick.
- Silent baseline: set energy `0.18 → 0.05`, so a still room looks still and sound visibly animates it. Expose the baseline as `softIdle` (0-0.3, default 0.05).
- Pitch: the per-plant frequency multiplier `0.8 + 0.4·octN`. High notes ripple finer.
- Size: `size = min(8, 0.8·sqrt(length))` plus `0.15·size·kick` for an instant "bloom" on attack. Reading growth directly from the skeleton keeps note duration mapped to size.
- Accumulated clock: `softClock += dt · softSpeed · (1 + 0.5·energy)` (fixes B8 and adds tempo feel).

### 8.6 Controls and UI

Engine controls:

- Keep `softWave` (0-3, .05, 1), `softReact` (0-3, .05, 1) and `softSpeed` (0-3, .05, .8) with the same keys.
- Add optional `softIdle` (0-0.3, .01, .05) and `softFollow` (0/1, default 1: orient to the skeleton; 0 = legacy upright).
- All of them go into a new `'Soft'` group, inserted into `GROUP_ORDER` after `'Species'`.

Species UI:

- Remove `#sec-fluid`. Its camera select belongs to the camera cluster.
- In `renderEngineControls` (main.ts:320-352), when rendering the Species icon grid, add a second button row: `rigid only`, `soft only`, `+soft` / `−soft`. These call a new engine method:

  ```ts
  setSpeciesMask(mask: (sp: Species, i: number) => boolean) // sets all sp:i, calls respawnHeld ONCE,
                                                           // fires onControlValue for each changed key
  ```

  main.ts then syncs the widgets through `ctls.get(id)?.sync?.(v)` with no full panel rebuild, and saves once. This fixes B19.
- Keep the kind picker (`#softChoice` equivalent) only if the owner wants "only this soft kind". It is equivalent to clicking one icon after "none".
- Give the soft icons unique, widely supported glyphs, or render SVG. Suggestions: 🫧 liquid, 🎐 ribbon, 🌊 blanket, 🎐/🪼 jelly (keep a fallback), 🌱 kelp frond, 🦋 manta, 🌀 spiral, ⭕ torus, 🧪 tube, 🪸 fan, 🎏 pleats, 💧 droplet, 💿 disc. Owner's call.

### 8.7 Not to port as-is

| v19 item | Reason |
|---|---|
| `performanceState` | Pass `m`. |
| `updateSoftGrowth` inside `draw()` | Wrong phase, and it makes the camera blind to soft surfaces. |
| `writeSeg` growth=0 wrapper | Explicit branch instead. |
| `side:Et` | BackSide. |
| `IcosahedronGeometry(1,2)` + `computeVertexNormals` | Flat normals. |
| `PlaneGeometry(1,1,24,16)` for every kind | Resolution misallocated. |
| 16-per-frame / 30 Hz / 15 Hz throttles | Stutter. |
| Per-plant `MeshStandardNodeMaterial` + effect material | Material explosion; shaders 1-21 ignored. |
| `{...js[1]}` | Fragile inheritance. |
| `skin:'smooth'` | Illegal type value. |
| `softOnly` wiping all species | UX. |
| `stage-motion.js` per-mesh `computeBoundingBox` | Use analytic bounds. |
| `test-motion.cjs` soft section | Replace with the tests in section 9. |

---

## 9. Acceptance tests

### 9.1 Unit-testable (vitest or node, no GPU)

1. **Species table:**
   - SPECIES has 37 entries; indices 24-36 are `liquid, silk ribbon, wave blanket, jelly bell, kelp frond, manta sail, spiral streamer, breathing torus, wave tube, anemone fan, pleated silk, liquid droplet, ripple disc` with the `soft` kinds from table 2.1.
   - Each soft entry has explicit skeleton fields equal to group A or B.
   - No entry has `skin === 'smooth'`.
   - `controls` `sp:24..36` default 0; `sp:0..23` default 1.
2. **Controls:**
   - `softWave` / `softReact` / `softSpeed` exist with the ranges and defaults from section 3.
   - After `mount()` their `group === 'Soft'`, and `GROUP_ORDER` contains `'Soft'` after `'Species'` (regression for B7).
3. **Forms** (`softForms.ts`), for each of the 13 kinds over a u,v grid, t ∈ {0, 1.7, 10}, energy ∈ {0.05, 1.13}, wave ∈ {0, 1, 3}:
   - all outputs are finite;
   - positions scale linearly with size: `eval(size=2) == 2·eval(size=1)` within 1e-9 (regression for B9);
   - wrapped kinds give `eval(u=-.5) == eval(u=+.5)` for every v, and torus also in v;
   - `extent(size)` contains every sampled vertex;
   - with the idle baseline and `kick = 0`, the silent amplitude is ≤ 30 % of the loud amplitude, and `kick = 1` raises the maximum displacement by ≥ 25 % (B14).
4. **Clock continuity:** changing `softSpeed` from 0.8 to 0.45 at t = 600 s changes `softClock` by < `dt·3` in the next frame (B8).
5. **Skeleton hiding:** with a soft plant owned by `SoftSurfaces`, every `writeSeg` call path (addSeg, grow, finishSegment, removeSeg swap, deform with offsets, growCapacity, attach) writes zero-scale matrices for that plant's `seg.idx` in all six instanced meshes. Test with a fake InstancedMesh recording `setMatrixAt`.
6. **Visibility pass:** a scene of only soft plants leaves `segMesh.visible === false` and `sphereMesh.visible === false`.
7. **Lifecycle and leaks:** instrument `dispose()` on geometry and materials.
   - Spawn 300 soft plants across all kinds, retract them all, `clear()`, `unmount()`: every created GPU resource is disposed exactly once.
   - Material count ≤ number of kinds in use (+1 per `setShader`).
   - Switching `shader` 0 → 22 → 5 → 31 → 0 leaves no undisposed materials, and soft meshes use shader 5 too (B13).
8. **Tip markers:** with `musicFocus > 0`, the tip-glow loop does not place markers at hidden skeleton tips of soft plants (B6). Either they are skipped, or the marker position equals `soft.tipPoint(plant)`.
9. **Bounds:** `soft.bounds()` for a plant at root (3,0,0) with size 8 and the ribbon kind in legacy upright mode includes y = 16. The camera radius computed in `frame()` is ≥ the soft bounds radius (B5).
10. **Persistence:** loading v19 settings JSON with `engineCtl.organism = {'sp:25': 1, 'sp:3': 0, softWave: .65}` enables silk ribbon, disables lightning and sets the slider to .65.
11. **`setSpeciesMask`:** a single call with held notes invokes `respawnHeld` exactly once and emits `onControlValue` only for changed keys.
12. **Perf guard (CPU fallback):** 64 soft plants × 13 kinds use ≤ 60k vertex evaluations per frame, and there is no `ctl()` call inside the vertex loop (spy on `ctl`).

### 9.2 Needs a browser (Chrome WebGPU and Chrome `forceWebGL`; spot-check Safari and Firefox)

1. **Visible from all sides** (B1): for each kind, spawn one plant at the origin (size ≈ 4) and render from 6 camera directions (±X, ±Y, ±Z). The non-black pixel count is > 1 % of the frame in all 6 views.
2. **Smooth liquid** (B2): the luminance gradient across the blob has no facet edges. Automated check: the maximum angle between adjacent pixels' reconstructed normals is < 10° away from silhouettes. A visual check is also acceptable.
3. **No seams** (B3): torus, tube, jelly, droplet and disc under a rotating directional light show no vertical crease line.
4. **Organic, non-uniform** (B4): a 4-note chord of silk ribbon gives 4 ribbons with pairwise orientation difference > 20°. They follow the skeleton when `softFollow = 1`.
5. **Framing** (B5): Simple → Silk, hold a 3-note chord for 2 s. All ribbon vertices are inside the viewport in "still" (auto-fit) and orbit modes. Tip glide and chase target the visible ribbon end.
6. **Stutter** (B10): record 10 s at 60 fps with 40 soft plants. Frame-difference analysis of the ribbon region shows no repeated frames (per-frame motion > 0 for ≥ 98 % of frames). ffprobe shows CFR (recording cluster).
7. **Performance:** on the owner's weak laptop at 1080p, 64 soft plants mixed with rigid growth run at ≥ 55 fps (auto quality on). The CPU frame time spent in `soft.update` is < 1.5 ms (Performance panel).
8. **Music legibility** (B14): with MIDI, staccato notes on a held soft chord produce a visible pulse per note. In silence the surfaces settle to ≤ 30 % of their loud motion within 1 s. Side-by-side with v19, the owner can tell loud from quiet at a glance.
9. **Materials:** every growth shader 0-31 visibly applies to soft surfaces. Switching shaders 10 times in 5 s gives no hitch longer than 50 ms after the first compile of each shader.
10. **Reference and skin:** with a picture reference in depth mode, soft surfaces sit on the relief without flat clamped walls. In shell mode the surfaces stay inside the shell, or are clipped by `soft.bounds` scaling (owner decision).
11. **Reset and unmount:** `renderer.info.memory.geometries` and `.textures` return to their pre-spawn baseline after Reset and after switching to another engine and back.

---

## Appendix A: Measured extents (numeric harness, real three r185 geometry)

Local coordinates relative to `plant.root`, wave = 1, react = 1, sampled over 40 time steps × energy {0.18, 1.13}. Motion is the maximum vertex displacement per 0.1 s, silent → loud.

| kind | size 1 (x / y / z) | size 4 (x / y / z) | size 8 (x / y / z) | motion/0.1 s at size 4 |
|---|---|---|---|---|
| liquid | ±0.6 / ±0.6 / ±0.6 | ±2.5 / ±2.5 / ±2.5 | ±5.0 / ±5.0 / ±5.0 | 0.042 → 0.089 |
| ribbon | ±1.6 / 0…2 / ±1.5 | ±2.0 / 0…8 / ±1.9 | ±2.4 / 0…16 / ±2.3 | 0.041 → 0.083 |
| blanket | ±0.8 / ±0.57 / ±2.0 | ±3.2 / ±2.3 / ±2.0 | ±6.4 / ±4.6 / ±2.0 | 0.067 → 0.214 |
| jelly | ±0.72 / −0.22…0.70 / ±0.72 | ±2.9 / −0.9…2.8 / ±2.9 | ±5.8 / −1.8…5.6 / ±5.8 | 0.033 → 0.064 |
| kelp | ±0.34 / 0…2 / ±0.75 | ±1.35 / 0…8 / ±3.0 | ±2.7 / 0…16 / ±6.0 | 0.148 → 0.299 |
| manta | ±1 / −0.4…0.55 / −0.78…0.87 | ±4 / −1.6…2.2 / −3.1…3.5 | ±8 / −3.2…4.4 / −6.3…7.0 | 0.069 → 0.186 |
| spiral | ±0.46 / 0…1.8 / ±0.52 | ±1.84 / 0…7.2 / ±2.1 | ±3.7 / 0…14.4 / ±4.2 | 0.056 → 0.078 |
| torus | ±0.81 / ±0.21 / ±0.81 | ±3.25 / ±0.85 / ±3.25 | ±6.5 / ±1.7 / ±6.5 | 0.005 → 0.013 |
| tube | ±0.48 / 0…1.8 / ±0.39 | ±1.9 / 0…7.2 / ±1.55 | ±3.8 / 0…14.4 / ±3.1 | 0.034 → 0.091 |
| fan | ±0.95 / −0.67…0.95 / ±0.24 | ±3.8 / −2.7…3.8 / ±0.96 | ±7.6 / −5.4…7.6 / ±1.9 | 0.035 → 0.095 |
| pleats | ±0.8 / ±0.65 / ±0.33 | ±3.2 / ±2.6 / ±1.32 | ±6.4 / ±5.2 / ±2.65 | 0.045 → 0.098 |
| droplet | ±0.62 / ±0.9 / ±0.55 | ±2.5 / ±3.6 / ±2.2 | ±4.9 / ±7.2 / ±4.4 | 0.010 → 0.026 |
| disc | ±0.85 / ±0.85 / ±0.18 | ±3.4 / ±3.4 / ±0.72 | ±6.8 / ±6.8 / ±1.44 | 0.037 → 0.101 |

Other measurements:

- Deformation amplitude ratio, loud over silent, at size 4: liquid 2.12, ribbon 2.77, blanket 3.21, the other ten 2.71.
- Mean face normal at rest: blanket (−0.05, 0, 0.80), manta (0, 0, 0.92), disc (0, 0, −0.95), fan (0.03, 0, 0.95), pleats (−0.03, 0, 0.71), ribbon (−0.69, 0.05, 0.27), kelp (0.02, 0.03, 0.68).
- `IcosahedronGeometry(1,2)`: 540 vertices, non-indexed, 180 triangles. After `computeVertexNormals` the mean deviation from the smooth normal is 13.23° (max 13.68°).
- `PlaneGeometry(1,1,24,16)`: 425 vertices, indexed, 768 triangles.
- Seam: jelly, torus, tube, droplet and disc have 17/17 rows with coincident but unshared vertices at u = ±0.5.

## Appendix B: Harness (to reproduce; run with node ≥ 20 from any directory)

```js
// extents.mjs — imports three from the TS repo's node_modules (read-only)
import * as THREE from 'file:///C:/Users/User/Desktop/code/growth-midi-visualiser/node_modules/three/build/three.module.js';
import fs from 'node:fs';
const extra = fs.readFileSync('C:/Users/User/Downloads/growth-v0190/maintenance/soft-species-extra.js','utf8');
const { softFormXYZ, extraSoftSpecies } = new Function('js', extra + '\nreturn {softFormXYZ, extraSoftSpecies};')([{},{}]);
const plane = new THREE.PlaneGeometry(1,1,24,16), ico = new THREE.IcosahedronGeometry(1,2);
function formPoint(kind,bx,by,bz,size,t,phase,wave,energy,out){
  if(kind==='liquid'){const pulse=1+wave*(.12+energy*.18)*(Math.sin(bx*3+t+phase)*Math.cos(by*2-t*.7)+.45*Math.sin(bz*4+t*1.2));const r=size*.45;out[0]=bx*r*pulse;out[1]=by*r*pulse;out[2]=bz*r*pulse;return}
  if(kind==='ribbon'){const along=(by+.5)*size*2,twist=along*.6+Math.sin(t*.4+phase)*.7,width=Math.min(1.4,size*.2)*bx*(1+.25*Math.sin(along*1.1+t));
    out[0]=Math.sin(along*.55-t*.45+phase)*wave*(.4+energy)+Math.cos(twist)*width;out[1]=along;out[2]=Math.cos(along*.4-t*.3+phase)*wave*(.3+energy)+Math.sin(twist)*width;return}
  if(kind==='blanket'){out[0]=bx*size*1.6;out[1]=by*size*1.15;out[2]=wave*(.25+energy)*(Math.sin(bx*5+t+phase)*Math.cos(by*4-t*.7)+.45*Math.sin((bx+by)*8-t*1.3));return}
  softFormXYZ(kind,bx,by,size,t,phase,wave,energy,out);
}
// 1) extents: loop kinds × size {1,4,8} × energy {.18,1.13} × 40 time steps over base vertices, track min/max
// 2) flat normals: ico.clone().computeVertexNormals(); compare each normal with normalize(position)
// 3) seams: compare formPoint at grid column 0 and 24 for each of the 17 rows
// 4) face orientation: deform a plane clone at rest, computeVertexNormals, average the normal
```
