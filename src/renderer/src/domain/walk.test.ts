import { describe, expect, it } from 'vitest'
import { toLambert93 } from './geo/lambert93'
import { distanceM, fromLocal, localFrame, stepToward, toLocal } from './geo/local'
import { eyePosition, groundAt, isBlocked, type WalkContext } from './terrain'

const LAT = 48.5834
const LON = 7.7458
const o = toLambert93(LAT, LON)

// Sol en pente douce vers l'est (1 m tous les 10 m), immeuble de 10 × 10 m à 20 m au nord.
const cols = 160
const rows = 160
const minX = Math.floor(o.x) - 40
const maxY = Math.floor(o.y) + 40
const values = new Float32Array(cols * rows)
for (let r = 0; r < rows; r++)
  for (let c = 0; c < cols; c++) values[r * cols + c] = 140 + (minX + (c + 0.5) * 0.5 - o.x) / 10
// Surface : le sol, plus le toit de l'immeuble à 15 m au-dessus du sol.
const surface = new Float32Array(cols * rows)
for (let r = 0; r < rows; r++)
  for (let c = 0; c < cols; c++) {
    const x = minX + (c + 0.5) * 0.5
    const y = maxY - (r + 0.5) * 0.5
    const inside = x > o.x - 5 && x < o.x + 5 && y > o.y + 20 && y < o.y + 30
    surface[r * cols + c] = values[r * cols + c] + (inside ? 15 : 0)
  }
const ctx: WalkContext = {
  frame: localFrame(LAT, LON),
  eyeAltitude: 141.7,
  mnt: { minX, maxY, res: 0.5, cols, rows, values },
  mns: { minX, maxY, res: 0.5, cols, rows, values: surface },
  buildings: [
    {
      polygons: [[[[o.x - 5, o.y + 20], [o.x + 5, o.y + 20], [o.x + 5, o.y + 30], [o.x - 5, o.y + 30], [o.x - 5, o.y + 20]]]]
    }
  ]
}

describe('déplacement', () => {
  it('avance vers l’azimut visé, pas de côté vers la droite', () => {
    const north = stepToward(0, 1, 0)
    expect(north.n).toBeCloseTo(1)
    expect(north.e).toBeCloseTo(0)
    const eastStep = stepToward(90, 1, 0)
    expect(eastStep.e).toBeCloseTo(1)
    // En regardant au nord, la droite est l'est.
    expect(stepToward(0, 0, 1).e).toBeCloseTo(1)
  })

  it('convertit mètres et coordonnées dans les deux sens', () => {
    const f = localFrame(LAT, LON)
    const p = fromLocal(f, 12, -7)
    const back = toLocal(f, p.lat, p.lon)
    expect(back.e).toBeCloseTo(12, 6)
    expect(back.n).toBeCloseTo(-7, 6)
    expect(distanceM({ lat: LAT, lon: LON }, p)).toBeCloseTo(Math.hypot(12, 7), 2)
  })

  it('suit le sol : l’œil monte de 1 m après 10 m vers l’est', () => {
    const f = localFrame(LAT, LON)
    const p = fromLocal(f, 10, 0)
    const eye = eyePosition(ctx, p.lat, p.lon, 140)
    expect(eye.x).toBeCloseTo(10, 1)
    // Lambert et nord vrai diffèrent de 3,4° : 10 m vers l'est valent ~9,98 m en X Lambert.
    expect(eye.y).toBeCloseTo(1, 1)
  })

  it('garde le dernier sol connu hors de la zone chargée', () => {
    const f = localFrame(LAT, LON)
    const p = fromLocal(f, 500, 0)
    expect(Number.isNaN(groundAt(ctx, p.lat, p.lon))).toBe(true)
    expect(eyePosition(ctx, p.lat, p.lon, 140).y).toBeCloseTo(0, 6)
  })

  it('bloque l’entrée dans un bâtiment', () => {
    const f = localFrame(LAT, LON)
    const inside = fromLocal(f, 0, 25)
    const outside = fromLocal(f, 0, 15)
    expect(isBlocked(ctx, inside.lat, inside.lon)).toBe(true)
    expect(isBlocked(ctx, outside.lat, outside.lon)).toBe(false)
  })

  it('laisse passer au-dessus d’un toit quand l’œil est assez haut', () => {
    const f = localFrame(LAT, LON)
    const inside = fromLocal(f, 0, 25)
    // Toit à 15 m : bloqué à 10 m, libre à 20 m.
    expect(isBlocked(ctx, inside.lat, inside.lon, 10)).toBe(true)
    expect(isBlocked(ctx, inside.lat, inside.lon, 20)).toBe(false)
  })

  it('place l’œil à la hauteur choisie au-dessus du sol', () => {
    const eye = eyePosition(ctx, LAT, LON, 140, 30)
    // Sol à 140 m sous l'observateur, scène construite pour un œil à 141,7 m.
    expect(eye.y).toBeCloseTo(140 + 30 - 141.7, 2)
  })
})
