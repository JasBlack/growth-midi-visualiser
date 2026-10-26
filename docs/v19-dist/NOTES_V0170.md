# Growth v0.17.0 — recording, cameras and soft growth

This update starts from the verified v0.16.0 distribution in this conversation. It retains the image/video/camera reference feature and v0.15.1 input fixes. The attachment still has no TypeScript/Vite source, so this is a compiled-distribution patch. Port the readable modules into the source project before the next normal build. Earlier handoffs are preserved in `NOTES_V0160.md` and `NOTES_V0151.md`.

## User-facing changes

- **Shift + middle-drag pans**, middle-drag orbits, right-drag still pans. Panning uses the camera's screen-up direction and actual shot distance. Lost pointer capture ends the drag.
- **Output → audio** offers Input only or Full mix. Input only excludes generated sounds when recording audio files, microphones or tab/system audio. MIDI uses the existing instrument mix because MIDI itself is note data, not an audio waveform.
- **Output → resolution** offers 1080 px tall, 1440 px tall, or current canvas. The 3D renderer draws at the requested pixel density before capture; the canvas is not merely enlarged afterward. Capture is bounded to 3,840 pixels wide and 4× pixel ratio. Status reports actual dimensions.
- **Output → frame rate** offers 60 or 30 fps targets. **Quality** offers 24 Mbps, 40 Mbps or 12 Mbps video; audio requests 256 kbps. These are encoder targets, not guarantees of GPU speed or achieved bitrate.
- **Tip glide** smoothly follows the latest active tip. **Cinematic tour** moves between active plants. **Wide pulse** frames the scene with gentle bass-linked distance changes. C cycles all nine camera modes. Camera controls include shot distance, tracking response and speed. Orbit/pan/zoom offsets remain usable in the new modes.
- **Liquid**, **Silk ribbon**, and **Wave blanket** are additional species. Use Flow & camera → Use soft species for an immediate selection, then play notes (or enable reference Build shape). Existing species remain selectable. The new species start disabled in the default mix, preserving existing looks.
- **Soft motion** controls wave amplitude, audio response and flow speed. Bass and treble drive smoothed deformation. Growth/retraction controls how large each surface becomes.

## Recording changes and rationale

The previous WebCodecs path could intentionally discard audio if its channel count or sample rate differed from an assumed stereo configuration, and could silently continue without an audio encoder. The shared recording bus also included generated audio, which differs from the selected input.

`maintenance/recorder-native.js` replaces compiled recorder class `rZ` with a MediaRecorder implementation. The browser timestamps audio and video on its capture path; this code no longer reads, drops or independently timestamps raw PCM packets. MP4 is selected when native recording supports it; otherwise the file is honestly saved as `.webm` with a visible fallback message. A WebCodecs-only MP4 option may still appear in the old format picker, but its native fallback is explicit. There is no promise of MP4 on every browser.

`O5.recordStream()` now creates one cached MediaStreamAudioDestinationNode connected directly to the audio analyser. This input-only tap bypasses the generated instrument/effect mix without changing speaker routing. Full mix retains `Gw()`. The recorder clones audio tracks and owns only those clones and its canvas video tracks. Stopping or failing a recording stops its own tracks, not the user's live input. The input analyser is a pass-through for recording; recorded audio is encoded with the browser's selected lossy audio codec, not a bit-perfect PCM copy.

`maintenance/recording-ui.js` replaces `Vw`/`x5`. It resumes the audio context, selects the requested bus, sets and locks capture pixel density, starts recording, and restores renderer quality on stop/error. It shows the stop state only after capture succeeds. Format/audio/resolution/fps/quality controls are disabled during a take. Pattern switching is blocked during recording startup or an active take so the recorded canvas cannot disappear. Countdown recording is cancellable and repeated clicks cannot start overlapping takes.

The 1080/1440 render-resolution control applies to renderer-backed 3D patterns. Canvas2D patterns retain their own canvas resolution, which is reported when capture starts. Resizing the browser during recording is not locked; for a stable output size, leave the performance window dimensions unchanged during the take.

## Camera integration

Readable module: `maintenance/cinematic-camera.js`.

Append camera options at indices 6–8 so the original six indices retain their meanings. Run `updateCinematic(state, globals)` before applying the final camera transform, and skip the old sit-inside branch for the new indices. Camera target and position interpolate with a delta-time-based response; tour targets change every few seconds. Wide framing samples at most roughly 512 segment endpoints plus the reference bounds. Fog is reduced using the orbit-style distance rule in the new modes. New cinematic modes do not automatically create roots around the moving camera.

Shift-middle panning is a small edit to the existing pointermove handler. The pan modifier is read during the drag. Keep existing pointer capture and add `lostpointercapture` cleanup.

## Soft-growth integration

Readable module: `maintenance/soft-growth.js`.

Append three species to `js`; never reorder existing species. The species controls are built from that array, with new soft entries defaulting to off. Their original branching skeleton remains responsible for note lifetime, growth amount, retraction, fusion and the segment budget. A per-plant mesh supplies the visible soft surface:

- Liquid: smooth subdivided surface with low-frequency radial deformation.
- Silk ribbon: a twisted, curving strip along a flowing path.
- Wave blanket: a subdivided sheet with layered travelling waves.

These are procedural deforming surfaces, **not a fluid dynamics or cloth-collision simulation**. They do not model viscosity, liquid merging, self-collision or cloth draping over arbitrary meshes. Fusion still belongs to the underlying growth skeleton. Existing shell geometry is not used as a cloth collision surface.

The meshes use the plant's colour and generated smooth normals. They update at up to 30 Hz with smoothed audio bands. Up to 64 soft surface meshes are retained; additional soft plants use their ordinary skeleton rather than disappearing. Meshes/materials are disposed when plants disappear, on reset and on engine unmount. Soft surfaces use dedicated materials, so the existing segment surface-shader selector does not re-skin them. Their extents are artistic deformations around plant roots; old cameras that inspect skeleton geometry may not frame all fabric edges as precisely as the new wide mode.

With active reference guidance, live soft surfaces can sample the reference relief. They remain artistic shapes rather than exact image reconstructions. Existing reference behaviour and its limitations are documented in `NOTES_V0160.md`.

## Files and reproduction

- Runnable entrypoints: `index.html`, `growth-visualiser-v0.17.0.html`, `assets/index-BWYXfAkm.js`.
- Readable implementation: `recorder-native.js`, `recording-ui.js`, `cinematic-camera.js`, `soft-growth.js`, `performance-ui.js` in `maintenance/`.
- `maintenance/patch_performance.py` verifies the exact v0.16.0 bundle hash and writes into a separate output directory. Older patch scripts are historical; do not run them over v0.17.0.
- `maintenance/test-recording.cjs` and `test-motion.cjs` are new regression checks. The earlier audio, input and reference tests remain included.

```sh
python maintenance/patch_performance.py /path/to/unmodified-v0160 /path/to/output
node --check assets/index-BWYXfAkm.js
node maintenance/test-recording.cjs
node maintenance/test-motion.cjs
node maintenance/test-audio.cjs
node maintenance/test-input.cjs
node maintenance/test-reference.cjs
python maintenance/validate.py /path/to/original-growth-visualiser-v0.15.0.zip
```

## What was verified

Automated checks passed for audio-track inclusion, clone ownership/cleanup, native codec fallback, requested bitrate/frame rate, recording error handling, cached input-only routing, Shift-middle pan versus orbit, finite deforming soft geometry, retraction, disposal, smooth camera coordinates, previous audio/input/reference regressions, syntax, HTML IDs, standalone parity, preserved MediaPipe assets, local serving and ZIP extraction.

**A live browser test was attempted but the remote browser could not connect to the local app. No live rendering, physical MIDI/microphone, listening comparison, recorded-file A/V synchronisation or achieved frame-rate/quality check was completed.** Mocked tests verify code paths, not subjective capture quality or browser encoder support. Test on the user's performance machine before treating this as a production release.

Suggested source-project QA: record the same known audio file in Input only and Full mix, listen/compare; test mono microphone and tab input; inspect 1080/1440 output metadata and motion at 30/60 targets; stop/start multiple takes; cancel countdown; run all three soft species while holding/releasing chords; pan with Shift-middle in each new camera mode; verify reset and species switching release GPU resources.
