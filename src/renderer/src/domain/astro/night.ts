import { Body, Observer, SearchAltitude } from 'astronomy-engine'
import { addDays, parisTime, type CalendarDay } from '../time'

export const ASTRONOMICAL_TWILIGHT_DEG = -18
export const NAUTICAL_TWILIGHT_DEG = -12

export type NightWindow =
  | { kind: 'astronomical' | 'nautical'; start: Date; end: Date }
  | { kind: 'none' }

const DAY_MS = 86_400_000

/**
 * Fenêtre de nuit rattachée au jour `day` (la nuit du 12 au 13 est celle du 12) :
 * du crépuscule du soir à l'aube du lendemain, cherchés entre midi et midi, heure de Paris.
 * Nuit astronomique (Soleil à −18°) si elle existe, sinon nuit nautique (−12°).
 */
export function nightWindow(day: CalendarDay, lat: number, lon: number): NightWindow {
  const observer = new Observer(lat, lon, 0)
  const noon = parisTime(day, 12)
  const nextNoon = parisTime(addDays(day, 1), 12)

  for (const [kind, altitude] of [
    ['astronomical', ASTRONOMICAL_TWILIGHT_DEG],
    ['nautical', NAUTICAL_TWILIGHT_DEG]
  ] as const) {
    const dusk = SearchAltitude(Body.Sun, observer, -1, noon, (nextNoon.getTime() - noon.getTime()) / DAY_MS, altitude)
    if (!dusk || dusk.date >= nextNoon) continue
    const dawn = SearchAltitude(
      Body.Sun,
      observer,
      +1,
      dusk.date,
      (nextNoon.getTime() - dusk.date.getTime()) / DAY_MS,
      altitude
    )
    if (!dawn || dawn.date >= nextNoon) continue
    return { kind, start: dusk.date, end: dawn.date }
  }
  return { kind: 'none' }
}
