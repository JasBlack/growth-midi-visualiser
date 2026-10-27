# CLAUDE.md — Growth (MIDI / music visualiser)

## What it is

Growth is a browser-based, live music visualiser for performance and recording. Notes (MIDI,
computer keyboard, or onsets detected in audio) grow organic 3D structures — roots, coral, neurons,
crystals, soft ribbons — that extend while a note is held, retract on release, fuse into larger
organisms, and visibly react to the music (ignition flares, light pulses along branches, breathing
reach, director camera cuts). It runs entirely client-side, works offline as a single HTML file, and
records clean MP4/WebM in the browser.

## Tech stack

- **TypeScript 5.8 + Vite 6** (`vite.config.ts`: `base: './'`, `three` aliased to `three/webgpu`).
- **three.js r185** — `WebGPURenderer` with automatic **WebGL2 fallback** (`forceWebGL` when
  `navigator.gpu` is missing), **TSL** node materials for all shaders, `RenderPipeline` + BloomNode.
- **three-mesh-bvh** — fast raycasts against loaded 3D models (shell/skin modes).
- **mp4-muxer / webm-muxer** + **WebCodecs** — recording (H.264+AAC MP4 or VP9+Opus WebM).
- **@mediapipe/tasks-vision** — optional webcam gestures (assets vendored by `yarn vendor`).
- **Vitest 3** — unit tests for pure logic (`src/**/*.test.ts`, Node environment).
- Web MIDI, Web Audio (AudioWorklet PCM tap), File System Access (optional streaming of recordings).
- Package manager: **Yarn 1** (`packageManager: yarn@1.22.22`). No backend, no database.

## Folder structure

```
index.html                    UI markup + CSS, inline (JAS.BLACK console look, docs/ui-ref/DESIGN.md): top bar,
                              easy steps (left), stage well, console column (right); tiers via data-tier
src/vite-env.d.ts
src/midi/
  main.ts                     app wiring: inputs, panel/widgets, ctls map, presets + morph, CC learn,
                              recording/stills, render loop, URL params, window.__viz debug handle
  engine.ts                   Engine interface every visual engine implements (controls, frame, …)
  engines/
    organism.ts               OrganismEngine — the main engine (~3.1k lines): species table, plants/
                              segments/tips, growth/retract/fusion, instanced meshes, render
    organism/                 feature modules plugged into OrganismEngine via feature.ts hooks:
      types.ts feature.ts       shared types; OrganismFeature hook interface
      pacing.ts uploads.ts      segment credits (newest note first); dirty-range GPU uploads
      camera.ts bounce.ts       CameraRig: modes 0–11 (9 Framed = default, 10 Director, 11 Flight); screen bounce
      ignition.ts conduction.ts note-on flares/rings/lunge/envelopes; light waves root→tip (GPU)
      breath.ts song.ts         music breath (reach expands/contracts with music); energy-arc scene response
      layout.ts                 pitch → space layouts, harmony-driven grafting
      reference.ts              picture / video / camera reference growth
      soft.ts                   13 soft deforming species + chrome ribbon/coil surfaces
      tips.ts                   tip markers (built-in shapes, PNG/OBJ upload)
      quality.ts                adaptive quality tiers
      haze.ts flight.ts debris.ts  "Webs" look: high-key haze world, flight content, debris particles
    reactionDiffusion.ts branching.ts cells.ts crystal3d.ts   other (simpler) engines
  shaders.ts materials.ts     TSL growth/env shaders, reactify() (swell/flash/emphasis/rim/breath/fog)
  music.ts beat.ts arcs.ts    MusicClock/MusicState, tempo tracking, energy arcs (build/drop/breakdown)
  inputMidi.ts inputAudio.ts  Web MIDI + keyboard piano; audio file/mic/tab input, onset detection, stems
  audioCtx.ts pcmTap.ts       one shared 48 kHz AudioContext, recording buses, AudioWorklet PCM tap
  recorder.ts recordUi.ts     WebCodecs recorder (CFR, fixed capture size), Output panel logic
  looks.ts simpleUi.ts macros.ts   authored looks, Simple-mode card, macro knobs
  ui/                         dom.ts (LED-key state, fader fill) knob.ts (LED-ring knob over a range input)
                              theme.ts (light/dark + baked dot grid) lookTiles.ts (look thumbnails) toast.ts
                              pianoKeys.ts (on-screen keyboard under the stage: touch/mouse, multi-finger, glissando)
  keys.ts panelSearch.ts storage.ts presets.ts synth.ts cast.ts vision.ts videoField.ts color.ts version.ts
src/vision/                   MediaPipe face/hand landmarker wrapper
public/                       copied to dist/ as is: og.jpg (1200×630 link-preview card), favicon-32.png,
                              apple-touch-icon.png; the SVG icon is inline in index.html (works offline)
scripts/
  release.mjs                 builds single-file HTML + README.txt + launchers + zip (Node zlib)
  vendor.mjs                  copies MediaPipe runtime/models into public/mediapipe (gitignored)
  launch.py                   local static server used by the shipped start scripts (port 8765)
  test-server.py              test helper: static server + POST /?name=… to save uploaded recordings
docs/
  FEATURES.md                 full user-facing feature guide and release notes
  v20-plan/                   analysis + plans that produced v0.20–v0.21 (MASTER_PLAN.md, specs, audits)
  v19-dist/                   readable sources/notes of v0.15.1–v0.19.0 (historic patched-bundle lineage)
  webs-ref/                   reference frames + plan for the Webs / flight look
```

## Commands

```sh
yarn              # install
yarn dev          # dev server, http://localhost:5180 (.claude/launch.json runs this)
yarn build        # tsc --noEmit + vite build + scripts/release.mjs
yarn test         # vitest run (~1 s, 121 tests)
yarn run check    # tsc + vitest  (note: bare `yarn check` is Yarn 1's own integrity command)
yarn vendor       # MediaPipe assets → public/mediapipe (only needed for webcam gestures)
yarn preview      # serve the built dist/
```

`yarn build` outputs `dist/` (folder build), `dist/growth-visualiser-v<version>.html` (single file)
and `growth-visualiser-v<version>.zip` in the project root (gitignored).

## Deployment

No server-side component. Hosted at https://growth.jas.black via GitHub Pages:
`.github/workflows/pages.yml` builds `dist/` on every push to `main` (Pages source = GitHub Actions,
custom domain set in repo Settings → Pages; DNS is a `growth` CNAME → `jasblack.github.io`).
Also distributed as the release zip / single HTML file that users open locally
(double-click, or the bundled `start-mac.command` / `start-windows.cmd`, which run `launch.py` on
`http://localhost:8765/`). Any static host works (built with relative `base: './'`); it must be HTTPS
or localhost because MIDI, microphone, camera and screen capture need a secure context. For live
shows it is captured into OBS as a Browser Source (`?ui=0` hides the panel; "copy capture URL" in the
panel). Casting over WHIP to a user-supplied mediamtx URL is optional.

## Environment variables / secrets

None. The app reads no env vars and has no API keys. `.env.example` exists only to document that.
User-entered values (e.g. a WHIP cast URL) are typed into the panel at runtime and kept in
`localStorage`.

## Current status (v0.22.1, 2026-10-21)

**Works (verified in Chrome on Windows):** Organism engine with all looks (Roots, Coral, Neural,
Crystal, Liquid, Silk, Webs, Webs night); Simple/Advanced panel, settings search, macros, presets,
MIDI CC learn; MIDI + keyboard + audio file/mic/tab input; note ignition, conduction pulses, music
breath, Director and Flight cameras; picture/video reference growth; soft species, materials, tip
shapes; recording — ffprobe-verified H.264 High 1920×1080, moov-first, exact CFR 30 fps, AAC 48 kHz;
stills; adaptive quality; WebGL2 fallback spot-checked; 121 unit tests pass.

**Known issues:**
- Small dark notches where tube segments join — very visible up close in Flight. Planned fix:
  seamless mitered tubes (docs/v20-plan/k1-visual-music.md, Idea 11).
- Webs look is sparser than its reference, and big ribbons pass the lens less often.
- Music breath can draw large structures back to their core in quiet passages (tune the `breath`
  control or `BREATH_ARC` in shaders.ts).
- 1440p60 recording exceeds some machines' encoders (frames dropped; reported in the status line).

**Not verified:** macOS (Quick Look playback of recordings, start-mac.command, audio sync with the
Mac AAC encoder), real MIDI hardware (sustain pedal, DAW clock, hot-unplug), WHIP casting and webcam
gestures since v0.15, Safari/Firefox beyond the WebGL2 spot checks.

**Unfinished / next:** seamless tubes; Stage 3 of docs/v20-plan/MASTER_PLAN.md (GPU-compact segments,
shader-side motion, scene bank + crossfader, perform HUD). `organism.ts` is still large; new work
should go into `organism/` feature modules.

## Decisions, gotchas, context

- **Owner's aesthetic rules:** organic growth, never kaleidoscopic/mirror-symmetric/uniform; black
  space is the default (the Webs look is the bright exception); every feature optional via controls;
  must stay light enough for a weak laptop; growth must always follow the music (nothing grows in
  silence; released notes retract unless lignified). When given a visual reference, apply its
  behaviour to the existing looks rather than building a separate world.
- **Indices are append-only:** species (`sp:<i>`), camera modes (`camMode` 0–11), growth shaders,
  palettes and env shaders are stored by index in presets/settings — never reorder; append new ones.
- **Persistence:** `localStorage` keys `midiviz_settings_v3` and `midiviz_presets_v1`; writes go
  through `storage.ts` (never throws). Looks reset a base set of controls (`LOOK_BASE` in looks.ts).
- **Versioning:** bump `src/midi/version.ts` AND `package.json` by hand per release; tag `vX.Y.Z`.
- **GPU uploads:** instance data is uploaded via coalesced dirty ranges (`organism/uploads.ts`).
  Never call `clearUpdateRanges()` on ranges three hasn't uploaded yet — that bug made branches
  render black. `StorageInstancedBufferAttribute` is used only on WebGPU (uniform path caps at 64 KB).
- **Recording:** must stay WebCodecs + muxer (frame n stamped n/fps, fixed capture size, AudioWorklet
  PCM). An earlier MediaRecorder version produced fragmented, variable-frame-rate files that Quick
  Look/VLC/Resolve rejected (evidence in docs/v20-plan/evidence-recording.md).
- **Bloom / stills:** `RenderPipeline` renders the scene pass once per animation frame unless forced;
  stills therefore render explicitly (see `ensureBloom` in organism.ts).
- **Testing in an automated/hidden browser:** a hidden tab pauses `requestAnimationFrame`. Drive
  frames by hand via the debug handle: `__viz.clock.tick(null,0); __viz.renderer?._nodes?.nodeFrame?.update?.();
  __viz.engine.frame(__viz.clock.state, __viz.g)`; play notes with `KeyboardEvent` keydown/keyup on
  `window` (keys a…k, `shiftKey: true`). Recording needs a visible tab (real rAF).
- **Single-file HTML must work offline:** no CDNs or runtime fetches (the AudioWorklet is inlined
  via a Blob URL). MediaPipe gestures only work in the folder build after `yarn vendor`.
- **Dev environment so far:** Windows 11, Git Bash; expect CRLF warnings from git.
- **History:** v0.15.1–v0.19.0 were made outside this repo by patching the minified bundle; v0.20.0
  ported all of it back into TypeScript. Commit messages and docs/v20-plan record why each change was
  made.
