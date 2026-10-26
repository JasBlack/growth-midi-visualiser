import type { MusicState } from './music'
import type { Palette } from './color'
import type { Gesture } from './vision'
import type { VideoField } from './videoField'

/** Knobs shared by every engine, driven from the side panel + auto-modulation. */
export interface GlobalParams {
  palette: Palette
  /** Base zoom (1 = fit). */
  zoom: number
  /** How strongly energy pushes zoom (0..1). */
  zoomReact: number
  /** Growth speed multiplier (0.1..3). */
  growth: number
  /** Decay / fade of old material (0 = accumulate forever, 1 = fast fade). */
  decay: number
  /** Replication / symmetry folds. 0 = automatic (from polyphony). */
  symmetry: number
  /** Effective symmetry after auto-resolution (filled by main each frame). */
  symmetryNow: number
  /** Effective zoom after auto-modulation (filled by main each frame). */
  zoomNow: number
  /** Effective rotation angle in radians (filled by main each frame). */
  rotNow: number
}

export interface EngineControl {
  key: string
  label: string
  min: number
  max: number
  step: number
  value: number
  /** When set, the panel renders a select (value = option index) instead of a slider. */
  options?: string[]
  /** When set, the panel renders an on/off icon button (value 0 / 1) in a grid. */
  icon?: string
  /** Panel section this control belongs to. Ungrouped controls render in one flat list. */
  group?: string
}

/** A one-click set of control values, shown as a button at the top of a panel section. */
export interface EngineAction {
  group: string
  label: string
  title?: string
  values: Readonly<Record<string, number>>
}

export interface Engine {
  readonly id: string
  readonly name: string
  readonly blurb: string
  /** Engine-specific knobs; rendered by the panel. */
  controls: EngineControl[]
  /** Optional: preset buttons over those knobs (applied like panel changes: saved, MIDI-mapped widgets follow). */
  readonly actions?: readonly EngineAction[]
  mount(host: HTMLElement): Promise<void> | void
  resize(): void
  frame(m: MusicState, g: GlobalParams): void
  clear(): void
  unmount(): void
  /** Called when a panel knob changes. */
  setControl(key: string, value: number): void
  /** Optional: accept a 3D model file (GLB / OBJ / STL) as a boundary shell. Resolves to a status line. */
  loadShell?(file: File): Promise<string>
  /** Optional: a picture (PNG / WebP / JPG) or OBJ as the growing-tip marker, for this session. Resolves to a status line. */
  loadTipMarker?(file: File): Promise<string>
  /** Optional: set by the app; the engine reports something the user should read in the status line. */
  onStatus?: (msg: string) => void
  /** Optional: the engine reports structural events (fuse, burst, spawn) — used for sound-back. */
  onEvent?: (kind: 'fuse' | 'burst' | 'spawn', pitch: number, velocity: number) => void
  /** Optional: head / hand gesture state each frame (null when tracking is off). */
  setGesture?(g: Gesture | null): void
  /** Optional: render one frame at `scale` × the current resolution and return it as a PNG. */
  snapshot?(scale: number): Promise<Blob | null>
  /** The canvas the engine draws to (for recording / casting). */
  canvasEl?(): HTMLCanvasElement | null
  /** Optional: grow a string as letterforms (typography). */
  growText?(text: string): void
  /** Optional: a short live stat for the HUD (e.g. skin coverage). */
  stats?(): string
  /** Set while recording: hold the render resolution steady (auto quality would corrupt the take). */
  lockQuality?: boolean
  /**
   * Optional: render at exactly this drawing-buffer size (a recording's frame size) whatever the
   * window does, letterboxed on screen; null goes back to following the window. Engines without
   * it are scaled into the recording frame by the recorder.
   */
  setOutputSize?(size: { width: number; height: number } | null): void
  /** Optional: the engine changed a control's option list (e.g. a model was loaded) — redraw the panel. */
  onControlsChanged?: () => void
  /** Optional: the engine changed a control's value itself — update that widget without re-applying. */
  onControlValue?: (key: string, value: number) => void
  /** Optional: a live video source whose depth and edge maps can steer the growth. */
  setVideoField?(f: VideoField | null): void
  /** Optional: frame the guiding picture / video face-on (a locked view is re-aimed); false when none guides. */
  fitReference?(): boolean
  /** Optional: freeze the camera pose (the view survives Reset) or release it; returns the new state. */
  toggleCameraLock?(): boolean
  /** Optional: whether the camera pose is frozen. */
  readonly cameraLocked?: boolean
  /** Optional: the GPU device or WebGL context was lost; the engine stopped drawing and wants a fresh mount. */
  onDeviceLost?: (reason: string) => void
  /**
   * Optional: many setControl calls follow (a look, a species set) — heavy side effects (respawn
   * held notes, rebuild materials) run once at endBatch instead of once per control. Nestable.
   */
  beginBatch?(): void
  endBatch?(): void
  /**
   * Optional: the share of the view the panel covers on the left (x) or at the top (y), 0..0.5.
   * The engine centres its framing in the rest; it ignores this while recording (fixed frame).
   */
  setFrameInset?(x: number, y: number): void
}

export function ctl(controls: EngineControl[], key: string): number {
  const c = controls.find((c) => c.key === key)
  return c ? c.value : 0
}

export function setCtl(controls: EngineControl[], key: string, value: number) {
  const c = controls.find((c) => c.key === key)
  if (c) c.value = value
}

/** Canvas sized to the host in CSS px × dpr (capped so 4K screens stay smooth). */
export function fitCanvas(canvas: HTMLCanvasElement, host: HTMLElement, maxDpr = 1.5) {
  const dpr = Math.min(maxDpr, window.devicePixelRatio || 1)
  const w = Math.max(1, Math.floor(host.clientWidth * dpr))
  const h = Math.max(1, Math.floor(host.clientHeight * dpr))
  const changed = canvas.width !== w || canvas.height !== h
  if (changed) {
    canvas.width = w
    canvas.height = h
  }
  canvas.style.width = '100%'
  canvas.style.height = '100%'
  return { w, h, dpr, changed }
}
