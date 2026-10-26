// Recording. Frames are encoded with WebCodecs the moment they are drawn and
// written into a regular (non-fragmented) container by mp4-muxer / webm-muxer:
// H.264 + AAC in MP4 with the index (moov) at the front, or VP9 + Opus in WebM.
//
// What makes a take open smoothly in Quick Look, QuickTime, VLC and Resolve:
// - a fixed, even frame size chosen up front (the stage renders at exactly that
//   size for the take), never the window's size;
// - constant frame rate: frame n is stamped n/fps. Which render fills which
//   slot is decided on the audio clock, so a slow GPU repeats the previous
//   picture instead of leaving a timestamp gap, and a fast one skips renders;
// - audio from an AudioWorklet tap (pcmTap.ts), stamped from a sample counter
//   on the same clock, so the two tracks cannot drift apart.
// MediaRecorder writes fragmented, variable-rate files that fail all of that;
// it is used only where WebCodecs is missing, and labelled as such.

import {
  Muxer as Mp4Muxer,
  ArrayBufferTarget as Mp4Buffer,
  FileSystemWritableFileStreamTarget as Mp4FileTarget,
} from 'mp4-muxer'
import {
  Muxer as WebmMuxer,
  ArrayBufferTarget as WebmBuffer,
  FileSystemWritableFileStreamTarget as WebmFileTarget,
} from 'webm-muxer'
import { PcmTap, TAP_RATE, loadPcmTap, type PcmBlock } from './pcmTap'

export interface RecFormat {
  /** 'mp4' | 'webm' for WebCodecs, 'mr:<mime>' for the MediaRecorder fallback */
  id: string
  label: string
  ext: 'mp4' | 'webm'
  webcodecs: boolean
  /** MediaRecorder fallback only */
  mime?: string
  /** the encoder accepts 3840×2160 */
  uhd: boolean
}

export interface RecCapabilities {
  formats: RecFormat[]
  /** File System Access: a take can stream straight into a file the user picked */
  saveWhileRecording: boolean
}

export type RecQuality = 'standard' | 'high' | 'max'
export type RecSize = '1080' | '1440' | '2160' | 'canvas'

// ------------------------------------------------------------ sizes, bitrates, codec strings

const even = (v: number) => Math.max(2, Math.floor(v / 2) * 2)

/** The frame size of a take. `canvas` = the stage canvas as it is now, rounded to even, at most 4K. */
export function captureSize(size: RecSize, canvas: HTMLCanvasElement | null): { width: number; height: number } {
  if (size === '1440') return { width: 2560, height: 1440 }
  if (size === '2160') return { width: 3840, height: 2160 }
  if (size === 'canvas' && canvas && canvas.width >= 2 && canvas.height >= 2) {
    const long = Math.max(canvas.width, canvas.height)
    const short = Math.min(canvas.width, canvas.height)
    const k = Math.min(1, 3840 / long, 2160 / short)
    return { width: even(canvas.width * k), height: even(canvas.height * k) }
  }
  return { width: 1920, height: 1080 }
}

const MBPS_1080P30: Record<RecQuality, number> = { standard: 12, high: 24, max: 40 }

/** Video bitrate: the 1080p30 figure scaled by picture area (sub-linearly) and frame rate. */
export function bitrateFor(q: RecQuality, width: number, height: number, fps: number): number {
  const area = (width * height) / (1920 * 1080)
  const bps = MBPS_1080P30[q] * 1e6 * Math.pow(area, 0.8) * (fps > 30 ? 1.5 : 1)
  return Math.round(Math.min(100e6, Math.max(2e6, bps)) / 1e5) * 1e5
}

// [level_idc, MaxMBPS, MaxFS, MaxBR for High in bit/s] (H.264 Table A-1; Main / Baseline MaxBR = High / 1.25)
const AVC_LEVELS: [number, number, number, number][] = [
  [0x1f, 108000, 3600, 17.5e6],
  [0x20, 216000, 5120, 25e6],
  [0x28, 245760, 8192, 25e6],
  [0x29, 245760, 8192, 62.5e6],
  [0x2a, 522240, 8704, 62.5e6],
  [0x32, 589824, 22080, 168.75e6],
  [0x33, 983040, 36864, 300e6],
  [0x34, 2073600, 36864, 300e6],
]

/** Lowest H.264 level that covers size, rate and bitrate (Chrome refuses a level that is too low). */
export function avcLevel(width: number, height: number, fps: number, bitrate: number, high: boolean): number {
  const fs = Math.ceil(width / 16) * Math.ceil(height / 16)
  const br = high ? bitrate : bitrate * 1.25
  const hit = AVC_LEVELS.find(([, mbps, maxFs, maxBr]) => fs <= maxFs && fs * fps <= mbps && br <= maxBr)
  return (hit ?? AVC_LEVELS[AVC_LEVELS.length - 1])[0]
}

// [level, max luma sample rate, max luma picture size] (VP9 levels 4.0 … 5.2)
const VP9_LEVELS: [number, number, number][] = [
  [40, 83558400, 2228224],
  [41, 160432128, 2228224],
  [50, 311951360, 8912896],
  [51, 588251136, 8912896],
  [52, 1176502272, 8912896],
]

export function vp9Level(width: number, height: number, fps: number): number {
  const px = width * height
  return (VP9_LEVELS.find(([, rate, size]) => px <= size && px * fps <= rate) ?? VP9_LEVELS[VP9_LEVELS.length - 1])[0]
}

const H264_PROFILES = [
  { name: 'High', prefix: '6400', high: true },
  { name: 'Main', prefix: '4D40', high: false },
  { name: 'Constrained Baseline', prefix: '42E0', high: false },
]
const ACCEL: HardwareAcceleration[] = ['prefer-hardware', 'no-preference']

interface VideoChoice {
  config: VideoEncoderConfig
  /** e.g. "H.264 High (avc1.640028)" */
  label: string
}

async function supported(config: VideoEncoderConfig): Promise<boolean> {
  try {
    return (await VideoEncoder.isConfigSupported(config)).supported === true
  } catch {
    return false
  }
}

/** Best encoder config for this take: H.264 High → Main → Baseline (hardware first), or VP9. */
async function pickVideo(ext: 'mp4' | 'webm', width: number, height: number, fps: number, bitrate: number): Promise<VideoChoice | null> {
  if (typeof VideoEncoder === 'undefined') return null
  const base = { width, height, bitrate, framerate: fps, latencyMode: 'quality', bitrateMode: 'variable' } as const
  if (ext === 'mp4') {
    for (const p of H264_PROFILES) {
      const codec = `avc1.${p.prefix}${avcLevel(width, height, fps, bitrate, p.high).toString(16).padStart(2, '0')}`
      for (const hardwareAcceleration of ACCEL) {
        // avcC, not avc3: QuickTime and Quick Look want the parameter sets in the sample description
        const config: VideoEncoderConfig = { ...base, codec, hardwareAcceleration, avc: { format: 'avc' } }
        if (await supported(config)) return { config, label: `H.264 ${p.name} (${codec})` }
      }
    }
    return null
  }
  const codec = `vp09.00.${vp9Level(width, height, fps)}.08`
  for (const hardwareAcceleration of ACCEL) {
    const config: VideoEncoderConfig = { ...base, codec, hardwareAcceleration }
    if (await supported(config)) return { config, label: `VP9 (${codec})` }
  }
  return null
}

async function pickAudio(ext: 'mp4' | 'webm'): Promise<AudioEncoderConfig | null> {
  if (typeof AudioEncoder === 'undefined') return null
  const codec = ext === 'mp4' ? 'mp4a.40.2' : 'opus'
  // 192 k first: the Windows AAC encoder only takes 96 / 128 / 160 / 192 kbps
  for (const bitrate of [192000, 160000, 128000]) {
    const config: AudioEncoderConfig = { codec, sampleRate: TAP_RATE, numberOfChannels: 2, bitrate }
    try {
      if ((await AudioEncoder.isConfigSupported(config)).supported) return config
    } catch {
      /* try the next */
    }
  }
  return null
}

const FALLBACK_MIMES: [string, 'mp4' | 'webm'][] = [
  ['video/mp4;codecs=avc1.640028,mp4a.40.2', 'mp4'],
  ['video/mp4;codecs=avc1,mp4a.40.2', 'mp4'],
  ['video/mp4', 'mp4'],
  ['video/webm;codecs=vp9,opus', 'webm'],
  ['video/webm;codecs=vp8,opus', 'webm'],
  ['video/webm', 'webm'],
]

/** What this browser can actually write, best first. Labels only claim what is used. */
export async function probeRecording(): Promise<RecCapabilities> {
  const formats: RecFormat[] = []
  const webcodecs = typeof VideoEncoder !== 'undefined' && typeof AudioEncoder !== 'undefined' && typeof AudioWorkletNode !== 'undefined'
  if (webcodecs) {
    for (const ext of ['mp4', 'webm'] as const) {
      const hd = await pickVideo(ext, 1920, 1080, 30, bitrateFor('high', 1920, 1080, 30))
      if (!hd || !(await pickAudio(ext))) continue
      const uhd = (await pickVideo(ext, 3840, 2160, 30, bitrateFor('standard', 3840, 2160, 30))) !== null
      const label = ext === 'mp4' ? 'MP4 · H.264 + AAC' : 'WebM · VP9 + Opus'
      formats.push({ id: ext, label, ext, webcodecs: true, uhd })
    }
  }
  if (!formats.length && typeof MediaRecorder !== 'undefined') {
    for (const [mime, ext] of FALLBACK_MIMES) {
      if (formats.some((f) => f.ext === ext) || !MediaRecorder.isTypeSupported(mime)) continue
      formats.push({ id: `mr:${mime}`, label: `Fallback: browser recorder · ${ext.toUpperCase()} (timing may vary)`, ext, webcodecs: false, mime, uhd: true })
    }
  }
  const w = window as unknown as { showSaveFilePicker?: unknown }
  return { formats, saveWhileRecording: typeof w.showSaveFilePicker === 'function' }
}

// ------------------------------------------------------------ constant frame rate

/** Slot n of a take starts at n / fps: its timestamp in µs, rounded per slot so the stamps never drift. */
export const slotTimestamp = (slot: number, fps: number) => Math.round((slot * 1e6) / fps)

/** Audio samples (at TAP_RATE) from the start of the take to the start of `slot`. */
export const slotSampleCount = (slot: number, fps: number) => Math.round((slot * TAP_RATE) / fps)

/**
 * The slot a render at `now` (audio clock, s) fills, in a stretch that began at `t0` with slot
 * `slot0`. The epsilon keeps a render stamped exactly on a boundary from landing a slot early.
 */
export const dueSlot = (slot0: number, t0: number, now: number, fps: number) => slot0 + Math.floor((now - t0) * fps + 1e-6)

// ------------------------------------------------------------ helpers

export function download(blob: Blob, name: string) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(a.href), 5000)
}

/** Local date and time for file names (UTC would be an hour or two off). */
export const stamp = () => {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`
}

/**
 * Maps performance.now() onto AudioContext time. currentTime moves in whole audio
 * callbacks, so currentTime − perf is a sawtooth whose top is the true offset:
 * keep the maximum over the last ~second of frames.
 */
class ContextClock {
  private hist: number[] = []
  private est = NaN

  constructor(private ctx: AudioContext) {}

  /** Returns true when the audio clock lost time (suspended, device switch): a discontinuity. */
  sample(perf: number): boolean {
    // while suspended, keep running on the last offset (the video must not freeze with it)
    if (this.ctx.state !== 'running') return false
    const o = this.ctx.currentTime - perf / 1000
    const jump = o < this.est - 0.25
    if (jump) this.hist.length = 0
    this.hist.push(o)
    if (this.hist.length > 64) this.hist.shift()
    this.est = Math.max(...this.hist)
    return jump
  }

  now(perf: number): number {
    return perf / 1000 + (Number.isNaN(this.est) ? this.ctx.currentTime - perf / 1000 : this.est)
  }
}

interface MuxLike {
  addVideoChunk(chunk: EncodedVideoChunk, meta?: EncodedVideoChunkMetadata): void
  addAudioChunk(chunk: EncodedAudioChunk, meta?: EncodedAudioChunkMetadata): void
  finalize(): void
}

/** A stretch of the take's audio: output sample s0 is context frame f0; frames from fEnd on belong to the next stretch. */
interface AudioSeg {
  s0: number
  f0: number
  fEnd: number
}

export interface SaveTarget {
  handle: FileSystemFileHandle
  writable: FileSystemWritableFileStream
}

export interface TakeSpec {
  format: RecFormat
  width: number
  height: number
  fps: number
  bitrate: number
  /** the shared context, or null for a take without an audio track */
  ctx: AudioContext | null
  /** WebCodecs: the bus the worklet taps */
  bus: AudioNode | null
  /** MediaRecorder fallback: the same bus as a stream */
  busStream: MediaStream | null
  /** save while recording, or null = in memory, downloaded at the end */
  save: SaveTarget | null
  /** file name without extension */
  name: string
}

/** A render gap longer than this (hidden tab, stalled GPU) cuts the take rather than freezing the picture for seconds. */
const MAX_GAP_S = 2
let aacDelay: Promise<number> | null = null

/**
 * An AAC encoder may put priming silence in front of the audio, and mp4-muxer writes no
 * edit list, so players would hear everything that much late; the take then feeds the
 * encoder from that many frames later. How much varies by platform (Chrome on Windows
 * measured 0, other encoders are documented at 1024–2112), so it is measured once per
 * session: encode a click, decode it, see where it lands.
 */
function measureAacDelay(config: AudioEncoderConfig): Promise<number> {
  aacDelay ??= (async () => {
    const at = 2048
    const frames = 8192
    const chunks: EncodedAudioChunk[] = []
    let dcfg: AudioDecoderConfig | undefined
    const enc = new AudioEncoder({
      output: (c, m) => {
        chunks.push(c)
        if (m?.decoderConfig) dcfg = m.decoderConfig
      },
      error: () => {},
    })
    enc.configure(config)
    const pcm = new Float32Array(frames * 2)
    pcm[at] = pcm[frames + at] = 0.9
    const ad = new AudioData({ format: 'f32-planar', sampleRate: TAP_RATE, numberOfFrames: frames, numberOfChannels: 2, timestamp: 0, data: pcm })
    enc.encode(ad)
    ad.close()
    await enc.flush()
    enc.close()
    if (!dcfg) return 0
    const out: number[] = []
    const dec = new AudioDecoder({
      output: (a) => {
        const f = new Float32Array(a.numberOfFrames)
        a.copyTo(f, { planeIndex: 0, format: 'f32-planar' })
        for (const v of f) out.push(v)
        a.close()
      },
      error: () => {},
    })
    dec.configure(dcfg)
    for (const c of chunks) dec.decode(c)
    await dec.flush()
    dec.close()
    let peak = 0
    for (let i = 1; i < out.length; i++) if (Math.abs(out[i]) > Math.abs(out[peak])) peak = i
    return Math.max(0, Math.min(4096, peak - at))
  })().catch(() => 0)
  return aacDelay
}

export class Recorder {
  state: 'idle' | 'ready' | 'recording' | 'stopping' = 'idle'
  /** An encoder failed mid-take. The owner should stop: what was captured is saved as a partial take. */
  onFailure: (message: string) => void = () => {}
  /** The first frame of the take went to the encoder. */
  onStarted: () => void = () => {}
  /** "1920×1080 · 30 fps constant · H.264 High … · AAC 48 kHz stereo" once prepared */
  summary = ''
  /** frames in the file */
  frames = 0
  /** slots no render arrived for in time: the previous picture was repeated */
  repeated = 0
  /** fresh renders dropped because the encoder was behind (the previous picture was repeated) */
  dropped = 0
  /** slots left out entirely — the encoder was hopelessly behind; the only thing that breaks constant timing */
  skipped = 0
  /** render gaps over 2 s (hidden tab) cut out of both tracks */
  cuts = 0
  /** encoded bytes so far */
  bytes = 0

  private spec: TakeSpec | null = null
  private failure = ''
  private venc: VideoEncoder | null = null
  private aenc: AudioEncoder | null = null
  private mux: MuxLike | null = null
  private buffer: Mp4Buffer | WebmBuffer | null = null
  private tap: PcmTap | null = null
  private clock: ContextClock | null = null

  // CFR slots: slot s covers audio-clock time [segT0 + (s - segSlot0)/fps, …)
  private pendingStart = false
  private startPerf = 0
  private segT0 = 0
  private segSlot0 = 0
  private next = 0
  private lastGop = -1
  private lastFresh = -1
  private last: VideoFrame | null = null
  private scratch: HTMLCanvasElement | null = null

  // audio assembly: the sample counter is the timestamp
  private segs: AudioSeg[] = []
  private aNext = 0
  private aLimit = Infinity
  private priming = 0
  private padded = 0
  private aWait: (() => void) | null = null

  // MediaRecorder fallback
  private mr: MediaRecorder | null = null
  private mrChunks: Blob[] = []
  private mrTracks: MediaStreamTrack[] = []
  private mrVideo: CanvasCaptureMediaStreamTrack | null = null

  get busy() {
    return this.state !== 'idle'
  }

  get width() {
    return this.spec?.width ?? 0
  }

  get height() {
    return this.spec?.height ?? 0
  }

  get fps() {
    return this.spec?.fps ?? 0
  }

  /** media time recorded so far */
  get seconds() {
    if (this.state !== 'recording' || !this.spec) return 0
    return this.mr ? (performance.now() - this.startPerf) / 1000 : this.next / this.spec.fps
  }

  /** Set up encoders, muxer and audio tap; the take starts with begin(). Resolves to an error message or null. */
  async prepare(spec: TakeSpec): Promise<string | null> {
    if (this.state !== 'idle') return 'already recording'
    this.reset(spec)
    try {
      const err = spec.format.webcodecs ? await this.prepareCodecs(spec) : this.prepareRecorder(spec)
      if (err) this.teardown()
      else this.state = 'ready'
      return err
    } catch (e) {
      this.teardown()
      return `recording could not start: ${(e as Error).message}`
    }
  }

  /** The next grab() is frame 0. */
  begin() {
    if (this.state !== 'ready') return
    this.state = 'recording'
    this.pendingStart = true
    this.mr?.start(1000)
  }

  /** Hand over the frame that was just drawn. Must run in the same task as the draw (WebGPU canvases clear after it). */
  grab(canvas: HTMLCanvasElement | null, perf: number) {
    if (this.state !== 'ready' && this.state !== 'recording') return
    const jump = this.clock?.sample(perf) ?? false
    if (this.state !== 'recording' || !canvas || !this.spec) return
    const fps = this.spec.fps
    const now = this.clock ? this.clock.now(perf) : perf / 1000
    if (this.pendingStart) {
      this.pendingStart = false
      this.startPerf = perf
      this.segT0 = now
      this.segSlot0 = 0
      this.next = 0
      if (this.tap) {
        // sample s is context frame f0 + s - s0; the encoder's priming is paid for by starting later
        const f0 = Math.round(now * TAP_RATE)
        this.segs = [{ s0: -this.priming, f0, fEnd: Infinity }]
        this.tap.from(f0 + this.priming)
      }
      this.onStarted()
    } else if (jump) this.cut(now)
    if (this.mr) return this.grabRecorder(canvas, now)
    const venc = this.venc
    if (!venc || venc.state !== 'configured') return
    let due = dueSlot(this.segSlot0, this.segT0, now, fps)
    if (due < this.next) return // rendering faster than the take's rate: this render is not needed
    if (due - this.next > MAX_GAP_S * fps) {
      this.cut(now)
      due = this.next
    }
    // measured before this grab's repeats, so a burst of repeats after a stall does not count against it
    const q = venc.encodeQueueSize
    // slots the renderer missed get the previous picture (strict CFR)
    for (let s = this.next; s < due; s++) if (this.repeat(s)) this.repeated++
    // Encoder behind: only every k-th slot gets a fresh picture, the rest repeat the last one. A repeat
    // costs the encoder about as much, but holds no new GPU copy, so the backlog stays small in memory
    // while the picture keeps moving (dropping every fresh frame would freeze the take).
    const soft = Math.max(4, Math.round(fps / 4))
    const k = q > soft ? Math.ceil(q / soft) : 1
    if (this.last && due - this.lastFresh < k) {
      this.dropped++
      this.repeat(due)
    } else this.fresh(canvas, due)
    this.next = due + 1
  }

  /** Finish the take and save it. Resolves to the status line. */
  async stop(): Promise<string> {
    if (this.state === 'ready') {
      await this.cancel()
      return 'recording cancelled'
    }
    if (this.state !== 'recording' || !this.spec) return 'not recording'
    this.state = 'stopping'
    if (this.mr) return this.stopRecorder()
    const spec = this.spec
    const slots = this.next
    try {
      if (this.tap && this.aenc) {
        // exactly as much audio as video (the priming makes up the rest)
        this.aLimit = Math.max(0, this.slotSamples(slots) - this.priming)
        await this.audioTail()
      }
      this.tap?.close()
      this.tap = null
      if (this.venc?.state === 'configured') await this.venc.flush()
      if (this.aenc?.state === 'configured') await this.aenc.flush()
    } catch (e) {
      this.failure ||= (e as Error).message
    }
    const partial = this.failure !== ''
    const name = spec.save ? spec.save.handle.name : `${spec.name}${partial ? '_partial' : ''}.${spec.format.ext}`
    let bytes = 0
    try {
      if (!this.frames) throw new Error('no frames were captured')
      this.mux!.finalize()
      if (spec.save) {
        await spec.save.writable.close()
        bytes = (await spec.save.handle.getFile()).size
      } else {
        const blob = new Blob([this.buffer!.buffer], { type: spec.format.ext === 'mp4' ? 'video/mp4' : 'video/webm' })
        bytes = blob.size
        download(blob, name)
      }
    } catch (e) {
      const why = this.failure || (e as Error).message
      await spec.save?.writable.abort().catch(() => {})
      this.teardown()
      return `recording failed: ${why} — nothing was saved`
    }
    const secs = slots / spec.fps
    const notes = [
      `${this.dropped} dropped`,
      this.repeated ? `${this.repeated} repeated (renderer slower than ${spec.fps} fps)` : '',
      this.skipped ? `${this.skipped} skipped — timing not constant there` : '',
      this.cuts ? `${this.cuts} gap${this.cuts > 1 ? 's' : ''} over ${MAX_GAP_S} s cut` : '',
      this.padded ? `audio tail padded ${(this.padded / TAP_RATE).toFixed(2)} s` : '',
      partial ? `PARTIAL — ${this.failure}` : '',
    ].filter(Boolean)
    const msg = `saved ${name} · ${(bytes / 1e6).toFixed(1)} MB · ${secs.toFixed(1)} s · ${this.frames} frames @ ${spec.fps} fps · ${notes.join(' · ')}`
    this.teardown()
    return msg
  }

  /** Abandon a prepared (not yet started) take. */
  async cancel() {
    if (this.state === 'idle') return
    const save = this.spec?.save
    this.teardown()
    await save?.writable.abort().catch(() => {})
  }

  // ------------------------------------------------------------ WebCodecs path

  private async prepareCodecs(spec: TakeSpec): Promise<string | null> {
    const { width: w, height: h, fps } = spec
    const mp4 = spec.format.ext === 'mp4'
    const video = await pickVideo(spec.format.ext, w, h, fps, spec.bitrate)
    if (!video) return `no ${mp4 ? 'H.264' : 'VP9'} encoder for ${w}×${h} at ${fps} fps in this browser — try a smaller size or 30 fps`
    let acfg: AudioEncoderConfig | null = null
    if (spec.ctx && spec.bus) {
      acfg = await pickAudio(spec.format.ext)
      if (!acfg) return `no ${mp4 ? 'AAC' : 'Opus'} audio encoder in this browser`
      try {
        await loadPcmTap(spec.ctx)
      } catch (e) {
        return `the audio tap could not load (${(e as Error).message}) — nothing recorded`
      }
    }
    const audio = acfg ? { numberOfChannels: 2, sampleRate: TAP_RATE } : undefined
    // streaming to disk puts the index at the end (the classic QuickTime layout, fine for local playback);
    // in memory it goes to the front, which Quick Look and web players like best
    if (mp4) {
      const target = spec.save ? new Mp4FileTarget(spec.save.writable) : new Mp4Buffer()
      if (target instanceof Mp4Buffer) this.buffer = target
      this.mux = new Mp4Muxer({
        target,
        video: { codec: 'avc', width: w, height: h, frameRate: fps },
        audio: audio && { codec: 'aac', ...audio },
        fastStart: spec.save ? false : 'in-memory',
        firstTimestampBehavior: 'offset',
      })
    } else {
      const target = spec.save ? new WebmFileTarget(spec.save.writable) : new WebmBuffer()
      if (target instanceof WebmBuffer) this.buffer = target
      this.mux = new WebmMuxer({
        target,
        video: { codec: 'V_VP9', width: w, height: h, frameRate: fps },
        audio: audio && { codec: 'A_OPUS', ...audio },
        firstTimestampBehavior: 'offset',
      })
    }
    this.venc = new VideoEncoder({
      output: (chunk, meta) => {
        this.bytes += chunk.byteLength
        try {
          this.mux?.addVideoChunk(chunk, meta)
        } catch (e) {
          this.fail(`muxer: ${(e as Error).message}`)
        }
      },
      error: (e) => this.fail(`video encoder: ${e.message}`),
    })
    this.venc.configure(video.config)
    if (acfg && spec.ctx && spec.bus) {
      this.aenc = new AudioEncoder({
        output: (chunk, meta) => {
          this.bytes += chunk.byteLength
          try {
            this.mux?.addAudioChunk(chunk, meta)
          } catch (e) {
            this.fail(`muxer: ${(e as Error).message}`)
          }
        },
        error: (e) => this.fail(`audio encoder: ${e.message}`),
      })
      this.aenc.configure(acfg)
      this.priming = mp4 ? await measureAacDelay(acfg) : 0 // Opus signals its own pre-skip
      this.tap = new PcmTap(spec.ctx, spec.bus)
      this.tap.onBlock = (b) => this.onPcm(b)
      this.clock = new ContextClock(spec.ctx)
      this.clock.sample(performance.now())
    }
    const au = acfg ? `${mp4 ? 'AAC' : 'Opus'} ${Math.round((acfg.bitrate ?? 0) / 1000)} kbps 48 kHz stereo` : 'no audio'
    this.summary = `${w}×${h} · ${fps} fps constant · ${video.label} ${Math.round(spec.bitrate / 1e6)} Mbps · ${au}${spec.save ? ' · saving to disk while recording' : ''}`
    return null
  }

  private ts(slot: number) {
    return slotTimestamp(slot, this.spec!.fps)
  }

  private slotSamples(slot: number) {
    return slotSampleCount(slot, this.spec!.fps)
  }

  private encode(f: VideoFrame, slot: number) {
    // keyframe every 2 s — and at the first frame of a group whose opening slot was skipped
    const gop = Math.floor(slot / (2 * this.spec!.fps))
    this.venc!.encode(f, { keyFrame: gop !== this.lastGop })
    this.lastGop = gop
  }

  private fresh(canvas: HTMLCanvasElement, slot: number) {
    const { width, height, fps } = this.spec!
    const init = { timestamp: this.ts(slot), duration: Math.round(1e6 / fps), alpha: 'discard' } as const
    let f: VideoFrame
    try {
      // an engine that cannot render at the take's size is scaled into it, letterboxed, never stretched
      f = new VideoFrame(canvas.width === width && canvas.height === height ? canvas : this.letterbox(canvas), init)
    } catch {
      try {
        f = new VideoFrame(this.letterbox(canvas), init)
      } catch {
        // nothing readable this frame: keep the slot filled rather than throw out of the render loop
        this.dropped++
        this.repeat(slot)
        return
      }
    }
    this.encode(f, slot)
    this.last?.close()
    this.last = f // kept: repeats reference it without copying pixels
    this.lastFresh = slot
    this.frames++
  }

  /** Put the previous picture in this slot. False when even that was skipped (encoder hopelessly behind: > 4 s backlog). */
  private repeat(slot: number): boolean {
    if (!this.last || this.venc!.encodeQueueSize > 4 * this.spec!.fps) {
      this.skipped++
      return false
    }
    const f = new VideoFrame(this.last, { timestamp: this.ts(slot), duration: Math.round(1e6 / this.spec!.fps) })
    this.encode(f, slot)
    f.close()
    this.frames++
    return true
  }

  /** A W×H canvas of the take's size (letterboxing, and the fallback's capture source). */
  private scratchCanvas(): HTMLCanvasElement {
    if (!this.scratch) {
      this.scratch = document.createElement('canvas')
      this.scratch.width = this.spec!.width
      this.scratch.height = this.spec!.height
    }
    return this.scratch
  }

  private letterbox(src: HTMLCanvasElement): HTMLCanvasElement {
    const { width: w, height: h } = this.spec!
    const out = this.scratchCanvas()
    const g = out.getContext('2d')!
    g.fillStyle = '#000'
    g.fillRect(0, 0, w, h)
    if (src.width > 0 && src.height > 0) {
      const k = Math.min(w / src.width, h / src.height)
      const dw = src.width * k
      const dh = src.height * k
      g.drawImage(src, (w - dw) / 2, (h - dh) / 2, dw, dh)
    }
    return out
  }

  /** Cut both tracks at the current slot boundary and carry on from `now`. */
  private cut(now: number) {
    this.cuts++
    this.segSlot0 = this.next
    this.segT0 = now
    const seg = this.segs[this.segs.length - 1]
    if (!this.tap || !seg || !this.spec?.ctx) return
    const at = this.slotSamples(this.next) - this.priming
    // the old stretch ends at its projected end, or earlier if the audio clock stalled
    const heard = Math.round(this.spec.ctx.currentTime * TAP_RATE)
    seg.fEnd = Math.max(seg.f0, Math.min(seg.f0 + (at - seg.s0), heard))
    this.segs.push({ s0: at, f0: Math.round(now * TAP_RATE), fEnd: Infinity })
  }

  private onPcm(b: PcmBlock) {
    let i = 0
    while (i < b.n && this.aNext < this.aLimit) {
      const seg = this.segs[0]
      if (!seg) return
      const f = b.frame0 + i
      if (f >= seg.fEnd) {
        // past this stretch: whatever it never received becomes silence, then the next stretch
        const nextSeg = this.segs[1]
        if (!nextSeg) return
        this.silence(nextSeg.s0)
        this.segs.shift()
        continue
      }
      const s = seg.s0 + (f - seg.f0)
      if (s < this.aNext) {
        i += Math.min(b.n - i, this.aNext - s) // before the take, or inside a cut
        continue
      }
      if (s > this.aNext) {
        this.silence(s) // frames that never arrived: silence keeps every later sample in place
        continue
      }
      const n = Math.min(b.n - i, seg.fEnd - f, this.aLimit - this.aNext)
      this.emitAudio(b.pcm, i, b.right + i, n)
      i += n
    }
    if (this.aNext >= this.aLimit) this.aWait?.()
  }

  private silence(upTo: number) {
    const end = Math.min(upTo, this.aLimit)
    while (this.aNext < end) this.emitAudio(null, 0, 0, Math.min(TAP_RATE, end - this.aNext))
  }

  private emitAudio(pcm: Float32Array | null, l: number, r: number, n: number) {
    const enc = this.aenc
    if (enc && enc.state === 'configured') {
      const data = new Float32Array(n * 2)
      if (pcm) {
        data.set(pcm.subarray(l, l + n), 0)
        data.set(pcm.subarray(r, r + n), n)
      }
      const ad = new AudioData({
        format: 'f32-planar',
        sampleRate: TAP_RATE,
        numberOfFrames: n,
        numberOfChannels: 2,
        timestamp: Math.round((this.aNext * 1e6) / TAP_RATE),
        data,
      })
      try {
        enc.encode(ad) // never dropped: blocks are tiny, the queue just grows for a moment
      } finally {
        ad.close()
      }
    }
    this.aNext += n
  }

  /** Wait until the audio has caught up with the last video frame (a few ms), padding if the clock stalled. */
  private audioTail(): Promise<void> {
    return new Promise((resolve) => {
      const t0 = performance.now()
      let iv = 0
      const done = () => {
        clearInterval(iv)
        this.aWait = null
        resolve()
      }
      if (this.aNext >= this.aLimit) return done()
      this.aWait = done
      iv = window.setInterval(() => {
        if (this.aNext >= this.aLimit) return done()
        if (performance.now() - t0 > 1500) {
          this.padded = this.aLimit - this.aNext
          this.silence(this.aLimit)
          return done()
        }
        this.tap?.flush() // the worklet holds up to one partial block
      }, 40)
    })
  }

  private fail(message: string) {
    if (this.failure) return
    this.failure = message
    if (this.state === 'recording' || this.state === 'ready') this.onFailure(message)
  }

  // ------------------------------------------------------------ MediaRecorder fallback

  private prepareRecorder(spec: TakeSpec): string | null {
    if (typeof MediaRecorder === 'undefined' || !spec.format.mime) return 'this browser cannot record video'
    const { width: w, height: h, fps } = spec
    // capture a W×H copy of the stage, so the fallback file has the chosen size too
    const stream = this.scratchCanvas().captureStream(0)
    const vt = stream.getVideoTracks()[0] as CanvasCaptureMediaStreamTrack | undefined
    if (!vt) return 'the canvas gave no video track'
    this.mrTracks.push(vt)
    this.mrVideo = vt
    for (const t of spec.busStream?.getAudioTracks() ?? []) {
      if (t.readyState === 'ended') continue
      // own a clone: stopping it at the end must never stop the input itself
      const c = t.clone()
      this.mrTracks.push(c)
      stream.addTrack(c)
    }
    const rec = new MediaRecorder(stream, { mimeType: spec.format.mime, videoBitsPerSecond: spec.bitrate, audioBitsPerSecond: 192000 })
    rec.ondataavailable = (e) => {
      if (e.data.size) {
        this.mrChunks.push(e.data)
        this.bytes += e.data.size
      }
    }
    rec.onerror = () => this.fail('the browser recorder stopped')
    this.mr = rec
    const au = stream.getAudioTracks().length ? 'audio' : 'NO audio (the audio engine is not running)'
    this.summary = `${w}×${h} · ${fps} fps target · browser recorder fallback: timing may vary · ${rec.mimeType || spec.format.mime} · ${au}`
    return null
  }

  private grabRecorder(canvas: HTMLCanvasElement, now: number) {
    const fps = this.spec!.fps
    const due = dueSlot(this.segSlot0, this.segT0, now, fps)
    if (due < this.next) return
    this.repeated += due - this.next
    this.letterbox(canvas)
    this.mrVideo?.requestFrame()
    this.frames++
    this.next = due + 1
  }

  private stopRecorder(): Promise<string> {
    const spec = this.spec!
    const rec = this.mr!
    const secs = (performance.now() - this.startPerf) / 1000
    return new Promise((resolve) => {
      const finish = () => {
        const blob = new Blob(this.mrChunks, { type: rec.mimeType || spec.format.mime })
        const partial = this.failure !== ''
        const name = `${spec.name}${partial ? '_partial' : ''}.${spec.format.ext}`
        let msg = 'recording failed: nothing was captured'
        if (blob.size) {
          download(blob, name)
          msg = `saved ${name} · ${(blob.size / 1e6).toFixed(1)} MB · ${secs.toFixed(1)} s · browser recorder fallback: timing may vary${partial ? ` · PARTIAL — ${this.failure}` : ''}`
        }
        this.teardown()
        resolve(msg)
      }
      rec.onstop = finish
      if (rec.state !== 'inactive') rec.stop()
      else finish()
    })
  }

  // ------------------------------------------------------------ lifecycle

  private reset(spec: TakeSpec) {
    this.spec = spec
    this.failure = ''
    this.summary = ''
    this.frames = this.repeated = this.dropped = this.skipped = this.cuts = this.bytes = 0
    this.next = this.segSlot0 = 0
    this.lastGop = this.lastFresh = -1
    this.segs = []
    this.aNext = 0
    this.aLimit = Infinity
    this.priming = this.padded = 0
    this.pendingStart = false
  }

  private teardown() {
    this.tap?.close()
    this.tap = null
    for (const c of [this.venc, this.aenc]) {
      try {
        if (c && c.state !== 'closed') c.close()
      } catch {
        /* already closed */
      }
    }
    this.venc = null
    this.aenc = null
    this.mux = null
    this.buffer = null
    this.clock = null
    this.last?.close()
    this.last = null
    this.scratch = null
    this.aWait = null
    if (this.mr) {
      this.mr.ondataavailable = this.mr.onstop = this.mr.onerror = null
      if (this.mr.state !== 'inactive') this.mr.stop()
    }
    this.mr = null
    // only tracks the take owns; never the input's own
    for (const t of this.mrTracks) t.stop()
    this.mrTracks = []
    this.mrChunks = []
    this.mrVideo = null
    this.state = 'idle'
  }
}

/** Grab the canvas as a PNG. Call right after a frame was drawn (WebGL keeps the buffer until the next composite). */
export function snapshot(canvas: HTMLCanvasElement, name = `growth-${stamp()}.png`): Promise<string> {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => {
      if (!blob) return resolve('snapshot failed')
      download(blob, name)
      resolve(`saved ${name} (${canvas.width}×${canvas.height})`)
    }, 'image/png')
  })
}
