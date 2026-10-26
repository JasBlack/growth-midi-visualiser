# Growth v0.17.3 — ten animated surface materials

Built from v0.17.2, retaining its camera lock, musical pacing and recent-growth emphasis. This remains a compiled-distribution patch because the uploaded project has no TypeScript/Vite source. Port the readable modules into the source project before a normal rebuild. Previous handoffs are preserved in NOTES_V0172.md and earlier files.

## User-facing changes

The Animated materials section near the top of the controls has a material selector and Next new button. The original Growth shader control uses the same value, so presets and MIDI learning continue to work. The old 22 material indices are unchanged; ten entries are appended at indices 22–31:

- Tidal glass: broad cyan wave interference with a polished opaque finish.
- Pearl currents: warm pearl and lavender bands flowing around folds.
- Mercury ribbons: bright silver ribbons travelling over a dark metallic surface.
- Biolume: green luminous patches that brighten with musical attacks.
- Oil slick: shifting multicolour bands on a metallic surface.
- Silk shimmer: intersecting pink and violet threads.
- Molten gold: amber streams across a gold surface.
- Ripple rings: expanding blue circular waves.
- Aurora weave: green and violet curtains moving across the growth.
- Electric filaments: narrow violet light paths on a dark surface.

These are surface materials for existing species, not ten additional branching behaviours. The ten new materials also work on Liquid, Silk ribbon and Wave blanket; original shaders keep their previous behaviour on those soft species.

Motion speed, Pattern scale and Audio response affect the new materials only. Speed 0 stops time-driven motion; set Audio response to 0 as well for a static material. The default material selection is preserved. Next new starts with Tidal glass and cycles through the ten new entries. Material changes keep the growth and camera position. Video recordings capture these surfaces through the existing renderer.

## Implementation and performance

- maintenance/dynamic-materials.js appends the catalogue before engine/control construction. It uses the same bundled three.js node-material helpers as existing shaders. Patterns are bounded combinations of sine waves, smooth transitions and colours. There are no texture downloads, noise loops, extra render targets, additional meshes, transparency or extra render passes. Glass is an opaque polished appearance, not physical refraction.
- Shared uniforms hold animation phase, scale and smoothed audio levels. maintenance/dynamic-material-runtime.js updates them once per Organism frame. Delta time is bounded after stalls; phase is integrated so changing speed does not jump to a different absolute time. Audio-only response does not flash to a continuing tempo estimate during silence.
- Soft meshes create an owned effect material only when the selected shader changes and retain it across animation frames. They retain their base material for switching back. Effects and base materials are disposed on plant cleanup/reset/unmount. Per-plant colour is retained through materialColor, and emissive output uses diffuseColor so recent-growth emphasis can influence the appearance. Normal instanced geometry retains the existing material-sharing path.
- The CPU animation and geometry complexity of soft species are unchanged. This patch makes surface animation cheap; it cannot guarantee a fixed frame rate with arbitrary scene sizes. First use of a shader can still involve browser/GPU shader compilation. High recording resolutions and dense growth still cost rendering time.

## Reproduction

Run maintenance/patch_dynamic_materials.py with the verified v0.17.2 directory and a separate output directory. The script verifies the old bundle hash, embeds the readable modules, adds controls and quick UI, updates soft-material ownership, and rebuilds folder and standalone HTML versions. Preserve the current handoff notes separately; the builder does not generate this text.

## Verification

All eight Node regression suites pass, along with JavaScript syntax and the packaging validator (unique HTML IDs, embedded bundle parity, supplied model/runtime asset preservation and launcher checks).

The new test-dynamic-materials.cjs evaluates the material expressions through a numeric node model: ten distinct sampled patterns, time changes, audio changes, finite colours, bounded expression construction, silence handling, speed freeze, material reuse and disposal. This model is not a GPU compiler or a visual benchmark. Live WebGPU/WebGL rendering and end-to-end recording were not verified here. Before an upstream release, visually inspect each material on rigid and soft species, test repeated switching, and compare performance in a dense scene at the user's recording resolution.

The ZIP is fully extracted and compared to its source files before delivery.
