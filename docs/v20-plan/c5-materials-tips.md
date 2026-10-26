# C5: Animated surface materials, tip marker shapes, and the v0.17.3/v0.18.0 extra controls (porting spec)

Target: port into the TypeScript source `C:\Users\User\Desktop\code\growth-midi-visualiser` (tag v0.15.0).
Evidence base: v19 compiled-patch lineage in `C:\Users\User\Downloads\growth-v0190`.

Conventions in this report:
- `TS organism.ts:NNN` = `src/midi/engines/organism.ts` line NNN at tag v0.15.0 (2790 lines).
- `TS shaders.ts:NNN` = `src/midi/shaders.ts`; `TS main.ts:NNN` = `src/midi/main.ts`; `TS index.html:NNN` = repo-root `index.html`.
- `v19 <file>:NN` = `C:\Users\User\Downloads\growth-v0190\maintenance\<file>` line NN.
- `bundle@<byte>` = byte offset in `C:\Users\User\Downloads\growth-v0190\assets\index-BWYXfAkm.js` (v0.19.0 build).
- The minified names are listed in Appendix A.

Files read for this report: dynamic-materials.js, dynamic-material-runtime.js, dynamic-material-ui.js, tip-shapes.js, extra-controls.js, patch_dynamic_materials.py, patch_species_stage.py, test-dynamic-materials.cjs, test-stage-tips.cjs, NOTES_V0173.md, NOTES_V0180.md, START_HERE_v0180.md, NOTES_FOR_CLAUDE.md, START_HERE_v0190.md, custom-tip-example.obj, plus supporting context: soft-growth.js, soft-species-extra.js (head), stage-motion.js, music-focus.js, reference-ui.js, simple-ui.js, patch_consolidation.py, recording-ui.js (grep), v19 index.html, and the TS files shaders.ts, organism.ts, engine.ts, main.ts, presets.ts, version.ts, index.html, music.ts (MusicState). Both existing node tests were run read-only and both pass (output in section 9).

---

## 1. Summary

### What the cluster does for the user
1. **Ten animated surface materials** (v0.17.3). Ten GPU node materials are appended to the growth-shader list at indices 22–31: tidal glass, pearl currents, mercury ribbons, biolume, oil slick, silk shimmer, molten gold, ripple rings, aurora weave, electric filaments. They are cheap world-space sine patterns. Their animation clock, pattern scale and audio response are driven by three new sliders. They apply to rigid instanced growth through the existing `shader` control. On the v0.16 soft species (liquid / silk ribbon / wave blanket, plus the ten v0.18 soft species) they apply through a per-plant "effect material". The original 22 shaders are not applied to soft species.
2. **Material runtime** (v0.17.3). Once per frame the engine advances the shared clock, sets the scale, and computes a smoothed energy value and a decaying attack envelope. Silence gating stops the beat tracker's predicted beats from flashing the surface.
3. **Material quick UI** (v0.17.3). An "Animated materials" card at the top of the panel holds a material `<select>` (all 32 shaders), a "Next new" button that cycles only the ten new ones, and three sliders. The card mirrors the engine controls through a 400 ms polling loop.
4. **Tip marker shapes** (v0.18.0). The bright markers drawn at live growing tips (the existing `tipMesh`, 200 instances) can be sphere, cube, diamond, cone, ring, disc, hexagon, star, heart, a custom image (PNG/WebP/JPG, a camera-facing 256² textured quad) or a custom OBJ (at most 2,048 triangles). New controls set marker size, brightness and visible-marker limit. Flat shapes face the camera.
5. **Extra controls** (v0.18.0). A "Screen bounce & tip shapes" card holds a DVD-logo-style "bounce sculpture around screen" toggle with speed and size sliders (it changes only the projection matrix), the tip controls and the file upload. The card's script also adds the ten extra soft species to the `softChoice` menu, and two recording buttons ("Editor MP4 settings", "Recording report") plus an "MP4 editor compatibility" checkbox. Those three belong to the recording cluster (see §2.9 and §7).

### Version provenance
| Version | Builder | What it added for this cluster |
|---|---|---|
| v0.17.3 | `maintenance/patch_dynamic_materials.py` (input hash `8d7464…804a`, the v0.17.2 bundle) | dynamic-materials.js (catalogue), dynamic-material-runtime.js, 3 controls, soft-growth edits (syncSoftMaterial / disposeSoftItem), "Animated materials" HTML card, dynamic-material-ui.js |
| v0.18.0 | `maintenance/patch_species_stage.py` (input hash `3d0473…3aca3a`, the v0.17.3 bundle) | tip-shapes.js, stage-motion.js (screen bounce), draw wrapper, 7 controls, 5 tip-loop edits, "Screen bounce & tip shapes" HTML card, record buttons, extra-controls.js |
| v0.19.0 | `maintenance/patch_consolidation.py` | Gave the two cards ids `sec-specialist-motion` / `sec-specialist-materials`, removed their `open` attribute, hid both in Simple mode. The Simple "Liquid" look uses shader 22 (tidal glass) and "Silk" uses shader 27 (silk shimmer). All looks set `materialSpeed .45`, `materialReact .65`, `screenBounce 0` (v19 simple-ui.js:2-7, 21-25). |

**None of v0.16–v0.19 was ever rendered in a browser** (NOTES_V0173 "Live WebGPU/WebGL rendering … not verified"; NOTES_FOR_CLAUDE "A browser executable was unavailable"). The node tests use stubs for every three.js/TSL symbol. That matters because the most serious defect in this cluster, the `Et` = BackSide constant (§7 B1), is hidden by a test stub.

### Diff vs v0.15.0 TS (what is new relative to the port target)
- `GROWTH_SHADERS` (TS shaders.ts:97-212) has 22 entries (indices 0–21). v19 has 32, and the ten new ones append without renumbering.
- TS has no material speed/scale/react uniforms. v19 adds 4 module-level uniforms.
- TS has no soft species. v19's soft material path depends on the soft-species cluster (v0.16 `soft-growth.js`, v0.18 `soft-species-extra.js`).
- TS tip loop (organism.ts:2547-2569) always draws `IcosahedronGeometry(1,1)` markers with identity rotation, scale `tip.r*(1.5+.8*onset)*glow*sp.glow`, and colour `plantColor*1.6+0.35`, capped at `MAX_TIPS=200`. v19 changes shape, orientation, scale, colour and cap. It also layers the music-focus changes on top (another cluster: minimum on-screen size, cyan lerp, `depthTest=false`).
- TS `draw()` (organism.ts:871-879) has no projection-matrix manipulation. v19 wraps it for screen bounce.
- TS `unmount()` (organism.ts:2776-2789) has no upload disposal. v19 wraps it.
- 10 new engine controls. TS `GROUP` (organism.ts:227-243) has no entries for them, so in v19 they all fall into the auto-generated **"More"** section, as well as appearing in the quick cards.

---

## 2. Behaviours

### 2.1 Shared material helpers (v19 dynamic-materials.js:3-10)

```
dynamicMaterialStart = GROWTH_SHADERS.length           // 22 at module evaluation
uClock  = uniform(0)   // dynamicClock
uScale  = uniform(1)   // dynamicScale
uAudio  = uniform(0)   // dynamicAudio  (smoothed energy × react)
uAttack = uniform(0)   // dynamicAttack (attack envelope × react)
wave(n) = sin(n) * 0.5 + 0.5                            // "dynamicWave", range 0..1
surface(mask, low, high, roughness, metalness, glow = 0.15):
  m     = clamp(mask, 0, 1)
  tint  = mix(vec3(low), vec3(high), m) * materialColor // materialColor = the material's own .color uniform
  return std({ colorNode: tint, roughness, metalness,
               emissiveNode: diffuseColor.rgb * m * (uAudio*0.25 + glow) })
```
- `std` is the existing TS helper `std()` (shaders.ts:86-95), minified `ks`: `new MeshStandardNodeMaterial()`, `roughness ?? .5`, `metalness ?? .1`, plus the optional nodes.
- `p = positionWorld * uScale` and `t = uClock` in every entry. Patterns are in **world space**: they do not move with the growth. Screen bounce does not affect them because it changes only the projection.
- `diffuseColor` already includes the instance colour on instanced meshes (three r185 `NodeMaterial.setupDiffuseColor`: `colorNode * instanceColor`, node_modules/three/src/materials/nodes/NodeMaterial.js:834-860). The emissive term is therefore tinted by the plant colour, and the recent-growth emphasis written into instance colours carries through.
- `materialColor` is white on the rigid shared material. On soft meshes it becomes the plant colour, because soft-growth.js:44 copies `plant.color × focusLevel` into whatever material the soft mesh currently has.
- Design constraints the author imposed (and the test asserts, test-dynamic-materials.cjs:28-29): ≤100 arithmetic nodes, ≤6 `sin` nodes, no `transparent`, no `transmission`, no `positionNode` set by make(). `reactify` (minified `bf`) later adds the pulse `positionNode` and the flash emissive.

### 2.2 The ten materials (exact formulas, v19 dynamic-materials.js:11-69)
Notation: `p = positionWorld*uScale`, `t = uClock`, `S = smoothstep(lo, hi, x)`. Colours are `[r,g,b]`. The `glow` column is the base emissive at silence. "Audio inputs" lists which uniforms change the look.

| idx | name | mask formula | low colour | high colour | rough | metal | glow | audio inputs | sin nodes* | arith nodes* |
|---|---|---|---|---|---|---|---|---|---|---|
| 22 | tidal glass | `wave(p.x*2 + t + sin(p.z*2 - t*0.7))` | .025,.12,.2 | .35,.95,1 | .19 | .32 | .15 | uAudio (emissive) | 2 | 22 |
| 23 | pearl currents | `wave(p.y*2.5 - t*0.6 + sin((p.x+p.z)*1.4 + t)*2)` | .24,.15,.32 | 1,.85,.72 | .28 | .48 | .05 | uAudio | 2 | 24 |
| 24 | mercury ribbons | `warp=sin(p.z*2 + t*0.4)`; `S(.35,.65, wave(p.x*3 + p.y - t + warp))` | .035,.055,.09 | .85,.95,1 | .16 | .9 | .07 | uAudio | 2 | 24 |
| 25 | biolume | `dots = wave(p.x*3+t)*wave(p.y*3.7 - t*0.8)*wave(p.z*2 + t*0.3)`; `S(.32,.8,dots) * (uAttack*0.5 + 0.5)` | .015,.06,.08 | .2,1,.55 | .45 | .12 | .65 | uAudio + **uAttack** (colour and emissive) | 3 | 35 |
| 26 | oil slick | *not via surface()*: `colorNode = (hue(h)*0.8 + 0.12) * materialColor`, `h = p.x*0.12 + p.z*0.09 + wave(p.y + t*0.4)*0.3 + t*0.08`; `emissive = diffuseColor.rgb*(uAudio*0.18 + 0.08)` | — | — | .22 | .7 | .08 | uAudio | 1 | 19 |
| 27 | silk shimmer | `warp = wave(p.x*4 + sin(p.y*1.2 - t))`; `weft = wave(p.z*4 + t*0.7)`; mask `warp*weft*0.65 + warp*0.35` | .12,.025,.2 | 1,.48,.7 | .52 | .15 | .08 | uAudio | 3 | 30 |
| 28 | molten gold | `wave(p.y*2 - t + sin(p.x*1.8 + t*0.6) + sin(p.z*1.3 - t*0.4))` | .18,.035,.005 | 1,.72,.12 | .24 | .72 | .24 | uAudio | 3 | 27 |
| 29 | ripple rings | `r = length(p.xz)`; `ring = wave(r*3 - t*1.6 + p.y*0.7 + uAttack*0.4)`; mask `S(.35,.8,ring)` | .015,.07,.16 | .2,.65,1 | .32 | .38 | .22 | uAudio + **uAttack** (phase kick) | 1 | 23 |
| 30 | aurora weave | `curtain = wave(p.x*1.7 + sin(p.y*0.8 + t*0.6)*2 + t*0.4)`; `drift = wave(p.z*1.5 - t*0.35)`; mask `curtain*0.7 + drift*0.3` | .14,.015,.3 | .15,1,.62 | .4 | .2 | .3 | uAudio | 3 | 33 |
| 31 | electric filaments | `path = wave(p.y*3 + sin(p.x*2 - t)*2 + sin(p.z*2 + t*0.7))`; mask `S(.72,.96,path)` | .025,.018,.08 | .6,.55,1 | .35 | .25 | .5 | uAudio | 3 | 27 |

\* Node counts as printed by `node test-dynamic-materials.cjs` (numeric node stub, not a GPU compile).

`hue(h)` is the existing TS helper (shaders.ts:76): `clamp(abs(fract(h + vec3(0,.6667,.3333))*6 - 3) - 1, 0, 1)`. It is periodic with period 1 in `h`.

**Every `t` coefficient is a multiple of 0.05** (1, .7, .6, .4, .8, .3, 1.6, .35), except the oil-slick hue drift of 0.08. This fact is the basis of the clock-wrap fix in §7 B10 / §8.

### 2.3 Runtime update (v19 dynamic-material-runtime.js:2-14, called once per organism frame)
```
dt       = clamp(m.dt, 0, 0.05)
uClock  += dt * ctl('materialSpeed')              // integrated phase, so a speed change never jumps the pattern
uScale   = ctl('materialScale') || 1
alpha    = 1 - exp(-dt * 10)                      // ~100 ms EMA
react    = ctl('materialReact')
energy   = clamp(m.energy, 0, 1)
audible  = energy > 0.01 || m.active.size > 0 || m.events.some(e => e.kind === 'on')
attack   = clamp(max(m.onset, audible ? m.beat.hit : 0), 0, 1)
materialEnergy += (energy - materialEnergy) * alpha
materialAttack  = max(attack, materialAttack * exp(-dt * 7))
uAudio  = materialEnergy * react                  // 0..2
uAttack = materialAttack * react                  // 0..2
```
- Engine fields `materialEnergy` and `materialAttack` start undefined (treated as 0).
- The clock, and the other uniforms, are **module-level globals**. They are never reset (engine switch and Reset keep the phase).
- The v19 call site is the very top of `frame()`, directly after `this.lastG=t,this.lastGTime=e.time;this.performanceState=e;` (bundle anchor `this.performanceState=e;this.updateDynamicMaterials(e);`). That is before note events are processed. Order does not matter for the uniforms. They must only be set before the render in the same frame.
- **Near-duplicate of existing TS logic:** TS organism.ts:2526-2531 already computes `hitEnv` = `max(hitEnv*exp(-dt*7), max(onset, sounding ? beat.hit : 0, note-on: .5+.5*velocity))` with `sounding = energy > .03 || active.size > 0`. `materialAttack` is the same envelope with slightly different gates (.01 instead of .03, note-on counted as "audible" but its velocity not used as a hit, plus clamping).

### 2.4 Rigid (instanced) path
Nothing new. The existing `applyShaders()` (TS organism.ts:783-812) builds `GROWTH_SHADERS[shader].make()`, wraps it in `reactify`, and assigns the **one** material to all six instanced meshes (seg, rib, crystal, leaf, sphere, cube) via `baseMats`. The dynamic materials behave like any other shader:
- They are created once, when `shader` changes (`setControl` → `applyShaders`, TS organism.ts:768).
- They animate only through the shared uniforms. No per-frame material work.
- Existing side-effects carry over from v0.15 (pre-existing, not introduced here): the leaf mesh loses `DoubleSide`, and cube/crystal lose `flatShading`, whenever any non-standard shader is selected.

### 2.5 Soft-mesh path (v19 dynamic-material-runtime.js:15-33 plus edits to soft-growth.js)
`patch_dynamic_materials.py:20-23` edits the v0.16 `soft-growth.js` in two places:
- Replaces `this.group.remove(item.mesh);item.mesh.geometry.dispose();item.mesh.material.dispose();` with `this.disposeSoftItem(item);` (soft-growth.js:15 and :77).
- Inserts `this.syncSoftMaterial(plant,item);` before the 30 Hz throttle (soft-growth.js:39).

`syncSoftMaterial(plant, item)`, called **every frame for every soft plant**, before the per-mesh 1/30 s throttle:
```
index = ctl('shader')
if item.materialIndex === index: return             // cheap no-op on most frames
item.materialIndex = index
item.baseMaterial ??= item.mesh.material            // the soft base: MeshStandardNodeMaterial({color: plant.color, roughness .16|.45, metalness .25|.08, side: Et}) wrapped in reactify
dispose item.effectMaterial if any; item.effectMaterial = null
if 22 <= index < 32:
   try: item.effectMaterial = reactify(GROWTH_SHADERS[index].make()); item.effectMaterial.side = Et   // Et === BackSide (bug B1)
   catch: console.warn('Animated soft material unavailable', e)
item.mesh.material = item.effectMaterial ?? item.baseMaterial
```
`disposeSoftItem(item)`: `group.remove(mesh)`; `geometry.dispose()`; `effectMaterial?.dispose()`; `(baseMaterial ?? mesh.material).dispose()`.

Consequences:
- There is **one owned material per soft plant**, up to 64 (the soft mesh cap in soft-growth.js:31).
- Switching `shader` makes every live soft plant build a new NodeMaterial in the same frame.
- Per-plant colour arrives only on that mesh's next 30 Hz geometry update (soft-growth.js:44 `item.mesh.material.color?.copy(plant.color).multiplyScalar(focusLevel)`). Until then the effect material's `.color` is white, so there can be a one-frame white flash.

### 2.6 Tip marker shapes (v19 tip-shapes.js)
`tipShapeNames = ['sphere','cube','diamond','cone','ring','disc','hexagon','star','heart','custom image','custom OBJ']` (indices 0–10).

Geometry produced by `syncTipShape()` (tip-shapes.js:28-42):
| idx | name | geometry (three class) | extent | orientation (`orientTip`) |
|---|---|---|---|---|
| 0 (and default) | sphere | `IcosahedronGeometry(1, 1)` (identical to TS buildMeshes:683) | r=1 | identity |
| 1 | cube | `BoxGeometry(1.5, 1.5, 1.5)` | ±.75 | identity (axis-aligned) |
| 2 | diamond | `OctahedronGeometry(1, 0)` | r=1 | identity |
| 3 | cone | `ConeGeometry(0.8, 1.8, 10)` | r .8, y ±.9, apex +Y | identity (always points world +Y) |
| 4 | ring | `TorusGeometry(0.7, 0.2, 6, 16)` | outer .9, in the XY plane | identity (always faces world +Z) |
| 5 | disc | `CircleGeometry(1, 20)` | r=1 | **billboard** (copies `camera.quaternion`) |
| 6 | hexagon | `CircleGeometry(1, 6)` | r=1, point on +X | billboard |
| 7 | star | `tipFlatGeometry('star')` | r=1 | billboard |
| 8 | heart | `tipFlatGeometry('heart')` | x ±1, y ≈ −1.06…+.75 (not centred) | billboard |
| 9 | custom image | `this.tipImage ? PlaneGeometry(2,2) : IcosahedronGeometry(1,1)` | ±1 | billboard |
| 10 | custom OBJ | `this.tipOBJ ? this.tipOBJ.clone() : IcosahedronGeometry(1,1)` | normalised to ±1 | identity |

`tipFlatGeometry(kind)` (tip-shapes.js:2-8) builds a non-indexed triangle fan from the origin, with no UVs, followed by `computeVertexNormals()`:
- star: 10 points, `a = i*π/5 + π/2`, `r = i odd ? 0.43 : 1`, point `(cos a·r, sin a·r)`. Counter-clockwise, so front faces point +Z.
- heart: 48 points, `a = i*2π/48`, point `(sin³a, .8125cos a − .3125cos 2a − .125cos 3a − .0625cos 4a)`. This path runs **clockwise**, so its front faces point −Z.
- Each fan triangle is `(0,0,0), p[i], p[(i+1)%n]`.

`syncTipShape()` change detection: it rebuilds only when `tipShapeMesh !== tipMesh` (buildMeshes recreates tipMesh on capacity growth), or `tipShapeCurrent !== tipShape`, or `tipShapeRevision !== tipUploadRevision`. On rebuild:
```
tipMesh.geometry.dispose(); tipMesh.geometry = g
mat = tipMesh.material                         // MeshBasicMaterial({toneMapped:false}), TS organism.ts:683
mat.map       = idx === 9 ? (tipImage ?? null) : null
mat.alphaTest = idx === 9 ? 0.12 : 0
mat.side      = Et                             // === THREE.BackSide (bug B1)
mat.needsUpdate = true
```

Per-frame tip loop after the v0.18 edits. v19 bundle text, with the music-focus parts (another cluster) marked `[MF]`:
```
this.syncTipShape()                                  // before reading glow
glow = ctl('glow'); n = 0
if glow > 0:
  for plant of plants:
    skip unless (held || autoUntil > t) and (sp.glow > 0 or [MF] musicFocus > 0) and not ([MF] referenceAuto && musicFocus > 0)
    for tip of plant.tips:
      if n >= min(MAX_TIPS=200, ctl('tipLimit'), ctl('tipShape') === 10 ? 128 : 512): break   // inner loop only
      pos = tip.seg ? lerp(seg.a, seg.b, seg.growth) : tip.pos
      s   = max(tip.r*(1.5 + .8*onset)*glow*max(sp.glow, [MF]musicFocus), [MF] musicFocus>0 ? clamp(camDist*.0025, .06, .5) : 0)
      dummy.position = pos; orientTip(); dummy.scale = s * ctl('tipSize') (uniform)
      color = tipShape === 9
            ? white * tipBrightness
            : (plant.color lerp [MF](.4,1,1) by musicFocus*.8) * 1.6 + .35, then * tipBrightness
      setMatrixAt(n), setColorAt(n); n++
  instanceMatrix/instanceColor.needsUpdate = true
tipMesh.count = n
```
`orientTip()`: `tipShape in 5..9 ? dummy.quaternion.copy(camera.quaternion) : dummy.quaternion.identity()`.

Note: the tip loop runs **before** the camera block in `frame()` (TS organism.ts:2547 vs camera at 2571-2702). The billboard therefore uses the previous frame's camera orientation.

### 2.7 Custom marker upload (v19 tip-shapes.js:9-26, 47-62; extra-controls.js:4-9)

`loadTipFile(file)` (engine method, async):
1. If there is no file, return `undefined`.
2. If `file.size > 8*1024*1024`, throw `'Use an image or OBJ smaller than 8 MB'`.
3. `request = ++tipUploadRequest` (a staleness token).
4. **OBJ** (`/\.obj$/i`): `g = parseTipOBJ(await file.text())`. If the request is stale or `!this.ready`, dispose `g` and return `undefined`. Otherwise dispose the old `tipOBJ`, set `tipOBJ = g`, `tipUploadRevision++`, and **return 10**.
5. **Image**: the name must match `/\.(png|webp|jpe?g)$/i`, else throw `'Choose PNG, WebP, JPG, or a small OBJ'`.
   - Decode with `createImageBitmap(file, {resizeWidth:256, resizeHeight:256, resizeQuality:'high'})`, draw into a 256×256 canvas (`drawImage(bmp,0,0,256,256)`, so the aspect ratio is not preserved), then `bitmap.close()`.
   - If the request is stale or `!ready`, return `undefined`.
   - Otherwise `tex = new CanvasTexture(canvas)`, `colorSpace = SRGBColorSpace`, `needsUpdate = true`. Dispose the old `tipImage`, set it, `tipUploadRevision++`, and **return 9**.

`parseTipOBJ(text)`:
- Split on `/\r?\n/`. For each line, strip everything after `#`, trim, and split on whitespace.
- `v` lines: take `parts[1..3]` as Numbers. If there are not exactly 3 or any is non-finite, throw `'Invalid OBJ vertex'`. If 10,000 vertices already exist, throw `'Use a smaller OBJ: at most 10,000 vertices'`.
- `f` lines: each token becomes `Number(token.split('/')[0])`. A negative index `n` resolves to `verts.length + n`; a positive one to `n-1`. There must be 3–64 indices, each an integer that refers to an already-defined vertex, else `'Invalid OBJ face'`. Faces are fan-triangulated `(0,i,i+1)`. Before each triangle, if `data.length ≥ 2048*9`, throw `'Use a simpler OBJ: at most 2,048 triangles'`.
- `vn`, `vt`, `o`, `g`, `s`, `usemtl`, `mtllib` are ignored.
- No faces: `'OBJ has no faces'`.
- Build a non-indexed position-only geometry and compute its bounding box. `span = max(size.x, size.y, size.z)`. If span is not finite or `< 1e-8`, dispose and throw `'OBJ has no usable extent'`.
- `translate(-center)`, `scale(2/span)` (so the geometry fits in ±1), `computeVertexNormals()` (flat normals, since the geometry is non-indexed).
- `custom-tip-example.obj` is a 4-vertex, 4-face tetrahedron. It yields 36 floats, all within ±1.

`disposeTipUploads()`: `tipUploadRequest++` (invalidates in-flight loads), dispose `tipImage` and `tipOBJ`, set both to null. It is chained into `unmount()` **before** the original unmount (tip-shapes.js:64-65).

UI handler `#tipFile.onchange` (extra-controls.js:4-9):
- If there is no file or the current engine is not organism, return (the input is not cleared on this path).
- Capture `engine`, set status `'Loading marker…'`, then try `index = await engine.loadTipFile(file)`.
- If the engine changed or `index == null`, return. The status stays "Loading marker…" (bug B8).
- Otherwise `referenceSet('tipShape', index)` and status `` `Loaded ${file.name}` ``.
- On error, status = `error.message`. In `finally`, clear the input value.

Uploads are session-only. The `tipShape` index (9/10) persists in settings and presets, but the asset does not.

### 2.8 Screen bounce (v0.18.0 "extra control"; v19 stage-motion.js + draw wrapper in patch_species_stage.py:21-28)
This cluster owns the controls and UI card. The behaviour is also relevant to any camera/stage cluster, so it is fully specified here.

`reflectedStep(position, direction, distance, limit)`:
- `limit ≤ 0` → `{position: 0, direction}`.
- `distance ≤ 0` → `{position: clamp(position, ±limit), direction}`.
- Otherwise `x = position + direction*distance`, `span = 2*limit`, `phase = ((x+limit) mod 2span + 2span) mod 2span`. If `phase > span`: `x = limit − (phase − span)` and the direction flips. Else `x = phase − limit`.
- This is a closed-form triangle wave, so a long frame cannot loop.

`updateBounceBounds(time)`, refreshed at most every 0.25 s:
- `camera.updateMatrixWorld()`, then project sample points to NDC. Points with view-space `z ≥ −near` are skipped, as are points with non-finite or `|ndc| > 100` results.
- Samples:
  - Segment endpoints `a` and `b` with stride `ceil(segs/384)`.
  - If the video/reference field is on: the 8 corners of `(±w/2, ±h/2, ±videoDepth/2)`.
  - Else if a shell exists: the 8 corners of `±shellSize*1.3`.
  - For each visible soft mesh: `computeBoundingBox()` and its 8 corners.
- Result: `{x, y}` = the NDC centre, `hx`/`hy` = `max(.1, half-extent) * 1.05`. If there are no points, `{0, 0, 1, 1}`.

`beginScreenBounce()`, run inside `draw()`:
```
if !screenBounce: bounceLastTime = null; return null
time = frame time; dt = bounceLastTime==null ? 0 : clamp(time − bounceLastTime, 0, .05); bounceLastTime = time
updateBounceBounds(time)
bounceSmooth ??= copy(bounceBounds); each of x,y,hx,hy += (target − value) * (1 − exp(−dt*6))
scale  = min(1, bounceSize / max(hx, hy))
limitX = max(0, .96 − hx*scale); limitY = max(0, .96 − hy*scale)
speed  = bounceSpeed * 2   (NDC units per second)
x = reflectedStep(clamp(bounceX, ±limitX), bounceDX ?? 1, dt*speed, limitX)
y = reflectedStep(clamp(bounceY, ±limitY), bounceDY ?? 1, dt*speed*0.71, limitY)
store bounceX/DX/Y/DY
original = projectionMatrix.clone()
P.elements[0,4,8,12,1,5,9,13] *= scale        // shrinks NDC x,y about the screen centre
P.elements[8] −= x − b.x*scale; P.elements[9] −= y − b.y*scale   // perspective off-axis shift, so NDC moves by +(x − b.x*scale)
projectionMatrixInverse = inverse(P); return original
```
`endScreenBounce(original)` restores the projection matrix and its inverse. The draw wrapper calls it in `finally`, so it also runs when the render throws.

Because only the projection changes, the effect appears in recordings and snapshots and the world coordinates are untouched. With a moving camera the framing changes. With a locked camera the path looks like a DVD logo.

### 2.9 Extra UI behaviours in extra-controls.js that belong to other clusters
- Line 1 appends one `<option value=soft-kind>name</option>` per entry of `extraSoftSpecies` to `#softChoice` (**soft-species cluster**).
- Line 22 `#recReport`: downloads `JSON.stringify(recorder.lastReport, null, 2)` as `growth-recording-report.json` (**recording cluster**).
- Lines 23-28 `#recEditor`:
  - If a take is busy or recording, do nothing.
  - Find a format with `ext === 'mp4'` in the MediaRecorder format list. If there is none, set status `'MP4 is not offered by this browser. Record WebM and use the conversion helper.'`
  - Otherwise set `settings.recFormat`, the `#recFormat` select, `#recCompat` = checked, `#recResolution` = '1080', `#recFps` = '30'; then save and set status `'Editor starting point: MP4 H.264/AAC requested, 1080 tall, 30 fps target.'` (**recording cluster**; §7 B16).

---

## 3. Controls

All are **engine controls of OrganismEngine**. There are no new `g:` globals. Panel id: `e:organism:<key>`.

| key | label (v19 engine control) | min | max | step | default | options | v19 section | quick-card label (v19) | read by |
|---|---|---|---|---|---|---|---|---|---|
| materialSpeed | new materials: motion speed | 0 | 3 | 0.05 | 0.8 | — | "More" (+ Animated materials card) | Motion speed | `updateDynamicMaterials`: `uClock += dt*speed` |
| materialScale | new materials: pattern scale | 0.25 | 3 | 0.05 | 1 | — | "More" (+ card) | Pattern scale | `updateDynamicMaterials`: `uScale = value \|\| 1` |
| materialReact | new materials: audio response | 0 | 2 | 0.05 | 1 | — | "More" (+ card) | Audio response | `updateDynamicMaterials`: multiplies uAudio and uAttack |
| shader *(changed)* | growth shader | 0 | **31** (was 21) | 1 | 0 | 32 names: 22 original plus the 10 in §2.2, in order | Look (+ card select) | card `<select id=dynamicMaterial>` | `applyShaders` (rigid), `syncSoftMaterial` (soft) |
| screenBounce | bounce sculpture around screen | 0 | 1 | 1 | 0 | — | "More" (+ Screen bounce card toggle) | Bounce around screen / Bouncing on | `beginScreenBounce` |
| bounceSpeed | screen bounce speed | 0 | 0.5 | 0.01 | 0.08 | — | "More" (+ card) | Bounce speed | `beginScreenBounce`: `speed = v*2` NDC/s |
| bounceSize | bouncing sculpture screen size | 0.2 | 0.85 | 0.05 | 0.55 | — | "More" (+ card) | Sculpture screen size | `beginScreenBounce`: `scale = min(1, v/max(hx,hy))` |
| tipShape | tip marker shape | 0 | 10 | 1 | 0 | `tipShapeNames` (11) | "More" (+ card select) | Tip shape | `syncTipShape`, `orientTip`, tip-limit cap (==10 → 128), tip colour (==9 → white) |
| tipSize | tip marker size | 0.1 | 3 | 0.1 | 1 | — | "More" (+ card) | Marker size | tip loop scale multiplier |
| tipBrightness | tip marker brightness | 0 | 2 | 0.05 | 1 | — | "More" (+ card) | Marker brightness | tip loop colour multiplier |
| tipLimit | visible tip limit | 32 | 512 | 32 | 256 | — | "More" (+ card) | Visible marker limit | tip loop cap `min(200, tipLimit, …)`. **Values above 200 do nothing** (B3). |

Insertion order in v19's control array:
- The 3 material keys come immediately **before** `shader`, i.e. after `env` (TS organism.ts:429).
- The 7 stage/tip keys come immediately **before** `glow` (TS organism.ts:414), after `videoShow`.
- `mount()` sorts controls by `GROUP` (TS organism.ts:571-573). Keys missing from `GROUP` get group `'More'`, so in v19 all ten render at the very end of the engine controls.

Simple-mode overrides (v19 simple-ui.js:21-25, another cluster): every look sets `materialSpeed .45`, `materialReact .65`, `screenBounce 0`, and a per-look `shader`: roots 2 (marble), coral 4 (mottle), neural 6 (veins), crystal 14 (chrome), **liquid 22 (tidal glass)**, **silk 27 (silk shimmer)**. These indices must stay stable in the port.

Random mix (TS main.ts:473-495) randomises every control not in `NO_RANDOM` (TS main.ts:463-468). v19 replaced random mix with a curated surprise, but the TS port still has it. Unless added to `NO_RANDOM` or capped, random mix would pick `tipShape` 9/10 (custom assets that do not exist), `screenBounce 1`, and random `tipLimit`.

---

## 4. UI

### 4.1 DOM added (v19 index.html:183, one line; created by the python builders)
Placement: directly after the v19 Simple-mode card `#simpleHome`, before `#sec-input`. In v0.17.3/v0.18.0 this was "first thing after #panelTop". The TS equivalent is between TS index.html:108 (`</div>` closing `#panelTop`) and :110 (`<!-- 1. where the music comes from -->`). Order: Screen bounce card first, then Animated materials card. Neither card has the `<div class="body">` wrapper that every other section uses (TS index.html:38 `details.sec .body { padding: 0 0 8px 2px; }`).

**Card A: `<details class="sec" id="sec-specialist-motion">`** (had `open` in v0.18.0; v0.19 removed it). `<summary>Screen bounce &amp; tip shapes</summary>`, then:
- `<button type="button" id="screenBounceToggle" aria-pressed="false">Bounce around screen</button>`
- five `<label class="slider" for=K><span>LABEL</span><output id="KValue">DEFAULT</output><input id=K type=range min max step value></label>` for `bounceSpeed` (0–.5/.01/.08, "Bounce speed"), `bounceSize` (.2–.85/.05/.55, "Sculpture screen size"), `tipSize` (.1–3/.1/1, "Marker size"), `tipBrightness` (0–2/.05/1, "Marker brightness"), `tipLimit` (32–512/32/256, "Visible marker limit")
- `<label>Tip shape <select id="tipShapeSelect"></select></label>` (options filled by extra-controls.js:2, value = index, text = name)
- `<label>Custom marker <input id="tipFile" type="file" accept=".png,.webp,.jpg,.jpeg,.obj"></label>`
- `<p id="tipUploadStatus" class="note">Transparent PNG/WebP = flat icon. OBJ = solid 3D shape, up to 2,048 triangles. Images use a square 256 px tile. Uploads last for this session.</p>`
- `<p class="note">Bounce moves the whole sculpture in the view, including in recordings. Lock the camera for a steady DVD-style path. Screen size leaves space to travel.</p>`

**Card B: `<details class="sec" id="sec-specialist-materials">`** (had `open` in v0.17.3). `<summary>Animated materials</summary>`, then:
- `<div class="row"><select id="dynamicMaterial" aria-label="Growth material" style="flex:1;min-width:0"></select><button id="dynamicNext" type="button">Next new</button></div>`
- three `label.slider` blocks for `materialSpeed` ("Motion speed", 0–3/.05/.8), `materialScale` ("Pattern scale", .25–3/.05/1), `materialReact` ("Audio response", 0–2/.05/1)
- `<p class="note">Next new explores ten animated surfaces, including on soft species. These three controls affect the new materials. Set motion and audio response to 0 for a still surface.</p>`

**Recording row** (inserted before `#recFormatNote`; TS index.html:219; recording cluster):
- `<div class="row"><button id="recEditor" type="button">Editor MP4 settings</button><button id="recReport" type="button">Recording report</button></div>`
- `<label><input id="recCompat" type="checkbox" checked> MP4 editor compatibility (H.264 + AAC)</label>`
- `<p class="note">This requests explicit codecs; it does not guarantee import into every editor. The ZIP includes a Resolve conversion helper for existing recordings.</p>`

### 4.2 Handlers
dynamic-material-ui.js, appended at the end of the bundle (main.ts module scope):
- On load, fills `#dynamicMaterial` with **all 32** shader names (`value = index`). This duplicates the engine "growth shader" select.
- `syncDynamicMaterialUI()`:
  - `enabled = engine.id === 'organism'`. Disables the select, `#dynamicNext` and the three sliders when not enabled.
  - When enabled: select value = `shader`; each slider value = its control value (fallback 1); `#KValue.textContent = input.value`.
- `#dynamicMaterial.onchange` → `referenceSet('shader', +value)`, which does `ctls.get('e:organism:shader')?.set(v)` then `referenceSync()` (a reference-UI helper from another cluster).
- `#dynamicNext.onclick`: `cur < 22 ? 22 : 22 + ((cur − 22 + 1) % 10)`, then `referenceSet('shader', …)` and a sync.
- Each slider `oninput` → `referenceSet(key, +value)` and a sync.
- `syncDynamicMaterialUI()` runs once, then **`setInterval(syncDynamicMaterialUI, 400)` forever**.

extra-controls.js:
- `#tipShapeSelect.onchange` → `referenceSet('tipShape', +value)`.
- `#tipFile.onchange`: see §2.7.
- `#screenBounceToggle.onclick` → toggles `screenBounce` 0↔1.
- The `oninput` of `bounceSpeed`, `bounceSize`, `tipSize`, `tipBrightness` and `tipLimit` → `referenceSet(key, +value)`. The number labels update only on the next 400 ms poll.
- `syncExtraControls()`:
  - Enables or disables the toggle, select and file input, and the five sliders.
  - Sets `aria-pressed` and the toggle text: `'Bouncing on'` if on, else `'Bounce around screen'`.
  - Sets the select value and the slider values and outputs.
  - Sets `#recReport.disabled = !recorder.lastReport || recording` and `#recEditor.disabled = recording || recordingBusy`.
  - `setInterval(syncExtraControls, 400)` forever.

The engine-generated widgets in "More" (TS main.ts:134-223 `widget()`) are the real controls: MIDI-learnable, persisted, and in presets. The cards are mirrors of them.

### 4.3 CSS
- No new CSS for the cards. They reuse `details.sec`, `.row`, `.slider`, `.note`, but their markup (`label.slider > span + output + input`) differs from the engine widget (`div.slider > span.l + span.v + input`, TS index.html:47-50). The output therefore gets no `span.v` monospace styling.
- v19 `#simpleUiStyle` hides both cards in Simple mode: `body.simple-ui #sec-specialist-motion, body.simple-ui #sec-specialist-materials {display:none!important}` (patch_consolidation.py:42-56).

---

## 5. Integration points (minified anchor → TS location → required change)

### 5.1 patch_dynamic_materials.py (v0.17.3)
| # | Anchor edited (exact) | Equivalent TS location | What to do in TS |
|---|---|---|---|
| M1 | `const LM="0.17.2"` → `"0.17.3"` | `src/midi/version.ts:2` `export const VERSION = '0.15.0'` | Bump as part of the release (single source of truth; do not hand-edit HTML). |
| M2 | Insert dynamic-materials.js before `function _j(i){`. This is only a position anchor: `_j` is a three-mesh-bvh internal that sits right after the minified `I_`/`L_` (GROWTH_SHADERS/ENV_SHADERS) literals at bundle@1037436-1041990, so the catalogue runs after `I_` exists and before the OrganismEngine class is built. | `src/midi/shaders.ts:97-212` (`GROWTH_SHADERS`, last entry 'pulse' at :205-211, closing `]` at :212) | Put the ten entries in a new module and **append** them (`GROWTH_SHADERS = [...BASE_GROWTH_SHADERS, ...ANIMATED_SHADERS]`), in exactly the §2.2 order so indices 22–31 are stable. The `shader` control (organism.ts:430) derives `max` and `options` from `GROWTH_SHADERS` at class-field initialisation, so ES import order already guarantees correctness. |
| M3 | Append dynamic-material-runtime.js after music-focus.js (top-level `Object.assign(tw.prototype, …)`) | OrganismEngine class body (organism.ts), next to `applyShaders` (:781-812) | Implement as a pure function in the materials module plus one call site (M4). Port `syncSoftMaterial`/`disposeSoftItem` only together with the soft-species cluster, and with the §7 fixes applied. |
| M4 | `this.performanceState=e;` → `this.performanceState=e;this.updateDynamicMaterials(e);` (frame start, bundle: `frame(e,t){…if(!this.ready||!this.renderer)return;this.lastG=t,this.lastGTime=e.time;this.performanceState=e;…`) | `frame()` at organism.ts:2274-2277 (start). **Recommended placement:** after the `hitEnv`/`bassS` update at organism.ts:2531, before the `uPulse` line at :2534. | Call `updateAnimatedUniforms(...)` there so it reuses `this.hitEnv`. Constraint: it must run every frame before `this.draw()` (organism.ts:2736). It must not run in `snapshot()`, which only calls `draw()`. |
| M5 | `{key:"shader",` → three controls inserted before it | organism.ts:430 (`shader`), i.e. after `env` at :429 | Add the three controls **and** add `materialSpeed/materialScale/materialReact: 'Look'` to `GROUP` (organism.ts:239). v19 did not, so they landed in "More". |
| M6 | soft-growth.js edits: `this.group.remove(item.mesh);item.mesh.geometry.dispose();item.mesh.material.dispose();` → `this.disposeSoftItem(item);`, and insert `this.syncSoftMaterial(plant,item);` before `if(state.time-item.last<1/30)continue;` | No TS equivalent: soft species do not exist in v0.15.0 | Dependency: the soft-species cluster must be ported first or together. Apply the corrected design in §8.3 (shared material plus per-object tint uniform, correct `side`). |
| M7 | HTML: card inserted before the first `<details class="sec"` of index.html and of the standalone HTML | TS index.html between :108 and :110 | **Do not port the card.** Render the controls through `renderEngineControls` (main.ts:306-394) in the Look section, plus the "next animated" button injected after the `shader` widget (see §8.5). |
| M8 | dynamic-material-ui.js appended to the end of the bundle | main.ts module scope | Replace with the injected button row in `renderEngineControls`. No `setInterval`. |

### 5.2 patch_species_stage.py (v0.18.0), tip and bounce parts
| # | Anchor edited (exact) | Equivalent TS location | What to do in TS |
|---|---|---|---|
| S1 | `const LM="0.17.3"` → `"0.18.0"` | version.ts:2 | Release bump. |
| S2 | Append stage-motion.js + tip-shapes.js + draw wrapper after dynamic-material-runtime.js | New modules (see §8) + organism.ts `draw()` :871-879 | Implement bounce inside `draw()` (try/finally around the render calls) and move tips into a `TipMarkers` module. |
| S3 | `{key:"glow",label:"tip glow",min:0,max:2,step:.05,value:1},{key:"budget",` → 7 controls inserted before `glow` | organism.ts:414 (`glow`) / :415 (`budget`) | Add the controls. GROUP: `tipShape/tipSize/tipBrightness/tipLimit: 'Look'` (next to `glow`, which is already `'Look'` at :239) and `screenBounce/bounceSpeed/bounceSize: 'Camera'`. Change `tipLimit` to max = `MAX_TIPS` (see B3). |
| S4 | `const Dt=G(this.controls,"glow");` → `this.syncTipShape();const Dt=…` | organism.ts:2548 `const glow = ctl(this.controls, 'glow')` | `this.tips.syncShape(params)` before any instance write. It must also run after `buildMeshes` if the tip mesh is still created there. The recommended design removes tipMesh from `buildMeshes`. |
| S5 | `if(Hs>=XC)break;` → `if(Hs>=Math.min(XC,G(this.controls,"tipLimit"),G(this.controls,"tipShape")===10?128:512))break;` | organism.ts:2554 `if (nt >= MAX_TIPS) break` | Hoist `limit = min(MAX_TIPS, tipLimit, customObjInstanceCap)` out of the loop, and break out of **both** loops (labelled break), not just the inner one. |
| S6 | `this.dummy.position.copy(ne),this.dummy.quaternion.identity(),this.dummy.scale.set(Pe,Pe,Pe)` → `…this.orientTip(),this.dummy.scale.set(Pe*G(…"tipSize"),…×3)` | organism.ts:2557-2559 | Orientation by shape kind (§8.4): camera-facing for flat shapes, growth-direction for cone/ring (improvement), identity otherwise. Scale `s * tipSize` (hoisted). |
| S7 | `this.tipMesh.setColorAt(Hs,this.tmpColor.copy(q.color)` → `…G(…"tipShape")===9?this.tmpColor.setRGB(1,1,1).multiplyScalar(G(…"tipBrightness")):this.tmpColor.copy(q.color)` | organism.ts:2562 | White only when an image is actually loaded (fix B4). |
| S8 | `.multiplyScalar(1.6).addScalar(.35)),Hs++` → `.multiplyScalar(1.6).addScalar(.35).multiplyScalar(G(…"tipBrightness"))),Hs++` | organism.ts:2562-2563 | `color*1.6 + .35` then `* tipBrightness`. |
| S9 | `tw.prototype.draw` wrapper (`beginScreenBounce` / `endScreenBounce` in try/finally) | organism.ts:871-879 `draw()` | Inline it: `const restore = this.bounce.begin(...)` then `try { render } finally { restore() }`. Also applies to `snapshot()` (:889-895), which calls `draw()`. |
| S10 | `tw.prototype.unmount` wrapper → `disposeTipUploads()` then original | organism.ts:2776-2789 | `this.tips.dispose()` (disposes uploads, geometry, material, texture) inside `unmount()`. Remove tipMesh from the generic mesh list at :2778 if TipMarkers owns it. |
| S11 | Text replacement `Capture uses browser-synchronised audio/video…` → `MP4 editor compatibility requests H.264 + AAC explicitly…` | main.ts:849 (`recFormatNote`) | **Recording cluster.** Do not port; TS v0.15 uses WebCodecs + mp4-muxer. |
| S12 | extra-controls.js appended to the end of the bundle | main.ts | Tip-file input injected after the `tipShape` widget in `renderEngineControls` (mirrors the `shell` loader at main.ts:370-393). `softChoice` options belong to the soft cluster; recReport/recEditor to the recording cluster. |
| S13 | HTML: bounce/tip card before the first `<details class="sec"`, plus the rec row before `#recFormatNote` | TS index.html:108-110, :219 | Do not port the card. Do not port the rec row (recording cluster decides). |
| S14 | Implicit: `syncTipShape` detects `tipMesh` replacement by `buildMeshes` (`this.tipShapeMesh===this.tipMesh`) | organism.ts:663-702 (`buildMeshes`, tipMesh at :683, disposal loop :665-670, `group.add` :695) | Better: create the tip mesh once in `mount()`, owned by TipMarkers. Its capacity (`MAX_TIPS`) does not depend on `cap`, so it never needs rebuilding with the segment meshes. Remove it from :665, :683, :695, :746 (use `tips.clear()`), :2778. |

### 5.3 Ordering constraints (TS `frame()`)
1. The material uniform update must come after `hitEnv` (organism.ts:2531) and before `draw()` (:2736).
2. `TipMarkers.update()` should move **after the camera block** (after `this.camera.lookAt(this.camLook)` at organism.ts:2702, before :2736), so billboards use this frame's camera quaternion. Moving it is safe: the chase camera (mode 5, from :2649) reads `plant.tips` directly, not the tip mesh.
3. Within TipMarkers: sync shape and material, then write instances, then set `count`.
4. The bounce projection edit must wrap only the render call inside `draw()`. It must not leak into `camera.updateProjectionMatrix()` calls: `frame()` calls it when `near` changes at :2285-2289, and `resize()` at :738.

---

## 6. State and lifecycle

### 6.1 New state in v19
| Where | Field | Meaning | Reset / dispose |
|---|---|---|---|
| module | `dynamicMaterialStart` (22) | first animated index | constant |
| module | `dynamicClock`, `dynamicScale`, `dynamicAudio`, `dynamicAttack` (TSL `uniform`) | shared by all animated materials | never reset; clock grows without bound (B10) |
| engine | `materialEnergy`, `materialAttack` | smoothed energy and attack envelope | never reset |
| soft item | `materialIndex`, `baseMaterial`, `effectMaterial` | per soft plant | `disposeSoftItem` on plant death, `clearSoftMeshes` (Reset via `clearGrowth` wrapper), `unmount` wrapper |
| engine | `tipShapeMesh`, `tipShapeCurrent`, `tipShapeRevision` | change detection for `syncTipShape` | — |
| engine | `tipUploadRequest` (staleness token), `tipUploadRevision`, `tipImage` (CanvasTexture), `tipOBJ` (BufferGeometry) | uploads | `disposeTipUploads()` on unmount; replaced assets disposed on the next upload |
| engine | `bounceBounds`, `bounceBoundsT`, `bounceSmooth`, `bounceX`, `bounceY`, `bounceDX`, `bounceDY`, `bounceLastTime` | screen bounce | `bounceLastTime = null` when bounce is off. **`bounceSmooth` is never reset** (B15). |
| UI module | two `setInterval(…, 400)` handles | polling sync | never cleared |

### 6.2 Lifecycle
- **Reset** (`M5` = resetEngine → `clear()` → `clearGrowth()`, TS organism.ts:742-760): tipMesh `count=0`; soft meshes disposed through their wrapper. Materials, clock and uploads persist. That is correct: Reset should not drop the user's custom marker.
- **Capacity growth** (`growCapacity` → `buildMeshes`, organism.ts:704-714): in v19 this recreates tipMesh with a fresh sphere geometry and a fresh MeshBasicMaterial, which `syncTipShape` detects and re-applies. In the recommended design the tip mesh is untouched by buildMeshes.
- **Shader change**: `applyShaders` disposes the previous `shaderMat` (organism.ts:792-794). Soft effect materials are disposed and recreated per plant on the next frame.
- **Engine switch or unmount**: v19 disposes uploads first, then the original unmount disposes tipMesh geometry and material and `shaderMat`. Module uniforms survive (harmless).
- **Persistence**:
  - All ten controls persist automatically in `localStorage['midiviz_settings_v3'].engineCtl.organism[key]` (TS main.ts:68, :96-99, :349-353) and in preset slots `localStorage['midiviz_presets_v1']` (presets.ts:13, `snapshotPreset` main.ts:441-447, which snapshots every engine control).
  - Saved values load **unclamped** on engine select (main.ts:256 `for (const c of e.controls) if (saved[c.key] !== undefined) c.value = saved[c.key]`).
  - Uploaded tip assets are not persisted, so `tipShape` 9/10 can be restored without an asset (B4).
  - Preset morph (main.ts:519-532) tweens `materialSpeed/Scale/React`, `tipSize`, `tipBrightness`, `bounceSpeed` and `bounceSize`. Options and step≥1 controls (`tipShape`, `tipLimit`, `screenBounce`, `shader`) switch instantly.

---

## 7. Bugs, weaknesses and questionable decisions in the patch implementation

Severity: **H** = visibly broken, **M** = wrong or misleading behaviour, **L** = cost or robustness.

**B1 (H). `Et` is `THREE.BackSide`, not DoubleSide. Several tip shapes are invisible and soft materials render inside-out.**
- Evidence: the bundle constant table at bundle@41553 reads `…fn=0,Et=1,yi=2,…` (FrontSide=0, BackSide=1, DoubleSide=2). The ENV sky shaders in the same bundle use `side=Et` exactly where TS uses `THREE.BackSide` (TS shaders.ts:227, 239, 250 …). `Et` is a single top-level const (only one `Et=` in the bundle) and the inserted modules run at top level, so nothing shadows it.
- Where the patch uses it:
  - `syncTipShape` sets `material.side = Et` for **every** shape (tip-shapes.js:41).
  - `syncSoftMaterial` sets `effectMaterial.side = Et` (dynamic-material-runtime.js:24).
  - The soft base material is created with `side: Et` (soft-growth.js:34).
- Why it was not caught: the author's test stubs `Et:2` (test-dynamic-materials.cjs:23), and `syncTipShape` is never executed by any test (test-stage-tips.cjs only calls `parse`, `flat`, `loadTipFile` and the unmount wrapper).
- Consequences, from static analysis (confirm in a browser):
  - Flat billboarded markers face the camera with their **front** faces (copying the camera quaternion makes local +Z point at the viewer). CircleGeometry, PlaneGeometry and the star fan are counter-clockwise, so they are culled. **Disc (5), hexagon (6), star (7) and custom image (9) draw nothing.**
  - The heart path runs clockwise, so only the heart shows. The uploaded-image feature cannot have worked in v0.18/v0.19.
  - Closed shapes (sphere, cube, diamond, cone, ring, OBJ) show their far interior faces. The silhouette is the same with the unlit MeshBasicMaterial, but a tip embedded in a tube is more occluded.
  - Soft meshes (liquid, ribbons, blankets, all 13 soft species) render only their back faces, with lighting on flipped normals. From the default camera the wave blanket's +Z face is culled.
- Fix: flat markers `DoubleSide` (or FrontSide, since they are billboarded); closed markers `FrontSide`; soft sheets (ribbon/blanket/sail) `DoubleSide`; closed soft forms (liquid/droplet/torus/tube/jelly) `FrontSide`. Add a test that asserts `side` using the real three constants, not stubs.

**B2 (H, cross-cluster, explains the lead's "Liquid = faceted low-poly blobs").** The Simple "Liquid" look is soft `liquid` plus shader 22 (tidal glass).
- The liquid mesh is `new kp(1,2)` = `IcosahedronGeometry(1, 2)`: 320 faces and **non-indexed** (three r185 `PolyhedronGeometry.js:62-72` sets only attributes, no index).
- soft-growth.js:72 calls `computeVertexNormals()` on it, which on a non-indexed geometry produces **flat face normals**. The facets become obvious.
- Aggravating factors:
  - BackSide (B1) shows the inner surface.
  - Normals update at 15 Hz while positions update at 30 Hz, so shading lags the deformation.
  - Tidal glass has low roughness (.19) and metalness .32, so specular highlights emphasise each facet.
- Fix (soft cluster, but required for the materials to look like "liquid"): use an indexed sphere (`SphereGeometry(1,48,32)`, or `mergeVertices(IcosahedronGeometry(1,4))`), compute normals analytically or with `computeVertexNormals` on the indexed mesh at the same rate as positions, and use FrontSide.

**B3 (M). `tipLimit` range 32–512 (default 256), but the allocation is `MAX_TIPS = 200`** (bundle `XC=200`; TS organism.ts:52).
- The cap `min(XC, tipLimit, …)` makes every value ≥ 224 identical. The `512` branch is dead code, and the default 256 silently means 200.
- Fix: allocate `MAX_TIPS = 512` (512 × 80 triangles for the sphere is about 41k triangles, trivial), keep the default at 200 to preserve the v0.15 look, and set slider `max = MAX_TIPS`. Or keep 200 and set `max: 200`.

**B4 (M). `tipShape` 9/10 without an asset.**
- After a reload, a preset load, or a random mix, `tipShape` can be 9 or 10 with no asset. The geometry falls back to the sphere, but the colour branch still forces **white** for 9, and the 128-instance cap still applies for 10.
- Fix: branch on `hasImage` / `hasObj`, not on the index. Show "custom image (none loaded)" in the option label, or clamp to 0 on load. Add 9/10 to a random-mix exclusion.

**B5 (M). One-frame billboard lag.** The tip loop runs before the camera update (TS organism.ts:2547 vs :2702). `orientTip` copies last frame's `camera.quaternion`, so during fast camera moves flat markers visibly shear or turn edge-on. Fix: update tips after the camera block (§5.3).

**B6 (M). Poor defaults for oriented shapes.** Cone and ring use identity orientation, so every cone points world +Y and every ring faces +Z. Cubes are all axis-aligned. That produces a uniform, grid-like field, which conflicts with the owner's "never uniform" preference.
- Fix: orient cone and ring along `tip.dir`, so they point where the tip is growing: `quaternion.setFromUnitVectors(Y, tip.dir)`.
- Give cubes and diamonds a per-tip random yaw seeded from the plant id, plus optional slow spin from the material clock.

**B7 (L). The limit expression is evaluated per tip with `G()` linear searches.**
- `G`/`ctl` is `controls.find` (bundle `function G(i,e){const t=i.find(s=>s.key===e);return t?t.value:0}`; TS engine.ts:79-82), over about 134 controls.
- The patched loop calls it roughly 10–12 times per tip (tipLimit, tipShape ×2–3, tipSize ×3, tipBrightness, orientTip, plus the music-focus keys). At 200 tips that is about 2,400 `find()` calls per frame.
- The `break` exits only the inner loop, which is pre-existing (TS :2554).
- Fix: hoist all parameters once per frame and use a labelled break.

**B8 (L). Upload status stuck.** If the load is superseded (a second pick, an engine switch, `!ready`), `loadTipFile` resolves `undefined` and the UI returns early, leaving "Loading marker…" forever (extra-controls.js:7). Fix: always set a final status ("Cancelled", "Replaced by newer upload").

**B9 (M). Image decode path.**
- (a) `createImageBitmap(file, {resizeWidth, resizeHeight, resizeQuality})`: support for these resize options varies across Safari and Firefox versions, and the code immediately `drawImage`s to 256×256 anyway, so the options are redundant.
- (b) Non-square images are **stretched**. START_HERE_v0180 tells users to "prepare square artwork".
- (c) No SVG, although logos usually arrive as SVG.
- (d) There is no test for this path.
- (e) The old texture is disposed inside `loadTipFile` while `material.map` still references it until the next `syncTipShape`. A render in between (for example `snapshot()`) would bind a disposed texture.
- Fix: decode through `createImageBitmap(file)` without options, with an `HTMLImageElement` fallback. Letterbox-fit into a transparent 256² canvas, preserving aspect. Accept `.svg` via `Image` + `drawImage`. Swap `material.map` and dispose the old texture in the same call.

**B10 (L). Unbounded animation clock.**
- `uClock` grows forever: about 2,880/h at speed .8, and 10,800/h at speed 3. It feeds float32 `sin()` after multiplying by up to 1.6 and adding `position*scale`.
- In multi-hour VJ sets the float32 increment resolution degrades. At 1e5 the ULP is about 0.008 against a per-frame step of 0.05 at speed 3, so the motion becomes uneven.
- Fix, which is seamless: every `t` coefficient is a multiple of 0.05 (§2.2), so every pattern is periodic in `t` with period **40π ≈ 125.66**. Wrap `clock = (clock + dt*speed) % (40*Math.PI)`, and change the oil-slick hue drift from `0.08` to `1/(4π) ≈ 0.0795775` (so `hue(t*k)` is also 40π-periodic: `40π·k = 10`, an integer). The visual change is imperceptible.

**B11 (M). Weak and inconsistent music response.**
- The owner's main complaint is that the growth must *obviously* follow the music. Here, 8 of the 10 materials react only through `emissive += diffuse*mask*uAudio*.25`, at most +0.5 at `react=2`. That is a subtle brightening of smoothed energy.
- Only biolume (attack scales both colour and glow) and ripple rings (attack phase-kick of 0.4 rad) react to hits.
- None uses the available `uBass`/`uTreble`/`uBeat` (TS shaders.ts:42-46).
- Fix (bounded and cheap):
  - Energy → pattern speed: `clock += dt*speed*(1 + 1.5*energy*react)`.
  - Attack → a mask-weighted emissive flash for all ten: `+ diffuse*m*uAttack*0.8`.
  - Bass → scale breathing: `uScale*(1 + .12*bassS*react)`.
  - Treble → a tighter smoothstep for filament and mercury.
  - Keep `materialReact = 0` giving a static surface.

**B12 (M). Fixed material palettes fight the app palette.**
- Each surface multiplies fixed low/high colours by `materialColor` / instance colour. For example, the tidal-glass high `[.35,.95,1]` × a warm palette colour `(1,.5,.1)` gives `(.35,.48,.1)`, a muddy olive.
- The low colours are very dark (≈0.02–0.2), so on most palettes the surfaces read as dark and dirty rather than luminous.
- "Tidal glass" is opaque with no fresnel, so it does not read as glass. The patterns are colour-only, with no normal perturbation, so they look painted on.
- Fix:
  - Add a `materialTint` 0..1 control: 0 = pattern modulates the plant/palette colour (brightness and saturation only), 1 = the material's own signature colours.
  - Add a cheap fresnel rim for glass, pearl and mercury, using the existing `fresnel()` helper in shaders.ts:77.
  - Optionally perturb the normal from the analytic derivative of the pattern: two extra `cos` per material, off on low quality.

**B13 (M). Soft materials: one NodeMaterial per plant, created all at once.**
- Up to 64 soft plants each build their own effect material in the same frame the shader changes. That is a CPU stall plus possible first-use pipeline compiles, which hurts during a live performance.
- The original 22 shaders are ignored on soft species while the new 10 apply, which is inconsistent: choosing "marble" does nothing to Liquid.
- Fix:
  - One shared soft material per `(shader, sideMode)`, with the plant colour supplied by a per-object uniform: `uniform(new Color()).onObjectUpdate(({object}) => object.userData.tint)` (TSL, r185).
  - Apply every opaque shader to soft meshes. Exclude the transparent x-ray (index 20) or give it a soft variant.
  - Prewarm with `renderer.compileAsync(scene, camera)` before swapping.

**B14 (L). UI duplication and polling.**
- Every new control appears twice: the quick card, and the auto widget in "More". The material select also duplicates the Look "growth shader" select.
- Two `setInterval(…, 400)` loops run forever, even with the panel hidden or another engine active. They rewrite `select.value` while a dropdown may be open.
- Output labels for the bounce/tip sliders lag by up to 400 ms.
- The cards lack the `.body` wrapper and use different slider markup.
- In Advanced mode the cards sit *above* Input, pushing the most-used section down.
- "Next new" is an unclear label.
- Fix: render through the engine control system (GROUP entries) and inject the extra button and file input in `renderEngineControls`. There is no polling in the TS design: `Ctl.set` already updates widgets, and `onControlValue` exists for engine-driven changes (main.ts:261-266).

**B15 (L). Screen bounce details.**
- `bounceSmooth` is never reset, so re-enabling bounce after moving the camera animates from stale bounds.
- Soft meshes run `computeBoundingBox()` every 0.25 s, up to 64 meshes. That is cheap but avoidable: soft-growth already knows `size` and `root`.
- A shell's cube corners at `shellSize*1.3` are included even when `shellLook` is 'invisible', so the sculpture is framed smaller than necessary.
- It needs the previous frame's time via `performanceState` (a v19-only field). In TS, use `m.time` passed to `draw()` or stored in `frame()`.
- Its `A` (Vector3) allocations per corner are minor.
- Otherwise the maths is correct: the scale about the screen centre and the perspective off-axis shift restore in `finally`.

**B16 (M, recording cluster, noted for completeness). Do not port `recEditor`, `recCompat` or `recReport` as they are.**
- They exist only because v0.17 replaced the verified WebCodecs + mp4-muxer path with MediaRecorder.
- `recEditor` sets `#recResolution`/`#recFps` DOM values that are **not persisted** (recording-ui.js reads the DOM at record time only), and the status claims "H.264/AAC requested", which MediaRecorder may not honour.
- The TS v0.15 recorder already produces faststart H.264 High + AAC CFR MP4.

**B17 (L). OBJ parser limits and fidelity.**
- 10,000 vertices / 2,048 triangles is conservative for logos exported from Illustrator or Blender.
- There is no GLB, although the owner's other flows recommend GLB.
- Normals are flat, which is fine for unlit markers.
- Faces that reference vertices defined later in the file are rejected (rare).
- The 128-instance cap is fixed rather than budget-based.
- Parsing runs on the main thread (up to 8 MB of text).
- Fix: reuse the already bundled `OBJLoader`/`GLTFLoader`/`STLLoader` (TS organism.ts:23-25, used by `loadShell` :1033-1070), concatenate the meshes to non-indexed positions, keep the size and extent checks, and replace the fixed caps with a **triangle budget**: `maxInstances = clamp(floor(262144 / tris), 16, MAX_TIPS)`. Keep the hand parser only if bundle size matters. The loaders are already in the bundle, so reusing them adds nothing.

**B18 (L). Heart not centred.** Its y-range is −1.06…+.75, so the marker sits about 0.16 units low relative to the tip. Fix: centre it with `geometry.center()` or translate by `+0.155`. Scale it so the max extent is 2, like the OBJ normalisation.

**B19 (L). `material.needsUpdate = true` and `side`/`map` changes force a pipeline rebuild on the first use of each shape.** That is acceptable, but prefer a small set of prebuilt materials (solid-front, flat-double, image-cutout) so a shape switch only swaps geometry and material references.

**B20 (process).** `test-dynamic-materials.cjs` and `test-stage-tips.cjs` assert `bundle.includes(sourceFile)`, which is parity, not behaviour, and evaluate TSL through a numeric stub. The stub's `hue` (`Yg`) is a cosine palette, not the real fract-based ramp. No test executes `syncTipShape`, `orientTip`, the image path, real three.js geometry, or real side constants. That is why B1 and B3 passed "all regression suites".

---

## 8. Recommended TypeScript design

### 8.1 Module layout
```
src/midi/shaders.ts                  (existing) keep base GROWTH_SHADERS as BASE_GROWTH_SHADERS; re-export the combined list
src/midi/materials/animated.ts       NEW  ten animated ShaderDefs + uniforms + pure update fn
src/midi/engines/tipMarkers.ts       NEW  shapes, custom assets, TipMarkers class (owns the InstancedMesh)
src/midi/engines/screenBounce.ts     NEW  reflectedStep + ScreenBounce class (projection offset in draw)
src/midi/engines/organism.ts         controls + GROUP entries, call sites only
src/midi/engine.ts                   optional `loadTipMarker?(file: File): Promise<string>` on Engine
src/midi/main.ts                     renderEngineControls: inject "next animated" button after `shader`, file input after `tipShape`; NO_RANDOM additions
```
Keep `organism.ts` from growing. It is already 2,790 lines, so every behaviour above goes into the new modules and organism.ts keeps only call sites.

### 8.2 `materials/animated.ts` (exact port plus fixes)
```ts
import { uniform, sin, mix, vec3, clamp, smoothstep, length, positionWorld, diffuseColor, materialColor } from 'three/tsl'
import { MeshStandardNodeMaterial } from 'three/webgpu'
import type { ShaderDef } from '../shaders'
import { hue } from '../shaders'            // export the existing helper (shaders.ts:76)

type N = any
export const ANIM_PERIOD = 40 * Math.PI     // common period of every t-term (see B10)
export const uMatClock = uniform(0)
export const uMatScale = uniform(1)
export const uMatEnergy = uniform(0)        // "dynamicAudio"
export const uMatAttack = uniform(0)        // "dynamicAttack"

const wave = (n: N) => sin(n).mul(0.5).add(0.5)
type RGB = [number, number, number]
function surface(mask: N, low: RGB, high: RGB, roughness: number, metalness: number, glow = 0.15) {
  const m = clamp(mask, 0, 1)
  const mat = new MeshStandardNodeMaterial()
  mat.roughness = roughness; mat.metalness = metalness
  mat.colorNode = mix(vec3(...low), vec3(...high), m).mul(materialColor)
  mat.emissiveNode = diffuseColor.rgb.mul(m).mul(uMatEnergy.mul(0.25).add(glow))
  //   optional B11 upgrade: .add(diffuseColor.rgb.mul(m).mul(uMatAttack.mul(0.8)))
  return mat
}
const P = () => positionWorld.mul(uMatScale)
const T = uMatClock

export const ANIMATED_SHADERS: ShaderDef[] = [
  { name: 'tidal glass', make: () => { const p = P(); return surface(wave(p.x.mul(2).add(T).add(sin(p.z.mul(2).sub(T.mul(0.7))))), [0.025, 0.12, 0.2], [0.35, 0.95, 1], 0.19, 0.32) } },
  { name: 'pearl currents', make: () => { const p = P(); return surface(wave(p.y.mul(2.5).sub(T.mul(0.6)).add(sin(p.x.add(p.z).mul(1.4).add(T)).mul(2))), [0.24, 0.15, 0.32], [1, 0.85, 0.72], 0.28, 0.48, 0.05) } },
  { name: 'mercury ribbons', make: () => { const p = P(); const warp = sin(p.z.mul(2).add(T.mul(0.4)))
      return surface(smoothstep(0.35, 0.65, wave(p.x.mul(3).add(p.y).sub(T).add(warp))), [0.035, 0.055, 0.09], [0.85, 0.95, 1], 0.16, 0.9, 0.07) } },
  { name: 'biolume', make: () => { const p = P()
      const dots = wave(p.x.mul(3).add(T)).mul(wave(p.y.mul(3.7).sub(T.mul(0.8)))).mul(wave(p.z.mul(2).add(T.mul(0.3))))
      return surface(smoothstep(0.32, 0.8, dots).mul(uMatAttack.mul(0.5).add(0.5)), [0.015, 0.06, 0.08], [0.2, 1, 0.55], 0.45, 0.12, 0.65) } },
  { name: 'oil slick', make: () => { const p = P()
      const h = p.x.mul(0.12).add(p.z.mul(0.09)).add(wave(p.y.add(T.mul(0.4))).mul(0.3)).add(T.mul(1 / (4 * Math.PI)))  // was .08 (B10)
      const m = new MeshStandardNodeMaterial(); m.roughness = 0.22; m.metalness = 0.7
      m.colorNode = hue(h).mul(0.8).add(0.12).mul(materialColor)
      m.emissiveNode = diffuseColor.rgb.mul(uMatEnergy.mul(0.18).add(0.08)); return m } },
  { name: 'silk shimmer', make: () => { const p = P(); const warp = wave(p.x.mul(4).add(sin(p.y.mul(1.2).sub(T)))); const weft = wave(p.z.mul(4).add(T.mul(0.7)))
      return surface(warp.mul(weft).mul(0.65).add(warp.mul(0.35)), [0.12, 0.025, 0.2], [1, 0.48, 0.7], 0.52, 0.15, 0.08) } },
  { name: 'molten gold', make: () => { const p = P()
      return surface(wave(p.y.mul(2).sub(T).add(sin(p.x.mul(1.8).add(T.mul(0.6)))).add(sin(p.z.mul(1.3).sub(T.mul(0.4))))), [0.18, 0.035, 0.005], [1, 0.72, 0.12], 0.24, 0.72, 0.24) } },
  { name: 'ripple rings', make: () => { const p = P(); const ring = wave(length(p.xz).mul(3).sub(T.mul(1.6)).add(p.y.mul(0.7)).add(uMatAttack.mul(0.4)))
      return surface(smoothstep(0.35, 0.8, ring), [0.015, 0.07, 0.16], [0.2, 0.65, 1], 0.32, 0.38, 0.22) } },
  { name: 'aurora weave', make: () => { const p = P()
      const curtain = wave(p.x.mul(1.7).add(sin(p.y.mul(0.8).add(T.mul(0.6))).mul(2)).add(T.mul(0.4))); const drift = wave(p.z.mul(1.5).sub(T.mul(0.35)))
      return surface(curtain.mul(0.7).add(drift.mul(0.3)), [0.14, 0.015, 0.3], [0.15, 1, 0.62], 0.4, 0.2, 0.3) } },
  { name: 'electric filaments', make: () => { const p = P()
      const path = wave(p.y.mul(3).add(sin(p.x.mul(2).sub(T)).mul(2)).add(sin(p.z.mul(2).add(T.mul(0.7)))))
      return surface(smoothstep(0.72, 0.96, path), [0.025, 0.018, 0.08], [0.6, 0.55, 1], 0.35, 0.25, 0.5) } },
]

/** Pure, unit-testable. Call once per frame after hitEnv is updated. */
export interface AnimState { energy: number }   // smoothed energy (engine field)
export function updateAnimatedUniforms(s: AnimState, dtRaw: number, speed: number, scale: number, react: number, energy: number, hitEnv: number) {
  const dt = Math.min(0.05, Math.max(0, dtRaw))
  uMatClock.value = (uMatClock.value + dt * speed) % ANIM_PERIOD
  uMatScale.value = scale || 1
  s.energy += (Math.min(1, Math.max(0, energy)) - s.energy) * (1 - Math.exp(-dt * 10))
  uMatEnergy.value = s.energy * react
  uMatAttack.value = Math.min(1, hitEnv) * react   // reuse organism.ts:2528-2531 instead of a second envelope
}
```
In `shaders.ts`, rename the existing array to `BASE_GROWTH_SHADERS` and `export const GROWTH_SHADERS = [...BASE_GROWTH_SHADERS, ...ANIMATED_SHADERS]`. Export `ANIMATED_START = BASE_GROWTH_SHADERS.length` (=22). Extend `ShaderDef` with an optional `animated?: true` flag (for "Next animated" and the UI grouping) and `softOk?: boolean` (false for transparent x-ray, index 20). Watch for a circular import: `animated.ts` needs `hue` from `shaders.ts`, and `shaders.ts` needs `ANIMATED_SHADERS`. Move `hue`/`fresnel`/`std` into a small `materials/tslHelpers.ts` to avoid the cycle.

Call site in organism.ts, after :2531:
```ts
updateAnimatedUniforms(this.matAnim, dt, ctl(this.controls,'materialSpeed'), ctl(this.controls,'materialScale'), ctl(this.controls,'materialReact'), m.energy, this.hitEnv)
```
(`private matAnim = { energy: 0 }`.) Silence gating is inherited from `hitEnv`'s `sounding` check (:2527-2528).

### 8.3 Soft meshes (when the soft cluster lands)
- Create one material per `(shaderIndex, side)` in the engine (`softMats: Map<string, Material>`), built from `GROWTH_SHADERS[i].make()` and `reactify`, with `colorNode` multiplied by a per-object tint: `const tint = uniform(new THREE.Color()).onObjectUpdate(({ object }) => object.userData.tint)`. Base standard soft material: `std({colorNode: tint…})`.
- Each soft mesh sets `mesh.userData.tint = plantColor × focusLevel` (the v0.17.2 emphasis) and receives the shared material reference. This removes the per-plant creation, the white flash, and the dispose bookkeeping (`disposeSoftItem` only disposes geometry).
- `side`: DoubleSide for sheet kinds (ribbon, blanket, manta, kelp, fan, pleats, disc); FrontSide for closed kinds (liquid, droplet, jelly (open bell: DoubleSide), torus, tube).
- On `shader` change, prewarm: `await renderer.compileAsync(this.scene, this.camera)` after assigning, or build the materials before assigning them. Keep the old materials until the compile resolves.

### 8.4 `engines/tipMarkers.ts`
```ts
export type TipOrient = 'none' | 'camera' | 'growth' | 'spin'
export interface TipShapeDef { name: string; orient: TipOrient; flat: boolean; make(): THREE.BufferGeometry }
export const TIP_SHAPES: TipShapeDef[] = [
  { name: 'sphere',  orient: 'none',   flat: false, make: () => new THREE.IcosahedronGeometry(1, 1) },
  { name: 'cube',    orient: 'spin',   flat: false, make: () => new THREE.BoxGeometry(1.5, 1.5, 1.5) },
  { name: 'diamond', orient: 'spin',   flat: false, make: () => new THREE.OctahedronGeometry(1, 0) },
  { name: 'cone',    orient: 'growth', flat: false, make: () => new THREE.ConeGeometry(0.8, 1.8, 10) },   // apex +Y → tip.dir
  { name: 'ring',    orient: 'growth', flat: false, make: () => new THREE.TorusGeometry(0.7, 0.2, 6, 16).rotateX(Math.PI / 2) }, // ring plane ⟂ growth
  { name: 'disc',    orient: 'camera', flat: true,  make: () => new THREE.CircleGeometry(1, 20) },
  { name: 'hexagon', orient: 'camera', flat: true,  make: () => new THREE.CircleGeometry(1, 6) },
  { name: 'star',    orient: 'camera', flat: true,  make: () => flatFan(starPoints()) },
  { name: 'heart',   orient: 'camera', flat: true,  make: () => flatFan(heartPoints()).center() },   // B18
  { name: 'custom image', orient: 'camera', flat: true, make: () => new THREE.PlaneGeometry(2, 2) },  // only when an image is loaded
  { name: 'custom 3D',    orient: 'spin',   flat: false, make: () => /* uploaded */ null! },
]
export function starPoints(): [number, number][]   // 10 pts, a=i·π/5+π/2, r = i%2 ? .43 : 1
export function heartPoints(): [number, number][]  // 48 pts, (sin³a, .8125cos a−.3125cos2a−.125cos3a−.0625cos4a)
export function flatFan(pts: [number, number][]): THREE.BufferGeometry  // fan from origin; winding irrelevant with DoubleSide
export function parseTipObj(text: string, lim = { verts: 10000, tris: 2048 }): THREE.BufferGeometry   // exact rules of §2.7 (or OBJLoader-based, B17)
export async function imageToTipTexture(file: File, size = 256): Promise<THREE.CanvasTexture>   // letterbox-fit, transparent, sRGB (B9)

export class TipMarkers {
  readonly mesh: THREE.InstancedMesh           // created once in mount(); capacity MAX_TIPS (512 recommended)
  private solid = new THREE.MeshBasicMaterial({ toneMapped: false, side: THREE.FrontSide })
  private flat  = new THREE.MeshBasicMaterial({ toneMapped: false, side: THREE.DoubleSide })
  private image = new THREE.MeshBasicMaterial({ toneMapped: false, side: THREE.DoubleSide, alphaTest: 0.12 })
  private customImage: THREE.Texture | null = null
  private customGeo: THREE.BufferGeometry | null = null
  private uploadToken = 0
  private shapeKey = ''                         // `${index}:${uploadRevision}`
  constructor(maxTips: number)
  syncShape(index: number): void                 // geometry + material swap only when key changes; image/obj fall back to sphere+solid when missing
  async load(file: File, ready: () => boolean): Promise<{ index: number; message: string }>   // 8 MB cap, token staleness, swaps map+disposes old in one step
  update(o: { plants: Plant[]; t: number; onset: number; glow: number; size: number; brightness: number; limit: number; camera: THREE.Camera; shape: number; focus?: FocusHooks }): void
  clear(): void                                  // count = 0
  dispose(): void                                // token++, dispose geometries, 3 materials, texture
}
```
`update()` algorithm (the TS :2547-2569 semantics plus the v18 controls):
- Hoist `limit = min(MAX_TIPS, tipLimit, customGeo ? budgetCap : MAX_TIPS)`.
- `outer:` loop over plants with the existing visibility test (held || autoUntil > t, and sp.glow > 0; the music-focus cluster extends this).
- Per tip:
  - `s = tip.r*(1.5+.8*onset)*glow*sp.glow*tipSize`.
  - Orientation: 'camera' → `camera.quaternion`; 'growth' → `setFromUnitVectors(Y, tip.dir)`; 'spin' → a yaw from `plant.id*1.731 + uMatClock` (optional); 'none' → identity.
  - Colour: image loaded → `white*brightness` (optionally lerp to the plant colour by a future `tipTint` control); else `color*1.6+.35` then `*brightness`.
- `break outer` when the limit is reached.
- Call it **after** the camera update (§5.3).
- Music-focus (other cluster) needs hooks: the minimum screen size, the cyan lerp, and `depthTest=false`/`renderOrder=10` applied to **all three** tip materials (music-focus.js:38-41 sets them on `tipMesh.material` only).

Engine glue (organism.ts): add `async loadTipMarker(file: File): Promise<string>` → `const r = await this.tips.load(file, () => this.ready)`, then `this.setControl('tipShape', r.index)` and `this.onControlValue?.('tipShape', r.index)` (the existing callback keeps the widget and settings in sync, main.ts:261-266), then return `r.message`. Declare `loadTipMarker?` in the `Engine` interface (engine.ts:42-78).

### 8.5 UI (main.ts)
In `renderEngineControls` (main.ts:306-394), next to the existing `shell` loader injection (:370-393):
- After the widget for `shader`, add a `.row` with a "next animated ▸" button. It cycles `ANIMATED_START + ((cur − ANIMATED_START + 1) mod 10)`, or `ANIMATED_START` when `cur < ANIMATED_START`, via `ctls.get('e:organism:shader')?.set(n)`. Add a short `.note`: "10 moving surfaces · speed / scale / audio response below".
- After the widget for `tipShape` and when `e.loadTipMarker` exists: a file input `accept=".png,.webp,.jpg,.jpeg,.svg,.obj,.glb,.stl"`. On change: `setStatus(await e.loadTipMarker(f))`, then clear the input.
- GROUP additions (organism.ts:227-243): `materialSpeed`, `materialScale`, `materialReact`, `tipShape`, `tipSize`, `tipBrightness`, `tipLimit` → `'Look'`; `screenBounce`, `bounceSpeed`, `bounceSize` → `'Camera'`. The resulting control order within Look is `shader, materialSpeed/Scale/React`, then `glow, tip*`, which follows the array order after the stable sort.
- Clearer labels (the owner prefers plain words): "animated surface: motion speed", "animated surface: pattern size", "animated surface: reacts to music", "tip marker: shape / size / brightness / how many", "bounce the sculpture around the screen (DVD style)", "bounce: speed", "bounce: sculpture size on screen".
- `NO_RANDOM` (main.ts:463-468): add `screenBounce`, `tipLimit`. For `tipShape`, either add it to `NO_RANDOM` or cap it in `RANDOM_CAP` at 8 so random mix never selects the custom slots.
- No `setInterval`. No duplicate cards. v19's `#dynamicMaterial`, `#dynamicNext`, `#tipShapeSelect`, `#tipFile`, `#tipUploadStatus` and `#screenBounceToggle` are not needed. If a v20 Simple mode wants a "material" quick pick, bind it through `ctls` and `onControlValue`, not polling.

### 8.6 Screen bounce (`engines/screenBounce.ts`)
- Export `reflectedStep` (a pure copy of §2.8) and `class ScreenBounce { begin(camera, time, params, boundsSource): () => void }`. `begin` returns a restore closure.
- Reset `smooth` when the toggle turns on.
- The bounds source is a callback supplied by the engine: sampled segment endpoints, video box, visible shell only, and soft bounds from their known `size`/`root`.
- `draw()` becomes `const restore = this.bounce.begin(...); try { …render… } finally { restore() }`.

### 8.7 Do NOT port as-is
- The `Et` side assignments (B1), and the soft BackSide base material.
- The 400 ms polling UI and duplicate cards (B14).
- The separate `materialAttack` envelope. Reuse `hitEnv`.
- The tip-limit expression with the dead `512` (B3), and the index-based white colour (B4).
- Tip placement before the camera update (B5).
- The recording row and handlers (`recEditor`, `recReport`, `recCompat`) and the `recFormatNote` text (B16: recording cluster, and TS already has verified WebCodecs MP4).
- The `referenceSet`/`referenceValue` helpers (reference-UI cluster artefacts). Use `ctls`.
- `createImageBitmap` resize options and stretch-to-square (B9).

---

## 9. Acceptance tests

### 9.1 Unit-testable (node, real `three` classes, no GPU). Add `vitest` as a devDependency; the repo currently has no test runner (package.json scripts: dev/build/preview/vendor).
1. **Catalogue order and indices.** `GROWTH_SHADERS.length === 32`. `GROWTH_SHADERS.slice(0,22).map(s=>s.name)` equals the v0.15 list (standard … pulse). Indices 22..31 are exactly `['tidal glass','pearl currents','mercury ribbons','biolume','oil slick','silk shimmer','molten gold','ripple rings','aurora weave','electric filaments']`. The organism `shader` control has `max === 31` and 32 options.
2. **Materials construct.** For i in 22..31, `make()` returns a `MeshStandardNodeMaterial` with `transparent === false`, `colorNode` and `emissiveNode` set, and `positionNode` unset before `reactify`. After `reactify`, `positionNode` is set. This needs `three/webgpu` importable in node; if it is not, run in a vitest `happy-dom` environment.
3. **Clock periodicity.** Port the §2.2 formulas to a scalar JS evaluator (as the v19 test does, but with the real `hue`). For each material and 50 random positions, `pattern(t) ≈ pattern(t + 40π)` within 1e-6 (this validates the wrap and the oil-slick coefficient change). `updateAnimatedUniforms` keeps `uMatClock.value` in `[0, 40π)` after 1e6 steps.
4. **Runtime.**
   - `speed = 0` → the clock does not change.
   - `react = 0` → `uMatEnergy = uMatAttack = 0`.
   - `dtRaw = 10` → the clock advances ≤ `0.05*speed`.
   - Energy EMA reaches 63% of a step within 0.1 s.
   - `hitEnv` passes through clamped to 1.
   - Silence: with `m.energy=0`, no active notes, `beat.hit=1`, the organism's `hitEnv` stays 0, so `uMatAttack` stays 0 (the existing :2527-2528 gate).
5. **Tip shapes.** Each `TIP_SHAPES[i].make()` (0..8) yields finite positions with max |coord| ≤ 1.0 + 1e-6, except the cube at 0.75. The heart bbox centre is within 0.01 of the origin after the fix. The star has 30 vertices (10 triangles), the heart 144.
6. **Materials by shape.** `TipMarkers.syncShape(i)` uses a material with `side === DoubleSide` for flat shapes (5–9) and `FrontSide` for solids. **Assert against `THREE.DoubleSide`/`THREE.FrontSide` imported from three, not literals** (the regression test for B1).
7. **Limit.**
   - With 300 synthetic tips across 3 plants and `tipLimit = 64`, `mesh.count === 64`, and the outer loop exits (spy on the plant iteration).
   - `tipLimit` max equals `MAX_TIPS`.
   - A custom geometry with 2,048 triangles gives an instance cap of 128 under the budget rule (262144/2048).
8. **Colour.** With `tipShape = 9` and no image loaded, the instance colour equals `plantColor*1.6+.35` (not white). With an image loaded, it equals `white*brightness`.
9. **Orientation.** 'growth' shapes: the instance quaternion rotates +Y onto `tip.dir` (dot > 0.999). 'camera' shapes: the quaternion equals `camera.quaternion` **of the same frame** (call `update` after changing the camera; assert no lag).
10. **OBJ parser** (port test-stage-tips.cjs:28-31 plus more cases):
    - `custom-tip-example.obj` gives 36 floats, all |x| ≤ 1.
    - `v NaN 0 0` → /Invalid/.
    - A face referencing a missing vertex → /Invalid/.
    - 2,049 triangles → /2,048/.
    - Negative indices and trailing `# comment` work.
    - 10,001 vertices → /10,000/.
    - 65-gon → /Invalid/.
    - Zero-extent → /usable extent/.
    - `vn`/`vt`/`usemtl` lines ignored.
11. **Upload lifecycle.**
    - A second `load()` disposes the first geometry or texture.
    - A stale load (token bumped mid-await) disposes its result and resolves to `{index: -1, message: 'superseded'}`, so a status is always set.
    - A >8 MB file rejects with "8 MB".
    - `.gif` rejects.
    - `dispose()` disposes the current asset and invalidates pending loads.
12. **reflectedStep** (port test-stage-tips.cjs:16-20): over 10,000 steps |x| ≤ limit and |Δx| ≤ distance. `distance=0` keeps x. `limit=0` gives 0. A huge distance stays bounded. `ScreenBounce.begin()` then `restore()` leaves `projectionMatrix` and `projectionMatrixInverse` bit-identical, including when the render throws (try/finally).
13. **Controls and GROUP.** All ten keys exist with the §3 ranges and defaults (except `tipLimit` max per B3). None lands in `'More'`. `NO_RANDOM` covers `screenBounce` and `tipLimit`, and random mix never yields `tipShape` ≥ 9.

### 9.2 Needs a browser (Chrome WebGPU, plus Chrome `?forceWebGL` / Safari / Firefox for the WebGL2 fallback). A dev page such as `?materialTest` that lays out a rigid organism and a soft sheet for each material makes this quick.
1. Each of the ten materials animates visibly at speed .8. At speed 0 with audio response 0 it is static. Playing MIDI chords brightens surfaces and hits flash them (biolume and ripple rings clearly; all ten after B11). Pattern scale .25→3 changes the stripe frequency. There are no shader compile errors in the console on either backend.
2. Switching the material 22→31 repeatedly for 2 minutes with 64 soft plants alive: no frame hitch > 100 ms after first use, and no growth of GPU memory (check `renderer.info.memory` / Chrome task manager).
3. Tip shapes 0–8: every shape is visible from the default camera and from a camera orbiting 360°. Disc, hexagon, star and heart always face the camera with no lag during fast orbit. Cones and rings follow the growth direction. Custom PNG with transparency: a crisp cut-out, correct colours, not stretched for a 2:1 image. Custom OBJ (example tetrahedron, plus a 2k-triangle logo): visible, correct size. Custom GLB: visible (if B17 is adopted).
4. `tipLimit` changes the visible count across its full range, and `tipSize`/`tipBrightness` respond. Reset keeps the uploaded marker. Engine switch then back: the marker is gone (session-only), `tipShape` falls back gracefully (no white spheres), and the status says so.
5. Screen bounce with the camera locked: the sculpture travels and reflects at the edges and stays inside the frame for 5 minutes. Toggling off restores normal framing. A 10 s recording and a `still` snapshot include the bounced framing, and nothing is left permanently offset afterwards.
6. Liquid look (soft liquid plus tidal glass): smooth, non-faceted, lit from the outside (B1/B2 fixed). Silk look: ribbons visible from both sides.
7. Long-run: leave the materials animating at speed 3 for 1 hour of real time, or set `uMatClock` near the wrap boundary: no visible jump at the wrap and no jitter.
8. Weak-laptop check: with auto quality on, frame time with an animated material is within 5% of `standard` in a 60k-segment scene. The bounded patterns should cost about the same as the existing noise shaders, and less than marble, fire or lava, which use `mx_fractal_noise`.

### 9.3 Existing v19 tests (run read-only on 2026-09-23; both pass)
- `node maintenance/test-dynamic-materials.cjs` passes, printing per-material node counts (22–35 arithmetic, 1–3 sin) and `PASS: ten distinct bounded patterns, animation/audio response, silent beat gating, speed freeze, soft-material reuse and disposal`.
- `node maintenance/test-stage-tips.cjs` passes with `PASS: bounded continuous reflection, no speed-zero motion, OBJ limits/normalisation/comments, flat shapes, upload replacement/disposal`.
- Their stub-based design (`Et:2`, a numeric TSL model, no `syncTipShape` execution) is why B1/B3/B4/B5 were not detected. Port the logic cases above into vitest with real three.js objects, and do not port the `bundle.includes(...)` parity checks.

---

## Appendix A: minified symbol map for this cluster (v19 bundle → TS / three)
| minified | meaning | evidence |
|---|---|---|
| `tw` | OrganismEngine class | task map |
| `G(c,k)` | `ctl(controls,key)`, a linear `find` | bundle `function G(i,e){const t=i.find(s=>s.key===e);return t?t.value:0}` |
| `I_` / `L_` | GROWTH_SHADERS / ENV_SHADERS | bundle@1037436 `I_=[{name:"standard",…` |
| `ks` | `std()` helper (MeshStandardNodeMaterial factory) | bundle `ks=i=>{const e=new Tc;…}` |
| `bf` | `reactify()` | bundle `function bf(i){…e.positionNode=oj.add(tj.mul(nL));const t=KX.rgb.mul(rL);…}` |
| `on` | TSL `uniform` | bundle `cp=on(0),WT=on(0),…` (uEnergy…uFlash) |
| `ot` | `positionWorld` (TS `pw`) | bundle `ot=lj` in the TS `pw` position |
| `pc`, `Ri`, `Le`, `eL`, `cl`, `RC`, `Za`, `Qc` | sin, mix, vec3, clamp, smoothstep, length, fract, float | shader bodies line up 1:1 with shaders.ts |
| `Yg`, `Zg` | `hue()`, `fresnel()` | bundle `const Yg=i=>eL($T(Za(Qc(i).add(Le(0,.6667,.3333)))…` |
| `KX` | TSL `diffuseColor` | used by `bf` exactly where TS reactify uses `diffuseColor` |
| `b` | the TSL namespace object (`b.materialColor` = TSL `materialColor`) | bundle `const R0=b.mx_worley_noise_float;…` |
| `Tc` / `xs` / `eo` | MeshStandardNodeMaterial / MeshBasicMaterial / MeshBasicNodeMaterial | `ks` uses `Tc`; tipMesh uses `new xs({toneMapped:!1})` (TS :683); toon/neon use `eo` |
| `fn`, `Et`, `yi` | **FrontSide = 0, BackSide = 1, DoubleSide = 2** | bundle@41553 `…Wf=3,fn=0,Et=1,yi=2,…` |
| `kp` | IcosahedronGeometry | `class kp extends Wx{…}` (golden-ratio vertices) |
| `Hc`, `Dp`, `l2`, `u2`, `Py`, `Up` | Box, Octahedron, Cone, Torus, Circle, Plane geometry | `this.type="BoxGeometry"` etc. |
| `Ct`, `es`, `A` | BufferGeometry, BufferAttribute, Vector3 | class definitions |
| `IU`, `us` | CanvasTexture, `"srgb"` (SRGBColorSpace) | `class IU extends fs{…isCanvasTexture}`, `us="srgb"` |
| `$t` | Mesh | soft-growth.js `new $t(geometry,material)` |
| `XC` | `MAX_TIPS` = 200 | bundle `,XC=200` |
| `Dt`, `Hs`, `q`, `ge`, `ne`, `Pe` (in frame) | glow, tip count `nt`, plant `p`, tip, position, scale `s` | TS :2548-2562 |
| `Zt` | `ctls` Map (main.ts:124) | task map |
| `te`, `Y`, `vs`, `Hi`, `Tx`, `he` | current engine, `$`, setStatus, save, download, settings | task map / main.ts |
| `hl`, `Qa` | recorder instance, MediaRecorder format list (v0.17+ only) | recording-ui.js |
| `referenceSet(k,v)` / `referenceValue(k,f)` | `Zt.get('e:organism:'+k)?.set(v)` + referenceSync / `Zt.get(…)?.c.value ?? f` (organism only) | v19 reference-ui.js:11-17 |
