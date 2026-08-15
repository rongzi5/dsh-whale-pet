/**
 * Procedural killer-whale ("DeepSeek logo" whale) 3D scene factory.
 *
 * The geometry, shading and animation are ported faithfully from the original
 * demo. This module composes the shared config, geometry builders and material
 * factories into a self-contained `WhaleScene` handle; the parent owns the
 * frame loop, input and resizing.
 *
 * The scene is fully driven from the outside: `createWhaleScene` never attaches
 * event listeners, never calls requestAnimationFrame and never schedules
 * timers. The swim and motion phases are *integrated* from `deltaSeconds`
 * (never `elapsed * time-varying speed`); only fixed-frequency effects (float,
 * blink, happy pulse) use elapsed time.
 */
import { type WhaleExternalState } from './animation.ts';
export type { WhaleExternalState } from './animation.ts';
/** Handle returned by {@link createWhaleScene}; the parent drives everything. */
export interface WhaleScene {
    /** Update drawing buffer, pixel ratio and camera aspect. */
    resize(width: number, height: number, dpr: number): void;
    /** Advance the animation by deltaSeconds using the given external state. */
    render(deltaSeconds: number, elapsedSeconds: number, external: WhaleExternalState): void;
    /** Release all GPU resources (geometries, materials, textures, renderer). */
    dispose(): void;
}
export declare function createWhaleScene(canvas: HTMLCanvasElement): WhaleScene;
