/**
 * Segment-start credits: "new segments per second" is banked as a fractional credit, so
 * the rate holds at any frame rate (v19 allocator). At most 50 ms accrues per frame and
 * the bank caps at 64 starts, so a stall never turns into a catch-up flood.
 */
export class SegmentCredits {
  private credit = 0
  private granted = 0

  /** Starts allowed this frame; Infinity when rate <= 0 ("as fast as it can"). */
  begin(rate: number, dt: number): number {
    if (!(rate > 0)) {
      this.credit = 0
      return (this.granted = Infinity)
    }
    this.credit = Math.min(64, this.credit + rate * Math.min(0.05, Math.max(0, dt)))
    return (this.granted = Math.floor(this.credit))
  }

  /** Pay for the starts made; `left` is the allowance not spent this frame. */
  end(left: number) {
    if (Number.isFinite(this.granted)) this.credit = Math.max(0, this.credit - (this.granted - left))
  }

  reset() {
    this.credit = 0
    this.granted = 0
  }
}
