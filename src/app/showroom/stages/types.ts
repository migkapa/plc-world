import type { ComponentType } from 'react';
import type { DemoControl, DemoStore, DemoValue } from '../demo';

/** How one showroom device is staged in 3D and which demo controls drive it. */
export interface StageDef {
  /** Initial demo values (a fresh store is created every time the device is opened). */
  defaults: Record<string, DemoValue>;
  controls: DemoControl[];
  /** 3D content (inside the SceneCanvas). */
  Scene: ComponentType<{ demo: DemoStore }>;
  /** Floor height (m), or false for no floor (wall-mounted panel devices bring their own backplate). */
  floor?: number | false;
}
