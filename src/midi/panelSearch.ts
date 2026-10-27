// "Find a setting": narrows the panel to the controls whose label contains
// every typed word (or whole sections whose title matches), opens the sections
// that match and puts their open state back when the search is cleared.
//
// Rows are hidden with data-search-hidden, never with `hidden`, so rows that
// hide themselves (the per-mode input rows, empty playlists) keep their own
// state. Option text inside selects is not searched: "orbit" should find the
// camera control by its label, not every section that lists orbit as a choice.

// a phone or tablet plays the on-screen keys; a desktop the computer keyboard
const TOUCH = typeof matchMedia !== 'undefined' && matchMedia('(hover: none) and (pointer: coarse)').matches
const IDLE_HELP = TOUCH
  ? 'Tap or slide on the keys under the stage to grow · perform for full screen'
  : 'Hold A–K to grow · F2 or ` hides controls · Esc brings them back'
const NO_MATCH = 'No matching settings. Try “species”, “camera” or “decay”.'
const HIDE = 'data-search-hidden'

export class PanelSearch {
  private words: string[] = []
  private openBefore = new Map<HTMLDetailsElement, boolean>()
  /** A search starts or ends (Simple mode shows the Advanced rows while one runs). */
  onActiveChange?: (active: boolean) => void

  constructor(
    private input: HTMLInputElement,
    private help: HTMLElement,
    private root: HTMLElement,
  ) {
    input.addEventListener('input', () => this.refresh())
    input.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return
      // Esc here clears the search; it is not also the global "show UI"
      e.stopPropagation()
      this.clear()
      input.blur()
    })
    help.textContent = IDLE_HELP
  }

  /** While true, section toggles are the search's doing and must not be remembered. */
  get active() {
    return this.words.length > 0
  }

  clear() {
    this.input.value = ''
    this.refresh()
  }

  /** Re-apply the query, e.g. after the engine controls were rebuilt. */
  refresh() {
    const words = this.input.value.trim().toLowerCase().split(/\s+/).filter(Boolean)
    const was = this.active
    this.words = words
    if (was !== this.active) this.onActiveChange?.(this.active)
    if (!words.length) {
      if (!was) return // idle: leave every row and section exactly as it is
      for (const el of this.root.querySelectorAll(`[${HIDE}]`)) el.removeAttribute(HIDE)
      for (const [sec, open] of this.openBefore) if (sec.isConnected) sec.open = open
      this.openBefore.clear()
      this.help.textContent = IDLE_HELP
      return
    }
    let shown = 0
    for (const sec of this.root.querySelectorAll<HTMLDetailsElement>('details.sec')) {
      if (!this.openBefore.has(sec)) this.openBefore.set(sec, sec.open)
      const title = sec.querySelector(':scope > summary')?.textContent?.toLowerCase() ?? ''
      const whole = matches(title, words)
      let any = whole
      for (const el of entriesOf(sec)) {
        const hit = whole || matches(searchText(el), words)
        el.toggleAttribute(HIDE, !hit)
        if (hit && !el.hidden) any = true
      }
      sec.toggleAttribute(HIDE, !any)
      if (any) {
        sec.open = true
        shown++
      }
    }
    this.help.textContent = shown ? `${shown} matching section${shown === 1 ? '' : 's'} · Esc clears` : NO_MATCH
  }
}

const matches = (text: string, words: string[]) => words.every((w) => text.includes(w))

/** The rows of a section: body children, with control grids opened up so single controls can match. */
function entriesOf(sec: HTMLDetailsElement): HTMLElement[] {
  const body = sec.querySelector<HTMLElement>(':scope > .body')
  if (!body) return []
  // running text (the Keys reference) is one entry: hiding single <kbd>s would garble it
  if ([...body.childNodes].some((n) => n.nodeType === Node.TEXT_NODE && n.textContent?.trim())) return [body]
  const out: HTMLElement[] = []
  for (const el of body.children) {
    if (!(el instanceof HTMLElement)) continue
    if (el.matches('.icons, .engines, .looks, .intents, .knobs, .camkeys, .trio, .ctl-list, #globalControls')) out.push(...(el.children as HTMLCollectionOf<HTMLElement>))
    else out.push(el)
  }
  return out
}

/** Visible words plus titles / placeholders / labels / data-search keywords, without option lists. */
function searchText(el: HTMLElement): string {
  const parts: string[] = []
  const walk = document.createTreeWalker(el, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (n.nodeName === 'OPTION' || n.nodeName === 'OPTGROUP' ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  })
  for (let n: Node | null = el; n; n = walk.nextNode()) {
    if (n instanceof Element) {
      for (const a of ['title', 'placeholder', 'aria-label', 'data-search']) {
        const v = n.getAttribute(a)
        if (v) parts.push(v)
      }
    } else parts.push(n.textContent ?? '')
  }
  return parts.join(' ').toLowerCase()
}
