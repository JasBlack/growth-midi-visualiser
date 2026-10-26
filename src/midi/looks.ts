// Authored looks for Simple mode and "Surprise me". Pure data and maths (no DOM): the card in
// simpleUi.ts applies them through the control registry, so presets, MIDI learn, search and
// saved settings see the same values as the Advanced panel. A look sets the macros' bases
// (macros.ts): the performance knobs scale around it.
//
// Names, not indices: species, palettes and growth shaders are looked up by name when a look
// applies, so a reorder never silently changes a look (v0.19 hard-coded shader 22 and 27).
// The music response stays at the Organism defaults ("Obvious"): v0.19's looks cut growth to
// 0.315x and new segments to 16%, which hid the music.
//
// The camera stays the performer's (the Simple card's camera style), except in a look that is a
// camera move itself: Webs flies through its web. Flight is a camera like any other: a look chosen
// while flying keeps flying, through its own growth in its own world.

import { CAM } from './engines/organism/camera'
import { HAZE_TONES, type HazeTone } from './engines/organism/haze'

export interface LookRecipe {
  id: string
  label: string
  /** SPECIES[].name; the first is the main one */
  species: string[]
  /** species choice: 0 by note, 1 by octave, 2 random, 3 cycle */
  speciesMode: number
  /** PALETTES[].name: [0] is the authored one, the rest are Surprise candidates */
  palettes: string[]
  /** growth shader names, like palettes */
  shaders: string[]
  /** organism control key → value, over LOOK_BASE */
  values: Readonly<Record<string, number>>
  /** the sky (ENV_SHADERS name), looked up like the shaders; none: black space */
  sky?: string
  /** a camera mode (CAM) and camera speed the look flies with; none: the performer's camera stays */
  camera?: { mode: number; speed: number }
}

/** The haze world's controls for one of its tones (organism/haze.ts). */
const haze = (t: HazeTone) => ({ hazeHue: t.hue, hazeSat: t.sat, hazeBright: t.bright, hazeGlow: t.glow })

/**
 * What every look sets, so a look is the same whatever was loaded before (a wild preset leaves
 * no nebula sky, typography or beat-lock behind; Webs leaves no debris or haze). Not here, on
 * purpose: camera (lookCamera below), source / model (video*, shell*), stems, performance
 * (budget, quality), tip limit and screen bounce.
 */
export const LOOK_BASE: Readonly<Record<string, number>> = {
  wild: 0, nested: 0, physics: 0, seasons: 0, cycleEvery: 0, beatLock: 0, text: 0,
  // the Organism's "Obvious" music response (step 4 defaults)
  speed: 1, musicAmount: 1, sustain: 1.5, fillRate: 1500, musicFocus: 0.5, musicTrail: 2.5,
  thickness: 1, nodes: 1, length: 1, branch: 1, wiggle: 1, lignify: 1.6, join: 1, retract: 1, maxLive: 24, cohesion: 0.35,
  react: 1, pulse: 0.6, flash: 0.6, kick: 0.5, shake: 0.15, speedReact: 0.6, lightReact: 1, glow: 1,
  // bloom on (only bright things glow) and the rim that lets thin growth read on black
  bloom: 0.8, rim: 0.8, env: 0, envShader: 0,
  materialSpeed: 0.8, materialScale: 1, materialReact: 1,
  softWave: 1, softReact: 1, softSpeed: 0.8, softIdle: 0.05, softFollow: 1,
  tipShape: 0, tipSize: 1, tipBrightness: 1,
  // note events (organism/ignition.ts): flare, shock ring, attack lunge, envelope 2 = strike
  ignite: 1, igniteRing: 0.6, lunge: 1, envelope: 2,
  // energy arcs (organism/song.ts): builds, drops and breakdowns, modest
  songResponse: 0.5,
  // pitch → space, harmony → structure, velocity → weight (organism/layout.ts): free roots unless a look picks a layout
  layout: 0, layoutSpread: 1, harmony: 0.6, velocityLook: 1,
  // conduction and age grading (organism/conduction.ts) at their defaults
  conduct: 1, conductBeat: 1, ageGrade: 0.6,
  // music breath (organism/breath.ts): growth reaches out with the music, draws back when it is quiet
  breath: 0.55,
  // the Webs scenery (organism/flight.ts, debris.ts, haze.ts): no debris, ambient web or ribbons;
  // the flight itself at its defaults (any look can fly)
  debris: 0, debrisSize: 1, debrisReact: 1, debrisDrift: 1,
  flightWander: 1, flightRoll: 1, flightReact: 0.8, flightFill: 0, flightRibbons: 0,
  ...haze(HAZE_TONES.mist), hazeLines: 1, hazeFog: 1, hazeReflect: 1,
}

/** Shared knobs a look resets (the Organism reads growth as a speed multiplier and decay for dormant growth). */
export const LOOK_GLOBALS: Readonly<Record<string, number>> = { growth: 1, decay: 0.15, rotSpeed: 0, beatZoom: 0 }

export const LOOKS: readonly LookRecipe[] = [
  {
    id: 'roots',
    label: 'Roots',
    species: ['roots', 'fungi'],
    speciesMode: 1,
    palettes: ['forest', 'ember', 'mono'],
    shaders: ['marble', 'mottle', 'veins'],
    // strata: the bass roots down into the dark, the melody branches up into a canopy
    values: { branch: 0.8, wiggle: 1.15, length: 0.9, thickness: 1.15, nodes: 0.7, layout: 1, breath: 0.6 },
  },
  {
    id: 'coral',
    label: 'Coral',
    species: ['corals', 'staghorn coral', 'sea fan'],
    speciesMode: 1,
    palettes: ['candy', 'ocean', 'ember'],
    shaders: ['mottle', 'scales', 'pearl currents'],
    // coral breathes slowly in and out, like polyps
    values: { branch: 0.9, wiggle: 0.7, length: 0.85, thickness: 1.25, nodes: 0.9, breath: 0.5 },
  },
  {
    id: 'neural',
    label: 'Neural',
    species: ['neuron', 'veins'],
    speciesMode: 1,
    palettes: ['spectrum', 'acid', 'ocean'],
    shaders: ['veins', 'biolume', 'electric filaments'],
    // fifths: consonant notes wire up together, a clash stands apart
    values: { branch: 0.9, wiggle: 1.2, length: 0.85, thickness: 0.8, nodes: 1.15, glow: 1.4, igniteRing: 0.8, layout: 3, breath: 0.55 },
  },
  {
    id: 'crystal',
    label: 'Crystal',
    species: ['crystals', 'snowflake'],
    speciesMode: 1,
    // chrome has nothing to mirror in black space: iridescent first, and shards thick enough to read
    palettes: ['ocean', 'mono', 'spectrum'],
    shaders: ['iridescent', 'chrome', 'mercury ribbons'],
    // shards snap out and stop (the pluck envelope); more growth per note makes up for the short release.
    // Helix: pitch class round a loose spiral, so a scale climbs through the cluster
    // (shards withdraw less: a crystal keeps its form between phrases)
    values: { branch: 0.6, wiggle: 0.35, length: 1.15, thickness: 1.6, nodes: 1.1, glow: 1.2, envelope: 1, igniteRing: 0.8, musicAmount: 1.4, layout: 2, breath: 0.45 },
  },
  {
    id: 'liquid',
    label: 'Liquid',
    species: ['liquid', 'liquid droplet', 'jelly bell'],
    speciesMode: 0,
    palettes: ['ocean', 'acid', 'candy'],
    shaders: ['tidal glass', 'oil slick', 'biolume'],
    // surfaces swell rather than snap
    values: { branch: 0.4, wiggle: 0.6, length: 0.9, thickness: 1.2, nodes: 0, softWave: 1.1, softReact: 1.2, softSpeed: 0.7, envelope: 3, lunge: 0.5, igniteRing: 0.35, breath: 0.6 },
  },
  {
    id: 'silk',
    label: 'Silk',
    species: ['silk ribbon', 'pleated silk', 'spiral streamer'],
    speciesMode: 0,
    palettes: ['candy', 'mono', 'spectrum'],
    shaders: ['silk shimmer', 'aurora weave', 'pearl currents'],
    values: { branch: 0.3, wiggle: 0.5, length: 0.9, thickness: 0.9, nodes: 0, softWave: 0.9, softReact: 1, softSpeed: 0.6, envelope: 3, lunge: 0.5, igniteRing: 0.3, breath: 0.6 },
  },
  webs('webs', 'Webs', HAZE_TONES.mist, {}),
  // the dark variant: silver threads in the palette's colours (ink only reads on a light world)
  webs('webs-night', 'Webs (night)', HAZE_TONES.ink, { bloom: 0.45, ignite: 0.5 }),
]

/**
 * "Webs" (docs/webs-ref): a flight through a tangle of threads in a haze, chrome ribbons sweeping
 * past on the accents, debris drifting. The ambient web and the ribbons come from the flight
 * (organism/flight.ts) whatever the toggles, and only while the music sounds; played notes grow
 * threads in the low and middle octaves and chrome ribbons above. Everything breathes with the music.
 */
function webs(id: string, label: string, tone: HazeTone, over: Record<string, number>): LookRecipe {
  return {
    id,
    label,
    species: ['threads', 'chrome ribbon'],
    speciesMode: 1,
    palettes: ['smoke', 'mono', 'ocean'],
    shaders: ['standard'],
    sky: 'haze',
    camera: { mode: CAM.flight, speed: 0.7 },
    // A light world wants ink, not light: no tip markers, rim, rings or pulses to wash out, a small
    // flare and swell. The web as dense as the budget allows (the quality tiers thin it first).
    values: {
      ...haze(tone),
      debris: 1,
      flightFill: 2,
      flightRibbons: 1,
      breath: 0.5,
      // hundreds of strands grow at once: any cap on new segments starves the older ones short
      // (the flight bounds the web by strand count, growth time and its share of the budget)
      fillRate: 0,
      // a little less atmosphere than the haze's default: the far core stays a dark tangle
      hazeFog: 0.8,
      thickness: 1,
      branch: 0.6,
      wiggle: 1,
      nodes: 0,
      glow: 0,
      rim: 0,
      bloom: 0.35,
      ignite: 0.35,
      igniteRing: 0,
      lunge: 0.7,
      conduct: 0.3,
      flash: 0.25,
      pulse: 0.35,
      kick: 0.2,
      shake: 0.05,
      musicFocus: 0.3,
      ...over,
    },
  }
}

/** Surprise varies these by ±12% around the look. */
const VARY = ['branch', 'wiggle', 'length', 'thickness']

export interface ResolvedLook {
  label: string
  /** species indices switched on (all others off) */
  speciesOn: Set<number>
  speciesMode: number
  palette: number
  shader: number
  values: Record<string, number>
  /** names that did not resolve (reported, the rest still applies) */
  missing: string[]
}

/**
 * Resolve a recipe against the engine's current name lists. `surprise` picks the palette and
 * shader among the look's candidates and varies the shape by ±12%; without it the look is
 * exactly as authored.
 */
export function resolveLook(r: LookRecipe, names: { species: readonly string[]; palettes: readonly string[]; shaders: readonly string[]; skies?: readonly string[] }, surprise: (() => number) | null): ResolvedLook {
  const missing: string[] = []
  const find = (list: readonly string[], name: string) => {
    const i = list.indexOf(name)
    if (i < 0) missing.push(name)
    return i
  }
  const speciesOn = new Set<number>()
  for (const s of r.species) {
    const i = find(names.species, s)
    if (i >= 0) speciesOn.add(i)
  }
  const pick = (list: string[]) => (surprise ? list[Math.floor(surprise() * list.length)] : list[0])
  const values: Record<string, number> = { ...LOOK_BASE, ...r.values }
  if (surprise) for (const k of VARY) values[k] = +(values[k] * (0.88 + surprise() * 0.24)).toFixed(3)
  if (r.sky && names.skies) values.envShader = Math.max(0, find(names.skies, r.sky))
  return {
    label: r.label,
    speciesOn,
    speciesMode: r.speciesMode,
    palette: Math.max(0, find(names.palettes, pick(r.palettes))),
    shader: Math.max(0, find(names.shaders, pick(r.shaders))),
    values,
    missing,
  }
}

/** framed mode's camera speed (simpleUi.ts: the camera style "Framed") */
export const FRAMED_SPEED = 0.5

/**
 * The camera keys a look writes: its own camera, else nothing (the performer's camera stays,
 * flight included: any look can be flown through).
 */
export function lookCamera(r: LookRecipe): Record<string, number> {
  return r.camera ? { camMode: r.camera.mode, orbit: r.camera.speed } : {}
}

/** A look other than `last` (uniform over the rest). */
export function pickSurprise(count: number, last: number, rng: () => number): number {
  if (count < 2 || last < 0 || last >= count) return Math.floor(rng() * count)
  const i = Math.floor(rng() * (count - 1))
  return i >= last ? i + 1 : i
}
