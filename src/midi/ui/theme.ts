// The console's light / dark theme. The stage stays dark either way.
//
// The case's dot grid is the JAS.BLACK family tile (16 px, fine and faint): a small PNG per theme,
// set as `--dotgrid` in index.html and repeated by the page background. A baked image, never a CSS
// gradient — large live gradients shimmered on macOS.

export type Theme = 'dark' | 'light'

export function applyTheme(t: Theme) {
  document.documentElement.dataset.theme = t
}

/** Apply the saved theme (index.html already set it before the first paint). */
export function setupTheme(initial: Theme) {
  applyTheme(initial)
}

export const asTheme = (v: unknown): Theme => (v === 'light' ? 'light' : 'dark')
