#!/usr/bin/env node
// Render every deliverable drawing for a spec into an output folder (SVG + PNG) and the 3D views.
// usage: node tools/render_all.mjs [spec.json=spec/sf1600.json] [outdir=renderings] [--skip-3d]
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
const require = createRequire(import.meta.url);
const here = path.dirname(new URL(import.meta.url).pathname);
const ROOT = path.resolve(here, '..');
const args = process.argv.slice(2).filter(a => !a.startsWith('--'));
const flags = process.argv.slice(2).filter(a => a.startsWith('--'));
const specPath = path.resolve(ROOT, args[0] || 'spec/sf1600.json');
const outdir = path.resolve(ROOT, args[1] || 'renderings');
fs.mkdirSync(outdir, { recursive: true });
const FloorPlan = require(path.join(ROOT, 'web/js/floorplan.js'));
const Elevations = require(path.join(ROOT, 'web/js/elevations.js'));
const RoofPlan = require(path.join(ROOT, 'web/js/roofplan.js'));
const SitePlan = require(path.join(ROOT, 'web/js/siteplan.js'));
const spec = JSON.parse(fs.readFileSync(specPath, 'utf8'));
const baseline = JSON.parse(fs.readFileSync(path.join(ROOT, 'spec/baseline_sf1258.json'), 'utf8'));
const placement = SitePlan.computePlacement(spec);
const jobs = [
  ['floor_plan_presentation', FloorPlan.renderSVG(spec, { style: 'presentation', pxPerInch: 2 })],
  ['floor_plan_architectural', FloorPlan.renderSVG(spec, { style: 'architectural', pxPerInch: 2 })],
  ['original_sf1258_floor_plan', FloorPlan.renderSVG(baseline, { style: 'presentation', pxPerInch: 2 })],
  ['elevation_front', Elevations.renderSVG(spec, 'front', { pxPerFoot: 24 })],
  ['elevation_rear', Elevations.renderSVG(spec, 'rear', { pxPerFoot: 24 })],
  ['elevation_left', Elevations.renderSVG(spec, 'left', { pxPerFoot: 24 })],
  ['elevation_right', Elevations.renderSVG(spec, 'right', { pxPerFoot: 24 })],
  ['roof_plan', RoofPlan.renderSVG(spec, { pxPerInch: 2 })],
  ['site_plan', SitePlan.renderSVG(spec, { pxPerFoot: 10, placement })],
];
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const browser = await chromium.launch();
for (const [name, svg] of jobs) {
  fs.writeFileSync(path.join(outdir, name + '.svg'), svg);
  const m = svg.match(/width="([\d.]+)" height="([\d.]+)"/);
  const w = Math.ceil(Number(m[1])), h = Math.ceil(Number(m[2]));
  const scale = w > 2600 ? 1 : 2;
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: scale });
  await page.setContent(`<html><body style="margin:0;background:#fff">${svg}</body></html>`);
  const el = await page.$('svg');
  await el.screenshot({ path: path.join(outdir, name + '.png') });
  await page.close();
  console.log('wrote', name, `${w * scale}x${h * scale}`);
}
await browser.close();
fs.writeFileSync(path.join(outdir, 'placement.json'), JSON.stringify({ placement, impervious: SitePlan.impervious(spec, placement) }, null, 1));
if (!flags.includes('--skip-3d')) {
  execFileSync('node', [path.join(here, 'render_3d.mjs'), specPath, outdir, '--views', 'front-left,front-right,rear-right,rear-left,top', '--size', '1600x1000'], { stdio: 'inherit' });
}
console.log('done ->', outdir);
