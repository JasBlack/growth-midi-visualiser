// The on-screen keyboard under the stage: the tool is playable with a finger or a mouse, no
// hardware (phones above all). It plays through the same clock as the computer-keyboard piano
// (source 'keys', so the instrument sounds it too) on its own channel, so a pitch held on screen
// and on the computer keyboard are two notes. It starts at the computer piano's octave (Z / X move
// both), fits as many white keys as the width allows, slides between keys (glissando), takes
// several fingers at once and lights every key held by any source (MIDI, keyboard, the screen).

import type { MusicClock } from '../music'
import type { KeyboardPiano } from '../inputMidi'

/** channel for the screen's notes (the computer keyboard plays on 0) */
const CHANNEL = 1
/** a white key at least this wide (px), and the range it may span */
const MIN_WHITE = 30
const WHITES_MIN = 7
const WHITES_MAX = 22
/** semitones within an octave that are white keys */
const WHITE_SEMIS = [0, 2, 4, 5, 7, 9, 11]
const NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B']

export class PianoKeys {
  /** pointer id → the pitch it holds */
  private down = new Map<number, number>()
  private keys = new Map<number, HTMLElement>()
  private lit = new Set<number>()
  private octave = -1
  private whites = 0

  constructor(
    private host: HTMLElement,
    private clock: MusicClock,
    private piano: KeyboardPiano,
  ) {
    host.addEventListener('pointerdown', this.onDown)
    host.addEventListener('pointermove', this.onMove)
    host.addEventListener('pointerup', this.onUp)
    host.addEventListener('pointercancel', this.onUp)
    host.addEventListener('lostpointercapture', this.onUp)
    host.addEventListener('contextmenu', (e) => e.preventDefault()) // a long press is a held note, not a menu
    window.addEventListener('blur', this.releaseAll)
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.releaseAll()
    })
    new ResizeObserver(() => this.layout()).observe(host)
    this.layout()
  }

  /** Octave down / up, shared with the computer keyboard's Z / X. */
  shift(by: number) {
    this.releaseAll()
    this.piano.octave = Math.min(7, Math.max(1, this.piano.octave + by))
    this.layout(true)
  }

  /** Each frame: follow a Z / X octave change and light the keys held by any source. */
  update(held: Iterable<number>) {
    if (this.piano.octave !== this.octave) this.layout(true)
    const now = new Set(held)
    for (const p of this.lit) if (!now.has(p)) this.keys.get(p)?.classList.remove('on')
    for (const p of now) if (!this.lit.has(p)) this.keys.get(p)?.classList.add('on')
    this.lit = now
  }

  releaseAll = () => {
    for (const pitch of new Set(this.down.values())) this.off(pitch)
    this.down.clear()
  }

  private layout(force = false) {
    const w = this.host.clientWidth
    if (!w) return
    const whites = Math.min(WHITES_MAX, Math.max(WHITES_MIN, Math.floor(w / MIN_WHITE)))
    if (!force && whites === this.whites && this.octave === this.piano.octave) return
    this.releaseAll()
    this.whites = whites
    this.octave = this.piano.octave
    const base = 12 * (this.octave + 1)
    this.host.textContent = ''
    this.keys.clear()
    this.lit.clear()
    const pct = 100 / whites
    for (let i = 0; i < whites; i++) {
      const pitch = base + 12 * Math.floor(i / 7) + WHITE_SEMIS[i % 7]
      const k = this.key(pitch, 'w')
      if (pitch % 12 === 0) k.dataset.c = `C${pitch / 12 - 1}`
      this.host.appendChild(k)
      // a black key on the boundary to the next white key (none after E and B)
      const semi = pitch % 12
      if (i < whites - 1 && semi !== 4 && semi !== 11) {
        const b = this.key(pitch + 1, 'b')
        b.style.left = `${(i + 1) * pct}%`
        b.style.width = `${pct * 0.62}%`
        this.host.appendChild(b)
      }
    }
  }

  private key(pitch: number, kind: 'w' | 'b') {
    const k = document.createElement('span')
    k.className = `pk ${kind}`
    k.dataset.p = String(pitch)
    k.setAttribute('aria-label', `${NAMES[pitch % 12]}${Math.floor(pitch / 12) - 1}`)
    this.keys.set(pitch, k)
    return k
  }

  /** the key under a point and how far down it the point is (lower on the key = louder) */
  private hit(x: number, y: number): { pitch: number; velocity: number } | null {
    const el = document.elementFromPoint(x, y)
    const k = el instanceof HTMLElement ? el.closest<HTMLElement>('.pk') : null
    if (!k || !this.host.contains(k)) return null
    const r = k.getBoundingClientRect()
    const depth = r.height > 0 ? Math.min(1, Math.max(0, (y - r.top) / r.height)) : 0.5
    return { pitch: Number(k.dataset.p), velocity: 0.45 + 0.55 * depth }
  }

  private onDown = (e: PointerEvent) => {
    if (e.button !== 0) return
    const h = this.hit(e.clientX, e.clientY)
    if (!h) return
    e.preventDefault()
    this.host.setPointerCapture(e.pointerId)
    this.down.set(e.pointerId, h.pitch)
    this.on(h.pitch, h.velocity)
  }

  private onMove = (e: PointerEvent) => {
    const was = this.down.get(e.pointerId)
    if (was === undefined) return
    const h = this.hit(e.clientX, e.clientY)
    if (!h || h.pitch === was) return
    this.down.set(e.pointerId, h.pitch)
    this.release(was)
    this.on(h.pitch, h.velocity)
  }

  private onUp = (e: PointerEvent) => {
    const was = this.down.get(e.pointerId)
    if (was === undefined) return
    this.down.delete(e.pointerId)
    this.release(was)
  }

  /** one note per pitch however many fingers hold it: sounds with the first, ends with the last */
  private on(pitch: number, velocity: number) {
    if (this.countHolding(pitch) > 1) return
    this.clock.push({ kind: 'on', pitch, velocity, time: this.clock.now(), channel: CHANNEL, source: 'keys' })
  }

  private release(pitch: number) {
    if (this.countHolding(pitch) === 0) this.off(pitch)
  }

  private off(pitch: number) {
    this.clock.push({ kind: 'off', pitch, velocity: 0, time: this.clock.now(), channel: CHANNEL, source: 'keys' })
  }

  private countHolding(pitch: number) {
    let n = 0
    for (const p of this.down.values()) if (p === pitch) n++
    return n
  }
}
