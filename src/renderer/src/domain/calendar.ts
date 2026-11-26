import { moonIlluminatedFraction, moonPresence, type MoonPresence } from './astro/moon'
import { nightWindow, type NightWindow } from './astro/night'
import { addDays, daysInMonth, parisTime, type CalendarDay } from './time'

/** Tranches de 25 % de fraction éclairée. Une valeur pile sur une limite va dans la tranche du dessus. */
export type MoonTranche = 'green' | 'yellow' | 'orange' | 'red'

export function trancheFor(fraction: number): MoonTranche {
  if (fraction < 0.25) return 'green'
  if (fraction < 0.5) return 'yellow'
  if (fraction < 0.75) return 'orange'
  return 'red'
}

export const TRANCHE_LABELS: Record<MoonTranche, string> = {
  green: '0 à 25 %',
  yellow: '25 à 50 %',
  orange: '50 à 75 %',
  red: '75 à 100 %'
}

export interface NightInfo {
  day: CalendarDay
  window: NightWindow
  /** Fraction éclairée au milieu de la fenêtre (ou à minuit s'il n'y a pas de nuit noire). */
  illumination: number
  tranche: MoonTranche
  /** Absent quand il n'y a pas de nuit noire. */
  moon?: MoonPresence
}

export function computeNight(day: CalendarDay, lat: number, lon: number): NightInfo {
  const window = nightWindow(day, lat, lon)
  if (window.kind === 'none') {
    const midnight = parisTime(addDays(day, 1), 0)
    const illumination = moonIlluminatedFraction(midnight)
    return { day, window, illumination, tranche: trancheFor(illumination) }
  }
  const middle = new Date((window.start.getTime() + window.end.getTime()) / 2)
  const illumination = moonIlluminatedFraction(middle)
  return {
    day,
    window,
    illumination,
    tranche: trancheFor(illumination),
    moon: moonPresence(window.start, window.end, lat, lon)
  }
}

export function computeMonth(year: number, month: number, lat: number, lon: number): NightInfo[] {
  const n = daysInMonth(year, month)
  return Array.from({ length: n }, (_, i) => computeNight({ year, month, day: i + 1 }, lat, lon))
}
