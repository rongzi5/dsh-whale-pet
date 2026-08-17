import { type WhaleActivity } from './activity.ts';
export declare const PET_WIDTH = 320;
export declare const PET_HEIGHT = 240;
export type WhaleMotionMode = 0 | 1 | 2 | 3;
export interface WhaleMotionFrame {
    x: number;
    y: number;
    angle: number;
    scale: number;
    dragging: boolean;
    hover: boolean;
    mode: WhaleMotionMode;
    speed: number;
    motionX: number;
    motionY: number;
    yaw: number;
    pitch: number;
    roll: number;
}
/** Measurements for one completed pointer drag. */
export interface WhaleDragResult {
    durationMs: number;
    distance: number;
    averageSpeed: number;
    cancelled: boolean;
}
/** Frame-rate-independent screen-space motion for the whale overlay. */
export declare class WhaleMotionController {
    private readonly random;
    private width;
    private height;
    private x;
    private y;
    private vx;
    private vy;
    private pointerX;
    private pointerY;
    private lastPointerX;
    private lastPointerY;
    private hasPointer;
    private dragging;
    private hovering;
    private grabX;
    private grabY;
    private dragTargetX;
    private dragTargetY;
    private dragDistance;
    private dragStartedAt;
    private lastDragResult;
    private mode;
    private moveTime;
    private moveDuration;
    private startX;
    private startY;
    private targetX;
    private targetY;
    private moveDx;
    private moveDy;
    private loopStartAngle;
    private loopStartYaw;
    private loopDuration;
    private depthScale;
    private angle;
    private angleTarget;
    private motionVelocityX;
    private motionVelocityY;
    private motionDirectionX;
    private motionDirectionY;
    private motionSpeed;
    private snapToCorner;
    private settlingToCorner;
    private settleTargetX;
    private settleTargetY;
    private nextLook;
    private lookTime;
    private nextPatrol;
    private desiredYaw;
    private desiredPitch;
    private activity;
    constructor(width?: number, height?: number, random?: () => number);
    resize(width: number, height: number): void;
    /** Move the yaw target along the shortest angular path. */
    private setDesiredYaw;
    /** Screen direction to continuous model yaw (0 = facing left, π = facing right). */
    private directionYaw;
    pointerMove(x: number, y: number): void;
    beginDrag(pointerX: number, pointerY: number, startedAt?: number): void;
    releaseDrag(releasedAt?: number, cancelled?: boolean): boolean;
    /** Return the latest completed drag once, so stale releases cannot retrigger effects. */
    consumeLastDragResult(): WhaleDragResult | null;
    /** Whether released drags glide to the nearest corner. */
    setSnapToCorner(enabled: boolean): void;
    /** Glide to the nearest corner now unless an interaction owns the pose. */
    snapToCornerNow(): void;
    /** Restore a persisted position, clamped to the current viewport. */
    restorePosition(x: number | null, y: number | null): void;
    /** Current pet top-left position (CSS pixels). */
    get position(): {
        x: number;
        y: number;
    };
    private beginCornerSnap;
    private nearestCorner;
    setHover(hovering: boolean): void;
    /** Update the session-driven mood. */
    setActivity(activity: WhaleActivity): void;
    /** Run one longer, full 360° loop; used for long-turn/goal celebrations. */
    celebrate(): void;
    /** Start the next patrol now (exposed for tests and future callers). */
    patrolNow(): void;
    private beginActivePatrol;
    wasClick(maximumDrag?: number): boolean;
    step(deltaSeconds: number): WhaleMotionFrame;
    private stepPatrol;
    private stepSettling;
    private startCelebrationLoop;
    private stepLoop;
    /**
     * After the loop closes, glide horizontally to the nearest edge while
     * keeping the current y, so the celebration ends resting on the edge of
     * the same horizontal line.
     */
    private beginEdgeReturn;
    /** Ellipse center for the celebration loop (pet top-left coordinates). */
    private loopBaseX;
    private loopBaseY;
    private loopRadiusX;
    private loopRadiusY;
    /**
     * Start an edge patrol. Active moods receive a small perpendicular drift
     * so they stay near the boundary but are not pinned to a single line.
     */
    private beginPatrol;
    private nearestEdge;
    private restingYaw;
    private maxX;
    private maxY;
    private frame;
}
