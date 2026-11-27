import { describe, expect, it } from 'vitest'
import { DEFAULT_PREFERENCES, sanitizePreferences } from '../../domain/preferences'
import { createSkyState, toPreferences } from './skyState'
import { captureFileName, exposureWarnings, focalEquivalentText, focalText, hudLine, settingsSummary } from './skyText'

const state = () => {
  const s = createSkyState(DEFAULT_PREFERENCES, 15000)
  s.observer = { lat: 48.5734, lon: 7.7521, label: 'Strasbourg' }
  // 26 novembre 2026, 19 h 00 à Paris (18 h 00 UTC) : en pleine nuit astronomique.
  s.start = new Date(Date.UTC(2026, 10, 26, 18, 0))
  return s
}

describe('état de la vue', () => {
  it('rend les préférences telles qu’elles ont été lues', () => {
    const prefs = sanitizePreferences({ focalMm: 85, sensorId: 'aps-c', eyeHeight: 12, reliefOn: true })
    expect(toPreferences(createSkyState(prefs, 15000))).toEqual(prefs)
  })
})

describe('textes de la vue', () => {
  it('donne la focale réelle et son équivalent hors plein format', () => {
    const s = state()
    expect(focalText(s)).toBe('24 mm plein format')
    expect(focalEquivalentText(s)).toBe('')
    s.sensorId = 'm43'
    s.focalMm = 12
    expect(focalText(s)).toBe('12 mm Micro 4/3 (≈ 24 mm éq. 24×36)')
    expect(focalEquivalentText(s)).toContain('×2')
  })

  it('résume les réglages en une ligne', () => {
    const s = state()
    s.showTrees = false
    expect(settingsSummary(s)).toBe(
      '24 mm plein format paysage · 19:00, pose 30 min · 2 000 étoiles · œil à 1,7 m · volumes 50 m · relief masqué · arbres masqués'
    )
  })

  it('indique la rotation dans le bandeau seulement si elle n’est pas nulle', () => {
    const s = state()
    const f = { h: 73.7, v: 53.1 }
    const moon = { fraction: 0.5, altitude: -3, azimuth: 0 }
    expect(hudLine(s, f, moon)).not.toContain('rotation')
    s.roll = 12.5
    expect(hudLine(s, f, moon)).toContain('rotation 12,5°')
    expect(hudLine(s, f, moon)).toContain('Lune couchée (50 %)')
  })

  it('n’avertit pas pour une pose en pleine nuit, avertit si elle déborde au matin', () => {
    const s = state()
    expect(exposureWarnings(s)).toEqual([])
    // 27 novembre, 7 h 00 à Paris : l'aube astronomique est passée.
    s.start = new Date(Date.UTC(2026, 10, 27, 6, 0))
    expect(exposureWarnings(s).join(' ')).toContain('se termine après la fin')
  })

  it('nomme le fichier exporté avec la date, l’heure et la focale', () => {
    expect(captureFileName(state())).toBe('star-trail-planner-20261126-1900-24mm.png')
  })
})
