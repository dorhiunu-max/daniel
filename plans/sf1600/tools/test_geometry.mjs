#!/usr/bin/env node
/**
 * test_geometry.mjs — sanity checks for web/js/geometry.js (HouseGeometry.build).
 *
 *   node tools/test_geometry.mjs spec/baseline_sf1258.json spec/sf1600_A.json [...]
 *
 * For every spec it prints wall-face counts, the exterior wall length against an
 * independently computed outer perimeter of (living ∪ garage), the roof planes with a
 * slope/coplanarity check, each roof piece's eave and ridge heights, the openings grouped
 * by the side they face, and the maximum ridge height.  Exit code 1 if any check fails.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const HouseGeometry = require(path.join(here, '..', 'web', 'js', 'geometry.js'));

const specs = process.argv.slice(2);
if (!specs.length) {
  console.error('usage: node tools/test_geometry.mjs <spec.json> [...]');
  process.exit(2);
}

// ---- helpers ------------------------------------------------------------------------
function fmtFt(inches) {
  const r = Math.round(inches * 2) / 2;
  const ft = Math.floor(r / 12);
  const rem = r - ft * 12;
  const whole = Math.floor(rem);
  return `${ft}'-${whole}${rem - whole >= 0.5 ? '½' : ''}"`;
}
const f1 = (n) => (Math.round(n * 10) / 10).toString();
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a) => { const l = Math.hypot(...a); return l ? a.map((v) => v / l) : a; };

function pointInPoly(pt, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > pt[1]) !== (yj > pt[1]) && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Outer perimeter of the union of rectilinear polygons, by counting grid-cell boundary edges. */
function unionPerimeter(polys) {
  const xs = [...new Set(polys.flat().map((p) => p[0]))].sort((a, b) => a - b);
  const ys = [...new Set(polys.flat().map((p) => p[1]))].sort((a, b) => a - b);
  const nx = xs.length - 1, ny = ys.length - 1;
  const inside = (i, j) => {
    if (i < 0 || j < 0 || i >= nx || j >= ny) return false;
    const c = [(xs[i] + xs[i + 1]) / 2, (ys[j] + ys[j + 1]) / 2];
    return polys.some((p) => pointInPoly(c, p));
  };
  let per = 0;
  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < ny; j++) {
      if (!inside(i, j)) continue;
      const w = xs[i + 1] - xs[i], h = ys[j + 1] - ys[j];
      if (!inside(i - 1, j)) per += h;
      if (!inside(i + 1, j)) per += h;
      if (!inside(i, j - 1)) per += w;
      if (!inside(i, j + 1)) per += w;
    }
  }
  return per;
}

function fitPlane(poly3) {
  const v0 = poly3[0];
  let n = null;
  for (let i = 1; i < poly3.length && !n; i++) {
    for (let j = i + 1; j < poly3.length; j++) {
      const c = cross(sub(poly3[i], v0), sub(poly3[j], v0));
      if (Math.hypot(...c) > 1e-6) { n = norm(c); break; }
    }
  }
  if (!n) return null;
  if (n[2] < 0) n = n.map((v) => -v);
  const maxDev = Math.max(...poly3.map((p) => Math.abs(dot(sub(p, v0), n))));
  return { n, maxDev };
}

// ---- per-spec checks -------------------------------------------------------------------
let failures = 0;
const fail = (msg) => { failures++; console.log('  FAIL ' + msg); };
const pass = (msg) => console.log('  ok   ' + msg);

for (const specPath of specs) {
  const spec = JSON.parse(fs.readFileSync(specPath, 'utf8'));
  const name = path.basename(specPath, '.json');
  console.log(`\n=== ${name} (${spec.name || ''}) ===`);
  const g = HouseGeometry.build(spec);
  const pitch = g.pitch, tanP = pitch / 12;

  // -- walls
  const byKind = {};
  for (const w of g.walls) byKind[w.kind] = (byKind[w.kind] || 0) + 1;
  console.log(`wall faces: ${g.walls.length}  (${Object.entries(byKind).map(([k, v]) => `${k} ${v}`).join(', ')})`);
  const extLen = g.walls.filter((w) => w.kind === 'wall').reduce((s, w) => s + w.len, 0);
  const polys = [spec.footprint.living, spec.footprint.garage].filter(Boolean);
  const per = unionPerimeter(polys);
  const dPer = Math.abs(extLen - per);
  (dPer <= 1 ? pass : fail)(`exterior wall length ${f1(extLen)}" (${fmtFt(extLen)}) vs union perimeter ${f1(per)}" — diff ${f1(dPer)}"`);

  // every wall face vertical, unit outward normal, quad/triangle winding CCW from outside
  const union = (pt) => polys.some((p) => pointInPoly(pt, p));
  let wallProblems = 0;
  for (const w of g.walls) {
    const n = w.normal;
    if (Math.abs(Math.hypot(...n) - 1) > 1e-3 || Math.abs(n[2]) > 1e-9) { wallProblems++; console.log(`    bad normal on ${w.id}: ${n}`); }
    const xy = w.poly3.map((p) => [p[0], p[1]]);
    const spread = Math.max(...xy.map((p) => Math.abs((p[0] - xy[0][0]) * n[0] + (p[1] - xy[0][1]) * n[1])));
    if (spread > 1e-6) { wallProblems++; console.log(`    ${w.id} is not vertical/planar`); }
    if (w.kind === 'wall') {
      const c = [(w.a[0] + w.b[0]) / 2, (w.a[1] + w.b[1]) / 2];
      const out = [c[0] + n[0] * 2, c[1] + n[1] * 2], inn = [c[0] - n[0] * 2, c[1] - n[1] * 2];
      if (union(out) || !union(inn)) { wallProblems++; console.log(`    ${w.id} normal does not point outward`); }
      if (HouseGeometry.sideOfNormal(n[0], n[1]) !== w.side) { wallProblems++; console.log(`    ${w.id} side mismatch`); }
      // winding: bottom edge a→b must run toward the viewer's right for its side
      const u = HouseGeometry.SIDES[w.side].u;
      if ((w.b[0] - w.a[0]) * u[0] + (w.b[1] - w.a[1]) * u[1] <= 0) { wallProblems++; console.log(`    ${w.id} winding not left→right`); }
      if (w.poly3[0][2] !== 0 || Math.abs(w.poly3[2][2] - g.plate) > 1e-9) { wallProblems++; console.log(`    ${w.id} height not 0→plate`); }
    }
  }
  (wallProblems ? fail : pass)(`wall faces vertical, outward unit normals, CCW-from-outside winding (${wallProblems} problems)`);
  const closures = g.walls.filter((w) => w.kind === 'closure');
  if (closures.length) console.log(`  porch closure panels: ${closures.map((w) => `${w.id} ${f1(w.len)}" z ${w.z0}→${w.z1}`).join('; ')}`);

  // -- roofs
  console.log(`roof planes: ${g.roofsUnclipped.length} whole planes → ${g.roofs.length} visible parts`);
  let roofProblems = 0;
  for (const r of g.roofsUnclipped.concat(g.roofs)) {
    const fit = fitPlane(r.poly3);
    if (!fit) { roofProblems++; console.log(`    ${r.id}: degenerate`); continue; }
    const slope = Math.hypot(fit.n[0], fit.n[1]) / fit.n[2];
    const okSlope = Math.abs(slope - tanP) <= 0.01;
    const okPlanar = fit.maxDev <= 0.1;
    const okNormal = dot(fit.n, r.normal) > 0.9999;
    const grad = norm([fit.n[0], fit.n[1], 0]);
    const okDown = grad[0] * r.down[0] + grad[1] * r.down[1] > 0.999;
    const zs = r.poly3.map((p) => p[2]);
    // a visible part may stop short of the eave/ridge; a whole plane must span eave→ridge
    const whole = r.part === undefined;
    const okZ = whole
      ? Math.abs(Math.min(...zs) - r.eaveZ) < 1e-6 && Math.abs(Math.max(...zs) - r.ridgeZ) < 1e-6
      : Math.min(...zs) >= r.eaveZ - 1e-6 && Math.max(...zs) <= r.ridgeZ + 1e-6;
    const ok = okSlope && okPlanar && okNormal && okDown && okZ;
    if (!ok) roofProblems++;
    const zr = `${f1(Math.min(...zs))}→${f1(Math.max(...zs))}`;
    console.log(`    ${ok ? 'ok  ' : 'FAIL'} ${(whole ? 'plane ' : 'part  ') + r.id.padEnd(24)} ${r.kind.padEnd(5)} ${r.slope.padEnd(12)} dz/run=${slope.toFixed(4)} (want ${tanP.toFixed(4)}) coplanar±${fit.maxDev.toFixed(3)}" verts=${r.poly3.length} z ${zr.padEnd(9)}${whole ? '' : ' edges=' + r.edges.join(',')}${okNormal ? '' : ' normal-mismatch'}${okDown ? '' : ' down-mismatch'}${okZ ? '' : ' z-mismatch'}`);
  }
  (roofProblems ? fail : pass)(`roof slopes ${pitch}:12 and coplanar within 0.1" (${roofProblems} problems)`);

  // visible parts must tile the upper envelope of all planes exactly: sample a grid
  {
    const b = g.bounds;
    let n = 0, bad = 0, uncovered = 0, doubled = 0;
    const partsXY = g.roofs.map((r) => ({ r, xy: r.poly3.map((p) => [p[0], p[1]]) }));
    const inConvex = (pt, xy, tol) => {
      const s = HouseGeometry.signedArea(xy) > 0 ? 1 : -1;
      for (let i = 0; i < xy.length; i++) {
        const p = xy[i], q = xy[(i + 1) % xy.length], len = Math.hypot(q[0] - p[0], q[1] - p[1]);
        if (((q[0] - p[0]) * (pt[1] - p[1]) - (q[1] - p[1]) * (pt[0] - p[0])) * s / len < -tol) return false;
      }
      return true;
    };
    const zOnPart = (r, x, y) => { const v = r.poly3[0], nn = r.normal; return v[2] - (nn[0] * (x - v[0]) + nn[1] * (y - v[1])) / nn[2]; };
    for (let x = b.minX + 3; x < b.maxX; x += 6) {
      for (let y = b.minY + 3; y < b.maxY; y += 6) {
        const env = HouseGeometry.roofZ(g, x, y);
        // skip points within 1" of any part edge (ties / boundaries)
        let near = false;
        for (const { xy } of partsXY) { if (inConvex([x, y], xy, 1) && !inConvex([x, y], xy, -1)) { near = true; break; } }
        if (near) continue;
        const hits = partsXY.filter(({ xy }) => inConvex([x, y], xy, 0));
        n++;
        if (env === -Infinity) { if (hits.length) doubled++; continue; }
        if (!hits.length) { uncovered++; continue; }
        if (hits.length > 1) doubled++;
        const dz = Math.max(...hits.map(({ r }) => Math.abs(zOnPart(r, x, y) - env)));
        if (dz > 0.05) bad++;
      }
    }
    ((bad || uncovered || doubled) ? fail : pass)(`visible roof parts tile the roof's upper envelope (${n} samples: ${uncovered} uncovered, ${doubled} overlapping, ${bad} wrong height)`);
  }

  console.log('roof pieces:');
  for (const p of g.roofPieces) {
    const cnt = g.roofsUnclipped.filter((r) => r.piece === p.id).length;
    const vis = g.roofs.filter((r) => r.piece === p.id).length;
    const gab = g.walls.filter((w) => w.kind === 'gable' && w.piece === p.id);
    console.log(`    ${p.id.padEnd(8)} ${p.kind.padEnd(5)} ridge ${p.ridge}  plate ${p.plate}"  eave z ${p.eaveZ}" (${fmtFt(p.eaveZ)})  ridge z ${p.ridgeZ}" (${fmtFt(p.ridgeZ)})  halfSpan ${p.halfSpan}"  ridge ${JSON.stringify(p.ridgeLine)}  ends ${JSON.stringify(p.ends)}  planes ${cnt} (${vis} visible parts)  gable-tris ${gab.length}`);
    // the roof at the frame line must sit at the plate; gable apex at the ridge
    for (const w of gab) {
      const apex = w.poly3[2], base = w.poly3[0];
      if (Math.abs(apex[2] - p.ridgeZ) > 1e-6 || Math.abs(base[2] - p.plate) > 1e-6) fail(`gable ${w.id} base/apex z ${base[2]}/${apex[2]} != plate/ridge ${p.plate}/${p.ridgeZ}`);
    }
    const ovh = g.overhang;
    if (Math.abs((p.eaveZ + ovh * tanP) - p.plate) > 1e-6) fail(`${p.id}: roof at the frame line is ${p.eaveZ + ovh * tanP}, plate ${p.plate}`);
  }
  // whole planes: 2 quads + one hip triangle per hip end; one gable triangle per gable end
  for (const p of g.roofPieces) {
    const planes = g.roofsUnclipped.filter((r) => r.piece === p.id);
    const tris = planes.filter((r) => r.poly3.length === 3).length, quads = planes.filter((r) => r.poly3.length === 4).length;
    const ends = Object.values(p.ends);
    const hipEnds = ends.filter((e) => e === 'hip').length, gabEnds = ends.filter((e) => e === 'gable').length;
    const gabTris = g.walls.filter((w) => w.kind === 'gable' && w.piece === p.id).length;
    if (quads !== 2 || tris !== hipEnds || gabTris !== gabEnds) fail(`${p.id}: expected 2 quads + ${hipEnds} hip tris + ${gabEnds} gable tris, got ${quads}/${tris}/${gabTris}`);
  }
  // with clipping off the contract's simple planes come back unchanged
  {
    const g0 = HouseGeometry.build(spec, { clip: false, autoValley: false });
    const hips = g0.roofPieces.filter((p) => p.kind === 'hip');
    const okHip = hips.every((p) => g0.roofs.filter((r) => r.piece === p.id).length === 4);
    (okHip && g0.roofs.length === g0.roofsUnclipped.length ? pass : fail)(`clip:false, autoValley:false → ${g0.roofs.length} whole planes, every hip piece has 4`);
  }

  // -- openings
  console.log(`openings: ${g.openings.length}`);
  let openProblems = 0;
  for (const side of HouseGeometry.SIDE_NAMES) {
    const list = g.openings.filter((o) => o.side === side);
    if (!list.length) continue;
    console.log(`  ${side}:`);
    for (const o of list) {
      const wall = g.walls.find((w) => w.id === o.wallId);
      if (!wall || wall.side !== side) { openProblems++; console.log(`      wall mismatch for ${o.mark}`); }
      if (!(o.z1 > o.z0)) { openProblems++; console.log(`      bad z for ${o.mark}`); }
      const u = HouseGeometry.SIDES[side].u;
      const cu = ((o.x0 + o.x1) / 2) * u[0] + ((o.y0 + o.y1) / 2) * u[1];
      console.log(`      ${o.kind.padEnd(6)} ${String(o.mark || o.id).padEnd(3)} ${o.units}× ${o.unitW}"×${o.h}"  total ${o.w}"×${o.h}"  sill ${o.z0}" head ${o.z1}"  at u=${f1(cu)} (${fmtFt(cu)}) on ${o.wallId}  [${o.label}]`);
    }
  }
  const noSide = g.openings.filter((o) => !HouseGeometry.SIDE_NAMES.includes(o.side));
  if (noSide.length) { openProblems += noSide.length; console.log(`  openings without a side: ${noSide.map((o) => o.mark).join(', ')}`); }
  (openProblems ? fail : pass)(`openings resolved to exterior walls (${openProblems} problems)`);
  // exterior-door expectations: every overhead door and every door with 'outside' access must be present; interior ones absent
  const exteriorIds = g.openings.filter((o) => o.kind !== 'window').map((o) => o.id);
  const utilityGarage = (spec.doors || []).find((d) => /garage\)/.test(d.label || '') && d.kind !== 'overhead');
  if (utilityGarage && exteriorIds.includes(utilityGarage.id)) fail(`utility→garage door ${utilityGarage.id} treated as exterior`);
  else pass(`interior doors excluded (exterior doors: ${exteriorIds.join(', ')})`);
  const winCount = (spec.windows || []).length, gotWin = g.openings.filter((o) => o.kind === 'window').length;
  (winCount === gotWin ? pass : fail)(`all ${winCount} windows resolved (${gotWin})`);

  // -- bounds / ridge
  const maxRidge = Math.max(...g.roofPieces.map((p) => p.ridgeZ));
  console.log(`bounds: x ${g.bounds.minX}..${g.bounds.maxX}  y ${g.bounds.minY}..${g.bounds.maxY}  maxZ ${g.bounds.maxZ}`);
  (Math.abs(g.bounds.maxZ - maxRidge) < 1e-6 ? pass : fail)(`max ridge height ${maxRidge}" = ${fmtFt(maxRidge)} above the slab (bounds.maxZ ${g.bounds.maxZ})`);
  if (g.warnings.length) console.log('warnings:\n' + g.warnings.map((w) => '    ' + w).join('\n'));
}

console.log(failures ? `\n${failures} check(s) FAILED` : '\nall checks passed');
process.exit(failures ? 1 : 0);
