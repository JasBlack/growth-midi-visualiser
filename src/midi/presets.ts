// Preset slots (8) persisted in localStorage, and a morph that eases numeric
// knobs from their current value to the preset's over a couple of seconds.
// Selects / toggles switch instantly (there is nothing between two species).

import { readStored, writeStored } from './storage'

export interface Preset {
  name: string
  palette: number
  globals: Record<string, number>
  engine: string
  /** effective values (what the controls held), so an older build still loads the slot */
  engineCtl: Record<string, number>
  /** macro knob positions (absent in slots saved before the macros: they load at neutral) */
  macros?: Record<string, number>
  /** macro target registry id → base (value with every knob at 0.5) */
  macroBase?: Record<string, number>
}

const KEY = 'midiviz_presets_v1'
export const SLOTS = 8

export function loadPresets(): (Preset | null)[] {
  const stored = readStored(KEY)
  const list = Array.isArray(stored) ? (stored as (Preset | null)[]) : []
  const out: (Preset | null)[] = []
  for (let i = 0; i < SLOTS; i++) out.push(list[i] ?? null)
  return out
}

/** false when browser storage refused the write (the slots then last for this session only). */
export function savePresets(list: (Preset | null)[]): boolean {
  return writeStored(KEY, list)
}

const ease = (u: number) => (u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2)

export class Morph {
  active = false
  private t0 = 0
  private dur = 2
  private from: Record<string, number> = {}
  private to: Record<string, number> = {}
  private apply: (key: string, v: number) => void = () => {}

  start(from: Record<string, number>, to: Record<string, number>, dur: number, apply: (key: string, v: number) => void) {
    this.from = { ...from }
    this.to = { ...to }
    this.dur = Math.max(0.01, dur)
    this.apply = apply
    this.t0 = performance.now() / 1000
    this.active = true
  }

  /** Stop easing one key (it was just set to something newer). */
  drop(key: string) {
    delete this.to[key]
  }

  tick() {
    if (!this.active) return
    const u = Math.min(1, (performance.now() / 1000 - this.t0) / this.dur)
    const e = ease(u)
    for (const k in this.to) {
      const a = this.from[k] ?? this.to[k]
      this.apply(k, a + (this.to[k] - a) * e)
    }
    if (u >= 1) this.active = false
  }
}
