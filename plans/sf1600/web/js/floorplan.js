/*  floorplan.js — dependency-free floor-plan renderer for the house-plan spec
 *  (see tools/SPEC_FORMAT.md).  Produces a complete <svg> element string.
 *
 *  UMD: attaches to window.FloorPlan in a browser, module.exports under Node.
 *
 *    FloorPlan.renderSVG(spec, options) -> "<svg …>…</svg>"
 *    FloorPlan.roomDims(poly)           -> { w, d, wFt, dFt, areaSf }
 *    FloorPlan.fmtFt(inches[, style])   -> "13'-10\""  (style 'plain' -> "13'10\"")
 *
 *  options:
 *    style            'presentation' (default) | 'architectural'
 *    pxPerInch        2
 *    padding          px around the plan (default 30" presentation / 90" architectural)
 *    showFixtures     true
 *    showDimensions   architectural: true, presentation: false
 *    showDoorLabels   architectural only (default true there)
 *    showWindowMarks  architectural only (default true there)
 *    showLabels       true
 *    title            string | null
 *    background       '#fff' | 'transparent' | any css color
 *    colors           { page, room, wall, garageFloor, porch, stoop, text, … } overrides
 *
 *  Drawing method: SVG user units are INCHES (+x right, +y toward the street).
 *  Walls are implicit — the living/garage footprints are painted in the wall colour
 *  and every room polygon is painted on top in the floor colour; what remains is wall.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) { module.exports = factory(); }
  else { root.FloorPlan = factory(); }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var VERSION = '1.0.0';
  var FONT = "'Segoe UI', Helvetica, Arial, sans-serif";

  // ------------------------------------------------------------------ palettes
  var STYLES = {
    presentation: {
      page: '#ffffff', room: '#f4f4f4', wall: '#3a3a3a', garageFloor: '#f8f8f8',
      porch: '#efefef', stoop: '#f3f3f3', slabOutline: '#c4c4c4',
      text: '#222222', dimText: '#222222', window: '#3a3a3a', door: '#3a3a3a',
      doorArc: '#6f6f6f', fixture: '#8a8a8a', fixtureText: '#8a8a8a', outline: '#3a3a3a',
      openEdge: '#b5b5b5', hatch: '#d8d8d8', entry: '#222222', title: '#222222'
    },
    architectural: {
      page: '#ffffff', room: '#ffffff', wall: '#555555', garageFloor: '#ffffff',
      porch: '#f4f4f4', stoop: '#f4f4f4', slabOutline: '#6a6a6a',
      text: '#111111', dimText: '#111111', window: '#111111', door: '#111111',
      doorArc: '#333333', fixture: '#444444', fixtureText: '#444444', outline: '#111111',
      openEdge: '#9a9a9a', hatch: '#bdbdbd', entry: '#111111', title: '#111111'
    }
  };

  // stroke widths in inches (0.5" = 1 px at 2 px/in)
  var SW = {
    fixture: 0.4, door: 0.55, arc: 0.4, jamb: 0.45, window: 0.45, outline: 0.35,
    footOutline: 0.6, slab: 0.3, dim: 0.3, ext: 0.22, tick: 0.5, openEdge: 0.35,
    overhead: 1.5, marker: 0.4
  };

  // ------------------------------------------------------------------ helpers
  function num(v, d) { var n = Number(v); return isFinite(n) ? n : d; }
  function f(n) { return String(Math.round(n * 1000) / 1000); }
  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function lower(s) { return String(s == null ? '' : s).toLowerCase(); }

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
  function distToBoundary(x, y, poly) {
    var best = Infinity;
    for (var i = 0, n = poly.length; i < n; i++) {
      var p = poly[i], q = poly[(i + 1) % n];
      var dx = q[0] - p[0], dy = q[1] - p[1];
      var l2 = dx * dx + dy * dy;
      var t = l2 ? Math.max(0, Math.min(1, ((x - p[0]) * dx + (y - p[1]) * dy) / l2)) : 0;
      var ex = p[0] + t * dx - x, ey = p[1] + t * dy - y;
      var d = Math.sqrt(ex * ex + ey * ey);
      if (d < best) best = d;
    }
    return best;
  }
  function inPolyStrict(x, y, poly) { return pointInPoly(x, y, poly) && distToBoundary(x, y, poly) > 0.05; }
  function inPolyInclusive(x, y, poly) { return pointInPoly(x, y, poly) || distToBoundary(x, y, poly) <= 0.05; }

  /** Edges of a rectilinear polygon with outward-normal sign along the perpendicular axis. */
  function polyEdges(poly) {
    var A = polyArea(poly), out = [];
    for (var i = 0, n = poly.length; i < n; i++) {
      var p = poly[i], q = poly[(i + 1) % n];
      if (p[1] === q[1]) {
        var dir = q[0] > p[0] ? 1 : -1;
        out.push({ horiz: true, c: p[1], a: Math.min(p[0], q[0]), b: Math.max(p[0], q[0]), out: A > 0 ? -dir : dir });
      } else if (p[0] === q[0]) {
        var dv = q[1] > p[1] ? 1 : -1;
        out.push({ horiz: false, c: p[0], a: Math.min(p[1], q[1]), b: Math.max(p[1], q[1]), out: A > 0 ? dv : -dv });
      } else {
        out.push({ diag: true, x0: p[0], y0: p[1], x1: q[0], y1: q[1] });
      }
    }
    return out;
  }
  /** Is the open rectangle strictly inside the polygon? (centre inside, no edge crossing) */
  function rectInPoly(x0, y0, x1, y1, poly, edges) {
    if (!pointInPoly((x0 + x1) / 2, (y0 + y1) / 2, poly)) return false;
    for (var i = 0; i < edges.length; i++) {
      var e = edges[i];
      if (e.diag) return false;
      if (e.horiz) { if (e.c > y0 + 1e-6 && e.c < y1 - 1e-6 && e.a < x1 - 1e-6 && e.b > x0 + 1e-6) return false; }
      else { if (e.c > x0 + 1e-6 && e.c < x1 - 1e-6 && e.a < y1 - 1e-6 && e.b > y0 + 1e-6) return false; }
    }
    return true;
  }
  function boxesOverlap(a, b, pad) {
    pad = pad || 0;
    return a.x0 < b.x1 + pad && a.x1 > b.x0 - pad && a.y0 < b.y1 + pad && a.y1 > b.y0 - pad;
  }
  /** Subtract intervals [a,b] (list) from [a0,b0]; returns remaining pieces. */
  function subtractIntervals(a0, b0, cuts) {
    var pieces = [[a0, b0]];
    for (var i = 0; i < cuts.length; i++) {
      var c = cuts[i], next = [];
      for (var j = 0; j < pieces.length; j++) {
        var p = pieces[j];
        if (c[1] <= p[0] || c[0] >= p[1]) { next.push(p); continue; }
        if (c[0] > p[0]) next.push([p[0], c[0]]);
        if (c[1] < p[1]) next.push([c[1], p[1]]);
      }
      pieces = next;
    }
    return pieces.filter(function (p) { return p[1] - p[0] > 0.25; });
  }
  function pathOf(poly) {
    var s = 'M' + f(poly[0][0]) + ' ' + f(poly[0][1]);
    for (var i = 1; i < poly.length; i++) s += 'L' + f(poly[i][0]) + ' ' + f(poly[i][1]);
    return s + 'Z';
  }

  /** {w, d, wFt, dFt, areaSf} for a room polygon (bounding-box clear dimensions). */
  function roomDims(poly) {
    var p = cleanPoly(poly);
    if (!p) return { w: 0, d: 0, wFt: fmtFt(0), dFt: fmtFt(0), areaSf: 0 };
    var b = polyBBox(p);
    return { w: b.w, d: b.h, wFt: fmtFt(b.w), dFt: fmtFt(b.h), areaSf: Math.round(Math.abs(polyArea(p)) / 144 * 10) / 10 };
  }

  // ------------------------------------------------------------------ text helpers
  // approximate Helvetica/Arial advance widths (em) for text fitting
  var CW = {
    ' ': 0.278, '!': 0.278, '"': 0.355, '#': 0.556, '$': 0.556, '%': 0.889, '&': 0.667, "'": 0.191, '(': 0.333, ')': 0.333,
    '*': 0.389, '+': 0.584, ',': 0.278, '-': 0.333, '.': 0.278, '/': 0.278, ':': 0.278, ';': 0.278, '=': 0.584, '?': 0.556,
    '@': 1.015, '½': 0.834, '×': 0.584, '’': 0.222, '”': 0.5,
    A: 0.667, B: 0.667, C: 0.722, D: 0.722, E: 0.667, F: 0.611, G: 0.778, H: 0.722, I: 0.278, J: 0.5, K: 0.667, L: 0.556, M: 0.833,
    N: 0.722, O: 0.778, P: 0.667, Q: 0.778, R: 0.722, S: 0.667, T: 0.611, U: 0.722, V: 0.667, W: 0.944, X: 0.667, Y: 0.667, Z: 0.611,
    a: 0.556, b: 0.556, c: 0.5, d: 0.556, e: 0.556, f: 0.278, g: 0.556, h: 0.556, i: 0.222, j: 0.222, k: 0.5, l: 0.222, m: 0.833,
    n: 0.556, o: 0.556, p: 0.556, q: 0.556, r: 0.333, s: 0.5, t: 0.278, u: 0.556, v: 0.5, w: 0.722, x: 0.5, y: 0.5, z: 0.5
  };
  /** Estimated rendered width (same units as size). kind 'bold' adds ~8%; spacing = letter-spacing per gap. */
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
      'text-anchor="' + (o.anchor || 'middle') + '"', 'fill="' + (o.fill || '#222') + '"'];
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

  // ------------------------------------------------------------------ fixtures
  /** Fixture symbol in local coords: origin at centre, width lw along x, depth lh along y, back at -y. */
  function fixtureShapes(kind, lw, lh, fx, C, rot) {
    var x0 = -lw / 2, y0 = -lh / 2, x1 = lw / 2, y1 = lh / 2;
    var st = 'fill="none" stroke="' + C.fixture + '" stroke-width="' + f(SW.fixture) + '"';
    var stThin = 'fill="none" stroke="' + C.fixture + '" stroke-width="' + f(SW.fixture * 0.8) + '"';
    var dashed = stThin + ' stroke-dasharray="2 1.5"';
    var s = [];
    var minD = Math.min(lw, lh);
    function label(str, size) {
      // keep fixture text upright regardless of rotation
      var sz = size || Math.max(2.4, Math.min(4.5, minD * 0.32));
      s.push('<g transform="rotate(' + f(-rot) + ')">' +
        textEl(0, sz * 0.35, str, sz, { fill: C.fixtureText, weight: 500 }) + '</g>');
    }
    switch (kind) {
      case 'tub': {
        s.push(rect(x0, y0, lw, lh, st));
        var ins = Math.min(3, lw * 0.12, lh * 0.12);
        s.push(rect(x0 + ins, y0 + ins, lw - 2 * ins, lh - 2 * ins, st + ' rx="' + f(Math.min(6, minD * 0.25)) + '"'));
        if (lw >= lh) s.push(circle(x0 + Math.min(8, lw * 0.15), 0, 1.25, st));
        else s.push(circle(0, y0 + Math.min(8, lh * 0.15), 1.25, st));
        break;
      }
      case 'shower':
        s.push(rect(x0, y0, lw, lh, st));
        s.push(line(x0, y0, x1, y1, C.fixture, SW.fixture * 0.7));
        s.push(line(x1, y0, x0, y1, C.fixture, SW.fixture * 0.7));
        s.push(circle(0, 0, 1.6, st));
        break;
      case 'toilet': {
        var th = lh * 0.3;
        s.push(rect(x0 + lw * 0.08, y0, lw * 0.84, th, st + ' rx="0.8"'));
        var ry = lh * 0.33, rx = Math.min(lw * 0.42, ry * 0.85);
        s.push('<ellipse cx="0" cy="' + f(y0 + th + ry + 0.5) + '" rx="' + f(rx) + '" ry="' + f(ry) + '" ' + st + '/>');
        break;
      }
      case 'vanity': {
        s.push(rect(x0, y0, lw, lh, st));
        var n = Math.max(1, Math.min(2, Math.round(num(fx.sinks, 1))));
        if (lw < 40) n = 1;
        var pos = n === 1 ? [0] : [-lw / 4, lw / 4];
        var brx = Math.min((lw / n) * 0.32, 8), bry = Math.min(lh * 0.3, 7);
        for (var i = 0; i < pos.length; i++) {
          s.push('<ellipse cx="' + f(pos[i]) + '" cy="' + f(lh * 0.06) + '" rx="' + f(brx) + '" ry="' + f(bry) + '" ' + st + '/>');
          s.push(circle(pos[i], Math.max(y0 + 1.6, lh * 0.06 - bry - 2.2), 0.9, 'fill="' + C.fixture + '"'));
        }
        break;
      }
      case 'sink': {
        s.push(rect(x0, y0, lw, lh, st));
        var si = Math.min(2.5, minD * 0.12);
        s.push(rect(x0 + si, y0 + si + 1.5, lw - 2 * si, lh - 2 * si - 1.5, st + ' rx="2"'));
        s.push(circle(0, y0 + si * 0.9, 0.9, 'fill="' + C.fixture + '"'));
        break;
      }
      case 'range': {
        s.push(rect(x0, y0, lw, lh, st));
        var br = Math.max(1.5, minD * 0.15);
        var ox = lw * 0.25, oy = lh * 0.24;
        s.push(circle(-ox, -oy, br, st)); s.push(circle(ox, -oy, br, st));
        s.push(circle(-ox, oy, br * 0.85, st)); s.push(circle(ox, oy, br * 0.85, st));
        break;
      }
      case 'fridge':
        s.push(rect(x0, y0, lw, lh, st));
        s.push(line(x0, y1 - 2, x1, y1 - 2, C.fixture, SW.fixture * 0.8));
        label('REF');
        break;
      case 'dw':
        s.push(rect(x0, y0, lw, lh, st));
        label('DW');
        break;
      case 'island': {
        s.push(rect(x0, y0, lw, lh, st));
        if (lh >= lw) { // long axis y: overhang line along the +x side
          var ox2 = lw >= 30 ? x1 - 12 : 0;
          s.push(line(ox2, y0 + 1, ox2, y1 - 1, C.fixture, SW.fixture * 0.8, 'stroke-dasharray="2.5 1.5"'));
        } else {
          var oy2 = lh >= 30 ? y1 - 12 : 0;
          s.push(line(x0 + 1, oy2, x1 - 1, oy2, C.fixture, SW.fixture * 0.8, 'stroke-dasharray="2.5 1.5"'));
        }
        break;
      }
      case 'counter':
        s.push(rect(x0, y0, lw, lh, st));
        break;
      case 'washer': case 'dryer': {
        s.push(rect(x0, y0, lw, lh, st));
        s.push(circle(0, 0, minD * 0.3, st));
        label(kind === 'washer' ? 'W' : 'D', Math.max(2.5, minD * 0.28));
        break;
      }
      case 'water_heater':
        s.push(circle(0, 0, minD / 2, st));
        label('WH', Math.max(2.4, minD * 0.3));
        break;
      case 'bench':
        s.push(rect(x0, y0, lw, lh, st));
        if (lw >= lh) s.push(line(x0, y0 + lh * 0.35, x1, y0 + lh * 0.35, C.fixture, SW.fixture * 0.7));
        else s.push(line(x0 + lw * 0.35, y0, x0 + lw * 0.35, y1, C.fixture, SW.fixture * 0.7));
        break;
      case 'shelves': {
        s.push(rect(x0, y0, lw, lh, st));
        if (lw >= lh) {
          var k = lh > 16 ? 2 : 1;
          for (var q = 1; q <= k; q++) { var yy = y0 + lh * q / (k + 1); s.push(line(x0, yy, x1, yy, C.fixture, SW.fixture * 0.7, 'stroke-dasharray="2 1.5"')); }
        } else {
          var k2 = lw > 16 ? 2 : 1;
          for (var q2 = 1; q2 <= k2; q2++) { var xx = x0 + lw * q2 / (k2 + 1); s.push(line(xx, y0, xx, y1, C.fixture, SW.fixture * 0.7, 'stroke-dasharray="2 1.5"')); }
        }
        break;
      }
      case 'closet_rod': {
        if (lw >= lh) {
          s.push(line(x0, 0, x1, 0, C.fixture, SW.fixture * 0.8, 'stroke-dasharray="2.5 1.5"'));
          var sy = Math.max(1.5, lh / 2);
          s.push(line(x0, sy, x1, sy, C.fixture, SW.fixture * 0.8));
        } else {
          s.push(line(0, y0, 0, y1, C.fixture, SW.fixture * 0.8, 'stroke-dasharray="2.5 1.5"'));
          var sx = Math.max(1.5, lw / 2);
          s.push(line(sx, y0, sx, y1, C.fixture, SW.fixture * 0.8));
        }
        break;
      }
      case 'bed': {
        s.push(rect(x0, y0, lw, lh, st + ' rx="1"'));
        var ph = Math.min(10, lh * 0.16), pw = lw * 0.4;
        s.push(rect(x0 + lw * 0.06, y0 + 2, pw, ph, stThin + ' rx="1.5"'));
        s.push(rect(x1 - lw * 0.06 - pw, y0 + 2, pw, ph, stThin + ' rx="1.5"'));
        s.push(line(x0, y0 + ph + 6, x1, y0 + ph + 6, C.fixture, SW.fixture * 0.7));
        break;
      }
      case 'sofa': {
        s.push(rect(x0, y0, lw, lh, st + ' rx="1.5"'));
        var bk = lh * 0.25, arm = Math.min(lw * 0.12, 8);
        s.push(line(x0 + arm, y0 + bk, x1 - arm, y0 + bk, C.fixture, SW.fixture * 0.7));
        s.push(line(x0 + arm, y0 + bk, x0 + arm, y1, C.fixture, SW.fixture * 0.7));
        s.push(line(x1 - arm, y0 + bk, x1 - arm, y1, C.fixture, SW.fixture * 0.7));
        break;
      }
      case 'table':
        s.push(rect(x0, y0, lw, lh, st + ' rx="1.5"'));
        break;
      case 'desk':
        s.push(rect(x0, y0, lw, lh, st));
        s.push(line(x0, y0 + lh * 0.3, x1, y0 + lh * 0.3, C.fixture, SW.fixture * 0.7, 'stroke-dasharray="2 1.5"'));
        break;
      default:
        s.push(rect(x0, y0, lw, lh, dashed));
        if (kind) label(String(kind).toUpperCase().slice(0, 6));
    }
    return s.join('');
  }

  // ------------------------------------------------------------------ main
  function renderSVG(spec, options) {
    spec = spec || {};
    var o = options || {};
    var arch = o.style === 'architectural';
    var C = Object.assign({}, STYLES[arch ? 'architectural' : 'presentation'], o.colors || {});
    var ppi = num(o.pxPerInch, 2) > 0 ? num(o.pxPerInch, 2) : 2;
    var padIn = o.padding != null ? num(o.padding, 0) / ppi : (arch ? 90 : 30);
    var showFixtures = o.showFixtures !== false;
    var showDims = o.showDimensions != null ? !!o.showDimensions : arch;
    var showDoorLabels = arch && o.showDoorLabels !== false;
    var showWindowMarks = arch && o.showWindowMarks !== false;
    var showLabels = o.showLabels !== false;
    var showNotes = arch && o.showNotes !== false;
    var background = o.background == null ? C.page : o.background;
    var walls = spec.walls || {};
    var extT = num(walls.exterior, 6);

    // ---- model -------------------------------------------------------------
    var fp = spec.footprint || {};
    var zones = {};
    ['living', 'garage', 'porch', 'stoop'].forEach(function (k) {
      var p = cleanPoly(fp[k]);
      if (p) zones[k] = { poly: p, edges: polyEdges(p), bbox: polyBBox(p) };
    });
    var rooms = [];
    (Array.isArray(spec.rooms) ? spec.rooms : []).forEach(function (r, i) {
      if (!r || typeof r !== 'object') return;
      var p = cleanPoly(r.poly);
      if (!p) return;
      var zone = r.zone === 'garage' || r.zone === 'porch' || r.zone === 'stoop' ? r.zone : 'living';
      rooms.push({
        id: r.id != null ? String(r.id) : ('room' + i), name: r.name != null ? String(r.name) : '',
        zone: zone, poly: p, edges: polyEdges(p), bbox: polyBBox(p), area: Math.abs(polyArea(p)),
        label: r.label, name_pos: Array.isArray(r.name_pos) && r.name_pos.length >= 2 ? [num(r.name_pos[0], 0), num(r.name_pos[1], 0)] : null,
        ceiling: r.ceiling != null ? String(r.ceiling) : '', raw: r
      });
    });
    var fixtures = (Array.isArray(spec.fixtures) ? spec.fixtures : []).filter(function (fx) {
      return fx && isFinite(Number(fx.x)) && isFinite(Number(fx.y)) && Number(fx.w) > 0 && Number(fx.h) > 0;
    }).map(function (fx) {
      return { kind: lower(fx.kind), x: Number(fx.x), y: Number(fx.y), w: Number(fx.w), h: Number(fx.h),
        rot: ((Math.round(num(fx.rot, 0) / 90) * 90) % 360 + 360) % 360, sinks: fx.sinks, raw: fx };
    });
    var doors = (Array.isArray(spec.doors) ? spec.doors : []).filter(function (d) {
      return d && isFinite(Number(d.x)) && isFinite(Number(d.y)) && Number(d.w) > 0;
    }).map(function (d, i) {
      return { id: d.id != null ? String(d.id) : String(i + 1), kind: lower(d.kind) || 'hinged', w: Number(d.w),
        x: Number(d.x), y: Number(d.y), orient: d.orient === 'v' ? 'v' : 'h',
        hinge: d.hinge === 'right' ? 'right' : 'left', swing: d.swing === '-' ? -1 : 1, label: d.label != null ? String(d.label) : '' };
    });
    var windows = (Array.isArray(spec.windows) ? spec.windows : []).filter(function (w) {
      return w && isFinite(Number(w.x)) && isFinite(Number(w.y)) && Number(w.w) > 0;
    }).map(function (w) {
      return { mark: w.mark != null ? String(w.mark) : '', label: w.label != null ? String(w.label) : '',
        w: Number(w.w), x: Number(w.x), y: Number(w.y), orient: w.orient === 'v' ? 'v' : 'h' };
    });
    var columns = (Array.isArray(spec.porch_columns) ? spec.porch_columns : []).filter(function (c) {
      return c && isFinite(Number(c.x)) && isFinite(Number(c.y));
    }).map(function (c) { return { x: Number(c.x), y: Number(c.y), size: num(c.size, 24) }; });

    // ---- point classifier --------------------------------------------------
    function classify(x, y) {
      for (var i = 0; i < rooms.length; i++) {
        var r = rooms[i];
        var b = r.bbox;
        if (x < b.x0 - 0.1 || x > b.x1 + 0.1 || y < b.y0 - 0.1 || y > b.y1 + 0.1) continue;
        if (inPolyStrict(x, y, r.poly)) return { type: 'room', room: r };
      }
      if (zones.living && inPolyInclusive(x, y, zones.living.poly)) return { type: 'wall', zone: 'living' };
      if (zones.garage && inPolyInclusive(x, y, zones.garage.poly)) return { type: 'wall', zone: 'garage' };
      if (zones.porch && inPolyInclusive(x, y, zones.porch.poly)) return { type: 'slab', zone: 'porch' };
      if (zones.stoop && inPolyInclusive(x, y, zones.stoop.poly)) return { type: 'slab', zone: 'stoop' };
      return { type: 'outside' };
    }
    function isWallAt(x, y) { return classify(x, y).type === 'wall'; }
    function isExteriorSide(cls) {
      return cls.type === 'outside' || cls.type === 'slab' || (cls.type === 'room' && (cls.room.zone === 'porch' || cls.room.zone === 'stoop'));
    }
    function fillForSpace(cls) {
      if (cls.type === 'room') return cls.room.zone === 'garage' ? C.garageFloor : cls.room.zone === 'porch' ? C.porch : cls.room.zone === 'stoop' ? C.stoop : C.room;
      if (cls.type === 'slab') return cls.zone === 'porch' ? C.porch : C.stoop;
      return C.page;
    }

    /** Wall band [lo, hi] across an opening at (x,y); orient h => band along y. */
    function wallBand(x, y, orient, w) {
      var isW = orient === 'h' ? function (c) { return isWallAt(x, c); } : function (c) { return isWallAt(c, y); };
      var c = orient === 'h' ? y : x;
      var fallback = [c - 3.5, c + 3.5];
      if (!isW(c)) {
        var found = null;
        for (var d = 0.5; d <= 6 && found === null; d += 0.5) {
          if (isW(c - d)) found = c - d; else if (isW(c + d)) found = c + d;
        }
        if (found === null) return { lo: fallback[0], hi: fallback[1], found: false };
        c = found;
      }
      var lo = c, hi = c, guard = 0;
      while (guard++ < 60 && isW(lo - 0.5)) lo -= 0.5;
      guard = 0;
      while (guard++ < 60 && isW(hi + 0.5)) hi += 0.5;
      if (hi - lo < 1.5) return { lo: c - 3.5, hi: c + 3.5, found: false };
      return { lo: lo, hi: hi, found: true };
    }
    /** Local frame for an opening: along-wall coordinate a, perpendicular p. */
    function mapAP(orient) {
      return orient === 'h' ? function (a, p) { return [a, p]; } : function (a, p) { return [p, a]; };
    }

    // ---- bounds --------------------------------------------------------------
    var bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;
    function grow(b) { if (b.x0 < bx0) bx0 = b.x0; if (b.y0 < by0) by0 = b.y0; if (b.x1 > bx1) bx1 = b.x1; if (b.y1 > by1) by1 = b.y1; }
    Object.keys(zones).forEach(function (k) { grow(zones[k].bbox); });
    rooms.forEach(function (r) { grow(r.bbox); });
    columns.forEach(function (c) { grow({ x0: c.x, y0: c.y, x1: c.x + c.size, y1: c.y + c.size }); });
    fixtures.forEach(function (fx) { grow({ x0: fx.x, y0: fx.y, x1: fx.x + fx.w, y1: fx.y + fx.h }); });
    if (!isFinite(bx0)) { bx0 = 0; by0 = 0; bx1 = 120; by1 = 120; }
    // building extents (living + garage) for dimensions / FRONT note
    var hb = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
    ['living', 'garage'].forEach(function (k) { if (zones[k]) { var b = zones[k].bbox; if (b.x0 < hb.x0) hb.x0 = b.x0; if (b.y0 < hb.y0) hb.y0 = b.y0; if (b.x1 > hb.x1) hb.x1 = b.x1; if (b.y1 > hb.y1) hb.y1 = b.y1; } });
    if (!isFinite(hb.x0)) hb = { x0: bx0, y0: by0, x1: bx1, y1: by1 };

    // ---- layers ----------------------------------------------------------------
    var L = { bg: [], walls: [], floors: [], slabs: [], outlines: [], openings: [], fixtures: [], doors: [], labels: [], dims: [], annot: [] };
    var defs = [];
    var crisp = 'shape-rendering="crispEdges"';

    // wall material: footprints in wall colour
    ['living', 'garage'].forEach(function (k) {
      if (zones[k]) L.walls.push('<path d="' + pathOf(zones[k].poly) + '" fill="' + C.wall + '" ' + crisp + '/>');
    });
    // slabs
    ['porch', 'stoop'].forEach(function (k) {
      if (!zones[k]) return;
      var fill = k === 'porch' ? C.porch : C.stoop;
      L.slabs.push('<path d="' + pathOf(zones[k].poly) + '" fill="' + fill + '" ' + crisp + '/>');
      if (arch && k === 'porch') {
        defs.push('<pattern id="fpHatch" patternUnits="userSpaceOnUse" width="8" height="8">' +
          '<path d="M0 8L8 0" stroke="' + C.hatch + '" stroke-width="0.3" fill="none"/></pattern>');
        L.slabs.push('<path d="' + pathOf(zones[k].poly) + '" fill="url(#fpHatch)"/>');
      }
      L.slabs.push('<path d="' + pathOf(zones[k].poly) + '" fill="none" stroke="' + C.slabOutline + '" stroke-width="' + f(SW.slab) + '"/>');
    });
    // rooms
    rooms.forEach(function (r) {
      var fill = r.zone === 'garage' ? C.garageFloor : r.zone === 'porch' ? C.porch : r.zone === 'stoop' ? C.stoop : C.room;
      if (r.zone === 'porch' || r.zone === 'stoop') {
        // slab rooms: only paint if no footprint slab painted the same area
        if (zones[r.zone]) return;
      }
      L.floors.push('<path d="' + pathOf(r.poly) + '" fill="' + fill + '" ' + crisp + '/>');
    });
    // porch columns
    columns.forEach(function (c) { L.slabs.push(rect(c.x, c.y, c.size, c.size, 'fill="' + C.wall + '" ' + crisp)); });

    // ---- shared (open) edges between rooms + crisp outlines (architectural) -----
    var wallRooms = rooms.filter(function (r) { return r.zone === 'living' || r.zone === 'garage'; });
    function collinearOverlaps(e, others, selfRoom) {
      var cuts = [];
      others.forEach(function (r2) {
        if (r2 === selfRoom) return;
        r2.edges.forEach(function (e2) {
          if (e2.diag || e2.horiz !== e.horiz || Math.abs(e2.c - e.c) > 0.3) return;
          var a = Math.max(e.a, e2.a), b = Math.min(e.b, e2.b);
          if (b - a > 0.25) cuts.push([a, b, r2]);
        });
      });
      return cuts;
    }
    if (arch) {
      // dashed line on open edges > 24" between differently named rooms
      var drawnOpen = {};
      wallRooms.forEach(function (r) {
        r.edges.forEach(function (e) {
          if (e.diag) return;
          collinearOverlaps(e, wallRooms, r).forEach(function (cut) {
            var r2 = cut[2];
            if (cut[1] - cut[0] <= 24) return;
            if (lower(r.name) === lower(r2.name)) return;
            var key = [r.id, r2.id].sort().join('|') + ':' + e.horiz + ':' + e.c + ':' + cut[0] + ':' + cut[1];
            if (drawnOpen[key]) return; drawnOpen[key] = true;
            var p0 = e.horiz ? [cut[0], e.c] : [e.c, cut[0]], p1 = e.horiz ? [cut[1], e.c] : [e.c, cut[1]];
            L.outlines.push(line(p0[0], p0[1], p1[0], p1[1], C.openEdge, SW.openEdge, 'stroke-dasharray="3 3"'));
          });
        });
      });
      // room outlines minus shared edges
      wallRooms.forEach(function (r) {
        r.edges.forEach(function (e) {
          if (e.diag) { L.outlines.push(line(e.x0, e.y0, e.x1, e.y1, C.outline, SW.outline)); return; }
          var cuts = collinearOverlaps(e, wallRooms, r).map(function (c) { return [c[0], c[1]]; });
          subtractIntervals(e.a, e.b, cuts).forEach(function (seg) {
            var p0 = e.horiz ? [seg[0], e.c] : [e.c, seg[0]], p1 = e.horiz ? [seg[1], e.c] : [e.c, seg[1]];
            L.outlines.push(line(p0[0], p0[1], p1[0], p1[1], C.outline, SW.outline));
          });
        });
      });
      // footprint outlines minus the living/garage shared edge
      var fpZones = ['living', 'garage'].filter(function (k) { return zones[k]; }).map(function (k) { return zones[k]; });
      fpZones.forEach(function (z) {
        z.edges.forEach(function (e) {
          if (e.diag) { L.outlines.push(line(e.x0, e.y0, e.x1, e.y1, C.outline, SW.footOutline)); return; }
          var cuts = [];
          fpZones.forEach(function (z2) {
            if (z2 === z) return;
            z2.edges.forEach(function (e2) {
              if (e2.diag || e2.horiz !== e.horiz || Math.abs(e2.c - e.c) > 0.3) return;
              var a = Math.max(e.a, e2.a), b = Math.min(e.b, e2.b);
              if (b - a > 0.25) cuts.push([a, b]);
            });
          });
          subtractIntervals(e.a, e.b, cuts).forEach(function (seg) {
            var p0 = e.horiz ? [seg[0], e.c] : [e.c, seg[0]], p1 = e.horiz ? [seg[1], e.c] : [e.c, seg[1]];
            L.outlines.push(line(p0[0], p0[1], p1[0], p1[1], C.outline, SW.footOutline));
          });
        });
      });
    }

    // ---- doors -------------------------------------------------------------------
    var swingBoxes = [];
    var frontDoor = null, frontDoorScore = -1;
    var doorInfo = [];
    doors.forEach(function (d) {
      var band = wallBand(d.x, d.y, d.orient, d.w);
      var M = mapAP(d.orient);
      var a0 = d.orient === 'h' ? d.x : d.y;          // along-wall centre
      var c = (band.lo + band.hi) / 2;                 // wall centreline
      var half = d.w / 2;
      var pLo = M(a0, band.lo - 1.5), pHi = M(a0, band.hi + 1.5);
      var sideLo = classify(pLo[0], pLo[1]), sideHi = classify(pHi[0], pHi[1]);
      var info = { d: d, band: band, sideLo: sideLo, sideHi: sideHi, c: c, a0: a0, M: M };
      doorInfo.push(info);

      // opening fill colour: interior room side if any
      var roomSide = sideLo.type === 'room' && !isExteriorSide(sideLo) ? sideLo : sideHi.type === 'room' && !isExteriorSide(sideHi) ? sideHi : (sideLo.type === 'room' ? sideLo : sideHi);
      var openFill = arch ? C.room : (roomSide.type === 'room' ? fillForSpace(roomSide) : C.room);
      var r0 = M(a0 - half, band.lo - 0.3), r1 = M(a0 + half, band.hi + 0.3);
      var bandT = band.hi - band.lo;
      var isExt = isExteriorSide(sideLo) || isExteriorSide(sideHi);

      if (d.kind === 'overhead') {
        L.openings.push(rect(Math.min(r0[0], r1[0]), Math.min(r0[1], r1[1]), Math.abs(r1[0] - r0[0]), Math.abs(r1[1] - r0[1]), 'fill="' + openFill + '" ' + crisp));
        // exterior face = side that is outside
        var outAtHi = isExteriorSide(sideHi) && !isExteriorSide(sideLo) ? true : (isExteriorSide(sideLo) && !isExteriorSide(sideHi) ? false : true);
        var face = outAtHi ? band.hi : band.lo;
        var inner = outAtHi ? band.lo : band.hi;
        var inw = outAtHi ? -1 : 1;
        var q0 = M(a0 - half, face), q1 = M(a0 + half, face);
        L.doors.push(line(q0[0], q0[1], q1[0], q1[1], C.door, SW.overhead));
        var e0 = M(a0 - half, inner + inw * 0.6), e1 = M(a0 + half, inner + inw * 0.6);
        L.doors.push(line(e0[0], e0[1], e1[0], e1[1], C.door, SW.outline));
        var dp0 = M(a0 - half + 2, inner + inw * 5), dp1 = M(a0 + half - 2, inner + inw * 5);
        L.doors.push(line(dp0[0], dp0[1], dp1[0], dp1[1], C.door, SW.outline, 'stroke-dasharray="4 2.5"'));
        // jambs
        [a0 - half, a0 + half].forEach(function (aa) {
          var j0 = M(aa, band.lo - 0.3), j1 = M(aa, band.hi + 0.3);
          L.openings.push(line(j0[0], j0[1], j1[0], j1[1], C.door, SW.jamb));
        });
        if (showDoorLabels) {
          var lt = d.label || (fmtFt(d.w, 'plain').replace(/"$/, '') + ' O.H. DOOR');
          var tp = M(a0, face + (outAtHi ? 1 : -1) * 7);
          L.annot.push(textEl(tp[0], tp[1] + 1.2, lt.toUpperCase(), 3.4, { fill: C.text, rotate: d.orient === 'v' ? -90 : 0 }));
        }
        return;
      }

      // generic opening: punch the wall band
      L.openings.push(rect(Math.min(r0[0], r1[0]), Math.min(r0[1], r1[1]), Math.abs(r1[0] - r0[0]), Math.abs(r1[1] - r0[1]), 'fill="' + openFill + '" ' + crisp));
      [a0 - half, a0 + half].forEach(function (aa) {
        var j0 = M(aa, band.lo - 0.3), j1 = M(aa, band.hi + 0.3);
        L.openings.push(line(j0[0], j0[1], j1[0], j1[1], C.door, SW.jamb));
      });

      var s = d.swing;  // +1 => toward +perp
      var leafSt = C.door, leafW = SW.door;
      function leaf(hingeA, len, dir) { // dir: +1 => leaf toward +perp
        var h0 = M(hingeA, c), t = M(hingeA, c + dir * len);
        return { h: h0, t: t, str: line(h0[0], h0[1], t[0], t[1], leafSt, leafW, d.kind === 'french' ? 'stroke-linecap="square"' : '') };
      }
      function arc(hinge, tip, closed, r) {
        var ux = tip[0] - hinge[0], uy = tip[1] - hinge[1], vx = closed[0] - hinge[0], vy = closed[1] - hinge[1];
        var cross = ux * vy - uy * vx;
        var sweep = cross > 0 ? 1 : 0;
        return '<path d="M' + f(tip[0]) + ' ' + f(tip[1]) + 'A' + f(r) + ' ' + f(r) + ' 0 0 ' + sweep + ' ' + f(closed[0]) + ' ' + f(closed[1]) +
          '" fill="none" stroke="' + C.doorArc + '" stroke-width="' + f(SW.arc) + '"/>';
      }
      function swingBox(hinge, tip, closed) {
        var xs = [hinge[0], tip[0], closed[0]], ys = [hinge[1], tip[1], closed[1]];
        swingBoxes.push({ x0: Math.min.apply(null, xs), y0: Math.min.apply(null, ys), x1: Math.max.apply(null, xs), y1: Math.max.apply(null, ys) });
      }

      var labelPos = null, labelRot = 0, labelBaselineDone = false;
      if (d.kind === 'double' || d.kind === 'french') {
        if (d.kind === 'french') leafW = SW.door * 1.7;
        var lenH = half;
        var lf1 = leaf(a0 - half, lenH, s), lf2 = leaf(a0 + half, lenH, s);
        var mid = M(a0, c);
        L.doors.push(lf1.str, lf2.str, arc(lf1.h, lf1.t, mid, lenH), arc(lf2.h, lf2.t, mid, lenH));
        swingBox(lf1.h, lf1.t, mid); swingBox(lf2.h, lf2.t, mid);
        var lp = M(a0, c + s * (lenH + 4));
        labelPos = lp; labelRot = d.orient === 'v' ? -90 : 0;
      } else if (d.kind === 'bifold') {
        var q = half / 2; // quarter width
        var dep = q * 0.9;
        var pts1 = [M(a0 - half, c), M(a0 - half + q / 2, c + s * dep), M(a0 - half + q, c)];
        var pts2 = [M(a0 + half, c), M(a0 + half - q / 2, c + s * dep), M(a0 + half - q, c)];
        [pts1, pts2].forEach(function (pts) {
          L.doors.push('<polyline points="' + pts.map(function (p) { return f(p[0]) + ',' + f(p[1]); }).join(' ') + '" fill="none" stroke="' + C.door + '" stroke-width="' + f(SW.door) + '"/>');
        });
        // second zigzag for a 4-panel look
        var pts3 = [M(a0 - half + q, c), M(a0 - half + q + q / 2, c + s * dep), M(a0 - half + 2 * q, c)];
        var pts4 = [M(a0 + half - q, c), M(a0 + half - q - q / 2, c + s * dep), M(a0 + half - 2 * q, c)];
        [pts3, pts4].forEach(function (pts) {
          L.doors.push('<polyline points="' + pts.map(function (p) { return f(p[0]) + ',' + f(p[1]); }).join(' ') + '" fill="none" stroke="' + C.door + '" stroke-width="' + f(SW.door * 0.8) + '"/>');
        });
        labelPos = M(a0, c + s * (dep + 4)); labelRot = d.orient === 'v' ? -90 : 0;
      } else if (d.kind === 'pocket') {
        var pocketDir = d.hinge === 'left' ? -1 : 1; // pocket in the wall on the hinge side
        var jamb = a0 + pocketDir * half;
        // clamp the pocket to the wall material that actually exists beyond the jamb
        var pkLen = d.w;
        for (var pt = 1; pt <= d.w; pt += 1) {
          var pp = M(jamb + pocketDir * pt, c);
          if (!isWallAt(pp[0], pp[1])) { pkLen = pt - 1; break; }
        }
        if (pkLen < 4) pkLen = d.w;
        var pk0 = M(jamb, c), pk1 = M(jamb + pocketDir * pkLen, c);
        L.doors.push(line(pk0[0], pk0[1], pk1[0], pk1[1], C.door, SW.door * 0.8, 'stroke-dasharray="2.5 1.5"'));
        var pl0 = M(jamb, c), pl1 = M(jamb - pocketDir * d.w * 0.35, c);
        L.doors.push(line(pl0[0], pl0[1], pl1[0], pl1[1], C.door, SW.door));
        labelPos = M(a0, c + 5); labelRot = d.orient === 'v' ? -90 : 0;
      } else if (d.kind === 'sliding') {
        var t = Math.min(1.6, bandT / 3);
        var s0 = M(a0 - half, c - t - 0.2), s1 = M(a0 + 2, c - 0.2);
        var s2 = M(a0 - 2, c + 0.2), s3 = M(a0 + half, c + t + 0.2);
        L.doors.push(rect(Math.min(s0[0], s1[0]), Math.min(s0[1], s1[1]), Math.abs(s1[0] - s0[0]), Math.abs(s1[1] - s0[1]), 'fill="' + openFill + '" stroke="' + C.door + '" stroke-width="' + f(SW.door * 0.8) + '"'));
        L.doors.push(rect(Math.min(s2[0], s3[0]), Math.min(s2[1], s3[1]), Math.abs(s3[0] - s2[0]), Math.abs(s3[1] - s2[1]), 'fill="' + openFill + '" stroke="' + C.door + '" stroke-width="' + f(SW.door * 0.8) + '"'));
        labelPos = M(a0, c + 5); labelRot = d.orient === 'v' ? -90 : 0;
      } else if (d.kind === 'opening') {
        if (arch) {
          var o0 = M(a0 - half, c), o1 = M(a0 + half, c);
          L.doors.push(line(o0[0], o0[1], o1[0], o1[1], C.door, SW.outline, 'stroke-dasharray="3 2"'));
        }
        labelPos = M(a0, c + 6.5); labelRot = d.orient === 'v' ? -90 : 0;
      } else { // hinged (default)
        var hingeA = d.hinge === 'right' ? a0 + half : a0 - half;
        var closedA = d.hinge === 'right' ? a0 - half : a0 + half;
        var lf = leaf(hingeA, d.w, s);
        var closed = M(closedA, c);
        L.doors.push(lf.str, arc(lf.h, lf.t, closed, d.w));
        swingBox(lf.h, lf.t, closed);
        // label alongside the leaf, inside the swing (always open floor). Text runs along the
        // leaf; glyphs extend toward -along from the baseline, so offset the baseline accordingly.
        var sideSign = closedA > hingeA ? 1 : -1;
        var lblSize = 3.1;
        var alongPos = sideSign > 0 ? hingeA + 1.2 + 0.72 * lblSize : hingeA - 1.2;
        labelPos = M(alongPos, c + s * d.w / 2);
        labelRot = d.orient === 'h' ? -90 : 0;
        labelBaselineDone = true;
      }

      // door schedule code
      if (showDoorLabels && labelPos) {
        var code = doorCode(d);
        var lx = labelPos[0], ly = labelPos[1];
        if (!labelBaselineDone) { if (labelRot) lx += 1.1; else ly += 1.1; }
        if (code) L.annot.push(textEl(lx, ly, code, 3.1, { fill: C.text, rotate: labelRot }));
      }

      // front-door candidate (presentation entry marker)
      if (isExt && (d.kind === 'hinged' || d.kind === 'double' || d.kind === 'french')) {
        var other = isExteriorSide(sideLo) ? sideHi : sideLo;
        if (other.type === 'room' && other.room.zone === 'living') {
          var score = 1;
          var lab = lower(d.label);
          if (lab.indexOf('front') >= 0 || lab.indexOf('entry') >= 0) score += 10;
          if (d.id === '2' || lower(d.id) === 'front') score += 5;
          var extCls = isExteriorSide(sideLo) ? sideLo : sideHi;
          if (extCls.type === 'slab' && extCls.zone === 'porch' || (extCls.type === 'room' && extCls.room.zone === 'porch')) score += 3;
          if (score > frontDoorScore) { frontDoorScore = score; frontDoor = { info: info, extAtHi: isExteriorSide(sideHi) }; }
        }
      }
    });

    function doorCode(d) {
      var m = /(?:\b(PR)\s*)?\b(\d{4})\b/i.exec(d.label || '');
      var code;
      if (m) code = (m[1] ? 'PR ' : '') + m[2];
      else {
        var leafW = (d.kind === 'double' || d.kind === 'french') ? d.w / 2 : d.w;
        var ft = Math.floor(leafW / 12), inch = Math.round(leafW - ft * 12);
        if (inch === 12) { ft += 1; inch = 0; }
        // door code = width feet, width inches, height 6'-8" -> 3'-0" = 3068, 2'-8" = 2868, 2'-10" = 21068
        code = ((d.kind === 'double' || d.kind === 'french') ? 'PR ' : '') + ft + inch + '68';
      }
      if (d.kind === 'opening') code += ' C.O.';
      if (d.kind === 'pocket') code += ' PKT';
      if (d.kind === 'bifold') code += ' B.F.';
      if (d.kind === 'sliding') code += ' SLDR';
      return code;
    }

    // ---- windows ----------------------------------------------------------------
    windows.forEach(function (w) {
      var band = wallBand(w.x, w.y, w.orient, w.w);
      var M = mapAP(w.orient);
      var a0 = w.orient === 'h' ? w.x : w.y;
      var half = w.w / 2;
      var c = (band.lo + band.hi) / 2;
      var r0 = M(a0 - half, band.lo - 0.3), r1 = M(a0 + half, band.hi + 0.3);
      L.openings.push(rect(Math.min(r0[0], r1[0]), Math.min(r0[1], r1[1]), Math.abs(r1[0] - r0[0]), Math.abs(r1[1] - r0[1]), 'fill="#ffffff" ' + crisp));
      var gap = Math.min(1.1, (band.hi - band.lo) / 5);
      [c - gap, c + gap].forEach(function (pc) {
        var l0 = M(a0 - half, pc), l1 = M(a0 + half, pc);
        L.openings.push(line(l0[0], l0[1], l1[0], l1[1], C.window, SW.window));
      });
      [a0 - half, a0 + half].forEach(function (aa) {
        var j0 = M(aa, band.lo - 0.3), j1 = M(aa, band.hi + 0.3);
        L.openings.push(line(j0[0], j0[1], j1[0], j1[1], C.window, SW.jamb));
      });
      if (showWindowMarks && w.mark) {
        var pLo = M(a0, band.lo - 1.5), pHi = M(a0, band.hi + 1.5);
        var outHi = isExteriorSide(classify(pHi[0], pHi[1]));
        var outLo = isExteriorSide(classify(pLo[0], pLo[1]));
        var dir = outHi && !outLo ? 1 : (outLo && !outHi ? -1 : 1);
        var face = dir > 0 ? band.hi : band.lo;
        var mp = M(a0, face + dir * 11);
        L.annot.push(circle(mp[0], mp[1], 4.6, 'fill="#ffffff" stroke="' + C.text + '" stroke-width="0.35"'));
        L.annot.push(textEl(mp[0], mp[1] + 1.55, w.mark, 4.4, { fill: C.text, weight: 600 }));
      }
    });

    // ---- fixtures ---------------------------------------------------------------
    var fixtureBoxes = [];
    fixtures.forEach(function (fx) {
      var box = { x0: fx.x, y0: fx.y, x1: fx.x + fx.w, y1: fx.y + fx.h, kind: fx.kind };
      fixtureBoxes.push(box);
      if (!showFixtures) return;
      var cx = fx.x + fx.w / 2, cy = fx.y + fx.h / 2;
      var swap = fx.rot === 90 || fx.rot === 270;
      var lw = swap ? fx.h : fx.w, lh = swap ? fx.w : fx.h;
      L.fixtures.push('<g transform="translate(' + f(cx) + ' ' + f(cy) + ') rotate(' + f(fx.rot) + ')">' +
        fixtureShapes(fx.kind, lw, lh, fx, C, fx.rot) + '</g>');
    });

    // ---- entry marker (presentation) --------------------------------------------
    var markerBoxes = [];
    if (!arch && frontDoor) {
      var fi = frontDoor.info, M2 = fi.M;
      var dir = frontDoor.extAtHi ? 1 : -1;
      var face = dir > 0 ? fi.band.hi : fi.band.lo;
      var tip = M2(fi.a0, face + dir * 3.5), b1 = M2(fi.a0 - 5, face + dir * 12.5), b2 = M2(fi.a0 + 5, face + dir * 12.5);
      L.annot.push('<polygon points="' + [tip, b1, b2].map(function (p) { return f(p[0]) + ',' + f(p[1]); }).join(' ') + '" fill="' + C.entry + '"/>');
      var tsz = 5;
      var tc = M2(fi.a0, face + dir * (12.5 + 2 + tsz * 0.6));
      var rot = fi.d.orient === 'v' ? -90 : 0;
      L.annot.push(textEl(tc[0], tc[1] + tsz * 0.35, 'Entry', tsz, { fill: C.entry, weight: 600, rotate: rot }));
      var mA = fi.a0, mP0 = face, mP1 = face + dir * (12.5 + 2 + tsz * 1.4);
      var m0 = M2(mA - Math.max(6, textW('Entry', tsz, 'bold') / 2 + 1), Math.min(mP0, mP1)), m1 = M2(mA + Math.max(6, textW('Entry', tsz, 'bold') / 2 + 1), Math.max(mP0, mP1));
      markerBoxes.push({ x0: Math.min(m0[0], m1[0]), y0: Math.min(m0[1], m1[1]), x1: Math.max(m0[0], m1[0]), y1: Math.max(m0[1], m1[1]) });
    }
    columns.forEach(function (c) { markerBoxes.push({ x0: c.x, y0: c.y, x1: c.x + c.size, y1: c.y + c.size }); });

    // ---- room labels --------------------------------------------------------------
    if (showLabels) rooms.forEach(function (r) { drawRoomLabel(r); });

    function drawRoomLabel(r) {
      if (r.label === false || !r.name) return;
      var small = r.area / 144 < 40 || Math.min(r.bbox.w, r.bbox.h) < 54;
      var dims = roomDims(r.poly);
      var dimStr = arch ? (dims.wFt + ' x ' + dims.dFt) : (fmtFt(dims.w, 'plain') + ' x ' + fmtFt(dims.d, 'plain'));
      var wantDims = Math.min(r.bbox.w, r.bbox.h) >= 30;
      var base = arch
        ? (small ? { name: 4.0, dims: 3.4, ceil: 3.0 } : { name: 5.0, dims: 4.2, ceil: 3.5 })
        : (small ? { name: 4.75, dims: 4.0, ceil: 0 } : { name: 6.25, dims: 5.0, ceil: 0 });
      var nameKind = arch ? 'upper' : 'bold';
      var nameText = arch ? r.name.toUpperCase() : r.name;
      var ceilText = arch && r.ceiling ? r.ceiling.toUpperCase() : '';
      var anchor = r.name_pos || polyCentroid(r.poly);
      if (!pointInPoly(anchor[0], anchor[1], r.poly)) anchor = [r.bbox.cx, r.bbox.cy];

      function buildLines(scale, split, withDims) {
        var lines = [];
        var nsz = base.name * scale, dsz = base.dims * scale, csz = base.ceil * scale;
        var nameParts = [nameText];
        if (split && nameText.indexOf(' ') > 0) {
          var words = nameText.split(' '), bestI = 1, bestDiff = Infinity;
          for (var i = 1; i < words.length; i++) {
            var l1 = words.slice(0, i).join(' ').length, l2 = words.slice(i).join(' ').length;
            if (Math.abs(l1 - l2) < bestDiff) { bestDiff = Math.abs(l1 - l2); bestI = i; }
          }
          nameParts = [words.slice(0, bestI).join(' '), words.slice(bestI).join(' ')];
        }
        nameParts.forEach(function (t) { lines.push({ t: t, size: nsz, kind: nameKind, role: 'name' }); });
        if (withDims && wantDims) lines.push({ t: dimStr, size: dsz, kind: 'normal', role: 'dims' });
        if (withDims && ceilText && csz > 0) lines.push({ t: ceilText, size: csz, kind: 'normal', role: 'ceil' });
        var w = 0, h = 0;
        lines.forEach(function (ln) {
          ln.w = ln.kind === 'upper' ? textW(ln.t, ln.size, 'bold', 0.3) : textW(ln.t, ln.size, ln.kind);
          if (ln.w > w) w = ln.w; h += ln.size * 1.28;
        });
        return { lines: lines, w: w, h: h };
      }
      function boxAt(cx, cy, blk) { return { x0: cx - blk.w / 2, y0: cy - blk.h / 2, x1: cx + blk.w / 2, y1: cy + blk.h / 2 }; }
      function fitsPoly(bx) { return rectInPoly(bx.x0 - 1, bx.y0 - 1, bx.x1 + 1, bx.y1 + 1, r.poly, r.edges); }
      var obstaclesT1 = fixtureBoxes.concat(swingBoxes, markerBoxes);
      var obstaclesT2 = fixtureBoxes.filter(function (b) { return b.kind !== 'counter' && b.kind !== 'closet_rod' && b.kind !== 'shelves'; }).concat(markerBoxes);
      function clear(bx, obs) { for (var i = 0; i < obs.length; i++) if (boxesOverlap(bx, obs[i], 0.5)) return false; return true; }
      function findPos(blk, obs) {
        // preferred anchors first
        var cands = [anchor];
        if (r.name_pos) cands.push(polyCentroid(r.poly));
        cands.push([r.bbox.cx, r.bbox.cy]);
        for (var i = 0; i < cands.length; i++) {
          var bx = boxAt(cands[i][0], cands[i][1], blk);
          if (fitsPoly(bx) && clear(bx, obs)) return cands[i];
        }
        // grid search, nearest to anchor
        var step = Math.max(2, Math.min(4, Math.min(r.bbox.w, r.bbox.h) / 12));
        var best = null, bestD = Infinity;
        for (var gx = r.bbox.x0 + blk.w / 2 + 1; gx <= r.bbox.x1 - blk.w / 2 - 1; gx += step) {
          for (var gy = r.bbox.y0 + blk.h / 2 + 1; gy <= r.bbox.y1 - blk.h / 2 - 1; gy += step) {
            var dx = gx - anchor[0], dy = gy - anchor[1], dd = dx * dx + dy * dy * 1.3;
            if (dd >= bestD) continue;
            var bx2 = boxAt(gx, gy, blk);
            if (fitsPoly(bx2) && clear(bx2, obs)) { best = [gx, gy]; bestD = dd; }
          }
        }
        return best;
      }

      var result = null;
      var tiers = [obstaclesT1, obstaclesT2, []];
      outer:
      for (var ti = 0; ti < tiers.length; ti++) {
        var scales = ti === 0 ? [1, 0.9, 0.82, 0.74] : ti === 1 ? [1, 0.9, 0.82] : [1, 0.9, 0.82, 0.74, 0.66, 0.58];
        for (var si = 0; si < scales.length; si++) {
          var blk = buildLines(scales[si], false, true);
          var pos = findPos(blk, tiers[ti]);
          if (pos) { result = { blk: blk, pos: pos }; break outer; }
          if (nameText.indexOf(' ') > 0) {
            var blk2 = buildLines(scales[si], true, true);
            var pos2 = findPos(blk2, tiers[ti]);
            if (pos2) { result = { blk: blk2, pos: pos2 }; break outer; }
          }
        }
      }
      if (!result) { // drop dims, shrink further
        var sc = [1, 0.85, 0.7, 0.58];
        for (var k = 0; k < sc.length && !result; k++) {
          var b3 = buildLines(sc[k], false, false);
          var p3 = findPos(b3, []);
          if (p3) result = { blk: b3, pos: p3 };
          else if (nameText.indexOf(' ') > 0) {
            var b4 = buildLines(sc[k], true, false);
            var p4 = findPos(b4, []);
            if (p4) result = { blk: b4, pos: p4 };
          }
        }
      }
      if (!result) result = { blk: buildLines(0.58, nameText.indexOf(' ') > 0, false), pos: anchor };

      var blk = result.blk, cx = result.pos[0], cy = result.pos[1];
      var y = cy - blk.h / 2;
      blk.lines.forEach(function (ln) {
        var baseline = y + ln.size * 1.0;
        var opts = { fill: C.text };
        if (ln.role === 'name') {
          if (arch) { opts.spacing = 0.3; opts.weight = 600; }
          else opts.weight = 600;
        } else if (ln.role === 'ceil') { opts.fill = C.text; opts.opacity = 0.85; }
        L.labels.push(textEl(cx, baseline, ln.t, ln.size, opts));
        if (arch && ln.role === 'name') {
          var uw = textW(ln.t, ln.size, 'bold', 0.3) - ln.size * 0.1;
          L.labels.push(line(cx - uw / 2, baseline + ln.size * 0.22, cx + uw / 2, baseline + ln.size * 0.22, C.text, 0.25));
        }
        y += ln.size * 1.28;
      });
    }

    // ---- dimension strings (architectural) ----------------------------------------
    var dimExtent = { top: hb.y0, bottom: hb.y1, left: hb.x0, right: hb.x1 };
    if (showDims) drawDimensions();

    /** Exterior edge pieces worth dimensioning: building (living+garage) edges minus shared
     *  intervals, plus slab (porch/stoop) edges that face away from the building. */
    function exposedFootprintEdges() {
      var bld = ['living', 'garage'].filter(function (k) { return zones[k]; }).map(function (k) { return zones[k]; });
      var slabs = ['porch', 'stoop'].filter(function (k) { return zones[k]; }).map(function (k) { return zones[k]; });
      var all = bld.concat(slabs);
      var pieces = [];
      all.forEach(function (z) {
        var isSlab = slabs.indexOf(z) >= 0;
        z.edges.forEach(function (e) {
          if (e.diag) return;
          var cuts = [];
          // building edges are trimmed only where they abut other building zones; slab edges wherever they abut anything
          (isSlab ? all : bld).forEach(function (z2) {
            if (z2 === z) return;
            z2.edges.forEach(function (e2) {
              if (e2.diag || e2.horiz !== e.horiz || Math.abs(e2.c - e.c) > 0.3) return;
              var a = Math.max(e.a, e2.a), b = Math.min(e.b, e2.b);
              if (b - a > 0.25) cuts.push([a, b]);
            });
          });
          subtractIntervals(e.a, e.b, cuts).forEach(function (seg) {
            pieces.push({ horiz: e.horiz, c: e.c, a: seg[0], b: seg[1], out: e.out, slab: isSlab, zone: z });
          });
        });
      });
      // overall extents including slabs
      var ext = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
      all.forEach(function (z) { var b = z.bbox; ext.x0 = Math.min(ext.x0, b.x0); ext.y0 = Math.min(ext.y0, b.y0); ext.x1 = Math.max(ext.x1, b.x1); ext.y1 = Math.max(ext.y1, b.y1); });
      function hits(x, y, list, skip) {
        for (var i = 0; i < list.length; i++) if (list[i] !== skip && pointInPoly(x, y, list[i].poly)) return true;
        return false;
      }
      return pieces.filter(function (p) {
        var mid = (p.a + p.b) / 2;
        // outward walk: building pieces are occluded only by building; slab pieces by anything
        var occluders = p.slab ? all : bld;
        var limit = p.horiz ? (p.out > 0 ? ext.y1 : ext.y0) : (p.out > 0 ? ext.x1 : ext.x0);
        for (var t = p.c + p.out * 1.5; p.out > 0 ? t < limit : t > limit; t += p.out * 3) {
          if (hits(p.horiz ? mid : t, p.horiz ? t : mid, occluders, p.zone)) return false;
        }
        if (p.slab) { // inward walk must reach the building
          var lim2 = p.horiz ? (p.out > 0 ? ext.y0 : ext.y1) : (p.out > 0 ? ext.x0 : ext.x1);
          var ok = false;
          for (var u = p.c - p.out * 1.5; p.out > 0 ? u > lim2 : u < lim2; u -= p.out * 3) {
            if (hits(p.horiz ? mid : u, p.horiz ? u : mid, bld, null)) { ok = true; break; }
          }
          if (!ok) return false;
        }
        return true;
      });
    }

    function drawDimensions() {
      var pieces = exposedFootprintEdges();
      if (!pieces.length) return;
      var sides = [
        { name: 'top', horiz: true, out: -1 }, { name: 'bottom', horiz: true, out: 1 },
        { name: 'left', horiz: false, out: -1 }, { name: 'right', horiz: false, out: 1 }
      ];
      var fs = 3.9, off1 = 24, off2 = 20;
      sides.forEach(function (side) {
        var sp = pieces.filter(function (p) { return p.horiz === side.horiz && p.out === side.out; });
        if (!sp.length) return;
        var pts = {}; // coord -> {edgeC, corner}
        function addPt(v, edgeC, corner) {
          var key = null;
          Object.keys(pts).forEach(function (k) { if (Math.abs(Number(k) - v) <= 2) key = k; });
          if (key === null) { pts[v] = { edgeC: edgeC, corner: !!corner }; }
          else {
            var cur = pts[key];
            cur.edgeC = side.out > 0 ? Math.max(cur.edgeC, edgeC) : Math.min(cur.edgeC, edgeC);
            cur.corner = cur.corner || !!corner;
          }
        }
        function nearCorner(v) {
          return Object.keys(pts).some(function (k) { return pts[k].corner && Math.abs(Number(k) - v) <= 6; });
        }
        var extreme = side.out > 0 ? -Infinity : Infinity;
        // footprint corners first, then interior walls (skipped when they hug a corner)
        sp.forEach(function (p) {
          extreme = side.out > 0 ? Math.max(extreme, p.c) : Math.min(extreme, p.c);
          addPt(p.a, p.c, true); addPt(p.b, p.c, true);
        });
        sp.forEach(function (p) {
          if (p.slab) return; // slabs have no interior walls
          // interior walls meeting this exterior wall: sample 1" inside the exterior band
          var probe = p.c - side.out * (extT + 1);
          var runs = [], inRun = false, r0 = 0;
          for (var v = p.a + 0.25; v <= p.b - 0.25; v += 0.5) {
            var x = p.horiz ? v : probe, y = p.horiz ? probe : v;
            var w = isWallAt(x, y);
            if (w && !inRun) { inRun = true; r0 = v; }
            if (!w && inRun) { inRun = false; runs.push([r0, v - 0.5]); }
          }
          if (inRun) runs.push([r0, p.b - 0.25]);
          runs.forEach(function (run) {
            if (run[0] <= p.a + 1 || run[1] >= p.b - 1) return; // perpendicular exterior wall
            var len = run[1] - run[0];
            if (len <= 14) { var mv = (run[0] + run[1]) / 2; if (!nearCorner(mv)) addPt(mv, p.c); }
            else { if (!nearCorner(run[0])) addPt(run[0], p.c); if (!nearCorner(run[1])) addPt(run[1], p.c); }
          });
        });
        var coords = Object.keys(pts).map(Number).sort(function (a, b) { return a - b; });
        if (coords.length < 2) return;
        var lineC = extreme + side.out * off1;
        var overallC = lineC + side.out * off2;
        var textSide = side.horiz ? -1 : -1; // text above the line (reading direction) => -y for horizontal, -x for vertical
        function P(along, perp) { return side.horiz ? [along, perp] : [perp, along]; }
        // extension lines
        coords.forEach(function (v) {
          var e0 = P(v, pts[v].edgeC + side.out * 1.5), e1 = P(v, overallC + side.out * 3);
          L.dims.push(line(e0[0], e0[1], e1[0], e1[1], C.dimText, SW.ext));
        });
        // dimension line + ticks + text
        function dimRun(cs, lc) {
          var p0 = P(cs[0], lc), p1 = P(cs[cs.length - 1], lc);
          L.dims.push(line(p0[0], p0[1], p1[0], p1[1], C.dimText, SW.dim));
          cs.forEach(function (v) {
            var t = P(v, lc);
            L.dims.push(line(t[0] - 2.2, t[1] + 2.2, t[0] + 2.2, t[1] - 2.2, C.dimText, SW.tick));
          });
          for (var i = 0; i + 1 < cs.length; i++) {
            var len = cs[i + 1] - cs[i];
            var str = fmtFt(len);
            var tw = textW(str, fs, 'normal');
            var sz = fs;
            if (tw + 3 > len) sz = Math.max(fs * 0.6, fs * len / (tw + 3));
            var mid = (cs[i] + cs[i + 1]) / 2;
            var tp = P(mid, lc + textSide * 1.6);
            L.dims.push(textEl(tp[0], tp[1], str, sz, { fill: C.dimText, rotate: side.horiz ? 0 : -90 }));
          }
        }
        dimRun(coords, lineC);
        if (coords.length > 2) dimRun([coords[0], coords[coords.length - 1]], overallC);
        else dimRun([coords[0], coords[coords.length - 1]], overallC);
        var reach = overallC + side.out * (fs + 4);
        if (side.name === 'top') dimExtent.top = Math.min(dimExtent.top, reach);
        if (side.name === 'bottom') dimExtent.bottom = Math.max(dimExtent.bottom, reach);
        if (side.name === 'left') dimExtent.left = Math.min(dimExtent.left, reach);
        if (side.name === 'right') dimExtent.right = Math.max(dimExtent.right, reach);
      });
    }

    // ---- notes (architectural) ---------------------------------------------------------
    if (showNotes && Array.isArray(spec.notes)) {
      spec.notes.forEach(function (n) {
        if (!n || n.text == null || !isFinite(Number(n.x)) || !isFinite(Number(n.y))) return;
        L.annot.push(textEl(Number(n.x), Number(n.y), String(n.text).toUpperCase(), 3.4, { fill: C.text, anchor: n.anchor || 'start' }));
      });
    }

    // ---- viewBox --------------------------------------------------------------------------
    var vx0 = Math.min(bx0, dimExtent.left) - padIn, vy0 = Math.min(by0, dimExtent.top) - padIn;
    var vx1 = Math.max(bx1, dimExtent.right) + padIn, vy1 = Math.max(by1, dimExtent.bottom) + padIn;
    if (o.title && !arch) vy0 -= 10;
    var vw = vx1 - vx0, vh = vy1 - vy0;

    // ---- title / title block / FRONT -------------------------------------------------------
    if (arch) {
      var frontY = Math.max(by1, dimExtent.bottom) + 16;
      var frontX = (hb.x0 + hb.x1) / 2;
      L.annot.push(textEl(frontX, frontY, 'FRONT', 5, { fill: C.text, weight: 600, spacing: 1.5 }));
      L.annot.push(line(frontX - 22, frontY + 3, frontX + 22, frontY + 3, C.text, 0.35));
      // title block, bottom-left of the sheet
      var tbX = vx0 + 10, tbY = vy1 - 8;
      L.annot.push(textEl(tbX, tbY - 9, 'FLOOR PLAN', 8, { fill: C.title, weight: 700, anchor: 'start', spacing: 0.8 }));
      L.annot.push(line(tbX, tbY - 6.5, tbX + textW('FLOOR PLAN', 8, 'bold', 0.8), tbY - 6.5, C.title, 0.5));
      L.annot.push(textEl(tbX, tbY, 'SCALE: 1/4" = 1\'-0"', 4, { fill: C.title, anchor: 'start', spacing: 0.3 }));
      if (o.title) L.annot.push(textEl(tbX, tbY - 20, String(o.title).toUpperCase(), 4.4, { fill: C.title, anchor: 'start', spacing: 0.6 }));
      // area tabulation
      var tab = [];
      if (zones.living) tab.push(['LIVING AREA', Math.abs(polyArea(zones.living.poly)) / 144]);
      if (zones.garage) tab.push(['GARAGE', Math.abs(polyArea(zones.garage.poly)) / 144]);
      if (zones.porch) tab.push(['PORCH', Math.abs(polyArea(zones.porch.poly)) / 144]);
      if (tab.length) {
        var tot = tab.reduce(function (s, t) { return s + t[1]; }, 0);
        tab.push(['TOTAL UNDER ROOF', tot]);
        var tx = vx1 - 10, ty = vy1 - 8 - (tab.length - 1) * 5.2;
        tab.forEach(function (t, i) {
          var yy = ty + i * 5.2;
          L.annot.push(textEl(tx - 34, yy, t[0], 3.6, { fill: C.title, anchor: 'end', spacing: 0.3 }));
          L.annot.push(textEl(tx, yy, Math.round(t[1]).toLocaleString('en-US') + ' SF', 3.6, { fill: C.title, anchor: 'end', weight: i === tab.length - 1 ? 700 : 400 }));
        });
        L.annot.push(line(tx - 34 - textW('TOTAL UNDER ROOF', 3.6, 'normal', 0.3), ty + (tab.length - 2) * 5.2 + 1.8, tx, ty + (tab.length - 2) * 5.2 + 1.8, C.title, 0.3));
      }
    } else if (o.title) {
      L.annot.push(textEl((bx0 + bx1) / 2, vy0 + 14, String(o.title), 8, { fill: C.title, weight: 700 }));
    }

    // ---- assemble ---------------------------------------------------------------------------
    var W = Math.round(vw * ppi), H = Math.round(vh * ppi);
    var out = [];
    out.push('<svg xmlns="http://www.w3.org/2000/svg" version="1.1" width="' + W + '" height="' + H + '" viewBox="' +
      f(vx0) + ' ' + f(vy0) + ' ' + f(vw) + ' ' + f(vh) + '" font-family="' + FONT + '" data-floorplan="' + VERSION + '">');
    if (spec.name) out.push('<title>' + esc(spec.name) + '</title>');
    if (defs.length) out.push('<defs>' + defs.join('') + '</defs>');
    if (background && background !== 'transparent') out.push(rect(vx0, vy0, vw, vh, 'fill="' + background + '"'));
    ['walls', 'floors', 'slabs', 'outlines', 'openings', 'fixtures', 'doors', 'labels', 'dims', 'annot'].forEach(function (k) {
      if (L[k].length) out.push('<g id="fp-' + k + '">' + L[k].join('') + '</g>');
    });
    out.push('</svg>');
    return out.join('\n');
  }

  return { renderSVG: renderSVG, roomDims: roomDims, fmtFt: fmtFt, version: VERSION };
}));
