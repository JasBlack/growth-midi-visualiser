# Growth v0.17.2 — camera lock, musical pacing and visible new growth

Incremental compiled-distribution update from v0.17.1. The supplied project has no TypeScript/Vite source. Port these readable modules and guarded bundle edits into the source before a normal rebuild. Earlier notes remain in NOTES_V0171.md and previous handoffs.

## For the user

- A top-right Lock camera toggle stays visible when the controls are hidden. It freezes the camera pose, including automatic motion, gesture movement and Reset. Unlock before orbiting, panning, zooming or fitting the reference. It applies to the Organism pattern and is a session control, not a saved preset.
- Use as 3D shape now starts music-led: reference guidance is on but Build shape is off. Build shape remains available for independent filling, with a Background starts / second slider.
- Music-led settings is a one-click starting point: background fill off, Growth amount 0.45, release sustain 0.25 s, highlight 0.8, fresh trail 2 s, segment rate 300/s. This also helps when an older preset restores more aggressive settings. It does not erase existing structures; use Reset if desired.
- Growth amount scales growth speed. Highlight new / dim old makes recent segments brighter and older structures darker. Cyan-tinted musical tips draw through the older structure, so new activity stays visible when the picture is dense. Highlight 0 restores normal colours and depth-tested tips. Fresh trail changes how long recent segments stay bright.
- The soft species also dim with age. Tip markers scale with view distance so they remain readable in wider views. Recorded canvases include the emphasis, but not the camera-lock UI.

## Why growth was fast first and slower later

Several mechanisms were contributing, rather than a single audio detector bug:

1. Activating a reference enabled autonomous plants every 0.16 seconds, each lasting five seconds, regardless of the music. It now leaves auto-fill off. Optional auto-fill defaults to 0.8 starts/s, has a two-second lifetime and a maximum four concurrent active plants, with an initial interval before the first start.
2. Released notes continued growing for 1.5 seconds. The default is now 0.25 seconds, and overall Growth amount defaults to 0.45. Note-on/off, audio analysis and sustain remain adjustable.
3. The engine explicitly multiplied growth speed down to 30% as the segment budget filled. That multiplier is removed. Existing hard budgets and recycling still apply; unlimited complexity or constant frame rate is not promised.
4. The old segment allowance rounded up implicitly and had a minimum one start per frame. Fractional credits now enforce starts per second across different frame rates. Credits cap at 64 and accumulation uses at most 50 ms per frame, preventing a long stall from banking a large burst.
5. Still references rewrote up to 4,000 segments thirty times per second even when unchanged. Static geometry now updates only after relevant changes or follow re-enabling. The resize sweep correctly stops after visiting all segments, including scenes above 4,000 segments. Live video keeps bounded updates without rewinding the batch cursor on every frame revision.

## Integration

- maintenance/music-focus.js: camera lock, reset preservation, segment credit allocator, colour emphasis with a reusable temporary colour, bounded 800-segment colour refresh per draw.
- maintenance/music-focus-ui.js: always-visible lock button and shared music controls.
- maintenance/reference-growth.js: slower optional auto-fill, still-image dirty tracking and corrected multi-batch completion.
- maintenance/soft-growth.js: age-based colour multiplier for soft surfaces.
- maintenance/patch_music_focus.py: guarded edits to v0.17.1's verified bundle, controls/defaults, camera-simulation guard, pacing, tip visibility, UI, standalone HTML. Run with the v0.17.1 input folder and a separate output folder. New outputs are copied from the input before patching. The builder does not generate this handoff text; preserve it separately.

Camera lock skips automatic camera calculation, tunnel culling and gesture offsets, restores the captured position/quaternion and projection values, and preserves navigation state across clear(). Input movement is ignored while locked. The camera aspect ratio still responds to window resizing.

New emphasis is applied per segment based on birth time; it is not an audio waveform display. Background auto-fill never receives the fresh musical highlight. Old colours update in a bounded sweep, so extremely dense scenes can take a moment to reflect a slider change. Some procedural shaders may reduce the effect of per-instance colour, though the tip overlay remains separate. Sharp black/white images still provide brightness relief rather than inferred facial geometry.

## Verification and remaining checks

All seven Node regression suites pass, covering camera pose across Reset and the actual compiled locked-camera block, input controls, audio races, recording ownership, soft motion, seed distribution, 30/60/120-fps credit pacing, stale/stalled frame credit, colour separation, and 5,001-segment static/live update sweeps. JavaScript syntax, HTML IDs, standalone/bundle parity, unchanged supplied model assets and launcher behaviour pass validation. The ZIP is fully extracted and byte-compared before delivery.

No live GPU or perceptual listening test was available here. Confirm on the user's hardware: lock a preferred view then Reset; play a quiet passage followed by a strong attack; compare Highlight 0 and 0.8 in a dense image; try video/camera following after filling over 4,000 segments; record a short take. Dense geometry can still reduce frame rate, and imported aggressive presets can override the new defaults. Music-led settings provides an explicit way back.
