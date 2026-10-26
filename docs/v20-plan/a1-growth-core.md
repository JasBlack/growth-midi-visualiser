# A1 — Organism growth core audit (organism.ts @ v0.15.0, cross-checked against v0.19.0 bundle)

Scope: `C:\Users\User\Desktop\code\growth-midi-visualiser\src\midi\engines\organism.ts` (2790 lines). This covers the species table, the Plant/Seg/Tip model, `newPlant`, `startSegment`/`finishSegment`, the grow and retract loops, fusion, cohesion, budget and capacity, recycling, `makeRoom`, `removeSeg`, `writeSeg`/`writeColor`, cycles, nested growths, typography, physics, seasons, wild, fillRate and maxLive.
I checked every finding against the v19 bundle `C:\Users\User\Downloads\growth-v0190\assets\index-BWYXfAkm.js` and the `maintenance/*.js` modules. **None of the core bugs below is fixed in v19.** v19 changed only pacing (the `segmentAllowance` credit allocator in `maintenance/music-focus.js`, and removal of the 30 % budget throttle per NOTES_V0172 §3), colour emphasis (`writeColor` wrapper plus an 800-segment/frame colour sweep) and soft-species overlays. Where v19 changed something relevant, the finding says so.

Line numbers refer to organism.ts unless stated otherwise. Minified anchors are quoted from the v19 bundle.

---

## Severity: HIGH

### H1. Tips die at an absolute radius of 0.008, so thin species, soft notes, high notes, low `thickness` and nested levels produce little or nothing
- **Where:** `startSegment` L1936 (`tip.r < 0.008 → dropTip`), start radius L1632 `r0 = (0.014 + 0.05*velocity) * thickness * sp.thickness * (1.4 - 0.6*octN) * scale`, taper in `finishSegment` L2033, dichotomous split L2053-2054, branch radius L2049/L2058, typography L2263. v19 is unchanged: `.r<.008||e.depth>n.sp.maxDepth){this.dropTip(e)`.
- **Scenario (computed with the real species constants; script in scratchpad `r0.cjs`):**
  - **Neuron** (the v19 "Neural" look sets `thickness` 0.8, and "Surprise" can take it down to 0.70): velocity 0.25 in a high octave gives `r0` = 0.0068, which is below the threshold. **The note grows nothing.** In a middle octave, `r0` = 0.0097: the trunk lives for about 20 segments and every branch dies at birth (0.0097 × 0.8 < 0.008).
  - **Lightning** at thickness 1 and a soft high note gives `r0` = 0.0074, so nothing grows. At thickness 0.5, lightning, fungi, neuron, snowflake and sea fan all produce **zero** segments for soft notes.
  - **Nested level 2** multiplies by `scale = 0.45² = 0.2`. Almost every species then starts below 0.008, so nested depth 2 and 3 do nothing visible.
  - **Typography:** `r = 0.03*thickness*(size/14)` drops below 0.008 when thickness is under about 0.27, so the text never draws.
- **Why it matters:** this is the most direct cause of "growth does not visibly follow the music". Quiet or high notes on thin looks are simply swallowed. Audio pseudo-notes have velocity 0.245–1, which puts them in the dead zone.
- **Fix:** make death relative. Store `plant.r0` and drop a tip when `tip.r < plant.r0 * 0.12`, with an absolute floor of about 0.0015 so the GPU still draws something. Also clamp `r0 >= 0.006` so every note shows at least a visible sprout. Let velocity scale **length/speed** more and radius less.

### H2. A tip can keep a reference to a segment that was already removed. It then overwrites another segment's instance, and growth restarts from a segment that no longer exists
- **Where:** `removeSeg` L1703-1714 never clears `tip.seg`. Three paths remove a segment that a live tip still points to:
  1. **Reverse cycle:** L2441 `if ((p.held || p.autoUntil > t) && !this.reversing) continue` means held plants are retracted while reversing. Their tip segments are removed (L2459-2463, L2477) but the tips stay.
  2. **Tunnel cull:** L2630-2637 removes every segment 25 units behind the camera, whether its plant is held or not.
  3. `growText`/`newPlant` paths are fine. `makeRoom` skips held and auto plants, so it is safe.
- **Scenario:** set `cycleEvery` to 10 and `cycleMode` to reverse, and hold a chord. During the reverse phase, held plants unwind, including their in-progress tip segments. When `reversing` flips back, the grow loop at L2389-2394 runs `seg.growth += …` and `writeSeg(seg)` on the removed segment. `seg.idx` now belongs to whichever segment was swapped into that slot, so **that other segment's matrices are overwritten** (a random piece of the organism jumps or disappears). `finishSegment` then sets `tip.pos = ghost.b`, so new branches start from a point that is no longer attached to anything. Held plants whose skeleton fully unwound resume from tips floating in the void. In tunnel mode the same thing happens every 30 frames for lagging tips.
- **Fix:** give `Seg` a `tip?: Tip` back-reference, or scan `seg.plant.tips` in `removeSeg`. Set `tip.seg = null` and `tip.pos.copy(seg.a)`, and set `seg.idx = -1`. Guard `writeSeg`/`writeColor` against `idx < 0`. While reversing, clear held plants' tips or skip held plants.

### H3. Every seg/colour write re-uploads the entire instance buffers of all 6–7 meshes, every frame
- **Where:** `writeSeg` L1744 / L1756 / L1771-1772 and `writeColor` L1695-1700 set `needsUpdate = true` on `instanceMatrix`/`instanceColor` of `segMesh`, `segRib`, `segCrys`, `leafMesh`, `sphereMesh` and `cubeMesh`. No `addUpdateRange` is used anywhere; the bundle only contains three.js's own definition of it.
- **Scenario:** any frame in which a single segment grows (i.e. every frame while music plays) uploads `cap × 64 B × 6` of matrices plus `cap × 12 B × 6` of colours. At the default budget of 60k that is about **27 MB per frame**, or 1.6 GB/s at 60 fps. At 250k it is about 115 MB per frame. **v19 makes this unconditional:** `draw(){this.refreshMusicFocus();…` rewrites 800 colours on every draw, so the full colour buffers of all six meshes are uploaded every frame even in a static scene. On a weak laptop this is probably the single largest GPU cost after fill-rate.
- **Fix:** track `dirtyMin`/`dirtyMax` per attribute. At the end of `frame()`, call `attr.clearUpdateRanges(); attr.addUpdateRange(min*16, (max-min+1)*16)` (matrices) or `*3` (colours), then `needsUpdate = true` once. Both WebGL and WebGPU backends honour `updateRanges` in r185. In practice the dirty range is "the tail plus a few swap-remove holes". For many scattered holes, keep a small list of ranges and merge them.

### H4. Each segment occupies a slot in six instanced meshes. Five of the six are zero-scale instances that still run the full vertex shader
- **Where:** `writeSeg` L1740-1772 writes a real matrix into one tube mesh (or rib/crystal), one node mesh and possibly the leaf mesh, and `ZERO_M` into the others. L2483 sets `count = segs.length` on all six. The only culling is per mesh, L2485-2504: a mesh is skipped only if *no plant at all* uses it.
- **Scenario:** with mixed species (the v15 default is random over all 25; any look with a node species plus a skinned one), every mesh is visible and draws `segs.length` instances. Vertex count per segment slot: open cylinder 16 + lathe (12+1)×(8+1)=117 + octahedron 24 + **Icosahedron(1,1) non-indexed 240** + box 24 + plane 4 ≈ **425 vertex invocations per segment**. Only about 16–256 of those are useful. At 60k segments that is about 25 M vertex-shader invocations per frame through TSL `reactify` materials.
- **Fix, in increasing effort:**
  - (a) Make the node sphere `mergeVertices(new IcosahedronGeometry(1,1))` (indexed, 42 verts), or detail 0 for nodes. The lathe drops to 6×5 below 50k.
  - (b) Give each mesh its own compact index space. `Seg` holds `iTube`, `iNode`, `iLeaf` (or -1), and each mesh has its own swap-remove list, so every mesh draws exactly the instances it needs.
  - (c) Longer term, move segments to one storage buffer and one merged "tube+cap" geometry, selecting the variant per instance in TSL.

### H5. `maxPlantSegs` is tied to the current *allocation*, not the budget, so a held note stops at 1,666 segments
- **Where:** L654-656 `Math.max(800, Math.min(12000, Math.round(this.cap / 12)))`, used at L1936, L2398 and L2411. v19 is unchanged (`get maxPlantSegs(){return Math.max(800,Math.min(12e3,Math.round(this.cap/12)))}`).
- **Scenario:** `cap` starts at 20,000 (L601) and only doubles once the *whole world* fills it. A long pad or drone note therefore stops growing at 1,666 segments. All its tips are dropped at L1936, and re-sprouting (L2411) is gated on the same limit, even though the budget is 60k and the scene holds perhaps 3k. This matches the owner's complaint that "growth stalls at limits".
- **Fix:** base the per-plant share on the budget and on how many plants are live, e.g. `max(800, min(budgetCap()*0.5, budgetCap()/max(2, live)))`. When a plant hits its share, **freeze its oldest region, not its tips**: keep growing at the tips and recycle the plant's own oldest non-structural segments.

### H6. At the limit, tips are *killed* instead of paused, so held notes freeze permanently
- **Where:** `addSeg` L1671-1672 returns null when `segs.length >= cap-1`, growth is impossible and `makeRoom` could not free anything. `startSegment` L2016-2018 (and the path branch L1955) then calls `dropTip` on null. `makeRoom` L1659-1668 skips all held and auto plants.
- **Scenario:** budget full, and every plant is held or sustaining (a big chord, or v19 reference auto-fill). Every tip that tries to start a segment is deleted. The re-sprout block adds up to 3 tips per frame, and they are deleted too. When recycling later frees room, those plants have no tips and grow only through re-sprouts. The structure looks frozen while keys are held.
- **Fix:** on a null `addSeg`, `return` and leave the tip waiting (it retries next frame). Only drop tips for geometric reasons (depth, bounds, radius).

### H7. Growth budget (`fillRate` credits) and tip glow are handed out oldest-plant-first, so the newest notes starve
- **Where:** grow loop L2375-2388: `for (const p of this.plants)` in insertion order, with a shared `addBudget`; `if (addBudget <= 0) continue`. Tip glow L2551-2564 fills `MAX_TIPS = 200` oldest-first. v19 replaced the budget with `segmentAllowance` (fractional credit, capped at 64) but **keeps the same oldest-first loop** (`let x=this.segmentAllowance(g,s);for(const q of this.plants){…if(!ne.seg){if(x<=0)continue;x--,this.startSegment(ne,e,n)}`).
- **Scenario:** at v19's `fillRate` of 240–300/s, one frame is worth about 4–5 segment starts. With a sustained coral chord already live (maxTips 40 per plant), the older plants' tips use up the whole frame's credit. A **newly struck note gets no new segments** until they drain. The newest plants also get no glowing tip marker once 200 older tips exist. The note you just played is the one that visibly does nothing.
- **Fix:** iterate plants newest-first, or share credit round-robin weighted by `recent note-on + velocity`. At minimum, reserve about 50 % of each frame's credit for plants younger than 0.5 s. Iterate glow newest-first. Also: `startSegment` calls that end in `dropTip` (depth, bounds) consume credit without producing a segment. Refund the credit when no segment was added.

---

## Severity: MEDIUM

### M1. Fusion (the headline "tips that touch fuse") almost never fires, and when it does, it leaves a gap
- **Where:** `nextDir` L1871-1883 fuses only when the tip's *current position* is within `tip.r + seg.r + 0.05` (about 0.07–0.12 units) of another plant's endpoint. `fuse` L1913-1927 bridges only `if (tip.seg)`, but `nextDir` is called only from `startSegment`, where `tip.seg` is always null (`finishSegment` L2030 clears it first).
- **Scenario:** tips step 0.3–0.55 units per segment. Attraction steers them toward a target, but the chance of an endpoint *landing* inside a 0.1-radius ball is small, so tips overshoot and orbit. When a fuse does happen, no bridging segment is drawn, leaving a visible hole of up to about 0.12 units.
- **Fix:** test the target against the *proposed* segment. If `dist(target, tip.pos) < len*1.1`, set `b = target.point`, add the segment, and mark `tip.fuseWith = seg`. In `finishSegment`, call `fuse` (the segment now ends exactly on the other structure). Exclude `dying` plants and text plants from `nearestEndpoint`, because fusing onto a structure that is being recycled makes the new plant permanent while its partner vanishes.

### M2. `nearestEndpoint` is O(all segments) per segment start. Other per-frame full-array passes add up too
- **Where:**
  - L1895-1911: full scan of `this.segs` for every tip start.
  - `newPlant` L1583 `this.segs.filter(s => s.growth >= 1)`: allocates an array the size of the world on every note-on.
  - Camera centroid and radius loops L2577-2590: two full passes per frame (v19 still does them when unlocked).
  - Lignify loop L2422: all segments of every live plant, every frame.
  - Retract target scan L2443-2448: walks the whole plant backwards every frame for fully-permanent dormant plants.
- **Scenario:** at 60k segments and the v15 default of 1,500 starts/s, `nearestEndpoint` alone is about 90 M distance tests/s. The per-frame passes add about 4 × segs iterations (240k at 60k, 1M at 250k), roughly 5–10 ms/frame on a weak laptop before any GPU work. A fast arpeggio at 250k allocates 250k-element arrays per note.
- **Fix:**
  - Spatial hash (a 1-unit cell `Map<number, Seg[]>` or `Int32Array` buckets) updated in `addSeg`/`removeSeg`/`finishSegment`. `nearestEndpoint` then checks 27 cells.
  - Graft host: pick `segs[random]` and retry up to 8 times until `growth >= 1`, instead of filtering.
  - Keep running sums for the centroid (add/subtract `a` in `addSeg`/`removeSeg`) and sample the radius from a strided subset or the 90th percentile. This also stops one stray segment from dragging the camera out.
  - Store `p.firstSoft`, the index of the first non-permanent segment (segments lignify in birth order), so the lignify loop and retract scan become O(1).

### M3. `removeSeg` uses `indexOf` + `splice` on the plant's segment list, making it quadratic for big plants
- **Where:** L1712-1713. Callers almost always remove the *last* segment (`makeRoom` L1664, retract L2471/L2477), but `indexOf` scans from the front.
- **Scenario:** `makeRoom(600)` on a 12k-segment plant does 600 × 12k = 7.2 M comparisons in one `addSeg` call, which is a frame hitch exactly when the budget is full.
- **Fix:** `const pi = seg.plant.segs.lastIndexOf(seg)`, or a fast path `if (plant.segs[plant.segs.length-1] === seg) plant.segs.pop()`. Better still, store `seg.pi` and swap-remove inside the plant too, if plant order is not needed (it is currently used for retract order, so keep `lastIndexOf`).

### M4. `deform` assumes `segs` is in birth order, but swap-remove breaks that. Toggling wild or physics off also leaves segments frozen in their displaced pose
- **Where:**
  - L2105-2110: loops from the end and `break`s at the first segment older than 9 s. `removeSeg` L1705-1709 moves the newest segment into the removed slot.
  - L2078: `if (wild <= 0 && !physics && !nerves) return`, with no restore pass.
- **Scenario A:** with wild > 0 and recycling active, young segments swapped into low indices are never reached, so their last swayed pose freezes. Neighbouring segments keep swaying, which produces cracked joints for up to 9 s. The offset becomes permanent because the fade-to-rest write never happens.
- **Scenario B:** turn wild from 1 to 0, or physics off, mid-show. Every displaced segment stays drawn at its displaced or drooped position forever (until swapped or cap-rebuilt), while `seg.a`/`seg.b` and new tips use rest positions. New growth then starts visibly detached from the drawn skeleton.
- **Fix:** keep a `youngList` (a ring of segments with `born > t-9`) instead of relying on array order. On the transition of `wild`, `physics` or `nerves` from on to off, run a one-shot batched rest-pose rewrite (for example 20k per frame).

### M5. Capacity doubling rebuilds every material and pipeline mid-performance, and changes the geometry detail
- **Where:** `growCapacity` L704-714 calls `buildMeshes` L663-701. That disposes all meshes and materials, creates new `MeshStandardNodeMaterial`s, then calls `applyShaders()` (new growth shader material plus a new sky sphere) and `rebuildEnv()`, and re-writes every segment. Radial/blob/rib detail changes at 50k and 120k.
- **Scenario:** the world crosses 20k → 40k → 60k segments during a set. Each crossing means WebGPU pipeline compilation for 7 meshes plus the sky, plus a full re-write of every segment in one frame. The result is a hitch of hundreds of milliseconds (visible in recordings) and a visible pop as tubes go from 7 sides to 5 and nodes lose subdivision. There is also a leak: when a growth shader is active, `buildMeshes` disposes `mesh.material` (the shared `shaderMat`) but never the 4 base materials held in `baseMats`.
- **Fix:** allocate at `budgetCap()` up front (60k × 7 meshes × 76 B ≈ 32 MB is fine), or keep the materials and only swap `instanceMatrix`/`instanceColor` attributes when growing. Choose geometry detail from the *budget* (or the quality tier) once, not from the live cap. Dispose the base materials in `buildMeshes`/`unmount`.

### M6. `release()` is not idempotent, so a plant already retired by maxLive or respawn comes back to life on key-up
- **Where:** `release` L2739-2746, maxLive L2357-2367 (releases *held* plants with `final=true` while they stay in `byPitch`), key-off L2297-2302.
- **Scenario:** hold more notes than `maxLive`, or have autonomous plants (nested children, text, v19 reference auto) push the count over. The oldest *held* notes are cut while the key is still down, and nothing grows under the performer's finger. On key-up, `release(p, t, lignify)` with `final=false` sees `autoUntil = 0` and sets `autoUntil = t + sustain`. The plant becomes live again, re-sprouts from random joints (L2411-2419) and grows for `sustain` seconds. If it had been marked `dying` in the meantime, it now grows dimmed while its retraction is suspended.
- **Fix:** start `release` with `if (!p.held && !(p.autoUntil > t)) return`. In the maxLive loop, release autonomous plants (`!p.held`) first. Never cut a held note in favour of autonomous growth; if held notes alone exceed maxLive, throttle their rate instead.

### M7. Growth speed and recycling are frame-rate dependent (at most one segment finished or removed per tip or plant per frame)
- **Where:** grow loop L2391-2394 finishes at most one segment per tip per frame and throws away the overshoot. Retract loop L2475-2478 removes at most one segment per plant per frame and throws away the overshoot.
- **Scenario:** short segments (moss 0.16 × length 0.3 = 0.05) at rate 3 units/s need 60 segments/s per tip. At 30 fps (weak laptop, or recording load) the tip only manages 30/s, so growth runs at **half speed exactly when the machine is loaded**. Recording at a different fps gives a different organism. Recycling a few huge plants frees at most `plants × fps` segments/s (5 plants × 30 fps = 150/s) while spawning at 300–1,500/s. The budget then hits the wall, `makeRoom(600)` pops whole chunks instantly (L1664) and H6 kills tips.
- **Fix:** carry the overshoot. `while (seg.growth >= 1 && credit) { rem = (seg.growth-1)*len; finishSegment; startSegment; seg.growth = rem/newLen }`. Do the same for retraction: loop removing segments while the frame's `rate*dt` distance remains, with a per-frame cap.

### M8. `speciesFor('by octave')` returns `undefined` for the lowest piano keys, and the exception in `frame()` drops that frame's other note events
- **Where:** L1522 `on[Math.min(on.length-1, Math.round(((octave(pitch)-1)/7)*(on.length-1)))]` has no lower clamp. `octave(p) = floor(p/12)-1` (music.ts:85). v19 has the same code path.
- **Scenario:** species mode "by octave" with at least 5 species on. A0–B0 (MIDI 21–23, present on every 88-key keyboard) give octave 0, which yields a negative index, so `sp` is `undefined`. L1545 `sp.hue` then throws a TypeError inside `frame()`. That frame renders nothing, and every later event in `m.events` (other note-ons and note-offs of the same tick) is lost, which can leave stuck or missing plants.
- **Fix:** `Math.max(0, …)` and clamp the octave as `newPlant` L1537 already does. Also wrap per-event handling in try/catch so one bad event cannot drop the rest.

### M9. `clear()` / Reset leaves stale cycle state, so after a Reset during a reverse cycle nothing grows for up to `cycleEvery` seconds
- **Where:** `clearGrowth` L742-747 and `clear` L749-760 do not reset `reversing`, `cycleT`, `spawnRate`, `dyingNow`, `lastChord`/`lastText` or `cycleI`. The grow loop skips all growth while `reversing` (L2380).
- **Scenario:** `cycleMode` is reverse with `cycleEvery` 60, and the user presses Reset during the reverse half. New notes spawn plants but none of them grow (`if (this.reversing) continue`) for up to 60 s. Typography also will not redraw the same chord after Reset (`lastChord` unchanged).
- **Fix:** reset `reversing = false`, `cycleT = 0`, `spawnRate = spawnCount = 0` and `lastChord = ''` in `clearGrowth()`. v19's `clear` wrapper resets only `musicCredit`/`focusCursor`.

### M10. Growth placement is independent of what the camera can see (root spread and bounds far exceed a locked view)
- **Where:** `newPlant` L1590-1598 places roots at up to `1.8 × (1 + 3.5(1-cohesion)) × size/14` from centre, about 5.9 units at cohesion 0.35, plus octave height `(oct-4)(1.1-0.7c)` of ±3.4. The bounds sphere is `size` = 14 (L1989-2000; `nextDir` L1860-1861). v19 Still mode freezes the camera and, when locked, also freezes `this.center`.
- **Scenario:** the v19 first-run Still camera at about 13–14 units with fov 48 sees roughly ±6 units vertically. Roots already spawn at the frame edge, and growth may extend to radius 14 (or 16+ units for v19 silk ribbons: `size*2` along y in `soft-growth.js`). This matches the lead's observation that silk grows mostly out of frame.
- **Fix:** when the camera is locked or calm, derive the growth bounds from the view frustum: fit `size` so the bounds sphere projects into about 80 % of the frame, and place roots in view space (`camera.unproject` of a jittered screen point at the focus depth). Alternatively, let the organism size drive the locked camera distance once (a "fit" on Reset).

### M11. Cohesion grafts land on a uniformly random segment, so new notes appear buried inside the existing mass
- **Where:** L1583-1589: graft host is `finished[random]` and roots at `host.b`. Probability is `cohesion × 0.85`, so about 30 % of notes at the default. It also grafts onto `dying` and text plants and marks the host permanent (L1628). With video or skin on, the root is overwritten later (L1600-1624) but `graft` still marks both plants fused and permanent.
- **Scenario:** in a dense scene, uniformly random segments are mostly interior, so new notes sprout inside the mass and are occluded. Unrelated plants become permanent (`fused` plants skip silence decay until `20/decay` s) even though no connection exists.
- **Fix:** bias the graft toward the hull and toward recent growth (sample about 16 candidates and take the one with the largest `|b - center|` or the newest `born`). Skip dying and text hosts. Only set `graft` if the root is actually used.

### M12. Seasons: winter leaf thinning never reaches existing leaves, the phase jumps when speed changes, and every season step re-colours the whole world with allocations
- **Where:** `seasons` L2140-2176. `leafScale` (L2173) is only read in `writeSeg` (L1747-1749), and existing permanent segments are never re-written. The phase is `(t*speed*0.01)%1` (L2144). L2175 calls `writeColor` for every segment, which allocates a `new THREE.Color` per call (L1693). The slider value is set via `setCtl` without `onControlValue`, so the panel slider does not move.
- **Scenario:**
  - Winter "bare" happens only to new leaves; the old canopy stays fully leafed.
  - Moving the speed slider warps the phase and causes a sudden season flash.
  - At 250k segments, each phase step (every 0.4 s at speed 1) triggers 250k × 6 colour writes plus 250k allocations plus a full buffer upload (H3).
- **Fix:** integrate `phase += dt*speed*0.01`. Hoist `WHITE = new THREE.Color(1,1,1)` to module scope. Rewrite leaf matrices in a batched sweep when `leafScale` changes by more than 0.05. Re-colour in a batched sweep (v19's 800/frame focus sweep can be reused). Call `onControlValue('season', …)` at 4 Hz.

---

## Severity: LOW

### L1. Lowering the `budget` slider is not enforced
- `setControl('budget')` L769-772 only runs `makeRoom` on dormant plants. `addSeg` L1671-1672 compares against `this.cap` (the allocation), not `budgetCap()`, so after 250k → 60k the world keeps growing to the old allocation. **Fix:** `const limit = Math.min(this.cap, this.budgetCap())` in `addSeg`.

### L2. `ctl()` is a linear `Array.find` with string comparison, called on hot paths
- engine.ts:79-82. `writeSeg` calls `ctl('nodes')` per segment (L1758). `nextDir` makes about 8 `ctl` calls per start, `startSegment` about 4, plus `frame`. v19 has about 134 organism controls. With wild on, `deform` rewrites every segment younger than 9 s every frame (about 13k writes/frame at 1,500 segs/s), which is about 1M string compares per frame. **Fix:** cache `this.cv = Object.fromEntries(controls.map(c=>[c.key,c.value]))` in `setControl` and read `this.cv.nodes`, or use a `Map`.

### L3. `writeColor` allocates a `new THREE.Color` per call, and `startSegment`/`addSeg` allocate 3 `Vector3`s per segment plus a Seg object
- L1693, L1940, L1679. This is GC churn at a high fill rate. Longer term, a structure-of-arrays layout (`Float32Array` a/b/r/growth/born, `Int32Array` plant) would remove most per-segment objects and make hashing, centroid and upload ranges trivial.

### L4. `growText` crashes when no stroke has more than 2 points, and drops dots
- L2261 `root: to3(strokes[0][0])`: with `pts.length > 0` but all chains of length ≤ 2 (small punctuation-only words from the typed-text-per-bar path, main.ts:1078), this throws a TypeError in the main loop every bar. The dots of i/j and full stops are always discarded (`line.length > 2`). **Fix:** `if (!strokes.length) return` and keep 1–2-point strokes as tiny tips. The greedy chaining is O(pts²) per word, which is fine for chord names but should be capped for long typed text.

### L5. `respawnHeld` runs once per species toggle, so a v19 look change triggers it about 37 times in one click
- L765 `if (key.startsWith('sp:') || key === 'species') this.respawnHeld()`. v19 Simple looks and Surprise set up to 37 `sp:*` controls in a row. With notes held, that means 37 × held-count full plant re-creations (each doing the L1583 filter) and 37 `spawn` sounds via `onEvent`. **Fix:** set `this.respawnDue = true` and do the work once at the start of the next `frame()`.

### L6. Nested children and respawns fire `onEvent('spawn')`, which plays synth notes nobody played
- L1654 is called from `release` (nested, pitch + 12) and from `respawnHeld`. Releasing a key with nested on plays 2–3 ghost notes an octave up. **Fix:** pass `opt.silent` for autonomous spawns.

### L7. Tunnel cull updates `count` on only 3 of the 6 meshes
- L2636 `this.segMesh.count = this.sphereMesh.count = this.cubeMesh.count = …`. Rib, crystal and leaf keep the pre-cull count for that frame and draw stale tail instances (a one-frame flicker every 30 frames in tunnel mode). The cull filter L2635 also drops sustaining or text plants with zero segments early (it ignores `autoUntil`). **Fix:** set all six counts; reuse the main filter predicate.

### L8. `unmount` leaks GPU and JS resources that are not tied to the renderer
- L2776-2789 never disposes:
  - `videoTex`: a `VideoTexture`'s `requestVideoFrameCallback` chain keeps running on the shared video element after an engine switch. `dispose()` cancels it.
  - `backdrop`, `sky` geometry/material (only removed), floor/ceiling geometry and material, `shellMat`, shell group geometries, loaded model geometries plus BVH (`disposeBoundsTree`), `mixer`, `post`/`bloomNode`, and the 4 base materials in `baseMats` when a shader is active.
- `selectEngine` creates a new instance each time (main.ts:250-267), so most JS is garbage-collected, but the video callback chain and device-side resources can outlive it. **Fix:** a single `disposeAll()` that walks `scene.traverse`, disposing geometry, material and textures, plus `videoTex.dispose()` and `post?.dispose()`.

### L9. `makeInstanced` picks a storage-buffer attribute by `'gpu' in navigator`, not by the backend actually in use
- L721 (and L578). When `navigator.gpu` exists but no adapter is granted (blocklisted GPU, some Linux/Firefox builds), `WebGPURenderer` silently falls back to WebGL2, yet the instance matrices are still `StorageInstancedBufferAttribute`s. This is probably harmless in r185, but it contradicts the comment and is not tested. **Fix:** after `await renderer.init()`, use `renderer.backend.isWebGPUBackend`.

### L10. `deform`'s nerve pulse uses `% period`, which can be negative, and `t` is absolute page time
- L2130 `head = (t*speedN + p.id*1.3) % period`. `speedN` changes with energy every frame, so `t*speedN` jumps by up to `t × Δspeed` (hundreds of units after a few minutes), and the nerve signal teleports on every energy change rather than travelling. **Fix:** integrate a per-engine phase, `phase += dt*speedN`.

### L11. The species table forms a single long list with no musical ordering
- `by note` mode uses `on[pitch % on.length]` (L1526), so adjacent semitones land on unrelated species. With 25 (v15) or 37 (v19) entries, chords become visual noise. This is design rather than a bug; see the design notes below.

---

## Design notes toward "obviously a music visualiser" (growth-core level)

1. **Music currently changes only *speed*, not *form*.** In the growth core, music enters only through the per-plant rate (`(0.75+0.5·energy)·(1+speedReact·(…))`, L2382), bass/treble radial drift (L1859) and the wild-only bursts (L2508-2524). Branching probability, radius, direction and species are music-agnostic once a plant exists. Proposed direct mappings, all toggleable:
   - **onset or hit → branch burst:** the existing `wild` burst code at L2513-2521, promoted to a normal `React` control "hits sprout branches", independent of wild.
   - **velocity → segment length and burst size** (not only radius; see H1).
   - **pitch → growth direction:** high notes bias upward and outward, bass downward and inward, via a pitch-weighted term in `nextDir`.
   - **for audio input, `m.chroma[pc]` → that plant's live rate,** so a plant grows while *its* note sounds instead of on global energy.
   - **note-off → visible "set" (lignify flash):** a brief colour pulse on the segments that turned permanent.
2. **Lignify versus staccato.** Segments become permanent only after `lignify` seconds held (1.6 s). Short notes retract entirely, and silence decay (L2451-2454) erodes non-fused skeletons in every inter-note gap (`silent = m.active.size === 0`). Fast passages therefore leave nothing. Consider letting accent (velocity above 0.8) or the beat make a note's growth permanent, and gate decay on a longer silence (for example 1.5 s without events) rather than on instantaneous emptiness.
3. **Bounded fair scheduling.** One scheduler should own "who gets to add segments this frame" (newest notes first, velocity-weighted) and "who gives segments back" (oldest dormant, smooth retraction with carry-over). The current mix of `addBudget`, `maxLive` releases, the pressure throttle (removed in v19), `pruneLeft`, `makeRoom` pops and `maxPlantSegs` drops has four independent mechanisms that interfere (H5, H6, H7, M6, M7).
4. **Data layout.** Moving `Seg` to structure-of-arrays with a spatial hash and per-mesh compact index spaces fixes H3, H4, M2, M3, L3 and makes 250k segments realistic on a laptop.
5. **v19 soft species (in the species table).** The "Liquid" look builds `new kp(1,2)`, which is `IcosahedronGeometry(1,2)`: non-indexed, 320 faces. It then calls `computeVertexNormals()` (soft-growth.js). On non-indexed geometry that produces per-face normals, which is why Liquid renders as faceted low-poly. Use `mergeVertices(new IcosahedronGeometry(1,4))` (indexed, so normals are smooth), or compute analytic normals from the radial displacement. Silk's `y = along` up to `size*2 = 16` units from the root ignores bounds and camera (see M10).

---

## Quick wins (each is small and low-risk)

1. `removeSeg`: `lastIndexOf` (or pop when last) instead of `indexOf` (M3). One line.
2. `speciesFor` by-octave: `Math.max(0, …)` (M8). One line.
3. `startSegment`/`addSeg` null result: `return` without `dropTip` (H6). Two lines.
4. `maxPlantSegs`: use `budgetCap()` instead of `this.cap` (H5). One line.
5. Relative tip death `tip.r < plant.r0*0.12` plus a floor on `r0` (H1). About 5 lines.
6. `release()`: early return if already released. maxLive releases non-held plants first (M6). About 6 lines.
7. `clearGrowth()`: reset `reversing`, `cycleT`, `spawnRate` and `lastChord` (M9). 4 lines.
8. `removeSeg`: null out the owning tip's `seg` and set `idx=-1` (H2). About 6 lines.
9. Iterate plants newest-first in the grow loop and in tip glow (H7). About 2 lines each.
10. Hoist `WHITE` Colour, and cache control values in a plain object (L2, L3).
11. `addSeg`: enforce `min(cap, budgetCap())` (L1). One line.
12. `growText`: `if (!strokes.length) return` (L4). One line.
13. Batch all `needsUpdate` flags to one per attribute per frame with `addUpdateRange` over the dirty span (H3). About 30 lines; the biggest perf win for the effort.
14. Debounce `respawnHeld` to the next frame (L5). 3 lines.
15. Indexed node sphere via `mergeVertices` (H4a). 1 line; cuts about 200 vertex invocations per segment.
