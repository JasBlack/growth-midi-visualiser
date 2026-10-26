# Growth v0.15.1 — handoff to Claude

## Starting point

This update was made directly against the user's **growth-visualiser-v0.15.0.zip**, not the earlier v0.14.1 patch. The attachment contains production HTML, a compiled JavaScript bundle, MediaPipe assets and launchers. It contains **no TypeScript source, package.json, lockfile, source maps or Git history**. This is therefore a patched distribution, not a Vite rebuild.

Please port the changes below into the actual source project before the next normal build. Do not replace the source project with this distribution or infer source filenames from minified names. The names below identify this exact input build only.

The new picture-input handling, camera cycling, shared audio/recording infrastructure, growth engines, species and shader code from v0.15.0 are retained. No organism algorithms were redesigned.

## 1. Audio input transitions and asynchronous races

**Source location to find:** the audio input/analyser class with `loadTrack`, `startMic`, `startTabCapture`, `stop`, `stopMic`, and `stopTab`. Its compiled name is `O5`.

Readable implementations are in `maintenance/audio-methods.js`. The patcher embeds them directly into the class.

- Add a monotonically increasing `inputRequest` generation. `stop()` increments it before releasing anything. New input requests call `beginInputRequest()`, which stops the previous source and returns the generation.
- After each asynchronous file read, decode or permission grant, compare the captured generation with the current generation. Discard obsolete results; stop every track of obsolete capture streams. Obsolete rejections must not overwrite the active source's status.
- `loadTrack` clears the previous buffer/name/offset before loading, commits only the current decode, and catches playback failures. Failed files cannot leave the previous audio buffer replayable under the new filename. Next/previous selection updates the requested index immediately.
- Starting microphone or tab capture disconnects **only** `analyser -> context.destination` when file playback previously enabled that connection. This prevents implicit speaker monitoring/feedback after file playback. Leave the shared recording tap intact: the existing `U5(this.analyser)` and `Gw()` path is preserved.
- Microphone and tab track `onended` handlers verify both the generation and stream identity, then stop the source and release pending note-offs. An old stream's event cannot shut down its replacement.
- If capture setup fails after obtaining a stream, stop its tracks and clean up the source.
- In the input-mode UI function (`_u` in this build), selecting Audio file when the current source is not a file now calls `je.stop()` before prompting for a file. This closes a live microphone/tab and invalidates pending requests.

These changes affect audio input, not the separate video/camera/gesture lifecycle. Camera permission races remain a useful follow-up for the source project.

## 2. Keyboard and performance controls

**Source locations to find:** keyboard piano class (`D5`), global keydown handler near `clear.onclick`, and UI visibility function (`pd`).

- Release keyboard notes on `document.visibilitychange` when hidden, in addition to the existing window-blur release.
- Do not play notes while editing contenteditable content or form fields.
- Ignore global shortcuts during composition, after `defaultPrevented`, and with Ctrl/Command/Alt. Ignore key repeats except arrow adjustments. This covers the new **C camera-cycle** shortcut as well as recording, stills and reset.
- Focused buttons, links, summaries and form controls retain their own keyboard behavior.
- **Intentional shortcut change:** Tab now performs normal focus navigation; **F2** toggles the UI. Escape restores it. Help text and tooltips were updated.
- Set the hidden panel's `inert` property so invisible controls cannot receive focus.
- Add a Show controls button for pointer users in hidden-UI mode. It fades with the existing cursor behavior and is excluded from `?ui=0` capture output.

## 3. Control-panel usability

Readable additions: `maintenance/interface.css` and `maintenance/interface.js`.

- Add a Find a setting field. It searches section text, opens matching sections, reports no matches and restores the earlier open/closed state on clear. Escape clears the search. Changes to generated engine controls reapply the filter.
- Ignore section-persistence toggle events while search is active. The corresponding section-binding function is `d5` in this build.
- Add `[hidden] { display: none !important; }`. Existing flex styles otherwise override hidden transport/input/playlist rows and the countdown element.
- Increase panel text and control target sizes, use readable four-column species buttons, add visible keyboard focus outlines and constrain the panel on narrow screens. Keep the black visualisation canvas.
- Add accessible names to generated sliders/selects and static device, transport and text controls. The slider factory is `l5` in this build.
- Respect reduced-motion preferences for panel transitions; growth animation is unchanged.

## 4. Persistence and launchers

- Preset saving (`IK`, called by `gJ`) catches storage errors and explicitly reports that the preset is only retained for this session.
- Debounced settings saving (`Hi`) catches unavailable storage and reports it instead of throwing.
- Existing settings and preset storage keys are unchanged. No stored data is migrated or deleted. The standalone HTML's changed filename may receive different file-origin storage in a browser; keep the previous file if you need its presets.
- Add `launch.py`: bind to loopback, start serving before opening the browser, report port conflicts and shut down on Ctrl+C. Retain `http://localhost:8765/` and its browser origin.
- macOS checks for Python 3. Windows tries `py -3`, then `python`. Both explain the standalone alternative if Python is absent.

## Files changed or added

| File | Purpose |
| --- | --- |
| `assets/index-BWYXfAkm.js` | Patched application bundle; retains original filename for this distribution |
| `index.html` | Panel/search/accessibility styles and markup |
| `growth-visualiser-v0.15.1.html` | Same patched bundle and UI embedded into the standalone file |
| `launch.py`, platform launchers | Reliable optional local server |
| `README.txt` | Updated running instructions and shortcuts |
| `maintenance/patch_release.py` | Reproducible patch against the original v0.15.0 ZIP, with original-bundle hash and exact-fragment checks |
| `maintenance/audio-methods.js` | Readable audio changes to port into TypeScript |
| `maintenance/interface.js`, `interface.css` | Readable UI additions |
| `maintenance/test-audio.cjs`, `test-input.cjs` | Regression tests against the shipped bundle and UI helpers |
| `maintenance/validate.py` | Distribution parity, asset preservation and local-launch checks |
| `NOTES_FOR_CLAUDE.md` | This handoff |

## Verification and limits

Automated checks passed for JavaScript syntax; out-of-order decodes; cancelled decodes; corrupt audio; microphone/tab permission races; stale errors; speaker-only disconnection; stream-ending cleanup; note release; modifier/repeat guards; Tab/F2/Escape; preset shortcuts; search restoration; and storage failures.

Distribution checks verify required DOM IDs, exact folder/inline bundle parity, preserved v0.15.0 MediaPipe assets, ZIP integrity, and a local HTTP launcher smoke test including port conflicts and clean shutdown.

These are controlled tests using mocked browser media APIs, not live hardware or rendered-browser tests. **GPU visuals/performance, MIDI hardware, microphone/camera permissions, MP4/WebM recording, WHIP streaming, and platform-native launcher execution on macOS/Windows were not verified here.** The server itself was tested on Linux.

Run from the extracted release folder:

```sh
node --check assets/index-BWYXfAkm.js
node maintenance/test-input.cjs
node maintenance/test-audio.cjs
python maintenance/validate.py /path/to/growth-visualiser-v0.15.0.zip
```

The patcher can reproduce app/launcher changes from the original ZIP into a separate output directory:

```sh
python maintenance/patch_release.py /path/to/growth-visualiser-v0.15.0.zip /path/to/output
```

The notes and maintenance tests are supplied in this release; the patcher generates the runnable app, not a replacement source repository.

## Suggested next verification in the source project

1. Port the readable changes, then run the normal TypeScript check and Vite/single-file build.
2. Start decoding a large audio file, immediately choose another track or MIDI, and verify no delayed playback.
3. Open a mic/tab permission prompt, switch modes, then grant it; verify the obsolete capture closes.
4. Play a file, then switch to mic at low speaker volume; verify there is no implicit microphone monitoring while recordings still receive the intended audio.
5. Check all five engines, picture/video steering, C camera cycling, F2/Tab/Escape, and recording on the real performance machine.
