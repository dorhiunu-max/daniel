#!/usr/bin/env node
// Render elevations (front/rear/left/right) and the roof plan for a spec to SVG (+PNG).
// usage: node tools/render_views.mjs <spec.json> <outdir> [--png] [--scale 2] [--only front,rear,left,right,roof]
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
const require = createRequire(import.meta.url);
const Elevations = require('../web/js/elevations.js');
const RoofPlan = require('../web/js/roofplan.js');
const args = process.argv.slice(2);
const specPath = args[0], outdir = args[1];
if (!specPath || !outdir) { console.error('usage: render_views.mjs <spec.json> <outdir> [--png] [--scale 2] [--only a,b]'); process.exit(2); }
const png = args.includes('--png');
const scale = args.includes('--scale') ? Number(args[args.indexOf('--scale') + 1]) : 2;
const only = args.includes('--only') ? args[args.indexOf('--only') + 1].split(',') : ['front', 'rear', 'left', 'right', 'roof'];
const spec = JSON.parse(fs.readFileSync(specPath, 'utf8'));
fs.mkdirSync(outdir, { recursive: true });
const base = path.basename(specPath, '.json');
const jobs = [];
for (const v of only) {
  const svg = v === 'roof' ? RoofPlan.renderSVG(spec, { pxPerInch: 1 }) : Elevations.renderSVG(spec, v, { pxPerFoot: 12 });
  const name = v === 'roof' ? `roof_${base}` : `elev_${base}_${v}`;
  const svgPath = path.join(outdir, name + '.svg');
  fs.writeFileSync(svgPath, svg);
  jobs.push({ svg, name, svgPath });
  console.log('wrote', svgPath, (svg.length / 1024).toFixed(0) + 'KB');
}
if (png) {
  const { chromium } = require('/opt/node22/lib/node_modules/playwright');
  const browser = await chromium.launch();
  for (const j of jobs) {
    const m = j.svg.match(/width="([\d.]+)" height="([\d.]+)"/);
    const w = Math.ceil(Number(m[1])), h = Math.ceil(Number(m[2]));
    const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: scale });
    await page.setContent(`<html><body style="margin:0;background:#fff">${j.svg}</body></html>`);
    const el = await page.$('svg');
    const out = path.join(outdir, j.name + '.png');
    await el.screenshot({ path: out });
    await page.close();
    console.log('wrote', out, `${w * scale}x${h * scale}`);
  }
  await browser.close();
}
