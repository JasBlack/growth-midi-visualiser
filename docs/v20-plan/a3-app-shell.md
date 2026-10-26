# A3 — App shell, inputs, music analysis, presets, recording, casting

Scope audited: `src/midi/{main,music,beat,inputAudio,inputMidi,presets,synth,audioCtx,recorder,cast,vision,videoField,engine}.ts`, `src/vision/engine.ts`, `index.html` (TS source, tag v0.15.0), cross-checked against the v0.19.0 compiled bundle `assets/index-BWYXfAkm.js` and `maintenance/*.js` in `C:\Users\User\Downloads\growth-v0190`.

Legend: **TS** = `C:\Users\User\Desktop\code\growth-midi-visualiser`, **v19** = `C:\Users\User\Downloads\growth-v0190`. "v19 status" says whether the compiled patch lineage already addresses the issue. Any v19 fix still has to be ported into TS.

---

## Findings, most severe first

### 1. [HIGH · bug/design] The v19 recorder writes files that editors don't like: fragmented, variable frame rate, odd sizes, window aspect ratio, 60 fps by default, and the whole take held in RAM

**Where:** v19 `maintenance/recorder-native.js` (class `rZ`, which replaces TS `recorder.ts`) and `maintenance/recording-ui.js` (`Vw`/`x5`, which replace TS `main.ts:788-831`).

**Scenario / evidence:**
- `this.stream=canvas.captureStream(fps)` then `this.rec.start(1000)`. Chrome's MediaRecorder MP4 output is always fragmented (moof/mdat with no up-front index), and its frame timestamps are wall-clock, so the frame rate varies. On a weak laptop that can't render at the requested rate, the gaps become irregular frame durations. This is the Quick Look / QuickTime / Resolve stutter the owner keeps reporting. v18 worked around it with `convert-for-resolve.py`, which needs ffmpeg and Python.
- `recording-ui.js`: `captureRatio=Math.min(4,target/Math.max(1,height),3840/Math.max(1,width))` followed by `renderer.setPixelRatio(captureRatio)`. three.js sizes the canvas as `floor(cssW*ratio)`. Example: a MacBook 1512×900 CSS window with a 1440 target gives ratio 1.6 and a 2419×1440 canvas. The width is odd and the aspect is not 16:9. H.264 needs even dimensions, so Chrome pads or crops, and QuickTime/Resolve treat odd widths badly. The TS v0.15 recorder forced even sizes (`recorder.ts:123-124`); v19 lost that.
- The `recFps` select defaults to **60** (`index.html:318` in v19). Asking a weak laptop for 60 fps while rendering at a higher pixel ratio (captureRatio > 1) and holding `lockQuality=true` guarantees dropped frames, which again means a variable frame rate.
- `this.chunks.push(event.data)` keeps the whole take in memory. At the default 24 Mbps, an hour-long set is about 10.8 GB, and the tab crashes before it can save. The TS path had the same problem (`fastStart: 'in-memory'` plus `ArrayBufferTarget`, `recorder.ts:157-164`).
- The recording option selects (`recAudio`, `recResolution`, `recFps`, `recQuality`, `recCompat`) are not saved to `settings`, so "Editor MP4 settings" has to be clicked again every session.

**Fix:** Bring back the v0.15 WebCodecs + `mp4-muxer` path (it produced files that open everywhere) and fix its real defects (finding 2):
1. Render at an exact even target size (1920×1080 or 1280×720), independent of the window. Use `renderer.setSize(W,H,false)` with CSS letterboxing, or render into a fixed-size render target and blit it to the screen. Never derive the output size from the window.
2. Default to 30 fps with a constant frame rate (finding 2).
3. For takes longer than a few minutes, stream to disk. Open a `showSaveFilePicker()` handle on Chrome/Edge when recording starts, use `mp4-muxer`'s `StreamTarget` with `fastStart: false`, and `FileSystemWritableFileStream.write({type:'write', position, data})` for the mdat size patch. A moov atom at the end is fine for Quick Look, QuickTime, VLC and Resolve. Keep in-memory `fastStart:'in-memory'` only for takes under about 2 GB, and warn in the status line.
4. Save the recording options in `Settings`.

**v19 status:** This regression was introduced by v17/v18. It is not fixed; only worked around by the external converter.

---

### 2. [HIGH · bug] TS v0.15 WebCodecs recorder: timestamps aren't constant-rate, audio is dropped (drift or silence), frames drop under load, and odd-width windows pay for a per-frame rescale

**Where:** TS `src/midi/recorder.ts:198-203`, `:203`, `:226-228`, `:231-240`, `:243`.

**Scenario / evidence:**
- **Silent takes.** `:198` `if (value.sampleRate !== sampleRate || value.numberOfChannels !== 2) { ... enc.close(); this.aenc = null }` drops the audio for the whole take on the first mismatched `AudioData`. This is the bug that made v17 abandon WebCodecs. `MediaStreamTrackProcessor` on a `MediaStreamAudioDestinationNode` track can deliver a different channel count or sample rate than the forced 48 kHz context, depending on platform or device.
- **A/V drift.** `:203` `else if (enc.encodeQueueSize < 40) enc.encode(value)` silently drops audio packets under load. AAC in MP4 has no gaps; sample durations are implicit. Every dropped packet moves all later audio earlier relative to the video.
- **Variable frame rate / stutter.** `:226-228` gate frames on `performance.now()` and `:243` stamps each frame with `timestamp: Math.round(t*1000)` (wall clock at grab time). Measured rAF jitter, 144 Hz displays (frames land at 34.7 ms, so about 28.8 fps effective), and `:228` `if (venc.encodeQueueSize > 8) return` all produce irregular frame durations. mp4-muxer writes these as-is into `stts`, so the declared 30 fps is not what the file contains.
- **Per-frame cost for about half of all window sizes.** `:123` rounds the width to even, so any odd `canvas.width` never equals `this.w`. The code then takes the scratch path at `:231-240` every frame: a 2D `drawImage` of the WebGPU canvas plus a 1-pixel non-uniform stretch. It also stretches the aspect when the window is resized mid-take.

**Fix:**
- **Audio:** stop using `MediaStreamTrackProcessor` for audio. Add an `AudioWorkletNode` tap on the record bus (`audioCtx.ts`: `recordDest`'s input) that posts Float32 blocks to the main thread (or a worker). Build `new AudioData({format:'f32-planar', sampleRate: ctx.sampleRate, numberOfChannels: 2, numberOfFrames, timestamp: framesSoFar*1e6/sr, data})`. The format is then known by construction and timestamps are exact to the sample. Never drop audio: if the encoder falls behind, drop video frames instead.
- **Video, constant frame rate:** keep a frame counter `n` and set `timestamp = n * 1e6 / fps`. On each rAF, compute `due = floor((now - t0) * fps / 1000)`. While `n < due`, encode the latest canvas (duplicating the frame if rendering fell behind; to save work, reuse one `VideoFrame` and `clone()` it). If `n > due`, skip this rAF. Audio timestamps come from the same `t0`, taken from `ctx.currentTime` at start, so the tracks line up.
- **Odd sizes:** crop with `new VideoFrame(canvas, {timestamp, visibleRect:{x:0,y:0,width:w,height:h}})` instead of the scratch-canvas rescale, or better, make the render target an exact even size (finding 1).

**v19 status:** v19 replaced this recorder with MediaRecorder instead of fixing it (see finding 1).

---

### 3. [HIGH · bug] MIDI clock sync fires beats twice, never times out, and the Start/Continue handling is off

**Where:** TS `src/midi/beat.ts:44-60`, `:95-114`; `src/midi/inputMidi.ts:73-74`. Unchanged in v19 (bundle class `B5` has identical logic).

**Scenario / evidence:**
- **Double beats.** `clockTick` sets `nextBeat = t` on every 24th tick (`:48-51`). `tick()` also free-runs: when `t >= nextBeat` it fires and sets `nextBeat += period` (`:105-110`). If the rAF frame at about `lastBeat+period` runs *before* the next 24th 0xF8 message is handled (roughly a coin flip each beat given main-thread jitter), the predicted beat fires first. Then the real tick arrives and resets `nextBeat` to a time that has already passed, so the next frame fires a second hit and `beat++` again. Consequences: `beat % 4` bar boundaries wander, and `barHit` fires on the wrong beats. That affects `beatPalette` (main.ts:1072-1079), organism `beatLock` triggers (organism.ts:2509-2510, 2613), `shellCycleBeat` (2311), and the pulses at 2133/2529.
- **Phantom beats forever.** The `source === 'clock'` state never times out; only `'onsets'` does (`:99-104`). When the DAW stops sending 0xF8, `period` stays set and beats keep firing at the last tempo indefinitely. With `beatPalette` on, the palette keeps changing every bar in silence. 0xFC (Stop) is ignored (`inputMidi.ts:73-75`).
- **Start off-by-one.** After 0xFA, `ticks=0`. The first 0xF8 makes `ticks=1`, and a beat only fires at `ticks=24`, which is the *start of beat 2*. By the MIDI spec, the first clock after Start is the downbeat. Bars end up permanently shifted by one beat.
- **Continue resets.** 0xFB (Continue) goes to `clockStart()` (`inputMidi.ts:74`) and resets the beat count to 0, so a paused-then-continued song loses its bar alignment. `clockStart` also doesn't clear `nextBeat`, which leaves a stale prediction that can fire right away.
- **Jitter in the clock period.** `clockTick` uses `performance.now()` at handler time (`music.ts:129`), not `MIDIMessageEvent.timeStamp`, so BPM comes from main-thread-delayed times with no smoothing (`period = t - lastBeatT`, no filter).
- **Onset phase correction only works one way.** `beat.ts:40` only snaps when an onset comes *before* the predicted beat. A late onset is compared against the already-advanced `nextBeat` (about one period away), so it never corrects.

**Fix:**
- **Clock mode:** don't free-run. `clockTick` counts ticks and sets `pendingBeat = true` when `(ticks-1) % 24 === 0`. `tick()` fires only on `pendingBeat`. Use `e.timeStamp` and a smoothed period (EMA over the 24-tick intervals) only for `phase`.
- Time the clock source out 0.5 s after the last tick, and handle 0xFC. 0xFB should keep the counters.
- **Onset mode:** use a PLL. Measure the error against the *nearest* beat (the last one fired or the next one) and nudge `nextBeat += 0.2 * err`.
- Add vitest unit tests for `BeatTracker`. This is pure logic that fakes easily. The TS repo has no tests at all.

---

### 4. [HIGH · bug] MIDI channels clash with the internal pseudo-channels; the instrument is silent on MIDI channels 2–16; held notes are tracked by pitch only

**Where:** TS `src/midi/main.ts:1048`; `src/midi/engines/organism.ts:1512-1516`; `src/midi/music.ts:157-166`; `src/midi/inputAudio.ts:434-452, 469-471`. Unchanged in v19 (bundle loop `a.channel===0&&(...el.noteOn...)` and the same `speciesFor`).

**Scenario / evidence:**
- `inputMidi.ts:77` passes the real MIDI channel (0–15) as `channel`. `inputAudio` reuses the same field as a *source tag*: `channel: 1` means audio pseudo-note, and 2–5 mean stems.
  - `main.ts:1048` `if (ev.channel !== 0) continue // audio pseudo-notes never play the instrument`. Any controller or DAW sending on MIDI channel 2–16 gets no instrument sound.
  - `organism.ts:1514` `if (channel >= 2 && channel <= 5)` sends notes on **MIDI channels 3–6** through the *stem* species selects (`stemDrums/stemBass/stemVoice/stemOther`), so a keyboard on channel 3 grows "drums" species.
- `MusicClock.active` is a `Map<pitch, ActiveNote>` (`music.ts:159,164`), and organism `byPitch` is keyed the same way. Two channels layering the same pitch (a split/layer, or a DAW sending bass and pad on different channels) behave wrongly: the note-off on channel A deletes the note still held on channel B, and the growth stops.
- The same thing happens across sources. In audio mode with MIDI connected, a pseudo-note on pitch P schedules an off at +0.2–0.6 s (`inputAudio.ts:472`), and that off kills a real held MIDI key on P.

**Fix:** Add a `source: 'midi'|'keys'|'audio'|'stem'` field and a separate `stem?: 0..3` field to `NoteEvent` (plus `ActiveNote`), and keep `channel` meaning MIDI channel only. Key active notes by `(source, channel, pitch)`, or keep a per-pitch reference count so a pitch is only released when every holder has released it. The instrument should play `source === 'midi' || 'keys'`, optionally filtered by a channel setting.

---

### 5. [HIGH · bug] Stuck notes and cut-short notes: sustain pedal ignored, All-Notes-Off ignored, unplugging or switching devices leaves notes stuck, and there is no panic

**Where:** TS `src/midi/inputMidi.ts:51-67, 79-91`; `src/midi/music.ts:120-122, 141-144`; `src/midi/main.ts:991-996`. Unchanged in v19. v15.1 only added `visibilitychange` release for the *computer keyboard*.

**Scenario / evidence:**
- **CC64 (sustain) is only stored** (`music.ts:120`; the doc comment at `music.ts:46` even names it). A pianist holding the pedal lifts keys, and the growth releases or retracts while the sound is still ringing. For "growth should visibly follow the music" this is the main MIDI-keyboard gap. The instrument (`synth.ts`) also ignores the pedal. CC66 (sostenuto) is ignored too.
- **CC120/123** (All Sound Off / All Notes Off, which some DAWs send on transport stop) are ignored. Any notes still held on stop grow forever.
- **Device changes.** `rebind()` (`inputMidi.ts:51-60`) unbinds inputs on `onstatechange` or `select()` without releasing their held notes. If a controller is unplugged mid-chord, or the user switches the device select while a key is down, those pitches stay in `clock.active` forever. Pitch bend and CC1 also stay at their last values, and `main.ts:1071` keeps turning `g.rotNow` with `m.pitchBend*0.8 + m.cc[1]*0.5`, so the camera drifts forever.
- **Reset makes stuck notes worse.** Backspace re-pushes every held note (`main.ts:994`), so the only escape is switching input mode (`setMode` → `clock.allOff()`).

**Fix:**
- In `MusicClock`, track the pedal. While `cc[64] >= 0.5`, move note-offs into a `sustained` set and flush them when the pedal goes up (still honouring a re-strike). Mirror this in `Instrument`.
- Handle CC120/123 as `allOff` for that channel.
- In `MidiInput`, keep `held: Map<inputId, Set<key>>`. On unbind, a `state==='disconnected'` event, or `select()`, push offs for those notes and reset `pitchBend` and `cc[1]`.
- Add a panic action (Shift+Backspace or a button) that calls `clock.allOff()`, `instrument.allOff()` and clears pedal state.

---

### 6. [HIGH · perf/bug] Preset morphs and CC-mapped knobs call expensive `setControl` every frame or message; presets also overwrite machine-specific performance settings

**Where:** TS `src/midi/main.ts:505-534` (`loadPreset`, `queue`), `presets.ts:50-59` (`Morph.tick`), `main.ts:548-551` (CC apply), `main.ts:350-351, 359-367` (icon all/none), and organism `setControl` (organism.ts:762-777). Same in v19 (`o5.tick()` in the loop; `simpleApplyLook` in `simple-ui.js` sets about 30 controls plus 37 species one at a time).

**Scenario / evidence:**
- `queue()` morphs every numeric control with `step < 1` for 2 s. `Morph.tick` → `ctl.set` → `e.setControl(key)` then runs *every frame* for:
  - `quality` (step 0.05, organism.ts:417) → `renderer.setPixelRatio` + `resize()`, which reallocates the canvas and swapchain every frame for 2 s. That causes visible hitching, and during a recording it changes the resolution mid-take.
  - `shellSize` (step 0.5) → `rebuildShell()` (new geometry every frame).
  - every `video*` key (`videoDepth` step 0.5, etc.) → `rebuildBackdrop()` every frame.
- Icon toggles apply immediately, one at a time. Each `sp:i` runs `respawnHeld()` (organism.ts:765). Loading a preset, "all"/"none", `randomMix`, or v19's `simpleSpecies` does **37 respawns in one frame**. `applyShaders()` rebuilds the material and sky when `shader`/`envShader` appear in a preset.
- A MIDI CC mapped to `quality`, `shellSize` or `videoDepth` does the same work per CC message (up to about 1 kHz from a fast knob).
- **Performance settings travel with presets.** `snapshotPreset()` (`main.ts:441-447`) stores `quality`, `budget` and `autoQuality`. Loading a slot saved on a fast desktop onto the weak laptop sets `budget` to 250k and `autoQuality` to 0. `NO_RANDOM` (`main.ts:463-469`) protects these keys only for random mixes.
- Minor: every `set` calls `save()`, so there are about 130 `clearTimeout`/`setTimeout` pairs per frame during a morph.

**Fix:**
- Split controls into "cheap" and "rebuild" classes (a `rebuild: true` flag on `EngineControl`). Rebuild-class controls snap at the end of the morph (or once at the start) and are never interpolated.
- Batch changes through `engine.setControls(record)`, which runs `respawnHeld`, `applyShaders` and `rebuildShell` at most once.
- Coalesce slider `oninput` and CC changes to one apply per rAF.
- Exclude `NO_RANDOM` (the performance, output and model keys) from `snapshotPreset` and `loadPreset`.

---

### 7. [MEDIUM-HIGH · bug/design] Audio onset and energy detection is blurred, depends on frame rate, and turns the mic noise floor into full energy

**Where:** TS `src/midi/inputAudio.ts:15, 18-24, 77, 330-409`. v19 changes only the threshold constants (`patch_consolidation.py:32-33`, the `__growthAudioSensitivity` scaling).

**Scenario / evidence:**
- **Smoothing blurs onsets.** `analyser.smoothingTimeConstant = 0.55` (`:77`) also smooths `getFloatFrequencyData`, so spectral flux between frames is smeared over about 3 frames and the peak drops by about 45%. On top of that, `FFT = 4096` at 48 kHz is an 85 ms window, so attacks are both late and soft. For the owner's "obvious music visualiser" goal this is the main reason drums and plucks don't produce crisp new strands.
- **Flux on linear magnitudes** (`:356, 363-364`) is dominated by bass. A kick drowns hi-hat and snare onsets. Standard practice is log-magnitude (dB) or half-wave-rectified log flux, split into bands.
- **Frame-count windows, so results depend on fps:**
  - `fluxHist` holds 24 *frames* (`:399-400`): 0.8 s at 30 fps, but 0.17 s at 144 Hz, where the median threshold follows the onset itself and hits are missed.
  - `RunningMax` decays `*0.997` *per frame* (`:21`): about 3.8 s half-life at 60 fps and about 1.6 s at 144 fps.
  - `stemHist` uses 30 frames (`:417`).
- **Noise floor normalised to full scale.** `RunningMax` floors at `1e-4`. After a loud passage ends and the room goes quiet, `v` decays toward the mic's noise RMS (about 1e-3), so `energy = x/v ≈ 1` on pure noise. Both gates (`:396` `energy < 0.03` → chroma off; `:405` `energy > 0.04`) use this *relative* energy, so they no longer gate silence. Pseudo-notes start spawning from room noise after about 20–40 s of quiet.

**Fix:**
- Add a second `AnalyserNode` for onsets with `fftSize = 1024` (21 ms) and `smoothingTimeConstant = 0`. Compute half-wave log-flux in about 3 bands (low <150 Hz, mid, high >2 kHz). Keep the 4096 analyser for chroma only.
- Make every history window and decay time-based: keep `(t, value)` pairs for the last 0.5 s, and use decay `exp(-dt/τ)`.
- Give `RunningMax` an absolute floor (for example RMS 0.003 ≈ -50 dBFS) and add an absolute gate: `rms < floor` → energy 0, no onsets.
- Save the sensitivity setting (v19 keeps it only in `globalThis.__growthAudioSensitivity`).

---

### 8. [MEDIUM · design] Audio pseudo-notes are too short, sit in one octave, and don't track harmony, so audio-driven growth doesn't visibly follow the music

**Where:** TS `src/midi/inputAudio.ts:454-475`, `:435-452`.

**Scenario / evidence:**
- Each onset emits at most 2 notes lasting `0.18 + 0.4*(1-strength)` s (`:460`), which is about 0.2 s for strong hits. The organism grows only while a note is held, so audio input produces short spurts that immediately release or retract. v19's calm defaults (`musicAmount .42`, `fillRate 240`, `sustain .2`) shrink these further. This matches the lead's observation of about 300 segments for 2 s of held notes.
- The octave comes from the chroma-weighted spectral centroid over 55–4200 Hz (`:457-458`). For real mixes that centroid sits around 500–1500 Hz, so `oct` is almost always 4–5. `notePos()` maps octave to radius, so all audio growth lands on one ring: the uniform, radial look the owner doesn't want.
- `emitted === 2 ? 12 : 0` (`:464`) is dead code because the loop breaks at `emitted >= 2`, so the intended octave-up third note never happens.
- Stem drums use `36 + random(12)` (`:439`), which scatters a new plant to a random pitch-class angle on every hit. That reads as noise, not rhythm.

**Fix:**
- Add *sustained* pseudo-notes. Track the smoothed chroma. When a pitch class stays above 0.6 for more than 150 ms, hold a note-on until it falls below 0.4, so chords and pads grow long structures. Onsets then add short branch bursts on top of the held structure. Emit onsets from the low band on low octaves (2–3) and high-band onsets on octaves 5–6.
- Map drum hits to *pulses or branch events on existing plants* (the `beat.hit`/`onset` already exist) instead of spawning new random plants.
- Use `source: 'audio'` from finding 4 so the engine can pick an audio-appropriate growth profile.

---

### 9. [MEDIUM · bug/UX] Keyboard handling depends on the keyboard layout, and in v19 shortcuts stop working after clicking any panel button

**Where:** TS `src/midi/inputMidi.ts:102-147` (`e.key.toLowerCase()`), `main.ts:998-1029`. v19: piano class `D5` still uses `e.key`; the v19 global handler returns early when `e.target.closest("input,select,textarea,button,summary,a,[role=button]")`.

**Scenario / evidence:**
- **AZERTY** (likely for a Belgian user). The physical key at QWERTY-A types `q`, and `q` is *Take still* (`main.ts:1018`). Pressing where "C" should be saves a PNG. The QWERTY-W position types `z` (octave down); `a` sits at QWERTY-Q. Unshifted top-row digits on AZERTY type `& é " ' (`, so `1`–`5` engine switching (`main.ts:1007`) doesn't work, and Shift+digit loads a preset (checked via `e.code`) where it should switch engine.
- **v19 shortcuts go dead.** After the user clicks any button (rec, reset, a look, a species icon), focus stays on it, so every global shortcut is ignored: R, Space, Backspace, digits, Enter, C, Q, [ ]. The piano keeps working because `D5.isTyping` excludes only inputs. Pressing R to stop the take you just started with the mouse does nothing.
- v15.1 already fixed repeat and modifier guards, F2 for hiding the UI, and Enter not firing performance mode on focused buttons (visible in the v19 bundle).

**Fix:**
- Use `e.code` (`KeyA`, `KeyW`, …, `Digit1`) for the piano and for number and letter shortcuts. Put the physical-layout map in `KEY_ROW`.
- For focused buttons, skip only Enter and Space, not every shortcut. Or call `(document.activeElement as HTMLElement).blur()` on `pointerup` inside `#panel` buttons.

---

### 10. [MEDIUM · bug] Races and leaks when opening the camera, video or gestures (camera light stays on)

**Where:** TS `src/midi/videoField.ts:102-119`, `:85-100`, `:112`; `src/midi/vision.ts:29-58`; `main.ts:687-705, 950-961`. v15.1 notes say: "Camera permission races remain a useful follow-up". Not fixed in v19.

**Scenario / evidence:**
- **Camera race.** `openCamera` calls `stopCamera()` *before* `await getUserMedia`. Double-click 📷, or click it while the `videoDevice` `onchange` open is pending: both awaits resolve, `this.stream` is overwritten, and the first stream is never stopped. The camera light stays on until reload. `openFile` racing an in-flight `openCamera` works the same way: the late camera stream replaces a playing file.
- **Gestures race.** `GestureInput.start` sets `running = true` only after `getUserMedia` and the MediaPipe `init` (several seconds). The button handler (`main.ts:950-961`) checks `gestures.running`, so a second click during loading calls `start()` again. That creates a second stream plus a second `VisionEngine` with face and hand models (tens of MB of WASM/GPU memory), and the first one leaks.
- **Uncaught `play()`.** `await v.play()` (`vision.ts:41`) and `await this.video.play()` (`videoField.ts:116`) aren't wrapped. A rejection leaks the stream and leaves `this.stream` set.
- **Bogus load.** `this.video.src = ''` (`videoField.ts:112, :141`) makes the element try to load the *page URL* as media and fire an error. Use `removeAttribute('src'); load()`.

**Fix:** Use the same `request` generation pattern as `maintenance/audio-methods.js`. Add `private req = 0`; take `const r = ++this.req` before each await; afterwards, if `r !== this.req`, stop the tracks and return. Set a `starting` flag in `GestureInput` and make the button toggle cancel a start in progress.

---

### 11. [MEDIUM · bug] Gestures can't work from the offline single-file HTML

**Where:** TS `src/vision/engine.ts:17-19` (wasm via `?url`), `:36-40` (`'/mediapipe/models/...'` root-absolute), `vite.config.ts` (`base: './'`), `scripts/release.mjs:11` (inlines only the JS bundle). v19 bundle: `n5=""+new URL("vision_wasm_internal-Uq1_n2E_.js",import.meta.url).href` inside `growth-visualiser-v0.19.0.html`.

**Scenario / evidence:**
- In the single-file build the module is inline, so `import.meta.url` is the *HTML file's* URL. The wasm glue and binary then resolve next to the HTML, but in the ZIP they live in `assets/`.
- The model paths are root-absolute: under `file://` they resolve to `file:///mediapipe/...` (the drive root), and under `launch.py` the standalone page still points at the wrong wasm path.
- `fetch()` of `file://` URLs is also blocked in Chrome, so `ensureWasmGlue` fails regardless.
- Result: 🖐 gestures report "vision failed (run yarn vendor?)" in the owner's primary delivery format.

**Fix:**
- Resolve model and wasm URLs relative to the document (`new URL('assets/…', document.baseURI)`) and use relative model paths.
- In the single-file build, feature-detect `location.protocol === 'file:'` and show a clear "gestures need the served version (start-mac/start-windows)" message.
- Alternatively, inline the models and wasm as base64 blobs behind a lazy import. That adds about 13 MB; offer it as an optional "full" standalone.

---

### 12. [MEDIUM · bug] Casting: switching engine freezes the cast, an orphaned WHIP session can block republishing, there's no cleanup on unload, and no reconnect

**Where:** TS `src/midi/cast.ts:23-95`; `main.ts:907-916`. Unchanged in v19. v19 blocks engine switches only while *recording* (`Fm`: `if((hl.recording||recordingBusy)&&te?.id!==i)`).

**Scenario / evidence:**
- **Engine switch.** Each engine creates its own canvas and removes it on unmount (organism.ts:575, 2776-2789). `caster.start(canvas)` captures that canvas, so after a pattern switch (keys 1–5, a preset for another engine, or a program change) the WHIP stream shows a frozen last frame while the status still says "live".
- **Stop during connect.** Calling `stop()` while `start()` is awaiting `fetch` still lets the old `start` run `this.location = r.headers.get('Location')` (`:68`) *after* the stop. The mediamtx session is created and never DELETEd. mediamtx then refuses the next publish on the same path ("someone is already publishing") until ICE times out. `set('error')` (`:81`) also overwrites the `stopped` state.
- **No unload cleanup.** Nothing sends the DELETE on `pagehide`/unload, so closing the tab leaves the server-side session until timeout.
- **No reconnect.** ICE `failed` is terminal and there is no reconnect. That is unsuitable for long live shows.
- **Offline / privacy.** `stun:stun.l.google.com` sends a request to the internet even for LAN casting, and it's pointless offline.

**Fix:**
- Add an `onCanvasChanged` hook in `selectEngine`. When casting, call `tr.sender.replaceTrack(newCanvas.captureStream(fps).getVideoTracks()[0])` and stop the old track.
- Guard `start` with a generation token (`if (this.pc !== pc) { DELETE location; return }`).
- On `pagehide`, call `fetch(location, {method:'DELETE', keepalive:true})`.
- Auto-reconnect with backoff on `failed`.
- Default to `iceServers: []` (LAN) with an optional STUN setting.

---

### 13. [MEDIUM · bug/design] "Copy capture URL" encodes only a preset slot number, and OBS has its own storage, so the capture loads an empty slot

**Where:** TS `src/midi/main.ts:1114-1143`.

**Scenario / evidence:** `captureUrl()` writes `?ui=0&preset=N&engine=…&cam=…`. `applyParams` then runs `loadPreset(N-1)`, which reads *this browser profile's* `localStorage` (`presets.ts:16-25`). An OBS Browser Source (CEF) has its own storage, so the slot is empty ("slot N is empty") and the capture shows default settings, not the look the user set up. The Spout/Syphon/NDI workflow documented in `index.html:229-232` depends on this.

**Fix:** Serialise the full preset (engine, controls, palette, globals) into the URL hash as compressed JSON (`CompressionStream('deflate-raw')` → base64url, about 1–2 KB). Keep `preset=N` as a fallback. Also validate `parseInt` results: `?preset=abc` currently gives `presets[NaN]`, and `?cam=x` stores `NaN` into the control and settings (`main.ts:1137-1139`).

---

### 14. [MEDIUM · bug] v19: the first-run curated look races the async engine mount; engine requests during a mount are silently dropped

**Where:** v19 `maintenance/simple-ui.js` (last lines: `setTimeout(()=>{... if(first)simpleApplyLook('roots')},700)`); TS `main.ts:245-249` (`if (mounting) return`).

**Scenario / evidence:**
- WebGPU `renderer.init()` plus the first shader compiles can take more than 700 ms on a weak laptop. `simpleApplyLook` sees `te` null and calls `await Fm('organism')`, which returns immediately because `tT` (mounting) is true. The look then returns without applying anything. The first-run key `growth-good-start-v0190` is written *before* the attempt, so the curated first look never applies on exactly the machines it was meant for.
- The same silent drop affects fast `1`/`2` key presses, a program change during boot (`applyParams` → `selectEngine`), and `softOnly`/`simpleModelFile` in v19.

**Fix:** Make `selectEngine` return a promise for the *current* mount. Queue the most recent requested id and run it after the in-flight mount finishes. Set the first-run key only after the look is applied, triggered by an `engineReady` event rather than a timeout.

---

### 15. [MEDIUM · bug/perf] Hidden tabs and slow frames: the event queue grows without limit, frame-rate readout and growth rate are wrong on slow machines, and recordings freeze when throttled

**Where:** TS `src/midi/music.ts:116-118, 149`; `main.ts:1082`; `recorder.ts:217-253`.

**Scenario / evidence:**
- **Burst after hiding.** While the tab is hidden or the window is occluded, rAF stops but MIDI keeps pushing into `pending` (`music.ts:116-118`), which has no bound. On return, every accumulated on/off is applied in one frame and the organism spawns dozens or hundreds of plants at once. That frame spikes and the burst reads as garbage.
- **dt clamp distorts time.** `dt` is clamped to `[0.001, 0.05]` (`music.ts:149`). Below 20 fps (weak laptop plus 1440p recording), simulation time runs slower than real time, so growth per note shrinks and wall-clock pseudo-note durations fall out of step. `fpsEma` in both the HUD (`main.ts:1082`) and the organism's auto quality uses the clamped `dt`, so the HUD never shows below 20 fps: 10 fps reads as 20.
- **Recording freezes.** Grabbing is rAF-driven, so an occluded or minimised window freezes the video while the MediaRecorder audio keeps running (v19), or produces gaps (TS).

**Fix:**
- When draining, drop on/off pairs that both happened while hidden, and cap the drain at about 32 events per frame (keep the latest note-ons).
- Use raw `dt` for FPS measurement. Clamp only for integration, and use sub-steps when `dt > 0.05`.
- Show a "tab hidden: capture paused" warning during recording/casting, and recommend `--disable-backgrounding-occluded-windows` in the OBS notes.

---

### 16. [MEDIUM · design/perf] Audio files are fully decoded into RAM, and each playlist track is re-decoded, leaving a silent gap

**Where:** TS `src/midi/inputAudio.ts:135-157, 176-182`. v19 `audio-methods.js` keeps the full decode.

**Scenario / evidence:**
- `decodeAudioData` of a 1-hour DJ mix at 48 kHz stereo float32 is 48000·3600·2·4 ≈ **1.38 GB**. On an 8 GB laptop the tab crashes or the whole machine stalls; a 2-hour set always fails.
- At a natural end, `onended` → `next()` → `loadTrack` → `file.arrayBuffer()` + a full decode, giving 1–5 s of silence with no analysis between tracks. The playlist loops back to earlier tracks and decodes them again.

**Fix:** Stream files longer than about 10 minutes through an `<audio>` element with `createMediaElementSource`. The comment at `:7-10` about embedded/headless browsers doesn't apply to Chrome/Edge desktop; keep the buffer path for short files. Pre-decode the next track during the last 20 s of the current one, and cross-fade.

---

### 17. [MEDIUM · bug] TS: returning to Audio-file mode after a MIDI detour loses the loaded track, and the play button stops working

**Where:** TS `src/midi/main.ts:597-607`; `inputAudio.ts:302-307`. Still present in v19 `_u` (`je.source!=="file"?(je.stop(),vs("choose an mp3…")):je.active=!0`).

**Scenario / evidence:** Load a track → switch to MIDI (calls `audio.stop()`, which sets `source='none'`) → back to Audio file. Because `audio.source !== 'file'`, the status asks you to choose a file again. The transport is still visible (`duration` is still non-zero because `buffer` was kept), but ▶ calls `togglePlay()`, which returns immediately since `source !== 'file'`. The playlist UI still lists the tracks, and clicking one decodes it again.

**Fix:** When leaving file mode, `pause()` without clearing `source`/`buffer`. When re-entering, if `audio.buffer` exists, set `active = true` and restore the transport (optionally auto-resume).

---

### 18. [MEDIUM · bug] TS index.html: the `hidden` attribute is overridden, so the countdown digit and ♪ stay on screen and the transport shows in MIDI mode

**Where:** TS `index.html:88` (`#countdown` with inline `style="...display:flex..."`), `:39` (`.row { display:flex }` applied to `#transport`, `#micRow`, `#fileRow`, `#stemsRow`, `#videoDeviceRow`), `:63` (`.playlist` flex).

**Scenario / evidence:** An author `display` value beats the UA `[hidden]{display:none}`. After a countdown, `cd.hidden = true` doesn't hide the last digit "1" (and the note-arm "♪"), which stays on the performance screen. Hidden rows show anyway.

**Fix / v19 status:** Fixed in v15.1 by adding `[hidden]{display:none!important}` (`maintenance/interface.css`). Port it into TS `index.html`.

---

### 19. [MEDIUM · design] Stored settings have no versioning or validation, and all `file://` builds share one storage in Chrome

**Where:** TS `src/midi/main.ts:68-99, 255-256`; `presets.ts:13-29`.

**Scenario / evidence:**
- `Object.assign(settings, JSON.parse(...))` and `c.value = saved[c.key]` don't clamp to `min`/`max`, check option ranges, or reject `null`. `NaN` goes through JSON and comes back as `null`, and `ctl()` then returns `null`, which becomes 0 in arithmetic. A removed option index leaves a `<select>` blank.
- Species keys are *positional* (`sp:${i}`, organism.ts:373). Presets saved before v17/v18 appended species don't contain the new keys, so loading them leaves the soft species in whatever state they were in. Any reorder silently corrupts every preset.
- New defaults, such as v19's calm values, never reach existing users because saved values always win. There's no migration step.
- Chrome gives every `file://` page the same storage. Opening the older `growth-visualiser-v0.15.1/16/17.html` files next to v19 writes the same `midiviz_settings_v3`/`midiviz_presets_v1` keys with each version's control set. v15.1's notes say different filenames may get different storage; in Chrome they don't (Firefox isolates per file).
- Not saved: MIDI device (`midi.selectedId`), mic device, stems toggle, audio sensitivity (v19), and recording options (v19).

**Fix:**
- Store `{schema: N, ...}`, migrate on load, and clamp and validate every value against the control definition.
- Key species by name (`sp:roots`) and map old `sp:i` keys once during migration.
- Add a small "what changed in defaults" migration per version.
- Save device ids and the other missing options.

---

### 20. [MEDIUM-LOW · perf] `ctl()` does a linear search on every call, and v19 calls it per segment

**Where:** TS `src/midi/engine.ts:79-87` (`controls.find`), 107 call sites in organism.ts, 38 inside `frame()`. v19 `maintenance/music-focus.js`: `focusLevel()` calls `G(this.controls,'musicFocus')` and `G(...,'musicTrail')` per segment, and `refreshMusicFocus` writes 800 segments per frame.

**Scenario / evidence:** With about 170 controls in v19, that's 800 × 2 × up to about 170 string comparisons, roughly 270k per frame, before counting the per-frame calls, all in the hot path of a weak laptop.

**Fix:** In `mount`, build `Map<string, EngineControl>` (the controls array is fixed per engine; rebuild it in `onControlsChanged`). Have `ctl()` use the map, or read per-frame constants once at the top of `frame()` and pass them down.

---

### 21. [LOW-MEDIUM · bug] Reset re-sends held notes as channel-0 note-ons: the synth re-attacks, audio pseudo-notes play through the instrument, and a fake onset is fed to the beat tracker

**Where:** TS `src/midi/main.ts:991-995`. Same in v19 (`M5`).

**Scenario / evidence:** `clock.push({kind:'on', ..., channel: 0})` for every active note:
- The loop at `main.ts:1047-1051` then `instrument.noteOn`s them, so every held note audibly re-attacks on Backspace.
- In audio mode the pseudo-notes (originally channel 1) *play through the instrument* as well.
- `ActiveNote` doesn't keep the channel, so stem notes regrow as normal species.
- The re-push also counts as an onset (`music.ts:160, 228`), which disturbs tempo estimation.

**Fix:** Add a `regrow` or `synthetic` flag to `NoteEvent` (the instrument and beat tracker ignore it), and keep `channel`/`source` in `ActiveNote`. Or call `engine.regrowHeld(active)` directly instead of going through the clock.

---

### 22. [LOW-MEDIUM · UX/design] CC learn and program change: no channel or device awareness, species icons can't be mapped, and learn grabs any CC

**Where:** TS `src/midi/main.ts:537-553`, `:337-368` (icons get no `oncontextmenu`).

**Scenario / evidence:**
- `ccMap` is keyed by CC number only. Two controllers, or two channels, using CC 20 both drive the same control.
- Learn maps the *first* CC that arrives. A sustain pedal nudge or a controller sending CC bursts grabs the mapping.
- Species icon buttons have no right-click learn, so the most performative on/off toggles can't be mapped.
- Program change is taken from any channel or device, and `n % 8` means a DAW sending program changes on project load switches presets unexpectedly.
- A CC-driven icon `set` receives fractional values (for example 0.37), which are stored and saved as-is.

**Fix:** Key the map by `${inputId}:${ch}:${cc}` (and accept a plain `cc` as a wildcard for compatibility). In learn, ignore CC64/66/120–127 and require a change of at least 3 steps. Add `oncontextmenu` learn to icon buttons, rounding `value >= 0.5` to 1. Add a program-change channel filter setting (default: off/omni, with an "ignore" option).

---

### 23. [LOW · bug] TS recording start/stop races and the UI shows "stop" after a failed start (fixed in v19)

**Where:** TS `src/midi/main.ts:788-831`.

**Scenario / evidence:**
- `startRecordingNow` switches the button to "■ stop" and sets `lockQuality = true` unconditionally, even when `recorder.start()` returned an error string.
- Pressing R during `startCodecs`' `await isConfigSupported` starts a second encoder and muxer. The first `VideoEncoder` leaks, and hardware encoder sessions are limited on some GPUs.
- Pressing R during the 3 s countdown starts a second countdown, which leads to two starts.

**Fix / v19 status:** Fixed in v19 `recording-ui.js` (`recordingBusy`, countdown token, UI updates only on success, `restoreRecordingQuality`). Port that logic.

---

### 24. [LOW · bug] Instrument bell/keys auto-release cuts off a re-struck note

**Where:** TS `src/midi/synth.ts:253`.

**Scenario / evidence:** `if (sustainLevel === 0) setTimeout(() => this.noteOff(pitch), (attack+decay)*1000)` releases *whatever voice holds `pitch`* when the timer fires. Striking bell C4 twice within 1.6 s means the first strike's timer kills the second strike early.

**Fix:** Capture the voice: `const v = {stop}; this.voices.set(pitch, v); setTimeout(() => { if (this.voices.get(pitch) === v) this.noteOff(pitch) }, …)`. Also use `gain.cancelAndHoldAtTime(t)` in `stop` instead of reading `.value` of an automated param (`:247-248`), which clicks in some browsers.

---

### 25. [LOW · perf] The panel's `backdrop-filter: blur(8px)` sits over a canvas that repaints every frame

**Where:** TS `index.html:16`.

**Scenario / evidence:** The compositor has to re-blur the region under the 310 px-wide, full-height panel every frame because the WebGPU canvas under it changes every frame. On weak integrated GPUs that competes with the renderer and auto quality responds by lowering the render scale.

**Fix:** Use a solid `rgba(12,13,16,0.94)`, or turn off blur when auto quality has dropped below 1.0 (add a `body.low-power` class).

---

### 26. [LOW · perf] Small per-frame allocations in the analysis path

**Where:** TS `music.ts:175, 186` (`new Set`, `new Float32Array(12)` every frame); `inputAudio.ts:385, 387, 401, 418, 437, 456` (array spreads and `sort` every frame, `stemFlux = [0,0,0,0]`); `main.ts:1096` (`[...m.active.values()]` every 6 frames).

**Scenario / evidence:** This steady garbage causes minor GC pauses. It's small, but it adds to the budget on weak machines.

**Fix:** Preallocate: a 12-slot `Uint8Array` bitmask for polyphony, one reusable chroma scratch array, a ring-buffer median (copy into a preallocated `Float32Array` and sort in place), and index sorts on a reused `Int8Array` of 12.

---

### 27. [LOW · perf] Gesture tracking runs face blendshapes, transform matrices and full `analyze()` it doesn't need, on the main thread

**Where:** TS `src/vision/engine.ts:84-86` (`outputFaceBlendshapes: true`, `outputFacialTransformationMatrixes: true`), `:141` (`analyze(...)` every detect); `src/midi/vision.ts:53-57` (20 Hz on the main thread, with `delegate: 'GPU'` taking a second GL context next to the WebGPU renderer).

**Scenario / evidence:** Gestures only use the nose landmark and hand landmarks 0/4/8/9/12/16/20. Everything else is wasted inference and CPU, and it causes main-thread jank of about 10–30 ms per detect on a weak laptop.

**Fix:** Pass `face: {blendshapes:false, matrices:false}` (or drop the face model and use the hand wrist for parallax), skip `analyze()` for gesture use, run at 12–15 Hz, and consider moving it to a worker (engine.ts was written for a worker originally).

---

### 28. [LOW · UX] Papercuts

- `stamp()` (`recorder.ts:59`) uses `toISOString()`, which is UTC, so file names and preset names (`main.ts:446`) are 1–2 h off for a Belgian user. Use local time: `new Date(Date.now() - tzOffset)`.
- The audio `<input type=file>` (`main.ts:749-752`) value is never reset, so choosing the same file again (for example after a decode failure) fires no `change` event. v19 resets only `simpleModelFile`.
- A mount failure leaves the engine's canvas in `#stage` (organism.ts:575-579 appends it before `renderer.init()`, and `selectEngine`'s catch doesn't unmount). Nothing recovers from WebGPU device loss or `webglcontextlost`: the loop reports `frame error` every frame (`main.ts:1085-1087`). Add an app-shell "if 30 consecutive frame errors → remount engine" watchdog.
- `rebind()` runs on every MIDIAccess `statechange`, including output ports and `pending`/`open` connection changes, and overwrites the status line each time (`inputMidi.ts:37, 62-66`).
- `dragleave` fires when the pointer moves between child elements, so the drop overlay flickers (`main.ts:762`). Use a drag counter.
- v19 simple sliders (`simpleGrowth`, `simpleDetail`, `simpleAudio`) start at their HTML default values, not the engine's current values. The first nudge jumps `musicAmount`/`speed`/`sustain`/`branch` away from the user's saved values.

---

## Quick wins (each under about an hour, high payoff)

1. Port `[hidden]{display:none!important}` into TS `index.html` (finding 18).
2. Piano and shortcuts on `e.code` for AZERTY; in v19, only skip Enter/Space on focused buttons, or blur after click (finding 9).
3. Sustain pedal (CC64) and CC120/123 in `MusicClock`; a panic shortcut (finding 5).
4. Stop the MIDI channel collision: add `source`/`stem` fields to `NoteEvent`; the instrument plays all MIDI channels (finding 4).
5. Beat tracker: clock-mode firing only on ticks, 0.5 s clock timeout, 0xFC handling, Start off-by-one (finding 3), plus vitest tests.
6. Morph and CC: never interpolate `quality`/`shellSize`/`video*`; batch species toggles into one `respawnHeld`; exclude `budget`/`quality`/`autoQuality` from presets (finding 6).
7. Onset analyser: a second `AnalyserNode` (1024, smoothing 0) for flux; time-based history; absolute noise floor (finding 7).
8. Recording defaults: 30 fps, even output size, saved options. Start restoring WebCodecs with an AudioWorklet PCM tap and constant-rate timestamps (findings 1–2).
9. Generation-token guards for `openCamera`, `GestureInput.start` and `Caster.start`; `replaceTrack` on engine switch while casting (findings 10, 12).
10. Map-backed `ctl()` (finding 20).
11. Capture URL carries the full preset in the hash (finding 13).
12. Save MIDI device, mic device, stems, sensitivity and recording options; add a settings schema version with clamping (finding 19).
13. Local-time `stamp()`, reset file input values, a counter-based drag overlay (finding 28).
