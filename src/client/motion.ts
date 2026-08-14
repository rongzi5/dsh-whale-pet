export const PET_WIDTH = 320
export const PET_HEIGHT = 240

const MIN_X = 14
const MIN_Y = 24

type PetMode = 'idle' | 'patrol' | 'dragging' | 'settling'
export type WhaleMotionMode = 0 | 1 | 2 | 3

export interface WhaleMotionFrame {
  x: number
  y: number
  angle: number
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
    } else if (this.mode === 'patrol') {
      this.stepPatrol(dt)
    } else if (this.mode === 'settling') {
      this.stepSettling(dt)
    } else {
      this.angleTarget = 0
      this.desiredPitch *= Math.exp(-7 * dt)
      if (!this.hovering) {
        this.nextLook -= dt
        this.nextPatrol -= dt
        if (this.nextLook <= 0) {
          this.lookTime = 2.4 + this.random() * 2.2
          this.nextLook = 13 + this.random() * 20
        }
        if (this.nextPatrol <= 0) this.beginPatrol()
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
      if (this.motionSpeed > 0.04 && Math.abs(this.motionDirectionX) > 0.12) {
        this.desiredYaw = this.motionDirectionX < 0 ? 0 : Math.PI
      }
      const pitchTarget = clamp(-this.motionDirectionY * this.motionSpeed * 0.28, -0.28, 0.28)
      this.desiredPitch += (pitchTarget - this.desiredPitch) * blend(9, dt)
      this.angleTarget = clamp(this.motionDirectionY * this.motionSpeed * 10, -10, 10)
    }

    if (!this.dragging && this.mode !== 'patrol') {
      if (this.hovering || this.lookTime > 0) {
        this.desiredYaw = this.pointerX - centerX < 0 ? 0 : Math.PI
        const lookPitch = clamp((this.pointerY - centerY) / PET_HEIGHT * 0.2, -0.2, 0.2)
        this.desiredPitch += (lookPitch - this.desiredPitch) * blend(7, dt)
        if (this.lookTime > 0) this.lookTime -= dt
      } else {
        this.desiredYaw = this.restingYaw()
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
    if (Math.abs(this.moveDx) > 4) this.desiredYaw = this.moveDx < 0 ? 0 : Math.PI
    this.desiredPitch = clamp(-ny * 0.18, -0.22, 0.22)
    if (progress < 1) return
    this.x = this.targetX
    this.y = this.targetY
    this.mode = 'settling'
    this.moveTime = 0
    this.vx = 0
    this.vy = 0
    this.angleTarget = 0
    this.nextPatrol = 45 + this.random() * 45
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
    else if (this.mode === 'patrol') mode = 1
    else if (this.mode === 'settling') mode = 3
    return {
      x: this.x,
      y: this.y,
      angle: this.angle,
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
