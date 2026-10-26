import { describe, expect, it } from 'vitest'
import { CAM, CAM_MODES, endless, fitDistance, travels } from './camera'

const rad = (deg: number) => (deg * Math.PI) / 180

describe('fitDistance', () => {
  it('90° square view, no margin: the sphere touches the frame at r·√2', () => {
    expect(fitDistance(1, 90, 1, 1)).toBeCloseTo(Math.SQRT2, 12)
    expect(fitDistance(3, 90, 1, 1)).toBeCloseTo(3 * Math.SQRT2, 12)
  })

  it('scales linearly with radius and margin (default margin 1.12)', () => {
    const d = fitDistance(2, 50, 16 / 9, 1)
    expect(fitDistance(4, 50, 16 / 9, 1)).toBeCloseTo(2 * d, 12)
    expect(fitDistance(2, 50, 16 / 9)).toBeCloseTo(1.12 * d, 12)
  })

  it('landscape is limited by the height, portrait by the width', () => {
    const square = fitDistance(1, 50, 1)
    expect(fitDistance(1, 50, 16 / 9)).toBeCloseTo(square, 12)
    expect(fitDistance(1, 50, 3)).toBeCloseTo(square, 12)
    const portrait = fitDistance(1, 50, 9 / 16)
    expect(portrait).toBeGreaterThan(square)
    // the framed sphere is tangent to the narrower (horizontal) half-angle
    const halfX = Math.atan(Math.tan(rad(25)) * (9 / 16))
    expect(Math.asin(1.12 / portrait)).toBeCloseTo(halfX, 12)
  })

  it('a panel covering part of the view pushes the camera back only when it narrows the limiting side', () => {
    const d = fitDistance(1, 50, 16 / 9)
    expect(fitDistance(1, 50, 16 / 9, 1.12, 0, 0.2)).toBeGreaterThan(d) // top panel: height limits
    // a 30% side panel still leaves a 16:9 view wider than tall: unchanged
    expect(fitDistance(1, 50, 16 / 9, 1.12, 0.3, 0)).toBeCloseTo(d, 12)
    // half the width covered: now the width limits
    const half = fitDistance(1, 50, 16 / 9, 1.12, 0.5, 0)
    expect(half).toBeGreaterThan(d)
    expect(Math.asin(1.12 / half)).toBeCloseTo(Math.atan(Math.tan(rad(25)) * (16 / 9) * 0.5), 12)
  })
})

describe('camera modes', () => {
  it('indices are saved in presets and URLs: the table keeps its meaning', () => {
    expect(CAM_MODES.length).toBe(Object.keys(CAM).length)
    expect(CAM_MODES[CAM.orbit]).toBe('orbit')
    expect(CAM_MODES[CAM.tipGlide]).toBe('tip glide')
    expect(CAM_MODES[CAM.framed]).toBe('framed')
    expect(CAM_MODES[CAM.director]).toBe('director')
    expect(CAM.flight).toBe(11)
    expect(CAM_MODES[CAM.flight]).toMatch(/^flight/)
  })

  it('tunnel and flight fly on for ever (no shell, no bounds, passed growth culled)', () => {
    const forever = CAM_MODES.map((_, i) => i).filter(endless)
    expect(forever).toEqual([CAM.tunnel, CAM.flight])
  })

  it('only weave … chase travel among the growth', () => {
    const moving = CAM_MODES.map((_, i) => i).filter(travels)
    expect(moving).toEqual([CAM.weave, CAM.tunnel, CAM.drift, CAM.sit, CAM.chase])
  })
})
