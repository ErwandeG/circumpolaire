import { describe, expect, it } from 'vitest'
import { computeHorizon, curvatureDrop, ridgeSegments, type ReliefGrid } from './horizon'

/** Grille de 40 × 40 km au pas de 50 m, centrée sur (0, 0), relief donné par f(x, y). */
function grid(f: (x: number, y: number) => number): ReliefGrid {
  const res = 50
  const cols = 800
  const rows = 800
  const minX = -20000
  const maxY = 20000
  const values = new Float32Array(cols * rows)
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) values[r * cols + c] = f(minX + (c + 0.5) * res, maxY - (r + 0.5) * res)
  return { minX, maxY, res, cols, rows, values }
}

const base = { x: 0, y: 0, eyeAltitude: 1001.7, gridNorth: 0, minDistance: 50, maxDistance: 19000, azimuths: 360 }
const atan = (h: number, d: number) => (Math.atan2(h, d) * 180) / Math.PI

describe('relief lointain', () => {
  it('abaisse une crête à 20 km d’environ 27 m (rotondité moins réfraction)', () => {
    expect(curvatureDrop(20000)).toBeCloseTo(27.3, 0)
    expect(curvatureDrop(1000)).toBeLessThan(0.1)
  })

  it('trouve une muraille de 1 000 m à 5 km au nord, à la bonne hauteur angulaire', () => {
    // Plaine à 1 000 m, muraille à 2 000 m entre 5 et 6 km au nord.
    const g = grid((_x, y) => (y > 5000 && y < 6000 ? 2000 : 1000))
    const p = computeHorizon({ ...base, grids: [g] })
    const expected = atan(2000 - curvatureDrop(5000) - 1001.7, 5000)
    expect(p.skyline[0]).toBeCloseTo(expected, 0)
    expect(p.skylineDistance[0]).toBeGreaterThan(4900)
    expect(p.skylineDistance[0]).toBeLessThan(5200)
    // Au sud, pas de muraille : l'horizon de la plaine est sous l'horizontale.
    expect(p.skyline[180]).toBeLessThan(0)
  })

  it('suit le nord vrai, pas le nord du quadrillage', () => {
    const g = grid((x, y) => (Math.hypot(x - 0, y - 5000) < 500 ? 2000 : 1000))
    // Nord vrai tourné de +10° dans le quadrillage : le sommet au nord du quadrillage
    // apparaît à l'azimut −10°, soit 350°.
    const p = computeHorizon({ ...base, grids: [g], gridNorth: (10 * Math.PI) / 180 })
    let best = 0
    for (let i = 0; i < 360; i++) if (p.skyline[i] > p.skyline[best]) best = i
    expect(best).toBeGreaterThanOrEqual(349)
    expect(best).toBeLessThanOrEqual(351)
  })

  it('garde une crête intermédiaire visible devant la crête principale', () => {
    // Colline à 2 km (1 300 m), vallée, puis grande crête à 10 km (3 000 m).
    const g = grid((_x, y) => {
      if (y > 1800 && y < 2200) return 1300
      if (y > 9800 && y < 10500) return 3000
      return 1000
    })
    const p = computeHorizon({ ...base, grids: [g] })
    expect(p.skylineDistance[0]).toBeGreaterThan(9500)
    const north: number[] = []
    for (let k = 0; k < p.ridges.length; k += 3) if (p.ridges[k] === 0) north.push(p.ridges[k + 2])
    expect(north.some((d) => d > 1700 && d < 2300)).toBe(true)
  })

  it('relie les crêtes voisines en segments', () => {
    const g = grid((x, y) => (y > 1800 && y < 2200 && Math.abs(x) < 3000 ? 1300 : y > 9800 && y < 10500 ? 3000 : 1000))
    const p = computeHorizon({ ...base, grids: [g] })
    const seg = ridgeSegments(p)
    expect(seg.length).toBeGreaterThan(5 * 5)
  })

  it('empile les plans vus sous la crête, du proche au lointain', () => {
    const g = grid((_x, y) => {
      if (y > 1800 && y < 2200) return 1300
      if (y > 9800 && y < 10500) return 3000
      return 1000
    })
    const p = computeHorizon({ ...base, grids: [g] })
    const from = p.layerStart[0]
    const to = p.layerStart[1]
    expect(to - from).toBeGreaterThan(1)
    // Bandes jointives de −89° jusqu'à la crête, distances croissantes.
    expect(p.layers[from * 3]).toBe(-89)
    for (let k = from + 1; k < to; k++) {
      expect(p.layers[k * 3]).toBeCloseTo(p.layers[(k - 1) * 3 + 1], 5)
      expect(p.layers[k * 3 + 2]).toBeGreaterThan(p.layers[(k - 1) * 3 + 2])
    }
    expect(p.layers[(to - 1) * 3 + 1]).toBeCloseTo(p.skyline[0], 5)
    expect(p.layers[(to - 1) * 3 + 2]).toBeGreaterThan(9500)
  })

  it('dessine la ville en silhouette (MNS) mais cherche les crêtes sur le sol nu', () => {
    // Tour de 300 m à 800 m au nord (MNS seulement), plus haute à l'œil que la crête à 10 km.
    const bare = grid((_x, y) => {
      if (y > 1800 && y < 2200) return 1300
      if (y > 9800 && y < 10500) return 3000
      return 1000
    })
    const surf: ReliefGrid = { ...grid((x, y) => (Math.abs(x) < 60 && y > 760 && y < 840 ? 1300 : 1000)), surface: true }
    // Grille MNS limitée à 3 km : au-delà, NaN, le MNT prend le relais.
    surf.values = surf.values.map((v, i) => {
      const c = i % surf.cols
      const r = Math.floor(i / surf.cols)
      const x = surf.minX + (c + 0.5) * surf.res
      const y = surf.maxY - (r + 0.5) * surf.res
      return Math.hypot(x, y) < 3000 ? v : Number.NaN
    })
    const p = computeHorizon({ ...base, grids: [surf, bare] })
    // La tour cache le nord : la silhouette est la sienne, à 800 m.
    expect(p.skyline[0]).toBeGreaterThan(atan(300 - 1.7, 850))
    expect(p.skylineDistance[0]).toBeLessThan(900)
    // Aucune crête « de toit » : la tour n'est pas dans les crêtes.
    for (let k = 0; k < p.ridges.length; k += 3) expect(p.ridges[k + 2]).toBeGreaterThan(1500)
    // Ailleurs, la colline de 2 km reste une crête.
    const east = []
    for (let k = 0; k < p.ridges.length; k += 3) if (p.ridges[k] === 10) east.push(p.ridges[k + 2])
    expect(east.some((d) => d > 1700 && d < 2300)).toBe(true)
  })

  it('ne dépasse pas la distance demandée', () => {
    const g = grid((_x, y) => (y > 9000 && y < 10000 ? 4000 : 1000))
    const p = computeHorizon({ ...base, grids: [g], maxDistance: 5000 })
    expect(p.skylineDistance[0]).toBeLessThanOrEqual(5000)
    expect(p.skyline[0]).toBeLessThan(0.5)
  })
})
