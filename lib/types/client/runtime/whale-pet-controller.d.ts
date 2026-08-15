/**
 * Whale pet runtime controller.
 *
 * Owns everything that used to live inside the `WhalePet` React effect:
 * the Three.js scene, the motion controller, resize/pointer listeners and
 * the render loop. The React component keeps only refs, view state (heart
 * burst, error message) and input handlers; it delegates state changes to
 * this controller and receives renderer failures through `hooks.onError`.
 *
 * The split is deliberate: future features (sleep tiers, settings,
 * persistence, session-driven emotions) extend the controller without
 * touching the view, while the view remains a thin overlay shell.
 */
import { type WhaleActivity } from '../activity.ts';
import { WhaleMotionController } from '../motion.ts';
/** DOM handles the view lends to the runtime for the lifetime of one mount. */
export interface WhalePetTargets {
    root: HTMLDivElement;
    pet: HTMLDivElement;
    canvas: HTMLCanvasElement;
    shadow: HTMLSpanElement;
}
export interface WhalePetControllerHooks {
    /** Called when the Three.js scene cannot be created or rendered. */
    onError(message: string): void;
}
export declare class WhalePetController {
    private readonly motion;
    private scene;
    private scheduler;
    private targets;
    private hooks;
    private doc;
    private browser;
    private currentDpr;
    private activity;
    private lastYaw;
    constructor(motion?: WhaleMotionController);
    /**
     * Mount the runtime onto the view's DOM handles. Idempotent: a repeated
     * call after a previous start disposes the previous mount first, which
     * keeps React StrictMode's simulated remount using the same controller
     * instance (and therefore the same motion position) as before.
     * @returns whether the runtime mounted; false means no browser surface or
     * the WebGL scene failed, matching the original component's early return.
     */
    start(targets: WhalePetTargets, hooks: WhalePetControllerHooks): boolean;
    /**
     * Unwind the current mount: stop the frame chain, detach listeners and
     * release the WebGL scene. The motion controller intentionally survives so
     * a remount keeps the pet's position, exactly like the original view's
     * persistent `motionRef`.
     */
    dispose(): void;
    /** Expose the motion controller so the view can drive hover and drag. */
    get motionController(): WhaleMotionController;
    /** Pointer hover edge transitions; delegates straight to the motion controller. */
    setHover(hovering: boolean): void;
    /** Start a drag from viewport coordinates. */
    beginDrag(pointerX: number, pointerY: number): void;
    /** Update the pointer position (both hover look and drag follow). */
    pointerMove(pointerX: number, pointerY: number): void;
    /** End a drag; returns whether the controller was actually dragging. */
    releaseDrag(): boolean;
    /** Whether the last drag stayed below the click threshold. */
    wasClick(maximumDrag?: number): boolean;
    /** Update the session-driven mood before the next rendered frame. */
    setActivity(activity: WhaleActivity): void;
    /** Run the motion layer's longer celebration lap. */
    celebrate(): void;
    /** Latest rendered model yaw; used to anchor effects like bubbles. */
    get currentYaw(): number;
    private readonly resize;
    private readonly handlePointerMove;
    private readonly handleRelease;
    private readonly render;
}
