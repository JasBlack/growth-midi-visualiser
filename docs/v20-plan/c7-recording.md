# C7 — Recording & output: port specification + design for the best recorder

Cluster: native recorder, recording UI, output audio bus (input-only vs full mix), capture resolution / fps / bitrate, editor compatibility, recording report, Resolve conversion helper (v0.17.0, v0.18.0). Section 10 is a complete design for the recorder that should replace both lineages.

---

## 0. Sources read, and the name map for this cluster

**v19 compiled lineage** (`C:\Users\User\Downloads\growth-v0190`):
- `maintenance/recorder-native.js` (73 lines, class `rZ`, final v0.18.0 form)
- `maintenance/recording-ui.js` (58 lines: `Vw`, `x5`)
- `maintenance/performance-ui.js` (15 lines). **It has no output/recording code.** It only holds `softOnly` and `cameraPreset`, which belong to the soft-species and camera clusters. The recording-relevant part of the v0.17 patch is the `Fm` guard in `patch_performance.py:41-42`.
- `maintenance/extra-controls.js` (29 lines). Lines 20-28 are the v0.18 `recReport` / `recEditor` handlers plus a 400 ms polling loop. Found by grep; the brief did not list it.
- `maintenance/patch_performance.py` (v0.16.0 → v0.17.0) and `maintenance/patch_species_stage.py` (v0.17.3 → v0.18.0)
- `maintenance/patch_consolidation.py:42-50` (v0.19.0 hides `#sec-output` in Simple mode)
- `maintenance/audio-methods.js` (v0.15.1 speaker-only disconnect that preserves the recording tap)
- `maintenance/test-recording.cjs`, `convert-for-resolve.py`, `Convert-for-Resolve.command`, `RESOLVE_IMPORT.md`, `NOTES_V0170.md`, `NOTES_V0180.md`, `NOTES_FOR_CLAUDE.md`, `README.txt`
- Compiled bundle `assets/index-BWYXfAkm.js` (1,457,993 bytes), plus `growth-visualiser-v0.16.0.html` and `-v0.17.0.html`, from which I extracted the pre-patch and v0.17.0 versions of `rZ`/`Vw`/`x5` to diff each step.
- Measured evidence from the lead: `scratchpad/v20/reports/evidence-recording.md`, an ffprobe of a real v19 take plus a real v0.15 take.

**TS source of truth** (`C:\Users\User\Desktop\code\growth-midi-visualiser`, tag `v0.15.0`):
- `src/midi/recorder.ts` (350 lines), `src/midi/audioCtx.ts` (57), `src/midi/inputAudio.ts` (476), `src/midi/synth.ts`, `src/midi/main.ts` (1174), `src/midi/engine.ts`, `src/midi/engines/organism.ts`, `src/midi/engines/crystal3d.ts`, `src/midi/cast.ts`, `index.html`, `scripts/release.mjs`, `vite.config.ts`
- `node_modules/mp4-muxer` 5.2.2 (`build/mp4-muxer.d.ts`; its README now says "⚠️ This library is deprecated ⚠️ … in favor of Mediabunny") and `node_modules/webm-muxer` 5.1.4

**Minified → TS names used by this cluster.** I verified these by reading the compiled v0.16.0 code, which is byte-identical in logic to the TS v0.15.0 source.

| Minified | TS | Where (TS) |
|---|---|---|
| `rZ` | `class Recorder` | recorder.ts:61-339 |
| `oZ` | `snapshot()` | recorder.ts:342-350 |
| `Qa` | `VIDEO_FORMATS` | recorder.ts:39-43 |
| `iZ` / `tP` | `CODEC_FORMATS` / `RECORDER_CANDIDATES` | recorder.ts:25-36 |
| `sZ` / `eP` | `HAS_CODECS` / `W` (window) | recorder.ts:22-23 |
| `nZ` | `formatFor()` | recorder.ts:45-47 |
| `Tx` / `em` | `download()` / `stamp()` | recorder.ts:49-59 |
| `GY`, `xL` / `tZ`, `BL` | `Mp4Muxer`, `Mp4Target` / `WebmMuxer`, `WebmTarget` | recorder.ts:10-11 |
| `hl` | `recorder` instance | main.ts:34 |
| `OM` | `stageCanvas()` | main.ts:784-786 |
| `Cp` | `recArmed` | main.ts:787 |
| `Vw` | `startRecordingNow()` | main.ts:788-799 |
| `x5` | `toggleRecord()` | main.ts:800-831 |
| `b5` / `zw` | `takeStill()` / `stillPending` | main.ts:859-875 |
| `Fm` / `tT` | `selectEngine()` / `mounting` | main.ts:245-246 |
| `he` / `Hi` / `vs` / `Y` / `fa` / `te` / `je` | `settings` / `save()` / `setStatus()` / `$` / `mode` / `engine` / `audio` | main.ts:68-99, 127, 25, 43, (engine), 33 |
| `A5` | `loop()` | main.ts:1041 (`clock.tick` :1044, `engine.frame` :1084, `recorder.grab` :1088) |
| `Al` | `audioContext()` | audioCtx.ts:12-36 |
| `nT` | `toOutput()` | audioCtx.ts:39-43 |
| `U5` | `toRecordingOnly()` | audioCtx.ts:46-49 |
| `Gw` | `recordingStream()` | audioCtx.ts:52-57 |
| `Pr` / `Mc` | `ctx` / `recordDest` | audioCtx.ts:8-9 |
| `O5` | `class AudioInput` | inputAudio.ts:26 |

---

## 1. Summary

**What the cluster does for the user.** It covers everything in "getting it out": the **● rec** button and its start modes (now / 3 s countdown / on next note), which audio goes into the take, capture resolution / frame rate / bitrate, the video container and codec, a diagnostic "Recording report", an "Editor MP4 settings" one-click preset, and an external ffmpeg helper (`convert-for-resolve.py`) that repairs takes for DaVinci Resolve. It also touches stills (`Q`), the REC HUD and casting, because they share the capture canvas.

**Lineage.**
- **v0.15.0 (TS, target):** WebCodecs `VideoEncoder`/`AudioEncoder` + `mp4-muxer`/`webm-muxer`, i.e. H.264 High + AAC with moov first (`fastStart:'in-memory'`), even dimensions, 30 fps hard-coded in `startRecordingNow` (main.ts:796), audio from the shared "everything audible" bus (`recordingStream()`), and MediaRecorder only as a fallback where WebCodecs + `MediaStreamTrackProcessor` are missing. The lead's ffprobe of a real v0.15 take shows `ftyp moov mdat`, H.264 High, even dims, `r_frame_rate=30/1`, pts deltas exactly 1/30 s, clean decode and AAC 48 kHz stereo (evidence-recording.md).
- **v0.17.0 (patch_performance.py):** replaced the whole recorder with a MediaRecorder + `canvas.captureStream(fps)` implementation. It added an input-only audio bus, a resolution control (1080 / 1440 / current), fps (60 / 30), bitrate (24 / 40 / 12 Mbps), capture pixel-ratio boosting with a quality lock and restore, a busy guard, a cancellable countdown and arm, and a block on pattern switching while recording.
- **v0.18.0 (patch_species_stage.py):** added "MP4 editor compatibility" (explicit `avc1…,mp4a.40.2` MIME list, no silent generic fallback), a JSON "Recording report", the "Editor MP4 settings" button, and the root-level `convert-for-resolve.py` / `Convert-for-Resolve.command` / `RESOLVE_IMPORT.md`.
- **v0.19.0:** no recording code change. Output is hidden in Simple mode, which is now the default (`patch_consolidation.py:47`).

**Net effect today (measured).** The v19 default take is a **fragmented MP4** (`ftyp moov moof mdat moof mdat`), H.264 **Constrained Baseline**, **2284×1080** (window aspect), **38.5 fps effective against a 60 fps target**, frame deltas **3.7–297 ms**, and **55 "non monotonically increasing dts" decode errors**. That is exactly what the owner describes: Quick Look refuses the file, VLC stutters, Resolve has trouble. **The TS v0.15 recorder is the better base. Port the v17/v18 UX ideas onto a rebuilt WebCodecs recorder (section 10), not the v19 MediaRecorder class.**

---

## 2. Behaviours (v19), with exact algorithms and constants

### 2.1 `rZ` — MediaRecorder recorder (recorder-native.js, v0.18.0 form)

State (constructor, line 4): `active=false, frames=0, failure='', tracks=[], rec=null, done=null, started=0`. Later additions: `ext`, `chunks`, `stream`, `resolveDone`, `lastReport`.

Getters (5-6):
- `recording` returns `active`.
- `seconds` returns `(performance.now()-started)/1000` while active, else 0.

`async start(canvas, audio, fps=60, format)` (7-46). The 5th argument (`context.sampleRate`, passed by `Vw`) is ignored.
1. If active, return `'already recording'`. If `typeof MediaRecorder==='undefined'`, return `'This browser cannot record. Try Chrome or Edge.'`
2. `preferred = format?.ext==='mp4' ? 'mp4' : 'webm'`. Only `.ext` of the chosen `VIDEO_FORMATS` entry is used, so the WebCodecs entries `wc/mp4` / `wc/webm` still drive this.
3. `strict = preferred==='mp4' && (document.getElementById('recCompat')?.checked ?? true)`. The class reads the DOM directly.
4. `explicit = ['video/mp4;codecs=avc1,mp4a.40.2', 'video/mp4;codecs=avc1.640034,mp4a.40.2', 'video/mp4;codecs=avc1.4D0034,mp4a.40.2']` (level 5.2 fixed regardless of size).
5. Candidates:
   - strict: `explicit`
   - mp4 non-strict: `['video/mp4;codecs=avc1.42E01E,mp4a.40.2','video/mp4','video/webm;codecs=vp9,opus','video/webm;codecs=vp8,opus','video/webm']`
   - webm: `['video/webm;codecs=vp9,opus','video/webm;codecs=vp8,opus','video/webm','video/mp4']`
6. `mime` = the first candidate for which `MediaRecorder.isTypeSupported` is true. If none: strict gives `'This browser cannot capture explicit H.264 + AAC. Disable MP4 editor compatibility to record another format, then use the Resolve conversion helper.'`, otherwise `'No supported recording format in this browser.'`
7. `ext = mime.startsWith('video/mp4') ? 'mp4' : 'webm'`. Reset `frames`, `failure`, `tracks`, `chunks`.
8. `lastReport = {version:'0.18.0' (hard-coded), requestedMime, editorCompatibility:strict, width:canvas.width, height:canvas.height, targetFps:fps}`.
9. `stream = canvas.captureStream(fps)`. Push its video tracks. If there are none, throw `'canvas did not provide a video track'`. Set `tracks[0].contentHint='detail'`.
10. For each audio track of `audio` that is not `readyState==='ended'`: `clone()`, own it (push to `tracks`) and `stream.addTrack(clone)`.
11. `bitrate = Number(document.getElementById('recQuality')?.value) || 24000000`. `new MediaRecorder(stream, {mimeType:mime, videoBitsPerSecond:bitrate, audioBitsPerSecond:256000})`.
12. Report adds `reportedMime` (`rec.mimeType`), `requestedVideoBitrate`, `reportedVideoBitrate` (`rec.videoBitsPerSecond`) and `reportedAudioBitrate`.
13. `done = new Promise(r => resolveDone = r)`. `ondataavailable` pushes non-empty blobs. `onerror` sets `failure = event.error?.message || 'capture interrupted'`, then calls `rec.stop()` if not inactive, else `finish()`. `onstop = finish`.
14. `started = performance.now(); rec.start(1000)` (1 s timeslice); `active = true`.
15. Returns `` `recording ${w}×${h} · ${fps} fps target · ${round(bitrate/1e6)} Mbps${fallback} · ${rec.mimeType}${hasAudio?' · audio connected':' · no audio track'}` ``, where `fallback = ' · WEBM fallback'` (or `MP4`) if `ext !== preferred`.
16. Any throw calls `cleanup()` and returns `` `recording could not start: ${message}` ``.

`grab()` (47) only increments `frames` while active. It does not affect capture: `captureStream(fps)` samples the canvas by itself.

`finish()` (48-61), resolved once:
- `failure` gives `recording failed: …` and **no file is saved** (the partial take is discarded).
- No chunks gives `'recording failed: no frames were captured'`.
- Otherwise it builds `Blob(chunks, {type: rec.mimeType})`, names it `growth-${stamp()}.${ext}`, and `download`s it. The report gains `{filename, bytes, durationSeconds:(now-started)/1000, renderCallbacks:frames, note:'MIME and bitrate are browser reports; inspect the saved file to confirm codecs and frame timing.'}` and the message is `` `saved ${name} · ${MB.toFixed(1)} MB · ${secs.toFixed(1)} s` ``.
- Then `cleanup()` and resolve.

`stop()` (62-67): returns `'not recording'` when `!rec`. Otherwise it calls `rec.stop()` and returns `done`.

`cleanup()` (68-72) stops **only owned tracks** (the canvas video track plus audio clones) and nulls `rec`/`stream`/`chunks`.

v0.17.0 → v0.18.0 diff (extracted from `growth-visualiser-v0.17.0.html`): v0.17 had no `strict`/`explicit`/`lastReport`, and its mp4 candidates were always the non-strict list. v0.18 added strict mode, the report, `· ${rec.mimeType}` in the status, and `recCompat` in the disabled-controls list.

### 2.2 Input-only audio bus (`O5.recordStream`, patch_performance.py:23-24)

Replaces `recordStream(){return Gw()}` (inputAudio.ts:101-103) with:
```js
recordStream(){ this.ensureCtx();
  if(!this.captureDestination){ this.captureDestination=this.ctx.createMediaStreamDestination(); this.analyser.connect(this.captureDestination) }
  return this.captureDestination.stream }
```
It caches one `MediaStreamAudioDestinationNode` (default 2 channels at the context's 48 kHz) fed from the pass-through `AnalyserNode`, which carries file, mic and tab audio. It bypasses the instrument and sound-back, which reach `Mc` via `toOutput`. Unlike `Mc`, **it has no ConstantSource keep-alive**; compare audioCtx.ts:17-23, whose comment says Chrome emits nothing from an unconnected destination.

### 2.3 Recording UI (`recording-ui.js`)

Module state (line 1): `recordingBusy=false, recordingCountdown=0, recordingRestore=null`.

`restoreRecordingQuality()` (2-10):
- If `recordingRestore` exists: `renderer.setPixelRatio(ratio); engine.pixelNow=ratio; engine.resize()`, then `engine.lockQuality=false; recordingRestore=null`.
- Always: the record button loses `.rec`, gets text `'● rec'` and is re-enabled, and `recAudio, recResolution, recFps, recQuality, recFormat, recCompat` are re-enabled.

`Vw()` = start now (11-41):
1. Return if `recordingBusy || hl.recording`. Set `recordingBusy=true` and disable `#record`.
2. `context = Al()`. If suspended, `await context.resume()`.
3. Audio: if `recAudio==='input' && fa!=='midi'`:
   - `je.active` false throws `'Start an audio file, microphone or tab input first, or choose Full mix.'`
   - otherwise `audio = je.recordStream()`.
   - Else (mix, or any MIDI mode): `audio = Gw()` (the full mix, **including sound-back**).
4. If `te?.renderer`: store `{engine:te, ratio:renderer.getPixelRatio()}` and set `te.lockQuality=true`. `target = Number(recResolution)`. If `target` is non-zero:
   - `captureRatio = Math.min(4, target/Math.max(1, host.clientHeight), 3840/Math.max(1, host.clientWidth))`
   - `te.pixelNow=captureRatio; renderer.setPixelRatio(captureRatio); te.resize(); te.draw?.()`
   - The canvas becomes `floor(clientW·r) × floor(clientH·r)`: window aspect, and possibly odd or 1079.
5. `canvas = OM()`. If none, throw `'Nothing to record.'`
6. `status = await hl.start(canvas, audio, Number(recFps), nZ(he.recFormat), context.sampleRate)`, then `vs(status)`. If not recording, restore and return.
7. Success: `#record` gets `.rec` and text `'■ stop'`, and the six option controls are disabled. `hl.done.then(msg => {restoreRecordingQuality(); vs(msg)})` also restores after browser-initiated errors.
8. `catch` shows the message and restores. `finally` sets `recordingBusy=false` and re-enables `#record`.

`x5()` = toggle (42-58):
1. Return if `recordingBusy`.
2. If recording: set busy, `await hl.stop()` (the message is shown by the `done` handler), clear busy.
3. If `Cp || recordingCountdown`: disarm. Set both to 0, hide `#countdown`, set button text `'● rec'`, status `'recording disarmed'`.
4. `recMode==='note'`: `Cp=true`, `#countdown` shows `'♪'`, button text `'cancel'`, status `'armed — recording starts on the next note'`.
5. `recMode==='count'`: `token = performance.now()||1; recordingCountdown=token`; button `'cancel'`. For n = 3..1: show n, wait 1000 ms, and abort if the token changed. Then `recordingCountdown=0` and hide.
6. `await Vw()`.

Arm trigger (unchanged TS logic, in the loop before `engine.frame`): `Cp && e.events.some(a=>a.kind==="on") && (Cp=false, #countdown.hidden=true, Vw())`. `Vw` is **async** and not awaited.

### 2.4 Pattern-switch guard (patch_performance.py:41-42)

`async function Fm(i){ if((hl.recording||recordingBusy)&&te?.id!==i){ vs("Stop recording before switching patterns"); return } if(tT)return; …`

### 2.5 v0.18 extras (extra-controls.js:20-29)

- `syncExtraControls()` runs every **400 ms** forever (`setInterval(syncExtraControls,400)`). Besides tip/bounce controls it sets `recReport.disabled = !hl.lastReport || hl.recording` and `recEditor.disabled = hl.recording || recordingBusy`.
- `#recReport` click: `Tx(new Blob([JSON.stringify(hl.lastReport,null,2)],{type:'application/json'}), 'growth-recording-report.json')`. The file name is fixed and only the last take is kept, in memory.
- `#recEditor` click:
  - Return if busy or recording.
  - `format = Qa.find(ext==='mp4')`. If none: `vs('MP4 is not offered by this browser. Record WebM and use the conversion helper.')`
  - Otherwise `he.recFormat=format.mime`, `recFormat.value=format.mime`, `recCompat.checked=true`, `recResolution='1080'`, `recFps='30'`, `Hi()`, `vs('Editor starting point: MP4 H.264/AAC requested, 1080 tall, 30 fps target.')`
  - Only `recFormat` is persisted.

### 2.6 Format note text over versions (TS main.ts:849-853, patched twice)

| Version | `#recFormatNote` when MP4 is available |
|---|---|
| v0.15 | `MP4 opens in Quick Look, QuickTime, VLC, Premiere and Resolve — anywhere a MOV would.` |
| v0.17 | `Capture uses browser-synchronised audio/video. If MP4 capture is unavailable, the take is saved as WebM.` |
| v0.18 / v0.19 | `MP4 editor compatibility requests H.264 + AAC explicitly. If unavailable, turn compatibility off and convert the recording using the supplied helper.` |

In every version, a WebM-only browser shows `This browser only writes WebM — Chrome or Edge add MP4.` and a browser with no formats shows `This browser cannot record video.`

The format `<select>` is still built from `Qa`. On Chrome, `Qa = iZ` (WebCodecs detected), so the user is offered **"MP4 · H.264 + AAC (Quick Look, Premiere, Resolve, everything)"** and "WebM · VP9 + Opus (smaller, browsers + VLC)". Both are now served by MediaRecorder: the labels are false. The mp4-muxer / webm-muxer libraries remain in the bundle as dead code (`new GY(`, `new tZ(`, `VideoEncoder(`, `AudioEncoder(` each occur 0 times; `fastStart` code is still present).

### 2.7 Simple mode (v0.19)

`body.simple-ui #sec-output{display:none!important}` (patch_consolidation.py:44-47). The top-bar `● rec`, `recMode` and `📷 still` stay visible. So the default user records with invisible defaults: `recAudio=input`, 1080, 60 fps, 24 Mbps, strict MP4.

### 2.8 Resolve conversion helper (`convert-for-resolve.py`, `Convert-for-Resolve.command`)

- CLI: `files+`, `--format {prores,h264,remux}` (default **prores**), `--fps {24,25,30,50,60}` (default **30**).
- Needs `ffmpeg` on PATH, otherwise it exits with `'FFmpeg is required for conversion, but is not installed or is not on PATH. The visualiser itself does not need it.'`
- Output: `<stem>-resolve-<format>.mov` for prores, `.mp4` otherwise, next to the source. It refuses to overwrite (`dest.exists()` → `parser.error`), and ffmpeg also gets `-n`.
- If `ffprobe` exists, it writes `<dest-without-ext>.source-info.json` (`-show_streams -show_format -of json`).
- Base arguments: `ffmpeg -hide_banner -nostdin -n -i SRC -map 0:v:0 -map 0:a:0?`
  - `remux`: `-c copy -movflags +faststart DEST`
  - The other modes add `-vf fps={fps},pad=ceil(iw/2)*2:ceil(ih/2)*2 -fps_mode cfr`, then:
    - prores: `-c:v prores_ks -profile:v 1 -pix_fmt yuv422p10le -c:a pcm_s24le -ar 48000` (ProRes 422 LT, 10-bit, 24-bit PCM)
    - h264: `-c:v libx264 -preset medium -crf 18 -pix_fmt yuv420p -c:a aac -b:a 256k -ar 48000`
  - Every mode ends with `-movflags +faststart DEST`.
- `subprocess.run(..., check=True)`, then prints `Saved {dest}`.
- `.command` (macOS only): prepends `/opt/homebrew/bin:/usr/local/bin` to PATH. With no args it uses `osascript` to "choose file with prompt 'Choose a Growth recording to convert to ProRes for Resolve'", runs the Python script, then waits for Return and exits with its status.
- `RESOLVE_IMPORT.md` documents usage and honestly says Resolve import was never tested and no failing file was ever inspected.

### 2.9 Unchanged v0.15 behaviours that are still live in v19

- Stills: `Q` / `📷 still` calls `engine.snapshot(scale)`. Shift gives 2×; the file is `growth-${stamp}${-2x}.png` (main.ts:860-875). Engines without `snapshot` set `stillPending`, grabbed after the next frame (main.ts:1089-1093).
- The loop calls `recorder.grab()` right after `engine.frame()` in the same rAF task (main.ts:1088).
- HUD `#hudRec`: `` ` · ● REC ${round(seconds)}s` `` every 6th frame (main.ts:1107).
- Keys: `R` toggles recording, `Q` / `Shift+Q` take a still (main.ts:1016-1018).
- `#countdown` overlay (index.html:88): fixed full-screen, 160 px bold white text, `pointer-events:none`.
- `recMode` persisted in `settings.recMode`, default `'now'` (main.ts:65, 87, 832, 855-858). `recFormat` persisted in `settings.recFormat`, default `''`, which becomes the first available format (main.ts:66, 88, 842).
- Casting (`cast.ts:23-26`) uses `canvas.captureStream(fps=30)` on the same canvas, so it is affected by capture-size changes.

### 2.10 Diff summary vs the TS target (v0.15.0)

| Aspect | TS v0.15.0 | v19 |
|---|---|---|
| Engine | WebCodecs + mp4-muxer/webm-muxer (MediaRecorder fallback) | MediaRecorder only (muxers dead in bundle) |
| MP4 structure | moov first, one mdat (`fastStart:'in-memory'`) | fragmented (moof/mdat), zero durations |
| Codec | H.264 High (`avc1.640028` ≤ 2.1 MP else `640033`) → Main → Baseline; AAC-LC 160 kbps; VP9/Opus for WebM | whatever the browser picks for `avc1,…` (measured: Constrained Baseline); AAC 256 kbps requested |
| Frame timing | real-time timestamps, frame-rate hold `t-lastT < 1000/fps-1.5` skip, drop if `encodeQueueSize>8`: CFR only if GPU ≥ fps | `captureStream(fps)` wall-clock: VFR (measured deltas 3.7–297 ms) |
| Dimensions | canvas & ~1 (even), 2D-scratch rescale if size changes mid-take | canvas as-is (odd possible); pixel ratio set to `min(4, target/h, 3840/w)`; changes on resize |
| fps | 30 fixed | 60 default / 30 |
| Bitrate | `min(28e6, max(4e6, px·fps·0.14))` | 24 / 40 / 12 Mbps select |
| Audio | shared bus (input + instrument + sound-back); MSTP → AudioEncoder; **drops all audio if AudioData ≠ 2 ch @ ctx rate; drops chunks when encodeQueueSize ≥ 40** | clone of input-only tap or full-mix track; browser-muxed |
| Memory | whole file in an ArrayBuffer (fastStart in-memory) | Blob chunks (Chrome pages large blobs to disk) |
| UI | no busy guard; countdown not cancellable; "■ stop" even after failed start | busy guard, token-cancellable countdown, restore-on-error, controls locked |
| Report | none | JSON (browser-reported values) |
| Editor help | n/a | ffmpeg helper + docs |

---

## 3. Controls

There are **no engine (`EngineControl`) controls** in this cluster. All controls are DOM controls in the Output section or the top bar.

### 3.1 v19 controls (to port or replace)

| Id | Type | Label / text | Options (value → label) | Default | Persisted | Section | Read by |
|---|---|---|---|---|---|---|---|
| `record` | button | `● rec` / `■ stop` / `cancel` | — | — | — | top bar (index.html:156 v19; TS :99) | `x5` onclick; key `R` |
| `recMode` | select | title "how a recording starts" | `now` → now, `count` → 3 s countdown, `note` → on next note | `now` | `settings.recMode` | top bar | `x5` |
| `still` | button | `📷 still` (title "Q · shift+Q renders it at 2×") | — | — | — | top bar | `b5` |
| `recFormat` | select | `video` | built from `Qa` (Chrome: `wc/mp4` "MP4 · H.264 + AAC (Quick Look, Premiere, Resolve, everything)", `wc/webm` "WebM · VP9 + Opus (smaller, browsers + VLC)"; no-WebCodecs browsers: supported entries from `tP`) | `Qa[0]` | `settings.recFormat` | Output | `Vw` → `nZ(he.recFormat)`, only `.ext` used |
| `recEditor` | button | `Editor MP4 settings` | — | — | — | Output (v18) | extra-controls.js:23-28 |
| `recReport` | button | `Recording report` | — | disabled until a take finishes | — | Output (v18) | extra-controls.js:22 |
| `recCompat` | checkbox | `MP4 editor compatibility (H.264 + AAC)` | — | checked | **no** | Output (v18) | `rZ.start` via `document.getElementById` |
| `recAudio` | select | `audio` | `input` → "Input only (MIDI: instrument mix)", `mix` → "Full mix, including generated sounds" | `input` | **no** | Output (v17) | `Vw` |
| `recResolution` | select | `resolution` | `1080` → "1080 px tall", `1440` → "1440 px tall", `0` → "Current canvas" | `1080` | **no** | Output (v17) | `Vw` (pixel-ratio formula) |
| `recFps` | select | `frame rate` | `60` → "60 fps target", `30` → "30 fps target" | `60` | **no** | Output (v17) | `Vw` → `captureStream(fps)` |
| `recQuality` | select | `quality` | `24000000` → "High · 24 Mbps", `40000000` → "Maximum · 40 Mbps", `12000000` → "Smaller · 12 Mbps" | `24000000` | **no** | Output (v17) | `rZ.start` via `document.getElementById` |

Hidden constants: `audioBitsPerSecond 256000`, timeslice `1000` ms, capture-ratio caps `4` (pixel ratio) and `3840` (width), countdown 3 × `1000` ms, polling `400` ms, `contentHint 'detail'`.

### 3.2 Controls for the new design (section 10). One `settings.rec` object; all persisted.

| Key (`settings.rec.*`) | UI id | Label | Options | Default | Notes |
|---|---|---|---|---|---|
| `size` | `recSize` | Size | `1080p` 1920×1080 · `1440p` 2560×1440 · `2160p` 3840×2160 · `vertical` 1080×1920 · `square` 1080×1080 · `window` (match window, even, ≤3840 wide) · `custom` | `1080p` | fixed output size, independent of window |
| `w`, `h` | `recW`, `recH` | Custom width/height | 256–3840 step 2 (even enforced) | 1920 / 1080 | only when `size=custom` |
| `fps` | `recFps` | Frame rate | 24, 25, 30, 50, 60 | **30** | 30 is editor-safe on weak laptops; 60 offered |
| `quality` | `recQuality` | Quality | `standard`, `high`, `max` (bitrate formula §10.6) | `high` | replaces fixed Mbps |
| `container` | `recContainer` | File type | `mp4` (H.264 + AAC), `mov` (H.264 + 24-bit PCM, "Editor master"), `webm` (VP9 + Opus) | `mp4` | availability-filtered (§10.3) |
| `audio` | `recAudio` | Sound in the take | `music` (input + instrument), `input` (file/mic/tab only), `mix` (everything incl. sound-back), `none` | `music` | fixes the MIDI "input only" confusion |
| `saveTo` | `recSaveTo` (+ `recFolder` button, `recFolderName` label) | Save to | `download` (browser downloads, disk-spooled), `ask` (Save-as each take), `folder` (a chosen takes folder) | `download` | `ask`/`folder` only where the File System Access API exists |
| `startMode` | `recMode` (existing) | Start | `now`, `count`, `note` | `now` | keep the old `settings.recMode` key as the source of truth (migration) |
| `avOffsetMs` | `recAvOffset` | A/V trim (Advanced) | −100…+100 step 1 | 0 | manual residual sync trim |
| `sidecar` | `recSidecar` | Save report with each take (Advanced) | checkbox | false | writes `<take>.report.json` |
| `webOptimised` | `recFastStart` (Advanced) | Web-optimised (index first) | checkbox | false | uses `fastStart:'reserve'` (§10.11) |

Migration from `settings.recFormat`: values starting `wc/mp4` or `video/mp4` → `container:'mp4'`; `wc/webm` or `video/webm` → `'webm'`. Then delete `recFormat`.

---

## 4. UI

### 4.1 v19 DOM added by the cluster (exact markup, positions)

In `#sec-output .body`, after the `recFormat` row (TS index.html:215-218), in this final order:
1. v18 (`patch_species_stage.py:48`, inserted **before** `#recFormatNote`):
   `<div class="row"><button id="recEditor" type="button">Editor MP4 settings</button><button id="recReport" type="button">Recording report</button></div><label><input id="recCompat" type="checkbox" checked> MP4 editor compatibility (H.264 + AAC)</label><p class="note">This requests explicit codecs; it does not guarantee import into every editor. The ZIP includes a Resolve conversion helper for existing recordings.</p>`
2. `<div id="recFormatNote" class="note"></div>` (existing, TS :219)
3. v17 (`patch_performance.py:48-53`, inserted **after** `#recFormatNote`): four rows `<div class="row"><label>audio <select id="recAudio">…`, `resolution <select id="recResolution">`, `frame rate <select id="recFps">`, `quality <select id="recQuality">` (options as in §3.1), then `<p class="note">Resolution is rendered before capture (up to 3840 px wide). Actual frame rate depends on your GPU. Input only excludes generated sounds from audio-file, microphone and tab recordings.</p>`
4. The existing cast / capture-URL rows follow unchanged.

No CSS was added for recording. The existing `button.rec { background:#6a2020; border-color:#a33 }` (index.html:67) and `.note` are reused. v19 CSS hides `#sec-output` in Simple mode (§2.7).

### 4.2 v19 handlers

| Element / event | Handler | Effect |
|---|---|---|
| `#record` click, key `R` | `x5` | §2.3 toggle state machine |
| `#recMode` change | TS main.ts:855-858 | persist `settings.recMode` |
| `#recFormat` change | TS main.ts:844-847 | persist `settings.recFormat` |
| `#recEditor` click | extra-controls.js:23-28 | editor preset (§2.5) |
| `#recReport` click | extra-controls.js:22 | download last report JSON |
| (none) `recAudio/Resolution/Fps/Quality/Compat` | — | read at start only; disabled during a take; never persisted |
| `setInterval(syncExtraControls,400)` | extra-controls.js:29 | polls disabled states |
| loop arm trigger | bundle loop (TS main.ts:1052-1056) | `Vw()` on the first note-on |

### 4.3 New UI (recommended; details in §10.17)

- **Top bar** (index.html:98-106): keep `#record`, `#recMode`, `#still`. Add `<button id="recProfile" class="chip">1080p30 · MP4</button>` after `#record`. It shows the active profile and opens/scrolls to Output. It is visible in Simple mode. This addresses the v19 finding that Simple hides Output.
- **Output section:** Size, Frame rate, Quality, File type, Sound, Save to (+ Choose folder… / folder name), capability line `#recFormatNote` (computed, truthful). Advanced only: A/V trim, sidecar report, web-optimised, `#recReport` "Save last take report".
- **Simple home:** a compact "Record" row with `recSize` (1080p / 1080p60 / 4K / Vertical), `recAudio` (Music / Everything / None), `recSaveTo`.
- **HUD** (`#hudRec`): ` · ● REC 01:23 · 1920×1080 30p · 212 MB · rep 1.2%`, with ` · ⚠ encoder busy` / ` · ⚠ paused (tab hidden)` appended when relevant.
- **Frame guide:** while recording (or while Output is open), size the canvas element to the letterboxed content rect and give it `box-shadow: 0 0 0 1px #2a2f38`. This is CSS only and never captured.
- **Events instead of polling:** the recorder emits `onState(state)`; `recordUi.ts` updates disabled states and texts.

---

## 5. Integration points: every patched anchor → TS location → required change

| # | Patch | Minified anchor | TS location | What must change |
|---|---|---|---|---|
| 1 | patch_performance.py:19-20; patch_species_stage.py:16-17 | `class rZ{` … up to `function oZ(` (whole class) | `recorder.ts:61-339` `export class Recorder` | **Do not port rZ as the recorder.** Replace with `output/recorder/` (§8, §10). Port rZ's good ideas (owned-track cleanup, `done` promise, explicit MIME list, status line) into `mediaRecorderBackend.ts` as the fallback. |
| 2 | patch_performance.py:21-22; patch_species_stage.py:16-17 | `async function Vw(){` … up to `Y("recMode").value=` (the preceding `let Cp=!1;` stays and gains `let recordingBusy…`) | `main.ts:787-831` (`recArmed`, `startRecordingNow`, `toggleRecord`) | Move to `app/recordUi.ts` as an explicit state machine (§10.12). Port: busy guard, cancellable countdown token, "stop" only after a successful start, restore on any end, controls locked during a take. Change: no pixel-ratio hack (use `setOutputSize`), synchronous `begin()` for arm-on-note, `showSaveFilePicker` in the click task. |
| 3 | patch_performance.py:23-24 | `recordStream(){return Gw()}` | `inputAudio.ts:100-103` | Delete `recordStream()`. In `ensureCtx()` (inputAudio.ts:92-96) replace `toRecordingOnly(this.analyser!)` with `this.analyser!.connect(buses.input)`. |
| 4 | patch_performance.py:41-42 | `async function Fm(i){var t;if(tT)return;` | `main.ts:245-246` `selectEngine` (`if (mounting) return`) | Phase 1: add `if (recorder.isBusy() && engine?.id !== id) { setStatus('Stop recording before switching patterns'); return }` where busy covers arming, armed, counting, starting, recording and stopping (v19 missed armed and counting). Phase 2 (optional): allow switching, re-applying `setOutputSize` after `mount` and letting duplicates cover the mount gap. |
| 5 | patch_performance.py:45-46; patch_species_stage.py:37 | the `#recFormatNote` string literal (3 versions, §2.6) | `main.ts:849-853` | Replace with a capability line from the negotiated path, e.g. "MP4 · H.264 High + AAC · constant 30 fps · opens in Quick Look, QuickTime, VLC, Resolve". |
| 6 | patch_performance.py:43-44 | `const LM="0.16.0"` (used only as the module insertion point) | `version.ts:2` | Nothing. Modules become imports. The report reads `VERSION`. |
| 7 | patch_performance.py:47 | `code+='\n'+performance-ui.js` | — | Not recording (soft species / camera clusters). |
| 8 | patch_performance.py:48-53,66 | HTML after `<div id="recFormatNote" class="note"></div>` | `index.html:219` | New Output rows (§4.3). Render from TS if the r1 `panel/sections/output.ts` approach is adopted. |
| 9 | patch_species_stage.py:44-48 | HTML before `<div id="recFormatNote"` | `index.html:219` | Same. Drop `recCompat` and `recEditor` (profiles replace them). |
| 10 | patch_species_stage.py:38 | `s+=extra-controls.js` (appended at module end) | end of `main.ts` (after boot, :1146-1174) | `recReport` lives in `recordUi.ts`, event-driven. **No `setInterval`.** |
| 11 | (bundle loop, unchanged TS) | `Cp&&e.events.some(a=>a.kind==="on")&&(Cp=!1,Y("countdown").hidden=!0,Vw())` | `main.ts:1052-1056` | `if (recorder.state==='armed' && m.events.some(on)) recorder.begin(performance.now())`. **Synchronous**, and after `clock.tick` / before `engine.frame` so that this frame is slot 0. |
| 12 | (bundle loop) | `if(hl.recording&&hl.grab(),zw){zw=!1;…oZ(a)…}` | `main.ts:1088-1093` | `if (recorder.capturing) recorder.grab(stageCanvas(), performance.now())`. **Same task, immediately after `engine.frame()`** (WebGPU canvas validity). A still requested during a take reuses this frame (`canvas.toBlob` in the same task, 1× only). |
| 13 | (bundle HUD) | `Y("hudRec").textContent=(hl.recording?…` | `main.ts:1107` | Richer HUD from `recorder.status` (§4.3). |
| 14 | (bundle) | `async function b5(i){if(te!=null&&te.snapshot)…` | `main.ts:860-875` `takeStill` | While recording: refuse 2× (`'2× stills are disabled while recording'`) and route 1× to "save current capture frame" (#12). Never call `engine.snapshot()` mid-take: it changes the pixel ratio and canvas size. |
| 15 | (bundle keys) | `t==="r"||t==="R"?x5()` / `t==="q"…?b5(…)` | `main.ts:1016-1018` | Keep. Consider Shift+R per k3-ux B4 (R sits between piano keys E and T). |
| 16 | (bundle) | `function OM(){…canvasEl…??r5.querySelector("canvas")}` | `main.ts:784-786` `stageCanvas` | Keep as the capture-source provider, called per grab so a remounted engine's canvas is picked up. |
| 17 | (bundle) | `function Al(){…new AudioContext({sampleRate:48e3})…createConstantSource…}` | `audioCtx.ts:12-36` | Keep 48 kHz. Add bus GainNodes (`input`, `instrument`, `soundback`) and `ensureWorklet()` (Blob-URL `addModule`). Keep the ConstantSource on the MediaRecorder-fallback destination only. |
| 18 | (bundle) | `function Gw(){return Al().state==="running"?Mc?.stream…}` | `audioCtx.ts:52-57` | Keep only for the MediaRecorder fallback and casting. The primary path uses the PCM worklet. |
| 19 | (bundle) | `function nT(i){…i.connect(e.destination),i.connect(Mc)}` / `function U5(i){…i.connect(Mc)}` | `audioCtx.ts:39-49` | Replace with `connectBus(node, 'instrument'|'soundback')`: bus → speakers, bus → recorder mix on demand. |
| 20 | (callers of nT) | synth master/wet `nT(...)` | `synth.ts:21` (SoundBack), `:98`, `:111` (Instrument) | `connectBus(this.master,'soundback')`; `connectBus(this.master,'instrument')`, `connectBus(this.wet,'instrument')`. |
| 21 | (engine internals used by recording-ui.js) | `te.renderer`, `te.pixelNow`, `te.resize()`, `te.draw?.()`, `te.host`, `te.lockQuality` | organism.ts:471 (`lockQuality`), :510 (`private pixelNow`), :729-739 (`resize`), :870-879 (`private draw`), :2721-2735 (auto quality); crystal3d.ts:131-140 | Add the public Engine API `setOutputSize?(size:{width:number,height:number}|null)` (engine.ts:42-77). Organism/crystal3d `resize()` honours it: pixel ratio 1, `renderer.setSize(W,H,false)`, `camera.aspect=W/H`, CSS letterbox. Auto quality is skipped while it is set. No external writes to private fields. |
| 22 | (bundle) | `Qa=sZ?iZ:…`, `nZ`, `iZ`, `tP`, `sZ` | `recorder.ts:22-47` | Replace with `capabilities.ts` (async probe: `VideoEncoder.isConfigSupported`, `AudioEncoder.isConfigSupported`, FSA, OPFS, MediaRecorder types). **Never label an option with a capability that is not actually used.** |
| 23 | (bundle) | `const em=()=>new Date().toISOString()…` / `function Tx(` | `recorder.ts:49-59` | Keep `download`. Make `stamp()` local-time (a3 finding: UTC is 1–2 h off in Belgium). |
| 24 | (bundle) | `function oZ(i,e=…png)` | `recorder.ts:342-350` | Keep. |
| 25 | settings | `he` keys `recMode`, `recFormat` | `main.ts:46-67` (interface), `:69-90` (defaults), `:91-99` (load/save, key `midiviz_settings_v3`) | Add `rec: RecordSettings` with defaults (§3.2) and migration. |

**Ordering constraints (hard):**
1. `grab()` must run in the **same rAF task, immediately after `engine.frame()`/draw** (main.ts:1084 → 1088). A WebGPU/WebGL canvas without `preserveDrawingBuffer` is only valid until the task yields. `takeStill`'s comment (main.ts:861-863) documents the same hazard.
2. The arm trigger must be evaluated after `clock.tick()` (main.ts:1044) and before `engine.frame()` (main.ts:1084), and `begin()` must be synchronous: encoders and sink are already prepared while armed.
3. `showSaveFilePicker()` / folder `requestPermission()` must be called inside the click/keydown task (transient user activation) **before** the countdown or any long await. Call it first in `toggleRecord`.
4. `audioContext().resume()` inside the same gesture (main.ts:793-794); the worklet module must be loaded (`await audioWorklet.addModule`) before `begin()`, which is done in `prepare()`.
5. `engine.setOutputSize(size)` → `resize()` → one `draw()` **before** configuring the VideoEncoder, so the canvas has exactly W×H. Restore (`setOutputSize(null)`) only after `finalize()` completes.
6. `lockQuality=true` before the first captured frame; clear only after restore.
7. Stop sequence: stop scheduling → `videoEncoder.flush()` → audio tail up to the computed end frame → `audioEncoder.flush()` (or PCM tail) → `output.finalize()` → `sink.close()` → restore engine → report → status.
8. `selectEngine` must consult the recorder state before `unmount()` (main.ts:251).

---

## 6. State & lifecycle

### 6.1 v19 state

| Where | Field | Lifetime |
|---|---|---|
| `rZ` | `active, frames, failure, tracks[], rec, done, resolveDone, started, ext, chunks[], stream, lastReport` | per take; `lastReport` survives until the next take (memory only) |
| module | `recordingBusy, recordingCountdown (token), recordingRestore {engine, ratio}` | global |
| module | `Cp` (armed) | global |
| `O5` | `captureDestination` (MediaStreamAudioDestinationNode, analyser-connected) | forever once created (never disconnected) |
| engine | `lockQuality`, `pixelNow` (externally mutated) | restored in `restoreRecordingQuality` |
| persistence | `settings.recMode`, `settings.recFormat` in `localStorage['midiviz_settings_v3']` | — |
| not persisted | `recAudio, recResolution, recFps, recQuality, recCompat` | reset on reload |

Unmount/dispose: pattern switching is blocked while recording or busy (not while armed or counting). On page unload during a take, everything is lost: no `beforeunload` guard.

### 6.2 New design state (summary; full detail in §10)

- `RecorderState = 'idle'|'preparing'|'armed'|'counting'|'recording'|'stopping'|'error'`
- Per take: `settings snapshot`, `capture {w,h,fps}`, `videoEncoder`, `audioEncoder|null`, `output (muxer)`, `sink`, `clock` (ContextClock), `scheduler {T0, nextSlot, lastFrame, dupSlots, overloadSlots, heldSlots, segments[]}`, `audio {F0, priming, samplesWritten, pending blocks}`, `stats`, `warnings[]`, `report`.
- Persistent: `settings.rec` (localStorage `midiviz_settings_v3`); the takes-folder `FileSystemDirectoryHandle` in IndexedDB `growth-rec`/`handles` key `takesDir`; OPFS spool dir `growth-spool/` (cleaned on start: delete entries older than 24 h, keep finalized-but-undownloaded takes and list them under "Unsaved takes").
- `beforeunload` prompt while `recording|stopping`.
- Engine: `setOutputSize(size|null)`. On unmount while recording (Phase 2 switching), the recorder keeps running and the next engine gets `setOutputSize` after `mount`.

---

## 7. Bugs, weaknesses and questionable decisions

### 7.1 In the v17–v19 patch

1. **[Critical] MediaRecorder output is structurally editor-hostile.** `canvas.captureStream(fps)` + `new MediaRecorder(...)` (recorder-native.js:22, 31) gives Chrome's fragmented MP4 with zero-duration moov and wall-clock frame times. Measured: `moof/mdat` fragments, 38.5 fps effective at a 60 target, deltas 3.7–297 ms, 55 non-monotonic DTS errors. Independent analysis agrees: Chrome (tested on v147) always writes fMP4 with zero duration fields and Windows Media Player cannot show duration or seek (addpipe, see Sources). **Better:** WebCodecs + muxer with CFR slots (§10). The ffmpeg helper (v18) is a workaround for a regression v17 introduced.
2. **[High] The format picker lies.** `Qa=sZ?iZ:…` still offers "MP4 · H.264 + AAC (Quick Look, Premiere, Resolve, everything)" (mime `wc/mp4`) and "WebM · VP9 + Opus", but `rZ.start` only reads `.ext`. The mp4-muxer/webm-muxer code stays bundled but unused (0 constructor call sites). **Better:** build options from actual capability probes; remove the dead code.
3. **[High] Capture size = window aspect × pixel ratio.** `captureRatio=min(4, target/h, 3840/w)` (recording-ui.js:27), then three.js `floor(css·ratio)`: 2284×1080 measured, odd widths possible (a3: 1512×900 @1440 → 2419×1440), "1080" can floor to 1079. `resize()` recomputes from the host on every window resize or fullscreen (`Enter` performance mode!), so **the resolution changes mid-take**. v17 notes admit "Resizing the browser during recording is not locked". **Better:** fixed drawing-buffer size W×H with CSS letterbox (§10.5).
4. **[High] "Current canvas" records the auto-quality-degraded size.** With `target=0` the pixel ratio stays wherever auto quality left it (can be 0.5 on a weak laptop, organism.ts:2727), then gets locked. There is no even-size enforcement.
5. **[High] A 2× still during a take corrupts it.** `b5` has no recording guard. `engine.snapshot(2)` (organism.ts:889-899) sets pixel ratio ×2, resizes, draws and restores, so the captured stream sees a size change. **Better:** §5 #14.
6. **[High] Failed takes are thrown away.** `finish()` saves nothing when `failure` is set (recorder-native.js:52), and the test enforces it (`'failed recording must not be presented as a valid file'`, test-recording.cjs:35). A 20-minute set that errors at minute 19 loses everything. **Better:** always finalize what exists as `…-partial.mp4` and say so.
7. **[High] 60 fps default + `lockQuality` + pixel ratio up to 4 on weak laptops.** The GPU cannot hold 60 at 2284×1080, so the take is VFR (38.5 fps measured). `contentHint='detail'` (line 25) additionally tells Chrome to preserve resolution over frame rate, which means more frame drops. **Better:** 30 fps default, fixed 1080p, CFR duplication, and a load warning.
8. **[Medium] The input-only bus has no keep-alive.** `createMediaStreamDestination()` fed only by the analyser (patch_performance.py:24). audioCtx.ts:17-23 records that Chrome's destination "emits no samples at all" when nothing is connected, and MediaRecorder then "waits for audio that never comes". Whether an idle analyser counts as connected is **unverified**. **Better:** the §10.8 worklet always produces samples while the context runs.
9. **[Medium] MIDI "Input only" includes generated sounds.** `if(recAudio==='input'&&fa!=='midi'){…}else audio=Gw()` (recording-ui.js:17-20). In MIDI mode `Gw()` includes `SoundBack` plucks (synth.ts:21 `toOutput`), contradicting the note "Input only excludes generated sounds". **Better:** explicit buses (`music` / `input` / `mix`, §10.8).
10. **[Medium] Arm-on-note misses the note.** The trigger calls async `Vw()` from the loop (awaits `context.resume`, `hl.start`). MediaRecorder starts later still, so the attack frames and audio are lost. Errors (for example "Start an audio file… first") surface only at trigger time. **Better:** validate and prepare at arm time; synchronous `begin()`; audio pre-roll from the worklet ring (§10.12).
11. **[Medium] Recorder reads the DOM.** `document.getElementById('recCompat'|'recQuality')` inside `rZ.start` breaks layering and testing. **Better:** pass a `RecordSettings` object.
12. **[Medium] Recording options are not persisted** (recAudio/Resolution/Fps/Quality/Compat), so "Editor MP4 settings" must be re-clicked every session (a3 #1).
13. **[Medium] Output is hidden in Simple (default) mode.** Users most in need of "a file that just opens" cannot see the format or profile (k3 B20).
14. **[Medium] The report is weak and mislabelled.** It hard-codes `version:'0.18.0'` in v0.19 (line 20). All values are "browser reports". The fixed filename `growth-recording-report.json` is not paired with the take; only the last report is kept, in memory. `renderCallbacks` counts rAF grabs, not encoded frames; there are no drop or dup metrics.
15. **[Low] Strict mode is a technical checkbox users must understand.** It asks for fixed level 5.2 (`avc1.640034`, `avc1.4D0034`) regardless of size, yet Chrome still produced **Constrained Baseline** (measured). The MIME profile is advisory. It refuses to record on Firefox/older Safari until the user unticks it. **Better:** negotiated profiles and one honest capability line.
16. **[Low] 400 ms polling forever** (`setInterval(syncExtraControls,400)`) to update disabled states. **Better:** state events.
17. **[Low] `Fm` guard gaps.** It blocks switching while `recording||recordingBusy` but not while armed or counting down. When a take is armed and the user switches pattern, the later trigger records the new canvas; harmless but surprising.
18. **[Low] Private engine internals are written from outside** (`engine.pixelNow`, `engine.draw`, `engine.host`). These are `private` in TS (organism.ts:510, 870, `host`), so the logic cannot be ported as-is.
19. **[Low] Test coverage is mocks only.** test-recording.cjs covers the class with fake MediaRecorder/tracks and one extracted method. There is nothing for `Vw`/`x5` (busy guard, countdown cancel, restore), nothing about file validity, and no browser run. The v17/v18 notes say so.
20. **[Low] Unused 5th argument** (`context.sampleRate`) to `hl.start`.
21. **[Resolve helper]**
    - (a) Default `--fps 30` regardless of source halves 60 fps takes silently. It should default to the source's nominal rate from ffprobe `r_frame_rate`, snapped to 24/25/30/50/60.
    - (b) `remux` of a WebM source writes `…-resolve-remux.mp4` containing VP9/Opus, which Resolve on macOS cannot decode, so the result is pointless. Refuse remux for non-H.264 input.
    - (c) No colour tags. Add `-colorspace bt709 -color_primaries bt709 -color_trc bt709 -color_range tv`.
    - (d) macOS launcher only; the owner also works on Windows. Add `Convert-for-Resolve.cmd`.
    - (e) `-fps_mode` needs FFmpeg ≥ 5.1 (older builds need `-vsync cfr`). Print the version and a hint.
    - (f) `check=True` gives a Python traceback on ffmpeg failure; catch it and print one line.
    - (g) The first existing destination aborts the whole batch (`parser.error`).
    - It stays useful only for **legacy v0.17–v0.19 takes**; new takes should not need it.

### 7.2 In the TS v0.15 target (do not carry these over)

1. **Audio can vanish silently.** `if (value.sampleRate !== sampleRate || value.numberOfChannels !== 2) { … enc.close(); this.aenc = null }` (recorder.ts:198-202) turns the take silent for the rest of the recording when the MSTP AudioData is not stereo at the context rate. That was the v17 motivation. **Fix: §10.8 (the graph guarantees 2 ch at 48 kHz by construction).**
2. **Audio chunks are dropped under load.** `else if (enc.encodeQueueSize < 40) enc.encode(value)` (:203) silently drops audio, creating gaps and drift. Audio must never be dropped.
3. **WebCodecs is gated on `MediaStreamTrackProcessor`** (:23). Firefox and Safari fall to MediaRecorder even though they have `VideoEncoder` (Firefox 130+, Safari 16.4+) and Safari 26+ has `AudioEncoder`.
4. **A/V offset.** Video timestamps are `performance.now()-started` (:226, :243), audio timestamps come from the MSTP clock, and there is `firstTimestampBehavior:'offset'` **per track** (:163, :169). Any first-arrival latency difference becomes a permanent offset, and there is no drift correction. The AAC priming delay (~1024 samples on Chrome) is not compensated either (mp4-muxer writes no `elst`; checked in `mp4-muxer.mjs`, which has `co64` and `colr` but no `edts`/`elst`).
5. **Frames are skipped, not duplicated.** When the GPU is slower than fps (`t - lastT` hold) or the encoder is busy (`encodeQueueSize > 8`, :228), the file gets timestamp gaps, which is VFR. The measured v0.15 file was clean only because 30 fps was achievable on that machine.
6. **Level choice ignores fps.** `px > 2_100_000 ? 'avc1.640033' : 'avc1.640028'` (:128): 1080p60 needs level 4.2, but 4.0 is declared. The fallbacks `4D4028` / `42E028` have the same issue.
7. **The whole file lives in RAM.** `fastStart:'in-memory'` + `ArrayBufferTarget` (:157-164) holds every chunk plus the final buffer (about 2× file size). At 24 Mbps an hour is about 10.8 GB, so the tab dies (a3 #1).
8. **A mid-take size change stretches the image** (2D-canvas `drawImage` to W×H, :231-240) instead of letterboxing, and costs a CPU-side rescale per frame.
9. **Encoder errors are only noticed at stop** (`this.failure`, :176, :266). The UI keeps showing REC.
10. **30 fps is hard-coded in main** (main.ts:796). `startRecordingNow` sets "■ stop" and `lockQuality` even when start failed (a3 #23). The countdown cannot be cancelled and double-starts are possible.
11. **The "moov first … Quick Look … need it" claim (:162) is only half true.** A moov atom at the end is the classic QuickTime layout and opens fine locally. Fast start matters for progressive web playback. This matters because streaming to disk naturally puts moov at the end.

---

## 8. Recommended TypeScript design

### 8.1 Module layout. This aligns with r1-pragmatic's `output/recorder/`.

```
src/midi/output/recorder/
  index.ts              Recorder facade: capability probe, backend choice, state machine, events, report
  capabilities.ts       probe(): {webcodecs:{h264Profiles[], vp9, aac, opus}, pcmMov, fsa, opfs, mediaRecorderTypes[]}
  profiles.ts           SIZE_PRESETS, captureSize(settings, host, dpr) → even W×H, fps list
  codecs.ts             avcCodecString(w,h,fps,bitrate,profile), bitrateFor(w,h,fps,quality), level table  (pure)
  clock.ts              ContextClock: perf ↔ AudioContext time estimator  (pure core + thin ctx adapter)
  scheduler.ts          CfrScheduler: due slots, duplicates, overload, gaps → segments  (pure)
  audioTap.ts           PcmTap: AudioWorkletNode wrapper, Blob-URL module load, block assembly
  pcmTap.worklet.js     worklet source, imported with ?raw (single-file safe)
  audioAssembler.ts     ctx-frame ranges → contiguous AudioData / AudioSample blocks, priming, trim  (pure)
  webcodecsBackend.ts   VideoEncoder + AudioEncoder (or PCM) → muxer adapter
  muxer.ts              MuxerAdapter interface + Mediabunny implementation (mp4-muxer implementation optional)
  sinks.ts              FileSink (showSaveFilePicker), FolderSink (dir handle in IndexedDB), OpfsSink, MemorySink
  mediaRecorderBackend.ts  fallback (ported from recorder-native.js, fixed)
  report.ts             TakeReport type + builder  (pure)
src/midi/audio/buses.ts   (from audioCtx.ts) context 48 kHz, buses input/instrument/soundback, speaker routing,
                          recorder mix, MediaStreamDestination for fallback/cast
src/midi/app/recordUi.ts  panel/top-bar/HUD wiring, countdown, arm, key R/Q, settings persistence
tools/convert-for-resolve.py, Convert-for-Resolve.command, Convert-for-Resolve.cmd, sync-check.py
```

### 8.2 Key types

```ts
export type AudioBusChoice = 'music' | 'input' | 'mix' | 'none'
export type Container = 'mp4' | 'mov' | 'webm'
export interface RecordSettings {
  size: 'window'|'1080p'|'1440p'|'2160p'|'vertical'|'square'|'custom'; w: number; h: number
  fps: 24|25|30|50|60; quality: 'standard'|'high'|'max'; container: Container
  audio: AudioBusChoice; saveTo: 'download'|'ask'|'folder'; startMode: 'now'|'count'|'note'
  avOffsetMs: number; sidecar: boolean; webOptimised: boolean
}
export type RecorderState = 'idle'|'preparing'|'armed'|'counting'|'recording'|'stopping'|'error'
export interface RecorderStatus {
  state: RecorderState; seconds: number; width: number; height: number; fps: number
  bytes: number; slots: number; uniqueFrames: number; dupSlots: number; overloadSlots: number; heldSlots: number
  encoderQueue: number; warning?: string; message?: string
}
export interface CaptureTarget {            // implemented by main via engine + stageCanvas
  canvas(): HTMLCanvasElement | null
  setOutputSize(size: { width: number; height: number } | null): void   // Engine.setOutputSize or no-op
}
export interface Recorder {
  readonly status: RecorderStatus
  onStatus?: (s: RecorderStatus) => void
  /** Call inside the user gesture. Opens sink (may prompt), probes/configures encoders, starts audio tap in ring mode. */
  prepare(s: RecordSettings, target: CaptureTarget): Promise<{ ok: true } | { ok: false; error: string }>
  /** Synchronous: slot 0 = the next grab(). Requires state 'armed'. */
  begin(perfNow: number): void
  /** Call in the same rAF task right after the engine drew. */
  grab(canvas: HTMLCanvasElement, perfNow: number): void
  stop(): Promise<TakeResult>           // finalize; saves partial on errors
  cancel(): Promise<void>               // from armed/counting: close everything, delete spool
  isBusy(): boolean
}
export interface TakeResult { ok: boolean; partial: boolean; name: string; bytes: number; savedTo: string; report: TakeReport; message: string }
```

Engine interface addition (engine.ts:42-77): `setOutputSize?(size: { width: number; height: number } | null): void`. Keep `lockQuality`.

### 8.3 What NOT to port as-is

- `rZ` as the primary recorder, `captureStream(fps)`-driven capture, `contentHint='detail'`.
- The pixel-ratio capture hack (`captureRatio`, external `pixelNow` writes, `te.draw?.()`).
- DOM reads inside the recorder, `setInterval` polling, and the hard-coded report version.
- The `recCompat` checkbox and "Editor MP4 settings" button. Replace them with profiles (every MP4 we write is editor-grade).
- Discarding partial takes on error.
- `O5.recordStream()` / the per-input `MediaStreamDestination` tap. Use buses.
- The "Input only (MIDI: instrument mix)" label semantics.
- The v0.15 audio mismatch drop, audio queue drop, per-track `'offset'` timestamps, fps-agnostic level, in-memory-only target and stretch-rescale.
- Keep the ffmpeg helper as a **tool for legacy takes**, not as part of the recording story.

---

## 9. Acceptance tests

### 9.1 Unit (no DOM; vitest or `node --test` + tsx; add `"test"` to package.json)

1. `codecs.avcLevel`: level byte and string for each case.
   - 1920×1080@30 → `0x28` (4.0); 1920×1080@60 → `0x2A` (4.2)
   - 2560×1440@30 → `0x32` (5.0); 2560×1440@60 → `0x33` (5.1)
   - 3840×2160@30 → `0x33`; 3840×2160@60 → `0x34` (5.2)
   - 1080×1920@30 → `0x28`; 1080×1080@30 at standard quality (8 Mbps) → `0x20` (3.2)
   - With a bitrate above the level's MaxBR (1080p30 @ 28 Mbps) → `0x29` (4.1)
   - Codec strings `avc1.64xxLL`, `avc1.4D40LL`, `avc1.42E0LL`.
2. `codecs.bitrateFor`: formula and floor/cap values from §10.6 (for example 1080p30 high → 16,000,000; 1080p60 high → 24,883,200; 4K60 max → 120,000,000).
3. `profiles.captureSize`: presets are exact. `window` gives even values ≤ 3840 wide and preserves aspect; `custom` rounds odd values down to even and clamps to 256–3840.
4. `scheduler`:
   - (a) 45 fps renders into 60 fps slots for 10 s: slots 0..599 each exactly once, strictly increasing, dup ≈ 25 %.
   - (b) 120 Hz renders into 60 fps: 50 % of renders skipped, no dups.
   - (c) 300 ms stall at 60 fps: 17 duplicates, then continue.
   - (d) 3 s gap: segment cut, and slots continue contiguously after the cut.
   - (e) Encoder queue above Qhard: fresh capture suppressed, duplicates continue (overloadSlots counted).
   - (f) Queue above Qcrit: held slots (timestamp gap) counted and `strictCFR=false`.
   - (g) Keyframe on every GOP boundary even across holds.
5. `clock`: synthetic `currentTime` sawtooth (480-frame callbacks at 48 kHz, ±2 ms main-thread jitter, 80 ppm drift over 1 h) gives an estimate error < 1.5 ms, and a suspend/resume discontinuity is detected.
6. `audioAssembler`:
   - blocks with arbitrary `frame0` give contiguous timestamps (`samplesWritten·1e6/48000`)
   - start from a ring-history frame; priming offset P=1024 applied once
   - segment cuts drop exactly the cut frames
   - stop trims audio to `round(N·48000/fps)` samples (+P)
   - mono or missing channels are impossible by construction, but the assembler must still handle `inputs[0].length ∈ {0,1,2}` blocks
7. `report`: schema complete; `version` equals `VERSION`; `strictCFR` computed.
8. `recordUi` state machine with fake timers:
   - countdown cancel
   - arm then cancel
   - double press while preparing is ignored
   - stop during stopping is ignored
   - error goes to idle with the partial message
   - `selectEngine` is blocked for every busy state
9. `MemorySink` head-patch logic: writes at position < headLen patch the head; appends go to Blob parts; the final Blob equals the byte-exact reference produced by an ArrayBuffer target on the same write sequence.

### 9.2 Node + ffprobe (muxer-level, CI-able)

10. Mux 300 synthetic H.264 packets (a tiny pre-encoded fixture) plus AAC or PCM through `MuxerAdapter` → file. ffprobe must show:
    - `nb_frames=300`, `r_frame_rate = avg_frame_rate = 30/1`, all pts deltas = 1/30
    - audio duration equal to video within 1 AAC frame
    - moov present and parsable (for fastStart false, at the end)
    - mediainfo "Frame rate mode: Constant"

### 9.3 Browser (Playwright with real Chrome, plus manual on the owner's Mac and Windows)

11. 10 s take at 1080p30 and 1080p60 (MP4): H.264 High (or Baseline under headless software encode, accepted in CI only), exactly 1920×1080, CFR, frame count within ±1 of fps·seconds, AAC 48 kHz stereo, `ffmpeg -v error -i take.mp4 -f null -` prints **zero** errors.
12. Opens without stutter, correct duration, and seekable in **Finder Quick Look, QuickTime Player, VLC (Mac + Windows), DaVinci Resolve (Free, Mac + Windows), Premiere if available, Windows Media Player / Films & TV**. The MOV + PCM profile passes the same list.
13. **Sync test:** the debug `__viz.recorder.syncTest()` plays a click (OscillatorNode on the instrument bus, scheduled at exact ctx times every 500 ms) and paints a full-white frame for the slot containing each click time. `tools/sync-check.py` finds white frames (`signalstats` YAVG > 200) and click onsets (`silencedetect` / envelope). Require |offset| ≤ 1 frame on Chrome/Edge (Mac and Windows) and Safari 26. Record the measured AAC priming.
14. Buses: file mode with the instrument playing: `input` contains only the file, `music` contains the file plus instrument, `mix` also contains sound-back. MIDI mode `input` gives a silent track plus a UI hint.
15. Mono USB mic on a 44.1 kHz device: the take is 48 kHz stereo with the mic in both channels and no dropouts (inspect the waveform for gaps).
16. Resize the window, enter fullscreen (`Enter`), hide the UI (`F2`) and press `Q` during a take: the file dims never change, the image is not stretched, and the still is W×H PNG. `Shift+Q` is refused.
17. Weak-laptop run at 1080p60: HUD shows dup %, the file is still strictly CFR, and audio is continuous.
18. 30-minute take to a folder (Chrome) and to download (Brave, where FSA is off by default): browser memory stays within +300 MB; the file opens. A >4 GB take (4K high ≈ 7 min) opens (largesize mdat / co64).
19. Hide the tab for 5 s mid-take: the take contains a clean cut (report lists it), A/V stay in sync after the cut.
20. Unplug the mic or stop the tab share mid-take: recording continues (silence); stop saves normally. Kill the encoder by forcing an unsupported config after start, or simulate: a `-partial` file is saved and the message says so.
21. Arm-on-note: the first video frame shows the note's first growth, and the audio contains the attack (no missing first ~100 ms).
22. Firefox 130+ and Safari 26: the capability line is truthful, the recording works via the chosen path (§10.3), and the file plays.
23. Single-file HTML opened from `file://`: the worklet loads from a Blob URL, OPFS works or falls back to the memory sink, and recording works offline.

---

## 10. DESIGN — the best recorder

### 10.1 Goals

1. **Every take opens everywhere without stutter:** Quick Look, QuickTime, VLC, Resolve, Premiere, Windows players. Achieved through H.264 High in a regular (non-fragmented) MP4/MOV, with **true constant frame rate** and correct durations.
2. **What you see is what you get:** a fixed output size (1920×1080 by default), independent of window size and fullscreen, previewed live with letterboxing, and rendered once at native resolution (no upscaling).
3. **The sound is never missing, never drifts:** sample-exact 48 kHz stereo PCM taken inside the audio graph, a selectable bus, A/V anchored on the audio clock, and AAC priming compensated.
4. **Long sets never crash the tab:** stream to disk (a chosen file or takes folder, or an OPFS spool), with bounded memory.
5. **Fails soft:** partial takes are saved; overload is visible; an honest report is available.
6. **Light:** hardware H.264, GPU-side frame capture, no extra render pass, and 30 fps default for weak laptops.
7. **Offline single-file compatible:** worklet and workers inlined as strings and loaded via Blob URLs; no network.

Non-goals: ProRes or DNxHR (no browser encoder); alpha video; 10-bit/HDR.

### 10.2 Decision summary

| Decision | Choice | Why |
|---|---|---|
| Video encode | WebCodecs `VideoEncoder`, H.264 High → Main → Constrained Baseline, level computed | CFR control, profile/level/GOP control, hardware encode, proven in v0.15 |
| Muxer | **Mediabunny** (`Output` + `Mp4OutputFormat`/`MovOutputFormat`/`WebMOutputFormat`, `EncodedVideoPacketSource`, `AudioSampleSource`/`EncodedAudioPacketSource`, `StreamTarget`/`BufferTarget`), behind a `MuxerAdapter` | Maintained successor to the deprecated mp4-muxer. Adds PCM-in-MOV/MP4, `fastStart:'reserve'`, metadata tags, WebM in one library, and a `Conversion` API for fixing legacy takes. mp4-muxer 5.2.2 remains a drop-in adapter if the team wants zero new deps in phase 1 (no PCM/MOV). |
| Audio source | **AudioWorklet PCM tap** on a recorder mix node with `channelCount:2, channelCountMode:'explicit', channelInterpretation:'speakers'` in the 48 kHz context | Stereo at 48 kHz **by construction** (the graph up/down-mixes; the context resamples device I/O), so mismatch is impossible. Works in Chrome/Edge/Brave/Firefox/Safari (no MSTP). Sample-counter timestamps. |
| Audio encode | MP4: AAC-LC 256 kbps via `AudioEncoder`; MOV "Editor master": 24-bit PCM (no encoder, no priming); WebM: Opus 192 kbps | PCM avoids lossy audio and priming entirely and works without `AudioEncoder` (Firefox, Safari ≤ 18) |
| Clock | Audio (AudioContext) time is the master. Video slots are placed on a CFR grid anchored to context time via a perf↔ctx estimator. | No drift; A/V identical by construction |
| Frames | Render at the capture size into the main canvas; CSS letterbox; `new VideoFrame(canvas)` in the same task | One render, exact size, no scaling |
| Slow GPU | Duplicate the previous frame into missed slots | Keeps strict CFR (what Resolve needs) and sync |
| Slow encoder | Tiered: duplicates-only, then held slots as last resort, never abort | §10.10 |
| Storage | FSA file/folder, else OPFS spool, else memory (Blob spool). `fastStart:false` (moov at end) when streaming. | Bounded memory; all target players read moov-at-end locally |
| Fallback | MediaRecorder only if no `VideoEncoder` or no encodable video codec | Firefox Android, very old Safari |

### 10.3 Support matrix and path selection

| Browser | VideoEncoder H.264 | AudioEncoder | AudioWorklet | FSA pickers | OPFS writable | Path |
|---|---|---|---|---|---|---|
| Chrome / Edge (Win, mac) | yes (HW High; SW OpenH264 Baseline fallback) | AAC + Opus (no AAC on desktop Linux) | yes | yes | yes | **WebCodecs MP4 (AAC) or MOV (PCM)** → File/Folder/OPFS/Memory |
| Brave | yes | as Chrome | yes | **disabled by default** (flag) | yes (verify; not in private windows) | WebCodecs → OPFS/Memory; hide "ask/folder" |
| Firefox 130+ desktop | advertised; a known bug where `isConfigSupported` says yes but `configure` fails. **Probe with a real configure plus a 1-frame test encode.** VP9/VP8 reliable. | Opus yes, **AAC no** | yes | no | yes (111+) | H.264 works: **MOV + PCM** (no AAC needed) or WebM VP9/Opus. Otherwise WebM. Optional later: AAC via the `@mediabunny/aac-encoder` WASM extension. |
| Safari 26+ | yes (VideoToolbox) | **AAC yes (26+)** | yes | no | createWritable 26+ | WebCodecs MP4/MOV → OPFS/Memory |
| Safari 16.4–18 | yes | **no** | yes | no | sync handle in worker only | WebCodecs video + **PCM (MOV)**, else MediaRecorder (fMP4) |
| No VideoEncoder (Firefox Android, very old) | — | — | — | — | — | MediaRecorder fallback (honestly labelled) |

The probe runs at boot (async, cached) and again at `prepare()`:
```ts
for (const profile of ['64', '4D', '42E0']) cfg = {codec: avc(profile, level), width, height, bitrate, framerate: fps,
  latencyMode:'quality', bitrateMode:'variable', hardwareAcceleration:'prefer-hardware', avc:{format:'avc'}}
// try prefer-hardware, then no-preference; accept only if isConfigSupported().supported
// and (Firefox) a real configure()+encode(1 black frame)+flush() produces one chunk within 2 s
```

### 10.4 Pipeline

```
rAF loop (main thread)                                   audio thread (48 kHz context)
 clock.tick ─ arm trigger → recorder.begin()   [sync]    input bus ─┐ (analyser → input bus)
 engine.frame(): draws into canvas W×H (fixed)            instr bus ─┼─► recordMix (GainNodes per choice)
 recorder.grab(canvas, perf):                             sndbk bus ─┘        │ channelCount 2, explicit, speakers
   ctxNow = clock.now(perf)                                                   ▼
   scheduler → slots to fill                                     AudioWorkletNode 'growth-pcm-tap'
   new VideoFrame(canvas,{timestamp,duration})                    ring (2 s) + emit from frame F
   duplicates via new VideoFrame(lastFrame,{timestamp})           posts {frame0, planar Float32 [L|R] ×1024}
   videoEncoder.encode(frame,{keyFrame})                                      │ (transfer)
        │ output(chunk, meta)                                                 ▼
        ▼                                                  audioAssembler (main): ctx-frame ranges → blocks
  muxer.addVideo(packet, meta) ◄──────────────┐              ├─ MP4: AudioData f32-planar → AudioEncoder(AAC) → muxer
                                              └──────────────┤─ MOV: AudioSample → PCM s24 source → muxer
                                                             └─ WebM: AudioEncoder(Opus) → muxer
  muxer ─► sink (FSA file / folder / OPFS / memory spool)
```

Phase 2 (optional): move encoders, muxer and sink into a dedicated Worker (inline Blob URL). `VideoFrame` is transferable (`postMessage(frame,[frame])`); OPFS `createSyncAccessHandle` is then available (Safari 15.2+). The main thread keeps only frame capture and the scheduler.

### 10.5 How frames are produced at the capture resolution

**Chosen: render at the capture size in the main canvas, preview letterboxed.**
- `Engine.setOutputSize({width:W, height:H})`. Organism and crystal3d `resize()` (organism.ts:729-739, crystal3d.ts:131-140), while set:
  ```ts
  this.renderer.setPixelRatio(1)
  this.renderer.setSize(W, H, false)               // drawing buffer exactly W×H; don't touch CSS size
  this.camera.aspect = W / H; this.camera.updateProjectionMatrix()
  const s = Math.min(host.clientWidth / W, host.clientHeight / H)   // letterbox rect
  Object.assign(this.canvas.style, { position:'absolute', width:`${W*s}px`, height:`${H*s}px`,
    left:`${(host.clientWidth - W*s)/2}px`, top:`${(host.clientHeight - H*s)/2}px` })
  ```
  Window resize or fullscreen only re-runs the CSS part. Auto quality (organism.ts:2723) is skipped while `outputSize` is set. Bloom post-processing follows the renderer size automatically. The only host-size dependency in organism.ts is `resize()` (grep: `host.client*` appears only at :731-732), so pointer drags and gestures are unaffected. The black letterbox is invisible against the black void; the frame guide (§4.3) shows the edges.
- It is set when the user opens Output or presses rec (the preview matches the file before recording starts), and cleared after the take unless "Keep preview at recording size" is on.
- `size:'window'` = even `min(host·dpr, 3840)` computed once at prepare. This is full-bleed with no letterbox and is the right choice for OBS-style use.
- **Engines without `setOutputSize`** (2D engines using `fitCanvas`, engine.ts:90-101): the recorder letterbox-scales into an `OffscreenCanvas(W,H)` (2D `drawImage` with a black fill, preserving aspect, never stretching) and makes the VideoFrame from that. The same path covers a mid-take engine swap (Phase 2).
- Rejected: (a) the v19 pixel-ratio boost (aspect follows the window, odd sizes, changes mid-take); (b) a second render into a W×H render target per slot (2× GPU cost; only worthwhile for a future "vertical cut while projecting landscape" feature); (c) scaling the screen canvas (blurry, aspect issues).
- **Stills during a take:** save the current W×H frame (`canvas.toBlob` in the grab task). 2× is disabled. Outside a take, `snapshot(scale)` is unchanged.
- **Casting** (`cast.ts:26`) automatically sends the fixed-size canvas while `outputSize` is set.

### 10.6 Video encoder configuration

- Codec strings: `avc1.PPCCLL`, with PP/CC = `64 00` (High), `4D 40` (Main), `42 E0` (Constrained Baseline), and level LL from:
  ```ts
  // [level_idc, MaxMBPS, MaxFS, MaxBR_High(bit/s)]  (H.264 Table A-1; High MaxBR = 1.25 × Baseline/Main)
  const LEVELS = [[0x1F,108000,3600,17.5e6],[0x20,216000,5120,25e6],[0x28,245760,8192,25e6],[0x29,245760,8192,62.5e6],
                  [0x2A,522240,8704,62.5e6],[0x32,589824,22080,168.75e6],[0x33,983040,36864,300e6],[0x34,2073600,36864,300e6]]
  const fs = Math.ceil(W/16) * Math.ceil(H/16), mbps = fs * fps
  level = LEVELS.find(([, m, f, br]) => fs <= f && mbps <= m && bitrate <= br) ?? LEVELS.at(-1)
  ```
- Bitrate: `clamp(round(W·H·fps·bppf[q]), floor[q], 120e6)` with `bppf = {standard: 0.10, high: 0.20, max: 0.35}` and `floor = {standard: 8e6, high: 16e6, max: 28e6}`. Examples: 1080p30 = 8 / 16 / 28 Mbps; 1080p60 = 12.4 / 24.9 / 43.5 Mbps; 4K30 = 24.9 / 49.8 / 87.1 Mbps; 4K60 = 49.8 / 99.5 / 120 Mbps. `bitrateMode:'variable'`.
- `framerate: fps`, `latencyMode:'quality'`, `hardwareAcceleration:'prefer-hardware'` then `'no-preference'`, `avc:{format:'avc'}` (avcC; **not** avc3, which QuickTime handles poorly — v19's move from `avc3.42E01E` to `avc1` was right).
- GOP: keyframe every `fps` slots (1 s; good scrubbing in editors), forced at slot 0 and at the first encoded slot of every GOP group after holds or cuts.
- Colour: pass `meta.decoderConfig` to the muxer with `colorSpace` normalised to `{primaries:'bt709', transfer:'bt709', matrix:'bt709', fullRange:false}` when the encoder reports sRGB transfer (`'iec61966-2-1'`) or omits it. That is the tagging editors expect for HD SDR. Acceptance: black stays black, mid-grey matches across QuickTime, VLC and Resolve (the QuickTime gamma quirk is documented, not fixable).
- WebM: `vp09.00.LL.08` (profile 0, 8-bit), with level from the VP9 luma-sample-rate table (`vp09.00.40.08` ≤ 1080p30, `vp09.00.41.08` for 1080p60, `.50.08` for 4K30, `.51.08` for 4K60; note TS v0.15 used `vp09.00.40.08` even for 60 fps), `bitrate` as above.

### 10.7 CFR slot scheduler (the heart of "no stutter")

The timeline is in AudioContext seconds. Slot `s` covers `[T0 + s/fps, T0 + (s+1)/fps)`. Timestamp: `ts(s) = Math.round(s * 1e6 / fps)` µs; duration: `Math.round(1e6/fps)`.

```ts
grab(canvas, perf) {
  const now = clock.now(perf)                              // ctx seconds, §10.9
  if (this.seg.pendingStart) { this.seg.start(now); }       // T0 for this segment
  let due = this.seg.slotStart + Math.floor((now - this.seg.ctxStart) * fps + 1e-6)
  if (due < this.next) return                              // rendering faster than fps: skip this render
  const gap = (due - this.next) / fps
  if (gap > MAX_GAP_S /* 2.0 */) {                         // hidden tab, long freeze, ctx suspend
    this.cutSegment(now)                                   // A and V both cut at a slot boundary; report it
    due = this.next
  }
  const q = venc.encodeQueueSize
  const overloaded = q > Q_HARD                            // Q_HARD = fps (≈1 s backlog)
  // 1) slots [next, due) never saw a fresh image: repeat the previous image (cheap)
  for (let s = this.next; s < due; s++) {
    if (q > Q_CRIT) { this.held++; continue }              // Q_CRIT = 4*fps: last resort, timestamp gap (VFR)
    this.encode(new VideoFrame(this.last ?? blackFrame, { timestamp: ts(s), duration }), s); this.dup++
  }
  // 2) slot `due` gets the fresh image, unless the encoder is drowning
  if (!overloaded) {
    const f = new VideoFrame(canvas, { timestamp: ts(due), duration, alpha: 'discard' })
    this.encode(f, due, /*keep*/ true); this.last?.close(); this.last = f; this.unique++   // keep `last` for duplicates
  } else if (q <= Q_CRIT) { this.encode(new VideoFrame(this.last!, { timestamp: ts(due), duration }), due); this.overload++ }
  else this.held++
  this.next = due + 1
}
encode(frame, s, keep = false) { const g = Math.floor(s / fps); venc.encode(frame, { keyFrame: g !== this.lastGop }); this.lastGop = g; if (!keep) frame.close() }
// on stop/cancel: this.last?.close()
```

- Duplicates reference the same GPU resource (`new VideoFrame(videoFrame, init)` clones), so memory does not grow per duplicate. Encoding an identical frame as a P-frame is very cheap.
- The muxer is told `frameRate: fps` (Mediabunny `addVideoTrack(src, {frameRate})` / mp4-muxer `video.frameRate`), so timestamps snap to the grid.
- Strict CFR holds unless `held > 0` (report `strictCFR: held === 0`; HUD warning; advice "choose 30 fps or 1080p").
- On stop: `N = next` slots written. The last sample's duration is `1/fps`.

Why duplicates rather than timestamp gaps: Resolve and many NLEs index frames sequentially and assume a constant rate. A 300 ms gap sample (VFR) makes every later frame drift against audio. Duplicates keep the frame count equal to `duration × fps`.

### 10.8 Audio: buses, worklet tap, encoding

**Bus graph** (`audio/buses.ts`, replacing audioCtx.ts's single `recordDest`):
```ts
ctx = new AudioContext({ sampleRate: 48000 })                 // keep (audioCtx.ts:15)
buses.input      = ctx.createGain()   // AudioInput: analyser.connect(buses.input) (was toRecordingOnly)
buses.instrument = ctx.createGain()   // Instrument master + wet  (synth.ts:98, :111) → also → ctx.destination
buses.soundback  = ctx.createGain()   // SoundBack master (synth.ts:21)            → also → ctx.destination
// speakers: instrument & soundback → destination; input reaches speakers only via the existing file-monitor
// connection analyser → destination (inputAudio.ts:170-173; mic/tab never monitored)
recordMix = ctx.createGain()          // per take: connect buses per choice
//   music = input + instrument ; input = input ; mix = input + instrument + soundback ; none = (no audio track)
fallbackDest = ctx.createMediaStreamDestination() + ConstantSource(0) keep-alive  // MediaRecorder fallback / cast only
```

**Worklet** (`pcmTap.worklet.js`, imported `?raw`, loaded via `URL.createObjectURL(new Blob([src],{type:'text/javascript'}))` → `ctx.audioWorklet.addModule(url)`; must work from `file://`, test #23):
```js
class PcmTap extends AudioWorkletProcessor {
  constructor(o) { super(); const p = o.processorOptions
    this.block = p.block /*1024*/; this.cap = p.ringFrames /*96000 = 2 s*/
    this.L = new Float32Array(this.cap); this.R = new Float32Array(this.cap)
    this.end = -1            // absolute frame index after the last written sample
    this.emit = -1           // next absolute frame to emit (-1 = idle)
    this.buf = null; this.bufN = 0; this.buf0 = 0
    this.port.onmessage = ({ data: m }) => {
      if (m.cmd === 'emitFrom') this.emit = Math.max(m.frame, this.end - this.cap)   // clamp to ring history
      else if (m.cmd === 'idle') { this.flush(); this.emit = -1 } }
  }
  process(inputs) {
    const ch = inputs[0], n = ch[0]?.length ?? 128, f0 = currentFrame
    const l = ch[0], r = ch[1] ?? ch[0]                   // explicit 2-ch mixing makes r present; guard anyway
    for (let i = 0; i < n; i++) { const k = (f0 + i) % this.cap; this.L[k] = l ? l[i] : 0; this.R[k] = r ? r[i] : 0 }
    this.end = f0 + n
    if (this.emit >= 0) while (this.emit < this.end) {    // copy ring → planar block
      if (!this.buf) { this.buf = new Float32Array(this.block * 2); this.bufN = 0; this.buf0 = this.emit }
      const k = this.emit % this.cap; this.buf[this.bufN] = this.L[k]; this.buf[this.block + this.bufN] = this.R[k]
      this.bufN++; this.emit++
      if (this.bufN === this.block) this.flush()
    }
    return true
  }
  flush() { if (!this.buf || !this.bufN) return
    this.port.postMessage({ frame0: this.buf0, n: this.bufN, block: this.block, pcm: this.buf }, [this.buf.buffer]); this.buf = null }
}
registerProcessor('growth-pcm-tap', PcmTap)
```
Node: `new AudioWorkletNode(ctx, 'growth-pcm-tap', { numberOfInputs:1, numberOfOutputs:1, outputChannelCount:[1], channelCount:2, channelCountMode:'explicit', channelInterpretation:'speakers', processorOptions:{ block:1024, ringFrames:96000 } })`. Connect `recordMix → tap → zeroGain(0) → ctx.destination` so it is always pulled.

Properties that fix the v0.15 and v19 failures:
- **Channel or rate mismatch cannot happen.** `channelCountMode:'explicit'` with `channelCount:2` makes the graph up-mix mono (L=R) and down-mix 5.1 by speaker rules. The context runs at 48 kHz and resamples mic/tab/device internally.
- **No gaps, never dropped.** The worklet produces a sample for every rendered quantum, zeros when nothing plays. `postMessage` queues are lossless. The main thread never drops audio; if `AudioEncoder.encodeQueueSize` grows, blocks are just queued (they are tiny: 48k × 2 × 4 B = 384 KB/s).
- **Exact timestamps** from the sample counter: `timestamp = round(samplesWritten · 1e6 / 48000)`.

**Main-thread assembly and encoding:**
- AAC (MP4): `new AudioData({ format:'f32-planar', sampleRate:48000, numberOfFrames:n, numberOfChannels:2, timestamp, data: pcm.subarray(0,n) and pcm.subarray(block, block+n) packed contiguously })`, then `aenc.encode(ad); ad.close()`. Config `{codec:'mp4a.40.2', sampleRate:48000, numberOfChannels:2, bitrate:256000}`, falling back to 192000 then 160000 via `isConfigSupported`. Output goes to `EncodedAudioPacketSource('aac')` with `meta.decoderConfig`.
- PCM (MOV "Editor master"): Mediabunny `AudioSampleSource({codec:'pcm-s24'})` (or `'pcm-s16'`), adding samples built from the same planar data. No `AudioEncoder` is needed, so this works on Firefox and Safari ≤ 18.
- Opus (WebM): `{codec:'opus', sampleRate:48000, numberOfChannels:2, bitrate:192000}`. OpusHead pre-skip handles priming, so no manual compensation.
- `none`: no audio track.

### 10.9 A/V synchronisation

1. **Master clock = AudioContext render time.** The visual in a rAF reflects the analyser's latest data, which is the audio at the render head (`ctx.currentTime`), and MIDI notes start the synth "now" at the render head. The file places both at the same media time. Speaker output latency is deliberately ignored: it is a property of the room, not of the file.
2. **Perf ↔ ctx estimator (`clock.ts`).** Sample on every rAF: `o = ctx.currentTime − performance.now()/1000`. `currentTime` advances in callback-sized steps, so `o` is a sawtooth whose **maximum** is the true offset. Keep `max(o)` over a sliding 1 s window and smooth it with an EMA (α = 0.05). If `|max − est| > 0.25 s` (suspend/resume or a device switch), snap and flag a discontinuity. `now(perf) = perf/1000 + est`. It starts sampling at `prepare()` so there is ≥ 0.5 s of history before `begin()` (without history, use the raw value; error ≤ one callback ≈ 10–20 ms). Drift between the system and audio clocks (~50–100 ppm) is absorbed because slots are placed on audio time: at worst one extra duplicate or skip every few minutes.
3. **Start.** `begin(perf)`: `T0 = clock.now(perf)`, `F0 = round(T0·48000)`. The first grab in the same task is slot 0. Tell the worklet `emitFrom = F0 + P` (history from the ring, so arm-on-note includes the attack).
4. **Priming compensation `P`.** Chrome's and Safari's AAC encoders delay real audio by ~1024 samples with leading silence, and WebCodecs does not expose the delay. Neither mp4-muxer nor Mediabunny writes an `elst` for it (mp4-muxer code checked; Mediabunny issue #444). Starting the encoder input `P` samples *later* in context time makes decoded file audio at media time `t` equal to context audio at `T0 + t`. Defaults: `P = 1024` for AAC on Chromium and WebKit, `P = 0` for PCM and Opus. Plus the user trim `avOffsetMs` (±100 ms, converted to samples and added to P). Safari additionally zeroes about the first 2112 samples, which only affects the first ~44 ms of a take. Acceptance test #13 measures the real value per platform; update the default table from measurements.
5. **Cuts** (gap > 2 s, tab hidden, context suspended): video ends at slot `Nk`, and audio for that segment ends at `F_segStart + (Nk − slotStart)·(48000/fps)`. Samples per slot are integers for every offered fps (24 → 2000, 25 → 1920, 30 → 1600, 50 → 960, 60 → 800), so segment boundaries align exactly. The next segment starts at the next render with a new ctx anchor; audio resumes from that anchor. Media time stays contiguous in both tracks. The report lists the cuts.
6. **Stop.** `N` slots → audio samples written = `N·48000/fps` exactly (plus `P` of encoder tail, which is harmless). Durations match to the sample. `visibilitychange` to hidden triggers a warning (status + HUD). If rAF actually stops, the gap rule cuts.

### 10.10 When the encoder falls behind

| Encoder queue (`encodeQueueSize`, watched on `dequeue`) | Behaviour | File |
|---|---|---|
| ≤ `Q_SOFT = max(2, ceil(fps/8))` | normal: fresh frame + duplicates for missed slots | strict CFR |
| `Q_SOFT` … `Q_HARD = fps` | normal, HUD shows "encoder busy" | strict CFR |
| `Q_HARD` … `Q_CRIT = 4·fps` | **no fresh captures**: every due slot gets a duplicate of the last frame (the picture freezes briefly; duplicates are cheap) | strict CFR, `overloadSlots` counted |
| > `Q_CRIT` | skip slots (timestamp gap), persistent warning "encoder can't keep up — lower size or fps" | VFR in that region, `heldSlots`, `strictCFR:false` |
| sustained > `Q_CRIT` for 10 s | keep going (never abort a performance); suggest stopping | — |

- Audio is never throttled.
- Pre-flight: after 2 s of recording, if `(dup + overload)/slots > 20 %`, show a toast: "Your GPU renders ~X fps; a 30 fps take will look smoother" (X from the render rate EMA).
- Sink back-pressure: track pending bytes to the writable. If > 256 MB, show a warning; keep writing.

### 10.11 Muxing and saving long takes

- **Sinks, in order of preference by `saveTo`:**
  - `ask`: `showSaveFilePicker({ suggestedName, id:'growth-take', startIn:'videos', types:[{description:'MP4 video', accept:{'video/mp4':['.mp4']}}] })` → `createWritable()`. Streamed.
  - `folder`: a `FileSystemDirectoryHandle` from `showDirectoryPicker({id:'growth-takes', mode:'readwrite', startIn:'videos'})`, persisted in IndexedDB. Per take: `queryPermission`, then `requestPermission` (in the gesture), then `getFileHandle(name,{create:true})` → `createWritable()`. No dialogs per take, which suits a VJ.
  - `download` (and the fallback for Brave/Firefox/Safari): **OPFS spool** `navigator.storage.getDirectory()` → `growth-spool/<name>` → `createWritable()` (Chrome, Firefox 111+, Safari 26+; in a worker `createSyncAccessHandle` otherwise). On finalize: `getFile()` → `download(file, name)`. The browser streams the disk-backed file into Downloads. Delete after 24 h, or offer "Unsaved takes" on the next start.
  - Last resort: **MemorySink.** Collect writes into ~4 MB `Blob` parts (Chrome pages large Blob storage to disk), keep the first 64 KB as a mutable head to accept the muxer's header patches (mdat size), and build `new Blob([head, ...parts])` at the end. Warn at 1.5 GB.
- **fastStart:** streaming sinks use `false` (moov at end: the classic QuickTime layout, fine for Quick Look, QuickTime, VLC and Resolve on local files; verify in test #12). "Web-optimised" uses `'reserve'` with `maximumPacketCount` from a "max take length" (default 180 min; about 20 MB reserved). The take auto-stops cleanly at the cap. `'in-memory'` is never used for long takes. **Fragmented output is never used for editor files** (that is the v19 problem).
- Files > 4 GB: largesize mdat and co64 (mp4-muxer supports both, per code; Mediabunny to verify, test #18).
- Name: local-time `growth_2026-09-23_21-14-05_roots_1080p30.mp4`, plus `…report.json` when sidecar is on. Partial saves use the `…_partial.mp4` suffix.
- Metadata (Mediabunny `metadataFormat` / tags): title `Growth vX.Y.Z — <look>`, comment = a compact settings summary. This keeps "versions visible" even inside the file.

### 10.12 Start modes and the state machine

```
idle ──rec(now)──► preparing ──ok──► armed ──(same task)──► begin ► recording ──rec──► stopping ──► idle
idle ──rec(count)─► preparing ──ok──► counting(3,2,1 ×1000 ms) ──► begin ► recording
idle ──rec(note)──► preparing ──ok──► armed(♪) ──first note-on in loop──► begin ► recording
armed/counting ──rec──► cancel (close encoders, delete spool) ──► idle         preparing ──rec──► ignored
any error in prepare ─► idle + message (nothing recorded)    error while recording ─► stopping (partial) ─► idle
```

- `prepare()` runs in the click task. In order: (1) sink selection (picker/permission, needs activation) → (2) `ctx.resume()` → (3) `setOutputSize` + one draw → (4) encoder probe/configure → (5) muxer `start()` → (6) worklet ready with the ring filling. Validation errors (for example `audio:'input'` in MIDI mode) appear here, not at the trigger.
- The button texts: `● rec` → `…` (preparing) → `cancel` (armed/counting) → `■ stop` (recording) → `saving…` (stopping). Port the v19 token-cancellable countdown and busy guard.
- `beforeunload` prompts while recording or stopping.

### 10.13 Coexistence

- **Casting:** unaffected; it sees the fixed-size canvas.
- **Stills:** §10.5.
- **Engine switching:** Phase 1 blocks it (all busy states). Phase 2 allows it: the recorder keeps a black or duplicate frame during `mount`, re-applies `setOutputSize`, and uses letterbox scaling for 2D engines.
- **Reset / looks / presets:** unaffected.
- **Camera lock / screen bounce (v18):** unaffected (projection-matrix tricks render into the same canvas).

### 10.14 MediaRecorder fallback (only when WebCodecs video is unavailable)

Port `recorder-native.js` into `mediaRecorderBackend.ts` with these changes:
- Take options as parameters (no DOM reads).
- `contentHint='motion'`.
- Use `canvas.captureStream(0)` + `track.requestFrame()` called by the same CFR scheduler: at most one frame per rAF, but evenly paced.
- Audio from `fallbackDest.stream` clones for the selected buses.
- MIME order: explicit `avc1…,mp4a.40.2` first, then Opus/VP9 WebM.
- Always save partials.
- Label it honestly: "Browser recorder: timing may vary; use 'Fix a take' or the converter for editing."
- Keep the owned-track cleanup exactly as v19 did (it is correct).

### 10.15 Errors, partial saves, recovery

- `VideoEncoder` or `AudioEncoder` `error` callback, or a sink write rejection: switch to `stopping`, finalize the muxer with what it has (packets already muxed are valid), and save as `_partial`. The status explains and the report lists the error.
- Muxer finalize failure: keep the spool file (OPFS) and offer "Download raw data" for support.
- Crash or tab kill mid-take: moov-at-end files are unrecoverable without the index. Phase 3 option "crash-safe": spool as fragmented MP4 to OPFS (append-only, every fragment self-contained) and on stop **remux** (packet copy, no re-encode) to regular MP4 with Mediabunny `Conversion`. On the next start, offer to recover an unfinished spool.

### 10.16 Take report (sidecar `…report.json`, or button "Save last take report")

```json
{ "app":"Growth","version":"<VERSION>","createdAt":"2026-09-23T21:14:05+02:00","userAgent":"…",
  "file":{"name":"…mp4","bytes":0,"container":"mp4","fastStart":false,"sink":"folder|file|opfs|memory","partial":false},
  "video":{"codec":"avc1.640028","profile":"High","level":"4.0","width":1920,"height":1080,"fps":30,"bitrate":16000000,
           "hardwareAcceleration":"prefer-hardware","gopFrames":30,"colorSpace":{…},
           "slots":0,"uniqueFrames":0,"dupSlots":0,"overloadSlots":0,"heldSlots":0,"strictCFR":true},
  "audio":{"bus":"music","codec":"mp4a.40.2|pcm-s24|opus|none","sampleRate":48000,"channels":2,"bitrate":256000,
           "samples":0,"primingCompensation":1024,"avOffsetMs":0},
  "timing":{"durationSeconds":0,"segments":[{"atSeconds":0,"cutSeconds":0,"reason":"tab hidden"}],
            "renderFpsMean":0,"renderFpsP5":0,"encoderQueueMax":0,"clockDiscontinuities":0},
  "scene":{"engine":"organism","look":"roots","globals":{…},"engineCtl":{…}},
  "warnings":[] }
```
Everything is **known from our own pipeline**, not "browser reports".

### 10.17 UI/UX

See §3.2 and §4.3. The top-bar profile chip is always visible, including in Simple mode. After a take, the status shows `saved growth_…_1080p30.mp4 · 212 MB · 3:41 · constant 30 fps · H.264 High + AAC` (plus `· 12 repeated frames (0.2%)` if any). Optional later: "Fix a take…" (Phase 3), which drops an old v17–v19 file onto the page and uses Mediabunny `Conversion` (`frameRate`, even size, H.264 + AAC or PCM) entirely offline. It replaces the Python + FFmpeg helper for most users.

### 10.18 Performance budget (weak laptop)

- Default 1080p30. Rendering 1920×1080 at pixel ratio 1 is typically **cheaper** than a Retina window at the default auto-quality ceiling, and capture adds one GPU copy per slot. Hardware H.264 runs on a dedicated block; CPU cost is muxing (memcpy) plus worklet message handling (~47 msgs/s).
- Main-thread work per slot: create one `VideoFrame`, call encode, occasionally clone for duplicates. No `getImageData`, no 2D rescale (except for 2D engines).
- Phase 2 worker offload removes muxing and I/O from the render thread.

### 10.19 Optional Phase 3: "Render take offline" (with k2-performance P13)

For audio-file performances, render the whole track **non-real-time** at any size (4K60) with perfect CFR on a weak laptop:
- MusicClock time injection (music.ts:136-138 `now()` uses `performance.now()`; organism.ts has 2 direct `performance.now()` calls to route through it).
- Offline features via the same FFT pipeline computed from the decoded `AudioBuffer`.
- Frame n at `t = n/fps`. Encode with back-pressure (`await` the encoder queue < 4).
- Audio straight from the `AudioBuffer` (already 48 kHz, decoded by the 48 kHz context).

Live MIDI/mic takes would first need the performance recorded (events + audio), which is P13's design. This is the only way to get flawless 4K60 on the owner's weak laptop.

### 10.20 Honest comparison with the v19 MediaRecorder approach

| Criterion | v19 MediaRecorder | Proposed WebCodecs |
|---|---|---|
| Opens in Quick Look / QuickTime / Windows players | fMP4 with zero durations: Quick Look refuses (owner), Windows no seeking | regular MP4/MOV with durations |
| Resolve / Premiere smoothness | VFR (measured 38.5 fps effective, 297 ms gaps, DTS errors), needs ffmpeg conversion | strict CFR by construction; duplicates when the GPU is slow |
| Exact size | window aspect, odd sizes, changes mid-take | fixed W×H, even, preview matches |
| A/V sync | browser-managed; generally OK within a take | audio-clock anchored + priming compensation; **must be verified (test #13)** because it is our code |
| Audio robustness | browser-muxed; input-only bus may stall (unverified) | worklet guarantees 48 kHz stereo; never dropped |
| Long takes | Blob chunks (paged to disk by Chrome): **good** | FSA/OPFS streaming: **better** (no final copy with FSA) |
| Main-thread cost | minimal | small (frame creation + mux); worker in Phase 2 |
| Code size / complexity | ~70 lines | ~1,200–1,600 lines incl. tests; more to get wrong |
| Browser coverage | everything with MediaRecorder | Chrome/Edge/Brave/Firefox 130+/Safari 16.4+ (with PCM or AAC variants); MediaRecorder fallback elsewhere |
| Diagnostics | "browser reports" | exact report of what was written |
| Control | none (profile, GOP, level chosen by the browser; Baseline measured) | full |

MediaRecorder genuinely wins on simplicity, ubiquity and memory friendliness, and it is a sound fallback. It cannot meet the owner's hard requirements (Quick Look, Resolve without stutter, fixed size), and no setting fixes that: the problems are structural. **Recommendation: WebCodecs primary, MediaRecorder fallback.** Delete the Resolve-conversion dependency from the normal workflow and keep the helper for legacy takes.

### 10.21 Phasing and effort

- **Phase 1 (L):**
  - buses + worklet tap + clock + scheduler + WebCodecs MP4 (AAC) and MOV (PCM) via Mediabunny
  - FileSink / FolderSink / OPFS / MemorySink
  - `setOutputSize` in organism and crystal3d
  - recordUi state machine + settings persistence + HUD
  - MediaRecorder fallback port
  - unit tests + ffprobe CI test + the sync test tool
- **Phase 2 (M):** worker offload, engine switching during takes, WebM VP9/Opus polish, crash-safe fMP4 spool + remux.
- **Phase 3 (M–L):** "Fix a take" in-app converter; offline render (with P13); optional AAC WASM for Firefox.

---

## Sources

- [Chrome/Safari MediaRecorder MP4 output: fragmented, zero durations (addpipe)](https://blog.addpipe.com/duration-in-mp4-files-produced-by-chrome-safari/)
- [Mediabunny: writing media files (fastStart false / in-memory / reserve / fragmented; StreamTarget + File System API; frameRate snapping; backpressure)](https://mediabunny.dev/guide/writing-media-files)
- [Mediabunny: output formats (MOV/MP4 options, metadata formats)](https://mediabunny.dev/guide/output-formats)
- [Mediabunny: supported formats and codecs (PCM s16/s24/f32 in MP4/MOV; AAC not in WebM; `@mediabunny/aac-encoder`)](https://mediabunny.dev/guide/supported-formats-and-codecs)
- [Mediabunny: media sources (EncodedVideoPacketSource, AudioSampleSource with PCM)](https://mediabunny.dev/guide/media-sources)
- [Mediabunny: converting media files (frameRate, resize, transmux)](https://mediabunny.dev/guide/converting-media-files)
- [Mediabunny issue #444: AAC priming ~1024 samples in Chrome/Safari, no elst](https://github.com/Vanilagy/mediabunny/issues/444)
- [MDN: WebCodecs codec selection (AAC encode gaps: Firefox, desktop Linux)](https://developer.mozilla.org/en-US/docs/Web/API/WebCodecs_API/Codec_selection)
- [WebCodecs Fundamentals: AVC support (Firefox isConfigSupported/configure mismatch)](https://webcodecsfundamentals.org/codecs/avc.html)
- [Brave: File System Access API disabled by default (flag)](https://github.com/brave/brave-browser/issues/18979)
- [Can I use: FileSystemFileHandle.createWritable](https://caniuse.com/mdn-api_filesystemfilehandle_createwritable)
- mp4-muxer 5.2.2 README (deprecation notice) and build code (`co64`, `largeSize`, `colr`, no `elst`), in `node_modules/mp4-muxer`
- Measured v19 and v0.15 takes: `scratchpad/v20/reports/evidence-recording.md`
