# C1: Input robustness, keyboard/shortcuts, panel interface, persistence, launchers (v0.15.1)

Porting specification: v19 compiled-patch lineage to the TypeScript source (`growth-midi-visualiser`, tag v0.15.0)

- Source of truth (target): `C:\Users\User\Desktop\code\growth-midi-visualiser` (HEAD = tag v0.15.0, commit 42083cc)
- Patched lineage (reference only): `C:\Users\User\Downloads\growth-v0190`
- Cluster files read in full: `maintenance/audio-methods.js`, `maintenance/interface.js`, `maintenance/interface.css`, `maintenance/patch_release.py`, `maintenance/test-audio.cjs`, `maintenance/test-input.cjs`, `maintenance/validate.py`, `launch.py`, `start-mac.command`, `start-windows.cmd`, `NOTES_V0151.md`, `README.txt`, v19 `index.html`. TS files read: `src/midi/inputAudio.ts`, `src/midi/inputMidi.ts`, `src/midi/main.ts`, `src/midi/presets.ts`, `src/midi/audioCtx.ts`, `index.html`, `scripts/release.mjs`, `package.json`, `vite.config.ts`, `src/midi/version.ts`.
- Additional evidence: the v19 bundle `assets/index-BWYXfAkm.js` (current form of every anchor), the v0.15.0 release zip in the TS repo, a Windows run of `launch.py` (a copy in the scratchpad), and a live check of v0.19.0 in a Chromium-based browser pane (served read-only from localhost). See Appendix B.

---

## 1. Summary

**What the cluster does for the user**

1. **Audio inputs do not trip over each other.** If you pick a new track, switch to mic, open a tab share or go back to MIDI while an earlier file decode or permission prompt is still pending, the older result is thrown away. Stale streams are stopped, and old errors cannot overwrite the current status. File playback no longer leaves the analyser connected to the speakers when a mic or tab input takes over, so the mic is not monitored and cannot cause feedback. When a mic or tab stream ends (unplugged device, or "Stop sharing"), the input is torn down and its pending pseudo-notes are released.
2. **Keyboard piano notes do not stick.** They are released when the page loses focus (existing) and now also when the tab is hidden. The piano ignores contenteditable content and anything inside a form control.
3. **Global shortcuts are harder to trigger by accident.** They ignore Ctrl/Cmd/Alt, IME composition, `defaultPrevented` events, key auto-repeat (except arrows) and focused buttons, links, summaries and form controls.
4. **Hiding the UI moved from Tab to F2**, so Tab does normal focus navigation. Esc shows the UI. The hidden panel is `inert`. A "Show controls · Esc" button appears for pointer users, and `?ui=0` capture output hides that button.
5. **Panel usability.** "Find a setting" filters the panel by section. A global `[hidden]{display:none!important}` rule fixes rows that the `hidden` attribute could not hide. Text is larger, focus rings are visible, the layout adapts to narrow screens, and reduced motion is respected. Sliders, selects and static inputs get ARIA labels.
6. **Persistence survives unavailable storage.** Preset and settings saves catch storage exceptions and report them instead of throwing.
7. **Launchers.** `launch.py` serves on loopback, opens the browser only after the server is listening, reports port conflicts and stops cleanly on Ctrl+C. It keeps the `http://localhost:8765/` origin so existing localStorage still loads. Wrapper scripts exist for macOS and Windows.

**Version history.** The cluster was introduced in **v0.15.1** by `maintenance/patch_release.py`, which patched the v0.15.0 zip. Later versions carry it unchanged: every v0.15.1 anchor is still present verbatim in the v19 bundle, and later versions only changed the launcher filenames to `…v0.19.0.html`. Later code in the same class belongs to other clusters: v0.17 added `recordStream()` with a cached `captureDestination`, and v0.19 added `globalThis.__growthAudioSensitivity` to `analyze()`.

**Verdict for the port.**

- **Port the idea, re-implemented as typed code:** audio request-generation tokens, visibility release, storage try/catch with a boolean result, the `[hidden]` rule, ARIA labels, `inert`, and most of `launch.py`.
- **Redesign:** the focus and shortcut policy (it regressed shortcuts, see §7-1), the hide-UI key, search granularity, storage-failure reporting, overlay visibility, Windows port-conflict detection, and release zipping.
- **Leave behind:** the patch scripts, `validate.py` and the vm-based tests of minified code.

---

## 2. Behaviours (exact algorithms, constants, strings)

### 2.1 Audio input request generation (`AudioInput`, minified `O5`)

The source is `maintenance/audio-methods.js` plus the `stop()` edit at `patch_release.py:79-80`.

- **B-A1 Generation counter.** A new field `inputRequest` (undeclared in the patch; it starts as `undefined`) acts as a monotonically increasing generation.
  - `stop()` begins with `this.inputRequest = (this.inputRequest || 0) + 1` and only then does `pause()`, `stopMic()`, `stopTab()`, sets `active=false` and `source='none'`, zeroes `features` and chroma, and pushes `{kind:'off', pitch, velocity:0, time: clock.now(), channel:1}` for every `pendingOffs` entry before clearing them.
- **B-A2 `beginInputRequest()`**: calls `this.stop()`. If `outConnected && analyser && ctx`, it calls `analyser.disconnect(ctx.destination)` and sets `outConnected=false`. This disconnects **only** the speaker edge. The recording taps stay connected: `toRecordingOnly(analyser)` (TS `audioCtx.ts:46-49`) and the v0.17 `captureDestination`. It returns the current `inputRequest`.
  - It must be called **synchronously, before the first `await`**, in every entry point.
- **B-A3 `loadTrack(index)`**:
  1. If `playlist[index]` is missing, return.
  2. `request = beginInputRequest()`.
  3. Set `buffer=null`, `fileName=''`, `offset=0`, `trackI=index` (the requested index is committed immediately).
  4. `onStatus('decoding ${file.name}…')`.
  5. Inside `try`: `ctx=ensureCtx()`, `bytes = await file.arrayBuffer()`, and if `request !== inputRequest` return. Then `buffer = await ctx.decodeAudioData(bytes)`, and again return on a generation mismatch.
  6. Commit: `buffer`, `fileName`, `source='file'`, `active=true`, `play()`.
  7. Status `${playlist.length>1 ? `track ${index+1}/${playlist.length}: ` : ''}${file.name} (${buffer.duration.toFixed(0)} s)`, then `onTrack(name, index, playlist.length)`.
  8. On error: if stale, return silently. Otherwise `stop()`, `buffer=null`, `fileName=''` and `onStatus('could not play ${file.name}: ${error.message}')`. TS v0.15.0 said `could not decode …` and left the **previous** buffer replayable.
- **B-A4 `startMic(deviceId?)`**:
  1. `request = beginInputRequest()`.
  2. `getUserMedia({audio:{deviceId: deviceId ? {exact: deviceId} : undefined, echoCancellation:false, noiseSuppression:false, autoGainControl:false}})`. These constraints are unchanged from TS `inputAudio.ts:280`.
  3. If stale, stop all tracks of the late stream and return.
  4. If there are no audio tracks, `throw new Error('no audio track was provided')`.
  5. Commit `micStream`, then `micSource = ctx.createMediaStreamSource(stream)` connected to the analyser only (never the speakers), `source='mic'`, `active=true`.
  6. `audioTracks[0].onended`: if `request !== inputRequest || micStream !== stream`, ignore. Otherwise `stop()` and `onStatus('microphone disconnected — select an input to reconnect')`.
  7. Status `input live: ${track.label || 'default microphone'}`.
  8. On error: stop the stream's tracks if one was obtained. If stale, return. Otherwise `stop()` and `onStatus('microphone unavailable: ${error.message}')` (TS said `mic denied: …`).
- **B-A5 `startTabCapture()`**:
  1. `request = beginInputRequest()`.
  2. `getDisplayMedia({video:true, audio:true})`.
  3. If stale, stop the tracks and return.
  4. If there are no audio tracks, stop all tracks and `onStatus('no audio in that share — choose a tab and enable Share tab audio')`. TS `inputAudio.ts:248` also carried the Windows hint `(Windows: "Entire screen" + system audio)`; the patch dropped it.
  5. Stop the video tracks, then `tabSource = ctx.createMediaStreamSource(new MediaStream(audioTracks))` connected to the analyser.
  6. `onended`: guarded like the mic, then `stop()` and `'tab capture ended'`.
  7. `source='tab'`, `active=true`, `'tab / system audio live'`.
  8. On error: stop tracks. If stale, return. Otherwise `stop()` and `'tab capture unavailable: ${error.message}'` (TS said `tab capture cancelled: …`).
- **B-A6 Mode UI (`setMode`, minified `_u`).** In the `file` branch, when `audio.source !== 'file'`, call `audio.stop()` **before** `setStatus('choose an mp3 / wav / ogg (or drop one on the page)')`. This closes a live mic or tab and invalidates pending requests. The other branches are unchanged: `midi` calls `audio.stop()`, `mic` calls `audio.startMic(sel||undefined).then(refreshMics)`, and `tab` calls `audio.startTabCapture()`.
- **B-A7 Unchanged but relied on.** `play()` connects `analyser → ctx.destination` once, when `!outConnected` (TS `inputAudio.ts:170-173`). `next()` and `prev()` call `loadTrack`, which now also tears down the previous input through `beginInputRequest`. Natural track end still goes through `srcNode.onended → next()` (TS `inputAudio.ts:179-182`).
- **B-A8 Test-encoded guarantees** (`test-audio.cjs`):
  - Out-of-order decodes: only the latest plays (`played.length===1`).
  - `stop()` during a decode means nothing plays.
  - A corrupt file sets `buffer===null` and `playing===false`, and the status matches `/decode failed/`.
  - A late mic grant is stopped, and `micStream` is the newer stream.
  - `startMic` disconnects exactly `[destination]` and sets `outConnected=false`.
  - `onended` releases `pendingOffs` (the last pushed note is an `off`).
  - For both `startMic` and `startTabCapture`, `stop()` before the grant means the late stream is stopped and `source==='none'`.
  - An older rejection does not overwrite the newer status.
  - Tab "stop sharing" stops the stream and releases pitch 64.

### 2.2 Keyboard piano (`KeyboardPiano`, minified `D5`)

- **B-K1** In addition to `window.blur → releaseAll()`, add `document.addEventListener('visibilitychange', () => { document.hidden && this.releaseAll() })` (`patch_release.py:37-39`).
- **B-K2** `isTyping(e)` becomes `!!t && (t.isContentEditable || !!t.closest?.('input,select,textarea'))` (`patch_release.py:40-42`). The old version compared `tagName` only. **Note:** `closest` includes `input[type=range]`, so the piano is dead after touching any slider (see §7-2).
- **B-K3 Unchanged** (TS `inputMidi.ts:122-147`):
  - `onDown` ignores `!enabled`, typing, `e.repeat`, `ctrlKey`, `metaKey` and `altKey`.
  - `z` moves the octave down (min 1), `x` moves it up (max 7). The default octave is 4.
  - `KEY_ROW='awsedftgyhujkolp;'` with semitones 0..16. `pitch = 12*(octave+1)+semi` and velocity is `shiftKey ? 1 : 0.75`, on channel 0. The handler calls `e.preventDefault()`.
  - `onUp` matches `e.key.toLowerCase()`.

### 2.3 Global shortcuts (TS `main.ts:998-1029`, minified window keydown before `const _J=`)

v19 evaluation order, quoted from the bundle:

1. If `ctrlKey || metaKey || altKey || isComposing || defaultPrevented`, return.
2. `t = e.key`. If `e.repeat && !t.startsWith('Arrow')`, return.
3. `Escape`: `setUiHidden(false)` and return. This runs **before** the focus check, so it works in fields that do not stop propagation.
4. `F2`: toggle `setUiHidden(!body.hide-ui)`, `preventDefault()` and return. Also runs before the focus check.
5. If `target.isContentEditable || target.closest('input,select,textarea,button,summary,a,[role=button]')`, return. **This is the regression, see §7-1.**
6. `shiftKey && /^Digit[1-8]$/.test(e.code)` → `loadPreset(n-1)` plus `preventDefault()`.
7. `'1'..'9'` → `selectEngine(ENGINE_META[n-1].id)`.
8. `Enter` → `performanceMode()`.
9. `Backspace` or `Delete` → `resetEngine()`.
10. `]` or `[` → `setPalette(palette ± 1)`.
11. `r`/`R` → `toggleRecord()`, `c`/`C` → `cycleCamera()`, `q`/`Q` → `takeStill(shift ? 2 : 1)`.
12. `' '` → `togglePlay()` if in file mode, plus `preventDefault()` always.
13. `ArrowUp`/`ArrowDown` → `g:zoom.set(+(g.zoom*(Up ? 1.08 : 1/1.08)).toFixed(2))` plus `preventDefault()`.
14. `ArrowLeft`/`ArrowRight` → `g:symmetry.set(g.symmetry ± 1)` plus `preventDefault()`.
15. The trailing `t==="Escape"&&pd(!1)` is now **dead code**.

The `Tab` branch (`:t==="Tab"?(pd(...),i.preventDefault())`) was **removed**, so Tab does native focus traversal.

**Implicit ordering dependency.** `KeyboardPiano` registers its window keydown listener at construction (TS `main.ts:32`). That is before the global handler (`main.ts:998`). Piano keys call `preventDefault()`, so step 1's `defaultPrevented` check is what stops piano letters from also firing shortcuts.

### 2.4 UI visibility (`setUiHidden`, minified `pd`)

- **B-U1** `setUiHidden(h)`: `$('panel').inert = h`, then the existing body `hide-ui` toggle, `hideUi.textContent = h ? 'show UI' : 'hide UI'` and `hideCursorSoon()`, which adds `hide-cursor` after **2000 ms** without mouse movement while hidden (TS `main.ts:964-975`).
- **B-U2** `#returnUi` (a button outside `#panel`) calls `setUiHidden(false)` on click.
- **B-U3** On load, `body.classList.toggle('capture-output', URLSearchParams(location.search).get('ui') === '0')`. `?ui=0` itself still calls `setUiHidden(true)` in `applyParams` (TS `main.ts:1142`).
- **B-U4 Unchanged**:
  - `performanceMode()` hides the UI, then requests fullscreen with `{navigationUI:'hide'}`.
  - `fullscreenchange` with no fullscreen element and `ui!=='0'` calls `setUiHidden(false)`.
  - `#hideUi.onclick` toggles.

### 2.5 "Find a setting" (`interface.js`, appended to the bundle)

- The query is `input.value.trim().toLowerCase()`. The sections are `#panel details.sec`. This includes the static sections and the engine-generated ones.
- For each section:
  1. If the query is non-empty and this section has not been recorded yet, save `open` in `Map<section, boolean>`.
  2. `match = !query || section.textContent.toLowerCase().includes(query)`. **`textContent` includes `<option>` text and hidden rows.**
  3. `section.hidden = !match`.
  4. If the query is non-empty and the section matches, force `open=true` and count it.
  5. If the query is empty and a saved state exists, restore `open`.
- An empty query clears the map.
- Help text (`#searchHelp`, `role=status`):
  - With matches: `${matches} matching sections · clear to show all`.
  - Without: `No matching settings. Try “species”, “camera” or “decay”.`
  - Idle: `Hold A–K to grow · F2 hides controls · Esc brings them back`.
- Listeners:
  - `input` runs the filter.
  - `keydown` Escape clears the value, filters, `blur()`s and calls `stopPropagation()`. This stops the global handler and the piano, so Esc in the search does **not** unhide the UI.
  - A `MutationObserver` on `#engineControls` `{childList:true}` re-filters when the query is non-empty, which happens whenever `renderEngineControls` rebuilds.
- `growthFilterControls()` runs once at boot. **With an empty query it sets `hidden=false` on every `details.sec`** (see §7-9).

### 2.6 Section persistence during search (`rememberSection`, minified `d5`)

The toggle handler returns early when `document.getElementById('controlSearch')?.value.trim()` is non-empty, so sections opened by search are not written to `settings.openSecs`. User toggles during a search are not persisted either.

### 2.7 Storage failures

- **Presets** (`savePresets`, minified `IK`): `try { localStorage.setItem('midiviz_presets_v1', JSON.stringify(list)); return true } catch { return false }`.
- **`savePreset(i)`** (minified `gJ`): `presets[i]=snapshotPreset(); const saved = savePresets(presets); currentPreset=i; renderPresets();`. `#presetStatus` shows `saved slot ${i+1}` on success and `slot ${i+1} kept for this session only — browser storage is unavailable` otherwise.
- **Settings** (`save()`, minified `Hi`): debounced **250 ms**. The write is `try { localStorage.setItem('midiviz_settings_v3', JSON.stringify(settings)) } catch { setStatus('Settings apply for this session only — browser storage is unavailable') }`. **This fires on every failed save** (see §7-6).
- **Keys:** the storage keys are unchanged (`midiviz_settings_v3`, `midiviz_presets_v1`). No migration was added.

### 2.8 CSS added (`maintenance/interface.css`, appended inside the page `<style>`)

Before → after, relative to TS `index.html:8-82`:

- `[hidden] { display:none !important }`. This fixes `.row{display:flex}` (`index.html:39`) and `.playlist{display:flex}` (`:63`) overriding the user-agent `[hidden]` rule. In v0.15.0, `#midiRow`, `#micRow`, `#fileRow`, `#transport`, `#stemsRow`, `#videoDeviceRow` and `#playlist` were **all visible regardless of mode**. `#countdown` has an inline `display:flex` and was always rendered (empty).
- Base font: `html, body { font-size: 14px }`, previously 12px from the `font:` shorthand (line-height 1.4 kept). `#panel h1` goes from 13 to 16px.
- `#panel`:
  - Width goes from `310px` to `min(370px, calc(100vw - 24px))`.
  - Max height goes from `calc(100% - 24px)` to `calc(100dvh - 70px)`.
  - `scrollbar-width: thin; scrollbar-color: #46525c transparent`.
- `#panelTop` padding goes from 9px/7px to 12px/12px.
- `button, select { min-height: 34px }`. This is a blanket rule that also hits the 8-column presets grid and the species icon grid.
- Focus ring: `button/select/input/summary:focus-visible { outline: 2px solid #99ffcc; outline-offset: 3px }`.
- `details.sec > summary`: 11px → 14px, padding `7px 2px 5px` → `12px 2px 9px`, colour `#8a93a3` → `#bac3d1`. The `.hint` goes from 10px `#5a6070` to 12px `#919aaa`.
- `.note, #blurb, .keys`: 13px, `#aab4c3`.
- Sliders:
  - `.slider` margin goes from 3px to 8px.
  - `.slider span.v, #status, #hud, kbd` are all 12px.
  - `.slider input { min-height: 26px; accent-color: #8fe6b6 }`.
- `.icons`:
  - Grid goes from `repeat(6,1fr)` gap 3 to `repeat(4, minmax(0,1fr))` gap 5.
  - `.icon` padding becomes `7px 2px`, and **inactive opacity goes from .35 to .7**.
  - `small` goes from 8px to 12px.
- `.engines button small, .presets button, .playlist button` are 12px. `.playlist button { min-height: 32px }`.
- `.row > input[type=text], .row > input[type=file] { min-width:0; max-width:100% }`.
- `#controlSearch { width:100%; min-height:36px; margin-top:10px }` and `#searchHelp { margin:5px 0 0; font-size:12px; color:#aab4c3 }`.
- `#hud { max-width: calc(100vw - 24px); bottom: 10px }`.
- `#returnUi`:
  - Default: `display:none; position:fixed; top:12px; right:12px; z-index:5`.
  - `body.hide-ui` shows it with `display:block`.
  - `body.hide-cursor` sets `opacity:0`. Hover or `:focus-visible` in `hide-ui` sets `opacity:1`.
  - `body.capture-output` sets `display:none`.
- `@media (max-width:600px)`:
  - `#panel` gets `top/left:8px`, width `min(370px, calc(100vw - 16px))` and `max-height:60dvh`.
  - `#hud` gets `left:8px` and 12px text.
  - The summary `.hint` gets `max-width:55%` and right alignment.
- `@media (prefers-reduced-motion: reduce)`: no transition on `#panel`, `#hud` or `summary::before`.

### 2.9 Accessibility attributes

- Generated controls (`widget()`, minified `l5`): `select.setAttribute('aria-label', c.label)` and `range.setAttribute('aria-label', c.label)`.
- Static elements get `aria-label`s:
  - `midiDevice`: "MIDI input"
  - `micDevice`: "Microphone input"
  - `file`: "Audio files"
  - `seek`: "Track position"
  - `videoDevice`: "Camera input"
  - `textIn`: "Words to grow"
  - `castUrl`: "WHIP stream address"
  - `playBtn`: "Play or pause"
  - `prevBtn`: "Previous track"
  - `nextBtn`: "Next track"
- `#panel` gets `role="region" aria-label="Growth controls"`. `#status` gets `role="status"`.

### 2.10 Launchers, README, version

- **`launch.py`**:
  - `argparse` with `--port` (int, default **8765**) and `--no-browser`.
  - `ThreadingHTTPServer(('127.0.0.1', port), SimpleHTTPRequestHandler(directory=<script dir>))`.
  - On `OSError` it prints `Could not start Growth: {error}` and `Close the other server or run: python launch.py --port 8766`, then returns 1.
  - The URL is `http://localhost:{server_port}/`. Using `localhost` rather than 127.0.0.1 keeps the v0.15.0 origin, so existing localStorage still loads.
  - `serve_forever` runs in a daemon thread. It prints `Growth is ready at {url}\nKeep this window open. Ctrl+C stops the server.`, then calls `webbrowser.open(url)`, printing `Open the address above in your browser.` if that fails.
  - The main thread loops on `join(0.5)`. `KeyboardInterrupt` prints `\nStopping Growth.`; `finally` calls `server.shutdown()`. It returns 0.
- **`start-mac.command`**: `cd "$(dirname "$0")" || exit 1`. If `command -v python3` succeeds it runs `python3 launch.py`. Otherwise it echoes `Python 3 is needed for webcam gestures. Otherwise open growth-visualiser-v0.19.0.html directly.` and waits with `read -r -p "Press Enter to close."`.
- **`start-windows.cmd`**: `cd /d "%~dp0"`. It tries `py -3 --version`, then `py -3 launch.py` (pausing if errorlevel is 1). It falls back to `python --version` then `python launch.py`. Otherwise it echoes the same message and `pause`s.
- **README edits** (`patch_release.py:139`):
  - `Tab hide UI` → `F2 hide UI`
  - `Q still ·` → `Q still · C camera ·`
  - `Both use Python 3;` → `Both wait for the server before opening the browser and use Python 3;`
  - Appended lines: `See NOTES_FOR_CLAUDE.md …` and `Tab now moves focus between controls. Use Find a setting to locate controls.`
- **Keys help**:
  - `<kbd>Tab</kbd> hide UI` → `<kbd>F2</kbd> hide UI · <kbd>Tab</kbd> next control`.
  - The `#hideUi` title goes from `Tab` to `F2`.
- **Version**: `"0.15.0"` → `"0.15.1"`. This is `VERSION` in `src/midi/version.ts:2`. `package.json:4` must be bumped as well.

---

## 3. Controls

No `EngineControl` keys or global (`g:`) sliders were added or changed in this cluster, and no `Settings` fields were added. The only new interactive DOM controls are these:

| id | type | label / text | default | where | read by |
|---|---|---|---|---|---|
| `controlSearch` | `input[type=text]`, `autocomplete=off`, `aria-label="Find a setting"`, `aria-describedby="searchHelp"`, placeholder `Find a setting…` | n/a | `''` | End of `#panelTop` (the sticky header), after the rec row | `growthFilterControls()`, and the `rememberSection` toggle guard (§2.6). Hidden in v19 Simple mode (`body.simple-ui #controlSearch{display:none!important}`, from another cluster). |
| `searchHelp` | `p[role=status]` | help strings in §2.5 | idle text | Under `#controlSearch` | written by the search |
| `returnUi` | `button[type=button]`, `title="Esc"` | `Show controls · Esc` | hidden unless `body.hide-ui` | Body, immediately before `#panel` | click → `setUiHidden(false)` |

Changed attributes on existing controls: see §2.9. The keyboard map changed as shown here (TS v0.15.0 → v19):

| Key | v0.15.0 TS | v19 |
|---|---|---|
| Tab | toggle hide UI plus `preventDefault` | native focus navigation |
| F2 | none | toggle hide UI |
| Esc | show UI (after the typing check) | show UI (before the focus check) |
| any shortcut with Ctrl/Cmd/Alt | fired | ignored |
| auto-repeat | fired repeatedly (for example Backspace spam-reset) | ignored except arrows |
| focused button/summary/a | fired | **ignored** |

---

## 4. UI (DOM, handlers, CSS)

**DOM added or changed** (TS `index.html` line → change):

- `:83` `</style>`: insert the interface CSS from §2.8 before it.
- `:90` `<div id="panel">`: add `role="region" aria-label="Growth controls"`. Insert `<button id="returnUi" type="button" title="Esc">Show controls · Esc</button>` **before** it (outside the panel, so it is not `inert`).
- `:96` `#hideUi` title: `Tab` → `F2`.
- `:107-108` end of `#panelTop`: append `#controlSearch` and `#searchHelp` before the closing `</div>`.
- `:121` `midiDevice`, `:124` `micDevice`, `:127` `file`, `:130` `prevBtn`, `:131` `playBtn`, `:132` `nextBtn`, `:133` `seek`, `:144` `videoDevice`, `:201` `textIn`, `:221` `castUrl`: add the `aria-label`s from §2.9.
- `:151` `#status`: add `role="status"`.
- `:240` Keys help: `<kbd>F2</kbd> hide UI · <kbd>Tab</kbd> next control`.

**Handlers:**

- `#controlSearch` `input` → filter. `keydown` Escape → clear, blur and stop propagation.
- `MutationObserver(#engineControls)` → re-filter.
- `#returnUi` click → show the UI.
- `window` keydown: the new guard order (§2.3).
- `document` `visibilitychange` → piano `releaseAll`.
- `setUiHidden` → `panel.inert`.

**v19 overlay interaction (important for the port).** v0.17 added `#cameraLock` with `position:fixed; top:12px; right:12px; z-index:1000` (v19 `index.html:126`). That is **the same spot** as `#returnUi` (z-index 5), and it has **no hide-UI or capture-output rule**. Verified live (Appendix B-4 and B-5): in hidden-UI mode the Show-controls button is completely covered, and the camera-lock button stays visible in performance mode and in the `?ui=0` capture output.

---

## 5. Integration points (minified anchor → TS location → required change)

Name map additions used below (derived from the v19 bundle): `S5`=performanceMode, `x5`=toggleRecord, `w5`=cycleCamera, `b5`=takeStill, `rb`=loadPreset, `Bm`=ENGINE_META, `fa`=mode, `zt`=g (GlobalParams), `he`=settings, `a5`=`'midiviz_settings_v3'` (LS), `dL`=`'midiviz_presets_v1'` (KEY), `Rx`=presets array, `dJ`=snapshotPreset, `rm`=currentPreset, `PM`=renderPresets, `gJ`=savePreset, `IK`=savePresets, `FK`=loadPresets, `d5`=rememberSection, `lR`=renderEngineControls, `v5`=hideCursorSoon, `_u`=setMode, `xJ`=refreshMics, `bu`=midi, `xo`=clock, `el`=instrument, `P5`=KEY_ROW, `k5`=KEY_SEMIS, `Al`=audioContext, `nT`=toOutput, `ba`=RunningMax, `kr`=FFT, `iu`=setInteract, `kM`=textIn.

| # | Minified anchor (as patched) | TS location | Change |
|---|---|---|---|
| 1 | `window.addEventListener("blur",()=>this.releaseAll())` | `src/midi/inputMidi.ts:114` (KeyboardPiano constructor) | Add the `visibilitychange` (hidden) and `pagehide` release. Keep the listener refs for a `dispose()`. |
| 2 | `isTyping(e){…tagName…}` | `inputMidi.ts:117-120` | Replace with the shared `classifyTarget()` (§8). Do **not** treat range, checkbox or button targets as typing. |
| 3 | `window.addEventListener("keydown",i=>{var s,n;const e=i.target;if(e&&(e.tagName===…))return;const t=i.key;` | `src/midi/main.ts:998-1001` | Replace the whole handler with the shortcut dispatcher (§8.2): modifier, composition and repeat guards plus a per-key focus policy. |
| 4 | `:t==="Tab"?(pd(…),i.preventDefault())` (removed) and trailing `t==="Escape"&&pd(!1)` | `main.ts:1011-1013`, `main.ts:1028` | Remove the Tab toggle. Esc and the hide key are handled early (see §7-3 for the key choice). Delete the dead Escape branch. |
| 5 | `function pd(i){document.body.classList.toggle("hide-ui",i),` | `main.ts:971-975` `setUiHidden` | Move into a `UiVisibility` module: `panel.inert`, the body state, **all** floating overlays (`#returnUi`, `#cameraLock`, future stage buttons) and focus save/restore. |
| 6 | `c.style.gridColumn="1 / span 2",t.options.forEach` | `main.ts:149-152` (widget select branch) | `sel.setAttribute('aria-label', c.label)`. Better still, create a real `<label>` element with `htmlFor` and a unique id. |
| 7 | `u.type="range",u.min=String(t.min)` | `main.ts:179-181` (widget range branch) | Same for the range input. Add `aria-valuetext` if the label needs units. |
| 8 | `i.addEventListener("toggle",()=>{he.openSecs[e]=i.open,Hi()})` | `main.ts:298-304` `rememberSection` | Guard with `if (panelSearch.active) return`. Do not query the DOM input. |
| 9 | `function IK(i){localStorage.setItem(dL,…)}` | `src/midi/presets.ts:27-29` `savePresets` | Return `boolean` through the shared `safeStorage.write`. |
| 10 | `function gJ(i){Rx[i]=dJ(),IK(Rx),rm=i,PM(),Y("presetStatus").textContent=…}` | `main.ts:497-503` `savePreset` | Use the boolean result and show the session-only text (§2.7). |
| 11 | `aR=window.setTimeout(()=>localStorage.setItem(a5,…),250)` | `main.ts:95-99` `save()` | Use `DebouncedSaver(250)` with `flush()` on `pagehide` and `visibilitychange`, and **a one-time** failure notice (§7-6). Load at `main.ts:90-94` also goes through `safeStorage.read`. |
| 12 | `async loadTrack(…)`…`next(){` / `async startMic(`…`stopMic(){` / `async startTabCapture(`…`stopTab(){` replaced; `beginInputRequest` inserted | `src/midi/inputAudio.ts:135-157`, `:273-292`, `:234-264` | Re-implement as typed methods (§8.1) with the same generation semantics. Declare `private gen = 0`. |
| 13 | `stop(){this.pause(),this.stopMic(),…` | `inputAudio.ts:302-312` | Increment `gen` first, then release. Store and release the `channel` for pending offs (§7-12). |
| 14 | `je.source!=="file"?vs("choose an mp3 …")` | `main.ts:604-606` (`setMode` file branch) | `if (audio.source !== 'file' && !audio.pending) audio.stop()`, and resume an existing playlist if one is loaded (§7-10). |
| 15 | `"0.15.0"` → `"0.15.1"` | `src/midi/version.ts:2`, `package.json:4` | Bump to the next real version (v0.20.0 or whatever the lead decides). |
| 16 | `interface.js` appended at bundle end | New `src/midi/ui/search.ts`, wired in the boot block `main.ts:1145-1157` | Call `panelSearch.refresh()` at the end of `renderEngineControls` (`main.ts:394`) instead of using a MutationObserver. |
| 17 | `document.body.classList.toggle('capture-output', …ui==='0')` | Boot, before first paint (`index.html` inline head script, or top of `main.ts`) | Set `data-ui="capture"` before any overlay renders, so nothing flashes. |
| 18 | HTML edits (improve_html) | `index.html` lines listed in §4 | As §4. |
| 19 | `launch.py`, `start-mac.command`, `start-windows.cmd`, README text | `scripts/release.mjs:19-56` | Add `scripts/launch.py` to the repo and copy it into `dist/`. Generate the wrapper scripts with correct EOLs. Generate the README keys line from the shortcut table. Replace the `Compress-Archive` zip at `release.mjs:58-64` (§7-15). |

**Ordering constraints**

- `beginRequest()` (generation bump) must happen **synchronously at the top** of `loadTrack`, `startMic` and `startTabCapture`, before any `await`. A second click must invalidate the first before the first can resolve.
- `stop()` must bump the generation **before** it stops tracks. Stopping a track can fire `onended` synchronously in some engines, and that handler must see the stream as stale.
- The piano must see a key **before** the shortcut dispatcher. Today this depends on listener registration order (`main.ts:32` before `main.ts:998`) combined with `defaultPrevented`. Make it explicit: the dispatcher calls `piano.handleKeyDown(e)` first and stops when it returns `true`.
- `UiVisibility` must exist before `applyParams()` (`main.ts:1133-1143`), because `?ui=0` calls it.
- `panelSearch.refresh()` must run **after** `renderEngineControls` has appended all sections, and after `rememberSection` has set the initial `open` state.
- Storage load (`main.ts:90-94`) must run before `renderGlobalControls` and `rememberSection`, as today.
- `navigator.mediaDevices` `devicechange` → `refreshMics()` can be registered at boot. It must not start the mic.

---

## 6. State & lifecycle

**New state**

- `AudioInput`:
  - `inputRequest` (patched; undeclared). In TS: `private gen = 0`.
  - Recommended additions: `pending: 'file' | 'mic' | 'tab' | null` and `phase: 'idle' | 'pending' | 'live' | 'ended' | 'error'` (§8.1).
- `KeyboardPiano`: an extra `visibilitychange` listener. It is never removed; that is acceptable for a singleton, but add `dispose()`.
- Search: module-level `Map<HTMLDetailsElement, boolean>` of pre-search `open` states, plus a `MutationObserver` and the query string.
- Body classes: `hide-ui`, `hide-cursor` (both existing) and `capture-output` (new). `#panel.inert` mirrors `hide-ui`.

**Reset, clear, unmount.** None of this state is engine-scoped:

- Engine `unmount` or `selectEngine` rebuilds `#engineControls`, and search re-applies through the observer.
- `resetEngine` (Backspace) is unchanged. It re-pushes held notes as **channel 0** (`main.ts:991-995`), which makes the instrument play held audio pseudo-notes (§7-13).
- `audio.stop()` on switching to MIDI mode also invalidates pending requests.

**Persistence keys**

| Key | Owner | Changed in C1? |
|---|---|---|
| `midiviz_settings_v3` | settings (`main.ts:68`) | No (errors are now caught). |
| `midiviz_presets_v1` | presets (`presets.ts:13`) | No (errors are now caught). |
| `growth-ui-mode` | Simple/Advanced toggle | Other cluster (v19). |
| `growth-good-start-v0190` | Simple first-run look | Other cluster (v19). |

`settings.openSecs[...]` is no longer written while a search is active. There is no schema version, no migration and no reset or export.

**Storage origins (important for the owner).**

- File-origin storage differs per browser. In Chrome all `file://` pages share storage. In Firefox each file path is its own origin, so a renamed `growth-visualiser-vX.html` loses its presets.
- `http://localhost:8765/` (launcher) is a different origin from `file://`.
- Presets are therefore siloed between the single-file and folder versions. Keep 8765 and `localhost` for continuity, and add export/import (§8.4).

---

## 7. Bugs, weaknesses and questionable decisions

Severity: **H**igh / **M**edium / **L**ow. "Verified" means reproduced in Appendix B; the rest are code-reading findings with line evidence.

1. **H, verified: shortcuts die after any mouse click on a panel button or section header in Chrome.**
   - Chrome focuses `<button>` and `<summary>` on click. The v19 guard `closest("input,select,textarea,button,summary,a,[role=button]")` then swallows **every** shortcut: R record, Q still, C camera, Backspace reset, [ ] palette, digits, arrows and Space.
   - Live check: after clicking `#clear`, `activeElement` was `BUTTON#clear`, `]` left the palette at 5 and `c` left the camera unchanged. The same keys worked from `<body>`.
   - `test-input.cjs:58-61` asserts this behaviour as a feature.
   - The motive (stop Enter/Space double-activating a focused button) was valid, but the fix is far too broad.
   - **Better:** use a per-key focus policy (§8.2):
     - Buttons, summaries and links consume only Enter and Space, and only when `el.matches(':focus-visible')` (the focus came from the keyboard).
     - When focus came from the pointer, blur the element and run the shortcut.
     - Ranges consume only arrows, Home, End, PageUp and PageDown.
     - Selects consume letters, digits, arrows, Space and Enter.
     - Text entry consumes everything except Esc and the hide key.
2. **H, verified: the keyboard piano is dead after touching any slider.** `isTyping` uses `closest('input,…')`, which matches `input[type=range]`. Live check: after clicking the Simple-mode "How much the music grows" slider, pressing `a` produced **no note** and `]` did nothing. Simple mode puts three sliders right next to "Hold A–K to grow", so this directly feeds the owner's "growth does not visibly follow the music" complaint. **Better:** only text entry, `select` and contenteditable count as typing.
3. **M: F2 as the only hide-UI key is poor on Macs.** Mac laptop keyboards map F2 to brightness and need Fn+F2, and the owner's playback and preview workflow is macOS. The hint "F2 hides controls" is also invisible in v19 Simple mode, because `#searchHelp` is hidden there.
   - **Better:** accept Tab to toggle **only when focus is not inside the panel** (focus on `<body>` or the stage canvas), which is the v0.15.0 muscle memory. Tab inside the panel stays native.
   - Also accept `F2` and a positional key that the piano does not use (for example `Backquote`).
   - Keep Esc as show-only.
   - Generate the Keys help from the table.
4. **H, verified: floating overlays ignore the hide-UI and capture contract.**
   - `#cameraLock` (v0.17, z-index 1000) exactly covers `#returnUi`. Both hit tests on `#returnUi` returned `cameraLock`, so the Show-controls button cannot be clicked.
   - `#cameraLock` stays visible in performance mode and in `?ui=0` capture (the OBS Browser Source path). Verified: it shows "🔓 Lock camera" on the black output.
   - **Better:** a single `UiVisibility` state with `body[data-ui=shown|hidden|capture]`. Every overlay is tagged `.ui-overlay` and hidden unless the state is `shown`. `#returnUi` is shown only when `hidden`. Move the camera lock into `#panelTop` or a stage toolbar that hides with the UI. Offset `#returnUi` so nothing overlaps.
5. **M: Space re-activates the focused button.** Because focused buttons bypass the global handler, pressing Space for play/pause after clicking a button fires that button again. After ↺ reset it resets again. After ● rec it toggles the recording. After a look button or "Surprise me" it re-applies or re-randomises (look buttons clear the growth). v0.15.0 called `preventDefault()` on Space, which suppressed native activation. **Better:** use the §7-1 policy; with pointer-initiated focus, Space goes to transport.
6. **M, verified: the storage-failure message spams the status line.** `save()` calls `setStatus('Settings apply for this session only …')` on **every** failed debounced save. Live check: the status `input live: Test microphone` was overwritten within 1 s of pressing `]`, which hides device and recording messages.
   - **Better:** report once per session, plus a persistent small "session-only" badge in the panel header.
   - Also flush the debounced save on `pagehide` and `visibilitychange`. The 250 ms debounce loses the last change when the window closes quickly.
7. **H, verified on Windows: `launch.py` cannot detect a busy port on Windows.**
   - On Windows, CPython's `HTTPServer.allow_reuse_address=True` sets `SO_REUSEADDR`, which lets a second process bind the same port. Verified with Python 3.12.6 on Windows 11: the second instance printed "Growth is ready" instead of "Could not start Growth".
   - The browser can then be served by either process, for example an **old version's** folder still running on 8765.
   - `validate.py` only exercised this on Linux (see the NOTES_V0151 limits).
   - **Better:** subclass with `allow_reuse_address = (sys.platform != 'win32')` and set `SO_EXCLUSIVEADDRUSE` on Windows. On a conflict, probe `GET /version.json`: if it is the same app and version, just open the browser; otherwise print the message and exit 1.
8. **M: no cache control or MIME hardening in `launch.py`.**
   - `SimpleHTTPRequestHandler` sends `Last-Modified` and no `Cache-Control`, so `index.html` may be heuristically cached across version swaps on the same `localhost:8765` origin.
   - The patched lineage never renamed `index-BWYXfAkm.js`, which is especially risky.
   - Python's `mimetypes` reads the Windows registry. On this machine `.mjs` maps to `text/plain`; `.js` was fine here but is known to be overridden to `text/plain` on some machines, which breaks `<script type="module">`.
   - **Better:** add `Cache-Control: no-cache` in `end_headers()`, and set `extensions_map` for `.js`/`.mjs` → `text/javascript`, `.wasm` → `application/wasm`, `.task` → `application/octet-stream`.
9. **L: search clobbers `hidden` on every section.** `growthFilterControls()` with an empty query sets `hidden=false` on all `details.sec`, including at boot. Any future code that hides a section with the attribute (for example an engine-specific static section) gets un-hidden. Also:
   - It matches `textContent`, which includes `<option>` text and hidden rows. For example "orbit" matches any section containing a camera select.
   - It filters whole sections, so in the 134-control Organism "Growth" section a match still leaves the user scrolling.
   - Sections that do not match are hidden, including `#sec-input`, which contains `#status`, so status messages disappear during a search.
   - **Better:** filter at control-row level with explicit search text (label, group, key and optional synonyms), keep the status outside searchable sections, and track "hidden by search" with a `data-search-hidden` attribute instead of `hidden`.
10. **M: `setMode('file')` → `audio.stop()` cancels an in-flight decode.**
    - During a decode, `beginInputRequest()` has already set `source='none'`. Clicking "Audio file" again then calls `stop()`, which silently aborts the decode and shows "choose an mp3…".
    - A loaded playlist is also never resumable after visiting MIDI or mic mode, because `stop()` sets `source='none'` while the buffer and playlist remain.
    - **Better:** expose `audio.pending`. In `setMode('file')`, when `audio.playlist.length && audio.hasBuffer`, resume (`source='file'`, `play()`); otherwise stop.
11. **M: error texts are raw and sometimes empty.**
    - `OverconstrainedError.message` is often `''` in Chrome when a saved `deviceId` disappears, which yields "microphone unavailable: ".
    - `NotAllowedError` from cancelling the display picker reads as "tab capture unavailable: Permission denied".
    - The tab no-audio message lost the Windows "Entire screen + system audio" hint.
    - **Better:** a pure `describeMediaError(kind, err)` keyed on `err.name`:
      - `NotAllowedError`: permission or cancelled.
      - `NotFoundError`: no device.
      - `NotReadableError`: in use by another app.
      - `OverconstrainedError`: retry with the default device automatically.
      - `AbortError`, `SecurityError`: explained separately.
    - Restore the OS-specific guidance. Hide or disable "Tab / system audio" where `getDisplayMedia` audio is unsupported (Safari, Firefox).
12. **L: pending pseudo-notes lose their channel.** `pendingOffs` stores `{pitch, t}` only. `stop()` and the `analyze()` flush push offs with `channel:1`, while stem notes were emitted on channels 2–5 (`inputAudio.ts:310, 322, 443`). The clock keys active notes by pitch, so this is tolerated, but any engine logic keyed on the note-off channel is wrong. **Better:** store the channel.
13. **M, pre-existing and adjacent: Backspace reset replays held audio pseudo-notes into the instrument.** `resetEngine()` re-pushes every active note with `channel:0` (`main.ts:994`). The loop sends channel-0 events to `instrument.noteOn` (`main.ts:1047-1051`), and `ActiveNote` does not store a channel (`music.ts:159`). **Better:** store the channel in `ActiveNote` and re-push with the original channel.
14. **M, likely for the owner: shortcuts and the piano depend on keyboard layout.**
    - The piano and letter shortcuts use `e.key`. On AZERTY (common in Belgium and France; confirm the owner's layout), the home and top rows produce `q`, `z`, `r`, `c`, `w` and `x`. Playing the "piano" there fires **still (q), octave-down (z), record (r) and camera (c)**.
    - The v19 Alt guard blocks `[`/`]`, which need AltGr on Windows AZERTY and Option on Mac AZERTY.
    - Engines `1–5` need Shift on AZERTY, and Shift+`DigitN` is the **preset** shortcut, so engine selection by key is impossible.
    - The piano's `onUp` matches `e.key.toLowerCase()`. Holding `;` and then pressing Shift turns the key-up into `:`, so the note sticks until blur. `e.code` avoids this.
    - **Better:**
      - The piano uses **`e.code`** (positional: `KeyA`, `KeyW`, …, `Semicolon`; `KeyZ`/`KeyX` for octave), and so does its key-up.
      - Shortcuts use `e.code` for letters and digits: `Digit1-9` selects an engine without Shift, and Shift+`Digit1-8` loads a preset.
      - `[`/`]` accept `e.key` regardless of AltGraph, using `e.getModifierState('AltGraph')`.
      - Help labels come from `navigator.keyboard.getLayoutMap()` where available (Chromium), falling back to QWERTY.
15. **H, verified: the release zip is broken for macOS users.**
    - `scripts/release.mjs:60-61` uses Windows PowerShell 5.1 `Compress-Archive`. The v0.15.0 zip's central directory stores **backslash paths** (`b'assets\\index-BWYXfAkm.js'`, `b'mediapipe\\models\\…'`) with `create_system=0` and **no Unix mode bits**. `patch_release.py:25` even reads `"assets\\index-BWYXfAkm.js"`.
    - On macOS or Linux such entries can extract as flat files with literal backslashes (tool-dependent; Info-ZIP warns and converts; verify Finder's Archive Utility on a Mac). `start-mac.command` also loses its executable bit.
    - **Better:** zip in Node with forward slashes, and set `0o100755` Unix attributes (`os=3`) for `start-mac.command`. `fflate`'s `zipSync` accepts per-file `os`/`attrs`; verify the exact option names. Assert this in a post-build check.
16. **M: the v0.15.0 `release.mjs` launchers were weaker than `launch.py`.**
    - `start-mac.command` runs `open` **before** the server starts (a race gives an error page).
    - `python3 -m http.server 8765` binds **all interfaces**, which exposes the folder to the LAN or venue Wi-Fi.
    - The Windows script uses `start ""` before the server as well.
    - Keep `launch.py` (loopback, open after listen), but fix §7-7 and §7-8.
    - Minor: on macOS, `command -v python3` succeeds even for the Xcode CLT stub, which then pops an install dialog; mention it in the README.
17. **L: blanket `button, select { min-height:34px }` and `.icons` opacity .7.**
    - Every compact grid grows: 37 species toggles become about 10 rows of 4.
    - With inactive at .7 opacity versus 1, on and off are harder to tell apart than at v0.15.0's .35.
    - **Better:** apply the minimum height to primary controls only. Give icon toggles `aria-pressed` plus a clear on-state (a check mark or border). Consider a compact/comfortable density toggle.
18. **L: ARIA uses `aria-label` instead of labels.** The visible label `<span class="l">` is not associated with the control, the CC-learn tag is not announced, and icon toggles have no `aria-pressed`. Mode buttons (`modeMidi`…) should expose `aria-pressed`, and `#hideUi` should use `aria-expanded` or `aria-pressed`.
19. **L: patch-tooling artifacts.**
    - `inputRequest` is undeclared, so it only works because `undefined||0`.
    - `validate.py`'s regex `Y\("([\w-]+)"\)` misses the single-quoted `Y('…')` calls added later.
    - The tests slice minified code into `vm`. None of this should be ported; replace it with typed code and unit tests.
20. **L: no focus restore after unhide.** Hiding with `inert` blurs whatever had focus in the panel. After Esc or Show-controls, focus stays on `<body>`, so keyboard users lose their place. **Better:** remember `document.activeElement` before hiding and restore it, falling back to `#hideUi`.
21. **M, new and not in v19: MIDI stuck notes on device switch or unplug.** `MidiInput.rebind()` (`inputMidi.ts:51-67`) nulls `onmidimessage` on old inputs. That covers hot-plug `statechange` and the device `<select>`. Notes held on that input never receive their note-offs, so the organism keeps growing them. CC 123 (All Notes Off) and CC 120 (All Sound Off) are treated as ordinary, learnable CCs. **Better:** track held pitches per input id and release them on unbind or disconnect. Handle CC 120/123 as "release all on channel". Optional: sustain CC 64.
22. **M, new and not in v19: playlist and autoplay gaps.**
    - `addFiles()` does not update `srcNode.loop`. After shift-dropping more tracks onto a single playing track, the first track loops forever and never advances (`inputAudio.ts:124-129`, `176`).
    - A decode failure mid-playlist stops playback instead of skipping, and `onTrack` is not called, so the playlist highlight goes stale.
    - A file dropped before any user gesture plays on a **suspended** `AudioContext`: silent, and the analyser sees nothing. The status still says the track is playing.
    - **Better:** update `loop` in `addFiles`; skip to the next track on failure (bounded by the playlist length); call `onTrack` in both paths; and when `ctx.state !== 'running'` after `play()`, show "click anywhere to start sound".
23. **L, cross-cluster, observed live: C cycles the camera in Simple mode while the Simple "Camera: Still" select says still.** The `camCycle` label changed to "weave through" behind the lock. The C shortcut should either respect Simple camera modes or update the Simple select.

---

## 8. Recommended TypeScript design

Keep the existing module boundaries. Add a small `src/midi/ui/` folder and one storage module, with no new runtime dependencies.

### 8.1 `src/midi/inputAudio.ts` (modify `AudioInput` in place)

```ts
export type AudioSourceKind = 'none' | 'file' | 'mic' | 'tab'
export type InputPhase = 'idle' | 'pending' | 'live' | 'ended' | 'error'

export class AudioInput {
  private gen = 0                                  // was the undeclared `inputRequest`
  pending: Exclude<AudioSourceKind, 'none'> | null = null
  onPhase: (kind: AudioSourceKind, phase: InputPhase) => void = () => {}
  private beginRequest(kind: 'file' | 'mic' | 'tab'): number {
    this.stop()                                    // bumps gen first
    this.muteMonitor()                             // analyser -/-> destination only; recording taps untouched
    this.pending = kind; this.onPhase(kind, 'pending')
    return this.gen
  }
  private isCurrent(g: number) { return g === this.gen }
  get hasBuffer() { return !!this.buffer }
  resumeFile(): boolean { /* source='file', active=true, play() if buffer */ }
  // loadTrack / startMic / startTabCapture: exactly §2.1 semantics + describeMediaError + channel-aware pendingOffs
}

/** Pure; unit-tested. */
export function describeMediaError(kind: 'mic' | 'tab' | 'file', err: unknown): { text: string; retryDefaultDevice?: boolean }
```

- `stop()` does `this.gen++` first. Then: `pending=null`; pause; stop mic and tab; `active=false`; `source='none'`; zero the features; release `pendingOffs` **with their stored channel**; `onPhase(kind,'idle')`.
- Mic: if an `OverconstrainedError` or `NotFoundError` hits a `deviceId`, retry once with `deviceId: undefined` and report "selected input unavailable — using default".
- Tab capture: optionally add Chromium hints `{ systemAudio: 'include', selfBrowserSurface: 'exclude', surfaceSwitching: 'include' }` and `audio: { echoCancellation:false, noiseSuppression:false, autoGainControl:false }`. Other browsers ignore unknown members; verify in Chrome before relying on any hint. Feature-detect `mediaDevices.getDisplayMedia` and disable `#modeTab` with an explanatory title where audio capture is unsupported.
- `main.ts` subscribes to `onPhase`:
  - Mode button states: `aria-pressed`, plus a "pending…" style while `phase==='pending'`.
  - On `ended` for mic or tab, keep mode `mic`/`tab` but show a "Reconnect" button, or switch the UI back to MIDI. Choose one; the current v19 behaviour leaves the mode button lit with nothing live.
  - Register `navigator.mediaDevices.addEventListener('devicechange', refreshMics)` at boot.
- Playlist fixes from §7-22.

### 8.2 `src/midi/ui/keys.ts` (new: focus policy, shortcut table, dispatcher)

```ts
export type TargetKind = 'none' | 'text' | 'select' | 'range' | 'toggle' | 'activator' | 'file'
export function classifyTarget(t: EventTarget | null): TargetKind
//  text: contenteditable, textarea, input[type=text|search|url|email|password|number|tel]
//  select; range: input[type=range]; toggle: checkbox/radio; activator: button, summary, a[href], [role=button]
//  file: input[type=file]
/** Pure: does the focused control natively own this key? */
export function controlOwnsKey(kind: TargetKind, e: { key: string; code: string }, keyboardFocused: boolean): boolean
//  text → all except Escape/F2 ; select → letters, digits, arrows, Space, Enter, Home/End/PageUp/PageDown
//  range → Arrow*, Home, End, PageUp, PageDown ; toggle/file → Space (+Enter for file)
//  activator → Enter/Space only if keyboardFocused (el.matches(':focus-visible')); else blur() and let shortcuts run

export interface Shortcut {
  id: string
  codes?: string[]          // positional (KeyR, Digit1…) — layout-independent
  keys?: string[]           // semantic fallback ('[', ']', 'Escape', 'F2', ' ')
  shift?: boolean | 'any'
  repeat?: boolean          // arrows only
  global?: boolean          // Escape / hide key: work even from text fields
  help: string              // drives Keys panel + README line
  run(e: KeyboardEvent): void
}
export function createDispatcher(table: Shortcut[], piano: { handleKeyDown(e: KeyboardEvent): boolean }): (e: KeyboardEvent) => void
```

- Guards, in order:
  1. If `ctrlKey || metaKey`, return.
  2. If `altKey` without `getModifierState('AltGraph')`, return. The exception is `[`/`]` produced with Option on Mac.
  3. If `isComposing` or `key==='Process'`, return.
  4. If `defaultPrevented`, return.
  5. Global shortcuts: Esc (show, plus cancel CC-learn and disarm "on next note" recording) and the hide key.
  6. If `controlOwnsKey`, return.
  7. `piano.handleKeyDown(e)`; if true, return.
  8. Repeat check.
  9. Table lookup.
- Hide-UI key (§7-3): `Tab` only when `document.activeElement` is `body` or the stage canvas, plus `F2` and `Backquote`.
- `KeyboardPiano` moves to `e.code` (§7-14) and exposes `handleKeyDown` and `handleKeyUp` instead of self-registering keydown. It keeps its own `blur`, `visibilitychange` and `pagehide` release. `isTyping` becomes `classifyTarget(t) in {text, select}`.
- Generate the `#sec-keys` body and the README keys line from the same table. `release.mjs` can read the help strings from a small JSON export, or a unit test can assert that the README template contains every `help` label.
- Optional: `/` (Slash) focuses `#controlSearch`.

### 8.3 `src/midi/ui/visibility.ts` (new)

```ts
export type UiState = 'shown' | 'hidden' | 'capture'
export class UiVisibility {
  constructor(opts: { panel: HTMLElement; returnBtn: HTMLElement; hideBtn: HTMLElement; body?: HTMLElement })
  state: UiState
  set(hidden: boolean): void   // no-op to 'shown' when state==='capture' unless explicit
  toggle(): void
  // body.dataset.ui = state; panel.inert = state !== 'shown'; remembers/restores focus; hideCursorSoon (2000 ms)
}
```

- CSS:
  - `body:not([data-ui=shown]) .ui-overlay { display:none !important }` covers `#cameraLock`, future stage buttons and optionally `#countdown` in capture mode.
  - `body[data-ui=hidden] #returnUi { display:block }`. Place `#returnUi` so it cannot overlap anything, for example `top:12px; left:12px`, since the panel is hidden then.
- Keep the old `hide-ui` and `hide-cursor` classes as aliases during the port if other CSS depends on them.
- Capture state is set from `?ui=0` before first paint.

### 8.4 `src/midi/storage.ts` (new) and `presets.ts` changes

```ts
export interface KV { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void }
export function openStore(getBackend: () => KV | null = () => { try { return window.localStorage } catch { return null } }): {
  available: boolean
  read<T>(key: string, fallback: T, validate?: (x: unknown) => x is T): T
  write(key: string, value: unknown): boolean
  remove(key: string): void
  onFirstFailure(cb: (err: unknown) => void): void   // fires once per session
}
export class DebouncedSaver { constructor(write: () => boolean, ms?: number /* 250 */); schedule(): void; flush(): void }
```

- `main.ts`:
  - `settings` gets `schema: 4`. `migrate(obj)` accepts v3 (no schema field). Unknown keys are dropped and numeric fields are clamped to control ranges on load.
  - Call `saver.flush()` on `pagehide` and on `visibilitychange` (hidden).
  - On first failure, show a one-time status plus a header badge "settings: this session only".
- `presets.ts`:
  - `savePresets(list): boolean`.
  - `exportPresets(): Blob` and `importPresets(json: string): { ok: boolean; error?: string; list?: (Preset|null)[] }` with a validator: exactly `SLOTS` entries; each null or `{name: string, palette: int, globals: Record<string, finite>, engine: known id, engineCtl: Record<string, finite>}`.
  - UI: "Export slots" and "Import slots" in the Saved slots section (uses the existing `download()` from `recorder.ts`).
- Add a "Reset all settings" button with a confirm dialog that removes `midiviz_settings_v3` and reloads. It is needed with 134 organism controls and changed defaults.
- Keep the key names. Keep `localhost:8765` for origin continuity.

### 8.5 `src/midi/ui/search.ts` (new)

```ts
export interface SearchEntry { el: HTMLElement; section: HTMLDetailsElement; text: string }
export function matchEntries(query: string, entries: readonly { text: string }[]): boolean[]   // pure, case-insensitive, all words must match
export class PanelSearch {
  constructor(input: HTMLInputElement, help: HTMLElement, root: HTMLElement)
  get active(): boolean
  refresh(): void          // re-index (call after renderEngineControls)
  clear(): void
}
```

- Index per control: the `.slider` wrap, icon buttons and static `.row`s. The text is `label + ' ' + group + ' ' + key + ' ' + (c.keywords ?? []).join(' ')`, where `keywords` is a new optional field on `EngineControl` in `engine.ts`.
- Hide non-matching rows with `data-search-hidden`. Hide a section only if none of its rows match, and force-open sections that do. Save and restore `open` as the patch does. Never touch sections' own `hidden`.
- Keep `#status` outside searchable sections by moving it into `#panelTop` under the buttons, which also fixes status being invisible when "Input" is collapsed.
- Help strings: reuse the §2.5 texts, updated for the chosen hide key.

### 8.6 `index.html` / CSS

- Port the §2.8 rules with these changes:
  - Scope `min-height:34px` to `.row > button, .row > select, #panelTop button`.
  - Keep `.icons` compact with a clear active state (`aria-pressed` styles).
  - Keep `[hidden]{display:none!important}`, the focus-visible rings, the `dvh` sizing, mobile rules and reduced-motion rules.
- Use real `<label for>` associations for static inputs, and give generated widgets `id`s so `<label>` works.

### 8.7 Launchers and release (`scripts/`)

- `scripts/launch.py` (versioned in the repo, copied into `dist/` by `release.mjs`): the §2.10 behaviour plus:
  - `class Server(ThreadingHTTPServer): allow_reuse_address = sys.platform != 'win32'`, with `SO_EXCLUSIVEADDRUSE` on win32.
  - Handler `extensions_map` overrides (§7-8), `Cache-Control: no-cache`, and a quiet `log_message`.
  - A `/version.json` probe on conflict.
  - Keep `--port` (default 8765) and `--no-browser`.
- `release.mjs`:
  - Write `start-mac.command` (LF, mode 0755) and `start-windows.cmd` (CRLF) from the §2.10 templates, with the version-specific HTML filename.
  - Write `dist/version.json` (`{"version": VERSION}`).
  - Generate the README keys from the shortcut help.
  - Zip with a Node zip writer: forward slashes, Unix attributes for `.command`. `fflate` as a devDependency is the lightest option.
- Post-build assertions, replacing `validate.py`:
  - The single-file HTML contains no `<script … src=`.
  - All zip entry names contain no `\`.
  - `start-mac.command` has mode 0755.
  - Every `$('id')` used in `src/**/*.ts` exists in `index.html` (a static regex check in a unit test).

### 8.8 Do not port as-is

- The Python exact-string patchers, bundle hash checks, `validate.py` bundle parity, and `vm`-sliced tests of minified code.
- `interface.js` globals, its MutationObserver and the `document.getElementById('controlSearch')` coupling inside `rememberSection`.
- The blanket `closest('…button,summary,a,[role=button]')` exclusion.
- F2 as the only hide key.
- The per-save status message.
- The unconditional `audio.stop()` in `setMode('file')`.
- The shortened tab-capture message.
- The undeclared `inputRequest`.
- `opacity:.7` for inactive species.
- The blanket `min-height`.
- `Compress-Archive` zipping.
- `validate.py`'s "server tested on Linux" assumption.

---

## 9. Acceptance tests

The repo has no test runner. Add `vitest` with `happy-dom` as devDependencies, or `node:test` with `tsx`. The tests below are grouped by where they can run.

### 9.1 Unit (no browser)

**AudioInput** (fake `AudioContext`, `MediaStream` and deferred `decodeAudioData`/`getUserMedia`/`getDisplayMedia`, ported from `test-audio.cjs`):

1. Out-of-order decodes play only the newest, and `fileName` is the newest.
2. `stop()` during a decode means nothing plays and `active=false`.
3. A corrupt file sets `buffer=null` and `playing=false`, the status names the file, and the next track is attempted when in a playlist.
4. A late mic grant after a newer request is stopped (`track.stopped`), and `micStream` is the newer stream.
5. A late grant after `stop()` is stopped, `source==='none'`, for both mic and tab.
6. A stale rejection does not change the status.
7. `startMic` after file playback disconnects only `analyser → destination`, and the recording tap stays connected (assert the disconnect target list equals `[destination]`).
8. `onended` of the current stream means `stop()`, pending offs released **with their original channels**, and `onPhase('mic','ended')`. `onended` of an old stream does nothing.
9. `addFiles` onto a single playing track sets `srcNode.loop=false`, and natural end advances.
10. `describeMediaError`: `NotAllowedError`, `NotFoundError`, `NotReadableError`, `OverconstrainedError` (expects `retryDefaultDevice`), `AbortError`, and an unknown error with an empty message all produce non-empty, specific text.
11. After `setMode('file')` with a loaded buffer, `resumeFile()` plays. With a pending decode, `stop()` is **not** called.

**KeyboardPiano:**

12. Events with `{code:'KeyA'}` play C at octave 4 (pitch 60) whatever the `key` value (`'a'` or `'q'`). A key-up with the same code releases it.
13. Hold `Semicolon`, then key-up with `key:':'` and the same code: the note is released.
14. `repeat` and modifiers are ignored.
15. `blur`, `visibilitychange` (hidden) and `pagehide` release all notes.
16. A range, button or checkbox target does **not** block notes. Text inputs, `select` and contenteditable do.

**Shortcut dispatcher** (table-driven):

17. Each shortcut fires once, and auto-repeat is ignored except for arrows.
18. Ctrl or Meta: nothing fires. An AltGraph-produced `]` changes the palette.
19. Text input focus: only Esc and the hide key act.
20. A pointer-focused button (not `:focus-visible`): `r` records and Space toggles transport. A keyboard-focused button: Space and Enter are left to the button, `r` still records.
21. Range focus: arrows are left to the slider, and `a` plays the piano.
22. `{code:'Digit1', key:'&'}` selects engine 1. `{code:'Digit1', shiftKey:true, key:'1'}` loads preset 1.
23. `Tab` with focus inside the panel is never `preventDefault`ed. `Tab` with focus on body toggles the UI (if that option is chosen).
24. Esc cancels CC-learn and disarms "record on next note".

**UiVisibility:**

25. `set(true)` sets `panel.inert`, `data-ui=hidden` and shows `#returnUi`. `.ui-overlay` elements are hidden.
26. `set(false)` restores focus to the previously focused element.
27. Capture state: `#returnUi` and all `.ui-overlay` are hidden, and the hide or show keys do not reveal the panel.

**Search:**

28. `matchEntries` is case-insensitive and requires all words to match.
29. Select option text does not match.
30. Rows are hidden, not sections. Sections with a match are opened; clearing restores the prior `open` state; a section's own `hidden` is untouched.
31. `refresh()` after `renderEngineControls` re-applies the active query.
32. `openSecs` is not written while search is active.

**Storage:**

33. A throwing `localStorage` getter gives defaults.
34. A throwing `setItem` makes `write()` return false, and `onFirstFailure` fires exactly once across 10 saves.
35. `flush()` writes immediately.
36. v3 settings migrate to schema 4 with values clamped.
37. `importPresets` rejects wrong slot counts, unknown engines and non-finite numbers, and accepts exported JSON round-trip.
38. `savePreset` status: `saved slot N` versus `slot N kept for this session only — browser storage is unavailable`.

**MIDI** (new):

39. Unbinding or disconnecting an input with held notes pushes offs for exactly those notes.
40. CC 123 and CC 120 release all notes on that channel and are not CC-learnable.

**Release and launcher** (node plus python):

41. Zip entry names contain no `\`. `start-mac.command` has external attributes `0o100755 << 16` (`os=3`). `start-windows.cmd` uses CRLF. The single-file HTML has no external scripts. `version.json` matches `VERSION`.
42. `launch.py` serves `/` as `text/html`, `.js` as `text/javascript`, `.wasm` as `application/wasm`, with `Cache-Control: no-cache`, and binds 127.0.0.1 only.
43. **On Windows,** a second `launch.py` on the same port exits 1 with "Could not start Growth" (today it does not, see Appendix B-7). A same-version conflict opens the browser instead.
44. Ctrl+C gives exit 0.

**Static:**

45. Every `$('id')` and `getElementById('id')` literal in `src/**/*.ts` exists in `index.html`, and `index.html` ids are unique.

### 9.2 Needs a browser (manual or Playwright on Chrome, plus smoke tests in Safari and Firefox)

- B1. Click any panel button or section header, then press R, Q, C, `]`, Backspace and 1–5. Each must act. This is the regression in §7-1.
- B2. Drag the Simple "How much the music grows" slider, then hold A. A note plays and growth appears. This is the regression in §7-2.
- B3. Click ↺ reset, then press Space in file mode. The track toggles and nothing resets.
- B4. Hide the UI with the chosen key, then check:
  - Only the Show-controls button is visible, and it is clickable (no overlap).
  - The camera-lock button is hidden.
  - In performance mode (fullscreen), no overlay is visible.
  - `?ui=0` shows a clean black stage with no buttons (check in an OBS Browser Source).
- B5. Tab moves through panel controls with a visible focus ring. With the UI hidden, Tab cannot focus panel controls. Esc restores the UI and focus.
- B6. Mic tests:
  - Deny permission and get a friendly message.
  - Unplug a USB mic and get a status update and correct mode-button state.
  - Plug it back in and the device list refreshes (`devicechange`).
  - Pick a device, unplug it, restart: the app falls back to the default input with a notice.
- B7. Tab capture tests:
  - Cancel the picker and see "cancelled".
  - Share a window without audio and get the guidance text with the OS hint.
  - "Stop sharing" and the UI reflects that the capture ended.
- B8. Start decoding a large file, then immediately choose MIDI, then another track. There is no delayed playback, and the status matches the final choice.
- B9. Drop one file, then shift-drop two more. The first track advances at its end, and a corrupt middle file is skipped.
- B10. Drop a file on a fresh page before any click. The "click to start sound" hint appears, and the first click starts audible playback and analysis.
- B11. Block storage (Chrome site settings, cookies blocked) and change sliders. The notice appears once, the badge is shown, and statuses are not overwritten. Export and import presets works between `file://` and `http://localhost:8765/`.
- B12. With an AZERTY layout (OS switch): home-row piano playing never triggers record, still or camera. Engine 1–5 and preset Shift+1–8 work. `[`/`]` change the palette with AltGr.
- B13. macOS: unzip the release zip in Finder. The folder structure is intact, and `start-mac.command` runs after right-click → Open (Gatekeeper). Windows: double-click `start-windows.cmd` twice; the second reports the port is in use or opens the existing same-version server.
- B14. MIDI: hold notes on a controller, switch the device dropdown or unplug. The notes stop growing (released).

---

## Appendix A: v0.15.1 edits vs TS v0.15.0, one line each

- Piano: add visibility release, and change `isTyping` to contenteditable or `closest(input,select,textarea)`.
- Shortcuts: modifier, composition, `defaultPrevented` and repeat guards. Esc and F2 before the focus check. Focus exclusion widened to activators. Tab toggle removed.
- `setUiHidden`: `panel.inert`. New `#returnUi`, and `capture-output` for `?ui=0`.
- `widget()`: `aria-label` on the select and range.
- `rememberSection`: skip persistence while searching.
- `savePresets`: try/catch returning a boolean. `savePreset` shows the session-only message. `save()` has a try/catch status message.
- `AudioInput`: generation tokens, stale-result discarding, speaker-only disconnect, guarded `onended`, clearing on failure, `stop()` bumps the generation.
- `setMode('file')`: stop a non-file source.
- HTML/CSS: search field, `[hidden]` rule, readability, focus rings, mobile rules, reduced motion, ARIA labels and roles, Keys help.
- README, `launch.py` and platform wrappers. Version 0.15.1.

## Appendix B: evidence log (2026-09-23)

- **B-1 Baseline.** v0.19.0 served read-only from the v19 folder on `127.0.0.1:8799` and opened in a Chromium-based browser pane. With focus on `<body>`: `]` changed `#palette` from 4 to 5, `c` changed `#camCycle` to "🎥 weave through" (while Simple mode's camera was locked, see §7-23), and `a` pushed `on:60:ch0` / `off:60:ch0`. A `clock.push` spy was installed through `window.__viz` for inspection.
- **B-2 Button focus.** After a real mouse click on `#clear`: `document.activeElement` was `BUTTON#clear`. `]` left the palette at 5, `c` left the camera label unchanged, and `a` still played. This confirms §7-1.
- **B-3 Slider focus.** After a click on `#simpleGrowth`: `activeElement` was `INPUT#simpleGrowth` (range). `a` pushed **no** events and `]` had no effect. This confirms §7-2.
- **B-4 Hidden UI.** After F2: `body.hide-ui` true and `#panel.inert` true. `#returnUi` rect was (518,12,137×34) and `#cameraLock` rect (514,12,141×40). `elementFromPoint` at the left and right ends of `#returnUi` both returned `cameraLock`. The screenshot showed only "🔒 Camera locked" on the black stage.
- **B-5 Capture URL.** `?ui=0`: `capture-output` true, `#returnUi` `display:none`, `#cameraLock` `display:block`. The screenshot shows "🔓 Lock camera" on the output.
- **B-6 Storage.** `Storage.prototype.setItem` was overridden in-page to throw, and `#status` set to "input live: Test microphone". One `]` press replaced it within 1 s with "Settings apply for this session only — browser storage is unavailable".
- **B-7 Windows port conflict.** A copy of `launch.py` in the scratchpad, Python 3.12.6 on Windows 11. The first instance on port 0 got 61646. A second instance with `--port 61646` **did not fail**: it printed "Growth is ready at http://localhost:61646/". MIME types here: `.js` `application/javascript`, `.wasm` `application/wasm`, `.task` `application/octet-stream`; `mimetypes` maps `.mjs` → `text/plain` (registry). All test processes were stopped.
- **B-8 Zip.** The raw central directory of `growth-midi-visualiser/growth-visualiser-v0.15.0.zip` has entry names `b'assets\\index-BWYXfAkm.js'`, `b'assets\\vision_wasm_internal-CA13OlP-.wasm'` and `b'mediapipe\\models\\face_landmarker.task'`, all 17 entries with `create_system=0` and Unix mode `0o0`.
- **B-9 Existing tests.** `node maintenance/test-input.cjs` and `node maintenance/test-audio.cjs` pass against the v19 bundle (Node 20.20.0). `test-input.cjs:58-61` asserts the focus-exclusion behaviour that causes §7-1.
- **B-10 Anchors.** Anchors are present in the v19 bundle exactly as the patch leaves them: `visibilitychange`, `isTyping(e){…closest?.("input,select,textarea")}`, the window keydown guard, `function pd(i){Y("panel").inert=i,…`, the two `setAttribute("aria-label",t.label)`, `d5` with the search guard, `IK` try/catch, `gJ` saved flag, the `Hi` try/catch, `O5.beginInputRequest` and the three readable methods, `_u` with `je.stop()`, and `interface.js` appended after the `pd` keydown block.
