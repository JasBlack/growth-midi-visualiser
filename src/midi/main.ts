// Entry for midi.html: wires inputs (Web MIDI / computer keyboard / audio
// file / mic) into the shared MusicClock, drives the selected growth engine
// every frame with auto-modulated global params, and owns the panel, HUD,
// presets + morph, MIDI CC learn, recording, casting, sound-back, gestures
// and performance mode.

import { MusicClock, pitchClass, octave, type NoteSource } from './music'
import { MidiInput, KeyboardPiano } from './inputMidi'
import { AudioInput } from './inputAudio'
import { PALETTES } from './color'
import type { Engine, EngineAction, EngineControl, GlobalParams } from './engine'
import { ctl } from './engine'
import { ReactionDiffusionEngine } from './engines/reactionDiffusion'
import { BranchingEngine } from './engines/branching'
import { CellsEngine } from './engines/cells'
import { Crystal3dEngine } from './engines/crystal3d'
import { OrganismEngine, FRAME_CAPS } from './engines/organism'
import { loadPresets, savePresets, Morph, SLOTS, type Preset } from './presets'
import { snapshot, download, stamp } from './recorder'
import { setupRecording, loadRecSettings, REC_DEFAULTS, type RecSettings } from './recordUi'
import { audioContext, recordingStream } from './audioCtx'
import { Caster } from './cast'
import { SoundBack, Instrument, INSTRUMENTS } from './synth'
import { GestureInput } from './vision'
import { VideoField } from './videoField'
import { VERSION } from './version'
import { ANIMATED_START } from './shaders'
import { classifyTarget, controlOwnsKey, focusedByKeyboard, ignoredKey, trackFocusOrigin } from './keys'
import { PanelSearch } from './panelSearch'
import { readStored, writeStored } from './storage'
import { setupSimple, type SimpleSettings, type WidgetOpts } from './simpleUi'
import { RENAMED_MACROS, loadMacroBases, loadMacroPositions, neutralMacros } from './macros'
import { paintRange, paintRangesOnInput, setPressed } from './ui/dom'
import { makeKnob } from './ui/knob'
import { asTheme, setupTheme, applyTheme, type Theme } from './ui/theme'
import { toast } from './ui/toast'

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T

// ?ui=0 is a capture output (OBS Browser Source): no floating buttons at all, from the first paint
document.body.classList.toggle('capture-output', new URLSearchParams(location.search).get('ui') === '0')
trackFocusOrigin()

const stage = $('stage')
const statusEl = $('status')
const clock = new MusicClock()
const midi = new MidiInput(clock)
const piano = new KeyboardPiano(clock)
const audio = new AudioInput(clock)
const caster = new Caster()
const sound = new SoundBack()
const instrument = new Instrument()
const gestures = new GestureInput()
const videoField = new VideoField()
const morph = new Morph()
const search = new PanelSearch($<HTMLInputElement>('controlSearch'), $('searchHelp'), $('panel'))

type Mode = 'midi' | 'file' | 'mic' | 'tab'
let mode: Mode = 'midi'

// ---------------------------------------------------------------- settings
interface Settings extends SimpleSettings {
  engine: string
  palette: number
  zoom: number
  zoomReact: number
  growth: number
  decay: number
  symmetry: number
  rotSpeed: number
  beatZoom: number
  beatPalette: number
  engineCtl: Record<string, Record<string, number>>
  /** MIDI CC number → control id (g:key or e:engine:key) */
  ccMap: Record<string, string>
  soundBack: boolean
  castUrl: string
  openSecs: Record<string, boolean>
  instrument: number
  instVol: number
  recMode: string
  rec: RecSettings
  /** audio attack sensitivity 0..1 (0.5 = the v0.15 onset detector) */
  audioSens: number
  /** the console's colours (the stage is dark either way) */
  theme: Theme
}
const LS = 'midiviz_settings_v3'
const settings: Settings = {
  engine: 'organism',
  palette: 0,
  zoom: 1,
  zoomReact: 0.5,
  growth: 1,
  decay: 0.15,
  symmetry: 1,
  rotSpeed: 0,
  beatZoom: 0,
  beatPalette: 0,
  engineCtl: {},
  ccMap: {},
  soundBack: false,
  castUrl: '',
  openSecs: {},
  instrument: 0,
  instVol: 0.5,
  recMode: 'now',
  rec: { ...REC_DEFAULTS },
  audioSens: 0.5,
  theme: 'dark',
  uiMode: 'simple',
  look: '',
  macros: neutralMacros(),
  macroBase: {},
  lookStarted: false,
  freshCanvas: false,
}
/** Nobody has tuned the Organism in this browser yet: the first-run look may set it up. */
let organismUntouched = true
{
  const stored = readStored(LS)
  const s = stored && typeof stored === 'object' ? (stored as Record<string, unknown>) : {}
  Object.assign(settings, s)
  // nested and versioned: validate rather than trust (older versions stored `recFormat` only)
  settings.rec = loadRecSettings(s.rec, s.recFormat)
  delete (settings as unknown as Record<string, unknown>).recFormat
  const unit = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : d)
  settings.audioSens = unit(settings.audioSens, 0.5)
  settings.uiMode = settings.uiMode === 'advanced' ? 'advanced' : 'simple'
  settings.theme = asTheme(settings.theme)
  settings.look = typeof settings.look === 'string' ? settings.look : ''
  // v0.20's growth / detail macros: Energy and Complexity took them over, knob and MIDI mapping alike
  settings.macros = loadMacroPositions(s.macros)
  settings.macroBase = loadMacroBases(s.macroBase)
  if (!settings.ccMap || typeof settings.ccMap !== 'object') settings.ccMap = {}
  for (const [cc, id] of Object.entries(settings.ccMap)) if (RENAMED_MACROS[id]) settings.ccMap[cc] = RENAMED_MACROS[id]
  settings.lookStarted = settings.lookStarted === true
  settings.freshCanvas = settings.freshCanvas === true
  organismUntouched = !(s.engineCtl && typeof s.engineCtl === 'object' && 'organism' in s.engineCtl)
}
audio.sensitivity = settings.audioSens
let saveT = 0
function save() {
  clearTimeout(saveT)
  saveT = window.setTimeout(writeSettings, 250)
}
function writeSettings() {
  clearTimeout(saveT)
  saveT = 0
  if (!writeStored(LS, settings)) storageUnavailable('Settings apply for this session only — browser storage is unavailable')
}
let storageWarned = false
/** Once per session: a status line, then only the header badge (a status per save would bury every other message). */
function storageUnavailable(msg: string) {
  $('storageNote').hidden = false
  if (storageWarned) return
  storageWarned = true
  setStatus(msg)
}
// the debounce must not lose the last change when the window closes or hides
window.addEventListener('pagehide', () => {
  if (saveT) writeSettings()
})
document.addEventListener('visibilitychange', () => {
  if (document.hidden && saveT) writeSettings()
})

const g: GlobalParams = {
  palette: PALETTES[settings.palette] ?? PALETTES[0],
  zoom: settings.zoom,
  zoomReact: settings.zoomReact,
  growth: settings.growth,
  decay: settings.decay,
  symmetry: settings.symmetry,
  symmetryNow: 1,
  zoomNow: 1,
  rotNow: 0,
}

// ---------------------------------------------------------------- control registry (sliders, selects, toggles)
interface Ctl {
  id: string
  c: EngineControl
  /** update the widget only — no apply, no save (for values the engine changed itself) */
  sync?: (n: number) => void
  /** set the value, update the widget, apply to engine / globals, persist */
  set: (n: number) => void
  wrap?: HTMLElement
  refreshCc?: () => void
}
const ctls = new Map<string, Ctl>()
let learning: Ctl | null = null

function setStatus(s: string) {
  statusEl.textContent = s
  statusEl.title = s // the line cuts long messages; the full one on hover
}
function setInteract(s: string) {
  $('interactStatus').textContent = s
}

/** An on/off control (0 / 1 in whole steps) shows as an LED switch instead of a two-stop fader. */
const isSwitch = (c: EngineControl) => !c.options && !c.icon && c.min === 0 && c.max === 1 && c.step === 1

function widget(host: HTMLElement, id: string, c: EngineControl, onChange: (v: number) => void, opts: WidgetOpts = {}): Ctl {
  const wrap = document.createElement('div')
  wrap.className = 'slider'
  const l = document.createElement('span')
  l.className = 'l'
  l.textContent = c.label
  const ccTag = document.createElement('span')
  ccTag.className = 'cc'
  l.appendChild(ccTag)
  const refreshCc = () => {
    const cc = Object.entries(settings.ccMap).find(([, v]) => v === id)?.[0]
    ccTag.textContent = cc !== undefined ? ` cc${cc}` : ''
  }
  refreshCc()
  wrap.dataset.search = c.key // "Find a setting" also knows controls by their key
  let ctl: Ctl
  if (isSwitch(c) && !opts.knob) {
    // an LED key: on / off, the label beside it
    wrap.classList.add('tog')
    const b = document.createElement('button')
    b.type = 'button'
    b.className = 'sw'
    b.setAttribute('aria-label', c.label)
    const show = (n: number) => {
      c.value = n
      b.setAttribute('aria-pressed', String(n > 0))
      b.textContent = n > 0 ? 'on' : 'off'
    }
    b.onclick = () => ctl.set(c.value > 0 ? 0 : 1)
    show(c.value)
    wrap.append(l, b)
    ctl = {
      id,
      c,
      sync: show,
      set: (n) => {
        n = Math.round(Math.min(c.max, Math.max(c.min, n)))
        show(n)
        onChange(n)
      },
    }
  } else if (c.options) {
    const sel = document.createElement('select')
    sel.setAttribute('aria-label', c.label)
    c.options.forEach((name, i) => {
      const o = document.createElement('option')
      o.value = String(i)
      o.textContent = name
      sel.appendChild(o)
    })
    sel.value = String(c.value)
    sel.onchange = () => ctl.set(parseInt(sel.value))
    wrap.append(l, sel)
    ctl = {
      id,
      c,
      sync: (n) => {
        c.value = n
        sel.value = String(n)
      },
      set: (n) => {
        n = Math.round(Math.min(c.max, Math.max(c.min, n)))
        c.value = n
        sel.value = String(n)
        onChange(n)
      },
    }
  } else {
    const v = document.createElement('span')
    v.className = 'v'
    v.textContent = String(c.value)
    const inp = document.createElement('input')
    inp.type = 'range'
    inp.setAttribute('aria-label', c.label)
    inp.min = String(c.min)
    inp.max = String(c.max)
    inp.step = String(c.step)
    inp.value = String(c.value)
    inp.oninput = () => ctl.set(parseFloat(inp.value))
    // a knob turns the same (visually hidden) input: focus, arrow keys and screen readers stay
    const knob = opts.knob ? makeKnob(inp, opts.centre) : null
    if (knob) {
      wrap.classList.add('kn')
      wrap.append(knob.el, inp, l, v)
    } else wrap.append(l, v, inp)
    const show = (n: number) => {
      c.value = n
      inp.value = String(n)
      v.textContent = String(+n.toFixed(3))
      paintRange(inp)
      knob?.paint()
    }
    show(c.value)
    ctl = {
      id,
      c,
      sync: show,
      set: (n) => {
        n = Math.min(c.max, Math.max(c.min, n))
        if (c.step >= 1) n = Math.round(n)
        show(n)
        onChange(n)
      },
    }
  }
  // right-click: MIDI CC learn
  wrap.oncontextmenu = (e) => {
    e.preventDefault()
    toggleLearn(ctl)
  }
  ctl.wrap = wrap
  ctl.refreshCc = refreshCc
  host.appendChild(wrap)
  ctls.set(id, ctl)
  return ctl
}

/** MIDI CC learn for a control (right-click its slider, or a quick control bound to it); again cancels. */
function toggleLearn(ctl: Ctl) {
  if (learning === ctl) {
    learning = null
    ctl.wrap?.classList.remove('learn')
    setInteract('learn cancelled')
    return
  }
  document.querySelectorAll('.learn').forEach((el) => el.classList.remove('learn'))
  learning = ctl
  ctl.wrap?.classList.add('learn')
  setInteract(`move a MIDI knob to map "${ctl.c.label}" (right-click again to cancel)`)
  setStatus(`MIDI learn: move a knob or fader on your controller for "${ctl.c.label}" — right-click again or Esc cancels`)
}

function refreshCcTags() {
  for (const c of ctls.values()) c.refreshCc?.()
}

// ---------------------------------------------------------------- engines
const ENGINES: (() => Engine)[] = [
  () => new OrganismEngine(),
  () => new ReactionDiffusionEngine(),
  () => new BranchingEngine(),
  () => new CellsEngine(),
  () => new Crystal3dEngine(),
]
const ENGINE_META = ENGINES.map((f) => {
  const e = f()
  return { id: e.id, name: e.name, blurb: e.blurb }
})
let engine: Engine | null = null
/** the mount in flight: one at a time (a second request meanwhile is dropped), and awaitable */
let mounting: Promise<void> | null = null

function selectEngine(id: string): Promise<void> {
  if (mounting) return mounting
  if (rec.busy() && engine?.id !== id) {
    setStatus('stop recording before switching patterns')
    return Promise.resolve()
  }
  const idx = ENGINE_META.findIndex((e) => e.id === id)
  if (idx < 0) return Promise.resolve()
  mounting = mountEngine(idx, id).finally(() => (mounting = null))
  return mounting
}

/** The Organism, mounted: waits out a mount in flight, then switches if needed. Null when it cannot be up. */
async function ensureOrganism(): Promise<Engine | null> {
  while (mounting) await mounting
  if (engine?.id !== 'organism') await selectEngine('organism')
  return engine?.id === 'organism' ? engine : null
}

async function mountEngine(idx: number, id: string) {
  try {
    engine?.unmount()
    engine = null
    for (const k of [...ctls.keys()]) if (k.startsWith('e:')) ctls.delete(k)
    const e = ENGINES[idx]()
    const saved = settings.engineCtl[e.id] ?? {}
    for (const c of e.controls) if (saved[c.key] !== undefined) c.value = saved[c.key]
    e.onEvent = (kind, pitch, vel) => sound.play(kind, pitch, vel)
    e.onStatus = (s) => setStatus(s)
    e.setVideoField?.(videoField)
    // the engine can add options (a loaded model) or move its own sliders (shell cycle)
    e.onControlsChanged = () => renderEngineControls(e)
    e.onControlValue = (key, value) => {
      const c = ctls.get(`e:${e.id}:${key}`)
      c?.sync?.(value)
      ;(settings.engineCtl[e.id] ??= {})[key] = value
      save()
      if (key.startsWith('video')) syncReference()
      if (key === 'shader') syncMaterial()
      macroMoved(`e:${e.id}:${key}`, value)
    }
    // GPU reset: a fresh engine with the saved controls instead of a black canvas (the growth is lost)
    e.onDeviceLost = (why) => {
      if (engine !== e) return
      setStatus(`GPU reset (${why}) — restoring the picture…`)
      void selectEngine(e.id)
    }
    await e.mount(stage)
    engine = e
    settings.engine = id
    save()
    renderEngineButtons()
    renderEngineControls(e)
    simple.engineMounted() // its saved values may predate a macro move
    syncReference()
    syncMaterial()
    cameraLabel()
    $('blurb').textContent = e.blurb
    $('hudEngine').textContent = e.name
  } catch (err) {
    setStatus(`engine failed: ${(err as Error).message}`)
  }
}

/** Many control writes as one engine batch: heavy rebuilds (held notes, materials) run once, at the end. */
function inBatch(e: Engine | null, fn: () => void) {
  e?.beginBatch?.()
  try {
    fn()
  } finally {
    e?.endBatch?.()
  }
}

function renderEngineButtons() {
  const host = $('engines')
  host.innerHTML = ''
  ENGINE_META.forEach((m, i) => {
    const b = document.createElement('button')
    b.type = 'button'
    const name = document.createElement('span')
    name.textContent = m.name
    const k = document.createElement('kbd')
    k.textContent = String(i + 1)
    b.append(name, k)
    b.title = `${m.name} — key ${i + 1}`
    b.dataset.search = m.id
    setPressed(b, engine?.id === m.id)
    b.onclick = () => void selectEngine(m.id)
    host.appendChild(b)
  })
}

/** Sections that start open the first time the panel is drawn. */
const OPEN_BY_DEFAULT = new Set(['Growth', 'Species', 'Settings']) // Settings: a simple engine's only group

/** Wire a <details> so its open/closed state is remembered. */
function rememberSection(det: HTMLDetailsElement, key: string, fallback: boolean) {
  det.open = settings.openSecs[key] ?? fallback
  det.addEventListener('toggle', () => {
    if (search.active) return // the search opens sections it matched; that is not the user's layout
    settings.openSecs[key] = det.open
    save()
  })
}

function renderEngineControls(e: Engine) {
  const host = $('engineControls')
  host.innerHTML = ''
  const bodies = new Map<string, HTMLElement>()
  const grids = new Map<string, HTMLElement>()
  const iconRefs: Record<string, (n: number) => void> = {}
  // one collapsible section per control group; ungrouped engines get a single list
  const bodyFor = (name: string) => {
    const existing = bodies.get(name)
    if (existing) return existing
    const det = document.createElement('details')
    det.className = 'sec panel'
    const sum = document.createElement('summary')
    const title = document.createElement('b')
    title.textContent = name
    sum.appendChild(title)
    const body = document.createElement('div')
    body.className = 'body'
    det.append(sum, body)
    host.appendChild(det)
    rememberSection(det, `${e.id}:${name}`, OPEN_BY_DEFAULT.has(name))
    bodies.set(name, body)
    const acts = (e.actions ?? []).filter((a) => a.group === name)
    if (acts.length) {
      const row = document.createElement('div')
      row.className = 'row acts'
      for (const a of acts) row.appendChild(actionButton(e, a))
      body.appendChild(row)
    }
    return body
  }
  for (const c of e.controls) {
    const id = `e:${e.id}:${c.key}`
    const group = c.group ?? 'Settings'
    const parent = bodyFor(group)
    const apply = (n: number) => {
      e.setControl(c.key, n)
      ;(settings.engineCtl[e.id] ??= {})[c.key] = n
      save()
      if (c.key.startsWith('video')) syncReference() // the quick controls show the same value
      if (c.key === 'shader') syncMaterial()
      macroMoved(id, n)
    }
    if (c.icon) {
      let grid = grids.get(group)
      if (!grid) {
        // mini LED keys in a grid (Code Painter's style keys), all / none above them
        const bar = document.createElement('div')
        bar.className = 'minis'
        const all = document.createElement('button')
        all.type = 'button'
        all.textContent = 'all'
        const none = document.createElement('button')
        none.type = 'button'
        none.textContent = 'none'
        all.onclick = () => inBatch(e, () => Object.values(iconRefs).forEach((f) => f(1)))
        none.onclick = () => inBatch(e, () => Object.values(iconRefs).forEach((f) => f(0)))
        bar.append(all, none)
        parent.appendChild(bar)
        grid = document.createElement('div')
        grid.className = 'icons'
        grid.setAttribute('role', 'group')
        grid.setAttribute('aria-label', group)
        parent.appendChild(grid)
        grids.set(group, grid)
      }
      const b = document.createElement('button')
      b.type = 'button'
      b.className = 'icon'
      b.title = `${c.icon} ${c.label}`
      b.dataset.search = c.key
      const name = document.createElement('span')
      name.textContent = c.label
      b.appendChild(name)
      setPressed(b, c.value > 0)
      const set = (n: number) => {
        c.value = n
        setPressed(b, n > 0)
        apply(n)
      }
      b.onclick = () => set(c.value > 0 ? 0 : 1)
      grid.appendChild(b)
      iconRefs[c.key] = set
      ctls.set(id, { id, c, set })
      continue
    }
    widget(parent, id, c, apply)
    // the model loader belongs with the shell settings it drives
    if (c.key === 'shell' && e.loadShell) {
      const row = document.createElement('div')
      row.className = 'row'
      const label = document.createElement('label')
      label.textContent = 'load model '
      const inp = document.createElement('input')
      inp.type = 'file'
      inp.accept = '.glb,.gltf,.obj,.stl'
      inp.onchange = async () => {
        const f = inp.files?.[0]
        if (f) setStatus(await loadModel(f))
      }
      label.appendChild(inp)
      row.appendChild(label)
      const note = document.createElement('div')
      note.className = 'note'
      note.textContent = 'glb / obj / stl — or drop one on the page. A rigged glb keeps its animation.'
      parent.append(row, note)
    }
    // the marker upload sits under the shape it selects
    if (c.key === 'tipShape' && e.loadTipMarker) {
      const row = document.createElement('div')
      row.className = 'row'
      const label = document.createElement('label')
      label.textContent = 'tip marker file '
      const inp = document.createElement('input')
      inp.type = 'file'
      inp.accept = '.png,.webp,.jpg,.jpeg,.obj'
      inp.onchange = async () => {
        const f = inp.files?.[0]
        if (!f || !e.loadTipMarker) return
        setStatus(`tip marker: loading ${f.name}…`)
        setStatus(await e.loadTipMarker(f))
        inp.value = '' // the same file again reloads it
      }
      label.appendChild(inp)
      row.appendChild(label)
      const note = document.createElement('div')
      note.className = 'note'
      note.textContent = 'transparent png / webp = a flat icon facing you; obj = a solid (≤ 2,048 triangles). For this session only.'
      parent.append(row, note)
    }
  }
  search.refresh() // an active search applies to the new sections too
}

/** An engine's preset button: every value goes through its widget, so it applies, saves and shows at once. */
function actionButton(e: Engine, a: EngineAction): HTMLButtonElement {
  const b = document.createElement('button')
  b.type = 'button'
  b.textContent = a.label
  if (a.title) b.title = a.title
  b.dataset.search = a.label
  b.onclick = () => {
    inBatch(e, () => {
      for (const [k, v] of Object.entries(a.values)) ctls.get(`e:${e.id}:${k}`)?.set(v)
    })
    setStatus(`${a.label}: ${Object.entries(a.values).map(([k, v]) => `${k} ${v}`).join(', ')}`)
  }
  return b
}

function renderGlobalControls() {
  const host = $('globalControls')
  host.innerHTML = ''
  const defs: (EngineControl & { apply: (n: number) => void })[] = [
    { key: 'zoom', label: 'zoom', min: 0.3, max: 4, step: 0.02, value: g.zoom, apply: (n) => (g.zoom = settings.zoom = n) },
    { key: 'zoomReact', label: 'zoom reacts to energy', min: 0, max: 1, step: 0.02, value: g.zoomReact, apply: (n) => (g.zoomReact = settings.zoomReact = n) },
    { key: 'growth', label: 'growth speed', min: 0.1, max: 3, step: 0.05, value: g.growth, apply: (n) => (g.growth = settings.growth = n) },
    { key: 'decay', label: 'decay (0 = accumulate)', min: 0, max: 1, step: 0.02, value: g.decay, apply: (n) => (g.decay = settings.decay = n) },
    { key: 'symmetry', label: 'mirror folds (1 = off, 0 = auto from chord)', min: 0, max: 8, step: 1, value: g.symmetry, apply: (n) => (g.symmetry = settings.symmetry = n) },
    { key: 'rotSpeed', label: 'rotation', min: -1, max: 1, step: 0.02, value: settings.rotSpeed, apply: (n) => (settings.rotSpeed = n) },
    { key: 'beatZoom', label: 'beat sync: zoom kick on the beat', min: 0, max: 1, step: 0.02, value: settings.beatZoom, apply: (n) => (settings.beatZoom = n) },
    { key: 'beatPalette', label: 'beat sync: next palette every bar (0 / 1)', min: 0, max: 1, step: 1, value: settings.beatPalette, apply: (n) => (settings.beatPalette = n) },
  ]
  for (const d of defs) {
    widget(host, `g:${d.key}`, d, (n) => {
      d.apply(n)
      save()
      macroMoved(`g:${d.key}`, n)
    })
  }
  // lives with the input it tunes; still a g: control, so it is MIDI-learnable and kept in presets
  const sens: EngineControl = { key: 'audioSens', label: 'audio sensitivity: how small a hit still grows (0.5 = standard)', min: 0, max: 1, step: 0.05, value: settings.audioSens }
  $('audioSensRow').innerHTML = ''
  widget($('audioSensRow'), 'g:audioSens', sens, (n) => {
    audio.sensitivity = settings.audioSens = n
    save()
  })
}

// ---------------------------------------------------------------- palette
{
  const sel = $<HTMLSelectElement>('palette')
  PALETTES.forEach((p, i) => {
    const o = document.createElement('option')
    o.value = String(i)
    o.textContent = p.name
    sel.appendChild(o)
  })
  sel.value = String(settings.palette)
  sel.onchange = () => setPalette(parseInt(sel.value))
}
function setPalette(i: number) {
  settings.palette = ((i % PALETTES.length) + PALETTES.length) % PALETTES.length
  g.palette = PALETTES[settings.palette]
  $<HTMLSelectElement>('palette').value = String(settings.palette)
  save()
}

// ---------------------------------------------------------------- presets + morph
const presets = loadPresets()
let currentPreset = -1

function snapshotPreset(): Preset {
  const globals: Record<string, number> = {}
  for (const [id, c] of ctls) if (id.startsWith('g:')) globals[id.slice(2)] = c.c.value
  const engineCtl: Record<string, number> = {}
  if (engine) for (const c of engine.controls) engineCtl[c.key] = c.value
  return { name: `preset ${stamp().slice(11, 16)}`, palette: settings.palette, globals, engine: engine?.id ?? settings.engine, engineCtl, ...simple.snapshotMacros() }
}

function renderPresets() {
  const host = $('presets')
  host.innerHTML = ''
  presets.forEach((p, i) => {
    const b = document.createElement('button')
    b.type = 'button'
    b.textContent = String(i + 1)
    b.title = p ? `${p.name} — click load, shift+click overwrite` : 'empty — shift+click to save here'
    b.setAttribute('aria-label', `slot ${i + 1}${p ? `: ${p.name}` : ', empty'}${i === currentPreset ? ', loaded' : ''}`)
    // LED: violet = something saved here, green = the slot loaded
    b.className = (p ? 'full' : '') + (i === currentPreset ? ' on' : '')
    b.onclick = (e) => (e.shiftKey ? savePreset(i) : void loadPreset(i))
    host.appendChild(b)
  })
}

/** Controls a random mix leaves alone: performance, output, and anything about the loaded model. */
const NO_RANDOM = new Set([
  'budget', 'recycle', 'quality', 'autoQuality', 'bounds',
  'shell', 'shellSize', 'shellLook', 'shellMode', 'shellCycle', 'shellCycleBeat', 'shellCycleSize', 'skinStick',
  'modelAnim', 'animSpeed', 'attach',
  'stemDrums', 'stemBass', 'stemVoice', 'stemOther',
  'text', 'textHold', 'cycleEvery', 'cycleMode',
  'musicAmount', // how strongly the music drives growth is a response setting, not a look
  'calmCamera', 'screenBounce', 'bounceSpeed', 'bounceSize', // presentation choices, not a look
  'videoBuild', // growth without music is a choice, not a look
  'tipLimit', // a performance cap, not a look
])
/** Keys that get a gentler range than their slider allows, so a mix stays playable. */
const RANDOM_CAP: Record<string, number> = { nested: 1, speed: 2, wild: 1.4, branch: 2, bloom: 1.2, env: 2, musicFocus: 0.7, tipShape: 8 } // 9-10: uploads

function randomMix() {
  const e = engine
  if (!e) return
  inBatch(e, () => randomValues(e))
  setPalette(Math.floor(Math.random() * PALETTES.length))
  ctls.get('g:decay')?.set(+(Math.random() * 0.6).toFixed(2))
  ctls.get('g:rotSpeed')?.set(+((Math.random() - 0.5) * 0.6).toFixed(2))
  ctls.get('g:zoomReact')?.set(+Math.random().toFixed(2))
  setStatus('wild mix — shift+click a preset slot to keep it')
}
function randomValues(e: Engine) {
  const icons = e.controls.filter((c) => c.icon)
  if (icons.length) {
    const want = 2 + Math.floor(Math.random() * 5)
    const on = new Set<number>()
    while (on.size < Math.min(want, icons.length)) on.add(Math.floor(Math.random() * icons.length))
    icons.forEach((c, i) => ctls.get(`e:${e.id}:${c.key}`)?.set(on.has(i) ? 1 : 0))
  }
  for (const c of e.controls) {
    if (c.icon || NO_RANDOM.has(c.key)) continue
    const max = Math.min(c.max, RANDOM_CAP[c.key] ?? c.max)
    const steps = Math.max(1, Math.round((max - c.min) / c.step))
    ctls.get(`e:${e.id}:${c.key}`)?.set(c.min + Math.round(Math.random() * steps) * c.step)
  }
}
$('wildMix').onclick = randomMix
$('randomMix').onclick = () => simple.surprise()

function savePreset(i: number) {
  presets[i] = snapshotPreset()
  const stored = savePresets(presets)
  currentPreset = i
  renderPresets()
  $('presetStatus').textContent = stored ? `saved slot ${i + 1}` : `slot ${i + 1} kept for this session only — browser storage is unavailable`
  toast(stored ? `preset slot ${i + 1} saved` : `slot ${i + 1}: this session only`, stored ? 'ok' : 'err')
  if (!stored) $('storageNote').hidden = false
}

async function loadPreset(i: number, dur = 2) {
  const p = presets[i]
  if (!p) {
    $('presetStatus').textContent = `slot ${i + 1} is empty — shift+click to save`
    return
  }
  currentPreset = i
  renderPresets()
  setPalette(p.palette)
  if (engine?.id !== p.engine) {
    settings.engineCtl[p.engine] = { ...(settings.engineCtl[p.engine] ?? {}), ...p.engineCtl }
    await selectEngine(p.engine)
  }
  const values: Record<string, number> = {}
  for (const [k, v] of Object.entries(p.globals)) values[`g:${k}`] = v
  for (const [k, v] of Object.entries(p.engineCtl)) values[`e:${p.engine}:${k}`] = v
  // the slot's knob positions come back with it; its values are made from its bases at those
  simple.recallMacros(p.macros, p.macroBase, values)
  applyValues(values, dur, true)
  $('presetStatus').textContent = `loading slot ${i + 1} (${p.name})`
}

/**
 * Set registry values (presets, looks, the Simple card, the macros): selects, toggles and whole
 * steps at once in one engine batch, the rest eased over `dur` seconds. Unchanged values are
 * skipped. `owned`: the values already carry the macros, so neither they nor the eased values
 * on the way re-derive the macros' bases (a clamped or half-eased value would drift them).
 */
function applyValues(values: Record<string, number>, dur: number, owned = false) {
  const from: Record<string, number> = {}
  const to: Record<string, number> = {}
  const own = (fn: () => void) => {
    if (owned) macroOwned++
    try {
      fn()
    } finally {
      if (owned) macroOwned--
    }
  }
  own(() =>
    inBatch(engine, () => {
      for (const [id, v] of Object.entries(values)) {
        const c = ctls.get(id)
        if (!c) continue
        morph.drop(id) // a newer value wins over an ease still running
        if (c.c.value === v) continue
        if (dur <= 0 || c.c.options || c.c.icon || c.c.step >= 1) c.set(v)
        else {
          from[id] = c.c.value
          to[id] = v
        }
      }
    }),
  )
  if (Object.keys(to).length) morph.start(from, to, dur, (id, v) => own(() => ctls.get(id)?.set(v)))
}

/** inside applyValues(…, owned): the macros already made these values */
let macroOwned = 0
/** A registry value moved (its slider, MIDI, an action, a random mix): a macro that scales it scales from there now. */
function macroMoved(id: string, value: number) {
  if (!macroOwned) simple.controlMoved(id, value)
}

// ---------------------------------------------------------------- MIDI: CC learn, program change, clock
midi.onCC = (cc, value) => {
  if (learning) {
    for (const k of Object.keys(settings.ccMap)) if (settings.ccMap[k] === learning.id) delete settings.ccMap[k]
    settings.ccMap[String(cc)] = learning.id
    save()
    learning.wrap?.classList.remove('learn')
    setInteract(`cc${cc} → ${learning.c.label}`)
    setStatus(`MIDI cc${cc} → ${learning.c.label}`)
    toast(`cc${cc} → ${learning.c.label}`)
    learning = null
    refreshCcTags()
    return
  }
  const id = settings.ccMap[String(cc)]
  if (!id) return
  const c = ctls.get(id)
  if (c) c.set(c.c.min + (c.c.max - c.c.min) * value)
}
midi.onProgram = (n) => void loadPreset(n % SLOTS)
$('ccClear').onclick = () => {
  settings.ccMap = {}
  save()
  refreshCcTags()
  setInteract('CC map cleared')
}

// ---------------------------------------------------------------- inputs
midi.onStatus = (s) => {
  if (mode === 'midi') setStatus(s)
}
audio.onStatus = (s) => {
  if (mode !== 'midi') setStatus(s)
}
/** connected MIDI inputs (the top bar's midi light) */
let midiDevices = 0
midi.onDevices = (devs) => {
  midiDevices = devs.length
  const sel = $<HTMLSelectElement>('midiDevice')
  const cur = sel.value
  sel.innerHTML = '<option value="all">all MIDI inputs</option>'
  for (const d of devs) {
    const o = document.createElement('option')
    o.value = d.id
    o.textContent = d.name
    sel.appendChild(o)
  }
  sel.value = devs.some((d) => d.id === cur) ? cur : 'all'
}
$<HTMLSelectElement>('midiDevice').onchange = (e) => midi.select((e.target as HTMLSelectElement).value)

function setMode(m: Mode) {
  mode = m
  clock.allOff()
  setPressed($('modeMidi'), m === 'midi')
  setPressed($('modeFile'), m === 'file')
  setPressed($('modeMic'), m === 'mic')
  setPressed($('modeTab'), m === 'tab')
  $('micRow').hidden = m !== 'mic'
  $('midiRow').hidden = m !== 'midi'
  $('fileRow').hidden = m !== 'file'
  $('stemsRow').hidden = m === 'midi'
  $('audioSensRow').hidden = m === 'midi'
  $('transport').hidden = m !== 'file'
  const label = m === 'midi' ? 'midi + keys' : m === 'file' ? 'audio file' : m === 'mic' ? 'line in' : 'tab audio'
  $('hudInput').textContent = label
  $('inputHint').textContent = label
  if (m === 'midi') {
    audio.stop()
    setStatus('MIDI mode — plug in a controller or play the computer keyboard')
  } else if (m === 'mic') {
    void audio.startMic($<HTMLSelectElement>('micDevice').value || undefined).then(refreshMics)
  } else if (m === 'tab') {
    void audio.startTabCapture()
  } else if (audio.source === 'file') audio.active = true
  else if (audio.pending !== 'file') {
    // a live mic / tab (or a prompt for one) ends here; a decode already in flight is left alone
    audio.stop()
    if (!audio.resumeFile()) setStatus('choose an mp3 / wav / ogg (or drop one on the page)')
  }
}
$('modeMidi').onclick = () => setMode('midi')
$('stems').onclick = () => {
  audio.stems = !audio.stems
  setPressed($('stems'), audio.stems)
  setStatus(audio.stems ? 'stems on — drums / bass / voice / other each grow their own species (see Organism stem selects)' : 'stems off')
}
const textIn = $<HTMLInputElement>('textIn')
function growTyped() {
  const s = textIn.value.trim()
  if (s && engine?.growText) engine.growText(s)
}
$('textGo').onclick = growTyped
textIn.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    growTyped()
    e.stopPropagation()
  }
})
let textWordI = 0
$('modeFile').onclick = () => setMode('file')
$('modeMic').onclick = () => setMode('mic')
$('modeTab').onclick = () => setMode('tab')
async function refreshMics() {
  const sel = $<HTMLSelectElement>('micDevice')
  const cur = sel.value
  const devs = await audio.listMics()
  sel.innerHTML = '<option value="">default input</option>'
  for (const d of devs) {
    const o = document.createElement('option')
    o.value = d.id
    o.textContent = d.label
    sel.appendChild(o)
  }
  sel.value = devs.some((d) => d.id === cur) ? cur : ''
}
$<HTMLSelectElement>('micDevice').onchange = () => {
  if (mode === 'mic') void audio.startMic($<HTMLSelectElement>('micDevice').value || undefined)
}
$('prevBtn').onclick = () => audio.prev()

// ---------------------------------------------------------------- video source (steers the growth, not the sound)
const videoPick = document.createElement('input')
videoPick.type = 'file'
videoPick.accept = 'video/*,.mp4,.mov,.webm,.m4v'
videoPick.onchange = () => {
  const f = videoPick.files?.[0]
  if (f) void openVideo(f)
}
async function openVideo(f: File) {
  const gen = videoField.generation
  setVideoStatus(await videoField.openFile(f))
  await afterSourceOpened(gen)
}
const imagePick = document.createElement('input')
imagePick.type = 'file'
imagePick.accept = 'image/*'
imagePick.onchange = () => {
  const f = imagePick.files?.[0]
  if (f) void openImage(f)
}
async function openImage(f: File) {
  const gen = videoField.generation
  setVideoStatus(await videoField.openImage(f))
  await afterSourceOpened(gen)
}
$('videoImage').onclick = () => imagePick.click()
function setVideoStatus(s: string) {
  $('videoStatus').textContent = s
}
/** A new source went live: guidance on, music-led. A failed or cancelled load changes nothing. */
async function afterSourceOpened(gen: number) {
  $('videoStop').hidden = !videoField.active
  if (videoField.active && videoField.generation !== gen) await activateReference()
  syncReference()
}
$('videoFile').onclick = () => videoPick.click()
$('videoCam').onclick = async () => {
  const gen = videoField.generation
  setVideoStatus(await videoField.openCamera($<HTMLSelectElement>('videoDevice').value || undefined))
  const cams = await videoField.listCameras()
  const sel = $<HTMLSelectElement>('videoDevice')
  const cur = sel.value
  sel.innerHTML = ''
  for (const c of cams) {
    const o = document.createElement('option')
    o.value = c.id
    o.textContent = c.label
    sel.appendChild(o)
  }
  if (cams.some((c) => c.id === cur)) sel.value = cur
  $('videoDeviceRow').hidden = cams.length < 2
  await afterSourceOpened(gen)
}
$<HTMLSelectElement>('videoDevice').onchange = async () => {
  if (videoField.source !== 'camera') return
  const gen = videoField.generation
  setVideoStatus(await videoField.openCamera($<HTMLSelectElement>('videoDevice').value))
  await afterSourceOpened(gen)
}
function stopVideo() {
  if (!videoField.active) return
  videoField.stop()
  $('videoStop').hidden = true
  setVideoStatus('video off')
  syncReference()
}
$('videoStop').onclick = stopVideo
// a camera unplugged, a frame that cannot be read
videoField.onStatus = (s) => {
  setVideoStatus(s)
  $('videoStop').hidden = !videoField.active
  syncReference()
}

// ---------------------------------------------------------------- 3D reference quick controls
// Bound to the Organism's own control entries (e:organism:<key>): presets, MIDI learn and saved
// settings see one value, whichever widget moved it.
const REF_TOGGLES = [
  ['refBuild', 'videoBuild'],
  ['refFollow', 'videoFollow'],
  ['refVisible', 'videoShow'],
  ['refInvert', 'videoInvert'],
] as const
const REF_SLIDERS = [
  ['refSize', 'videoSize'],
  ['refDepth', 'videoDepth'],
  ['refScatter', 'videoScatter'],
] as const
const refCtl = (key: string) => (engine?.id === 'organism' ? ctls.get(`e:organism:${key}`) : undefined)
/** Show brings back the opacity it hid. */
let refShown = 0.55

/** Guidance on, music-led: notes grow along the picture's lines and relief; nothing grows without music. */
async function activateReference() {
  if (!videoField.active || !(await ensureOrganism())) return
  // Trace / Grow over relief asked for this source; otherwise plain guidance
  applyValues(simple.takePendingIntent() ?? { 'e:organism:videoMode': 3, 'e:organism:videoBuild': 0 }, 0)
  syncReference()
}

function syncReference() {
  const box = $('referenceTools')
  box.hidden = !videoField.active
  if (box.hidden) return
  const organism = engine?.id === 'organism'
  for (const [id, key] of REF_TOGGLES) {
    const b = $<HTMLButtonElement>(id)
    const c = refCtl(key)
    const on = !!c && c.c.value > 0
    b.disabled = !c
    b.classList.toggle('active', on)
    b.setAttribute('aria-pressed', String(on))
  }
  for (const [id, key] of REF_SLIDERS) {
    const inp = $<HTMLInputElement>(id)
    const c = refCtl(key)
    inp.disabled = !c
    if (!c) continue
    inp.min = String(c.c.min)
    inp.max = String(c.c.max)
    inp.step = String(c.c.step)
    inp.value = String(c.c.value)
    paintRange(inp)
    $(`${id}Value`).textContent = String(+c.c.value.toFixed(3))
  }
  $<HTMLButtonElement>('refFit').disabled = !organism
  const mode = refCtl('videoMode')?.c.value ?? 0
  $('refHint').textContent = !organism
    ? 'Use as 3D shape switches to the Organism pattern.'
    : mode === 0
      ? 'Guidance is off: Use as 3D shape turns it on.'
      : (refCtl('videoBuild')?.c.value ?? 0) > 0
        ? 'Build shape is on: a background fill grows without music.'
        : 'Music-led: play notes or audio to grow into the picture. Build shape adds a background fill.'
}

for (const [id, key] of REF_TOGGLES) {
  $(id).onclick = () => {
    const c = refCtl(key)
    if (!c) return
    if (key === 'videoShow') {
      // visibility only: hiding remembers the opacity
      if (c.c.value > 0) refShown = c.c.value
      c.set(c.c.value > 0 ? 0 : refShown)
    } else c.set(c.c.value > 0 ? 0 : 1)
  }
}
for (const [id, key] of REF_SLIDERS) {
  const inp = $<HTMLInputElement>(id)
  inp.oninput = () => refCtl(key)?.set(parseFloat(inp.value))
  inp.oncontextmenu = (e) => {
    const c = refCtl(key)
    if (!c) return
    e.preventDefault()
    toggleLearn(c)
  }
}
$('refEnable').onclick = () => void activateReference()
$('refFit').onclick = () => {
  if (!engine?.fitReference?.()) setVideoStatus('Fit view needs guidance on: Use as 3D shape')
}
$('nextBtn').onclick = () => audio.next()

// ---------------------------------------------------------------- material quick row
// Bound to the Organism's own growth-shader control, like the reference quick controls above.
const materialCtl = () => (engine?.id === 'organism' ? ctls.get('e:organism:shader') : undefined)

function syncMaterial() {
  const row = $('materialQuick')
  const c = materialCtl()
  row.hidden = !c
  if (!c) return
  const sel = $<HTMLSelectElement>('materialPick')
  const names = c.c.options ?? []
  if (sel.dataset.names !== names.join('|')) {
    sel.dataset.names = names.join('|')
    sel.innerHTML = ''
    const groups = [document.createElement('optgroup'), document.createElement('optgroup')]
    groups[0].label = 'surfaces'
    groups[1].label = 'animated (move with the music)'
    names.forEach((name, i) => {
      const o = document.createElement('option')
      o.value = String(i)
      o.textContent = name
      groups[i < ANIMATED_START ? 0 : 1].appendChild(o)
    })
    sel.append(...groups.filter((gr) => gr.children.length))
  }
  sel.value = String(c.c.value)
}
$<HTMLSelectElement>('materialPick').onchange = () => materialCtl()?.set(parseInt($<HTMLSelectElement>('materialPick').value))
$('materialPick').oncontextmenu = (ev) => {
  const c = materialCtl()
  if (!c) return
  ev.preventDefault()
  toggleLearn(c)
}
$('materialNext').onclick = () => {
  const c = materialCtl()
  if (!c) return
  const n = (c.c.options?.length ?? 0) - ANIMATED_START
  if (n <= 0) return
  const cur = c.c.value
  c.set(cur < ANIMATED_START ? ANIMATED_START : ANIMATED_START + ((cur - ANIMATED_START + 1) % n))
  setStatus(`material: ${c.c.options?.[c.c.value] ?? c.c.value}`)
}

// transport (file mode)
const seekEl = $<HTMLInputElement>('seek')
let seeking = false
$('playBtn').onclick = () => audio.togglePlay()
seekEl.oninput = () => (seeking = true)
seekEl.onchange = () => {
  seeking = false
  audio.seek((parseInt(seekEl.value) / 1000) * audio.duration)
}
function renderPlaylist() {
  const host = $('playlist')
  host.innerHTML = ''
  if (audio.playlist.length < 2) {
    host.hidden = true
    return
  }
  host.hidden = false
  audio.playlist.forEach((f, i) => {
    const b = document.createElement('button')
    b.type = 'button'
    b.textContent = `${i + 1}. ${f.name}`
    b.title = f.name
    b.className = i === audio.trackI ? 'on' : ''
    if (i === audio.trackI) b.setAttribute('aria-current', 'true')
    b.onclick = () => void audio.loadTrack(i)
    host.appendChild(b)
  })
}
audio.onTrack = () => renderPlaylist()

const fmtT = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`
function updateTransport() {
  if (mode !== 'file' || !audio.duration) return
  $('playBtn').textContent = audio.playing ? '❚❚' : '▶'
  if (!seeking) {
    seekEl.value = String(Math.round((audio.currentTime / audio.duration) * 1000))
    paintRange(seekEl)
  }
  const n = audio.playlist.length
  $('timeLbl').textContent = `${fmtT(audio.currentTime)} / ${fmtT(audio.duration)}${n > 1 ? ` · ${audio.trackI + 1}/${n}` : ''}`
}
$<HTMLInputElement>('file').onchange = (e) => {
  const fs = [...((e.target as HTMLInputElement).files ?? [])]
  if (fs.length) void loadAudio(fs)
}
async function loadAudio(fs: File[]) {
  if (mode !== 'file') setMode('file')
  await audio.loadFiles(fs)
  renderPlaylist()
}
window.addEventListener('dragover', (e) => {
  e.preventDefault()
  document.body.classList.add('dragging')
})
window.addEventListener('dragleave', () => document.body.classList.remove('dragging'))
window.addEventListener('drop', (e) => {
  e.preventDefault()
  document.body.classList.remove('dragging')
  const all = [...(e.dataTransfer?.files ?? [])]
  if (!all.length) return
  const f = all[0]
  const isAudio = (x: File) => x.type.startsWith('audio/') || /\.(mp3|wav|ogg|flac|m4a|aac)$/i.test(x.name)
  const isVideo = (x: File) => x.type.startsWith('video/') || /\.(mp4|mov|webm|m4v|avi)$/i.test(x.name)
  const isImage = (x: File) => x.type.startsWith('image/') || /\.(png|jpe?g|webp|gif|bmp)$/i.test(x.name)
  if (/\.(glb|gltf|obj|stl)$/i.test(f.name) && engine?.loadShell) void loadModel(f).then(setStatus)
  else if (isVideo(f)) void openVideo(f)
  else if (isImage(f)) void openImage(f)
  else if (all.some(isAudio)) {
    const tracks = all.filter(isAudio)
    // drop onto a running playlist with shift held = append
    if (e.shiftKey && audio.playlist.length) void audio.addFiles(tracks).then(renderPlaylist)
    else void loadAudio(tracks)
  }
})

/** A 3D model as the Organism's shell, selected in its shell control (saved, and seen by the Simple card). */
async function loadModel(f: File): Promise<string> {
  const e = engine
  if (!e?.loadShell) return 'this pattern takes no 3D model'
  const msg = await e.loadShell(f)
  const shell = e.controls.find((x) => x.key === 'shell')
  if (shell && engine === e) ctls.get(`e:${e.id}:shell`)?.set(shell.value)
  return msg
}

// ---------------------------------------------------------------- output: record / still / cast
function stageCanvas(): HTMLCanvasElement | null {
  return engine?.canvasEl?.() ?? stage.querySelector('canvas')
}
// recording: state machine, options and the Output section live in recordUi.ts
const rec = setupRecording({
  settings,
  save,
  setStatus,
  engine: () => engine,
  canvas: stageCanvas,
  inputMode: () => mode,
})
let stillPending = false
async function takeStill(scale: 1 | 2) {
  // Draw and capture in one step. Reading a WebGPU canvas at any other moment
  // can hand back an empty image, because the drawing buffer is only valid
  // immediately after the render.
  if (engine?.snapshot) {
    if (scale === 2) setStatus('rendering 2× still…')
    const blob = await engine.snapshot(scale)
    if (blob) {
      const name = `growth-${stamp()}${scale === 2 ? '-2x' : ''}.png`
      download(blob, name)
      setStatus(`saved ${name} (${(blob.size / 1e6).toFixed(1)} MB)`)
      toast(`still saved · ${name}`)
    } else {
      setStatus('snapshot failed')
      toast('snapshot failed', 'err')
    }
    return
  }
  stillPending = true // engines without their own snapshot: grab after the next frame
}

// ---------------------------------------------------------------- camera style: one button, always reachable
function cameraCtl() {
  return engine ? ctls.get(`e:${engine.id}:camMode`) : undefined
}
const cameraName = (c: Ctl) => c.c.options?.[c.c.value] ?? String(c.c.value)
let shownCamera = ''
function cameraLabel() {
  const c = cameraCtl()
  const b = $('camCycle')
  b.hidden = !c
  if (c) {
    const name = cameraName(c)
    if (name !== shownCamera) {
      shownCamera = name
      b.textContent = name.replace(/ \(.*\)$/, '') // "flight (through the growth)" → flight; the title has it all
      b.title = `camera: ${name} — C next style · Shift+C previous`
      b.setAttribute('aria-label', `Camera: ${name}. Next camera style`)
    }
  }
  // the lock is UI: it lives in the panel, so it is never in a capture or over "Show controls"
  const lock = $('camLock')
  lock.hidden = !engine?.toggleCameraLock
  const on = !!engine?.cameraLocked
  lock.textContent = on ? 'locked' : 'lock'
  setPressed(lock, on)
  lock.title = on ? 'V — unlock: the camera moves again' : 'V — freeze this view (Reset keeps it)'
  simple.sync() // camera style and source buttons read the same controls
}
function cycleCamera(step = 1) {
  const c = cameraCtl()
  if (!c) return setStatus('this pattern has no camera styles')
  const n = c.c.options?.length ?? c.c.max + 1
  c.set((c.c.value + step + n) % n)
  cameraLabel()
  setStatus(`camera: ${cameraName(c)}${engine?.cameraLocked ? ' (the view is locked — V unlocks)' : ''}`)
}
function toggleCameraLock() {
  if (!engine?.toggleCameraLock) return setStatus('this pattern has no camera lock')
  const on = engine.toggleCameraLock()
  cameraLabel()
  setStatus(on ? 'view locked — the growth goes on, Reset keeps this view · V unlocks' : 'view unlocked')
}
$('camCycle').onclick = () => cycleCamera()
$('camLock').onclick = toggleCameraLock
$('still').onclick = (e) => void takeStill(e.shiftKey ? 2 : 1)
$('stillKey').onclick = (e) => void takeStill(e.shiftKey ? 2 : 1)
// easy's Export step: the whole Output panel is in the console
$('moreOutput').onclick = () => {
  if (settings.uiMode !== 'advanced') $('uiTier').click()
  const out = $<HTMLDetailsElement>('sec-output')
  out.open = true
  out.scrollIntoView({ block: 'start', behavior: 'smooth' })
}

$<HTMLInputElement>('castUrl').value = settings.castUrl
$<HTMLInputElement>('castUrl').onchange = (e) => {
  settings.castUrl = (e.target as HTMLInputElement).value.trim()
  save()
}
caster.onStatus = (s, d) => {
  $('castStatus').textContent = `cast: ${s}${d ? ' — ' + d : ''}`
  $('cast').textContent = s === 'live' || s === 'connecting' ? 'stop cast' : 'cast'
}
$('cast').onclick = () => {
  if (caster.status === 'live' || caster.status === 'connecting') return caster.stop()
  const canvas = stageCanvas()
  const url = settings.castUrl
  if (!canvas || !url) {
    $('castStatus').textContent = 'cast: set the WHIP url first (http://host:8889/<path>/whip)'
    return
  }
  void caster.start(canvas, url)
}

// ---------------------------------------------------------------- interact: instrument, sound-back, gestures
{
  const sel = $<HTMLSelectElement>('instrument')
  INSTRUMENTS.forEach((n, i) => {
    const o = document.createElement('option')
    o.value = String(i)
    o.textContent = n
    sel.appendChild(o)
  })
  instrument.preset = settings.instrument
  instrument.volume = settings.instVol
  sel.value = String(settings.instrument)
  sel.onchange = () => {
    instrument.allOff()
    instrument.preset = settings.instrument = parseInt(sel.value)
    save()
  }
  const vol = $<HTMLInputElement>('instVol')
  vol.value = String(settings.instVol)
  vol.oninput = () => {
    instrument.volume = settings.instVol = parseFloat(vol.value)
    save()
  }
}
sound.enabled = settings.soundBack
setPressed($('soundBack'), sound.enabled)
$('soundBack').onclick = () => {
  sound.enabled = settings.soundBack = !sound.enabled
  save()
  setPressed($('soundBack'), sound.enabled)
  setInteract(sound.enabled ? 'sound-back on — fuses, bursts and spawns play a pluck' : 'sound-back off')
}
$('gestures').onclick = async () => {
  if (gestures.running) {
    gestures.stop()
    engine?.setGesture?.(null)
    setPressed($('gestures'), false)
    setInteract('gestures off')
    return
  }
  setPressed($('gestures'), true)
  await gestures.start(setInteract)
  if (!gestures.running) setPressed($('gestures'), false)
}

// ---------------------------------------------------------------- performance mode
let cursorT = 0
function hideCursorSoon() {
  document.body.classList.remove('hide-cursor')
  clearTimeout(cursorT)
  if (document.body.classList.contains('hide-ui')) cursorT = window.setTimeout(() => document.body.classList.add('hide-cursor'), 2000)
}
window.addEventListener('mousemove', hideCursorSoon)
const uiHidden = () => document.body.classList.contains('hide-ui')
/** Where keyboard focus was in the panel when it was hidden, to put it back on show. */
let focusBeforeHide: HTMLElement | null = null
function setUiHidden(h: boolean) {
  const panel = $('panel')
  const active = document.activeElement instanceof HTMLElement ? document.activeElement : null
  if (h && !uiHidden()) {
    focusBeforeHide = active && panel.contains(active) && focusedByKeyboard(active) ? active : null
    if (active && panel.contains(active)) active.blur()
  }
  // inert: Tab cannot wander into invisible controls, and they cannot eat keys
  panel.inert = h
  document.body.classList.toggle('hide-ui', h)
  if (!h) {
    // keyboard users get their place back (or the hide button when they came from "Show controls")
    const back = focusBeforeHide ?? (active?.id === 'returnUi' && focusedByKeyboard(active) ? $('hideUi') : null)
    focusBeforeHide = null
    if (back?.isConnected) back.focus({ preventScroll: true })
  }
  hideCursorSoon()
}
$('returnUi').onclick = () => setUiHidden(false)

// The stage is its own cell (no panel covers it), so the engine never needs a frame inset now
// (Engine.setFrameInset stays for an overlay layout). It does need to hear when the cell resizes
// without the window: easy ↔ console, hide UI, a search opening the console column.
new ResizeObserver(() => engine?.resize()).observe(stage)
async function performanceMode() {
  setUiHidden(true)
  try {
    if (!document.fullscreenElement) await document.documentElement.requestFullscreen({ navigationUI: 'hide' })
  } catch {
    /* fullscreen may be refused; UI is still hidden */
  }
}
document.addEventListener('fullscreenchange', () => {
  if (!document.fullscreenElement && new URLSearchParams(location.search).get('ui') !== '0') setUiHidden(false)
})
$('perf').onclick = () => void performanceMode()
$('hideUi').onclick = () => setUiHidden(!uiHidden())
// full screen with the controls (perform is full screen without them)
$('fullBtn').onclick = async () => {
  try {
    if (document.fullscreenElement) await document.exitFullscreen()
    else await document.documentElement.requestFullscreen({ navigationUI: 'hide' })
  } catch {
    setStatus('full screen was refused by the browser')
  }
}
$('themeBtn').onclick = () => {
  settings.theme = settings.theme === 'light' ? 'dark' : 'light'
  applyTheme(settings.theme)
  save()
}

/** Reset the pattern but keep growing for notes still held (as the same notes: no new attack). */
function resetEngine() {
  engine?.clear()
  const t = clock.now()
  for (const n of [...clock.state.notes.values()]) clock.push({ kind: 'on', pitch: n.pitch, velocity: n.velocity, time: t, channel: n.channel, source: n.source, stem: n.stem, regrow: true })
}
$('clear').onclick = () => resetEngine()

function cancelLearn() {
  if (!learning) return
  learning.wrap?.classList.remove('learn')
  learning = null
  setInteract('learn cancelled')
  setStatus('MIDI learn cancelled')
}

// One keydown handler for the shortcuts and the piano, so the order is explicit:
// guards → Esc / F2 → what the focused control owns → piano → shortcuts.
// Tab is never touched: it moves focus.
window.addEventListener('keydown', (e) => {
  if (ignoredKey(e)) return
  const k = e.key
  if (k === 'Escape') {
    cancelLearn()
    setUiHidden(false)
    return
  }
  if (k === 'F2') {
    if (!e.repeat) setUiHidden(!uiHidden())
    e.preventDefault()
    return
  }
  const el = e.target instanceof HTMLElement ? e.target : null
  const kind = classifyTarget(el)
  const byKeyboard = focusedByKeyboard(el)
  if (controlOwnsKey(kind, k, byKeyboard)) return
  // a select the mouse left focused would also type-ahead to an option starting with this letter
  if (kind === 'select' && !byKeyboard) el?.blur()
  if (piano.handleKeyDown(e)) return
  if (e.repeat && !k.startsWith('Arrow')) return
  // handled keys never reach the focused control (Space / Enter would click a button the mouse left focused)
  if (runShortcut(e)) e.preventDefault()
})

function runShortcut(e: KeyboardEvent): boolean {
  const k = e.key
  // top-row digits by position: AZERTY types & é " … unshifted, and Shift+digit is the preset row everywhere
  const digit = /^Digit([1-9])$/.exec(e.code)?.[1] ?? /^[1-9]$/.exec(k)?.[0]
  if (digit && e.shiftKey) {
    if (+digit > SLOTS) return false
    void loadPreset(+digit - 1)
  } else if (digit) {
    const m = ENGINE_META[+digit - 1]
    if (!m) return false
    void selectEngine(m.id)
  } else if (e.code === 'Backquote' || k === '`') setUiHidden(!uiHidden()) // F2 needs Fn on a Mac; this is left of 1
  else if (k === 'Enter') void performanceMode()
  else if (k === 'Backspace' || k === 'Delete') resetEngine()
  else if (k === ']' || k === '[') setPalette(settings.palette + (k === ']' ? 1 : -1))
  else if (k === 'r' || k === 'R') void rec.toggle()
  else if (k === 'c' || k === 'C') cycleCamera(e.shiftKey ? -1 : 1)
  else if (k === 'v' || k === 'V') toggleCameraLock()
  else if (k === 'q' || k === 'Q') void takeStill(e.shiftKey ? 2 : 1)
  else if (k === ' ') {
    if (mode === 'file') audio.togglePlay()
  } else if (k === 'ArrowUp' || k === 'ArrowDown') ctls.get('g:zoom')?.set(+(g.zoom * (k === 'ArrowUp' ? 1.08 : 1 / 1.08)).toFixed(2))
  else if (k === 'ArrowLeft' || k === 'ArrowRight') ctls.get('g:symmetry')?.set(g.symmetry + (k === 'ArrowRight' ? 1 : -1))
  else return false
  return true
}

// ---------------------------------------------------------------- loop
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
let zoomSmooth = 1
let symHold = 1
let symHoldT = 0
let hudN = 0
let fpsEma = 60
let lastBar = 0
const meter = $('meter').firstElementChild as HTMLElement

const playsInstrument = (s: NoteSource) => s === 'midi' || s === 'keys'

/**
 * Performance → frame cap: skip the display frames above it, so a 120 / 144 Hz laptop does half
 * the work. Notes wait in the clock for the next drawn frame. Never during a take (its frames are
 * the file's).
 */
let capDue = 0
function overCap(now: number): boolean {
  const e = engine
  const cap = e && !e.lockQuality ? (FRAME_CAPS[ctl(e.controls, 'fpsCap')] ?? 0) : 0
  if (!cap) return false
  const iv = 1000 / cap
  // up to 3 ms early is on time: a 60 Hz panel never drops a frame to jitter, a 144 Hz one alternates 2 and 3
  if (now < capDue - 3) return true
  capDue = now - capDue > iv ? now + iv : capDue + iv
  return false
}

function loop() {
  requestAnimationFrame(loop)
  if (overCap(performance.now())) return
  const onset = audio.analyze()
  clock.tick(mode !== 'midi' && audio.active ? audio.features : null, mode !== 'midi' ? onset : 0)
  const m = clock.state
  morph.tick()
  simple.tick()
  // the instrument plays what you play (every MIDI channel, the keyboard), never audio pseudo-notes;
  // its voices are per pitch, so a pitch sounds until its last player lets go
  for (const ev of m.events) {
    if (!playsInstrument(ev.source) || ev.regrow) continue
    if (ev.kind === 'on') instrument.noteOn(ev.pitch, ev.velocity)
    else if (![...m.notes.values()].some((n) => n.pitch === ev.pitch && playsInstrument(n.source))) instrument.noteOff(ev.pitch)
  }
  rec.notes(m.events) // an armed take starts on this frame's first note

  // auto-modulation of the shared knobs
  const beatKick = settings.beatZoom > 0 && m.beat.bpm > 0 ? settings.beatZoom * 0.25 * Math.pow(1 - m.beat.phase, 3) : 0
  const zoomTarget = g.zoom * (1 + g.zoomReact * (0.35 * m.energy + 0.18 * m.onset) + beatKick) * (1 + 0.025 * Math.sin(m.time * 0.35))
  zoomSmooth += (zoomTarget - zoomSmooth) * (1 - Math.exp(-m.dt * (zoomTarget > zoomSmooth ? 14 : 3)))
  g.zoomNow = zoomSmooth
  if (g.symmetry > 0) g.symmetryNow = g.symmetry
  else {
    if (m.polyphony >= symHold || m.time - symHoldT > 2.5) {
      symHold = m.polyphony
      symHoldT = m.time
    }
    g.symmetryNow = symHold
  }
  g.rotNow += (settings.rotSpeed * 0.6 + m.pitchBend * 0.8 + m.cc[1] * 0.5) * m.dt
  if (m.beat.barHit > 0.95 && m.beat.beat !== lastBar) {
    lastBar = m.beat.beat
    if (settings.beatPalette > 0) setPalette(settings.palette + 1)
    // typography = typed text: one word per bar from the text box
    const typed = engine?.controls.find((c) => c.key === 'text')?.value === 2
    const words = textIn.value.trim().split(/\s+/).filter(Boolean)
    if (typed && words.length && engine?.growText) engine.growText(words[textWordI++ % words.length])
  }
  if (gestures.running) engine?.setGesture?.(gestures.gesture)

  fpsEma += (1 / Math.max(1e-3, m.dt) - fpsEma) * 0.05
  try {
    engine?.frame(m, g)
  } catch (err) {
    setStatus(`frame error: ${(err as Error).message}`)
  }
  rec.afterFrame() // the frame just drawn goes to the encoder, in the same task
  if (stillPending) {
    stillPending = false
    const c = stageCanvas()
    if (c) void snapshot(c).then(setStatus)
  }

  if (++hudN % 6 === 0) {
    const notes = [...m.active.values()]
      .sort((a, b) => a.pitch - b.pitch)
      .slice(0, 8)
      .map((n) => NOTE_NAMES[pitchClass(n.pitch)] + octave(n.pitch))
    $('hudNotes').textContent = notes.length ? notes.join(' ') : '–'
    meter.style.width = `${Math.round(m.energy * 100)}%`
    $('hudBpm').textContent = m.beat.bpm > 0 ? `${Math.round(m.beat.bpm)}${m.beat.source === 'clock' ? '♩' : ''}` : '–'
    $('hudZoom').textContent = g.zoomNow.toFixed(2)
    $('hudFps').textContent = String(Math.round(fpsEma))
    const st = engine?.stats?.() ?? ''
    cameraLabel() // presets, random mix and MIDI can all move it
    $('hudRec').textContent = rec.hud() + (st ? ` · ${st}` : '')
    $('hudRec').classList.toggle('live', rec.busy()) // red only while a take is on
    updateTransport()
    statusLights(m)
  }
}

/** The top bar's lights: midi (a device or a held note), audio (live input), rec (red; violet while armed). */
const lights = { midi: $('ledMidi'), audio: $('ledAudio'), rec: $('ledRec') }
function statusLights(m: { active: ReadonlyMap<unknown, { source: NoteSource }> }) {
  const played = [...m.active.values()].some((n) => playsInstrument(n.source))
  lights.midi.classList.toggle('on', mode === 'midi' && (midiDevices > 0 || played))
  lights.audio.classList.toggle('on', mode !== 'midi' && audio.active && (audio.source !== 'file' || audio.playing))
  const take = rec.state()
  lights.rec.classList.toggle('on', take === 'starting' || take === 'recording' || take === 'stopping')
  lights.rec.classList.toggle('armed', take === 'armed' || take === 'counting')
}

// ---------------------------------------------------------------- url params (capture-friendly launch)
const params = new URLSearchParams(location.search)
function captureUrl(): string {
  const u = new URL(location.href)
  u.search = ''
  u.searchParams.set('ui', '0')
  if (currentPreset >= 0) u.searchParams.set('preset', String(currentPreset + 1))
  if (engine) u.searchParams.set('engine', engine.id)
  const cam = engine?.controls.find((c) => c.key === 'camMode')?.value
  if (cam !== undefined) u.searchParams.set('cam', String(cam))
  return u.toString()
}
$('copyCaptureUrl').onclick = async () => {
  const url = captureUrl()
  try {
    await navigator.clipboard.writeText(url)
    $('captureStatus').textContent = 'copied — paste into an OBS Browser Source (set its size to your output)'
  } catch {
    $('captureStatus').textContent = url
  }
}
async function applyParams() {
  const eng = params.get('engine')
  if (eng && ENGINE_META.some((e) => e.id === eng)) await selectEngine(eng)
  const p = params.get('preset')
  if (p) await loadPreset(Math.max(0, Math.min(SLOTS - 1, parseInt(p) - 1)), 0.01)
  const cam = params.get('cam')
  if (cam) ctls.get(`e:${engine?.id}:camMode`)?.set(parseInt(cam))
  const mode = params.get('mode')
  if (mode === 'mic' || mode === 'file') setMode(mode)
}

// ---------------------------------------------------------------- boot
window.addEventListener('resize', () => engine?.resize())
setupTheme(settings.theme) // set before the first paint (index.html); this bakes the case's dot grid
document.getElementById('ver')!.textContent = 'v' + VERSION
document.getElementById('hudVer')!.textContent = 'v' + VERSION
document.title = `Growth v${VERSION} — MIDI / music visualiser`
for (const det of document.querySelectorAll<HTMLDetailsElement>('details.sec[id]')) rememberSection(det, det.id, det.open)
renderGlobalControls()
// Simple mode's card: a view of the same registry (the tier attribute was set before the first paint)
const simple = setupSimple({
  settings,
  save,
  setStatus,
  ctl: (id) => ctls.get(id),
  slider: widget,
  engine: () => engine,
  organism: ensureOrganism,
  apply: applyValues,
  setPalette,
  reset: resetEngine,
  source: { active: () => videoField.active, pickPicture: () => imagePick.click(), stop: stopVideo },
  loadModel,
  cameraChanged: () => cameraLabel(),
})
// a search looks through every tier: Simple shows the Advanced rows while one runs
search.onActiveChange = (on) => document.documentElement.toggleAttribute('data-searching', on)
renderEngineButtons()
renderPresets()
setMode('midi')
if (params.get('ui') === '0') setUiHidden(true) // before the engine mounts, so the panel never flashes in a capture
delete document.documentElement.dataset.capture // index.html's first-paint guard: body.hide-ui has taken over
void midi.start()
// first run: the Roots look once the engine is up — never over a capture URL or settings someone made
const launchParams = ['engine', 'preset', 'cam', 'ui'].some((k) => params.has(k))
void selectEngine(ENGINE_META.some((e) => e.id === settings.engine) ? settings.engine : 'organism')
  .then(applyParams)
  .then(() => simple.firstRun(launchParams || !organismUntouched || engine?.id !== 'organism'))
piano.enabled = true
paintRangesOnInput() // the faders' green fill: every drag repaints, and the static ones start right
// debug handle (console): window.__viz.clock.state, window.__viz.audio.features, window.__viz.engine
;(window as unknown as { __viz: unknown }).__viz = {
  clock,
  audio,
  midi,
  g,
  ctls,
  recorder: rec.recorder,
  morph,
  videoField,
  audioContext,
  recordingStream,
  instrument,
  get engine() {
    return engine
  },
}
loop()
