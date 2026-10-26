import { describe, expect, it } from 'vitest'
import type { EngineControl } from './engine'
import { MACROS, MacroRig, NEUTRAL, baseFrom, effective, isMacroTarget, loadMacroBases, loadMacroPositions, neutralMacros, type MacroHost, type MacroPositions } from './macros'

const at = (p: Partial<MacroPositions>): MacroPositions => ({ ...neutralMacros(), ...p })
const ALL_IDS = [...new Set(MACROS.flatMap((m) => m.targets.map((t) => t.id)))]

describe('macro curves', () => {
  it('every knob at 0.5 leaves every control exactly as the look set it', () => {
    for (const id of ALL_IDS) for (const base of [0, 0.37, 1, 24]) expect(effective(id, base, neutralMacros()), id).toBe(base)
  })

  it('ends of a knob: multipliers, offsets, and controls answering to two knobs', () => {
    const kick = 'e:organism:kick'
    expect(effective(kick, 0.5, at({ reaction: 0 }))).toBe(0) // calm: no camera kick
    expect(effective(kick, 0.5, at({ reaction: 1 }))).toBeCloseTo(0.6, 12)
    expect(effective('e:organism:musicAmount', 1, at({ energy: 0 }))).toBeCloseTo(1 / 3, 12)
    expect(effective('e:organism:musicAmount', 1, at({ energy: 1 }))).toBeCloseTo(3, 12)
    // wild: the looks leave it at 0, the chaos offset brings it in
    expect(effective('e:organism:wild', 0, at({ chaos: 1 }))).toBeCloseTo(0.9, 12)
    // wiggle: complexity (×2 at 1) and chaos (×1.4 at 1) multiply
    expect(effective('e:organism:wiggle', 1, at({ complexity: 1, chaos: 1 }))).toBeCloseTo(2.8, 12)
    expect(effective('not-a-target', 7, at({ energy: 1 }))).toBe(7)
  })

  it('baseFrom inverts effective, except where a multiplier is 0', () => {
    for (const id of ALL_IDS)
      for (const x of [0.1, 0.5, 0.83]) {
        const pos = at({ reaction: x, energy: 1 - x, complexity: x, motion: x, chaos: 1 - x })
        expect(baseFrom(id, effective(id, 0.7, pos), pos)!, id).toBeCloseTo(0.7, 9)
      }
    expect(baseFrom('e:organism:kick', 0.3, at({ reaction: 0 }))).toBeNull()
  })

  it('no macro moves a control that rebuilds meshes or shaders', () => {
    const heavy = /^(e:organism:)?(shell|sp:|species|env$|shader|envShader|budget|quality|video|nested|camMode)/
    for (const id of ALL_IDS) expect(heavy.test(id), id).toBe(false)
    expect(isMacroTarget('e:organism:speed')).toBe(true)
    expect(isMacroTarget('e:organism:budget')).toBe(false)
  })
})

describe('saved macro settings', () => {
  it('positions: clamped to 0..1, junk is neutral, v0.20 growth / detail carry over', () => {
    expect(loadMacroPositions(null)).toEqual(neutralMacros())
    expect(loadMacroPositions('x')).toEqual(neutralMacros())
    expect(loadMacroPositions({ reaction: 1.5, motion: -2, chaos: Number.NaN, energy: '0.9' })).toEqual(at({ reaction: 1, motion: 0 }))
    expect(loadMacroPositions({ growth: 0.8, detail: 0.2 })).toEqual(at({ energy: 0.8, complexity: 0.2 }))
    expect(loadMacroPositions({ growth: 0.8, energy: 0.3 }).energy).toBe(0.3)
  })

  it('bases: v0.20 keys become registry ids; non-numbers are dropped', () => {
    expect(loadMacroBases({ speed: 2, 'g:zoomReact': 0.5, pulse: Number.POSITIVE_INFINITY, flash: '1' })).toEqual({ 'e:organism:speed': 2, 'g:zoomReact': 0.5 })
    expect(loadMacroBases(undefined)).toEqual({})
  })
})

describe('MacroRig', () => {
  const control = (key: string, value: number, min: number, max: number, step: number): EngineControl => ({ key, label: key, value, min, max, step })

  function rig(values: { kick?: number; maxLive?: number } = {}) {
    const controls: Record<string, EngineControl> = {
      'e:organism:kick': control('kick', values.kick ?? 0.5, 0, 2, 0.01),
      'e:organism:maxLive': control('maxLive', values.maxLive ?? 24, 1, 64, 1),
    }
    let writes = 0
    const host: MacroHost = {
      ctl: (id) => (controls[id] ? { c: controls[id] } : undefined),
      write: (v) => {
        writes++
        for (const [id, x] of Object.entries(v)) controls[id].value = x
      },
      save: () => {},
    }
    const r = new MacroRig(host, neutralMacros(), {})
    let now = 10
    /** let a knob settle: the controls ease toward it over a few frames */
    const settle = () => {
      for (let i = 0; i < 60; i++) r.tick((now += 1 / 60))
    }
    return { r, controls, settle, value: (key: string) => controls[`e:organism:${key}`].value, writes: () => writes }
  }

  // regression: a control without a stored base (no engine mounted yet, fresh settings) took its base
  // at the knob's next position instead of the one that set its value: energy 0.5 → 1 left maxLive at 27, not 48
  it('turning a knob and back returns the controls exactly, even on a control seen for the first time', () => {
    const { r, settle, value } = rig({ kick: 0.5, maxLive: 24 })
    r.set('energy', 1)
    settle()
    expect(value('maxLive')).toBe(48) // ×2, a whole-step control stays whole
    r.set('energy', NEUTRAL)
    settle()
    expect(value('maxLive')).toBe(24)
    expect(r.bases['e:organism:maxLive']).toBe(24)
  })

  it('a value past the control range is clamped when written, never stored as the base', () => {
    const { r, settle, value } = rig({ kick: 1.9 })
    r.set('reaction', 1)
    settle()
    expect(value('kick')).toBe(2) // 1.9 × 1.2 held to max
    r.set('reaction', NEUTRAL)
    settle()
    expect(value('kick')).toBeCloseTo(1.9, 9)
  })

  it('a manual move rebases the control; a knob at a zero multiplier cannot', () => {
    const { r, settle, value } = rig({ kick: 0.5 })
    r.set('reaction', 1)
    settle()
    r.controlMoved('e:organism:kick', 0.8) // the user drags kick while the knob is up
    expect(r.bases['e:organism:kick']).toBeCloseTo(0.8 / 1.2, 9)
    r.set('reaction', NEUTRAL)
    settle()
    expect(value('kick')).toBeCloseTo(0.8 / 1.2, 9)
    r.set('reaction', 0)
    settle()
    const before = r.bases['e:organism:kick']
    r.controlMoved('e:organism:kick', 0.3)
    expect(r.bases['e:organism:kick']).toBe(before)
    r.controlMoved('e:organism:budget', 5) // not a target: ignored
    expect('e:organism:budget' in r.bases).toBe(false)
  })

  it('idle ticks write nothing; a look rebases its values; an old preset loads exactly as saved', () => {
    const { r, settle, writes } = rig()
    settle()
    expect(writes()).toBe(0)
    r.set('energy', 1)
    settle()
    const look: Record<string, number> = { 'e:organism:maxLive': 10, 'e:organism:budget': 3 }
    r.rebase(look)
    expect(r.bases['e:organism:maxLive']).toBe(10)
    expect(look).toEqual({ 'e:organism:maxLive': 20, 'e:organism:budget': 3 })
    // a preset from before the macros: no positions, no bases
    const preset: Record<string, number> = { 'e:organism:kick': 0.7 }
    r.recall(undefined, undefined, preset)
    expect(r.pos).toEqual(neutralMacros())
    expect(preset['e:organism:kick']).toBe(0.7)
    expect(r.snapshot().macroBase['e:organism:kick']).toBe(0.7)
  })
})
