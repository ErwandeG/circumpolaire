import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { zoomFor, type Place } from '../domain/place'

/** Plan IGN v2, servi par la Géoplateforme en WMTS (gratuit, sans clé). */
const PLAN_IGN_URL =
  'https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0' +
  '&LAYER=GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2&STYLE=normal&TILEMATRIXSET=PM' +
  '&FORMAT=image/png&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}'

export interface PlaceMap {
  showPlace(place: Place): void
}

export function createMap(container: HTMLElement, initial: Place): PlaceMap {
  const map = L.map(container, {
    center: [initial.lat, initial.lon],
    zoom: zoomFor(initial.kind),
    minZoom: 5,
    maxZoom: 19,
    // La métropole et un peu de marge : on ne se perd pas au milieu de l'océan.
    maxBounds: L.latLngBounds([39.5, -9], [53, 13]),
    maxBoundsViscosity: 0.8
  })

  L.tileLayer(PLAN_IGN_URL, {
    maxZoom: 19,
    tileSize: 256,
    attribution:
      '<a href="https://www.ign.fr/" target="_blank" rel="noopener">© IGN</a> — Plan IGN'
  }).addTo(map)

  L.control.scale({ imperial: false }).addTo(map)

  // Un cercle plutôt qu'une icône image : pas de fichier à embarquer.
  const marker = L.circleMarker([initial.lat, initial.lon], {
    radius: 8,
    color: '#ffffff',
    weight: 2,
    fillColor: '#2563eb',
    fillOpacity: 1
  }).addTo(map)
  marker.bindTooltip(initial.label)

  return {
    showPlace(place) {
      marker.setLatLng([place.lat, place.lon])
      marker.setTooltipContent(place.label)
      map.flyTo([place.lat, place.lon], zoomFor(place.kind), { duration: 0.8 })
    }
  }
}
