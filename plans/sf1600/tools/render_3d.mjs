#!/usr/bin/env node
// Screenshot the Three.js exterior model from preset views with headless Chromium (SwiftShader WebGL).
// usage: node tools/render_3d.mjs <spec.json> <outdir> [--views front-left,front-right,rear-right,rear-left,top] [--size 1600x1000] [--prefix 3d]
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
const require = createRequire(import.meta.url);
const here = path.dirname(new URL(import.meta.url).pathname);
const ROOT = path.resolve(here, '..');
const args = process.argv.slice(2);
const specPath = args[0], outdir = args[1];
if (!specPath || !outdir) { console.error('usage: render_3d.mjs <spec.json> <outdir> [--views a,b] [--size WxH] [--prefix 3d]'); process.exit(2); }
const views = args.includes('--views') ? args[args.indexOf('--views') + 1].split(',') : ['front-left', 'front-right', 'rear-right', 'rear-left', 'top'];
const size = args.includes('--size') ? args[args.indexOf('--size') + 1].split('x').map(Number) : [1600, 1000];
const prefix = args.includes('--prefix') ? args[args.indexOf('--prefix') + 1] : '3d';
const spec = fs.readFileSync(specPath, 'utf8');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const html = `<html><head><meta charset="utf-8"><style>html,body{margin:0;background:#bfe0f5;overflow:hidden}#v{width:${size[0]}px;height:${size[1]}px}</style></head><body>
<div id="v"></div>
<script>${read('web/vendor/three.min.js')}</script>
<script>${read('web/vendor/OrbitControls.js')}</script>
<script>${read('web/js/geometry.js')}</script>
<script>${read('web/js/model3d.js')}</script>
<script>
window.__err = null;
try {
  window.__spec = ${spec};
  window.__h = Model3D.mount(document.getElementById('v'), window.__spec, { view: 'front-left', shadows: true });
} catch (e) { window.__err = String(e && e.stack || e); }
</script></body></html>`;
fs.mkdirSync(outdir, { recursive: true });
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: size[0], height: size[1] }, deviceScaleFactor: 1 });
page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') console.log('console:', m.text().slice(0, 200)); });
page.on('pageerror', e => console.log('pageerror:', String(e).slice(0, 300)));
await page.setContent(html, { waitUntil: 'load' });
await page.waitForTimeout(1500);
const err = await page.evaluate(() => window.__err);
if (err) { console.error('MOUNT ERROR', err); await browser.close(); process.exit(1); }
const info = await page.evaluate(() => { const h = window.__h; return { objects: h.scene.children.length, meshes: h.model.walls.length + h.model.roofs.length, warnings: h.model.warnings }; });
console.log('mounted:', JSON.stringify(info));
for (const v of views) {
  await page.evaluate(v => { window.__h.setView(v); window.__h.renderOnce(); }, v);
  await page.waitForTimeout(700);
  await page.evaluate(() => window.__h.renderOnce());
  const out = path.join(outdir, `${prefix}_${v}.png`);
  await page.screenshot({ path: out, clip: { x: 0, y: 0, width: size[0], height: size[1] } });
  console.log('wrote', out);
}
await browser.close();
