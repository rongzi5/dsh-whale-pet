import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import type { WhaleActivity } from '../src/client/activity.ts'
import { WhaleAnimator, type WhaleExternalState } from '../src/client/whale/animation.ts'

function external(activity: WhaleActivity): WhaleExternalState {
  return {
    hover: false,
    dragging: false,
    mode: 0,
    speed: 0,
    motionX: 0,
    motionY: 0,
    yaw: 0,
    pitch: 0,
    roll: 0,
    activity,
  }
}

describe('WhaleAnimator dizzy pose', () => {
  it('turns the belly toward the camera and smoothly returns upright', () => {
    const model = new THREE.Group()
    const petPivot = new THREE.Group()
    const tailGroup = new THREE.Group()
    const eyeGroup = new THREE.Group()
    const eyeMat = new THREE.MeshBasicMaterial()
    const finPivot = new THREE.Group()
    const animator = new WhaleAnimator({
      model,
      petPivot,
      tailGroup,
      eyeMat,
      eyeGroup,
      finPivots: [{ pivot: finPivot, side: 1 }],
      petBaseY: 0,
    })

    let elapsed = 0
    animator.update(1 / 60, elapsed, external({ mood: 'idle', intensity: 0 }))
    for (let frame = 0; frame < 90; frame += 1) {
      elapsed += 1 / 60
      animator.update(1 / 60, elapsed, external({ mood: 'dizzy', intensity: 1 }))
    }
    expect(petPivot.rotation.x).toBeGreaterThan(3)
    expect(Math.abs(petPivot.rotation.z)).toBeLessThanOrEqual(0.13)

    for (let frame = 0; frame < 120; frame += 1) {
      elapsed += 1 / 60
      animator.update(1 / 60, elapsed, external({ mood: 'idle', intensity: 0 }))
    }
    expect(Math.abs(petPivot.rotation.x)).toBeLessThan(0.01)
    expect(Math.abs(petPivot.rotation.z)).toBeLessThan(0.01)
  })
})
