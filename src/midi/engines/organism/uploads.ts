// Instance-buffer uploads. A bare `needsUpdate` makes three re-send the whole
// capacity-sized buffer (tens of MB per frame at 80k+ segments); instead every
// write marks its slot, and once per frame the marks become a few coalesced
// update ranges, so only the slots that changed reach the GPU.

import type * as THREE from 'three'

/** Marks kept per attribute; past this, the frame uploads the one span [min, max]. */
const LIST = 4096
/** Upload calls per attribute per frame, at most (each writeBuffer / bufferSubData has a fixed cost). */
const MAX_SPANS = 8

/** Slots of one instanced attribute written since its last upload. */
export class DirtySlots {
  private list = new Int32Array(LIST)
  private len = 0
  private min = 0x7fffffff
  private max = -1

  mark(i: number) {
    if (i < this.min) this.min = i
    if (i > this.max) this.max = i
    if (this.len < LIST) this.list[this.len] = i
    this.len++
  }

  reset() {
    this.len = 0
    this.min = 0x7fffffff
    this.max = -1
  }

  /**
   * Hand the marked slots to three as update ranges and flag the attribute; the marks
   * are then forgotten. Only call this in a frame that renders the mesh: three consumes
   * ranges when it draws, and ranges replaced before that would never be uploaded.
   * Returns the bytes handed over.
   */
  flush(attr: THREE.BufferAttribute): number {
    if (!this.len) return 0
    const size = attr.itemSize
    // Ranges three has not uploaded yet (the attribute was not drawn since the last flush, or
    // a pass skipped it) must survive: clearing them here silently lost those writes and left
    // whole segments black. Keep them; if they pile up, fall back to one covering span.
    if (attr.updateRanges.length > 48) {
      let lo = Infinity
      let hi = -Infinity
      for (const r of attr.updateRanges) {
        lo = Math.min(lo, r.start)
        hi = Math.max(hi, r.start + r.count)
      }
      attr.clearUpdateRanges()
      attr.addUpdateRange(lo, hi - lo)
    }
    let items = 0
    if (this.len > LIST) {
      items = this.max - this.min + 1
      attr.addUpdateRange(this.min * size, items * size)
    } else {
      const a = this.list.subarray(0, this.len).sort()
      // marks closer than `gap` share a span (re-sending a few clean slots beats another call)
      let gap = 16
      while (spanCount(a, gap) > MAX_SPANS) gap *= 2
      let lo = a[0]
      let hi = a[0]
      for (let k = 1; k < a.length; k++) {
        const v = a[k]
        if (v - hi > gap) {
          attr.addUpdateRange(lo * size, (hi - lo + 1) * size)
          items += hi - lo + 1
          lo = v
        }
        hi = v
      }
      attr.addUpdateRange(lo * size, (hi - lo + 1) * size)
      items += hi - lo + 1
    }
    attr.needsUpdate = true
    this.reset()
    return items * size * attr.array.BYTES_PER_ELEMENT
  }
}

function spanCount(sorted: Int32Array, gap: number) {
  let n = 1
  for (let k = 1; k < sorted.length; k++) if (sorted[k] - sorted[k - 1] > gap) n++
  return n
}
