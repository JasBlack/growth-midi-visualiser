# Growth v0.18.0 — new soft species, screen bounce, tip shapes, editor capture

This is a compiled-distribution update from v0.17.3, not a TypeScript source rebuild. The attachments did not include the Vite/TypeScript source. Port the readable modules into the source before a normal build. Prior handoffs are in NOTES_V0173.md and earlier files. User instructions: START_HERE_v0180.md. Recording investigation and sources: RESOLVE_IMPORT.md.

## Species and performance

Ten species are appended after the existing three soft species, preserving all previous indices: Jelly bell, Kelp frond, Manta sail, Spiral streamer, Breathing torus, Wave tube, Anemone fan, Pleated silk, Liquid droplet, Ripple disc. Each has distinct parametric geometry, not merely a different material. Definitions and allocation-free per-vertex formulas are in maintenance/soft-species-extra.js; the builder inserts this after the original three definitions and before the soft engine methods.

maintenance/soft-growth.js uses a reused 24 by 16 plane grid (425 vertices) or a lower-detail liquid mesh. A round-robin cursor allows at most 16 geometry updates per frame and at most 64 retained soft meshes. Mesh creation is also bounded by the update quota. Geometry targets 30 Hz, normal recomputation 15 Hz; heavily populated scenes update each organism less often. Extra plants fall back to their skeleton. Existing reference anchoring, material choices, age emphasis, growth, retraction and disposal remain integrated. No fixed FPS claim is made.

## Screen bounce

maintenance/stage-motion.js applies a temporary scale/translation to the projection matrix during draw, then restores it and its inverse in a finally block. No plant positions or reference coordinates are changed. It includes recordings/snapshots and coexists with camera lock. Scene bounds are estimated from sampled segment endpoints, reference corners, soft bounds and the shell size; they refresh four times per second and are smoothed. Unusual model bounds may require reducing screen size. Reflection is a bounded modulo calculation, delta time is clamped after stalls, and speed zero preserves travel position. Draw errors also restore the projection. With moving camera modes, framing can change; camera lock gives the intended DVD-style motion.

## Tip shapes

maintenance/tip-shapes.js changes the existing instanced tip geometry. Nine built-ins plus image/OBJ uploads, size, brightness and marker-count controls. Flat markers face the camera. Images become 256-square textures with alpha testing, retain their source colours, and do not add a separate mesh per marker. OBJ parser supports vertex positions and triangulated polygon faces with positive/negative indices; ignores material/texture/animation data. It caps input size, vertex count and triangles, centres and scales the geometry, and rejects malformed data. Custom OBJ markers are additionally capped at 128 instances. Pending uploads are invalidated on unmount; replaced assets are disposed. Capacity-driven replacement of tipMesh is detected and reapplies the selected shape. Uploads are session-only; controls/preset indices alone do not serialize files.

## Recording

maintenance/recorder-native.js adds explicit H.264/AAC MP4 capture requests, with no generic MP4/WebM fallback when editor compatibility is enabled. Compatibility off retains broader browser-native choices. The status displays the browser-reported MIME; Recording report exports diagnostic JSON but is not a file-level codec verification. Editor MP4 settings selects 1080 tall/30 fps and strict capture. The earlier fixed-level codec followed by generic MP4 was a robustness weakness, not a proven explanation for the user's clip. Resolve 20 lists Opus in MP4/MOV, so do not assert Opus is universally unsupported.

convert-for-resolve.py optionally uses installed FFmpeg to write ProRes LT/PCM MOV, H.264/AAC MP4, or a no-recompression MP4 remux. It refuses overwrites, preserves originals and uses argument arrays, not shell interpolation. Optional ffprobe source reports aid diagnosis. Convert-for-Resolve.command adds a Mac file picker. FFmpeg/Python are not bundled and are needed only for this helper, not the app. No failed user MP4 was supplied.

## Build and validation

maintenance/patch_species_stage.py verifies the v0.17.3 bundle hash and requires a separate output. It combines the readable modules with guarded edits to the compiled controls, draw wrapper, tip transforms, record controls and standalone HTML. Preserve the root documentation/conversion helper separately when reproducing: the patch builder copies the old release and maintenance files, not newly authored root docs/helper files.

Nine Node regression suites pass. New coverage includes all thirteen soft forms, finite animated positions, retraction/disposal, per-frame update and total-mesh caps; long reflection sequences and speed-zero behaviour; actual compiled draw-wrapper restoration on success/error; OBJ normalisation, limits, negative indices, comments and upload replacement; strict recording rejection and explicit codec requests. Existing audio/input/reference/material/camera regression suites remain passing.

JavaScript syntax and packaging validation pass (HTML IDs, standalone parity, supplied model assets and launchers). The converter was run on a generated fragmented H.264/AAC MP4; ffprobe verified all three output modes, audio retention, pixel formats and 30 fps for transcodes. Actual Resolve import and live GPU rendering remain unverified. User hardware should be used for visual/performance assessment. The release ZIP is extracted and byte-compared before delivery.
