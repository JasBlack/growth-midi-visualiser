// Web MIDI input → NoteEvents, plus a computer-keyboard piano so the tool is
// playable with no hardware (rows a-k = white keys, w-u = black, z/x octave).

import type { MusicClock } from './music'
import { classifyTarget } from './keys'

export interface MidiDevice {
  id: string
  name: string
}

export class MidiInput {
  private access: MIDIAccess | null = null
  private bound = new Map<string, MIDIInput>()
  /** per input: notes it has down (pitch by channel·128 + pitch) and channels where it holds the pedal */
  private held = new Map<string, Map<number, { channel: number; pitch: number }>>()
  private pedals = new Map<string, Set<number>>()
  selectedId: string = 'all'
  onDevices: (devs: MidiDevice[]) => void = () => {}
  onStatus: (s: string) => void = () => {}
  onCC: (cc: number, value: number) => void = () => {}
  onProgram: (program: number) => void = () => {}

  constructor(private clock: MusicClock) {}

  get supported() {
    return typeof navigator !== 'undefined' && 'requestMIDIAccess' in navigator
  }

  async start() {
    if (!this.supported) {
      this.onStatus('Web MIDI not supported in this browser (use Chrome / Edge)')
      return
    }
    try {
      this.access = await navigator.requestMIDIAccess({ sysex: false })
    } catch (e) {
      this.onStatus(`MIDI access denied: ${(e as Error).message}`)
      return
    }
    this.access.onstatechange = () => this.rebind()
    this.rebind()
  }

  select(id: string) {
    this.selectedId = id
    this.rebind()
  }

  devices(): MidiDevice[] {
    if (!this.access) return []
    return [...this.access.inputs.values()].filter((i) => i.state !== 'disconnected').map((i) => ({ id: i.id, name: i.name ?? i.id }))
  }

  private rebind() {
    if (!this.access) return
    for (const inp of this.bound.values()) inp.onmidimessage = null
    const was = [...this.bound.keys()]
    this.bound.clear()
    const devs = this.devices()
    this.onDevices(devs)
    for (const inp of this.access.inputs.values()) {
      if (inp.state === 'disconnected') continue
      if (this.selectedId !== 'all' && inp.id !== this.selectedId) continue
      const id = inp.id
      inp.onmidimessage = (e) => this.handle(e, id)
      this.bound.set(id, inp)
    }
    // unplugged or deselected mid-chord: its keys will never send note-off, so end them here
    for (const id of was) if (!this.bound.has(id)) this.releaseInput(id)
    this.onStatus(
      devs.length === 0
        ? 'no MIDI inputs found — plug one in (hot-plug works) or use the keyboard'
        : `listening on ${this.bound.size} of ${devs.length} MIDI input${devs.length > 1 ? 's' : ''}`,
    )
  }

  /** End everything this input was holding: pedal, notes, and the bend / mod wheel it may have left moved. */
  private releaseInput(id: string) {
    for (const ch of this.pedals.get(id) ?? []) this.clock.controlChange(ch, 64, 0)
    for (const n of this.held.get(id)?.values() ?? []) this.clock.forceOff(n.channel, n.pitch)
    this.pedals.delete(id)
    this.held.delete(id)
    this.clock.setPitchBend(0)
    this.clock.setCC(1, 0)
  }

  private handle(e: MIDIMessageEvent, id: string) {
    const d = e.data
    if (!d || d.length < 1) return
    // system realtime / common. The event's own timestamp keeps main-thread delay out of the tempo.
    if (d[0] === 0xf8) {
      const now = this.clock.now()
      const ts = e.timeStamp / 1000
      return this.clock.clockTick(ts > 0 && Math.abs(ts - now) < 1 ? ts : now)
    }
    if (d[0] === 0xfa) return this.clock.clockStart()
    if (d[0] === 0xfb) return this.clock.clockContinue()
    if (d[0] === 0xfc) return this.clock.clockStop()
    if (d[0] === 0xf2) return d.length >= 3 ? this.clock.songPosition((d[2] << 7) | d[1]) : undefined
    if (d.length < 2 || d[0] >= 0xf0) return
    const status = d[0] & 0xf0
    const ch = d[0] & 0x0f
    const t = this.clock.now()
    const k = ch * 128 + d[1]
    if (status === 0x90 && d[2] > 0) {
      let held = this.held.get(id)
      if (!held) this.held.set(id, (held = new Map()))
      held.set(k, { channel: ch, pitch: d[1] })
      this.clock.push({ kind: 'on', pitch: d[1], velocity: d[2] / 127, time: t, channel: ch, source: 'midi' })
    } else if (status === 0x80 || status === 0x90) {
      // note-off, or note-on with velocity 0 (running-status keyboards send that)
      this.held.get(id)?.delete(k)
      this.clock.push({ kind: 'off', pitch: d[1], velocity: 0, time: t, channel: ch, source: 'midi' })
    } else if (status === 0xc0) {
      this.onProgram(d[1])
    } else if (status === 0xb0) {
      if (d[1] === 64) {
        let ped = this.pedals.get(id)
        if (!ped) this.pedals.set(id, (ped = new Set()))
        if (d[2] >= 64) ped.add(ch)
        else ped.delete(ch)
      } else if (d[1] === 120 || d[1] === 123) {
        for (const [key, n] of this.held.get(id) ?? []) if (n.channel === ch) this.held.get(id)?.delete(key)
        this.pedals.get(id)?.delete(ch)
      }
      this.clock.controlChange(ch, d[1], d[2] / 127)
      this.onCC(d[1], d[2] / 127)
    } else if (status === 0xe0) {
      const v = ((d[2] << 7) | d[1]) - 8192
      this.clock.setPitchBend(v / 8192)
    }
  }

  stop() {
    for (const inp of this.bound.values()) inp.onmidimessage = null
    for (const id of this.bound.keys()) this.releaseInput(id)
    this.bound.clear()
    if (this.access) this.access.onstatechange = null
    this.access = null
  }
}

const KEY_ROW = 'awsedftgyhujkolp;'
// semitone offsets for the row above (a = C, w = C#, s = D, ...)
const KEY_SEMIS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]

export class KeyboardPiano {
  octave = 4
  /** held notes by physical key (e.code), so a Shift change mid-hold (; → :) still releases */
  private down = new Map<string, number>()
  enabled = true

  constructor(private clock: MusicClock) {
    window.addEventListener('keyup', this.onUp)
    // a key released while the page is not looking never sends its keyup
    window.addEventListener('blur', this.releaseAll)
    window.addEventListener('pagehide', this.releaseAll)
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.releaseAll()
    })
  }

  /**
   * Called first by the global key handler (after its focus policy), so a
   * piano letter never also fires a shortcut. true = the key is the piano's.
   * Only text entry blocks it: a focused slider, checkbox or button does not.
   */
  handleKeyDown(e: KeyboardEvent): boolean {
    if (!this.enabled || classifyTarget(e.target) === 'text' || e.ctrlKey || e.metaKey || e.altKey) return false
    const k = e.key.toLowerCase()
    if (k === 'z' || k === 'x') {
      if (!e.repeat) this.octave = k === 'z' ? Math.max(1, this.octave - 1) : Math.min(7, this.octave + 1)
      e.preventDefault()
      return true
    }
    const i = KEY_ROW.indexOf(k)
    if (i < 0) return false
    const id = e.code || k
    if (!e.repeat && !this.down.has(id)) {
      const pitch = 12 * (this.octave + 1) + KEY_SEMIS[i]
      this.down.set(id, pitch)
      this.clock.push({ kind: 'on', pitch, velocity: e.shiftKey ? 1 : 0.75, time: this.clock.now(), channel: 0, source: 'keys' })
    }
    e.preventDefault()
    return true
  }

  private onUp = (e: KeyboardEvent) => {
    const id = e.code || e.key.toLowerCase()
    const pitch = this.down.get(id)
    if (pitch === undefined) return
    this.down.delete(id)
    this.clock.push({ kind: 'off', pitch, velocity: 0, time: this.clock.now(), channel: 0, source: 'keys' })
  }

  releaseAll = () => {
    for (const pitch of this.down.values()) this.clock.push({ kind: 'off', pitch, velocity: 0, time: this.clock.now(), channel: 0, source: 'keys' })
    this.down.clear()
  }
}
