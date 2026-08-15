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

import { IDLE_ACTIVITY, type WhaleActivity, type WhaleToolReaction } from '../activity.ts'
import { PET_HEIGHT, PET_WIDTH, WhaleMotionController } from '../motion.ts'
import { createWhaleScene, type WhaleScene } from '../whale-scene.ts'
import { WhaleRenderScheduler, type WhaleTick } from './scheduler.ts'

const RENDER_ERROR_MESSAGE = '3D 模型不可用'

const formatTransform = (value: number): string => value.toFixed(3)

/** DOM handles the view lends to the runtime for the lifetime of one mount. */
export interface WhalePetTargets {
  root: HTMLDivElement
  pet: HTMLDivElement
  canvas: HTMLCanvasElement
  shadow: HTMLSpanElement
}

export interface WhalePetControllerHooks {
  /** Called when the Three.js scene cannot be created or rendered. */
  onError(message: string): void
  /** Called after a drag release with the pet's final position (px). */
  onRelease?(x: number, y: number): void
}

export class WhalePetController {
  private scene: WhaleScene | null = null
  private scheduler: WhaleRenderScheduler | null = null
  private targets: WhalePetTargets | null = null
  private hooks: WhalePetControllerHooks | null = null
  private doc: Document | null = null
  private browser: Window | null = null
  private currentDpr = 0
  private activity: WhaleActivity = IDLE_ACTIVITY
  private lastYaw = 0
  private hidden = false
  private toolReaction: WhaleToolReaction = 'none'

  public constructor(
    private readonly motion: WhaleMotionController = new WhaleMotionController(),
  ) {}

  /**
   * Mount the runtime onto the view's DOM handles. Idempotent: a repeated
   * call after a previous start disposes the previous mount first, which
   * keeps React StrictMode's simulated remount using the same controller
   * instance (and therefore the same motion position) as before.
   * @returns whether the runtime mounted; false means no browser surface or
   * the WebGL scene failed, matching the original component's early return.
   */
  public start(targets: WhalePetTargets, hooks: WhalePetControllerHooks): boolean {
    if (this.targets !== null) this.dispose()

    const doc = targets.root.ownerDocument
    const browser = doc.defaultView
    if (browser === null) return false

    let scene: WhaleScene
    try {
      scene = createWhaleScene(targets.canvas)
    } catch (cause) {
      console.error('[ui-whale-pet] creating the Three.js scene failed:', cause)
      hooks.onError(RENDER_ERROR_MESSAGE)
      return false
    }

    this.targets = targets
    this.hooks = hooks
    this.doc = doc
    this.browser = browser
    this.scene = scene
    this.scheduler = new WhaleRenderScheduler({
      requestAnimationFrame: callback => browser.requestAnimationFrame(callback),
      cancelAnimationFrame: handle => browser.cancelAnimationFrame(handle),
    })

    this.resize()
    browser.addEventListener('resize', this.resize)
    doc.addEventListener('pointermove', this.handlePointerMove, { passive: true })
    doc.addEventListener('pointerup', this.handleRelease, { passive: true })
    doc.addEventListener('pointercancel', this.handleRelease, { passive: true })
    this.scheduler.start(this.render)
    return true
  }

  /**
   * Unwind the current mount: stop the frame chain, detach listeners and
   * release the WebGL scene. The motion controller intentionally survives so
   * a remount keeps the pet's position, exactly like the original view's
   * persistent `motionRef`.
   */
  public dispose(): void {
    this.scheduler?.stop()
    this.scheduler = null

    const browser = this.browser
    const doc = this.doc
    if (browser !== null && doc !== null) {
      browser.removeEventListener('resize', this.resize)
      doc.removeEventListener('pointermove', this.handlePointerMove)
      doc.removeEventListener('pointerup', this.handleRelease)
      doc.removeEventListener('pointercancel', this.handleRelease)
    }

    this.scene?.dispose()
    this.scene = null
    this.targets = null
    this.hooks = null
    this.browser = null
    this.doc = null
    this.currentDpr = 0
  }

  /** Expose the motion controller so the view can drive hover and drag. */
  public get motionController(): WhaleMotionController {
    return this.motion
  }

  /** Pointer hover edge transitions; delegates straight to the motion controller. */
  public setHover(hovering: boolean): void {
    this.motion.setHover(hovering)
  }

  /** Start a drag from viewport coordinates. */
  public beginDrag(pointerX: number, pointerY: number): void {
    this.motion.beginDrag(pointerX, pointerY)
  }

  /** Update the pointer position (both hover look and drag follow). */
  public pointerMove(pointerX: number, pointerY: number): void {
    this.motion.pointerMove(pointerX, pointerY)
  }

  /** End a drag; returns whether the controller was actually dragging. */
  public releaseDrag(): boolean {
    return this.motion.releaseDrag()
  }

  /** Whether the last drag stayed below the click threshold. */
  public wasClick(maximumDrag = 7): boolean {
    return this.motion.wasClick(maximumDrag)
  }

  /** Update the session-driven mood before the next rendered frame. */
  public setActivity(activity: WhaleActivity): void {
    this.activity = activity
    this.motion.setActivity(activity)
  }

  /** Pause rendering and motion while the pet is hidden. */
  public setHidden(hidden: boolean): void {
    this.hidden = hidden
  }

  /** Animation personality of the currently running tool (service-owned). */
  public setToolReaction(reaction: WhaleToolReaction): void {
    this.toolReaction = reaction
  }

  /** Run the motion layer's longer celebration lap. */
  public celebrate(): void {
    this.motion.celebrate()
  }

  /** Latest rendered model yaw; used to anchor effects like bubbles. */
  public get currentYaw(): number {
    return this.lastYaw
  }

  private readonly resize = (): void => {
    const doc = this.doc
    const browser = this.browser
    if (doc === null || browser === null) return
    const width = Math.max(PET_WIDTH + 30, doc.documentElement.clientWidth || browser.innerWidth)
    const height = Math.max(PET_HEIGHT + 46, doc.documentElement.clientHeight || browser.innerHeight)
    this.motion.resize(width, height)
    const nextDpr = Math.min(2, Math.max(1, browser.devicePixelRatio || 1))
    this.currentDpr = nextDpr
    this.scene?.resize(PET_WIDTH, PET_HEIGHT, nextDpr)
  }

  private readonly handlePointerMove = (event: globalThis.PointerEvent): void => {
    this.motion.pointerMove(event.clientX, event.clientY)
  }

  private readonly handleRelease = (): void => {
    if (this.motion.releaseDrag()) {
      const { x, y } = this.motion.position
      this.hooks?.onRelease?.(x, y)
    }
  }

  private readonly render = (tick: WhaleTick): void => {
    const targets = this.targets
    const scene = this.scene
    const browser = this.browser
    if (targets === null || scene === null || browser === null) return

    const { deltaSeconds: dt, elapsedSeconds: elapsed } = tick
    const nextDpr = Math.min(2, Math.max(1, browser.devicePixelRatio || 1))
    if (nextDpr !== this.currentDpr) {
      this.currentDpr = nextDpr
      scene.resize(PET_WIDTH, PET_HEIGHT, nextDpr)
    }

    // Hidden: freeze motion and rendering; the DOM layer is display:none.
    if (this.hidden) return

    const frame = this.motion.step(dt)
    this.lastYaw = frame.yaw
    targets.pet.style.transform = `translate3d(${formatTransform(frame.x)}px, ${formatTransform(frame.y)}px, 0) rotate(${formatTransform(frame.angle)}deg) scale(${formatTransform(frame.scale)})`
    targets.shadow.style.transform = frame.dragging
      ? 'scale(0.7, 0.62)'
      : `scale(${formatTransform(1 + frame.speed * 0.14)}, ${formatTransform(1 - frame.speed * 0.08)})`
    targets.shadow.style.opacity = frame.dragging ? '0.08' : '0.68'

    try {
      scene.render(dt, elapsed, { ...frame, activity: this.activity, toolReaction: this.toolReaction })
    } catch (cause) {
      console.error('[ui-whale-pet] rendering the Three.js scene failed:', cause)
      this.hooks?.onError(RENDER_ERROR_MESSAGE)
      scene.dispose()
      this.scene = null
      this.scheduler?.stop()
    }
  }
}
