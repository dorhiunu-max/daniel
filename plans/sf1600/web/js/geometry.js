/*  geometry.js — shared 3D model builder for the house-plan spec (see tools/SPEC_FORMAT.md
 *  and web/CONTRACTS.md).  Everything the elevations, roof plan and 3D view need is derived
 *  here from the spec alone, so the drawings always agree with each other.
 *
 *  UMD: attaches to window.HouseGeometry in a browser, module.exports under Node.
 *
 *    HouseGeometry.build(spec[, opts]) -> {
 *      walls:    [ { id, poly3, normal, zone, material, kind, side, a, b, len, z0, z1 } ],
 *      roofs:    [ { id, piece, poly3, normal, kind, slope, down, eaveZ, ridgeZ, edges, planeId, part, parts } ],
 *      roofsUnclipped: [ { id, piece, poly3, normal, kind, slope, down, eaveZ, ridgeZ, edges } ],
 *      openings: [ { kind, mark, label, x0, y0, x1, y1, z0, z1, wallId, orient, side, units, w, h, unitW, code, normal, id } ],
 *      bounds:   { minX, maxX, minY, maxY, maxZ },
 *      roofPieces: [ { id, kind, ridge, rect, eave, plate, eaveZ, ridgeZ, halfSpan, ridgeLine, ends, extent } ],
 *      porch:    { poly, z, columns } | null,
 *      plate, porchPlate, pitch, overhang,
 *      warnings: [ string ]
 *    }
 *    opts.clip        (default true)  — `roofs` holds only the VISIBLE part of every plane, clipped
 *                                       against the other pieces (valleys become polygon edges).
 *                                       With clip:false `roofs` === `roofsUnclipped`.
 *    opts.autoValley  (default true)  — an unlisted end whose eave line lies inside another piece
 *                                       and whose ridge runs into that roof becomes a valley end
 *                                       (planes run straight to the intersection, like the
 *                                       architect's roof plan) instead of a hip.
 *    HouseGeometry.decodeSize(label)      -> { code, unitW, unitH, units, w, h } | null
 *    HouseGeometry.sideOfNormal(nx, ny)   -> 'front' | 'rear' | 'left' | 'right'
 *    HouseGeometry.project([x,y,z], side) -> { u, v, depth }   (orthographic elevation coords)
 *    HouseGeometry.roofZ(model, x, y)     -> visible roof height at a plan point (or -Infinity)
 *    HouseGeometry.SIDES                  -> { front, rear, left, right } view frames
 *
 *  Units are inches.  Plan axes: +x right, +y toward the street (front), z up from the slab.
 *  Side naming as seen from outside: front = viewer at +y looking toward −y (garage on the
 *  left), rear = viewer at −y, left = viewer at −x, right = viewer at +x.
 *
 *  Walls (contract fields: id, poly3, normal, zone, material):
 *    kind 'wall'    — exterior face of footprint.living / footprint.garage, z 0 → plate.  The
 *                     segments the two polygons share are not exterior and are dropped.
 *    kind 'column'  — the four faces of each porch column box, z 0 → roof.porch_plate.
 *    kind 'gable'   — gable-end triangle above the plate for every end listed in a gable piece's
 *                     gable_ends (zone/material 'gable').
 *    kind 'closure' — siding panel from the plate up to the porch ceiling where an exterior wall
 *                     borders the porch slab (the porch plate is higher than the house plate).
 *  Every quad/triangle is wound counter-clockwise as seen from outside (first edge runs from the
 *  viewer's left to right along the bottom/eave).
 *
 *  Roofs: eave (fascia) at z = plate − overhang·pitch/12, ridge at eave + halfSpan·pitch/12 with
 *  halfSpan = half the eave dimension perpendicular to the ridge.  Ends of a piece along its ridge
 *  are 'hip' (triangle), 'gable' (rectangle runs out over the rake overhang; gable triangle in
 *  `walls`) or 'valley' (see autoValley).  `down` is the unit plan vector pointing down-slope,
 *  `normal` the true 3D unit normal.  `edges[i]` tags the edge poly3[i]→poly3[i+1]:
 *  'eave' | 'ridge' | 'hip' | 'rake' | 'valley' | 'seam' (coplanar with the neighbour, no crease)
 *  | 'under' (another roof's eave hangs above this edge) | 'internal' (split between two parts of
 *  the same plane) | 'cut' (end of an extended plane, normally buried).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) { module.exports = factory(); }
  else { root.HouseGeometry = factory(); }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var VERSION = '1.1.0';
  var EPS = 1e-6;
  var COLLINEAR_TOL = 0.01;   // inches — two edges on the same line
  var OPENING_TOL = 6;        // inches — an opening centre may sit this far off the wall line
  var OPENING_SPAN_TOL = 0.5; // inches — an opening may overhang its wall segment this much
  var MIN_AREA = 0.5;         // in² — clipping slivers smaller than this are dropped
  var Z_TOL = 0.05;           // inches — heights closer than this count as equal

  // View frames for the four elevations (as seen from outside):
  //   u = plan direction that runs to the viewer's RIGHT on the drawing,
  //   depth = plan direction toward the viewer (larger = nearer),
  //   normal = the outward wall normal that faces this viewer.
  var SIDES = {
    front: { normal: [0, 1], u: [1, 0], depth: [0, 1] },
    rear: { normal: [0, -1], u: [-1, 0], depth: [0, -1] },
    left: { normal: [-1, 0], u: [0, 1], depth: [-1, 0] },
    right: { normal: [1, 0], u: [0, -1], depth: [1, 0] }
  };
  var SIDE_NAMES = ['front', 'rear', 'left', 'right'];
  var DOWN = { front: [0, 1], rear: [0, -1], left: [-1, 0], right: [1, 0] };

  // ------------------------------------------------------------------ helpers
  function num(v, d) { var n = Number(v); return isFinite(n) ? n : d; }
  function r3(n) { return Math.round(n * 1000) / 1000; }
  function lower(s) { return String(s == null ? '' : s).toLowerCase(); }
  function hyp(a, b) { return Math.sqrt(a * a + b * b); }

  function cleanPoly(pts) {
    if (!Array.isArray(pts)) return null;
    var out = [];
    for (var i = 0; i < pts.length; i++) {
      var p = pts[i];
      if (!Array.isArray(p) || p.length < 2) continue;
      var x = Number(p[0]), y = Number(p[1]);
      if (!isFinite(x) || !isFinite(y)) continue;
      if (out.length && Math.abs(out[out.length - 1][0] - x) < EPS && Math.abs(out[out.length - 1][1] - y) < EPS) continue;
      out.push([x, y]);
    }
    if (out.length > 1 && Math.abs(out[0][0] - out[out.length - 1][0]) < EPS &&
        Math.abs(out[0][1] - out[out.length - 1][1]) < EPS) out.pop();
    return out.length >= 3 ? out : null;
  }

  function signedArea(poly) {
    var s = 0;
    for (var i = 0, n = poly.length; i < n; i++) {
      var a = poly[i], b = poly[(i + 1) % n];
      s += a[0] * b[1] - b[0] * a[1];
    }
    return s / 2;
  }

  function sideOfNormal(nx, ny) {
    if (Math.abs(nx) >= Math.abs(ny)) return nx > 0 ? 'right' : 'left';
    return ny > 0 ? 'front' : 'rear';
  }

  /** Orthographic projection of a plan point for one elevation: u right, v up (= z), depth toward viewer. */
  function project(p, side) {
    var f = SIDES[side] || SIDES.front;
    return {
      u: p[0] * f.u[0] + p[1] * f.u[1],
      v: p[2],
      depth: p[0] * f.depth[0] + p[1] * f.depth[1]
    };
  }

  /** Axis-aligned edges of a polygon with their outward unit normals. */
  function polyEdges(poly) {
    var area = signedArea(poly), sgn = area > 0 ? 1 : -1, n = poly.length, out = [];
    for (var i = 0; i < n; i++) {
      var a = poly[i], b = poly[(i + 1) % n];
      var dx = b[0] - a[0], dy = b[1] - a[1];
      var len = hyp(dx, dy);
      if (len < EPS) continue;
      var axis = Math.abs(dy) < EPS ? 'x' : (Math.abs(dx) < EPS ? 'y' : 'diag');
      out.push({ a: a, b: b, len: len, axis: axis, nx: r3(sgn * dy / len), ny: r3(-sgn * dx / len), index: i });
    }
    return out;
  }

  /** Remove from each edge of A every interval it shares (collinear, overlapping) with an edge of B. */
  function subtractShared(edgesA, edgesB) {
    var out = [];
    edgesA.forEach(function (e) {
      if (e.axis === 'diag') { out.push(e); return; }
      var k = e.axis === 'x' ? 1 : 0;      // constant coordinate
      var t = e.axis === 'x' ? 0 : 1;      // running coordinate
      var c = e.a[k];
      var lo = Math.min(e.a[t], e.b[t]), hi = Math.max(e.a[t], e.b[t]);
      var cuts = [];
      edgesB.forEach(function (f) {
        if (f.axis !== e.axis || Math.abs(f.a[k] - c) > COLLINEAR_TOL) return;
        var flo = Math.min(f.a[t], f.b[t]), fhi = Math.max(f.a[t], f.b[t]);
        var s = Math.max(lo, flo), q = Math.min(hi, fhi);
        if (q - s > COLLINEAR_TOL) cuts.push([s, q]);
      });
      cuts.sort(function (p, q) { return p[0] - q[0]; });
      var keep = [], cur = lo;
      cuts.forEach(function (cv) {
        if (cv[0] > cur + COLLINEAR_TOL) keep.push([cur, cv[0]]);
        cur = Math.max(cur, cv[1]);
      });
      if (hi > cur + COLLINEAR_TOL) keep.push([cur, hi]);
      keep.forEach(function (iv) {
        var a = e.a.slice(), b = e.b.slice();
        var forward = e.b[t] >= e.a[t];
        a[t] = forward ? iv[0] : iv[1];
        b[t] = forward ? iv[1] : iv[0];
        out.push({ a: a, b: b, len: iv[1] - iv[0], axis: e.axis, nx: e.nx, ny: e.ny, index: e.index });
      });
    });
    return out;
  }

  /** Order the segment so a→b runs toward the viewer's right for the side it faces. */
  function orientForSide(seg) {
    var side = sideOfNormal(seg.nx, seg.ny), u = SIDES[side].u;
    var d = (seg.b[0] - seg.a[0]) * u[0] + (seg.b[1] - seg.a[1]) * u[1];
    if (d < 0) { var tmp = seg.a; seg.a = seg.b; seg.b = tmp; }
    seg.side = side;
    return seg;
  }

  function wallQuad(seg, z0, z1) {
    return [
      [seg.a[0], seg.a[1], z0], [seg.b[0], seg.b[1], z0],
      [seg.b[0], seg.b[1], z1], [seg.a[0], seg.a[1], z1]
    ];
  }

  // ------------------------------------------------------------------ 2D convex polygon tools
  function dedupePoly(poly) {
    var out = [];
    for (var i = 0; i < poly.length; i++) {
      var p = poly[i], q = out[out.length - 1];
      if (q && Math.abs(q[0] - p[0]) < 1e-7 && Math.abs(q[1] - p[1]) < 1e-7) continue;
      out.push(p);
    }
    while (out.length > 1 && Math.abs(out[0][0] - out[out.length - 1][0]) < 1e-7 && Math.abs(out[0][1] - out[out.length - 1][1]) < 1e-7) out.pop();
    return out;
  }
  function dropCollinear(poly) {
    var out = [], n = poly.length;
    for (var i = 0; i < n; i++) {
      var a = poly[(i + n - 1) % n], b = poly[i], c = poly[(i + 1) % n];
      var ux = b[0] - a[0], uy = b[1] - a[1], vx = c[0] - b[0], vy = c[1] - b[1];
      var cr = ux * vy - uy * vx, l = hyp(ux, uy) * hyp(vx, vy);
      if (l < 1e-12 || Math.abs(cr / l) > 1e-6) out.push(b);
    }
    return out.length >= 3 ? out : poly;
  }
  /** Part of a convex polygon where a·x + b·y + c ≥ 0 (Sutherland–Hodgman); null when empty. */
  function clipHalf(poly, a, b, c) {
    var out = [], n = poly.length;
    for (var i = 0; i < n; i++) {
      var p = poly[i], q = poly[(i + 1) % n];
      var fp = a * p[0] + b * p[1] + c, fq = a * q[0] + b * q[1] + c;
      var pin = fp >= -1e-7, qin = fq >= -1e-7;
      if (pin) out.push(p);
      if (pin !== qin) { var t = fp / (fp - fq); out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]); }
    }
    out = dedupePoly(out);
    return out.length >= 3 && Math.abs(signedArea(out)) > MIN_AREA ? out : null;
  }
  /** Unit half-planes [a,b,c] (a·x+b·y+c ≥ 0 inside) whose intersection is the convex polygon. */
  function halfPlanesOf(poly) {
    var s = signedArea(poly) > 0 ? 1 : -1, hp = [], n = poly.length;
    for (var i = 0; i < n; i++) {
      var p = poly[i], q = poly[(i + 1) % n];
      var a = -(q[1] - p[1]) * s, b = (q[0] - p[0]) * s, len = hyp(a, b);
      if (len < 1e-9) continue;
      a /= len; b /= len;
      hp.push([a, b, -(a * p[0] + b * p[1])]);
    }
    return hp;
  }
  /** Q minus the convex region ∩hps, as a list of convex parts (Q unchanged if disjoint). */
  function convexDiff(Q, hps) {
    var inside = Q;
    for (var k = 0; k < hps.length && inside; k++) inside = clipHalf(inside, hps[k][0], hps[k][1], hps[k][2]);
    if (!inside) return [Q];
    var parts = [], cur = Q;
    for (var i = 0; i < hps.length && cur; i++) {
      var h = hps[i];
      var outside = clipHalf(cur, -h[0], -h[1], -h[2]);
      if (outside) parts.push(outside);
      cur = clipHalf(cur, h[0], h[1], h[2]);
    }
    return parts;
  }
  function convexHull(pts) {
    var P = pts.slice().sort(function (a, b) { return a[0] - b[0] || a[1] - b[1]; });
    if (P.length < 3) return P;
    function cr(o, a, b) { return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]); }
    var lo = [], up = [], i;
    for (i = 0; i < P.length; i++) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], P[i]) <= 1e-6) lo.pop(); lo.push(P[i]); }
    for (i = P.length - 1; i >= 0; i--) { while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], P[i]) <= 1e-6) up.pop(); up.push(P[i]); }
    lo.pop(); up.pop();
    return lo.concat(up);
  }
  /** Greedily merge convex parts of one plane whose union is convex (hull area = sum of areas). */
  function mergeParts(parts) {
    var changed = true;
    while (changed) {
      changed = false;
      for (var i = 0; i < parts.length && !changed; i++) {
        for (var j = i + 1; j < parts.length; j++) {
          var hull = convexHull(parts[i].concat(parts[j]));
          var ai = Math.abs(signedArea(parts[i])), aj = Math.abs(signedArea(parts[j])), ah = Math.abs(signedArea(hull));
          if (Math.abs(ah - ai - aj) < 1e-6 * (ai + aj) + 0.05) {
            if (signedArea(parts[i]) < 0) hull.reverse();
            parts[i] = hull; parts.splice(j, 1); changed = true; break;
          }
        }
      }
    }
    return parts.map(dropCollinear);
  }
  function pointInConvex(pt, poly, tol) {
    var s = signedArea(poly) > 0 ? 1 : -1, n = poly.length;
    for (var i = 0; i < n; i++) {
      var p = poly[i], q = poly[(i + 1) % n];
      var len = hyp(q[0] - p[0], q[1] - p[1]);
      if (len < 1e-9) continue;
      var d = ((q[0] - p[0]) * (pt[1] - p[1]) - (q[1] - p[1]) * (pt[0] - p[0])) * s / len;
      if (d < -tol) return false;
    }
    return true;
  }
  function bbox(poly) {
    var b = [Infinity, Infinity, -Infinity, -Infinity];
    poly.forEach(function (p) { if (p[0] < b[0]) b[0] = p[0]; if (p[1] < b[1]) b[1] = p[1]; if (p[0] > b[2]) b[2] = p[0]; if (p[1] > b[3]) b[3] = p[1]; });
    return b;
  }
  function pointOnSegment(pt, a, b, tol) {
    var dx = b[0] - a[0], dy = b[1] - a[1], len = hyp(dx, dy);
    if (len < 1e-9) return false;
    var t = ((pt[0] - a[0]) * dx + (pt[1] - a[1]) * dy) / (len * len);
    if (t < -tol / len || t > 1 + tol / len) return false;
    var d = Math.abs((pt[0] - a[0]) * dy - (pt[1] - a[1]) * dx) / len;
    return d <= tol;
  }

  // ------------------------------------------------------------------ labels → sizes
  var SIZE_RE = /(?:^|[^\d])(\d)(\d)(\d)(\d)(?![\d'"])/;
  var FEET_RE = /(\d+)\s*'\s*(?:-?\s*(\d+)\s*"?)?\s*[xX×]\s*(\d+)\s*'\s*(?:-?\s*(\d+)\s*"?)?/;
  var PAIR_RE = /^\s*(PR|PAIR|DBL|DOUBLE)\b/i;   // only a leading "PR 3050"; "3068 w/ 2-1060 sidelights" is one unit

  /**
   * Decode a schedule-style size label: "3050" → 36" × 60" per unit, "PR 3050" → two units
   * (w = 72), "2668" → 30" × 80", "16'x8'" → 192" × 96".  Returns null when nothing parses.
   */
  function decodeSize(label) {
    var s = String(label == null ? '' : label);
    var m = FEET_RE.exec(s);
    var units = PAIR_RE.test(s) ? 2 : 1;
    if (m) {
      var w = num(m[1], 0) * 12 + num(m[2], 0), h = num(m[3], 0) * 12 + num(m[4], 0);
      return { code: m[0].replace(/\s+/g, ''), unitW: w, unitH: h, units: units, w: w * units, h: h };
    }
    m = SIZE_RE.exec(s);
    if (m) {
      var uw = num(m[1], 0) * 12 + num(m[2], 0), uh = num(m[3], 0) * 12 + num(m[4], 0);
      if (uw > 0 && uh > 0) return { code: m[1] + m[2] + m[3] + m[4], unitW: uw, unitH: uh, units: units, w: uw * units, h: uh };
    }
    return null;
  }

  // ------------------------------------------------------------------ walls
  function buildWalls(spec, plate, porchPlate, warnings) {
    var living = cleanPoly(spec.footprint && spec.footprint.living);
    var garage = cleanPoly(spec.footprint && spec.footprint.garage);
    var porch = cleanPoly(spec.footprint && spec.footprint.porch);
    if (!living) warnings.push('footprint.living missing or invalid');
    var eL = living ? polyEdges(living) : [], eG = garage ? polyEdges(garage) : [];
    var extL = subtractShared(eL, eG), extG = subtractShared(eG, eL);
    var walls = [];

    function pushWalls(segs, zone) {
      segs.forEach(function (s) {
        if (s.axis === 'diag') warnings.push(zone + ' footprint has a non-rectilinear edge');
        orientForSide(s);
        walls.push({
          id: zone + '-' + s.index + '-' + s.side,
          poly3: wallQuad(s, 0, plate), normal: [s.nx, s.ny, 0],
          zone: zone, material: 'siding', kind: 'wall', side: s.side,
          a: s.a.slice(), b: s.b.slice(), len: r3(s.len), z0: 0, z1: plate
        });
      });
    }
    pushWalls(extL, 'living');
    pushWalls(extG, 'garage');
    // a footprint edge split by a shared stretch yields several exterior faces: keep ids unique
    var seen = {};
    walls.forEach(function (w) {
      if (seen[w.id] == null) { seen[w.id] = 0; return; }
      seen[w.id] += 1; w.id += '-' + seen[w.id];
    });

    // porch closure panels: exterior walls that border the porch slab rise to the porch ceiling
    if (porch && porchPlate > plate + EPS) {
      var eP = polyEdges(porch);
      walls.filter(function (w) { return w.kind === 'wall'; }).forEach(function (w) {
        var seg = { a: w.a, b: w.b, axis: Math.abs(w.a[1] - w.b[1]) < EPS ? 'x' : 'y', nx: w.normal[0], ny: w.normal[1], len: w.len, index: 0 };
        var kept = subtractShared([seg], eP);          // the part NOT bordering the porch
        var keptLen = kept.reduce(function (s, k) { return s + k.len; }, 0);
        if (w.len - keptLen < COLLINEAR_TOL) return;
        var t = seg.axis === 'x' ? 0 : 1;
        var lo = Math.min(w.a[t], w.b[t]), hi = Math.max(w.a[t], w.b[t]);
        var ivs = kept.map(function (k) { return [Math.min(k.a[t], k.b[t]), Math.max(k.a[t], k.b[t])]; }).sort(function (p, q) { return p[0] - q[0]; });
        var cur = lo, shared = [];
        ivs.forEach(function (iv) { if (iv[0] > cur + COLLINEAR_TOL) shared.push([cur, iv[0]]); cur = Math.max(cur, iv[1]); });
        if (hi > cur + COLLINEAR_TOL) shared.push([cur, hi]);
        shared.forEach(function (iv, i) {
          var a = w.a.slice(), b = w.b.slice();
          var forward = w.b[t] >= w.a[t];
          a[t] = forward ? iv[0] : iv[1]; b[t] = forward ? iv[1] : iv[0];
          var s2 = { a: a, b: b, nx: w.normal[0], ny: w.normal[1], len: iv[1] - iv[0] };
          walls.push({
            id: w.id + '-porch' + (shared.length > 1 ? i : ''),
            poly3: wallQuad(s2, plate, porchPlate), normal: [w.normal[0], w.normal[1], 0],
            zone: w.zone, material: 'siding', kind: 'closure', side: w.side,
            a: a, b: b, len: r3(s2.len), z0: plate, z1: porchPlate
          });
        });
      });
    }

    // porch columns: small square boxes, four faces each, up to the porch plate
    (Array.isArray(spec.porch_columns) ? spec.porch_columns : []).forEach(function (c, i) {
      var x = num(c.x, NaN), y = num(c.y, NaN), sz = num(c.size, 24);
      if (!isFinite(x) || !isFinite(y) || !(sz > 0)) { warnings.push('porch column ' + i + ' invalid'); return; }
      var box = [[x, y], [x + sz, y], [x + sz, y + sz], [x, y + sz]];
      polyEdges(box).forEach(function (s) {
        orientForSide(s);
        walls.push({
          id: 'col' + i + '-' + s.side,
          poly3: wallQuad(s, 0, porchPlate), normal: [s.nx, s.ny, 0],
          zone: 'porch_column', material: 'stone', kind: 'column', side: s.side,
          a: s.a.slice(), b: s.b.slice(), len: r3(s.len), z0: 0, z1: porchPlate, column: i
        });
      });
    });

    return { walls: walls, living: living, garage: garage, porch: porch };
  }

  // ------------------------------------------------------------------ roofs
  function slopeNormal(down, pitch) {
    var h = Math.sqrt(pitch * pitch + 144);
    return [down[0] * pitch / h, down[1] * pitch / h, 12 / h];
  }

  function buildRoofs(spec, plate, porchPlate, pitch, oh, opts, warnings) {
    var roof = spec.roof || {};
    var pieces = Array.isArray(roof.pieces) ? roof.pieces : [];
    var tan = pitch / 12;
    var autoValley = opts.autoValley !== false, clip = opts.clip !== false;
    var P = [];

    // ---- 1. base geometry of every piece
    pieces.forEach(function (pc, idx) {
      var id = pc.id != null ? String(pc.id) : 'piece' + idx;
      var rc = Array.isArray(pc.rect) ? pc.rect.map(function (v) { return num(v, NaN); }) : [];
      if (rc.length < 4 || rc.some(function (v) { return !isFinite(v); })) { warnings.push('roof piece ' + id + ': bad rect'); return; }
      var x0 = Math.min(rc[0], rc[2]), x1 = Math.max(rc[0], rc[2]);
      var y0 = Math.min(rc[1], rc[3]), y1 = Math.max(rc[1], rc[3]);
      var kind = lower(pc.kind) === 'gable' ? 'gable' : 'hip';
      var isPorch = /porch/i.test(id);
      var pl = num(pc.plate, isPorch ? porchPlate : plate);
      var eaveZ = pl - oh * tan;
      var eave = [x0 - oh, y0 - oh, x1 + oh, y1 + oh];
      var axis = pc.ridge === 'x' || pc.ridge === 'y' ? pc.ridge : ((eave[2] - eave[0]) >= (eave[3] - eave[1]) ? 'x' : 'y');
      var span = axis === 'x' ? eave[3] - eave[1] : eave[2] - eave[0];   // eave width perpendicular to the ridge
      var halfSpan = span / 2;
      var endNames = axis === 'x' ? ['left', 'right'] : ['rear', 'front'];
      var gableEnds = (Array.isArray(pc.gable_ends) ? pc.gable_ends : []).map(lower);
      if (kind === 'gable') gableEnds.forEach(function (g) { if (endNames.indexOf(g) < 0) warnings.push('roof piece ' + id + ': gable end "' + g + '" is not an end of a ridge along ' + axis); });
      var ends = endNames.map(function (nm) { return kind === 'gable' && gableEnds.indexOf(nm) >= 0 ? 'gable' : 'hip'; });
      if (pc.ends && typeof pc.ends === 'object') {                     // explicit override {rear:'valley'}
        endNames.forEach(function (nm, i) { var v = lower(pc.ends[nm]); if (v === 'hip' || v === 'gable' || v === 'valley') ends[i] = v; });
      }
      var lo = axis === 'x' ? eave[0] : eave[1], hi = axis === 'x' ? eave[2] : eave[3];
      P.push({
        index: idx, id: id, kind: kind, plate: pl, eaveZ: eaveZ, ridgeZ: eaveZ + halfSpan * tan,
        rect: [x0, y0, x1, y1], eave: eave, axis: axis, halfSpan: halfSpan,
        mid: axis === 'x' ? (eave[1] + eave[3]) / 2 : (eave[0] + eave[2]) / 2,
        endNames: endNames, ends: ends, lo: lo, hi: hi,
        ext: [lo, hi],
        ridge: [ends[0] === 'hip' ? lo + halfSpan : lo, ends[1] === 'hip' ? hi - halfSpan : hi],
        forced: [ends[0] === 'valley', ends[1] === 'valley']
      });
    });
    if (!P.length) warnings.push('roof.pieces is empty');

    // height of piece A's own (unextended) roof at a plan point, -Infinity outside it
    function baseZ(A, x, y) {
      var s = A.axis === 'x' ? y : x, t = A.axis === 'x' ? x : y;
      var s0 = A.axis === 'x' ? A.eave[1] : A.eave[0], s1 = A.axis === 'x' ? A.eave[3] : A.eave[2];
      if (s < s0 - 1e-9 || s > s1 + 1e-9 || t < A.lo - 1e-9 || t > A.hi + 1e-9) return -Infinity;
      var d = Math.min(s - s0, s1 - s);
      if (A.ends[0] === 'hip') d = Math.min(d, t - A.lo);
      if (A.ends[1] === 'hip') d = Math.min(d, A.hi - t);
      return A.eaveZ + d * tan;
    }

    // ---- 2. valley ends: an end inside another roof whose ridge runs into it
    P.forEach(function (B) {
      for (var e = 0; e < 2; e++) {
        if (B.ends[e] === 'gable') continue;
        if (B.ends[e] === 'hip' && !autoValley) continue;
        var tEnd = e === 0 ? B.lo : B.hi, dir = e === 0 ? -1 : 1;
        var ridgePt = function (t) { return B.axis === 'x' ? [t, B.mid] : [B.mid, t]; };
        var m = ridgePt(tEnd);
        var hosts = P.filter(function (A) {
          return A !== B && m[0] >= A.eave[0] - 1e-9 && m[0] <= A.eave[2] + 1e-9 && m[1] >= A.eave[1] - 1e-9 && m[1] <= A.eave[3] + 1e-9;
        });
        if (!hosts.length) { if (B.forced[e]) warnings.push('roof piece ' + B.id + ': ' + B.endNames[e] + ' end forced to valley but lies in no other piece'); continue; }
        var far = tEnd;
        hosts.forEach(function (A) {
          var b = B.axis === 'x' ? (dir < 0 ? A.eave[0] : A.eave[2]) : (dir < 0 ? A.eave[1] : A.eave[3]);
          far = dir < 0 ? Math.min(far, b) : Math.max(far, b);
        });
        var env = function (t) { var p = ridgePt(t), z = -Infinity; P.forEach(function (A) { if (A !== B) z = Math.max(z, baseZ(A, p[0], p[1])); }); return z; };
        var buried = function (t) { return env(t) >= B.ridgeZ - 1e-6; };
        var bisect = function (tb, tu) { for (var k = 0; k < 40; k++) { var tm = (tb + tu) / 2; if (buried(tm)) tb = tm; else tu = tm; } return (tb + tu) / 2; };
        var t, tPrev, found = false, tStar;
        if (buried(tEnd)) {
          // already buried at its own eave line: walk inward until the ridge emerges
          var inner = e === 0 ? B.hi : B.lo;
          tPrev = tEnd;
          for (t = tEnd - dir; dir < 0 ? t <= inner : t >= inner; t -= dir) { if (!buried(t)) { found = true; break; } tPrev = t; }
          if (!found) { warnings.push('roof piece ' + B.id + ' is entirely buried under other pieces'); continue; }
          tStar = bisect(tPrev, t);
        } else {
          tPrev = tEnd;
          for (t = tEnd + dir; dir < 0 ? t >= far : t <= far; t += dir) { if (buried(t)) { found = true; break; } tPrev = t; }
          if (!found) { if (B.forced[e]) warnings.push('roof piece ' + B.id + ': ' + B.endNames[e] + ' end never meets the other roof; hipped'); B.ends[e] = 'hip'; continue; }
          tStar = bisect(t, tPrev);
          B.ext[e] = tStar;                       // planes run out to the intersection
        }
        B.ends[e] = 'valley';
        B.ridge[e] = tStar;
      }
      if (B.ridge[1] < B.ridge[0] - 1e-9) {
        warnings.push('roof piece ' + B.id + ': ridge along ' + B.axis + ' is shorter than its hips need; collapsed to a point');
        B.ridge[0] = B.ridge[1] = (B.ridge[0] + B.ridge[1]) / 2;
      }
    });

    // ---- 3. unclipped planes (with per-edge tags) and gable-end triangles
    var planes = [], gables = [];
    var END_TAG = { hip: 'hip', gable: 'rake', valley: 'cut' };
    P.forEach(function (B) {
      var ev = B.eave, mid = B.mid, ridgeZ = B.ridgeZ, eaveZ = B.eaveZ;
      // ridge-end coordinate used by the trapezoid's slanted/cut edge at each end
      var R = [B.ends[0] === 'hip' ? B.ridge[0] : B.ext[0], B.ends[1] === 'hip' ? B.ridge[1] : B.ext[1]];
      var tags = [END_TAG[B.ends[0]], END_TAG[B.ends[1]]];
      function plane(slope, pts, edgeTags, isEnd, ridgePt) {
        var down = DOWN[slope];
        var label = (B.kind === 'gable' && !isEnd) ? 'gable-' + slope : slope;
        planes.push({
          id: B.id + '-' + label, piece: B.id, pieceIndex: B.index, kind: B.kind, slope: label, down: down,
          normal: slopeNormal(down, pitch), eaveZ: r3(eaveZ), ridgeZ: r3(ridgeZ),
          xy: pts, edges: edgeTags,
          gx: -tan * down[0], gy: -tan * down[1], c: ridgeZ + tan * (down[0] * ridgePt[0] + down[1] * ridgePt[1])
        });
      }
      function gableWall(side, pts3) {
        var n = SIDES[side].normal;
        gables.push({
          id: 'gable-' + B.id + '-' + side, poly3: pts3, normal: [n[0], n[1], 0],
          zone: 'gable', material: 'gable', kind: 'gable', side: side, piece: B.id, z0: B.plate, z1: r3(ridgeZ)
        });
      }
      var rc = B.rect, fmid = mid;
      if (B.axis === 'x') {
        plane('front', [[B.ext[0], ev[3]], [B.ext[1], ev[3]], [R[1], mid], [R[0], mid]], ['eave', tags[1], 'ridge', tags[0]], false, [0, mid]);
        plane('rear', [[B.ext[1], ev[1]], [B.ext[0], ev[1]], [R[0], mid], [R[1], mid]], ['eave', tags[0], 'ridge', tags[1]], false, [0, mid]);
        if (B.ends[0] === 'hip') plane('left', [[B.lo, ev[1]], [B.lo, ev[3]], [R[0], mid]], ['eave', 'hip', 'hip'], true, [R[0], 0]);
        if (B.ends[1] === 'hip') plane('right', [[B.hi, ev[3]], [B.hi, ev[1]], [R[1], mid]], ['eave', 'hip', 'hip'], true, [R[1], 0]);
        if (B.ends[0] === 'gable') gableWall('left', [[rc[0], rc[1], B.plate], [rc[0], rc[3], B.plate], [rc[0], fmid, ridgeZ]]);
        if (B.ends[1] === 'gable') gableWall('right', [[rc[2], rc[3], B.plate], [rc[2], rc[1], B.plate], [rc[2], fmid, ridgeZ]]);
      } else {
        plane('left', [[ev[0], B.ext[0]], [ev[0], B.ext[1]], [mid, R[1]], [mid, R[0]]], ['eave', tags[1], 'ridge', tags[0]], false, [mid, 0]);
        plane('right', [[ev[2], B.ext[1]], [ev[2], B.ext[0]], [mid, R[0]], [mid, R[1]]], ['eave', tags[0], 'ridge', tags[1]], false, [mid, 0]);
        if (B.ends[0] === 'hip') plane('rear', [[ev[2], B.lo], [ev[0], B.lo], [mid, R[0]]], ['eave', 'hip', 'hip'], true, [0, R[0]]);
        if (B.ends[1] === 'hip') plane('front', [[ev[0], B.hi], [ev[2], B.hi], [mid, R[1]]], ['eave', 'hip', 'hip'], true, [0, R[1]]);
        if (B.ends[0] === 'gable') gableWall('rear', [[rc[2], rc[1], B.plate], [rc[0], rc[1], B.plate], [fmid, rc[1], ridgeZ]]);
        if (B.ends[1] === 'gable') gableWall('front', [[rc[0], rc[3], B.plate], [rc[2], rc[3], B.plate], [fmid, rc[3], ridgeZ]]);
      }
    });
    var zOf = function (pl, x, y) { return pl.gx * x + pl.gy * y + pl.c; };
    var lift = function (pl, xy) { return xy.map(function (p) { return [p[0], p[1], zOf(pl, p[0], p[1])]; }); };
    var unclipped = planes.map(function (pl) {
      return { id: pl.id, piece: pl.piece, poly3: lift(pl, pl.xy), normal: pl.normal, kind: pl.kind, slope: pl.slope, down: pl.down, eaveZ: pl.eaveZ, ridgeZ: pl.ridgeZ, edges: pl.edges.slice() };
    });

    // ---- 4. visibility: clip every plane against the planes of the other pieces
    var visible = [];   // { plane, xy }
    planes.forEach(function (pl) {
      var parts = [pl.xy];
      if (clip) {
        var pb = bbox(pl.xy);
        planes.forEach(function (q) {
          if (q.piece === pl.piece) return;
          var qb = bbox(q.xy);
          if (qb[0] > pb[2] || qb[2] < pb[0] || qb[1] > pb[3] || qb[3] < pb[1]) return;
          var dA = q.gx - pl.gx, dB = q.gy - pl.gy, dC = q.c - pl.c;
          var qFirst = q.pieceIndex < pl.pieceIndex;        // earlier piece wins a coplanar tie
          var hps = halfPlanesOf(q.xy);
          if (Math.abs(dA) < 1e-9 && Math.abs(dB) < 1e-9) {
            if (!(qFirst ? dC >= -Z_TOL : dC > Z_TOL)) return;   // parallel & below: hides nothing
          } else {
            var len = hyp(dA, dB);
            hps.push([dA / len, dB / len, (dC + (qFirst ? Z_TOL : -Z_TOL)) / len]);   // region where q is above pl
          }
          var next = [];
          parts.forEach(function (Q) { convexDiff(Q, hps).forEach(function (r) { next.push(r); }); });
          parts = next;
        });
        parts = mergeParts(parts);
      }
      parts.forEach(function (xy, k) { visible.push({ plane: pl, xy: xy, part: k, parts: parts.length }); });
    });

    // ---- 5. edge tags on the visible parts
    function partAt(pt, excludePlane) {
      for (var i = 0; i < visible.length; i++) {
        if (excludePlane && visible[i].plane === excludePlane) continue;
        if (pointInConvex(pt, visible[i].xy, 1e-6)) return visible[i];
      }
      return null;
    }
    visible.forEach(function (v) {
      var pl = v.plane, n = v.xy.length, tags = [];
      var s = signedArea(v.xy) > 0 ? 1 : -1;
      for (var i = 0; i < n; i++) {
        var p = v.xy[i], q = v.xy[(i + 1) % n];
        var zp = zOf(pl, p[0], p[1]), zq = zOf(pl, q[0], q[1]);
        var tag = null;
        if (Math.abs(zp - pl.ridgeZ) < Z_TOL && Math.abs(zq - pl.ridgeZ) < Z_TOL) tag = 'ridge';
        else if (Math.abs(zp - pl.eaveZ) < Z_TOL && Math.abs(zq - pl.eaveZ) < Z_TOL) tag = 'eave';
        else {
          for (var k = 0; k < pl.xy.length && !tag; k++) {
            var a = pl.xy[k], b = pl.xy[(k + 1) % pl.xy.length];
            if (pointOnSegment(p, a, b, 0.02) && pointOnSegment(q, a, b, 0.02)) tag = pl.edges[k];
          }
        }
        if (!tag || tag === 'cut') {
          // probe just outside the edge (outward normal of this part's boundary)
          var mx = (p[0] + q[0]) / 2, my = (p[1] + q[1]) / 2;
          var dx = q[0] - p[0], dy = q[1] - p[1], L = hyp(dx, dy) || 1;
          var ox = dy / L * s, oy = -dx / L * s;                 // outward for the part's winding
          var probe = [mx + ox * 0.3, my + oy * 0.3];
          var other = partAt(probe, null);
          if (!other) tag = tag || 'cut';
          else if (other.plane === pl) tag = 'internal';
          else {
            var dz = zOf(other.plane, probe[0], probe[1]) - zOf(pl, probe[0], probe[1]);
            if (Math.abs(dz) < 0.5) {
              var sameDir = Math.abs(other.plane.down[0] - pl.down[0]) < 1e-9 && Math.abs(other.plane.down[1] - pl.down[1]) < 1e-9;
              tag = sameDir ? 'seam' : 'valley';
            } else tag = dz > 0 ? 'under' : 'valley';
          }
        }
        tags.push(tag);
      }
      v.edges = tags;
    });

    var roofs = visible.map(function (v) {
      var pl = v.plane;
      return {
        id: pl.id + (v.parts > 1 ? '-' + v.part : ''), planeId: pl.id, piece: pl.piece, poly3: lift(pl, v.xy),
        normal: pl.normal, kind: pl.kind, slope: pl.slope, down: pl.down, eaveZ: pl.eaveZ, ridgeZ: pl.ridgeZ,
        edges: v.edges, part: v.part, parts: v.parts
      };
    });

    var summaries = P.map(function (B) {
      var endsObj = {}; endsObj[B.endNames[0]] = B.ends[0]; endsObj[B.endNames[1]] = B.ends[1];
      return {
        id: B.id, kind: B.kind, ridge: B.axis, rect: B.rect, eave: B.eave, plate: B.plate,
        eaveZ: r3(B.eaveZ), ridgeZ: r3(B.ridgeZ), halfSpan: B.halfSpan,
        ridgeLine: B.axis === 'x' ? [[r3(B.ridge[0]), B.mid], [r3(B.ridge[1]), B.mid]] : [[B.mid, r3(B.ridge[0])], [B.mid, r3(B.ridge[1])]],
        ends: endsObj, extent: [r3(B.ext[0]), r3(B.ext[1])]
      };
    });
    return { roofs: clip ? roofs : unclipped, roofsUnclipped: unclipped, gables: gables, pieces: summaries, planes: planes };
  }

  /** Visible roof height at a plan point from a built model (max over the unclipped planes). */
  function roofZ(model, x, y) {
    var z = -Infinity;
    (model.roofsUnclipped || []).forEach(function (r) {
      var xy = r.poly3.map(function (p) { return [p[0], p[1]]; });
      if (!pointInConvex([x, y], xy, 1e-6)) return;
      var v0 = r.poly3[0], n = r.normal;
      var zz = v0[2] - (n[0] * (x - v0[0]) + n[1] * (y - v0[1])) / n[2];
      if (zz > z) z = zz;
    });
    return z;
  }

  // ------------------------------------------------------------------ openings
  function findWall(walls, orient, x, y, halfW) {
    var axis = orient === 'v' ? 'y' : 'x';     // 'h' → wall runs along x
    var k = axis === 'x' ? 1 : 0, t = axis === 'x' ? 0 : 1;
    var c = axis === 'x' ? y : x, lo = (axis === 'x' ? x : y) - halfW, hi = (axis === 'x' ? x : y) + halfW;
    var best = null, bestScore = Infinity;
    walls.forEach(function (w) {
      if (w.kind !== 'wall') return;
      var wAxis = Math.abs(w.a[1] - w.b[1]) < EPS ? 'x' : 'y';
      if (wAxis !== axis) return;
      var dist = Math.abs(w.a[k] - c);
      if (dist > OPENING_TOL) return;
      var wlo = Math.min(w.a[t], w.b[t]), whi = Math.max(w.a[t], w.b[t]);
      var covers = lo >= wlo - OPENING_SPAN_TOL && hi <= whi + OPENING_SPAN_TOL;
      var overlap = Math.min(hi, whi) - Math.max(lo, wlo);
      if (overlap <= 0) return;
      var score = dist + (covers ? 0 : 1000);
      if (score < bestScore) { bestScore = score; best = { wall: w, covers: covers, dist: dist }; }
    });
    return best;
  }

  function buildOpenings(spec, walls, warnings) {
    var out = [];
    var elev = spec.elevations || {};
    var defaultHead = num(elev.header_height, 80);

    (Array.isArray(spec.windows) ? spec.windows : []).forEach(function (win, i) {
      var x = num(win.x, NaN), y = num(win.y, NaN), w = num(win.w, NaN);
      var orient = win.orient === 'v' ? 'v' : 'h';
      var label = win.label != null ? String(win.label) : '';
      var size = decodeSize(label);
      if (!isFinite(x) || !isFinite(y)) { warnings.push('window ' + (win.mark || i) + ': bad position'); return; }
      if (!isFinite(w) || w <= 0) w = size ? size.w : 36;
      var units = num(win.units, size ? size.units : 1);
      var h = num(win.height, size ? size.unitH : 60);
      if (!size && win.height == null) warnings.push('window ' + (win.mark || i) + ': cannot decode size from "' + label + '", assuming ' + h + '" tall');
      var head = num(win.head, defaultHead);
      var sill = num(win.sill, head - h);
      var m = findWall(walls, orient, x, y, w / 2);
      if (!m) { warnings.push('window ' + (win.mark || i) + ' at (' + x + ',' + y + ') is not on an exterior wall; skipped'); return; }
      if (!m.covers) warnings.push('window ' + (win.mark || i) + ' overhangs the end of wall ' + m.wall.id);
      out.push(makeOpening('window', win.mark, label, x, y, w, orient, sill, head, m.wall, units, size, null));
    });

    (Array.isArray(spec.doors) ? spec.doors : []).forEach(function (d, i) {
      var x = num(d.x, NaN), y = num(d.y, NaN), w = num(d.w, NaN);
      var orient = d.orient === 'v' ? 'v' : 'h';
      var label = d.label != null ? String(d.label) : '';
      var kind = lower(d.kind);
      if (!isFinite(x) || !isFinite(y)) { warnings.push('door ' + (d.id || i) + ': bad position'); return; }
      var size = decodeSize(label);
      var overhead = kind === 'overhead';
      if (!isFinite(w) || w <= 0) w = size ? size.w : (overhead ? 192 : 36);
      var m = findWall(walls, orient, x, y, w / 2);
      if (!m) return;                                    // interior door
      if (!m.covers) warnings.push('door ' + (d.id || i) + ' overhangs the end of wall ' + m.wall.id);
      var h = num(d.height, size ? size.unitH : (overhead ? 96 : 80));
      var head = num(d.head, h);
      var units = num(d.units, size ? size.units : (kind === 'double' || kind === 'french' ? 2 : 1));
      out.push(makeOpening(overhead ? 'garage' : 'door', d.mark != null ? d.mark : d.id, label, x, y, w, orient, 0, head, m.wall, units, size, d.id, kind));
    });
    return out;
  }

  function makeOpening(kind, mark, label, x, y, w, orient, z0, z1, wall, units, size, id, doorKind) {
    // snap onto the wall line (the spec places exterior openings on the footprint edge)
    var alongX = orient === 'h';
    if (alongX) y = wall.a[1]; else x = wall.a[0];
    var o = {
      kind: kind, mark: mark != null ? String(mark) : '', label: label,
      x0: alongX ? x - w / 2 : x, y0: alongX ? y : y - w / 2,
      x1: alongX ? x + w / 2 : x, y1: alongX ? y : y + w / 2,
      z0: r3(z0), z1: r3(z1), wallId: wall.id, orient: orient, side: wall.side, units: units,
      w: w, h: r3(z1 - z0), unitW: size ? size.unitW : w / units, code: size ? size.code : null,
      normal: wall.normal.slice()
    };
    if (id != null) o.id = String(id);
    if (doorKind) o.doorKind = doorKind;
    return o;
  }

  // ------------------------------------------------------------------ build
  function build(spec, opts) {
    spec = spec || {};
    opts = opts || {};
    var warnings = [];
    var roof = spec.roof || {};
    var plate = num(roof.plate, 109);
    var porchPlate = num(roof.porch_plate, plate);
    var pitch = num(roof.pitch, 6);
    var oh = num(roof.overhang, 18);

    var w = buildWalls(spec, plate, porchPlate, warnings);
    var r = buildRoofs(spec, plate, porchPlate, pitch, oh, opts, warnings);
    var walls = w.walls.concat(r.gables);
    var openings = buildOpenings(spec, walls, warnings);

    var b = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity, maxZ: 0 };
    function grow(p) {
      if (p[0] < b.minX) b.minX = p[0]; if (p[0] > b.maxX) b.maxX = p[0];
      if (p[1] < b.minY) b.minY = p[1]; if (p[1] > b.maxY) b.maxY = p[1];
      if (p[2] > b.maxZ) b.maxZ = p[2];
    }
    walls.forEach(function (f) { f.poly3.forEach(grow); });
    r.roofs.forEach(function (f) { f.poly3.forEach(grow); });
    if (!isFinite(b.minX)) b = { minX: 0, maxX: 0, minY: 0, maxY: 0, maxZ: 0 };
    b.maxZ = r3(b.maxZ);

    var porch = null;
    if (w.porch) {
      porch = { poly: w.porch, z: porchPlate, columns: (spec.porch_columns || []).map(function (c) { return { x: num(c.x, 0), y: num(c.y, 0), size: num(c.size, 24) }; }) };
    }

    return {
      walls: walls, roofs: r.roofs, roofsUnclipped: r.roofsUnclipped, openings: openings, bounds: b,
      roofPieces: r.pieces, porch: porch,
      plate: plate, porchPlate: porchPlate, pitch: pitch, overhang: oh,
      warnings: warnings
    };
  }

  return {
    VERSION: VERSION,
    SIDES: SIDES,
    SIDE_NAMES: SIDE_NAMES,
    build: build,
    decodeSize: decodeSize,
    sideOfNormal: sideOfNormal,
    project: project,
    roofZ: roofZ,
    signedArea: signedArea,
    cleanPoly: cleanPoly
  };
}));
