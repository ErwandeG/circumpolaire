import { describe, expect, it } from 'vitest'
import { moonPhasesInMonth } from './phases'

/**
 * Références : phases de janvier 2024 (heures UTC publiées par l'IMCCE et l'USNO) :
 * dernier quartier le 4 à 03:30, nouvelle Lune le 11 à 11:57,
 * premier quartier le 18 à 03:53, pleine Lune le 25 à 17:54.
 */
describe('phases principales de la Lune', () => {
  const jan = moonPhasesInMonth(2024, 1)

  it('trouve les quatre phases de janvier 2024, dans l’ordre, au bon jour', () => {
    expect(jan.map((p) => [p.quarter, p.day.day])).toEqual([
      [3, 4],
      [0, 11],
      [1, 18],
      [2, 25]
    ])
  })

  it('donne l’instant à quelques minutes près', () => {
    const near = (d: Date, iso: string) => Math.abs(d.getTime() - new Date(iso).getTime()) < 5 * 60_000
    expect(near(jan[0].time, '2024-01-04T03:30:00Z')).toBe(true)
    expect(near(jan[1].time, '2024-01-11T11:57:00Z')).toBe(true)
    expect(near(jan[2].time, '2024-01-18T03:53:00Z')).toBe(true)
    expect(near(jan[3].time, '2024-01-25T17:54:00Z')).toBe(true)
  })

  it('range la phase au jour de Paris (pleine Lune du 15 décembre 2024)', () => {
    const dec = moonPhasesInMonth(2024, 12)
    expect(dec.find((p) => p.quarter === 2)?.day.day).toBe(15)
  })

  it('compte 4 ou 5 phases par mois (un cycle dure 29,5 jours)', () => {
    const counts = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((m) => moonPhasesInMonth(2026, m).length)
    for (const c of counts) expect(c === 4 || c === 5).toBe(true)
  })
})
