import { describe, expect, it } from 'vitest'
import { WhalePetService } from '../src/client/runtime/whale-pet-service.ts'

describe('WhalePetService', () => {
  it('anchors bubbles at the mouth implied by the current yaw', () => {
    const service = new WhalePetService()
    // Default yaw is 0 (facing left), so the mouth anchor sits on the left.
    service.playEffect('bubble')

    const bubble = service.getSnapshot().effects.find(effect => effect.kind === 'bubble')
    expect(bubble?.origin?.x).toBeCloseTo(34, 5)
    expect(bubble?.origin?.y).toBe(70)

    service.dispose()
  })
})
