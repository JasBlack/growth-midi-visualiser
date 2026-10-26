# Growth v0.17.1 — distributed picture growth

Built from v0.17.0. This is still a compiled-distribution patch: the uploaded project did not include TypeScript/Vite source. Keep the readable maintenance modules and port their changes into the source before rebuilding. Previous changes are in NOTES_V0170.md, NOTES_V0160.md and NOTES_V0151.md.

## What caused the central starburst

The reference addSeg wrapper captured its UV anchors from caller vectors after calling the original renderer. The renderer reuses a scratch vector for a direction calculation; that vector can also be the caller's endpoint. The wrapper therefore sometimes anchored an endpoint near the origin instead of at its saved world position. Live following pulled those endpoints towards the picture centre. This was a bug in the earlier reference patch.

The wrapper now anchors from segment.a and segment.b, which are the renderer's saved endpoint clones. Never capture the input vectors after calling the original addSeg.

## New behaviour

- New plants use weighted random seed sampling throughout the reference instead of repeatedly choosing the strongest edge from a candidate pool.
- A 12 by 12 density map discourages repeated starts in crowded areas. Positions remain continuous random coordinates, not a grid. Visited pixels receive a further penalty; every area still has a nonzero chance.
- New strand spread is exposed in the 3D reference panel and Video controls. Default 0.7; higher values favour starts anywhere, lower values favour image details. Try 0.8–1 for scattered colonies.
- Reference segments with implausibly large endpoint jumps are rejected, limiting long bridges across abrupt brightness/depth cliffs. The limit depends on field width and species segment length and is bounded between 0.75 and 3 world units. Non-reference growth and typography bypass this check.
- Reset clears the seed density map. Reset after loading the picture to discard already malformed growth. Existing bad anchors from an older running version cannot be recovered by this fix.

## Files and reproduction

Updated readable modules: maintenance/reference-field.js and maintenance/reference-growth.js. Incremental builder: maintenance/patch_seed_fix.py, run with a verified v0.17.0 folder and a separate output folder. It verifies the input bundle hash, inserts the spread controls, embeds the modules, and rebuilds the standalone HTML. Apply handoff notes after building, since the builder copies the old notes.

Regression: node maintenance/test-seeding.cjs. An optional JSON pixel fixture can exercise a real image; no user image is bundled in this release. The test reproduces the actual scratch-vector mutation, verifies the saved endpoint stays in place, checks depth-cliff rejection and checks spatial coverage. On the supplied portrait, 2,000 starts covered all 144 regions, with 489–509 in each quadrant and 64 inside a small central circle. This measures seed distribution, not a rendered likeness.

All six regression scripts and the packaging validator passed. JavaScript syntax was checked. Live GPU rendering, real camera hardware, and end-to-end recording were not verified in this environment.

## Limits to preserve in the UI

Depth is derived from brightness; this does not infer an anatomically correct face or a full 3D model. A black-and-white silhouette gives two depth layers with sharp transitions. Rejecting cliff-spanning segments helps avoid spears, but branches can end at those transitions. Randomness alone is not a guarantee of recognisable portrait reconstruction. Reference visibility, size/depth, live following, recording, camera controls and soft species from v0.17.0 remain included.
