// Small DOM helpers shared by the panel code (the JAS.BLACK console look: keys with LEDs).

/** A toggle key's state: the pressed face, its LED and the accessible state move together. */
export function setPressed(el: HTMLElement, on: boolean) {
  el.classList.toggle('on', on)
  el.setAttribute('aria-pressed', String(on))
}

/** A range input's green fill up to its value (WebKit has no progress pseudo-element). */
export function paintRange(inp: HTMLInputElement) {
  const min = parseFloat(inp.min) || 0
  const max = inp.max === '' ? 100 : parseFloat(inp.max)
  const v = parseFloat(inp.value)
  const pct = max > min && Number.isFinite(v) ? ((v - min) / (max - min)) * 100 : 0
  inp.style.setProperty('--pct', `${Math.min(100, Math.max(0, pct)).toFixed(2)}%`)
}

/** Every range the user drags repaints its fill; programmatic writes call paintRange themselves. */
export function paintRangesOnInput(root: Document | HTMLElement = document) {
  root.addEventListener(
    'input',
    (e) => {
      const t = e.target
      if (t instanceof HTMLInputElement && t.type === 'range') paintRange(t)
    },
    true,
  )
  for (const inp of root.querySelectorAll<HTMLInputElement>('input[type=range]')) paintRange(inp)
}
