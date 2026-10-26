# Growth — MIDI / music visualiser

A black 3D space where every note grows an organism. Hold a key: a growth
appears and expands like roots, coral, lightning, crystal, moss… Release: it
retracts. Hold longer and it stays; tips that touch fuse. Play chords and the
growths bind into one structure. Feed it MIDI, an audio file or a microphone.

Vite + TypeScript + three (WebGPU, WebGL2 fallback). No backend.

## Since v0.22.0 — Flight on any look, music breath

- **Flight with every look:** pick the **Flight** camera (Simple mode's camera
  menu, or camera 11) with Roots, Coral, Neural, Crystal, Liquid or Silk and
  the look stays itself — black space, its species and materials — while the
  camera flies on through it: each note grows ahead of you, in view, a held
  note keeps reaching ahead, a release retracts like anywhere else, and what
  the camera has passed is retired, so it never ends. Nothing grows in
  silence. Choosing a look while flying keeps flying.
- **Music breath** (Notes section, *music breath*, 0–1, default 0.55; the
  Reaction macro scales it): every strand and shape reaches out with the music
  and draws back toward its roots when it goes quiet — fast in on a note, slow
  out over about half a second. The notes you are holding stay out; grafted
  growth draws back with the branch it stands on; soft surfaces swell and
  shrink with it; tip markers go with their ends. It runs in the growth shader,
  in every look and camera mode.

## New in v0.22.0 — Webs

A new look modelled on a "piano webs" reference: the camera flies forward through
an endless tangle of fine wires, chrome ribbons and tumbling debris in a bright,
hazy world with light at the end of the tunnel. Notes grow strands and ribbons
ahead of you; the flight speeds up with the music. Click **Webs** or **Webs
(night)** in Simple mode, or pick the **Flight** camera with any look. Details
in "The Webs look" below. Also: stills taken with bloom on are now always the
current frame (a 2x still used to be an upscaled 1x).

## New in v0.21.0 — an obvious music visualiser

- **Notes ignite**: every note flares at its root with a shock ring, the
  first segments lunge out, and growth follows a per-note envelope (strike,
  pluck, swell, pad). Tips glint on release.
- **Conduction**: each note sends a wave of light root to tip through its own
  branches, in its own colour; chords make separate waves, held notes
  shimmer. Old growth cools to bark and a passing pulse relights it.
- **Director camera** (camera 10): shots cut on the bar; a build pushes in, a
  drop hard-cuts to wide, a breakdown drifts close. The song's energy arc
  also drives bursts, glow and bloom (Song response).
- **Macros**: Reaction, Energy, Complexity, Motion, Chaos — one knob moves
  many settings around the current look, MIDI-learnable, saved in presets.
- **Light**: ACES tone mapping, a rim light in each plant's colour, HDR tips
  and bloom on by default; adaptive quality steps down bloom, then
  resolution, on slow machines (never during a recording); optional 60/30
  fps cap.
- **Pitch and harmony in space**: layouts (strata: bass roots low, melody
  high; helix; circle of fifths), consonant notes graft together, chords
  root as one cluster, soft and strong notes look different.
- Fixes: chord notes that grafted onto a neighbour grew nothing; instance
  updates could be lost before upload (branches rendered black); a macro
  base bug on fresh settings. 91 unit tests (`yarn test`).

## New in v0.20.0

v0.15.1–v0.19.0 were built outside this repo by patching the compiled bundle.
v0.20.0 brings all of it back into the TypeScript source (details and the
analysis behind it: `docs/v20-plan/`), and fixes what those releases broke:

- **Recording** is WebCodecs again: H.264 + AAC MP4 with the index at the front
  (or VP9 + Opus WebM), a fixed 1080p / 1440p / 4K frame, constant frame rate
  and audio that cannot be dropped. Opens in Quick Look, QuickTime, VLC and
  Resolve. Input-only or full-mix audio, 30 / 60 fps, save-while-recording.
- **Growth no longer stalls**: a few held notes used to freeze at a third of
  the budget; tips now wait for room instead of dying.
- **Much lighter per frame**: only changed instances are uploaded to the GPU.
- **Simple mode** (default): six looks, Surprise me, growth / detail /
  sensitivity sliders, camera and source choices. Advanced shows everything.
- **Framed camera** (default) keeps the growth in view and clear of the panel;
  lock, calm, tip glide, cinematic tour, wide pulse, screen bounce, Shift+middle
  pan.
- **Music response**: new growth is highlighted as it appears, an audio
  sensitivity setting, sharper onsets, MIDI sustain pedal / all-notes-off /
  every channel / clock fixes.
- **Picture, video and camera tracing** (face-on, double-sided, no lost tips),
  **13 soft species**, **10 animated materials**, **custom tip shapes**
  (PNG / OBJ), settings search, F2 or ` to hide the UI.

## Run

```sh
yarn            # install
yarn vendor     # MediaPipe runtime + face/hand models into public/ (only for webcam gestures)
yarn dev        # http://localhost:5180
yarn build      # dist/ + dist/growth-visualiser-vX.html (single file) + growth-visualiser-vX.zip
```

Chrome, Edge or Brave (2023+) on macOS or Windows use WebGPU. Safari 26+ and
current Firefox fall back to WebGL2 (slower). Safari has no Web MIDI: use an
audio file, the microphone or the computer keyboard there.

## What is in the panel

The panel is a stack of collapsible sections, remembered between sessions:
A pinned bar at the top keeps reset, performance mode, hide UI, the record
controls and the **camera style** button (`C`; each click is the next style)
reachable however far you scroll. Below it:
**Input** (where the music comes from) · **Pattern** (which visual) · the
pattern's own settings, grouped — *Growth, Species, React, Model & shell (the
model loader sits with the shell settings it drives), Video, Camera, Look,
Life, Stems, Performance* · **Shared** (zoom, palette, decay) · **Presets** (eight slots plus 🎲 random mix) · **Play**
(instrument, gestures, MIDI map) · **Output** (record, still, cast) · **Keys**.


- **Input:** Web MIDI (hot-plug), computer keyboard as a piano (`A`…`K` white,
  `W`…`U` black, `Z`/`X` octave, Shift = full velocity), audio files (drop one
  or many on the page for a playlist that auto-advances; shift-drop appends),
  a playlist you can click through, mic / line in with a device picker (a loopback device such as BlackHole on
  macOS or VB-Cable on Windows feeds any desktop app in), or **tab / system
  audio**: Chrome captures another tab, so the Spotify web player or YouTube
  drive the visuals with no extra software (Windows can also share system
  audio with the whole screen). Audio is analysed for energy, bands, chroma and
  onsets; onsets become pseudo notes. **Stems** (audio mode) splits drums /
  bass / voice / other with their own detectors.
- **React** — what makes it an obvious music visualiser. A master
  *intensity*, then: *swell* (every growth thickens on the bass and on hits —
  a vertex push along the normal in the shader, so it costs nothing), *music
  breath* (in Notes: branches reach out with the music and draw back toward
  their roots in the quiet, also in the shader), *flash*
  (every surface lights up its own colour on hits), *kick* (the camera punches
  in), *shake* (the camera trembles with the bass) and *growth speed follows
  the energy*. Hits come from audio onsets, beats while music is playing, and
  every note you play.
- **Model moves to the music:** *breathe* swells the whole model; *ripple*,
  *boil*, *spikes* and *explode* displace its vertices along smooth normals,
  driven by bass, energy, mids, treble or hits, with an amount slider. Growth
  in skin / nerves mode rides the moving surface, and containment follows it
  (the BVH is refitted each frame). Models up to 150k vertices morph; bigger
  ones still breathe.
- **Growth patterns:** Organism (default) plus reaction–diffusion, branching,
  cells and crystal. Species, skins, shell, camera modes, seasons, physics,
  nesting, typography, wild and stems are Organism features.
- **Organism:** 24 species as icon toggles (bacteria, roots, fungi, lightning,
  rocks, crystals, spirals, corals, staghorn coral, sea fan, tree, slime mould,
  moss, anemone, vines, fern, antlers, neuron, snowflake, veins, kelp,
  stalactites, stalagmites, brambles) picked by note / octave / random /
  cycle; cohesion (spawn near, graft onto, pull together); organism size;
  *bounds* (a soft sphere of the organism size, or none at all); shell boundary
  (sphere, cube, torus, cylinder, cone, capsule, octahedron, knot, or any
  number of loaded GLB / OBJ / STL models — each one you load joins the list;
  looks: invisible, faint / plain / glowing wireframe, glass, solid,
  silhouette, points; a *shell cycle* swaps shape and size every N seconds,
  optionally waiting for the next bar); *contain* mode bounces growth inside, *skin* mode grows
  it over the surface so the object is slowly built as the song develops,
  with coverage % in the HUD; *nerves* mode grows neurons and veins just under
  the skin with signals pulsing outward along them; a rigged GLB plays its
  animation (free-running or beat-synced) and every growth rides the surface
  vertex it grew from); camera (orbit, weave through, tunnel, drift inside,
  sit inside, chase the newest growth) with a *camera follows new growth*
  amount that keeps the focus where segments are appearing, and growth that
  can spawn along the camera path; wild (mutants, style shifts,
  bursts, sway, pulse); beat lock; light reaction; bloom; environment
  (floor / cave / shadows); physics (droop, wind); seasons; nested organisms;
  typography (chord names or typed words as letterforms); a timed *cycle*
  that every N seconds resets, reverses (everything retracts, then regrows) or
  sheds the oldest half; auto quality;
  *segment budget* — the instance buffers start at 20k and double on demand up
  to this slider (250k max), geometry detail dropping as they grow, so the
  scene is limited only by what you set and what the GPU can draw; *new
  segments per second* and *growths building at once* pace how fast it fills;
  *recycle* —
  near that limit the oldest growths retire (dimmed, visibly unwinding), as
  many at once as it takes to free segments as fast as they are created, so
  new growth never stops;
  *growth shader* (20 procedural TSL surface materials — stripes, marble,
  cells, lava, iridescent, hologram, toon, chrome, neon, x-ray, fire… all
  music-reactive) and *environment shader* (starfield, nebula, gradient,
  grid horizon, aurora, deep sea sky spheres). Both run on WebGPU and the
  WebGL2 fallback; add your own in `src/midi/shaders.ts`.
- **Performing:** 8 preset slots with a 2 s morph (click / shift+click /
  `Shift+1…8` / MIDI program change), MIDI CC learn (right-click a slider,
  move a knob), tempo from onsets or MIDI clock with beat-sync options,
  `R` record (start now, after a 3 s countdown, or on the next note). Frames
  are encoded with WebCodecs the moment they are drawn and written into a
  proper container: MP4 (H.264 High + AAC, index at the front, even
  dimensions, constant 30 fps) opens in Finder Quick Look, QuickTime, VLC,
  Premiere and Resolve; WebM (VP9 + Opus) has cues and a duration. A take
  carries everything you hear — the input, the instrument you play and the
  sound-back. Browsers without WebCodecs fall back to MediaRecorder. `Q`
  still (`Shift+Q` 2×), cast over WHIP to a mediamtx path, a built-in
  polyphonic instrument (pluck, pad, bass, bell, organ, strings, lead, keys)
  that plays your MIDI / keyboard notes, middle-drag orbit / right-drag pan /
  wheel zoom,
  sound-back plucks, webcam gestures (head parallax, pinch rotate, open palm
  repel).
- **Keys:** `1`–`5` pattern · `Enter` performance mode · `F2` hide UI ·
  `Esc` show UI · `Tab` next control · `Backspace` reset · `[` `]` palette ·
  `Space` play/pause · `R` record · `Q` still · `C` camera · arrows zoom /
  mirror folds. Shortcuts and the keyboard piano work whenever you are not
  typing in a text field (a focused slider keeps its arrow keys). **Find a
  setting** at the top of the panel filters it down to matching controls.

## The Webs look

**Webs** (Simple mode, also in Surprise me) flies through an endless tangle
instead of watching a sculpture in black space: a pale haze with light at the
end of the tunnel and fine speed lines, hundreds of glossy wire threads (ink,
pewter, a little dusty pink and steel blue), chrome ribbons in navy, white and
pink that sweep past on accented notes, and drifting flakes and ash. Notes
grow ahead of the camera (pitch sets where round the tunnel); the flight speeds
up with the energy, tempo and hits. **Webs (night)** is the same flight in a
near-black haze, the threads silver in the palette's colours.

The web comes from the music: the ambient threads appear only while something
sounds (more with more energy), and in silence everything — threads, ribbons,
the strands your notes grew — draws back and retracts, so a pause empties the
tunnel and the next phrase fills it again. Like every look it breathes with
the music (*music breath*).

Its parts are ordinary settings, so they mix with any look: the *haze* sky
(environment shader, colour / glow / speed lines / atmosphere / reflections,
with mist, dusk and ink presets), the *flight* camera (also in Simple mode's
camera menu: wander, bank, music response; the *ambient web* and *ribbons*
are off unless a look turns them on), the *threads* and *chrome* species and
*debris*. The flight alone keeps a look's own world: the haze, ambient web,
ribbons and debris only come with Webs (or when you switch them on). The
ambient web and the debris are the first things adaptive quality thins out on
a slow machine.

## Video or a picture as a guide

A camera, a video file (mp4, mov, webm) or a still picture can steer the
growth. Load one from the Input section or drop it on the page, then open the
**Video** section:

- **depth** turns the picture into a height field and growth rides its relief,
  so a lit subject on a darker background gets growth crawling over its form.
- **lines** runs a Sobel pass and growth follows the edges — the line-art idea:
  tips travel along a contour and are drawn toward stronger ones.
- **depth + lines** does both, and new growth starts on the subject rather than
  in empty space.
- **mimic** is for a picture: growth starts on its lines, follows them, and the
  linework stands proud of the relief so the drawing reads in 3D from any
  angle. The HUD shows how much of the picture has been drawn. Play, and the
  image emerges over time.

Sliders set the picture's size, how deep the relief is, how hard growth clings
to the lines and to the surface, and whether the picture itself shows behind.

Honest about the depth: real monocular depth estimation needs a ~50 MB network.
This uses blurred luminance as the height field, which reads as relief for a lit
subject but is a look, not a measurement — a white wall behind a dark coat will
read "closer" than the coat. The line following is genuine edge detection and
works on any footage. Everything runs on a 192 px working copy of the frame at
about 30 Hz, so it costs well under a millisecond.

## Syphon / Spout / NDI out

Browsers cannot publish Syphon or Spout textures, so capture the page:

1. OBS → add a **Browser Source** with the capture URL from the panel
   (`copy capture URL`; it looks like `…/?ui=0&preset=1&cam=0`), sized to
   your output. OBS's Chromium has no WebGPU, so the page runs on its WebGL2
   fallback there.
2. Send it on: Windows **obs-spout2** plugin → Spout; macOS an OBS Syphon
   output plugin, or **DistroAV** (NDI) → the NDI Syphon app. Resolume,
   TouchDesigner and MadMapper accept NDI directly.
3. Anything that speaks WebRTC can instead pull the **cast** (WHIP → mediamtx → WHEP).

URL parameters: `ui=0` bare page, `preset=N` load slot N, `engine=organism|rd|branch|cells|crystal`,
`cam=0…4` Organism camera mode, `mode=file|mic` input.

Settings persist in `localStorage` (`midiviz_settings_v3`, presets in
`midiviz_presets_v1`). Version lives in `src/midi/version.ts`.

## Layout

```
index.html              page + panel markup
src/midi/main.ts        wiring: inputs, panel, presets, CC learn, record, cast, gestures, loop
src/midi/music.ts       shared MusicState + beat tracker
src/midi/input*.ts      Web MIDI / keyboard piano / audio analysis (+ stems)
src/midi/engines/       organism.ts (species table, growth model), reactionDiffusion, branching, cells, crystal3d
src/midi/*.ts           beat, presets, recorder, cast (WHIP), synth (sound-back), vision (gestures)
src/vision/             MediaPipe face / hand landmarker wrapper
scripts/                vendor.mjs (MediaPipe assets), release.mjs (single file + zip), launch.py (local server for the folder version)
```
