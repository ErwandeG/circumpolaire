/**
 * Capture de la vue du ciel : l'image du cadre, suivie d'un bandeau qui rappelle
 * le lieu, l'heure et les réglages, pour s'en servir sur le terrain.
 */
export interface CaptureInfo {
  place: string
  coords: string
  when: string
  settings: string
}

/** Grand côté de l'image exportée, en pixels. */
export const EXPORT_LONG_SIDE_PX = 2400

/** Découpe un texte en lignes qui tiennent dans la largeur, de préférence aux « · ». */
function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const lines: string[] = []
  let current = ''
  for (const word of text.split(' ')) {
    const candidate = current ? `${current} ${word}` : word
    if (ctx.measureText(candidate).width <= maxWidth || !current) {
      current = candidate
    } else {
      lines.push(current)
      current = word === '·' ? '' : word
    }
  }
  if (current) lines.push(current)
  return lines
}

export function composeCapture(source: HTMLCanvasElement, info: CaptureInfo): HTMLCanvasElement {
  const w = source.width
  const h = source.height
  const font = Math.round(Math.max(14, Math.min(w, h * 1.5) / 75))
  const line = Math.round(font * 1.45)
  const padding = Math.round(font * 0.9)
  const maxWidth = w - 2 * padding

  // Mesure d'abord, pour connaître la hauteur du bandeau.
  const probe = document.createElement('canvas').getContext('2d')
  if (!probe) throw new Error('Canvas 2D indisponible')
  const bold = `600 ${font}px "Segoe UI", system-ui, sans-serif`
  const regular = `${font}px "Segoe UI", system-ui, sans-serif`
  probe.font = bold
  const head = wrap(probe, `${info.place} · ${info.when}`, maxWidth)
  probe.font = regular
  const body = wrap(probe, `${info.settings} · ${info.coords}`, maxWidth)
  const band = padding * 2 + line * (head.length + body.length)

  const out = document.createElement('canvas')
  out.width = w
  out.height = h + band
  const ctx = out.getContext('2d')
  if (!ctx) throw new Error('Canvas 2D indisponible')
  ctx.drawImage(source, 0, 0)
  ctx.fillStyle = '#05080f'
  ctx.fillRect(0, h, w, band)
  ctx.textBaseline = 'top'
  let y = h + padding
  ctx.font = bold
  ctx.fillStyle = '#e6e9ed'
  for (const l of head) {
    ctx.fillText(l, padding, y)
    y += line
  }
  ctx.font = regular
  ctx.fillStyle = '#94a3b8'
  for (const l of body) {
    ctx.fillText(l, padding, y)
    y += line
  }
  return out
}

/** Propose l'enregistrement du PNG (Electron ouvre la boîte « Enregistrer sous »). */
export async function saveCapture(canvas: HTMLCanvasElement, fileName: string): Promise<void> {
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
  if (!blob) throw new Error('Image impossible à produire')
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  document.body.append(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}
