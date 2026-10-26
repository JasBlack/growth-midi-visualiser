// "General music" mode: an mp3 / any audio file (or the microphone) is analysed
// every frame — band levels, RMS energy, a 12-bin chroma from the FFT, and a
// spectral-flux onset detector. Onsets are turned into pseudo NoteEvents (top
// chroma pitch classes, octave from the spectral centroid) so every engine's
// note-driven growth works identically on recorded music.
//
// Files are decoded into an AudioBuffer and played through an
// AudioBufferSourceNode (not a <media> element): sample-accurate transport,
// and it keeps working in embedded / headless browsers where media-element →
// WebAudio routing delivers silence.
//
// Every input request (a track, the mic, a tab share) takes a generation
// number. A decode, permission prompt or share picker that resolves after a
// newer request, or after stop(), sees it is stale and backs out, stopping any
// stream it was handed, so picking inputs quickly can never leave an old one
// playing or let an old error overwrite the current status.

import type { AudioFeatures, MusicClock, NoteSource } from './music'
import { audioContext, toInputBus } from './audioCtx'

const FFT = 4096
/**
 * Onsets get their own unsmoothed analysis: 43 ms at 48 kHz instead of a smoothed 85 ms. Not
 * shorter: at 30 fps a 21 ms window leaves gaps between frames and misses short hits.
 */
const ONSET_FFT = 2048
/** Flux on log(1 + γ·|X|) magnitudes, so hats and snares count next to the kick. */
const FLUX_GAMMA = 1000
/** Seconds of history behind the adaptive thresholds (were 24 / 30 frames, i.e. fps-dependent). */
const FLUX_WINDOW = 0.4
const STEM_WINDOW = 0.5
/** Level normalisers forget a loud passage with this time constant (was ×0.997 per frame ≈ 5.5 s at 60 fps). */
const NORM_TAU = 5.5
const clamp01 = (v: number) => Math.min(1, Math.max(0, v))

export interface OnsetParams {
  /** threshold = median flux × k + floor */
  k: number
  floor: number
  /** seconds between onsets, at least */
  gap: number
  /** relative loudness (0..1) an onset needs */
  gate: number
  /** absolute RMS below which the input counts as silence (noise gate) */
  rms: number
}

/**
 * Audio attack sensitivity 0..1 → onset detector settings. 0.5 is the v0.15 detector
 * (k 1.9, gap 0.12 s, gate 0.04); 0 and 1 match v0.19's ends of the scale.
 */
export function onsetParams(sensitivity: number): OnsetParams {
  const x = Math.min(1, Math.max(0, sensitivity))
  const rms = 0.00316 * Math.pow(4, 1 - 2 * x) // −50 dBFS at 0.5, ±12 dB across the range
  return x <= 0.5
    ? { k: 2.55 - 1.3 * x, floor: 0.0015 - 0.001 * x, gap: 0.18 - 0.12 * x, gate: 0.055 - 0.03 * x, rms }
    : { k: 1.9 - 1.6 * (x - 0.5), floor: 0.001, gap: 0.12 - 0.08 * (x - 0.5), gate: 0.04 - 0.02 * (x - 0.5), rms }
}

/** Keeps (time, value) pairs for the last `span` seconds; median over them. */
export class TimeWindow {
  private t: number[] = []
  private v: number[] = []
  constructor(private span: number) {}
  push(t: number, v: number) {
    this.t.push(t)
    this.v.push(v)
    while (this.t.length > 1 && t - this.t[0] > this.span) {
      this.t.shift()
      this.v.shift()
    }
  }
  median() {
    const s = [...this.v].sort((a, b) => a - b)
    return s[s.length >> 1] ?? 0
  }
}

type RequestKind = 'file' | 'mic' | 'tab'

const stopTracks = (s: MediaStream) => s.getTracks().forEach((t) => t.stop())

/** A readable reason for a failed getUserMedia / getDisplayMedia (Chrome's message is often empty). */
function mediaError(e: unknown): string {
  const { name = '', message = '' } = (e ?? {}) as { name?: string; message?: string }
  if (name === 'NotAllowedError') return 'permission denied or cancelled'
  if (name === 'NotFoundError') return 'no such device'
  if (name === 'NotReadableError') return 'the device is in use by another app or blocked by the system'
  if (name === 'OverconstrainedError') return 'the selected input is gone — choose another one'
  return message || name || 'unknown error'
}

export class RunningMax {
  v: number
  constructor(public floor = 1e-4) {
    this.v = floor
  }
  push(x: number, dt: number) {
    this.v = Math.max(x, this.v * Math.exp(-dt / NORM_TAU), this.floor)
    return x / this.v
  }
}

export class AudioInput {
  ctx: AudioContext | null = null
  analyser: AnalyserNode | null = null
  /** the onset detector's own view of the same signal: short and unsmoothed */
  private onsetAn: AnalyserNode | null = null
  /** audio attack sensitivity 0..1 (a global setting): see onsetParams */
  sensitivity = 0.5
  private outConnected = false
  private buffer: AudioBuffer | null = null
  private srcNode: AudioBufferSourceNode | null = null
  private startCtxT = 0
  private offset = 0
  playing = false
  fileName = ''
  /** playlist of files; auto-advances, loops the list */
  playlist: File[] = []
  trackI = 0
  private tabStream: MediaStream | null = null
  private tabSource: MediaStreamAudioSourceNode | null = null
  onTrack: (name: string, i: number, n: number) => void = () => {}
  private micSource: MediaStreamAudioSourceNode | null = null
  private micStream: MediaStream | null = null
  private mag = new Float32Array(FFT / 2)
  private prevMag = new Float32Array(FFT / 2)
  private dbBuf = new Float32Array(FFT / 2)
  private timeBuf = new Float32Array(FFT)
  private onsetDb = new Float32Array(ONSET_FFT / 2)
  private onsetLog = new Float32Array(ONSET_FFT / 2)
  private onsetCur = new Float32Array(ONSET_FFT / 2)
  private fluxHist = new TimeWindow(FLUX_WINDOW)
  private lastOnsetT = 0
  private lastT = 0
  /** pseudo notes still sounding, released as the note they started as */
  private pendingOffs: { pitch: number; t: number; source: NoteSource; stem?: number }[] = []
  private nEnergy = new RunningMax(0.01)
  private nBass = new RunningMax()
  private nMid = new RunningMax()
  private nTreble = new RunningMax()
  private binPc: Int8Array = new Int8Array(0)
  private binW: Float32Array = new Float32Array(0)
  readonly features: AudioFeatures = { energy: 0, bass: 0, mid: 0, treble: 0, chroma: new Float32Array(12) }
  private tapped = false
  /** Stems: split the spectrum into drums / bass / voice / other with their own onset detectors. */
  stems = false
  readonly stemLevels = new Float32Array(4)
  private stemFlux = [0, 0, 0, 0]
  private stemHist = [0, 1, 2, 3].map(() => new TimeWindow(STEM_WINDOW))
  private stemLast = [0, 0, 0, 0]
  private nStem = [new RunningMax(), new RunningMax(), new RunningMax(), new RunningMax()]
  active = false
  source: 'none' | 'file' | 'mic' | 'tab' = 'none'
  /** the input a request is still waiting for (decode, permission prompt, share picker) */
  pending: RequestKind | null = null
  /** request generation: bumped by every request and by stop() */
  private gen = 0
  onStatus: (s: string) => void = () => {}

  constructor(private clock: MusicClock) {}

  private ensureCtx() {
    if (!this.ctx) {
      this.ctx = audioContext()
      this.analyser = this.ctx.createAnalyser()
      this.analyser.fftSize = FFT
      this.analyser.smoothingTimeConstant = 0.55 // bands and chroma want it steady; onsets use onsetAn
      this.onsetAn = this.ctx.createAnalyser()
      this.onsetAn.fftSize = ONSET_FFT
      this.onsetAn.smoothingTimeConstant = 0
      this.analyser.connect(this.onsetAn) // an analyser passes its input through unchanged
      // bin → pitch class lookup (55 Hz .. 4.2 kHz), weighted toward the mid range
      const n = FFT / 2
      const sr = this.ctx.sampleRate
      this.binPc = new Int8Array(n).fill(-1)
      this.binW = new Float32Array(n)
      for (let i = 1; i < n; i++) {
        const f = (i * sr) / FFT
        if (f < 55 || f > 4200) continue
        const midi = 69 + 12 * Math.log2(f / 440)
        this.binPc[i] = ((Math.round(midi) % 12) + 12) % 12
        // de-emphasise very low bins (they smear across semitones) and the top
        this.binW[i] = f < 110 ? 0.4 : f > 2000 ? 0.6 : 1
      }
    }
    // everything the analyser hears belongs in a recording, speakers or not
    if (!this.tapped) {
      this.tapped = true
      toInputBus(this.analyser!)
    }
    return this.ctx
  }

  get duration() {
    return this.buffer?.duration ?? 0
  }

  get currentTime() {
    if (!this.buffer || !this.ctx) return 0
    const t = this.playing ? this.offset + (this.ctx.currentTime - this.startCtxT) : this.offset
    return t % this.buffer.duration
  }

  /** Replace the playlist with these files and start the first. */
  async loadFiles(files: File[]) {
    if (!files.length) return
    this.playlist = files
    this.trackI = 0
    await this.loadTrack(0)
  }

  /** Append to the playlist (starts playing if nothing was). */
  async addFiles(files: File[]) {
    const wasEmpty = this.playlist.length === 0
    this.playlist.push(...files)
    // a lone track loops; once it has company it must end and advance
    if (this.srcNode) this.srcNode.loop = this.playlist.length <= 1
    if (wasEmpty) await this.loadTrack(0)
    else this.onStatus(`playlist: ${this.playlist.length} tracks`)
  }

  async loadFile(file: File) {
    await this.loadFiles([file])
  }

  /**
   * Stop whatever was live and open a new request. Synchronous, before any
   * await, so a second click invalidates the first before it can resolve.
   */
  private beginRequest(kind: RequestKind): number {
    this.stop()
    // only the speaker edge: the analyser's recording tap stays wired, and a mic is never monitored
    if (this.outConnected && this.analyser && this.ctx) {
      this.analyser.disconnect(this.ctx.destination)
      this.outConnected = false
    }
    this.pending = kind
    return this.gen
  }

  async loadTrack(i: number) {
    const file = this.playlist[i]
    if (!file) return
    const req = this.beginRequest('file')
    this.buffer = null
    this.fileName = ''
    this.offset = 0
    this.trackI = i
    this.onStatus(`decoding ${file.name}…`)
    try {
      const ctx = this.ensureCtx()
      const bytes = await file.arrayBuffer()
      if (req !== this.gen) return
      const buffer = await ctx.decodeAudioData(bytes)
      if (req !== this.gen) return
      this.pending = null
      this.buffer = buffer
      this.fileName = file.name
      this.source = 'file'
      this.active = true
      this.play()
      this.onStatus(`${this.playlist.length > 1 ? `track ${i + 1}/${this.playlist.length}: ` : ''}${file.name} (${buffer.duration.toFixed(0)} s)`)
    } catch (e) {
      if (req !== this.gen) return
      this.stop()
      this.onStatus(`could not play ${file.name}: ${(e as Error).message || 'unreadable audio'}`)
    }
    this.onTrack(file.name, i, this.playlist.length)
  }

  /** Back to the decoded track after visiting MIDI / mic / tab, paused. false = nothing to resume. */
  resumeFile(): boolean {
    if (!this.buffer || this.pending) return false
    this.source = 'file'
    this.active = true
    this.onStatus(`${this.fileName} (${this.buffer.duration.toFixed(0)} s) — Space or ▶ plays it`)
    return true
  }

  next() {
    if (this.playlist.length > 1) void this.loadTrack((this.trackI + 1) % this.playlist.length)
  }

  prev() {
    if (this.playlist.length > 1) void this.loadTrack((this.trackI - 1 + this.playlist.length) % this.playlist.length)
  }

  play() {
    if (!this.buffer || !this.ctx || !this.analyser) return
    this.stopNode()
    if (!this.outConnected) {
      this.outConnected = true
      this.analyser.connect(this.ctx.destination) // the recording tap is already wired
    }
    const s = this.ctx.createBufferSource()
    s.buffer = this.buffer
    s.loop = this.playlist.length <= 1
    s.connect(this.analyser)
    s.start(0, this.offset % this.buffer.duration)
    s.onended = () => {
      // natural end of a playlist track (stopNode() nulls srcNode first, so manual stops do not advance)
      if (this.srcNode === s && this.playing) this.next()
    }
    this.srcNode = s
    this.startCtxT = this.ctx.currentTime
    this.playing = true
  }

  pause() {
    if (!this.playing) return
    this.offset = this.currentTime
    this.stopNode()
    this.playing = false
  }

  seek(t: number) {
    this.offset = Math.max(0, Math.min(this.duration, t))
    if (this.playing) this.play()
  }

  togglePlay() {
    if (this.source !== 'file') return
    if (this.playing) this.pause()
    else this.play()
  }

  private stopNode() {
    if (this.srcNode) {
      try {
        this.srcNode.stop()
      } catch {
        /* already stopped */
      }
      this.srcNode.disconnect()
      this.srcNode = null
    }
  }

  /** Audio input devices (labels appear after the first permission grant). */
  async listMics(): Promise<{ id: string; label: string }[]> {
    try {
      const devs = await navigator.mediaDevices.enumerateDevices()
      return devs.filter((d) => d.kind === 'audioinput').map((d, i) => ({ id: d.deviceId, label: d.label || `input ${i + 1}` }))
    } catch {
      return []
    }
  }

  /**
   * Capture another tab's audio (Chrome: pick a tab, tick "share tab audio";
   * Windows can also share system audio with the whole screen). Feeds Spotify
   * web player / YouTube in without any extra software. The picked source keeps
   * playing normally; nothing is routed to the speakers from here.
   */
  async startTabCapture() {
    const req = this.beginRequest('tab')
    let stream: MediaStream | null = null
    try {
      const ctx = this.ensureCtx()
      stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true })
      if (req !== this.gen) return stopTracks(stream)
      const track = stream.getAudioTracks()[0]
      if (!track) {
        stopTracks(stream)
        this.stop()
        this.onStatus('no audio in that share — pick a Chrome TAB and tick "Share tab audio" (Windows: "Entire screen" + system audio)')
        return
      }
      stream.getVideoTracks().forEach((t) => t.stop()) // audio only
      const live = stream
      this.pending = null
      this.tabStream = live
      this.tabSource = ctx.createMediaStreamSource(new MediaStream(live.getAudioTracks()))
      this.tabSource.connect(this.analyser!)
      track.onended = () => {
        if (req !== this.gen || this.tabStream !== live) return
        this.stop()
        this.onStatus('tab capture ended')
      }
      this.source = 'tab'
      this.active = true
      this.onStatus('tab / system audio live')
    } catch (e) {
      if (stream) stopTracks(stream)
      if (req !== this.gen) return
      this.stop()
      this.onStatus(`tab capture unavailable: ${mediaError(e)}`)
    }
  }

  private stopTab() {
    this.tabSource?.disconnect()
    this.tabSource = null
    this.tabStream?.getTracks().forEach((t) => t.stop())
    this.tabStream = null
  }

  async startMic(deviceId?: string) {
    const req = this.beginRequest('mic')
    let stream: MediaStream | null = null
    try {
      const ctx = this.ensureCtx()
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { deviceId: deviceId ? { exact: deviceId } : undefined, echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      })
      if (req !== this.gen) return stopTracks(stream)
      const track = stream.getAudioTracks()[0]
      if (!track) throw new Error('no audio track was provided')
      const live = stream
      this.pending = null
      this.micStream = live
      this.micSource = ctx.createMediaStreamSource(live)
      this.micSource.connect(this.analyser!) // analyser only — never to destination (feedback)
      this.source = 'mic'
      this.active = true
      track.onended = () => {
        if (req !== this.gen || this.micStream !== live) return
        this.stop()
        this.onStatus('microphone disconnected — select an input to reconnect')
      }
      this.onStatus(`input live: ${track.label || 'default microphone'}`)
    } catch (e) {
      if (stream) stopTracks(stream)
      if (req !== this.gen) return
      this.stop()
      this.onStatus(`microphone unavailable: ${mediaError(e)}`)
    }
  }

  private stopMic() {
    this.micSource?.disconnect()
    this.micSource = null
    this.micStream?.getTracks().forEach((t) => t.stop())
    this.micStream = null
  }

  /** Leave audio mode: stop playback / mic, silence features, release pseudo notes. */
  stop() {
    this.gen++ // first: a pending request, or an onended fired by the teardown below, is now stale
    this.pending = null
    this.pause()
    this.stopMic()
    this.stopTab()
    this.active = false
    this.source = 'none'
    this.features.energy = this.features.bass = this.features.mid = this.features.treble = this.features.level = 0
    this.features.chroma.fill(0)
    for (const p of this.pendingOffs) this.clock.push({ kind: 'off', pitch: p.pitch, velocity: 0, time: this.clock.now(), channel: 0, source: p.source, stem: p.stem })
    this.pendingOffs = []
  }

  /** Analyse the current frame. Returns the onset impulse (0..1) for this frame. */
  analyze(): number {
    const an = this.analyser
    const t = this.clock.now()
    // flush scheduled note-offs for pseudo notes
    if (this.pendingOffs.length) {
      const keep: typeof this.pendingOffs = []
      for (const p of this.pendingOffs) {
        if (p.t <= t) this.clock.push({ kind: 'off', pitch: p.pitch, velocity: 0, time: t, channel: 0, source: p.source, stem: p.stem })
        else keep.push(p)
      }
      this.pendingOffs = keep
    }
    if (!an || !this.active || !this.ctx) return 0
    if (this.source === 'file' && !this.playing) return 0

    const dt = Math.min(0.1, Math.max(0, t - this.lastT))
    this.lastT = t
    const op = onsetParams(this.sensitivity)
    an.getFloatFrequencyData(this.dbBuf)
    an.getFloatTimeDomainData(this.timeBuf)
    const n = this.dbBuf.length
    const sr = this.ctx.sampleRate
    const hzPerBin = sr / FFT

    // RMS energy; below the noise gate the input is silence (no energy, bands, chroma or onsets)
    let rms = 0
    for (let i = 0; i < FFT; i++) rms += this.timeBuf[i] * this.timeBuf[i]
    rms = Math.sqrt(rms / FFT)
    const quiet = rms < op.rms
    // loudness is relative to the recent peak, but never to less than 3× the gate (−40 dBFS at
    // 0.5): after a loud passage a quiet room fades toward low energy instead of reading as full
    this.nEnergy.floor = 3 * op.rms
    const level = clamp01(this.nEnergy.push(rms, dt))
    this.features.energy = quiet ? 0 : level
    this.features.level = quiet ? 0 : rms

    // linear magnitudes, bands, chroma, centroid (and the drum stem's transients)
    let bass = 0
    let mid = 0
    let treble = 0
    let nb = 0
    let nm = 0
    let nt = 0
    let cSum = 0
    let cW = 0
    const chroma = this.features.chroma
    chroma.fill(0)
    for (let i = 1; i < n; i++) {
      const db = this.dbBuf[i]
      const m = db < -100 ? 0 : Math.pow(10, db / 20)
      this.mag[i] = m
      const f = i * hzPerBin
      if (f > 9000) break
      if (f < 150) (bass += m), nb++
      else if (f < 2000) (mid += m), nm++
      else (treble += m), nt++
      if (this.stems) {
        const d = m - this.prevMag[i]
        // drums: transients everywhere but weighted to kick (<150) and hats/snare (>2k)
        if (d > 0) this.stemFlux[0] += d * (f < 150 || f > 2000 ? 1 : 0.25)
        if (f < 160) {
          this.stemFlux[1] += m
        } else if (f >= 250 && f < 3500) {
          this.stemFlux[2] += m
        } else if (f >= 3500) this.stemFlux[3] += m
      }
      const pc = this.binPc[i]
      if (pc >= 0) {
        const w = m * this.binW[i]
        chroma[pc] += w
        cSum += f * w
        cW += w
      }
    }
    this.prevMag.set(this.mag)
    if (this.stems) {
      // voice: the harmonic share of the mids (mids minus their transient part)
      const raw = [this.stemFlux[0], this.stemFlux[1], Math.max(0, this.stemFlux[2] - this.stemFlux[0] * 0.5), this.stemFlux[3] + this.stemFlux[2] * 0.15]
      for (let k = 0; k < 4; k++) this.stemLevels[k] = quiet ? 0 : clamp01(this.nStem[k].push(raw[k], dt))
      this.stemFlux = [0, 0, 0, 0]
    }
    const open = quiet ? 0 : 1
    this.features.bass = open * clamp01(this.nBass.push(nb ? bass / nb : 0, dt))
    this.features.mid = open * clamp01(this.nMid.push(nm ? mid / nm : 0, dt))
    this.features.treble = open * clamp01(this.nTreble.push(nt ? treble / nt : 0, dt))
    let cmax = 0
    for (let i = 0; i < 12; i++) cmax = Math.max(cmax, chroma[i])
    if (cmax > 0) for (let i = 0; i < 12; i++) chroma[i] /= cmax
    // gate chroma on silence so quiet noise doesn't light every bin
    if (this.features.energy < 0.03) chroma.fill(0)

    // onset: half-wave log spectral flux from the unsmoothed analyser vs an adaptive threshold
    let flux = 0
    const oa = this.onsetAn
    if (oa) {
      oa.getFloatFrequencyData(this.onsetDb)
      const top = Math.min(this.onsetDb.length - 1, Math.ceil(9000 / (sr / oa.fftSize)))
      const prev = this.onsetLog
      const cur = this.onsetCur
      for (let i = 1; i <= top; i++) {
        const db = this.onsetDb[i]
        cur[i] = db < -100 ? 0 : Math.log1p(FLUX_GAMMA * Math.pow(10, db / 20))
      }
      // rise over the loudest neighbouring bin of the last frame (SuperFlux): a noise bed's
      // bin-to-bin jitter cancels out, a real attack rises across all of them
      for (let i = 1; i < top; i++) {
        const ref = Math.max(prev[i - 1], prev[i], prev[i + 1])
        if (cur[i] > ref) flux += cur[i] - ref
      }
      this.onsetLog = cur
      this.onsetCur = prev
    }
    this.fluxHist.push(t, flux)
    const thr = this.fluxHist.median() * op.k + op.floor
    let onset = 0
    if (!quiet && flux > thr && t - this.lastOnsetT > op.gap && this.features.energy > op.gate) {
      onset = clamp01((flux - thr) / (thr + 1e-6))
      this.lastOnsetT = t
      if (!this.stems) this.emitPseudoNotes(onset, cW > 0 ? cSum / cW : 440, t)
    }
    if (this.stems && this.features.energy > op.gate) {
      // each stem: its level against its own recent median → an onset with its own note
      const minGap = [0.1, 0.16, 0.22, 0.3]
      const gapK = op.gap / 0.12
      const k1 = 1.35 * (op.k / 1.9)
      for (let k = 0; k < 4; k++) {
        const hist = this.stemHist[k]
        const lv = this.stemLevels[k]
        hist.push(t, lv)
        const med = hist.median()
        const rise = lv - (this.stemLast[k] ?? 0)
        this.stemLast[k] = lv
        if (lv > med * k1 + 0.05 && rise > 0.06 && t - (this.stemLastT[k] ?? 0) > minGap[k] * gapK) {
          this.stemLastT[k] = t
          const strength = clamp01(rise * 3)
          this.emitStemNote(k, strength, t)
        }
      }
    }
    return onset
  }

  private stemLastT = [0, 0, 0, 0]

  /** A pseudo note: retriggering one still sounding ends it first. */
  private pseudoNote(source: NoteSource, stem: number | undefined, pitch: number, velocity: number, t: number, dur: number) {
    const idx = this.pendingOffs.findIndex((p) => p.pitch === pitch && p.source === source && p.stem === stem)
    if (idx >= 0) {
      this.pendingOffs.splice(idx, 1)
      this.clock.push({ kind: 'off', pitch, velocity: 0, time: t, channel: 0, source, stem })
    }
    this.clock.push({ kind: 'on', pitch, velocity, time: t, channel: 0, source, stem })
    this.pendingOffs.push({ pitch, t: t + dur, source, stem })
  }

  /** One stem hit → one tagged pseudo note (stem 0 drums, 1 bass, 2 voice, 3 other). */
  private emitStemNote(k: number, strength: number, t: number) {
    const chroma = this.features.chroma
    const order = [...chroma.keys()].sort((a, b) => chroma[b] - chroma[a])
    let pitch: number
    if (k === 0) pitch = 36 + ((Math.random() * 12) | 0) // drums: low register, any colour
    else if (k === 1) pitch = 36 + (order[0] ?? 0)
    else if (k === 2) pitch = 72 + (order[0] ?? 0)
    else pitch = 60 + (order[1] ?? order[0] ?? 0)
    const dur = [0.15, 0.4, 0.6, 0.35][k] + 0.3 * (1 - strength)
    this.pseudoNote('stem', k, pitch, 0.35 + 0.65 * strength, t, dur)
  }

  private emitPseudoNotes(strength: number, centroidHz: number, t: number) {
    const chroma = this.features.chroma
    const order = [...chroma.keys()].sort((a, b) => chroma[b] - chroma[a])
    const centroidMidi = 69 + 12 * Math.log2(Math.max(30, centroidHz) / 440)
    const oct = Math.min(6, Math.max(2, Math.round(centroidMidi / 12) - 2))
    const vel = 0.35 + 0.65 * strength
    const dur = 0.18 + 0.4 * (1 - strength)
    let emitted = 0
    for (const pc of order) {
      if (chroma[pc] < 0.55 || emitted >= 2) break
      const pitch = 12 * (oct + 1) + pc + (emitted === 2 ? 12 : 0)
      this.pseudoNote('audio', undefined, pitch, vel * (emitted === 0 ? 1 : 0.7), t, dur)
      emitted++
    }
  }
}
