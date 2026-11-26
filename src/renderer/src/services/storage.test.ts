import { describe, expect, it } from 'vitest'
import { DEFAULT_PLACE, type Place } from '../domain/place'
import { loadLastPlace, saveLastPlace, type KeyValueStore } from './storage'

function memoryStore(): KeyValueStore & { data: Map<string, string> } {
  const data = new Map<string, string>()
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v)
  }
}

const kleber: Place = {
  label: '1 Place Kléber 67000 Strasbourg',
  lat: 48.5834,
  lon: 7.7458,
  kind: 'housenumber'
}

describe('dernier lieu', () => {
  it('vaut Strasbourg au premier lancement', () => {
    expect(loadLastPlace(memoryStore())).toEqual(DEFAULT_PLACE)
  })

  it('vaut Strasbourg sans stockage disponible', () => {
    expect(loadLastPlace(null)).toEqual(DEFAULT_PLACE)
  })

  it('relit le lieu enregistré', () => {
    const store = memoryStore()
    saveLastPlace(kleber, store)
    expect(loadLastPlace(store)).toEqual(kleber)
  })

  it('ignore une valeur corrompue', () => {
    const store = memoryStore()
    store.setItem('circumpolaire.lastPlace', '{pas du json')
    expect(loadLastPlace(store)).toEqual(DEFAULT_PLACE)
  })

  it('ignore un lieu hors métropole', () => {
    const store = memoryStore()
    store.setItem(
      'circumpolaire.lastPlace',
      JSON.stringify({ ...kleber, lat: -20.88, lon: 55.45 })
    )
    expect(loadLastPlace(store)).toEqual(DEFAULT_PLACE)
  })

  it('survit à un stockage qui lève une erreur', () => {
    const broken: KeyValueStore = {
      getItem: () => {
        throw new Error('bloqué')
      },
      setItem: () => {
        throw new Error('plein')
      }
    }
    expect(() => saveLastPlace(kleber, broken)).not.toThrow()
    expect(loadLastPlace(broken)).toEqual(DEFAULT_PLACE)
  })
})
