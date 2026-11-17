// Right-click any setting: back to its default (the JAS.BLACK family rule). This covers the panel's
// own controls outside the registry: option groups (input mode, pattern, camera style), toggle keys
// (aria-pressed), lists, checkboxes and plain range inputs. Their default is their state once the page
// has loaded (saved settings included, like the kit's family.js). Registry widgets (faders, knobs,
// switches, lists) handle their own right-click in main.ts — back to the control's default,
// Shift+right-click MIDI learn — and call preventDefault(), so this listener leaves them alone.
// Action keys (rec, still, reset, open…) keep the browser's menu, as does anything inside [data-noreset].

/** Containers whose aria-pressed buttons are one choice among several: reset presses the default one. */
const GROUPS = '.seg, #camStyle, #engines'

type Def = string | boolean | number
const defs = new WeakMap<Element, Def>()

const isField = (el: Element): el is HTMLInputElement | HTMLSelectElement => el instanceof HTMLInputElement || el instanceof HTMLSelectElement
const valueOf = (el: HTMLInputElement | HTMLSelectElement): Def => (el instanceof HTMLInputElement && el.type === 'checkbox' ? el.checked : el.value)
const pressedIndex = (group: Element) => [...group.querySelectorAll('button')].findIndex((b) => b.getAttribute('aria-pressed') === 'true')
const SKIP_TYPES = new Set(['file', 'text', 'search', 'button', 'submit', 'url', 'email', 'password'])

function note(root: ParentNode) {
  for (const el of root.querySelectorAll('input, select')) if (isField(el) && !defs.has(el)) defs.set(el, valueOf(el))
  for (const g of root.querySelectorAll(GROUPS)) {
    const i = pressedIndex(g)
    if (!defs.has(g) && i >= 0) defs.set(g, i)
  }
  for (const b of root.querySelectorAll('button[aria-pressed]'))
    if (!b.closest(GROUPS) && !defs.has(b)) defs.set(b, b.getAttribute('aria-pressed') ?? 'false')
}

let watching = false
/**
 * Note the state of every setting once the page has loaded (call it when boot is done). The selected
 * pattern's own panel is rebuilt on every pattern change, so its new keys are noted as they appear.
 */
export function rememberDefaults() {
  note(document)
  if (watching) return
  watching = true
  const host = document.getElementById('engineControls')
  if (host) new MutationObserver(() => note(host)).observe(host, { childList: true, subtree: true })
}

const fire = (el: Element) => {
  el.dispatchEvent(new Event('input', { bubbles: true }))
  el.dispatchEvent(new Event('change', { bubbles: true }))
}
const nameOf = (el: Element) =>
  (el.getAttribute('aria-label') || ((el instanceof HTMLInputElement || el instanceof HTMLSelectElement) && el.labels?.[0]?.textContent) || el.textContent || '').trim().split('\n')[0]

/** Put the control under `target` back to its default, the way a user's change would. Null: not a setting. */
function reset(target: Element): string | null {
  if (target.closest('[data-noreset]')) return null
  const group = target.closest(GROUPS)
  if (group) {
    if (!defs.has(group)) return null
    const b = group.querySelectorAll('button')[defs.get(group) as number]
    if (b && b.getAttribute('aria-pressed') !== 'true') b.click()
    return nameOf(group) || nameOf(b ?? group)
  }
  const key = target.closest('button[aria-pressed]')
  if (key) {
    if (!defs.has(key)) return null
    if (key.getAttribute('aria-pressed') !== defs.get(key)) (key as HTMLButtonElement).click()
    return nameOf(key)
  }
  // a hidden checkbox inside its label key (fresh canvas, save while recording)
  const label = target.closest('label')
  const el = target.closest('input, select') ?? label?.control ?? null
  if (!el || !isField(el) || el.disabled || !defs.has(el)) return null
  if (el instanceof HTMLInputElement && SKIP_TYPES.has(el.type)) return null
  let d = defs.get(el)!
  // a device list filled in after the page loaded: its first entry is the default
  if (el instanceof HTMLSelectElement && ![...el.options].some((o) => o.value === d)) d = el.options[0]?.value ?? ''
  if (valueOf(el) !== d) {
    if (typeof d === 'boolean') (el as HTMLInputElement).checked = d
    else el.value = String(d)
    fire(el)
  }
  return nameOf(el)
}

/** Install the right-click reset; `told` hears the name of each control put back. */
export function setupResetMenu(told: (name: string) => void) {
  document.addEventListener('contextmenu', (e) => {
    if (e.defaultPrevented || !(e.target instanceof Element)) return
    const name = reset(e.target)
    if (name === null) return
    e.preventDefault()
    told(name)
  })
}
