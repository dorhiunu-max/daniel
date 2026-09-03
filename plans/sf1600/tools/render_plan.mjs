#!/usr/bin/env node
/**
 * render_plan.mjs — render a house-plan spec to SVG (and optionally PNG).
 *
 *   node tools/render_plan.mjs <spec.json> <out.svg> [--style presentation|architectural]
 *                              [--png <out.png>] [--scale 2] [--ppi 2] [--title "text"]
 *                              [--transparent] [--no-fixtures] [--no-labels] [--no-dims]
 *
 * PNG rasterisation uses Playwright's bundled Chromium. Run with
 *   NODE_PATH=/opt/node22/lib/node_modules node tools/render_plan.mjs …
 * (or have `playwright` resolvable from this folder). Never runs `playwright install`.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const FloorPlan = require(path.join(here, '..', 'web', 'js', 'floorplan.js'));

function usage(msg) {
  if (msg) console.error('error: ' + msg);
  console.error('usage: node tools/render_plan.mjs <spec.json> <out.svg> [--style presentation|architectural] [--png <out.png>] [--scale 2]');
  process.exit(2);
}

// ---- args -------------------------------------------------------------------
const argv = process.argv.slice(2);
const positional = [];
const opt = { style: 'presentation', png: null, scale: 2, ppi: 2, title: null, transparent: false, fixtures: true, labels: true, dims: null };
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  const next = () => { if (i + 1 >= argv.length) usage(`${a} needs a value`); return argv[++i]; };
  if (a === '--style') opt.style = next();
  else if (a === '--png') opt.png = next();
  else if (a === '--scale') opt.scale = Number(next());
  else if (a === '--ppi') opt.ppi = Number(next());
  else if (a === '--title') opt.title = next();
  else if (a === '--transparent') opt.transparent = true;
  else if (a === '--no-fixtures') opt.fixtures = false;
  else if (a === '--no-labels') opt.labels = false;
  else if (a === '--no-dims') opt.dims = false;
  else if (a === '--dims') opt.dims = true;
  else if (a === '-h' || a === '--help') usage();
  else if (a.startsWith('--')) usage(`unknown flag ${a}`);
  else positional.push(a);
}
if (positional.length < 2) usage();
if (!['presentation', 'architectural'].includes(opt.style)) usage(`bad --style ${opt.style}`);
if (!(opt.scale > 0)) usage('bad --scale');
if (!(opt.ppi > 0)) usage('bad --ppi');

const [specPath, svgPath] = positional;

// ---- render SVG ---------------------------------------------------------------
let spec;
try { spec = JSON.parse(fs.readFileSync(specPath, 'utf8')); }
catch (e) { console.error(`cannot read spec ${specPath}: ${e.message}`); process.exit(1); }

const renderOpts = {
  style: opt.style,
  pxPerInch: opt.ppi,
  showFixtures: opt.fixtures,
  showLabels: opt.labels,
  title: opt.title,
  background: opt.transparent ? 'transparent' : '#fff',
};
if (opt.dims !== null) renderOpts.showDimensions = opt.dims;

const svg = FloorPlan.renderSVG(spec, renderOpts);
fs.mkdirSync(path.dirname(path.resolve(svgPath)), { recursive: true });
fs.writeFileSync(svgPath, svg);
const m = /width="(\d+)" height="(\d+)"/.exec(svg);
const W = m ? Number(m[1]) : 1200, H = m ? Number(m[2]) : 900;
console.log(`wrote ${svgPath} (${W}x${H} px @ ${opt.ppi} px/in, style=${opt.style})`);

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
