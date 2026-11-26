import { describe, expect, it } from 'vitest'
import { fromLambert93, meridianConvergence, toLambert93 } from './lambert93'

/**
 * Références : sommets de bâtiments BD TOPO renvoyés par le WFS de l'IGN
 * à la fois en EPSG:4326 et en EPSG:2154 (coordonnées stockées au décimètre).
 */
const refs = [
  { name: 'Strasbourg', lon: 7.74487969, lat: 48.58412441, x: 1049759.39972051, y: 6842057.70464554 },
  { name: 'Marseille', lon: 5.3706521, lat: 43.29679309, x: 892458.39985789, y: 6247069.90473208 },
  { name: 'Brest', lon: -4.48607641, lat: 48.39108266, x: 146641.90044155, y: 6836337.7046435 },
  { name: 'Bastia', lon: 9.45130605, lat: 42.69763479, x: 1228674.29961515, y: 6199167.20470003 }
]

describe('Lambert 93', () => {
  it('place l’origine de la projection à (700 000 ; 6 600 000)', () => {
    const p = toLambert93(46.5, 3)
    expect(p.x).toBeCloseTo(700000, 3)
    expect(p.y).toBeCloseTo(6600000, 3)
  })

  for (const r of refs) {
    it(`concorde avec l’IGN à ${r.name} (à 5 cm près)`, () => {
      const p = toLambert93(r.lat, r.lon)
      expect(Math.abs(p.x - r.x)).toBeLessThan(0.05)
      expect(Math.abs(p.y - r.y)).toBeLessThan(0.05)
    })

    it(`revient aux coordonnées GPS à ${r.name}`, () => {
      const g = fromLambert93(r.x, r.y)
      expect(g.lat).toBeCloseTo(r.lat, 6)
      expect(g.lon).toBeCloseTo(r.lon, 6)
    })
  }

  it('donne une convergence des méridiens d’environ 3,4° à Strasbourg', () => {
    expect(meridianConvergence(7.75)).toBeCloseTo(3.45, 1)
  })
})
