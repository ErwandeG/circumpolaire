import { Body, DefineStar, Equator, Horizon, Observer } from 'astronomy-engine'
import { describe, expect, it } from 'vitest'
import starData from '../../data/stars.json'
import {
  SENSORS,
  SIDEREAL_DEG_PER_MIN,
  cropFactor,
  equivalentFocal,
  fieldOfView,
  focalFromSlider,
  sensorById,
  sliderFromFocal
} from '../optics'
import {
  StarField,
  altAzToEnu,
  angleBetween,
  enuToAltAz,
  moonState,
  northCelestialPole,
  type Enu,
  type StarRow
} from './sky'

const LAT = 48.5734
const LON = 7.7521
const T = new Date('2026-12-15T21:00:00Z')
const rows = starData.stars as StarRow[]
const field = new StarField(rows.slice(0, 2000))
const VEGA = Object.entries(starData.names).find(([, n]) => n === 'Vega')![0]

describe('catalogue', () => {
  it('contient toutes les étoiles jusqu’à la magnitude 8, triées par éclat, Polaire parmi les 1 000 premières', () => {
    expect(rows.length).toBeGreaterThan(40000)
    expect(rows.at(-1)![2]).toBeLessThanOrEqual(8)
    for (let i = 1; i < rows.length; i++) expect(rows[i][2]).toBeGreaterThanOrEqual(rows[i - 1][2])
    expect(starData.polarisIndex).toBeLessThan(1000)
    expect(starData.names[String(starData.polarisIndex) as keyof typeof starData.names]).toBe('Polaris')
  })

  it('donne les magnitudes limites attendues (2 000 → 5,2 ; 15 000 → 7,0)', () => {
    expect(rows[1999][2]).toBeCloseTo(5.18, 1)
    expect(rows[14999][2]).toBeCloseTo(6.97, 1)
  })
})

describe('positions dans le ciel', () => {
  it('place le pôle céleste à une hauteur égale à la latitude, plein nord', () => {
    const p = enuToAltAz(northCelestialPole(T, LAT, LON, { refraction: false }))
    expect(p.altitude).toBeCloseTo(LAT, 2)
    expect(Math.min(p.azimuth, 360 - p.azimuth)).toBeLessThan(0.01)
  })

  it('place la Polaire à moins de 0,75° du pôle', () => {
    const polaris = field.position(starData.polarisIndex, T, LAT, LON)
    const pole = northCelestialPole(T, LAT, LON)
    expect(angleBetween(polaris, pole)).toBeLessThan(0.75)
    expect(angleBetween(polaris, pole)).toBeGreaterThan(0.55)
  })

  it('concorde avec le calcul d’étoile d’astronomy-engine pour Véga (à 0,02° près)', () => {
    const [ra, dec] = starData.stars[Number(VEGA)]
    expect(ra).toBeCloseTo(279.23, 1)
    expect(dec).toBeCloseTo(38.78, 1)
    // Chemin indépendant : étoile définie dans le moteur, puis Equator (précession, nutation,
    // aberration) et Horizon avec réfraction.
    DefineStar(Body.Star1, ra / 15, dec, 25)
    const observer = new Observer(LAT, LON, 0)
    for (const t of [T, new Date('2027-06-21T22:00:00Z')]) {
      const eq = Equator(Body.Star1, t, observer, true, true)
      const ref = Horizon(t, observer, eq.ra, eq.dec, 'normal')
      const mine = enuToAltAz(field.position(Number(VEGA), t, LAT, LON))
      expect(angleBetween(altAzToEnu(mine.azimuth, mine.altitude), altAzToEnu(ref.azimuth, ref.altitude))).toBeLessThan(0.02)
    }
  })

  it('place la Lune comme Horizon d’astronomy-engine, réfraction comprise', () => {
    const observer = new Observer(LAT, LON, 0)
    const eq = Equator(Body.Moon, T, observer, true, true)
    const ref = Horizon(T, observer, eq.ra, eq.dec, 'normal')
    const moon = enuToAltAz(moonState(T, 5, 2, LAT, LON).direction)
    expect(moon.altitude).toBeCloseTo(ref.altitude, 6)
    expect(moon.azimuth).toBeCloseTo(ref.azimuth, 6)
  })

  it('applique la réfraction : environ 0,5° de plus à l’horizon, rien au zénith', () => {
    const low = altAzToEnu(0, 0)
    // Une étoile proche de l'horizon : on cherche la plus basse au-dessus de 0°.
    let best = -1
    let bestAlt = 90
    for (let i = 0; i < field.count; i++) {
      const a = enuToAltAz(field.position(i, T, LAT, LON, { refraction: false })).altitude
      if (a > 0.2 && a < bestAlt) {
        bestAlt = a
        best = i
      }
    }
    const raw = enuToAltAz(field.position(best, T, LAT, LON, { refraction: false }))
    const refr = enuToAltAz(field.position(best, T, LAT, LON))
    expect(refr.altitude - raw.altitude).toBeGreaterThan(0.2)
    expect(refr.altitude - raw.altitude).toBeLessThan(0.6)
    expect(refr.azimuth).toBeCloseTo(raw.azimuth, 6)
    expect(low.n).toBeCloseTo(1)
  })
})

describe('filés', () => {
  const at = (arr: Float32Array, star: number, k: number, samples: number): Enu => {
    const o = (star * samples + k) * 3
    return { e: arr[o], n: arr[o + 1], u: arr[o + 2] }
  }

  it('tournent autour du pôle de 15,04° par heure', () => {
    const samples = 31
    const trails = field.trails(T, 60, samples, LAT, LON, { refraction: false })
    const pole = northCelestialPole(T, LAT, LON, { refraction: false })
    const star = Number(VEGA)
    const a = at(trails, star, 0, samples)
    const b = at(trails, star, samples - 1, samples)
    // Angle de rotation vu depuis le pôle : on projette sur le plan perpendiculaire au pôle.
    const proj = (v: Enu): Enu => {
      const d = v.e * pole.e + v.n * pole.n + v.u * pole.u
      return { e: v.e - d * pole.e, n: v.n - d * pole.n, u: v.u - d * pole.u }
    }
    expect(angleBetween(proj(a), proj(b))).toBeCloseTo(60 * SIDEREAL_DEG_PER_MIN, 1)
  })

  it('gardent la distance au pôle (déclinaison constante)', () => {
    const samples = 5
    const trails = field.trails(T, 120, samples, LAT, LON, { refraction: false })
    const pole = northCelestialPole(T, LAT, LON, { refraction: false })
    const star = Number(VEGA)
    const d0 = angleBetween(at(trails, star, 0, samples), pole)
    const d4 = angleBetween(at(trails, star, 4, samples), pole)
    expect(Math.abs(d0 - d4)).toBeLessThan(0.01)
  })
})

describe('Lune', () => {
  it('a un diamètre apparent d’environ un demi-degré', () => {
    const m = moonState(T, 60, 3, LAT, LON)
    expect(m.diameterDeg).toBeGreaterThan(0.48)
    expect(m.diameterDeg).toBeLessThan(0.57)
    expect(m.track).toHaveLength(3)
  })
})

describe('optique', () => {
  it('donne 122° à 10 mm et 3,4° à 600 mm en largeur plein format', () => {
    expect(fieldOfView(36, 10)).toBeCloseTo(121.9, 1)
    expect(fieldOfView(36, 600)).toBeCloseTo(3.44, 2)
  })

  it('connaît les facteurs de recadrage usuels', () => {
    const crop = (id: string) => cropFactor(sensorById(id))
    expect(crop('full-frame')).toBeCloseTo(1, 5)
    expect(crop('medium-44')).toBeCloseTo(0.79, 2)
    expect(crop('medium-54')).toBeCloseTo(0.65, 2)
    expect(crop('aps-c')).toBeCloseTo(1.53, 2)
    expect(crop('aps-c-canon')).toBeCloseTo(1.61, 2)
    expect(crop('m43')).toBeCloseTo(2.0, 1)
    expect(new Set(SENSORS.map((s) => s.id)).size).toBe(SENSORS.length)
  })

  it('donne à 12 mm sur Micro 4/3 le champ d’un 24 mm plein format', () => {
    const m43 = sensorById('m43')
    expect(equivalentFocal(m43, 12)).toBeCloseTo(24, 0)
    // Même diagonale de champ, à 1° près.
    const diag = (w: number, h: number, f: number) => fieldOfView(Math.hypot(w, h), f)
    expect(diag(17.3, 13, 12)).toBeCloseTo(diag(36, 24, 24), 0)
  })

  it('revient au plein format pour un capteur inconnu', () => {
    expect(sensorById('inconnu').id).toBe('full-frame')
  })

  it('slider logarithmique réversible', () => {
    expect(focalFromSlider(0)).toBeCloseTo(10)
    expect(focalFromSlider(1)).toBeCloseTo(600)
    expect(sliderFromFocal(focalFromSlider(0.37))).toBeCloseTo(0.37)
  })
})
