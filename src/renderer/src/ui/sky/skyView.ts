import { nightWindow } from '../../domain/astro/night'
import { enuToAltAz, moonState, northCelestialPole } from '../../domain/astro/sky'
import {
  DURATION_MAX,
  DURATION_MIN,
  FOCAL_MAX_MM,
  FOCAL_MIN_MM,
  SENSORS,
  eyeFromSlider,
  fieldOfView,
  focalFromSlider,
  focalAfterWheel,
  frameSize,
  reliefFromSlider,
  sensorById,
  sliderFromEye,
  sliderFromFocal,
  sliderFromRelief
} from '../../domain/optics'
import { formatParisTime, parisDayOf, parisTime, type CalendarDay } from '../../domain/time'
import type { SceneRadius } from '../../domain/terrain'
import {
  DEFAULT_PREFERENCES,
  clampEyeHeight,
  clampReliefDistance
} from '../../domain/preferences'
import { loadPreferences, savePreferences } from '../../services/storage'
import { EXPORT_LONG_SIDE_PX, composeCapture, saveCapture } from './exportImage'
import { createMiniMap } from './miniMap'
import { SkyScene } from './scene'
import { createSceneLoader } from './sceneLoader'
import {
  PROCESSING_LABELS,
  PROCESSING_HELP,
  LP_LEVELS,
  skyClassLabel,
  naturalSky,
  skyQuality,
  trailLimit,
  trailWidthArcsec,
  type Processing,
  type SkyQuality
} from '../../domain/lightPollution'
import { StarField, type StarRow } from '../../domain/astro/sky'
import {
  isLightPollutionOn,
  lightPollutionLevel,
  onLightPollutionChange,
  setLightPollutionOn
} from '../../services/lightPollutionMap'
import { setupMovement } from './movement'
import { createSkyState, toPreferences, type Observer } from './skyState'
import { allStars, polarisIndex, trailSamples } from './starCatalog'
import {
  captureFileName,
  captureInfo,
  exposureWarnings,
  focalEquivalentText,
  fmt1,
  hudLine,
  pad,
  settingsSummary
} from './skyText'
import { bindNumber as bindNumberWith, setNum, setupResets } from './controls'

export type { Observer } from './skyState'

interface SkyElements {
  root: HTMLElement
  back: HTMLButtonElement
  pole: HTMLButtonElement
  moon: HTMLButtonElement
  exportButton: HTMLButtonElement
  place: HTMLElement
  coords: HTMLElement
  terrain: HTMLElement
  stage: HTMLElement
  frame: HTMLElement
  canvas: HTMLCanvasElement
  hud: HTMLElement
  warnings: HTMLElement
  focal: HTMLInputElement
  focalNum: HTMLInputElement
  duration: HTMLInputElement
  durationNum: HTMLInputElement
  starsOut: HTMLOutputElement
  starsLp: HTMLElement
  starsDelta: HTMLElement
  skyClass: HTMLElement
  skyGaugeMark: HTMLElement
  procHelp: HTMLElement
  focalEq: HTMLOutputElement
  eye: HTMLInputElement
  eyeNum: HTMLInputElement
  roll: HTMLInputElement
  rollNum: HTMLInputElement
  treesOn: HTMLButtonElement
  hdOn: HTMLButtonElement
  lpOn: HTMLButtonElement
  procRaw: HTMLButtonElement
  procStandard: HTMLButtonElement
  procPushed: HTMLButtonElement
  reliefOn: HTMLButtonElement
  reliefDist: HTMLInputElement
  reliefDistNum: HTMLInputElement
  busy: HTMLElement
  busyText: HTMLElement
  radius50: HTMLButtonElement
  radius150: HTMLButtonElement
  radius500: HTMLButtonElement
  sensor: HTMLSelectElement
  landscape: HTMLButtonElement
  portrait: HTMLButtonElement
  date: HTMLInputElement
  time: HTMLInputElement
  miniMapBox: HTMLElement
  miniMap: HTMLElement
  miniMapToggle: HTMLButtonElement
  panel: HTMLElement
  panelToggle: HTMLButtonElement
  panelSummary: HTMLElement
}

export interface SkyView {
  open(observer: Observer, night: CalendarDay): void
}

export function setupSkyView(el: SkyElements, onClose: () => void): SkyView {
  const scene = new SkyScene(el.canvas)
  const prefs = loadPreferences()
  const state = createSkyState(prefs, allStars.length)

  // --- Indicateur de chargement : visible tant qu'une tâche est en cours ---
  // Une ligne par chargement : libellé et barre (avancement de 0 à 1, ou bande animée s'il est inconnu).
  const busyRows = new Map<string, { label: string; fraction?: number; working?: boolean }>()
  function setBusy(key: string, label: string | null, fraction?: number, working?: boolean): void {
    if (label) busyRows.set(key, { label, fraction, working })
    else busyRows.delete(key)
    el.busy.hidden = busyRows.size === 0
    el.busyText.replaceChildren(
      ...[...busyRows.values()].map(({ label: text, fraction: f, working }) => {
        const row = document.createElement('div')
        row.className = 'busy-row'
        const name = document.createElement('span')
        name.className = 'busy-label'
        name.textContent = f === undefined ? text : `${text} · ${Math.round(f * 100)} %`
        const track = document.createElement('div')
        // Calcul en cours sans avancement mesurable : la barre reste en place et scintille.
        track.className = f === undefined ? 'progress is-indeterminate' : working ? 'progress is-working' : 'progress'
        const bar = document.createElement('div')
        bar.className = 'progress-bar'
        if (f !== undefined) bar.style.width = `${Math.round(Math.min(1, Math.max(0, f)) * 100)}%`
        track.append(bar)
        row.append(name, track)
        return row
      })
    )
  }

  // Les réglages sont enregistrés peu après chaque changement, pour le lancement suivant.
  let saveTimer: ReturnType<typeof setTimeout> | undefined
  function rememberSettings(): void {
    clearTimeout(saveTimer)
    saveTimer = setTimeout(() => savePreferences(toPreferences(state)), 300)
  }

  for (const s of SENSORS) {
    const opt = document.createElement('option')
    opt.value = s.id
    opt.textContent = s.label
    el.sensor.append(opt)
  }
  el.sensor.addEventListener('change', () => {
    state.sensorId = sensorById(el.sensor.value).id
    scheduleSky()
    rememberSettings()
    syncInputs()
    layout()
  })

  const sensor = () => sensorById(state.sensorId)
  const frame = () => frameSize(sensor(), state.orientation)
  const fov = () => ({
    h: fieldOfView(frame().width, state.focalMm),
    v: fieldOfView(frame().height, state.focalMm)
  })

  // --- Pollution lumineuse du lieu (interrupteur de la carte principale) ---
  let lp: SkyQuality | null = null
  /**
   * Étoiles affichées : celles du réglage dont le filé ressort du fond de ciel sur la photo,
   * selon leur déclinaison, la brillance du ciel, la focale, le capteur et le traitement.
   * Sans pollution lumineuse activée : toutes celles du réglage.
   */
  const visibleCache = new Map<string, { rows: StarRow[]; field: StarField; polaris: number }>()
  function visibleStars(): { rows: StarRow[]; field: StarField; polaris: number } {
    const width = trailWidthArcsec(state.focalMm, sensorById(state.sensorId).widthMm)
    const key = `${sky().sqm.toFixed(2)}|${width.toFixed(1)}|${state.processing}`
    let v = visibleCache.get(key)
    if (!v) {
      const rows: StarRow[] = []
      let polaris = -1
      // Tout le catalogue (jusqu'à la magnitude 8) : c'est le calcul qui décide, pas un plafond.
      for (let i = 0; i < allStars.length; i++) {
        const r = allStars[i]
        // La Polaire reste affichée : c'est le repère de la composition.
        if (i === polarisIndex) polaris = rows.length
        if (i === polarisIndex || r[2] <= trailLimit(sky().sqm, r[1], width, state.processing)) rows.push(r)
      }
      v = { rows, field: new StarField(rows), polaris }
      if (visibleCache.size > 12) visibleCache.clear()
      visibleCache.set(key, v)
    }
    return v
  }
  /** Magnitude limite d'un filé à une déclinaison donnée, pour le détail sous le curseur. */
  const trailLimitAt = (dec: number) =>
    trailLimit(sky().sqm, dec, trailWidthArcsec(state.focalMm, sensorById(state.sensorId).widthMm), state.processing)
  /** Ciel du lieu si la pollution lumineuse est activée, ciel naturel sinon. */
  const sky = () => lp ?? naturalSky()
  let visibleCount = state.starCount
  async function updateLightPollution(): Promise<void> {
    const { lat, lon } = state.observer
    const level = isLightPollutionOn() ? await lightPollutionLevel(lat, lon) : null
    lp = level === null ? null : skyQuality(level)
    scene.setSkyGlow(lp?.glow ?? 0)
    recomputeSky()
    draw()
  }
  // Traitement de l'image : seuil de visibilité des filés.
  const procButtons: [HTMLButtonElement, Processing][] = [
    [el.procRaw, 'raw'],
    [el.procStandard, 'standard'],
    [el.procPushed, 'pushed']
  ]
  for (const [button, value] of procButtons) {
    button.addEventListener('click', () => {
      if (state.processing === value) return
      const before = visibleCount
      state.processing = value
      rememberSettings()
      syncInputs()
      recomputeSky()
      showStarsDelta(visibleCount - before)
      draw()
    })
  }
  // Écart du nombre d'étoiles après un changement de post-traitement, affiché quelques secondes.
  let deltaTimer = 0
  function showStarsDelta(delta: number): void {
    window.clearTimeout(deltaTimer)
    el.starsDelta.hidden = delta === 0
    el.starsDelta.textContent = `${delta > 0 ? '+' : '−'}${Math.abs(delta).toLocaleString('fr-FR')}`
    el.starsDelta.classList.toggle('down', delta < 0)
    deltaTimer = window.setTimeout(() => (el.starsDelta.hidden = true), 4000)
  }

  // Boutons « ? » : un clic déplie ou replie l'explication sous le réglage.
  for (const button of document.querySelectorAll<HTMLButtonElement>('button.help[aria-controls]')) {
    const help = document.getElementById(button.getAttribute('aria-controls') ?? '')
    if (!help) continue
    button.addEventListener('click', () => {
      help.hidden = !help.hidden
      button.setAttribute('aria-expanded', String(!help.hidden))
    })
  }

  // Même réglage que l'interrupteur de la carte principale : les deux restent synchronisés.
  el.lpOn.addEventListener('click', () => setLightPollutionOn(!isLightPollutionOn()))
  onLightPollutionChange((on) => {
    el.lpOn.setAttribute('aria-checked', String(on))
    el.starsDelta.hidden = true
    syncInputs()
    void updateLightPollution()
  })

  // --- Calculs du ciel (seulement quand le lieu, l'heure ou la durée changent) ---
  let moonInfo = { fraction: 0, altitude: 0, azimuth: 0 }
  function recomputeSky(): void {
    const { lat, lon } = state.observer
    // Pollution lumineuse : seules les étoiles dont le filé ressort du fond de ciel sont affichées.
    const { rows: stars, field, polaris } = visibleStars()
    visibleCount = stars.length
    const samples = trailSamples(state.durationMin, Math.max(1, stars.length))
    const starStart = field.trails(state.start, 0, 1, lat, lon)
    const trails = field.trails(state.start, state.durationMin, samples, lat, lon)
    const moon = moonState(state.start, state.durationMin, Math.min(samples, 25), lat, lon)
    const moonPos = enuToAltAz(moon.direction)
    moonInfo = { fraction: moon.illuminatedFraction, altitude: moonPos.altitude, azimuth: moonPos.azimuth }
    el.moon.disabled = moonPos.altitude < -1
    el.moon.title = el.moon.disabled ? 'La Lune est sous l’horizon au début de la pose' : ''
    scene.setContent({
      stars,
      starStart,
      trails,
      samples,
      polarisIndex: polaris,
      pole: northCelestialPole(state.start, lat, lon),
      moon
    })
    renderWarnings()
  }

  // --- Cadre : le canevas a exactement le rapport du capteur, centré dans la zone ---
  function layout(): void {
    const { width: fw, height: fh } = frame()
    const aspect = fw / fh
    const box = el.stage.getBoundingClientRect()
    const maxW = Math.max(100, box.width - 24)
    const maxH = Math.max(100, box.height - 24)
    let w = maxW
    let h = w / aspect
    if (h > maxH) {
      h = maxH
      w = h * aspect
    }
    el.frame.style.width = `${Math.floor(w)}px`
    el.frame.style.height = `${Math.floor(h)}px`
    scene.setSize(Math.floor(w), Math.floor(h))
    draw()
  }

  let pending = false
  function draw(): void {
    if (pending) return
    pending = true
    requestAnimationFrame(() => {
      pending = false
      const { width: fw, height: fh } = frame()
      scene.setView(state.azimuth, state.altitude, fov().v, fw / fh, state.roll)
      scene.render()
      renderHud()
      // La mini-carte suit sans être redessinée à chaque image.
      const now = performance.now()
      if (now - lastMiniMap > 80) {
        lastMiniMap = now
        miniMap.update(state.observer.lat, state.observer.lon, state.azimuth, fov().h)
      }
    })
  }
  let lastMiniMap = 0

  let skyPending = false
  function scheduleSky(): void {
    if (skyPending) return
    skyPending = true
    requestAnimationFrame(() => {
      skyPending = false
      recomputeSky()
      draw()
    })
  }

  // --- Textes ---
  function renderHud(): void {
    el.hud.textContent = hudLine(state, fov(), moonInfo)
    el.starsOut.textContent = `≈ ${visibleCount.toLocaleString('fr-FR')} étoiles visibles sur la photo`
    // Ciel du lieu : jauge du ciel noir au centre-ville, type de ciel en clair.
    const s = sky()
    el.skyGaugeMark.hidden = !lp
    el.skyGaugeMark.closest('.sky-gauge')?.classList.toggle('off', !lp)
    if (lp) el.skyGaugeMark.style.left = `${(lp.level / (LP_LEVELS - 1)) * 100}%`
    el.skyClass.textContent = lp ? `Ciel du lieu : ${skyClassLabel(lp.level)}` : 'Désactivée : ciel naturel, sans lumière artificielle.'
    el.procHelp.textContent = PROCESSING_HELP[state.processing]
    // Détails techniques, repliés par défaut.
    el.starsLp.textContent =
      `Brillance du ciel : ${fmt1(s.sqm)} mag/arcsec²${lp ? ` (zone ${lp.name} de l’atlas Lorenz)` : ' (ciel naturel)'}. ` +
      `Un filé ressort du fond jusqu’à la magnitude ${fmt1(trailLimitAt(0))} sur l’équateur céleste et ` +
      `${fmt1(trailLimitAt(80))} près du pôle, où les étoiles avancent plus lentement (post-traitement ${PROCESSING_LABELS[state.processing]}, ` +
      `selon la focale et le capteur). À l’œil nu, on verrait jusqu’à la magnitude ${fmt1(s.limit)}.`
    el.focalEq.textContent = focalEquivalentText(state)
    // Les champs de saisie suivent les curseurs, sauf pendant qu'on y tape.
    setNum(el.focalNum, Math.round(state.focalMm))
    setNum(el.durationNum, state.durationMin)
    setNum(el.eyeNum, state.eyeHeight)
    setNum(el.rollNum, state.roll)
    setNum(el.reliefDistNum, Math.round(state.reliefDistance / 100) / 10)
    el.panelSummary.textContent = settingsSummary(state)
  }

  function renderWarnings(): void {
    el.warnings.replaceChildren(
      ...exposureWarnings(state).map((m) => {
        const p = document.createElement('p')
        p.className = 'sky-warning'
        p.textContent = `⚠ ${m}`
        return p
      })
    )
  }

  function syncInputs(): void {
    el.focal.value = String(Math.round(sliderFromFocal(state.focalMm) * 1000))
    el.duration.min = String(DURATION_MIN)
    el.duration.max = String(DURATION_MAX)
    el.duration.value = String(state.durationMin)
    el.eye.value = String(Math.round(sliderFromEye(state.eyeHeight) * 1000))
    el.roll.value = String(state.roll)
    el.treesOn.setAttribute('aria-checked', String(state.showTrees))
    el.hdOn.setAttribute('aria-checked', String(state.hdBuildings))
    el.lpOn.setAttribute('aria-checked', String(isLightPollutionOn()))
    for (const [button, value] of [
      [el.procRaw, 'raw'],
      [el.procStandard, 'standard'],
      [el.procPushed, 'pushed']
    ] as const) {
      button.setAttribute('aria-pressed', String(state.processing === value))
    }
    el.reliefOn.setAttribute('aria-checked', String(state.reliefOn))
    el.reliefDist.value = String(Math.round(sliderFromRelief(state.reliefDistance) * 1000))
    el.reliefDist.disabled = !state.reliefOn
    el.reliefDistNum.disabled = !state.reliefOn
    el.sensor.value = state.sensorId
    el.sensor.title = sensor().label
    el.radius50.setAttribute('aria-pressed', String(state.radius === 50))
    el.radius150.setAttribute('aria-pressed', String(state.radius === 150))
    el.radius500.setAttribute('aria-pressed', String(state.radius === 500))
    el.landscape.setAttribute('aria-pressed', String(state.orientation === 'landscape'))
    el.portrait.setAttribute('aria-pressed', String(state.orientation === 'portrait'))
    const d = parisDayOf(state.start)
    el.date.value = `${d.year}-${pad(d.month)}-${pad(d.day)}`
    el.time.value = formatParisTime(state.start)
  }

  function aimAtPole(): void {
    const p = enuToAltAz(northCelestialPole(state.start, state.observer.lat, state.observer.lon))
    state.azimuth = p.azimuth > 180 ? p.azimuth - 360 : p.azimuth
    state.altitude = p.altitude
    draw()
  }

  // --- Interactions ---
  el.focal.addEventListener('input', () => {
    state.focalMm = focalFromSlider(Number(el.focal.value) / 1000)
    scheduleSky()
    rememberSettings()
    draw()
  })
  el.duration.addEventListener('input', () => {
    state.durationMin = Number(el.duration.value)
    rememberSettings()
    renderHud()
    scheduleSky()
  })

  // Hauteur du point de vue : déplace seulement l'œil, la scène n'est pas recalculée.
  const applyEyeHeight = () => {
    rememberSettings()
    placeEye()
    showCoords()
    draw()
    // Plus haut, on voit plus loin par-dessus les crêtes : le profil d'horizon est recalculé.
    scheduleRelief()
  }
  el.eye.addEventListener('input', () => {
    state.eyeHeight = clampEyeHeight(eyeFromSlider(Number(el.eye.value) / 1000))
    applyEyeHeight()
  })

  // Arbres affichés ou masqués : la zone est reconstruite (depuis le cache disque).
  const setTrees = (show: boolean) => {
    if (state.showTrees === show) return
    state.showTrees = show
    rememberSettings()
    syncInputs()
    void loadBuildings(true)
  }
  el.treesOn.addEventListener('click', () => setTrees(!state.showTrees))

  // Bâtiments HD (maquette 3D de Strasbourg) : la zone est reconstruite.
  const setHd = (on: boolean) => {
    if (state.hdBuildings === on) return
    state.hdBuildings = on
    rememberSettings()
    syncInputs()
    void loadBuildings(true)
  }
  // Interrupteur : un clic inverse l'état.
  el.hdOn.addEventListener('click', () => setHd(!state.hdBuildings))

  // Relief lointain : affiché / masqué, distance de 200 m à 20 km.
  const setRelief = (on: boolean) => {
    if (state.reliefOn === on) return
    state.reliefOn = on
    rememberSettings()
    syncInputs()
    void loadRelief()
  }
  el.reliefOn.addEventListener('click', () => setRelief(!state.reliefOn))
  el.reliefDist.addEventListener('input', () => {
    state.reliefDistance = clampReliefDistance(reliefFromSlider(Number(el.reliefDist.value) / 1000))
    rememberSettings()
    renderHud()
    scheduleRelief()
  })

  // Saisie au clavier dans chaque champ : validée par Entrée ou en quittant le champ, bornée.
  const bindNumber = (input: HTMLInputElement, apply: (value: number) => void) =>
    bindNumberWith(input, apply, () => {
      syncInputs()
      renderHud()
    })
  bindNumber(el.focalNum, (v) => {
    state.focalMm = Math.min(FOCAL_MAX_MM, Math.max(FOCAL_MIN_MM, v))
    scheduleSky()
    rememberSettings()
    draw()
  })
  bindNumber(el.durationNum, (v) => {
    state.durationMin = Math.round(Math.min(DURATION_MAX, Math.max(DURATION_MIN, v)))
    rememberSettings()
    scheduleSky()
  })
  bindNumber(el.eyeNum, (v) => {
    state.eyeHeight = clampEyeHeight(v)
    applyEyeHeight()
  })
  const setRoll = (deg: number) => {
    state.roll = Math.round(Math.min(90, Math.max(-90, deg)) * 2) / 2
    draw()
  }
  el.roll.addEventListener('input', () => setRoll(Number(el.roll.value)))
  // Molette sur la vue : focale, à pas fins si les crans sont espacés, larges s'ils s'enchaînent.
  let lastWheel = 0
  el.canvas.addEventListener(
    'wheel',
    (e) => {
      if (e.deltaY === 0) return
      e.preventDefault()
      const now = performance.now()
      const focal = focalAfterWheel(state.focalMm, -e.deltaY, now - lastWheel)
      lastWheel = now
      if (focal === state.focalMm) return
      state.focalMm = focal
      syncInputs()
      scheduleSky()
      rememberSettings()
      draw()
    },
    { passive: false }
  )
  // A / E : tonneau, d'un degré entier par appui (répété si la touche reste enfoncée).
  window.addEventListener('keydown', (e) => {
    const k = e.key.toLowerCase()
    if ((k !== 'a' && k !== 'e') || e.ctrlKey || e.altKey || e.metaKey || el.root.hidden) return
    const a = document.activeElement
    if ((a instanceof HTMLInputElement && a.type !== 'range') || a instanceof HTMLSelectElement || a instanceof HTMLTextAreaElement) return
    e.preventDefault()
    setRoll(Math.round(state.roll) + (k === 'e' ? -1 : 1))
    syncInputs()
    renderHud()
  })
  bindNumber(el.rollNum, setRoll)
  bindNumber(el.reliefDistNum, (km) => {
    state.reliefDistance = clampReliefDistance(km * 1000)
    rememberSettings()
    void loadRelief()
  })
  // Clic sur le nom d'un curseur : retour à sa valeur par défaut.
  setupResets([
    [el.focal, el.focalNum, DEFAULT_PREFERENCES.focalMm, `${DEFAULT_PREFERENCES.focalMm} mm`],
    [el.duration, el.durationNum, DEFAULT_PREFERENCES.durationMin, `${DEFAULT_PREFERENCES.durationMin} min`],
    [el.eye, el.eyeNum, DEFAULT_PREFERENCES.eyeHeight, `${String(DEFAULT_PREFERENCES.eyeHeight).replace('.', ',')} m`],
    [el.roll, el.rollNum, 0, '0°'],
    [el.reliefDist, el.reliefDistNum, DEFAULT_PREFERENCES.reliefDistanceM / 1000, `${DEFAULT_PREFERENCES.reliefDistanceM / 1000} km`]
  ])

  const setRadius = (r: SceneRadius) => {
    if (state.radius === r) return
    state.radius = r
    rememberSettings()
    syncInputs()
    // On garde la scène affichée pendant le chargement de la nouvelle zone.
    void loadBuildings(true)
  }
  el.radius50.addEventListener('click', () => setRadius(50))
  el.radius150.addEventListener('click', () => setRadius(150))
  el.radius500.addEventListener('click', () => setRadius(500))
  el.landscape.addEventListener('click', () => {
    state.orientation = 'landscape'
    rememberSettings()
    syncInputs()
    layout()
  })
  el.portrait.addEventListener('click', () => {
    state.orientation = 'portrait'
    rememberSettings()
    syncInputs()
    layout()
  })
  const onDateTime = () => {
    const [y, m, d] = el.date.value.split('-').map(Number)
    const [hh, mm] = el.time.value.split(':').map(Number)
    if (![y, m, d, hh, mm].every(Number.isFinite)) return
    state.start = parisTime({ year: y, month: m, day: d }, hh, mm)
    scheduleSky()
  }
  el.date.addEventListener('change', onDateTime)
  el.time.addEventListener('change', onDateTime)
  el.pole.addEventListener('click', aimAtPole)

  // --- Export de l'image du cadre ---
  /** Rendu en haute définition (2 400 px sur le grand côté), puis retour à la taille d'écran. */
  function renderForExport(): HTMLCanvasElement {
    const { width: fw, height: fh } = frame()
    const aspect = fw / fh
    const w = aspect >= 1 ? EXPORT_LONG_SIDE_PX : Math.round(EXPORT_LONG_SIDE_PX * aspect)
    const h = aspect >= 1 ? Math.round(EXPORT_LONG_SIDE_PX / aspect) : EXPORT_LONG_SIDE_PX
    const ratio = window.devicePixelRatio
    scene.renderer.setPixelRatio(1)
    scene.setSize(w, h)
    scene.setPointScale(w / Math.max(1, el.canvas.clientWidth))
    scene.setView(state.azimuth, state.altitude, fov().v, aspect, state.roll)
    scene.render()
    const capture = composeCapture(el.canvas, captureInfo(state, fov(), moonInfo))
    scene.renderer.setPixelRatio(ratio)
    scene.setPointScale(ratio)
    layout()
    return capture
  }

  el.exportButton.addEventListener('click', async () => {
    try {
      await saveCapture(renderForExport(), captureFileName(state))
    } catch (e) {
      el.terrain.textContent = `Export impossible : ${(e as Error).message}`
      el.terrain.dataset.tone = 'error'
    }
  })
  el.moon.addEventListener('click', () => {
    // On garde la continuité de l'azimut pour ne pas faire un tour complet.
    let az = moonInfo.azimuth
    while (az - state.azimuth > 180) az -= 360
    while (state.azimuth - az > 180) az += 360
    state.azimuth = az
    state.altitude = moonInfo.altitude
    draw()
  })
  el.back.addEventListener('click', () => {
    el.root.hidden = true
    onClose()
  })
  // Échap : retour à la carte (sauf dans un champ de saisie, où Échap annule la saisie).
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || el.root.hidden) return
    const t = e.target
    if (t instanceof HTMLInputElement && t.type !== 'range' && t.type !== 'checkbox') return
    if (t instanceof HTMLSelectElement || t instanceof HTMLTextAreaElement) return
    el.back.click()
  })

  // Glisser pour tourner : on « attrape » le ciel.
  let drag: { x: number; y: number; az: number; alt: number } | null = null
  el.canvas.tabIndex = 0
  el.canvas.addEventListener('pointerdown', (e) => {
    // Le focus quitte les curseurs : les flèches du clavier servent alors à marcher.
    el.canvas.focus()
    drag = { x: e.clientX, y: e.clientY, az: state.azimuth, alt: state.altitude }
    el.canvas.setPointerCapture(e.pointerId)
  })
  el.canvas.addEventListener('pointermove', (e) => {
    if (!drag) return
    const degPerPx = fov().v / el.canvas.clientHeight
    state.azimuth = drag.az - (e.clientX - drag.x) * degPerPx
    state.altitude = Math.max(-30, Math.min(90, drag.alt + (e.clientY - drag.y) * degPerPx))
    draw()
  })
  const endDrag = () => {
    drag = null
  }
  el.canvas.addEventListener('pointerup', endDrag)
  el.canvas.addEventListener('pointercancel', endDrag)

  new ResizeObserver(() => {
    if (!el.root.hidden) layout()
  }).observe(el.stage)

  function showCoords(): void {
    el.coords.textContent =
      `${state.observer.lat.toFixed(5)}° N, ${state.observer.lon.toFixed(5)}° E · ` +
      `œil à ${state.eyeHeight.toLocaleString('fr-FR', { maximumFractionDigits: 2 })} m du sol`
  }

  // --- Chargements : volumes 3D autour du point, puis relief lointain ---
  const loader = createSceneLoader({
    state,
    scene,
    status: el.terrain,
    setBusy,
    draw: () => draw(),
    onObserverMoved: () => {
      void updateLightPollution()
      showCoords()
      recomputeSky()
    },
    showZone: (lat, lon, radius) => miniMap.setZone(lat, lon, radius)
  })
  const { placeEye, loadBuildings, loadRelief, scheduleRelief } = loader

  // --- Déplacement : marche et hauteur au clavier, saut vers un point de la mini-carte ---
  const { moveTo } = setupMovement({
    state,
    loader,
    isActive: () => !el.root.hidden,
    draw: () => draw(),
    showCoords,
    recomputeSky,
    onEyeHeight: () => {
      syncInputs()
      applyEyeHeight()
    },
    showPlace: (label) => {
      void updateLightPollution()
      el.place.textContent = label
    },
    showError: (message) => {
      el.terrain.textContent = message
      el.terrain.dataset.tone = 'error'
    }
  })

  // --- Mini-carte : où l'on est, ce que l'on vise ; un clic déplace le point de vue ---
  const miniMap = createMiniMap(
    el.miniMapBox,
    el.miniMap,
    el.miniMapToggle,
    (lat, lon) => void moveTo(lat, lon),
    state.miniMapCollapsed,
    (collapsed) => {
      state.miniMapCollapsed = collapsed
      rememberSettings()
    }
  )

  // --- Panneau de gauche repliable : replié, la carte ou la vue 3D prend toute la largeur ---
  // (l'observateur de taille de la scène redimensionne alors l'image).
  function applyPanel(): void {
    el.panel.classList.toggle('is-collapsed', state.controlsCollapsed)
    el.panelToggle.setAttribute('aria-expanded', String(!state.controlsCollapsed))
    el.panelToggle.title = state.controlsCollapsed ? 'Afficher le panneau' : 'Replier le panneau pour agrandir la vue'
    el.panelToggle.textContent = state.controlsCollapsed ? '›' : '‹'
    // La carte (Leaflet) se recale sur l'événement de redimensionnement de la fenêtre.
    window.dispatchEvent(new Event('resize'))
  }
  applyPanel()
  el.panelToggle.addEventListener('click', () => {
    state.controlsCollapsed = !state.controlsCollapsed
    applyPanel()
    rememberSettings()
  })

  return {
    open(observer, night) {
      state.observer = observer
      // Début par défaut : début de la fenêtre de nuit de la date choisie, sinon 23:00.
      const w = nightWindow(night, observer.lat, observer.lon)
      state.start = w.kind === 'none' ? parisTime(night, 23) : new Date(Math.ceil(w.start.getTime() / 60_000) * 60_000)
      el.place.textContent = observer.label
      showCoords()
      el.root.hidden = false
      syncInputs()
      recomputeSky()
      aimAtPole()
      layout()
      miniMap.setZone(observer.lat, observer.lon, state.radius)
      miniMap.refresh(observer.lat, observer.lon)
      void loadBuildings(false)
      void updateLightPollution()
    }
  }
}
