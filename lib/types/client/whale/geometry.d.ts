/**
 * Pure geometry helpers for the procedural whale scene.
 *
 * Everything in this module is deterministic and side-effect free: it turns
 * SVG contours and numeric profiles into Three.js BufferGeometry. Scene
 * construction and animation live elsewhere so the heavy math can be tested
 * and tuned in isolation.
 */
import * as THREE from 'three';
export interface Pt {
    x: number;
    y: number;
}
export interface FinPt {
    x: number;
    z: number;
}
/** Per-slice body profile: x stations plus mid/radius curves (unscaled). */
export interface SweptData {
    xs: number[];
    mid: number[];
    rad: number[];
}
/**
 * Index into any array-like (plain arrays and typed arrays alike) with a loud
 * out-of-range failure. Satisfies `noUncheckedIndexedAccess` without non-null
 * assertions and surfaces a corrupt profile/fin array at the point of access
 * instead of silently producing NaN geometry.
 */
export declare function checkedAt<T>(array: ArrayLike<T>, index: number): T;
export declare function smoothstep(edge0: number, edge1: number, x: number): number;
/** Sample an SVG path (M/L/C commands only) densely. */
export declare function samplePath(d: string, stepsPerSegment: number): Pt[];
/** Arc-length re-sampling with centripetal-ish Catmull-Rom interpolation. */
export declare function catmullRomResample(points: Pt[], targetCount: number, closed: boolean): Pt[];
export declare function smoothGaussian(arr: number[], sigma: number, iterations: number): number[];
export declare function toHalfFloat(val: number): number;
export declare function removeDents(arr: number[], window: number): number[];
/** Swept body result: geometry plus the unscaled per-slice profile. */
export interface SweptBody {
    geometry: THREE.BufferGeometry;
    profile: SweptData;
}
/** Build the swept body geometry and its per-slice profile. */
export declare function buildSwept(poly: Pt[], nSlices: number, nRings: number): SweptBody;
export declare function requireBox(geometry: THREE.BufferGeometry): THREE.Box3;
/** Map an SVG-space point onto the swept body surface (with a lift offset). */
export declare function mapBrowToSurface(p: Pt, body: SweptData, cx: number, cy: number): {
    x: number;
    y: number;
    z: number;
};
/** Flat patch (brow or eye) triangulated in mapped space, wrapped on the surface. */
export declare function buildSurfacePatch(points: Pt[], swept: SweptData, scale: number, cx: number, cy: number, flip: boolean): THREE.BufferGeometry;
/** Split a closed fin outline into the left half (used for the mirrored fluke). */
export declare function extractLeftHalf(pts: FinPt[]): FinPt[] | null;
/** Thin double-sided leaf geometry from a closed 2D outline (x/z plane). */
export declare function buildLeafGeometry(contour2D: FinPt[], thickness: number): THREE.BufferGeometry;
/** Extrude a 2D polygon along a local (axisX, axisY) basis with given thickness. */
export declare function extrudePolygon3D(points2D: Pt[], thickness: number, origin: THREE.Vector3, axisX: THREE.Vector3, axisY: THREE.Vector3): THREE.BufferGeometry;
/** Surface point at a fractional length along the body (scaled coordinates). */
export declare function backSurfaceAt(frac: number, body: SweptData, scale: number): {
    x: number;
    top: number;
    mid: number;
    rad: number;
};
