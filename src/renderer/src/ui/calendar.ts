import { computeMonth, TRANCHE_LABELS, type NightInfo } from '../domain/calendar'
import type { Place } from '../domain/place'
import {
  formatParisTime,
  monthName,
  nightTitle,
  parisDayOf,
  sameDay,
  weekdayMondayFirst,
  type CalendarDay
} from '../domain/time'

interface CalendarElements {
  title: HTMLElement
  prev: HTMLButtonElement
  next: HTMLButtonElement
  today: HTMLButtonElement
  grid: HTMLElement
  detail: HTMLElement
}

export interface MoonCalendar {
  setPlace(place: Place): void
  /** Nuit sélectionnée (aujourd'hui par défaut). */
  selectedNight(): CalendarDay
}

const WEEKDAYS = ['L', 'M', 'M', 'J', 'V', 'S', 'D']

const WINDOW_LABELS = {
  astronomical: 'Nuit astronomique',
  nautical: 'Nuit nautique (nuit astronomique absente ou de moins d’1 h)'
} as const

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

/** Barre de présence : fond = Lune couchée, segments clairs = Lune levée. */
function presenceBar(night: NightInfo): HTMLElement | null {
  if (night.window.kind === 'none' || !night.moon) return null
  const bar = el('span', 'presence')
  const start = night.window.start.getTime()
  const span = night.window.end.getTime() - start
  for (const i of night.moon.intervals) {
    const seg = el('span', 'presence-moon')
    seg.style.left = `${((i.from.getTime() - start) / span) * 100}%`
    seg.style.width = `${((i.to.getTime() - i.from.getTime()) / span) * 100}%`
    bar.append(seg)
  }
  return bar
}

function presenceText(night: NightInfo): string[] {
  if (night.window.kind === 'none' || !night.moon) {
    return ['Pas de nuit noire : la présence de la Lune n’est pas évaluée.']
  }
  const m = night.moon
  if (m.state === 'absent') return ['Lune couchée toute la nuit.']
  if (m.state === 'present') return ['Lune levée toute la nuit.']
  const lines = m.intervals.map(
    (i) => `Lune levée de ${formatParisTime(i.from)} à ${formatParisTime(i.to)}.`
  )
  const events = [
    ...m.rises.map((t) => ({ t, label: 'lever' })),
    ...m.sets.map((t) => ({ t, label: 'coucher' }))
  ].sort((a, b) => a.t.getTime() - b.t.getTime())
  if (events.length > 0) {
    lines.push(events.map((e) => `${e.label} ${formatParisTime(e.t)}`).join(', ').replace(/^./, (c) => c.toUpperCase()) + '.')
  }
  return lines
}

export function setupCalendar(
  elements: CalendarElements,
  initialPlace: Place,
  onOpenSky: (night: CalendarDay) => void
): MoonCalendar {
  const today = parisDayOf(new Date())
  let place = initialPlace
  let view = { year: today.year, month: today.month }
  let selected: CalendarDay = today
  let nights: NightInfo[] = []

  function compute(): void {
    nights = computeMonth(view.year, view.month, place.lat, place.lon)
  }

  function renderDetail(): void {
    const night = nights.find((n) => sameDay(n.day, selected))
    const d = elements.detail
    d.replaceChildren()
    if (!night) {
      d.append(el('p', 'detail-empty', 'Choisissez une nuit dans le calendrier.'))
      return
    }
    d.append(el('h3', 'detail-title', nightTitle(night.day)))

    const w = night.window
    d.append(
      el(
        'p',
        'detail-line',
        w.kind === 'none'
          ? 'Pas de nuit noire : le Soleil ne descend pas sous −12°.'
          : `${WINDOW_LABELS[w.kind]} : ${formatParisTime(w.start)} → ${formatParisTime(w.end)}`
      )
    )

    const illum = el('p', 'detail-line')
    const swatch = el('span', `swatch tranche-${night.tranche}`)
    illum.append(
      swatch,
      document.createTextNode(
        ` Lune éclairée à ${Math.round(night.illumination * 100)} % (tranche ${TRANCHE_LABELS[night.tranche]})`
      )
    )
    d.append(illum)

    for (const line of presenceText(night)) d.append(el('p', 'detail-line', line))

    const open = el('button', 'detail-action', 'Voir le ciel cette nuit depuis le lieu de calcul')
    open.type = 'button'
    open.addEventListener('click', () => onOpenSky(night.day))
    d.append(open)
    d.append(el('p', 'detail-hint', 'Ou cliquez sur la carte pour choisir le point de vue exact.'))
  }

  function render(): void {
    elements.title.textContent = `${monthName(view.month)} ${view.year}`
    const grid = elements.grid
    grid.replaceChildren(...WEEKDAYS.map((w) => el('span', 'weekday', w)))

    const offset = weekdayMondayFirst({ year: view.year, month: view.month, day: 1 })
    for (let i = 0; i < offset; i++) grid.append(el('span', 'day-blank'))

    for (const night of nights) {
      const btn = el('button', `day tranche-${night.tranche}`)
      btn.type = 'button'
      if (sameDay(night.day, today)) btn.classList.add('is-today')
      if (sameDay(night.day, selected)) btn.classList.add('is-selected')
      btn.setAttribute('aria-label', `${nightTitle(night.day)}, Lune éclairée à ${Math.round(night.illumination * 100)} %`)
      btn.append(el('span', 'day-num', String(night.day.day)))
      if (night.window.kind === 'nautical') {
        const badge = el('span', 'day-badge', 'N')
        badge.title = 'Nuit nautique : nuit astronomique absente ou de moins d’1 h'
        btn.append(badge)
      }
      const bar = presenceBar(night)
      if (bar) btn.append(bar)
      btn.addEventListener('click', () => {
        selected = night.day
        render()
      })
      grid.append(btn)
    }
    renderDetail()
  }

  function goToMonth(delta: number): void {
    const d = new Date(Date.UTC(view.year, view.month - 1 + delta, 1))
    view = { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1 }
    compute()
    render()
  }

  elements.prev.addEventListener('click', () => goToMonth(-1))
  elements.next.addEventListener('click', () => goToMonth(1))
  elements.today.addEventListener('click', () => {
    view = { year: today.year, month: today.month }
    selected = today
    compute()
    render()
  })

  compute()
  render()

  return {
    setPlace(p) {
      place = p
      compute()
      render()
    },
    selectedNight: () => selected
  }
}
