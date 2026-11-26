import { kindLabel, type Place } from '../domain/place'
import { geocode, type GeocodeResult } from '../services/geocoding'

interface SearchElements {
  form: HTMLFormElement
  input: HTMLInputElement
  button: HTMLButtonElement
  message: HTMLElement
  results: HTMLUListElement
}

/**
 * Recherche d'adresse : un seul résultat est appliqué directement,
 * plusieurs résultats ouvrent une liste de choix.
 */
export function setupSearch(el: SearchElements, onSelect: (place: Place) => void): void {
  let requestId = 0

  function showMessage(text: string, tone: 'info' | 'error'): void {
    el.message.textContent = text
    el.message.dataset.tone = tone
    el.message.hidden = false
  }

  function clearMessage(): void {
    el.message.hidden = true
    el.message.textContent = ''
  }

  function clearResults(): void {
    el.results.replaceChildren()
    el.results.hidden = true
  }

  function choose(place: Place): void {
    clearResults()
    clearMessage()
    el.input.value = place.label
    onSelect(place)
  }

  function showResults(places: Place[]): void {
    el.results.replaceChildren(
      ...places.map((place) => {
        const li = document.createElement('li')
        const btn = document.createElement('button')
        btn.type = 'button'
        btn.className = 'result'

        const label = document.createElement('span')
        label.className = 'result-label'
        label.textContent = place.label

        const meta = document.createElement('span')
        meta.className = 'result-meta'
        meta.textContent = [kindLabel(place.kind), place.context].filter(Boolean).join(' · ')

        btn.append(label, meta)
        btn.addEventListener('click', () => choose(place))
        li.append(btn)
        return li
      })
    )
    el.results.hidden = false
    el.results.querySelector<HTMLButtonElement>('button')?.focus()
  }

  function handle(result: GeocodeResult, query: string): void {
    switch (result.status) {
      case 'ok':
        if (result.places.length === 1) {
          choose(result.places[0])
        } else {
          showMessage(`${result.places.length} résultats : choisissez le bon lieu.`, 'info')
          showResults(result.places)
        }
        break
      case 'empty':
        showMessage(
          query.trim().length < 3
            ? 'Saisissez au moins 3 caractères.'
            : `Aucun lieu trouvé en France métropolitaine pour « ${query.trim()} ».`,
          'info'
        )
        break
      case 'network-error':
        showMessage('Pas de connexion au service d’adresses. Le lieu actuel est conservé.', 'error')
        break
      case 'service-error':
        showMessage(
          `Le service d’adresses de l’IGN ne répond pas correctement (erreur ${result.httpStatus}). Réessayez plus tard.`,
          'error'
        )
        break
    }
  }

  el.form.addEventListener('submit', async (event) => {
    event.preventDefault()
    const query = el.input.value
    const id = ++requestId
    clearResults()
    showMessage('Recherche…', 'info')
    el.button.disabled = true
    try {
      const result = await geocode(query)
      // Une recherche plus récente a été lancée entre-temps : on ignore celle-ci.
      if (id === requestId) handle(result, query)
    } finally {
      if (id === requestId) el.button.disabled = false
    }
  })

  // Échap ferme la liste de choix.
  el.results.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      clearResults()
      clearMessage()
      el.input.focus()
    }
  })
}
