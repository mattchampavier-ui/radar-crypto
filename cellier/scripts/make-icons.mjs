// Génère les icônes PNG et les écrans de lancement iPhone à partir de public/favicon.svg.
import { createRequire } from 'node:module'
// Playwright préinstallé sur la machine (non listé dans les dépendances).
const { chromium } = createRequire(import.meta.url)('playwright')
import { readFileSync } from 'node:fs'

const svg = readFileSync(new URL('../public/favicon.svg', import.meta.url), 'utf8')
const out = (f) => new URL(`../public/${f}`, import.meta.url).pathname
const browser = await chromium.launch()
const page = await browser.newPage()

async function shot(file, w, h, html) {
  await page.setViewportSize({ width: w, height: h })
  await page.setContent(`<html><body style="margin:0">${html}</body></html>`)
  await page.screenshot({ path: out(file), omitBackground: false })
}

const icon = (size, pad = 0) =>
  `<div style="width:${size}px;height:${size}px;background:#2F4A3A;display:flex;align-items:center;justify-content:center">
     <div style="width:${size - pad * 2}px;height:${size - pad * 2}px">${svg.replace('<svg ', '<svg width="100%" height="100%" ').replace('rx="112"', 'rx="0"')}</div></div>`

await shot('apple-touch-icon.png', 180, 180, icon(180))
await shot('icon-192.png', 192, 192, icon(192))
await shot('icon-512.png', 512, 512, icon(512))
await shot('icon-512-maskable.png', 512, 512, icon(512, 60))

for (const [w, h, s] of [[1170, 2532, 3], [1179, 2556, 3], [1290, 2796, 3], [1125, 2436, 3]]) {
  await page.setViewportSize({ width: w / s, height: h / s })
  await page.setContent(`<html><body style="margin:0;height:100vh;background:#F4F1EA;display:flex;flex-direction:column;align-items:center;justify-content:center;font-family:Georgia,serif;color:#24271F">
    <div style="width:96px;height:96px">${svg.replace('<svg ', '<svg width="100%" height="100%" ')}</div>
    <div style="margin-top:18px;font-size:30px;font-weight:600">Cellier</div></body></html>`)
  const p = await browser.newPage({ viewport: { width: w / s, height: h / s }, deviceScaleFactor: s })
  await p.setContent(await page.content())
  await p.screenshot({ path: out(`splash-${w}x${h}.png`) })
  await p.close()
}
await browser.close()
console.log('Icônes générées')
