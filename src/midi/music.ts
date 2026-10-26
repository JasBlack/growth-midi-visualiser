// Shared music state consumed by every visual engine. Both input modes (Web
// MIDI, decoded audio) reduce to the same NoteEvent stream + a handful of
// smoothed scalars, so an engine never cares where the notes came from.

import { ArcTracker, createArcState, type ArcState } from './arcs'
import { BeatTracker, type BeatState } from './beat'

/** Where a note came from. `channel` is only ever a real MIDI channel; stems carry `stem`. */
export type NoteSource = 'midi' | 'keys' | 'audio' | 'stem'

export interface NoteEvent {
  kind: 'on' | 'off'
  pitch: number // MIDI note number 0..127
  velocity: number // 0..1
  time: number // seconds (performance clock)
  /** MIDI channel 0..15 (0 for every other source) */
  channel: number
  source: NoteSource
  /** stems: 0 drums, 1 bass, 2 voice, 3 other */
  stem?: number
  /** Reset re-sending a note that is still held: it grows again but is not a new attack */
  regrow?: boolean
}

export interface ActiveNote {
  pitch: number
  velocity: number
  t0: number
  source: NoteSource
  channel: number
  stem?: number
}

const SOURCE_I: Record<NoteSource, number> = { midi: 0, keys: 1, audio: 2, stem: 3 }

/**
 * One held note per source, channel (stem for stems) and pitch, so the same pitch layered
 * on two channels, or a key and an audio pseudo-note, are two notes that end separately.
 */
export const noteKey = (n: { source: NoteSource; channel: number; stem?: number; pitch: number }) =>
  ((SOURCE_I[n.source] * 16 + (n.source === 'stem' ? (n.stem ?? 0) : n.channel)) << 7) | (n.pitch & 127)

export interface MusicState {
  time: number
  dt: number
  /** Note on/off events that arrived since the previous frame (cleared each frame). */
  events: NoteEvent[]
  /** Pitches held right now by any source, keyed by pitch (the latest holder). */
  active: Map<number, ActiveNote>
  /** Every held note keyed by noteKey (source, channel, pitch). */
  notes: Map<number, ActiveNote>
  /** 0..1 smoothed loudness (audio RMS or summed note velocity). */
  energy: number
  /** 0..1 band levels. In MIDI mode these come from the register of held notes. */
  bass: number
  mid: number
  treble: number
  /** 12-bin pitch-class profile, normalised so max = 1 (all 0 when silent). */
  chroma: Float32Array
  /** Index of the loudest pitch class, -1 when silent. */
  rootPc: number
  /** Impulse that jumps to 1 on every onset (note-on / spectral flux peak) and decays. */
  onset: number
  /** Notes per second, smoothed. */
  density: number
  /** Number of distinct pitch classes held recently — drives replication / symmetry. */
  polyphony: number
  /** Mean pitch of held notes 0..1 (0 = C-1, 1 = G9). 0.5 when nothing held. */
  register: number
  /** MIDI CC values 0..1 by controller number (mod wheel = 1, sustain = 64). */
  cc: Float32Array
  pitchBend: number // -1..1
  /** tempo: bpm, phase ramp, beat / bar impulses */
  beat: BeatState
  /** energy arcs over bars: tension (build-up), drop, breakdown, section changes (arcs.ts) */
  arc: ArcState
}

export function createMusicState(): MusicState {
  return {
    time: 0,
    dt: 0,
    events: [],
    active: new Map(),
    notes: new Map(),
    energy: 0,
    bass: 0,
    mid: 0,
    treble: 0,
    chroma: new Float32Array(12),
    rootPc: -1,
    onset: 0,
    density: 0,
    polyphony: 1,
    register: 0.5,
    cc: new Float32Array(128),
    pitchBend: 0,
    beat: { bpm: 0, phase: 0, hit: 0, barHit: 0, beat: 0, confidence: 0, source: 'none' },
    arc: createArcState(),
  }
}

/** Per-frame analysis pushed by an input (audio mode). MIDI mode leaves this null. */
export interface AudioFeatures {
  energy: number
  bass: number
  mid: number
  treble: number
  chroma: Float32Array
  /** raw input level (RMS, 0 while gated), before the loudness normaliser: the energy arcs read it */
  level?: number
}

export const pitchClass = (pitch: number) => ((pitch % 12) + 12) % 12
export const octave = (pitch: number) => Math.floor(pitch / 12) - 1

/**
 * Where a note lives on the canvas (normalised 0..1). Pitch class → angle
 * around the centre (circle of semitones), octave → radius (bass in the middle,
 * treble at the edge). Every engine uses this so a chord "looks" the same
 * across growth patterns.
 */
export function notePos(pitch: number, jitter = 0): { x: number; y: number; a: number; r: number } {
  const a = (pitchClass(pitch) / 12) * Math.PI * 2 - Math.PI / 2
  const oct = Math.min(8, Math.max(1, octave(pitch)))
  const r = 0.08 + ((oct - 1) / 7) * 0.36 + (Math.random() - 0.5) * jitter
  return { x: 0.5 + r * Math.cos(a), y: 0.5 + r * Math.sin(a), a, r }
}

const exp = (cur: number, target: number, rate: number, dt: number) =>
  cur + (target - cur) * (1 - Math.exp(-rate * dt))

/**
 * Advance the music state by one frame. Pushed events are drained into
 * `state.events` and applied to the active-note map; audio features (when
 * present) override the band/energy/chroma estimates derived from MIDI.
 */
export class MusicClock {
  readonly state = createMusicState()
  readonly beat = new BeatTracker()
  readonly arcs = new ArcTracker()
  private pending: NoteEvent[] = []
  private recentPcs: { pc: number; t: number }[] = []
  private noteTimes: number[] = []
  private lastT = performance.now() / 1000
  /** MIDI channels with the sustain pedal (CC64) down */
  private pedal = new Set<number>()
  /** MIDI note-offs the pedal is holding back, by noteKey, flushed when the pedal comes up */
  private sustained = new Map<number, NoteEvent>()

  /** Queue a note. A MIDI key released under the sustain pedal keeps sounding until the pedal is up. */
  push(ev: NoteEvent) {
    if (ev.source === 'midi') {
      const k = noteKey(ev)
      if (ev.kind === 'off' && this.pedal.has(ev.channel)) {
        this.sustained.set(k, ev)
        return
      }
      // re-strike under the pedal: end the ringing note first, so every consumer sees off → on
      const ringing = ev.kind === 'on' ? this.sustained.get(k) : undefined
      if (ringing) {
        this.sustained.delete(k)
        this.pending.push({ ...ringing, time: ev.time })
      }
    }
    this.pending.push(ev)
  }

  setCC(n: number, v: number) {
    this.state.cc[n] = v
  }

  setPitchBend(v: number) {
    this.state.pitchBend = v
  }

  /** A MIDI control change on `channel`: sustain pedal, all-notes-off / all-sound-off, reset. */
  controlChange(channel: number, n: number, v: number) {
    this.state.cc[n] = v
    if (n === 64) {
      if (v >= 0.5) this.pedal.add(channel)
      else this.pedalUp(channel)
    } else if (n === 120 || n === 123) {
      // a DAW sends these on stop: nothing may keep growing, pedal or not
      this.pedal.delete(channel)
      this.releaseWhere((n) => n.source === 'midi' && n.channel === channel)
      for (const [k, ev] of this.sustained) if (ev.channel === channel) this.sustained.delete(k)
    } else if (n === 121) {
      this.pedalUp(channel)
      this.state.pitchBend = 0
      this.state.cc[1] = 0
    }
  }

  private pedalUp(channel: number) {
    if (!this.pedal.delete(channel)) return
    for (const [k, ev] of this.sustained) {
      if (ev.channel !== channel) continue
      this.sustained.delete(k)
      this.pending.push({ ...ev, time: this.now() })
    }
  }

  /** End one MIDI note now, pedal or not (its device went away). */
  forceOff(channel: number, pitch: number) {
    this.releaseWhere((n) => n.source === 'midi' && n.channel === channel && n.pitch === pitch)
  }

  /** MIDI clock (0xF8) at `t` seconds, and the transport messages. */
  clockTick(t = this.now()) {
    this.beat.clockTick(t)
  }

  clockStart() {
    this.beat.clockStart()
  }

  clockContinue() {
    this.beat.clockContinue()
  }

  clockStop() {
    this.beat.clockStop()
  }

  songPosition(sixteenths: number) {
    this.beat.songPosition(sixteenths)
  }

  now() {
    return performance.now() / 1000
  }

  /** Release every held note (input switch / panic), sustain pedal included. */
  allOff() {
    this.pedal.clear()
    this.releaseWhere(() => true)
    this.sustained.clear()
  }

  /** Notes held at this moment: the held map with the queued events applied (pedal-held notes included). */
  private heldNow(): Map<number, ActiveNote> {
    const held = new Map(this.state.notes)
    for (const ev of this.pending) {
      const k = noteKey(ev)
      if (ev.kind === 'on') held.set(k, { pitch: ev.pitch, velocity: ev.velocity, t0: ev.time, source: ev.source, channel: ev.channel, stem: ev.stem })
      else held.delete(k)
    }
    return held
  }

  private releaseWhere(pick: (n: ActiveNote) => boolean) {
    const t = this.now()
    for (const [k, n] of this.heldNow()) {
      if (!pick(n)) continue
      this.sustained.delete(k)
      this.pending.push({ kind: 'off', pitch: n.pitch, velocity: 0, time: t, channel: n.channel, source: n.source, stem: n.stem })
    }
  }

  tick(audio: AudioFeatures | null, audioOnset: number) {
    const s = this.state
    const t = this.now()
    const dt = Math.min(0.05, Math.max(0.001, t - this.lastT))
    this.lastT = t
    s.time = t
    s.dt = dt

    s.events = this.pending
    this.pending = []
    let onsetHit = 0
    for (const ev of s.events) {
      const k = noteKey(ev)
      if (ev.kind === 'on') {
        const n: ActiveNote = { pitch: ev.pitch, velocity: ev.velocity, t0: ev.time, source: ev.source, channel: ev.channel, stem: ev.stem }
        s.notes.set(k, n)
        s.active.set(ev.pitch, n)
        if (ev.regrow) continue // not a new attack: no onset, no tempo or density evidence
        onsetHit = Math.max(onsetHit, ev.velocity)
        this.recentPcs.push({ pc: pitchClass(ev.pitch), t })
        this.noteTimes.push(t)
      } else if (s.notes.delete(k)) {
        // the pitch stays held while another source or channel still holds it
        let still: ActiveNote | undefined
        for (const n of s.notes.values()) if (n.pitch === ev.pitch) still = n
        if (still) s.active.set(ev.pitch, still)
        else s.active.delete(ev.pitch)
      }
    }
    onsetHit = Math.max(onsetHit, audioOnset)

    // Density: notes in the last 2 s.
    while (this.noteTimes.length && t - this.noteTimes[0] > 2) this.noteTimes.shift()
    s.density = exp(s.density, this.noteTimes.length / 2, 4, dt)

    // Polyphony: distinct pitch classes hit in the last 1.5 s OR held right now.
    while (this.recentPcs.length && t - this.recentPcs[0].t > 1.5) this.recentPcs.shift()
    const pcs = new Set<number>()
    for (const r of this.recentPcs) pcs.add(r.pc)
    for (const n of s.active.values()) pcs.add(pitchClass(n.pitch))
    s.polyphony = Math.max(1, Math.min(8, pcs.size))

    // Register + MIDI-derived bands.
    let sum = 0
    let velSum = 0
    let b = 0
    let m = 0
    let tr = 0
    const midiChroma = new Float32Array(12)
    for (const n of s.active.values()) {
      const held = t - n.t0
      const env = n.velocity * Math.exp(-held * 0.35) // slow sustain decay so held chords breathe
      sum += n.pitch
      velSum += env
      midiChroma[pitchClass(n.pitch)] += env
      if (n.pitch < 48) b += env
      else if (n.pitch < 72) m += env
      else tr += env
    }
    const nActive = s.active.size
    const targetReg = nActive ? sum / nActive / 127 : 0.5
    s.register = exp(s.register, targetReg, 6, dt)

    if (audio) {
      s.energy = exp(s.energy, audio.energy, 12, dt)
      s.bass = exp(s.bass, audio.bass, 14, dt)
      s.mid = exp(s.mid, audio.mid, 14, dt)
      s.treble = exp(s.treble, audio.treble, 14, dt)
      s.chroma.set(audio.chroma)
    } else {
      s.energy = exp(s.energy, Math.min(1, velSum * 0.6), velSum > s.energy ? 30 : 4, dt)
      s.bass = exp(s.bass, Math.min(1, b), 12, dt)
      s.mid = exp(s.mid, Math.min(1, m), 12, dt)
      s.treble = exp(s.treble, Math.min(1, tr), 12, dt)
      let mx = 0
      for (let i = 0; i < 12; i++) mx = Math.max(mx, midiChroma[i])
      for (let i = 0; i < 12; i++) s.chroma[i] = exp(s.chroma[i], mx > 0 ? midiChroma[i] / mx : 0, 10, dt)
    }
    let best = -1
    let bestV = 0.15
    for (let i = 0; i < 12; i++) {
      if (s.chroma[i] > bestV) {
        bestV = s.chroma[i]
        best = i
      }
    }
    s.rootPc = best

    s.onset = Math.max(onsetHit, s.onset * Math.exp(-dt * 9))

    if (onsetHit > 0.35) this.beat.onset(t)
    this.beat.tick(t, dt)
    s.beat = this.beat.state
    this.arcs.feed(s, audio, t, dt)
    s.arc = this.arcs.state
  }
}
