import { NextMoonQuarter, SearchMoonQuarter } from 'astronomy-engine'
import { daysInMonth, parisDayOf, parisTime, type CalendarDay } from '../time'

/** 0 = nouvelle Lune, 1 = premier quartier, 2 = pleine Lune, 3 = dernier quartier. */
export type QuarterIndex = 0 | 1 | 2 | 3

export interface MoonPhaseEvent {
  quarter: QuarterIndex
  time: Date
  /** Jour de Paris où tombe l'instant exact de la phase. */
  day: CalendarDay
}

export const PHASE_EMOJI: Record<QuarterIndex, string> = {
  0: '🌑',
  1: '🌓',
  2: '🌕',
  3: '🌗'
}

export const PHASE_NAMES: Record<QuarterIndex, string> = {
  0: 'Nouvelle Lune',
  1: 'Premier quartier',
  2: 'Pleine Lune',
  3: 'Dernier quartier'
}

/** Phases principales dont l'instant exact tombe dans le mois (heure de Paris). */
export function moonPhasesInMonth(year: number, month: number): MoonPhaseEvent[] {
  const start = parisTime({ year, month, day: 1 }, 0)
  const end = parisTime({ year, month, day: daysInMonth(year, month) }, 23, 59)
  const out: MoonPhaseEvent[] = []
  let mq = SearchMoonQuarter(start)
  while (mq.time.date <= end) {
    out.push({ quarter: mq.quarter as QuarterIndex, time: mq.time.date, day: parisDayOf(mq.time.date) })
    mq = NextMoonQuarter(mq)
  }
  return out
}
