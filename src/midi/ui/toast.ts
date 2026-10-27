// SnipSnap's toasts, bottom right: the moments worth a glance (a take saved, a still, a MIDI
// mapping, a preset). Everything else stays in the status line under the stage. The container
// is a .ui-overlay, so toasts never show over a hidden UI or in a ?ui=0 capture.

const LIFE_MS = 3600
const MAX = 4

export function toast(msg: string, kind: 'ok' | 'err' = 'ok') {
  const host = document.getElementById('toasts')
  if (!host || !msg) return
  const t = document.createElement('div')
  t.className = `toast${kind === 'err' ? ' err' : ''}`
  t.textContent = msg
  host.appendChild(t)
  while (host.children.length > MAX) host.firstElementChild?.remove()
  setTimeout(() => {
    t.classList.add('out')
    setTimeout(() => t.remove(), 350)
  }, LIFE_MS)
}
