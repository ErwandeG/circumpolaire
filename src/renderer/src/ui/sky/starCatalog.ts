import starData from '../../data/stars.json'
import { StarField, type StarRow } from '../../domain/astro/sky'

/** Catalogue trié par éclat : afficher N étoiles = prendre les N premières. */
export const allStars = starData.stars as StarRow[]
export const polarisIndex = starData.polarisIndex

const fields = new Map<number, StarField>()
export function starField(count: number): StarField {
  let f = fields.get(count)
  if (!f) {
    f = new StarField(allStars.slice(0, count))
    fields.set(count, f)
  }
  return f
}

/** Nombre de points par filé : au plus ~400 000 sommets calculés, pour rester fluide à 15 000 étoiles. */
export function trailSamples(durationMin: number, count: number): number {
  const wanted = Math.round(durationMin / 2) + 1
  const budget = Math.floor(400_000 / count)
  return Math.max(4, Math.min(61, wanted, budget))
}

/** Magnitude de la plus faible des N étoiles affichées. */
export function limitingMagnitude(count: number): number {
  return allStars[Math.max(0, Math.min(allStars.length, count) - 1)][2]
}
