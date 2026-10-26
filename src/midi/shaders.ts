// Shader library: procedural TSL node materials for the growth surfaces and
// sky-sphere backgrounds. TSL compiles to WGSL (WebGPU) or GLSL (WebGL2
// fallback), so every shader runs on both backends. Music uniforms are
// updated by the engine each frame; instance colours (per growth) multiply
// into every surface shader automatically.

import * as THREE from 'three'
import { MeshStandardNodeMaterial, MeshBasicNodeMaterial } from 'three/webgpu'
import {
  uniform,
  time,
  positionWorld,
  normalWorld,
  normalView,
  positionViewDirection,
  float,
  vec3,
  mix,
  smoothstep,
  sin,
  fract,
  abs,
  floor,
  step,
  length,
  dot,
  normalize,
  pow,
  clamp,
  max,
  mod,
  hash,
  mx_noise_float,
  mx_fractal_noise_float,
  mx_worley_noise_float,
  positionLocal,
  normalLocal,
  diffuseColor,
  attribute,
  materialColor,
  exp,
  min,
  int,
  vec4,
  varying,
  uniformArray,
  uniformGroup,
  acos,
  atan,
  vec2,
  Fn,
  output,
  cameraPosition,
  fwidth,
  sqrt,
  materialRoughness,
  materialMetalness,
} from 'three/tsl'
import { ANIMATED_SHADERS } from './materials'

/** Music-reactive uniforms, set by the engine every frame. */
export const uEnergy = uniform(0)
export const uOnset = uniform(0)
export const uBass = uniform(0)
export const uTreble = uniform(0)
export const uBeat = uniform(0)
/** Music reaction, set by the engine: uPulse swells every surface along its normal (world units), uFlash lights it up. */
export const uPulse = uniform(0)
export const uFlash = uniform(0)
/**
 * 0: the swell is uPulse world units on every surface (thin growth balloons, as it always has);
 * 1: at most 1.5 radii, so hairline threads breathe instead of turning into pipes (the flight sets it).
 */
export const uSwellRel = uniform(0)
const SWELL_REL = 1.5

/**
 * Highlight new / dim old, set by the engine each frame: uNow is seconds on the engine's
 * clock, uFocus the strength (0 = off), uTrail the seconds a segment takes to go from fresh
 * to old. Each growth instance carries its birth time in the `segData` attribute, so the
 * fade runs on the GPU and costs no per-frame colour writes.
 */
export const uNow = uniform(0)
export const uFocus = uniform(0)
export const uTrail = uniform(2.5)
/**
 * The growth geometry attribute, per instance (segments) or per vertex (soft surfaces), written
 * when a segment is filed and never per frame: x birth time (engine clock − epoch), y arc distance
 * from its plant's root where the segment starts, z the segment's length, w the note that grew it
 * (MIDI pitch, −1 for growth no note made) + a fraction holding its radius (r / (1 + r)).
 */
export const SEG_DATA = 'segData'
/**
 * Per vertex of a segment shape: how far along its segment it sits (0 at the start, 1 at the moving
 * end); 2 for a shape that sits at the moving end as a whole (nodes, leaves).
 */
export const SEG_T = 'segT'
/**
 * Per segment instance, written when filed: how far along its host its plant's root sits (arc units,
 * 0 for a plant rooted in space). The breath reaches from the first root through grafts.
 */
export const SEG_BASE = 'segBase'

/**
 * Music breath (organism/breath.ts): the contraction 0 (everything out) … 1 (drawn back to the
 * roots), set every frame. A strand reaches BREATH_ARC·(1−c)/c + BREATH_MIN arc units from its
 * roots; beyond, segments collapse toward their start. A played note's own growth stays out while
 * the key is held, easing in over BREATH_HOLD_ATTACK and letting go over BREATH_HOLD_RELEASE (s).
 */
export const uBreath = uniform(0)
export const BREATH_ARC = 5
export const BREATH_MIN = 0.3
export const BREATH_HOLD_ATTACK = 0.08
export const BREATH_HOLD_RELEASE = 0.6
/** The breath's reach (arc units from the roots) at contraction `c` (the shader's formula). */
export const breathReach = (c: number) => (BREATH_ARC * (1 - c)) / Math.max(c, 1e-3) + BREATH_MIN
// level = 1 − 0.8·focus + 1.15·focus·fresh (v0.17's curve); fresh growth also glows a little
const OLD_DIM = 0.8
const FRESH_GAIN = 1.15
const FRESH_GLOW = 0.6

/**
 * Conduction (k1 Idea 1): each note-on sends a pulse of light from the roots to the tips of the
 * growth that note has made, in its own colour; a chord is several independent pulses. The table
 * holds one row per MIDI pitch (last two launches, strength, release), one per pitch class (other
 * octaves echo faintly) and one for the beat (a faint wave through everything, stronger through
 * held notes). It changes only on events: its own uniform group uploads when marked, not per draw.
 */
export const COND_PC = 128
export const COND_BEAT = COND_PC + 12
export const condGroup = uniformGroup('conduction')
export const condRows = Array.from({ length: COND_BEAT + 1 }, () => new THREE.Vector4(-1e4, -1e4, 0, -1e4))
export const uCond = uniformArray(condRows, 'vec4').setGroup(condGroup)
/** pulse brightness (0 = conduction off), speed along the branches (arc units / s), 1 / pulse life (s) */
export const uCondGain = uniform(0)
export const uCondSpeed = uniform(7)
export const uCondLife = uniform(0.6)
/** 1 / release time of a note's shimmer (s) */
export const uCondRelease = uniform(1.2)
/** Age grading (k1 Idea 17): 0 = off; old growth cools toward bark, new growth runs hot. */
export const uGrade = uniform(0)
/**
 * Rim light (k1 Idea 6): silhouettes glow in the growth's own colour, set by the engine each frame
 * (0 = off). Black space has nothing behind a thin branch to separate it from; the rim does.
 */
export const uRim = uniform(0)
const RIM_POWER = 3

/**
 * The haze world (ENV_SHADERS 'haze', set each frame by organism/haze.ts): a pale sky with light at
 * the end of the tunnel. Colours are linear. The glow sits on uHazeAxis (the view, eased), and
 * uHazeU / uHazeV span the plane across it for the speed lines. uHazeDensity is 0 in every other
 * world, so the sprites' own fade (hazeClear) costs nothing there.
 */
export const uHazeBase = uniform(new THREE.Color(0, 0, 0))
export const uHazeGlow = uniform(new THREE.Color(0, 0, 0))
export const uHazeAxis = uniform(new THREE.Vector3(0, 0, -1))
export const uHazeU = uniform(new THREE.Vector3(1, 0, 0))
export const uHazeV = uniform(new THREE.Vector3(0, 1, 0))
export const uHazeLines = uniform(0)
export const uHazeDensity = uniform(0)
/**
 * 0 on black space … 1 on a light background, from the world's luminance (organism/haze.ts). What
 * was made to glow on black reads it: old growth dries to ink, ignition lays ink instead of light.
 */
export const uLight = uniform(0)
// pulse shape: a gaussian front WIDTH wide, a tail fading over TAIL behind it (arc units)
const WIDTH = 0.8
const TAIL = 2.4
const HEAD_GAIN = 1.9
const ECHO = 0.35
const SHIMMER = 0.3
const BEAT_GAIN = 0.55
/** a pulse's front thickens the branch it passes by this much of its radius */
const SWELL = 0.8
/** bark: old colour desaturates toward a cool grey that keeps most of its brightness */
const BARK = [0.84, 0.94, 1.12] as const
/** on a light world grey bark would melt into the haze: old growth dries to ink instead */
const BARK_INK = [0.035, 0.03, 0.04] as const
/** share of the emissive glows (flash, fresh, pulses) a fully light world removes */
const LIGHT_GLOW_CUT = 0.6
/** growth takes GRADE_SPAN fresh trails to cool into bark; it runs hot for HOT_TAU seconds */
const GRADE_SPAN = 4
const HOT_TAU = 1.1
const HOT = 0.35

/** One travelling pulse: brightness at `arc`, `dt` seconds after launch, and its front alone. */
function pulse(arc: N, dt: N, speed: N, life: N) {
  const ahead = arc.sub(dt.mul(speed)) // > 0: not reached yet
  const front = exp(ahead.mul(ahead).mul(-1 / (WIDTH * WIDTH)))
  // min(): the unused side must stay finite (inf × 0 is NaN)
  const tail = exp(min(ahead, 0).mul(1 / TAIL))
  const fade = exp(dt.mul(life).negate()).mul(step(0, dt))
  return { glow: mix(tail, front, step(0, ahead)).mul(fade), front: front.mul(fade) }
}

/** Conduction brightness at a vertex (vertex stage), and the pulse fronts for the swell. */
function conduction(arc: N, code: N, played: N, row: N) {
  const pitch = max(code, 0)
  const echoRow: N = uCond.element(int(mod(pitch, 12).add(COND_PC)))
  const beatRow: N = uCond.element(int(COND_BEAT))
  const a = pulse(arc, uNow.sub(row.x), uCondSpeed, uCondLife)
  const b = pulse(arc, uNow.sub(row.y), uCondSpeed, uCondLife)
  const note = a.glow.add(b.glow.mul(0.75)).mul(row.z).mul(HEAD_GAIN)
  // another octave of the same pitch class answers, unless this pitch itself was just played
  const echo = pulse(arc, uNow.sub(echoRow.x), uCondSpeed, uCondLife).glow.mul(echoRow.y).mul(step(row.x.add(0.02), echoRow.x)).mul(ECHO)
  // a held note's growth keeps a slow shimmer running outward, fading with the release
  const held = exp(max(uNow.sub(row.w), 0).mul(uCondRelease).negate()).mul(played)
  const band = sin(arc.mul(1.7).sub(uNow.mul(2.4))).mul(0.5).add(0.5)
  const shimmer = band.mul(band).mul(held).mul(row.z).mul(SHIMMER)
  const beat = pulse(arc, uNow.sub(beatRow.x), uCondSpeed.mul(1.6), uCondLife.mul(1.8)).glow.mul(beatRow.y).mul(held.mul(0.7).add(0.3)).mul(BEAT_GAIN)
  const glow = note.add(echo).mul(played).add(shimmer).add(beat).mul(uCondGain)
  const front = a.front.add(b.front.mul(0.75)).mul(row.z).mul(played).mul(uCondGain)
  return { glow, front }
}

/**
 * The breath at a segment instance (vertex stage): the share of the segment inside the reach,
 * 0 (collapsed onto its start) … 1 (all out). `code` < 0 is growth no note made: -2 (the flight's
 * ambient web) breathes, -1 (typography, Build shape) never does.
 */
function breathShare(d: N, code: N, played: N, row: N) {
  const breathes = max(played, step(code, -1.5))
  // a held key keeps its growth out: in over the attack from its launch, out over the release from its note-off
  const attack = clamp(uNow.sub(row.x).mul(1 / BREATH_HOLD_ATTACK), 0, 1)
  const hold = min(attack, exp(max(uNow.sub(row.w), 0).mul(-1 / BREATH_HOLD_RELEASE))).mul(played)
  const c = uBreath.mul(breathes).mul(float(1).sub(hold))
  const reach = float(1).sub(c).div(max(c, 1e-3)).mul(BREATH_ARC).add(BREATH_MIN)
  const from = d.y.add(attribute(SEG_BASE, 'float') as N)
  return clamp(reach.sub(from).div(max(d.z, 1e-3)), 0, 1)
}

/**
 * Make a growth material react: vertices push out along their normal with
 * uPulse (instancing is applied first, so this thickens each segment in place)
 * and the surface glows its own colour with uFlash. New growth is brighter and
 * old growth dimmer (uFocus / uTrail); conduction pulses run along the branches and
 * old growth cools to bark (uGrade), all from `segData`; silhouettes carry a rim of the same
 * colour (uRim). Plain materials pass through.
 * `along`: the geometry carries SEG_T and SEG_BASE (segment shapes), so the arc runs along each
 * instance and the music breath collapses segments beyond its reach onto their start (nodes and
 * leaves at a collapsing end shrink away), before the instance transform: no per-segment CPU work.
 * Without it (soft surfaces) segData.y is already the arc at each vertex; they breathe by their
 * mesh scale (organism/soft.ts).
 */
export function reactify<T extends THREE.Material>(m: T, along = false): T {
  const nm = m as unknown as { isNodeMaterial?: boolean; positionNode: N; emissiveNode: N; colorNode: N; setupDiffuseColor?: (b: unknown) => void; setupPosition?: (b: unknown) => unknown }
  if (!nm.isNodeMaterial) return m
  const d: N = attribute(SEG_DATA, 'vec4')
  const segT: N = along ? attribute(SEG_T, 'float') : null
  const arc: N = along ? d.y.add(min(segT, 1).mul(d.z)) : d.y
  const code = floor(d.w)
  const played = step(0, code)
  const row: N = uCond.element(int(max(code, 0)))
  const c = conduction(arc, code, played, row)
  // the breath: how much of this segment is out, and how much of its girth a collapsing end keeps
  // (a skin thins as it goes, a node or leaf shrinks away; the swell goes with them)
  let keep: N = float(1)
  const setupPos = nm.setupPosition
  if (along && typeof setupPos === 'function') {
    const vis = breathShare(d, code, played, row)
    keep = mix(smoothstep(0, 0.2, vis), smoothstep(0.7, 1, vis), step(1.5, segT))
    nm.setupPosition = function (this: unknown, builder: unknown) {
      // in the shape's own space (a skin spans y −0.5 … 0.5 from start to end), before the instance transform
      const g: N = positionLocal
      const skin = vec3(g.x.mul(keep), g.y.add(0.5).mul(vis).sub(0.5), g.z.mul(keep))
      positionLocal.assign(mix(skin, g.mul(keep), step(1.5, segT)))
      return setupPos.call(this, builder)
    }
  }
  const f = fract(d.w)
  const radius = f.div(max(float(1).sub(f), 1e-3))
  const swell = mix(uPulse, min(uPulse, radius.mul(SWELL_REL)), uSwellRel)
  nm.positionNode = positionLocal.add(normalLocal.mul(swell.add(c.front.mul(radius).mul(SWELL)).mul(keep)))
  // per vertex, handed to the fragment stage: conduction, bark mix, hot glow, fresh
  const age = uNow.sub(d.x)
  const glow: N = c.glow
  const cool: N = float(1).sub(exp(age.div(uTrail.mul(GRADE_SPAN)).negate())).mul(uGrade).mul(float(1).sub(min(glow, 1)))
  const hot = exp(age.mul(-1 / HOT_TAU)).mul(uGrade).mul(HOT)
  const fresh = clamp(float(1).sub(age.div(uTrail)), 0, 1)
  const v = varying(vec4(glow, cool, hot, fresh))
  const level = float(1).sub(uFocus.mul(OLD_DIM)).add(uFocus.mul(FRESH_GAIN).mul(v.w))
  nm.colorNode = (nm.colorNode ?? materialColor).mul(level)
  const rim = fresnel(RIM_POWER).mul(uRim)
  // on a light world added light pales growth toward the sky: the glows step back (the colour stays)
  const flash = diffuseColor.rgb.mul(uFlash.add(uFocus.mul(v.w).mul(FRESH_GLOW)).add(v.x).add(v.z).add(rim)).mul(float(1).sub(uLight.mul(LIGHT_GLOW_CUT)))
  nm.emissiveNode = nm.emissiveNode ? nm.emissiveNode.add(flash) : flash
  // bark: after three multiplies the instance / vertex colour in (colorNode is before it), so the
  // plant's own colour desaturates; a passing pulse brings it back
  const setup = nm.setupDiffuseColor
  if (typeof setup === 'function') {
    nm.setupDiffuseColor = function (this: unknown, builder: unknown) {
      setup.call(this, builder)
      const col: N = diffuseColor.rgb
      const lum = mix(dot(col, vec3(0.3, 0.59, 0.11)), max(col.r, max(col.g, col.b)), 0.4)
      const bark: N = mix(col, mix(vec3(...BARK).mul(lum), vec3(...BARK_INK), uLight), v.y)
      diffuseColor.assign(vec4(bark, diffuseColor.a))
    }
  }
  return m
}

/** a wire's roughness on a light world */
const WIRE_ROUGH = 0.22

/**
 * On a light world (the haze) growth reads as wire, as in the reference: glossy, the near-black
 * inks a dielectric whose edges mirror the bright sky, the lighter ones metal (pewter, silver).
 * Black space keeps the material exactly as it was (uLight 0).
 */
export function wireOnLight<T extends THREE.Material>(m: T): T {
  const nm = m as unknown as { isNodeMaterial?: boolean; roughnessNode: N; metalnessNode: N }
  if (!nm.isNodeMaterial) return m
  const lum = dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722))
  nm.roughnessNode = mix(nm.roughnessNode ?? materialRoughness, float(WIRE_ROUGH), uLight)
  nm.metalnessNode = mix(nm.metalnessNode ?? materialMetalness, smoothstep(0.02, 0.2, lum).mul(0.85), uLight)
  return m
}

export function setShaderMusic(energy: number, onset: number, bass: number, treble: number, beat: number) {
  uEnergy.value = energy
  uOnset.value = onset
  uBass.value = bass
  uTreble.value = treble
  uBeat.value = beat
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type N = any

const hue = (h: N): N => clamp(abs(fract(float(h).add(vec3(0, 0.6667, 0.3333))).mul(6).sub(3)).sub(1), 0, 1)
const fresnel = (p = 3): N => pow(float(1).sub(clamp(dot(normalView, positionViewDirection), 0, 1)), p)
const pw = positionWorld

// ---------------------------------------------------------------- haze world

// Profile measured on the reference frames (docs/webs-ref): a bright plateau out to ~0.47 of the
// half-height, a broad falloff to the edges, corners ~2.6x darker than the centre (linear).
/** the sky's light (radians from the axis): a soft disc in a wide, faint halo */
const GLOW_IN = 0.18
const GLOW_OUT = 0.4
const HALO = 0.5
/** speed lines round the axis: ~5 px apart at the frame's mid-edge at 1080p, like the reference's hatching */
const LINES_N = 720
/** a line's half width (share of its period) where they are well apart, and its darkening at full strength */
const LINE_HALF = 0.09
const LINE_DARK = 0.09
/** walls dim away from the light, and much more behind the camera (chrome mirrors that side) */
function hazeShade(th: N): N {
  return float(1).sub(smoothstep(0.25, 1.0, th).mul(0.3)).sub(smoothstep(1.3, 2.8, th).mul(0.35))
}

/** The haze sky in world direction `dir` (unit); `lines` adds the faint speed lines (the sky sphere only). */
export function hazeSky(dir: N, lines: boolean): N {
  const th: N = acos(clamp(dot(dir, uHazeAxis), -1, 1))
  const glow = float(1).sub(smoothstep(GLOW_IN, GLOW_OUT, th)).mul(0.75).add(exp(th.mul(th).mul(-1 / (HALO * HALO))).mul(0.25))
  const col: N = uHazeBase.mul(hazeShade(th)).add(uHazeGlow.mul(glow))
  if (!lines) return col
  // the reference's fine hatching converging on the light: thin dark lines round the axis (a whole
  // number of them, so the atan seam never shows), their phase and strength wandering with a noise
  // taken round the unit circle. Antialiased by their footprint: a soft sine grating near a pixel's
  // scale read as moiré bands (W1), so each line is drawn over the pixels it covers, and where the
  // lines crowd toward the light they fade out instead of beating against the pixel grid
  const u = dot(dir, uHazeU)
  const v = dot(dir, uHazeV)
  const r2 = max(u.mul(u).add(v.mul(v)), 1e-8)
  const ring = vec2(u, v).div(sqrt(r2))
  const wander = mx_noise_float(vec3(ring.mul(9), th.mul(2.5)))
  const cyc = atan(v, u).mul(LINES_N / (2 * Math.PI)).add(wander.mul(0.8))
  // periods per pixel from the angle's derivative (continuous across the seam, unlike fwidth(atan))
  const w = abs(u).mul(fwidth(v)).add(abs(v).mul(fwidth(u))).div(r2).mul(LINES_N / (2 * Math.PI)).add(1e-4)
  const d = abs(fract(cyc).sub(0.5))
  const line = float(1).sub(smoothstep(max(float(LINE_HALF).sub(w.mul(0.5)), 0), w.mul(0.5).add(LINE_HALF), d))
  const apart = float(1).sub(smoothstep(0.28, 0.5, w))
  const strength = smoothstep(-0.5, 0.6, mx_noise_float(vec3(ring.mul(4), th.mul(1.2).add(7))))
  return col.mul(float(1).sub(line.mul(apart).mul(strength).mul(smoothstep(0.16, 0.5, th)).mul(uHazeLines).mul(LINE_DARK)))
}

/**
 * Reflections and ambient light from the haze (scene.environmentNode): the sky without lines, with
 * the light spread wider and dimmer for rough surfaces, a cool tint above and a pink one below so
 * chrome picks up two tones. Read through the environment's context like a PMREM: radiance asks
 * along the reflection at the surface's roughness, irradiance along the normal at level 1.
 */
export const hazeEnvironment = Fn((builder: N) => {
  const ctx = builder.context
  const dir: N = ctx.getUV ? ctx.getUV(null, builder) : normalWorld
  const rough: N = ctx.getTextureLevel ? float(ctx.getTextureLevel(null, builder)) : float(1)
  const th: N = acos(clamp(dot(dir, uHazeAxis), -1, 1))
  const w2 = rough.mul(rough).mul(1.6).add(0.1)
  const glow = exp(th.mul(th).div(w2).negate()).mul(float(0.11).div(w2))
  const up = max(dir.y, 0)
  const down = max(dir.y.negate(), 0)
  const tint = vec3(1).add(vec3(-0.05, -0.02, 0.08).mul(up)).add(vec3(0.06, -0.03, 0.02).mul(down))
  return uHazeBase.mul(hazeShade(th)).mul(tint).add(uHazeGlow.mul(glow))
})

/**
 * What the chrome ribbons mirror (their own envNode, organism/soft.ts). A mirror of an even sky is a
 * flat grey plate: this is a studio with a mirror's contrast, the light at the end of the tunnel,
 * bright walls in panels round the horizon above a dark floor (the horizon is the mirror's dark-bright
 * edge), a dark band across the walls and two thin strip lights, so a twisting ribbon streaks from
 * white to dark along its length. On a light world (uLight) the walls are near white with the haze's
 * cast and the floor navy, the reference's navy-to-white chrome; in black space and dark hazes the
 * same studio, neutral and dim.
 */
export const chromeEnvironment = Fn((builder: N) => {
  const ctx = builder.context
  const dir: N = ctx.getUV ? ctx.getUV(null, builder) : normalWorld
  const rough: N = ctx.getTextureLevel ? float(ctx.getTextureLevel(null, builder)) : float(1)
  const th: N = acos(clamp(dot(dir, uHazeAxis), -1, 1))
  const w2 = rough.mul(rough).mul(1.6).add(0.06)
  const glow = exp(th.mul(th).div(w2).negate()).mul(float(0.07).div(w2))
  const walls: N = mix(vec3(0.32, 0.33, 0.36) as N, mix(uHazeBase.mul(2), vec3(1.4), 0.45), uLight)
  const light: N = mix(vec3(1.6) as N, (uHazeGlow as N).add(uHazeBase).mul(2.2), uLight)
  const floor: N = mix(vec3(0.008, 0.009, 0.016) as N, vec3(0.004, 0.007, 0.03), uLight)
  const y = dir.y
  const sharp = float(1).sub(rough)
  // softbox panels round the horizon and a dark band across them; both blur away on a rough surface
  const panels = mix(float(0.5), float(1.2), smoothstep(-0.2, 0.6, sin(atan(dir.z, dir.x).mul(3).add(0.5))))
  const band = smoothstep(0.09, 0.02, abs(y.sub(0.2))).mul(0.85)
  const wall: N = mix(walls.mul(mix(float(1), panels, sharp)), floor, band.mul(sharp))
  // the horizon (a little above level, so a ribbon's underside is mostly dark) softens with
  // roughness; the strips fade out on a rough surface
  const sky = mix(floor, wall, smoothstep(rough.mul(-0.3).add(0.02), rough.mul(0.3).add(0.08), y))
  const strips = smoothstep(0.04, 0, abs(y.sub(0.42))).add(smoothstep(0.03, 0, abs(y.sub(0.72)))).mul(sharp.mul(sharp))
  return sky.add(light.mul(glow)).add(light.mul(strips).mul(0.9))
})

/**
 * How much of what lies `dist` from the camera survives the haze: exponential squared, like the
 * scene's FogExp2 (near growth stays crisp and dark, far growth melts), but by distance, not view
 * depth, so the frame's edges fog like its centre. 1 when the haze is off (density 0).
 */
const clearAt = (dist: N): N => {
  const k = dist.mul(uHazeDensity)
  return exp(k.mul(k).negate())
}

/** The haze's clearness at this fragment, for sprites that draw no scene fog (ignition): additive light dims, ink thins. */
export const hazeClear = (): N => clearAt(length(positionWorld.sub(cameraPosition)))

/**
 * scene.fogNode for the haze: toward the sky right behind the fragment, so far growth melts into
 * the light instead of greying against it. Additive materials only fade: adding the sky would
 * brighten them.
 */
export const hazeFog = Fn((builder: N) => {
  const d = positionWorld.sub(cameraPosition)
  const dist = length(d)
  const clear = clearAt(dist)
  if (builder.material?.blending === THREE.AdditiveBlending) return vec4(output.rgb.mul(clear), output.a)
  return vec4(mix(hazeSky(d.div(max(dist, 1e-4)), false), output.rgb, clear), output.a)
})

export interface ShaderDef {
  name: string
  /** null = the engine's default material */
  make: () => THREE.Material | null
}

const std = (o: Partial<{ colorNode: N; emissiveNode: N; roughnessNode: N; metalnessNode: N; roughness: number; metalness: number }>) => {
  const m = new MeshStandardNodeMaterial()
  m.roughness = o.roughness ?? 0.5
  m.metalness = o.metalness ?? 0.1
  if (o.colorNode) m.colorNode = o.colorNode
  if (o.emissiveNode) m.emissiveNode = o.emissiveNode
  if (o.roughnessNode) m.roughnessNode = o.roughnessNode
  if (o.metalnessNode) m.metalnessNode = o.metalnessNode
  return m
}

const BASE_GROWTH_SHADERS: ShaderDef[] = [
  { name: 'standard', make: () => null },
  { name: 'stripes', make: () => std({ colorNode: mix(vec3(0.3), vec3(1), step(0.5, fract(pw.y.mul(3).add(time.mul(0.3))))) }) },
  {
    name: 'marble',
    make: () => {
      const n = mx_fractal_noise_float(pw.mul(0.8))
      const v = sin(pw.x.mul(2).add(n.mul(6))).mul(0.5).add(0.5)
      return std({ colorNode: mix(vec3(0.2, 0.2, 0.25), vec3(1), v), roughness: 0.3 })
    },
  },
  { name: 'cells', make: () => std({ colorNode: mix(vec3(1), vec3(0.25), mx_worley_noise_float(pw.mul(2.5))) }) },
  { name: 'mottle', make: () => std({ colorNode: vec3(mx_noise_float(pw.mul(3)).mul(0.5).add(0.5).mul(0.6).add(0.4)) }) },
  {
    name: 'scales',
    make: () => {
      const r = length(fract(pw.xz.mul(4)).sub(0.5))
      return std({ colorNode: mix(vec3(0.55), vec3(1), smoothstep(0.5, 0.42, r)), roughness: 0.35, metalness: 0.3 })
    },
  },
  {
    name: 'veins',
    make: () => {
      const v = smoothstep(0.0, 0.08, mx_worley_noise_float(pw.mul(3)))
      return std({ colorNode: mix(vec3(1.2, 0.2, 0.25), vec3(1), v) })
    },
  },
  {
    name: 'lava',
    make: () => {
      const n = mx_fractal_noise_float(pw.mul(1.5).add(time.mul(0.2))).mul(0.5).add(0.5)
      return std({ colorNode: vec3(0.15), emissiveNode: vec3(1, 0.3, 0).mul(pow(n, 3)).mul(uBass.mul(2).add(1)), roughness: 0.8 })
    },
  },
  {
    name: 'iridescent',
    make: () => std({ colorNode: hue(fresnel(1.5).mul(0.7).add(pw.y.mul(0.05)).add(time.mul(0.05))), metalness: 0.8, roughness: 0.25 }),
  },
  {
    name: 'hologram',
    make: () => {
      const scan = step(0.5, fract(pw.y.mul(20).sub(time.mul(2)))).mul(0.5).add(0.5)
      return std({ colorNode: vec3(0.1), emissiveNode: vec3(0.2, 0.8, 1).mul(fresnel(2)).mul(scan).mul(2), roughness: 0.2 })
    },
  },
  {
    name: 'toon',
    make: () => {
      const l = dot(normalWorld, normalize(vec3(0.5, 1, 0.3))).mul(0.5).add(0.5)
      const band = floor(l.mul(3).add(0.5)).div(3)
      const m = new MeshBasicNodeMaterial()
      m.colorNode = vec3(band.mul(0.75).add(0.25))
      return m
    },
  },
  {
    name: 'checker',
    make: () => std({ colorNode: mix(vec3(0.3), vec3(1), mod(floor(pw.x.mul(2)).add(floor(pw.y.mul(2))).add(floor(pw.z.mul(2))), 2)) }),
  },
  { name: 'height rainbow', make: () => std({ colorNode: hue(fract(pw.y.mul(0.04).add(time.mul(0.02)))) }) },
  {
    name: 'plasma',
    make: () => {
      const v = sin(pw.x.mul(1.5).add(time)).add(sin(pw.y.mul(1.3).sub(time.mul(1.3)))).add(sin(pw.x.add(pw.z).mul(0.9).add(time.mul(0.7))))
      return std({ colorNode: hue(v.mul(0.1).add(time.mul(0.05))) })
    },
  },
  { name: 'chrome', make: () => std({ colorNode: vec3(0.9), emissiveNode: vec3(0.6, 0.7, 0.9).mul(fresnel(3)).mul(0.5), metalness: 1, roughness: 0.15 }) },
  {
    name: 'neon',
    make: () => {
      const m = new MeshBasicNodeMaterial()
      m.colorNode = vec3(1).mul(uOnset.mul(1.2).add(1.3))
      m.toneMapped = false
      return m
    },
  },
  {
    name: 'cracks',
    make: () => {
      const w = mx_worley_noise_float(pw.mul(2))
      const e = smoothstep(0.02, 0.12, w)
      return std({ colorNode: mix(vec3(0.05), vec3(1), e), emissiveNode: float(1).sub(e).mul(vec3(1, 0.5, 0.1)).mul(uEnergy.mul(2).add(0.2)) })
    },
  },
  { name: 'rainbow flow', make: () => std({ colorNode: hue(pw.x.mul(0.05).add(pw.y.mul(0.03)).sub(time.mul(0.15))) }) },
  {
    name: 'dots',
    make: () => std({ colorNode: mix(vec3(1), vec3(0.15), smoothstep(0.2, 0.15, length(fract(pw.xy.mul(3)).sub(0.5)))) }),
  },
  {
    name: 'fire',
    make: () => {
      const n = mx_fractal_noise_float(vec3(pw.x, pw.y.sub(time.mul(1.5)), pw.z).mul(2)).mul(0.5).add(0.5)
      return std({ colorNode: vec3(0.2), emissiveNode: mix(vec3(1, 0.1, 0), vec3(1, 0.9, 0.3), n).mul(n).mul(uTreble.mul(1.5).add(0.6)), roughness: 0.9 })
    },
  },
  {
    name: 'x-ray',
    make: () => {
      const m = new MeshBasicNodeMaterial()
      m.colorNode = vec3(0.4, 0.8, 1).mul(fresnel(2).mul(0.9).add(0.05))
      m.transparent = true
      m.blending = THREE.AdditiveBlending
      m.depthWrite = false
      return m
    },
  },
  {
    name: 'pulse',
    make: () => {
      const wave = sin(pw.y.mul(2).sub(time.mul(4))).mul(0.5).add(0.5)
      return std({ colorNode: vec3(0.35).add(wave.mul(0.65)), emissiveNode: vec3(wave).mul(uBeat.add(uOnset)).mul(0.8) })
    },
  },
]

/** Index of the first animated surface (materials.ts). Indices never move: presets and looks store them. */
export const ANIMATED_START = BASE_GROWTH_SHADERS.length
export const GROWTH_SHADERS: ShaderDef[] = [...BASE_GROWTH_SHADERS, ...ANIMATED_SHADERS]

/** Sky-sphere backgrounds: colour by view direction (the sphere is rendered from inside). */
export const ENV_SHADERS: ShaderDef[] = [
  { name: 'black', make: () => null },
  {
    name: 'starfield',
    make: () => {
      const d = normalize(pw)
      const cell = floor(d.mul(420))
      const h = hash(dot(cell, vec3(1, 57, 113)))
      const star = step(0.996, h)
      const tw = sin(time.mul(2).add(h.mul(60))).mul(0.4).add(0.6)
      const m = new MeshBasicNodeMaterial()
      m.colorNode = vec3(star.mul(tw).mul(uEnergy.mul(0.6).add(0.7)))
      m.side = THREE.BackSide
      m.fog = false
      return m
    },
  },
  {
    name: 'nebula',
    make: () => {
      const d = normalize(pw)
      const n = mx_fractal_noise_float(d.mul(2).add(time.mul(0.02))).mul(0.5).add(0.5)
      const m = new MeshBasicNodeMaterial()
      m.colorNode = mix(vec3(0.02, 0.02, 0.1), vec3(0.45, 0.1, 0.5), pow(n, 2)).mul(uEnergy.mul(0.8).add(0.5))
      m.side = THREE.BackSide
      m.fog = false
      return m
    },
  },
  {
    name: 'gradient',
    make: () => {
      const d = normalize(pw)
      const m = new MeshBasicNodeMaterial()
      m.colorNode = mix(vec3(0.12, 0.03, 0.08), vec3(0.02, 0.06, 0.16), d.y.mul(0.5).add(0.5))
      m.side = THREE.BackSide
      m.fog = false
      return m
    },
  },
  {
    name: 'grid horizon',
    make: () => {
      const d = normalize(pw)
      const p = d.xz.div(abs(d.y).add(0.03)).mul(3)
      const g = step(0.94, max(fract(p.x), fract(p.y)))
      const below = step(d.y, float(0))
      const fade = smoothstep(0.0, 0.25, abs(d.y))
      const m = new MeshBasicNodeMaterial()
      m.colorNode = vec3(0.1, 0.8, 1).mul(g).mul(below).mul(fade).mul(uBeat.mul(1.5).add(0.6))
      m.side = THREE.BackSide
      m.fog = false
      return m
    },
  },
  {
    name: 'aurora',
    make: () => {
      const d = normalize(pw)
      const n = mx_noise_float(d.mul(3).add(time.mul(0.1)))
      const band = sin(d.x.mul(3).add(time.mul(0.3)).add(n.mul(4))).mul(0.5).add(0.5)
      const m = new MeshBasicNodeMaterial()
      m.colorNode = mix(vec3(0, 0.5, 0.3), vec3(0.2, 0.2, 0.7), band).mul(smoothstep(0.05, 0.6, d.y)).mul(band).mul(uEnergy.mul(0.7).add(0.6))
      m.side = THREE.BackSide
      m.fog = false
      return m
    },
  },
  {
    name: 'deep sea',
    make: () => {
      const d = normalize(pw)
      const caustic = pow(float(1).sub(mx_worley_noise_float(d.xz.mul(6).add(time.mul(0.15)))), 4)
      const m = new MeshBasicNodeMaterial()
      m.colorNode = mix(vec3(0.0, 0.02, 0.06), vec3(0.0, 0.25, 0.4), d.y.mul(0.5).add(0.5)).add(vec3(0.2, 0.5, 0.6).mul(caustic).mul(smoothstep(0.2, 0.9, d.y)))
      m.side = THREE.BackSide
      m.fog = false
      return m
    },
  },
  {
    // a lit world, not a backdrop: its colours, fog, reflections and the light-background
    // adaptations come from organism/haze.ts
    name: 'haze',
    make: () => {
      const m = new MeshBasicNodeMaterial()
      m.colorNode = hazeSky(normalize(pw.sub(cameraPosition)), true)
      m.side = THREE.BackSide
      m.fog = false
      return m
    },
  },
]

/** ENV_SHADERS index of the haze world */
export const HAZE_ENV = ENV_SHADERS.findIndex((s) => s.name === 'haze')
