/*  elevations.js — orthographic exterior elevations from HouseGeometry (see web/CONTRACTS.md).
 *
 *    Elevations.renderSVG(spec, side, opts) -> "<svg …>"     side: 'front'|'rear'|'left'|'right'
 *    Elevations.renderAll(spec, opts)       -> { front, rear, left, right }
 *    opts: { pxPerFoot=12, title=true, dims=true, materials=true, background='#fff', pad=48 }
 *
 *  Painter's algorithm: every visible wall face, gable triangle, porch column face, roof part
 *  and opening is projected for the requested side, sorted far → near and filled opaquely, so
 *  nearer masses hide farther ones.  SVG user units are inches (the viewBox is in inches; the
 *  width/height attributes apply pxPerFoot/12).  UMD: window.Elevations / module.exports.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) { module.exports = factory(require('./geometry.js')); }
  else { root.Elevations = factory(root.HouseGeometry); }
}(typeof self !== 'undefined' ? self : this, function (HG) {
  'use strict';

  var C = {
    line: '#2b2b2b', wall: '#ffffff', batten: '#8f8f8f', stone: '#e9e6df', stoneLine: '#6d6a63',
    rowlock: '#c9b6a6', roof: '#e3e3e3', roofLine: '#7a7a7a', fascia: '#f7f7f7', glass: '#e4edf3',
    frame: '#333333', door: '#f2f2f2', ground: '#2b2b2b', text: '#1f1f1f', dim: '#444444', porchBeam: '#f4f4f4'
  };

  function fmtFt(inches) {
    var neg = inches < 0; inches = Math.abs(Math.round(inches * 2) / 2);
    var ft = Math.floor(inches / 12), rem = inches - ft * 12, s;
    if (Math.abs(rem - Math.round(rem)) < 1e-6) s = String(Math.round(rem));
    else s = Math.floor(rem) + '½';
    return (neg ? '-' : '') + ft + "'-" + s + '"';
  }
  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;'); }
  function num(n) { return Math.round(n * 100) / 100; }
  function pts(poly) { return poly.map(function (p) { return num(p[0]) + ',' + num(p[1]); }).join(' '); }
  function area2(poly) { var a = 0; for (var i = 0; i < poly.length; i++) { var p = poly[i], q = poly[(i + 1) % poly.length]; a += p[0] * q[1] - q[0] * p[1]; } return a / 2; }
  function centroid(poly) { var x = 0, y = 0; poly.forEach(function (p) { x += p[0]; y += p[1]; }); return [x / poly.length, y / poly.length]; }

  // ---------------------------------------------------------------- projection
  function frame(side) {
    var F = HG.SIDES[side];
    if (!F) throw new Error('Elevations: unknown side ' + side);
    return F;
  }
  function proj(F, p) { // plan point [x,y,z] -> {u, z, d}
    return { u: p[0] * F.u[0] + p[1] * F.u[1], z: p[2], d: p[0] * F.depth[0] + p[1] * F.depth[1] };
  }
  function projPoly(F, poly3) { return poly3.map(function (p) { var q = proj(F, p); return [q.u, q.z, q.d]; }); }
  function depthOf(pp) { var d = 0; pp.forEach(function (p) { d += p[2]; }); return d / pp.length; }

  // ---------------------------------------------------------------- material fills
  function defs(id) {
    var s = '';
    // board & batten: one batten every 12"
    s += '<pattern id="' + id + '-batten" patternUnits="userSpaceOnUse" width="12" height="12">' +
      '<rect width="12" height="12" fill="' + C.wall + '"/><rect x="0" y="0" width="1.6" height="12" fill="' + C.batten + '"/></pattern>';
    // ashlar stone: 48 x 24 tile, three courses of 8"
    var stones = [[0, 0, 14], [14, 0, 10], [24, 0, 16], [40, 0, 8], [0, 8, 8], [8, 8, 16], [24, 8, 10], [34, 8, 14], [0, 16, 12], [12, 16, 8], [20, 16, 18], [38, 16, 10]];
    s += '<pattern id="' + id + '-stone" patternUnits="userSpaceOnUse" width="48" height="24"><rect width="48" height="24" fill="' + C.stone + '"/>';
    stones.forEach(function (st) { s += '<rect x="' + (st[0] + 0.6) + '" y="' + (st[1] + 0.6) + '" width="' + (st[2] - 1.2) + '" height="6.8" rx="0.8" fill="none" stroke="' + C.stoneLine + '" stroke-width="0.7"/>'; });
    s += '</pattern>';
    // shingles: 5" courses with staggered joints
    s += '<pattern id="' + id + '-shingle" patternUnits="userSpaceOnUse" width="24" height="10"><rect width="24" height="10" fill="' + C.roof + '"/>' +
      '<line x1="0" y1="5" x2="24" y2="5" stroke="' + C.roofLine + '" stroke-width="0.5"/><line x1="0" y1="10" x2="24" y2="10" stroke="' + C.roofLine + '" stroke-width="0.5"/>' +
      '<line x1="6" y1="0" x2="6" y2="5" stroke="' + C.roofLine + '" stroke-width="0.35"/><line x1="18" y1="5" x2="18" y2="10" stroke="' + C.roofLine + '" stroke-width="0.35"/></pattern>';
    // rowlock: brick on edge, 4" units
    s += '<pattern id="' + id + '-rowlock" patternUnits="userSpaceOnUse" width="4" height="3.5"><rect width="4" height="3.5" fill="' + C.rowlock + '"/><line x1="0" y1="0" x2="0" y2="3.5" stroke="' + C.stoneLine + '" stroke-width="0.4"/></pattern>';
    return s;
  }

  // ---------------------------------------------------------------- face painters (coordinates already in svg space: x=u, y=top-down)
  function Painter(id, toY) {
    this.id = id; this.toY = toY; this.out = []; this.clipN = 0;
  }
  Painter.prototype.poly = function (pp) { var toY = this.toY; return pp.map(function (p) { return [p[0], toY(p[1])]; }); };
  Painter.prototype.clip = function (poly) {
    var cid = this.id + '-c' + (this.clipN++);
    this.out.push('<clipPath id="' + cid + '"><polygon points="' + pts(poly) + '"/></clipPath>');
    return cid;
  };
  Painter.prototype.wallFace = function (face, pp, opts) {
    var poly = this.poly(pp), cid = this.clip(poly);
    var xs = poly.map(function (p) { return p[0]; }), ys = poly.map(function (p) { return p[1]; });
    var x0 = Math.min.apply(null, xs), x1 = Math.max.apply(null, xs), y0 = Math.min.apply(null, ys), y1 = Math.max.apply(null, ys);
    var o = this.out, id = this.id;
    o.push('<g clip-path="url(#' + cid + ')">');
    if (face.material === 'stone' || face.kind === 'column') {
      o.push('<rect x="' + num(x0) + '" y="' + num(y0) + '" width="' + num(x1 - x0) + '" height="' + num(y1 - y0) + '" fill="url(#' + id + '-stone)"/>');
    } else {
      o.push('<rect x="' + num(x0) + '" y="' + num(y0) + '" width="' + num(x1 - x0) + '" height="' + num(y1 - y0) + '" fill="url(#' + id + '-batten)"/>');
      if (face.kind === 'wall' && opts.wainscot > 0) {
        var wy = this.toY(opts.wainscot), gy = this.toY(0);
        o.push('<rect x="' + num(x0) + '" y="' + num(wy) + '" width="' + num(x1 - x0) + '" height="' + num(gy - wy) + '" fill="url(#' + id + '-stone)"/>');
        // rowlock cap 3.5" tall projecting 1"
        o.push('<rect x="' + num(x0 - 1) + '" y="' + num(wy - 3.5) + '" width="' + num(x1 - x0 + 2) + '" height="3.5" fill="url(#' + id + '-rowlock)" stroke="' + C.line + '" stroke-width="0.6"/>');
      }
    }
    o.push('</g>');
    // outline + corner boards (4" trim) on vertical edges of siding faces
    o.push('<polygon points="' + pts(poly) + '" fill="none" stroke="' + C.line + '" stroke-width="1.1" stroke-linejoin="round"/>');
    if (face.kind === 'wall') {
      var wTop = this.toY(face.z1), wBot = this.toY(Math.max(face.z0, opts.wainscot));
      o.push('<rect x="' + num(x0) + '" y="' + num(wTop) + '" width="4" height="' + num(wBot - wTop) + '" fill="' + C.wall + '" stroke="' + C.line + '" stroke-width="0.6"/>');
      o.push('<rect x="' + num(x1 - 4) + '" y="' + num(wTop) + '" width="4" height="' + num(wBot - wTop) + '" fill="' + C.wall + '" stroke="' + C.line + '" stroke-width="0.6"/>');
    }
  };
  Painter.prototype.roofFace = function (pp, edges) {
    var poly = this.poly(pp), o = this.out, id = this.id;
    o.push('<polygon points="' + pts(poly) + '" fill="url(#' + id + '-shingle)" stroke="none"/>');
    // crease lines: draw ridge/hip/valley/eave/rake edges; skip internal/seam/under/cut
    for (var i = 0; i < poly.length; i++) {
      var tag = edges ? edges[i] : 'eave';
      if (tag === 'internal' || tag === 'seam' || tag === 'under' || tag === 'cut') continue;
      var a = poly[i], b = poly[(i + 1) % poly.length];
      var w = tag === 'ridge' ? 1.6 : 1.0;
      o.push('<line x1="' + num(a[0]) + '" y1="' + num(a[1]) + '" x2="' + num(b[0]) + '" y2="' + num(b[1]) + '" stroke="' + C.line + '" stroke-width="' + w + '"/>');
      if (tag === 'eave') { // fascia board 7" below the eave line
        o.push('<polygon points="' + pts([a, b, [b[0], b[1] + 7], [a[0], a[1] + 7]]) + '" fill="' + C.fascia + '" stroke="' + C.line + '" stroke-width="0.9"/>');
      }
    }
  };
  Painter.prototype.roofEdgeOn = function (pp) { // rake / fascia seen end-on: thick board along the projected line, raised by rafter depth
    var poly = this.poly(pp), o = this.out;
    var lifted = poly.map(function (p) { return [p[0], p[1] - 7]; });
    // hull as polyline through min/max along u
    lifted.sort(function (a, b) { return a[0] - b[0]; });
    var band = [];
    for (var i = 0; i < lifted.length; i++) band.push(lifted[i]);
    o.push('<polyline points="' + pts(band) + '" fill="none" stroke="' + C.line + '" stroke-width="8.2" stroke-linejoin="round" stroke-linecap="butt"/>');
    o.push('<polyline points="' + pts(band) + '" fill="none" stroke="' + C.fascia + '" stroke-width="6.4" stroke-linejoin="round" stroke-linecap="butt"/>');
  };
  Painter.prototype.opening = function (op, u0, u1, z0, z1, side) {
    var o = this.out, x = Math.min(u0, u1), w = Math.abs(u1 - u0), y = this.toY(z1), h = this.toY(z0) - y;
    if (w <= 0 || h <= 0) return;
    var g = '<g>';
    if (op.kind === 'garage') {
      g += '<rect x="' + num(x) + '" y="' + num(y) + '" width="' + num(w) + '" height="' + num(h) + '" fill="' + C.door + '" stroke="' + C.line + '" stroke-width="1.2"/>';
      var cols = Math.max(1, Math.round(w / 48)), rows = 4, pw = w / cols, ph = h / rows;
      for (var r = 0; r < rows; r++) for (var c = 0; c < cols; c++) {
        g += '<rect x="' + num(x + c * pw + 3) + '" y="' + num(y + r * ph + 3) + '" width="' + num(pw - 6) + '" height="' + num(ph - 6) + '" fill="none" stroke="' + C.frame + '" stroke-width="0.7"/>';
      }
    } else if (op.kind === 'door') {
      var pair = op.units >= 2 || /PR|french|2668/i.test(op.label || '');
      g += '<rect x="' + num(x) + '" y="' + num(y) + '" width="' + num(w) + '" height="' + num(h) + '" fill="' + C.door + '" stroke="' + C.line + '" stroke-width="1.2"/>';
      var leaves = pair ? 2 : 1, lw = w / leaves;
      for (var l = 0; l < leaves; l++) {
        var lx = x + l * lw;
        if (pair) { // 15-lite french leaf: 3 x 5
          for (var rr = 0; rr < 5; rr++) for (var cc = 0; cc < 3; cc++) {
            g += '<rect x="' + num(lx + 3 + cc * (lw - 6) / 3 + 0.8) + '" y="' + num(y + 4 + rr * (h - 12) / 5 + 0.8) + '" width="' + num((lw - 6) / 3 - 1.6) + '" height="' + num((h - 12) / 5 - 1.6) + '" fill="' + C.glass + '" stroke="' + C.frame + '" stroke-width="0.5"/>';
          }
        } else { // entry door: two raised panels + upper lite
          g += '<rect x="' + num(lx + 5) + '" y="' + num(y + 6) + '" width="' + num(lw - 10) + '" height="' + num(h * 0.36) + '" fill="' + C.glass + '" stroke="' + C.frame + '" stroke-width="0.7"/>';
          g += '<rect x="' + num(lx + 5) + '" y="' + num(y + h * 0.5) + '" width="' + num(lw - 10) + '" height="' + num(h * 0.42) + '" fill="none" stroke="' + C.frame + '" stroke-width="0.7"/>';
          g += '<circle cx="' + num(lx + lw - 8) + '" cy="' + num(y + h * 0.55) + '" r="1.2" fill="' + C.frame + '"/>';
        }
        if (l > 0) g += '<line x1="' + num(lx) + '" y1="' + num(y) + '" x2="' + num(lx) + '" y2="' + num(y + h) + '" stroke="' + C.line + '" stroke-width="1"/>';
      }
    } else { // window
      var units = Math.max(1, op.units || 1), uw = w / units;
      g += '<rect x="' + num(x - 2) + '" y="' + num(y - 2) + '" width="' + num(w + 4) + '" height="' + num(h + 4) + '" fill="' + C.wall + '" stroke="' + C.line + '" stroke-width="1.2"/>'; // 2" trim
      for (var k = 0; k < units; k++) {
        var ux = x + k * uw;
        g += '<rect x="' + num(ux) + '" y="' + num(y) + '" width="' + num(uw) + '" height="' + num(h) + '" fill="' + C.glass + '" stroke="' + C.frame + '" stroke-width="0.9"/>';
        var fixed = /fix|1060/i.test(op.label || '') || h <= 14;
        if (!fixed) { // single-hung meeting rail; horizontal slider gets a vertical meeting stile instead
          if (/HS|slider|3010/i.test(op.label || '')) g += '<line x1="' + num(ux + uw / 2) + '" y1="' + num(y) + '" x2="' + num(ux + uw / 2) + '" y2="' + num(y + h) + '" stroke="' + C.frame + '" stroke-width="1.1"/>';
          else g += '<line x1="' + num(ux) + '" y1="' + num(y + h / 2) + '" x2="' + num(ux + uw) + '" y2="' + num(y + h / 2) + '" stroke="' + C.frame + '" stroke-width="1.3"/>';
          // 2 x 2 divided lites in the upper sash
          if (uw >= 20 && h >= 36) {
            g += '<line x1="' + num(ux + uw / 2) + '" y1="' + num(y) + '" x2="' + num(ux + uw / 2) + '" y2="' + num(y + h / 2) + '" stroke="' + C.frame + '" stroke-width="0.5"/>';
            g += '<line x1="' + num(ux) + '" y1="' + num(y + h / 4) + '" x2="' + num(ux + uw) + '" y2="' + num(y + h / 4) + '" stroke="' + C.frame + '" stroke-width="0.5"/>';
          }
        }
      }
      // sill
      g += '<rect x="' + num(x - 3) + '" y="' + num(y + h + 2) + '" width="' + num(w + 6) + '" height="2" fill="' + C.wall + '" stroke="' + C.line + '" stroke-width="0.7"/>';
    }
    g += '</g>';
    o.push(g);
  };

  // ---------------------------------------------------------------- main
  function renderSVG(spec, side, opts) {
    opts = opts || {};
    var pxPerFoot = opts.pxPerFoot || 12, pad = opts.pad == null ? 60 : opts.pad;
    var showTitle = opts.title !== false, showDims = opts.dims !== false, showMat = opts.materials !== false;
    var F = frame(side);
    var g = HG.build(spec);
    var wainscot = (spec.elevations && spec.elevations.wainscot_height) || 36;
    var id = 'el-' + side;

    // ---- collect drawable items {depth, draw(painter)}
    var items = [];
    var openingsByWall = {};
    (g.openings || []).forEach(function (op) { (openingsByWall[op.wallId] = openingsByWall[op.wallId] || []).push(op); });

    var minU = Infinity, maxU = -Infinity, maxZ = 0;
    function track(pp) { pp.forEach(function (p) { if (p[0] < minU) minU = p[0]; if (p[0] > maxU) maxU = p[0]; if (p[1] > maxZ) maxZ = p[1]; }); }

    (g.walls || []).forEach(function (w) {
      var facing = w.normal[0] * F.normal[0] + w.normal[1] * F.normal[1];
      if (facing <= 0.01) return;
      var pp = projPoly(F, w.poly3); track(pp);
      var ops = openingsByWall[w.id] || [];
      items.push({ depth: depthOf(pp), draw: function (P) {
        P.wallFace(w, pp, { wainscot: wainscot });
        ops.forEach(function (op) {
          var a = proj(F, [op.x0, op.y0, op.z0]), b = proj(F, [op.x1, op.y1, op.z1]);
          P.opening(op, a.u, b.u, op.z0, op.z1, side);
        });
      } });
    });

    (g.roofs || []).forEach(function (r) {
      var facing = r.normal[0] * F.normal[0] + r.normal[1] * F.normal[1];
      var pp = projPoly(F, r.poly3);
      var a = Math.abs(area2(pp));
      if (a < 1) { // edge-on plane: rake/fascia board, only if it faces up toward the viewer's horizon (always draw; it is hidden by nearer masses)
        track(pp);
        items.push({ depth: depthOf(pp) + 0.01, draw: function (P) { P.roofEdgeOn(pp); } });
        return;
      }
      if (facing <= 0) return; // sloping away -> hidden behind the ridge
      track(pp);
      items.push({ depth: depthOf(pp), draw: function (P) { P.roofFace(pp, r.edges); } });
    });

    // porch beam between the outer column faces (front side only when the porch faces the viewer)
    if (g.porch && g.porch.columns && g.porch.columns.length) {
      var cols = g.porch.columns, us = [], ds = [];
      cols.forEach(function (c) { var s = c.size || 24; [[c.x, c.y], [c.x + s, c.y], [c.x, c.y + s], [c.x + s, c.y + s]].forEach(function (q) { var p = proj(F, [q[0], q[1], 0]); us.push(p.u); ds.push(p.d); }); });
      var bu0 = Math.min.apply(null, us), bu1 = Math.max.apply(null, us), bd = Math.max.apply(null, ds);
      var pz = g.porchPlate || 145;
      if (bu1 - bu0 > 30) items.push({ depth: bd - 0.5, draw: function (P) {
        var y = P.toY(pz), h = P.toY(pz - 12) - y;
        P.out.push('<rect x="' + num(bu0) + '" y="' + num(y) + '" width="' + num(bu1 - bu0) + '" height="' + num(h) + '" fill="' + C.porchBeam + '" stroke="' + C.line + '" stroke-width="1"/>');
      } });
    }

    items.sort(function (a, b) { return a.depth - b.depth; }); // far first

    if (!isFinite(minU)) { minU = 0; maxU = 100; }
    var topZ = Math.max(maxZ, g.bounds.maxZ || 0) + 6;
    var left = minU - pad, right = maxU + pad, vbW = right - left;
    var dimBand = showDims ? 54 : 0;
    var titleBand = showTitle ? 40 : 0;
    var vbH = topZ + 30 + dimBand * 0 + 24 + titleBand; // headroom + grade band + title
    var toY = function (z) { return topZ + 30 - z; };
    var P = new Painter(id, toY);

    var out = [];
    out.push('<svg xmlns="http://www.w3.org/2000/svg" viewBox="' + num(left - dimBand) + ' 0 ' + num(vbW + 2 * dimBand) + ' ' + num(vbH) + '" width="' + num((vbW + 2 * dimBand) * pxPerFoot / 12) + '" height="' + num(vbH * pxPerFoot / 12) + '" font-family="Helvetica, Arial, sans-serif">');
    out.push('<defs>' + defs(id) + '</defs>');
    if (opts.background !== 'transparent') out.push('<rect x="' + num(left - dimBand) + '" y="0" width="' + num(vbW + 2 * dimBand) + '" height="' + num(vbH) + '" fill="' + (opts.background || '#fff') + '"/>');

    items.forEach(function (it) { it.draw(P); });
    out.push(P.out.join(''));

    // grade line
    var gy = toY(0);
    out.push('<line x1="' + num(left) + '" y1="' + num(gy) + '" x2="' + num(right) + '" y2="' + num(gy) + '" stroke="' + C.ground + '" stroke-width="1.8"/>');
    out.push('<line x1="' + num(left + 10) + '" y1="' + num(gy + 4) + '" x2="' + num(right - 10) + '" y2="' + num(gy + 4) + '" stroke="' + C.ground + '" stroke-width="0.6"/>');

    // ---- dimensions: plate heights at both ends
    if (showDims) {
      var plate = g.plate || 109, porchPlate = g.porchPlate;
      var hasPorchFace = (g.walls || []).some(function (w) { return (w.kind === 'column' || w.kind === 'closure') && (w.normal[0] * F.normal[0] + w.normal[1] * F.normal[1]) > 0.01; });
      function vdim(x, z0, z1, label, anchorRight) {
        var y0 = toY(z0), y1 = toY(z1), tx = anchorRight ? x + 5 : x - 5;
        out.push('<line x1="' + num(x) + '" y1="' + num(y0) + '" x2="' + num(x) + '" y2="' + num(y1) + '" stroke="' + C.dim + '" stroke-width="0.7"/>');
        [y0, y1].forEach(function (yy) { out.push('<line x1="' + num(x - 4) + '" y1="' + num(yy) + '" x2="' + num(x + 4) + '" y2="' + num(yy) + '" stroke="' + C.dim + '" stroke-width="0.7"/>'); });
        out.push('<text x="' + num(tx) + '" y="' + num((y0 + y1) / 2) + '" font-size="7" fill="' + C.text + '" text-anchor="middle" transform="rotate(-90 ' + num(tx) + ' ' + num((y0 + y1) / 2) + ')">' + esc(label) + '</text>');
      }
      function plateNote(x, z, text, anchor) {
        var y = toY(z);
        out.push('<line x1="' + num(left) + '" y1="' + num(y) + '" x2="' + num(right) + '" y2="' + num(y) + '" stroke="' + C.dim + '" stroke-width="0.5" stroke-dasharray="6 4"/>');
        out.push('<text x="' + num(x) + '" y="' + num(y - 2.5) + '" font-size="6.5" fill="' + C.text + '" text-anchor="' + anchor + '">' + esc(text) + '</text>');
      }
      vdim(left - 22, 0, plate, fmtFt(plate), false);
      vdim(right + 22, 0, plate, fmtFt(plate), true);
      plateNote(left - 26, plate, 'PLT. @ ' + fmtFt(plate), 'start');
      plateNote(right + 26, plate, 'PLT. @ ' + fmtFt(plate), 'end');
      if (hasPorchFace && porchPlate && porchPlate !== plate) {
        vdim(left - 40, 0, porchPlate, fmtFt(porchPlate), false);
        plateNote(left - 26, porchPlate, 'PLT. @ COV. PORCH ' + fmtFt(porchPlate), 'start');
      }
    }

    // ---- material call-outs and pitch symbols
    if (showMat) {
      var notes = [];
      // highest visible ridge point
      var ridgeTop = null;
      (g.roofs || []).forEach(function (r) {
        var pp = projPoly(F, r.poly3);
        r.poly3.forEach(function (p, i) { if (r.edges && r.edges[i] === 'ridge' && (!ridgeTop || p[2] > ridgeTop[1])) ridgeTop = [pp[i][0], p[2]]; });
      });
      var pitch = g.pitch || 6;
      function callout(u, z, dx, dz, text) {
        var x1 = u, y1 = toY(z), x2 = u + dx, y2 = toY(z + dz);
        out.push('<line x1="' + num(x1) + '" y1="' + num(y1) + '" x2="' + num(x2) + '" y2="' + num(y2) + '" stroke="' + C.dim + '" stroke-width="0.6"/>');
        out.push('<circle cx="' + num(x1) + '" cy="' + num(y1) + '" r="1" fill="' + C.dim + '"/>');
        var lines = text.split('\n');
        lines.forEach(function (t, i) {
          out.push('<text x="' + num(x2 + (dx >= 0 ? 2 : -2)) + '" y="' + num(y2 + 2 + i * 7.5) + '" font-size="6.5" fill="' + C.text + '" text-anchor="' + (dx >= 0 ? 'start' : 'end') + '">' + esc(t) + '</text>');
        });
      }
      if (ridgeTop) callout(ridgeTop[0], ridgeTop[1], 30, 14, 'RIDGE VNTS.');
      // roof slope note on the largest facing roof part
      var best = null;
      (g.roofs || []).forEach(function (r) {
        var facing = r.normal[0] * F.normal[0] + r.normal[1] * F.normal[1]; if (facing <= 0) return;
        var pp = projPoly(F, r.poly3), a = Math.abs(area2(pp)); if (!best || a > best.a) best = { a: a, pp: pp };
      });
      if (best) {
        var c = centroid(best.pp);
        out.push('<text x="' + num(c[0]) + '" y="' + num(toY(c[1]) - 2) + '" font-size="7" font-weight="bold" fill="' + C.text + '" text-anchor="middle" text-decoration="underline">COMP. ROOF SHINGLES</text>');
        out.push('<text x="' + num(c[0]) + '" y="' + num(toY(c[1]) + 7) + '" font-size="6" fill="' + C.text + '" text-anchor="middle">' + pitch + ':12 PITCH</text>');
        // pitch symbol at the upper-right of the plane
        var xs = best.pp.map(function (p) { return p[0]; }), zs = best.pp.map(function (p) { return p[1]; });
        var sx = Math.max.apply(null, xs) - 34, sz = Math.max.apply(null, zs) - 4;
        var sy = toY(sz);
        out.push('<polyline points="' + num(sx) + ',' + num(sy) + ' ' + num(sx + 24) + ',' + num(sy) + ' ' + num(sx + 24) + ',' + num(sy + 24 * pitch / 12) + ' ' + num(sx) + ',' + num(sy) + '" fill="none" stroke="' + C.dim + '" stroke-width="0.6"/>');
        out.push('<text x="' + num(sx + 12) + '" y="' + num(sy - 1.5) + '" font-size="5.5" fill="' + C.text + '" text-anchor="middle">12</text>');
        out.push('<text x="' + num(sx + 27) + '" y="' + num(sy + 24 * pitch / 24 + 2) + '" font-size="5.5" fill="' + C.text + '">' + pitch + '</text>');
      }
      // siding / stone / rowlock notes on the widest facing wall
      var wall = null;
      (g.walls || []).forEach(function (w) {
        if (w.kind !== 'wall') return;
        var facing = w.normal[0] * F.normal[0] + w.normal[1] * F.normal[1]; if (facing <= 0.01) return;
        var pp = projPoly(F, w.poly3), xs = pp.map(function (p) { return p[0]; }), wdt = Math.max.apply(null, xs) - Math.min.apply(null, xs);
        if (!wall || wdt > wall.w) wall = { w: wdt, u0: Math.min.apply(null, xs), u1: Math.max.apply(null, xs), z1: w.z1 };
      });
      if (wall) {
        var mu = wall.u0 + wall.w * 0.22;
        callout(mu, wall.z1 - 20, -14, 10, 'BRD & BTTN\nSIDING AS\nSELECTED');
        callout(wall.u0 + wall.w * 0.5, wainscot - 14, 16, -6, 'STONE VENEER\nAS SPECIFIED');
        callout(wall.u0 + wall.w * 0.78, wainscot + 1.5, 14, 12, 'BRICK ROWLOCK');
        callout(wall.u1 - 6, wall.z1 - 10, 12, 6, '4" TRIM');
      }
    }

    // ---- title
    if (showTitle) {
      var tName = side.toUpperCase() + ' ELEVATION';
      var ty = vbH - 14;
      out.push('<text x="' + num(left + 6) + '" y="' + num(ty) + '" font-size="16" font-style="italic" fill="' + C.text + '" letter-spacing="1.5">' + tName + '</text>');
      out.push('<line x1="' + num(left + 6) + '" y1="' + num(ty + 4) + '" x2="' + num(left + 6 + tName.length * 10.5) + '" y2="' + num(ty + 4) + '" stroke="' + C.text + '" stroke-width="1.6"/>');
      out.push('<text x="' + num(left + 6 + tName.length * 10.5) + '" y="' + num(ty + 11) + '" font-size="6.5" fill="' + C.text + '" text-anchor="end">SCALE: ' + esc(opts.scaleText || '1/4" = 1\'-0"') + '</text>');
    }
    out.push('</svg>');
    return out.join('');
  }

  function renderAll(spec, opts) {
    var r = {};
    ['front', 'rear', 'left', 'right'].forEach(function (s) { r[s] = renderSVG(spec, s, opts); });
    return r;
  }

  return { renderSVG: renderSVG, renderAll: renderAll, fmtFt: fmtFt, version: '1.0.0' };
}));
