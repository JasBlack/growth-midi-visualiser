# Growth v0.20 — lean master plan (lead, from 18 reports + live evidence)

Source of truth = TS repo `growth-midi-visualiser` (v0.15.0). v19 = compiled patches; port intent, not code.
Specs per cluster: `c1..c8-*.md`; audits `a1..a4`; ideas `k1..k3`; architecture `r1..r3` (all in this folder).
Architecture: r1-pragmatic, light — new features go in `src/midi/engines/organism/<feature>.ts` modules with typed hooks called from OrganismEngine; no big-bang split of existing code.
Execution: sequential in one tree (hot files organism.ts / main.ts / index.html), one subagent per stage reading its spec, tsc + build + short browser check after each. Lead verifies live.

## Stage 1 — v0.20.0 "everything v19 had, working" (port + critical fixes)
1. Recording: WebCodecs + mp4-muxer again (c7 §10): fixed capture size (1080p/1440p 16:9, even), CFR from frame counter, AudioWorklet PCM tap at 48 k stereo (never dropped), input-only / full-mix bus, 30/60 fps, bitrate; MediaRecorder only where WebCodecs absent; honest labels. Verify with ffprobe.
2. Growth stall: maxPlantSegs from budget not capacity; tip waits instead of dying at the limit; tip-death radius relative; newest notes get credit first (a1, c6).
3. Perf: dirty-range instance uploads, write only the mesh a segment uses (a2/k2 P1).
4. Input/UI shell (c1): audio request generations, F2/Tab/inert, shortcut guards WITHOUT the v19 dead-shortcut/dead-piano bugs, settings search, storage try/catch, launch.py.
5. Reference (c2): field rewrite, UV anchors, follow live, build shape, invert, fit — DoubleSide backdrop, no 68% segment rejection, framing that faces the plane.
6. Camera (c3): CameraRig with auto-framing default; lock (not frozen at startup pose, not covering buttons, hidden in capture); cinematic tip glide / tour / wide pulse; Shift-middle pan; screen bounce; kick/shake as offsets not state.
7. Soft species (c4): 13 species, DoubleSide, indexed smooth normals, oriented per note.
8. Materials + tips (c5): 10 animated materials, tip shapes + PNG/OBJ upload, tipLimit ≤ MAX_TIPS.
9. Music pacing (c6): credit allocator, emphasis new/dim old without per-frame 800-seg sweep, audio sensitivity wired properly (no globalThis).
10. Simple mode (c8): six looks + Surprise through the control registry; first-run look without the 700 ms race; Simple camera = Framed (auto-fit), not a pose lock; defaults that visibly react (not v19's 0.315x).

## Stage 2 — v0.21 "obvious music visualiser" (improvements, pick from k1/k3/k2)
- Note-on ignition (seed flare + attack lunge, visible within one frame) + ADSR envelope.
- Conduction: light pulses travel root→tip along each note's branch on the GPU.
- Director camera: auto-framing + cuts on bars; energy arcs (build/drop) drive scene evolution.
- Reaction macro (calm ↔ show) + macros Energy / Complexity / Motion / Chaos, MIDI-learnable.
- Lighting/post: AgX, fresnel rim, HDR tips, bloom default on (first to drop under auto quality).
- Pitch→space layouts, harmony→grafts.
- MIDI fixes (a3): sustain CC64, all-notes-off, channel clashes, clock double-beat.
- Unit tests (vitest) for pure logic; zip fix (backslash entries, exec bit).

## Stage 3 — v0.22 perf/UX depth (optional)
GPU compact segments (P6), shader-side motion (P7), scenes bank + crossfader, perform HUD.
