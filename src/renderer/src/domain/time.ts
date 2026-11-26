/**
 * Heure légale française (Europe/Paris), changement d'heure compris.
 * Tous les instants sont des Date (UTC en interne) ; seul l'affichage passe en heure de Paris.
 */
export const TIME_ZONE = 'Europe/Paris'

/** Un jour du calendrier, sans heure. month : 1 à 12. */
export interface CalendarDay {
  year: number
  month: number
  day: number
}

const partsFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: TIME_ZONE,
  hourCycle: 'h23',
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
  hour: 'numeric',
  minute: 'numeric',
  second: 'numeric'
})

function parisParts(instant: Date): Record<string, number> {
  const out: Record<string, number> = {}
  for (const p of partsFormatter.formatToParts(instant)) {
    if (p.type !== 'literal') out[p.type] = Number(p.value)
  }
  return out
}

/** Décalage de Paris par rapport à UTC à cet instant, en minutes (60 l'hiver, 120 l'été). */
export function parisOffsetMinutes(instant: Date): number {
  const p = parisParts(instant)
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second)
  return Math.round((asUtc - Math.floor(instant.getTime() / 1000) * 1000) / 60000)
}

/** Instant correspondant à une heure locale de Paris donnée. */
export function parisTime(day: CalendarDay, hour: number, minute = 0): Date {
  const guess = Date.UTC(day.year, day.month - 1, day.day, hour, minute)
  const offset = parisOffsetMinutes(new Date(guess - 60 * 60000))
  const candidate = new Date(guess - offset * 60000)
  // Si le décalage a changé entre-temps (nuit du changement d'heure), on corrige une fois.
  const check = parisOffsetMinutes(candidate)
  return check === offset ? candidate : new Date(guess - check * 60000)
}

export function addDays(day: CalendarDay, n: number): CalendarDay {
  const d = new Date(Date.UTC(day.year, day.month - 1, day.day + n))
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() }
}

export function sameDay(a: CalendarDay, b: CalendarDay): boolean {
  return a.year === b.year && a.month === b.month && a.day === b.day
}

/** Jour de Paris contenant cet instant. */
export function parisDayOf(instant: Date): CalendarDay {
  const p = parisParts(instant)
  return { year: p.year, month: p.month, day: p.day }
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

/** Jour de la semaine, lundi = 0 … dimanche = 6. */
export function weekdayMondayFirst(day: CalendarDay): number {
  return (new Date(Date.UTC(day.year, day.month - 1, day.day)).getUTCDay() + 6) % 7
}

const hmFormatter = new Intl.DateTimeFormat('fr-FR', {
  timeZone: TIME_ZONE,
  hour: '2-digit',
  minute: '2-digit'
})

/** « 21:47 » en heure de Paris. */
export function formatParisTime(instant: Date): string {
  return hmFormatter.format(instant)
}

const MONTHS = [
  'janvier', 'février', 'mars', 'avril', 'mai', 'juin',
  'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'
]

export function monthName(month: number): string {
  return MONTHS.at(month - 1) ?? ''
}

/** « Nuit du 12 au 13 décembre », « Nuit du 31 décembre au 1er janvier ». */
export function nightTitle(day: CalendarDay): string {
  const next = addDays(day, 1)
  const d1 = day.day === 1 ? '1er' : String(day.day)
  const d2 = next.day === 1 ? '1er' : String(next.day)
  if (next.month === day.month) return `Nuit du ${d1} au ${d2} ${monthName(day.month)}`
  return `Nuit du ${d1} ${monthName(day.month)} au ${d2} ${monthName(next.month)}`
}
