import { describe, expect, it } from 'vitest'
import type { Building } from './geo/buildings'
import { toLambert93 } from './geo/lambert93'
import { SurfaceKind, buildTerrain, gridResFor, sceneExtent, type ElevationGrid } from './terrain'

const LAT = 48.5834
const LON = 7.7458
const obs = { ...toLambert93(LAT, LON), lat: LAT, lon: LON }

function grid(minX: number, maxY: number, cols: number, rows: number, f: (x: number, y: number) => number): ElevationGrid {
  const values = new Float32Array(cols * rows)
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) values[r * cols + c] = f(minX + (c + 0.5) * 0.5, maxY - (r + 0.5) * 0.5)
  return { minX, maxY, res: 0.5, cols, rows, values }
}

describe('surface 3D', () => {
  // Zone de 40 m × 40 m autour de l'observateur, sol à 140 m.
  const minX = Math.floor(obs.x) - 20
  const maxY = Math.floor(obs.y) + 20
  const n = 80
  // Un immeuble de 20 m de haut, 10 m au nord de l'observateur.
  const house: Building = {
    polygons: [[[[obs.x - 5, obs.y + 10], [obs.x + 5, obs.y + 10], [obs.x + 5, obs.y + 15], [obs.x - 5, obs.y + 15], [obs.x - 5, obs.y + 10]]]],
    height: 20
  }
  const inHouse = (x: number, y: number) => x > obs.x - 5 && x < obs.x + 5 && y > obs.y + 10 && y < obs.y + 15
  const mnt = grid(minX, maxY, n, n, () => 140)

  it('place l’œil à 1,70 m au-dessus du MNT', () => {
    const mns = grid(minX, maxY, n, n, () => 140)
    const t = buildTerrain(obs, mns, mnt, [house], 60)
    expect(t.eyeAltitude).toBeCloseTo(141.7)
  })

  it('met l’immeuble au nord, à la bonne hauteur, classé bâtiment', () => {
    const mns = grid(minX, maxY, n, n, (x, y) => (inHouse(x, y) ? 160 : 140))
    const t = buildTerrain(obs, mns, mnt, [house], 60)
    let found = false
    let roofTop = -Infinity
    for (let i = 0; i < t.kinds.length; i++) {
      if (t.kinds[i] !== SurfaceKind.Building) continue
      found = true
      const z = t.positions[i * 3 + 2]
      // Murs et toit tiennent dans l'emprise, au nord (z négatif), entre 10 et 15 m
      // (± 0,3 m : le rectangle Lambert est tourné de 3,4° par rapport au nord vrai).
      expect(-z).toBeGreaterThan(9.6)
      expect(-z).toBeLessThan(15.4)
      roofTop = Math.max(roofTop, t.positions[i * 3 + 1])
    }
    expect(found).toBe(true)
    expect(roofTop).toBeCloseTo(160 - 141.7, 3)
  })

  it('classe en végétation ce qui dépasse du sol hors des emprises', () => {
    const mns = grid(minX, maxY, n, n, (x, y) => (Math.hypot(x - obs.x - 8, y - obs.y) < 2 ? 150 : 140))
    const t = buildTerrain(obs, mns, mnt, [house], 60)
    expect(Array.from(t.kinds).includes(SurfaceKind.Vegetation)).toBe(true)
  })

  it('ramène les arbres au sol quand on les masque', () => {
    const mns = grid(minX, maxY, n, n, (x, y) => (Math.hypot(x - obs.x - 8, y - obs.y) < 2 ? 150 : 140))
    const t = buildTerrain(obs, mns, mnt, [house], 60, { trees: false })
    expect(Array.from(t.kinds).includes(SurfaceKind.Vegetation)).toBe(false)
    let maxGroundY = -Infinity
    for (let i = 0; i < t.kinds.length; i++)
      if (t.kinds[i] === SurfaceKind.Ground) maxGroundY = Math.max(maxGroundY, t.positions[i * 3 + 1])
    expect(maxGroundY).toBeCloseTo(140 - 141.7, 3)
  })

  it('laisse voir sous un arbre : sol en dessous, cime au-dessus de l’œil', () => {
    // Arbre de 10 m de haut, de 4 m de rayon, centré sur l'observateur.
    const mns = grid(minX, maxY, n, n, (x, y) => (Math.hypot(x - obs.x, y - obs.y) < 4 ? 150 : 140))
    const t = buildTerrain(obs, mns, mnt, [], 60)
    const ys = { ground: [] as number[], crown: [] as number[] }
    for (let i = 0; i < t.kinds.length; i++) {
      const x = t.positions[i * 3]
      const z = t.positions[i * 3 + 2]
      if (Math.hypot(x, z) > 1) continue
      ;(t.kinds[i] === SurfaceKind.Ground ? ys.ground : ys.crown).push(t.positions[i * 3 + 1])
    }
    // Sol sous l'arbre à −1,70 m de l'œil, bas de cime à 4 m du sol (au-dessus de l'œil).
    expect(ys.ground.some((y) => Math.abs(y + 1.7) < 0.01)).toBe(true)
    expect(Math.min(...ys.crown)).toBeCloseTo(4 - 1.7, 1)
  })

  it('remplace un trou du LiDAR par le volume BD TOPO', () => {
    const mns = grid(minX, maxY, n, n, (x, y) => (inHouse(x, y) ? Number.NaN : 140))
    const t = buildTerrain(obs, mns, mnt, [house], 60)
    let top = -Infinity
    for (let i = 0; i < t.kinds.length; i++)
      if (t.kinds[i] === SurfaceKind.Fallback) top = Math.max(top, t.positions[i * 3 + 1])
    expect(top).toBeCloseTo(140 + 20 - 141.7, 3)
    expect(t.fallbackShare).toBeGreaterThan(0)
  })

  it('aligne le nord vrai (convergence des méridiens corrigée)', () => {
    // Un point plein nord en coordonnées géographiques doit avoir x ≈ 0 dans la scène,
    // alors qu'en Lambert 93 il est décalé de ~3,4° vers l'ouest du quadrillage.
    const north = toLambert93(LAT + 0.00015, LON)
    expect(north.x - obs.x).toBeLessThan(-0.9) // décalage visible en Lambert
    const mns = grid(minX, maxY, n, n, () => 140)
    const t = buildTerrain(obs, mns, mnt, [], 60)
    // Sommet de grille le plus proche de ce point.
    const c = Math.round((north.x - minX) / 0.5 - 0.5)
    const r = Math.round((maxY - north.y) / 0.5 - 0.5)
    const i = r * n + c
    expect(Math.abs(t.positions[i * 3])).toBeLessThan(0.5)
    expect(Math.abs(-t.positions[i * 3 + 2] - 16.7)).toBeLessThan(0.5)
  })
})

describe('zone chargée', () => {
  it('s’élargit aux bâtiments touchés par le cercle, dans la limite de 2 × rayon + 120 m', () => {
    const big: Building = {
      polygons: [[[[obs.x + 50, obs.y - 10], [obs.x + 200, obs.y - 10], [obs.x + 200, obs.y + 10], [obs.x + 50, obs.y + 10], [obs.x + 50, obs.y - 10]]]]
    }
    const e = sceneExtent(obs.x, obs.y, [big], 60)
    expect(e.touched).toHaveLength(1)
    expect(e.maxX - obs.x).toBeGreaterThan(110)
    expect(e.maxX - obs.x).toBeLessThanOrEqual(120.5)
    expect(obs.x - e.minX).toBeCloseTo(60, 0)
  })

  it('à 500 m, passe au pas de 1 m et aligne la zone sur ce pas', () => {
    expect(gridResFor(50)).toBe(0.5)
    expect(gridResFor(150)).toBe(0.5)
    expect(gridResFor(500)).toBe(1)
    const e = sceneExtent(obs.x + 0.3, obs.y + 0.7, [], 500)
    for (const v of [e.minX, e.minY, e.maxX, e.maxY]) expect(Number.isInteger(v)).toBe(true)
    expect(e.maxX - e.minX).toBeLessThanOrEqual(1002)
  })

  it('à 150 m, couvre le cercle entier et ignore un bâtiment hors de portée', () => {
    const far: Building = {
      polygons: [[[[obs.x + 200, obs.y], [obs.x + 210, obs.y], [obs.x + 210, obs.y + 10], [obs.x + 200, obs.y + 10], [obs.x + 200, obs.y]]]]
    }
    const e = sceneExtent(obs.x, obs.y, [far], 150)
    expect(e.touched).toHaveLength(0)
    expect(e.maxX - obs.x).toBeCloseTo(150, 0)
    expect(obs.y - e.minY).toBeCloseTo(150, 0)
  })
})
