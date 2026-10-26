# Growth v0.19.0 — consolidation and good first-run output

This release is a compiled patch over v0.18.0. It does not remove the existing
advanced system. The previous handoff is preserved as `NOTES_V0180.md`.

## Product decisions

- **Simple mode is now the default.** It exposes only a coherent starting look,
  growth/detail/music-response controls, calm camera choices and source tracing.
- **Advanced mode retains the complete application.** The top `Advanced` button
  reveals every specialist, material, physics, camera, preset and output control.
- The first run applies a restrained Roots look. This is stored under
  `growth-good-start-v0190`, so an established user's later settings are not
  repeatedly overwritten.
- The ten experimental soft species from v0.18.0 remain available in Advanced,
  but are deliberately excluded from the curated first-run looks.

## Stable cameras

`calmCamera` defaults to 1. While enabled, camera distance, orbit angle and
elevation do not react to audio; camera kick and shake are suppressed; fog is
reduced to 0.002 so completed structures stay visible.

Simple mode offers:

- **Still** — stationary, camera locked across Reset.
- **Gentle orbit** — slow constant orbit with no beat zoom or audio jump.
- **Manual** — no automatic motion; middle-drag orbits, Shift+middle-drag pans.

All nine legacy camera modes remain in Advanced. The persistent top camera-lock
button continues to decide whether Reset preserves the exact view.

## Coherent looks and presets

The old random mix independently randomized almost every control, enabled two to
six species and could turn on reactive camera zoom. That produced different
numbers but very similar visual clutter.

Simple mode replaces it with six authored looks: Roots, Coral, Neural, Crystal,
Liquid and Silk. `Surprise me` does not repeat the immediately previous look and
only varies branch, wiggle, length and thickness by about 12%, preserving each
look's visual identity and performance budget. The eight saved slots still work
in Advanced and are now labelled `Saved slots` rather than suggesting authored
presets.

## Music response

- MIDI note-on/note-off remains direct and is the most rhythmically exact input.
- Audio still uses spectral flux/onset detection rather than attempting full
  polyphonic transcription.
- The Simple `Audio sensitivity` control now affects the onset threshold, minimum
  onset interval and minimum energy gate. It is not just a cosmetic control.
- Curated looks use restrained density (`musicGrowth` about 0.42,
  `musicSustain` about 0.20 and `fillRate` 240) with camera audio response off.
  Reference auto-fill is off, so new geometry corresponds to music/MIDI events.

## Picture, video and 3D-source drawing

Simple mode separates three intentions:

- **Trace silhouette** uses reference mode 3: edge attraction plus depth relief,
  distributed surface seeding, strong edge weight and low branching. This is the
  default when enabling a picture/video/camera reference.
- **Sculpt relief** uses brightness as a 2.5D depth field and allows more
  interior coverage.
- **Skin 3D model** uses actual mesh ray projection and surface normals, low
  branching and mesh attachment. GLB is recommended; GLTF, OBJ and STL are also
  accepted. An explicit model picker is present in Simple mode.

`Source visible` only toggles the guide; it does not stop tracing. `Fit source`
frames it. Picture and ordinary video are not reconstructed into a hidden 360°
mesh: they produce an animated brightness/edge relief. A loaded 3D model is the
route for genuine all-angle geometry.

## Files and reproduction

- Built app: `assets/index-BWYXfAkm.js`
- Standalone app: `growth-visualiser-v0.19.0.html`
- Consolidation builder: `maintenance/patch_consolidation.py`
- Simple UI source: `maintenance/simple-ui.js`
- Calm-camera source: `maintenance/calm-camera.js`
- Regression test: `maintenance/test-consolidation.cjs`

Rebuild with:

```bash
python maintenance/patch_consolidation.py ../growth-v0180 .
```

## Verification and limits

Ten Node regression suites pass: motion, stage tips, recording, reference,
music focus, dynamic materials, input, audio, seeding and consolidation. The
compiled JavaScript passes `node --check`, and the standalone validator passes.

A browser executable was unavailable in the build environment, so this release
has not had an automated live WebGPU/WebGL render or device MIDI/camera capture
test here. Before release, manually check Chrome with one audio track, one MIDI
controller, one face video and one GLB on the target Mac/Windows machines.

## Suggested acceptance pass

1. Open the standalone file: Simple mode should show Roots and a still camera.
2. Play MIDI: geometry should start on note-on and stop/retract on note-off.
3. Play audio: adjust sensitivity until attacks produce discrete new strands.
4. Load a face video, choose Trace silhouette, hide the source and orbit it.
5. Load a GLB, choose Skin 3D model and inspect the result from several angles.
6. Lock the camera, Reset and confirm the view is unchanged.
7. Run Surprise several times and confirm the six looks remain visibly distinct.

