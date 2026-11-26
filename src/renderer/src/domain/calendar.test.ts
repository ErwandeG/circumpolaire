import { describe, expect, it } from 'vitest'
import { computeNight, trancheFor } from './calendar'
import { nightWindow } from './astro/night'
import { formatParisTime, nightTitle, parisTime } from './time'

/**
 * Références : IMCCE, service Miriade « rts », Strasbourg (48,5734 N ; 7,7521 E),
 * heures en UTC à la minute. Tolérance du cahier des charges : 2 minutes.
 */
const LAT = 48.5734
const LON = 7.7521
const TOL_MS = 2 * 60_000

function utc(iso: string): Date {
  return new Date(`${iso}:00Z`)
}

function expectNear(actual: Date | undefined, expectedIso: string): void {
  expect(actual).toBeDefined()
  const diff = Math.abs(actual!.getTime() - utc(expectedIso).getTime())
  expect(diff, `${actual!.toISOString()} vs ${expectedIso}Z`).toBeLessThanOrEqual(TOL_MS)
}

describe('fenêtre de nuit (référence IMCCE)', () => {
  const cases = [
    { day: { year: 2024, month: 1, day: 11 }, start: '2024-01-11T17:48', end: '2024-01-12T05:25' },
    { day: { year: 2024, month: 3, day: 31 }, start: '2024-03-31T19:48', end: '2024-04-01T03:16' },
    { day: { year: 2024, month: 9, day: 17 }, start: '2024-09-17T19:24', end: '2024-09-18T03:22' },
    { day: { year: 2024, month: 10, day: 27 }, start: '2024-10-27T18:02', end: '2024-10-28T04:23' },
    { day: { year: 2024, month: 12, day: 15 }, start: '2024-12-15T17:29', end: '2024-12-16T05:20' }
  ]

  for (const c of cases) {
    it(`nuit astronomique du ${c.day.day}/${c.day.month}/${c.day.year}`, () => {
      const w = nightWindow(c.day, LAT, LON)
      expect(w.kind).toBe('astronomical')
      if (w.kind === 'none') return
      expectNear(w.start, c.start)
      expectNear(w.end, c.end)
    })
  }

  it('passe en nuit nautique au solstice d’été à Strasbourg', () => {
    const w = nightWindow({ year: 2024, month: 6, day: 21 }, LAT, LON)
    expect(w.kind).toBe('nautical')
    if (w.kind === 'none') return
    expectNear(w.start, '2024-06-21T21:16')
    expectNear(w.end, '2024-06-22T01:45')
  })

  it('passe en nuit nautique quand la nuit astronomique dure moins d’1 h', () => {
    // 26 juin 2027 à Strasbourg : environ 33 min de nuit astronomique seulement.
    const w = nightWindow({ year: 2027, month: 6, day: 26 }, LAT, LON)
    expect(w.kind).toBe('nautical')
    if (w.kind === 'none') return
    expect(w.end.getTime() - w.start.getTime()).toBeGreaterThan(3 * 3600_000)
  })

  it('garde la nuit astronomique au solstice à Perpignan', () => {
    expect(nightWindow({ year: 2024, month: 6, day: 21 }, 42.6887, 2.8948).kind).toBe('astronomical')
  })

  it('passe en nuit nautique plus longtemps à Lille', () => {
    // 10 juin : le Soleil descend à environ −16,4° à Lille, −18,4° à Strasbourg.
    expect(nightWindow({ year: 2024, month: 6, day: 10 }, 50.6292, 3.0573).kind).toBe('nautical')
    expect(nightWindow({ year: 2024, month: 6, day: 10 }, LAT, LON).kind).toBe('astronomical')
  })
})

describe('présence de la Lune (référence IMCCE)', () => {
  it('absente toute la nuit à la nouvelle Lune du 11 janvier 2024', () => {
    const n = computeNight({ year: 2024, month: 1, day: 11 }, LAT, LON)
    expect(n.moon?.state).toBe('absent')
    expect(n.tranche).toBe('green')
  })

  it('présente toute la nuit à la pleine Lune du 15 décembre 2024', () => {
    const n = computeNight({ year: 2024, month: 12, day: 15 }, LAT, LON)
    expect(n.moon?.state).toBe('present')
    expect(n.tranche).toBe('red')
  })

  it('présente toute la nuit nautique du solstice 2024 (pleine Lune)', () => {
    const n = computeNight({ year: 2024, month: 6, day: 21 }, LAT, LON)
    expect(n.window.kind).toBe('nautical')
    expect(n.moon?.state).toBe('present')
    expect(n.tranche).toBe('red')
  })

  it('se lève pendant la nuit du passage à l’heure d’été (31 mars 2024)', () => {
    const n = computeNight({ year: 2024, month: 3, day: 31 }, LAT, LON)
    expect(n.moon?.state).toBe('partial')
    expect(n.moon?.rises).toHaveLength(1)
    expectNear(n.moon?.rises[0], '2024-04-01T01:17')
    // 01:17 UTC = 03:17 heure d'été (affichage tronqué à la minute, tolérance 2 min).
    expect(formatParisTime(n.moon!.rises[0])).toMatch(/^03:1[5-9]$/)
  })

  it('se lève pendant la nuit du passage à l’heure d’hiver (27 octobre 2024)', () => {
    const n = computeNight({ year: 2024, month: 10, day: 27 }, LAT, LON)
    expect(n.moon?.state).toBe('partial')
    expectNear(n.moon?.rises[0], '2024-10-28T01:46')
    // 01:46 UTC = 02:46 heure d'hiver.
    expect(formatParisTime(n.moon!.rises[0])).toMatch(/^02:4[4-8]$/)
  })

  it('les intervalles de présence restent dans la fenêtre', () => {
    const n = computeNight({ year: 2024, month: 3, day: 31 }, LAT, LON)
    if (n.window.kind === 'none' || !n.moon) throw new Error('nuit attendue')
    for (const i of n.moon.intervals) {
      expect(i.from.getTime()).toBeGreaterThanOrEqual(n.window.start.getTime())
      expect(i.to.getTime()).toBeLessThanOrEqual(n.window.end.getTime())
    }
  })
})

describe('tranches de fraction éclairée', () => {
  it('découpe par 25 %, limite dans la tranche du dessus', () => {
    expect(trancheFor(0)).toBe('green')
    expect(trancheFor(0.2499)).toBe('green')
    expect(trancheFor(0.25)).toBe('yellow')
    expect(trancheFor(0.5)).toBe('orange')
    expect(trancheFor(0.75)).toBe('red')
    expect(trancheFor(1)).toBe('red')
  })
})

describe('heure de Paris', () => {
  it('midi le jour du passage à l’heure d’été vaut 10:00 UTC', () => {
    expect(parisTime({ year: 2024, month: 3, day: 31 }, 12).toISOString()).toBe('2024-03-31T10:00:00.000Z')
  })

  it('midi en hiver vaut 11:00 UTC', () => {
    expect(parisTime({ year: 2024, month: 12, day: 15 }, 12).toISOString()).toBe('2024-12-15T11:00:00.000Z')
  })

  it('titre de nuit à cheval sur deux mois', () => {
    expect(nightTitle({ year: 2026, month: 12, day: 31 })).toBe('Nuit du 31 décembre au 1er janvier')
    expect(nightTitle({ year: 2026, month: 12, day: 12 })).toBe('Nuit du 12 au 13 décembre')
  })
})
