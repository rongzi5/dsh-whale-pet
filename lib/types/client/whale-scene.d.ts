/**
 * whale-scene.ts
 *
 * Procedural killer-whale ("DeepSeek logo" whale) 3D scene for the ui-whale-pet
 * browser plugin. The geometry, shading and animation are ported faithfully
 * from `deepseek_html_20260814_79b0ff.html` (original demo) and the corrected
 * runtime `vendor/whale-pet-runtime.html`:
 *
 *  - swept body built from the logo SVG contour (Catmull-Rom resampled)
 *  - blue/white body mask via a half-float mid/radius lookup texture
 *  - brow / eye patches mapped onto the body surface (mirrored pair)
 *  - V-shaped tail fluke (mirrored leaf), dorsal fin and pectoral fins
 *  - Box3-centered model inside a `petPivot` group
 *  - camera at (0, 0.8, 11.8) with a transparent WebGL clear
 *
 * The scene is fully driven from the outside: the parent owns the frame loop,
 * input and resizing. `createWhaleScene` never attaches event listeners, never
 * calls requestAnimationFrame and never schedules timers. The swim and motion
 * phases are *integrated* from `deltaSeconds` (never `elapsed * time-varying
 * speed`); only fixed-frequency effects (float, blink, happy pulse) use
 * elapsed time, exactly like the runtime. External pose/shape inputs are
 * low-pass filtered with the runtime's rates.
 *
 * Array reads go through `checkedAt`, which bounds-checks every index and
 * throws loudly on an out-of-range access, so the strict
 * `noUncheckedIndexedAccess` build stays clean without non-null assertions.
 */
import type { WhaleActivity, WhaleToolReaction } from './activity.ts';
declare module 'three' {
    interface Material {
        extensions: {
            derivatives?: boolean | undefined;
            fragDepth?: boolean | undefined;
            drawBuffers?: boolean | undefined;
            shaderTextureLOD?: boolean | undefined;
        };
    }
}
/** Per-frame external pet state supplied by the parent. */
export interface WhaleExternalState {
    /** Pointer is hovering over the pet (also boosts swim frequency). */
    hover: boolean;
    /** Pointer is dragging the pet (squash/stretch deformation). */
    dragging: boolean;
    /** Pet mode: 0 idle, 1 patrol, 3 follow (as in the corrected runtime). */
    mode: number;
    /** Normalized movement speed, 0..1 (drives swim frequency + motion energy). */
    speed: number;
    /** Normalized horizontal motion, -1..1 (steers tail + fins). */
    motionX: number;
    /** Normalized vertical motion, -1..1 (pitches tail + fins). */
    motionY: number;
    /** Target yaw (radians) applied to the pet pivot. */
    yaw: number;
    /** Target pitch (radians) applied to the pet pivot. */
    pitch: number;
    /** Target roll (radians) applied to the pet pivot. */
    roll: number;
    /** Session-driven mood, supplied by the runtime service. */
    activity: WhaleActivity;
    /** Animation personality of the currently running tool. */
    toolReaction: WhaleToolReaction;
}
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
