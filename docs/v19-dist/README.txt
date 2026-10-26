Growth v0.19.0 — MIDI / music visualiser
=======================================

Chrome, Edge or Brave (2023+) on macOS or Windows give the full-speed WebGPU
path. Safari 26+ and current Firefox run it through WebGL2 (slower, same look).

TWO WAYS TO RUN

A) One file, no server: double-click "growth-visualiser-v0.19.0.html".
   Everything works from a plain file open except webcam gestures (needs the
   MediaPipe files, see B).

B) Folder + tiny local server (enables gestures):
   macOS    double-click "start-mac.command" (first time: right-click → Open,
            or in Terminal: chmod +x start-mac.command)
   Windows  double-click "start-windows.cmd"
   then open http://localhost:8765/
   Both wait for the server before opening the browser and use Python 3; any static server works instead (e.g. npx serve .).

Keys: 1–5 pattern · Enter performance mode · F2 hide UI · Backspace reset ·
R record · Q still · C camera · Shift+1…8 presets · letters play the keyboard piano.

See NOTES_FOR_CLAUDE.md for improvements, validation and source limitations.
Tab now moves focus between controls. Use Find a setting to locate controls.

GOOD FIRST OUTPUT (v0.19.0)
The application now opens in Simple mode. Choose one of six authored looks,
adjust Growth, Detail and Audio sensitivity, then play. Surprise me selects a
coherent look instead of independently randomising every setting. Camera choices
are Still, Gentle orbit and Manual; none zoom or jump with the music.

For a picture/video/camera choose Trace silhouette or Sculpt relief. For actual
all-angle geometry choose a GLB/GLTF/OBJ/STL with Choose 3D model. Source visible
shows or hides the guide without stopping growth. Click Advanced to reveal every
legacy control. See START_HERE_v0190.md and NOTES_FOR_CLAUDE.md.

3D REFERENCE GROWTH (introduced in v0.15.1)
Choose a picture, video or camera in Input. The Organism pattern automatically
starts filling its shape. Use Build shape to pause/resume automatic filling,
Follow live to update existing branches, and Show reference to hide/show the
source image without stopping growth. Size scales the image and its growth;
Depth controls relief. Invert depth flips near/far. Fit view reframes it.
Middle-drag to orbit. Reset clears the growth and starts filling again.

Depth is derived from brightness: this is a 3D relief, not a full reconstructed
360-degree model. Automatic filling is bounded; large scenes update in batches.
See NOTES_FOR_CLAUDE.md for implementation details and validation limits.

FLOW, CAMERAS AND RECORDING (introduced in v0.16.0)
Shift + middle-drag pans. Middle-drag orbits; wheel zooms.
In Flow & camera, select Liquid, Silk ribbon or Wave blanket and click Use soft
species, then play notes. Soft motion controls adjust waves and audio response.
Try Tip glide, Cinematic tour or Wide pulse; C cycles all camera modes.
In Output, choose Input only or Full mix, capture resolution, 30/60 fps target,
and video quality. Native MP4 falls back to WebM when necessary. Capture status
reports actual pixels. Quality and frame rate depend on browser/GPU support.
See NOTES_FOR_CLAUDE.md for full changes, limitations and validation results.


NEW IN v0.17.0
Lock camera (top right) freezes the view across Reset. Unlock to navigate.
Choose Music-led settings for a restrained starting point. Build shape now defaults
to off when enabling a reference; it remains available for independent filling.
Growth amount controls speed; Highlight new / dim old and Fresh trail reveal new
musical activity. Highlight 0 restores normal colours and tip depth.
See NOTES_FOR_CLAUDE.md for changes, implementation details and verification limits.


NEW IN v0.17.3
Animated materials -> Next new cycles through ten new moving surface finishes.
They also apply to Liquid, Silk ribbon and Wave blanket. Motion speed, Pattern
scale and Audio response control these new materials. Set both motion and audio
response to zero for a static finish. Existing species and material indices stay
compatible. See NOTES_FOR_CLAUDE.md for implementation and testing details.


NEW IN v0.18.0
See START_HERE_v0180.md for ten new soft growth species, screen bounce and tip shapes.
See RESOLVE_IMPORT.md for explicit editor MP4 settings and optional conversion.
See NOTES_FOR_CLAUDE.md for the complete handoff.
