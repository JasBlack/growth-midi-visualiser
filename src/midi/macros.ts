// Performance macros: five knobs (Reaction, Energy, Complexity, Motion, Chaos) that each move
// many controls at once. Data, maths and a small DOM-free runtime; the sliders live in
// simpleUi.ts and are ordinary registry widgets (m:<id>), so they are MIDI-learnable, saved
// and searchable like any other.
//
// Relative, never absolute: a control's value is its base (what a look, a preset or its own
// slider set) times every macro multiplier on it, plus every macro offset:
//   value = base × Π mul(x) + Σ add(x)
// Every curve is neutral at 0.5 (mul 1, add 0), so 0.5 is the look as authored, and a knob
// left turned keeps its meaning when the look changes under it (k3 U3). v0.19's macros wrote
// absolute values and drifted out of sync with the look.
//
// No target rebuilds anything: shell*, sp:*, species, env, shader, envShader, budget, quality,
// video*, nested and camMode stay out (a3: those rebuild meshes or shaders on every change).

import type { EngineControl } from './engine'
import { LOOK_BASE, LOOK_GLOBALS } from './looks'

export type MacroId = 'reaction' | 'energy' | 'complexity' | 'motion' | 'chaos'
export const MACRO_IDS: readonly MacroId[] = ['reaction', 'energy', 'complexity', 'motion', 'chaos']
/** a macro here leaves its controls as the look set them */
export const NEUTRAL = 0.5

/** macro position 0..1 → a multiplier (1 at 0.5) or an offset (0 at 0.5) */
export type Curve = (x: number) => number

/** lo at 0, 1 at 0.5, hi at 1, straight between */
const lin = (lo: number, hi: number): Curve => (x) => (x < 0.5 ? lo + (1 - lo) * 2 * x : 1 + (hi - 1) * (2 * x - 1))
/** 1/r at 0, 1 at 0.5, r at 1, in even ratios: for rates that span a wide range (v0.20's growth and detail curves) */
const geo = (r: number): Curve => (x) => Math.pow(r, 2 * x - 1)
/** nothing up to `from`, then up to `amount` at 1: lifts a control the look leaves at 0 */
const boost = (amount: number, from = NEUTRAL): Curve => (x) => (x <= from ? 0 : (amount * (x - from)) / (1 - from))

export interface MacroTarget {
  /** registry id: e:organism:<key> or g:<key> */
  id: string
  mul?: Curve
  add?: Curve
}

export interface MacroDef {
  id: MacroId
  label: string
  title: string
  targets: readonly MacroTarget[]
}

const o = (key: string) => `e:organism:${key}`

export const MACROS: readonly MacroDef[] = [
  {
    id: 'reaction',
    label: 'Reaction',
    title: 'calm ↔ show: how strongly everything answers the music — swell, breath, flash, camera kick and shake, ignition, conduction, song response and bloom',
    // `react` is the master over pulse / flash / kick / shake / speedReact: their own curves are
    // milder so the product lands where k1 put calm and show (pulse ≈ .15 / .8, flash ≈ .07 / .9)
    targets: [
      { id: o('react'), mul: lin(0.6, 1.25) },
      { id: o('pulse'), mul: lin(0.4, 1.07) },
      { id: o('flash'), mul: lin(0.2, 1.2) },
      { id: o('kick'), mul: lin(0, 1.2) },
      { id: o('shake'), mul: lin(0, 1.3) },
      { id: o('speedReact'), mul: lin(0.4, 1.3) },
      { id: o('lightReact'), mul: lin(0.35, 1) },
      { id: o('musicFocus'), mul: lin(0.5, 1.5) },
      { id: o('ignite'), mul: lin(0.3, 1.5) },
      { id: o('igniteRing'), mul: lin(0, 1.6) },
      { id: o('lunge'), mul: lin(0.4, 1.6) },
      { id: o('conduct'), mul: lin(0.25, 1.6) },
      { id: o('songResponse'), mul: lin(0.2, 2.4) },
      { id: o('materialReact'), mul: lin(0.3, 1.6) },
      { id: o('softReact'), mul: lin(0.4, 1.6) },
      // the music breath (times `react` in the engine): calm barely draws back, show withdraws to the roots
      { id: o('breath'), mul: lin(0.5, 1.3) },
      // the looks set bloom on (0.8): calm halves the glow, show adds half again; bloom switched off stays off
      { id: o('bloom'), mul: lin(0.5, 1.5) },
      { id: 'g:zoomReact', mul: lin(0.2, 1.6) },
    ],
  },
  {
    id: 'energy',
    label: 'Energy',
    title: 'how much the music grows: growth per note, speed, new segments per second, sustain, growths at once',
    // v0.20's "How much the music grows", same curves, so its saved position carries over
    targets: [
      { id: o('musicAmount'), mul: geo(3) },
      { id: o('speed'), mul: geo(Math.sqrt(3)) },
      { id: o('sustain'), mul: geo(3) },
      // new segments per second too: otherwise the cap stalls a chord however high this goes
      { id: o('fillRate'), mul: geo(3) },
      { id: o('maxLive'), mul: lin(0.5, 2) },
    ],
  },
  {
    id: 'complexity',
    label: 'Complexity',
    title: 'branching, node size, wiggle, shorter segments, fusing, finer surface patterns',
    // v0.20's "Branching detail" (branch, wiggle, length), same curves. Species stay the look's:
    // toggling them respawns every held growth.
    targets: [
      { id: o('branch'), mul: geo(2) },
      { id: o('wiggle'), mul: geo(2) },
      { id: o('length'), mul: geo(Math.SQRT1_2) },
      { id: o('nodes'), mul: lin(0.35, 1.6) },
      { id: o('join'), mul: lin(0.6, 1.4) },
      { id: o('materialScale'), mul: lin(0.7, 1.6) },
    ],
  },
  {
    id: 'motion',
    label: 'Motion',
    title: 'still ↔ moving: camera speed and following, director cuts, beat zoom; soft surfaces, animated materials and physics wind sway',
    targets: [
      // below 1.9 a framed camera stays "framed" in the camera menu (1 and up reads as gentle orbit)
      { id: o('orbit'), mul: lin(0, 1.9) },
      { id: o('camFollow'), mul: lin(0.3, 1.8) },
      // bars per shot: 8 at still, 2 at full (base 4)
      { id: o('dirBars'), mul: geo(0.5) },
      { id: 'g:beatZoom', mul: lin(0, 1.5), add: boost(0.3) },
      { id: o('softWave'), mul: lin(0.4, 1.5) },
      { id: o('softSpeed'), mul: lin(0.3, 1.8) },
      { id: o('softIdle'), mul: lin(0, 2.5) },
      { id: o('materialSpeed'), mul: lin(0.2, 1.9) },
      { id: o('wind'), mul: lin(0.3, 2) },
    ],
  },
  {
    id: 'chaos',
    label: 'Chaos',
    title: 'orderly ↔ feral: wild mutants, bursts and sway, looser cohesion, more jitter (never symmetry)',
    targets: [
      // the looks leave wild at 0: the offset brings it in, the multiplier takes a set one out at 0
      { id: o('wild'), mul: lin(0, 1.5), add: boost(0.9) },
      { id: o('cohesion'), mul: lin(1.8, 0.35) },
      { id: o('wiggle'), mul: lin(0.75, 1.4) },
    ],
  },
]

/** Every macro that moves a control, by control id (a control may answer to several). */
const BY_ID = new Map<string, { m: MacroId; t: MacroTarget }[]>()
for (const m of MACROS) for (const t of m.targets) BY_ID.set(t.id, [...(BY_ID.get(t.id) ?? []), { m: m.id, t }])

export const isMacroTarget = (id: string) => BY_ID.has(id)

export type MacroPositions = Record<MacroId, number>

export const neutralMacros = (): MacroPositions => ({ reaction: NEUTRAL, energy: NEUTRAL, complexity: NEUTRAL, motion: NEUTRAL, chaos: NEUTRAL })

function factors(id: string, at: Readonly<MacroPositions>) {
  let mul = 1
  let add = 0
  for (const { m, t } of BY_ID.get(id) ?? []) {
    if (t.mul) mul *= t.mul(at[m])
    if (t.add) add += t.add(at[m])
  }
  return { mul, add }
}

/** What the knobs at `at` make of a control whose base is `base` (unclamped). */
export function effective(id: string, base: number, at: Readonly<MacroPositions>): number {
  const f = factors(id, at)
  return base * f.mul + f.add
}

/** The base that gives `value` at `at`; null where a multiplier is 0 (every base gives the same value there). */
export function baseFrom(id: string, value: number, at: Readonly<MacroPositions>): number | null {
  const f = factors(id, at)
  return Math.abs(f.mul) < 1e-6 ? null : (value - f.add) / f.mul
}

const unit = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : undefined)

/** Saved positions from any version. v0.20 had growth and detail: Energy and Complexity take them over with the same curves. */
export function loadMacroPositions(stored: unknown): MacroPositions {
  const s = stored && typeof stored === 'object' ? (stored as Record<string, unknown>) : {}
  const out = neutralMacros()
  for (const id of MACRO_IDS) out[id] = unit(s[id]) ?? NEUTRAL
  out.energy = unit(s.energy) ?? unit(s.growth) ?? NEUTRAL
  out.complexity = unit(s.complexity) ?? unit(s.detail) ?? NEUTRAL
  return out
}

/** Saved bases, by registry id. v0.20 keyed them by Organism control key. */
export function loadMacroBases(stored: unknown): Record<string, number> {
  const s = stored && typeof stored === 'object' ? (stored as Record<string, unknown>) : {}
  const out: Record<string, number> = {}
  for (const [k, v] of Object.entries(s)) if (typeof v === 'number' && Number.isFinite(v)) out[k.includes(':') ? k : o(k)] = v
  return out
}

/** v0.20's macro sliders in a saved MIDI map: the macros that took them over. */
export const RENAMED_MACROS: Readonly<Record<string, string>> = { 'm:growth': 'm:energy', 'm:detail': 'm:complexity' }

export interface MacroHost {
  /** a registry control; undefined while its engine is not mounted */
  ctl(id: string): { readonly c: EngineControl } | undefined
  /** registry values the macros computed, at once (their bases must not be re-derived from them) */
  write(values: Record<string, number>): void
  save(): void
}

/** writes at most this often while a knob moves (a CC stream sends far more) */
const WRITE_EVERY = 1 / 30
/** seconds: the controls ease after a knob, so a jump on a 7-bit CC or a double-click glides */
const EASE = 0.06

/** A value as its control will hold it (range, whole steps). */
function held(c: EngineControl, v: number) {
  v = Math.min(c.max, Math.max(c.min, v))
  return c.step >= 1 ? Math.round(v) : v
}

/**
 * The macros at run time. `pos` and `bases` are the app settings' own objects (kept, never
 * replaced), so moving a knob or rebasing persists with the next save.
 */
export class MacroRig {
  /** where the controls are now: eases toward `pos` */
  private readonly applied: MacroPositions
  private lastWrite = 0

  constructor(
    private readonly host: MacroHost,
    readonly pos: MacroPositions,
    readonly bases: Record<string, number>,
  ) {
    this.applied = { ...pos }
  }

  /** A knob moved: the controls follow over the next frames (tick), not per MIDI message. */
  set(id: MacroId, v: number) {
    this.pos[id] = v
    this.host.save()
  }

  /** Per frame. Idle costs five comparisons; a moving knob writes only the controls whose value changed. */
  tick(now = performance.now() / 1000) {
    if (now - this.lastWrite < WRITE_EVERY) return
    let moving: MacroId[] | null = null
    for (const id of MACRO_IDS) if (this.applied[id] !== this.pos[id]) (moving ??= []).push(id)
    if (!moving) return
    const ids = this.targetsOf(moving)
    // a control seen for the first time: its base is what its value implies at the positions that
    // set it, so take it before they move on (after, a first knob move rescaled the control)
    for (const id of ids) this.baseOf(id)
    const k = 1 - Math.exp(-Math.min(0.1, now - this.lastWrite) / EASE)
    this.lastWrite = now
    for (const id of moving) {
      const d = this.pos[id] - this.applied[id]
      this.applied[id] = Math.abs(d) < 0.003 ? this.pos[id] : this.applied[id] + d * k
    }
    this.write(ids)
  }

  /** Every target from its base at the knobs' positions (an engine mounted: its saved values may predate a knob move). */
  applyAll() {
    Object.assign(this.applied, this.pos)
    this.write([...BY_ID.keys()])
  }

  /**
   * A look: the targets among `values` become bases, and `values` get what the knobs make of
   * them. The knobs stay where they are: a performer's hardware knob and the macro agree.
   */
  rebase(values: Record<string, number>) {
    // at the positions the controls hold now; a knob still easing carries on from there (tick)
    for (const [id, v] of Object.entries(values)) {
      if (!BY_ID.has(id)) continue
      this.bases[id] = v
      values[id] = effective(id, v, this.applied)
    }
    this.host.save()
  }

  /**
   * A preset: its knob positions and bases (a preset from before the macros has neither: its
   * values are bases at neutral, so it loads exactly as saved). `values` get the targets'
   * effective values, including targets the preset lacks whose control is mounted.
   */
  recall(pos: unknown, bases: unknown, values: Record<string, number>) {
    const at = pos ? loadMacroPositions(pos) : neutralMacros()
    const stored = loadMacroBases(bases)
    for (const id of BY_ID.keys()) {
      const has = id in values
      const b = stored[id] ?? (has ? baseFrom(id, values[id], at) : null) ?? this.baseOf(id)
      if (b === undefined) continue
      this.bases[id] = b
      if (has || this.host.ctl(id)) values[id] = effective(id, b, at)
    }
    Object.assign(this.pos, at)
    Object.assign(this.applied, at)
    this.host.save()
  }

  /** For a preset: knob positions and the targets' bases. */
  snapshot(): { macros: MacroPositions; macroBase: Record<string, number> } {
    const macroBase: Record<string, number> = {}
    for (const id of BY_ID.keys()) {
      const b = this.baseOf(id)
      if (b !== undefined) macroBase[id] = b
    }
    return { macros: { ...this.pos }, macroBase }
  }

  /** A target moved some other way (its own slider, MIDI, an action, a random mix): the macros now scale from there. */
  controlMoved(id: string, value: number) {
    if (!BY_ID.has(id)) return
    const b = baseFrom(id, value, this.applied)
    if (b === null) return // a knob at a zero multiplier: the value says nothing about the base
    this.bases[id] = b
    this.host.save()
  }

  private targetsOf(ids: MacroId[]): string[] {
    const out = new Set<string>()
    for (const m of MACROS) if (ids.includes(m.id)) for (const t of m.targets) out.add(t.id)
    return [...out]
  }

  /** The stored base, or (first sight of this control) the one its current value implies. */
  private baseOf(id: string): number | undefined {
    const b = this.bases[id]
    if (Number.isFinite(b)) return b
    const c = this.host.ctl(id)
    if (!c) return undefined
    const key = id.startsWith('g:') ? id.slice(2) : id.slice(o('').length)
    const found = baseFrom(id, c.c.value, this.applied) ?? (id.startsWith('g:') ? LOOK_GLOBALS[key] : LOOK_BASE[key]) ?? c.c.value
    this.bases[id] = found
    return found
  }

  private write(ids: string[]) {
    const out: Record<string, number> = {}
    for (const id of ids) {
      const c = this.host.ctl(id)
      const b = c && this.baseOf(id)
      if (!c || b === undefined) continue
      const v = held(c.c, effective(id, b, this.applied))
      if (Math.abs(v - c.c.value) > 1e-6 * (c.c.max - c.c.min)) out[id] = v
    }
    if (Object.keys(out).length) this.host.write(out)
  }
}
