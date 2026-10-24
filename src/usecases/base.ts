import type { ComponentType, LazyExoticComponent } from 'react';
import type { UseCaseDescriptor } from '@aicoe/aihub-platform/usecases';

/**
 * The use-case contract.
 *
 * A vertical declares itself once, in its own `manifest.ts`, and the shell
 * derives the rest: its routes, its role gate and its hub tile. Adding a
 * vertical is a new folder under `src/usecases/` — no edits to the router,
 * the hub or the auth types.
 *
 * Every route component is lazy so a vertical's code is a separate chunk;
 * with 20+ verticals an eager bundle would ship all of them on first paint.
 */
export interface UseCaseRoute {
  /** Path relative to the app root, e.g. `naas/agents/:agentId`. */
  path: string;
  component: LazyExoticComponent<ComponentType>;
  /**
   * Extra roles required on top of the use case's own, for a surface that is
   * more privileged than the rest of the vertical (e.g. a NaaS admin panel).
   */
  roles?: readonly string[];
  /** Identifies the surface in the `/denied` message. Defaults to the slug. */
  deniedAs?: string;
}

export interface UseCaseManifest extends UseCaseDescriptor {
  routes: readonly UseCaseRoute[];
}

export type { UseCaseHubTile } from '@aicoe/aihub-platform/usecases';
