// Adaptive quality (k2 P8, the render-side subset). When the frame rate sags, give up what the
// picture misses least, in order: bloom resolution, bloom, render scale, then the heavier effects
// (soft surfaces reshape at half rate, the note light goes out). Win them back one step at a time
// after a long stretch of headroom; a step back up that cannot hold waits twice as long before it
// is tried again, so the tier settles instead of see-sawing. Steps that do not raise the rate are
// undone: a CPU-bound set or a 30 fps battery saver keeps its full picture. v0.20 only moved the
// pixel ratio, every 1.5 s, down to half on any slow machine, reallocating the canvas and bloom
// targets each time.
//
// A pure state machine: the engine applies the tier, and stops calling update() while a take
// records (lockQuality), so a recording never changes quality mid-file.
//
// `load` is the share of the optional scenery (the flight's debris and ambient web, organism/
// debris.ts and flight.ts) a tier keeps: it is the first thing given up, from the first step down.

export interface QualityTier {
  /** HUD label */
  name: string
  /** bloom's buffers relative to the canvas; 0 = no bloom pass */
  bloomRes: number
  /** share of the pixel-ratio ceiling (the render scale knob, capped by the display) */
  px: number
  /** false: the heavier effects run light */
  fx: boolean
  /** share of the optional scenery kept: debris particles, the ambient web */
  load: number
}

export const QUALITY_TIERS: readonly QualityTier[] = [
  { name: 'High', bloomRes: 0.5, px: 1, fx: true, load: 1 },
  { name: 'High · light bloom', bloomRes: 0.25, px: 1, fx: true, load: 0.6 },
  { name: 'Medium · no bloom', bloomRes: 0, px: 1, fx: true, load: 0.45 },
  { name: 'Medium · 80% scale', bloomRes: 0, px: 0.8, fx: true, load: 0.35 },
  { name: 'Low · 65% scale', bloomRes: 0, px: 0.65, fx: true, load: 0.25 },
  { name: 'Potato · 50% scale, light effects', bloomRes: 0, px: 0.5, fx: false, load: 0.15 },
]

/** below this share of the target rate for DOWN_AFTER seconds: one step down */
const DOWN_AT = 0.75
const DOWN_AFTER = 2
/** above this share for the (growing) wait: one step up */
const UP_AT = 0.95
const UP_WAIT = 6
const UP_WAIT_MAX = 60
/** a step down this soon after a step up means the step up failed */
const FAILED_WITHIN = 5
/** a step down that raised the rate by less than this bought nothing */
const GAIN = 1.08
/** after two such steps: undo them and hold this long (doubling) before trying again */
const HOLD = 20
const HOLD_MAX = 320
/** the HUD names a new tier for this long */
const SHOW_FOR = 4

export class QualityGovernor {
  tier = 0
  private changedAt = -Infinity
  private below = 0
  private above = 0
  private upWait = UP_WAIT
  private lastUp = -Infinity
  /** the rate just before the last step down (0 = not judging one) */
  private fpsAtStep = 0
  private futile = 0
  private holdUntil = -Infinity
  private holdFor = HOLD

  get current(): QualityTier {
    return QUALITY_TIERS[this.tier]
  }

  /**
   * One frame at `fps` (smoothed) against `target` (the display's rate or the frame cap). True when
   * the tier changed.
   */
  update(fps: number, target: number, dt: number, t: number): boolean {
    if (fps < target * DOWN_AT) {
      this.below += dt
      this.above = 0
    } else if (fps > target * UP_AT) {
      this.above += dt
      this.below = 0
    } else {
      // in between: neither verdict builds up
      this.below = Math.max(0, this.below - dt)
      this.above = Math.max(0, this.above - dt)
    }
    if (this.below > DOWN_AFTER && this.tier < QUALITY_TIERS.length - 1 && t >= this.holdUntil) {
      // Steps that buy nothing mean the limit is elsewhere (the CPU, a 30 Hz battery saver, a
      // capped display): two in a row are undone rather than blurring the picture for nothing.
      if (this.fpsAtStep > 0 && fps < this.fpsAtStep * GAIN) {
        if (++this.futile >= 2) {
          this.futile = 0
          this.fpsAtStep = 0
          this.holdUntil = t + this.holdFor
          this.holdFor = Math.min(HOLD_MAX, this.holdFor * 2)
          return this.set(Math.max(0, this.tier - 2), t)
        }
      } else this.futile = 0
      if (t - this.lastUp < FAILED_WITHIN) this.upWait = Math.min(UP_WAIT_MAX, this.upWait * 2)
      this.fpsAtStep = fps
      return this.set(this.tier + 1, t)
    }
    if (this.above > this.upWait && this.tier > 0) {
      this.lastUp = t
      this.fpsAtStep = 0
      this.futile = 0
      return this.set(this.tier - 1, t)
    }
    return false
  }

  /** Back to full quality (auto quality switched off, or a fresh engine). */
  reset(t: number): boolean {
    this.upWait = UP_WAIT
    this.holdFor = HOLD
    this.holdUntil = -Infinity
    this.fpsAtStep = 0
    this.futile = 0
    return this.tier !== 0 && this.set(0, t)
  }

  /** The HUD's note while a change is recent ('' otherwise). */
  note(t: number): string {
    return t - this.changedAt < SHOW_FOR ? `Q: ${this.current.name} (auto)` : ''
  }

  private set(tier: number, t: number): boolean {
    this.tier = tier
    this.changedAt = t
    this.below = this.above = 0
    return true
  }
}
