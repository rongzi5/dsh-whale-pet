/**
 * Pose animation for the procedural whale scene.
 *
 * The animator owns the low-pass filters, integrated swim/motion phases and
 * all per-frame object transforms. It is deliberately independent of the
 * renderer: the scene factory calls `update()` and then issues the WebGL
 * draw itself.
 */

import * as THREE from 'three'

import type { WhaleActivity } from '../activity.ts'
import { CFG } from './config.ts'

// Animation tuning constants that are not part of the ported CFG block but
// make the emotional reactions readable without magic numbers inline.
const ERROR_TREMBLE_FREQUENCY = 45
const ERROR_TREMBLE_AMPLITUDE = 0.016
const HOVER_BOB_FREQUENCY = 8
const HOVER_BOB_AMPLITUDE = 0.035
const SLEEP_EYE_OPACITY = 0.12
const SLEEP_EYE_SQUASH_BASE = 0.18
const SLEEP_EYE_SQUASH_AMPLITUDE = 0.06
const SLEEP_EYE_SQUASH_FREQUENCY = 1.1
const ERROR_EYE_STARTLE_BASE = 1
const ERROR_EYE_STARTLE_PER_INTENSITY = 0.32
const DIZZY_FLIP_RADIANS = Math.PI
const DIZZY_WOBBLE_FREQUENCY = 3.8
const DIZZY_WOBBLE_AMPLITUDE = 0.12

/** Per-frame external pet state supplied by the parent. */
export interface WhaleExternalState {
  /** Pointer is hovering over the pet (also boosts swim frequency). */
  hover: boolean
  /** Pointer is dragging the pet (squash/stretch deformation). */
  dragging: boolean
  /** Pet mode: 0 idle, 1 patrol, 3 follow (as in the corrected runtime). */
  mode: number
  /** Normalized movement speed, 0..1 (drives swim frequency + motion energy). */
  speed: number
  /** Normalized horizontal motion, -1..1 (steers tail + fins). */
  motionX: number
  /** Normalized vertical motion, -1..1 (pitches tail + fins). */
  motionY: number
  /** Target yaw (radians) applied to the pet pivot. */
  yaw: number
  /** Target pitch (radians) applied to the pet pivot. */
  pitch: number
  /** Target roll (radians) applied to the pet pivot. */
  roll: number
  /** Session-driven mood, supplied by the runtime service. */
  activity: WhaleActivity
}

/** The mutable Three.js objects the animator drives each frame. */
export interface WhaleAnimatorTargets {
  model: THREE.Object3D
  petPivot: THREE.Group
  tailGroup: THREE.Group
  eyeMat: THREE.MeshBasicMaterial
  eyeGroup: THREE.Group
  finPivots: { pivot: THREE.Group; side: number }[]
  petBaseY: number
}

export class WhaleAnimator {
  private readonly f = { speed: 0, motionX: 0, motionY: 0, patrolLevel: 0, dragLevel: 0, dizzyLevel: 0, yaw: 0, pitch: 0, roll: 0 }
  private initialized = false
  private swimPhase = 0
  private motionPhase = 0

  public constructor(private readonly targets: WhaleAnimatorTargets) {}

  /** Advance one frame. `delta` is already clamped by the caller. */
  public update(deltaSeconds: number, elapsedSeconds: number, external: WhaleExternalState): void {
    const delta = Math.min(Math.max(deltaSeconds, 0), 0.1)
    const hover = external.hover ? 1 : 0
    const mode = external.mode
    const mood = external.activity.mood
    const intensity = Math.min(1, Math.max(0, external.activity.intensity))
    const speedTarget = Math.min(1, Math.max(0, external.speed))
    const motionXTarget = Math.min(1, Math.max(-1, external.motionX))
    const motionYTarget = Math.min(1, Math.max(-1, external.motionY))

    const { model, petPivot, tailGroup, eyeMat, eyeGroup, finPivots, petBaseY } = this.targets

    // low-pass filters (exact runtime rates); snap on the first frame so the
    // pet does not lunge from a zero-initialized state on mount
    if (!this.initialized) {
      this.f.speed = speedTarget
      this.f.motionX = motionXTarget
      this.f.motionY = motionYTarget
      this.f.patrolLevel = mode === 1 ? 1 : 0
      this.f.dragLevel = external.dragging ? 1 : 0
      this.f.dizzyLevel = mood === 'dizzy' ? 1 : 0
      this.f.yaw = external.yaw
      this.f.pitch = external.pitch
      this.f.roll = external.roll
      this.initialized = true
    } else {
      this.f.speed += (speedTarget - this.f.speed) * (1 - Math.exp(-(speedTarget > this.f.speed ? 10 : 6) * delta))
      const directionBlend = 1 - Math.exp(-8 * delta)
      this.f.motionX += (motionXTarget - this.f.motionX) * directionBlend
      this.f.motionY += (motionYTarget - this.f.motionY) * directionBlend
      this.f.patrolLevel += ((mode === 1 ? 1 : 0) - this.f.patrolLevel) * (1 - Math.exp(-7 * delta))
      this.f.dragLevel += ((external.dragging ? 1 : 0) - this.f.dragLevel) * (1 - Math.exp(-9 * delta))
      this.f.dizzyLevel += ((mood === 'dizzy' ? 1 : 0) - this.f.dizzyLevel) * (1 - Math.exp(-5 * delta))
    }

    // effective swim frequency; the phase is INTEGRATED (never elapsed * speed)
    const swimBoost = mood === 'sleeping'
      ? 0.3
      : mood === 'dizzy'
        ? 0.18
        : mood === 'thinking'
        ? 1.2
        : mood === 'working'
          ? 1.35 + 0.2 * intensity
          : mood === 'focused'
            ? 1.5 + 0.25 * intensity
            : mood === 'celebrating'
              ? 1.7
              : mood === 'listening' || mood === 'awaiting'
                ? 0.85
                : 1
    let swimSpeed = CFG.SWIM_SPEED * (1 + this.f.speed * 1.55)
    if (hover > 0.5) swimSpeed *= CFG.HOVER_SWIM_BOOST
    swimSpeed *= swimBoost
    this.swimPhase += swimSpeed * Math.PI * 2 * delta

    const t = elapsedSeconds
    const bodyAmp = CFG.BODY_SWAY_AMPLITUDE * (
      mood === 'sleeping' ? 0.35
        : mood === 'dizzy' ? 0.2
          : mood === 'working' || mood === 'focused' ? 1.25
          : mood === 'celebrating' ? 1.4
            : mood === 'listening' || mood === 'awaiting' ? 0.8
              : 1
    )
    const pitchAmp = CFG.PITCH_AMPLITUDE * (mood === 'sleeping' ? 0.4 : 1)
    const rollAmp = CFG.ROLL_AMPLITUDE * (mood === 'sleeping' ? 0.5 : 1)
    const bodySway = Math.sin(this.swimPhase) * bodyAmp
    const pitchSway = Math.sin(this.swimPhase + 0.8) * pitchAmp
    const rollSway = Math.sin(this.swimPhase * 0.55 + 0.3) * rollAmp

    // filtered external pose (yaw/pitch/roll)
    const poseBlend = 1 - Math.exp(-7 * delta)
    this.f.yaw += (external.yaw - this.f.yaw) * poseBlend
    this.f.pitch += (external.pitch - this.f.pitch) * poseBlend
    this.f.roll += (external.roll - this.f.roll) * (1 - Math.exp(-9 * delta))

    // movement-driven motion energy (patrol / drag / follow)
    const patrolEnergy = this.f.patrolLevel * this.f.speed
    const dragEnergy = this.f.dragLevel * this.f.speed
    const residualEnergy = mode === 3 ? this.f.speed * 0.6 : 0
    const motionEnergy = Math.max(patrolEnergy, dragEnergy, residualEnergy)
    this.motionPhase += (8 + motionEnergy * 10) * delta
    const motionWave = Math.sin(this.motionPhase)
    const motionWave2 = Math.cos(this.motionPhase * 0.82 + 0.35)
    const motionBounce = 0.5 - 0.5 * Math.cos(this.motionPhase)
    const celebratePulse = mood === 'celebrating' ? 1 : 0
    const happyPulse = Math.max(hover, celebratePulse) * (0.5 + 0.5 * Math.sin(t * HOVER_BOB_FREQUENCY))

    // swim pose on the body
    model.rotation.y = bodySway + motionWave * patrolEnergy * 0.06
    model.rotation.x = pitchSway - this.f.motionY * motionEnergy * 0.1 + motionWave2 * patrolEnergy * 0.04
    model.rotation.z = rollSway + motionWave * patrolEnergy * 0.035

    // Pivot pose, bounce and squash/stretch. Dizziness rolls around the
    // longitudinal body axis so the existing white belly faces the camera.
    const divePitch = mood === 'focused' ? -0.08 * intensity : mood === 'sleeping' ? 0.02 : 0
    const dizzyWobble = Math.sin(t * DIZZY_WOBBLE_FREQUENCY) * DIZZY_WOBBLE_AMPLITUDE * this.f.dizzyLevel
    petPivot.rotation.y = this.f.yaw
    petPivot.rotation.x = this.f.pitch - this.f.motionY * motionEnergy * 0.055 + divePitch + DIZZY_FLIP_RADIANS * this.f.dizzyLevel
    petPivot.rotation.z = this.f.roll + motionWave * motionEnergy * 0.02 + dizzyWobble
    petPivot.position.y = motionBounce * patrolEnergy * 0.07 + motionWave * dragEnergy * 0.018
    // Error: rapid trembling so the reaction cannot be missed.
    petPivot.position.x = mood === 'error' ? Math.sin(t * ERROR_TREMBLE_FREQUENCY) * ERROR_TREMBLE_AMPLITUDE : 0
    petPivot.scale.set(
      1 + dragEnergy * 0.21 + patrolEnergy * (0.04 + motionWave * 0.015) + happyPulse * 0.012,
      1 - dragEnergy * 0.14 - patrolEnergy * (0.022 + motionWave * 0.015) + happyPulse * 0.016,
      1 - dragEnergy * 0.065 + patrolEnergy * motionWave2 * 0.015 + happyPulse * 0.012,
    )

    // tail fluke: swim sway + motion steering + movement waves
    const tailAmpY = CFG.TAIL_SWAY_AMPLITUDE * (mood === 'sleeping' ? 0.35 : mood === 'dizzy' ? 0.16 : mood === 'celebrating' ? 1.4 : 1)
    const tailAmpX = CFG.TAIL_PITCH_AMPLITUDE * (mood === 'sleeping' ? 0.4 : mood === 'dizzy' ? 0.18 : 1)
    const tailSwayY = Math.sin(this.swimPhase + 0.7) * tailAmpY
    const tailSwayX = Math.sin(this.swimPhase + 1.2) * tailAmpX
    tailGroup.rotation.y = tailSwayY - this.f.motionX * motionEnergy * 0.28 + motionWave * patrolEnergy * 0.2 + motionWave * dragEnergy * 0.08
    tailGroup.rotation.x = tailSwayX - this.f.motionY * motionEnergy * 0.42 + motionWave2 * patrolEnergy * 0.25 + motionWave2 * dragEnergy * 0.12
    tailGroup.rotation.z = (CFG.TAIL_TILT_DEG * Math.PI) / 180

    // pectoral fins: flapping + steering
    const pecAmp = CFG.PEC_FLAP_AMPLITUDE * (
      mood === 'sleeping' ? 0.3
        : mood === 'dizzy' ? 0.12
          : mood === 'working' || mood === 'focused' ? 1.3
          : mood === 'listening' || mood === 'awaiting' ? 0.8
            : 1
    )
    const pecFlap = Math.sin(this.swimPhase + CFG.PEC_FLAP_PHASE) * pecAmp
    for (const { pivot, side } of finPivots) {
      pivot.rotation.x = pecFlap + motionWave * patrolEnergy * 0.3 - dragEnergy * 0.52
      pivot.rotation.z = -this.f.motionY * motionEnergy * side * 0.15 + motionWave2 * patrolEnergy * side * 0.1
    }

    // gentle float (fixed frequency) + hover bob + motion bounce
    const floatSpeed = CFG.FLOAT_SPEED * (mood === 'sleeping' ? 0.45 : 1)
    const floatAmp = CFG.FLOAT_AMPLITUDE * (
      mood === 'sleeping' ? 0.4
        : mood === 'celebrating' ? 1.5
          : mood === 'listening' || mood === 'awaiting' ? 0.8
            : 1
    )
    const floatOffset = Math.sin(t * floatSpeed) * floatAmp
    model.position.y =
      petBaseY + floatOffset + hover * Math.sin(t * HOVER_BOB_FREQUENCY) * HOVER_BOB_AMPLITUDE + motionBounce * patrolEnergy * 0.085 + motionWave * dragEnergy * 0.035

    if (mood === 'sleeping') {
      // Persistent closed eyes and a slow sleepy squash.
      eyeMat.opacity = SLEEP_EYE_OPACITY
      eyeGroup.scale.y = SLEEP_EYE_SQUASH_BASE + SLEEP_EYE_SQUASH_AMPLITUDE * Math.sin(t * SLEEP_EYE_SQUASH_FREQUENCY)
      eyeGroup.scale.x = 1.1
      eyeGroup.scale.z = 1.1
    } else if (mood === 'error') {
      // Startled wide-open eyes while the sweat drops pour down.
      const startle = ERROR_EYE_STARTLE_BASE + intensity * ERROR_EYE_STARTLE_PER_INTENSITY
      eyeMat.opacity = 1
      eyeGroup.scale.set(startle, startle, startle)
    } else {
      // blink (fixed interval driven by elapsed time, like the runtime)
      const blinkCycle = t % CFG.BLINK_INTERVAL
      if (blinkCycle < CFG.BLINK_DURATION) {
        const p = blinkCycle / CFG.BLINK_DURATION
        if (p < 0.4) {
          eyeMat.opacity = 1 - p / 0.4
        } else {
          const q = (p - 0.4) / 0.6
          eyeMat.opacity = q * q * (3 - 2 * q)
        }
        const eyeSquash = 1 - Math.sin(Math.min(p, 1) * Math.PI) * 0.35
        eyeGroup.scale.y = eyeSquash
        eyeGroup.scale.x = 1 + (1 - eyeSquash) * 0.3
        eyeGroup.scale.z = 1 + (1 - eyeSquash) * 0.3
      } else {
        eyeMat.opacity = 1.0
        eyeGroup.scale.set(1, 1, 1)
      }
    }
  }
}
