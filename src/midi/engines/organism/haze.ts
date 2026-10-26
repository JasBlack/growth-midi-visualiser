// The haze world ("Webs" W1): a high-key environment instead of black space, chosen as the
// 'haze' environment shader (shaders.ts ENV_SHADERS). A warm pale sky with light at the end of the
// tunnel (on the view direction, eased, so it drifts as the camera turns), faint speed lines, an
// atmosphere that melts far growth into that light, and reflections of it in every lit surface.
//
// Everything made to glow on black has to adapt once the background is light, so this module
// computes how light the world reads (uLight, from the background's luminance) and how bright its
// brightest part is (bloomFloor); the engine, the tip markers, ignition and the bark of old growth
// read those, so every other world keeps exactly its old look (light 0, no fog node, no env node).

import * as THREE from 'three'
import { ctl } from '../../engine'
import { HAZE_ENV, hazeEnvironment, hazeFog, uHazeAxis, uHazeBase, uHazeDensity, uHazeGlow, uHazeLines, uHazeU, uHazeV, uLight } from '../../shaders'
import type { FeatureControl, OrganismFeature, OrganismHost } from './feature'

const G = 'Look'
/** the glow doubles the background's brightness per GLOW_STOPS / control unit */
const GLOW_STOPS = 1.25
/** headroom over the sky's brightest (W1's speed lines brightened by up to this; since W3 they only darken) */
const LINES_MAX = 0.14
/** light: from black space (below LIGHT_LO) to a light world (above LIGHT_HI), in linear luminance */
const LIGHT_LO = 0.11
const LIGHT_HI = 0.26
/** the glow follows the view at this rate (1/s): light at the end of the tunnel, not painted on the lens */
const AXIS_EASE = 2.2
/** haze density per unit of the engine's view-scaled fog density (exponential squared, by distance) */
const FOG_GAIN = 1.3
const Y_AXIS = new THREE.Vector3(0, 1, 0)
const X_AXIS = new THREE.Vector3(1, 0, 0)

export interface HazeTone {
  /** background colour, sRGB HSL */
  hue: number
  sat: number
  bright: number
  /** light at the end of the tunnel (control units) */
  glow: number
}

/**
 * Engine actions set these (with the haze environment): mist is the reference's warm grey-mauve
 * (measured on the frames, tone-mapped: walls ~#998a8b, centre ~#e2d4d6), dusk a deep mauve where
 * glows still add light, ink near-black with a faint far light.
 */
export const HAZE_TONES = {
  mist: { hue: 0.99, sat: 0.08, bright: 0.6, glow: 1 },
  dusk: { hue: 0.86, sat: 0.13, bright: 0.3, glow: 1.5 },
  ink: { hue: 0.72, sat: 0.12, bright: 0.075, glow: 2.2 },
} as const satisfies Record<string, HazeTone>

const luminance = (c: THREE.Color) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b
const smooth = (a: number, b: number, x: number) => {
  const k = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return k * k * (3 - 2 * k)
}

/**
 * The haze's linear colours from a tone (written into `base` and `glow`), how light the world reads
 * (0 black space … 1 light) and the bloom threshold that keeps the sky itself from blooming.
 */
export function hazeTone(t: HazeTone, base: THREE.Color, glow: THREE.Color) {
  base.setHSL(t.hue, Math.min(1, Math.max(0, t.sat)), Math.min(1, Math.max(0, t.bright)), THREE.SRGBColorSpace)
  const lum = luminance(base)
  // the light is the walls' own colour, paler and brighter: a multiple of them, so a dark world gets a dim light
  const k = Math.pow(2, GLOW_STOPS * Math.max(0, t.glow)) - 1
  const pale = (x: number) => (0.3 * x + 0.7 * lum) * k
  glow.setRGB(pale(base.r), pale(base.g), pale(base.b))
  const glowLum = luminance(glow)
  const light = smooth(LIGHT_LO, LIGHT_HI, lum + 0.25 * glowLum)
  // the sky's brightest (the light's centre, speed lines at full swing), with the bloom knee's margin above it
  const peak = (lum + glowLum) * (1 + LINES_MAX)
  return { light, bloomFloor: peak * 1.08 + 0.05 }
}

export class HazeWorld implements OrganismFeature {
  readonly id = 'haze'
  readonly controls: FeatureControl[] = [
    { key: 'hazeHue', label: 'haze world: colour (hue)', min: 0, max: 1, step: 0.01, value: HAZE_TONES.mist.hue, group: G },
    { key: 'hazeSat', label: 'haze world: colour strength', min: 0, max: 0.6, step: 0.01, value: HAZE_TONES.mist.sat, group: G },
    { key: 'hazeBright', label: 'haze world: brightness (low = a dark variant)', min: 0, max: 1, step: 0.01, value: HAZE_TONES.mist.bright, group: G },
    { key: 'hazeGlow', label: 'haze world: light at the end of the tunnel', min: 0, max: 3, step: 0.05, value: HAZE_TONES.mist.glow, group: G },
    { key: 'hazeLines', label: 'haze world: speed lines', min: 0, max: 2, step: 0.05, value: 1, group: G },
    { key: 'hazeFog', label: 'haze world: atmosphere (far growth melts into the light)', min: 0, max: 4, step: 0.05, value: 1, group: G },
    { key: 'hazeReflect', label: 'haze world: reflections (glossy and chrome surfaces mirror it)', min: 0, max: 2, step: 0.05, value: 1, group: G },
  ]
  /** the haze environment is selected */
  on = false
  /** 0 on black space … 1 on a light background: the engine adapts rim, tone mapping and lights to it */
  light = 0
  /** bloom's threshold stays above this, so the sky itself never blooms (0 when off) */
  bloomFloor = 0
  private dt = 0
  /** the next frame takes the view as the axis at once (a new world, a Reset) */
  private snap = true
  private readonly fogNode = hazeFog()
  private readonly envNode = hazeEnvironment()
  private readonly fwd = new THREE.Vector3()

  unmount(e: OrganismHost) {
    this.setOn(false, e)
  }

  clear() {
    this.snap = true
  }

  beforeFrame(_m: unknown, _g: unknown, dt: number, _t: number, e: OrganismHost) {
    this.dt = dt
    const c = e.controls
    this.setOn(ctl(c, 'envShader') === HAZE_ENV, e)
    if (!this.on) return
    const tone = hazeTone({ hue: ctl(c, 'hazeHue'), sat: ctl(c, 'hazeSat'), bright: ctl(c, 'hazeBright'), glow: ctl(c, 'hazeGlow') }, uHazeBase.value, uHazeGlow.value)
    this.light = uLight.value = tone.light
    this.bloomFloor = tone.bloomFloor
    uHazeLines.value = ctl(c, 'hazeLines')
    e.scene.environmentIntensity = ctl(c, 'hazeReflect')
    // whatever the sky sphere leaves uncovered clears to the walls' colour
    if (e.scene.background instanceof THREE.Color) e.scene.background.copy(uHazeBase.value)
  }

  /**
   * After the camera moved: the light eases toward the view (in flight, toward the direction of
   * travel: looking aside or banking leaves the light at the end of the tunnel); the fog takes the
   * engine's view-scaled density.
   */
  beforeDraw(e: OrganismHost) {
    if (!this.on) return
    const fwd = e.travel ? this.fwd.copy(e.travel) : e.camera.getWorldDirection(this.fwd)
    const a = uHazeAxis.value
    if (this.snap) a.copy(fwd)
    else a.lerp(fwd, 1 - Math.exp(-this.dt * AXIS_EASE)).normalize()
    this.snap = false
    this.dt = 0 // a snapshot's extra draw does not ease again
    const u = uHazeU.value.crossVectors(a, Y_AXIS)
    if (u.lengthSq() < 1e-6) u.crossVectors(a, X_AXIS)
    u.normalize()
    uHazeV.value.crossVectors(u, a)
    const fog = e.scene.fog as THREE.FogExp2 | null
    uHazeDensity.value = (fog?.density ?? 0.03) * FOG_GAIN * ctl(e.controls, 'hazeFog')
  }

  /** Swap the scene's fog and environment nodes (the materials recompile once, on the switch). */
  private setOn(on: boolean, e: OrganismHost) {
    if (on === this.on) return
    this.on = on
    this.snap = true
    e.scene.fogNode = on ? this.fogNode : null
    e.scene.environmentNode = on ? this.envNode : null
    if (on) return
    this.light = this.bloomFloor = 0
    uLight.value = uHazeDensity.value = 0
    e.scene.environmentIntensity = 1
    if (e.scene.background instanceof THREE.Color) e.scene.background.setRGB(0, 0, 0)
  }
}
