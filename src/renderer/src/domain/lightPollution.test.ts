import { describe, expect, it } from 'vitest'
import { glowStrength, levelToLpi, nakedEyeLimit, skyBrightness, skyQuality } from './lightPollution'

describe('pollution lumineuse', () => {
  it('fait coïncider lumière artificielle et naturelle à la limite 3b / 4a', () => {
    // Milieux des niveaux 3b (6) et 4a (7) de part et d'autre de LPI = 1.
    expect(levelToLpi(6)).toBeLessThan(1)
    expect(levelToLpi(7)).toBeGreaterThan(1)
    expect(levelToLpi(6) * levelToLpi(7)).toBeCloseTo(1, 6)
    // √3 d'un niveau au suivant.
    expect(levelToLpi(10) / levelToLpi(9)).toBeCloseTo(Math.sqrt(3), 6)
  })

  it('donne un ciel naturel à 22 mag/arcsec² et un ciel de ville bien plus clair', () => {
    expect(skyBrightness(0)).toBeCloseTo(22, 6)
    expect(skyBrightness(1)).toBeCloseTo(22 - 2.5 * Math.log10(2), 6)
    expect(skyQuality(14).sqm).toBeLessThan(17.6)
  })

  it('donne des magnitudes limites à l’œil nu plausibles', () => {
    expect(nakedEyeLimit(22)).toBeCloseTo(6.6, 1)
    expect(nakedEyeLimit(18)).toBeCloseTo(4, 0)
    // Plus le ciel est clair, moins on voit d'étoiles.
    for (let k = 1; k < 15; k++) expect(skyQuality(k).limit).toBeLessThan(skyQuality(k - 1).limit)
  })

  it('ne met aucune lueur sous un ciel naturel et la pleine lueur en centre-ville', () => {
    expect(glowStrength(0)).toBe(0)
    expect(skyQuality(0).glow).toBeLessThan(0.05)
    expect(skyQuality(14).glow).toBeCloseTo(1, 1)
  })
})

describe('filés photographiés', async () => {
  const { trailLimit, trailWidthArcsec } = await import('./lightPollution')
  const w24 = trailWidthArcsec(24, 36)

  it('calibre : Strasbourg, 24 mm plein format, déclinaison 45°', () => {
    expect(trailLimit(18.7, 45, w24, 'raw')).toBeCloseTo(4.5, 0)
    expect(trailLimit(18.7, 45, w24, 'standard')).toBeCloseTo(5.5, 0)
    expect(trailLimit(18.7, 45, w24, 'pushed')).toBeCloseTo(6.5, 0)
  })

  it('montre des filés plus faibles près du pôle, et sous un ciel plus noir', () => {
    expect(trailLimit(18.7, 85, w24, 'standard')).toBeGreaterThan(trailLimit(18.7, 45, w24, 'standard') + 2)
    expect(trailLimit(22, 45, w24, 'standard')).toBeGreaterThan(trailLimit(18.7, 45, w24, 'standard') + 3)
  })

  it('affine le trait avec la focale, jusqu’à la limite de netteté de l’air', () => {
    expect(trailWidthArcsec(135, 36)).toBeLessThan(w24)
    expect(trailWidthArcsec(600, 36)).toBe(20)
  })
})
