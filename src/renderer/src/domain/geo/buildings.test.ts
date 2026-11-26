import { describe, expect, it } from 'vitest'
import { contains, fallbackHeight, moveOutside, parseBuildings, type Building } from './buildings'

const square = (x0: number, y0: number, size: number): [number, number][] => [
  [x0, y0],
  [x0 + size, y0],
  [x0 + size, y0 + size],
  [x0, y0 + size],
  [x0, y0]
]

describe('bâtiments', () => {
  const block: Building = { polygons: [[square(0, 0, 20)]] }
  const withCourtyard: Building = { polygons: [[square(0, 0, 30), square(10, 10, 10)]] }

  it('reconnaît un point dans une emprise', () => {
    expect(contains(block, 5, 5)).toBe(true)
    expect(contains(block, 25, 5)).toBe(false)
  })

  it('compte une cour intérieure comme extérieur', () => {
    expect(contains(withCourtyard, 15, 15)).toBe(false)
    expect(contains(withCourtyard, 5, 5)).toBe(true)
  })

  it('laisse en place un point déjà dehors', () => {
    expect(moveOutside([block], 25, 5)).toEqual({ x: 25, y: 5, moved: 0 })
  })

  it('sort le point par la façade la plus proche, avec 0,5 m de marge', () => {
    const r = moveOutside([block], 18, 10)
    expect(r.x).toBeCloseTo(20.5)
    expect(r.y).toBeCloseTo(10)
    expect(r.moved).toBeCloseTo(2.5)
  })

  it('ne ressort pas dans le bâtiment mitoyen', () => {
    // Deux bâtiments collés : la façade commune (x = 20) ne mène nulle part.
    const neighbour: Building = { polygons: [[square(20, 0, 20)]] }
    const r = moveOutside([block, neighbour], 19, 10)
    expect(contains(block, r.x, r.y) || contains(neighbour, r.x, r.y)).toBe(false)
    // La sortie la plus proche est alors la façade sud ou nord (y = 0 ou 20), à 10 m.
    expect(r.moved).toBeCloseTo(10.5, 0)
  })

  it('peut sortir dans une cour intérieure', () => {
    const r = moveOutside([withCourtyard], 9, 15)
    expect(r.x).toBeCloseTo(10.5)
    expect(contains(withCourtyard, r.x, r.y)).toBe(false)
  })

  it('applique la hauteur de repli', () => {
    expect(fallbackHeight({ polygons: [], height: 18.6 })).toEqual({ height: 18.6, estimated: false })
    expect(fallbackHeight({ polygons: [], floors: 4 })).toEqual({ height: 12, estimated: true })
    expect(fallbackHeight({ polygons: [] })).toEqual({ height: 10, estimated: true })
  })

  it('lit le GeoJSON BD TOPO (MultiPolygon avec Z)', () => {
    const b = parseBuildings({
      features: [
        {
          geometry: { type: 'MultiPolygon', coordinates: [[[[0, 0, 140], [10, 0, 140], [10, 10, 140], [0, 0, 140]]]] },
          properties: { hauteur: 18.6, nombre_d_etages: 3 }
        },
        { geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] }, properties: { hauteur: null } }
      ]
    })
    expect(b).toHaveLength(2)
    expect(b[0].height).toBe(18.6)
    expect(b[0].polygons[0][0][1]).toEqual([10, 0])
    expect(b[1].height).toBeUndefined()
  })
})
