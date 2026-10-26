import { describe, expect, it } from 'vitest'
import { TAP_RATE } from './pcmTap'
import { avcLevel, bitrateFor, captureSize, dueSlot, slotSampleCount, slotTimestamp, vp9Level } from './recorder'

const canvas = (width: number, height: number) => ({ width, height }) as HTMLCanvasElement

describe('captureSize', () => {
  it('fixed sizes are 16:9 and even; no canvas falls back to 1080p', () => {
    expect(captureSize('1080', null)).toEqual({ width: 1920, height: 1080 })
    expect(captureSize('1440', canvas(7, 7))).toEqual({ width: 2560, height: 1440 })
    expect(captureSize('2160', null)).toEqual({ width: 3840, height: 2160 })
    expect(captureSize('canvas', null)).toEqual({ width: 1920, height: 1080 })
    expect(captureSize('canvas', canvas(1, 1))).toEqual({ width: 1920, height: 1080 })
  })

  it('canvas: rounded down to even, scaled to fit 4K (either orientation), aspect kept', () => {
    expect(captureSize('canvas', canvas(1001, 601))).toEqual({ width: 1000, height: 600 })
    expect(captureSize('canvas', canvas(3, 3))).toEqual({ width: 2, height: 2 })
    expect(captureSize('canvas', canvas(5000, 3000))).toEqual({ width: 3600, height: 2160 })
    expect(captureSize('canvas', canvas(1080, 1920))).toEqual({ width: 1080, height: 1920 })
    for (const [w, h] of [[2561, 1441], [7680, 1000], [999, 4321], [3841, 2161]]) {
      const s = captureSize('canvas', canvas(w, h))
      expect(s.width % 2 === 0 && s.height % 2 === 0).toBe(true)
      expect(Math.max(s.width, s.height)).toBeLessThanOrEqual(3840)
      expect(Math.min(s.width, s.height)).toBeLessThanOrEqual(2160)
      expect(Math.abs(s.width / s.height - w / h) / (w / h)).toBeLessThan(0.01)
    }
  })
})

describe('bitrates and codec levels', () => {
  it('presets at 1080p30 are 12 / 24 / 40 Mbps; 60 fps gets half as much again; bounded 2–100 Mbps in 100 k steps', () => {
    expect([bitrateFor('standard', 1920, 1080, 30), bitrateFor('high', 1920, 1080, 30), bitrateFor('max', 1920, 1080, 30)]).toEqual([12e6, 24e6, 40e6])
    expect(bitrateFor('high', 1920, 1080, 60)).toBe(36e6)
    expect(bitrateFor('standard', 3840, 2160, 30)).toBe(36.4e6) // area 4× → 4^0.8 ≈ 3.03×
    expect(bitrateFor('max', 3840, 2160, 60)).toBe(100e6)
    expect(bitrateFor('standard', 64, 64, 30)).toBe(2e6)
    expect(bitrateFor('high', 2560, 1440, 30) % 1e5).toBe(0)
  })

  it('H.264: the lowest level that covers frame size, rate and bitrate (Main pays 1.25× bitrate)', () => {
    const b = (w: number, h: number, fps: number) => bitrateFor('high', w, h, fps)
    expect(avcLevel(1920, 1080, 30, b(1920, 1080, 30), true)).toBe(0x28) // 4.0: avc1.640028
    expect(avcLevel(1920, 1080, 30, b(1920, 1080, 30), false)).toBe(0x29) // 30 Mbps effective: 4.1
    expect(avcLevel(1920, 1080, 60, b(1920, 1080, 60), true)).toBe(0x2a)
    expect(avcLevel(2560, 1440, 30, b(2560, 1440, 30), true)).toBe(0x32)
    expect(avcLevel(3840, 2160, 30, b(3840, 2160, 30), true)).toBe(0x33)
    expect(avcLevel(3840, 2160, 60, b(3840, 2160, 60), true)).toBe(0x34)
    expect(avcLevel(8192, 8192, 120, 1e9, true)).toBe(0x34) // nothing covers it: the highest
  })

  it('VP9: level by luma picture size and rate', () => {
    expect(vp9Level(1920, 1080, 30)).toBe(40)
    expect(vp9Level(1920, 1080, 60)).toBe(41)
    expect(vp9Level(2560, 1440, 30)).toBe(50)
    expect(vp9Level(3840, 2160, 60)).toBe(51)
  })
})

describe('constant frame rate', () => {
  it.each([24, 30, 60])('%i fps: timestamps are n/fps in µs, step evenly, and never drift over an hour', (fps) => {
    let prev = slotTimestamp(0, fps)
    expect(prev).toBe(0)
    const frame = 1e6 / fps
    for (let n = 1; n <= fps * 60; n++) {
      const ts = slotTimestamp(n, fps)
      expect(Math.abs(ts - prev - frame)).toBeLessThanOrEqual(1)
      prev = ts
    }
    expect(slotTimestamp(fps * 3600, fps)).toBe(3600e6)
  })

  it('audio samples match the video slots exactly at 48 kHz', () => {
    expect(TAP_RATE).toBe(48000)
    expect(slotSampleCount(1, 30)).toBe(1600)
    expect(slotSampleCount(1, 60)).toBe(800)
    expect(slotSampleCount(30 * 3600, 30)).toBe(48000 * 3600)
    for (const fps of [24, 30, 60]) for (const n of [1, 7, 1001]) expect(Math.abs(slotSampleCount(n, fps) / TAP_RATE - slotTimestamp(n, fps) / 1e6)).toBeLessThan(1 / TAP_RATE)
  })

  it('a render lands in the slot its audio-clock time falls in, even on an exact boundary', () => {
    const t0 = 123.456789
    for (let k = 0; k < 20000; k++) expect(dueSlot(0, t0, t0 + k / 60, 60)).toBe(k)
    expect(dueSlot(0, t0, t0 + 1 / 60 - 1e-4, 60)).toBe(0) // just before the boundary: still slot 0
    expect(dueSlot(500, t0, t0 + 1, 30)).toBe(530) // after a cut, counting on from the stretch's first slot
  })
})
