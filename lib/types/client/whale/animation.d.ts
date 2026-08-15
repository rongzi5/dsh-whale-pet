/**
 * Pose animation for the procedural whale scene.
 *
 * The animator owns the low-pass filters, integrated swim/motion phases and
 * all per-frame object transforms. It is deliberately independent of the
 * renderer: the scene factory calls `update()` and then issues the WebGL
 * draw itself.
 */
import * as THREE from 'three';
import type { WhaleActivity } from '../activity.ts';
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
}
/** The mutable Three.js objects the animator drives each frame. */
export interface WhaleAnimatorTargets {
    model: THREE.Object3D;
    petPivot: THREE.Group;
    tailGroup: THREE.Group;
    eyeMat: THREE.MeshBasicMaterial;
    eyeGroup: THREE.Group;
    finPivots: {
        pivot: THREE.Group;
        side: number;
    }[];
    petBaseY: number;
}
export declare class WhaleAnimator {
    private readonly targets;
    private readonly f;
    private initialized;
    private swimPhase;
    private motionPhase;
    constructor(targets: WhaleAnimatorTargets);
    /** Advance one frame. `delta` is already clamped by the caller. */
    update(deltaSeconds: number, elapsedSeconds: number, external: WhaleExternalState): void;
}
