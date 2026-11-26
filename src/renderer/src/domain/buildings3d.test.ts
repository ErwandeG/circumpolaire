import { describe, expect, it } from 'vitest'
import { edgesOf, fillCell } from './buildings3d'
import type { Building } from './geo/buildings'
import { toLambert93 } from './geo/lambert93'
import { SurfaceKind, buildTerrain, type ElevationGrid } from './terrain'

const LAT = 48.5834
const LON = 7.7458
const obs = { ...toLambert93(LAT, LON), lat: LAT, lon: LON }
const n = 120
// Grille alignée sur des multiples de 0,5 m, pour que les tests maîtrisent les pixels de bord.
const minX = Math.floor(obs.x) - 30
const maxY = Math.floor(obs.y) + 30
const px = (c: number) => minX + (c + 0.5) * 0.5
const py = (r: number) => maxY - (r + 0.5) * 0.5

function grid(f: (x: number, y: number) => number): ElevationGrid {
  const values = new Float32Array(n * n)
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) values[r * n + c] = f(px(c), py(r))
  return { minX, maxY, res: 0.5, cols: n, rows: n, values }
}

const rect = (x0: number, y0: number, x1: number, y1: number): [number, number][] => [
  [x0, y0],
  [x1, y0],
  [x1, y1],
  [x0, y1],
  [x0, y0]
]

// Immeuble de 12,3 × 7,7 m (bords hors grille, comme une vraie emprise), à 8 m au nord.
const bx0 = obs.x - 6.13
const bx1 = obs.x + 6.17
const by0 = obs.y + 8.07
const by1 = obs.y + 15.77
const house: Building = { polygons: [[rect(bx0, by0, bx1, by1)]], height: 20 }
const inHouse = (x: number, y: number) => x > bx0 && x < bx1 && y > by0 && y < by1
const nearEdge = (x: number, y: number) =>
  inHouse(x, y) && Math.min(x - bx0, bx1 - x, y - by0, by1 - y) < 0.6
const mnt = grid(() => 140)
const EYE = 141.7

function buildingVertices(t: ReturnType<typeof buildTerrain>, kind: number = SurfaceKind.Building) {
  const out: { x: number; y: number; z: number }[] = []
  for (let i = 0; i < t.kinds.length; i++)
    if (t.kinds[i] === kind) out.push({ x: t.positions[i * 3], y: t.positions[i * 3 + 1], z: t.positions[i * 3 + 2] })
  return out
}

describe('reconstruction des bâtiments', () => {
  it('écarte les pixels de bord mélangés : toit plat à 20 m, sans bourrelet', () => {
    // Le LiDAR mélange toit et rue au bord : 150 m au lieu de 160 m.
    const mns = grid((x, y) => (nearEdge(x, y) ? 150 : inHouse(x, y) ? 160 : 140))
    const t = buildTerrain(obs, mns, mnt, [house], 50)
    const roof = buildingVertices(t).filter((v) => v.y > 0)
    expect(roof.length).toBeGreaterThan(50)
    for (const v of roof) expect(v.y).toBeCloseTo(160 - EYE, 3)
  })

  it('pose les murs exactement sur l’emprise, verticaux, du sol au toit', () => {
    const mns = grid((x, y) => (inHouse(x, y) ? 160 : 140))
    const t = buildTerrain(obs, mns, mnt, [house], 50)
    const verts = buildingVertices(t)
    // Emprise dans le repère de la scène (nord = −z) : bornes à ± 0,15 m près
    // (la convergence des méridiens fait tourner le rectangle de 3,4°).
    const xs = verts.map((v) => v.x)
    const zs = verts.map((v) => -v.z)
    expect(Math.max(...zs) - Math.min(...zs)).toBeGreaterThan(7.6)
    expect(Math.max(...zs) - Math.min(...zs)).toBeLessThan(7.7 + 12.3 * Math.sin((3.5 * Math.PI) / 180) + 0.05)
    expect(Math.max(...xs) - Math.min(...xs)).toBeLessThan(12.3 + 7.7 * Math.sin((3.5 * Math.PI) / 180) + 0.05)
    // Chaque pied de mur (sous le sol) a un sommet de toit à la même position horizontale.
    const bottoms = verts.filter((v) => v.y < -2)
    expect(bottoms.length).toBeGreaterThan(40)
    for (const b of bottoms) {
      const top = verts.find((v) => v.y > 18 && Math.abs(v.x - b.x) < 1e-4 && Math.abs(v.z - b.z) < 1e-4)
      expect(top, `pas de haut de mur au-dessus de (${b.x.toFixed(2)}, ${b.z.toFixed(2)})`).toBeDefined()
    }
  })

  it('ne crée pas de faux arbre contre la façade (décalage LiDAR / emprise)', () => {
    // Le toit déborde de 0,8 m au sud dans le LiDAR (débord ou recalage).
    const mns = grid((x, y) => (x > bx0 && x < bx1 && y > by0 - 0.8 && y < by1 ? 160 : 140))
    const t = buildTerrain(obs, mns, mnt, [house], 50)
    expect(Array.from(t.kinds).includes(SurfaceKind.Vegetation)).toBe(false)
  })

  it('laisse la cour intérieure à ciel ouvert', () => {
    const courtyard = rect(obs.x - 2, obs.y + 10, obs.x + 2, obs.y + 14)
    const withCourt: Building = { polygons: [[rect(bx0, by0, bx1, by1), courtyard.slice().reverse()]] }
    const inCourt = (x: number, y: number) => x > obs.x - 2 && x < obs.x + 2 && y > obs.y + 10 && y < obs.y + 14
    const mns = grid((x, y) => (inHouse(x, y) && !inCourt(x, y) ? 160 : 140))
    const t = buildTerrain(obs, mns, mnt, [withCourt], 50)
    // Aucun toit au-dessus du centre de la cour (à 1 m de ses murs).
    const roofOverCourt = buildingVertices(t).filter(
      (v) => v.y > 0 && Math.abs(v.x) < 1 && -v.z > 11 && -v.z < 13
    )
    expect(roofOverCourt).toHaveLength(0)
  })

  it('fournit hauteurs au-dessus du sol et arêtes pour l’éclairage', () => {
    const mns = grid((x, y) => (inHouse(x, y) ? 160 : 140))
    const t = buildTerrain(obs, mns, mnt, [house], 50)
    expect(t.elevation).toHaveLength(t.kinds.length)
    // Sommets du bâtiment : 0 au pied, 20 m au toit.
    let maxElev = 0
    for (let i = 0; i < t.kinds.length; i++) if (t.kinds[i] === SurfaceKind.Building) maxElev = Math.max(maxElev, t.elevation[i])
    expect(maxElev).toBeCloseTo(20, 3)
    // Arêtes : le tour du toit (≈ 40 m de contour) et 4 angles verticaux de 20 m.
    let roofLine = 0
    let vertical = 0
    for (let i = 0; i < t.outline.length; i += 6) {
      const dx = t.outline[i + 3] - t.outline[i]
      const dy = t.outline[i + 4] - t.outline[i + 1]
      const dz = t.outline[i + 5] - t.outline[i + 2]
      if (Math.abs(dy) > 10) vertical++
      else roofLine += Math.hypot(dx, dz)
    }
    expect(vertical).toBe(4)
    expect(roofLine).toBeCloseTo(2 * (12.3 + 7.7), 0)
    // Ombre de contact sur le sol au pied de l'immeuble.
    expect(Array.from(t.contact).some((c) => c < 1)).toBe(true)
  })

  it('construit un volume de repli plat quand le LiDAR manque', () => {
    const mns = grid((x, y) => (inHouse(x, y) ? Number.NaN : 140))
    const t = buildTerrain(obs, mns, mnt, [house], 50)
    const tops = buildingVertices(t, SurfaceKind.Fallback).filter((v) => v.y > 0)
    expect(tops.length).toBeGreaterThan(10)
    for (const v of tops) expect(v.y).toBeCloseTo(140 + 20 - EYE, 3)
  })
})

describe('partie d’une case couverte par une emprise', () => {
  const area = (tris: [number, number][][]) =>
    tris.reduce((s, [p, q, r]) => s + Math.abs((q[0] - p[0]) * (r[1] - p[1]) - (r[0] - p[0]) * (q[1] - p[1])) / 2, 0)
  const asBuilding = (...rings: [number, number][][]): Building => ({ polygons: [rings] })

  it('garde exactement la partie d’un triangle dans la case', () => {
    const tris = fillCell(edgesOf(asBuilding([[0, 0], [4, 0], [0, 4], [0, 0]])), 1, 0, 3, 2)
    // Pentagone (1,0) (3,0) (3,1) (2,2) (1,2) : 3,5 m².
    expect(area(tris)).toBeCloseTo(3.5, 9)
  })

  it('retire une cour qui touche le bord de la case', () => {
    // Carré 0..4 avec une cour 1..3 ; case 2..4 × 0..4 → 8 − 2 = 6 m².
    const b = asBuilding(rect(0, 0, 4, 4), rect(1, 1, 3, 3))
    expect(area(fillCell(edgesOf(b), 2, 0, 4, 4))).toBeCloseTo(6, 9)
  })

  it('gère une forme en L (concave)', () => {
    const L: [number, number][] = [[0, 0], [4, 0], [4, 1], [1, 1], [1, 4], [0, 4], [0, 0]]
    expect(area(fillCell(edgesOf(asBuilding(L)), 0, 0, 4, 4))).toBeCloseTo(7, 9)
  })

  it('renvoie vide si l’emprise ne touche pas la case', () => {
    expect(fillCell(edgesOf(asBuilding(rect(0, 0, 1, 1))), 5, 5, 6, 6)).toHaveLength(0)
  })
})
