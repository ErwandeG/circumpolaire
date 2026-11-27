import './style.css'
import { kindLabel, type Place } from './domain/place'
import type { CalendarDay } from './domain/time'
import { checkPointInFrance } from './services/geocoding'
import { loadLastPlace, saveLastPlace } from './services/storage'
import { setupCalendar } from './ui/calendar'
import { createMap } from './ui/map'
import { setupSearch } from './ui/search'
import { setupSkyView, type Observer } from './ui/sky/skyView'
import { setupSidebar } from './ui/sidebar'
import { cacheClear, cacheStats } from './services/cache'

function byId<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id)
  if (!el) throw new Error(`Élément #${id} introuvable`)
  return el as T
}

const currentLabel = byId<HTMLParagraphElement>('current-label')
const currentMeta = byId<HTMLParagraphElement>('current-meta')
const mapEl = byId('map')
const mapHint = byId('map-hint')
const HINT = 'Cliquez sur la carte pour voir le ciel depuis ce point.'

function showCurrent(place: Place): void {
  currentLabel.textContent = place.label
  currentMeta.textContent = [
    kindLabel(place.kind),
    `${place.lat.toFixed(5)}° N, ${place.lon.toFixed(5)}° ${place.lon >= 0 ? 'E' : 'O'}`
  ].join(' · ')
}

let currentPlace = loadLastPlace()
showCurrent(currentPlace)

// --- Panneau de gauche : largeur réglable, onglets en vue 3D ---
const sidebar = setupSidebar({
  app: document.querySelector<HTMLElement>('.app')!,
  resizer: byId('panel-resizer'),
  toggle: byId('panel-toggle'),
  tabs: byId('panel-tabs'),
  tabPlace: byId('tab-place'),
  tabSettings: byId('tab-settings'),
  panePlace: byId('pane-place'),
  paneSettings: byId('pane-settings')
})

// --- Vue du ciel ---
const sky = setupSkyView(
  {
    root: byId('sky'),
    back: byId('sky-back'),
    pole: byId('sky-pole'),
    moon: byId('sky-moon'),
    exportButton: byId('sky-export'),
    place: byId('sky-place'),
    coords: byId('sky-coords'),
    terrain: byId('sky-terrain'),
    stage: byId('sky-stage'),
    frame: byId('sky-frame'),
    canvas: byId('sky-canvas'),
    hud: byId('sky-hud'),
    warnings: byId('sky-warnings'),
    focal: byId('focal'),
    focalNum: byId('focal-num'),
    duration: byId('duration'),
    durationNum: byId('duration-num'),
    stars: byId('stars'),
    starsNum: byId('stars-num'),
    starsOut: byId('stars-out'),
    starsLp: byId('stars-lp'),
    focalEq: byId('focal-eq'),
    eye: byId('eye'),
    eyeNum: byId('eye-num'),
    roll: byId('roll'),
    rollNum: byId('roll-num'),
    treesOn: byId('trees-on'),
    hdOn: byId('hd-on'),
    lpOn: byId('lp-on'),
    reliefOn: byId('relief-on'),
    reliefDist: byId('relief-dist'),
    reliefDistNum: byId('relief-dist-num'),
    busy: byId('sky-busy'),
    busyText: byId('sky-busy-text'),
    radius50: byId('radius-50'),
    radius150: byId('radius-150'),
    radius500: byId('radius-500'),
    sensor: byId('sensor'),
    landscape: byId('orient-landscape'),
    portrait: byId('orient-portrait'),
    date: byId('sky-date'),
    time: byId('sky-time'),
    miniMapBox: byId('minimap-box'),
    miniMap: byId('minimap'),
    miniMapToggle: byId('minimap-toggle'),
    panel: document.querySelector<HTMLElement>('.app')!,
    panelToggle: byId('panel-toggle'),
    panelSummary: byId('sky-panel-summary')
  },
  () => {
    mapEl.hidden = false
    mapHint.hidden = false
    sidebar.setSkyMode(false)
  }
)

// --- Cache disque : taille affichée dans l'onglet Réglages, bouton pour le vider ---
const cacheSize = byId('cache-size')
const formatBytes = (b: number) =>
  b >= 1e9 ? `${(b / 1e9).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} Go` : `${Math.round(b / 1e6)} Mo`
async function showCacheSize(): Promise<void> {
  cacheSize.textContent = formatBytes((await cacheStats()).bytes)
}
byId('cache-clear').addEventListener('click', async () => {
  const { bytes } = await cacheStats()
  if (!window.confirm(`Vider le cache (${formatBytes(bytes)}) ? Les zones déjà vues seront de nouveau téléchargées.`)) return
  await cacheClear()
  void showCacheSize()
})
byId('tab-settings').addEventListener('click', () => void showCacheSize())

function openSky(observer: Observer, night: CalendarDay): void {
  void showCacheSize()
  mapEl.hidden = true
  mapHint.hidden = true
  sidebar.setSkyMode(true)
  sky.open(observer, night)
}

// --- Calendrier ---
const calendar = setupCalendar(
  {
    title: byId('cal-month'),
    prev: byId('cal-prev'),
    next: byId('cal-next'),
    today: byId('cal-today'),
    grid: byId('cal-grid'),
    detail: byId('night-detail')
  },
  currentPlace,
  (night) => openSky({ lat: currentPlace.lat, lon: currentPlace.lon, label: currentPlace.label }, night)
)

// --- Carte : un clic ouvre la vue depuis ce point ---
let hintTimer: ReturnType<typeof setTimeout> | undefined
function flashHint(text: string, tone: 'info' | 'error'): void {
  mapHint.textContent = text
  mapHint.dataset.tone = tone
  clearTimeout(hintTimer)
  hintTimer = setTimeout(() => {
    mapHint.textContent = HINT
    delete mapHint.dataset.tone
  }, 4000)
}

const placeMap = createMap(mapEl, currentPlace, async (lat, lon) => {
  flashHint('Vérification du point…', 'info')
  const check = await checkPointInFrance(lat, lon)
  if (check.status === 'outside') {
    flashHint('Ce point est hors de France métropolitaine : choisissez un point en France.', 'error')
    return
  }
  mapHint.textContent = HINT
  delete mapHint.dataset.tone
  const label = check.status === 'inside' && check.label ? `Près de ${check.label}` : 'Point choisi sur la carte'
  openSky({ lat, lon, label }, calendar.selectedNight())
})

// --- Recherche ---
setupSearch(
  {
    form: byId('search-form'),
    input: byId('search-input'),
    button: byId('search-button'),
    message: byId('search-message'),
    results: byId('search-results')
  },
  (place) => {
    currentPlace = place
    placeMap.showPlace(place)
    showCurrent(place)
    calendar.setPlace(place)
    saveLastPlace(place)
  }
)
