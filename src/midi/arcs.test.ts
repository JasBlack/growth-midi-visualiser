import { describe, expect, it } from 'vitest'
import { ArcTracker, type ArcState } from './arcs'
import { createMusicState, type AudioFeatures } from './music'

const C_MAJOR = [1, 0, 0.3, 0, 0.8, 0, 0, 0.9, 0, 0.2, 0, 0]

/**
 * A song as loudness over time: 4 s quiet intro, a 12 s build, the drop at 16 s, 8 s of full
 * energy, a 10 s breakdown from 24 s, then the music comes back at 34 s.
 */
function song(t: number): number {
  if (t < 4) return 0.15
  if (t < 16) return 0.15 + ((t - 4) / 12) * 0.4
  if (t < 24) return 0.95
  if (t < 34) return 0.12
  return 0.9
}

/** Drive a tracker frame by frame at `fps` (integer frame clock, like the app); `probe` sees every frame. */
function play(fps: number, seconds: number, loud: (t: number) => number, probe?: (t: number, s: ArcState) => void) {
  const arc = new ArcTracker()
  const frames = Math.round(seconds * fps)
  for (let f = 1; f <= frames; f++) {
    const t = f / fps
    arc.step(loud(t), C_MAJOR, t, 1 / fps)
    probe?.(t, arc.state)
  }
  return arc
}

describe('ArcTracker', () => {
  it('silence stays flat: no tension, drop, breakdown or section', () => {
    const a = play(60, 30, () => 0).state
    expect(a).toMatchObject({ tension: 0, drop: 0, drops: 0, breakdown: 0, section: 0 })
  })

  it('a steady build raises tension; a plateau does not', () => {
    let atDrop = 0
    play(60, 15.9, song, (t, s) => {
      if (t < 15.9) atDrop = s.tension
    })
    expect(atDrop).toBeGreaterThan(0.6)
    const plateau = play(60, 30, () => 0.6).state
    expect(plateau.tension).toBeLessThan(0.05)
  })

  it('detects the drop within 0.25 s and releases the tension', () => {
    let dropAt = -1
    let tensionAfter = 1
    play(60, 20, song, (t, s) => {
      if (dropAt < 0 && s.drops > 0) dropAt = t
      if (t <= 17.5) tensionAfter = s.tension
    })
    expect(dropAt).toBeGreaterThanOrEqual(16)
    expect(dropAt - 16).toBeLessThanOrEqual(0.25)
    expect(tensionAfter).toBeLessThan(0.15)
  })

  it('the first notes after silence are an entrance, not a drop', () => {
    const a = play(60, 20, (t) => (t < 5 ? 0 : 0.9)).state
    expect(a.drops).toBe(0)
  })

  it('a breakdown needs sustained low energy after a loud passage (a one-bar gap is not one)', () => {
    let peak = 0
    play(60, 30, (t) => (t >= 20 && t < 21.5 ? 0.1 : 0.85), (_t, s) => (peak = Math.max(peak, s.breakdown)))
    expect(peak).toBeLessThan(0.05)

    let at2 = 0
    let at6 = 0
    const a = play(60, 26, (t) => (t < 20 ? 0.85 : 0.1), (t, s) => {
      if (t <= 22) at2 = s.breakdown
      if (t <= 26) at6 = s.breakdown
    }).state
    expect(at2).toBeLessThan(0.05)
    expect(at6).toBeGreaterThan(0.8)
    expect(a.section).toBe(1)
  })

  it('reads the same arc at 24, 60 and 144 fps', () => {
    const grid = (fps: number) => {
      const rows: number[][] = []
      play(fps, 40, song, (t, s) => {
        // at 0.25, 0.75, 1.25 … s: a frame boundary at all three rates, and never the frame a step in
        // the song lands on (where the rates legitimately differ by up to one frame)
        const q = t * 4
        if (Math.abs(q - Math.round(q)) < 1e-9 && Math.round(q) % 2 === 1) rows.push([s.tension, s.breakdown, s.short, s.long, s.drops, s.section])
      })
      return rows
    }
    const ref = grid(60)
    expect(ref.length).toBe(80)
    for (const fps of [24, 144]) {
      const rows = grid(fps)
      expect(rows.length).toBe(ref.length)
      rows.forEach((r, i) => {
        // tension, breakdown, short, long: one frame of timing at 24 fps is worth at most ~0.05
        for (let k = 0; k < 4; k++) expect(Math.abs(r[k] - ref[i][k])).toBeLessThan(0.06)
        expect(r[4]).toBe(ref[i][4]) // drops
        expect(r[5]).toBe(ref[i][5]) // sections
      })
    }
    // and the song reads as a song: the drop, the breakdown, and the comeback after it (a big rise
    // after a quiet stretch is a drop too), each a new section
    expect(ref[ref.length - 1][4]).toBe(2)
    expect(ref[ref.length - 1][5]).toBe(3)
  })

  describe('loudness', () => {
    it('MIDI: held-note energy with note activity; no input is silence', () => {
      const arc = new ArcTracker()
      const s = createMusicState()
      expect(arc.loudness(s, null, 1 / 60)).toBe(0)
      s.energy = 0.5
      expect(arc.loudness(s, null, 1 / 60)).toBeCloseTo(0.275)
      s.density = 8
      expect(arc.loudness(s, null, 1 / 60)).toBeGreaterThan(0.275)
    })

    it('audio: a full-scale signal reads loud, a -60 dBFS room never does, however long it lasts', () => {
      const s = createMusicState()
      const audio = (level: number): AudioFeatures => ({ energy: 1, bass: 0, mid: 0, treble: 0, chroma: new Float32Array(12), level })
      expect(new ArcTracker().loudness(s, audio(1), 1 / 60)).toBeCloseTo(0.75)
      const arc = new ArcTracker()
      let v = 1
      for (let i = 0; i < 60 * 300; i++) v = arc.loudness(s, audio(0.001), 1 / 60)
      expect(v).toBeLessThan(0.05)
      // gated silence: only note activity counts
      expect(arc.loudness(s, audio(0), 1 / 60)).toBe(0)
    })
  })
})
