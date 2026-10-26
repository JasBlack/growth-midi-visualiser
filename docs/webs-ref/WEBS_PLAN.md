# "Webs" — tunnel flight through an audio-reactive web (owner reference)

Owner's reference: "Piano webs — realtime audio reactive study in TouchDesigner" (portrait video; top half
visuals, bottom half the pianist). Frames in this folder: `sheet.jpg` (16 frames over 46 s), `f1.jpg`
(dense, chrome ribbons near camera), `f2.jpg` (sparse, background visible), `f3-sparse.jpg`, `f4.jpg`,
`motion.jpg` (8 consecutive frames over 1.2 s — forward flight). Owner: "this was how I imagined it"
(the tunnelling effect). Build it as a **look inside the Organism engine** so ignition, conduction,
macros, director camera, recording and presets keep working.

## What the reference does

1. **High-key world, not black space.** Background is a warm pale grey-mauve (~#b9adab … #d8cfcc) with a
   soft, large, bright radial glow at screen centre (light at the end of a tunnel, ~#f4eeee), and faint
   fine radial streaks / speed lines converging on the centre. Distance fades INTO that light haze
   (atmospheric perspective toward a bright background), not into black.
2. **Threads.** Thousands of thin, long, curving strands (hair / wire / web), mostly dark grey-black,
   some dusty pink and steel blue; thickness varies (hairline to a few px); they curl in 3D, tangle,
   cross the tunnel, rarely branch.
3. **Ribbons.** Flat twisted strips, chrome / mirror (reflecting the bright world, blue-violet and pink
   iridescent tints), some matte pink or black; when near the camera they are huge and sweep past.
4. **Debris.** Many small dark flakes / petals / ash tumbling, plus a few glassy faceted crystal blobs
   and lacy fragments. Adds depth cues and motion parallax.
5. **Flight.** The camera flies forward through the web (tunnel); near objects stream past fast, far
   ones slowly; the centre stays dense. Gentle drift and turning, no hard cuts in the clip.
6. **Music.** Notes / phrases add strands and ribbons; density and motion swell with playing.

## Constraints

- Optional: it's a look (and a set of controls), not a replacement — black space stays the default for
  other looks. Background colour / brightness are controls (a dark variant must also work).
- Weak-laptop budget: reuse instancing, bounded particle counts, adaptive quality (organism/quality.ts).
- High-key needs care: additive glows / bloom (ignition flares, HDR tips, bloom by default) wash out on
  a light background — they must adapt (normal blending, darker ink, bloom threshold above the bg).

## Steps

- W1 — World: haze environment (bg colour + radial glow + speed lines), fog/haze to the bg colour,
  reflections (env map from the world) so chrome reads, light-background adaptations of flares / tips /
  bloom / rim / tone mapping.
- W2 — Flight & content: proper fly-through camera (wandering path, energy/tempo-linked speed, roll,
  spawning ahead in view, recycling behind), thread species, ribbon flow, debris particle system,
  occasional crystal blobs; notes spawn ahead in view (pitch → position around the tunnel / tint).
- W3 — "Webs" look in Simple mode (+ dark variant), tuning against the reference frames, recording check.
