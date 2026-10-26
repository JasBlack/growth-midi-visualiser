# R3: Declarative control schema and generated UI tiers

**Angle:** one declarative schema describes every control: key, label, range, default, group, tier (simple, advanced or expert), macro memberships, whether MIDI can learn it, whether presets or the session own it, and help text. The panel, search index, Simple mode, presets and morph, CC learn, URL params and docs are all generated from it. Looks and Macros are written as data.

**Inputs read:** TS source at `C:\Users\User\Desktop\code\growth-midi-visualiser` (tag v0.15.0): `src/midi/engine.ts`, `src/midi/main.ts`, `src/midi/presets.ts`, `src/midi/engines/organism.ts`, `index.html`. The v19 compiled lineage at `C:\Users\User\Downloads\growth-v0190`: all `NOTES_*.md`, `START_HERE_v0190.md`, `index.html`, `maintenance/*.js`, `maintenance/patch_*.py`, and targeted greps of `assets/index-BWYXfAkm.js`. Sibling reports `a1-growth-core.md` and `a3-app-shell.md` were skimmed for their headings only, to cross-reference their findings.

---

## 0. Verdict (short)

Adopt it, with limits. A schema-first control layer is the best way to absorb v0.15.1 to v0.19.0. That history is roughly 70% "add some controls plus a quick panel for them" and about 30% real engine work. The schema removes the five hand-written quick panels. It also removes four `setInterval(…, 400)` UI polling loops, three competing ways to set a control, and the CSS hide-list that currently defines Simple mode. Adding a feature becomes a matter of adding a folder, and the only UI work left is optional layout hints. It does **not** fix the engine problems the owner sees: faceted Liquid, the growth that holds back and starves notes, and recordings. What it does is make the *tuning* of those problems (Looks, macros, defaults) a data change with a regression test attached.

Keep the schema **small and boring**. Pure data, `as const`, with no runtime dependencies. Custom widgets are an explicit escape hatch. Do not build a general UI DSL.

---

## 1. Where control definitions live today (evidence)

### 1.1 TS v0.15.0: one control is defined in up to 9 places

| # | Concern | Location | Problem |
|---|---|---|---|
| 1 | Definition (key/label/range/default/options/icon) | `src/midi/engines/organism.ts:371-446` (the `controls` array) | 97 engine keys plus 24 `sp:i` species toggles in one literal. Every feature edits the same lines. |
| 2 | Group (panel section) | `organism.ts:226` `GROUP_ORDER`, `organism.ts:227-245` `GROUP` map | Kept separately from the definition. `mount()` **overwrites** `c.group` (`organism.ts:571`). |
| 3 | Section ordering / sort | `organism.ts:571-573` (in `mount`) | Side effect on engine mount. |
| 4 | Side effects of a change | `organism.ts:762-778` `setControl` if-chain | Prefix matching (`key.startsWith('video')` triggers `rebuildBackdrop`, `key.startsWith('sp:')` triggers `respawnHeld`). |
| 5 | Global (shared) controls | `src/midi/main.ts:46-67` `Settings`, `main.ts:397-416` `renderGlobalControls` inline defs | Separate type and hand-written apply closures. |
| 6 | Random-mix exclusions / caps | `main.ts:463-471` `NO_RANDOM`, `RANDOM_CAP` | Kept by key name, far from the definition. |
| 7 | Default-open sections | `main.ts:295` `OPEN_BY_DEFAULT` | Kept by group name. |
| 8 | Morphability | `main.ts:524` heuristic `c.options \|\| c.icon \|\| c.step >= 1` | Implicit. |
| 9 | URL params | `main.ts:1114-1143` `captureUrl` / `applyParams` | Hand-picked: engine, preset, cam, mode, ui. |

Other v0.15 facts that a schema resolves:
- `ctl(controls, key)` in `engine.ts` is `Array.find` with a string compare. It is called **113 times** in `organism.ts`, and the v19 bundle has **195** `G(this.controls, …)` call sites (a1 L2, a3 #20).
- `snapshotPreset` (`main.ts:441-447`) captures **every** engine control, including `budget`, `quality` and `autoQuality`. A preset saved on a strong machine therefore overrides the weak laptop's performance settings (a3 #6).
- The engine writes some values behind the UI's back. `season` is written through `setCtl` without `onControlValue` (`organism.ts:2145`), so its slider goes stale. `shell` and `shellSize` do notify (`organism.ts:2320-2325`). The two paths are inconsistent.
- `settings` has no schema version (`main.ts:68`, `midiviz_settings_v3`). Presets are stored as `midiviz_presets_v1` with no migration path (`presets.ts:14`).

### 1.2 v19 made it worse: seven hand-written control surfaces sit on top of the generated panel

| v19 module | What it hand-writes | Duplication smell |
|---|---|---|
| `maintenance/simple-ui.js` (123 lines) | 6 Look recipes, Surprise, 3 macro sliders (growth, detail, audio), camera intent select, 4 source-intent buttons, model picker, source visible/fit | Looks name species by string but shaders **by index** (`shader:22`, `shader:27`) and palettes by index. The macros are **one-way**: `simpleGrowth` writes `musicAmount`, `speed` and `sustain`, but nothing reads them back, so the slider shows 0.42 after a preset changes them. `simpleAudio` writes **`globalThis.__growthAudioSensitivity`**, a window global that is not persisted, not in presets, not CC-learnable and not in URLs. |
| `maintenance/reference-ui.js` (58) | `refEnable/refFit/refBuild/refFollow/refVisible/refInvert/refSize/refDepth` duplicates of engine controls `videoBuild`, `videoFollow`, `videoShow`, `videoInvert`, `videoSize`, `videoDepth` | Its own `referenceSet/referenceValue/referenceSync` trio, a `te?.id==='organism'` guard, and `setInterval(referenceSync, 400)` |
| `maintenance/music-focus-ui.js` (23) | `musicAmount/musicFocus/musicTrail/buildPace` sliders, `musicLed` button, camera-lock button | Same trio plus `setInterval(syncMusicControls, 400)`. `musicLed` is a hard-coded 6-value patch (a "partial Look"). |
| `maintenance/dynamic-material-ui.js` (23) | material select (the same value as the `shader` control), `dynamicNext`, `materialSpeed/Scale/React` | `setInterval(syncDynamicMaterialUI, 400)`. The "Next new" button needs magic `dynamicMaterialStart` indices. |
| `maintenance/performance-ui.js` (15) | `softOnly` plus `softChoice`, `cameraPreset` | `softOnly` writes `sl(te.controls, 'sp:i')` (a raw `setCtl`) **and** `he.engineCtl` directly, then re-renders the whole panel (`lR(te)`). That is a *third* write path, and it skips effects and CC tags. |
| `maintenance/extra-controls.js` (29) | tip shape select, tip file, bounce toggle, `bounceSpeed/bounceSize/tipSize/tipBrightness/tipLimit`, `recReport`, `recEditor` | `setInterval(syncExtraControls, 400)`. `recEditor` is a hard-coded recording "Look". |
| `maintenance/recording-ui.js` (58) | `recAudio/recResolution/recFps/recQuality/recCompat` | Read straight from the DOM (`Y('recCompat')?.checked??true`). No settings key exists for them, so they are not persisted and reset on every load. |
| `maintenance/calm-camera.js` (16) | `setCalmCamera(mode)` calls `this.setControl(...)` on 7 keys | A *fourth* write path: the engine sets its own controls with no `onControlValue`, so the panel widgets and saved settings drift from the engine state. |
| `index.html` `<style id="simpleUiStyle">` | **Simple mode is a CSS hide-list** of 16 selectors (`#sec-pattern`, `#engineControls`, `#sec-output`, …) | Any new section is visible in Simple unless someone remembers to add it to the list. |
| `maintenance/interface.js` (34) | Search over `section.textContent` | It matches sections, not controls. It has no help or synonyms, and it cannot find a control that Simple mode hides. |

A bug that confirms the structural problem: the v17/v18 patches added `group:"Camera"`, `group:"Video"` and `group:"Soft motion"` to new controls. The bundle's `mount` still does `l.group=l.key.startsWith("sp:")?"Species":CK[l.key]??"More"` (grep anchor `async mount(e){for(const l of this.controls)l.group=`). The `CK` map was never updated. So **24 of the v0.16 to v0.19 controls land in the catch-all "More" section**, and their `group` fields are silently ignored: `calmCamera, camDistance, camSmooth, softWave, softReact, softSpeed, musicAmount, musicFocus, musicTrail, videoBuildPace, videoScatter, videoBuild, videoFollow, videoInvert, screenBounce, bounceSpeed, bounceSize, tipShape, tipSize, tipBrightness, tipLimit, materialSpeed, materialScale, materialReact`. The hand-written quick panels were partly the workaround for controls that nobody could find.

Other v19 costs:
- Applying a Simple Look makes about 30 separate `Zt.get(...).set()` calls. Each call runs `engine.setControl`, which schedules a debounced save, and sets the 37 `sp:i` toggles one by one. That is **37 `respawnHeld()` calls per click** (a1 L5).
- The "calm" Look defaults (`musicAmount .42`, `fillRate 240`, `sustain .2`, a still camera that is locked, `simple-ui.js:22-25`) are hard-coded in JS. They are the direct cause of the lead's observation that "3 held notes for 2 s grow ~300 segments". No test checks that a Look actually responds visibly to music.
- There are 134 organism controls (97 plus 37 species) and 8 globals. None of them carries help text. Labels are the only documentation.

---

## 2. Target architecture: principles

1. **One definition per control.** Its id, UI, persistence scope, MIDI learnability, randomization policy, morph policy, effects, tier and docs all live next to each other, in the feature folder that owns the control.
2. **Stable string ids, never indices.** Choices use option ids (`'cinematic-tour'`, not `7`). Species use ids (`'roots'`, not `sp:1`). Materials use ids (`'tidal-glass'`, not `22`). A migration table maps legacy indices once.
3. **A single write path.** Every write goes through `store.set` or `store.transaction`, with an `origin` tag. UI, MIDI, morph, Looks, macros, the URL and the engine itself all use it. Subscriptions replace polling.
4. **Generated surfaces, a few custom widgets.** The panel, Simple view, search, CC tags, URL codec and docs are functions of the schema. A custom widget (look grid, transport, playlist) is registered by name and still binds to schema ids.
5. **Looks and Macros are data.** They are validated at build time and linted against a headless growth simulation, so "music visibly grows" and "the camera frames the growth" become regression tests.
6. **Schema files are pure.** They cannot import three.js or DOM code, so tests, docs and search can load them in Node.
7. **Engine reads are O(1) typed slots.** No `Array.find` on the hot path, and no Proxy.

---

## 3. Module and file layout

```
src/
  app/
    boot.ts                 # ~80 lines: build registry, store, services, mount UI, select engine
    loop.ts                 # rAF loop, global auto-modulation (today main.ts:1041-1110)
    services.ts             # clock, midi, piano, audio, recorder, caster, synth, gestures, videoField
  schema/                   # PURE: no DOM, no three
    types.ts                # ControlDef union, Tier, Scope, GroupDef, LookDef, MacroDef, IntentDef
    define.ts               # range(), toggle(), choice(), set(), trigger(), asset(), text(); defineFeature()
    groups.ts               # GroupDef list with order + default-open + tier floor
    registry.ts             # collects feature fragments via import.meta.glob, validates, freezes, indexes
    ids.ts                  # ControlId type (derived via `satisfies`), namespacing helpers
    migrate.ts              # versioned migrations: v15 settings/presets/ccMap, v19 localStorage keys
    legacy-map.ts           # sp:i -> species id; shader index -> material id; camMode index -> id
  state/
    store.ts                # ParamStore: slots, transactions, subscribe, origins, dirty sets
    persistence.ts          # scope-aware storage (preset | session | machine | transient), quota-safe
    presets.ts              # slots v2, morph policy from defs (replaces presets.ts Morph heuristics)
    looks.ts                # applyLook(look, {vary, clear}) as ONE transaction
    macros.ts               # forward/inverse evaluation, "detached" state
    intents.ts              # choice-macros (camera intent, source intent)
    url.ts                  # URL codec generated from defs (alias + scope rules)
    cc.ts                   # CC learn/mapping on ids; soft-takeover; program change -> slot
    random.ts               # Surprise / random mix from def.randomize policy
  ui/
    panel/
      render.ts             # generic: groups -> sections -> widgets, filtered by tier
      widget-range.ts widget-toggle.ts widget-choice.ts widget-set.ts
      widget-trigger.ts widget-asset.ts widget-text.ts
      custom/               # escape hatch, registered by name
        look-grid.ts transport.ts playlist.ts device-select.ts rec-status.ts
    layouts/
      simple.ts             # Simple view layout DATA (ordering + headings), items are ids
    search.ts               # index: label, help, synonyms, group, option labels, keys; reveals across tiers
    keys.ts                 # keyboard shortcuts as DATA -> handler + Keys section + docs
    hud.ts
    styles.css
  features/                 # ONE FOLDER PER FEATURE = unit of parallel work
    global/        controls.ts                       # zoom, zoomReact, growth, decay, symmetry, rotSpeed, beatZoom, beatPalette, palette
    input/         controls.ts                       # input mode (session), audioSensitivity (was window global), stems
    growth/        controls.ts                       # speed, thickness, nodes, length, branch, wiggle, lignify, sustain, fillRate, maxLive, join, retract, cohesion, size, bounds
    species/       controls.ts  catalogue/*.ts        # species set (37 items, stable ids, families: rigid | soft)
    react/         controls.ts                       # react, pulse, flash, kick, shake, speedReact, lightReact
    music-focus/   controls.ts  runtime.ts           # musicAmount, musicFocus, musicTrail (+ credit allocator hook)
    camera/        controls.ts  runtime.ts cinematic.ts lock.ts calm.ts
    reference/     controls.ts  field.ts growth.ts   # video*, scatter, build, follow, invert, buildPace + actions fit/activate
    shell/         controls.ts  runtime.ts           # shell*, model anim, morph, attach, skinStick
    soft/          controls.ts  forms.ts runtime.ts  # softWave, softReact, softSpeed (+ soft species forms)
    materials/     controls.ts  catalogue.ts runtime.ts # material choice (ids), materialSpeed/Scale/React, envShader, env, bloom, glow
    tips/          controls.ts  shapes.ts            # tipShape, tipSize, tipBrightness, tipLimit, tipAsset
    bounce/        controls.ts  runtime.ts           # screenBounce, bounceSpeed, bounceSize
    life/          controls.ts  runtime.ts           # wild, beatLock, physics, gravity, wind, seasons, season, nested, cycle*
    typography/    controls.ts
    stems/         controls.ts
    performance/   controls.ts                       # budget, recycle, quality, autoQuality (scope: machine)
    recording/     controls.ts  recorder.ts          # recFormat, recAudio, recResolution, recFps, recQuality, recCompat (machine)
    cast/          controls.ts
  looks/                    # one file per Look (data), auto-collected by glob
    roots.ts coral.ts neural.ts crystal.ts liquid.ts silk.ts _music-led.ts _editor-capture.ts
  macros/
    growth.ts detail.ts music-reaction.ts
  engines/
    engine.ts               # Engine contract v2 (schema-aware)
    organism/               # engine-side split (other reports); reads `p` slots
    branching.ts cells.ts crystal3d.ts reactionDiffusion.ts   # converted via fromLegacyControls()
scripts/
  gen-docs.mjs              # docs/CONTROLS.md, docs/LOOKS.md, docs/KEYS.md from registry
  check-schema.mjs          # runs registry validation in CI (also part of `yarn build`)
tests/
  schema/*.test.ts  state/*.test.ts  looks/*.lint.test.ts  ui/*.test.ts  e2e/*.spec.ts
```

`index.html` shrinks to the stage, an empty `#panel` with `#panelTop` (logo, version, reset, perf, hide, tier switch, rec, still, search), the HUD and the camera-lock overlay. All other sections are generated.

---

## 4. Key interfaces (TypeScript)

### 4.1 Control definitions

```ts
// schema/types.ts
export type Tier = 'simple' | 'advanced' | 'expert'
/** Who owns the value:
 *  preset    - artistic state; saved in slots, morphed, in share-URLs
 *  session   - remembered per browser (input mode, section open state, camera lock pose is transient)
 *  machine   - performance/output for THIS computer; never in presets (budget, quality, rec*)
 *  transient - never persisted (camera lock pose, learn mode, armed rec) */
export type Scope = 'preset' | 'session' | 'machine' | 'transient'
export type MorphPolicy = 'lerp' | 'log' | 'snap'
export type EffectId =
  | 'rebuildShell' | 'respawnHeld' | 'rebuildEnv' | 'rebuildBackdrop' | 'applyShaders'
  | 'enforceBudget' | 'applyPixelRatio' | 'syncTipShape' | 'none'

interface BaseDef<Id extends string = string> {
  id: Id                        // 'organism.musicAmount' | 'global.zoom' | 'rec.fps'
  engine: 'organism' | 'rd' | 'branching' | 'cells' | 'crystal3d' | '*'
  label: string                 // short, UI
  help?: string                 // one or two sentences; tooltip + docs + search
  synonyms?: string[]           // search ('decay' -> 'fade', 'trail')
  group: GroupId
  order?: number                // within group; default = declaration order
  tier: Tier
  scope: Scope
  learnable?: boolean           // MIDI CC learn; default true for range/toggle/choice in preset|session scope
  url?: string | false          // short alias for URL params ('cam'); default: id when scope==='preset'
  randomize?: false | { min?: number; max?: number; p?: number }  // replaces NO_RANDOM / RANDOM_CAP
  effects?: readonly EffectId[] // replaces setControl if-chain (organism.ts:762-778)
  visibleWhen?: Predicate       // e.g. { id: 'organism.videoMode', ne: 'off' } - panel greys/hides
  since: `${number}.${number}.${number}`   // 'new in 0.19' badge; docs changelog
  legacyKeys?: readonly string[]           // 'e:organism:musicAmount', 'musicAmount'
  widget?: CustomWidgetId       // escape hatch ('lookGrid', 'tipShapePicker')
}

export interface RangeDef<Id extends string = string> extends BaseDef<Id> {
  kind: 'range'; min: number; max: number; step: number; default: number
  unit?: 's' | '/s' | '×' | '%' | 'k'
  curve?: 'lin' | 'log'         // slider + CC mapping curve
  morph?: MorphPolicy           // default 'lerp'
}
export interface ToggleDef<Id extends string = string> extends BaseDef<Id> {
  kind: 'toggle'; default: boolean
}
export interface ChoiceDef<Id extends string = string, O extends string = string> extends BaseDef<Id> {
  kind: 'choice'
  options: readonly { id: O; label: string; help?: string; family?: string; tier?: Tier }[]
  default: O
  /** index -> option id, for presets/ccMap saved by v15-v19 (append-only history). */
  legacyIndex?: readonly O[]
}
/** Multi-select over a catalogue (species). Items individually addressable: 'organism.species#roots'. */
export interface SetDef<Id extends string = string, I extends string = string> extends BaseDef<Id> {
  kind: 'set'
  items: readonly { id: I; label: string; icon?: string; family?: string; tier?: Tier }[]
  default: readonly I[]
  legacyIndex?: readonly I[]    // sp:0..36 -> ids in v19 append order
}
export interface TriggerDef<Id extends string = string> extends BaseDef<Id> {
  kind: 'trigger'; action: ActionId   // 'reference.fit' | 'materials.nextInFamily' | 'rec.report'
}
export interface AssetDef<Id extends string = string> extends BaseDef<Id> {
  kind: 'asset'; accept: string; maxBytes: number   // model, tip OBJ/image; scope must be 'session'|'transient'
}
export interface TextDef<Id extends string = string> extends BaseDef<Id> {
  kind: 'text'; default: string; maxLength: number
}
export type ControlDef = RangeDef | ToggleDef | ChoiceDef | SetDef | TriggerDef | AssetDef | TextDef

export interface GroupDef {
  id: GroupId; label: string; order: number
  openByDefault?: boolean       // replaces main.ts:295 OPEN_BY_DEFAULT
  help?: string
}
```

### 4.2 Feature fragments (the composition point with the engine split)

```ts
// schema/define.ts
export interface FeatureSchema<Defs extends readonly ControlDef[]> {
  id: string                    // 'music-focus'
  engine: EngineId | '*'
  controls: Defs
  actions?: readonly ActionDecl[]   // declared here, implemented in runtime.ts
}
export const defineFeature = <const D extends readonly ControlDef[]>(f: FeatureSchema<D>) => f

// features/music-focus/controls.ts  (pure data - no three import)
export default defineFeature({
  id: 'music-focus', engine: 'organism',
  controls: [
    range({ id: 'organism.musicAmount', label: 'Music growth amount', group: 'growth', tier: 'advanced',
      scope: 'preset', min: 0.1, max: 1.5, step: 0.05, default: 0.8, since: '0.17.2',
      help: 'Scales how far each note grows. Low values keep structures small and sparse.',
      legacyKeys: ['e:organism:musicAmount'] }),
    range({ id: 'organism.musicFocus', label: 'Highlight new / dim old', group: 'look', tier: 'advanced',
      scope: 'preset', min: 0, max: 1, step: 0.05, default: 0.8, since: '0.17.2' }),
    range({ id: 'organism.musicTrail', label: 'Fresh growth trail', unit: 's', group: 'look', tier: 'expert',
      scope: 'preset', min: 0.5, max: 8, step: 0.5, default: 2, since: '0.17.2' }),
  ],
})
```

### 4.3 Registry and typed ids

```ts
// schema/registry.ts
const mods = import.meta.glob<{ default: FeatureSchema<readonly ControlDef[]> }>(
  '../features/*/controls.ts', { eager: true })   // eager => bundled into the single-file HTML, no fetch
export const REGISTRY = buildRegistry(Object.values(mods).map((m) => m.default))
// buildRegistry validates: unique ids + legacyKeys, default in range, step>0, options unique,
// scope rules (asset => session|transient; machine => !learnable-in-presets), groups exist.

export type ControlId = (typeof ALL_DEFS)[number]['id']   // union of literal ids -> typo = compile error
```

If the literal union makes `tsc` slow (roughly 170 ids is fine, 1000+ might not be), `scripts/gen-ids.mjs` can emit `ids.gen.ts` instead.

### 4.4 ParamStore (single write path, O(1) reads)

```ts
// state/store.ts
export type Origin = 'ui' | 'midi' | 'preset' | 'morph' | 'look' | 'macro' | 'intent' | 'url' | 'engine' | 'random' | 'migrate'
export type Value = number | boolean | string | readonly string[]

export interface ParamStore {
  /** O(1): numeric slot read for hot paths; toggles are 0/1, choices are option ordinal in CURRENT options. */
  num(slot: Slot): number
  get<K extends ControlId>(id: K): ValueOf<K>
  set<K extends ControlId>(id: K, v: ValueOf<K>, origin: Origin): void
  /** Batch: one effects flush, one save, one notification per id. Looks, presets, macros use this. */
  transaction(origin: Origin, fn: (tx: Tx) => void): void
  subscribe(ids: readonly ControlId[] | '*', cb: (changed: ReadonlySet<ControlId>, origin: Origin) => void): () => void
  snapshot(scopes: readonly Scope[]): StateBlob          // presets = ['preset']; settings = ['session','machine']
  applyBlob(b: StateBlob, o: { origin: Origin; morphSeconds?: number }): void
}
export interface StateBlob { schema: 2; engine: EngineId; values: Partial<Record<ControlId, Value>>; look?: LookId }

/** Engine-facing typed view, compiled once per engine: property getters over a Float64Array. */
export type ParamView<E extends EngineId> = { readonly [K in ShortKeyOf<E>]: number }
// organism code: `const fill = this.p.fillRate` instead of `ctl(this.controls, 'fillRate')`
```

The engine never mutates the store directly. When it needs to move a value itself (seasons phase at `organism.ts:2145`, shell cycle at `organism.ts:2320-2325`, calm camera), it calls `store.set(id, v, 'engine')`. The store marks the change so it is not echoed back as an effect, and scope rules decide whether to persist it. Seasons phase would use `scope: 'transient'` for the auto-advanced value.

### 4.5 Engine contract v2

```ts
// engines/engine.ts
export interface EngineV2 {
  readonly id: EngineId; readonly name: string; readonly blurb: string
  /** Features this engine hosts; the registry filters controls by engine id. */
  readonly features: readonly string[]
  mount(host: HTMLElement, ctx: EngineCtx): Promise<void> | void
  frame(m: MusicState, g: GlobalView): void
  /** Replaces setControl: called once per transaction with the set of changed ids, after effects are deduped. */
  onParams?(changed: ReadonlySet<ControlId>, origin: Origin): void
  /** Action handlers for TriggerDefs owned by this engine's features. */
  actions?: Partial<Record<ActionId, (arg?: unknown) => void | Promise<string | void>>>
  /** Dynamic option lists (e.g. 'shell' gains loaded model names) - store re-renders just that widget. */
  dynamicOptions?(id: ControlId): readonly { id: string; label: string }[] | undefined
  unmount(): void
  // resize, snapshot, canvasEl, stats, loadShell -> unchanged
}
export interface EngineCtx { store: ParamStore; p: ParamView<EngineId>; emit(ev: EngineEvent): void }
```

Effects are declared per def (`effects: ['rebuildShell']`) and **deduplicated per transaction**. Setting 37 species items in one Look is one `respawnHeld()`, not 37 (a1 L5). A preset morph that changes `thickness` every frame triggers no effect at all, because thickness declares none (a3 #6).

### 4.6 Looks, Macros, Intents (authored data)

```ts
// schema/types.ts (continued)
export type CameraIntent = 'frame-growth' | 'gentle-orbit' | 'still' | 'manual' | 'cinematic'
export interface LookDef {
  id: LookId; label: string; blurb?: string; tier: 'simple' | 'advanced'; since: string
  extends?: LookId | '_music-led'          // shared base patch
  species: readonly SpeciesId[]
  palette: PaletteId; material: MaterialId
  camera: CameraIntent
  values: Partial<Record<ControlId, Value>> // only preset-scope ids allowed (validated)
  vary?: { ids: readonly ControlId[]; amount: number }   // Surprise: ±amount, clamped to def range
  /** Regression expectations checked by the headless look-lint (section 9). */
  expect?: {
    segmentsAfter2sOf3Notes?: [min: number, max: number]
    newGrowthInFrustum?: number             // fraction of new segment endpoints on screen, e.g. 0.8
    silenceGrowthPerSecond?: number         // must be ~0 when musicLed (no autonomous fill)
  }
}

export interface MacroDef {
  id: `macro.${string}`; label: string; help: string; tier: Tier; scope: 'preset'
  min: 0; max: 1; default: number; learnable: true; since: string
  targets: readonly { id: ControlId; map: Curve }[]   // Curve = {from:[0,1], to:[a,b], shape?: 'lin'|'ease'|'log'}
  /** How the macro slider reads back: from one anchor target, or 'detached' if targets disagree. */
  inverse: { anchor: ControlId } | 'stored'
}

/** A choice whose options are patches (camera intent, source intent, 'music-led'). */
export interface IntentDef {
  id: `intent.${string}`; label: string; tier: Tier; scope: 'preset' | 'session'
  options: readonly { id: string; label: string; help?: string; patch: Partial<Record<ControlId, Value>>; action?: ActionId }[]
  // readback: first option whose patch matches current values, else 'custom'
}
```

Example: the v19 recipes rewritten as data, retuned to show the music, with the numbers visible for review:

```ts
// looks/_music-led.ts : shared base (replaces simple-ui.js `base` + music-focus-ui.js `musicLed`)
export default defineLookBase({ id: '_music-led', values: {
  'organism.wild': 0, 'organism.nested': 0, 'organism.physics': false, 'organism.seasons': 0,
  'organism.videoBuild': false, 'organism.screenBounce': false,
  'organism.musicAmount': 0.8, 'organism.sustain': 0.6, 'organism.fillRate': 1200,   // v19: .42 / .2 / 240
  'organism.pulse': 0.45, 'organism.flash': 0.3, 'organism.speedReact': 0.6,          // v19: .15 / .08
  'organism.musicFocus': 0.7, 'organism.musicTrail': 2,
  'global.zoomReact': 0.15, 'global.beatZoom': 0, 'global.rotSpeed': 0,
}})

// looks/silk.ts
export default defineLook({
  id: 'silk', label: 'Silk', tier: 'simple', since: '0.19.0', extends: '_music-led',
  species: ['silk-ribbon'], palette: 'mono', material: 'silk-shimmer',     // v19: palette 5 (= 'mono'), shader 27
  camera: 'frame-growth',                                                   // v19: 'still' -> grew out of frame
  values: { 'organism.branch': 0.15, 'organism.wiggle': 0.4, 'organism.length': 0.75,
            'organism.thickness': 0.9, 'organism.nodes': 0,
            'organism.softWave': 0.65, 'organism.softReact': 0.9, 'organism.softSpeed': 0.35 },
  vary: { ids: ['organism.branch', 'organism.wiggle', 'organism.length', 'organism.thickness'], amount: 0.12 },
  expect: { segmentsAfter2sOf3Notes: [1500, 20000], newGrowthInFrustum: 0.8 },
})

// macros/growth.ts : the v19 simpleGrowth slider (simple-ui.js:91-94), now two-way
export default defineMacro({ id: 'macro.growth', label: 'How much the music grows', tier: 'simple',
  help: 'More = each note grows further and faster, and keeps growing briefly after release.',
  default: 0.6, since: '0.19.0', inverse: { anchor: 'organism.musicAmount' },
  targets: [
    { id: 'organism.musicAmount', map: { from: [0, 1], to: [0.1, 1.5] } },
    { id: 'organism.speed',       map: { from: [0, 1], to: [0.5, 1.6] } },
    { id: 'organism.sustain',     map: { from: [0, 1], to: [0.08, 1.2] } },
    { id: 'organism.fillRate',    map: { from: [0, 1], to: [200, 3000], shape: 'log' } },
  ] })

// state/intents: camera (replaces calm-camera.js + simpleCamera select + cameraPreset select)
export const cameraIntent = defineIntent({ id: 'intent.camera', label: 'Camera', tier: 'simple', scope: 'preset',
  options: [
    { id: 'frame-growth', label: 'Follow the growth', patch: { 'organism.camMode': 'wide-pulse', 'organism.calmCamera': true, 'organism.camFollow': 0.4 } },
    { id: 'gentle', label: 'Very slow orbit', patch: { 'organism.camMode': 'orbit', 'organism.orbit': 0.08, 'organism.calmCamera': true } },
    { id: 'still',  label: 'Still', patch: { 'organism.camMode': 'orbit', 'organism.orbit': 0 }, action: 'camera.lock' },
    { id: 'manual', label: 'Manual only', patch: { 'organism.camMode': 'orbit', 'organism.orbit': 0 }, action: 'camera.unlock' },
  ] })
```

### 4.7 CC, URL, persistence contracts

```ts
// state/cc.ts
export interface CcBinding { cc: number; channel?: number; device?: string; target: ControlId | `${ControlId}#${string}` | MacroId; pickup?: boolean }
// ccMap v2 keyed by binding; v15 {"21":"e:organism:speed"} migrated via legacyKeys.
// Species items are learnable (fixes a3 #22: species icons couldn't be mapped).

// state/url.ts
// ?look=coral&cam=gentle&ui=0              <- aliases from defs/intents (short, OBS-friendly)
// #s=<base64url(deflate(JSON diff vs look))> <- full preset-scope state, no localStorage dependency (fixes a3 #13)
export function encodeUrl(store: ParamStore, look?: LookId): string
export function applyUrl(url: URL, store: ParamStore): void   // only preset|session scope; never machine

// state/persistence.ts
// keys: growth.v20.settings (session+machine), growth.v20.presets (slots, preset scope only),
//       growth.v20.cc, growth.v20.firstRun. Every write is try/catch with a visible warning (v0.15.1 behaviour).
```

---

## 5. Generated surfaces

| Surface | How it is generated | Replaces |
|---|---|---|
| **Advanced/Expert panel** | `ui/panel/render.ts`: `groups.sort(order)` then defs where `tier <= viewTier`, rendered by kind. Kind `set` gives the icon grid with all/none/family filter buttons. `visibleWhen` greys out a control. The CC tag and "new in x.y" badge come from the def. ARIA labels come from `label` plus `help` (`aria-describedby`). | `main.ts:134-416`, the `GROUP` map, the group overwrite in `mount`, and the a11y patches from v0.15.1 `interface.js` |
| **Simple view** | `ui/layouts/simple.ts` is ordering data that lists ids, Looks, macros and intents. It renders with the same widgets plus `custom/look-grid.ts`. Hiding follows from **tier**, not from a CSS list. | `simple-ui.js`, the `#simpleHome` markup and the `#simpleUiStyle` hide-list |
| **Quick panels** (reference, music, materials, bounce/tips, soft/camera) | These are no longer separate panels. Each control appears once, in its group, at its tier. Where a "quick" cluster is really wanted, a layout entry (`{ section: 'Source', items: [...] }`) points at the same ids. The widgets subscribe to the store, so no polling is needed. | `reference-ui.js`, `music-focus-ui.js`, `dynamic-material-ui.js`, `performance-ui.js`, `extra-controls.js`, 4× `setInterval` |
| **Search** | Index of `label + help + synonyms + group label + option labels + key shortcuts`. Results are **controls**. Clicking a result scrolls to the control and highlights it. A hit in a hidden tier shows an "Advanced" badge and reveals that one control inline. | `interface.js` section textContent filter |
| **Presets / morph** | `snapshot(['preset'])`. The morph policy comes from `def.morph` (range → lerp/log, choice/toggle/set → snap at t=0.5 or at start). Machine scope is excluded, so budget and quality are never overwritten. | `main.ts:441-534`, `presets.ts` Morph heuristic |
| **Random / Surprise** | Surprise picks a Look (`vary`). "Random mix" (Expert) samples defs with `randomize` set, using the caps in the def. | `main.ts:463-494`, `simpleSurprise` |
| **CC learn** | Only `learnable` defs, plus macros and species items. Right-click or long-press → learn. Pickup mode prevents value jumps. | `main.ts:205-218, 537-559` |
| **URL** | Aliases plus a compressed diff hash (section 4.7). | `main.ts:1112-1143` |
| **Docs** | `scripts/gen-docs.mjs` → `docs/CONTROLS.md` (table per group: label, range, default, tier, scope, CC, since, help), `docs/LOOKS.md`, `docs/KEYS.md`. The in-app "?" popovers come from the same `help`. | the NOTES files as the only docs |
| **Keys section** | `ui/keys.ts` data (key, code, description, handler, `allowInInputs`), rendered in the panel and docs. It also carries the v0.15.1 guards (repeat, IME, modifiers, F2 vs Tab). | `main.ts:998-1029` + `index.html` Keys markup |
| **Version display** | `since` powers the "New in 0.20" filter. `VERSION` is still one constant. | — |

---

## 6. How each v0.15.1 to v0.19.0 feature cluster maps onto the schema

The Tier and Scope columns are proposals. The owner makes the product call.

| Cluster (version, source) | Schema representation | Tier | Scope | Custom UI? | Notes |
|---|---|---|---|---|---|
| Audio input races (0.15.1, `audio-methods.js`) | Not controls: the service in `inputAudio.ts` (generation counter). Input mode becomes `choice input.mode {midi,file,mic,tab}` | simple | session | transport, playlist, device-select | Mode buttons are a generated choice widget styled as buttons |
| Keyboard, F2/Tab/Esc, inert panel, Show-controls (0.15.1) | `ui/keys.ts` data table plus panel shell | — | — | no | Shortcut docs are generated |
| Find-a-setting, a11y, target sizes (0.15.1, `interface.js/.css`) | `ui/search.ts` from the schema; widgets are accessible by construction | — | — | no | Search reveals across tiers |
| Storage error handling (0.15.1) | `state/persistence.ts` | — | — | no | |
| Reference 3D growth (0.16.0): `videoBuild`, `videoFollow`, `videoInvert` plus existing `videoMode/Size/Depth/Edge/Stick/Spawn/Show` | `features/reference/controls.ts`. `videoMode` becomes a choice with ids `off/depth/lines/depth-lines/mimic`. `videoShow` gets **two** representations: range opacity (expert) and a `toggle` alias "Source visible" (simple) that stores the last opacity. Triggers: `reference.activate`, `reference.fit` | Show/Fit simple; Size/Depth/Follow/Build advanced; Edge/Stick/Spawn expert | preset (Size/Depth/Mode), session (Show) | no | `rebuildBackdrop` effect only on the ids that need it, not on every `video*` prefix (`organism.ts:767`) |
| Seed spread (0.17.1) `videoScatter` | range | advanced | preset | no | |
| Recording rewrite (0.17.0): `recAudio`, `recResolution`, `recFps`, `recQuality`, `recFormat` | `features/recording/controls.ts` choices with ids | advanced | **machine** (persisted, never in presets) | `rec-status` custom (live MIME, duration) | Fixes "not persisted" (they are read from the DOM today) |
| Editor capture (0.18.0) `recCompat`, `recEditor`, `recReport` | toggle `rec.editorCompat`; `recEditor` becomes an **IntentDef option** "Editor MP4 (1080p30 H.264/AAC)"; `recReport` is a trigger | simple (Editor preset on the rec row), advanced (the rest) | machine | no | Recorder internals belong to other reports; the schema only carries the settings |
| Cinematic cameras (0.17.0): `camMode` options 6-8, `camDistance`, `camSmooth`, Shift-middle pan | `camMode` choice with ids (`orbit, weave, tunnel, drift, sit-inside, chase, tip-glide, cinematic-tour, wide-pulse`), `legacyIndex` for presets | intent simple; camMode/camDistance advanced; camSmooth expert | preset | no | `cameraPreset` quick select removed (duplicate of `camMode`) |
| Soft species (0.17.0/0.18.0): 13 soft forms, `softWave/React/Speed`, `softOnly`/`softChoice` | Species `set` items with `family: 'soft'`; the generic set widget has family filter buttons ("only soft", "only rigid"). Soft motion controls go in group `soft`, `visibleWhen: species has family soft` | Looks cover simple; set advanced; soft motion advanced | preset | no | Removes the `sl(te.controls, …)` write-path bypass |
| Music focus (0.17.2): `musicAmount`, `musicFocus`, `musicTrail`, `videoBuildPace`, `musicLed` | ranges plus the `_music-led` Look base (a patch) | macro.growth simple; ranges advanced/expert | preset | no | Defaults move to the Look data and are linted |
| Camera lock (0.17.2) | `toggle organism.cameraLock` (**transient**; the pose lives in the engine) plus trigger actions `camera.lock/unlock` | simple (the overlay button stays a fixed custom element bound to the id) | transient | small overlay | Notes say explicitly "session control, not saved preset", which the schema can now state |
| Animated materials (0.17.3): shader indices 22-31, `materialSpeed/Scale/React`, `dynamicNext` | `material` choice with ids and `family: 'classic' \| 'animated'`, plus `legacyIndex` (32 entries). "Next new" becomes a generic trigger `choice.nextInFamily(id, 'animated')` | material simple (inside Looks), selector advanced, speed/scale/react expert | preset | no | No more magic `dynamicMaterialStart` |
| Screen bounce (0.18.0) `screenBounce`, `bounceSpeed`, `bounceSize` | `features/bounce` | advanced | preset | no | |
| Tip shapes (0.18.0) `tipShape` (11 options), `tipSize`, `tipBrightness`, `tipLimit`, `tipFile` | choice + ranges; `tipLimit` **machine**; `tip.asset` AssetDef (session). A preset stores `tipShape: 'custom'` plus the asset name and hash, and warns if the asset is missing | advanced (shape/size), expert (limit/brightness) | preset / machine / session | asset widget is generic | |
| Calm camera (0.19.0) `calmCamera` | toggle plus `intent.camera` | simple via the intent | preset | no | `setCalmCamera` becomes intent patches applied through the store, so there is no hidden `setControl` path |
| Simple mode (0.19.0) | `tier` on every def, `ui/layouts/simple.ts`, the tier switch in `#panelTop` (session scope) | — | session | look-grid | |
| Six Looks and Surprise (0.19.0) | `looks/*.ts` with stable ids, `vary`, `expect` | simple | preset | look-grid | Retuned to be music-obvious and to frame the growth (section 4.6) |
| Simple Growth/Detail sliders | `macros/growth.ts`, `macros/detail.ts` (two-way) | simple | preset | no | |
| Audio sensitivity (0.19.0) `window.__growthAudioSensitivity` | `range input.audioSensitivity` (subscribed by `AudioInput`) | simple | session (it is about the room/mic, not the art) | no | Now persisted and CC-learnable |
| Source intents: Trace/Relief/Skin model/Free (0.19.0) | `intent.source` with 4 option patches (`simple-ui.js:52-66` literally) + actions | simple | preset | no | The model picker is `shell.asset` AssetDef |
| First-run look `growth-good-start-v0190` | `persistence.firstRun` + `DEFAULT_LOOK` constant | — | session | — | Awaits engine mount (fixes a3 #14 race) |
| Stems, typography, seasons, physics, nested, cycle, shell/model (v0.15 features, unchanged in v19) | one feature folder each | expert (stems/nested/cycle/physics), advanced (shell, typography) | preset | model loader = AssetDef | |
| Globals (`main.ts:400-409`) + palette | `features/global` (`engine:'*'`), palette choice by id | palette simple (via Look), zoom advanced, others expert | preset | no | |
| Other engines (RD, branching, cells, crystal3d) | `fromLegacyControls(engineId, controls, { tier: 'advanced' })` adapter first, then hand-annotated | advanced | preset | no | Low priority |

**Resulting tier sizes** (approximate): Simple ≈ 10 elements (Look grid, Surprise, 2 macros, Music reaction macro, audio sensitivity, camera intent, source intent, source visible/fit, record plus Editor MP4). Advanced ≈ 55. Expert = the remaining ≈ 110 plus the species set.

A suggested new simple macro, `macro.musicReaction`, drives `react`, `pulse`, `flash`, `speedReact`, `lightReact`, `global.zoomReact` and (only when the camera intent is not still) `kick`. It is the "make it obviously a music visualiser" knob the owner keeps asking for. It replaces the v19 split where calm defaults quietly turned all of these down.

---

## 7. How the quick-panel duplication disappears (file by file)

| v19 file | Lines | Fate | Replacement |
|---|---|---|---|
| `simple-ui.js` | 123 | deleted | 6 Look files (~12 lines each), 2-3 macro files (~12 each), 2 intents (~20 each), `layouts/simple.ts` (~30), `custom/look-grid.ts` (~50) |
| `reference-ui.js` | 58 | deleted | ~10 def entries in `features/reference/controls.ts`, 2 actions in `runtime.ts` (activate, fit) |
| `music-focus-ui.js` | 23 | deleted | 3 defs + `_music-led` base + camera-lock toggle def |
| `dynamic-material-ui.js` | 23 | deleted | material choice with families + generic `nextInFamily` trigger |
| `performance-ui.js` | 15 | deleted | set-widget family filter (generic) + `camMode` def |
| `extra-controls.js` | 29 | deleted | defs in `tips/`, `bounce/`, `recording/`; generic asset widget |
| `interface.js` | 34 | deleted | `ui/search.ts` (~120, schema-aware) |
| `recording-ui.js` | 58 | logic kept (moved to `features/recording/runtime.ts`), DOM reads removed | recording defs (machine scope) |
| `index.html` quick markup (`#simpleHome`, `#sec-specialist-*`, `#referenceTools`, music block, `#sec-fluid`, `#simpleUiStyle`) | ~60 dense lines | deleted | generated |

The honest line count: about 360 lines of v19 UI JS plus about 60 lines of markup become about 350 lines of data and generic renderer. The generic renderer (about 400 lines) is paid once. **The first migration does not win on lines.** It wins on marginal cost: v20+ features add zero UI code, and there is one write path, zero polling and zero hide-lists.

---

## 8. Composition with the engine-side module split

The engine split (other reports) will likely turn `organism.ts` into a core (plants/segments/tips/render) plus feature modules with hooks (`beforeGrow`, `segmentColor`, `afterFrame`, `camera`, …). This proposal lines up with that:

```
features/<name>/
  controls.ts   <- schema fragment (pure). Imported by registry, UI, docs, tests (Node-safe).
  runtime.ts    <- engine hook implementation. Imports three. Receives `ctx.p` (typed view) + store.
  index.ts      <- defineFeatureRuntime({ id, install(core, ctx) { return { onParams, beforeGrow, ... } } })
```

- **Join point:** the registry, filtered by `engine`. `OrganismCore` collects `features/*/index.ts` with the same `import.meta.glob`. Adding a feature therefore needs no edit to the core's import list.
- **Reads:** feature runtimes read `ctx.p.musicAmount`. The core compiles `ParamView<'organism'>` once, at mount.
- **Effects:** a def's `effects` names core-level effects (`respawnHeld`, `applyShaders`). A feature can also implement `onParams(changed)` for its own effects (tips: `syncTipShape`, which today is patched into the frame).
- **Actions:** triggers (`reference.fit`, `camera.lock`) resolve to `runtime.actions`. The UI never touches engine internals. Today `reference-ui.js` pokes `te.referenceFrameRadius`, `te.zoomMul` and `te.pan` directly.
- **Import rule:** `controls.ts` may import only from `schema/`. This is enforced by a test that parses imports (section 10), so the schema never pulls three.js into the UI or Node tests.
- **Legacy bridge:** during migration, `toEngineControls(defs)` produces the old `EngineControl[]` (`engine.ts:27-40`), so the unsplit `organism.ts` and the current panel keep working (section 9, steps 1-2).

---

## 9. Migration plan: every step ships a working app

The critical path is steps 1-3, owned by one engineer, about 3-5 working days. After step 3, feature porting fans out.

| Step | Change | App still works because… | Size |
|---|---|---|---|
| **0. Safety net** | Add Vitest plus happy-dom. Add a Playwright smoke that loads the dev build and the single-file HTML in Chrome (WebGPU) and in Chromium with WebGPU disabled (WebGL2 path), plays a scripted MIDI phrase through `window.__viz.clock`, asserts no console errors and a non-black frame, and screenshots. Capture **real localStorage fixtures** from v0.15.0 and v0.19.0 (`midiviz_settings_v3`, `midiviz_presets_v1`, `growth-ui-mode`, `growth-good-start-v0190`). | No product change | S |
| **1. Schema types + organism fragments, legacy-bridged** | Create `schema/` and `features/*/controls.ts`. Move each entry from `organism.ts:371-446` into its feature fragment with `group`, `tier`, `scope`, `since`. Keep the **short keys** as `legacyKeys`. `OrganismEngine.controls = toEngineControls(registry.forEngine('organism'))`. Delete `GROUP`/`GROUP_ORDER` (`organism.ts:226-245`) and the overwrite in `mount` (`571-573`). The globals from `main.ts:400-409` become `features/global`. | `EngineControl[]` is byte-identical in keys, values and order. The panel is unchanged. | M |
| **2. ParamStore behind `ctl()`** | Implement the store. `ctl(controls, key)` becomes a slot read (same signature), and `setCtl` routes to `store.set(..., 'engine')`. Then codemod the 113 `ctl(this.controls, 'x')` calls to `this.p.x`. Replace the `setControl` if-chain with `effects` plus `onParams`. Engine-side writes (`season`, `shell` cycle) go through the store, so widgets sync. | The same values flow. Only the plumbing changes. | M |
| **3. Generated panel, presets, CC, persistence v2** | Replace `widget/renderEngineControls/renderGlobalControls` (`main.ts:134-416`) with `ui/panel/render.ts` (tier = advanced shows everything, as today). Presets v2 with scope filtering and def-driven morph. ccMap v2. `migrate.ts` reads v3 settings and v1 presets once and writes v20 keys, **keeping the old keys** as a rollback path. | The UI looks the same, now with help tooltips. Old presets load. | M-L |
| **4. Fan-out: port v19 features into feature folders** (parallel, section 10) | Each PR adds `features/<x>/{controls,runtime,index}.ts`, tests, and **no** edits to `main.ts`, `index.html` or a central list. Suggested order by value: music-focus + camera lock/calm → reference (+scatter) → recording settings (machine scope) → cinematic cameras → soft species + forms → materials catalogue → tips → bounce → input sensitivity. v0.15.1 audio/keyboard fixes are services, ported alongside. | Each feature ships behind its own def defaults, and the Looks don't use it until step 5 | 9 × S-M |
| **5. Tiers, Looks, Macros, Intents, Simple view** | Add `looks/`, `macros/`, `state/intents.ts`, `ui/layouts/simple.ts`, `custom/look-grid.ts`, and the tier switch. First run applies a Look **after** mount resolves. Retune the Looks with the headless look-lint in place (section 11). | Simple is a filter over existing controls. Advanced is unchanged. | M |
| **6. Search, URL, docs, keys-as-data** | `ui/search.ts`, `state/url.ts` (aliases plus the hash state that OBS needs), `scripts/gen-docs.mjs` added to `yarn build`, `ui/keys.ts` | Additive | S-M |
| **7. Remove the bridges** | Delete `toEngineControls` and `EngineControl`. Convert the other four engines from the `fromLegacyControls` adapter to annotated defs. Stop writing the old storage keys after one release. | Covered by the fixture tests | S |

Each step is a separate release candidate. `VERSION` gets bumped (0.20.0-alpha.N) so the owner can see which build is running.

---

## 10. Parallel porting with minimal merge conflicts

### 10.1 Hotspots today (every v19 feature touched these)

| Hotspot | Why it conflicts | Mitigation in this design |
|---|---|---|
| `organism.ts:371-446` controls array | Every feature appends keys in the middle of one literal | Per-feature `controls.ts`; order comes from `group` + `order`, not array position |
| `organism.ts:226-245` GROUP map | Every new key needs an entry (v19 forgot 24) | Deleted; `group` sits in the def |
| `organism.ts:762-778` setControl | Every feature adds an `if` | `effects` in the def + per-feature `onParams` |
| `organism.ts` `frame()` (2274-2775) | Every runtime feature inserts a call | Engine split with a hook registry (phase + order); no edits to the core frame |
| `organism.ts:105-130` SPECIES / `shaders.ts:97` GROWTH_SHADERS | Append-only arrays whose indices are a compatibility contract | Catalogue folders, one file per family, stable ids; `legacyIndex` is written once in `schema/legacy-map.ts` and frozen |
| `main.ts` (all of it) | Presets, CC, random, keys, URL, UI wiring in one file | Split into `state/*`, `ui/*`, `app/*`; features never edit these |
| `index.html` | Quick panels, simple CSS hide list | Shell only; sections are generated |
| `version.ts`, README, NOTES | Everyone edits | `changes/<feature>.md` fragments (changesets style), collated at release; the version is bumped only by the release script |
| Looks | Tuning collisions | One file per Look; `_music-led` base owned by one person |
| Central import lists (engines, features, looks) | Every PR adds a line | `import.meta.glob(..., { eager: true })`; the single-file build still inlines everything |

### 10.2 Rules for parallel engineers

1. **One feature = one folder = one PR.** A PR touches `features/<x>/**`, `tests/features/<x>/**`, and optionally `changes/<x>.md`. That's all.
2. **Id namespace per feature.** `organism.<key>` for engine controls, keeping v19 short keys for migration. `rec.*`, `input.*` and `global.*` for app features. The registry test fails on a duplicate, so collisions show up in CI instead of at runtime.
3. **Shared core effects** (`respawnHeld`, `applyShaders`, …) are an enum in `schema/types.ts`. Adding one is a tiny, separate PR, reviewed by the core owner.
4. **Hook points** (engine split) are declared by the core owner up front: `beforeEvents, beforeGrow, onSegmentBorn, segmentColor, afterGrow, camera, beforeDraw, afterDraw`. Features register with a numeric `order` and never edit the core.
5. **Generated files** (`docs/*.md`, optional `ids.gen.ts`) are either not committed or committed with a CI "regenerate and diff" check. Nobody hand-resolves conflicts in them.
6. **Codeowners:** `schema/`, `state/`, `ui/panel/` belong to the core owner. `looks/` belongs to the owner (Dimi) plus one engineer. Each `features/<x>` belongs to its porter.
7. **Legacy maps are frozen history.** `legacy-map.ts` is written once from the v19 bundle's final order (24 species + 3 soft + 10 extra soft; 22 + 10 materials; 9 camera modes) and then only appended to.

With this, the nine v19 feature ports in step 4 can run as nine concurrent PRs. The expected conflicts are limited to `changes/` (none, since the files differ) and occasional additions to the `EffectId` enum.

---

## 11. Testing strategy

| Layer | Tooling | What it asserts |
|---|---|---|
| **Schema invariants** | Vitest, Node (the schema is pure) | Unique ids and legacyKeys. Default within [min,max] and aligned to step. Choice/set ids unique; `legacyIndex` length ≥ the v19 count. `asset` ⇒ session/transient scope. Machine scope ⇒ not referenced by any Look, macro target or URL alias. Every `simple`-tier def has `help`. Every group exists. `controls.ts` files import only from `schema/` (parse the imports). |
| **Type safety** | `tsc --noEmit` | `this.p.fooo` is a compile error. A Look referencing a nonexistent id is a compile error (`Partial<Record<ControlId, …>>`). |
| **Migrations** | Vitest with **real fixtures** from v0.15.0 and v0.19.0 localStorage | `sp:23` → `'brambles'`; `shader: 27` → `'silk-shimmer'`; `camMode: 7` → `'cinematic-tour'`; ccMap `"21":"e:organism:speed"` → binding to `organism.speed`; unknown keys dropped with a report; idempotent (running twice changes nothing) |
| **Store** | Vitest | A transaction flushes deduped effects once (37 species set → one `respawnHeld`). Origins propagate. Engine-origin writes don't re-trigger effects. `snapshot(['preset'])` excludes machine/session. Morph: lerp/log/snap policies; no effects during a morph unless declared. |
| **Macros / intents** | Vitest, property-based (fast-check) | Forward output stays inside the target def ranges for x∈[0,1]. `inverse(forward(x)) ≈ x`. Independent target edits → macro shows "detached". The intent readback matches its own patch and reports `custom` otherwise. |
| **Panel golden** | happy-dom + snapshot | Per tier: section list, control count (Simple ≤ 12), ARIA labels present, CC tag rendering, `visibleWhen` greying. Search: "fade" finds decay, "camera" finds the intent plus camMode, a hidden-tier hit reveals the control. |
| **URL** | Vitest | encode → decode round-trip equals the preset-scope state; machine scope never appears; aliases stable |
| **Look lint (key new test)** | Headless organism core in Node with a stub renderer (needs the engine split: core without WebGPU) | For each Look: scripted MIDI (3 notes held 2 s; then an 8-bar pattern) → segment count inside `expect.segmentsAfter2sOf3Notes`; share of new endpoints inside the look's camera frustum ≥ `expect.newGrowthInFrustum`; growth during silence ≈ 0 for music-led looks; no NaN transforms. This makes the owner's complaints ("obvious music visualiser", "camera frames the action", "does not stall at limits": run 5 min at budget) into CI failures. |
| **Real browser** | Playwright: Chrome stable (WebGPU), Chromium with WebGPU disabled (WebGL2), WebKit smoke | Load `dist/growth-visualiser-vX.html` over `file://` offline. Cycle all Looks and take screenshots (non-black coverage %, stored as artifacts for the owner to eyeball). Tier switch. Search. CC learn via a synthetic `MIDIMessageEvent` injected into the input stub. Preset save/load/morph. Zero console errors. This covers the gap that v0.16-v0.19 were **never rendered**. |
| **Docs drift** | CI | `gen-docs` output equals the committed docs (if they are committed) |

---

## 12. Honest cons and risks

1. **Upfront cost on the busiest surface.** Steps 1-3 touch `organism.ts` and `main.ts` everywhere, before any visible v20 feature ships. With parallel porters waiting, that is a 3-5 day serial bottleneck. If it slips, people start porting into the old style and you pay twice.
2. **Generated UI can feel like a settings dump.** The owner is a visual artist, and the v19 Simple panel's hand-made feel (big look buttons, plain-language intents) is worth keeping. The custom-widget escape hatch and the layout data exist for this, but there is a real risk of "everything looks like a slider".
3. **Schema creep.** `visibleWhen`, dynamic options (shell models, `onControlsChanged`), engine-written values (seasons, shell cycle), assets and families are each justified. Together they head toward a DSL. The guard: when a def feature is used by fewer than 2 controls, it belongs in a custom widget instead.
4. **Macros are lossy by nature.** A user can tweak `speed` after moving the Growth macro. The "detached" readback is correct, but it may confuse people. The alternative (macro owns its targets and locks them) is more rigid. It is a product decision to show the owner.
5. **Tiering is a product call that is easy to get wrong.** Hiding a control the owner uses live is worse than clutter. Mitigations: search crosses tiers, and "pin to Simple" (a per-user session override list) is cheap to add.
6. **Stable ids mean migration code forever.** `legacy-map.ts` and `migrate.ts` must stay correct for v15-v19 data indefinitely, or old presets break silently. The fixtures help, but only as far as their coverage goes.
7. **The literal-union `ControlId` type** can slow `tsc` or produce unreadable errors as ids grow. There is a codegen fallback, but it adds a build step.
8. **Two sources of "default"** (schema default vs. the first-run Look) can confuse contributors. Rule: the schema default is the neutral expert baseline, the Look is the artistic starting point, and docs show both.
9. **It does not fix the engine.** Faceted Liquid (soft mesh subdivision and normals), notes starving at limits (a1 H5-H7), recordings for QuickTime/Resolve (a3 #1-2) and fusion bugs are engine and recorder work. The schema makes their *tuning* cheap and testable. It does not do the work.
10. **The look-lint needs a headless core.** Without the engine split that separates simulation from WebGPU rendering, the most valuable test (music visibly grows, camera frames it) can only run in Playwright, which is slower and flakier. That makes this proposal partly dependent on the engine-split proposal.
11. **Performance footgun.** A naive store (Map lookups, Proxies, per-read allocation) would be slower than today's `Array.find`. The slot-compiled `ParamView` is mandatory, not optional.
12. **Single-file build.** `import.meta.glob({ eager: true })` is inlined by Vite, which is fine. But anything that lazily loads feature code (e.g. MediaPipe) must stay out of `controls.ts`, or it defeats the pure-schema rule.

---

## 13. Direct wins against the owner's recurring complaints

| Complaint | What the schema changes |
|---|---|
| "Growth must visibly follow the music" | Looks become data with `expect` thresholds, checked in CI. A `macro.musicReaction` gives a single obvious knob. The calm defaults (`musicAmount .42`, `fillRate 240`) move from hidden JS to reviewed data. |
| "Camera should frame the action" | `intent.camera` defaults to `frame-growth` in Looks. The "new growth in frustum" lint catches Silk-style out-of-frame looks. |
| "Everything optional via toggles/sliders" | Every feature ships a def with an enable toggle. Nothing is hidden in JS. Search finds any control. |
| "Lightweight on a weak laptop" | Machine scope keeps `budget`, `quality`, `autoQuality`, `tipLimit` and recording resolution local. Presets and Looks never override them. |
| "Versions visible" | `since` badges and "New in 0.20" filter; docs changelog generated |
| "Single-file offline" | Schema, Looks and docs are bundled via eager glob. No runtime fetch. The URL hash carries full state for OBS without depending on localStorage. |
| "Recordings open everywhere" | Recording settings become persisted machine-scope defs, plus a one-click "Editor MP4" intent. The encoder fix itself is in the recording reports. |
