# Start here — Growth v0.19.0

Open `growth-visualiser-v0.19.0.html` in Chrome, Edge or Brave. The application
starts in **Simple** mode with a restrained Roots look and a still camera.

## A good first result

1. Choose Roots, Coral, Neural, Crystal, Liquid or Silk.
2. Leave Camera on **Still** or choose **Gentle orbit**.
3. Play MIDI, an audio file, microphone or tab audio.
4. Adjust **Growth** first, then **Detail**. Increase **Audio sensitivity** only
   if real attacks are being missed.
5. Use **Surprise me** for another coherent look. It no longer randomizes every
   control at once.

The camera-lock icon at the top keeps the exact view across Reset. Middle-drag
orbits, Shift+middle-drag pans and the mouse wheel zooms.

## Draw a picture, video or camera feed

Load the source in Input, then choose:

- **Trace silhouette** for faces, figures, logos and strong edges.
- **Sculpt relief** for landscapes, light/shadow and fuller surfaces.

`Source visible` shows or hides the guide without stopping the growth.
`Fit source` frames it. These sources create a live 2.5D depth relief from
brightness and edges; they are not automatic 360° reconstructions.

## Draw a real 3D model

Use **Choose 3D model**, preferably a `.glb`. `.gltf`, `.obj` and `.stl` are
also accepted. Growth is projected onto the actual mesh, so it can be inspected
from every angle. Use **Skin 3D model** after loading if needed.

## When to use Advanced

Click **Advanced** for every legacy species, animated material, physics system,
specialist camera, saved slot, streaming and recording control. Returning to
Simple does not delete those settings; applying a Simple look deliberately
restores a small set of stable values.

For implementation details and Claude handoff notes, read
`NOTES_FOR_CLAUDE.md`.
