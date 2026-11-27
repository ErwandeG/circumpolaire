import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { zoomFor, type Place } from '../domain/place'
import {
  LP_BOUNDS,
  LP_CREDIT,
  LP_MAP_IMAGE,
  isLightPollutionOn,
  onLightPollutionChange,
  setLightPollutionOn
} from '../services/lightPollutionMap'

/** Plan IGN v2, servi par la Géoplateforme en WMTS (gratuit, sans clé). */
export const PLAN_IGN_URL =
  'https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0' +
  '&LAYER=GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2&STYLE=normal&TILEMATRIXSET=PM' +
  '&FORMAT=image/png&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}'

export interface PlaceMap {
  showPlace(place: Place): void
}

export function createMap(
  container: HTMLElement,
  initial: Place,
  onPick: (lat: number, lon: number) => void
): PlaceMap {
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

  // La carte se recale quand son conteneur change de taille (fenêtre redimensionnée).
  new ResizeObserver(() => map.invalidateSize()).observe(container)

  // Un cercle plutôt qu'une icône image : pas de fichier à embarquer.
  const marker = L.circleMarker([initial.lat, initial.lon], {
    radius: 8,
    color: '#ffffff',
    weight: 2,
    fillColor: '#2563eb',
    fillOpacity: 1
  }).addTo(map)
  marker.bindTooltip(initial.label)

  map.on('click', (e: L.LeafletMouseEvent) => onPick(e.latlng.lat, e.latlng.lng))

  // Pollution lumineuse : couche de l'atlas et interrupteur, en haut à droite de la carte.
  const lpLayer = L.imageOverlay(
    LP_MAP_IMAGE,
    L.latLngBounds([LP_BOUNDS.south, LP_BOUNDS.west], [LP_BOUNDS.north, LP_BOUNDS.east]),
    { opacity: 0.85, interactive: false, attribution: LP_CREDIT }
  )
  const LpControl = L.Control.extend({
    onAdd() {
      const box = L.DomUtil.create('div', 'lp-control')
      box.innerHTML =
        '<span class="lp-label">Pollution lumineuse</span>' +
        '<button class="switch" type="button" role="switch" aria-checked="false" aria-label="Pollution lumineuse" ' +
        'title="Atlas de David Lorenz (2025) : affiché sur la carte, et pris en compte dans la vue 3D (étoiles visibles, lueur à l’horizon)">' +
        '<span class="switch-knob"></span></button>'
      L.DomEvent.disableClickPropagation(box)
      const sw = box.querySelector('button')!
      sw.addEventListener('click', () => setLightPollutionOn(!isLightPollutionOn()))
      const show = (on: boolean) => {
        sw.setAttribute('aria-checked', String(on))
        if (on) lpLayer.addTo(map)
        else lpLayer.remove()
      }
      onLightPollutionChange(show)
      show(isLightPollutionOn())
      return box
    }
  })
  new LpControl({ position: 'topright' }).addTo(map)

  return {
    showPlace(place) {
      marker.setLatLng([place.lat, place.lon])
      marker.setTooltipContent(place.label)
      map.flyTo([place.lat, place.lon], zoomFor(place.kind), { duration: 0.8 })
    }
  }
}
