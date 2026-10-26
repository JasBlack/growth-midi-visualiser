// Keyboard focus policy shared by the global shortcuts and the keyboard piano.
//
// Only text entry swallows every key. Any other control owns just the keys it
// natively uses, and buttons / selects / checkboxes only when they were reached
// with the keyboard: Chrome leaves focus on whatever the mouse clicked, and
// treating that as "typing" killed every shortcut after a click (and the piano
// after touching a slider) in v0.19.

export type TargetKind = 'none' | 'text' | 'select' | 'range' | 'toggle' | 'activator' | 'file'

const BUTTON_INPUTS = new Set(['button', 'submit', 'reset', 'image', 'color'])
const NAV_KEYS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown'])
const MODIFIER_KEYS = new Set(['Shift', 'Control', 'Alt', 'AltGraph', 'Meta', 'CapsLock', 'Fn'])

export function classifyTarget(t: EventTarget | null): TargetKind {
  if (!(t instanceof HTMLElement)) return 'none'
  if (t.isContentEditable || t instanceof HTMLTextAreaElement) return 'text'
  if (t instanceof HTMLSelectElement) return 'select'
  if (t instanceof HTMLInputElement) {
    if (t.type === 'range') return 'range'
    if (t.type === 'checkbox' || t.type === 'radio') return 'toggle'
    if (t.type === 'file') return 'file'
    return BUTTON_INPUTS.has(t.type) ? 'activator' : 'text' // text, number, search, … and anything unknown
  }
  return t.matches('button, summary, a[href], [role=button]') ? 'activator' : 'none'
}

// Where the current focus came from. The browser's :focus-visible cannot be
// used for this: Chrome flips it on for a mouse-focused button at the first
// key press, which is exactly the press being decided about.
let viaKeyboard = true
const keyboardFocused = new WeakSet<Element>()

export function trackFocusOrigin() {
  window.addEventListener(
    'keydown',
    (e) => {
      if (!MODIFIER_KEYS.has(e.key)) viaKeyboard = true
    },
    true,
  )
  window.addEventListener('pointerdown', () => (viaKeyboard = false), true)
  document.addEventListener('focusin', (e) => {
    if (!(e.target instanceof Element)) return
    if (viaKeyboard) keyboardFocused.add(e.target)
    else keyboardFocused.delete(e.target)
  })
}

export function focusedByKeyboard(el: Element | null): boolean {
  return !!el && keyboardFocused.has(el)
}

/** Does the focused control natively use this key, so shortcuts and the piano must leave it alone? */
export function controlOwnsKey(kind: TargetKind, key: string, byKeyboard: boolean): boolean {
  switch (kind) {
    case 'text':
      return key !== 'Escape' && key !== 'F2'
    case 'range': // fine-tuning a slider with the arrows is expected however it got focus
      return NAV_KEYS.has(key)
    case 'select': // an open select gets no page key events at all; a closed one only when tabbed to
      return byKeyboard && (NAV_KEYS.has(key) || key === ' ' || key === 'Enter')
    case 'toggle':
      return byKeyboard && key === ' '
    case 'file':
    case 'activator':
      return byKeyboard && (key === ' ' || key === 'Enter')
    default:
      return false
  }
}

/** Keys no shortcut or piano note should act on: browser / OS chords, IME input, events already handled. */
export function ignoredKey(e: KeyboardEvent): boolean {
  if (e.defaultPrevented || e.isComposing || e.key === 'Process') return true
  if (!e.ctrlKey && !e.metaKey && !e.altKey) return false
  // AltGr (Ctrl+Alt on Windows) or Option on a Mac is how many layouts type the palette brackets
  return !(e.altKey && !e.metaKey && (e.key === '[' || e.key === ']'))
}
