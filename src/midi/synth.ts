// Sound-back: the organism answers. Small WebAudio plucks tuned to the note
// that grew the structure, fired on fuse / burst / spawn events. Off by
// default; quiet by design so it sits under the music.

import { audioContext, toOutput } from './audioCtx'

export type SoundEvent = 'fuse' | 'burst' | 'spawn'

export class SoundBack {
  enabled = false
  volume = 0.25
  private ctx: AudioContext | null = null
  private master: GainNode | null = null
  private lastT = 0

  private ensure() {
    if (!this.ctx) {
      this.ctx = audioContext()
      this.master = this.ctx.createGain()
      this.master.gain.value = this.volume
      toOutput(this.master)
    }
    return this.ctx
  }

  play(kind: SoundEvent, pitch: number, vel = 0.6) {
    if (!this.enabled) return
    const ctx = this.ensure()
    const now = ctx.currentTime
    if (now - this.lastT < 0.03) return // rate limit
    this.lastT = now
    this.master!.gain.value = this.volume
    const f = 440 * Math.pow(2, (pitch - 69) / 12)
    const osc = ctx.createOscillator()
    const osc2 = ctx.createOscillator()
    const g = ctx.createGain()
    const lp = ctx.createBiquadFilter()
    lp.type = 'lowpass'
    let dur = 0.5
    if (kind === 'fuse') {
      osc.type = 'sine'
      osc2.type = 'sine'
      osc.frequency.value = f
      osc2.frequency.value = f * 1.5 // a fifth: two things becoming one
      lp.frequency.value = 2400
      dur = 0.9
    } else if (kind === 'burst') {
      osc.type = 'triangle'
      osc2.type = 'square'
      osc.frequency.value = f * 2
      osc2.frequency.value = f * 4
      lp.frequency.value = 3500
      dur = 0.18
    } else {
      osc.type = 'sine'
      osc2.type = 'triangle'
      osc.frequency.value = f
      osc2.frequency.value = f * 2
      lp.frequency.value = 1800
      dur = 0.6
    }
    const g2 = ctx.createGain()
    g2.gain.value = 0.35
    osc2.connect(g2).connect(lp)
    osc.connect(lp)
    lp.connect(g).connect(this.master!)
    const peak = 0.12 + 0.3 * vel
    g.gain.setValueAtTime(0.0001, now)
    g.gain.exponentialRampToValueAtTime(peak, now + 0.008)
    g.gain.exponentialRampToValueAtTime(0.0001, now + dur)
    osc.start(now)
    osc2.start(now)
    osc.stop(now + dur + 0.05)
    osc2.stop(now + dur + 0.05)
  }
}

// ---------------------------------------------------------------- Instrument: play the MIDI / keyboard notes
export const INSTRUMENTS = ['off', 'pluck', 'pad', 'bass', 'bell', 'organ', 'strings', 'lead', 'keys'] as const

interface Voice {
  stop: (t: number) => void
}

export class Instrument {
  preset = 0
  volume = 0.5
  private ctx: AudioContext | null = null
  private master: GainNode | null = null
  private wet: GainNode | null = null
  private voices = new Map<number, Voice>()

  private ensure() {
    if (!this.ctx) {
      const ctx = audioContext()
      this.ctx = ctx
      this.master = ctx.createGain()
      toOutput(this.master)
      // small generated reverb
      const len = ctx.sampleRate * 2
      const ir = ctx.createBuffer(2, len, ctx.sampleRate)
      for (let c = 0; c < 2; c++) {
        const d = ir.getChannelData(c)
        for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.5)
      }
      const conv = ctx.createConvolver()
      conv.buffer = ir
      this.wet = ctx.createGain()
      this.wet.gain.value = 0.25
      this.master.connect(conv).connect(this.wet)
      toOutput(this.wet)
    }
    this.master!.gain.value = this.volume * 0.5
    return this.ctx
  }

  noteOn(pitch: number, vel: number) {
    if (this.preset === 0) return
    const ctx = this.ensure()
    this.noteOff(pitch)
    const f = 440 * Math.pow(2, (pitch - 69) / 12)
    const now = ctx.currentTime
    const out = ctx.createGain()
    out.gain.value = 0
    const filt = ctx.createBiquadFilter()
    filt.type = 'lowpass'
    filt.connect(out).connect(this.master!)
    const oscs: OscillatorNode[] = []
    const extra: AudioNode[] = []
    const osc = (type: OscillatorType, freq: number, gain = 1, detune = 0) => {
      const o = ctx.createOscillator()
      o.type = type
      o.frequency.value = freq
      o.detune.value = detune
      const g = ctx.createGain()
      g.gain.value = gain
      o.connect(g).connect(filt)
      o.start(now)
      oscs.push(o)
      return o
    }
    const fm = (carrierF: number, ratio: number, index: number, decay: number) => {
      const c = ctx.createOscillator()
      c.frequency.value = carrierF
      const m = ctx.createOscillator()
      m.frequency.value = carrierF * ratio
      const mg = ctx.createGain()
      mg.gain.setValueAtTime(carrierF * index, now)
      mg.gain.exponentialRampToValueAtTime(carrierF * index * 0.05 + 1, now + decay)
      m.connect(mg).connect(c.frequency)
      c.connect(filt)
      c.start(now)
      m.start(now)
      oscs.push(c, m)
      extra.push(mg)
    }
    const peak = 0.25 + 0.6 * vel
    let attack = 0.01
    let release = 0.3
    let sustainLevel = 0.7
    let decay = 0.3
    switch (INSTRUMENTS[this.preset]) {
      case 'pluck':
        osc('triangle', f)
        osc('sawtooth', f, 0.3)
        filt.frequency.setValueAtTime(3500, now)
        filt.frequency.exponentialRampToValueAtTime(400, now + 0.5)
        attack = 0.004
        decay = 0.5
        sustainLevel = 0.15
        release = 0.25
        break
      case 'pad':
        osc('sawtooth', f, 0.5, -7)
        osc('sawtooth', f, 0.5, 7)
        osc('sine', f / 2, 0.4)
        filt.frequency.value = 1400
        filt.Q.value = 2
        attack = 0.5
        decay = 0.5
        sustainLevel = 0.9
        release = 1.4
        break
      case 'bass':
        osc('sine', f / 2, 1)
        osc('square', f, 0.35)
        filt.frequency.setValueAtTime(900, now)
        filt.frequency.exponentialRampToValueAtTime(220, now + 0.3)
        attack = 0.005
        decay = 0.3
        sustainLevel = 0.6
        release = 0.12
        break
      case 'bell':
        fm(f, 3.5, 2.2, 1.2)
        filt.frequency.value = 8000
        attack = 0.003
        decay = 1.6
        sustainLevel = 0.0
        release = 0.6
        break
      case 'organ':
        osc('sine', f, 0.8)
        osc('sine', f * 2, 0.5)
        osc('sine', f * 3, 0.25)
        osc('sine', f * 4, 0.2)
        filt.frequency.value = 6000
        attack = 0.02
        sustainLevel = 1
        release = 0.06
        break
      case 'strings':
        osc('sawtooth', f, 0.4, -10)
        osc('sawtooth', f, 0.4, 10)
        osc('sawtooth', f * 2, 0.15, 4)
        filt.frequency.value = 2600
        attack = 0.6
        decay = 0.3
        sustainLevel = 0.9
        release = 0.9
        break
      case 'lead':
        osc('square', f, 0.6)
        osc('sawtooth', f, 0.4, 5)
        filt.frequency.setValueAtTime(4000, now)
        filt.frequency.exponentialRampToValueAtTime(1500, now + 0.4)
        filt.Q.value = 4
        attack = 0.01
        decay = 0.4
        sustainLevel = 0.7
        release = 0.2
        break
      case 'keys':
        fm(f, 1, 1.6, 1.4)
        fm(f * 2, 14, 0.15, 0.1)
        filt.frequency.value = 5000
        attack = 0.003
        decay = 1.8
        sustainLevel = 0.2
        release = 0.35
        break
    }
    out.gain.setValueAtTime(0.0001, now)
    out.gain.exponentialRampToValueAtTime(peak, now + attack)
    out.gain.exponentialRampToValueAtTime(Math.max(0.0005, peak * sustainLevel), now + attack + decay)
    const stop = (t: number) => {
      out.gain.cancelScheduledValues(t)
      out.gain.setValueAtTime(Math.max(0.0005, out.gain.value), t)
      out.gain.exponentialRampToValueAtTime(0.0001, t + release)
      for (const o of oscs) o.stop(t + release + 0.05)
    }
    this.voices.set(pitch, { stop })
    if (sustainLevel === 0) setTimeout(() => this.noteOff(pitch), (attack + decay) * 1000)
  }

  noteOff(pitch: number) {
    const v = this.voices.get(pitch)
    if (!v || !this.ctx) return
    this.voices.delete(pitch)
    v.stop(this.ctx.currentTime)
  }

  allOff() {
    for (const p of [...this.voices.keys()]) this.noteOff(p)
  }
}
