// Tempo tracking. Two sources: MIDI clock (24 ticks per beat, exact) or the
// onset stream (interval histogram folded into 80–160 bpm, phase snapped to
// onsets near the predicted beat). Exposes a phase ramp plus beat / bar
// impulses so visuals can lock to bars instead of raw hits.

export interface BeatState {
  bpm: number
  /** 0..1 within the current beat */
  phase: number
  /** impulse: 1 on a beat, decays */
  hit: number
  /** impulse: 1 on a bar (every 4 beats), decays */
  barHit: number
  /** running beat count */
  beat: number
  /** 0..1 how sure the onset estimate is (1 for MIDI clock) */
  confidence: number
  source: 'none' | 'onsets' | 'clock'
}

export class BeatTracker {
  readonly state: BeatState = { bpm: 0, phase: 0, hit: 0, barHit: 0, beat: 0, confidence: 0, source: 'none' }
  private onsets: number[] = []
  private period = 0
  private nextBeat = 0
  private lastOnset = -1e9
  private lastBeatT = 0
  // MIDI clock: beats come only from received ticks (never predicted), so a late tick can't double a beat
  private ticks = 0
  private clockSeen = -1e9
  private tickEma = 0
  private beatDue = false
  private dueT = 0
  /** 'stopped' after 0xFC: clock may keep arriving (tempo) but beats wait for Start / Continue */
  private transport: 'unknown' | 'running' | 'stopped' = 'unknown'

  /** An onset at time t (seconds). Only meaningful hits — feed it strength-gated. */
  onset(t: number) {
    if (this.state.source === 'clock' && t - this.clockSeen < 2) return
    this.state.source = 'onsets'
    this.lastOnset = t
    this.onsets.push(t)
    if (this.onsets.length > 40) this.onsets.shift()
    this.estimate()
    if (this.period > 0) {
      const win = this.period * 0.18
      // an onset near the predicted beat re-anchors it; a late one (just after a beat fired) shifts the grid
      if (Math.abs(t - this.nextBeat) < win) this.nextBeat = t
      else if (this.lastBeatT > 0 && t >= this.lastBeatT && t - this.lastBeatT < win) this.nextBeat += t - this.lastBeatT
    }
  }

  /** MIDI clock tick (0xF8) at t: 24 per beat, and the first one after Start is the downbeat. */
  clockTick(t: number) {
    const d = t - this.clockSeen
    if (d > 0 && d < 0.25) this.tickEma = this.tickEma > 0 ? this.tickEma + (d - this.tickEma) * 0.08 : d
    this.clockSeen = t
    this.state.source = 'clock'
    this.state.confidence = 1
    if (this.transport === 'stopped') return
    if (this.ticks % 24 === 0) {
      this.beatDue = true
      this.dueT = t
    }
    this.ticks++
  }

  /** 0xFA: the song starts from the top. */
  clockStart() {
    this.transport = 'running'
    this.ticks = 0
    this.state.beat = 0
    this.beatDue = false
  }

  /** 0xFB: resume where it stopped (the bar count is kept). */
  clockContinue() {
    this.transport = 'running'
  }

  /** 0xFC */
  clockStop() {
    this.transport = 'stopped'
    this.beatDue = false
  }

  /** 0xF2 Song Position Pointer, in sixteenths: sent before Continue when the DAW relocates. */
  songPosition(sixteenths: number) {
    this.ticks = sixteenths * 6
    this.state.beat = Math.floor(sixteenths / 4)
  }

  private estimate() {
    const o = this.onsets
    if (o.length < 4) return
    // interval histogram, 20 ms bins, folded toward 0.375..0.75 s (160..80 bpm)
    const bins = new Float32Array(60) // 0.30 .. 1.50 s
    let total = 0
    for (let i = 0; i < o.length; i++) {
      for (let j = i + 1; j < o.length; j++) {
        let d = o[j] - o[i]
        if (d > 2.4) break
        if (d < 0.15) continue
        for (const cand of [d, d / 2, d * 2, d / 3, d / 4]) {
          if (cand < 0.3 || cand > 1.5) continue
          const w = cand >= 0.375 && cand <= 0.75 ? 1 : 0.45
          bins[Math.min(59, Math.floor((cand - 0.3) / 0.02))] += w
          total += w
        }
      }
    }
    let best = 0
    for (let i = 1; i < 60; i++) if (bins[i] > bins[best]) best = i
    if (bins[best] < 3) return
    // sub-bin refine with neighbours
    const l = bins[best - 1] ?? 0
    const r = bins[best + 1] ?? 0
    const off = (r - l) / (2 * (bins[best] + l + r) + 1e-6)
    const p = 0.3 + (best + 0.5 + off) * 0.02
    // slow drift unless there is no period yet
    this.period = this.period > 0 ? this.period + (p - this.period) * 0.3 : p
    if (this.nextBeat === 0) this.nextBeat = o[o.length - 1] + this.period
    this.state.confidence = Math.min(1, bins[best] / Math.max(1, total * 0.25))
  }

  tick(t: number, dt: number) {
    const s = this.state
    s.hit *= Math.exp(-dt * 10)
    s.barHit *= Math.exp(-dt * 8)
    if (s.source === 'clock' && t - this.clockSeen > 0.5) {
      // the clock stopped arriving: no phantom beats at the last tempo
      this.period = this.tickEma = 0
      this.nextBeat = 0
      this.beatDue = false
      this.transport = 'unknown'
      s.confidence = 0
      s.source = 'none'
    }
    if (s.source === 'onsets' && t - this.lastOnset > 6) {
      this.period = 0
      this.nextBeat = 0
      s.confidence = 0
      s.source = 'none'
    }
    if (s.source === 'clock') {
      this.period = this.tickEma * 24
      if (this.beatDue) {
        this.beatDue = false
        this.fire(this.dueT)
      }
      s.bpm = this.period > 0 ? 60 / this.period : 0
      s.phase = this.period > 0 && this.lastBeatT > 0 ? Math.max(0, Math.min(1, (t - this.lastBeatT) / this.period)) : 0
      return
    }
    if (this.period > 0 && this.nextBeat > 0 && t >= this.nextBeat) {
      this.fire(t)
      this.nextBeat += this.period
      if (this.nextBeat < t) this.nextBeat = t + this.period
    }
    s.bpm = this.period > 0 ? 60 / this.period : 0
    s.phase = this.period > 0 && this.nextBeat > 0 ? Math.max(0, Math.min(1, 1 - (this.nextBeat - t) / this.period)) : 0
  }

  /** A beat: every 4th from the downbeat (beat 0) is a bar. */
  private fire(t: number) {
    const s = this.state
    s.hit = 1
    if (s.beat % 4 === 0) s.barHit = 1
    s.beat++
    this.lastBeatT = t
  }
}
