// Thumbnails for the look tiles (Code Painter's style tiles): a small drawing per look in its own
// palette and growth habit — roots hang and canopy, coral fans, neurons wire, crystals shard,
// liquid pools, silk ribbons, webs tangle in their haze. Drawn once on a 2D canvas with a fixed
// seed, so the tiles are distinct and stable; no live rendering, nothing to load.

import { PALETTES, cosPalette, rgbCss, type Palette } from '../color'

const PX = 160

type Ctx = CanvasRenderingContext2D
type Rng = () => number

function seeded(seed: number): Rng {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const pal = (name: string): Palette => PALETTES.find((p) => p.name === name) ?? PALETTES[0]
const tone = (p: Palette, t: number, a = 1) => rgbCss(cosPalette(p, t), a)

interface Habit {
  /** radians of turn per step, random */
  wiggle: number
  /** pull toward this heading (radians), per step */
  pull: number
  heading: number
  /** chance per step of a side branch */
  fork: number
  spread: number
  step: number
  depth: number
  colour(depth: number, along: number): string
  tip?(g: Ctx, x: number, y: number, depth: number): unknown
}

/** One wandering branch and its side branches; width tapers to the tip. */
function branch(g: Ctx, r: Rng, h: Habit, x: number, y: number, a: number, len: number, w: number, depth: number) {
  const n = Math.max(2, Math.round(len / h.step))
  for (let i = 0; i < n; i++) {
    const along = i / n
    let d = a - h.heading
    d = Math.atan2(Math.sin(d), Math.cos(d))
    a += (r() - 0.5) * h.wiggle - d * h.pull
    const nx = x + Math.cos(a) * h.step
    const ny = y + Math.sin(a) * h.step
    g.strokeStyle = h.colour(depth, along)
    g.lineWidth = Math.max(0.6, w * (1 - along * 0.7))
    g.beginPath()
    g.moveTo(x, y)
    g.lineTo(nx, ny)
    g.stroke()
    if (depth < h.depth && r() < h.fork) {
      const side = r() < 0.5 ? -1 : 1
      branch(g, r, h, nx, ny, a + side * h.spread * (0.6 + r() * 0.6), len * (0.45 + r() * 0.25) * (1 - along * 0.5), w * 0.6, depth + 1)
    }
    x = nx
    y = ny
  }
  h.tip?.(g, x, y, depth)
}

function glowDot(g: Ctx, x: number, y: number, rad: number, colour: string) {
  const grd = g.createRadialGradient(x, y, 0, x, y, rad)
  grd.addColorStop(0, colour)
  grd.addColorStop(1, 'rgba(0,0,0,0)')
  g.fillStyle = grd
  g.fillRect(x - rad, y - rad, rad * 2, rad * 2)
}

function roots(g: Ctx, r: Rng) {
  const p = pal('forest')
  g.lineCap = 'round'
  const habit = (heading: number, pull: number): Habit => ({
    wiggle: 0.45, pull, heading, fork: 0.13, spread: 0.75, step: 3, depth: 4,
    colour: (d, al) => tone(p, 0.62 + d * 0.08 + al * 0.12, 1 - d * 0.14),
    tip: (gg, x, y, d) => d > 1 && glowDot(gg, x, y, 5, tone(p, 0.8, 0.9)),
  })
  glowDot(g, 80, 70, 26, tone(p, 0.7, 0.35))
  // the bass roots down into the dark, the melody branches up into a canopy
  for (let i = 0; i < 5; i++) branch(g, r, habit(Math.PI / 2, 0.05), 80 + (r() - 0.5) * 16, 70, Math.PI / 2 + (r() - 0.5) * 1.8, 82, 3.6, 0)
  for (let i = 0; i < 4; i++) branch(g, r, habit(-Math.PI / 2, 0.04), 80 + (r() - 0.5) * 10, 70, -Math.PI / 2 + (r() - 0.5) * 1.4, 62, 3, 1)
}

function coral(g: Ctx, r: Rng) {
  const p = pal('candy')
  g.lineCap = 'round'
  const h: Habit = {
    wiggle: 0.35, pull: 0.03, heading: -Math.PI / 2, fork: 0.16, spread: 0.55, step: 3.5, depth: 3,
    colour: (d, al) => tone(p, 0.1 + d * 0.15 + al * 0.2),
    tip: (gg, x, y, d) => {
      gg.fillStyle = tone(p, 0.55 + d * 0.1)
      gg.beginPath()
      gg.arc(x, y, 3.2 - d * 0.5, 0, Math.PI * 2)
      gg.fill()
    },
  }
  for (let i = 0; i < 5; i++) branch(g, r, h, 80 + (i - 2) * 9, 150, -Math.PI / 2 + (i - 2) * 0.32, 58 + r() * 26, 7, 0)
}

function neural(g: Ctx, r: Rng) {
  const p = pal('spectrum')
  const nodes = Array.from({ length: 7 }, () => ({ x: 22 + r() * 116, y: 22 + r() * 116 }))
  g.globalCompositeOperation = 'lighter'
  g.lineCap = 'round'
  // axons: soft curves between neighbours
  nodes.forEach((a, i) => {
    for (let j = i + 1; j < nodes.length; j++) {
      const b = nodes[j]
      if (Math.hypot(a.x - b.x, a.y - b.y) > 80) continue
      g.strokeStyle = tone(p, i / 7, 0.55)
      g.lineWidth = 1
      g.beginPath()
      g.moveTo(a.x, a.y)
      g.quadraticCurveTo((a.x + b.x) / 2 + (r() - 0.5) * 40, (a.y + b.y) / 2 + (r() - 0.5) * 40, b.x, b.y)
      g.stroke()
    }
  })
  // dendrites and a glowing soma
  nodes.forEach((n, i) => {
    const h: Habit = { wiggle: 0.9, pull: 0, heading: 0, fork: 0.12, spread: 0.8, step: 2.5, depth: 1, colour: () => tone(p, i / 7 + 0.1, 0.6) }
    for (let k = 0; k < 4; k++) branch(g, r, h, n.x, n.y, r() * Math.PI * 2, 14 + r() * 10, 1.1, 0)
    glowDot(g, n.x, n.y, 11, tone(p, i / 7, 0.9))
    g.fillStyle = 'rgba(255,255,255,0.9)'
    g.beginPath()
    g.arc(n.x, n.y, 1.8, 0, Math.PI * 2)
    g.fill()
  })
}

function crystal(g: Ctx, r: Rng) {
  const p = pal('ocean')
  const cx = 80
  const cy = 88
  for (let i = 0; i < 9; i++) {
    const a = -Math.PI / 2 + (r() - 0.5) * 2.6
    const len = 34 + r() * 46
    const w = 5 + r() * 6
    const tx = cx + Math.cos(a) * len
    const ty = cy + Math.sin(a) * len
    const nx = -Math.sin(a) * w
    const ny = Math.cos(a) * w
    const mx = cx + Math.cos(a) * len * 0.3
    const my = cy + Math.sin(a) * len * 0.3
    const grd = g.createLinearGradient(cx, cy, tx, ty)
    grd.addColorStop(0, tone(p, 0.2 + i * 0.07, 0.35))
    grd.addColorStop(1, tone(p, 0.5 + i * 0.07, 0.95))
    g.fillStyle = grd
    g.beginPath()
    g.moveTo(cx, cy)
    g.lineTo(mx + nx, my + ny)
    g.lineTo(tx, ty)
    g.lineTo(mx - nx, my - ny)
    g.closePath()
    g.fill()
    g.strokeStyle = 'rgba(235,245,255,0.75)'
    g.lineWidth = 0.8
    g.stroke()
  }
}

function liquid(g: Ctx, r: Rng) {
  const p = pal('ocean')
  g.globalCompositeOperation = 'lighter'
  for (let i = 0; i < 11; i++) {
    const x = 30 + r() * 100
    const y = 34 + r() * 96
    const rad = 8 + r() * 22
    const grd = g.createRadialGradient(x - rad * 0.3, y - rad * 0.35, rad * 0.1, x, y, rad)
    grd.addColorStop(0, tone(p, 0.55 + i * 0.05, 0.9))
    grd.addColorStop(0.7, tone(p, 0.35 + i * 0.05, 0.35))
    grd.addColorStop(1, 'rgba(0,0,0,0)')
    g.fillStyle = grd
    g.beginPath()
    g.arc(x, y, rad, 0, Math.PI * 2)
    g.fill()
  }
}

function silk(g: Ctx, r: Rng) {
  const p = pal('candy')
  for (let k = 0; k < 3; k++) {
    const y0 = 40 + k * 40 + (r() - 0.5) * 10
    const amp = 14 + r() * 14
    const ph = r() * 6
    for (let s = 0; s < 22; s++) {
      g.strokeStyle = tone(p, 0.2 + k * 0.22 + s * 0.012, 0.22 + 0.5 * Math.sin((s / 22) * Math.PI))
      g.lineWidth = 0.9
      g.beginPath()
      for (let x = -4; x <= 164; x += 4) {
        const twist = Math.sin(x * 0.03 + ph)
        const y = y0 + Math.sin(x * 0.045 + ph) * amp + (s - 11) * 0.7 * twist
        if (x === -4) g.moveTo(x, y)
        else g.lineTo(x, y)
      }
      g.stroke()
    }
  }
}

function webs(g: Ctx, r: Rng, night: boolean) {
  // the haze world: a light tunnel (or the dark one), threads converging on the far light
  const bg = g.createRadialGradient(84, 76, 4, 80, 80, 110)
  bg.addColorStop(0, night ? '#2a2430' : '#fbf4f2')
  bg.addColorStop(0.5, night ? '#141118' : '#d8c8cf')
  bg.addColorStop(1, night ? '#050407' : '#8f7d8a')
  g.fillStyle = bg
  g.fillRect(0, 0, PX, PX)
  const thread = night ? 'rgba(214,208,226,' : 'rgba(34,26,38,'
  for (let i = 0; i < 46; i++) {
    const a = r() * Math.PI * 2
    const x0 = 80 + Math.cos(a) * 120
    const y0 = 80 + Math.sin(a) * 120
    g.strokeStyle = `${thread}${(0.18 + r() * 0.5).toFixed(2)})`
    g.lineWidth = 0.4 + r() * 1
    g.beginPath()
    g.moveTo(x0, y0)
    g.quadraticCurveTo(80 + (r() - 0.5) * 120, 80 + (r() - 0.5) * 120, 84 + (r() - 0.5) * 16, 76 + (r() - 0.5) * 16)
    g.stroke()
  }
  // a chrome ribbon sweeping past
  for (let s = 0; s < 14; s++) {
    g.strokeStyle = `rgba(${night ? '230,232,240' : '250,250,252'},${(0.25 + 0.6 * Math.sin((s / 14) * Math.PI)).toFixed(2)})`
    g.lineWidth = 0.8
    g.beginPath()
    g.moveTo(-6, 130 + s * 0.9)
    g.bezierCurveTo(50, 70 + s * 1.6, 110, 160 - s, 166, 40 + s * 1.2)
    g.stroke()
  }
}

const DRAW: Record<string, (g: Ctx, r: Rng) => void> = {
  roots,
  coral,
  neural,
  crystal,
  liquid,
  silk,
  webs: (g, r) => webs(g, r, false),
  'webs-night': (g, r) => webs(g, r, true),
}

/** The tile picture for a look id (an unknown id gets a plain dark tile). */
export function lookThumb(id: string): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = c.height = PX
  c.setAttribute('aria-hidden', 'true')
  const g = c.getContext('2d')
  if (!g) return c
  g.fillStyle = '#060607'
  g.fillRect(0, 0, PX, PX)
  let seed = 7
  for (const ch of id) seed = (seed * 31 + ch.charCodeAt(0)) | 0
  g.save()
  DRAW[id]?.(g, seeded(seed))
  g.restore()
  return c
}
