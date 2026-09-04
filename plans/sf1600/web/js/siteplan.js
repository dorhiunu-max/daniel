/*  siteplan.js — site-plan renderer + house placement for the house-plan spec
 *  (see tools/SPEC_FORMAT.md and web/CONTRACTS.md).  Dependency-free; produces a complete
 *  <svg> element string.
 *
 *  UMD: attaches to window.SitePlan in a browser, module.exports under Node.
 *
 *    SitePlan.computePlacement(spec[, options]) ->
 *        { origin:[x_ft, y_ft], clearances:{left,right,rear,front}, ok, notes:[string…],
 *          violations:[{side, clearance, required, corner}], corners:[…], required:{…}, source }
 *    SitePlan.renderSVG(spec, {pxPerFoot=6, placement, title=true, background='#fff'}) -> "<svg …>"
 *    SitePlan.impervious(spec[, placement])  -> { lot, house, flatwork, total, pct, drive, walk, stoop, … }
 *    SitePlan.lotModel(spec)                 -> lot geometry (edges, bottom polyline, B.S.L. polygon, area)
 *    SitePlan.fmtFt(inches[, style]) / SitePlan.fmtFeet(feet[, style])
 *
 *  Coordinates.  The lot (`spec.site.lot`) is in FEET: +x to the right, +y toward Sawtooth Dr.
 *  (the street / front side); the top edge (y = 0) is Hunt Lane.  The lot polygon is expected
 *  as [top-left, top-right, bottom-right, bottom-left]; the bottom edge may carry
 *  `spec.site.bottom_curve = {straight_from_left, radius, length}` (a straight run from the
 *  bottom-left corner then a tangent arc to the bottom-right corner).
 *  The house footprint is in INCHES in plan coordinates; the placement `origin` is where the
 *  plan's (0,0) — the rear-left outside frame corner — lands on the lot (feet):
 *  plan +x -> lot +x, plan +y -> lot +y, plan inches / 12 = feet.
 *
 *  Placement rule (computePlacement): use `spec.site.house_origin` when present; otherwise keep
 *  the rear wall at `spec.site.house_origin_original[1]` and pick x so every footprint corner
 *  clears the side setback on both sides (the right P.L. slants inward toward the street, so the
 *  wing's front-right corner usually governs), preferring the original left offset.  If both
 *  sides (or the 20' front) cannot clear, the house is shifted toward Hunt Lane in 1' steps
 *  down to the rear setback; if still impossible, ok=false and the offending corners are
 *  reported (and drawn in red).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) { module.exports = factory(); }
  else { root.SitePlan = factory(); }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var VERSION = '1.0.0';
  var FONT = "'Segoe UI', Helvetica, Arial, sans-serif";
  var SERIF = "Georgia, 'Times New Roman', Times, serif";

  // palette (a drawing: fixed light look, like the floor-plan renderer)
  var C = {
    page: '#ffffff', lot: '#ffffff', text: '#111111', pl: '#111111', bsl: '#3c3c3c',
    house: '#111111', houseFill: '#ffffff', porchFill: '#ededed', slabFill: '#f3f3f3',
    slabStroke: '#4a4a4a', roof: '#a3a3a3', dim: '#1a1a1a', ext: '#555555', side: '#8c8c8c',
    red: '#c81e1e', box: '#111111', pin: '#111111', column: '#111111'
  };
  // stroke widths in FEET (1 ft = pxPerFoot px)
  var SW = {
    pl: 0.36, bsl: 0.12, house: 0.26, porch: 0.14, slab: 0.12, roof: 0.09, dim: 0.09,
    ext: 0.065, tick: 0.16, box: 0.1, side: 0.09, curb: 0.13, door: 0.5, red: 0.18
  };
  // text sizes in FEET
  var T = {
    street: 3.3, pl: 1.85, bsl: 1.65, dim: 1.75, house: 2.5, table: 2.3, small: 1.5,
    note: 1.6, title: 4.2, scale: 1.9, addr: 1.7, label: 1.55
  };
  var SIDES = ['left', 'right', 'rear', 'front'];

  // ------------------------------------------------------------------ helpers
  function num(v, d) { var n = Number(v); return isFinite(n) ? n : d; }
  function f(n) { return String(Math.round(n * 1000) / 1000); }
  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function hyp(x, y) { return Math.sqrt(x * x + y * y); }
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  /** Feet-inches at half-inch resolution: fmtFt(166) -> 13'-10", fmtFt(30.5,'plain') -> 2'6½" */
  function fmtFt(inches, style) {
    var r = Math.round(num(inches, 0) * 2) / 2;
    var neg = r < 0; r = Math.abs(r);
    var ft = Math.floor(r / 12);
    var rem = r - ft * 12;
    var whole = Math.floor(rem);
    var half = rem - whole >= 0.5;
    var dash = style === 'plain' ? '' : '-';
    return (neg ? '-' : '') + ft + "'" + dash + whole + (half ? '½' : '') + '"';
  }
  function fmtFeet(feet, style) { return fmtFt(num(feet, 0) * 12, style); }
  function fmtSf(n) { return Math.round(n).toLocaleString('en-US') + ' S.F.'; }

  // ------------------------------------------------------------------ geometry
  function cleanPoly(pts) {
    if (!Array.isArray(pts)) return null;
    var out = [];
    for (var i = 0; i < pts.length; i++) {
      var p = pts[i];
      if (!Array.isArray(p) || p.length < 2) continue;
      var x = Number(p[0]), y = Number(p[1]);
      if (!isFinite(x) || !isFinite(y)) continue;
      if (out.length && out[out.length - 1][0] === x && out[out.length - 1][1] === y) continue;
      out.push([x, y]);
    }
    if (out.length > 1 && out[0][0] === out[out.length - 1][0] && out[0][1] === out[out.length - 1][1]) out.pop();
    return out.length >= 3 ? out : null;
  }
  function polyArea(poly) { // signed (shoelace)
    var a = 0;
    for (var i = 0, n = poly.length; i < n; i++) {
      var p = poly[i], q = poly[(i + 1) % n];
      a += p[0] * q[1] - q[0] * p[1];
    }
    return a / 2;
  }
  function polyBBox(poly) {
    var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (var i = 0; i < poly.length; i++) {
      var p = poly[i];
      if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0];
      if (p[1] < y0) y0 = p[1]; if (p[1] > y1) y1 = p[1];
    }
    return { x0: x0, y0: y0, x1: x1, y1: y1, w: x1 - x0, h: y1 - y0, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 };
  }
  function polyCentroid(poly) {
    var a = 0, cx = 0, cy = 0;
    for (var i = 0, n = poly.length; i < n; i++) {
      var p = poly[i], q = poly[(i + 1) % n];
      var cr = p[0] * q[1] - q[0] * p[1];
      a += cr; cx += (p[0] + q[0]) * cr; cy += (p[1] + q[1]) * cr;
    }
    if (Math.abs(a) < 1e-9) { var b = polyBBox(poly); return [b.cx, b.cy]; }
    return [cx / (3 * a), cy / (3 * a)];
  }
  function pointInPoly(x, y, poly) { // even-odd
    var inside = false;
    for (var i = 0, n = poly.length, j = n - 1; i < n; j = i++) {
      var xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1];
      if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }
  function segDist(p, a, b) {
    var dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy;
    var t = l2 ? clamp(((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2, 0, 1) : 0;
    return hyp(a[0] + t * dx - p[0], a[1] + t * dy - p[1]);
  }
  function polylineDist(p, pts) {
    var best = Infinity;
    for (var i = 0; i + 1 < pts.length; i++) { var d = segDist(p, pts[i], pts[i + 1]); if (d < best) best = d; }
    return best;
  }
  /** y of an x-monotonic polyline at x (extrapolates the end segments). */
  function polylineY(pts, x) {
    var n = pts.length;
    if (n === 1) return pts[0][1];
    var i = 0;
    while (i + 2 < n && pts[i + 1][0] < x) i++;
    var a = pts[i], b = pts[i + 1];
    if (Math.abs(b[0] - a[0]) < 1e-12) return a[1];
    return a[1] + (b[1] - a[1]) * (x - a[0]) / (b[0] - a[0]);
  }
  /** Offset a bottom (left-to-right) polyline toward the lot interior (−y side) by d. */
  function offsetPolyline(pts, d) {
    var out = [];
    for (var i = 0; i < pts.length; i++) {
      var nx = 0, ny = 0;
      if (i > 0) { var dx = pts[i][0] - pts[i - 1][0], dy = pts[i][1] - pts[i - 1][1], l = hyp(dx, dy); nx += dy / l; ny += -dx / l; }
      if (i + 1 < pts.length) { var dx2 = pts[i + 1][0] - pts[i][0], dy2 = pts[i + 1][1] - pts[i][1], l2 = hyp(dx2, dy2); nx += dy2 / l2; ny += -dx2 / l2; }
      var nl = hyp(nx, ny) || 1;
      out.push([pts[i][0] + d * nx / nl, pts[i][1] + d * ny / nl]);
    }
    return out;
  }
  /** Rectilinear polygon offset (d > 0 expands). Valid while every edge is longer than 2d. */
  function offsetRectPoly(poly, d) {
    var A = polyArea(poly), n = poly.length, out = [];
    function normal(i) {
      var p = poly[i], q = poly[(i + 1) % n];
      var dx = q[0] - p[0], dy = q[1] - p[1], l = hyp(dx, dy) || 1;
      return A > 0 ? [dy / l, -dx / l] : [-dy / l, dx / l];
    }
    for (var i = 0; i < n; i++) {
      var np = normal((i + n - 1) % n), nn = normal(i);
      out.push([poly[i][0] + d * (np[0] + nn[0]), poly[i][1] + d * (np[1] + nn[1])]);
    }
    return out;
  }
  function uniqSorted(arr) {
    arr = arr.slice().sort(function (a, b) { return a - b; });
    var out = [];
    arr.forEach(function (v) { if (!out.length || Math.abs(v - out[out.length - 1]) > 1e-6) out.push(v); });
    return out;
  }
  /** Outline segments of the union of rectilinear polygons (grid scan; cells ~ 10x10). */
  function unionOutline(polys) {
    var xs = [], ys = [];
    polys.forEach(function (p) { p.forEach(function (v) { xs.push(v[0]); ys.push(v[1]); }); });
    xs = uniqSorted(xs); ys = uniqSorted(ys);
    var nx = xs.length - 1, ny = ys.length - 1, i, j, run, inside = [];
    for (i = 0; i < nx; i++) {
      inside.push([]);
      for (j = 0; j < ny; j++) {
        var cx = (xs[i] + xs[i + 1]) / 2, cy = (ys[j] + ys[j + 1]) / 2, inn = false;
        for (var k = 0; k < polys.length && !inn; k++) if (pointInPoly(cx, cy, polys[k])) inn = true;
        inside[i].push(inn);
      }
    }
    function at(a, b) { return a >= 0 && b >= 0 && a < nx && b < ny && inside[a][b]; }
    var segs = [];
    for (j = 0; j <= ny; j++) {
      run = null;
      for (i = 0; i < nx; i++) {
        if (at(i, j) !== at(i, j - 1)) { if (run) run[1] = xs[i + 1]; else run = [xs[i], xs[i + 1]]; }
        else if (run) { segs.push([[run[0], ys[j]], [run[1], ys[j]]]); run = null; }
      }
      if (run) segs.push([[run[0], ys[j]], [run[1], ys[j]]]);
    }
    for (i = 0; i <= nx; i++) {
      run = null;
      for (j = 0; j < ny; j++) {
        if (at(i, j) !== at(i - 1, j)) { if (run) run[1] = ys[j + 1]; else run = [ys[j], ys[j + 1]]; }
        else if (run) { segs.push([[xs[i], run[0]], [xs[i], run[1]]]); run = null; }
      }
      if (run) segs.push([[xs[i], run[0]], [xs[i], run[1]]]);
    }
    return segs;
  }

  // ------------------------------------------------------------------ text helpers
  var CW = {
    ' ': 0.278, '!': 0.278, '"': 0.355, '#': 0.556, '$': 0.556, '%': 0.889, '&': 0.667, "'": 0.191, '(': 0.333, ')': 0.333,
    '*': 0.389, '+': 0.584, ',': 0.278, '-': 0.333, '.': 0.278, '/': 0.278, ':': 0.278, ';': 0.278, '=': 0.584, '?': 0.556,
    '@': 1.015, '½': 0.834, '·': 0.278, '—': 1.0, '–': 0.556,
    A: 0.667, B: 0.667, C: 0.722, D: 0.722, E: 0.667, F: 0.611, G: 0.778, H: 0.722, I: 0.278, J: 0.5, K: 0.667, L: 0.556, M: 0.833,
    N: 0.722, O: 0.778, P: 0.667, Q: 0.778, R: 0.722, S: 0.667, T: 0.611, U: 0.722, V: 0.667, W: 0.944, X: 0.667, Y: 0.667, Z: 0.611,
    a: 0.556, b: 0.556, c: 0.5, d: 0.556, e: 0.556, f: 0.278, g: 0.556, h: 0.556, i: 0.222, j: 0.222, k: 0.5, l: 0.222, m: 0.833,
    n: 0.556, o: 0.556, p: 0.556, q: 0.556, r: 0.333, s: 0.5, t: 0.278, u: 0.556, v: 0.5, w: 0.722, x: 0.5, y: 0.5, z: 0.5
  };
  function textW(str, size, kind, spacing) {
    str = String(str);
    var w = 0;
    for (var i = 0; i < str.length; i++) {
      var ch = str[i];
      w += CW[ch] != null ? CW[ch] : (/[0-9]/.test(ch) ? 0.556 : 0.6);
    }
    var k = kind === 'bold' ? 1.08 : 1.0;
    return w * size * k + (spacing || 0) * Math.max(0, str.length - 1) + size * 0.1;
  }
  function textEl(x, y, str, size, o) {
    o = o || {};
    var a = ['x="' + f(x) + '"', 'y="' + f(y) + '"', 'font-size="' + f(size) + '"',
      'text-anchor="' + (o.anchor || 'middle') + '"', 'fill="' + (o.fill || C.text) + '"'];
    if (o.weight) a.push('font-weight="' + o.weight + '"');
    if (o.spacing) a.push('letter-spacing="' + f(o.spacing) + '"');
    if (o.italic) a.push('font-style="italic"');
    if (o.family) a.push('font-family="' + o.family + '"');
    if (o.rotate) a.push('transform="rotate(' + f(o.rotate) + ' ' + f(x) + ' ' + f(y) + ')"');
    if (o.opacity != null) a.push('opacity="' + o.opacity + '"');
    return '<text ' + a.join(' ') + '>' + esc(str) + '</text>';
  }
  function line(x0, y0, x1, y1, stroke, w, extra) {
    return '<line x1="' + f(x0) + '" y1="' + f(y0) + '" x2="' + f(x1) + '" y2="' + f(y1) +
      '" stroke="' + stroke + '" stroke-width="' + f(w) + '"' + (extra ? ' ' + extra : '') + '/>';
  }
  function rect(x, y, w, h, extra) {
    return '<rect x="' + f(x) + '" y="' + f(y) + '" width="' + f(Math.max(0, w)) + '" height="' + f(Math.max(0, h)) + '"' + (extra ? ' ' + extra : '') + '/>';
  }
  function circle(cx, cy, r, extra) {
    return '<circle cx="' + f(cx) + '" cy="' + f(cy) + '" r="' + f(r) + '"' + (extra ? ' ' + extra : '') + '/>';
  }
  function pathOf(poly, open) {
    var s = 'M' + f(poly[0][0]) + ' ' + f(poly[0][1]);
    for (var i = 1; i < poly.length; i++) s += 'L' + f(poly[i][0]) + ' ' + f(poly[i][1]);
    return open ? s : s + 'Z';
  }
  function wrap(text, maxChars) {
    var words = String(text).split(/\s+/), lines = [], cur = '';
    words.forEach(function (w) {
      if (cur && (cur + ' ' + w).length > maxChars) { lines.push(cur); cur = w; }
      else cur = cur ? cur + ' ' + w : w;
    });
    if (cur) lines.push(cur);
    return lines;
  }

  // ------------------------------------------------------------------ lot model
  /** Straight run + tangent arc from P0 to P2. sigma=+1: heading turns toward +y (the street),
   *  i.e. the arc centre lies on the street side and the boundary bows slightly into the lot —
   *  this is how the plat reads (the right end of the Sawtooth Dr. line drops more steeply). */
  function solveBottom(P0, P2, straight, R, L, sigma, samples) {
    var D = L / R;
    function endpoint(theta) {
      var ux = Math.cos(theta), uy = Math.sin(theta);
      var P1 = [P0[0] + straight * ux, P0[1] + straight * uy];
      var Cc = [P1[0] - R * uy * sigma, P1[1] + R * ux * sigma];
      var phi0 = Math.atan2(P1[1] - Cc[1], P1[0] - Cc[0]);
      var phi1 = phi0 + sigma * D;
      return { P1: P1, C: Cc, phi0: phi0, phi1: phi1, end: [Cc[0] + R * Math.cos(phi1), Cc[1] + R * Math.sin(phi1)] };
    }
    function err(theta) { var e = endpoint(theta).end; return hyp(e[0] - P2[0], e[1] - P2[1]); }
    var lo = -Math.PI / 3, hi = Math.PI / 3, best = 0, bestE = Infinity, k, th;
    for (k = 0; k <= 720; k++) { th = lo + (hi - lo) * k / 720; var e = err(th); if (e < bestE) { bestE = e; best = th; } }
    var step = (hi - lo) / 720;
    for (var it = 0; it < 60; it++) { // refine
      var a = err(best - step), b = err(best + step);
      if (a < bestE) { best -= step; bestE = a; } else if (b < bestE) { best += step; bestE = b; } else step /= 2;
    }
    var g = endpoint(best), pts = [P0.slice(), g.P1];
    var n = samples || 24;
    for (k = 1; k <= n; k++) {
      var phi = g.phi0 + (g.phi1 - g.phi0) * k / n;
      pts.push([g.C[0] + R * Math.cos(phi), g.C[1] + R * Math.sin(phi)]);
    }
    // close the (tiny) residual exactly: similarity about P0 mapping the computed end onto P2
    var e0 = pts[pts.length - 1], v0 = [e0[0] - P0[0], e0[1] - P0[1]], v1 = [P2[0] - P0[0], P2[1] - P0[1]];
    var l0 = hyp(v0[0], v0[1]), l1 = hyp(v1[0], v1[1]);
    if (l0 > 1e-9) {
      var s = l1 / l0, ang = Math.atan2(v1[1], v1[0]) - Math.atan2(v0[1], v0[0]);
      var ca = Math.cos(ang) * s, sa = Math.sin(ang) * s;
      pts = pts.map(function (p) { var x = p[0] - P0[0], y = p[1] - P0[1]; return [P0[0] + ca * x - sa * y, P0[1] + sa * x + ca * y]; });
    }
    return { pts: pts, theta: best, residual: bestE, P1: pts[1], sagitta: R * (1 - Math.cos(D / 2)), chord: 2 * R * Math.sin(D / 2) };
  }

  function lotModel(spec) {
    var site = spec && spec.site;
    var lot = site && cleanPoly(site.lot);
    if (!lot || lot.length < 4) return null;
    var TL = lot[0], TR = lot[1], BR = lot[2], BL = lot[3];
    var cen = polyCentroid(lot);
    function mkLine(a, b) {
      var dx = b[0] - a[0], dy = b[1] - a[1], len = hyp(dx, dy) || 1;
      var sgn = (dx * (cen[1] - a[1]) - dy * (cen[0] - a[0])) >= 0 ? 1 : -1;
      return {
        a: a, b: b, len: len, ux: dx / len, uy: dy / len,
        nin: [-sgn * dy / len, sgn * dx / len], nout: [sgn * dy / len, -sgn * dx / len],
        dist: function (p) { return sgn * (dx * (p[1] - a[1]) - dy * (p[0] - a[0])) / len; },
        // point on the line at parameter t along a->b
        at: function (t) { return [a[0] + dx * t, a[1] + dy * t]; },
        // foot of the perpendicular from p
        foot: function (p) { var t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (len * len); return [a[0] + dx * t, a[1] + dy * t]; }
      };
    }
    var top = mkLine(TL, TR), right = mkLine(TR, BR), left = mkLine(BL, TL), bottomLine = mkLine(BL, BR);
    var curve = null, bottomPts = [BL, BR];
    var bc = site.bottom_curve;
    if (bc && num(bc.radius, 0) > 0 && num(bc.length, 0) > 0) {
      var sigma = bc.bulge === 'out' ? -1 : 1;
      curve = solveBottom(BL, BR, num(bc.straight_from_left, 0), num(bc.radius, 0), num(bc.length, 0), sigma, 24);
      bottomPts = curve.pts;
    }
    function distBottom(p) {
      var yb = polylineY(bottomPts, p[0]);
      var d = polylineDist(p, bottomPts);
      return p[1] <= yb ? d : -d;
    }
    var setbacks = Object.assign({ front: 20, side: 5, rear: 5 }, site.setbacks || {});
    // outline used for area: TL, TR, then the bottom boundary right-to-left
    var outline = [TL, TR].concat(bottomPts.slice().reverse());
    var area = Math.abs(polyArea(outline));
    // building setback polygon
    var sSide = num(setbacks.side, 5), sRear = num(setbacks.rear, 5), sFront = num(setbacks.front, 20);
    var b20 = offsetPolyline(bottomPts, sFront);
    // top setback line y = ... (top edge assumed horizontal-ish): use lines offset inward
    function offsetLine(L, d) { return mkLine([L.a[0] + L.nin[0] * d, L.a[1] + L.nin[1] * d], [L.b[0] + L.nin[0] * d, L.b[1] + L.nin[1] * d]); }
    var topS = offsetLine(top, sRear), leftS = offsetLine(left, sSide), rightS = offsetLine(right, sSide);
    function isect(L1, L2) {
      var x1 = L1.a[0], y1 = L1.a[1], x2 = L1.b[0], y2 = L1.b[1], x3 = L2.a[0], y3 = L2.a[1], x4 = L2.b[0], y4 = L2.b[1];
      var den = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
      if (Math.abs(den) < 1e-12) return null;
      var t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / den;
      return [x1 + t * (x2 - x1), y1 + t * (y2 - y1)];
    }
    var bslTL = isect(topS, leftS), bslTR = isect(topS, rightS);
    // clip the offset bottom polyline between leftS and rightS (signed distances >= 0 inside)
    function clipPolyline(pts, lineA, lineB) { // keep where lineA.dist>=0 && lineB.dist>=0
      var out = [];
      function inside(p) { return lineA.dist(p) >= -1e-9 && lineB.dist(p) >= -1e-9; }
      function cross(p, q, Ln) { var da = Ln.dist(p), db = Ln.dist(q); var t = da / (da - db); return [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]; }
      for (var i = 0; i < pts.length; i++) {
        var p = pts[i];
        if (i > 0) {
          var q = pts[i - 1];
          [lineA, lineB].forEach(function (Ln) {
            if ((Ln.dist(q) < 0) !== (Ln.dist(p) < 0)) { var c = cross(q, p, Ln); if (inside(c)) out.push(c); }
          });
        }
        if (inside(p)) out.push(p);
      }
      return out;
    }
    var bslBottom = clipPolyline(b20, leftS, rightS);
    var bsl = [bslTL, bslTR].concat(bslBottom.slice().reverse());
    return {
      lot: lot, TL: TL, TR: TR, BR: BR, BL: BL, top: top, right: right, left: left, bottomLine: bottomLine,
      bottomPts: bottomPts, curve: curve, distBottom: distBottom, area: area, polyArea: Math.abs(polyArea(lot)),
      setbacks: { side: sSide, rear: sRear, front: sFront }, bsl: bsl, bslTL: bslTL, bslTR: bslTR, bslBottom: bslBottom,
      leftS: leftS, rightS: rightS, topS: topS, centroid: cen, bbox: polyBBox(outline),
      yBottom: function (x) { return polylineY(bottomPts, x); }
    };
  }

  // ------------------------------------------------------------------ house model (feet)
  function houseModel(spec) {
    var fp = (spec && spec.footprint) || {};
    var m = { zones: {} };
    ['living', 'garage', 'porch', 'stoop'].forEach(function (k) {
      var p = cleanPoly(fp[k]);
      if (p) m.zones[k] = p.map(function (v) { return [v[0] / 12, v[1] / 12]; });
    });
    m.structure = ['living', 'garage', 'porch'].filter(function (k) { return m.zones[k]; }).map(function (k) { return m.zones[k]; });
    var bb = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
    m.structure.forEach(function (p) { var b = polyBBox(p); bb.x0 = Math.min(bb.x0, b.x0); bb.y0 = Math.min(bb.y0, b.y0); bb.x1 = Math.max(bb.x1, b.x1); bb.y1 = Math.max(bb.y1, b.y1); });
    m.bbox = isFinite(bb.x0) ? bb : { x0: 0, y0: 0, x1: 0, y1: 0 };
    var doors = Array.isArray(spec && spec.doors) ? spec.doors : [];
    var oh = doors.filter(function (d) { return d && String(d.kind).toLowerCase() === 'overhead' && isFinite(Number(d.x)); });
    var g = m.zones.garage;
    if (g) {
      var gb = polyBBox(g);
      m.garageFront = gb.y1;
      if (oh.length) {
        var d = oh[0];
        m.door = { x0: (Number(d.x) - Number(d.w) / 2) / 12, x1: (Number(d.x) + Number(d.w) / 2) / 12, y: num(d.y, gb.y1 * 12) / 12 };
      } else m.door = { x0: gb.x0 + 2, x1: gb.x1 - 2, y: gb.y1 };
    }
    var fd = doors.filter(function (d) { return d && /front|entry/i.test(String(d.label || '')) && isFinite(Number(d.x)); });
    if (!fd.length) fd = doors.filter(function (d) { return d && String(d.id) === '2'; });
    if (fd.length) m.frontDoor = { x: Number(fd[0].x) / 12, y: num(fd[0].y, 0) / 12 };
    m.columns = (Array.isArray(spec && spec.porch_columns) ? spec.porch_columns : []).filter(function (c) { return c && isFinite(Number(c.x)); })
      .map(function (c) { return { x: Number(c.x) / 12, y: Number(c.y) / 12, size: num(c.size, 24) / 12 }; });
    // roof outline: union of roof pieces (or footprints) expanded by the overhang
    var roof = (spec && spec.roof) || {};
    var oh_ft = num(roof.overhang, 18) / 12;
    var pieces = Array.isArray(roof.pieces) ? roof.pieces.filter(function (p) { return p && Array.isArray(p.rect) && p.rect.length === 4; }) : [];
    var roofPolys = pieces.length ? pieces.map(function (p) {
      var r = p.rect.map(Number), x0 = Math.min(r[0], r[2]) / 12, x1 = Math.max(r[0], r[2]) / 12, y0 = Math.min(r[1], r[3]) / 12, y1 = Math.max(r[1], r[3]) / 12;
      return [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
    }) : m.structure;
    m.roofOutline = unionOutline(roofPolys.map(function (p) { return offsetRectPoly(p, oh_ft); }));
    m.overhang = oh_ft;
    m.areas = {};
    ['living', 'garage', 'porch', 'stoop'].forEach(function (k) { if (m.zones[k]) m.areas[k] = Math.abs(polyArea(m.zones[k])); });
    return m;
  }

  function cornerName(zone, poly, v) {
    var b = polyBBox(poly);
    var yy = Math.abs(v[1] - b.y0) < 1e-6 ? 'rear' : Math.abs(v[1] - b.y1) < 1e-6 ? 'front' : 'mid';
    var xx = Math.abs(v[0] - b.x0) < 1e-6 ? 'left' : Math.abs(v[0] - b.x1) < 1e-6 ? 'right' : 'mid';
    return zone + ' ' + yy + '-' + xx + ' corner';
  }

  // ------------------------------------------------------------------ placement
  function evaluate(lot, house, origin) {
    var corners = [];
    ['living', 'garage', 'porch'].forEach(function (k) {
      var poly = house.zones[k]; if (!poly) return;
      poly.forEach(function (v, i) {
        var P = [origin[0] + v[0], origin[1] + v[1]];
        corners.push({ zone: k, index: i, name: cornerName(k, poly, v), plan: v, point: P,
          left: lot.left.dist(P), right: lot.right.dist(P), rear: lot.top.dist(P), front: lot.distBottom(P) });
      });
    });
    var cl = { left: Infinity, right: Infinity, rear: Infinity, front: Infinity }, worst = {};
    corners.forEach(function (c) { SIDES.forEach(function (s) { if (c[s] < cl[s]) { cl[s] = c[s]; worst[s] = c; } }); });
    var req = { left: lot.setbacks.side, right: lot.setbacks.side, rear: lot.setbacks.rear, front: lot.setbacks.front };
    var violations = [];
    SIDES.forEach(function (s) {
      if (!isFinite(cl[s])) return;
      if (cl[s] < req[s] - 1e-6) violations.push({ side: s, clearance: cl[s], required: req[s], corner: worst[s] });
    });
    return { clearances: cl, worst: worst, violations: violations, corners: corners, required: req };
  }
  /** Feasible x interval for the side setbacks when the rear-left corner sits at y. */
  function xRangeAt(lot, house, y) {
    var lo = -Infinity, hi = Infinity;
    ['living', 'garage', 'porch'].forEach(function (k) {
      (house.zones[k] || []).forEach(function (v) {
        var Py = y + v[1];
        [lot.left, lot.right].forEach(function (L) {
          var g0 = L.dist([v[0], Py]), g1 = L.dist([v[0] + 1, Py]), m = g1 - g0;
          if (Math.abs(m) < 1e-9) return;
          var x0 = (lot.setbacks.side - g0) / m;
          if (m > 0) lo = Math.max(lo, x0); else hi = Math.min(hi, x0);
        });
      });
    });
    return { lo: lo, hi: hi };
  }
  function roundFt(v) { return Math.round(v * 1000) / 1000; }

  function computePlacement(spec, options) {
    var o = options || {};
    var notes = [];
    var lot = lotModel(spec);
    if (!lot) return { origin: [0, 0], clearances: null, ok: false, notes: ['spec.site.lot missing or invalid — cannot place the house'], violations: [], corners: [], source: 'none' };
    var house = houseModel(spec);
    var site = spec.site;
    var sb = lot.setbacks;
    var orig = Array.isArray(site.house_origin_original) && site.house_origin_original.length >= 2 ? [num(site.house_origin_original[0], 0), num(site.house_origin_original[1], 0)] : null;
    var given = Array.isArray(o.origin) && o.origin.length >= 2 ? [num(o.origin[0], 0), num(o.origin[1], 0)]
      : (Array.isArray(site.house_origin) && site.house_origin.length >= 2 ? [num(site.house_origin[0], 0), num(site.house_origin[1], 0)] : null);
    var origin, source, ev;

    if (given) {
      origin = given;
      source = Array.isArray(o.origin) ? 'options.origin' : 'spec.site.house_origin';
      notes.push('Placement taken from ' + source + ': rear-left frame corner at (' + fmtFeet(origin[0]) + ', ' + fmtFeet(origin[1]) + ') from the left / Hunt Lane property lines.');
      ev = evaluate(lot, house, origin);
    } else {
      var depth = house.bbox.y1 - house.bbox.y0;
      var yStart = orig ? orig[1] : Math.max(sb.rear, (lot.yBottom(lot.bbox.cx) - sb.front - depth + sb.rear) / 2);
      var xPref = orig ? orig[0] : null;
      yStart = Math.max(yStart, sb.rear);
      var ys = [];
      for (var y = yStart; y > sb.rear + 1e-9; y -= 1) ys.push(y);
      ys.push(sb.rear);
      var found = null, lastRange = null;
      for (var i = 0; i < ys.length && !found; i++) {
        var r = xRangeAt(lot, house, ys[i]);
        lastRange = { y: ys[i], lo: r.lo, hi: r.hi };
        if (r.lo <= r.hi + 1e-9) {
          var x = xPref != null ? clamp(xPref, r.lo, r.hi) : (r.lo + r.hi) / 2;
          var e = evaluate(lot, house, [x, ys[i]]);
          if (!e.violations.length) found = { origin: [x, ys[i]], ev: e, range: r };
        }
      }
      if (found) {
        origin = found.origin; ev = found.ev; source = 'computed';
        var shifted = orig ? roundFt(orig[1] - origin[1]) : 0;
        if (orig && shifted < 1e-6) notes.push('Rear wall kept at the original ' + fmtFeet(origin[1]) + ' from the Hunt Lane P.L.');
        else if (orig) notes.push('House shifted ' + fmtFeet(shifted) + ' toward Hunt Lane (rear wall ' + fmtFeet(origin[1]) + ' from the Hunt Lane P.L., originally ' + fmtFeet(orig[1]) + ') so the side and front setbacks clear.');
        else notes.push('Rear wall placed ' + fmtFeet(origin[1]) + ' from the Hunt Lane P.L.');
        if (orig && Math.abs(origin[0] - orig[0]) < 1e-6) notes.push('Left side offset kept at the original ' + fmtFeet(origin[0]) + ' from the left P.L.');
        else if (orig && origin[0] < orig[0]) {
          var w = ev.worst.right;
          notes.push('House shifted ' + fmtFeet(orig[0] - origin[0]) + ' to the left (' + fmtFeet(origin[0]) + ' off the left P.L., originally ' + fmtFeet(orig[0]) + ') so the ' + (w ? w.name : 'right side') + ' clears the ' + sb.side + "' side B.S.L. along the slanted right P.L.");
        } else if (orig) notes.push('House shifted ' + fmtFeet(origin[0] - orig[0]) + ' to the right (' + fmtFeet(origin[0]) + ' off the left P.L.) to clear the left ' + sb.side + "' side B.S.L.");
        else notes.push('Left side offset ' + fmtFeet(origin[0]) + ' from the left P.L. (centred in the feasible band).');
      } else {
        source = 'computed';
        var r2 = lastRange || xRangeAt(lot, house, sb.rear);
        var xf = r2.lo <= r2.hi ? (xPref != null ? clamp(xPref, r2.lo, r2.hi) : (r2.lo + r2.hi) / 2) : r2.lo;
        origin = [isFinite(xf) ? xf : (xPref != null ? xPref : 5), sb.rear];
        ev = evaluate(lot, house, origin);
        notes.push('No placement satisfies every setback: even with the rear wall at the ' + sb.rear + "' rear B.S.L. the house does not fit — see the violations below.");
        if (r2.lo > r2.hi) notes.push('The house is ' + fmtFeet(r2.lo - r2.hi) + ' too wide for the lot between the side setbacks at this depth (left held at ' + fmtFeet(origin[0]) + ').');
      }
    }
    var cl = ev.clearances;
    var clText = SIDES.map(function (s) {
      var w = ev.worst[s];
      return s + ' ' + (isFinite(cl[s]) ? fmtFeet(cl[s]) : 'n/a') + (w ? ' at the ' + w.name : '');
    }).join('; ');
    notes.push('Clearances to the property lines — ' + clText + '.');
    var ok = ev.violations.length === 0;
    if (ok) notes.push('All setbacks satisfied (' + sb.side + "' sides, " + sb.rear + "' rear, " + sb.front + "' front).");
    else ev.violations.forEach(function (v) {
      notes.push('VIOLATION: ' + v.side + ' clearance ' + fmtFeet(v.clearance) + ' is less than the required ' + v.required + "' at the " + v.corner.name + '.');
    });
    return {
      origin: [roundFt(origin[0]), roundFt(origin[1])],
      clearances: { left: roundFt(cl.left), right: roundFt(cl.right), rear: roundFt(cl.rear), front: roundFt(cl.front) },
      ok: ok, notes: notes, violations: ev.violations, corners: ev.corners, required: ev.required, worst: ev.worst, source: source
    };
  }

  // ------------------------------------------------------------------ flatwork + impervious cover
  function flatwork(lot, house, origin) {
    var ox = origin[0], oy = origin[1];
    function tr(p) { return [ox + p[0], oy + p[1]]; }
    var out = { drive: null, apron: null, walk: null, stoop: null, areas: { drive: 0, walk: 0, stoop: 0 } };
    var flare = 3, flareRun = 5, walkW = 3.5;
    var drive = null;
    if (house.door) {
      var x0 = ox + house.door.x0, x1 = ox + house.door.x1, yG = oy + house.garageFront;
      var yEnd0 = lot.yBottom(x0), yEnd1 = lot.yBottom(x1);
      var yF0 = yEnd0 - flareRun, yF1 = yEnd1 - flareRun;
      drive = { x0: x0, x1: x1, yG: yG,
        poly: [[x0, yG], [x1, yG], [x1, yF1], [x1 + flare, lot.yBottom(x1 + flare)], [x0 - flare, lot.yBottom(x0 - flare)], [x0, yF0]] };
      out.drive = drive;
      out.areas.drive = Math.abs(polyArea(drive.poly));
      // apron beyond the P.L. to the curb (not counted: outside the lot)
      var curbDy = 12;
      out.apron = [[x0 - flare, lot.yBottom(x0 - flare)], [x1 + flare, lot.yBottom(x1 + flare)], [x1 + flare, lot.yBottom(x1 + flare) + curbDy], [x0 - flare, lot.yBottom(x0 - flare) + curbDy]];
    }
    if (house.zones.porch) {
      var pb = polyBBox(house.zones.porch);
      var wx = house.frontDoor && house.frontDoor.x > pb.x0 && house.frontDoor.x < pb.x1 ? house.frontDoor.x : pb.cx;
      var wx0 = ox + wx - walkW / 2, wx1 = ox + wx + walkW / 2, yP = oy + pb.y1;
      var poly;
      if (drive) {
        var yJ = drive.yG + walkW; // horizontal leg hugs the garage-front line
        if (wx0 >= drive.x1 - 1e-6) poly = [[wx0, yP], [wx1, yP], [wx1, yJ], [drive.x1, yJ], [drive.x1, yJ - walkW], [wx0, yJ - walkW]];
        else if (wx1 <= drive.x0 + 1e-6) poly = [[wx0, yP], [wx1, yP], [wx1, yJ - walkW], [drive.x0, yJ - walkW], [drive.x0, yJ], [wx0, yJ]];
        else poly = [[wx0, yP], [wx1, yP], [wx1, drive.yG], [wx0, drive.yG]];
      } else {
        poly = [[wx0, yP], [wx1, yP], [wx1, lot.yBottom(wx1)], [wx0, lot.yBottom(wx0)]];
      }
      out.walk = { poly: poly, x0: wx0, x1: wx1, yTop: yP };
      out.areas.walk = Math.abs(polyArea(poly));
    }
    if (house.zones.stoop) {
      out.stoop = house.zones.stoop.map(tr);
      out.areas.stoop = Math.abs(polyArea(out.stoop));
    }
    return out;
  }

  function impervious(spec, placement) {
    var lot = lotModel(spec);
    if (!lot) return null;
    var house = houseModel(spec);
    var pl = placement && Array.isArray(placement.origin) ? placement : computePlacement(spec);
    var fw = flatwork(lot, house, pl.origin);
    var living = house.areas.living || 0, garage = house.areas.garage || 0, porch = house.areas.porch || 0;
    var houseSf = living + garage + porch;
    var flat = fw.areas.drive + fw.areas.walk + fw.areas.stoop;
    var total = houseSf + flat;
    return {
      lot: lot.area, lotPolygon: lot.polyArea, lotPlat: num(spec.site.lot_sf, null),
      house: houseSf, living: living, garage: garage, porch: porch,
      flatwork: flat, drive: fw.areas.drive, walk: fw.areas.walk, stoop: fw.areas.stoop,
      total: total, pct: 100 * total / lot.area, pctRounded: Math.round(100 * total / lot.area)
    };
  }

  // ------------------------------------------------------------------ renderer
  function renderSVG(spec, options) {
    spec = spec || {};
    var o = options || {};
    var ppf = num(o.pxPerFoot, 6) > 0 ? num(o.pxPerFoot, 6) : 6;
    var showTitle = o.title !== false;
    var background = o.background == null ? C.page : o.background;
    var site = spec.site || {};
    var lot = lotModel(spec);
    if (!lot) {
      return '<svg xmlns="http://www.w3.org/2000/svg" width="480" height="120" viewBox="0 0 480 120" font-family="' + FONT + '">' +
        '<rect width="480" height="120" fill="' + C.page + '"/>' + textEl(240, 64, 'SITE PLAN: spec.site.lot is missing', 16, { fill: C.red }) + '</svg>';
    }
    var house = houseModel(spec);
    var placement = o.placement && Array.isArray(o.placement.origin) ? o.placement : computePlacement(spec, o.placement ? { origin: o.placement.origin } : undefined);
    var origin = [num(placement.origin[0], 0), num(placement.origin[1], 0)];
    var ev = evaluate(lot, house, origin);
    var fw = flatwork(lot, house, origin);
    var imp = impervious(spec, { origin: origin });
    var sb = lot.setbacks;
    var ox = origin[0], oy = origin[1];
    function tr(p) { return [ox + p[0], oy + p[1]]; }
    function trPoly(poly) { return poly.map(tr); }

    var L = { bg: [], lot: [], flat: [], house: [], roof: [], lines: [], text: [], dims: [], annot: [] };
    var labels = Object.assign({}, site.lot_labels || {});
    var yB0 = lot.BL[1], yB1 = lot.BR[1], yBmax = Math.max(yB0, yB1);
    var lotB = lot.bbox;

    // ---- lot fill + property lines ------------------------------------------------------
    L.lot.push('<path d="' + pathOf([lot.TL, lot.TR].concat(lot.bottomPts.slice().reverse())) + '" fill="' + C.lot + '"/>');
    var plDash = 'stroke-dasharray="4.5 1.3 0.6 1.3" stroke-linecap="butt" fill="none"';
    L.lines.push(line(lot.TL[0], lot.TL[1], lot.TR[0], lot.TR[1], C.pl, SW.pl, plDash));
    L.lines.push(line(lot.TR[0], lot.TR[1], lot.BR[0], lot.BR[1], C.pl, SW.pl, plDash));
    L.lines.push(line(lot.BL[0], lot.BL[1], lot.TL[0], lot.TL[1], C.pl, SW.pl, plDash));
    L.lines.push('<path d="' + pathOf(lot.bottomPts, true) + '" stroke="' + C.pl + '" stroke-width="' + f(SW.pl) + '" ' + plDash + '/>');
    // property pins
    [lot.TL, lot.TR, lot.BR, lot.BL].concat(lot.curve ? [lot.curve.P1] : []).forEach(function (p) {
      L.lines.push(circle(p[0], p[1], 0.9, 'fill="' + C.page + '" stroke="' + C.pin + '" stroke-width="' + f(SW.bsl) + '"'));
    });

    // ---- building setback lines ------------------------------------------------------------
    var bslDash = 'stroke-dasharray="2.6 1.4" fill="none"';
    L.lines.push('<path d="' + pathOf(lot.bsl) + '" stroke="' + C.bsl + '" stroke-width="' + f(SW.bsl) + '" ' + bslDash + '/>');

    // ---- street furniture: sidewalk + curb along Sawtooth Dr. -----------------------------------
    var bp = lot.bottomPts;
    function extendedBottom(dy) {
      var pts = bp.map(function (p) { return [p[0], p[1] + dy]; });
      var a = pts[0], b = pts[1], ux = b[0] - a[0], uy = b[1] - a[1], l = hyp(ux, uy);
      var head = [a[0] - ux / l * 16, a[1] - uy / l * 16];
      var c = pts[pts.length - 2], d = pts[pts.length - 1], vx = d[0] - c[0], vy = d[1] - c[1], l2 = hyp(vx, vy);
      var tail = [d[0] + vx / l2 * 30, d[1] + vy / l2 * 30];
      return [head].concat(pts, [tail]);
    }
    var walkBack = 4, walkFront = 8, curbDy = 12;
    var swAttr = 'stroke="' + C.side + '" stroke-width="' + f(SW.side) + '" fill="none"';
    L.lot.push('<path d="' + pathOf(extendedBottom(walkBack), true) + '" ' + swAttr + '/>');
    L.lot.push('<path d="' + pathOf(extendedBottom(walkFront), true) + '" ' + swAttr + '/>');
    L.lot.push('<path d="' + pathOf(extendedBottom(curbDy), true) + '" stroke="' + C.slabStroke + '" stroke-width="' + f(SW.curb) + '" fill="none"/>');
    L.lot.push('<path d="' + pathOf(extendedBottom(curbDy + 0.6), true) + '" ' + swAttr + '/>');

    // ---- flatwork ---------------------------------------------------------------------------
    var slabAttr = 'fill="' + C.slabFill + '" stroke="' + C.slabStroke + '" stroke-width="' + f(SW.slab) + '"';
    if (fw.apron) L.flat.push('<path d="' + pathOf(fw.apron) + '" fill="' + C.slabFill + '" stroke="' + C.side + '" stroke-width="' + f(SW.side) + '"/>');
    if (fw.drive) L.flat.push('<path d="' + pathOf(fw.drive.poly) + '" ' + slabAttr + '/>');
    if (fw.walk) L.flat.push('<path d="' + pathOf(fw.walk.poly) + '" ' + slabAttr + '/>');
    if (fw.stoop) L.flat.push('<path d="' + pathOf(fw.stoop) + '" ' + slabAttr + '/>');

    // ---- house footprint --------------------------------------------------------------------
    if (house.zones.porch) L.house.push('<path d="' + pathOf(trPoly(house.zones.porch)) + '" fill="' + C.porchFill + '" stroke="' + C.house + '" stroke-width="' + f(SW.porch) + '"/>');
    ['garage', 'living'].forEach(function (k) {
      if (!house.zones[k]) return;
      L.house.push('<path d="' + pathOf(trPoly(house.zones[k])) + '" fill="' + C.houseFill + '" stroke="' + C.house + '" stroke-width="' + f(SW.house) + '" stroke-linejoin="miter"/>');
    });
    house.columns.forEach(function (c) { L.house.push(rect(ox + c.x, oy + c.y, c.size, c.size, 'fill="' + C.column + '"')); });
    if (house.door) L.house.push(line(ox + house.door.x0, oy + house.door.y, ox + house.door.x1, oy + house.door.y, C.house, SW.door));
    // roof outline (overhang), faint
    house.roofOutline.forEach(function (s) { L.roof.push(line(ox + s[0][0], oy + s[0][1], ox + s[1][0], oy + s[1][1], C.roof, SW.roof)); });
    // labels
    if (house.zones.living) {
      var lb = polyBBox(house.zones.living);
      var lc = house.zones.garage ? [lb.cx, lb.y0 + Math.min(lb.h, (house.zones.garage ? polyBBox(house.zones.garage).y0 - lb.y0 : lb.h)) * 0.55] : polyCentroid(house.zones.living);
      if (!pointInPoly(lc[0], lc[1], house.zones.living)) lc = polyCentroid(house.zones.living);
      L.text.push(textEl(ox + lc[0], oy + lc[1] + T.house * 0.35, 'HOUSE', T.house, { spacing: 0.45, weight: 600 }));
    }
    if (house.zones.garage) {
      var gc = polyBBox(house.zones.garage);
      L.text.push(textEl(ox + gc.cx, oy + gc.y0 + gc.h * 0.68, 'GARAGE', T.house, { spacing: 0.45, weight: 600 }));
    }
    if (fw.drive) {
      var d = fw.drive, dcx = (d.x0 + d.x1) / 2, dcy = (d.yG + lot.yBottom(dcx)) / 2 + 3;
      L.text.push(textEl(dcx, dcy, 'CONC. DRIVEWAY', T.label, { spacing: 0.25 }));
    }
    if (fw.walk) {
      var wk = fw.walk, yl = wk.yTop + 8, tx = wk.x1 + 2.6;
      L.annot.push(line(wk.x1 - 0.3, yl - 0.6, tx - 0.8, yl - 0.6, C.text, SW.ext));
      L.annot.push(circle(wk.x1 - 0.3, yl - 0.6, 0.28, 'fill="' + C.text + '"'));
      L.text.push(textEl(tx, yl - 0.9, '42" CONC.', T.label, { anchor: 'start' }));
      L.text.push(textEl(tx, yl + 1.0, 'WALKWAY', T.label, { anchor: 'start' }));
    }
    if (fw.stoop) {
      var sbb = polyBBox(fw.stoop);
      L.text.push(textEl(sbb.cx, sbb.y0 - 0.9, 'STOOP', T.small * 0.9, { fill: C.slabStroke }));
    }

    // ---- street names + P.L. labels -----------------------------------------------------------
    var topLab = labels.top || ('HUNT LANE  ' + fmtLen(lot.top.len) + " P.L.");
    var streetTop = /^([A-Z .']+?)\s{2,}/.exec(topLab);
    var topStreet = streetTop ? streetTop[1].trim() : 'HUNT LANE';
    var topLen = topLab.replace(topStreet, '').trim() || (fmtLen(lot.top.len) + " P.L.");
    var midTop = lot.top.at(0.5);
    L.text.push(textEl(midTop[0], midTop[1] - 6.6, topStreet, T.street, { weight: 700, spacing: 0.7, family: SERIF }));
    L.text.push(textEl(midTop[0], midTop[1] - 1.1, topLen, T.pl, { spacing: 0.2 }));
    L.text.push(textEl(midTop[0], lot.bslTL[1] + T.bsl + 0.5, sb.rear + "' B.S.L.", T.bsl, { spacing: 0.2 }));

    var leftLab = labels.left || (fmtLen(lot.left.len) + " P.L.");
    var lm = lot.left.at(0.45); // left edge runs BL -> TL; 0.45 is a little below the middle
    L.text.push(textEl(lm[0] - 0.8, lm[1], leftLab, T.pl, { rotate: -90, spacing: 0.2 }));
    L.text.push(textEl(lot.leftS.a[0] + T.bsl + 0.6, lm[1], sb.side + "' B.S.L.", T.bsl, { rotate: -90, spacing: 0.2 }));

    var rightLab = labels.right || (fmtLen(lot.right.len) + " P.L.");
    var rAng = Math.atan2(lot.TR[1] - lot.BR[1], lot.TR[0] - lot.BR[0]) * 180 / Math.PI; // reading upward
    var rm = lot.right.at(0.47), rn = lot.right.nout;
    L.text.push(textEl(rm[0] + rn[0] * (T.pl + 0.8), rm[1] + rn[1] * (T.pl + 0.8), rightLab, T.pl, { rotate: rAng, spacing: 0.2 }));
    var rsm = lot.rightS.at(0.47);
    L.text.push(textEl(rsm[0] - rn[0] * 0.6, rsm[1] - rn[1] * 0.6, sb.side + "' B.S.L.", T.bsl, { rotate: rAng, spacing: 0.2 }));

    // bottom: straight length + curve data, street name, sidewalk labels
    var bc = site.bottom_curve;
    if (lot.curve && bc) {
      var p1 = lot.curve.P1, sMid = [(lot.BL[0] + p1[0]) / 2, (lot.BL[1] + p1[1]) / 2];
      L.text.push(textEl(Math.min(sMid[0], (fw.drive ? fw.drive.x0 - 3 : lot.BL[0] + 12) - 5.2), sMid[1] + 2.3, fmtLen(num(bc.straight_from_left, 0)) + " P.L.", T.small, { spacing: 0.15 }));
      var ax = fw.drive ? Math.min(fw.drive.x1 + 3 + 14, lot.BR[0] - 4) : (p1[0] + lot.BR[0]) / 2;
      L.text.push(textEl(ax, lot.yBottom(ax) + 2.3, 'R=' + fmtLen(num(bc.radius, 0)) + '   L=' + fmtLen(num(bc.length, 0)), T.small, { spacing: 0.15 }));
    } else {
      var bmid = lot.bottomLine.at(0.5);
      L.text.push(textEl(bmid[0], bmid[1] + 2.3, fmtLen(lot.bottomLine.len) + " P.L.", T.small));
    }
    var bLabel = labels.bottom || 'SAWTOOTH DR.';
    var bottomStreet = (/^([A-Z .']+?)(\s{2,}|$)/.exec(bLabel) || [null, bLabel])[1].trim();
    var swx = fw.drive ? Math.min(fw.drive.x1 + 3 + 14, lot.BR[0] - 2) : lot.bbox.cx;
    L.text.push(textEl(swx, lot.yBottom(swx) + (walkBack + walkFront) / 2 + 0.55, 'EXISTING SIDEWALK', T.small * 0.9, { fill: C.slabStroke, spacing: 0.3 }));
    L.text.push(textEl(swx, lot.yBottom(swx) + curbDy + 2.2, 'STREET EDGE', T.small * 0.9, { fill: C.slabStroke, spacing: 0.3 }));
    var bsx = fw.drive ? (fw.drive.x0 + fw.drive.x1) / 2 : lot.bbox.cx;
    L.text.push(textEl(bsx, lot.yBottom(bsx) + curbDy + 7.6, bottomStreet, T.street, { weight: 700, spacing: 0.7, family: SERIF }));
    // 20' B.S.L. label, just inside (below) the setback line, clear of the drive and walk
    if (lot.bslBottom.length) {
      var lx = fw.walk ? fw.walk.x1 + 8.5 : (fw.drive ? fw.drive.x1 + 8 : lot.bbox.cx);
      lx = Math.min(lx, lot.bslBottom[lot.bslBottom.length - 1][0] - 6);
      L.text.push(textEl(lx, polylineY(lot.bslBottom, lx) + T.bsl + 0.7, sb.front + "' B.S.L.", T.bsl, { spacing: 0.2 }));
    }

    // ---- dimension ties -----------------------------------------------------------------------
    var hb = house.bbox;
    var rearLeft = tr([hb.x0, hb.y0]);
    var livB = house.zones.living ? polyBBox(house.zones.living) : hb;
    var rearRight = tr([livB.x1, livB.y0]);
    var frontRight = tr([livB.x1, livB.y1]);
    var dimY = rearLeft[1] - 7.5;
    // horizontal string across the rear: left P.L. -> house -> house width
    var xL = lot.left.foot([0, dimY])[0];
    dimLine([xL, dimY], [rearLeft[0], dimY], fmtFeet(rearLeft[0] - xL), { ext: [[[xL, lot.TL[1] + 4], [xL, dimY]], [rearLeft, [rearLeft[0], dimY]]] });
    dimLine([rearLeft[0], dimY], [rearRight[0], dimY], fmtFeet(rearRight[0] - rearLeft[0]), { ext: [[rearRight, [rearRight[0], dimY]]] });
    // slanted tie from the rear-right corner to the right P.L. (drawn parallel-offset toward the rear)
    tieToLine(rearRight, lot.right, -7.5, ev.worst.right && ev.worst.right.point[0] === rearRight[0] && ev.worst.right.point[1] === rearRight[1]);
    // slanted tie from the wing's front-right corner to the right P.L. (offset toward the street)
    if (frontRight[1] > rearRight[1] + 1) tieToLine(frontRight, lot.right, 5.5, false);
    // left margin: Hunt Lane P.L. -> rear wall -> garage front -> Sawtooth P.L. corner
    var dimX = lot.TL[0] - 5.2;
    var yRear = rearLeft[1], yGar = house.garageFront != null ? oy + house.garageFront : oy + hb.y1;
    var yTopPL = lot.top.foot([dimX, 0])[1];
    dimLine([dimX, yTopPL], [dimX, yRear], fmtFeet(yRear - yTopPL), { ext: [[[lot.TL[0] - 2.5, yTopPL], [dimX, yTopPL]], [rearLeft, [dimX, yRear]]] });
    dimLine([dimX, yRear], [dimX, yGar], fmtFeet(yGar - yRear), { ext: [[[ox + hb.x0, yGar], [dimX, yGar]]] });
    var yBL = lot.BL[1];
    dimLine([dimX, yGar], [dimX, yBL], fmtFeet(yBL - yGar), { ext: [[[lot.BL[0] - 2.5, yBL], [dimX, yBL]]] });

    function dimLine(p0, p1, label, opts) {
      opts = opts || {};
      var dx = p1[0] - p0[0], dy = p1[1] - p0[1], len = hyp(dx, dy);
      if (len < 1e-6) return;
      var ux = dx / len, uy = dy / len;
      var ang = Math.atan2(uy, ux) * 180 / Math.PI;
      if (ang > 90 || ang < -90) { ang += 180; ux = -ux; uy = -uy; }
      var upx = uy, upy = -ux; // "above" the line for upright text
      var col = opts.color || C.dim;
      L.dims.push(line(p0[0], p0[1], p1[0], p1[1], col, SW.dim));
      [p0, p1].forEach(function (p) { L.dims.push(line(p[0] - 0.5, p[1] + 0.5, p[0] + 0.5, p[1] - 0.5, col, SW.tick)); });
      (opts.ext || []).forEach(function (e) {
        var a = e[0], b = e[1], vx = b[0] - a[0], vy = b[1] - a[1], vl = hyp(vx, vy) || 1;
        L.dims.push(line(a[0] + vx / vl * 0.6, a[1] + vy / vl * 0.6, b[0] + vx / vl * 1.0, b[1] + vy / vl * 1.0, C.ext, SW.ext));
      });
      var size = opts.size || T.dim;
      var mx = (p0[0] + p1[0]) / 2 + upx * (opts.gap != null ? opts.gap : 0.55), my = (p0[1] + p1[1]) / 2 + upy * (opts.gap != null ? opts.gap : 0.55);
      var tw = textW(label, size);
      if (tw > len - 1 && opts.shrink !== false) size = Math.max(size * 0.7, size * (len - 1) / tw);
      L.dims.push(textEl(mx, my, label, size, { rotate: Math.abs(ang) < 0.01 ? 0 : ang, fill: col }));
    }
    /** Perpendicular tie from a house corner to a property line, drawn offset along the line by `along` feet. */
    function tieToLine(corner, Ln, along, red) {
      var base = [corner[0] + Ln.ux * along, corner[1] + Ln.uy * along];
      var foot = Ln.foot(base);
      var d = Ln.dist(corner);
      var col = red ? C.red : C.dim;
      // extension line from the corner along the P.L. direction
      L.dims.push(line(corner[0] + Ln.ux * (along > 0 ? 0.6 : -0.6), corner[1] + Ln.uy * (along > 0 ? 0.6 : -0.6), base[0] + Ln.ux * (along > 0 ? 1 : -1), base[1] + Ln.uy * (along > 0 ? 1 : -1), C.ext, SW.ext));
      dimLine(base, foot, fmtFeet(d), { color: col });
    }

    // ---- red marks for violated corners -----------------------------------------------------------
    var redNotes = [];
    ev.violations.forEach(function (v) {
      var p = v.corner.point;
      L.annot.push(circle(p[0], p[1], 1.4, 'fill="none" stroke="' + C.red + '" stroke-width="' + f(SW.red) + '"'));
      L.annot.push(line(p[0] - 1.0, p[1] - 1.0, p[0] + 1.0, p[1] + 1.0, C.red, SW.red));
      L.annot.push(line(p[0] - 1.0, p[1] + 1.0, p[0] + 1.0, p[1] - 1.0, C.red, SW.red));
      redNotes.push(v.side.toUpperCase() + ' SETBACK VIOLATED: ' + fmtFeet(v.clearance) + ' < ' + v.required + "' REQ'D AT THE " + v.corner.name.toUpperCase());
    });

    // ---- impervious-cover table (rear yard) --------------------------------------------------------
    var tabX = lot.bslTL[0] + 8.5, tabY = lot.bslTL[1] + 5.4, pitch = 2.95;
    var tab = [
      ['LOT ' + fmtSf(imp.lot) + (imp.lotPlat && Math.abs(imp.lotPlat - imp.lot) / imp.lot > 0.005 ? '' : ''), true],
      ['FLATWRK ' + fmtSf(imp.flatwork), false],
      ['+', false, 'plus'],
      ['HOUSE ' + fmtSf(imp.house), true],
      [fmtSf(imp.total).replace(' S.F.', ' S.F.') + ' = IMPERVIOUS AREA', false],
      ['EQ = ' + imp.pctRounded + '% IMPERVIOUS AREA', false]
    ];
    var tabW = 0;
    tab.forEach(function (r) { tabW = Math.max(tabW, textW(r[0], T.table, 'bold')); });
    var yy = tabY;
    tab.forEach(function (r, i) {
      if (r[2] === 'plus') { L.annot.push(textEl(tabX + tabW * 0.45, yy + T.table * 0.15, '+', T.table, { weight: 700, family: SERIF })); yy += pitch * 0.75; return; }
      L.annot.push(textEl(tabX, yy, r[0], T.table, { anchor: 'start', weight: 700, family: SERIF }));
      if (r[1]) L.annot.push(line(tabX - 1, yy + 0.7, tabX + tabW + 1, yy + 0.7, C.text, SW.box));
      yy += pitch;
    });
    if (imp.lotPlat && Math.abs(imp.lotPlat - imp.lot) > 1) {
      L.annot.push(textEl(tabX, yy - pitch + 2.0, '(LOT AREA FROM THE PLOTTED BOUNDARY; PLAT CALLS ' + fmtSf(imp.lotPlat) + ')', T.small * 0.85, { anchor: 'start', fill: C.slabStroke, spacing: 0.1 }));
      yy += 1.6;
    }
    // clearances summary (computed)
    var clStr = 'CLEARANCES TO P.L.:  LEFT ' + fmtFeet(ev.clearances.left) + '   RIGHT ' + fmtFeet(ev.clearances.right) + '   REAR ' + fmtFeet(ev.clearances.rear) + '   FRONT ' + fmtFeet(ev.clearances.front) +
      "   (REQ'D " + sb.side + "' / " + sb.side + "' / " + sb.rear + "' / " + sb.front + "')";
    var clDeferred = null; // when the rear yard is short the string would land on the dimension string: move it to the title area
    if (yy + 1.2 > dimY - 2.0) { clDeferred = clStr; }
    else { L.annot.push(textEl(tabX, yy + 0.6, clStr, T.small * 0.92, { anchor: 'start', spacing: 0.1, fill: ev.violations.length ? C.red : C.text })); yy += 2.2; }
    redNotes.forEach(function (t) { L.annot.push(textEl(tabX, yy + 0.6, t, T.small * 0.92, { anchor: 'start', fill: C.red, weight: 700 })); yy += 2.1; });
    if (dimY < yy + 0.5) { /* the rear-yard is short: nothing to do, dims sit above the string */ }

    // ---- notes (boxed, lower right, outside the lot) ---------------------------------------------------
    var siteNotes = Array.isArray(site.notes) && site.notes.length ? site.notes.map(String) : [
      'MAKE SURE ALL DRAINAGE RUN-OFF FLOWS AWAY FROM HOUSE FOUNDATION.',
      'PROVIDE PVC CONDUITS BELOW DRIVEWAYS FOR FUTURE LANDSCAPE WIRING'
    ];
    var noteX = Math.max(lot.BR[0], lot.TR[0]) + 6.5, noteW = 30, noteY = lot.BR[1] - 26;
    var maxX = noteX + noteW;
    siteNotes.forEach(function (n) {
      var lines = wrap(n.toUpperCase(), 25);
      var h = lines.length * (T.note * 1.35) + 2.2;
      L.annot.push(rect(noteX, noteY, noteW, h, 'fill="' + C.page + '" stroke="' + C.box + '" stroke-width="' + f(SW.box) + '"'));
      lines.forEach(function (ln, i) { L.annot.push(textEl(noteX + 1.3, noteY + 1.1 + T.note * 1.0 + i * T.note * 1.35, ln, T.note, { anchor: 'start', spacing: 0.15 })); });
      noteY += h + 2.4;
    });

    // ---- north arrow -------------------------------------------------------------------------------------
    var nax = Math.max(lot.TR[0], lot.BR[0]) + 14, nay = lot.TR[1] + 11, nar = 3.4;
    L.annot.push(circle(nax, nay, nar, 'fill="none" stroke="' + C.text + '" stroke-width="' + f(SW.box) + '"'));
    L.annot.push(line(nax, nay + nar * 0.75, nax, nay - nar * 0.35, C.text, SW.box * 1.6));
    L.annot.push('<polygon points="' + f(nax) + ',' + f(nay - nar * 0.85) + ' ' + f(nax - 0.85) + ',' + f(nay - nar * 0.2) + ' ' + f(nax + 0.85) + ',' + f(nay - nar * 0.2) + '" fill="' + C.text + '"/>');
    L.annot.push(textEl(nax, nay - nar - 1.0, 'N', 2.4, { weight: 700 }));
    maxX = Math.max(maxX, nax + nar + 2);

    // ---- title + address ---------------------------------------------------------------------------------
    var vx0 = lot.TL[0] - 17, vx1 = maxX + 2.5;
    var vy0 = lot.TL[1] - 12.5;
    var yTitle = yBmax + curbDy + 16.5;
    if (showTitle) {
      var tx0 = vx0 + 3;
      L.annot.push(textEl(tx0, yTitle, 'SITE PLAN', T.title, { anchor: 'start', weight: 700, spacing: 0.9 }));
      L.annot.push(line(tx0, yTitle + 1.2, tx0 + textW('SITE PLAN', T.title, 'bold', 0.9), yTitle + 1.2, C.text, 0.22));
      L.annot.push(textEl(tx0, yTitle + 4.4, 'SCALE: 1/8" = 1\'-0"', T.scale, { anchor: 'start', spacing: 0.3 }));
      if (clDeferred) L.annot.push(textEl(tx0, yTitle + 7.8, clDeferred, T.small * 0.92, { anchor: 'start', spacing: 0.1, fill: ev.violations.length ? C.red : C.text }));
      var addr = site.address_block || '738 SAWTOOTH DR. · LOT 48 · BLOCK 23 · N.C.B. 15850 · LACKLAND CITY SUBDIVISION · SAN ANTONIO, TX. · BEXAR COUNTY';
      var parts = addr.split(' · ');
      var l1 = parts.slice(0, 4).join(' · '), l2 = parts.slice(4).join(' · ');
      if (!l2) { l1 = parts.slice(0, Math.ceil(parts.length / 2)).join(' · '); l2 = parts.slice(Math.ceil(parts.length / 2)).join(' · '); }
      L.annot.push(textEl(vx1 - 3, yTitle - 0.2, l1.toUpperCase(), T.addr, { anchor: 'end', weight: 600, spacing: 0.25 }));
      L.annot.push(textEl(vx1 - 3, yTitle + 3.2, l2.toUpperCase(), T.addr, { anchor: 'end', spacing: 0.25 }));
      if (spec.name) L.annot.push(textEl(vx1 - 3, yTitle + 6.4, String(spec.name).toUpperCase() + ' — CONCEPT STUDY, NOT FOR CONSTRUCTION', T.small * 0.85, { anchor: 'end', fill: C.slabStroke, spacing: 0.2 }));
    }
    var vy1 = (showTitle ? yTitle + (clDeferred ? 10.8 : 9) : yBmax + curbDy + 11);
    var vw = vx1 - vx0, vh = vy1 - vy0;

    // ---- assemble --------------------------------------------------------------------------------------------
    var W = Math.round(vw * ppf), H = Math.round(vh * ppf);
    var out = [];
    out.push('<svg xmlns="http://www.w3.org/2000/svg" version="1.1" width="' + W + '" height="' + H + '" viewBox="' +
      f(vx0) + ' ' + f(vy0) + ' ' + f(vw) + ' ' + f(vh) + '" font-family="' + FONT + '" data-siteplan="' + VERSION + '">');
    out.push('<title>' + esc((spec.name ? spec.name + ' — ' : '') + 'Site plan') + '</title>');
    if (background && background !== 'transparent') out.push(rect(vx0, vy0, vw, vh, 'fill="' + background + '"'));
    ['lot', 'flat', 'roof', 'house', 'lines', 'text', 'dims', 'annot'].forEach(function (k) {
      if (L[k].length) out.push('<g id="sp-' + k + '">' + L[k].join('') + '</g>');
    });
    out.push('</svg>');
    return out.join('\n');
  }

  function fmtLen(ft) { // survey-style length: 73.31'
    var v = Math.round(num(ft, 0) * 100) / 100;
    return v.toFixed(2) + "'";
  }

  return {
    computePlacement: computePlacement, renderSVG: renderSVG, impervious: impervious, lotModel: lotModel,
    houseModel: houseModel, fmtFt: fmtFt, fmtFeet: fmtFeet, version: VERSION
  };
}));
