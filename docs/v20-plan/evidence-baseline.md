# Measured: v0.19.0 live baseline (Chrome, WebGPU, fast desktop GPU, 2026-09-23)

Stress: fillRate 0 (unlimited), musicAmount 1.2, speed 3, maxLive 60, sustain 3; 8 keyboard notes held for 8 s.

| second | rAF fps | segments |
|---|---|---|
| 1 | 61 | 4147 |
| 2 | 60 | 7436 |
| 3 | 60 | 10565 |
| 4 | 61 | 12980 |
| 5–8 | 60 | **13336 (frozen)** |

- engine.frame() CPU: p50 0.8 ms, p90 0.9 ms at 13.3k segments. Rendering is not the bottleneck on this machine (owner also uses weak laptops).
- **Held notes stop growing at 13,336 segments = 8 × 1667.** `maxPlantSegs = clamp(cap/12, 800, 12000)` is derived from the CURRENT instance capacity (20,000 at start), not the budget (60k). Capacity only doubles when the total reaches it, which a per-plant cap of cap/12 prevents with ≤11 plants. So with few held notes the organism silently stops at 1/3 of budget — the "growth stalls" complaint, still present in v19.

Default Simple-mode Roots look (v19): 3 held notes for 2 s → ~300 segments; camera locked still; growth leaves frame for ribbon species; Liquid soft species renders faceted.
