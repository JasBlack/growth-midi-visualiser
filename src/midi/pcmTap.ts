// Recording audio tap: an AudioWorklet that copies a bus into a 2 s ring and,
// once told where the take starts, posts planar stereo Float32 blocks to the
// main thread, each tagged with the context frame it starts at.
//
// The node's input is fixed at 2 channels with speaker mixing, so the graph
// itself duplicates mono and downmixes surround, and the shared context runs
// at 48 kHz: the recorder can never receive a channel count or sample rate it
// did not ask for (the old MediaStreamTrackProcessor path dropped the whole
// audio track when that happened). The ring lets a take start slightly in the
// past, so arm-on-note keeps the attack of the note that started it.
//
// The worklet source is inlined and loaded through a Blob URL: the release is
// one self-contained HTML file with no second file to fetch.

export const TAP_RATE = 48000
const BLOCK = 1024
const RING = 2 * TAP_RATE

const SOURCE = `
class GrowthPcmTap extends AudioWorkletProcessor {
  constructor(o) {
    super()
    const p = o.processorOptions
    this.block = p.block
    this.cap = p.ring
    this.L = new Float32Array(this.cap)
    this.R = new Float32Array(this.cap)
    this.end = 0
    this.emit = -1
    this.buf = null
    this.n = 0
    this.f0 = 0
    this.port.onmessage = (e) => {
      const m = e.data
      if (m.cmd === 'from') this.emit = Math.max(m.frame, this.end - this.cap, 0)
      else if (m.cmd === 'flush') this.flush()
      else if (m.cmd === 'stop') { this.flush(); this.emit = -1 }
    }
  }
  process(inputs) {
    const ch = inputs[0] || []
    const l = ch[0]
    const r = ch[1] || ch[0]
    const n = l ? l.length : 128
    const f0 = currentFrame
    for (let i = 0; i < n; i++) {
      const k = (f0 + i) % this.cap
      this.L[k] = l ? l[i] : 0
      this.R[k] = r ? r[i] : 0
    }
    this.end = f0 + n
    while (this.emit >= 0 && this.emit < this.end) {
      if (!this.buf) { this.buf = new Float32Array(this.block * 2); this.n = 0; this.f0 = this.emit }
      const k = this.emit % this.cap
      this.buf[this.n] = this.L[k]
      this.buf[this.block + this.n] = this.R[k]
      this.n++
      this.emit++
      if (this.n === this.block) this.flush()
    }
    return true
  }
  flush() {
    if (!this.buf || !this.n) return
    this.port.postMessage({ frame0: this.f0, n: this.n, pcm: this.buf }, [this.buf.buffer])
    this.buf = null
    this.n = 0
  }
}
registerProcessor('growth-pcm-tap', GrowthPcmTap)
`

const loaded = new WeakMap<AudioContext, Promise<void>>()

/** Load the worklet module into `ctx` (once). Rejects where AudioWorklet is missing. */
export function loadPcmTap(ctx: AudioContext): Promise<void> {
  let p = loaded.get(ctx)
  if (!p) {
    p = (async () => {
      if (!ctx.audioWorklet) throw new Error('AudioWorklet unavailable')
      const url = URL.createObjectURL(new Blob([SOURCE], { type: 'text/javascript' }))
      try {
        await ctx.audioWorklet.addModule(url)
      } finally {
        URL.revokeObjectURL(url)
      }
    })()
    // a failed load may succeed on the next take (e.g. the context was not ready)
    p.catch(() => loaded.delete(ctx))
    loaded.set(ctx, p)
  }
  return p
}

/** One block of planar stereo: `pcm[0..n)` is left, `pcm[BLOCK..BLOCK+n)` right, starting at context frame `frame0`. */
export interface PcmBlock {
  frame0: number
  n: number
  pcm: Float32Array
  /** offset of the right channel inside `pcm` */
  right: number
}

export class PcmTap {
  private node: AudioWorkletNode
  private sink: GainNode
  onBlock: (b: PcmBlock) => void = () => {}

  /** Call only after `loadPcmTap(ctx)` resolved. The ring starts filling immediately. */
  constructor(ctx: AudioContext, private source: AudioNode) {
    this.node = new AudioWorkletNode(ctx, 'growth-pcm-tap', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [1],
      channelCount: 2,
      channelCountMode: 'explicit',
      channelInterpretation: 'speakers',
      processorOptions: { block: BLOCK, ring: RING },
    })
    this.node.port.onmessage = (e: MessageEvent<{ frame0: number; n: number; pcm: Float32Array }>) => {
      const d = e.data
      this.onBlock({ frame0: d.frame0, n: d.n, pcm: d.pcm, right: BLOCK })
    }
    source.connect(this.node)
    // a worklet only runs while something pulls on it: a muted path to the speakers
    this.sink = ctx.createGain()
    this.sink.gain.value = 0
    this.node.connect(this.sink).connect(ctx.destination)
  }

  /** Start emitting at this absolute context frame (may be up to 2 s in the past). */
  from(frame: number) {
    this.node.port.postMessage({ cmd: 'from', frame })
  }

  /** Post the partly filled block now (used while waiting for the tail of a take). */
  flush() {
    this.node.port.postMessage({ cmd: 'flush' })
  }

  close() {
    this.node.port.postMessage({ cmd: 'stop' })
    this.node.port.onmessage = null
    try {
      this.source.disconnect(this.node)
    } catch {
      /* already disconnected */
    }
    this.node.disconnect()
    this.sink.disconnect()
  }
}
