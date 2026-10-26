# v0.20 plan — read this first when resuming

State on 2026-09-24:

- The TypeScript source in this repo is **v0.15.0**. Releases v0.15.1–v0.19.0 were made in
  another environment by patching the minified bundle; they exist only as a distribution.
  Their readable modules, patch scripts, tests and handoff notes are copied into
  `docs/v19-dist/` (original folder: `C:\Users\User\Downloads\growth-v0190`).
- `MASTER_PLAN.md` — the staged plan (Stage 1 = port v19 + critical fixes → v0.20.0;
  Stage 2 = obvious music reaction; Stage 3 = GPU/perf + scene bank).
- Port specs, one per feature cluster: `c1-input-shell` … `c8-simple-ui`.
  Audits of the v0.15.0 source: `a1`–`a4`. Improvement ideas: `k1` (visual/music),
  `k2` (performance), `k3` (UX). Architecture proposals: `r1`–`r3` (r1 chosen, lightly).
- `evidence-recording.md` / `evidence-baseline.md` — measured v19 recording defects and
  the growth-stall reproduction.

## Progress (paused 2026-09-25)

Stage 1 steps done and committed (each: tsc + vite build pass, lead-verified live unless noted):
1a feature seam + growth-stall fixes (601df18) · 1b dirty-range instance uploads + camera offsets (d4fa530) ·
2 WebCodecs recorder, ffprobe-verified (3557e86) · 3 input/panel shell (3bb27a3) · 4 music response +
MIDI fixes (7a7c7ed) · 5 CameraRig, Framed default (f971a6b) · 6 picture/video reference (8b5fb19) ·
7 soft species (14a8e7d, verified live) · 8 materials + tip shapes (7758ff3) · 9 Simple mode + looks, v0.20.0 (9c260e8).

Stage 1 complete: released as v0.20.0. Next: Stage 2 (MASTER_PLAN.md).

Stage 2 complete (2026-09-26): v0.21.0 — ignition, conduction, director + arcs, macros, lighting/post + adaptive quality, pitch layouts + harmony, 91 unit tests. Next: Stage 3 (MASTER_PLAN.md); seamless mitered tubes (k1 Idea 11) would remove the dark notches at segment joints.
