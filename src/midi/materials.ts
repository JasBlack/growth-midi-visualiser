// Animated surfaces (v0.17.3's ten, GROWTH_SHADERS 22-31): cheap world-space sine patterns on
// one shared clock. Four uniforms drive all ten, so speed, scale and the music cost nothing per
// material, and they work on the rigid growth and the soft surfaces alike (reactify adds the
// swell, flash and new/old emphasis on top, as for every growth shader).
//
// The clock is integrated (a speed change never jumps the pattern) and wrapped at ANIM_PERIOD:
// every time coefficient below is a multiple of 0.05, so every pattern repeats after 40π and the
// wrap is invisible (the oil slick's hue drift is 1/(4π), not v19's 0.08, for the same reason).
// Float32 precision then never degrades in a long set.
//
// This module imports nothing at runtime from shaders.ts (shaders.ts imports it).

import { MeshStandardNodeMaterial } from 'three/webgpu'
import { uniform, sin, mix, vec3, float, clamp, smoothstep, length, fract, abs, positionWorld, diffuseColor, materialColor } from 'three/tsl'
import type { ShaderDef } from './shaders'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type N = any
type RGB = [number, number, number]

export const ANIM_PERIOD = 40 * Math.PI
export const uMatClock = uniform(0)
export const uMatScale = uniform(1)
/** smoothed energy × audio response */
export const uMatEnergy = uniform(0)
/** the engine's hit envelope × audio response (silent in silence: the envelope gates the beat tracker) */
export const uMatAttack = uniform(0)

const wave = (n: N): N => sin(n).mul(0.5).add(0.5)
// the same ramp as shaders.ts hue()
const hue = (h: N): N => clamp(abs(fract(float(h).add(vec3(0, 0.6667, 0.3333))).mul(6).sub(3)).sub(1), 0, 1)
const P = (): N => positionWorld.mul(uMatScale)
const T = uMatClock

/** The pattern's bright part glows: a floor at rest, more with energy, a flash on every hit. */
function surface(mask: N, low: RGB, high: RGB, roughness: number, metalness: number, glow = 0.15) {
  const m = clamp(mask, 0, 1)
  const mat = new MeshStandardNodeMaterial()
  mat.roughness = roughness
  mat.metalness = metalness
  mat.colorNode = mix(vec3(...low), vec3(...high), m).mul(materialColor)
  mat.emissiveNode = diffuseColor.rgb.mul(m).mul(uMatEnergy.mul(0.3).add(uMatAttack.mul(0.7)).add(glow))
  return mat
}

export const ANIMATED_SHADERS: ShaderDef[] = [
  {
    name: 'tidal glass',
    make: () => {
      const p = P()
      return surface(wave(p.x.mul(2).add(T).add(sin(p.z.mul(2).sub(T.mul(0.7))))), [0.025, 0.12, 0.2], [0.35, 0.95, 1], 0.19, 0.32)
    },
  },
  {
    name: 'pearl currents',
    make: () => {
      const p = P()
      return surface(wave(p.y.mul(2.5).sub(T.mul(0.6)).add(sin(p.x.add(p.z).mul(1.4).add(T)).mul(2))), [0.24, 0.15, 0.32], [1, 0.85, 0.72], 0.28, 0.48, 0.05)
    },
  },
  {
    name: 'mercury ribbons',
    make: () => {
      const p = P()
      const warp = sin(p.z.mul(2).add(T.mul(0.4)))
      return surface(smoothstep(0.35, 0.65, wave(p.x.mul(3).add(p.y).sub(T).add(warp))), [0.035, 0.055, 0.09], [0.85, 0.95, 1], 0.16, 0.9, 0.07)
    },
  },
  {
    name: 'biolume',
    make: () => {
      const p = P()
      const dots = wave(p.x.mul(3).add(T)).mul(wave(p.y.mul(3.7).sub(T.mul(0.8)))).mul(wave(p.z.mul(2).add(T.mul(0.3))))
      return surface(smoothstep(0.32, 0.8, dots).mul(uMatAttack.mul(0.5).add(0.5)), [0.015, 0.06, 0.08], [0.2, 1, 0.55], 0.45, 0.12, 0.65)
    },
  },
  {
    name: 'oil slick',
    make: () => {
      const p = P()
      const h = p.x.mul(0.12).add(p.z.mul(0.09)).add(wave(p.y.add(T.mul(0.4))).mul(0.3)).add(T.mul(1 / (4 * Math.PI)))
      const mat = new MeshStandardNodeMaterial()
      mat.roughness = 0.22
      mat.metalness = 0.7
      mat.colorNode = hue(h).mul(0.8).add(0.12).mul(materialColor)
      mat.emissiveNode = diffuseColor.rgb.mul(uMatEnergy.mul(0.18).add(uMatAttack.mul(0.35)).add(0.08))
      return mat
    },
  },
  {
    name: 'silk shimmer',
    make: () => {
      const p = P()
      const warp = wave(p.x.mul(4).add(sin(p.y.mul(1.2).sub(T))))
      const weft = wave(p.z.mul(4).add(T.mul(0.7)))
      return surface(warp.mul(weft).mul(0.65).add(warp.mul(0.35)), [0.12, 0.025, 0.2], [1, 0.48, 0.7], 0.52, 0.15, 0.08)
    },
  },
  {
    name: 'molten gold',
    make: () => {
      const p = P()
      return surface(wave(p.y.mul(2).sub(T).add(sin(p.x.mul(1.8).add(T.mul(0.6)))).add(sin(p.z.mul(1.3).sub(T.mul(0.4))))), [0.18, 0.035, 0.005], [1, 0.72, 0.12], 0.24, 0.72, 0.24)
    },
  },
  {
    name: 'ripple rings',
    make: () => {
      const p = P()
      // a hit kicks the rings outward
      const ring = wave(length(p.xz).mul(3).sub(T.mul(1.6)).add(p.y.mul(0.7)).add(uMatAttack.mul(0.4)))
      return surface(smoothstep(0.35, 0.8, ring), [0.015, 0.07, 0.16], [0.2, 0.65, 1], 0.32, 0.38, 0.22)
    },
  },
  {
    name: 'aurora weave',
    make: () => {
      const p = P()
      const curtain = wave(p.x.mul(1.7).add(sin(p.y.mul(0.8).add(T.mul(0.6))).mul(2)).add(T.mul(0.4)))
      const drift = wave(p.z.mul(1.5).sub(T.mul(0.35)))
      return surface(curtain.mul(0.7).add(drift.mul(0.3)), [0.14, 0.015, 0.3], [0.15, 1, 0.62], 0.4, 0.2, 0.3)
    },
  },
  {
    name: 'electric filaments',
    make: () => {
      const p = P()
      const path = wave(p.y.mul(3).add(sin(p.x.mul(2).sub(T)).mul(2)).add(sin(p.z.mul(2).add(T.mul(0.7)))))
      return surface(smoothstep(0.72, 0.96, path), [0.025, 0.018, 0.08], [0.6, 0.55, 1], 0.35, 0.25, 0.5)
    },
  },
]

/** What the runtime keeps between frames. */
export interface MaterialPulse {
  energy: number
}

/**
 * Once per frame, after the engine's hit envelope. `hit` is that envelope (onsets, note-ons,
 * and beats only while something sounds), so the surfaces stay still in silence.
 */
export function updateMaterialUniforms(s: MaterialPulse, dtRaw: number, speed: number, scale: number, react: number, energy: number, hit: number) {
  const dt = Math.min(0.05, Math.max(0, dtRaw))
  s.energy += (Math.min(1, Math.max(0, energy)) - s.energy) * (1 - Math.exp(-dt * 10))
  // louder runs faster; still integrated, so the pattern never jumps
  uMatClock.value = (uMatClock.value + dt * speed * (1 + 1.2 * s.energy * react)) % ANIM_PERIOD
  uMatScale.value = scale > 0 ? scale : 1
  uMatEnergy.value = s.energy * react
  uMatAttack.value = Math.min(1, Math.max(0, hit)) * react
}
