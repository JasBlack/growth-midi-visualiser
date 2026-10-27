// Record button, start modes and the Output section's recording options.
//
// One state machine owns a take: idle → preparing → (counting | armed) →
// starting → recording → stopping → idle. Only idle accepts a new take, so
// starts can never overlap; "■ stop" appears only once the first frame is in
// the encoder. Preparing does everything that can fail or needs the click's
// user activation (save-file picker, waking the audio graph, sizing the stage,
// configuring encoders) before the countdown or the note trigger, so the
// start itself is instant and cannot fail.

import type { Engine } from './engine'
import { audioContext, busNode, recordingStream, type RecordBus } from './audioCtx'
import { Recorder, probeRecording, captureSize, bitrateFor, stamp, type RecCapabilities, type RecFormat, type RecQuality, type RecSize, type SaveTarget } from './recorder'
import { toast } from './ui/toast'

export interface RecSettings {
  /** RecFormat id: 'mp4' | 'webm' | 'mr:<mime>' */
  format: string
  size: RecSize
  fps: number
  quality: RecQuality
  audio: RecordBus
  /** stream the take into a file picked at start (File System Access) */
  stream: boolean
}

export const REC_DEFAULTS: RecSettings = { format: 'mp4', size: '1080', fps: 30, quality: 'high', audio: 'mix', stream: false }

/** Stored settings from any earlier version → valid RecSettings. */
export function loadRecSettings(stored: unknown, legacyFormat?: unknown): RecSettings {
  const s: Partial<RecSettings> = stored && typeof stored === 'object' ? (stored as Partial<RecSettings>) : {}
  const r = { ...REC_DEFAULTS }
  if (typeof s.format === 'string') r.format = s.format
  else if (typeof legacyFormat === 'string' && /webm/.test(legacyFormat)) r.format = 'webm' // v0.12–v0.19 recFormat
  if (s.size === '1080' || s.size === '1440' || s.size === '2160' || s.size === 'canvas') r.size = s.size
  if (s.fps === 30 || s.fps === 60) r.fps = s.fps
  if (s.quality === 'standard' || s.quality === 'high' || s.quality === 'max') r.quality = s.quality
  if (s.audio === 'input' || s.audio === 'mix') r.audio = s.audio
  r.stream = s.stream === true
  return r
}

export interface RecordHost {
  settings: { rec: RecSettings; recMode: string }
  save(): void
  setStatus(s: string): void
  engine(): Engine | null
  canvas(): HTMLCanvasElement | null
  inputMode(): 'midi' | 'file' | 'mic' | 'tab'
}

export type TakeState = 'idle' | 'preparing' | 'counting' | 'armed' | 'starting' | 'recording' | 'stopping'

interface SavePickerWindow {
  showSaveFilePicker(o: { suggestedName: string; types: { description: string; accept: Record<string, string[]> }[] }): Promise<FileSystemFileHandle>
}

const SIZE_LABELS: Record<RecSize, string> = {
  '1080': '1080p · 1920×1080',
  '1440': '1440p · 2560×1440',
  '2160': '4K · 3840×2160',
  canvas: 'current canvas',
}
const QUALITY_LABELS: Record<RecQuality, string> = { standard: 'Standard', high: 'High', max: 'Maximum' }
const OPTION_IDS = ['recFormat', 'recSize', 'recFps', 'recQuality', 'recAudio', 'recStream', 'recMode']

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export function setupRecording(host: RecordHost) {
  const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T
  const rs = host.settings.rec
  const recorder = new Recorder()
  let caps: RecCapabilities = { formats: [], saveWhileRecording: false }
  let st: TakeState = 'idle'
  let token = 0
  /** the engine whose size and quality the take holds */
  let held: Engine | null = null
  let busLabel = ''
  const btn = $<HTMLButtonElement>('record')
  /** the top bar's rec key and its copies (easy's Export step): one take, every key shows it */
  const keys = [btn, ...document.querySelectorAll<HTMLButtonElement>('[data-rec-key]')]
  const countdown = $('countdown')

  const formatNow = (): RecFormat | null => caps.formats.find((f) => f.id === rs.format) ?? caps.formats[0] ?? null

  function say(msg: string) {
    host.setStatus(msg)
    $('recStatus').textContent = msg
  }

  function render() {
    // the key's dot is its LED (red while a take runs, violet while armed): the words stay short
    const text: Record<TakeState, string> = {
      idle: 'rec',
      preparing: '…',
      counting: 'cancel',
      armed: 'cancel',
      starting: '…',
      recording: 'stop',
      stopping: 'saving…',
    }
    for (const k of keys) {
      k.textContent = text[st]
      k.dataset.state = st
      k.classList.toggle('rec', st === 'starting' || st === 'recording' || st === 'stopping')
      k.disabled = st === 'preparing' || st === 'stopping'
    }
    for (const id of OPTION_IDS) $<HTMLInputElement>(id).disabled = st !== 'idle'
  }

  // ------------------------------------------------------------ Output section

  function fillSelect(sel: HTMLSelectElement, options: [string, string][], value: string) {
    sel.innerHTML = ''
    for (const [v, label] of options) {
      const o = document.createElement('option')
      o.value = v
      o.textContent = label
      sel.appendChild(o)
    }
    sel.value = options.some(([v]) => v === value) ? value : options[0]?.[0] ?? ''
    return sel.value
  }

  /** Rebuild what depends on the format / size / fps, so every label states what will be written. */
  function refresh() {
    const fmt = formatNow()
    const sizes = (['1080', '1440', '2160', 'canvas'] as RecSize[]).filter((s) => s !== '2160' || fmt?.uhd)
    const c = host.canvas()
    const now = captureSize('canvas', c)
    rs.size = fillSelect(
      $('recSize'),
      sizes.map((s) => [s, s === 'canvas' && c ? `${SIZE_LABELS.canvas} · ${now.width}×${now.height}` : SIZE_LABELS[s]]),
      rs.size,
    ) as RecSize
    const { width, height } = captureSize(rs.size, c)
    rs.quality = fillSelect(
      $('recQuality'),
      (['standard', 'high', 'max'] as RecQuality[]).map((q) => [q, `${QUALITY_LABELS[q]} · ${Math.round(bitrateFor(q, width, height, rs.fps) / 1e6)} Mbps`]),
      rs.quality,
    ) as RecQuality
    $<HTMLSelectElement>('recFps').value = String(rs.fps)
    $<HTMLSelectElement>('recAudio').value = rs.audio
    const streamBox = $<HTMLInputElement>('recStream')
    $('recStreamRow').hidden = !caps.saveWhileRecording || !fmt?.webcodecs
    streamBox.checked = rs.stream
    const note = !fmt
      ? 'This browser cannot record video.'
      : !fmt.webcodecs
        ? 'This browser has no WebCodecs encoder, so its own recorder is used: frame timing may vary and editors may stutter. Chrome or Edge write constant-frame-rate MP4.'
        : fmt.ext === 'mp4'
          ? 'Regular MP4 (not fragmented) at a constant frame rate, index at the front — made for Quick Look, QuickTime, VLC and Resolve.'
          : 'WebM plays in browsers and VLC; Quick Look, QuickTime and Resolve want the MP4.'
    $('recFormatNote').textContent = `${note} While recording, the stage renders at exactly the chosen size (letterboxed on screen). MIDI sessions record the full mix.`
    // easy's Export step: what a take will be, in one line
    $('recSummary').textContent = fmt
      ? `${fmt.ext} · ${rs.size === 'canvas' ? `${width}×${height}` : `${height}p`}${rs.fps} · ${QUALITY_LABELS[rs.quality].toLowerCase()} · ${rs.audio === 'mix' ? 'full mix' : 'input only'}`
      : 'this browser cannot record video'
  }

  function wireOptions() {
    const fmtSel = $<HTMLSelectElement>('recFormat')
    rs.format = fillSelect(
      fmtSel,
      caps.formats.map((f) => [f.id, f.label]),
      rs.format,
    )
    fmtSel.onchange = () => {
      rs.format = fmtSel.value
      refresh()
      host.save()
    }
    $<HTMLSelectElement>('recSize').onchange = (e) => {
      rs.size = (e.target as HTMLSelectElement).value as RecSize
      refresh()
      host.save()
    }
    $<HTMLSelectElement>('recFps').onchange = (e) => {
      rs.fps = Number((e.target as HTMLSelectElement).value) === 60 ? 60 : 30
      refresh()
      host.save()
    }
    $<HTMLSelectElement>('recQuality').onchange = (e) => {
      rs.quality = (e.target as HTMLSelectElement).value as RecQuality
      refresh()
      host.save()
    }
    $<HTMLSelectElement>('recAudio').onchange = (e) => {
      rs.audio = (e.target as HTMLSelectElement).value === 'input' ? 'input' : 'mix'
      refresh()
      host.save()
    }
    $<HTMLInputElement>('recStream').onchange = (e) => {
      rs.stream = (e.target as HTMLInputElement).checked
      host.save()
    }
    // "current canvas" follows the window until a take starts
    $<HTMLDetailsElement>('sec-output').addEventListener('toggle', () => st === 'idle' && refresh())
    refresh()
  }

  const ready = probeRecording().then((c) => {
    caps = c
    wireOptions()
  })

  // ------------------------------------------------------------ a take

  function restore() {
    if (held) {
      held.setOutputSize?.(null)
      held.lockQuality = false
      held = null
    }
  }

  async function waitRunning(ctx: AudioContext, ms: number) {
    for (let t = 0; ctx.state !== 'running' && t < ms; t += 50) await sleep(50)
    return ctx.state === 'running'
  }

  /** Everything that can fail, before the take is armed. Resolves to an error message or null. */
  async function prepareTake(): Promise<string | null> {
    await ready
    const fmt = formatNow()
    if (!fmt) return 'this browser cannot record video'
    // wake the audio graph inside the click; the take's audio depends on it
    const ctx = audioContext()
    const resumed = ctx.resume().catch(() => {})
    const size = captureSize(rs.size === '2160' && !fmt.uhd ? '1080' : rs.size, host.canvas())
    const tag = rs.size === 'canvas' ? `${size.width}x${size.height}-${rs.fps}` : `${size.height}p${rs.fps}`
    const name = `growth-${stamp()}-${tag}`
    let save: SaveTarget | null = null
    if (rs.stream && fmt.webcodecs && caps.saveWhileRecording) {
      // the picker needs the click's user activation: it goes first
      try {
        const handle = await (window as unknown as SavePickerWindow).showSaveFilePicker({
          suggestedName: `${name}.${fmt.ext}`,
          types: [{ description: fmt.ext === 'mp4' ? 'MP4 video' : 'WebM video', accept: { [fmt.ext === 'mp4' ? 'video/mp4' : 'video/webm']: [`.${fmt.ext}`] } }],
        })
        save = { handle, writable: await handle.createWritable() }
      } catch (e) {
        return (e as DOMException).name === 'AbortError' ? 'recording cancelled' : `could not open the file: ${(e as Error).message}`
      }
    }
    await resumed
    if (!(await waitRunning(ctx, 1500))) {
      await save?.writable.abort().catch(() => {})
      return 'the audio engine did not start, so the take would have no sound — click the page once and press rec again'
    }
    const bus: RecordBus = host.inputMode() === 'midi' ? 'mix' : rs.audio
    busLabel = bus === 'mix' ? 'full mix' : 'input only'
    const eng = host.engine()
    if (eng) {
      held = eng
      eng.lockQuality = true
      eng.setOutputSize?.(size) // the stage renders at the file's size from the next frame on
    }
    const err = await recorder.prepare({
      format: fmt,
      width: size.width,
      height: size.height,
      fps: rs.fps,
      bitrate: bitrateFor(rs.quality, size.width, size.height, rs.fps),
      ctx: fmt.webcodecs ? ctx : null,
      bus: fmt.webcodecs ? busNode(bus) : null,
      busStream: fmt.webcodecs ? null : recordingStream(bus),
      save,
      name,
    })
    if (err) {
      await save?.writable.abort().catch(() => {})
      return err
    }
    return null
  }

  function begin() {
    st = 'starting'
    render()
    recorder.begin()
  }

  recorder.onStarted = () => {
    st = 'recording'
    render()
    say(`recording ${recorder.summary} · ${busLabel}`)
  }

  recorder.onFailure = (msg) => {
    if (st === 'recording' || st === 'starting') {
      say(`recording problem: ${msg} — saving what was captured`)
      void stopTake()
    } else if (st === 'counting' || st === 'armed') void cancelTake(`recording could not start: ${msg}`)
  }

  async function stopTake() {
    st = 'stopping'
    render()
    say('saving the take…')
    let msg: string
    try {
      msg = await recorder.stop()
    } catch (e) {
      msg = `recording failed: ${(e as Error).message}`
    }
    restore()
    st = 'idle'
    render()
    say(msg)
    toast(msg, /fail|problem|could not/i.test(msg) ? 'err' : 'ok')
  }

  async function cancelTake(msg: string) {
    token++
    countdown.hidden = true
    await recorder.cancel()
    restore()
    st = 'idle'
    render()
    say(msg)
  }

  async function toggle() {
    if (st === 'preparing' || st === 'stopping') return
    if (st === 'recording') return stopTake()
    // 'starting' waits for the next rendered frame; if frames have stopped (minimised window) it must stay cancellable
    if (st === 'counting' || st === 'armed' || st === 'starting') return cancelTake('recording cancelled')
    const my = ++token
    st = 'preparing'
    render()
    say('preparing the recording…')
    let err: string | null
    try {
      err = await prepareTake()
    } catch (e) {
      err = `recording could not start: ${(e as Error).message}`
    }
    if (err) {
      await recorder.cancel()
      restore()
      st = 'idle'
      render()
      say(err)
      if (err !== 'recording cancelled') toast(err, 'err')
      return
    }
    const how = host.settings.recMode
    if (how === 'count') {
      st = 'counting'
      render()
      for (let n = 3; n > 0; n--) {
        countdown.textContent = String(n)
        countdown.hidden = false
        await sleep(1000)
        if (token !== my) return // cancelled
      }
      countdown.hidden = true
      begin()
    } else if (how === 'note') {
      st = 'armed'
      countdown.textContent = '♪'
      countdown.hidden = false
      render()
      say(`armed — ${recorder.summary} · ${busLabel} — starts on the next note (press rec again to cancel)`)
    } else begin()
  }

  $<HTMLSelectElement>('recMode').value = host.settings.recMode
  $<HTMLSelectElement>('recMode').onchange = (e) => {
    host.settings.recMode = (e.target as HTMLSelectElement).value
    host.save()
  }
  for (const k of keys) k.onclick = () => void toggle()
  window.addEventListener('beforeunload', (e) => {
    if (st === 'recording' || st === 'stopping') e.preventDefault()
  })
  render()

  return {
    recorder,
    toggle,
    /** Anything but idle: engine switching must wait. */
    busy: () => st !== 'idle',
    /** where the take is (the top bar's rec light) */
    state: (): TakeState => st,
    /** From the loop, before the engine draws: an armed take starts on this frame's first note-on. */
    notes(events: readonly { kind: string }[]) {
      if (st === 'armed' && events.some((e) => e.kind === 'on')) {
        countdown.hidden = true
        begin()
      }
    },
    /** From the loop, right after the engine drew (same task). */
    afterFrame() {
      if (recorder.busy) recorder.grab(host.canvas(), performance.now())
    },
    hud(): string {
      if (st === 'armed') return ' · ♪ armed'
      if (st === 'counting') return ' · ● REC in…'
      if (st !== 'recording') return ''
      const s = Math.floor(recorder.seconds)
      const time = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
      const warn = recorder.dropped ? ` · ⚠ ${recorder.dropped} dropped` : ''
      return ` · ● REC ${time} ${recorder.width}×${recorder.height} ${recorder.fps}p ${(recorder.bytes / 1e6).toFixed(0)} MB${warn}`
    },
  }
}
