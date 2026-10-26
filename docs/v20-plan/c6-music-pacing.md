# C6: Musical pacing and emphasis. Porting spec (v0.17.2 + v0.19.0 into TS v0.15.0)

Cluster scope: segment start credits, the growth-amount multiplier, highlighting new growth and dimming old growth, the fresh trail, the Music-led settings macro, removing the budget throttle, audio onset sensitivity, and the music values baked into the Simple-mode looks and macros.

Target: `C:\Users\User\Desktop\code\growth-midi-visualiser` (tag v0.15.0). The TS source is the target. The v19 bundle is evidence of intent, not code to copy.

## 0. Sources read

v19 compiled lineage (`C:\Users\User\Downloads\growth-v0190`):

- `maintenance\music-focus.js` (58 lines): camera lock, `segmentAllowance`, `focusLevel`, `refreshMusicFocus`, the `writeColor` wrapper and the `clear` wrapper.
- `maintenance\music-focus-ui.js` (23 lines): the `#cameraLock` button, the Music growth sliders and the `#musicLed` macro.
- `maintenance\patch_music_focus.py` (75 lines): builds v0.17.2 from v0.17.1. Every anchor edit is listed in section 5.
- `maintenance\test-music-focus.cjs` (34 lines): the Node regression test. **It passes when run read-only today.**
- `maintenance\patch_consolidation.py` (90 lines): builds v0.19.0. It contains the audio-sensitivity edit (L32-34), appends `simple-ui.js`, and adds the Simple card HTML (L57-70).
- `maintenance\simple-ui.js`: the Simple look base values, the `simpleGrowth` and `simpleAudio` handlers, and `simpleReference`.
- `maintenance\reference-growth.js`: `videoBuildPace` auto-fill pacing (shared with the reference cluster).
- `maintenance\soft-growth.js`: the `focusLevel` use on soft species.
- `maintenance\tip-shapes.js`: `syncTipShape`, which is relevant to the depthTest issue.
- `maintenance\reference-ui.js`: `referenceSet` and `referenceValue`. **This copy is STALE compared with the bundle** (see bug 7.31).
- `NOTES_V0172.md`, `NOTES_FOR_CLAUDE.md` (the "Music response" section), `START_HERE_v0190.md` and `README.txt` (the v0.17 and v0.19 sections).
- `assets\index-BWYXfAkm.js` (v19 bundle): read at every anchor quoted below.
- `index.html`, line 230: the Music growth section inside `#referenceTools`. Line 355 holds the `#cameraLock` button. Line 126 holds the `#cameraLock` CSS.

TS source (`C:\Users\User\Desktop\code\growth-midi-visualiser`):

- `src\midi\engines\organism.ts` (2790 lines):
  - controls: 371-446
  - GROUP map: 226-244
  - Plant and Seg types: 167-206
  - fields: 448-568
  - mount and pointer handlers: 570-646
  - buildMeshes and tipMesh: 663-701
  - growCapacity: 704-714
  - clearGrowth and clear: 742-760
  - setControl: 762-778
  - draw: 871-879
  - shedOldest: 1499-1506
  - newPlant: 1529-1656
  - makeRoom: 1659-1668
  - addSeg: 1670-1685
  - writeColor: 1687-1701
  - removeSeg: 1703-1714
  - startSegment and finishSegment: 1934-2070
  - seasons: 2140-2183
  - `lastGTime`: 2269
  - `frame()`: 2274-2737, containing events 2292-2304, maxLive 2355-2367, throttle and addBudget 2369-2375, the grow loop 2376-2423, recycling 2425-2479, tip glow 2547-2569, the camera 2571-2702 and fog 2712
  - release and sustain: 2739-2774
  - unmount: 2776-2789
- `src\midi\inputAudio.ts`: onset detector 398-409, stems 410-428, `emitPseudoNotes` 454-475.
- `src\midi\main.ts`:
  - settings and `save()`: 68-99
  - `Ctl` and `ctls`: 114-124
  - `widget()`: 134-224
  - `selectEngine`: 245-280
  - `renderEngineControls`: 306-395
  - `renderGlobalControls`: 397-416
  - presets: 441-534
  - randomMix and NO_RANDOM: 463-493
  - resetEngine: 991-995
  - loop: 1041-1094 (`audio.analyze()` at 1043)
- `src\midi\music.ts`: `MusicClock.tick`, where dt is clamped to [0.001, 0.05] (line ~149) and `now()` returns `performance.now()/1000`.
- `src\midi\engine.ts`: `EngineControl` and `ctl()` (79-80). `ctl()` is a linear `find`.
- `src\midi\shaders.ts`: `reactify()` (56-63), the hook for a shader-based emphasis.
- `node_modules\three\src\renderers\common\RenderObjects.js:127-137` and `RenderObject.js:730-906` (three 0.185.1). These show how the WebGPU pipeline cache reacts to material changes.

---

## 1. Summary

**What it does for the user.** v0.17.2 tried to make the music, not the passage of time, drive what appears on screen. It also tried to fix "fast at first, slower later":

1. **Segment start credits** replace the old per-frame `addBudget = max(1, fillRate*dt)`. Credits are fractional, so "new segments per second" holds at any frame rate. There is no forced minimum of one start per frame, and the credit bank is capped at 64.
2. **Budget throttle removed.** Growth speed used to fall to 30% as the segment budget filled (from 60% to 95% full). It no longer does, and recycling alone makes room. This matches the owner's complaint that growth stalls at the limit.
3. **Growth amount** (`musicAmount`, default .45) multiplies growth extension speed.
4. **Restrained defaults.** `sustain` 1.5 → .25 s and `fillRate` 1500 → 300 segments/s.
5. **Highlight new / dim old** (`musicFocus`, default .8), with a **Fresh trail** (`musicTrail`, default 2 s). A segment's instance colour is scaled by a birth-age factor: new segments go up to ×1.28 and old ones down to ×0.36. Background (reference auto-fill) growth never counts as fresh. Colours of older segments are refreshed in a bounded sweep of 800 segments per draw.
6. **Musical tips.** While highlight is on, tips are cyan-tinted and drawn through the structure (depthTest off, renderOrder 10). They have a view-distance-scaled minimum size, and soft species, which have no glow, get tips too. Background auto-fill plants get no tips.
7. **Music-led settings**, a one-click macro: background fill off, amount .45, sustain .25, highlight .8, trail 2, fillRate 300.
8. **Background fill pacing** (`videoBuildPace`, 0.8 starts/s, with a 2 s lifetime and at most 4 concurrent plants), plus reference activation defaulting to music-led (`videoBuild` 0). This is shared with the reference cluster.
9. **v0.19.0 audio sensitivity.** A Simple-mode slider (0..1, default .45) scales the spectral-flux onset threshold, the minimum onset gap and the energy gate. It is stored in `globalThis.__growthAudioSensitivity`.
10. **v0.19.0 Simple looks** hard-code even more restrained values: `musicAmount` .42, `musicFocus` .7, `sustain` .2, `fillRate` 240, `speed` .75. The Simple slider "How much the music grows" is a macro over `musicAmount`, `speed` and `sustain`.

**Net effect as observed** (lead, live in Chrome): 3 held notes for 2 s grow about 300 segments, and music reaction is much less obvious than in v0.15. Section 2.12 quantifies why. With v19 defaults, one audio onset grows about 9× less geometry than in v0.15. The cause is not the credit system, which is not the binding limit at these settings. It is the multiplication of `musicAmount` (.42) × `speed` (.75) × a short `sustain` (.2 s).

**Porting stance.** Port the *mechanisms*:

- the credit allocator (with a fixed cap)
- throttle removal
- age-based emphasis (as a tracked "fresh set", not a global sweep)
- tip emphasis, as an option rather than the default x-ray
- audio sensitivity as a real persisted control
- a single source for the Music-led macro

Do **not** port the v19 defaults as they are. Section 8 has the recommended design and defaults.

---

## 2. Behaviours (exact algorithms and constants)

Notation:

- `ctl(k)` stands for `ctl(this.controls, k)`, written `G(this.controls,k)` in the bundle.
- `t` is `m.time`, in seconds from `performance.now()/1000`.
- `dt` is `m.dt`, already clamped to [0.001, 0.05] by `MusicClock.tick` (music.ts ~149).

### 2.1 Segment start credits (`segmentAllowance`), from music-focus.js:18-23

```js
segmentAllowance(rate, dt) {
  if (rate <= 0) { this.musicCredit = 0; return Infinity }      // fillRate 0 = unlimited
  this.musicCredit = Math.min(64, (this.musicCredit || 0) + rate * Math.min(.05, Math.max(0, dt)))
  return Math.floor(this.musicCredit)
}
```

Consumption is inserted in `frame()` right after the grow loop and before `const silent = m.active.size === 0` (patch L42):

```js
if (g > 0) this.musicCredit = Math.max(0, this.musicCredit - (Math.floor(this.musicCredit) - x))
// g = fillRate, x = allowance remaining after the loop (decremented once per segment START attempt)
```

Constants:

- Credit cap: **64**.
- Per-frame accrual is clamped to **0.05 s**. This is redundant, because the clock already clamps dt to ≤ 0.05.
- The allowance is `Math.floor` of the credit, so the fraction carries over.

The credit is reset to 0 in the `clear()` wrapper (music-focus.js:56) and whenever `fillRate <= 0`.

Consequences:

- Starts per frame at 60 fps: 5/frame at `fillRate` 300; 4/frame at 240.
- At 144 fps and 240/s, starts alternate between 1 and 2 per frame.
- The maximum effective rate is 64 × fps: **3840/s at 60 fps and 1920/s at 30 fps**. The `fillRate` slider goes to 8000, so its upper range does nothing (bug 7.10).
- Credits keep accruing while every tip is mid-segment. When tips then become free, up to 64 starts happen in one frame, which is a small burst.
- A credit is consumed per start *attempt*: `x--` happens before `startSegment`, which may drop the tip without adding a segment. This is inherited from v0.15.

### 2.2 Budget throttle removal (patch L39)

In v0.15 (organism.ts:2371-2372, applied at 2382):

```ts
const pressure = this.segs.length / this.budgetCap()
const throttle = 1 - 0.7 * Math.min(1, Math.max(0, (pressure - 0.6) / 0.35))   // 1.0 at ≤60% full, 0.3 at ≥95%
```

In v19, `m = 1`: the throttle is gone. `pressure` is still computed, because recycling uses it (urgency starts at 0.8, TS 2433-2439). Nothing else changed in recycling.

### 2.3 Growth amount (`musicAmount`) (patch L41)

The grow-loop rate in v19 (bundle anchor `const ge=G(this.controls,"musicAmount")*r*m*this.seasonF.speed...`; TS 2381-2382):

```
rate = musicAmount × speed_ctl × g.growth × seasonF.speed × sp.speed × (1.4 + 2.6·velocity)
       × (0.75 + 0.5·energy) × (1 + speedReact·react·(0.8·energy + 1.5·hitEnv))
```

- It applies to **every** live plant: notes, audio pseudo-notes, text, nested children and reference auto-fill. It is not specific to music, despite the name.
- It changes extension speed only. It does **not** raise `fillRate`, so it cannot raise throughput above the credit rate.

### 2.4 Default changes (patch L20-21)

- `sustain`: 1.5 → **.25** s (TS 398; the label still says "makes short notes big").
- `fillRate`: 1500 → **300** (TS 399).

### 2.5 Highlight new / dim old (`focusLevel` and the `writeColor` wrapper), from music-focus.js:24-30 and 44-50

```js
focusLevel(segment) {
  const focus = ctl('musicFocus'); if (focus <= 0) return 1
  const age = Math.max(0, (this.lastGTime ?? segment.born) - segment.born)
  const trail = ctl('musicTrail') || 2
  const fresh = segment.plant.referenceAuto ? 0 : Math.max(0, 1 - age / trail)
  return 1 - focus * .8 + focus * 1.15 * fresh
}
// writeColor wrapper: temporarily swaps plant.color for a scaled copy, calls the original writeColor, restores it
plant.color = this.musicTint.copy(original).multiplyScalar(this.focusLevel(segment))
```

The formula is `L(f, φ) = 1 − 0.8f + 1.15f·φ`, where `φ = max(0, 1 − age/trail)` and `φ = 0` for reference auto-fill plants.

| musicFocus f | old (age ≥ trail) | age = trail/2 | fresh (age 0) | old and dying (×0.45) |
|---|---|---|---|---|
| 0 | 1 | 1 | 1 | 0.45 |
| 0.5 | 0.60 | 0.8875 | 1.175 | 0.27 |
| 0.7 (Simple looks) | 0.44 | 0.8425 | 1.245 | 0.198 |
| 0.8 (control default and Music-led) | 0.36 | 0.82 | 1.28 | 0.162 |
| 1.0 | 0.20 | 0.775 | 1.35 | 0.09 |

How the scaled colour flows through the original `writeColor` (TS 1687-1701):

- `dying` multiplies the already-scaled colour by 0.45.
- Tubes, spheres, cubes and ribs get `c`.
- Crystal skin gets `c.lerp(white, .25)`, so it never drops below 0.25 absolute brightness. Its dimming is therefore weaker.
- Leaves get `c × 1.15`.
- All six `instanceColor.needsUpdate = true` flags are set on every call.

When colours are written:

- **At birth.** `addSeg` → `writeColor` gives age 0, so the segment is born bright.
- **By the sweep.** `refreshMusicFocus()` (music-focus.js:31-42) runs at the start of `draw()` (patch L52) and rewrites `min(count, 800)` segments per call using a round-robin cursor `focusCursor` (a modulo over `segs.length`). **There is no guard on `musicFocus`**, so it runs even at 0.
- **Other callers**, all inherited: growCapacity, removeSeg (for the moved last segment), seasons, shedOldest and recycling's "dying".

Soft species (soft-growth.js:44): each soft mesh's material colour is `plant.color × focusLevel(lastSeg || {plant, born: plant.birth})`. This updates at most once per 1/30 s per item and at most 16 items per frame.

### 2.6 Fresh trail (`musicTrail`)

This is the `trail` parameter above: the seconds over which a segment fades linearly from fresh to old. The range is .5..8, step .5, default 2. The fallback `|| 2` applies when the value is 0.

### 2.7 Tip emphasis (patch L53-55 on the tip-glow loop; TS 2547-2569; plus refreshMusicFocus L38-41)

The bundle's tip loop also contains the tip-cluster controls `tipLimit`, `tipShape`, `tipSize`, `tipBrightness` and `orientTip`. Only the `musicFocus` parts belong to this cluster.

- **Filter.** A plant contributes tips iff it is live (`held || autoUntil > t`) AND NOT (`sp.glow <= 0 && musicFocus <= 0`) AND NOT (`referenceAuto && musicFocus > 0`).
  - With highlight on, soft or glowless species get tips.
  - Background auto-fill never gets tips.
- **Size.** The v15 size is `s = tip.r·(1.5 + 0.8·onset)·glow·sp.glow`. The v19 size is:

  ```
  s = max( tip.r·(1.5+0.8·onset)·glow·max(sp.glow, focus),
           focus > 0 ? clamp(camPos.distanceTo(camLook)·0.0025, 0.06, 0.5) : 0 )   [× tipSize from the tip cluster]
  ```

  The whole block is skipped when the `glow` control is 0 (`if (glow > 0)`).
- **Colour.** v15 used `tmpColor = plant.color × 1.6 + 0.35`. v19 uses:

  ```
  tmpColor = plant.color.lerp(Color(0.4, 1, 1), focus·0.8) × 1.6 + 0.35
  ```

  The tip cluster then multiplies by `tipBrightness`. Tip shape 9 uses white.
  - At focus .8 the result is 64% cyan.
  - A `new THREE.Color` is allocated per tip per frame.
- **Depth.** On every `draw()`: `tipMesh.material.depthTest = !(focus > 0)` and `tipMesh.renderOrder = focus > 0 ? 10 : 0`. Tips are drawn over all geometry. `material.needsUpdate` is not set (bug 7.5).

### 2.8 Music-led settings (music-focus-ui.js:18-22)

This works only when the active engine is `organism`. Each value is set through `referenceSet(key, v)` → `ctls.get('e:organism:'+key).set(v)`, which applies, persists and updates the widget:

`videoBuild 0, musicAmount .45, sustain .25, musicFocus .8, musicTrail 2, fillRate 300`

It does not reset the scene. It does not touch `speed`, `videoBuildPace`, `glow` or `maxLive`.

### 2.9 Background auto-fill pacing (reference-growth.js:106-120; shared with the reference cluster)

- If `videoBuild` is 0, any live `referenceAuto` plants are force-released (`release(p, t, 0, true)`), and nothing else happens.
- Otherwise a new plant spawns only if all of these hold:
  - live plants (all kinds) < `min(4, maxLive)` (was 16)
  - `segs.length` < `min(16000, budgetCap × 0.8)`
  - the first call after (re)start only stamps `referenceSeedT = time` and returns, so the first start comes one interval later
  - `time − referenceSeedT` ≥ `1 / max(0.2, videoBuildPace || 0.8)` (was a fixed 0.16 s)
- The plant is created with `newPlant(48 + floor(rand·24), 0.65, globals, time, {root, autoUntil: time + 2})` (lifetime was +5). Then `held = false`, `referenceAuto = true` and `referenceRoot = uv`.
- `finishSegment` makes auto-fill segments permanent.
- Recycling skips them unless they are dying: `if(!ge&&q.referenceAuto&&!q.dying&&!this.reversing)continue;`.
- `activateReference()` now sets `videoBuild` 0 (patch L22). The v19 source uses `videoMode` 3 (patch_consolidation L36).
- Hints (patch L23-24):
  - Build on: `'Background fill is on: it grows without music. Turn Build shape off for music-only growth.'`
  - Build off: `'Music-led: play notes or audio to grow. Build shape adds independent background growth.'`

### 2.10 Audio sensitivity (v0.19.0, patch_consolidation.py:32-34)

TS inputAudio.ts:401-405, before and after:

```ts
// v0.15
const thr = med * 1.9 + 1e-3
if (flux > thr && t - this.lastOnsetT > 0.12 && this.features.energy > 0.04) { ... }
// v19 (s = globalThis.__growthAudioSensitivity ?? 0.45)
const thr = med * (2.55 - 1.45 * s) + 0.0015
if (flux > thr && t - this.lastOnsetT > 0.18 - 0.1 * s && this.features.energy > 0.055 - 0.025 * s) { ... }
```

| s | threshold × median flux | absolute floor | min onset gap (s) | energy gate |
|---|---|---|---|---|
| v0.15 | 1.90 | 0.0010 | 0.120 | 0.040 |
| 0.00 | 2.55 | 0.0015 | 0.180 | 0.055 |
| **0.45 (default)** | 1.8975 | 0.0015 | 0.135 | 0.04375 |
| 1.00 | 1.10 | 0.0015 | 0.080 | 0.030 |

Notes on this behaviour:

- **The default is marginally stricter than v0.15.** At its default, the control only changes behaviour when it is moved.
- The onset strength `(flux − thr)/(thr + 1e-6)` grows as the threshold falls. Higher sensitivity therefore also produces higher pseudo-note velocities (`vel = 0.35 + 0.65·strength`), which means thicker and faster growth.
- **The stems detectors (inputAudio.ts:410-428) ignore the sensitivity.** Their energy gate stays at 0.04 and their per-stem gaps stay at [.1, .16, .22, .3].
- The value is set by `#simpleAudio.oninput` and initialised at startup from the HTML value (0.45). It is not persisted or included in presets, and it cannot be MIDI-learned.

### 2.11 Simple-mode music macros (simple-ui.js)

- **`simpleApplyLook` base** (L21-25, applied to every look; recipe values override):
  - `musicAmount .42`, `musicFocus .7`, `musicTrail 2`, `sustain .2`, `fillRate 240`, `videoBuild 0`, `speed .75`
  - `pulse .15`, `flash .08`, `bloom .35`
  - global `zoomReact 0`, `beatZoom 0`, `rotSpeed 0`
  - it then calls `setCalmCamera('still')`, which sets `kick` 0 and `shake` 0 and locks the camera
- **First run.** The Roots look is applied 700 ms after load if localStorage `growth-good-start-v0190` is absent.
- **`#simpleGrowth.oninput(v)`** (L74-77): `musicAmount = v`, `speed = .5 + .65v`, `sustain = max(.08, .35v)`.

  | v | speed | sustain | musicAmount × speed |
  |---|---|---|---|
  | .1 | .565 | .08 | .057 |
  | .42 (HTML default) | .773 | .147 | .325 |
  | 1.2 | 1.28 | .42 | 1.536 |

  The slider does **not** touch `fillRate` (240). It is not re-synced when a look or preset changes the underlying values.
- **`#simpleAudio.oninput(v)`**: `globalThis.__growthAudioSensitivity = v`.
- **`simpleReference('trace' | 'relief')`**: also sets `musicAmount .38` and `fillRate 180`.

### 2.12 Quantified effect of the v19 defaults (why "much less obvious")

This is a model estimate from the formulas above. Take a Roots plant driven by an audio onset of strength 0.5:

- velocity = .675, so `(1.4 + 2.6·vel)` = 3.155
- energy ≈ .5, so `(0.75 + 0.5·energy)` = 1.0
- hitEnv ≈ .5 with speedReact .6 and react 1, so the reaction factor is 1.69
- pseudo-note hold = .18 + .4·.5 = .38 s (inputAudio.ts:460)

| | extension rate (units/s) | growth window | length per tip | ≈ segments per tip |
|---|---|---|---|---|
| v0.15 (speed 1, amount n/a, sustain 1.5) | 5.33 | .38 + 1.5 = 1.88 s | 10.0 | ~24 |
| v19 Simple (speed .75 × amount .42, sustain .2) | 1.68 | .38 + .2 = .58 s | 0.97 | ~2.7 |

That is about 9× less geometry per musical event. A toy allocation model (Appendix C) at 4 onsets/s and 60 fps gives:

- v0.15: 189 segments per plant, 1334 segments/s
- v19 Simple: 11 per plant, 87/s. This is below the 240/s credit rate, so **the credits are not the limit; extension speed and sustain are**.

The same model also exposes a v0.15 problem. At 8 onsets/s, allocation is oldest-plant-first and `fillRate` 1500 is binding. As a result, 81% of new plants waited more than 100 ms for their first segment, with a median of 383 ms. The newest note is the one that should react, and it starved. v19 hid this by starving everything equally. The proposed design (newest-first allocation, a per-note burst, `fillRate` 1200, `sustain` .8) gives 0 ms median latency with 6-9× v19's output.

---

## 3. Controls

### 3.1 Engine controls added or changed (organism)

| key | label (bundle) | min | max | step | default (v19) | options | group in v19 | read by |
|---|---|---|---|---|---|---|---|---|
| `musicAmount` (new) | music growth amount | .1 | 1.5 | .05 | .45 | — | **none → "More"** (see note) | grow-loop rate (frame); Music growth slider `#musicAmount`; Music-led; Simple base (.42), `simpleGrowth`, `simpleReference` (.38) |
| `musicFocus` (new) | highlight music / dim old growth | 0 | 1 | .05 | .8 | — | none → "More" | `focusLevel`, `refreshMusicFocus` (tip depthTest), tip filter, size and colour; `#musicFocus`; Music-led; Simple base (.7) |
| `musicTrail` (new) | fresh growth trail (seconds) | .5 | 8 | .5 | 2 | — | none → "More" | `focusLevel`; `#musicTrail`; Music-led; Simple base (2) |
| `videoBuildPace` (new, shared with reference cluster) | background starts per second | .2 | 3 | .1 | .8 | — | none → "More" | `updateReference` auto-fill interval; `#buildPace` |
| `sustain` (changed) | keep growing after release (s) — makes short notes big | 0 | 10 | .1 | **.25** (v15 1.5) | — | Growth | `release()` TS 2741; Music-led .25; Simple .2 / `simpleGrowth` |
| `fillRate` (changed) | new segments per second (0 = as fast as it can) | 0 | 8000 | 100 | **300** (v15 1500) | — | Growth | `segmentAllowance` credit rate; Music-led 300; Simple 240; trace/relief 180 |
| `speed` (unchanged, but set by Simple) | growth speed | .2 | 3 | .05 | 1 | — | Growth | grow-loop rate; Simple base .75; `simpleGrowth` .5+.65v |
| `videoBuild` (reference cluster; default flipped at activation) | build the shape without music | 0 | 1 | 1 | 0 | — | Video (overwritten to "More") | auto-fill gate; Music-led sets 0 |

Group note. The bundle's `mount` does `l.group = l.key.startsWith("sp:") ? "Species" : CK[l.key] ?? "More"`, which overwrites any explicit `group`. `CK` is the TS `GROUP` map, and it has no entry for these keys, so all four new controls render in the **More** section in Advanced. In TS, add them to `GROUP` (organism.ts:227-244).

Insertion position in the v19 array: just before `videoScatter`, after `videoMode`. v15 TS has no `videoScatter`.

### 3.2 Global and non-engine values

| name | where | range | default | persisted | read by |
|---|---|---|---|---|---|
| audio sensitivity | `globalThis.__growthAudioSensitivity` (set by `#simpleAudio`) | 0..1, step .05 | .45 | **no** | onset threshold, gap and gate in `AudioInput.analyze` |
| `zoomReact`, `beatZoom`, `rotSpeed` (existing globals) | set to 0 by Simple looks | — | — | yes (settings) | camera (camera cluster) |

### 3.3 Panel-only sliders duplicating engine controls

| DOM id | engine key | range (HTML) | initial HTML value |
|---|---|---|---|
| `#musicAmount` | musicAmount | .1..1.5 / .05 | .45 |
| `#musicFocus` | musicFocus | 0..1 / .05 | .8 |
| `#musicTrail` | musicTrail | .5..8 / .5 | 2 |
| `#buildPace` | videoBuildPace | .2..3 / .1 | .8 |
| `#simpleGrowth` | macro: musicAmount, speed, sustain | .1..1.2 / .05 | .42 |
| `#simpleAudio` | audio sensitivity | 0..1 / .05 | .45 |

---

## 4. UI

### 4.1 DOM added by v0.17.2 (patch_music_focus.py:60-67)

The "Music growth" section is inserted **inside `#referenceTools`** (the "3D reference" box in the Input section), right after `<p id="refHint" class="note"></p>` (v19 index.html:230):

```html
<section aria-label="Music growth"><h3>Music growth</h3>
  <button id="musicLed" type="button">♪ Music-led settings</button>
  <label class="slider" for="musicAmount"><span>Growth amount</span><output id="musicAmountValue">0.45</output>
    <input id="musicAmount" type="range" min="0.1" max="1.5" step="0.05" value="0.45"></label>
  <label class="slider" for="musicFocus"><span>Highlight new / dim old</span><output id="musicFocusValue">0.8</output>
    <input id="musicFocus" type="range" min="0" max="1" step="0.05" value="0.8"></label>
  <label class="slider" for="musicTrail"><span>Fresh trail (seconds)</span><output id="musicTrailValue">2</output>
    <input id="musicTrail" type="range" min="0.5" max="8" step="0.5" value="2"></label>
  <label class="slider" for="buildPace"><span>Background starts / second</span><output id="buildPaceValue">0.8</output>
    <input id="buildPace" type="range" min="0.2" max="3" step="0.1" value="0.8"></label>
  <p class="note">Music-led settings switches background fill off. Cyan tips mark musical growth, even behind the
  older structure. Highlight 0 restores normal colours and depth.</p></section>
```

No CSS was added for this section; it reuses the existing `.slider` and `.note` classes. The `#cameraLock` button and its CSS belong to the camera cluster (Appendix A).

**In v19 Simple mode (the default), `#referenceTools` is `display:none!important`** (patch_consolidation.py:47). So Highlight, Trail and the Music-led button cannot be reached in the default mode. In Advanced they appear **twice**: here and in the "More" section.

### 4.2 Handlers (music-focus-ui.js)

- **`syncMusicControls()`** runs at load and then every **400 ms** (`setInterval`, never cleared).
  - It disables the four sliders unless `te.id === 'organism'`.
  - When enabled, it copies each engine value into its slider (`referenceValue(key)`) and writes `#<id>Value.textContent = slider.value`.
  - It also syncs the camera-lock button (Appendix A).
- **`#musicAmount`, `#musicFocus`, `#musicTrail` `oninput`**: `referenceSet(key, +value)`, then `syncMusicControls()`.
- **`#buildPace.oninput`**: `referenceSet('videoBuildPace', +value)`, then `syncMusicControls()`.
- **`#musicLed.onclick`**: runs the macro in 2.8.
- `referenceSet(key, v)` is `Zt.get('e:organism:'+key)?.set(v); referenceSync()`. `Ctl.set` applies to the engine and persists to `settings.engineCtl` (main.ts:332-336).

### 4.3 DOM added by v0.19.0 for this cluster (patch_consolidation.py:62-64, inside the `#simpleHome` details, visible in both modes)

```html
<h3>Response</h3>
<label class="slider" for="simpleGrowth"><span>How much the music grows</span><output id="simpleGrowthValue">0.42</output>
  <input id="simpleGrowth" type="range" min="0.1" max="1.2" step="0.05" value="0.42"></label>
<label class="slider" for="simpleDetail">…Branching detail… (not this cluster)</label>
<label class="slider" for="simpleAudio"><span>Audio attack sensitivity</span><output id="simpleAudioValue">0.45</output>
  <input id="simpleAudio" type="range" min="0" max="1" step="0.05" value="0.45"></label>
```

The CSS in `#simpleUiStyle` is generic to the Simple card and not specific to this cluster.

### 4.4 Placement problems to fix in the port

- The music controls live in a reference-specific box.
- They are duplicated.
- They are invisible in Simple mode.
- The Simple sliders are write-only: they are never refreshed from the engine.
- Audio sensitivity is not in the Input section, where the audio source is chosen.

---

## 5. Integration points: minified anchor to TS location

Each row gives the patch line and the exact anchor, the TS location, and the required change (or a better alternative).

**Rows 1-4: controls and defaults**

1. **Version** (patch_music_focus.py L17): `const LM="0.17.1"`.
   - TS: `src/midi/version.ts`.
   - Change: version bump. Owned by the release cluster.
2. **New control definitions** (L18-19): inserted before `{key:"videoScatter",`.
   - TS: organism.ts controls array 371-446. v15 has no `videoScatter`.
   - Change: add `musicAmount`, `musicFocus`, `musicTrail` after `retract` (line 402), or in a new "Music" group. Add `videoBuildPace` next to the reference controls. **Add GROUP entries** at 227-244.
3. **`sustain` default** (L20): `min:0,max:10,step:.1,value:1.5},{key:"fillRate"`.
   - TS: organism.ts:398.
   - Change: the default value only. Section 8.6 has the recommended value.
4. **`fillRate` default** (L21): `min:0,max:8e3,step:100,value:1500`.
   - TS: organism.ts:399.
   - Change: the default value only. Section 8.6 has the recommended value.

**Rows 5-7: reference activation and pacing** (reference cluster owns the UI)

5. **Activation defaults** (L22): `referenceSet('videoFollow',1);referenceSet('videoBuild',1);`, which becomes `videoBuild 0`.
   - TS: none. v15 has no reference UI; `afterVideoOpened` at main.ts:680-685 sets `videoMode` 3.
   - Change: the reference cluster port must default Build to off.
6. **Reference hints** (L23-24): the two `refHint` strings.
   - TS: none (reference UI).
   - Change: use the strings in 2.9.
7. **Auto-fill pacing** (L25-37): `reference-growth.js` edits `Math.min(16,…maxLive)` → 4, `<.16` → `1/max(.2, videoBuildPace||.8)`, `time+5` → `time+2`, and the first-start delay.
   - TS: none (the reference cluster ports `updateReference`).
   - Change: port the pacing constants in 2.9.

**Rows 8-11: grow-loop pacing**

8. **Throttle** (L39): `m=1-.7*Math.min(1,Math.max(0,(p-.6)/.35))`, which becomes `m=1`.
   - TS: organism.ts:2369-2372 (`const throttle = …`).
   - Change: delete `throttle` and update the comment at 2369-2370. Keep `pressure`, which recycling at 2434 needs.
9. **Allowance** (L40): `let x=g>0?Math.max(1,g*s):1/0;`, which becomes `let x=this.segmentAllowance(g,s);`.
   - TS: organism.ts:2375 (`let addBudget = …`).
   - Change: `let addBudget = this.credits.begin(fillRate * amountForCredits, dt)` (see 8.2).
10. **Rate multiplier** (L41): `const ge=r*m*this.seasonF.speed`, which becomes `const ge=G(this.controls,"musicAmount")*r*m*…`.
    - TS: organism.ts:2381-2382 (`const rate = speed * throttle * …`).
    - Change: `rate = amount(p) * speed * this.seasonF.speed * …`, where `amount(p)` is `musicAmount` for music, text and child plants and 1 for auto-fill (8.4). Drop `throttle`.
11. **Credit consumption** (L42): `const _=e.active.size===0;`, prefixed with the credit-consumption statement.
    - TS: organism.ts:2423-2426. The statement goes after the closing `}` of the grow loop (2423) and before `const silent = …` (2426).
    - Change: `this.credits.end(addBudget)`. **It must run after the grow loop and before the recycle block.** No other code starts segments in between.

**Rows 12-15: camera lock and fog** (camera cluster; see Appendix A)

12. **Camera simulation guard** (L44-48): `const Ls=G(this.controls,"camMode"),ya=`, `this.camera.lookAt(this.camLook);const Tu=`, `if(this.dragBtn<0)return;`, `"pointerdown",l=>{if(!(l.button`, `"wheel",l=>{this.zoomMul`.
    - TS: 2573-2702, 624, 611-612, 642-643.
    - Camera cluster. Listed so nothing is lost.
13. **Store the camera extent** (L50): `this.updateCinematic(e,t);`, which becomes `this.focusCameraExtent=Pl;…`.
    - TS: `radius` at 2591. `updateCinematic` does not exist in v15.
    - Camera cluster.
14. **Fog extent** (L51): `this.camPos.distanceTo(this.center)+Pl+4`, which becomes `…+(this.focusCameraExtent??2)+4`.
    - TS: fog at 2712.
    - Camera cluster.
15. **Draw hook** (L52): `draw(){this.updateSoftGrowth(this.performanceState);`, which becomes `draw(){this.refreshMusicFocus();…`.
    - TS: `draw()` 871. Better, call it at the end of `frame()` just before `this.draw()` at 2736.
    - Change: call `this.updateEmphasis(t)` from `frame()` (not from `draw()`, which `snapshot()` also calls at 889-899). It must run **after** all `addSeg`, `removeSeg` and `seasons()` for the frame and **before** render.

**Rows 16-18: tip loop** (organism.ts 2547-2569)

16. **Tip filter** (L53): `q.sp.glow<=0` is replaced by the compound filter in 2.7.
    - TS: organism.ts:2552.
    - Change: `if (!(p.held || p.autoUntil > t)) continue; if (p.source === 'auto' && focus > 0) continue; if (p.sp.glow <= 0 && focus <= 0) continue`.
17. **Tip size** (L54): `Pe=ge.r*(1.5+.8*e.onset)*Dt*q.sp.glow` gets the max/min-size formula in 2.7.
    - TS: organism.ts:2556.
    - Change: the same formula. Compute `minTip` once per frame, outside the loop.
18. **Tip colour** (L55): `this.tmpColor.copy(q.color).multiplyScalar(1.6).addScalar(.35)` gets the cyan lerp.
    - TS: organism.ts:2562.
    - Change: use a module constant `FRESH_TINT` and a `freshTint` amount (8.5). No allocation.

**Rows 19-20: refresh and soft species**

19. **Colour sweep and tip depth state** (music-focus.js L31-42): `refreshMusicFocus` (the sweep plus tip depthTest and renderOrder).
    - TS: new method.
    - Change: replace the sweep with a fresh-set tracker (8.3). Set depthTest and renderOrder **only on change**, and set `material.needsUpdate = true` when you do (bug 7.5).
20. **Soft-species colour** (L56-58): soft-growth `item.mesh.material.color?.copy(plant.color)…`.
    - TS: none (the soft species cluster).
    - Change: that cluster must call `emphasisLevel()` for a soft mesh's colour.

**Rows 21-23: UI**

21. **Append UI script** (L59): appends `music-focus-ui.js` to the bundle.
    - TS: main.ts.
    - Change: see 8.7. Render the controls through the normal engine-controls path, add a "Music-led" action, no polling.
22. **Panel HTML** (L60-67): the HTML in 4.1.
    - TS: index.html. v15 has no `#referenceTools`.
    - Change: do not add a separate section. Use engine control groups (8.7).
23. **`writeColor` wrapper** (music-focus.js L44-50): wraps `tw.prototype.writeColor`.
    - TS: organism.ts:1687-1701.
    - Change: fold the emphasis into `writeColor` directly (8.3). Also fix the `new THREE.Color(1,1,1)` allocation at 1693.

**Row 24: reset**

24. **`clear` wrapper** (music-focus.js L51-58): wraps `tw.prototype.clear`.
    - TS: organism.ts:749-760.
    - Change: `clear()` resets the credits and the fresh tracker. Camera preservation belongs to the camera cluster.

**Rows 25-27: v0.19.0 edits**

25. **Onset detection** (patch_consolidation.py L32-34): `…sort((w,S)=>w-S),T=(x[x.length>>1]??0)*1.9+.001;let v=0;if(f>T&&t-this.lastOnsetT>.12&&this.features.energy>.04&&`.
    - TS: inputAudio.ts:398-409.
    - Change: a `sensitivity` field plus the formula in 2.10 (8.8).
26. **Simple UI** (L40): appends `simple-ui.js`.
    - TS: main.ts (Simple mode, another cluster).
    - Change: the looks' music values come from one `MUSIC_LED` or look table (8.6). The `simpleGrowth` and `simpleAudio` handlers are specified in 8.7.
27. **Simple card HTML** (L62-64): `#simpleGrowth` and `#simpleAudio` markup.
    - TS: index.html.
    - Change: see 8.7.

### 5.1 Ordering constraints in `frame()` (TS numbering)

1. `this.lastGTime = m.time` must be set **before** any `addSeg` (it already is, at 2277). Emphasis age for a newborn segment must be 0.
2. Note events (2292-2304) come before the grow loop, so a note-on's plant can use its burst in the same frame. In v19 `updateReference` (auto-fill spawn) runs *before* note events. Keep it before the grow loop.
3. The allowance is computed after the maxLive release (2355-2367) and before the loop. It is consumed right after the loop and before recycling (2427+).
4. Emphasis colour updates run after the grow loop, recycling, `deform` and `seasons` (2543), and before `draw()`. Seasons rewrites all colours through `writeColor`, which must already include emphasis.
5. The tip loop reads `musicFocus` once per frame into a local.

---

## 6. State and lifecycle

New engine fields in v19, and what they become in the port:

| v19 field | purpose | reset | port as |
|---|---|---|---|
| `musicCredit` | fractional start credit | 0 in `clear()` and when `fillRate` ≤ 0 | `private credits = new SegmentCredits()`; `credits.reset()` in `clear()` and `clearGrowth()` |
| `focusCursor` | sweep cursor | 0 in `clear()` | remove; replaced by `FreshTracker` (`clear()` in `clearGrowth()`) |
| `musicTint` | reused temp colour for the wrapper | never | remove; use `this.dimColor`/`tmpColor` inside `writeColor` |
| `plant.referenceAuto` | marks auto-fill plants (reference cluster) | per plant | `plant.source: 'note' \| 'auto' \| 'text' \| 'child'` |
| (tip material state) | depthTest and renderOrder set every draw | — | `private tipXrayOn = false`; toggle with `material.needsUpdate = true` on change; re-apply after `buildMeshes()` recreates `tipMesh` (organism.ts:683) |
| `focusCameraExtent`, `cameraLockPose` | camera cluster | — | camera cluster |

Lifecycle:

- **`clear()`** (Reset, Backspace or Delete): reset credits and the fresh tracker. `clearGrowth()` (the cycle reset at 2345) should also clear the tracker, because it empties `segs`. v19 does not reset credits there, which is harmless.
- **`growCapacity()`** (704-714) re-writes all colours. Emphasis is applied inside `writeColor`, so this is automatically correct.
- **`removeSeg()`** swaps the last segment into the removed index. The tracker must tolerate stale entries: check `this.segs[s.idx] === s` before writing.
- **`unmount()`**: nothing extra; no GPU resources are added. If the TSL variant (8.3b) is used, the uniforms are module-level and need no disposal.
- **`setControl('musicFocus' | 'musicTrail')`**: mark emphasis dirty, which triggers a chunked full recolour (8.3).
- **Persistence.** The engine keys persist in `localStorage['midiviz_settings_v3'].engineCtl.organism` and in presets (`midiviz_presets_v1`) through `snapshotPreset` (main.ts:441-447). In v19, audio sensitivity is **not** persisted. v19 Simple mode keys: `growth-good-start-v0190` (first-run look) and `growth-ui-mode`.
- **Old presets** without the new keys leave them at their current values (`loadPreset` only applies keys present; main.ts:530-531). This is acceptable.
- **Existing users** keep their saved `sustain` 1.5 and `fillRate` 1500, because saved values override the new code defaults (`selectEngine` main.ts:255-256). Add a settings-version migration (8.6).
- **Random mix** (main.ts:473-493) would randomise `musicAmount`, `musicFocus` and `musicTrail`. Either add them to `RANDOM_CAP` or `NO_RANDOM`, or keep them random with caps (e.g. `musicFocus` ≤ .7).

---

## 7. Bugs, weaknesses and questionable decisions in the patch

Every item was verified by reading code; none was run in a browser. **(B)** means it needs a browser check.

7.1 **The defaults make music reaction ~9× smaller per event than v0.15 (the lead's main complaint).** Evidence: 2.12. The rate is `musicAmount .42 × speed .75 = 0.315` of v0.15, and `sustain .2` removes most of the growth window of short notes and audio pseudo-notes (hold .18-.58 s). The v0.17.2 notes blame "fast first, slower later" on auto-fill, sustain, the throttle and rounding. Only the throttle and auto-fill were real problems. The fix slowed *all* musical growth instead of managing density. *Alternative:* keep per-event growth large, give the newest note priority (7.11) and a burst, and manage density with recycling and decay. Defaults are in 8.6.

7.2 **`refreshMusicFocus` runs unconditionally, even at `musicFocus = 0`** (music-focus.js:31-37 has no guard). That is 800 `writeColor` calls per frame, and each sets `needsUpdate` on six `instanceColor` buffers. The result is six **full** buffer uploads every frame forever, including a static scene and Highlight 0.
- At the default budget of 60k (cap 60,000 instances × 3 floats × 4 bytes = 720 KB per buffer), that is **~4.3 MB of uploads per frame, about 260 MB/s at 60 fps**.
- This directly works against "lightweight enough for a weak laptop".
- *Alternative:* a dirty-driven fresh set (8.3). No uploads when nothing changes.

7.3 **Stepped fade in large scenes.** Each segment is revisited every N/800 frames. At 60k segments that is every 75 frames (1.25 s at 60 fps, 2.5 s at 30 fps), while the trail is 2 s. So fading segments jump from bright to dim in one or two steps, and slider changes take seconds to spread. *Alternative:* update exactly the segments still inside the trail every frame; or the TSL per-instance birth attribute (8.3b), which gives a continuous fade at zero CPU cost.

7.4 **Allocation churn.**
- v15 `writeColor` allocates `new THREE.Color(1,1,1)` on every call (organism.ts:1693). The sweep turns that into 800+ allocations per frame.
- The v19 tip colour allocates `new Se(.4,1,1)` per tip per frame.
- *Alternative:* module-level constants.

7.5 **(B) The tip depthTest toggle probably does nothing in WebGPU after the first render.** In three 0.185.1, `RenderObjects.get` (RenderObjects.js:127-137) re-checks the pipeline cache key (which includes `depthTest`; RenderObject.js:730+) only when `material.version` changed or the dynamic node key changed. `refreshMusicFocus` never sets `material.needsUpdate`.
- It works on the first frame only because `syncTipShape` (tip-shapes.js:41) bumps the version in the same frame.
- Later Highlight 0 ↔ >0 toggles take effect only after a tip-shape change or a capacity rebuild.
- The WebGL2 backend applies the state per draw, so the two backends behave differently.
- *Fix:* set it only on change, with `needsUpdate = true`.

7.6 **The x-ray tips go against the owner's 3D aesthetic.** With highlight on (the default), up to 200 tips (`MAX_TIPS` 200) are drawn over all geometry. Growth behind the organism shows through the front, so the image reads as a 2D overlay of dots and depth cues are lost. *Alternative:* keep the depth test. Show freshness through emissive or bloom on the fresh segments themselves. Offer x-ray as an opt-in toggle (`tipXray`, default 0).

7.7 **A hard-coded cyan tint (0.4, 1, 1) at 64% ignores the palette.** Every curated look (each with its own palette) ends up with cyan tips. *Alternative:* tint toward white or a palette accent (`cosPalette(g.palette, 0.5, …)`), with a `freshTint` control defaulting to 0.

7.8 **Old growth is darkened to 36-44% albedo by default.** This multiplies lit albedo (not emissive). Combined with fog and a dying ×.45, the accumulated "complex 3D growth system" becomes nearly black, and recordings get darker. Values above 1 for fresh growth also only brighten with bloom or tone mapping headroom. *Alternative:* keep old growth at ≥ 0.6 (focus default .5) and add an emissive boost for fresh growth (8.3). Consider splitting "highlight new" and "dim old" into separate sliders.

7.9 **`musicAmount` is a third multiplicative speed knob and is misnamed.** The global `growth` ("growth speed", main.ts:403), the engine `speed` ("growth speed", 391) and `musicAmount` all scale the same product. It also scales non-music growth (auto-fill, text, children). And it cannot raise throughput above `fillRate`, so the Simple slider ("How much the music grows", max 1.2) cannot exceed 240 segments/s because it never touches `fillRate`. *Alternative:* define "Growth amount" as scaling both extension speed and credit rate, for music-origin plants only (8.4).

7.10 **The credit cap of 64 silently caps `fillRate` at 64 × fps** (3840/s at 60 fps, 1920/s at 30 fps). Values up to 8000 on the slider do nothing. v0.15's default of 1500 is already capped below 23 fps. *Fix:* `cap = max(64, rate × 0.1 s)`.

7.11 **Oldest-first allocation starves the newest note.** The grow loop iterates `this.plants` in creation order (organism.ts:2377), so older live plants spend the credits first. When credits bind (dense audio: 2 pseudo-notes per onset, maxLive 24), the plant that was just triggered waits. The toy model (Appendix C) shows 81% of new plants waiting more than 100 ms (median 383 ms) with v0.15 settings at 8 onsets/s. v19 does not fix the ordering. *Alternative:* iterate newest-first for starts, plus a per-note `burst` guarantee (8.2).

7.12 **Credits are consumed by failed starts** (`x--` before `startSegment`, which may `dropTip`). This is minor and inherited. *Alternative:* decrement only when `tip.seg` became non-null.

7.13 **The "no catch-up burst" claim is only partly true.** Credits bank up to 64 while tips are mid-segment, then spend up to 64 in one frame. This is harmless, and arguably good at onsets, but it should be intentional and documented: the bank is the onset reservoir.

7.14 **Redundant dt clamp and a test that cannot happen in the app.** `MusicClock.tick` already clamps dt to ≤ 0.05 (music.ts:149), so the Node test "stall must not bank seconds of work" (`segmentAllowance(300, 10)`) exercises an input the app never produces. It is harmless, but the test gives false assurance.

7.15 **Defaults are scattered and inconsistent across five places:**

| place | musicAmount | musicFocus | musicTrail | sustain | fillRate | speed |
|---|---|---|---|---|---|---|
| control defaults | .45 | .8 | 2 | .25 | 300 | 1 |
| Music-led button | .45 | .8 | 2 | .25 | 300 | — |
| Simple look base | .42 | .7 | 2 | .2 | 240 | .75 |
| `simpleReference` trace/relief | .38 | — | — | — | 180 | — |
| `simpleGrowth` at .42 | .42 | — | — | .147 | — | .773 |

`NOTES_FOR_CLAUDE.md` also names keys that do not exist (`musicGrowth`, `musicSustain`). *Alternative:* one exported `MUSIC_LED` constant, used by the control defaults, the Music-led action and the looks.

7.16 **No settings migration.** Returning users keep `sustain` 1.5 and `fillRate` 1500 from `midiviz_settings_v3`, and new users get v19's values. Behaviour depends on history, which is why the Music-led button had to exist. *Alternative:* add `settingsVersion` and a one-time migration that asks, or applies the new music defaults only for keys still equal to the old defaults.

7.17 **The new controls render in "More".** They have no GROUP entry, and mount overwrites the explicit `group` (3.1). Their dedicated UI is inside `#referenceTools`, which Simple mode hides. So in the default mode Highlight, Trail and Music-led cannot be reached. In Advanced they appear twice.

7.18 **The Simple sliders are write-only.** `#simpleGrowth` is never updated from the engine. After a reload, a look or a preset it shows .42 while the engine may hold different values. Its initial position (.42) does not match what the look applied (`speed` .75 vs .773 from the formula; `sustain` .2 vs .147).

7.19 **Audio sensitivity is a mutable global.** `globalThis.__growthAudioSensitivity` is not persisted (it resets to .45 on reload), not in presets, not MIDI-learnable, and not shown in the Input section. **It does not affect the stems detectors** (inputAudio.ts:410-428), which the UI does not mention.

7.20 **The default audio sensitivity (.45) is slightly stricter than v0.15** (factor 1.8975 vs 1.9, but gap .135 vs .12, gate .04375 vs .04, floor .0015 vs .001). The slider only helps after the user raises it. *Alternative:* pick the default so that it reproduces v0.15 exactly, or better, make the mapping piecewise so that s = .5 matches v0.15 (8.8).

7.21 **Sensitivity changes loudness too.** A lower threshold raises onset strength, and so velocity, thickness and speed. This may be desirable, but it is undocumented. Consider normalising the strength against a fixed reference threshold.

7.22 **Tips vanish when `glow` = 0, even with highlight on.** The loop is gated by `if (glow > 0)`. The panel note promises "Cyan tips mark musical growth", but it does not say that this is tied to Tip glow.

7.23 **`ctl()` is a linear `find` over ~170 controls**, and v19's tip loop calls it about 12 times per tip (`musicFocus` ×3, `tipSize` ×3, `tipShape` ×3, `tipLimit`, `tipBrightness`, and more). With 200 tips that is ~2,400 linear scans per frame. *Alternative:* read everything into locals once per frame. This is a cross-cluster performance issue.

7.24 **Monkey-patching `writeColor` by swapping `plant.color`** (music-focus.js:44-50). It is fragile: anything that reads `plant.color` inside the original sees the scaled copy, and future code has to know about the swap. *Alternative:* compute the colour inside `writeColor`.

7.25 **`refreshMusicFocus` lives in `draw()`,** which `snapshot()` also calls (organism.ts:889-899), so it runs twice around stills. It also runs even when `draw()` returns early because the canvas is under 2 px. *Alternative:* call it from `frame()`.

7.26 **Held long notes fade behind their own tips.** A chord held for 10 s shows only its last 2 s as bright, and the rest dims to .36 even though the note is still sounding. This may be fine as a "comet" look, but consider a `held` bonus: while the plant is held, the old level stays at least `max(L, 0.7)`.

7.27 **Soft species dim as one unit** (last-segment age, ≤ 30 Hz, ≤ 16 items per frame). This is acceptable. Cross-cluster note: the "faceted Liquid" observation comes from `new kp(1,2)`, which is `IcosahedronGeometry(1,2)`, a non-indexed geometry. With `computeVertexNormals`, that gives flat per-face normals (soft-growth.js:32, 72). This belongs to the soft species cluster.

7.28 **The musicLed button and sliders are inside the reference box**, even though they affect all organism growth, reference or not. This is conceptually wrong placement.

7.29 **`setInterval(syncMusicControls, 400)`** keeps polling while the panel is hidden, during performance mode and recording. *Alternative:* event-driven sync through `ctls`, as the `widget` pattern already does.

7.30 **Test coverage gaps.** `test-music-focus.cjs` stubs `writeColor` and never runs the grow loop. It does not test the credit consumption statement in `frame()`, allocation fairness, GPU upload volume, depthTest effectiveness, or any visual result. The throttle-removal check is only "the string is gone".

7.31 **The maintenance sources are not the source of truth.** `maintenance\reference-ui.js` still contains `referenceSet('videoBuild',1)` and the old hints, and it lacks `refScatter`. The bundle has the v0.17.2 edits (checked: that file is **not** verbatim in the bundle). `maintenance\soft-growth.js` also differs from the bundle. Porters must take strings from the bundle, or from this report.

7.32 **Removing the throttle is fine, but hitting the hard cap is abrupt.** When `segs.length >= cap-1` and capacity cannot grow, `addSeg` calls `makeRoom(600)` (organism.ts:1671), which removes 600 segments instantly, a visible pop. The v0.15 recycling urgency (from 0.8) should normally prevent reaching this. Keep the behaviour, but consider a smaller batch such as 120.

---

## 8. Recommended TypeScript design

### 8.1 Files

- `src/midi/engines/organism/pacing.ts`: `SegmentCredits` (pure, unit-testable).
- `src/midi/engines/organism/emphasis.ts`: `emphasisLevel()`, `FreshTracker` (pure) and the `MUSIC_LED` defaults.
- `src/midi/onset.ts`: `onsetParams(sensitivity)` and a pure `OnsetDetector.step(flux, energy, t)`, so the detector is testable without WebAudio.
- Edits in `organism.ts`, `inputAudio.ts`, `main.ts`, `engine.ts` (an optional `actions`) and `index.html`.
- If the engine file is not being split, the two small modules can sit next to `organism.ts` as `organismPacing.ts` and `organismEmphasis.ts`.

### 8.2 Credits and allocation

```ts
// pacing.ts
export interface CreditOptions { minCap?: number; bankSeconds?: number }
export class SegmentCredits {
  private credit = 0
  private granted = 0
  constructor(private readonly opt: CreditOptions = {}) {}
  /** Starts allowed this frame; Infinity when rate <= 0 ("as fast as it can"). */
  begin(rate: number, dt: number): number {
    if (!(rate > 0)) { this.credit = 0; this.granted = Infinity; return Infinity }
    const cap = Math.max(this.opt.minCap ?? 64, rate * (this.opt.bankSeconds ?? 0.1))
    this.credit = Math.min(cap, this.credit + rate * Math.min(0.05, Math.max(0, dt)))
    return (this.granted = Math.floor(this.credit))
  }
  /** `left` = allowance not spent this frame. */
  end(left: number) {
    if (Number.isFinite(this.granted)) this.credit = Math.max(0, this.credit - (this.granted - left))
  }
  reset() { this.credit = 0; this.granted = 0 }
}
```

`{minCap: 64, bankSeconds: 0}` gives exact v19 parity. The recommended settings are `{minCap: 64, bankSeconds: 0.1}`.

The grow loop (organism.ts:2369-2423) becomes:

```ts
const pressure = this.segs.length / this.budgetCap()           // keep for recycling
const amount = ctl(this.controls, 'musicAmount')
let allowance = this.credits.begin(ctl(this.controls, 'fillRate') * amount, dt)
for (let i = this.plants.length - 1; i >= 0; i--) {            // NEWEST first
  const p = this.plants[i]
  // …unchanged release / reversing checks…
  const amt = p.source === 'auto' ? 1 : amount
  const rate = amt * speed * this.seasonF.speed * p.sp.speed * (1.4 + 2.6 * p.velocity) * (0.75 + 0.5 * m.energy) * (1 + speedReact * (0.8 * m.energy + 1.5 * this.hitEnv))
  for (const tip of [...p.tips]) {
    if (!tip.seg) {
      if (p.burst > 0) p.burst--                               // guaranteed note-on sprout
      else if (allowance > 0) allowance--
      else continue
      this.startSegment(tip, m, t)
    }
    // …unchanged extension…
  }
  // …unchanged tunnel / re-sprout / lignify…
}
this.credits.end(allowance)
```

Notes on the loop:

- In `frame()`'s note-on branch (2296), set `plant.burst = Math.round(ctl('noteBurst') * (0.5 + 0.5 * velocity))`.
- Backward iteration: `release()` may push nested children. With a backward loop they are processed from the next frame, which is fine.
- The body of the v15 loop does not depend on order.
- Optional refinement: refund a credit when `startSegment` produced no segment (7.12).

### 8.3 Emphasis

**(a) CPU version (recommended first): parity formula plus a fresh set.**

```ts
// emphasis.ts
export const OLD_DIM = 0.8, FRESH_GAIN = 1.15
export function freshness(age: number, trail: number, auto: boolean) {
  return auto ? 0 : Math.max(0, 1 - Math.max(0, age) / (trail > 0 ? trail : 2))
}
export function emphasisLevel(age: number, auto: boolean, focus: number, trail: number) {
  if (!(focus > 0)) return 1
  return 1 - focus * OLD_DIM + focus * FRESH_GAIN * freshness(age, trail, auto)
}
/** Segments still inside the trail. update() writes each once per frame; items past the trail get a final write and are dropped. */
export class FreshTracker<T extends { born: number }> {
  private items: T[] = []
  add(s: T) { this.items.push(s) }
  clear() { this.items.length = 0 }
  update(now: number, trail: number, valid: (s: T) => boolean, write: (s: T) => void): number {
    let w = 0, n = 0
    for (const s of this.items) {
      if (!valid(s)) continue
      write(s); n++
      if (now - s.born < trail) this.items[w++] = s   // keep while fresh
    }
    this.items.length = w
    return n
  }
}
```

Engine wiring:

- **`writeColor(seg)`**:
  ```ts
  const L = emphasisLevel(this.lastGTime - seg.born, seg.plant.source === 'auto', this.fx.focus, this.fx.trail)
  const c = this.dimColor.copy(seg.plant.color).multiplyScalar(L * (seg.plant.dying ? 0.45 : 1))
  ```
  Then the existing six `setColorAt` calls, with a module constant `WHITE` instead of `new THREE.Color(1,1,1)`.
- **`addSeg`**: after `writeColor`, if `focus > 0 && plant.source !== 'auto'`, call `this.fresh.add(seg)`.
- **End of `frame()`**, before `draw()`:
  1. Read `focus` and `trail` once into `this.fx`.
  2. If `focus > 0`, call `this.fresh.update(t, trail, s => this.segs[s.idx] === s, s => this.writeColor(s))`.
  3. If `this.recolorPending`, recolour `min(remaining, 8000)` segments from a cursor, then clear the flag when finished.
- **`setControl`**: on `musicFocus` or `musicTrail`, set `recolorPending = true` and cursor = 0.
- **Uploads.** `needsUpdate` is already set only by `writeColor`, so a static scene uploads nothing. Optionally use `instanceColor.clearUpdateRanges(); addUpdateRange(minIdx*3, span*3)`. (B) Verify that the WebGPU backend honours `updateRanges` in 0.185.

**(b) GPU version (optional follow-up, smooth fade and no CPU writes).**

- Give each instanced mesh geometry an `InstancedBufferAttribute` `segBorn` (Float32, cap). Store `born − epoch`, with a negative value for auto-fill.
- In `reactify()` (shaders.ts:56), build in TSL:
  - `fresh = clamp(1 − (uNow − born)/uTrail, 0, 1) · step(0, born)`
  - `level = 1 − 0.8·uFocus + 1.15·uFocus·fresh`
  - `colorNode = (colorNode ?? materialColor) · level`
  - `emissive += diffuseColor.rgb · uFocus · uFreshGlow · fresh`
- (B) This needs a check that geometry-level instanced attributes are bound in both backends, and that every growth shader goes through `reactify`.

**Tips.**

- Compute once per frame:
  ```ts
  const focus = …
  const minTip = focus > 0 ? clamp(this.camPos.distanceTo(this.camLook) * 0.0025, 0.06, 0.5) : 0
  ```
- Filter and size as in 2.7.
- Colour: `tmpColor.copy(p.color).lerp(FRESH_TINT, focus * 0.8 * freshTint).multiplyScalar(1.6).addScalar(0.35)`, with a module constant `FRESH_TINT = new THREE.Color(0.4, 1, 1)`. If `freshTint = 0`, tint toward `WHITE` at `focus * 0.3`.
- X-ray: `const xray = focus > 0 && ctl('tipXray') > 0`. If `xray !== this.tipXrayOn`, set `material.depthTest = !xray`, `tipMesh.renderOrder = xray ? 10 : 0`, `material.needsUpdate = true`, and remember the state. Reset the state in `buildMeshes()` (a new material is created at 683).

### 8.4 Growth amount semantics

- Key: `musicAmount` (kept for preset compatibility).
- Label: "growth per musical event".
- It multiplies extension rate **and** the credit rate for `source !== 'auto'` plants.
- Default 1.0 (v0.15 behaviour). The Simple "How much the music grows" slider maps to it directly (optionally also to `sustain`). It must also be synced back from the engine.

### 8.5 New or changed controls (recommended)

| key | label | min | max | step | default | group |
|---|---|---|---|---|---|---|
| `musicAmount` | growth per musical event | .1 | 2 | .05 | **1** | Music |
| `noteBurst` (new) | segments guaranteed per new note | 0 | 48 | 1 | **8** | Music |
| `sustain` | keep growing after release (s) | 0 | 10 | .1 | **.8** | Music (moved from Growth) |
| `fillRate` | new segments per second (0 = unlimited) | 0 | 8000 | 100 | **1200** | Music |
| `musicFocus` | highlight new / dim old | 0 | 1 | .05 | **.5** | Look |
| `musicTrail` | fresh trail (s) | .5 | 8 | .5 | **2.5** | Look |
| `freshTint` (new) | fresh tip tint: palette → cyan | 0 | 1 | .05 | **0** | Look |
| `tipXray` (new) | fresh tips show through growth (0 / 1) | 0 | 1 | 1 | **0** | Look |
| `videoBuildPace` | background starts per second | .2 | 3 | .1 | .8 | Video |
| global `audioSens` | audio attack sensitivity | 0 | 1 | .05 | **.5** (= v0.15, see 8.8) | Input (rendered near stems) |

Panel layout:

- Add `'Music'` to `GROUP_ORDER` (organism.ts:226) as the first entry, and add it to `OPEN_BY_DEFAULT` (main.ts:295).
- Add all keys to `GROUP`.
- Random mix: cap `musicFocus` at .7 in `RANDOM_CAP`, and put `tipXray`, `noteBurst` and `fillRate` in `NO_RANDOM`.

**All the recommended default values need owner sign-off and a browser tuning pass** (acceptance BR1-BR2).

### 8.6 One source of music defaults and migration

```ts
export const MUSIC_LED = { videoBuild: 0, musicAmount: 1, noteBurst: 8, sustain: 0.8, fillRate: 1200, musicFocus: 0.5, musicTrail: 2.5 } as const
```

- The control defaults, the Music-led action and the Simple looks' base all reference `MUSIC_LED`. The looks may override `musicFocus` or `sustain` per look.
- Migration in main.ts: add `settings.version`. On load, when `version < 20`, for each `MUSIC_LED` key whose saved value equals an old default (v15: `sustain` 1.5, `fillRate` 1500; v19: .25/300/.45/.8, and so on), replace it with the new default. Then set `version = 20` and `save()`.

### 8.7 UI (main.ts and index.html)

- Engine controls render through `renderEngineControls`, so there is no hand-written HTML section and no polling.
- Add an optional `actions?: { group: string; label: string; run(): Record<string, number> }[]` to `Engine` (engine.ts). `renderEngineControls` renders each action as a button at the top of its group, and applies the returned values with `ctls.get('e:'+id+':'+k)?.set(v)`. `OrganismEngine.actions = [{ group: 'Music', label: '♪ Music-led settings', run: () => ({ ...MUSIC_LED }) }]`.
- Audio sensitivity: add `audioSens` to `Settings` (main.ts:48-67, default .5) and to the `settings` object (69-89). Render it with `widget(host, 'g:audioSens', …)` in `#sec-input` next to `#stemsRow`, or in `renderGlobalControls` (397-416). Apply with `audio.sensitivity = n; save()`, and set `audio.sensitivity = settings.audioSens` at startup. Because it is a `widget`, it becomes MIDI-learnable, and `snapshotPreset` picks it up through the `g:` prefix (main.ts:443).
- Simple mode (if ported): `#simpleGrowth` and `#simpleAudio` become thin proxies over `ctls.get('e:organism:musicAmount')` and `ctls.get('g:audioSens')`. Resync them whenever `Ctl.set` or `sync` fires (a small `onChange` subscription in `Ctl`), or when a look or preset is applied.

### 8.8 Audio sensitivity (inputAudio.ts)

```ts
// onset.ts
export function onsetParams(s: number) {
  const x = Math.min(1, Math.max(0, s))
  // v19 mapping (parity): k = 2.55 − 1.45x, floor .0015, gap .18 − .1x, gate .055 − .025x
  // recommended: piecewise so x = .5 reproduces v0.15 exactly (k 1.9, floor .001, gap .12, gate .04)
  return x <= 0.5
    ? { k: 2.55 - 1.3 * x, floor: 0.0015 - 0.001 * x, gap: 0.18 - 0.12 * x, gate: 0.055 - 0.03 * x }
    : { k: 1.9 - 1.6 * (x - 0.5), floor: 0.001, gap: 0.12 - 0.08 * (x - 0.5), gate: 0.04 - 0.02 * (x - 0.5) }
}
```

At s = 1 the recommended mapping gives k 1.1, gap .08 and gate .03, the same as v19 at 1. At s = 0 it gives v19's values at 0.

- In `AudioInput`, add `sensitivity = 0.5`. At line 401 use `const { k, floor, gap, gate } = onsetParams(this.sensitivity)`, then `thr = med * k + floor` and `if (flux > thr && t - this.lastOnsetT > gap && this.features.energy > gate)`.
- Optional (new behaviour, flag it in the UI): the stems use `gate` instead of `0.04` (line 410), scale `minGap` by `gap / 0.12`, and scale the stem threshold `1.35` by `k / 1.9`.

### 8.9 Do NOT port as-is

- The prototype wrappers (`writeColor` colour swap, `clear` wrapper) and `Object.assign(tw.prototype, …)`.
- The unconditional 800-per-frame sweep and `focusCursor`.
- Toggling tip depthTest every frame without `needsUpdate`, and x-ray on by default.
- The hard-coded cyan at 64%.
- `globalThis.__growthAudioSensitivity`.
- `setInterval` polling (`syncMusicControls`).
- The duplicated "Music growth" sliders inside `#referenceTools`.
- The credit cap as a constant 64.
- The `|| 2` fallback. Clamp the trail to ≥ .5 instead.
- `new Se(...)` or `new THREE.Color(...)` inside hot loops.
- The v19 default values (.42/.45 amount, .2/.25 sustain, 240/300 `fillRate`, .75 speed, focus .7/.8).
- Repeated `ctl()` lookups inside per-tip loops.

---

## 9. Acceptance tests

### 9.1 Unit (pure modules; add `vitest` or `tsx --test`, since the repo has no test runner and runs Node 20)

- **U1** Parity. `SegmentCredits({minCap: 64, bankSeconds: 0})` at rate 5/s for 4 s at 30, 60 and 120 fps allows 19-20 starts (the v19 test).
- **U2** `begin(0, dt)` returns `Infinity` and resets the credit. `end()` after an infinite grant is a no-op.
- **U3** Cap. Rate 8000 at 60 fps for 1 s allows 3840 starts with parity options and ≥ 7900 with `bankSeconds: .1`.
- **U4** Consumption. A grant of 5 with 3 used leaves exactly 2 plus the fraction carried over. The credit is never negative.
- **U5** `emphasisLevel` matches the table in 2.5 exactly (1e-9) for f ∈ {0, .5, .7, .8, 1} at ages {0, trail/2, ≥ trail}. Auto-fill plants always give the "old" value.
- **U6** `FreshTracker`: each valid item is written once per `update()`. An item older than the trail gets exactly one final write and is then dropped. Items that fail `valid()` are dropped without a write. `clear()` empties the tracker.
- **U7** `onsetParams`: s = .5 gives (1.9, .001, .12, .04). s = 0 and s = 1 match v19 (2.55/.0015/.18/.055 and 1.1/.0015/.08/.03, where the floor at 1 is .001 in the recommended mapping). Inputs are clamped outside [0, 1].
- **U8** Onset detector on a synthetic flux series (a steady bed plus impulses): the onset count is monotonically non-decreasing in s, and no two onsets are closer than `gap`.
- **U9** Allocation order (extract the start-selection helper). With an allowance of 1 and two plants each needing a start, the newer plant gets it. A plant with `burst` > 0 starts without consuming the allowance.
- **U10** `MUSIC_LED` is applied by the Music-led action, and the control defaults equal `MUSIC_LED`.
- **U11** Migration: saved `{sustain: 1.5, fillRate: 1500}` become the new defaults. A saved non-default value (for example `sustain` 3) is kept. It runs only once (version stamp).

### 9.2 Browser (Chrome WebGPU and forced WebGL2; also run the WebGL2 path in Safari or Firefox)

- **BR1** Growth volume. Take the Roots look with default music settings and hold 3 notes for 2 s: the segment count (HUD `stats()`) is **at least 3×** v19's ~300. Record the v0.15.0 baseline at the same time for reference.
- **BR2** Responsiveness. Play an audio file with clear drum hits at 8 onsets/s. Each hit produces visible new growth within 2 frames (screen recording at 60 fps). Also add a temporary debug HUD value "median first-segment latency" and check it is under 50 ms.
- **BR3** Highlight 0: colours match v0.15 behaviour, with no dimming. With Chrome DevTools Performance or a counter around `needsUpdate`, a static scene (no notes for 5 s) does **no** `instanceColor` uploads.
- **BR4** Dense scene (budget 60k, filled): the fresh fade is smooth, with no bright/dim popping (step through a 5 s recording frame by frame). Changing Highlight from .5 to 1 updates every segment within 0.5 s.
- **BR5** X-ray toggle on then off, and Highlight 0 ↔ .8, in both WebGPU and `forceWebGL`: tip occlusion changes immediately in both backends (this checks 7.5).
- **BR6** Weak-laptop profile (DevTools CPU 4× throttle, or the owner's laptop): fps with Highlight .5 is within 5% of Highlight 0. Auto quality does not drop solely because of emphasis.
- **BR7** Audio sensitivity persists across reload, is MIDI-learnable (right-click learn), and is stored in presets. At s = .5 the onset count on a reference track equals v0.15's (log `onset > 0` events over 30 s).
- **BR8** The Music-led button sets all `MUSIC_LED` values, the panel widgets update at once (no 400 ms lag), and it works in Simple and Advanced.
- **BR9** With a reference and Build shape on: background growth starts at `videoBuildPace`, stays at the "old" brightness, never gets tips with highlight on, and pauses while at least 4 plants are live.
- **BR10** No stall at the limit. At budget 10k, keep playing for 60 s: new notes still sprout within 2 frames, the stats show "recycling N", and there is no freeze.
- **BR11** Recording: a 10 s MP4 made with highlight on shows the emphasis. Old growth is not crushed to black (a spot check of mean luminance of old structure ≥ 0.5 × v0.15).
- **BR12** Palette coherence: with `freshTint` 0, the tips of each Simple look stay in their palette (no cyan). With `freshTint` 1, they turn cyan.

---

## Appendix A: camera items in the same patch (owned by the camera cluster, listed so nothing is lost)

From music-focus.js:3-17 and 51-58, music-focus-ui.js:1-8 and 15, patch_music_focus.py L44-51, and patch_consolidation.py L21-31:

- **`toggleCameraLock()`**: stores `{position, quaternion, look, near, far, fov}`, sets `dragBtn = -1`, and returns the new state.
- **`applyCameraLock()`**: restores the pose, and restores the projection only when it changed.
- **Frame camera block.** The block (TS 2573-2702) is wrapped in `if (!this.cameraLockPose) { … camera.lookAt } else this.applyCameraLock()`. This skips tunnel culling, gestures, kick and shake.
- **Input.** `pointermove` returns early when locked (TS 624); `pointerdown` returns when locked (611); `wheel` calls `preventDefault` and returns when locked (642).
- **`clear()` wrapper.** When locked, it saves and restores `center`, `newCenter`, `camPos`, `camLook`, `heading`, `pan`, `camTarget`, `camLookT`, `dist`, `manTheta`, `manPhi`, `zoomMul`, `theta` and `cinematicAngle`, then re-applies the lock.
- **Fog extent.** `focusCameraExtent = radius` is stored before `updateCinematic`. Fog uses `camPos.distanceTo(center) + (focusCameraExtent ?? 2) + 4`.
- **Button.** `#cameraLock`, fixed at top 12 px / right 12 px, `z-index` 1000, background `#171d26`, border `1px solid #7799aa`; when `aria-pressed="true"`, background `#254c40` and border `#8cdeb7`. Label: "🔓 Lock camera" or "🔒 Camera locked", with the title text and `aria-pressed` synced in `syncMusicControls` (split this out when porting).
- **v0.19.** `calmCamera` and `setCalmCamera` (calm-camera.js) call `toggleCameraLock`. Simple looks call `setCalmCamera('still')`, which locks the camera. That lock is the lead's "Silk grows out of frame" issue.

## Appendix B: minified symbol map (this cluster)

`tw` = OrganismEngine and `G` = `ctl`. The rest, by area.

**`frame()` locals:**

| minified | TS |
|---|---|
| `s` | dt |
| `n` | t |
| `r` | speed × g.growth |
| `o` | lignify |
| `a` | camMode |
| `c` | retract |
| `p` | pressure |
| `m` | throttle |
| `g` | fillRate |
| `y` | speedReact × react |
| `x` | addBudget |
| `q` | plant |
| `ge` | rate |
| `ne` | tip |
| `Pe` | seg |
| `_` | silent |
| `T` | recycle |
| `w` | urgency |

**Tip loop locals:** `Dt` = glow, `Hs` = nt, `ne` = pos, `Pe` = size, `XC` = MAX_TIPS (200), `Se` = THREE.Color.

**Audio (`O5` = AudioInput):** `f` = flux, `x` = sorted, `T` = thr, `v` = onset, `p`/`m` = cSum/cW, `kl` = clamp01.

**Bundle-level:** `CK` = GROUP, `YC` = GROUP_ORDER, `kp` = IcosahedronGeometry.

**UI helpers:** `Zt` = ctls, `te` = engine, `Y` = `$`, `referenceSet`/`referenceValue` = the `ctls.get(...).set` and `.c.value` helpers.

## Appendix C: toy allocation model (evidence for 2.12 and 7.11)

This is a model, not the engine. Plants start with 3 tips, branch with p = .22 per finished segment up to 10 tips (like roots), use a segment length of .36, and each audio onset spawns 2 plants with hold .38 s + sustain. maxLive is 24, oldest released first, at 60 fps. Credits work as in v19 (cap 64). Run it with `node`:

```js
function run({fillRate,rate,sustain,order,onsetsPerSec,fps=60,secs=8,burst=0,maxLive=24,segLen=.36}){
  let credit=0,t=0,dt=1/fps,plants=[],id=0,nextOnset=0,firstLatency=[],segTotal=0;
  const allowance=()=>{if(fillRate<=0){credit=0;return Infinity}credit=Math.min(64,credit+fillRate*dt);return Math.floor(credit)};
  while(t<secs){
    if(t>=nextOnset){nextOnset+=1/onsetsPerSec;for(let k=0;k<2;k++){const hold=.18+.4*.5;plants.push({id:id++,born:t,until:t+hold+sustain,tips:[{seg:0},{seg:0},{seg:0}],segs:0,first:null,burst})}}
    let live=plants.filter(p=>p.until>t);while(live.length>maxLive){live[0].until=t;live=plants.filter(p=>p.until>t)}
    let x=allowance(),given=x;
    const list=order==='newest'?[...live].reverse():live;
    for(const p of list){for(const tip of [...p.tips]){
      if(tip.seg<=0){let ok=false;if(p.burst>0){p.burst--;ok=true}else if(x>0){x--;ok=true}
        if(!ok)continue;tip.seg=segLen/rate;p.segs++;segTotal++;if(p.first==null){p.first=t-p.born;firstLatency.push(p.first)}}
      tip.seg-=dt;if(tip.seg<=0&&Math.random()<.22&&p.tips.length<10)p.tips.push({seg:0})}}
    if(fillRate>0)credit=Math.max(0,credit-(given-x));
    t+=dt;
  }
  const done=plants.filter(p=>p.born<secs-1.5);
  const starved=done.filter(p=>p.first==null||p.first>.1).length/done.length;
  const med=a=>{a=[...a].sort((x,y)=>x-y);return a[a.length>>1]??NaN};
  return {segsPerSec:(segTotal/secs).toFixed(0),segsPerPlant:(done.reduce((s,p)=>s+p.segs,0)/done.length).toFixed(1),
          starvedOver100ms:(starved*100).toFixed(0)+'%',medianFirstSegMs:(med(firstLatency)*1000).toFixed(0)};
}
// seeded Math.random (Lehmer, seed 42) per case; rate: v0.15 ≈ 5.3, v19 ≈ 1.7 units/s (from 2.12)
```

Results with a seeded RNG:

| case | 4 onsets/s: segs/s, segs per plant, starved > 100 ms, median first seg | 8 onsets/s: same |
|---|---|---|
| v0.15 (fill 1500, sustain 1.5, rate 5.3), oldest-first | 1334, 189.0, 8%, 0 ms | 1404, 101.0, **81%, 383 ms** |
| v19 Simple (fill 240, sustain .2, rate 1.7), oldest-first | **87, 11.1**, 0%, 0 ms | **171, 10.8**, 0%, 0 ms |
| v19 control defaults (fill 300, sustain .25, rate 1.8) | 87, 11.1, 0%, 0 ms | 171, 10.8, 0%, 0 ms |
| proposed (fill 1200, sustain .8, rate 4.5), newest-first + burst 6 | 826, 111.4, 0%, 0 ms | 1226, 81.6, 0%, 0 ms |

Credit-cap check: `fillRate` 8000 gives 1920 starts/s at 30 fps and 3840/s at 60 fps.
