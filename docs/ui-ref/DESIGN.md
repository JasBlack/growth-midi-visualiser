# Growth UI redesign — JAS.BLACK tool family

Goal (owner, 2026-10-27): "completely redesign the UI so that this looks like it has the same design
language / is in the same family of tools as paint.jas.black and snap.jas.black."

References in this folder (look at them):
- `painter-easy.jpg`, `painter-easy-zoom.png` — Code Painter, easy mode (numbered step panels).
- `painter-console.jpg`, `painter-console-bottom.png` — Code Painter, console mode (dense panels round the stage).
- `snipsnap-landing.jpg`, `snipsnap-workspace.webp` — SnipSnap (neumorphic keys, centred header, kbd footer).
- `painter-styles.css`, `snipsnap-styles.css` — their real CSS (copy exact values from these).
Sources: github.com/JasBlack/code-painter, github.com/JasBlack/snipsnap (both by the owner).

## The family's language (what makes them read as one family)

1. **A dark hardware console.** Flat charcoal case, panels slightly lighter with a 1px line, rounded
   12–16 px. The stage (canvas/video) sits in a darker inset well. No glassmorphism, no blur.
2. **Type.** UI in a monospace (Code Painter: `'IBM Plex Mono'` 400/500/600, 11 px base; SnipSnap: system
   sans, letter-spaced). Section titles UPPERCASE, 9 px, weight 500–600, letter-spacing .2–.3em, muted.
   Button labels small and lowercase (Code Painter). App wordmark UPPERCASE, heavy, very wide tracking
   (Code Painter uses Archivo 800 for the wordmark; SnipSnap 15 px 600 .28em). Numbers/timecode in mono.
3. **LEDs.** Tiny round status lights: green glowing when on/live, dark when off. Keys carry an LED dot
   that lights when the key is on. Wordmark flanked or followed by LEDs (SnipSnap: green + grey).
4. **Physical keys.** Raised keys: `--key` face, 1px `--keyline` border, `0 1px 0 --keyshadow` drop; pressed
   = `--keyon` + inset press shadow. SnipSnap's embossed keys (`--emboss`, `--keyface`) for big actions.
   The primary action is a **green filled key** with dark text; record is a **light/white key** whose LED
   turns red while recording. Segmented toggles (Code Painter `easy | console`) with an LED on the active one.
5. **Controls.** Sliders: thin dark track, green fill to the value, round light knob with a soft shadow.
   Rotary knobs (Code Painter) with a purple/green arc for continuous "musical" amounts. Selects are dark
   wells with an inset shadow and a small caret. Thumbnail tiles for looks/styles with lowercase captions.
6. **Accents.** Green `#39ff88` (live, primary, on) and purple `#b36bff` (marks, knobs, MIDI learn);
   SnipSnap's softer `#3ddc97` / `#9d7bff` are the same family. Red only for record/danger.
7. **Background.** Flat case colour + a subtle cutting-mat dot grid (SnipSnap, 24 px). Bake it (canvas or
   a tiny PNG tile) — NOT a live CSS gradient (they shimmer on macOS; see snipsnap CLAUDE.md).
8. **Furniture.** Status line in green mono under the stage (Code Painter); toasts bottom-right
   (SnipSnap); keyboard hints as `kbd` chips (SnipSnap footer); numbered step badges = green circles.
9. **Light / dark** console theme toggle (Code Painter); the stage stays dark either way.

## Growth layout (desktop ≥ 1100 px)

```
┌ top bar 44 ───────────────────────────────────────────────────────────────────────────┐
│ GROWTH ●  [easy|console]  ● midi ● audio ● rec   [reset][PERFORM][● rec][still]   [framed ▾][🔒][hide][◐][⛶] │
├ left 300 ─────────┬ stage well (canvas) ──────────────────────────┬ right 300 (console) ┤
│ 1 SOURCE          │                                                │ GROWTH              │
│ 2 LOOK (tiles)    │                                                │ SPECIES (LED keys)  │
│ 3 RESPONSE (knobs)│                                                │ NOTES · CAMERA …    │
│ 4 CAMERA (keys)   │                                                │ (all engine groups) │
│ 5 DRAW A SOURCE   ├ status line (green mono: notes · bpm · fps …) ┤                     │
│ 6 EXPORT          │ kbd hints                                      │                     │
└───────────────────┴────────────────────────────────────────────────┴─────────────────────┘
```

- **easy** (= today's Simple tier, default): left column of numbered step panels, stage takes the rest;
  right column hidden. **console** (= Advanced): left column compact + right column with every engine
  control group as dense panels (Code Painter console). Both columns scroll independently.
- **Stage** is its own grid cell (rounded inset well). The engine canvas lives there, so the old
  panel-inset camera shift is no longer needed while the stage is framed (keep it working for overlay
  cases or disable it cleanly). **Perform** (performance mode), F2 / ` (hide UI) and `?ui=0` make the
  stage full-bleed with no chrome. Recording's letterboxed fixed-size preview stays inside the stage.
- Narrow screens (< 900 px): one column — stage on top (16:9), panels below.
- Macros become 5 rotary knobs (Reaction, Energy, Complexity, Motion, Chaos) in RESPONSE.
- Looks become thumbnail tiles (2–3 per row) with lowercase captions; tiles may be generated previews
  or a palette swatch + species glyph — they must read as distinct.
- Camera modes as keys with LEDs (framed, flight, director, orbit, still/lock, …); the top-bar camera
  key keeps cycling.
- Species toggles (console) as mini LED keys in a grid like Code Painter's style grid.

## Must not break

Every element id and behaviour in src/midi/main.ts, simpleUi.ts, recordUi.ts, panelSearch.ts, keys.ts,
macros.ts, looks.ts; the shared `ctls` control map (MIDI learn, presets, persistence); Simple/Advanced
tiers (`data-tier`), settings search, CC-learn highlight, keyboard shortcuts and the piano, drag & drop,
the countdown overlay, Show-controls button, `?ui=0` capture output, recording, stills, all five engines'
generated controls, accessibility labels/focus outlines, single-file offline build (fonts: load
IBM Plex Mono + Archivo from Google Fonts with solid system-mono fallbacks so offline still looks right).
