// Simple mode: the Macros row (Reaction, Energy, Complexity, Motion, Chaos), the "Make something"
// card (the looks, Surprise me, camera style, draw-a-source intents) and the Simple / Advanced
// tier switch. The Macros row sits above the card and shows in both tiers.
//
// Every widget here is a view of the control registry (e:organism:*, g:*, m:*): values go
// through the same Ctl.set as the Advanced sliders, so presets, MIDI learn, search and saved
// settings see one value. Nothing here keeps a second copy: the camera style, the active
// intent and the macro positions are read back from the controls (v0.19's card wrote through
// engine.setControl, bypassed saving, and its sliders and selects drifted out of sync).

import type { Engine, EngineControl } from './engine'
import { PALETTES } from './color'
import { CAM, CAM_MODES } from './engines/organism/camera'
import { FRAMED_SPEED, LOOKS, LOOK_GLOBALS, lookCamera, pickSurprise, resolveLook } from './looks'
import { MACROS, MacroRig, NEUTRAL, type MacroPositions } from './macros'

export type UiTier = 'simple' | 'advanced'

/** The part of the app settings this card owns (persisted with the rest). */
export interface SimpleSettings {
  uiMode: UiTier
  /** id of the look applied last ('' = none yet) */
  look: string
  /** macro positions, 0.5 = the look as authored */
  macros: MacroPositions
  /** registry id → its value with every macro at 0.5 (what the macros scale) */
  macroBase: Record<string, number>
  /** the first-run look has been applied once */
  lookStarted: boolean
  /** a look or Surprise clears the growth first */
  freshCanvas: boolean
}

export interface CtlLike {
  readonly c: EngineControl
  set(n: number): void
  sync?: (n: number) => void
  wrap?: HTMLElement
}

export interface SimpleHost {
  settings: SimpleSettings
  save(): void
  setStatus(s: string): void
  /** a registry entry: g:<key>, e:<engine>:<key>, m:<macro> */
  ctl(id: string): CtlLike | undefined
  /** a registry slider (MIDI-learnable, searchable) in `host` */
  slider(host: HTMLElement, id: string, c: EngineControl, onChange: (v: number) => void): CtlLike
  engine(): Engine | null
  /** the Organism, mounted (waits for a mount in flight); null when it cannot be */
  organism(): Promise<Engine | null>
  /**
   * registry values: selects and toggles at once, numbers eased over `dur` seconds (0 = at once).
   * `owned`: the values already carry the macros (a macro, a look, a preset), so the macros'
   * bases are not re-derived from them — nor from the eased values in between.
   */
  apply(values: Record<string, number>, dur: number, owned?: boolean): void
  setPalette(i: number): void
  reset(): void
  /** the picture / video / camera source */
  source: { active(): boolean; pickPicture(): void; stop(): void }
  /** load a 3D model as the Organism's shell; resolves to a status line */
  loadModel(f: File): Promise<string>
  /** the camera style or lock changed here: the top bar's camera buttons follow */
  cameraChanged(): void
}

type Intent = 'trace' | 'relief' | 'model' | 'off'
type CamStyle = 'framed' | 'gentle' | 'director' | 'flight' | 'still' | 'manual' | 'other'

/** Draw-a-source intents: only source / shell keys, so the look (shape, colour, music) stays. */
const INTENTS: Record<Intent, Record<string, number>> = {
  trace: { videoMode: 3, videoStick: 1, videoFollow: 1, videoEdge: 2.5, videoScatter: 0.22, videoSpawn: 1, videoBuild: 0, shell: 0, shellMode: 0 },
  relief: { videoMode: 4, videoStick: 1, videoFollow: 1, videoEdge: 1.35, videoScatter: 0.55, videoSpawn: 1, videoBuild: 0, shell: 0, shellMode: 0 },
  model: { shellMode: 1, skinStick: 1, morph: 0, attach: 1, videoMode: 0, videoBuild: 0 },
  off: { videoMode: 0, videoBuild: 0, shell: 0, shellMode: 0 },
}
const INTENT_STATUS: Record<Intent, string> = {
  trace: 'Trace details — the music draws along the picture’s lines and relief.',
  relief: 'Grow over relief — the music grows across the picture’s surface.',
  model: 'Skin 3D model — the music builds the model’s surface.',
  off: 'Music only — no source; the music grows freely.',
}
/** framed mode turns at 0.12 × camera speed rad/s: 1.5 is a turn in about 35 s */
const GENTLE_SPEED = 1.5
/** flight's camera speed when chosen here, with any look (the Webs looks fly at their own) */
const FLIGHT_SPEED = 0.7

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T
const org = (key: string) => `e:organism:${key}`

export function setupSimple(host: SimpleHost) {
  const s = host.settings
  const rig = new MacroRig({ ctl: host.ctl, write: (v) => host.apply(v, 0, true), save: host.save }, s.macros, s.macroBase)
  /** trace / relief chosen before a source existed: applied when one opens */
  let pendingIntent: Intent | null = null

  // ------------------------------------------------------------ tier
  const tierBtn = $<HTMLButtonElement>('uiTier')
  function setTier(t: UiTier) {
    s.uiMode = t
    document.documentElement.dataset.ui = t
    tierBtn.setAttribute('aria-pressed', String(t === 'advanced'))
    tierBtn.title = t === 'advanced' ? 'showing every setting — click for the simple panel' : 'show every setting'
  }
  tierBtn.onclick = () => {
    setTier(s.uiMode === 'advanced' ? 'simple' : 'advanced')
    host.save()
  }
  setTier(s.uiMode)

  // ------------------------------------------------------------ looks
  const lookHost = $('looks')
  const lookBtns = LOOKS.map((r) => {
    const b = document.createElement('button')
    b.type = 'button'
    b.textContent = r.label
    b.dataset.look = r.id
    b.setAttribute('aria-pressed', 'false')
    b.onclick = () => void applyLook(r.id)
    lookHost.appendChild(b)
    return b
  })
  function syncLooks() {
    for (const b of lookBtns) {
      const on = b.dataset.look === s.look
      b.classList.toggle('active', on)
      b.setAttribute('aria-pressed', String(on))
    }
    $('lookName').textContent = LOOKS.find((r) => r.id === s.look)?.label ?? ''
  }

  const fresh = $<HTMLInputElement>('freshCanvas')
  fresh.checked = s.freshCanvas
  fresh.onchange = () => {
    s.freshCanvas = fresh.checked
    host.save()
  }

  /** Apply a look through the registry. Resolves false when the Organism could not be mounted. */
  async function applyLook(id: string, opt: { surprise?: boolean; dur?: number } = {}): Promise<boolean> {
    const e = await host.organism()
    if (!e) return false
    const recipe = LOOKS.find((r) => r.id === id) ?? LOOKS[0]
    const species: string[] = []
    for (const c of e.controls) {
      const m = /^sp:(\d+)$/.exec(c.key)
      if (m) species[+m[1]] = c.label
    }
    const options = (key: string) => e.controls.find((c) => c.key === key)?.options ?? []
    const look = resolveLook(recipe, { species, palettes: PALETTES.map((p) => p.name), shaders: options('shader'), skies: options('envShader') }, opt.surprise ? Math.random : null)
    if (look.missing.length) console.warn(`look ${recipe.id}: unknown ${look.missing.join(', ')}`)
    const vals: Record<string, number> = {}
    species.forEach((_, i) => (vals[org(`sp:${i}`)] = look.speciesOn.has(i) ? 1 : 0))
    vals[org('species')] = look.speciesMode
    vals[org('shader')] = look.shader
    for (const [k, v] of Object.entries(look.values)) vals[org(k)] = v
    const cam = lookCamera(recipe)
    for (const [k, v] of Object.entries(cam)) vals[org(k)] = v
    for (const [k, v] of Object.entries(LOOK_GLOBALS)) vals[`g:${k}`] = v
    // the look is the macros' new base; the knobs stay where the performer left them
    rig.rebase(vals)
    const clear = s.freshCanvas
    host.apply(vals, clear ? 0 : (opt.dur ?? 1.5), true)
    host.setPalette(look.palette)
    if (clear) host.reset()
    s.look = recipe.id
    host.save()
    syncLooks()
    const palette = PALETTES[look.palette]?.name ?? ''
    const shader = options('shader')[look.shader] ?? ''
    if (cam.camMode !== undefined) host.cameraChanged()
    host.setStatus(opt.surprise ? `Surprise: ${look.label} (${palette} · ${shader}) — play a note` : `${look.label} — play a note`)
    return true
  }

  function surprise() {
    const i = pickSurprise(LOOKS.length, LOOKS.findIndex((r) => r.id === s.look), Math.random)
    void applyLook(LOOKS[i].id, { surprise: true })
  }
  $('surprise').onclick = surprise

  // ------------------------------------------------------------ macros
  const macroHost = $('macros')
  for (const m of MACROS) {
    const c: EngineControl = { key: `macro ${m.id}`, label: m.label, min: 0, max: 1, step: 0.01, value: s.macros[m.id] }
    const w = host.slider(macroHost, `m:${m.id}`, c, (n) => rig.set(m.id, n))
    if (w.wrap) {
      w.wrap.title = `${m.title}. 0.5 = the look's own · double-click: back to 0.5 · right-click: MIDI learn`
      w.wrap.ondblclick = () => w.set(NEUTRAL)
    }
  }
  /** the sliders show the knob positions (a preset moved them) */
  function syncMacros() {
    for (const m of MACROS) host.ctl(`m:${m.id}`)?.sync?.(s.macros[m.id])
  }

  // ------------------------------------------------------------ camera style
  const camSel = $<HTMLSelectElement>('camStyle')
  const camOther = camSel.querySelector<HTMLOptionElement>('option[value=other]')!
  function camStyle(): CamStyle {
    const e = host.engine()
    if (!e || e.id !== 'organism') return 'other'
    if (e.cameraLocked) return 'still'
    const mode = host.ctl(org('camMode'))?.c.value ?? -1
    const speed = host.ctl(org('orbit'))?.c.value ?? 0
    if (mode === CAM.framed) return speed >= 1 ? 'gentle' : 'framed'
    if (mode === CAM.director) return 'director'
    if (mode === CAM.flight) return 'flight'
    if (mode === CAM.orbit && speed === 0) return 'manual'
    return 'other'
  }
  camSel.onchange = async () => {
    const want = camSel.value as CamStyle
    const e = await host.organism()
    if (!e) return
    if (want === 'still') {
      if (!e.cameraLocked) e.toggleCameraLock?.()
      host.setStatus('Still — this view is held; the growth goes on (Reset keeps it)')
    } else {
      if (e.cameraLocked) e.toggleCameraLock?.()
      const speed = host.ctl(org('orbit'))?.c.value ?? FRAMED_SPEED
      if (want === 'framed') host.apply({ [org('camMode')]: CAM.framed, ...(speed >= 1 ? { [org('orbit')]: FRAMED_SPEED } : {}) }, 0)
      else if (want === 'gentle') host.apply({ [org('camMode')]: CAM.framed, [org('orbit')]: GENTLE_SPEED }, 0)
      else if (want === 'director') host.apply({ [org('camMode')]: CAM.director, ...(speed === 0 || speed >= 1 ? { [org('orbit')]: FRAMED_SPEED } : {}) }, 0)
      else if (want === 'flight') host.apply({ [org('camMode')]: CAM.flight, ...(speed === 0 ? { [org('orbit')]: FLIGHT_SPEED } : {}) }, 0)
      else if (want === 'manual') host.apply({ [org('camMode')]: CAM.orbit, [org('orbit')]: 0 }, 0)
      host.setStatus(
        want === 'framed'
          ? 'Framed — the camera keeps all the growth in view'
          : want === 'gentle'
            ? 'Gentle orbit — framed, slowly circling'
            : want === 'director'
              ? 'Director — cuts between shots on the bar; a drop cuts wide, a breakdown drifts close'
              : want === 'flight'
                ? 'Flight — on through the growth for ever: notes grow ahead, the music sets the pace'
                : 'Manual — middle-drag (or Alt+drag) orbits, right-drag pans, the wheel zooms',
      )
    }
    host.cameraChanged()
  }

  // ------------------------------------------------------------ draw a source
  const intentBtns: Record<Intent, HTMLButtonElement> = { trace: $('srcTrace'), relief: $('srcRelief'), model: $('srcModel'), off: $('srcOff') }
  function currentIntent(): Intent | null {
    const e = host.engine()
    if (!e || e.id !== 'organism') return null
    const v = (k: string) => host.ctl(org(k))?.c.value ?? 0
    if (v('shell') > 0 && v('shellMode') === 1) return 'model'
    const guided = host.source.active() && v('videoMode') > 0
    if (guided && v('videoMode') === 3) return 'trace'
    if (guided && v('videoMode') === 4) return 'relief'
    return !guided && v('shell') === 0 ? 'off' : null
  }
  function values(intent: Intent) {
    return Object.fromEntries(Object.entries(INTENTS[intent]).map(([k, v]) => [org(k), v]))
  }
  async function chooseIntent(intent: Intent) {
    const e = await host.organism()
    if (!e) return
    pendingIntent = null
    if ((intent === 'trace' || intent === 'relief') && !host.source.active()) {
      pendingIntent = intent
      host.setStatus('Choose a picture — or start a video or camera in Input below')
      host.source.pickPicture()
      return
    }
    if (intent === 'model' && (host.ctl(org('shell'))?.c.value ?? 0) === 0) {
      modelFile.click()
      return
    }
    if (intent === 'off') host.source.stop()
    host.apply(values(intent), 0)
    host.setStatus(INTENT_STATUS[intent])
    sync()
  }
  for (const [intent, b] of Object.entries(intentBtns) as [Intent, HTMLButtonElement][]) b.onclick = () => void chooseIntent(intent)

  const modelFile = $<HTMLInputElement>('modelFile')
  $('modelPick').onclick = () => modelFile.click()
  modelFile.onchange = async () => {
    const f = modelFile.files?.[0]
    modelFile.value = '' // the same file again loads again
    if (!f || !(await host.organism())) return
    host.setStatus(`loading ${f.name}…`)
    const msg = await host.loadModel(f)
    if ((host.ctl(org('shell'))?.c.value ?? 0) > 0) host.apply(values('model'), 0)
    host.setStatus(msg)
    sync()
  }

  // ------------------------------------------------------------ read back (cheap: DOM writes only on change)
  let shownCam = ''
  let shownIntent: Intent | null | undefined
  function sync() {
    const style = camStyle()
    if (style !== shownCam) {
      shownCam = style
      if (style === 'other') {
        const mode = host.ctl(org('camMode'))?.c.value ?? -1
        camOther.textContent = host.engine()?.id === 'organism' ? `${CAM_MODES[mode] ?? 'camera'} (set in Advanced)` : '— (Organism only)'
      }
      camSel.value = style
    }
    const intent = currentIntent()
    if (intent !== shownIntent) {
      shownIntent = intent
      for (const [k, b] of Object.entries(intentBtns)) {
        b.classList.toggle('active', k === intent)
        b.setAttribute('aria-pressed', String(k === intent))
      }
    }
  }

  syncLooks()
  sync()

  return {
    applyLook,
    surprise,
    sync,
    /** per frame: a moving knob eases its controls in, a few writes a second */
    tick: () => rig.tick(),
    /** a registry value moved outside the macros: if a macro scales it, it scales from there now */
    controlMoved: (id: string, value: number) => rig.controlMoved(id, value),
    /** an engine mounted with its saved values: bring the targets to the knobs */
    engineMounted: () => rig.applyAll(),
    /** for a preset slot */
    snapshotMacros: () => rig.snapshot(),
    /** a preset's knobs and bases; `values` (registry id → value) get the targets as the knobs make them */
    recallMacros(pos: unknown, bases: unknown, values: Record<string, number>) {
      rig.recall(pos, bases, values)
      syncMacros()
    },
    /** A source just opened: the trace / relief chosen before it, if any (it is used up). */
    takePendingIntent(): Record<string, number> | null {
      const p = pendingIntent
      pendingIntent = null
      if (p !== 'trace' && p !== 'relief') return null
      host.setStatus(INTENT_STATUS[p])
      return values(p)
    },
    /**
     * First run: the Roots look, once, after the engine is up. The flag is stored only when the
     * look applied (a slow GPU start or a failed mount tries again next time).
     */
    async firstRun(skip: boolean) {
      if (s.lookStarted || skip) return
      if (await applyLook('roots', { dur: 0 })) {
        s.lookStarted = true
        host.save()
      }
    },
  }
}

export type SimpleUi = ReturnType<typeof setupSimple>
