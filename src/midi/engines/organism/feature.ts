// Feature seam: a feature module plugs into OrganismEngine through these optional
// hooks instead of editing the engine's frame loop. The engine calls every hook in
// list order; with no features the calls are loops over an empty array.

import type * as THREE from 'three'
import type { WebGPURenderer } from 'three/webgpu'
import type { EngineControl, GlobalParams } from '../../engine'
import type { MusicState } from '../../music'
import type { Plant, Seg } from './types'

/** What a feature may see of the engine. Widen this on purpose rather than reaching into privates. */
export interface OrganismHost {
  readonly controls: EngineControl[]
  readonly scene: THREE.Scene
  /** growth meshes live here (never rotated or scaled: local == world) */
  readonly group: THREE.Group
  readonly camera: THREE.PerspectiveCamera
  readonly renderer: WebGPURenderer | null
  readonly segs: readonly Seg[]
  readonly plants: readonly Plant[]
  /** the direction of travel while the camera flies (camera mode flight), else null */
  readonly travel: THREE.Vector3 | null
}

/** A feature control names its own panel section. */
export type FeatureControl = EngineControl & { group: string }

/**
 * Hooks are optional. Create features per engine instance: their controls are added to
 * the engine's list as-is (the panel and saved settings write into those objects).
 */
export interface OrganismFeature {
  readonly id: string
  readonly controls?: readonly FeatureControl[]
  /** renderer, scene and meshes exist; runs before the first clear() */
  mount?(e: OrganismHost): void
  unmount?(e: OrganismHost): void
  /** Reset / Backspace: the engine wiped its growth and camera */
  clear?(e: OrganismHost): void
  onControl?(key: string, value: number, e: OrganismHost): void
  /** start of frame(), before note events */
  beforeFrame?(m: MusicState, g: GlobalParams, dt: number, t: number, e: OrganismHost): void
  /** after the grow and retract loops, before the mesh counts are updated */
  afterGrowth?(m: MusicState, g: GlobalParams, dt: number, t: number, e: OrganismHost): void
  /** right before rendering (also for snapshots); the token is handed back to afterDraw */
  beforeDraw?(e: OrganismHost): unknown
  /** runs after render even when it throws, in reverse feature order */
  afterDraw?(e: OrganismHost, token: unknown): void
  onSegmentAdded?(seg: Seg, e: OrganismHost): void
  onPlantCreated?(plant: Plant, e: OrganismHost): void
  /** the plant left the engine's list (fully retracted, culled or cleared) */
  onPlantRemoved?(plant: Plant, e: OrganismHost): void
}
