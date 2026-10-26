# Measured: v0.19.0 recording output (Chrome, 2026-09-23)

Default Output settings in v19 (MP4, editor compatibility on, 1080, 60 fps, 24 Mbps, input audio), 5 s take while playing notes. File probed with ffprobe/ffmpeg 7.1.

- Container: **fragmented MP4** — atoms `ftyp moov moof mdat moof mdat` (no sample index in moov).
- Video: H.264 **Constrained Baseline**, **2284×1080** (window aspect, not 16:9; width not a standard size).
- Timing: 191 frames over 4.94 s = **38.5 fps effective** against a "60 fps target"; frame deltas from **3.7 ms to 297 ms** (a 0.3 s freeze); `r_frame_rate=60/1` but `avg_frame_rate=1146000/29911`.
- Decode: `ffmpeg -f null` prints **55 "non monotonically increasing dts" errors**.
- Audio: AAC LC 48 kHz stereo (present).

This reproduces the owner's complaints (Finder Quick Look refuses, VLC frozen/stuttery, Resolve import trouble). It is structural to MediaRecorder + canvas.captureStream timing, not a settings problem.

For comparison, the v0.15.0 WebCodecs + mp4-muxer recorder (same machine, 2026-09-15) produced: `ftyp moov mdat` (moov first), H.264 High, even dimensions, `r_frame_rate=30/1`, pts deltas exactly 1/30 s, clean full decode, AAC 48 kHz stereo audible.
