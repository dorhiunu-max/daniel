#!/usr/bin/env node
/**
 * preview_geometry.mjs — diagnostic rendering of HouseGeometry.build(spec):
 * a plan view of every roof plane (outlined, slope arrow, ridge lines) over the footprint,
 * plus four orthographic elevations (front / rear / left / right) drawn face by face —
 * every wall face, gable triangle, roof-plane outline and opening rectangle, painted
 * far-to-near with translucent fills so hidden edges still show through.
 *
 *   node tools/preview_geometry.mjs spec/baseline_sf1258.json [spec/sf1600_A.json ...]
 *        [--out renderings/_test] [--scale 0.7]
 *
 * Writes renderings/_test/geom_<specname>.svg and .png (PNG via Playwright's Chromium;
 * never runs `playwright install`).
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const HouseGeometry = require(path.join(here, '..', 'web', 'js', 'geometry.js'));

const argv = process.argv.slice(2);
const specs = [];
let outDir = path.join(here, '..', 'renderings', '_test');
let S = 0.7; // px per inch
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--out') outDir = argv[++i];
  else if (argv[i] === '--scale') S = Number(argv[++i]);
  else specs.push(argv[i]);
}
if (!specs.length) { console.error('usage: node tools/preview_geometry.mjs <spec.json> [...] [--out dir] [--scale pxPerInch]'); process.exit(2); }

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const f = (n) => Math.round(n * 100) / 100;
function fmtFt(inches) {
  const r = Math.round(inches * 2) / 2, ft = Math.floor(r / 12), rem = r - ft * 12, whole = Math.floor(rem);
  return `${ft}'-${whole}${rem - whole >= 0.5 ? '½' : ''}"`;
}
const PIECE_COLORS = ['#c0392b', '#2980b9', '#27ae60', '#8e44ad', '#d35400', '#16a085', '#7f8c8d'];
const FONT = "font-family='Helvetica, Arial, sans-serif'";

function pieceColor(g, piece) {
  const i = g.roofPieces.findIndex((p) => p.id === piece);
  return PIECE_COLORS[(i < 0 ? 0 : i) % PIECE_COLORS.length];
}

// ---- plan panel ---------------------------------------------------------------------------
function planPanel(spec, g, ox, oy) {
  const pad = 40;
  const b = g.bounds;
  const W = (b.maxX - b.minX) * S + pad * 2, H = (b.maxY - b.minY) * S + pad * 2;
  const X = (x) => ox + pad + (x - b.minX) * S, Y = (y) => oy + pad + (y - b.minY) * S;
  const P = (poly) => poly.map((p) => `${f(X(p[0]))},${f(Y(p[1]))}`).join(' ');
  let s = `<rect x="${ox}" y="${oy}" width="${f(W)}" height="${f(H)}" fill="#fff" stroke="#999"/>`;
  s += `<text x="${ox + 8}" y="${oy + 16}" font-size="13" font-weight="bold" ${FONT}>ROOF PLANES — plan view (street at the bottom)</text>`;
  s += `<text x="${ox + 8}" y="${oy + 30}" font-size="9" fill="#555" ${FONT}>fills = visible parts; black = ridge; blue dashed = valley; grey dotted = coplanar seam / internal split; faint dashes = whole (unclipped) planes; blue ticks = openings</text>`;
  const fp = spec.footprint || {};
  if (fp.stoop) s += `<polygon points="${P(fp.stoop)}" fill="#f2f2f2" stroke="#bbb" stroke-dasharray="3,2"/>`;
  if (fp.porch) s += `<polygon points="${P(fp.porch)}" fill="#f7f7f7" stroke="#aaa" stroke-dasharray="3,2"/>`;
  if (fp.living) s += `<polygon points="${P(fp.living)}" fill="#e6e6e6" stroke="#333" stroke-width="1.2"/>`;
  if (fp.garage) s += `<polygon points="${P(fp.garage)}" fill="#ededed" stroke="#333" stroke-width="1.2"/>`;
  for (const c of spec.porch_columns || []) s += `<rect x="${f(X(c.x))}" y="${f(Y(c.y))}" width="${f(c.size * S)}" height="${f(c.size * S)}" fill="#bbb" stroke="#333"/>`;
  // roof planes: visible parts filled, edges styled by tag; whole planes as faint dashed outlines
  for (const r of g.roofsUnclipped) {
    const col = pieceColor(g, r.piece);
    s += `<polygon points="${P(r.poly3.map((p) => [p[0], p[1]]))}" fill="none" stroke="${col}" stroke-width="0.6" stroke-opacity="0.35" stroke-dasharray="2,3"/>`;
  }
  const EDGE = {
    eave: 'stroke-width="1.6"', ridge: 'stroke-width="3" stroke="#000"', hip: 'stroke-width="1.3"', rake: 'stroke-width="1.6"',
    valley: 'stroke-width="1.6" stroke="#0a58ca" stroke-dasharray="6,3"', under: 'stroke-width="1.2" stroke-dasharray="2,2"',
    seam: 'stroke-width="0.8" stroke="#999" stroke-dasharray="1,3"', internal: 'stroke-width="0.6" stroke="#bbb" stroke-dasharray="1,2"', cut: 'stroke-width="1.6" stroke="#f0f"'
  };
  for (const r of g.roofs) {
    const col = pieceColor(g, r.piece);
    const xy = r.poly3.map((p) => [p[0], p[1]]);
    s += `<polygon points="${P(xy)}" fill="${col}" fill-opacity="0.13" stroke="none"/>`;
    for (let i = 0; i < xy.length; i++) {
      const a = xy[i], b2 = xy[(i + 1) % xy.length], tag = r.edges[i];
      s += `<line x1="${f(X(a[0]))}" y1="${f(Y(a[1]))}" x2="${f(X(b2[0]))}" y2="${f(Y(b2[1]))}" stroke="${col}" ${EDGE[tag] || 'stroke-width="1"'}/>`;
    }
    const cx = xy.reduce((a, p) => a + p[0], 0) / xy.length, cy = xy.reduce((a, p) => a + p[1], 0) / xy.length;
    const L = 22 / S; // arrow length in inches
    const ax = cx + r.down[0] * L, ay = cy + r.down[1] * L;
    s += `<line x1="${f(X(cx - r.down[0] * L * 0.4))}" y1="${f(Y(cy - r.down[1] * L * 0.4))}" x2="${f(X(ax))}" y2="${f(Y(ay))}" stroke="${col}" stroke-width="1.6" marker-end="url(#arr)"/>`;
    if (r.part === 0 || Math.abs(HouseGeometry.signedArea(xy)) > 4000) s += `<text x="${f(X(cx))}" y="${f(Y(cy)) - 6}" font-size="9" text-anchor="middle" fill="${col}" ${FONT}>${esc(r.piece + ' ' + r.slope + (r.parts > 1 ? ' #' + r.part : ''))}</text>`;
  }
  // ridge lines + heights
  for (const p of g.roofPieces) {
    const [a, b2] = p.ridgeLine;
    s += `<line x1="${f(X(a[0]))}" y1="${f(Y(a[1]))}" x2="${f(X(b2[0]))}" y2="${f(Y(b2[1]))}" stroke="#000" stroke-width="3"/>`;
    s += `<circle cx="${f(X(a[0]))}" cy="${f(Y(a[1]))}" r="2.5" fill="#000"/><circle cx="${f(X(b2[0]))}" cy="${f(Y(b2[1]))}" r="2.5" fill="#000"/>`;
    const mx = (a[0] + b2[0]) / 2, my = (a[1] + b2[1]) / 2;
    s += `<text x="${f(X(mx))}" y="${f(Y(my)) + 12}" font-size="9" text-anchor="middle" fill="#000" ${FONT}>${esc(`${p.id} ${p.kind} ridge ${fmtFt(p.ridgeZ)} / eave ${fmtFt(p.eaveZ)}`)}</text>`;
  }
  // openings as thick blue ticks on the wall line
  for (const o of g.openings) {
    s += `<line x1="${f(X(o.x0))}" y1="${f(Y(o.y0))}" x2="${f(X(o.x1))}" y2="${f(Y(o.y1))}" stroke="#0a58ca" stroke-width="3.5"/>`;
    s += `<text x="${f(X((o.x0 + o.x1) / 2) + o.normal[0] * 10)}" y="${f(Y((o.y0 + o.y1) / 2) + o.normal[1] * 10 + 3)}" font-size="8" text-anchor="middle" fill="#0a58ca" ${FONT}>${esc(o.mark || o.id)}:${o.side[0].toUpperCase()}</text>`;
  }
  // wall faces: outward normal ticks
  for (const w of g.walls) {
    if (w.kind !== 'wall') continue;
    const cx = (w.a[0] + w.b[0]) / 2, cy = (w.a[1] + w.b[1]) / 2;
    s += `<line x1="${f(X(cx))}" y1="${f(Y(cy))}" x2="${f(X(cx + w.normal[0] * 8))}" y2="${f(Y(cy + w.normal[1] * 8))}" stroke="#333" stroke-width="1"/>`;
  }
  return { svg: s, w: W, h: H };
}

// ---- elevation panel ----------------------------------------------------------------------
function elevationPanel(spec, g, side, ox, oy) {
  const frame = HouseGeometry.SIDES[side];
  const b = g.bounds;
  const corners = [[b.minX, b.minY], [b.maxX, b.minY], [b.minX, b.maxY], [b.maxX, b.maxY]].map((p) => p[0] * frame.u[0] + p[1] * frame.u[1]);
  const umin = Math.min(...corners) - 30, umax = Math.max(...corners) + 30;
  const zmax = b.maxZ + 30, zmin = -12;
  const pad = 24;
  const W = (umax - umin) * S + pad * 2, H = (zmax - zmin) * S + pad * 2 + 10;
  const U = (u) => ox + pad + (u - umin) * S, Z = (z) => oy + pad + 10 + (zmax - z) * S;
  const proj = (p) => { const q = HouseGeometry.project(p, side); return `${f(U(q.u))},${f(Z(q.v))}`; };
  const depthOf = (poly3) => poly3.reduce((a, p) => a + HouseGeometry.project(p, side).depth, 0) / poly3.length;
  const facing = (n) => n[0] * frame.depth[0] + n[1] * frame.depth[1] > 1e-9;

  let s = `<rect x="${ox}" y="${oy}" width="${f(W)}" height="${f(H)}" fill="#fff" stroke="#999"/>`;
  s += `<text x="${ox + 8}" y="${oy + 16}" font-size="13" font-weight="bold" ${FONT}>${side.toUpperCase()} ELEVATION — max ridge ${fmtFt(b.maxZ)}</text>`;
  // grade & plate lines
  s += `<line x1="${f(U(umin))}" y1="${f(Z(0))}" x2="${f(U(umax))}" y2="${f(Z(0))}" stroke="#444" stroke-width="1.5"/>`;
  for (const [z, lab] of [[g.plate, `plate ${fmtFt(g.plate)}`], [g.porchPlate, `porch plate ${fmtFt(g.porchPlate)}`]]) {
    s += `<line x1="${f(U(umin))}" y1="${f(Z(z))}" x2="${f(U(umax))}" y2="${f(Z(z))}" stroke="#c55" stroke-width="0.6" stroke-dasharray="6,3"/>`;
    s += `<text x="${f(U(umin)) + 2}" y="${f(Z(z)) - 2}" font-size="8" fill="#c55" ${FONT}>${esc(lab)}</text>`;
  }
  // gather drawables
  const items = [];
  for (const w of g.walls) items.push({ type: w.kind, poly3: w.poly3, normal: w.normal, depth: depthOf(w.poly3), id: w.id, layer: 0 });
  for (const r of g.roofs) items.push({ type: 'roof', poly3: r.poly3, normal: r.normal, depth: depthOf(r.poly3), id: r.id, piece: r.piece, layer: 0 });
  for (const o of g.openings) {
    const poly3 = [[o.x0, o.y0, o.z0], [o.x1, o.y1, o.z0], [o.x1, o.y1, o.z1], [o.x0, o.y0, o.z1]];
    items.push({ type: 'opening', kind: o.kind, poly3, normal: o.normal, depth: depthOf(poly3) + 0.01, id: o.mark || o.id, layer: 1 });
  }
  items.sort((a, c) => a.depth - c.depth || a.layer - c.layer);
  const FILL = { wall: '#ffffff', column: '#e8dcc8', closure: '#f3f3f3', gable: '#fff4cc', roof: '#d9d9d9', opening: '#bfe0ff' };
  const STROKE = { wall: '#222', column: '#6b4e2e', closure: '#777', gable: '#8a6d00', roof: '#333', opening: '#0a58ca' };
  for (const it of items) {
    const pts = it.poly3.map(proj).join(' ');
    const front = facing(it.normal) || (it.type === 'roof' && it.normal[2] > 0 && Math.abs(it.normal[0] * frame.depth[0] + it.normal[1] * frame.depth[1]) < 1e-9);
    const stroke = it.type === 'roof' ? pieceColor(g, it.piece) : STROKE[it.type];
    if (!front) {
      s += `<polygon points="${pts}" fill="none" stroke="${stroke}" stroke-width="0.7" stroke-opacity="0.45" stroke-dasharray="3,3"/>`;
      continue;
    }
    const fill = it.type === 'roof' ? pieceColor(g, it.piece) : FILL[it.type];
    const op = it.type === 'roof' ? 0.28 : 0.85;
    s += `<polygon points="${pts}" fill="${fill}" fill-opacity="${op}" stroke="${stroke}" stroke-width="${it.type === 'opening' ? 1.2 : 1.1}"/>`;
    if (it.type === 'opening') {
      const c = it.poly3.reduce((a, p) => { const q = HouseGeometry.project(p, side); return [a[0] + q.u / 4, a[1] + q.v / 4]; }, [0, 0]);
      s += `<text x="${f(U(c[0]))}" y="${f(Z(c[1])) + 3}" font-size="8" text-anchor="middle" fill="#0a58ca" ${FONT}>${esc(it.id)}</text>`;
    }
  }
  // ridge height ticks on the right
  for (const p of g.roofPieces) {
    s += `<text x="${f(U(umax)) - 2}" y="${f(Z(p.ridgeZ)) - 1}" font-size="8" text-anchor="end" fill="${pieceColor(g, p.id)}" ${FONT}>${esc(`${p.id} ridge ${fmtFt(p.ridgeZ)}`)}</text>`;
  }
  return { svg: s, w: W, h: H };
}

// ---- compose + render ---------------------------------------------------------------------
async function renderSpec(specPath, chromium) {
  const spec = JSON.parse(fs.readFileSync(specPath, 'utf8'));
  const name = path.basename(specPath, '.json');
  const g = HouseGeometry.build(spec);
  const gap = 16;
  const parts = [];
  // measure first (positions depend on sizes)
  const plan = planPanel(spec, g, 0, 0);
  const fr = elevationPanel(spec, g, 'front', 0, 0);
  const col2x = plan.w + gap;
  const width = col2x + Math.max(fr.w, 10) + gap;
  let y = 0;
  parts.push(planPanel(spec, g, 0, y).svg);
  // stack the four elevations in the right column, wrap below the plan if they run long
  let ey = 0, ex = col2x, maxRight = width;
  const sides = ['front', 'rear', 'left', 'right'];
  const measured = sides.map((sd) => elevationPanel(spec, g, sd, 0, 0));
  const totalRight = measured.reduce((a, m) => a + m.h + gap, 0);
  let bottom = plan.h;
  if (totalRight <= plan.h + 200) {
    for (let i = 0; i < sides.length; i++) { parts.push(elevationPanel(spec, g, sides[i], ex, ey).svg); ey += measured[i].h + gap; }
    bottom = Math.max(plan.h, ey);
  } else {
    // two in the right column, two below the plan
    for (let i = 0; i < 2; i++) { parts.push(elevationPanel(spec, g, sides[i], ex, ey).svg); ey += measured[i].h + gap; }
    let by = plan.h + gap, bx = 0;
    for (let i = 2; i < 4; i++) {
      parts.push(elevationPanel(spec, g, sides[i], bx, by).svg);
      bx += measured[i].w + gap;
      maxRight = Math.max(maxRight, bx);
    }
    bottom = Math.max(ey, by + Math.max(measured[2].h, measured[3].h));
  }
  const notes = [
    `${spec.name || name} — HouseGeometry preview: ${g.walls.length} wall faces, ${g.roofsUnclipped.length} roof planes (${g.roofs.length} visible parts), ${g.openings.length} openings; pitch ${g.pitch}:12, overhang ${g.overhang}", plate ${fmtFt(g.plate)}, porch plate ${fmtFt(g.porchPlate)}`,
    ...g.roofPieces.map((p) => `${p.id}: ${p.kind}, ridge along ${p.ridge}, eave ${fmtFt(p.eaveZ)}, ridge ${fmtFt(p.ridgeZ)}, ends ${Object.entries(p.ends).map(([k, v]) => `${k}=${v}`).join(' ')}`),
    ...(g.warnings.length ? ['warnings: ' + g.warnings.join(' | ')] : [])
  ];
  const noteY = bottom + gap;
  const totalH = noteY + notes.length * 14 + 10;
  const totalW = Math.max(width, maxRight);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${f(totalW)}" height="${f(totalH)}" viewBox="0 0 ${f(totalW)} ${f(totalH)}">
<defs><marker id="arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="context-stroke"/></marker></defs>
<rect width="100%" height="100%" fill="#fafafa"/>
${parts.join('\n')}
${notes.map((t, i) => `<text x="6" y="${f(noteY + 12 + i * 14)}" font-size="10" ${FONT}>${esc(t)}</text>`).join('\n')}
</svg>`;
  fs.mkdirSync(outDir, { recursive: true });
  const svgPath = path.join(outDir, `geom_${name}.svg`), pngPath = path.join(outDir, `geom_${name}.png`);
  fs.writeFileSync(svgPath, svg);
  console.log(`wrote ${svgPath} (${f(totalW)}x${f(totalH)})`);
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ deviceScaleFactor: 1.5, viewport: { width: Math.ceil(totalW) + 20, height: Math.ceil(totalH) + 20 } });
    await page.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;background:#fff}body{padding:10px;display:inline-block}svg{display:block}</style></head><body>${svg}</body></html>`, { waitUntil: 'load' });
    await page.locator('svg').first().screenshot({ path: pngPath });
    console.log(`wrote ${pngPath}`);
  } finally {
    await browser.close();
  }
}

const { chromium } = require('/opt/node22/lib/node_modules/playwright');
for (const sp of specs) await renderSpec(sp, chromium);
