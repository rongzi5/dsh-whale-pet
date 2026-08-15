import { IDLE_ACTIVITY, type WhaleActivity } from './activity.ts'

export const PET_WIDTH = 320
export const PET_HEIGHT = 240

const MIN_X = 14
const MIN_Y = 24

type PetMode = 'idle' | 'patrol' | 'dragging' | 'settling' | 'loop'
export type WhaleMotionMode = 0 | 1 | 2 | 3

export interface WhaleMotionFrame {
  x: number
  y: number
  angle: number
  scale: number
  dragging: boolean
  hover: boolean
  mode: WhaleMotionMode
  speed: number
  motionX: number
  motionY: number
  yaw: number
  pitch: number
  roll: number
}

interface EdgeCandidate {
  edge: 'left' | 'right' | 'top' | 'bottom'
  distance: number
}

const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, value))

const blend = (rate: number, dt: number): number => 1 - Math.exp(-rate * dt)

const easeInOut = (value: number): number =>
  value < 0.5 ? 2 * value * value : 1 - Math.pow(-2 * value + 2, 2) / 2

/** Frame-rate-independent screen-space motion for the whale overlay. */
export class WhaleMotionController {
  private width: number
  private height: number
  private x: number
  private y: number
  private vx = 0
  private vy = 0

  private pointerX: number
  private pointerY: number
  private lastPointerX: number
  private lastPointerY: number
  private hasPointer = false

  private dragging = false
  private hovering = false
  private grabX = 0
  private grabY = 0
  private dragTargetX: number
  private dragTargetY: number
  private dragDistance = 0

  private mode: PetMode = 'idle'
  private moveTime = 0
  private moveDuration = 2
  private startX = 0
  private startY = 0
  private targetX = 0
  private targetY = 0
  private moveDx = 0
  private moveDy = 0
  private loopStartAngle = 0
  private loopStartYaw = 0
  private loopDuration = 7
  private depthScale = 1

  private angle = 0
  private angleTarget = 0
  private motionVelocityX = 0
  private motionVelocityY = 0
  private motionDirectionX = 0
  private motionDirectionY = 0
  private motionSpeed = 0

  private nextLook: number
  private lookTime = 0
  private nextPatrol: number
  private desiredYaw = 0
  private desiredPitch = 0
  private activity: WhaleActivity = IDLE_ACTIVITY

  public constructor(
    width = 1280,
    height = 720,
    private readonly random: () => number = Math.random,
  ) {
    this.width = Math.max(PET_WIDTH + 30, width)
    this.height = Math.max(PET_HEIGHT + 46, height)
    this.x = Math.max(MIN_X, this.width - PET_WIDTH - 24)
    this.y = Math.max(MIN_Y, this.height - PET_HEIGHT - 16)
    this.dragTargetX = this.x
    this.dragTargetY = this.y
    this.pointerX = this.width * 0.5
    this.pointerY = this.height * 0.5
    this.lastPointerX = this.pointerX
    this.lastPointerY = this.pointerY
    this.nextLook = 12 + this.random() * 18
    this.nextPatrol = 55 + this.random() * 35
  }

  public resize(width: number, height: number): void {
    this.width = Math.max(PET_WIDTH + 30, width)
    this.height = Math.max(PET_HEIGHT + 46, height)
    this.x = clamp(this.x, MIN_X, this.maxX())
    this.y = clamp(this.y, MIN_Y, this.maxY())
    this.dragTargetX = clamp(this.dragTargetX, MIN_X, this.maxX())
    this.dragTargetY = clamp(this.dragTargetY, MIN_Y, this.maxY())
  }

  /** Move the yaw target along the shortest angular path. */
  private setDesiredYaw(target: number): void {
    let delta = target - this.desiredYaw
    delta = Math.atan2(Math.sin(delta), Math.cos(delta))
    this.desiredYaw += delta
  }

  /** Screen direction to continuous model yaw (0 = facing left, π = facing right). */
  private directionYaw(dx: number, dy: number): number {
    if (Math.hypot(dx, dy) < 0.001) return this.desiredYaw
    return Math.PI - Math.atan2(dy, dx)
  }

  public pointerMove(x: number, y: number): void {
    const dx = x - this.lastPointerX
    const dy = y - this.lastPointerY
    this.pointerX = x
    this.pointerY = y
    this.hasPointer = true
    if (this.dragging) {
      this.dragTargetX = clamp(x - this.grabX, MIN_X, this.maxX())
      this.dragTargetY = clamp(y - this.grabY, MIN_Y, this.maxY())
      this.dragDistance += Math.hypot(dx, dy)
    }
    this.lastPointerX = x
    this.lastPointerY = y
  }

  public beginDrag(pointerX: number, pointerY: number): void {
    this.dragging = true
    this.hovering = true
    this.mode = 'dragging'
    this.vx = 0
    this.vy = 0
    this.grabX = pointerX - this.x
    this.grabY = pointerY - this.y
    this.dragTargetX = this.x
    this.dragTargetY = this.y
    this.pointerX = pointerX
    this.pointerY = pointerY
    this.lastPointerX = pointerX
    this.lastPointerY = pointerY
    this.hasPointer = true
    this.dragDistance = 0
  }

  public releaseDrag(): boolean {
    if (!this.dragging) return false
    this.dragging = false
    this.hovering = false
    this.mode = 'settling'
    this.moveTime = 0
    this.vx = this.motionVelocityX * 0.45
    this.vy = this.motionVelocityY * 0.45
    this.nextPatrol = 55 + this.random() * 35
    this.nextLook = 12 + this.random() * 18
    return true
  }

  public setHover(hovering: boolean): void {
    if (!hovering && this.dragging) return
    this.hovering = hovering
    if (!hovering) return
    this.lookTime = 0
    if (this.mode === 'patrol') {
      this.mode = 'settling'
      this.moveTime = 0
      this.vx = this.motionVelocityX * 0.35
      this.vy = this.motionVelocityY * 0.35
    }
  }

  /** Update the session-driven mood. */
  public setActivity(activity: WhaleActivity): void {
    const previous = this.activity.mood
    this.activity = activity
    const activeNow = activity.mood === 'thinking' || activity.mood === 'working' || activity.mood === 'focused' || activity.mood === 'celebrating'
    const activeBefore = previous === 'thinking' || previous === 'working' || previous === 'focused' || previous === 'celebrating'

    if (activeNow && !activeBefore && this.mode !== 'dragging' && this.mode !== 'patrol') {
      // Wake the pet and start a short patrol soon so session activity is
      // visible instead of only changing the in-place swim frequency.
      this.mode = 'idle'
      this.moveTime = 0
      this.vx = 0
      this.vy = 0
      this.nextPatrol = 0.35 + this.random() * 0.4
      this.lookTime = Math.max(this.lookTime, 1.2)
    }

    if (activity.mood === 'sleeping' && (this.mode === 'patrol' || this.mode === 'loop')) {
      this.mode = 'settling'
      this.moveTime = 0
      this.vx = this.motionVelocityX * 0.2
      this.vy = this.motionVelocityY * 0.2
    }
  }

  /** Run one full 360° loop around a wide elliptical path. */
  public celebrate(): void {
    if (this.mode === 'dragging') return
    this.startCelebrationLoop()
  }

  public wasClick(maximumDrag = 7): boolean {
    return this.dragDistance < maximumDrag
  }

  public step(deltaSeconds: number): WhaleMotionFrame {
    const dt = clamp(deltaSeconds, 0.004, 0.04)
    const centerX = this.x + PET_WIDTH * 0.5
    const centerY = this.y + PET_HEIGHT * 0.5
    const beforeX = this.x
    const beforeY = this.y

    if (this.dragging) {
      const follow = blend(22, dt)
      this.x += (this.dragTargetX - this.x) * follow
      this.y += (this.dragTargetY - this.y) * follow
      this.mode = 'dragging'
    } else if (this.mode === 'loop') {
      this.stepLoop(dt)
    } else if (this.mode === 'patrol') {
      this.stepPatrol(dt)
    } else if (this.mode === 'settling') {
      this.stepSettling(dt)
    } else {
      this.angleTarget = 0
      if (this.activity.mood === 'sleeping') {
        this.desiredPitch *= Math.exp(-2.5 * dt)
      } else {
        this.desiredPitch *= Math.exp(-7 * dt)
        if (!this.hovering) {
          const activePace = this.activity.mood === 'thinking' || this.activity.mood === 'working' || this.activity.mood === 'focused'
            ? 2.5
            : this.activity.mood === 'celebrating'
              ? 4
              : 1
          this.nextLook -= dt * activePace
          this.nextPatrol -= dt * activePace
          if (this.nextLook <= 0) {
            this.lookTime = 2.4 + this.random() * 2.2
            this.nextLook = 13 + this.random() * 20
          }
          if (this.nextPatrol <= 0) this.beginPatrol()
        }
      }
    }

    const rawVelocityX = (this.x - beforeX) / dt
    const rawVelocityY = (this.y - beforeY) / dt
    const velocityMix = blend(12, dt)
    this.motionVelocityX += (rawVelocityX - this.motionVelocityX) * velocityMix
    this.motionVelocityY += (rawVelocityY - this.motionVelocityY) * velocityMix
    const velocityMagnitude = Math.hypot(this.motionVelocityX, this.motionVelocityY)
    const targetSpeed = clamp(velocityMagnitude / 120, 0, 1)
    this.motionSpeed += (targetSpeed - this.motionSpeed) * blend(
      targetSpeed > this.motionSpeed ? 10 : 7,
      dt,
    )

    let targetDirectionX = this.motionDirectionX
    let targetDirectionY = this.motionDirectionY
    if (this.mode === 'patrol') {
      const pathLength = Math.max(1, Math.hypot(this.moveDx, this.moveDy))
      targetDirectionX = this.moveDx / pathLength
      targetDirectionY = this.moveDy / pathLength
    } else if (velocityMagnitude > 2) {
      targetDirectionX = this.motionVelocityX / velocityMagnitude
      targetDirectionY = this.motionVelocityY / velocityMagnitude
    }
    const directionMix = blend(8, dt)
    this.motionDirectionX += (targetDirectionX - this.motionDirectionX) * directionMix
    this.motionDirectionY += (targetDirectionY - this.motionDirectionY) * directionMix
    const directionLength = Math.hypot(this.motionDirectionX, this.motionDirectionY)
    if (directionLength > 0.001) {
      this.motionDirectionX /= directionLength
      this.motionDirectionY /= directionLength
    }

    if (this.dragging) {
      if (this.motionSpeed > 0.04 && directionLength > 0.12) {
        this.setDesiredYaw(this.directionYaw(this.motionDirectionX, this.motionDirectionY))
      }
      const pitchTarget = clamp(-this.motionDirectionY * this.motionSpeed * 0.28, -0.28, 0.28)
      this.desiredPitch += (pitchTarget - this.desiredPitch) * blend(9, dt)
      this.angleTarget = clamp(this.motionDirectionY * this.motionSpeed * 10, -10, 10)
    }

    if (!this.dragging && this.mode !== 'patrol' && this.mode !== 'loop') {
      const mood = this.activity.mood
      const sessionFocused = mood === 'thinking' || mood === 'working' || mood === 'focused'
      if (this.hovering || this.lookTime > 0) {
        this.setDesiredYaw(this.directionYaw(this.pointerX - centerX, this.pointerY - centerY))
        const lookPitch = clamp((this.pointerY - centerY) / PET_HEIGHT * 0.2, -0.2, 0.2)
        this.desiredPitch += (lookPitch - this.desiredPitch) * blend(7, dt)
        if (this.lookTime > 0) this.lookTime -= dt
      } else if (sessionFocused && this.activity.mood !== 'sleeping') {
        // Look toward the bottom-center input area while the agent is active.
        const inputX = this.width * 0.5
        const inputY = this.height * 0.88
        this.setDesiredYaw(this.directionYaw(inputX - centerX, inputY - centerY))
        const lookPitch = clamp((inputY - centerY) / PET_HEIGHT * 0.25, -0.25, 0.25)
        this.desiredPitch += (lookPitch - this.desiredPitch) * blend(6, dt)
      } else {
        this.setDesiredYaw(this.restingYaw())
      }
    }

    this.angle += (this.angleTarget - this.angle) * blend(10, dt)
    return this.frame()
  }

  private stepPatrol(dt: number): void {
    this.moveTime += dt
    const progress = clamp(this.moveTime / this.moveDuration, 0, 1)
    const eased = easeInOut(progress)
    const length = Math.max(1, Math.hypot(this.moveDx, this.moveDy))
    const nx = this.moveDx / length
    const ny = this.moveDy / length
    const envelope = Math.sin(Math.PI * progress)
    const wriggle = Math.sin(progress * Math.PI * 6) * envelope * 5
    this.x = this.startX + this.moveDx * eased - ny * wriggle
    this.y = this.startY + this.moveDy * eased + nx * wriggle
    this.angleTarget = clamp(ny * 8 + Math.sin(progress * Math.PI * 6) * envelope * 3, -11, 11)
    if (length > 4) this.setDesiredYaw(this.directionYaw(nx, ny))
    this.desiredPitch = clamp(-ny * 0.18, -0.22, 0.22)
    if (progress < 1) return
    this.x = this.targetX
    this.y = this.targetY
    this.mode = 'settling'
    this.moveTime = 0
    this.vx = 0
    this.vy = 0
    this.angleTarget = 0
    const active = this.activity.mood === 'thinking' || this.activity.mood === 'working' || this.activity.mood === 'focused' || this.activity.mood === 'celebrating'
    this.nextPatrol = active ? 5 + this.random() * 5 : 45 + this.random() * 45
  }

  private stepSettling(dt: number): void {
    this.moveTime += dt
    this.x = clamp(this.x + this.vx * dt, MIN_X, this.maxX())
    this.y = clamp(this.y + this.vy * dt, MIN_Y, this.maxY())
    const decay = Math.exp(-10 * dt)
    this.vx *= decay
    this.vy *= decay
    this.angleTarget = 0
    this.desiredPitch *= Math.exp(-7 * dt)
    if (this.moveTime < 0.8 && Math.hypot(this.vx, this.vy) >= 0.4) return
    this.mode = 'idle'
    this.moveTime = 0
    this.vx = 0
    this.vy = 0
  }

  private startCelebrationLoop(): void {
    const baseX = this.loopBaseX()
    const baseY = this.loopBaseY()
    this.loopStartAngle = Math.atan2(this.y - baseY, this.x - baseX)
    // The tangent of the CCW ellipse is startAngle + π/2; yaw = π - tangent,
    // so the model starts facing the actual swimming direction.
    this.loopStartYaw = Math.PI / 2 - this.loopStartAngle
    this.loopDuration = 6.5 + this.random() * 1.0
    this.moveTime = 0
    this.mode = 'loop'
    this.lookTime = this.loopDuration + 0.5
  }

  private stepLoop(dt: number): void {
    this.moveTime += dt
    const progress = clamp(this.moveTime / this.loopDuration, 0, 1)
    const eased = easeInOut(progress)
    const angle = this.loopStartAngle + eased * Math.PI * 2
    const radiusX = this.loopRadiusX()
    const radiusY = this.loopRadiusY()
    const baseX = this.loopBaseX()
    const baseY = this.loopBaseY()
    this.x = clamp(baseX + Math.cos(angle) * radiusX, MIN_X, this.maxX())
    this.y = clamp(baseY + Math.sin(angle) * radiusY, MIN_Y, this.maxY())

    // Face the tangent direction continuously: the model yaw unwinds by a
    // full 2π over the loop instead of snapping between left and right.
    this.desiredYaw = this.loopStartYaw - eased * Math.PI * 2
    const tangentX = -Math.sin(angle) * radiusX
    const tangentY = Math.cos(angle) * radiusY
    this.desiredPitch = clamp(-tangentY / Math.max(1, radiusY) * 0.22, -0.22, 0.22)
    this.angleTarget = clamp(tangentY / Math.max(1, radiusY) * 10, -10, 10)

    // Screen-space depth: the bottom (near) part of the ellipse is closer
    // and larger, the top (far) part smaller.
    this.depthScale = 0.88 + 0.24 * (0.5 + 0.5 * Math.sin(angle))

    if (progress < 1) return
    this.mode = 'settling'
    this.moveTime = 0
    this.vx = tangentX / this.loopDuration
    this.vy = tangentY / this.loopDuration
    this.angleTarget = 0
    this.nextPatrol = 45 + this.random() * 45
  }

  /** Ellipse center for the celebration loop (pet top-left coordinates). */
  private loopBaseX(): number {
    return Math.max(MIN_X, this.width * 0.5 - PET_WIDTH * 0.5)
  }

  private loopBaseY(): number {
    return Math.max(MIN_Y, this.height * 0.5 - PET_HEIGHT * 0.5)
  }

  private loopRadiusX(): number {
    const half = Math.max(0, (this.width - PET_WIDTH) * 0.5 - MIN_X)
    return clamp(this.width * 0.35, Math.min(120, half), Math.max(120, half))
  }

  private loopRadiusY(): number {
    const half = Math.max(0, (this.height - PET_HEIGHT) * 0.5 - MIN_Y)
    return clamp(this.height * 0.35, Math.min(100, half), Math.max(100, half))
  }

  private beginPatrol(): void {
    const edge = this.nearestEdge()
    const travel = 100 + this.random() * 80
    const pointerX = this.hasPointer ? this.pointerX : this.width * 0.5
    const pointerY = this.hasPointer ? this.pointerY : this.height * 0.5
    let ax = this.x
    let ay = this.y
    let bx = this.x
    let by = this.y

    if (edge === 'top' || edge === 'bottom') {
      const edgeY = edge === 'top' ? 18 : Math.max(18, this.height - PET_HEIGHT - 14)
      ax = clamp(this.x - travel, MIN_X, this.maxX())
      bx = clamp(this.x + travel, MIN_X, this.maxX())
      ay = edgeY
      by = edgeY
    } else {
      const edgeX = edge === 'left' ? MIN_X : this.maxX()
      ay = clamp(this.y - travel, MIN_Y, this.maxY())
      by = clamp(this.y + travel, MIN_Y, this.maxY())
      ax = edgeX
      bx = edgeX
    }

    const distanceA = Math.hypot(ax + PET_WIDTH * 0.5 - pointerX, ay + PET_HEIGHT * 0.5 - pointerY)
    const distanceB = Math.hypot(bx + PET_WIDTH * 0.5 - pointerX, by + PET_HEIGHT * 0.5 - pointerY)
    this.startX = this.x
    this.startY = this.y
    this.targetX = distanceA >= distanceB ? ax : bx
    this.targetY = distanceA >= distanceB ? ay : by
    this.moveDx = this.targetX - this.startX
    this.moveDy = this.targetY - this.startY
    if (Math.abs(this.moveDx) + Math.abs(this.moveDy) < 32) {
      this.targetX = distanceA >= distanceB ? bx : ax
      this.targetY = distanceA >= distanceB ? by : ay
      this.moveDx = this.targetX - this.startX
      this.moveDy = this.targetY - this.startY
    }
    this.moveTime = 0
    this.moveDuration = 1.9 + this.random() * 0.6
    this.mode = 'patrol'
    this.lookTime = this.moveDuration + 0.5
  }

  private nearestEdge(): EdgeCandidate['edge'] {
    const candidates: EdgeCandidate[] = [
      { edge: 'left', distance: this.x },
      { edge: 'right', distance: this.width - this.x - PET_WIDTH },
      { edge: 'top', distance: this.y },
      { edge: 'bottom', distance: this.height - this.y - PET_HEIGHT },
    ]
    const [first, ...rest] = candidates
    if (first === undefined) throw new Error('edge candidate list must not be empty')
    let best = first
    for (const candidate of rest) {
      if (candidate.distance < best.distance) best = candidate
    }
    return best.edge
  }

  private restingYaw(): number {
    const edge = this.nearestEdge()
    if (edge === 'right') return 0
    if (edge === 'left') return Math.PI
    return this.x + PET_WIDTH * 0.5 > this.width * 0.5 ? 0 : Math.PI
  }

  private maxX(): number {
    return Math.max(MIN_X, this.width - PET_WIDTH - 14)
  }

  private maxY(): number {
    return Math.max(MIN_Y, this.height - PET_HEIGHT - 14)
  }

  private frame(): WhaleMotionFrame {
    let mode: WhaleMotionMode = 0
    if (this.dragging) mode = 2
    else if (this.mode === 'patrol' || this.mode === 'loop') mode = 1
    else if (this.mode === 'settling') mode = 3
    return {
      x: this.x,
      y: this.y,
      angle: this.angle,
      scale: this.mode === 'loop' ? this.depthScale : 1,
      dragging: this.dragging,
      hover: this.hovering,
      mode,
      speed: this.motionSpeed,
      motionX: this.motionDirectionX,
      motionY: this.motionDirectionY,
      yaw: this.desiredYaw,
      pitch: this.desiredPitch,
      roll: clamp(this.angle * Math.PI / 180 * 0.65, -0.2, 0.2),
    }
  }
}
