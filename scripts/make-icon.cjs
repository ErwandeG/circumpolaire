// Génère build/icon.png (512 × 512) : filés d'étoiles autour de la Polaire, toits de ville.
// Usage : npx electron scripts/make-icon.cjs
const { app, BrowserWindow } = require('electron')
const fs = require('node:fs')
const path = require('node:path')

const SIZE = 512
const cx = 256
const cy = 196

// Arcs de filés : rayons réguliers, longueurs et départs variés.
const arcs = []
for (let i = 0; i < 9; i++) {
  const r = 30 + i * 27
  const start = (i * 47) % 360
  const len = 70 + ((i * 37) % 90)
  const a0 = (start * Math.PI) / 180
  const a1 = ((start + len) * Math.PI) / 180
  const x0 = cx + r * Math.cos(a0)
  const y0 = cy + r * Math.sin(a0)
  const x1 = cx + r * Math.cos(a1)
  const y1 = cy + r * Math.sin(a1)
  const opacity = (0.95 - i * 0.07).toFixed(2)
  const width = (7 - i * 0.45).toFixed(1)
  arcs.push(
    `<path d="M${x0.toFixed(1)} ${y0.toFixed(1)} A${r} ${r} 0 0 1 ${x1.toFixed(1)} ${y1.toFixed(1)}" ` +
      `stroke="url(#trail)" stroke-opacity="${opacity}" stroke-width="${width}" fill="none" stroke-linecap="round"/>`
  )
}

const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 512 512">
  <defs>
    <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#0f1d3d"/>
      <stop offset="1" stop-color="#060a16"/>
    </linearGradient>
    <linearGradient id="trail" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#bfdbfe"/>
      <stop offset="1" stop-color="#fde68a"/>
    </linearGradient>
    <radialGradient id="glow">
      <stop offset="0" stop-color="#ffffff" stop-opacity="1"/>
      <stop offset="1" stop-color="#93c5fd" stop-opacity="0"/>
    </radialGradient>
    <clipPath id="tile"><rect width="512" height="512" rx="104"/></clipPath>
  </defs>
  <g clip-path="url(#tile)">
    <rect width="512" height="512" fill="url(#sky)"/>
    ${arcs.join('\n    ')}
    <circle cx="${cx}" cy="${cy}" r="26" fill="url(#glow)"/>
    <circle cx="${cx}" cy="${cy}" r="9" fill="#ffffff"/>
    <path fill="#0b0f17" stroke="#1f2a3c" stroke-width="3" d="
      M0 512 V392 H58 V360 H96 V398 H130 V338 L152 318 L174 338 V384 H206
      V300 L218 290 V230 L226 150 L234 230 V290 L246 300 V372 H282 V346 H330 V380
      H366 V326 L392 304 L418 326 V372 H448 V352 H512 V512 Z"/>
  </g>
</svg>`

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: SIZE,
    height: SIZE,
    show: false,
    frame: false,
    transparent: true,
    webPreferences: { offscreen: true }
  })
  const html = `<html><body style="margin:0;background:transparent">${svg}</body></html>`
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html))
  await new Promise((r) => setTimeout(r, 500))
  const image = (await win.webContents.capturePage()).resize({ width: SIZE, height: SIZE, quality: 'best' })
  const out = path.join(__dirname, '..', 'build', 'icon.png')
  fs.mkdirSync(path.dirname(out), { recursive: true })
  fs.writeFileSync(out, image.toPNG())
  console.log(`Icône écrite : ${out} (${image.getSize().width} × ${image.getSize().height})`)
  app.quit()
})
