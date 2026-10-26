# K3 — UX / Information-Architecture critique for Growth (v0.15.0 TS to v0.19.0 patched bundle)

Role: UX / IA critic for a live VJ tool. Scope: the panel, controls, presets, MIDI learn, keyboard, HUD and first-run in both lineages. No code in either tree was modified. v19 was served read-only from `C:\Users\User\Downloads\growth-v0190` on a throwaway local HTTP server and inspected in a browser pane at 1440x900 to confirm the DOM-level findings marked **[verified live]**.

---

## 0. Executive summary

Growth has a strong engine and a weak control surface. In v19 the control surface has become the main thing between the owner and "an obvious music visualiser".

- **Too much surface, not enough steering.** In Advanced mode (measured live) the panel has **22 collapsible sections**, **105 range sliders, 36 selects and 103 buttons**, 142 registry entries (`__viz.ctls.size`), and a **5,051 px scroll height** with the default open sections. The one thing a performer most needs, "how hard does it react to the music", is spread across about 18 parameters in 7 sections (details in 2.3).
- **Two UIs that disagree.** v19 added Simple mode (6 looks and 3 sliders) as a second panel on top of the old one. The old panel was not re-organised. The Simple controls are separate hand-made DOM widgets that call `Zt.get(...).set()`. They are not bound to state, and several drift out of sync (bugs B5, B9, B17).
- **Hand-made widgets are second-class.** v16–v19 added about 24 organism controls. None of them were given a group, so all fall into the generic **"More"** section (`GROUP` map in the bundle is unchanged from TS `organism.ts:227-244`). The hand-made duplicates in Input, Screen bounce, Animated materials and Flow & camera are **not MIDI-learnable**. They are not in search results as controls, and 4 separate `setInterval(...,400)` pollers keep them in sync.
- **Live-safety is poor.** A single key resets everything (Backspace or Delete). `R`, which starts recording, sits between the piano keys `E` and `T`. After you click any panel button, keyboard shortcuts silently stop working, and Space or Enter re-fire that button, which for a Look button wipes the scene. The "Show controls" button is hidden under the Camera-lock button **[verified live]**.
- **Calm defaults plus a locked camera hide the music.** v19 applies Roots on first run, sets `musicAmount .42`, `fillRate 240`, zeroes `zoomReact/beatZoom/rotSpeed`, and locks the camera pose 700 ms after load. At that moment the scene is empty, so growth later grows out of a frame chosen before anything existed. The user's wheel and drag do nothing while it is locked.

The recommended direction has one idea behind it: **a single declarative parameter registry, with every surface as a view of it.** The surfaces are panel, Perform HUD, command palette, MIDI map, scenes, macros, undo and reset. On top of the registry sit two performer-grade layers:
1. **Scenes**, which are authored looks plus user slots in one bank. Scenes morph instead of clearing, and an A/B crossfader can be mapped to MIDI.
2. **Four macros: Energy, Complexity, Motion and Chaos.** Each moves many parameters along authored curves relative to the scene. Energy's default is set so the music is obvious.

The recommended top 8 are at the end (section 5).

---

## 1. What exists today (inventory)

### 1.1 TS source (v0.15.0) — `C:\Users\User\Desktop\code\growth-midi-visualiser`

| Area | Location | Notes |
|---|---|---|
| Panel markup | `index.html:90-248` | 8 static sections: Input, Pattern, *(engine groups)*, Shared, Presets, Play, Output, Keys. Sticky `#panelTop` with reset / performance / hide UI / rec / still / camera. |
| Widget factory | `src/midi/main.ts:132-231` `widget()` | Slider or select. Right-click starts CC learn (`main.ts:212-224`). Shows the CC tag. **No default value, no reset, no toggle widget** (0/1 controls render as 2-step sliders). |
| Registry | `main.ts:120-129` `interface Ctl`, `ctls` Map | ids `e:<engine>:<key>` and `g:<key>`. |
| Engine sections | `main.ts:291-383` `renderEngineControls` | One `<details>` per `c.group`. Icon controls (species) render in a grid with all/none buttons and **are not learnable** (`main.ts:322-354` pushes `{id,c,set}` with no `wrap`, no contextmenu). |
| Groups | `engines/organism.ts:226-244` `GROUP_ORDER`, `GROUP` | Growth, Species, React, Model & shell, Video, Camera, Look, Life, Stems, Performance, More. |
| Globals | `main.ts:397-414` | zoom, zoomReact, growth, decay, **symmetry** (dead in Organism: only branching/cells/crystal3d/reactionDiffusion read `symmetryNow`), rotSpeed, beatZoom, beatPalette. |
| Presets | `main.ts:431-527`, `presets.ts` | 8 slots, shift+click save, 2 s morph (`Morph`, `presets.ts:33-60`). Selects, icons and step≥1 switch instantly. Program change selects a slot (`main.ts:549`). |
| Random mix | `main.ts:465-491` | Randomises nearly all controls. `NO_RANDOM` and `RANDOM_CAP` are guard lists. |
| CC learn | `main.ts:531-548` | Absolute mapping `min+(max-min)*v`. **No soft takeover, no relative encoders, no note/pad learn, no per-channel filter, no map list** (only "clear MIDI map"). |
| Keys | `main.ts:990-1026` | 1–9 switch engine, Enter performance, Tab hide UI, Backspace/Delete reset, [ ] palette, R record, C camera, Q still, Space play, ↑↓ zoom, ←→ symmetry, Esc show UI. |
| Piano | `inputMidi.ts:102-146` | `KEY_ROW = 'awsedftgyhujkolp;'`, Z/X octave. |
| HUD | `index.html:250`, `main.ts:1087-1101` | engine · input · notes · meter · bpm · zoom · fps · REC · stats · version. |
| Persistence | `main.ts:68-99` | `midiviz_settings_v3` (all engine values plus ccMap plus open sections). |

### 1.2 v19 patched lineage — `C:\Users\User\Downloads\growth-v0190`

| Area | Location | Notes |
|---|---|---|
| Panel markup | `index.html:147-350` | TS sections plus these additions: `#simpleHome` (169-182), `#sec-specialist-motion` (183, bounce and tip shapes), `#sec-specialist-materials` (183), `#referenceTools` including **"Music growth"** nested inside **Input** (219-232), `#sec-fluid` "Flow & camera" (253-260), recording selects in Output (315-320), floating `#cameraLock` (355), `#returnUi` (146), `#controlSearch` (165). |
| Simple mode | `maintenance/simple-ui.js` | 6 looks (`simpleLooks` 1-8), `simpleApplyLook` (16-37), Surprise (38-44), sources (45-63), mode toggle (64-70), 3 sliders (74-86), camera select (87-92), first-run Roots (119-123). CSS in `index.html:126-140` hides 15 sections under `body.simple-ui`. |
| Search | `maintenance/interface.js` | Section-level textContent filter only. |
| Quick panels | `reference-ui.js`, `music-focus-ui.js`, `dynamic-material-ui.js`, `extra-controls.js`, `performance-ui.js` | Every file is hand-made DOM that writes through `Zt.get('e:organism:'+key).set()` (`referenceSet`, `reference-ui.js:11-14`) and **polls every 400 ms** (`reference-ui.js:58`, `music-focus-ui.js:23`, `dynamic-material-ui.js:23`, `extra-controls.js:29`). |
| Camera | `calm-camera.js`, `cinematic-camera.js`, `music-focus.js` (lock pose) | 9 camMode options, `calmCamera` default 1. The lock pose is set by the look apply. |
| Build | `maintenance/patch_consolidation.py` | Injects the Simple card, CSS and `simple-ui.js`. It **rebinds `#randomMix` to `simpleSurprise`** (`simple-ui.js:73`), which removes the TS random mix. |

### 1.3 Measured v19 Advanced panel **[verified live]**

Visible sections in order: Make something [open] · Screen bounce & tip shapes · Animated materials · Input [open] · Pattern [open] · Growth [open] · Species [open] · React · Model & shell · Video · Camera · Look · Life · Stems · Performance · **More (24 controls)** · Flow & camera [open] · Shared · Saved slots · Play · Output · Keys.

Controls per engine group: Growth 15, Species 1 plus 37 icons, React 6, Model & shell 14, Video 7, Camera 4, Look 6, Life 12, Stems 4, Performance 4, **More 24**.

These are the 24 controls that landed in "More": stable presentation camera, camera shot distance, camera tracking response, soft wave amplitude, soft audio response, soft flow speed, **music growth amount**, highlight music / dim old growth, fresh growth trail, background starts per second, new strand spread, build the shape without music, existing growth follows live frames, invert relief depth, bounce sculpture around screen, screen bounce speed, bouncing sculpture screen size, tip marker shape/size/brightness, visible tip limit, new materials: motion speed / pattern scale / audio response.

---

## 2. Diagnosis — why the IA fails both audiences

### 2.1 First-time user (goal: a great result in 10 seconds)
- Simple mode is the right instinct, but the first frame is **an empty black screen and a panel**. Nothing tells the user to *press A–L or plug in MIDI* other than one search-help line (`interface.js:19`) that is hidden in Simple mode (`#searchHelp` is in the hide list). The only on-canvas signal is the tiny HUD.
- The camera is locked at 700 ms (`simple-ui.js:120-123` calls `simpleApplyLook('roots')`, which calls `te.setCalmCamera('still')`, which calls `toggleCameraLock()` in `calm-camera.js:10`). At that moment there is no geometry, so the frame is arbitrary. Silk and Liquid grow out of frame (lead's observation), and wheel and drag do nothing while locked (NOTES_V0172: "Unlock before orbiting, panning, zooming"). The first interaction a curious user tries appears broken.
- Defaults are tuned for *calm* (`musicAmount .42`, `fillRate 240`, `sustain .2`, `bloom .35`, `pulse .15`, `flash .08`, camera audio-response off). On note-on the response is subtle, which undercuts the product's promise.
- Labels are phrased inconsistently: "How much the music grows", "Branching detail", "Audio attack sensitivity". The START_HERE doc calls them "Growth", "Detail", "Audio sensitivity", "Trace silhouette", "Sculpt relief", "Gentle orbit", "Source visible" and "Choose 3D model", while the UI says "Trace details", "Grow over relief", "Very slow orbit", "Show / hide source" and "Load 3D model" (`START_HERE_v0190.md` vs `index.html:170-181`).

### 2.2 Live performer (fast, MIDI-mappable, performance-safe, nothing hidden that is needed live)
- **No live-sized layer exists.** "Performance" mode just hides everything (`main.ts:950-957`). Between "all hidden" and "22 sections" there is nothing.
- The v19 **Look buttons cannot be used live**. Each click does `clear:true` (`simple-ui.js:71`), which wipes the growth and re-locks the camera. They cannot be MIDI-mapped because they are not ctls, and they do not morph.
- **Saved slots** are 8 unnamed numbered buttons with no thumbnails and no names in the UI (name is `preset HH:MM`, `main.ts:437`). They are stored per-browser in localStorage only, with no export.
- **MIDI learn** covers only generated sliders and selects. Species icons, all v16–v19 hand-made sliders, Looks, Surprise, Reset, Record, camera lock, and the three Simple sliders cannot be mapped. There is no pad/note learn, so a pad controller cannot recall scenes except via Program Change.
- **Search** finds sections, not controls. Typing `speed` opens 10 sections, and `a` matches all 22 **[verified live]**. Nothing is highlighted or scrolled into view. It cannot run actions.

### 2.3 The "music reaction" knob is fragmented (core complaint)
Parameters that change how visibly growth follows the music, and where they live in v19:

| Parameter | Section |
|---|---|
| `musicAmount` | More **and** Input › 3D reference › Music growth **and** Simple "How much the music grows" (3 widgets) |
| `speed`, `sustain`, `fillRate`, `maxLive`, `retract` | Growth |
| `react`, `pulse`, `flash`, `kick`, `shake`, `speedReact` | React |
| `lightReact`, `bloom`, `glow` | Look |
| `beatLock`, `wild` | Life |
| `materialReact`, `softReact` | More (and hand-made copies) |
| `g:growth`, `g:zoomReact`, `g:beatZoom`, `g:rotSpeed` | Shared |
| `calmCamera` (which zeroes kick and shake via `react*(calm?0:1)`, `patch_consolidation.py` line ~31) | More |
| `__growthAudioSensitivity` (global var, not a ctl) | Simple only |

That is about 22 parameters, in 7 sections plus a hidden global. No human can "turn it up" coherently live. This is the strongest argument for macros (idea U3).

---

## 3. Concrete UX bugs and papercuts

Severity: **H** = can ruin a live show or first impression; **M** = confusing or inconsistent; **L** = polish.

| # | Sev | Bug | Evidence | Fix |
|---|---|---|---|---|
| B1 | H | With UI hidden, **"Show controls · Esc" (`#returnUi`) sits under the Camera-lock button**. Clicking where it shows toggles the camera lock instead of showing the UI. | `index.html:108` (`#returnUi` top:12 right:12 z:5) vs `index.html:126` (`#cameraLock` top:12 right:12 z:1000). `elementFromPoint` at returnUi returned `cameraLock` **[verified live]** | Put both in one top-right toolbar (flex row), or move the lock into the Perform HUD. |
| B2 | H | `#cameraLock` stays visible in capture mode `?ui=0`, so an **OBS Browser Source shows the button on the output**. | `interface.css:30` hides only `#returnUi` under `body.capture-output`. No rule for `#cameraLock`. | `body.capture-output #cameraLock{display:none}`. Better: all overlay chrome lives in one container hidden in capture mode. |
| B3 | H | **Focus trap**: after clicking any panel button, all shortcuts are ignored. v19 keydown returns if `e.target.closest("input,select,textarea,button,summary,a,[role=button]")`. **Space or Enter then natively re-click the focused button.** Example: click "Coral", then press Space to start the track, and the look is re-applied with `clear:true`, wiping the scene. Enter after clicking ↺ reset resets again instead of entering performance mode. | Bundle keydown (anchor `if(e&&(e.isContentEditable\|\|e.closest?.("input,select,textarea,button,summary,a,[role=button]")))return;`). After a click, `document.activeElement` = the Coral button **[verified live]** | Blur panel buttons on pointerup (`pointerup` then `if(e.pointerType!=='')btn.blur()`). Only exempt text inputs, selects and textareas from shortcuts. Give Space and Enter global meaning only when focus is on body or canvas; otherwise call `preventDefault` on Space for buttons that were mouse-clicked. |
| B4 | H | **R (record) sits between piano keys E and T**, and C (camera) is next to X (octave). Playing the computer piano fast can start or stop a recording or cycle the camera. | `inputMidi.ts:102` `KEY_ROW='awsedftgyhujkolp;'`. `main.ts:1008-1010` | Make command keys need Shift (Shift+R record) **or** add a piano/command toggle (see U10). Digits 1–5 switching engines is equally risky (`main.ts:998-1000`). |
| B5 | H | **Look buttons always clear the scene and re-lock the camera** (`clear:true`, `setCalmCamera('still')`), so they are unusable mid-song. | `simple-ui.js:32-33,71` | Scenes morph by default (U2). Clearing is an explicit option. |
| B6 | H | **Single-key irreversible reset** (Backspace or Delete, also ↺ button) with no hold, confirm or undo. | `main.ts:1004`, bundle `t==="Backspace"\|\|t==="Delete"?M5()` | Hold-to-reset (500 ms ring) for keyboard and button. The MIDI-mapped trigger stays instant. Optional "undo reset" keeps the last cleared scene for 10 s where memory allows (see U8). |
| B7 | M | **Simple sliders lie.** Applying a look resets `musicAmount` to .42 and branch/wiggle/length to recipe values, but `#simpleGrowth` and `#simpleDetail` keep their old positions. `#simpleCamera` does not reflect the top-right lock (unlock by hand and it still says "Still"). A look re-locks the camera even if the select says "Very slow orbit". | `simple-ui.js:21-35,87-92` | Bind every widget to the registry (U1). The camera select reads engine state. |
| B8 | M | **Display rounding hides real values.** The `musicAmount` hand-made slider (step .05) shows 0.4 while the engine holds 0.42. | `index.html:230`. Measured `[0.4, 0.42, 0.4]` **[verified live]** | Show the value from the registry with the control's own precision. |
| B9 | M | **Hand-made duplicate sliders look identical to learnable ones but are not MIDI-learnable** (right-click opens the browser menu). This affects musicAmount, musicFocus, musicTrail, buildPace, refSize, refDepth, bounce*, tip*, material*, and the three Simple sliders. | They are `<label class="slider">` elements with no `oncontextmenu` (`index.html:183,228-230`) | One widget per param, produced by `widget()` (U1). |
| B10 | M | **24 v16–v19 controls dumped into "More"**, including the primary music knob. | Bundle `GROUP` map equals TS `organism.ts:227-244`. More = 24 ctl **[verified live]** | Regroup (U5 table). |
| B11 | M | **"Make something" (Simple card) still shows in Advanced**, so there are two copies of look, response and camera controls. | `index.html:137` only defines `body.simple-ui #simpleHome{display:block}` and nothing hides it otherwise. Visible in Advanced **[verified live]** | Replace with the Scene strip (U2) at the top of both modes. |
| B12 | M | **Specialist novelties placed above Input.** "Screen bounce & tip shapes" and "Animated materials" come before Input and Pattern. | `index.html:183` | Move to Look ▸ Surface / Look ▸ Tips. |
| B13 | M | **"Music growth" is nested inside Input › 3D reference**, so the most important live control is visually subordinate to picture guidance. | `index.html:230` | Music tab (U5). |
| B14 | M | **Camera controls live in 6 places**: `#camCycle` (panelTop, hidden in Simple), floating `#cameraLock`, `#simpleCamera`, `#cameraPreset` (Flow & camera, 5 of 9 modes), engine Camera group (camMode, orbit, growAtCam, camFollow), More (calmCamera, camDistance, camSmooth). Also Shared zoom/zoomReact/rotSpeed/beatZoom and React kick/shake. | `index.html:163,177,257,355` | One Camera card (U6). |
| B15 | M | **Dead or anti-aesthetic globals.** Shared › "mirror folds" and ←/→ keys change `g.symmetry`, which Organism ignores. ← to 0 means "auto from chord" (kaleidoscope) on other engines, which the owner explicitly rejects. The Keys section still advertises "←→ mirror folds". | `main.ts:405,1020-1022`, `index.html:344` | Hide globals an engine does not consume (declare `consumes` per engine). Remap ←/→ to scene prev/next. |
| B16 | M | **Two "growth speed" sliders**: Shared `g:growth` (×) and Growth `speed`, multiplied in `organism.ts:2280`. | `main.ts:403`, `organism.ts:391` | Keep one visible; fold the global into the Energy macro. |
| B17 | M | **Audio sensitivity is a bare global** (`globalThis.__growthAudioSensitivity`). It is not saved (resets to 0.45 from the HTML attribute on reload), not in presets, and not learnable. | `simple-ui.js:82-86` | Make it a real global ctl `g:onsetSens`. |
| B18 | M | **Random mix removed in Advanced.** The `#randomMix` handler is overwritten with the Simple surprise, and the label changes to "curated surprise". Advanced users lost the exploratory randomiser. | `simple-ui.js:73`, `patch_consolidation.py` html_changes | Offer both: "Surprise (curated)" and "Mutate" (±x% around the current scene using the Chaos macro, U3). |
| B19 | M | **Status messages go to `#status` inside the Input section body.** They are invisible when Input is collapsed, scrolled away, or the UI is hidden. Many important messages ("Load a picture… first", "Choose Organism…", recording errors) go there. | `index.html:238`, `main.ts:134` | Toast area near the HUD (U11). |
| B20 | M | **Simple mode hides Output and Keys** but keeps ● rec, so recording format, resolution and the editor-MP4 preset are invisible to the users most likely to want a file that "just opens". | `index.html:127-132` | The Perform HUD shows the current record profile ("MP4 · 1080p30") with a one-click profile menu. |
| B21 | M | **Species icons (37) are not MIDI-learnable** and take about 10 rows at 4 columns. There is no way to switch "families" live. | `main.ts:322-354`, `interface.css:17` | Species become part of scenes. Add "species sets" (for example Roots family, Coral family, Soft) as learnable select ctls. |
| B22 | M | **CC mapping jumps.** After a preset or scene load the physical knob disagrees with the value, and the first touch jumps. | `main.ts:545-547` | Soft takeover (pickup) per mapping (U7). |
| B23 | M | **Doc/UI label drift** (see 2.1). | `START_HERE_v0190.md` vs `index.html:170-181` | Labels come from the registry and are generated into the docs. |
| B24 | L | `#panelTop` row wraps: "Advanced controls" drops to its own line at 340 px width (seen in screenshot). | `index.html:153`, `#uiMode{margin-left:auto}` | Icon button or segmented control "Simple/Full". |
| B25 | L | 0/1 controls render as 2-position sliders (attach, shellCycleBeat, shellCycleSize, growAtCam, videoSpawn, autoQuality, beatLock, physics, calmCamera, beatPalette…) with "(0 / 1)" in the label. | `organism.ts:382,389,390,405,412,418,420`, `main.ts:408` | `kind:'toggle'` renders a switch. |
| B26 | L | HUD shows `zoom 1.01`, which means nothing to a performer. It does not show scene name, macro values, quality/render scale, MIDI device activity, or camera lock state. | `index.html:352` | Perform HUD (U4). |
| B27 | L | Keys reference is out of date: piano row goes to `;`, not K; F2 vs Tab; digits switch to engines the owner doesn't use. | `index.html:342-347` | Generated overlay (U10). |
| B28 | L | `first-run` stores `growth-good-start-v0190`. Every existing user gets Roots applied once over their saved settings, silently. | `simple-ui.js:119-123` | Settings schema version plus an explicit "What's new — try the new default look?" toast. |
| B29 | L | Four 400 ms pollers rewrite DOM values (`slider.value=…`) even while the panel is hidden or in performance mode. | files listed in 1.2 | Registry change events (U1). Skip DOM work while `hide-ui`. |
| B30 | L | `referenceFrameRadius`/Fit, lock, and `refFit` are disabled until a source exists, with no inline explanation except `#refHint` inside the hidden-in-Simple `#referenceTools`. | `reference-ui.js:26-36` | Disabled controls carry a tooltip reason from the registry (`enabledWhen` with `why`). |

---

## 4. Proposals (ideas)

Each entry has: impact (1–10), effort (S/M/L/XL), user-visible result, technical design with code locations, risks, and how it stays optional and lightweight.

All designs target the **TS source** (`growth-midi-visualiser`). The v16–v19 features are assumed to be ported into TS first; porting is another agent's scope, and nothing here should be built as another bundle patch.

---

### U1 — Single declarative parameter registry ("one param, one truth, many views")
**Impact 8 · Effort L** *(enabler for U2–U11)*

**User-visible result:** every control behaves the same wherever it appears (panel, HUD, palette, MIDI). Right-click learns anything. Double-click resets anything. Values never disagree between two widgets. The duplicate hand-made sliders disappear.

**Design**
- Extend `EngineControl` (`src/midi/engine.ts:26-40`) into `ParamDef`:
  ```ts
  interface ParamDef extends EngineControl {
    def: number                 // factory default (captured once at construction)
    kind?: 'slider'|'select'|'toggle'|'icon'|'trigger'
    tab: 'Music'|'Growth'|'Species'|'Look'|'Camera'|'Source'|'Output'|'System'
    tier: 'essential'|'more'|'expert'   // progressive disclosure inside a section
    short?: string              // ≤14 chars for HUD/MIDI map ("Energy", "Branch")
    help?: string               // tooltip; generated into docs
    synonyms?: string[]         // palette search ("density", "amount", "react")
    live?: 'safe'|'heavy'|'destructive' // heavy = realloc/recompile (shader, budget), destructive = clears
    enabledWhen?: { test: () => boolean; why: string }
    fmt?: (v:number)=>string    // "0.42", "1500 /s", "Off/On"
  }
  ```
- `main.ts` `Ctl` (120-129) gains `def`, `reset()`, `modified()`, and a tiny event bus: `onParam(id, v, source:'ui'|'midi'|'macro'|'scene'|'engine')`. Replace the four `setInterval(…,400)` pollers (v19 `reference-ui.js:58`, `music-focus-ui.js:23`, `dynamic-material-ui.js:23`, `extra-controls.js:29`) with subscriptions. `onControlValue` (`main.ts:265-270`) already exists for engine-originated changes. Route it through the bus.
- Replace `OrganismEngine.GROUP` (`organism.ts:227-244`) with per-control `tab`/`tier` in the controls array (`organism.ts:371-449`). The group is data, not a lookup table that silently falls back to "More".
- `renderEngineControls` (`main.ts:291-383`) renders sections per `tab`. Inside each, `essential` shows, and `more`/`expert` sit behind a per-section "+N more" disclosure.
- Globals (`main.ts:397-414`) become ParamDefs with `consumes`. Engines declare `consumesGlobals: ['zoom','decay','growth']` so dead ones (symmetry for Organism) are hidden (fixes B15).

**Risks:** big diff in `main.ts`. Preset and localStorage key compatibility (keep `e:organism:<key>` ids, as `settings.engineCtl` and `ccMap` depend on them, `main.ts:62-66`).
**Optional/lightweight:** pure UI data, zero per-frame cost. It *removes* 4 pollers.

---

### U2 — Scenes: authored looks plus user slots in one morphable bank, with an A/B crossfader
**Impact 9 · Effort M–L**

**User-visible result:** a strip of **scene cards** (thumbnail plus name) at the top of the panel and in the Perform HUD. Built-in: Roots, Coral, Neural, Crystal, Liquid, Silk, plus 2–4 new "showpiece" scenes (for example "Mycelium storm", "Deep reef", "Lightning bloom"). **Clicking a scene morphs over 2 s (configurable 0–8 s) without clearing**: new growth adopts the new species, palette and shader, and old growth dims out naturally. Shift-click cuts with clear. There are 16 user slots with names and thumbnails. A **scene crossfader** (A|B), MIDI-mappable, blends any two scenes' numeric params live. "Save as scene" names it. Export and import `.growth-scenes.json` for gig backups and moving between laptops.

**Design**
- `presets.ts` `Preset` (5-11) becomes `Scene { id, name, builtin?, thumb?: string /*webp dataURL ~6-10 KB*/, palette, engine, globals, engineCtl, macros?: {energy,complexity,motion,chaos}, camera?: {mode, lock?:boolean}, morphSecs? }`.
- Built-ins are shipped as data (`src/midi/scenes.ts`) authored from `simple-ui.js:1-8` plus its `base` (21-25). They are **complete** snapshots: species, palette, shader, react params, camera mode. Macro defaults are set so music reads (see U3). They are never mutated. User edits produce "Roots (edited)" in a user slot.
- Morph: reuse `Morph` (`presets.ts:33-60`) and `loadPreset` queueing (`main.ts:500-526`). Change this for species: instead of flipping `sp:*` instantly (`c.c.icon` → `applyNow`), apply species at the *next note-on* ("quantised to next note") so the change is heard and seen as a musical event. Option: quantise the scene switch to the next bar using `m.beat.barHit` (already used at `main.ts:1054`).
- Heavy params (`live:'heavy'`: shader, env, budget, quality) switch at the morph midpoint, not per-frame.
- Crossfader: `g:sceneX` (0..1) ParamDef. When moved, per-frame `lerp(A.engineCtl[k], B.engineCtl[k], x)` for numeric non-heavy keys. Selects and species switch at x=0.5 (hysteresis ±0.05). Costs about 100 number writes per frame only while the fader moves, and nothing when idle.
- Thumbnails: on save, call `engine.snapshot(0.25)` (exists, `main.ts:864-878`) and downscale via OffscreenCanvas to 160×90 WebP q0.7. Built-in thumbs are generated at build time (or captured on first use and cached in localStorage).
- MIDI: Program Change maps to a scene index (kept, `main.ts:549`). Pads/notes on the **control channel** map to scene N (U7). ←/→ keys go to previous/next scene (replacing dead symmetry, B15).
- Replaces: `#simpleHome` look grid, `#sec-presets` (`index.html:273-282`), `simpleSurprise`/`randomMix` (a "Surprise" scene is a generated variation of a random built-in; "Mutate" = Chaos macro nudge).

**Risks:** morphing species between radically different scenes may look muddy. That is why species switch on the next note, and old plants keep their species (they already do: species is per plant). localStorage quota: 16 thumbs × 10 KB ≈ 160 KB is fine (localStorage is ~5 MB).
**Optional/lightweight:** the strip collapses to one row. The crossfader is hidden unless mapped or opened. No render cost.

---

### U3 — Four macros: Energy · Complexity · Motion · Chaos (plus an optional Density)
**Impact 9 · Effort M**

**User-visible result:** four big knobs (and 4 learnable CCs) that make coherent, large changes:
- **Energy** is "how obviously it dances". At 0 the growth is contemplative and slow. At 1 every note shoots strands, bass swells, hits flash, and new tips glow cyan. It is also the "make it obviously a music visualiser" knob, and **the factory default should be ~0.65, not v19's calm equivalent (~0.3)**.
- **Complexity** sets branching, nodes, segment length and wiggle (the v19 "Branching detail" generalised).
- **Motion** runs from locked-framed to slow orbit, then tip glide, then cinematic tour, including camera speed and beat kick. Motion 0 keeps calm-camera guarantees for recordings.
- **Chaos** covers wild, mutation, physics wind, and per-note variation. At 0 growth is orderly and at 1 it is feral. It **never produces symmetry or kaleidoscope** (owner constraint): symmetry is not a target.

**Design**
- `src/midi/macros.ts`:
  ```ts
  interface MacroTarget { id: string; curve: [number,number][] /* piecewise-linear x→y, x∈[0,1] */; mode?: 'abs'|'mul' }
  interface Macro { id:'energy'|'complexity'|'motion'|'chaos'; label:string; targets: MacroTarget[] }
  ```
  Apply as **base ⊕ macro**: scene values are *bases*. Macros produce offsets or multipliers so a macro stays meaningful across scene changes. Implement in the registry as `effective = clamp(base * mul + add)`. The engine reads effective values via `setControl`. Presets and scenes save *bases plus macro positions*, not effective values. This avoids "macro writes overwrite scene" drift.
- Starting target curves (keys from `organism.ts:371-449` and v19 extras):

  | Macro | Targets (x=0 → x=0.5 → x=1) |
  |---|---|
  | Energy | `musicAmount` .25→.7→1.3 · `speedReact` .2→.6→1 · `pulse` .1→.5→1 · `flash` .05→.4→.9 · `glow` .6→1→1.6 · `sustain` .15→.6→1.8 · `fillRate` 300→1500→4000 · `maxLive` 12→28→60 · `lightReact` .4→1→1 · `musicFocus` .5→.8→1 · `materialReact`/`softReact` .3→1→1.6 · `bloom` 0→.35→.8 (skipped if auto-quality is at its lowest tier) · `g:onsetSens` .35→.5→.7 |
  | Complexity | `branch` .2→1→2 · `nodes` .3→1→1.6 · `wiggle` .3→1→1.8 · `length` 1.2→1→.7 · `join` .5→1→1.4 · `cohesion` .2→.35→.6 |
  | Motion | `camMode` stepped: 0–.2 Framed (calm, auto-fit, U6) · .2–.45 orbit with `orbit` .05→.35 · .45–.7 tip glide (6) · .7–1 cinematic tour (7) · `camSmooth` .8→.4 · `kick`/`shake` 0 until .5, then 0→.5/0→.15 · `g:beatZoom` 0→.4 · `calmCamera` 1 below .5 else 0 |
  | Chaos | `wild` 0→.6→1.4 · `physics` 0/1 at .4 · `wind` 0→.5→1.2 · per-note species variance (`species` mode "random from toggled" above .6) · `cycleMode` shed/`cycleEvery` 0→0→60 above .8 (optional) |
  | (Density, optional 5th) | `budget` 40→80→200k (capped by device tier) · `recycle` · `size` — useful for weak laptops; maps to auto-quality |

- The Simple panel becomes: Scene strip + 4 macros + source intents + camera Framed/Orbit/Manual. It maps 1:1 to the Perform HUD.
- Macros are ParamDefs (`g:mEnergy` etc.), so they are learnable, saved in scenes, and undoable.

**Risks:** curve tuning takes art-direction time with the owner. Stepped camMode on a continuous knob needs hysteresis. Energy at max must respect the lightweight constraint: cap `fillRate`/`maxLive` by an auto-quality tier (`autoQuality`, `organism.ts:418`).
**Optional/lightweight:** macros at their neutral 0.5 equal the scene as authored. The cost is O(targets) only when a macro or base changes, not per frame.

---

### U4 — Perform HUD (compact live layer between "full panel" and "hidden")
**Impact 8 · Effort M**

**User-visible result:** pressing `P` (or ▶ performance) swaps the panel for a slim bottom bar about 64 px tall, semi-transparent, auto-fading after 3 s of no mouse movement, and never in recordings (the DOM is not in canvas capture). It contains:
`[scene cards ◀ Roots ▶ (8 mini thumbs)] [Energy ◔][Complexity ◑][Motion ◔][Chaos ○] [A——|——B] [🔒 Framed/Orbit/Follow] [⟲ hold-reset] [● REC 0:42 · MP4 1080p30] [in ▮▮▮▯ · MIDI ● · 124 bpm · 58 fps · q 0.85 · 34k/80k]`.
Knobs drag vertically, scroll-wheel, double-click resets, and right-click learns. Nothing needed live is hidden. Nothing destructive is one click away.

**Design**
- New `src/midi/hud.ts`, rendering from registry entries tagged `perf:true` (the macros, `g:sceneX`, `camera`, `record`) and the existing HUD fields (`main.ts:1087-1101`). Reuse the `#hud` element slot (`index.html:250`) and extend it rather than adding a new overlay.
- The HUD updates at the existing 1/6-frame cadence (`main.ts:1087`), so no new timers are needed.
- "Quality" readout shows `pixelNow` and the budget use (`engine.stats()`), so the performer sees *why* growth stops (budget full or auto quality dropped). This addresses "growth should not stall at limits".
- Capture mode `?ui=0` hides the HUD entirely. `?hud=1` can force it for OBS monitor-only setups.

**Risks:** screen real estate on small laptops (collapse to 2 rows below 900 px). Keyboard shortcuts must keep working while the HUD is focused (see B3 fix).
**Optional/lightweight:** it is a view. The HUD can be off, and costs about 20 DOM nodes.

---

### U5 — Re-organised panel IA (tabs plus progressive disclosure instead of Simple/Advanced plus 22 sections)
**Impact 8 · Effort M** (after U1)

**User-visible result:** one panel with a fixed top area (Scene strip plus macros plus transport), then **7 tabs**. Each section shows only its essentials, with "+N more" inside. There is no more global Simple/Advanced switch. Simple becomes "just don't open the tabs".

```
┌ Growth v0.20.0 ─────────────── [?] [⌘K] [Hide] ┐
│ Scenes: [Roots][Coral][Neural][Crystal][…][+]  │  ← always visible
│ Energy ◔  Complexity ◑  Motion ◔  Chaos ○      │  ← always visible
│ Input: ● MIDI (nanoKEY2) ▾   ⟲hold  ● rec ▾    │
├ Music | Growth | Species | Look | Camera | Source | Output | ⚙ ┤
```

| Tab | Essentials (always shown) | "+ more" (tier more/expert) |
|---|---|---|
| **Music** | input mode + device, audio transport, onset sensitivity (`g:onsetSens`), musicAmount, sustain, musicFocus, stems on/off | musicTrail, speedReact, react, pulse, flash, lightReact, beatLock, stem→species selects, BPM/clock source |
| **Growth** | speed, thickness, length, branch, wiggle, join | lignify, retract, fillRate, maxLive, cohesion, size, bounds, decay (global) |
| **Species** | family presets (Roots family / Coral / Neural / Crystal / Soft / All) plus species grid collapsed to 2 rows plus "show all 37" | species choice mode, soft wave/react/speed, nested |
| **Look** | palette, growth material (with thumbnails), bloom, glow | env, envShader, material speed/scale/react, tip shape/size/brightness/limit, seasons |
| **Camera** | mode (Framed / Orbit / Follow / Tour / Manual), lock, Fit | orbit speed, camDistance, camSmooth, camFollow, growAtCam, zoom, zoomReact, beatZoom, kick, shake, screen bounce (+speed, size) |
| **Source** | picture / video / camera / model buttons, intent (Trace / Relief / Skin / Off), show source, size, depth | edge, stick, spawn, scatter, build-without-music, build pace, follow live, invert, shell, shell mode/look/cycle, model anim/morph |
| **Output** | record profile (Editor MP4 / Web / Max), audio source, rec start mode, still | resolution, fps, bitrate, cast URL, capture URL, OBS/NDI notes, report |
| **⚙ System** | quality/auto-quality, budget, recycle, MIDI map, keyboard map | other engines ("Labs: Reaction-diffusion, Branching, Cells, Crystal 3D"), physics, typography, cycle, reset all to factory |

- Moves the "More" 24 into their homes (B10). Moves "Music growth" out of Input (B13). Kills the duplicates in `#sec-specialist-*`, `#referenceTools`, `#sec-fluid` (B9, B12, B14).
- **Other engines move to System ▸ Labs.** Digits no longer switch engines (B4), in line with the owner's organic-only aesthetic. They are still reachable, so the change is optional rather than a deletion.
- Tabs remember the last open one (reuse `settings.openSecs`, `main.ts:280-287`).
- Implementation: `index.html` becomes a short shell. `renderPanel()` iterates `tab` then `tier` from the registry. Static non-param widgets (file pickers, transport, cast URL) are declared as `kind:'custom'` render hooks so they sit in the right tab.

**Risks:** muscle memory of existing users. Mitigate with a palette (U9), where typing the old label finds the new home.
**Optional/lightweight:** fewer DOM nodes at once (lazy-render a tab's "+more" on first open).

---

### U6 — Camera consolidation plus "Framed" default (auto-fit, never out of frame)
**Impact 8 · Effort M**

**User-visible result:** one Camera control with five plain modes: **Framed** (default: calm, the camera slowly fits the living growth so nothing leaves the frame and nothing shakes), **Orbit**, **Follow** (tip glide or chase newest), **Tour** (cinematic), **Manual**. A lock icon freezes whatever you have. Wheel and drag always work: in Framed they *offset* the framing instead of being ignored, and after 8 s idle it eases back unless locked. First run shows Roots or Silk growing in frame.

**Design**
- Framed = `camMode 8` "wide pulse" (`cinematic-camera.js:21-26`, which already computes `extent` from sampled segments) with `calmCamera=1` and the bass breathing removed (`radius*=1-.07*cinematicBass`). Add a **fit hysteresis**: grow the radius quickly when extent exceeds 0.8 of the frame, shrink slowly (10 s time constant) to avoid pumping.
- Lock: keep `cameraLockPose` (`music-focus.js:4-11`), but **never auto-lock on first run** (remove `simple-ui.js:122` behaviour). Lock only on user action. When locked, a wheel or drag shows a toast "Camera locked — click 🔒 to unlock" instead of doing nothing silently.
- `#camCycle`, `#simpleCamera`, `#cameraPreset`, the floating `#cameraLock`, and the Camera and More groups collapse into the Camera tab plus one HUD control (fixes B1, B2, B14).
- The Motion macro drives this (U3).

**Risks:** auto-fit with sparse outlier strands (for example, lightning) could zoom far out. Use the 90th-percentile distance of sampled segments rather than the max (stride sampling exists: `cinematic-camera.js:23-24`).
**Optional/lightweight:** sampling 512 segments at 4 Hz is negligible. Manual and Lock remain.

---

### U7 — MIDI learn 2.0 (learn overlay, pads/notes, soft takeover, control channel, map list, export)
**Impact 8 · Effort M**

**User-visible result:** press **L** or the "MIDI learn" button, and every learnable thing (sliders, toggles, species icons, scene cards, macros, crossfader, reset, record, lock, camera modes) gets a yellow outline. Click one, move a knob or hit a pad, and it is mapped with a "cc21 → Energy" badge. A MIDI map list in ⚙ shows mappings with delete, channel, mode (absolute / relative / toggle / momentary) and "pickup" on/off. **Control channel**: notes on channel N (default 16, configurable, or "a specific device") trigger actions and never grow plants, so a pad controller can fire scenes without spawning roots. Maps export and import as JSON. Optional one-click templates for nanoKONTROL2, Launch Control XL, APC mini, and generic "8 knobs + 8 pads".

**Design**
- `main.ts:531-548` becomes `src/midi/midiMap.ts`: `Mapping { src: {type:'cc'|'note'|'pc', ch:number|'*', num:number, device?:string}, target: string /*param id or action id*/, mode:'abs'|'rel2c'|'relBin'|'toggle'|'momentary'|'trigger', pickup:boolean, min?:number, max?:number, invert?:boolean }`.
- **Soft takeover**: store the last hardware value per mapping. Only apply once the hardware value crosses the current param value (±2/127), and show "↑ pick up" in the badge until then (fixes B22).
- `MidiInput` (`inputMidi.ts:73-90`) passes `channel` and device to `onCC`, and emits `onNote` before the clock push. If the note matches a control-channel mapping, **consume it** (do not `clock.push`).
- **Actions registry** (`actions.ts`): `reset`, `record`, `still`, `scene:n`, `scene:next/prev`, `lock`, `camera:next`, `surprise`, `mutate`, `panic` (all notes off plus fade retract), `hideUi`, `tapTempo`. The same registry powers the palette (U9) and the keyboard (U10).
- Learn overlay: CSS class `body.learning`. Every element with `data-param` or `data-action` gets `outline` and a click handler in capture phase. The existing right-click learn stays as the fast path.
- Persist in `settings.midiMaps` (migrate old `ccMap`: `{cc:id}` → `{src:{type:'cc',ch:'*',num:cc}, target:id, mode:'abs', pickup:true}`).

**Risks:** relative encoder formats vary (offer 2 common ones and auto-detect by observing 1/127 or 63/65 patterns). Consuming notes on the control channel must not break users who play on channel 16. Default is "off until set".
**Optional/lightweight:** the map is idle unless messages arrive. Templates are tiny JSON.

---

### U8 — Per-control reset, "modified" markers, undo/redo, and A/B compare
**Impact 7 · Effort S–M**

**User-visible result:** a changed control shows a small dot. **Double-click a label resets it** to the scene value (or the factory value, holding Alt). Each section header shows "3 changed · reset". **Ctrl+Z / Ctrl+Shift+Z** undo and redo parameter changes (a whole drag is one step, as is a macro move or a scene load). An "A/B" toggle flips between the current tweak and the scene as authored, which is handy when auditioning a change. Optional **"Undo reset"** for 10 s restores the growth you just wiped (where memory allows).

**Design**
- `def` from U1. `modified = Math.abs(c.value - base) > step/2`, where `base` is the active scene's value (else `def`).
- Undo stack in `main.ts`: `{id, from, to, t}` entries, coalescing changes to the same id within 400 ms (drag) and wrapping multi-param operations (macro, scene, surprise) in one group. 100-entry ring. Skip `source:'midi'` changes by default (live knob moves are not "mistakes"). Option to include them.
- Undo reset: `OrganismEngine.clear()` already drops `segs`/`plants`. Instead keep the arrays in `lastCleared` for 10 s and free them after (memory cost: bounded by budget, up to about 80k segments of small objects). Offer only when `segs.length < budget*0.5` on weak devices (auto tier). Otherwise the hold-to-reset (B6) is the safety.

**Risks:** undo of heavy params (shader, budget) causes recompiles or reallocations, so rate-limit them. Undo reset memory use.
**Optional/lightweight:** pure UI bookkeeping. Undo reset can be switched off.

---

### U9 — Command palette (Ctrl+K or "/") that replaces section search
**Impact 7 · Effort S–M**

**User-visible result:** Ctrl+K (or "/") opens a centred box. Typing "bloom", "shake", "camera", "record", "coral" or "reset" lists **individual controls and actions** with their current value, tab path ("Look ▸ Bloom · 0.35"), and inline slider or toggle. Enter jumps to the control in the panel (tab opens, row scrolls into view and flashes). Recent and favourite items appear on empty query. Star a control to pin it into a "My controls" row in the HUD.

**Design**
- Index = registry (`label`, `short`, `synonyms`, `help`, `tab`) plus actions registry (U7). Fuzzy scoring (prefix > word-start > substring). About 60 lines, no library.
- Replace `interface.js` `growthFilterControls` (section textContent filter).
- Pins stored in `settings.pins: string[]` and rendered by the HUD (U4) as up to 4 extra knobs.

**Risks:** conflicts with the piano keys, so "/" must be a non-piano key (it is not in `KEY_ROW`). Ctrl+K is fine in Chrome.
**Optional/lightweight:** DOM is created on first open.

---

### U10 — Keyboard model: piano vs command layer, a safe shortcut map, and a "?" overlay
**Impact 7 · Effort S**

**User-visible result:** press **?** for a translucent overlay of all keys, drawn as a keyboard with the piano keys tinted and command keys labelled. A small "⌨ Piano / ⌘ Commands" indicator appears in the HUD. **Caps Lock**, or a toggle, switches the letter row between the piano and command letters. In piano mode, destructive commands need Shift (Shift+R record, Shift+Backspace hold-reset), and digits pick scenes 1–8 rather than engines.

**Design**
- Keydown (`main.ts:990-1026`, v19 bundle handler) becomes a table: `{key, shift?, action, layer:'always'|'command', hold?:ms}` from the actions registry. The overlay is generated from the same table, so the docs never drift (fixes B27).
- Fix B3: only skip shortcuts for `input[type=text|number|search], select, textarea, [contenteditable]`. Blur buttons after pointer activation. Space/Enter on a mouse-focused button are swallowed.
- Hold keys: `Backspace` hold 500 ms to reset, with a progress ring drawn in the HUD.
- `Esc` always shows the UI, and `F2`/`Tab` toggles. Keep v19's F2 so Tab remains keyboard-navigation friendly.

**Risks:** relearning. The overlay mitigates it.
**Optional/lightweight:** trivial.

---

### U11 — Feedback layer: toasts, "why nothing happens" diagnostics, input activity
**Impact 6 · Effort S**

**User-visible result:** messages appear as short toasts above the HUD, not buried in Input (B19). A small **diagnostic chip** explains stalls: "Budget full — recycling (Density ▲ or Reset)", "Camera locked — drag disabled", "Audio silent — check input", "No MIDI device — keyboard A–; plays", "Auto quality 0.7× (GPU busy)". MIDI activity LED plus a per-note flash in the HUD notes field. On first run with no input for 4 s, a centred hint appears on the canvas: "Play A S D F … or plug in MIDI · drop a song".

**Design**
- `setStatus` (`main.ts:133-135`) and `vs` → `toast(msg, {level, ttl})`. Keep `#status` as a log (last 20) inside ⚙.
- Diagnostics computed in the HUD tick (`main.ts:1087`) from `engine.stats()` plus flags (`lockQuality`, `cameraLockPose`, `pixelNow`, `segs.length/cap`, `audio.features.energy`, `midi` device list).

**Risks:** toast spam, so de-duplicate and rate-limit.
**Optional/lightweight:** yes.

---

### U12 — First-run "10-second" flow and an attract/demo loop
**Impact 8 · Effort S–M**

**User-visible result:** open the file and within 1 s a slow **demo phrase** (built-in generative MIDI: a few held chords plus bass hits) grows a showpiece scene in frame, with a hint "This is you playing — press A S D F or plug in MIDI · drop a song". The first real note or audio onset fades the demo out. An optional **attract mode** for installations restarts the demo after N minutes of silence. Energy default is 0.65, and the camera is Framed.

**Design**
- `src/midi/demo.ts`: a 16-bar seeded pattern pushed into `MusicClock` on channel 15 (`clock.push`, like `KeyboardPiano` at `inputMidi.ts:137`), so the whole pipeline is exercised with no special engine path. Stop on the first event with `channel !== 15` or audio energy > gate.
- Setting `settings.demo: 'first-run'|'attract'|'off'`, with default first-run only. Never plays while recording, unless the user explicitly starts recording during the demo.
- First-run key: bump to a settings schema version with a migration (`settings.schema = 20`) instead of per-release keys (B28).

**Risks:** demo notes could leak into recordings or casting. Guarded by the stop-on-record rule. Instrument sound-back must be muted for the demo channel (`main.ts:1037-1041` already skips `channel !== 0`).
**Optional/lightweight:** tiny. Off by setting.

---

### U13 — Live-safety mode ("Show lock")
**Impact 6 · Effort S**

**User-visible result:** a padlock in the Perform HUD, "Show lock", disables for the duration of a show:
- engine switching;
- file dialogs;
- one-key reset (hold only);
- panel clicks outside the HUD;
- browser Backspace-navigation and accidental Ctrl+W.

It also takes a Screen Wake Lock so the laptop does not sleep, auto-hides the cursor, and warns on low FPS.

**Design:** flag `settings.showLock`. The action registry marks `destructive` and `dialog` actions. `navigator.wakeLock.request('screen')` if available. `beforeunload` prompt while locked or recording.

**Risks:** the user forgetting it is on, so show a visible HUD badge.
**Optional/lightweight:** yes.

---

### U14 — Species "families" and learnable species sets
**Impact 6 · Effort S**

**User-visible result:** in the Species tab, big family buttons (Roots & fungi, Coral & reef, Neural & lightning, Crystal & mineral, Soft & liquid, All organic) with a "custom" grid below collapsed to 2 rows. The family is a learnable select, so a knob sweeps families. Scenes store families plus custom overrides.

**Design:** add `family` metadata to `SPECIES` (the `js` array; TS `organism.ts` species table) and a ParamDef `speciesSet` whose `set()` writes the `sp:*` toggles (like `simpleSpecies`, `simple-ui.js:12-15`, and `softOnly`, `performance-ui.js:1-11`). Make icon toggles learnable by giving them `wrap` plus contextmenu in `renderEngineControls` (`main.ts:344-352`) (B21).

**Risks:** family assignments are subjective, so the owner curates them.
**Optional/lightweight:** yes.

---

### U15 — Setlist / auto-scene (optional)
**Impact 5 · Effort M**

**User-visible result:** assign scenes to playlist tracks, or "change scene every N bars" with a morph. This supports unattended sets and installations.

**Design:** playlist entries (`main.ts:704-719`) carry `sceneId`. Bar counting uses `m.beat` (`main.ts:1054`). It replaces or extends `cycleEvery` (`organism.ts:445`).

**Risks:** clashes with manual performance, so pause it when the performer touches a scene.
**Optional/lightweight:** off by default.

---

### U16 — Label and copy pass, toggles as switches, units
**Impact 5 · Effort S**

**User-visible result:** short, consistent labels ("Branching", "Swell on bass", "Flash on hits"), with the long explanation in a tooltip. On/off controls become switches. Values show units ("1500 seg/s", "2.0 s", "On"). Docs are generated from the registry, so they match the UI.

**Design:** `short`, `help`, `fmt`, and `kind:'toggle'` in U1. A small `scripts/gen-docs.mjs` emits the control reference into README/START_HERE at release (`scripts/release.mjs` exists).

**Risks:** none.
**Optional/lightweight:** yes.

---

## 5. Recommended top 8 (priority order)

1. **Live-safety bug batch** (B1–B6, B15, B19, B27 via U10, plus the B3 focus fix). **Impact 8 · S.** It removes the ways a show can be ruined today: overlapping buttons, the capture-visible lock, the focus trap, R beside the piano keys, and one-key reset. It is also the cheapest item. Do it first, in TS.
2. **U1 Parameter registry.** **Impact 8 · L.** This is the enabler: one widget per param, factory defaults, tabs/tiers, events instead of pollers, and ids kept stable for presets and CC maps. Every later item depends on it.
3. **U3 Macros (Energy / Complexity / Motion / Chaos), Energy default ~0.65.** **Impact 9 · M.** This directly answers "I want it to be an obvious music visualiser". It replaces about 22 scattered reaction params with one knob, and it is safe for weak laptops because it is capped by the auto-quality tier.
4. **U2 Scenes: morphing scene bank with thumbnails, A/B crossfader, export.** **Impact 9 · M–L.** It turns the v19 looks into live instruments (no clear, morph, quantised to note or bar) and merges presets with looks.
5. **U6 Camera "Framed" default plus consolidation.** **Impact 8 · M.** It fixes "camera should frame the action" and "Silk grows out of frame", ends the silent locked-camera trap, and merges six camera UIs into one.
6. **U4 Perform HUD.** **Impact 8 · M.** It is the live layer: scenes, macros, crossfader, camera, hold-reset, record profile, and diagnostics in 64 px.
7. **U7 MIDI learn 2.0.** **Impact 8 · M.** It adds a learn overlay for everything, pads on a control channel for scenes and actions, soft takeover, a map list, and export.
8. **U5 Tabbed IA plus U9 command palette** (ship together). **Impact 8 · M.** The 22-section, 5,000 px panel becomes 7 tabs with essentials plus "+more", with the "More" dump and the duplicates removed. The palette finds any control or action by name.

Next in line: U12 (first-run demo; high first-impression value and cheap once U3 and U6 exist), U8 (reset, modified markers and undo), U11 (toasts and diagnostics), U14 (species families), U13 (Show lock), U16 (copy pass), U15 (setlist).

---

## Appendix A — Evidence log (live check, 1440x900, Chrome pane, v19 standalone)
- Simple mode on load: `body.simple-ui` true. `#cameraLock` at (1287,12) 140×39, z 1000, visible, text "Camera locked".
- With `hide-ui`: `#returnUi` at (1290,12) 137×34, z 5, and `document.elementFromPoint` there returns `cameraLock` (B1).
- Advanced: `#simpleHome` visible, 719 px tall (B11). 22 visible sections. Panel `scrollHeight` 5051. 105 ranges, 36 selects, 103 buttons, `__viz.ctls.size` 142.
- "More" section: 24 controls (list in 1.3).
- Search matches (section count): music 5, camera 8, speed 10, a 22, bloom 1, reset 2.
- After `.click()` on the "Coral" look, `document.activeElement` is the Coral button (B3 precondition). Values after the Coral look: `#musicAmount` 0.4, ctl 0.42, `#simpleGrowth` 0.4 (B8).
- Globals registered: zoom, zoomReact, growth, decay, symmetry, rotSpeed, beatZoom, beatPalette.
