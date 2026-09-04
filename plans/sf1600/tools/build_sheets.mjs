#!/usr/bin/env node
// Build two 36" x 24" concept sheets (HTML -> PDF via Playwright, merged with pypdf) at true drawing scale.
// usage: node tools/build_sheets.mjs [spec.json=spec/sf1600.json] [outdir=sheets]
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
const require = createRequire(import.meta.url);
const here = path.dirname(new URL(import.meta.url).pathname);
const ROOT = path.resolve(here, '..');
const args = process.argv.slice(2);
const specPath = path.resolve(ROOT, args[0] || 'spec/sf1600.json');
const outdir = path.resolve(ROOT, args[1] || 'sheets');
fs.mkdirSync(outdir, { recursive: true });
const FloorPlan = require(path.join(ROOT, 'web/js/floorplan.js'));
const Elevations = require(path.join(ROOT, 'web/js/elevations.js'));
const RoofPlan = require(path.join(ROOT, 'web/js/roofplan.js'));
const SitePlan = require(path.join(ROOT, 'web/js/siteplan.js'));
const HG = require(path.join(ROOT, 'web/js/geometry.js'));
const spec = JSON.parse(fs.readFileSync(specPath, 'utf8'));
const placement = SitePlan.computePlacement(spec);
const imp = SitePlan.impervious(spec, placement);
const date = new Date().toISOString().slice(0, 10);
const fmt = FloorPlan.fmtFt;
const area = p => { let a = 0; for (let i = 0; i < p.length; i++) { const q = p[i], r = p[(i + 1) % p.length]; a += q[0] * r[1] - r[0] * q[1]; } return Math.abs(a) / 288; };
const A = { living: area(spec.footprint.living), garage: area(spec.footprint.garage), porch: area(spec.footprint.porch) }; A.total = A.living + A.garage + A.porch;
const sf = n => Math.round(n).toLocaleString('en-US');

// viewBox (in plan inches) -> paper width in inches at a drawing scale (paper inches per plan foot)
function scaled(svg, paperPerFoot) {
  const vb = svg.match(/viewBox="([-\d. ]+)"/)[1].split(/\s+/).map(Number);
  const wIn = vb[2] / 12 * paperPerFoot, hIn = vb[3] / 12 * paperPerFoot;
  return { svg: svg.replace(/width="[\d.]+" height="[\d.]+"/, `width="${wIn}in" height="${hIn}in"`), w: wIn, h: hIn };
}
function scaledPx(svg, pxPerFoot, paperPerFoot) { // for SVGs whose viewBox is in FEET (site plan)
  const vb = svg.match(/viewBox="([-\d. ]+)"/)[1].split(/\s+/).map(Number);
  const wIn = vb[2] * paperPerFoot, hIn = vb[3] * paperPerFoot;
  return { svg: svg.replace(/width="[\d.]+" height="[\d.]+"/, `width="${wIn}in" height="${hIn}in"`), w: wIn, h: hIn };
}
const Q = 0.25, E = 0.125, T = 0.1875; // 1/4", 1/8", 3/16" scales
const eo = { pxPerFoot: 12, pad: 24, scaleText: '3/16" = 1\'-0"' };
const D = {
  plan: scaled(FloorPlan.renderSVG(spec, { style: 'architectural', pxPerInch: 1, padding: 60 }), Q),
  front: scaled(Elevations.renderSVG(spec, 'front', eo), T),
  rear: scaled(Elevations.renderSVG(spec, 'rear', eo), T),
  left: scaled(Elevations.renderSVG(spec, 'left', eo), T),
  right: scaled(Elevations.renderSVG(spec, 'right', eo), T),
  roof: scaled(RoofPlan.renderSVG(spec, { pxPerInch: 1 }), E),
  site: scaledPx(SitePlan.renderSVG(spec, { pxPerFoot: 6, placement }), 6, E),
};
console.log(Object.entries(D).map(([k, v]) => `${k} ${v.w.toFixed(1)}x${v.h.toFixed(1)} in`).join(' | '));

const css = `
  @page { size: 36in 24in; margin: 0; }
  html, body { margin: 0; width: 36in; height: 24in; background: #fff; font-family: Helvetica, Arial, sans-serif; color: #111; }
  .sheet { position: relative; width: 36in; height: 24in; overflow: hidden; }
  .border { position: absolute; left: .5in; top: .5in; right: .5in; bottom: .5in; border: 3px solid #111; }
  .inner { position: absolute; left: .62in; top: .62in; right: 3.62in; bottom: .62in; border: 1px solid #111; }
  .tb { position: absolute; right: .62in; top: .62in; bottom: .62in; width: 2.9in; border: 1px solid #111; display: flex; flex-direction: column; }
  .tb > div { border-bottom: 1px solid #111; padding: .12in .15in; }
  .tb .big { font: 700 .42in/1 Helvetica, Arial, sans-serif; letter-spacing: .02em; }
  .tb .sub { font-size: .13in; letter-spacing: .12em; text-transform: uppercase; color: #333; margin-top: .04in; }
  .tb .k { font-size: .11in; letter-spacing: .1em; text-transform: uppercase; color: #555; }
  .tb .v { font-size: .16in; font-weight: 600; margin-top: .02in; }
  .tb .warn { background: #111; color: #fff; font: 700 .15in/1.3 Helvetica, Arial, sans-serif; letter-spacing: .06em; text-transform: uppercase; }
  .tb .tab td { font: .13in/1.5 "Courier New", monospace; padding: 0 .04in; }
  .tb .tab td:last-child { text-align: right; }
  .tb .tab tr.total td { border-top: 1px solid #111; font-weight: 700; }
  .tb .title { flex: 1; display: flex; flex-direction: column; justify-content: flex-end; }
  .tb .title .t { font: 700 .34in/1.1 Georgia, "Times New Roman", serif; letter-spacing: .04em; text-transform: uppercase; }
  .place { position: absolute; }
  .place svg { display: block; }
  .cap { position: absolute; font: 700 .2in/1.2 Helvetica, Arial, sans-serif; letter-spacing: .08em; }
  .notes { position: absolute; font-size: .12in; line-height: 1.45; }
  .notes h4 { margin: 0 0 .05in; font-size: .14in; letter-spacing: .08em; text-transform: uppercase; text-decoration: underline; }
  .notes ol { margin: 0; padding-left: .25in; }
  .sched { border-collapse: collapse; font: .11in/1.35 Helvetica, Arial, sans-serif; }
  .sched th, .sched td { border: 1px solid #111; padding: .03in .08in; text-align: left; }
  .sched th { background: #eee; letter-spacing: .06em; text-transform: uppercase; font-size: .1in; }
  .sched caption { font: 700 .2in/1.4 Georgia, "Times New Roman", serif; letter-spacing: .1em; text-align: left; }
`;
function titleBlock(sheetTitle, n) {
  return `<div class="tb">
    <div><div class="big">SF 1600 <span style="font-size:.28in">F</span></div><div class="sub">1,600 sf variant of SF 1258 F</div></div>
    <div class="warn">Concept study<br>Not for construction</div>
    <div><div class="k">Derived from</div><div class="v" style="font-weight:500;font-size:.13in">Plan Factory plan SF 1258 “F” — designs by Antonio Escobedo, San Antonio, TX (drawn 6/22/2023, plotted 10/10/2023). Permit drawings must be prepared by the plan's designer or a licensed designer/engineer.</div></div>
    <div><div class="k">Prepared for</div><div class="v">DANTEGA HOMES<br>DANIEL ORHIUNU</div><div class="v" style="font-size:.14in">738 SAWTOOTH DR.</div><div style="font-size:.12in;color:#333">Lot 48 · Block 23 · N.C.B. 15850<br>Lackland City Subdivision<br>San Antonio, Bexar County, TX</div></div>
    ${n === 2 ? `<div><div class="k">Square footage tabulations</div><table class="tab" style="width:100%;margin-top:.05in"><tr><td>LIVING AREA</td><td>${sf(A.living)}</td></tr><tr><td>GARAGE</td><td>${sf(A.garage)}</td></tr><tr><td>COV. PORCH</td><td>${sf(A.porch)}</td></tr><tr class="total"><td>TOTAL UNDER ROOF</td><td>${sf(A.total)}</td></tr><tr><td>FLATWORK</td><td>${sf(imp.flatwork)}</td></tr></table></div>` : `<div><div class="k">Impervious cover</div><table class="tab" style="width:100%;margin-top:.05in"><tr><td>LOT</td><td>${sf(imp.lot)}</td></tr><tr><td>HOUSE</td><td>${sf(imp.house)}</td></tr><tr><td>FLATWORK</td><td>${sf(imp.flatwork)}</td></tr><tr class="total"><td>TOTAL</td><td>${sf(imp.total)} (${Math.round(imp.pct)}%)</td></tr></table></div>`}
    <div class="title"><div class="t">${sheetTitle}</div></div>
    <div><div class="k">Date</div><div class="v">${date}</div><div class="k" style="margin-top:.08in">Generated from</div><div class="v" style="font-weight:500;font-size:.12in">plans/sf1600/spec/sf1600.json · 2021 IRC conventions carried from the original sheets</div></div>
    <div style="border-bottom:none;display:flex;justify-content:space-between;align-items:baseline"><span class="k">Sheet</span><span class="big" style="font-size:.5in">${n}</span><span class="k">of 2</span></div>
  </div>`;
}
function place(d, x, y, cap) {
  return `<div class="place" style="left:${x}in;top:${y}in;width:${d.w}in;height:${d.h}in">${d.svg}</div>` + (cap ? `<div class="cap" style="left:${x}in;top:${y - 0.28}in">${cap}</div>` : '');
}
// ---- schedules (shared)
const doors = spec.doors.slice().sort((a, b) => String(a.id).localeCompare(String(b.id), undefined, { numeric: true }));
const dsz = d => { const m = (d.label || '').match(/\d{4}/); return m ? m[0] : fmt(d.w) + ' x 6\'-8"'; };
let dsched = `<table class="sched"><caption>DOOR SCHEDULE</caption><tr><th>Mark</th><th>Size</th><th>Type</th><th>Remarks</th></tr>`;
doors.forEach(d => { dsched += `<tr><td>${d.id}</td><td>${dsz(d)}</td><td>${d.kind}</td><td>${d.label || ''}</td></tr>`; });
dsched += `</table>`;
const marks = {}; spec.windows.forEach(w => { const k = w.mark + '|' + w.label; marks[k] = marks[k] || { mark: w.mark, label: w.label, w: w.w, n: 0 }; marks[k].n++; });
let wsched = `<table class="sched"><caption>WINDOW SCHEDULE</caption><tr><th>Mark</th><th>Unit</th><th>Qty</th><th>Rough width</th><th>Remarks</th></tr>`;
Object.keys(marks).sort().forEach(k => { const m = marks[k]; wsched += `<tr><td>${m.mark}</td><td>${m.label}</td><td>${m.n}</td><td>${fmt(m.w)}</td><td>Vinyl, insul. low-E glass, screens; SHGC .25 / U .35 max; tempered where required (IRC R308)</td></tr>`; });
wsched += `</table><p style="margin:.08in 0 0">Notes: see manufacturer for rough openings; window brand as selected by owner; every bedroom has an egress window (PR 3050 SH).</p>`;
const notesHtml = `<h4>General notes</h4><ol>
  <li>All construction to be done according to the 2021 I.R.C. (International Residential Code) and local amendments; tornado resistance per the original plan notes.</li>
  <li>Make sure all drainage run-off flows away from the house foundation. Provide PVC conduits below driveways for future landscape wiring.</li>
  <li>All roof overhangs to be 18" from frame unless noted otherwise. Composition shingles, 6:12 pitch, ridge vents. Metal flashing at roof intersections, adjoining walls and roof penetrations.</li>
  <li>Board & batten siding as selected with 4" trim; stone veneer wainscot to 3'-0" with brick rowlock cap, as specified.</li>
  <li>Plates 9'-1"; covered porch plate 12'-1". Header heights 6'-8". Exterior walls 2x4 with 5-1/2" veneer ledge as the original; plumbing walls 2x6.</li>
  <li>Site placement: house set ${fmt(placement.origin[0] * 12)} off the left P.L. and ${fmt(placement.origin[1] * 12)} from the Hunt Lane P.L.; clearances left ${fmt(placement.clearances.left * 12)}, right ${fmt(placement.clearances.right * 12)}, front ${fmt(placement.clearances.front * 12)} (B.S.L. 5' / 5' / 20'). Verify against the recorded plat and deed restrictions before proceeding.</li>
  <li>Areas are computed to the outside face of frame from the plan geometry; the original SF 1258 F sheet tabulated 1,258 sf living by its own convention.</li>
  </ol>`;

// ---- sheet 1: site plan, roof plan, schedules + notes
const inner = { x: 0.62, y: 0.62, w: 36 - 0.62 - 3.62, h: 24 - 1.24 };
let s1 = `<div class="sheet"><div class="border"></div><div class="inner"></div>`;
s1 += place(D.site, inner.x + 0.3, inner.y + 0.4);
const rx = inner.x + 0.3 + D.site.w + 0.5;
s1 += place(D.roof, rx, inner.y + 0.5);
const colX = rx + D.roof.w + 0.6, colW = inner.x + inner.w - colX - 0.3;
s1 += `<div class="notes" style="left:${colX}in;top:${inner.y + 0.5}in;width:${colW}in">${dsched}<div style="height:.3in"></div>${wsched}</div>`;
s1 += `<div class="notes" style="left:${rx}in;top:${inner.y + 0.5 + D.roof.h + 0.5}in;width:${D.roof.w + 0.3}in">${notesHtml}</div>`;
s1 += titleBlock('Site plan<br>Roof plan<br>&amp; Schedules', 1) + `</div>`;

// ---- sheet 2: floor plan (1/4") + four elevations (3/16")
let s2 = `<div class="sheet"><div class="border"></div><div class="inner"></div>`;
s2 += place(D.plan, inner.x + 0.3, inner.y + 0.3);
const px2 = inner.x + 0.3 + D.plan.w + 0.5;
let ey = inner.y + 0.5;
for (const k of ['front', 'rear', 'left', 'right']) { s2 += place(D[k], px2, ey); ey += D[k].h + 0.35; }
s2 += titleBlock('Floor plan<br>&amp; Elevations', 2) + `</div>`;

const wrap = body => `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body>${body}</body></html>`;
fs.writeFileSync(path.join(outdir, 'sheet1.html'), wrap(s1));
fs.writeFileSync(path.join(outdir, 'sheet2.html'), wrap(s2));
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const browser = await chromium.launch();
for (const n of [1, 2]) {
  const page = await browser.newPage();
  await page.setContent(fs.readFileSync(path.join(outdir, `sheet${n}.html`), 'utf8'), { waitUntil: 'load' });
  await page.pdf({ path: path.join(outdir, `sheet${n}.pdf`), width: '36in', height: '24in', printBackground: true, pageRanges: '1' });
  await page.close();
  console.log('wrote', `sheet${n}.pdf`);
}
await browser.close();
execFileSync('python3', ['-c', `
import pymupdf, os
out="${outdir}"
m=pymupdf.open()
for n in (1,2): m.insert_pdf(pymupdf.open(os.path.join(out,f"sheet{n}.pdf")))
m.save(os.path.join(out,"SF1600_Concept_Sheets.pdf")); m.close()
d=pymupdf.open(os.path.join(out,"SF1600_Concept_Sheets.pdf"))
for i,pg in enumerate(d):
    pix=pg.get_pixmap(matrix=pymupdf.Matrix(70/72,70/72),alpha=False); pix.save(os.path.join(out,f"sheet{i+1}.png"))
    print("page",i+1,pg.rect.width/72,"x",pg.rect.height/72,"in ->",pix.width,"x",pix.height)
`], { stdio: 'inherit' });
console.log('done ->', outdir);
