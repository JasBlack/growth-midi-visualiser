// Energy arcs (k1 Idea 8): where the music is heading over bars, not only how loud it is now.
// One loudness for every input (audio: its level against the track's recent peak plus onset
// activity; MIDI: note density × velocity plus the held notes), a few envelopes of it, and from
// those a build-up's tension, drops, breakdowns and harmonic section changes.
// Time-based: every smoother is exp(−dt/τ) and the history is sampled on a fixed 0.25 s grid, so
// any frame rate reads the same arc. O(1) a frame plus a 64-sample scan four times a second.

import type { AudioFeatures, MusicState } from './music'

export interface ArcState {
  /** the arcs' own loudness 0..1 (see ArcTracker.loudness) */
  energy: number
  /** envelopes of `energy`: short (τ 0.6 s) and long (τ 12 s) */
  short: number
  long: number
  /** 0..1: the energy has climbed steadily over the last bars (a build-up); released by a drop */
  tension: number
  /** impulse: jumps to 0.4..1 on a drop (a big rise after a build or a quiet stretch), decays in about a second */
  drop: number
  /** drops so far: a consumer compares it to act on each drop once */
  drops: number
  /** 0..1, eased: sustained low energy after a loud passage (or silence after music) */
  breakdown: number
  /** 0..1: how different the harmony of the last 4 s is from the 4 s before */
  novelty: number
  /** +1 on a drop, a breakdown's start or a harmonic section change */
  section: number
  /** seconds since `section` last changed */
  sinceSection: number
}

export function createArcState(): ArcState {
  return { energy: 0, short: 0, long: 0, tension: 0, drop: 0, drops: 0, breakdown: 0, novelty: 0, section: 0, sinceSection: 0 }
}

/** history grid (s) and length (16 s) */
const STEP = 0.25
const HIST = 64
/** tension compares four 2 s windows of the short envelope */
const WIN = 8
/** harmony: two 4 s windows of chroma */
const CWIN = 16
/**
 * audio: the level's reference peak starts at a mastered track's loud RMS (a quiet intro must not
 * read as full before anything louder came), falls this fast (dB/s) and never below FLOOR_DB, so a
 * quiet room is never normalised up to loud
 */
const START_DB = -16
const PEAK_FALL = 0.25
const FLOOR_DB = -40
/** a drop needs this rise of the fast envelope over the lowest short envelope of the last 1.5 s (less straight after a build) */
const DROP_JUMP = 0.25
const DROP_JUMP_BUILT = 0.18
const DROP_GAP = 6
/** after a drop, tension waits until its windows hold only post-drop music (the build + drop would read as one climb) */
const RELEASE = WIN * 4 * STEP
const BREAK_AFTER = 2.5
/** "loud lately" holds this long (s) after the loudest moment, then fades with REF_TAU: a 16-bar breakdown is still measured against the drop */
const REF_HOLD = 20
const REF_TAU = 40
const SECTION_GAP = 16

const clamp01 = (x: number) => Math.min(1, Math.max(0, x))
const ease = (cur: number, target: number, tau: number, dt: number) => cur + (target - cur) * (1 - Math.exp(-dt / tau))

export class ArcTracker {
  readonly state = createArcState()
  private vel = 0.6
  private peakDb = START_DB
  private eF = 0
  private eS = 0
  private eM = 0
  private eL = 0
  /** held, then slowly falling peak of the medium envelope: what "loud" means in this track lately */
  private ref = 0
  private refHold = 0
  private tensionT = 0
  /** recent tension, held a few seconds: a drop needs a build (or a dip) just before it */
  private tensionHold = 0
  private releaseUntil = -1e9
  private dropT = -1e9
  private breakOn = false
  private lowFor = 0
  private sectionT = 0
  private acc = 0
  private n = 0
  private readonly histS = new Float32Array(HIST)
  private readonly histM = new Float32Array(HIST)
  private readonly chroma = new Float32Array(HIST * 12)

  /**
   * The arcs' loudness 0..1. Audio: the raw level in dB against a slowly falling peak (the
   * input's own normaliser forgets a loud passage within seconds, which would erase every
   * breakdown and drop) blended with an absolute dBFS scale, plus onset activity. MIDI: notes
   * per second weighted by how hard they are played, plus the held notes' energy.
   */
  loudness(s: MusicState, audio: AudioFeatures | null, dt: number): number {
    for (const ev of s.events) if (ev.kind === 'on' && !ev.regrow) this.vel += (ev.velocity - this.vel) * 0.2
    const act = 1 - Math.exp((-s.density * (0.4 + 0.6 * this.vel)) / 5)
    if (!audio) return clamp01(0.55 * s.energy + 0.55 * act)
    const lv = audio.level
    if (lv === undefined) return clamp01(0.65 * s.energy + 0.35 * act)
    if (lv <= 0) return 0.25 * act
    const db = 20 * Math.log10(lv)
    this.peakDb = Math.max(db, this.peakDb - dt * PEAK_FALL, FLOOR_DB)
    const rel = clamp01(1 + (db - this.peakDb) / 20)
    const abs = clamp01((db + 42) / 32)
    return clamp01(0.75 * (0.65 * rel + 0.35 * abs) + 0.25 * act)
  }

  /** One frame from the music state (MusicClock.tick calls it last). */
  feed(s: MusicState, audio: AudioFeatures | null, t: number, dt: number) {
    this.step(this.loudness(s, audio, dt), s.chroma, t, dt)
  }

  /** Advance by dt with loudness e (0..1) and a 12-bin chroma. Separate from feed so a test can drive it. */
  step(e: number, chroma: ArrayLike<number>, t: number, dt: number) {
    const a = this.state
    this.eF = ease(this.eF, e, 0.12, dt)
    this.eS = ease(this.eS, e, 0.6, dt)
    this.eM = ease(this.eM, e, 2, dt)
    this.eL = ease(this.eL, e, 12, dt)
    if (this.eM >= this.ref) {
      this.ref = this.eM
      this.refHold = REF_HOLD
    } else if ((this.refHold -= dt) < 0) this.ref *= Math.exp(-dt / REF_TAU)
    this.acc += dt
    if (this.acc >= STEP) {
      this.acc -= STEP
      this.sample(chroma, t)
    }

    // tension: rises with a build, eases off on a plateau, and a drop releases it at once
    const target = t < this.releaseUntil ? 0 : this.tensionT
    a.tension = ease(a.tension, target, target > a.tension ? 1 : t < this.releaseUntil ? 0.2 : 2, dt)
    this.tensionHold = Math.max(a.tension, this.tensionHold * Math.exp(-dt / 2.5))

    // drop: the fast envelope leaps well above where the short one sat a moment ago, to near the
    // track's loudest, right after a build or a quiet stretch
    let lowS = this.eS
    let lowM = this.eM
    for (let k = 1; k <= 16 && k <= this.n; k++) {
      const i = (this.n - k) % HIST
      if (k <= 6) lowS = Math.min(lowS, this.histS[i])
      lowM = Math.min(lowM, this.histM[i])
    }
    const jump = this.eF - lowS
    const built = this.tensionHold > 0.3
    // a dip inside the music (it has been going a while): the first notes after silence are an entrance, not a drop
    const dipped = this.eL > 0.25 && lowM < 0.6 * this.ref
    a.drop *= Math.exp(-dt / 0.6)
    if (jump > (built ? DROP_JUMP_BUILT : DROP_JUMP) && this.eF > 0.45 && this.eF > 0.7 * this.ref && (built || dipped) && t - this.dropT > DROP_GAP) {
      this.dropT = t
      a.drop = Math.max(a.drop, clamp01(0.4 + 1.5 * jump))
      a.drops++
      this.releaseUntil = t + RELEASE
      this.tensionHold = 0
      this.breakOn = false
      this.lowFor = 0
      this.newSection(t)
    }

    // breakdown: well under the recent loud level for a few seconds (a one-bar gap is not one)
    const loudBefore = this.ref > 0.3
    if (loudBefore && this.eS < 0.5 * this.ref) this.lowFor += dt
    else this.lowFor = 0
    if (!this.breakOn && this.lowFor > BREAK_AFTER) {
      this.breakOn = true
      this.newSection(t)
    } else if (this.breakOn && (this.eM > 0.7 * this.ref || !loudBefore)) this.breakOn = false
    a.breakdown = ease(a.breakdown, this.breakOn ? 1 : 0, this.breakOn ? 1.5 : 0.5, dt)

    a.energy = e
    a.short = this.eS
    a.long = this.eL
    a.sinceSection = t - this.sectionT
  }

  private newSection(t: number) {
    this.state.section++
    this.sectionT = t
  }

  /** Every STEP: history, tension's target, harmonic novelty (once a second). */
  private sample(chroma: ArrayLike<number>, t: number) {
    const i = this.n % HIST
    this.histS[i] = this.eS
    this.histM[i] = this.eM
    const c = this.chroma
    for (let k = 0; k < 12; k++) c[i * 12 + k] = chroma[k] ?? 0
    this.n++

    // tension: four consecutive 2 s windows each louder than the one before, by similar steps. A
    // jump lands in one or two windows, so it never reads as a build; a steady climb over ~6 s does.
    if (this.n >= WIN * 4) {
      const w = [0, 0, 0, 0]
      for (let k = 0; k < WIN * 4; k++) w[(k / WIN) | 0] += this.histS[(this.n - 1 - k) % HIST] / WIN
      const d0 = w[0] - w[1]
      const d1 = w[1] - w[2]
      const d2 = w[2] - w[3]
      const minD = Math.min(d0, d1, d2)
      const even = minD / Math.max(1e-3, d0, d1, d2)
      this.tensionT = this.eM > 0.08 ? clamp01((w[0] - w[3]) / 0.25) * clamp01(minD / 0.015) * clamp01((even - 0.1) / 0.3) : 0
    }

    // novelty: cosine distance between the mean chroma of the last 4 s and of the 4 s before
    if (this.n % 4 === 0 && this.n >= CWIN * 2) {
      let dot = 0
      let na = 0
      let nb = 0
      for (let k = 0; k < 12; k++) {
        let x = 0
        let y = 0
        for (let j = 0; j < CWIN; j++) {
          x += c[((this.n - 1 - j) % HIST) * 12 + k]
          y += c[((this.n - 1 - CWIN - j) % HIST) * 12 + k]
        }
        dot += x * y
        na += x * x
        nb += y * y
      }
      const nov = na > 1e-3 && nb > 1e-3 ? 1 - dot / Math.sqrt(na * nb) : 0
      this.state.novelty = nov
      if (nov > 0.4 && this.eM > 0.12 && t - this.sectionT > SECTION_GAP) this.newSection(t)
    }
  }
}
