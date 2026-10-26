# Growth v0.18.0

Open `growth-visualiser-v0.18.0.html` in your browser. No extraction is needed if you downloaded the HTML separately.

## Ten new soft growth species

Under **Flow & camera**, choose a species in the soft-species menu and click **Use soft species**, then play notes. Choosing a menu item alone does not change the species toggles. All ten also appear in the regular Species controls.

Jelly bell, Kelp frond, Manta sail, Spiral streamer, Breathing torus, Wave tube, Anemone fan, Pleated silk, Liquid droplet and Ripple disc are new growing, deforming meshes. The previous Liquid, Silk ribbon and Wave blanket remain available, as do all animated materials.

Soft motion controls change their waves, speed and audio response. They grow/retract with their underlying organisms. Animation work is bounded: up to 64 soft meshes, at most 16 mesh updates per frame, 30 Hz target per mesh and 15 Hz normal updates. Busy scenes share this work across frames; additional organisms use their branching skeleton. This is a performance safeguard, not a guarantee of a particular frame rate.

## Smooth screen bounce

In **Screen bounce & tip shapes**, enable **Bounce around screen**. The complete sculpture is framed smaller and moves across the view, reflecting at the edges. Adjust **Bounce speed** and **Sculpture screen size**. Lock the camera for the closest DVD-logo-style result. Speed 0 pauses travel; turning bounce off restores normal framing.

The effect is applied only while rendering, so it works in recordings and snapshots without moving the growth's reference coordinates. Camera changes, live models and growing bounds can change the framing. Bounds are estimated; reduce screen size if an unusually large/custom model reaches an edge.

## Bright tip markers

Choose sphere, cube, diamond, cone, ring, disc, hexagon, star or heart. Adjust size, brightness and visible marker limit. These are the bright markers at live growing tips, not the organism's branch geometry.

For custom markers:

- **PNG/WebP** with transparency works as a flat camera-facing icon. JPG also works but has a rectangular background. Images use a square 256-pixel tile, so prepare square artwork to avoid stretching. Original image colours are retained.
- **OBJ** works as solid 3D geometry. Use a single simple mesh without textures; materials and animations are ignored. Limit: 8 MB file, 10,000 source vertices and 2,048 triangles. At most 128 custom OBJ markers are shown. `custom-tip-example.obj` is a small example.

You do not need a 3D file for a logo or icon. Uploads stay in the current session; reload them after reopening the app. Built-in shape choices and sliders use the normal preset/control system.

## Resolve recording help

See `RESOLVE_IMPORT.md`. The new explicit H.264/AAC mode reduces codec ambiguity. An optional, tested conversion helper is included for existing recordings; it requires FFmpeg and Python 3. A failing recording is still needed to identify the original import problem precisely.
