# Growth — MIDI / music visualiser

A browser visualiser where music grows living 3D organisms. Every note grows a
structure (roots, coral, neurons, crystal, soft ribbons…) that reaches out
while the key is held, retracts on release, ignites and pulses with light, and
breathes with the music. Feed it MIDI, the computer keyboard, an audio file, a
microphone or another browser tab; record 1080p/1440p MP4 straight from the
page. Runs fully offline, no backend.

## Run

Requires Node 18+ and Yarn 1.

```sh
yarn            # install dependencies
yarn dev        # dev server at http://localhost:5180
yarn build      # typecheck + production build + release artifacts (see below)
yarn test       # unit tests (vitest)
yarn vendor     # optional: copy MediaPipe runtime/models into public/ (webcam gestures)
```

`yarn build` writes `dist/` (folder build), `dist/growth-visualiser-vX.html`
(one self-contained file you can double-click) and `growth-visualiser-vX.zip`
(both, plus start scripts for macOS/Windows).

Use Chrome, Edge or Brave for the WebGPU path; Safari and Firefox run the WebGL2
fallback. Hold `A`…`K` to play notes from the keyboard; `F2` or `` ` `` hides
the controls.

Full feature guide: [`docs/FEATURES.md`](docs/FEATURES.md). Developer notes:
[`CLAUDE.md`](CLAUDE.md).
