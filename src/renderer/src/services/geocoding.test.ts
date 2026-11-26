import { describe, expect, it } from 'vitest'
import { geocode, parseGeocodeResponse } from './geocoding'

function feature(props: Record<string, unknown>, lon: number, lat: number) {
  return { type: 'Feature', geometry: { type: 'Point', coordinates: [lon, lat] }, properties: props }
}

const sample = {
  type: 'FeatureCollection',
  features: [
    feature(
      { label: 'Strasbourg', type: 'municipality', depcode: '67', context: '67, Bas-Rhin, Grand Est' },
      7.7521,
      48.5734
    ),
    feature(
      { label: 'Saint-Martin 97150', type: 'municipality', depcode: '978', context: 'Saint-Martin' },
      -63.05,
      18.07
    ),
    feature({ label: 'Saint-Denis 97400', type: 'municipality', depcode: '974' }, 55.45, -20.88),
    feature({ label: 'Ajaccio', type: 'municipality', depcode: '2A' }, 8.7369, 41.9267),
    feature({ label: '1 Place Kléber 67000 Strasbourg', type: 'housenumber', depcode: '67' }, 7.7458, 48.5834)
  ]
}

describe('parseGeocodeResponse', () => {
  it('garde la métropole et la Corse, écarte l’outre-mer', () => {
    const places = parseGeocodeResponse(sample)
    expect(places.map((p) => p.label)).toEqual([
      'Strasbourg',
      'Ajaccio',
      '1 Place Kléber 67000 Strasbourg'
    ])
  })

  it('lit les coordonnées dans l’ordre longitude, latitude', () => {
    const [strasbourg] = parseGeocodeResponse(sample)
    expect(strasbourg.lat).toBeCloseTo(48.5734)
    expect(strasbourg.lon).toBeCloseTo(7.7521)
  })

  it('ignore une réponse mal formée', () => {
    expect(parseGeocodeResponse(null)).toEqual([])
    expect(parseGeocodeResponse({ features: 'x' })).toEqual([])
    expect(parseGeocodeResponse({ features: [{ properties: {} }] })).toEqual([])
  })

  it('remplace un type inconnu par lieu-dit', () => {
    const [p] = parseGeocodeResponse({
      features: [feature({ label: 'X', type: 'poi', depcode: '67' }, 7.7, 48.5)]
    })
    expect(p.kind).toBe('locality')
  })
})

describe('geocode', () => {
  const okFetch = (body: unknown) => async () => new Response(JSON.stringify(body), { status: 200 })

  it('renvoie les lieux trouvés', async () => {
    const r = await geocode('Strasbourg', okFetch(sample))
    expect(r.status).toBe('ok')
    if (r.status === 'ok') expect(r.places).toHaveLength(3)
  })

  it('ne lance pas de requête sous 3 caractères', async () => {
    let called = false
    const r = await geocode('  ab ', async () => {
      called = true
      return new Response('{}')
    })
    expect(r.status).toBe('empty')
    expect(called).toBe(false)
  })

  it('signale aucun résultat quand tout est hors métropole', async () => {
    const r = await geocode('Saint-Denis 974', okFetch({ features: [sample.features[2]] }))
    expect(r.status).toBe('empty')
  })

  it('signale une erreur réseau', async () => {
    const r = await geocode('Strasbourg', async () => {
      throw new TypeError('Failed to fetch')
    })
    expect(r.status).toBe('network-error')
  })

  it('signale une erreur du service', async () => {
    const r = await geocode('Strasbourg', async () => new Response('oops', { status: 503 }))
    expect(r).toEqual({ status: 'service-error', httpStatus: 503 })
  })

  it('encode la requête dans l’URL', async () => {
    let seen = ''
    await geocode('1 place Kléber & co', async (url) => {
      seen = url
      return new Response(JSON.stringify({ features: [] }))
    })
    expect(seen).toContain('q=1%20place%20Kl%C3%A9ber%20%26%20co')
  })
})
