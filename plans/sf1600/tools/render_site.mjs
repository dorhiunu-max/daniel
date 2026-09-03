#!/usr/bin/env node
/**
 * render_site.mjs — render the site plan of a house-plan spec to SVG (and optionally PNG),
 * and print the computed placement / clearances / impervious-cover numbers.
 *
 *   node tools/render_site.mjs <spec.json> <out.svg> [--png <out.png>] [--scale 2] [--ppf 6]
 *                              [--origin x,y] [--no-title] [--transparent] [--json <out.json>]
 *
 *   --origin x,y   place the house's rear-left frame corner at (x, y) feet instead of the
 *                  computed placement (clearances are still reported; violations drawn in red)
 *   --ppf          pixels per foot for the SVG (default 6)
 *   --scale        device scale factor for the PNG (default 2)
 *   --json         also write placement + impervious numbers to a JSON file
 *
 * PNG rasterisation uses Playwright's bundled Chromium. Run with
 *   NODE_PATH=/opt/node22/lib/node_modules node tools/render_site.mjs …
 * (or have `playwright` resolvable from this folder). Never runs `playwright install`.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const SitePlan = require(path.join(here, '..', 'web', 'js', 'siteplan.js'));

function usage(msg) {
  if (msg) console.error('error: ' + msg);
  console.error('usage: node tools/render_site.mjs <spec.json> <out.svg> [--png <out.png>] [--scale 2] [--ppf 6] [--origin x,y] [--no-title] [--json <out.json>]');
  process.exit(2);
}

// ---- args -------------------------------------------------------------------
const argv = process.argv.slice(2);
const positional = [];
const opt = { png: null, scale: 2, ppf: 6, origin: null, title: true, transparent: false, json: null };
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  const next = () => { if (i + 1 >= argv.length) usage(`${a} needs a value`); return argv[++i]; };
  if (a === '--png') opt.png = next();
  else if (a === '--scale') opt.scale = Number(next());
  else if (a === '--ppf') opt.ppf = Number(next());
  else if (a === '--origin') {
    const parts = next().split(',').map(Number);
    if (parts.length !== 2 || parts.some((n) => !isFinite(n))) usage('--origin wants x,y in feet');
    opt.origin = parts;
  }
  else if (a === '--no-title') opt.title = false;
  else if (a === '--transparent') opt.transparent = true;
  else if (a === '--json') opt.json = next();
  else if (a === '-h' || a === '--help') usage();
  else if (a.startsWith('--')) usage(`unknown flag ${a}`);
  else positional.push(a);
}
if (positional.length < 2) usage();
if (!(opt.scale > 0)) usage('bad --scale');
if (!(opt.ppf > 0)) usage('bad --ppf');

const [specPath, svgPath] = positional;

// ---- spec + placement -------------------------------------------------------------
let spec;
try { spec = JSON.parse(fs.readFileSync(specPath, 'utf8')); }
catch (e) { console.error(`cannot read spec ${specPath}: ${e.message}`); process.exit(1); }

const placement = SitePlan.computePlacement(spec, opt.origin ? { origin: opt.origin } : undefined);
const imp = SitePlan.impervious(spec, placement);
const ff = (v) => (v == null || !isFinite(v) ? 'n/a' : `${SitePlan.fmtFeet(v)} (${v.toFixed(2)}')`);

console.log(`placement (${placement.source}): origin = [${placement.origin[0]}, ${placement.origin[1]}] ft  ok=${placement.ok}`);
if (placement.clearances) {
  const c = placement.clearances;
  console.log(`  clearances: left ${ff(c.left)}  right ${ff(c.right)}  rear ${ff(c.rear)}  front ${ff(c.front)}`);
}
placement.notes.forEach((n) => console.log('  - ' + n));
if (imp) {
  const r = (v) => Math.round(v);
  console.log(`impervious: LOT ${r(imp.lot)} sf (polygon ${r(imp.lotPolygon)}; plat ${imp.lotPlat ?? 'n/a'})  HOUSE ${r(imp.house)} sf (living ${r(imp.living)} + garage ${r(imp.garage)} + porch ${r(imp.porch)})  FLATWORK ${r(imp.flatwork)} sf (drive ${r(imp.drive)} + walk ${r(imp.walk)} + stoop ${r(imp.stoop)})  TOTAL ${r(imp.total)} sf = ${imp.pct.toFixed(1)}% -> ${imp.pctRounded}%`);
}
if (opt.json) {
  fs.mkdirSync(path.dirname(path.resolve(opt.json)), { recursive: true });
  fs.writeFileSync(opt.json, JSON.stringify({ placement, impervious: imp }, null, 2));
  console.log(`wrote ${opt.json}`);
}

// ---- render SVG ---------------------------------------------------------------
const svg = SitePlan.renderSVG(spec, {
  pxPerFoot: opt.ppf,
  placement,
  title: opt.title,
  background: opt.transparent ? 'transparent' : '#fff',
});
fs.mkdirSync(path.dirname(path.resolve(svgPath)), { recursive: true });
fs.writeFileSync(svgPath, svg);
const m = /width="(\d+)" height="(\d+)"/.exec(svg);
const W = m ? Number(m[1]) : 800, H = m ? Number(m[2]) : 1000;
console.log(`wrote ${svgPath} (${W}x${H} px @ ${opt.ppf} px/ft)`);

// ---- optional PNG via Playwright/Chromium --------------------------------------
if (opt.png) {
  let chromium;
  try { ({ chromium } = require('playwright')); }
  catch (e1) {
    try { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }
    catch (e2) {
      console.error('playwright not found: run with NODE_PATH=/opt/node22/lib/node_modules (' + e1.message + ')');
      process.exit(1);
    }
  }
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ deviceScaleFactor: opt.scale, viewport: { width: W + 40, height: H + 40 } });
    const html = `<!doctype html><html><head><meta charset="utf-8"><style>
      html,body{margin:0;padding:0;background:${opt.transparent ? 'transparent' : '#fff'}}
      body{padding:20px;display:inline-block}
      svg{display:block}
    </style></head><body>${svg}</body></html>`;
    await page.setContent(html, { waitUntil: 'load' });
    await page.evaluate(() => document.fonts && document.fonts.ready);
    fs.mkdirSync(path.dirname(path.resolve(opt.png)), { recursive: true });
    await page.locator('svg').first().screenshot({ path: opt.png, omitBackground: opt.transparent });
    console.log(`wrote ${opt.png} (${W * opt.scale}x${H * opt.scale} px, device scale ${opt.scale})`);
  } finally {
    await browser.close();
  }
}
