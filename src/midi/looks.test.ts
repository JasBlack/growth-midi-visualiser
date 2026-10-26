import { describe, expect, it } from 'vitest'
import { PALETTES } from './color'
import { CAM } from './engines/organism/camera'
import { THREADS } from './engines/organism/flight'
import { CHROME_SPECIES } from './engines/organism/soft'
import { ENV_SHADERS, GROWTH_SHADERS, HAZE_ENV } from './shaders'
import { LOOKS, LOOK_BASE, lookCamera, resolveLook } from './looks'

const webs = LOOKS.find((r) => r.id === 'webs')!
const night = LOOKS.find((r) => r.id === 'webs-night')!
const roots = LOOKS.find((r) => r.id === 'roots')!

describe('looks', () => {
  it('every key a look sets is reset by LOOK_BASE, so the next look puts it back', () => {
    for (const r of LOOKS) for (const k of Object.keys(r.values)) expect(k in LOOK_BASE, `${r.id}: ${k}`).toBe(true)
    // the Webs scenery is off in every other look: no haze, debris, ambient web or ribbons
    expect(LOOK_BASE.debris).toBe(0)
    expect(LOOK_BASE.envShader).toBe(0)
    expect(LOOK_BASE.flightFill).toBe(0)
    expect(LOOK_BASE.flightRibbons).toBe(0)
  })

  it('every look breathes with the music, visibly but not all the way back', () => {
    for (const r of LOOKS) {
      const b = { ...LOOK_BASE, ...r.values }.breath
      expect(b, r.id).toBeGreaterThanOrEqual(0.4)
      expect(b, r.id).toBeLessThanOrEqual(0.7)
    }
  })

  it('Webs resolves its threads, chrome ribbons, palette and haze sky by name', () => {
    const names = {
      species: [THREADS.name, ...CHROME_SPECIES.map((s) => s.name)],
      palettes: PALETTES.map((p) => p.name),
      shaders: GROWTH_SHADERS.map((s) => s.name),
      skies: ENV_SHADERS.map((s) => s.name),
    }
    for (const r of [webs, night]) {
      const look = resolveLook(r, names, null)
      expect(look.missing).toEqual([])
      expect(look.speciesOn).toEqual(new Set([0, 1]))
      expect(look.values.envShader).toBe(HAZE_ENV)
      expect(look.values.debris).toBeGreaterThan(0)
      expect(look.values.flightFill).toBeGreaterThan(0)
      expect(look.values.flightRibbons).toBeGreaterThan(0)
    }
    // the night is the haze darkened right down
    expect(night.values.hazeBright).toBeLessThan(0.2)
    expect(webs.values.hazeBright).toBeGreaterThan(0.4)
  })

  it('the camera: Webs flies; any other look keeps the performer’s camera, flight included', () => {
    expect(lookCamera(webs)).toEqual({ camMode: CAM.flight, orbit: webs.camera!.speed })
    for (const r of LOOKS) if (!r.camera) expect(lookCamera(r), r.id).toEqual({})
    expect(roots.camera).toBeUndefined()
  })
})
