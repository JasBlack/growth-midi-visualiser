// Gray-Scott reaction–diffusion on the GPU (WebGL2, RGBA16F ping-pong).
// Notes inject chemical B at their pitch position; the register of what you
// play morphs the feed/kill pair across Pearson's map (chaos → coral →
// mitosis), bass expands the field, treble contracts it, chords fold the
// display into a kaleidoscope. Relief lighting fakes a 3D surface.

import type { Engine, EngineControl, GlobalParams } from '../engine'
import { ctl, setCtl, fitCanvas } from '../engine'
import type { MusicState } from '../music'
import { notePos } from '../music'

const VERT = `#version 300 es
out vec2 vUv;
void main(){
  vec2 p = vec2((gl_VertexID<<1)&2, gl_VertexID&2);
  vUv = p; gl_Position = vec4(p*2.0-1.0, 0.0, 1.0);
}`

const SIM = `#version 300 es
precision highp float;
uniform sampler2D uState;
uniform vec2 uTexel;
uniform float uF, uK, uDa, uDb, uDt, uAspect, uExpand, uTwist, uDecay;
uniform vec2 uFKRadial;
uniform vec4 uSeeds[48];
uniform int uSeedCount;
in vec2 vUv;
out vec4 o;
vec2 warp(vec2 uv){
  vec2 d = uv - 0.5; d.x *= uAspect;
  float c = cos(uTwist), s = sin(uTwist);
  d = mat2(c, -s, s, c) * d;
  d *= (1.0 - uExpand);
  d.x /= uAspect; return d + 0.5;
}
void main(){
  vec2 uv = warp(vUv);
  vec2 c  = texture(uState, uv).xy;
  vec2 tx = vec2(uTexel.x, 0.0), ty = vec2(0.0, uTexel.y);
  vec2 lap = -c
    + 0.2  * (texture(uState, uv+tx).xy + texture(uState, uv-tx).xy + texture(uState, uv+ty).xy + texture(uState, uv-ty).xy)
    + 0.05 * (texture(uState, uv+tx+ty).xy + texture(uState, uv-tx+ty).xy + texture(uState, uv+tx-ty).xy + texture(uState, uv-tx-ty).xy);
  vec2 pr = (vUv - 0.5) * vec2(uAspect, 1.0);
  float r = length(pr);
  float f = uF + uFKRadial.x * r;
  float k = uK + uFKRadial.y * r + uDecay;
  float abb = c.x * c.y * c.y;
  float A = c.x + (uDa * lap.x - abb + f * (1.0 - c.x)) * uDt;
  float B = c.y + (uDb * lap.y + abb - (f + k) * c.y) * uDt;
  for (int i = 0; i < 48; i++) {
    if (i >= uSeedCount) break;
    vec4 s = uSeeds[i];
    vec2 d = vUv - s.xy; d.x *= uAspect;
    float m = smoothstep(s.z, s.z * 0.25, length(d)) * s.w;
    B = max(B, m);
  }
  o = vec4(clamp(A, 0.0, 1.0), clamp(B, 0.0, 1.0), 0.0, 1.0);
}`

const SHOW = `#version 300 es
precision highp float;
uniform sampler2D uState;
uniform vec2 uTexel;
uniform float uAspect, uZoom, uRot, uSym, uPhase, uRelief, uTime, uEnergy, uOnset;
uniform vec3 uPa, uPb, uPc, uPd;
in vec2 vUv;
out vec4 o;
vec3 pal(float t){ return uPa + uPb * cos(6.2831853 * (uPc * t + uPd)); }
vec2 kaleido(vec2 p, float n){
  if (n < 1.5) return p;
  float seg = 6.2831853 / n;
  float a = atan(p.y, p.x);
  a = mod(a, seg); a = abs(a - seg * 0.5);
  return vec2(cos(a), sin(a)) * length(p);
}
void main(){
  vec2 p = (vUv - 0.5) * vec2(uAspect, 1.0);
  float c = cos(uRot), s = sin(uRot);
  p = mat2(c, -s, s, c) * p;
  p /= uZoom;
  p = kaleido(p, uSym);
  vec2 uv = p / vec2(uAspect, 1.0) + 0.5;
  vec2 tx = vec2(uTexel.x, 0.0), ty = vec2(0.0, uTexel.y);
  float B  = texture(uState, uv).y;
  float A  = texture(uState, uv).x;
  float bx = texture(uState, uv + tx).y - texture(uState, uv - tx).y;
  float by = texture(uState, uv + ty).y - texture(uState, uv - ty).y;
  vec3 nrm = normalize(vec3(-bx * uRelief, -by * uRelief, 1.0));
  vec3 L = normalize(vec3(0.45 + 0.3 * sin(uTime * 0.2), 0.6, 0.7));
  float diff = max(dot(nrm, L), 0.0);
  float spec = pow(max(dot(reflect(-L, nrm), vec3(0.0, 0.0, 1.0)), 0.0), 28.0);
  float t = smoothstep(0.04, 0.45, B);
  float edge = smoothstep(0.0, 0.25, abs(bx) + abs(by));
  vec3 body = pal(t * 0.7 + uPhase + 0.08 * (1.0 - A));
  vec3 bg = pal(uPhase + 0.5) * 0.06;
  vec3 col = mix(bg, body * (0.35 + 0.75 * diff), t);
  col += spec * 0.6 * t;
  col += edge * pal(uPhase + 0.25) * (0.25 + 0.6 * uOnset);
  col *= 0.85 + 0.35 * uEnergy;
  // vignette
  float v = 1.0 - 0.45 * dot(vUv - 0.5, vUv - 0.5) * 2.0;
  o = vec4(col * v, 1.0);
}`

// Pearson map waypoints indexed by register 0 → 1.
const FK_STOPS: [number, number][] = [
  [0.014, 0.054], // moving spots — restless, drifting solitons
  [0.026, 0.051], // chaos — blobs born and dying
  [0.037, 0.06], // worms / labyrinth (robust default at mid register)
  [0.0367, 0.0649], // mitosis — self-replicating spots
  [0.0545, 0.062], // coral — branching fingers
]

function compile(gl: WebGL2RenderingContext, type: number, src: string) {
  const sh = gl.createShader(type)!
  gl.shaderSource(sh, src)
  gl.compileShader(sh)
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh) ?? 'shader')
  return sh
}
function program(gl: WebGL2RenderingContext, fs: string) {
  const p = gl.createProgram()!
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, VERT))
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs))
  gl.linkProgram(p)
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) ?? 'link')
  return p
}

export class ReactionDiffusionEngine implements Engine {
  readonly id = 'rd'
  readonly name = 'Reaction–diffusion'
  readonly blurb = 'Turing patterns. Register morphs chaos → coral → mitosis; bass expands, treble contracts; chords fold.'
  controls: EngineControl[] = [
    { key: 'res', label: 'sim resolution', min: 256, max: 1024, step: 128, value: 512 },
    { key: 'speed', label: 'steps / frame', min: 1, max: 32, step: 1, value: 16 },
    { key: 'pattern', label: 'pattern (0 = auto from register)', min: 0, max: 1, step: 0.01, value: 0 },
    { key: 'expand', label: 'expansion reactivity', min: 0, max: 2, step: 0.05, value: 1 },
    { key: 'twist', label: 'twist', min: -1, max: 1, step: 0.02, value: 0 },
    { key: 'relief', label: '3D relief', min: 0, max: 40, step: 1, value: 14 },
    { key: 'seedSize', label: 'seed size', min: 0.2, max: 3, step: 0.1, value: 1 },
  ]

  private host!: HTMLElement
  private canvas!: HTMLCanvasElement
  private gl!: WebGL2RenderingContext
  private simProg!: WebGLProgram
  private showProg!: WebGLProgram
  private tex: WebGLTexture[] = []
  private fbo: WebGLFramebuffer[] = []
  private cur = 0
  private simW = 0
  private simH = 0
  private u: Record<string, WebGLUniformLocation | null> = {}
  private us: Record<string, WebGLUniformLocation | null> = {}
  private seeds = new Float32Array(48 * 4)
  private notePosCache = new Map<number, { x: number; y: number }>()
  private float32 = false
  private f = 0.055
  private k = 0.062

  mount(host: HTMLElement) {
    this.host = host
    this.canvas = document.createElement('canvas')
    host.appendChild(this.canvas)
    const gl = this.canvas.getContext('webgl2', { antialias: false, alpha: false, premultipliedAlpha: false })
    if (!gl) throw new Error('WebGL2 unavailable')
    this.gl = gl
    if (!gl.getExtension('EXT_color_buffer_float')) throw new Error('EXT_color_buffer_float unavailable')
    // Gray-Scott needs the precision: half floats lose the small A/B deltas at
    // a growth front and the pattern silently dies. Use 32F when it can also be
    // linearly filtered (the sim samples between texels while expanding).
    this.float32 = !!gl.getExtension('OES_texture_float_linear')
    this.simProg = program(gl, SIM)
    this.showProg = program(gl, SHOW)
    const names = ['uState', 'uTexel', 'uF', 'uK', 'uDa', 'uDb', 'uDt', 'uAspect', 'uExpand', 'uTwist', 'uDecay', 'uFKRadial', 'uSeeds', 'uSeedCount']
    for (const n of names) this.u[n] = gl.getUniformLocation(this.simProg, n)
    const sn = ['uState', 'uTexel', 'uAspect', 'uZoom', 'uRot', 'uSym', 'uPhase', 'uRelief', 'uTime', 'uEnergy', 'uOnset', 'uPa', 'uPb', 'uPc', 'uPd']
    for (const n of sn) this.us[n] = gl.getUniformLocation(this.showProg, n)
    gl.bindVertexArray(gl.createVertexArray())
    this.resize()
  }

  private allocSim() {
    const gl = this.gl
    const res = ctl(this.controls, 'res')
    const aspect = this.canvas.width / this.canvas.height
    const w = aspect >= 1 ? res : Math.round(res * aspect)
    const h = aspect >= 1 ? Math.round(res / aspect) : res
    if (w === this.simW && h === this.simH && this.tex.length) return
    for (const t of this.tex) gl.deleteTexture(t)
    for (const f of this.fbo) gl.deleteFramebuffer(f)
    this.tex = []
    this.fbo = []
    this.simW = w
    this.simH = h
    for (let i = 0; i < 2; i++) {
      const t = gl.createTexture()!
      gl.bindTexture(gl.TEXTURE_2D, t)
      if (this.float32) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, w, h, 0, gl.RGBA, gl.FLOAT, null)
      else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.MIRRORED_REPEAT)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.MIRRORED_REPEAT)
      const f = gl.createFramebuffer()!
      gl.bindFramebuffer(gl.FRAMEBUFFER, f)
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0)
      this.tex.push(t)
      this.fbo.push(f)
    }
    this.clear()
  }

  resize() {
    fitCanvas(this.canvas, this.host, 1.5)
    this.allocSim()
  }

  clear() {
    const gl = this.gl
    for (const f of this.fbo) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, f)
      gl.viewport(0, 0, this.simW, this.simH)
      gl.clearColor(1, 0, 0, 1) // A = 1, B = 0
      gl.clear(gl.COLOR_BUFFER_BIT)
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
  }

  setControl(key: string, value: number) {
    setCtl(this.controls, key, value)
    if (key === 'res') this.allocSim()
  }

  private fkFor(m: MusicState): [number, number] {
    const p = ctl(this.controls, 'pattern')
    const x = (p > 0 ? p : m.register) * (FK_STOPS.length - 1)
    const i = Math.min(FK_STOPS.length - 2, Math.floor(x))
    const fr = x - i
    return [FK_STOPS[i][0] + (FK_STOPS[i + 1][0] - FK_STOPS[i][0]) * fr, FK_STOPS[i][1] + (FK_STOPS[i + 1][1] - FK_STOPS[i][1]) * fr]
  }

  frame(m: MusicState, g: GlobalParams) {
    const gl = this.gl
    const { changed } = fitCanvas(this.canvas, this.host, 1.5)
    if (changed) this.allocSim()

    // Seeds from held notes (+ a fresh burst on note-on).
    for (const ev of m.events) {
      if (ev.kind === 'on') this.notePosCache.set(ev.pitch, notePos(ev.pitch, 0.06))
      else this.notePosCache.delete(ev.pitch)
    }
    let n = 0
    const seedSize = ctl(this.controls, 'seedSize')
    for (const note of m.active.values()) {
      if (n >= 48) break
      const p = this.notePosCache.get(note.pitch) ?? notePos(note.pitch)
      const held = m.time - note.t0
      const burst = Math.exp(-held * 6)
      this.seeds[n * 4] = p.x
      this.seeds[n * 4 + 1] = p.y
      this.seeds[n * 4 + 2] = (0.008 + 0.03 * note.velocity + 0.02 * burst) * seedSize
      this.seeds[n * 4 + 3] = Math.min(1, 0.6 + note.velocity * 0.6)
      n++
    }

    // Feed/kill drift toward the register-selected point on the Pearson map.
    const [tf, tk] = this.fkFor(m)
    const lerp = 1 - Math.exp(-m.dt * 1.5)
    this.f += (tf - this.f) * lerp
    this.k += (tk - this.k) * lerp

    const aspect = this.simW / this.simH
    const expand = (m.bass * 0.9 - m.treble * 0.6 + m.onset * 0.4) * ctl(this.controls, 'expand') * 0.0005
    const twist = ctl(this.controls, 'twist') * 0.003 + m.pitchBend * 0.004
    const steps = Math.max(1, Math.round(ctl(this.controls, 'speed') * g.growth))

    gl.useProgram(this.simProg)
    gl.uniform2f(this.u.uTexel, 1 / this.simW, 1 / this.simH)
    gl.uniform1f(this.u.uF, this.f)
    gl.uniform1f(this.u.uK, this.k)
    gl.uniform1f(this.u.uDa, 1.0)
    gl.uniform1f(this.u.uDb, 0.5)
    gl.uniform1f(this.u.uDt, 1.0)
    gl.uniform1f(this.u.uAspect, aspect)
    gl.uniform1f(this.u.uExpand, expand)
    gl.uniform1f(this.u.uTwist, twist)
    gl.uniform1f(this.u.uDecay, g.decay * 0.003)
    gl.uniform2f(this.u.uFKRadial, 0.0015 * (m.mid - 0.3), 0.001 * (m.treble - m.bass))
    gl.uniform4fv(this.u.uSeeds, this.seeds)
    gl.uniform1i(this.u.uSeedCount, n)
    gl.uniform1i(this.u.uState, 0)
    gl.activeTexture(gl.TEXTURE0)
    gl.viewport(0, 0, this.simW, this.simH)
    for (let i = 0; i < steps; i++) {
      const next = 1 - this.cur
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo[next])
      gl.bindTexture(gl.TEXTURE_2D, this.tex[this.cur])
      gl.drawArrays(gl.TRIANGLES, 0, 3)
      this.cur = next
    }

    // Display.
    const pal = g.palette
    const phase = m.rootPc >= 0 ? (m.rootPc / 12) * pal.pitchSpread : 0
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    gl.viewport(0, 0, this.canvas.width, this.canvas.height)
    gl.useProgram(this.showProg)
    gl.bindTexture(gl.TEXTURE_2D, this.tex[this.cur])
    gl.uniform1i(this.us.uState, 0)
    gl.uniform2f(this.us.uTexel, 1 / this.simW, 1 / this.simH)
    gl.uniform1f(this.us.uAspect, this.canvas.width / this.canvas.height)
    gl.uniform1f(this.us.uZoom, g.zoomNow)
    gl.uniform1f(this.us.uRot, g.rotNow)
    gl.uniform1f(this.us.uSym, g.symmetryNow)
    gl.uniform1f(this.us.uPhase, phase)
    gl.uniform1f(this.us.uRelief, ctl(this.controls, 'relief'))
    gl.uniform1f(this.us.uTime, m.time)
    gl.uniform1f(this.us.uEnergy, m.energy)
    gl.uniform1f(this.us.uOnset, m.onset)
    gl.uniform3fv(this.us.uPa, pal.a)
    gl.uniform3fv(this.us.uPb, pal.b)
    gl.uniform3fv(this.us.uPc, pal.c)
    gl.uniform3fv(this.us.uPd, pal.d)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
  }

  unmount() {
    const gl = this.gl
    for (const t of this.tex) gl.deleteTexture(t)
    for (const f of this.fbo) gl.deleteFramebuffer(f)
    gl.getExtension('WEBGL_lose_context')?.loseContext()
    this.canvas.remove()
  }
}
