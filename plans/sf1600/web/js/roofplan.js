/*  roofplan.js — roof plan (view from above) from HouseGeometry (see web/CONTRACTS.md).
 *
 *    RoofPlan.renderSVG(spec, {pxPerInch=1, title=true, note=true, background='#fff', pad=40}) -> "<svg …>"
 *
 *  Uses the clipped visible roof parts: their edges are tagged eave/ridge/hip/valley/rake so the
 *  plan shows exactly the creases a roofer would frame, with pitch arrows pointing down-slope and
 *  "RIDGE VNT." on every ridge.  SVG user units are inches; street at the bottom (+y down).
 *  UMD: window.RoofPlan / module.exports.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) { module.exports = factory(require('./geometry.js')); }
  else { root.RoofPlan = factory(root.HouseGeometry); }
}(typeof self !== 'undefined' ? self : this, function (HG) {
  'use strict';
  var C = { line: '#2b2b2b', ridge: '#111111', roof: '#f7f7f7', foot: '#d9d9d9', footLine: '#9a9a9a', text: '#1f1f1f', arrow: '#333333', slab: '#ececec' };
  function num(n) { return Math.round(n * 100) / 100; }
  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;'); }
  function pts(poly) { return poly.map(function (p) { return num(p[0]) + ',' + num(p[1]); }).join(' '); }
  function area(poly) { var a = 0; for (var i = 0; i < poly.length; i++) { var p = poly[i], q = poly[(i + 1) % poly.length]; a += p[0] * q[1] - q[0] * p[1]; } return Math.abs(a / 2); }
  function centroid(poly) { // area-weighted centroid of a simple polygon
    var A = 0, cx = 0, cy = 0;
    for (var i = 0; i < poly.length; i++) { var p = poly[i], q = poly[(i + 1) % poly.length], f = p[0] * q[1] - q[0] * p[1]; A += f; cx += (p[0] + q[0]) * f; cy += (p[1] + q[1]) * f; }
    if (Math.abs(A) < 1e-9) { var x = 0, y = 0; poly.forEach(function (p) { x += p[0]; y += p[1]; }); return [x / poly.length, y / poly.length]; }
    return [cx / (3 * A), cy / (3 * A)];
  }
  function fmtFt(inches) { inches = Math.round(inches * 2) / 2; var ft = Math.floor(inches / 12), rem = inches - ft * 12; return ft + "'-" + (Math.abs(rem - Math.round(rem)) < 1e-6 ? Math.round(rem) : Math.floor(rem) + '½') + '"'; }

  function renderSVG(spec, opts) {
    opts = opts || {};
    var ppi = opts.pxPerInch || 1, pad = opts.pad == null ? 40 : opts.pad;
    var g = HG.build(spec);
    var b = g.bounds, fp = spec.footprint || {};
    var left = b.minX - pad, top = b.minY - pad - (opts.title === false ? 0 : 0), right = b.maxX + pad, bottom = b.maxY + pad;
    var noteBand = opts.note === false ? 0 : 34, titleBand = opts.title === false ? 0 : 48;
    var W = right - left, H = bottom - top + noteBand + titleBand;
    var out = [];
    out.push('<svg xmlns="http://www.w3.org/2000/svg" viewBox="' + num(left) + ' ' + num(top) + ' ' + num(W) + ' ' + num(H) + '" width="' + num(W * ppi) + '" height="' + num(H * ppi) + '" font-family="Helvetica, Arial, sans-serif">');
    if (opts.background !== 'transparent') out.push('<rect x="' + num(left) + '" y="' + num(top) + '" width="' + num(W) + '" height="' + num(H) + '" fill="' + (opts.background || '#fff') + '"/>');

    // faint footprint + slabs under the roof
    ['porch', 'stoop'].forEach(function (k) { if (fp[k]) out.push('<polygon points="' + pts(fp[k]) + '" fill="' + C.slab + '" stroke="' + C.footLine + '" stroke-width="0.6" stroke-dasharray="4 3"/>'); });
    ['living', 'garage'].forEach(function (k) { if (fp[k]) out.push('<polygon points="' + pts(fp[k]) + '" fill="none" stroke="' + C.footLine + '" stroke-width="0.8" stroke-dasharray="6 3"/>'); });

    // roof parts: fill first, then edges by tag
    var parts = g.roofs || [];
    parts.forEach(function (r) { out.push('<polygon points="' + pts(r.poly3) + '" fill="' + C.roof + '" stroke="none"/>'); });
    parts.forEach(function (r) {
      var p = r.poly3, e = r.edges || [];
      for (var i = 0; i < p.length; i++) {
        var tag = e[i] || 'eave', a = p[i], q = p[(i + 1) % p.length];
        if (tag === 'internal' || tag === 'seam' || tag === 'cut') continue;
        var w = 1.2, dash = '', col = C.line;
        if (tag === 'ridge') { w = 2.2; col = C.ridge; }
        else if (tag === 'eave' || tag === 'rake') { w = 1.6; }
        else if (tag === 'hip' || tag === 'valley') { w = 1.1; }
        else if (tag === 'under') { w = 0.7; dash = ' stroke-dasharray="3 3"'; }
        out.push('<line x1="' + num(a[0]) + '" y1="' + num(a[1]) + '" x2="' + num(q[0]) + '" y2="' + num(q[1]) + '" stroke="' + col + '" stroke-width="' + w + '" stroke-linecap="round"' + dash + '/>');
      }
    });

    // pitch arrows: one per plane (largest part), pointing down-slope
    var byPlane = {};
    parts.forEach(function (r) { var k = r.planeId || r.id; if (!byPlane[k] || area(r.poly3) > area(byPlane[k].poly3)) byPlane[k] = r; });
    var pitch = g.pitch || 6;
    Object.keys(byPlane).forEach(function (k) {
      var r = byPlane[k], A = area(r.poly3); if (A < 1500) return; // skip slivers (< ~10 sf)
      var c = centroid(r.poly3), d = r.down || [0, 1], L = Math.min(40, Math.sqrt(A) * 0.35);
      var ax = c[0] - d[0] * L / 2, ay = c[1] - d[1] * L / 2, bx = c[0] + d[0] * L / 2, by = c[1] + d[1] * L / 2;
      out.push('<line x1="' + num(ax) + '" y1="' + num(ay) + '" x2="' + num(bx) + '" y2="' + num(by) + '" stroke="' + C.arrow + '" stroke-width="0.9"/>');
      var px = -d[1], py = d[0];
      out.push('<polygon points="' + pts([[bx, by], [bx - d[0] * 6 + px * 3, by - d[1] * 6 + py * 3], [bx - d[0] * 6 - px * 3, by - d[1] * 6 - py * 3]]) + '" fill="' + C.arrow + '"/>');
      var horiz = Math.abs(d[0]) > Math.abs(d[1]);
      if (horiz) out.push('<text x="' + num(c[0]) + '" y="' + num(c[1] - 5) + '" font-size="6.5" fill="' + C.text + '" text-anchor="middle">' + pitch + ':12 PITCH</text>');
      else out.push('<text x="' + num(c[0] + 10) + '" y="' + num(c[1]) + '" font-size="6.5" fill="' + C.text + '" text-anchor="middle" transform="rotate(-90 ' + num(c[0] + 10) + ' ' + num(c[1]) + ')">' + pitch + ':12 PITCH</text>');
    });

    // ridge vent labels along each piece's ridge line
    (g.roofPieces || []).forEach(function (pc) {
      var rl = pc.ridgeLine; if (!rl || rl.length < 2) return;
      var mx = (rl[0][0] + rl[1][0]) / 2, my = (rl[0][1] + rl[1][1]) / 2, horiz = Math.abs(rl[1][0] - rl[0][0]) >= Math.abs(rl[1][1] - rl[0][1]);
      var len = Math.hypot(rl[1][0] - rl[0][0], rl[1][1] - rl[0][1]); if (len < 30) return;
      if (horiz) out.push('<text x="' + num(mx) + '" y="' + num(my - 4) + '" font-size="6" fill="' + C.text + '" text-anchor="middle">RIDGE VNT. — ' + esc(fmtFt(pc.ridgeZ)) + ' RIDGE</text>');
      else out.push('<text x="' + num(mx - 4) + '" y="' + num(my) + '" font-size="6" fill="' + C.text + '" text-anchor="middle" transform="rotate(-90 ' + num(mx - 4) + ' ' + num(my) + ')">RIDGE VNT. — ' + esc(fmtFt(pc.ridgeZ)) + ' RIDGE</text>');
    });

    // note + title
    var y0 = bottom + 4;
    if (opts.note !== false) {
      out.push('<text x="' + num(left + 6) + '" y="' + num(y0 + 10) + '" font-size="6.5" fill="' + C.text + '">NOTE: ALL ROOF OVERHANGS TO BE ' + (g.overhang || 18) + '" FROM FRAME, UNLESS NOTED OTHERWISE.</text>');
      out.push('<text x="' + num(left + 6) + '" y="' + num(y0 + 19) + '" font-size="6.5" fill="' + C.text + '">1. NAILS FOR SECURING SHINGLES SHALL BE CORROSION RESISTANT.  2. METAL FLASHING SHALL BE PROVIDED AT ROOF INTERSECTIONS, ADJOINING WALLS AND PROJECTIONS THRU ROOF.</text>');
      out.push('<text x="' + num(left + 6) + '" y="' + num(y0 + 28) + '" font-size="6.5" fill="' + C.text + '">' + pitch + ':12 PITCH ALL PLANES · COMPOSITION SHINGLES · RIDGE VENTS · PLATE ' + esc(fmtFt(g.plate || 109)) + ' (COV. PORCH ' + esc(fmtFt(g.porchPlate || 145)) + ')</text>');
    }
    if (opts.title !== false) {
      var ty = bottom + noteBand + 26;
      out.push('<text x="' + num(left + 6) + '" y="' + num(ty) + '" font-size="16" font-style="italic" fill="' + C.text + '" letter-spacing="1.5">ROOF PLAN</text>');
      out.push('<line x1="' + num(left + 6) + '" y1="' + num(ty + 4) + '" x2="' + num(left + 6 + 115) + '" y2="' + num(ty + 4) + '" stroke="' + C.text + '" stroke-width="1.6"/>');
      out.push('<text x="' + num(left + 121) + '" y="' + num(ty + 11) + '" font-size="6.5" fill="' + C.text + '" text-anchor="end">SCALE: 1/8" = 1\'-0"</text>');
    }
    out.push('</svg>');
    return out.join('');
  }
  return { renderSVG: renderSVG, version: '1.0.0' };
}));
