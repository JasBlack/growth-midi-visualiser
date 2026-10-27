// The console's light / dark theme and the case's dot grid. The stage stays dark either way.
//
// The dot grid (SnipSnap's cutting mat) is one small tile drawn into a canvas once and repeated
// by the page background: a baked image, not a CSS gradient — large live gradients shimmered on
// macOS. It is redrawn only when the theme or the screen's pixel ratio changes.

export type Theme = 'dark' | 'light'

const STEP = 24

let bakedFor = ''

function bakeDotGrid() {
  const root = document.documentElement
  const dpr = Math.max(1, Math.min(3, Math.round(window.devicePixelRatio || 1)))
  const dot = getComputedStyle(root).getPropertyValue('--dots').trim() || 'rgba(255,255,255,0.06)'
  const key = `${dpr}|${dot}`
  if (key === bakedFor) return
  bakedFor = key
  const c = document.createElement('canvas')
  c.width = c.height = STEP * dpr
  const g = c.getContext('2d')
  if (!g) return
  g.fillStyle = dot
  g.beginPath()
  g.arc(c.width / 2, c.height / 2, 0.9 * dpr, 0, Math.PI * 2)
  g.fill()
  root.style.setProperty('--dotgrid', `url("${c.toDataURL('image/png')}")`)
}

export function applyTheme(t: Theme) {
  document.documentElement.dataset.theme = t
  bakeDotGrid()
}

/** Bake the grid for the current theme and keep it right when the window moves to another screen. */
export function setupTheme(initial: Theme) {
  applyTheme(initial)
  window.addEventListener('resize', bakeDotGrid)
}

export const asTheme = (v: unknown): Theme => (v === 'light' ? 'light' : 'dark')
