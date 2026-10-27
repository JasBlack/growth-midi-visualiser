// Code Painter's LED-ring knob, drawn over a range input. The input stays the control: it keeps
// keyboard focus, the arrow keys (keys.ts treats a focused range as owning them), the screen
// reader's slider role and its owner's `input` handler; it is only hidden from sight. The knob
// turns it with a vertical drag (Shift: fine) or the wheel and fires that same input event.

const DOTS = 11
/** degrees either side of twelve o'clock */
const SWEEP = 135
/** pixels of drag for the whole sweep (Shift: four times finer) */
const DRAG_PX = 160

export interface Knob {
  readonly el: HTMLElement
  /** show the input's current value (call after writing inp.value) */
  paint(): void
}

/**
 * `centre` (0..1, e.g. a macro's neutral 0.5): the ring lights from there to the value, so the
 * knob reads as "this much either way"; without it the ring fills from the start.
 */
export function makeKnob(inp: HTMLInputElement, centre?: number): Knob {
  const el = document.createElement('div')
  el.className = 'lk'
  el.setAttribute('aria-hidden', 'true')
  const dots: HTMLElement[] = []
  for (let i = 0; i < DOTS; i++) {
    const d = document.createElement('span')
    d.className = 'ld'
    d.style.transform = `rotate(${-SWEEP + (2 * SWEEP * i) / (DOTS - 1)}deg) translateY(-20px)`
    el.appendChild(d)
    dots.push(d)
  }
  const cap = document.createElement('span')
  cap.className = 'k'
  const mark = document.createElement('i')
  cap.appendChild(mark)
  el.appendChild(cap)
  inp.classList.add('sr')

  const bounds = () => {
    const min = parseFloat(inp.min) || 0
    const max = inp.max === '' ? 100 : parseFloat(inp.max)
    return { min, max: max > min ? max : min + 1 }
  }
  const position = () => {
    const { min, max } = bounds()
    return Math.min(1, Math.max(0, (parseFloat(inp.value) - min) / (max - min)))
  }

  function paint() {
    const x = position()
    mark.style.transform = `rotate(${-SWEEP + 2 * SWEEP * x}deg)`
    const at = x * (DOTS - 1)
    const from = centre === undefined ? 0 : Math.min(at, centre * (DOTS - 1))
    const to = centre === undefined ? at : Math.max(at, centre * (DOTS - 1))
    dots.forEach((d, i) => d.classList.toggle('on', i >= from - 0.3 && i <= to + 0.3))
  }

  function turnTo(x: number) {
    const { min, max } = bounds()
    const before = inp.value
    inp.value = String(min + Math.min(1, Math.max(0, x)) * (max - min)) // the input snaps it to its step
    if (inp.value !== before) inp.dispatchEvent(new Event('input', { bubbles: true }))
  }

  let drag: { id: number; y: number; x: number } | null = null
  el.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return // right-click stays MIDI learn (the row's contextmenu)
    e.preventDefault()
    inp.focus({ preventScroll: true })
    try {
      el.setPointerCapture(e.pointerId) // the drag keeps going outside the knob
    } catch {
      /* a pointer that is already gone: the drag still works while over the knob */
    }
    drag = { id: e.pointerId, y: e.clientY, x: position() }
    el.classList.add('drag')
  })
  el.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return
    // accumulated, so pressing Shift mid-drag changes the rate without a jump
    drag.x += (drag.y - e.clientY) / (e.shiftKey ? DRAG_PX * 4 : DRAG_PX)
    drag.y = e.clientY
    turnTo(drag.x)
  })
  const end = (e: PointerEvent) => {
    if (!drag || e.pointerId !== drag.id) return
    drag = null
    el.classList.remove('drag')
  }
  el.addEventListener('pointerup', end)
  el.addEventListener('pointercancel', end)
  el.addEventListener('lostpointercapture', end)
  el.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault()
      if (e.deltaY) turnTo(position() - Math.sign(e.deltaY) * (e.shiftKey ? 0.01 : 0.04))
    },
    { passive: false },
  )
  inp.addEventListener('input', paint) // the arrow keys
  paint()
  return { el, paint }
}
