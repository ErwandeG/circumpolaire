/** Branchements génériques des réglages : champs de saisie et noms cliquables des curseurs. */

/** Un champ de saisie suit son curseur, sauf pendant qu'on y tape. */
export function setNum(input: HTMLInputElement, value: number): void {
  if (document.activeElement !== input) input.value = String(value)
}

/**
 * Saisie au clavier dans un champ : validée par Entrée ou en quittant le champ.
 * `apply` borne et applique la valeur ; `after` remet l'affichage à jour (aussi sur Échap).
 */
export function bindNumber(input: HTMLInputElement, apply: (value: number) => void, after: () => void): void {
  input.addEventListener('change', () => {
    const v = Number(input.value.replace(',', '.'))
    if (Number.isFinite(v) && input.value.trim() !== '') apply(v)
    input.blur()
    after()
  })
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      input.blur()
      after()
    }
  })
}

/** Curseur, son champ de saisie, sa valeur par défaut et le texte de l'infobulle. */
export type ResetEntry = [slider: HTMLInputElement, num: HTMLInputElement, value: number, text: string]

/**
 * Clic sur le nom d'un curseur : retour à sa valeur par défaut, en passant par le champ de saisie
 * (qui applique la valeur avec ses bornes et ses effets).
 */
export function setupResets(entries: readonly ResetEntry[]): void {
  for (const [slider, num, value, text] of entries) {
    const label = slider.closest('.ctrl')?.querySelector<HTMLElement>('label, .ctrl-label')
    if (!label) continue
    label.classList.add('resettable')
    label.title = `Cliquer pour revenir à la valeur par défaut (${text})`
    label.addEventListener('click', (e) => {
      // Pas de focus sur le curseur (les flèches doivent rester au déplacement).
      e.preventDefault()
      num.value = String(value)
      num.dispatchEvent(new Event('change'))
    })
  }
}
