import { describe, expect, it } from 'vitest'
import { loadPreferences, savePreferences, type KeyValueStore } from '../services/storage'
import { DEFAULT_PREFERENCES, sanitizePreferences } from './preferences'

function memoryStore(): KeyValueStore {
  const data = new Map<string, string>()
  return { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) }
}

describe('préférences de la vue', () => {
  it('donne les valeurs par défaut au premier lancement', () => {
    expect(loadPreferences(memoryStore())).toEqual(DEFAULT_PREFERENCES)
    expect(DEFAULT_PREFERENCES).toMatchObject({ focalMm: 24, durationMin: 30, starCount: 2000, radius: 50 })
  })

  it('retrouve les réglages enregistrés', () => {
    const store = memoryStore()
    const prefs = {
      focalMm: 135,
      durationMin: 90,
      orientation: 'portrait',
      starCount: 8000,
      radius: 500,
      miniMapCollapsed: true,
      eyeHeight: 12.5,
      showTrees: false
    } as const
    savePreferences(prefs, store)
    expect(loadPreferences(store)).toEqual(prefs)
  })

  it('ramène les valeurs hors limites dans les bornes', () => {
    const p = sanitizePreferences({ focalMm: 2000, durationMin: 1, starCount: 99_999 })
    expect(p.focalMm).toBe(600)
    expect(p.durationMin).toBe(5)
    expect(p.starCount).toBe(15000)
  })

  it('borne la hauteur d’œil entre 20 cm et 50 m', () => {
    expect(sanitizePreferences({ eyeHeight: 0.05 }).eyeHeight).toBe(0.2)
    expect(sanitizePreferences({ eyeHeight: 120 }).eyeHeight).toBe(50)
    expect(sanitizePreferences({ eyeHeight: 3.456 }).eyeHeight).toBe(3.46)
    expect(sanitizePreferences({}).eyeHeight).toBe(1.7)
  })

  it('arrondit le nombre d’étoiles au millier', () => {
    expect(sanitizePreferences({ starCount: 4321 }).starCount).toBe(4000)
  })

  it('remplace une valeur abîmée par sa valeur par défaut, garde les autres', () => {
    const p = sanitizePreferences({ focalMm: 'grand', orientation: 'carré', radius: 60, durationMin: 45 })
    expect(p.focalMm).toBe(24)
    expect(p.orientation).toBe('landscape')
    expect(p.radius).toBe(50)
    expect(p.durationMin).toBe(45)
  })

  it('ignore un enregistrement illisible', () => {
    const store = memoryStore()
    store.setItem('circumpolaire.viewPreferences', '{pas du json')
    expect(loadPreferences(store)).toEqual(DEFAULT_PREFERENCES)
  })
})
