import L from 'leaflet'
import { fromLocal, localFrame, stepToward } from '../../domain/geo/local'
import { SCENE_RADIUS_M } from '../../domain/terrain'
import { PLAN_IGN_URL } from '../map'

export interface MiniMap {
  /** Position de l'observateur, direction visée et champ horizontal (degrés). */
  update(lat: number, lon: number, azimuthDeg: number, hFovDeg: number): void
  /** Cercle des volumes 3D : le point d'où les bâtiments ont été chargés, et son rayon. */
  setZone(lat: number, lon: number, radiusM: number): void
  /** À appeler quand la carte redevient visible. */
  refresh(lat: number, lon: number): void
}

const CONE_LENGTH_M = 45

/**
 * Petite carte de la vue du ciel : où l'on est, ce que l'on vise, la zone des bâtiments.
 * Repliable ; un clic dessus déplace le point de vue.
 */
export function createMiniMap(
  box: HTMLElement,
  container: HTMLElement,
  toggle: HTMLButtonElement,
  onPick: (lat: number, lon: number) => void,
  startCollapsed = false,
  onToggle: (collapsed: boolean) => void = () => {}
): MiniMap {
  const map = L.map(container, {
    zoomControl: false,
    attributionControl: false,
    // Assez de dézoom pour situer le relief lointain (jusqu'à 200 km).
    minZoom: 7,
    maxZoom: 19
  }).setView([48.5734, 7.7521], 18)
  L.tileLayer(PLAN_IGN_URL, { maxZoom: 19 }).addTo(map)
  L.control.zoom({ position: 'topright' }).addTo(map)

  const zone = L.circle([0, 0], {
    radius: SCENE_RADIUS_M,
    color: '#60a5fa',
    weight: 1,
    dashArray: '4 4',
    fillOpacity: 0.04,
    interactive: false
  }).addTo(map)
  const cone = L.polygon([], {
    color: '#f59e0b',
    weight: 1,
    fillColor: '#f59e0b',
    fillOpacity: 0.25,
    interactive: false
  }).addTo(map)
  const marker = L.circleMarker([0, 0], {
    radius: 6,
    color: '#ffffff',
    weight: 2,
    fillColor: '#2563eb',
    fillOpacity: 1,
    interactive: false
  }).addTo(map)

  map.on('click', (e: L.LeafletMouseEvent) => onPick(e.latlng.lat, e.latlng.lng))

  let zoneCenter: [number, number] | null = null
  let last: { lat: number; lon: number; azimuth: number; hFov: number } | null = null

  /**
   * Cône de visée : sa longueur suit le zoom de la carte (environ 35 % de la hauteur visible),
   * pour rester lisible de près comme de loin.
   */
  function drawCone(): void {
    if (!last) return
    const { lat, lon, azimuth, hFov } = last
    const b = map.getBounds()
    const visibleHeightM = map.distance(b.getNorthWest(), b.getSouthWest())
    const length = Math.max(CONE_LENGTH_M, 0.35 * visibleHeightM)
    const f = localFrame(lat, lon)
    const half = Math.min(85, hFov / 2)
    const pts: L.LatLngExpression[] = [[lat, lon]]
    for (let a = -half; a <= half + 0.01; a += half / 6) {
      const d = stepToward(azimuth + a, length, 0)
      const p = fromLocal(f, d.e, d.n)
      pts.push([p.lat, p.lon])
    }
    cone.setLatLngs(pts)
  }
  map.on('zoomend', drawCone)

  const api: MiniMap = {
    update(lat, lon, azimuthDeg, hFovDeg) {
      marker.setLatLng([lat, lon])
      // Le cercle des volumes 3D reste centré sur le point de chargement des bâtiments.
      if (!zoneCenter) zoneCenter = [lat, lon]
      zone.setLatLng(zoneCenter)
      last = { lat, lon, azimuth: azimuthDeg, hFov: hFovDeg }
      // On recentre seulement quand le point sort du cœur de la carte.
      const inner = map.getBounds().pad(-0.3)
      if (!inner.contains([lat, lon])) map.panTo([lat, lon], { animate: false })
      drawCone()
    },
    setZone(lat, lon, radiusM) {
      zoneCenter = [lat, lon]
      zone.setLatLng(zoneCenter)
      zone.setRadius(radiusM)
    },
    refresh(lat, lon) {
      map.invalidateSize()
      map.setView([lat, lon], map.getZoom(), { animate: false })
    }
  }

  const applyCollapsed = (collapsed: boolean) => {
    box.classList.toggle('is-collapsed', collapsed)
    toggle.setAttribute('aria-expanded', String(!collapsed))
    toggle.textContent = collapsed ? 'Carte ▴' : 'Carte ▾'
    if (!collapsed) setTimeout(() => map.invalidateSize(), 0)
  }
  applyCollapsed(startCollapsed)
  toggle.addEventListener('click', () => {
    const collapsed = !box.classList.contains('is-collapsed')
    applyCollapsed(collapsed)
    onToggle(collapsed)
  })

  return api
}
