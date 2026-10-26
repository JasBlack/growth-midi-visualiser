// Replicating cells. Each note births a polygon (sides from pitch class) that
// swells while held; onsets trigger mitosis so a played rhythm literally
// divides the population. Cells repel each other, bass pushes them outward,
// treble pulls them in, and silence lets them shrink away.

import type { Engine, EngineControl, GlobalParams } from '../engine'
import { ctl, setCtl, fitCanvas } from '../engine'
import type { MusicState } from '../music'
import { notePos, pitchClass, octave } from '../music'
import { noteRgb, rgbCss } from '../color'

interface Cell {
  x: number
  y: number
  vx: number
  vy: number
  r: number
  target: number
  sides: number
  pitch: number
  rgb: [number, number, number]
  born: number
  gen: number
  phase: number
  spin: number
}

export class CellsEngine implements Engine {
  readonly id = 'cells'
  readonly name = 'Cells'
  readonly blurb = 'Polygons born from notes, swelling while held. Onsets trigger mitosis; silence shrinks the colony.'
  controls: EngineControl[] = [
    { key: 'size', label: 'cell size', min: 0.3, max: 3, step: 0.05, value: 1 },
    { key: 'split', label: 'mitosis sensitivity', min: 0, max: 1, step: 0.02, value: 0.5 },
    { key: 'maxGen', label: 'max generations', min: 1, max: 8, step: 1, value: 5 },
    { key: 'repel', label: 'repulsion', min: 0, max: 3, step: 0.05, value: 1 },
    { key: 'expand', label: 'expansion reactivity', min: 0, max: 2, step: 0.05, value: 1 },
    { key: 'trail', label: 'trails', min: 0, max: 1, step: 0.02, value: 0.35 },
    { key: 'fill', label: 'fill opacity', min: 0, max: 1, step: 0.02, value: 0.45 },
  ]

  private host!: HTMLElement
  private canvas!: HTMLCanvasElement
  private ctx!: CanvasRenderingContext2D
  private cells: Cell[] = []
  private lastSplitT = 0
  private w = 1
  private h = 1

  mount(host: HTMLElement) {
    this.host = host
    this.canvas = document.createElement('canvas')
    host.appendChild(this.canvas)
    this.ctx = this.canvas.getContext('2d')!
    this.resize()
    this.clear()
  }

  resize() {
    const { w, h } = fitCanvas(this.canvas, this.host, 1.25)
    this.w = w
    this.h = h
  }

  clear() {
    this.cells = []
    this.ctx.setTransform(1, 0, 0, 1, 0, 0)
    this.ctx.globalCompositeOperation = 'source-over'
    this.ctx.fillStyle = '#000'
    this.ctx.fillRect(0, 0, this.w, this.h)
  }

  setControl(key: string, value: number) {
    setCtl(this.controls, key, value)
  }

  private birth(pitch: number, velocity: number, g: GlobalParams, t: number, at?: { x: number; y: number }, gen = 0): Cell {
    const base = Math.min(this.w, this.h)
    const p = notePos(pitch, 0.05)
    const size = ctl(this.controls, 'size') * (base / 900)
    const c: Cell = {
      x: at ? at.x : this.w / 2 + (p.x - 0.5) * base,
      y: at ? at.y : this.h / 2 + (p.y - 0.5) * base,
      vx: 0,
      vy: 0,
      r: at ? 2 : 1,
      target: (14 + 70 * velocity) * size * Math.pow(0.78, gen),
      sides: 3 + (pitchClass(pitch) % 6),
      pitch,
      rgb: noteRgb(g.palette, pitch, 0.1 + octave(pitch) * 0.07 + gen * 0.05),
      born: t,
      gen,
      phase: Math.random() * Math.PI * 2,
      spin: (Math.random() - 0.5) * 1.5,
    }
    this.cells.push(c)
    return c
  }

  private mitosis(strength: number, g: GlobalParams, t: number) {
    const maxGen = ctl(this.controls, 'maxGen')
    const cap = 320
    const parents = this.cells.filter((c) => c.r > 6 && c.gen < maxGen && t - c.born > 0.25)
    // strongest onsets split more of the colony — but never more than a
    // handful per hit, or a busy track turns the colony into a white wall
    const count = Math.min(2 + Math.round(strength * 6), Math.ceil(parents.length * Math.min(1, 0.15 + strength * 0.5)))
    parents.sort(() => Math.random() - 0.5)
    for (let i = 0; i < count && this.cells.length < cap; i++) {
      const p = parents[i]
      const a = Math.random() * Math.PI * 2
      const off = p.r * 0.55
      const childR = p.r * 0.7
      for (let s = -1; s <= 1; s += 2) {
        const c = this.birth(p.pitch, 0.5, g, t, { x: p.x + Math.cos(a) * off * s, y: p.y + Math.sin(a) * off * s }, p.gen + 1)
        c.r = childR
        c.target = Math.max(childR, p.target * 0.72)
        c.vx = Math.cos(a) * s * 80 + p.vx
        c.vy = Math.sin(a) * s * 80 + p.vy
        c.sides = p.sides
        c.spin = -p.spin
      }
      // parent dissolves into the children
      p.target = 0
      p.r *= 0.6
    }
  }

  frame(m: MusicState, g: GlobalParams) {
    this.resize()
    const { w, h, ctx } = this
    const dt = m.dt
    const t = m.time
    const base = Math.min(w, h)
    const cap = 320

    for (const ev of m.events) {
      if (ev.kind === 'on' && this.cells.length < cap) this.birth(ev.pitch, ev.velocity, g, t)
    }
    // held notes keep swelling their cells
    const sizeCtl = ctl(this.controls, 'size') * (base / 900)
    for (const c of this.cells) {
      const a = m.active.get(c.pitch)
      if (a && c.gen === 0 && c.target > 0) c.target += 26 * sizeCtl * g.growth * dt
    }
    // mitosis on onsets
    const sens = ctl(this.controls, 'split')
    if (sens > 0 && m.onset > 1 - sens * 0.9 && t - this.lastSplitT > 0.12 / (0.2 + sens)) {
      this.lastSplitT = t
      this.mitosis(m.onset, g, t)
    }

    // ---- physics
    const repel = ctl(this.controls, 'repel')
    const expand = (m.bass * 0.8 - m.treble * 0.5) * ctl(this.controls, 'expand')
    const cells = this.cells
    const n = cells.length
    for (let i = 0; i < n; i++) {
      const a = cells[i]
      for (let j = i + 1; j < n; j++) {
        const b = cells[j]
        const dx = b.x - a.x
        const dy = b.y - a.y
        const d2 = dx * dx + dy * dy
        const minD = (a.r + b.r) * 0.95
        if (d2 < minD * minD && d2 > 1e-4) {
          const d = Math.sqrt(d2)
          const push = ((minD - d) / minD) * 180 * repel * dt
          const ux = dx / d
          const uy = dy / d
          a.vx -= ux * push
          a.vy -= uy * push
          b.vx += ux * push
          b.vy += uy * push
        }
      }
    }
    const shrink = m.active.size === 0 ? g.decay * 0.5 : g.decay * 0.12
    const alive: Cell[] = []
    for (const c of cells) {
      const dx = c.x - w / 2
      const dy = c.y - h / 2
      const d = Math.sqrt(dx * dx + dy * dy) + 1e-3
      c.vx += (dx / d) * expand * 120 * dt
      c.vy += (dy / d) * expand * 120 * dt
      // gentle pull home so the colony never escapes the frame
      const over = Math.max(0, d - base * 0.48)
      c.vx -= (dx / d) * over * 2.5 * dt
      c.vy -= (dy / d) * over * 2.5 * dt
      c.vx *= 1 - 2.5 * dt
      c.vy *= 1 - 2.5 * dt
      c.x += c.vx * dt
      c.y += c.vy * dt
      c.r += (c.target - c.r) * (1 - Math.exp(-dt * 3 * g.growth))
      c.target *= 1 - shrink * dt
      if (c.r > 1.2 && c.target > 0.5) alive.push(c)
    }
    this.cells = alive.length > cap ? alive.slice(alive.length - cap) : alive

    // ---- draw
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.globalCompositeOperation = 'source-over'
    const trail = ctl(this.controls, 'trail')
    ctx.fillStyle = `rgba(0,0,0,${1 - trail * 0.92})`
    ctx.fillRect(0, 0, w, h)
    ctx.translate(w / 2, h / 2)
    ctx.rotate(g.rotNow)
    ctx.scale(g.zoomNow, g.zoomNow)
    ctx.translate(-w / 2, -h / 2)
    ctx.globalCompositeOperation = 'lighter'
    const sym = Math.max(1, Math.round(g.symmetryNow))
    const fill = ctl(this.controls, 'fill')
    for (const c of this.cells) {
      const pulse = 1 + 0.12 * m.energy * Math.sin(t * 7 + c.phase) + 0.15 * m.onset
      const r = c.r * pulse
      const rot = c.phase + t * c.spin
      for (let s = 0; s < sym; s++) {
        const a = (s / sym) * Math.PI * 2
        const dx = c.x - w / 2
        const dy = c.y - h / 2
        const x = w / 2 + dx * Math.cos(a) - dy * Math.sin(a)
        const y = h / 2 + dx * Math.sin(a) + dy * Math.cos(a)
        ctx.beginPath()
        for (let k = 0; k < c.sides; k++) {
          const ang = rot + a + (k / c.sides) * Math.PI * 2
          const px = x + Math.cos(ang) * r
          const py = y + Math.sin(ang) * r
          if (k === 0) ctx.moveTo(px, py)
          else ctx.lineTo(px, py)
        }
        ctx.closePath()
        if (fill > 0) {
          ctx.fillStyle = rgbCss(c.rgb, fill * 0.35)
          ctx.fill()
        }
        ctx.lineWidth = Math.max(0.6, r * 0.08)
        ctx.strokeStyle = rgbCss(c.rgb, 0.75)
        ctx.stroke()
        // nucleus
        ctx.beginPath()
        ctx.arc(x, y, Math.max(0.5, r * 0.18), 0, Math.PI * 2)
        ctx.fillStyle = rgbCss(c.rgb, 0.8)
        ctx.fill()
      }
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.globalCompositeOperation = 'source-over'
  }

  unmount() {
    this.canvas.remove()
    this.cells = []
  }
}
