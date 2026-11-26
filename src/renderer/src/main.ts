import './style.css'
import { kindLabel, type Place } from './domain/place'
import { loadLastPlace, saveLastPlace } from './services/storage'
import { setupCalendar } from './ui/calendar'
import { createMap } from './ui/map'
import { setupSearch } from './ui/search'

function byId<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id)
  if (!el) throw new Error(`Élément #${id} introuvable`)
  return el as T
}

const currentLabel = byId<HTMLParagraphElement>('current-label')
const currentMeta = byId<HTMLParagraphElement>('current-meta')

function showCurrent(place: Place): void {
  currentLabel.textContent = place.label
  currentMeta.textContent = [
    kindLabel(place.kind),
    `${place.lat.toFixed(5)}° N, ${place.lon.toFixed(5)}° ${place.lon >= 0 ? 'E' : 'O'}`
  ].join(' · ')
}

const initial = loadLastPlace()
const placeMap = createMap(byId('map'), initial)
showCurrent(initial)

const calendar = setupCalendar(
  {
    title: byId('cal-month'),
    prev: byId('cal-prev'),
    next: byId('cal-next'),
    today: byId('cal-today'),
    grid: byId('cal-grid'),
    detail: byId('night-detail')
  },
  initial
)

setupSearch(
  {
    form: byId('search-form'),
    input: byId('search-input'),
    button: byId('search-button'),
    message: byId('search-message'),
    results: byId('search-results')
  },
  (place) => {
    placeMap.showPlace(place)
    showCurrent(place)
    calendar.setPlace(place)
    saveLastPlace(place)
  }
)
