# Growth v0.16.0 — real-time 3D reference growth

Built on the v0.15.1 distribution from this conversation. Its audio/input fixes are retained; see `NOTES_V0151.md` for that earlier handoff. This is still a compiled-release patch: no TypeScript source or Vite project was supplied. Port these changes into the real source before the next normal build.

## What the user requested

Growth should progressively form an uploaded image, video or live camera feed in three-dimensional space, with visible/hidden reference and larger/smaller controls. The existing feature was difficult to see working.

## How to use this version

1. Choose a picture, video file or camera in Input. A successful load selects Organism and enables 3D shape guidance, automatic filling and live following.
2. The **3D reference** controls sit directly below the source buttons. **Build shape** fills without music; switch it off for note-driven growth. It stops automatic growth while retaining completed branches.
3. **Follow live** lets existing reference-bound branches change depth with video/camera frames. Off freezes their depth; new notes can still produce growth from the current frame.
4. **Show reference** independently toggles the source plane without stopping the feed, guidance or automatic filling. The advanced video opacity control is still available.
5. **Size** changes the image and reference-bound growth together. **Depth** controls the relief depth. **Invert depth** exchanges near/far brightness mapping. **Fit view** recentres the orbit view after enlarging the shape. Middle-drag orbits it.
6. **Reset** clears growth and coverage so the source starts filling again. Stop video stops the source and automatic seeding; existing growth remains.

## Important limits

This produces a real XYZ **relief from luminance**, with smoothed image edges steering branches. It is not AI depth estimation, face landmark reconstruction, photogrammetry or a watertight 360-degree model. Bright regions project forward (or backward with Invert depth). A flat-colour image produces a mostly flat surface. No hidden surfaces are inferred.

Live following uses stable image UV coordinates: existing geometry changes depth at its anchored pixels. It does not track a moving face's identity or perform optical flow. As a subject moves across the frame, the relief changes and fresh seeds fill new edges.

Image analysis is bounded to 192 pixels on its longest axis at up to 30 Hz. Up to 4,000 segments are refreshed per geometry update; larger scenes follow in batches. Automatic seeding pauses at 16,000 total segments or 80% of the configured budget, whichever is lower, and respects a maximum of 16 live plants or the user's smaller live limit. This prevents unbounded growth and mesh-update work. Normal note-driven growth and existing budget management remain available.

## Problems found in v0.15.1

- Image guidance projected new tips onto the field, but completed segments never updated with later video frames or reference-size changes.
- Seeds repeatedly selected strong edges without considering already covered regions.
- Mimic depth added sharp edge spikes on top of brightness, making the intended shape harder to read.
- Nearest-neighbour sampling and unconstrained coordinates could produce stair steps and branches growing along indefinitely clamped border values.
- The backdrop was only rebuilt when absent or on a control change. A new image reused the same canvas object, so the texture could remain stale. A stopped or replaced source could leave a stale reference plane.
- Video/camera loading had stale-permission and stale-play races, and source switches did not reliably reset field dimensions.
- The existing visibility/size settings were buried among advanced controls. Automatic camera framing could cancel the visible effect of size changes.

## Source changes to port

### Reference field (compiled class `aJ`)

Readable replacement: `maintenance/reference-field.js`.

- Preserve the public `openImage`, `openFile`, `openCamera`, `stop`, `listCameras`, `frameSource`, `ready`, `depth`, `edge`, `grad`, `visit`, `coverage`, `pickPoint` and `update` API.
- Give each source change a request generation. Ignore late image/video completions and stop obsolete camera streams. Clean up object URLs, video source objects and track-end handlers.
- Reset dimensions/coverage on source changes. Cap both field axes, including portrait inputs; cap the uploaded still's longest texture axis to 1,536 pixels.
- Update the field before processing growth each frame. Initialize depth immediately on the first frame, then smooth subsequent live depth with a time-based exponential factor.
- Use bilinear sampling for depth and edge gradients. Alpha-composite transparent pixels against black for luminance.
- Prefer uncovered edges when sampling seed positions; mark a small neighbourhood visited. Moving edges can clear their coverage.
- Catch unreadable frames and stop the source with a useful status.

### Organism engine (compiled constructor alias `tw`)

Readable methods: `maintenance/reference-growth.js`; integration edits: `maintenance/patch_reference.py`.

- `fieldZ`: use smooth luminance relief with optional inversion; remove mimic edge spikes.
- `projectToField`: constrain XY to the reference rectangle, use full surface attachment in 3D shape mode, and calculate normals from smoothed depth gradients.
- Store UV anchors on segments created while guidance is active, and on plant roots/completed tips. Do not retrospectively attach unrelated older geometry.
- `updateReference` runs before note events and growth. Update the field/backdrop; update anchored geometry in bounded batches; keep active tip/root positions coherent; seed short-lived auto plants if enabled.
- Auto plants use the existing species/growth path and available live-plant budget. Completed segments harden; unfinished segments can retract after auto growth stops. Completed auto geometry survives ordinary silence decay and can still be cleared or removed by budget eviction.
- Do not let shell-surface projection or directional-species birth offsets override reference positions at birth.
- Clear reference coverage when growth is reset.
- Frame the whole reference on initial source activation. In orbit mode, centre the view on the reference and preserve that framing while Size changes, so enlargement is visible. Fit view recalculates framing explicitly.

### Reference plane and quick controls

- Reuse one unit plane and scale it; reuse its material instead of reallocating geometry for every slider change.
- Track source identity and field revision. Still textures refresh even when the canvas object is reused. Live video uses the existing video texture path.
- Hiding affects plane visibility only. Stopping hides the plane and releases its texture. Use double-sided reference material for orbit viewing.
- Add `videoBuild`, `videoFollow`, `videoInvert` controls to the Video group. Existing `videoMode`, `videoSize`, `videoDepth`, `videoShow`, `videoStick`, `videoSpawn` remain the same engine controls.
- `maintenance/reference-ui.js` binds quick controls to the existing control map (`Zt`), preserving preset and MIDI-control integration. Successful image/video/camera loading enables the shape setup through `activateReference()`.
- The source-opening handlers still use the existing Input buttons and file pickers; no new backend, downloads, libraries or online model service is required.

## Files and reproduction

- Runnable outputs: `index.html`, `assets/index-BWYXfAkm.js`, `growth-visualiser-v0.16.0.html`.
- New readable logic: `maintenance/reference-field.js`, `reference-growth.js`, `reference-ui.js`.
- New reproducible incremental patch: `maintenance/patch_reference.py` (checks the exact v0.15.1 bundle hash; requires separate source/output directories).
- New tests: `maintenance/test-reference.cjs`.
- Existing input/audio tests retained. Distribution validator updated to v0.16.0.
- Previous `maintenance/patch_release.py` is the historical v0.15.0 → v0.15.1 patch; **do not run it over v0.16.0**.

```sh
python maintenance/patch_reference.py /path/to/unmodified-v0151 /path/to/new-output
node --check assets/index-BWYXfAkm.js
node maintenance/test-reference.cjs
node maintenance/test-input.cjs
node maintenance/test-audio.cjs
python maintenance/validate.py /path/to/original-growth-visualiser-v0.15.0.zip
```

## Checks and outstanding verification

Automated checks cover bilinear sampling; depth inversion; finite normals and rectangle bounds; live and frozen anchored geometry; resizing; backdrop visibility, same-canvas refresh and cleanup; portrait sampling limits; stale camera cancellation; bounded automatic filling; previous audio/keyboard behavior; required HTML controls; folder/standalone parity; preserved MediaPipe assets; and the optional local server.

**No real browser GPU, live webcam, live MIDI or recording test was performed here.** Tests use controlled media/geometry stubs. Before releasing from source, check an uploaded face photo and a landscape; two consecutive stills with different aspect ratios; a moving camera subject; source stop/replacement during permission prompts; large scenes; preset transitions; output recording; and WebGPU/WebGL2 rendering. Inspect recognition from the front and visible depth while orbiting.
