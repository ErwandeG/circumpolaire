import { describe, expect, it } from 'vitest'
import { FOCAL_MAX_MM, FOCAL_MIN_MM, focalAfterWheel, focalFromSlider, sliderFromFocal } from './optics'

describe('focale', () => {
  it('couvre 6 à 2000 mm sur le curseur logarithmique', () => {
    expect(focalFromSlider(0)).toBeCloseTo(6, 6)
    expect(focalFromSlider(1)).toBeCloseTo(2000, 6)
    expect(focalFromSlider(sliderFromFocal(85))).toBeCloseTo(85, 6)
  })

  it('molette : pas fin quand les crans sont espacés, large quand ils s’enchaînent', () => {
    expect(focalAfterWheel(24, 1, 1000)).toBe(25)
    expect(focalAfterWheel(24, -1, 1000)).toBe(23)
    expect(focalAfterWheel(400, 1, 1000)).toBe(404)
    expect(focalAfterWheel(400, 1, 20)).toBe(460)
    expect(focalAfterWheel(24, 1, 100)).toBeGreaterThan(25)
  })

  it('molette : reste dans la plage', () => {
    expect(focalAfterWheel(FOCAL_MAX_MM, 1, 10)).toBe(FOCAL_MAX_MM)
    expect(focalAfterWheel(FOCAL_MIN_MM, -1, 10)).toBe(FOCAL_MIN_MM)
  })
})
