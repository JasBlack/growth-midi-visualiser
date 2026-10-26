// Branching growth (stochastic L-system-ish). Every note plants growth tips at
// its pitch position that crawl outward, wiggle, and fork; held notes keep their
// tips alive. The accumulation canvas is fed back through a per-frame zoom, so
// bass swells the whole organism outward and treble pulls it in.

import type { Engine, EngineControl, GlobalParams } from '../engine'
import { ctl, setCtl, fitCanvas } from '../engine'
import type { MusicState } from '../music'
import { notePos, octave } from '../music'
import { noteCss, cosPalette, rgbCss } from '../color'

interface Tip {
  x: number
  y: number
  angle: number
  speed: number
  width: number
  color: string
  life: number
  pitch: number
  gen: number
  curl: number
}

export class BranchingEngine implements Engine {
  readonly id = 'branch'
  readonly name = 'Branching'
  readonly blurb = 'Growth tips crawl from each note and fork. Bass swells the organism, treble contracts it, chords replicate.'
  controls: EngineControl[] = [
    { key: 'wiggle', label: 'wiggle', min: 0, max: 3, step: 0.05, value: 1 },
    { key: 'fork', label: 'fork rate', min: 0, max: 4, step: 0.1, value: 1.4 },
    { key: 'spread', label: 'fork angle', min: 0, max: 1.5, step: 0.05, value: 0.6 },
    { key: 'thickness', label: 'thickness', min: 0.3, max: 4, step: 0.1, value: 1.2 },
    { key: 'expand', label: 'expansion reactivity', min: 0, max: 2, step: 0.05, value: 1 },
    { key: 'glow', label: 'tip glow', min: 0, max: 2, step: 0.05, value: 1 },
  ]

  private host!: HTMLElement
  private canvas!: HTMLCanvasElement
  private ctx!: CanvasRenderingContext2D
  private acc!: HTMLCanvasElement
  private actx!: CanvasRenderingContext2D
  private tmp!: HTMLCanvasElement
  private tctx!: CanvasRenderingContext2D
  private tips: Tip[] = []
  private w = 1
  private h = 1

  mount(host: HTMLElement) {
    this.host = host
    this.canvas = document.createElement('canvas')
    host.appendChild(this.canvas)
    this.ctx = this.canvas.getContext('2d')!
    this.acc = document.createElement('canvas')
    this.actx = this.acc.getContext('2d')!
    this.tmp = document.createElement('canvas')
    this.tctx = this.tmp.getContext('2d')!
    this.resize()
  }

  resize() {
    const { w, h, changed } = fitCanvas(this.canvas, this.host, 1.25)
    if (changed || this.acc.width !== w) {
      this.w = w
      this.h = h
      this.acc.width = this.tmp.width = w
      this.acc.height = this.tmp.height = h
      this.actx.fillStyle = '#000'
      this.actx.fillRect(0, 0, w, h)
    }
  }

  clear() {
    this.tips = []
    this.actx.setTransform(1, 0, 0, 1, 0, 0)
    this.actx.globalCompositeOperation = 'source-over'
    this.actx.fillStyle = '#000'
    this.actx.fillRect(0, 0, this.w, this.h)
  }

  setControl(key: string, value: number) {
    setCtl(this.controls, key, value)
  }

  private spawn(pitch: number, velocity: number, g: GlobalParams, count: number) {
    const base = Math.min(this.w, this.h)
    for (let i = 0; i < count; i++) {
      const p = notePos(pitch, 0.04)
      const oct = octave(pitch)
      const outward = p.a + (Math.random() - 0.5) * 0.8
      this.tips.push({
        x: this.w / 2 + (p.x - 0.5) * base,
        y: this.h / 2 + (p.y - 0.5) * base,
        angle: outward,
        speed: (40 + 220 * velocity) * (base / 900),
        width: (1.5 + 9 * velocity) * ctl(this.controls, 'thickness'),
        color: noteCss(g.palette, pitch, 0.15 + oct * 0.06),
        life: 1.2 + 2.5 * velocity,
        pitch,
        gen: 0,
        curl: (Math.random() - 0.5) * 2,
      })
    }
  }

  frame(m: MusicState, g: GlobalParams) {
    this.resize()
    const { w, h } = this
    const actx = this.actx
    const dt = m.dt
    const growth = g.growth
    const base = Math.min(w, h)

    // ---- feedback: expand / contract the accumulation buffer, fade.
    const expand = (m.bass * 0.7 - m.treble * 0.45 + m.onset * 0.3) * ctl(this.controls, 'expand') * 0.35 * dt
    const twist = m.pitchBend * 0.3 * dt
    if (Math.abs(expand) > 1e-5 || Math.abs(twist) > 1e-6) {
      this.tctx.setTransform(1, 0, 0, 1, 0, 0)
      this.tctx.clearRect(0, 0, w, h)
      this.tctx.drawImage(this.acc, 0, 0)
      actx.setTransform(1, 0, 0, 1, 0, 0)
      actx.globalCompositeOperation = 'source-over'
      actx.fillStyle = '#000'
      actx.fillRect(0, 0, w, h)
      actx.translate(w / 2, h / 2)
      actx.rotate(twist)
      actx.scale(1 + expand, 1 + expand)
      actx.translate(-w / 2, -h / 2)
      actx.drawImage(this.tmp, 0, 0)
      actx.setTransform(1, 0, 0, 1, 0, 0)
    }
    if (g.decay > 0) {
      actx.setTransform(1, 0, 0, 1, 0, 0)
      actx.globalCompositeOperation = 'source-over'
      actx.fillStyle = `rgba(0,0,0,${Math.min(0.5, g.decay * 0.9 * dt)})`
      actx.fillRect(0, 0, w, h)
    }

    // ---- new notes → tips. Replication count = symmetry folds.
    for (const ev of m.events) {
      if (ev.kind === 'on') this.spawn(ev.pitch, ev.velocity, g, 1 + Math.round(ev.velocity * 2))
    }
    // held notes keep their tips alive (and occasionally re-seed)
    for (const t of this.tips) {
      const a = m.active.get(t.pitch)
      if (a) t.life = Math.max(t.life, 0.6)
    }
    if (m.active.size && this.tips.length < 40 && Math.random() < dt * 2) {
      const notes = [...m.active.values()]
      const n = notes[(Math.random() * notes.length) | 0]
      this.spawn(n.pitch, n.velocity, g, 1)
    }

    // ---- advance tips, draw segments with N-fold rotational replication.
    const wiggle = ctl(this.controls, 'wiggle')
    const forkRate = ctl(this.controls, 'fork') * (0.6 + m.energy)
    const spread = ctl(this.controls, 'spread')
    const sym = Math.max(1, Math.round(g.symmetryNow))
    const maxTips = 700
    const next: Tip[] = []
    actx.globalCompositeOperation = 'lighter'
    actx.lineCap = 'round'
    for (const t of this.tips) {
      const px = t.x
      const py = t.y
      t.angle += (Math.random() - 0.5) * wiggle * 2.2 * dt * 6 + t.curl * dt * 0.8
      const step = t.speed * growth * dt * (0.7 + 0.6 * m.energy)
      t.x += Math.cos(t.angle) * step
      t.y += Math.sin(t.angle) * step
      t.life -= dt
      t.width *= 1 - 0.25 * dt
      actx.strokeStyle = t.color
      actx.lineWidth = Math.max(0.4, t.width)
      for (let s = 0; s < sym; s++) {
        actx.setTransform(1, 0, 0, 1, 0, 0)
        if (s) {
          actx.translate(w / 2, h / 2)
          actx.rotate((s / sym) * Math.PI * 2)
          actx.translate(-w / 2, -h / 2)
        }
        actx.beginPath()
        actx.moveTo(px, py)
        actx.lineTo(t.x, t.y)
        actx.stroke()
      }
      const inside = t.x > -50 && t.x < w + 50 && t.y > -50 && t.y < h + 50
      if (t.life > 0 && t.width > 0.35 && inside) {
        next.push(t)
        if (next.length < maxTips && Math.random() < forkRate * dt && t.gen < 7) {
          const dir = Math.random() < 0.5 ? 1 : -1
          next.push({
            ...t,
            angle: t.angle + dir * spread * (0.6 + Math.random() * 0.8),
            width: t.width * 0.72,
            speed: t.speed * (0.85 + Math.random() * 0.3),
            life: t.life * 0.85,
            gen: t.gen + 1,
            curl: (Math.random() - 0.5) * 3,
          })
          t.angle -= dir * spread * 0.35
        }
      }
    }
    actx.setTransform(1, 0, 0, 1, 0, 0)
    this.tips = next

    // ---- composite to screen with global zoom / rotation.
    const ctx = this.ctx
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.globalCompositeOperation = 'source-over'
    ctx.fillStyle = '#000'
    ctx.fillRect(0, 0, w, h)
    ctx.translate(w / 2, h / 2)
    ctx.rotate(g.rotNow)
    ctx.scale(g.zoomNow, g.zoomNow)
    ctx.translate(-w / 2, -h / 2)
    ctx.drawImage(this.acc, 0, 0)

    // glowing heads on the live tips
    const glow = ctl(this.controls, 'glow')
    if (glow > 0) {
      ctx.globalCompositeOperation = 'lighter'
      const r = (2 + 6 * m.onset) * glow * (base / 900)
      for (const t of this.tips) {
        for (let s = 0; s < sym; s++) {
          const a = (s / sym) * Math.PI * 2
          const dx = t.x - w / 2
          const dy = t.y - h / 2
          const x = w / 2 + dx * Math.cos(a) - dy * Math.sin(a)
          const y = h / 2 + dx * Math.sin(a) + dy * Math.cos(a)
          ctx.fillStyle = t.color
          ctx.beginPath()
          ctx.arc(x, y, r * (0.5 + t.width * 0.15), 0, Math.PI * 2)
          ctx.fill()
        }
      }
    }
    // pulse of the root colour on onset
    if (m.onset > 0.02 && m.rootPc >= 0) {
      const c = cosPalette(g.palette, 0.5, (m.rootPc / 12) * g.palette.pitchSpread)
      ctx.setTransform(1, 0, 0, 1, 0, 0)
      ctx.fillStyle = rgbCss(c, m.onset * 0.08)
      ctx.fillRect(0, 0, w, h)
    }
    ctx.globalCompositeOperation = 'source-over'
  }

  unmount() {
    this.canvas.remove()
    this.tips = []
  }
}
