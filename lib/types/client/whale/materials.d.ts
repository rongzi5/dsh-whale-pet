/**
 * Material factories for the procedural whale scene.
 *
 * The body material carries the blue/white logo mask shader; the remaining
 * materials are simple flat-shaded surfaces. Keeping them here keeps
 * `scene.ts` focused on composition and resource lifetime.
 */
import * as THREE from 'three';
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
/** Body material with the blue/white mask driven by the mid/radius texture. */
export declare function createBodyMaterial(mrTex: THREE.DataTexture, bb: THREE.Box3): THREE.MeshBasicMaterial;
/** White brow patch material (double-sided, polygon-offset to avoid z-fight). */
export declare function createBrowMaterial(): THREE.MeshBasicMaterial;
/** White eye material; opacity is animated for blinking/sleep/error states. */
export declare function createEyeMaterial(): THREE.MeshBasicMaterial;
/** Simple flat material for fins and tail. */
export declare function createFinMaterial(color: number): THREE.MeshBasicMaterial;
