/*  model3d.js — interactive 3D exterior of the house from HouseGeometry (see web/CONTRACTS.md).
 *
 *    Model3D.mount(containerEl, spec, opts) -> handle
 *      opts: { view:'front-left'|'front-right'|'rear-right'|'rear-left'|'top', shadows:true, autoRotate:false, background:0xbfe0f5 }
 *      handle: { setView(name), resize(), dispose(), screenshot() -> dataURL, renderOnce(), scene, camera, renderer }
 *
 *  Requires the globals THREE (three.js r128) and THREE.OrbitControls loaded BEFORE this file, plus
 *  HouseGeometry.  Scene units are feet: scene x = plan x, scene z = plan y (street toward +z),
 *  scene y = height.  UMD: window.Model3D / module.exports (Node export is for bundling only).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) { module.exports = factory(root.THREE, typeof require === 'function' ? require('./geometry.js') : root.HouseGeometry); }
  else { root.Model3D = factory(root.THREE, root.HouseGeometry); }
}(typeof self !== 'undefined' ? self : this, function (THREE_, HG) {
  'use strict';
  var FT = 1 / 12;

  function needThree() {
    var T = THREE_ || (typeof THREE !== 'undefined' ? THREE : null);
    if (!T) throw new Error('Model3D: THREE (three.js r128) must be loaded before model3d.js');
    if (!T.OrbitControls) throw new Error('Model3D: THREE.OrbitControls must be loaded before model3d.js');
    return T;
  }

  // ---------------------------------------------------------------- procedural textures (1 canvas px = 1/64 ft)
  function canvasTex(T, wFt, hFt, draw) {
    var px = 64, c = document.createElement('canvas');
    c.width = Math.round(wFt * px); c.height = Math.round(hFt * px);
    var ctx = c.getContext('2d');
    draw(ctx, c.width, c.height, px);
    var t = new T.CanvasTexture(c);
    t.wrapS = t.wrapT = T.RepeatWrapping;
    t.anisotropy = 4; t.encoding = T.sRGBEncoding;
    t.repeat.set(1 / wFt, 1 / hFt); // UVs are in feet
    return t;
  }
  function makeTextures(T) {
    var tx = {};
    tx.siding = canvasTex(T, 4, 4, function (ctx, w, h, px) {
      ctx.fillStyle = '#e9e5dc'; ctx.fillRect(0, 0, w, h);
      for (var i = 0; i < w; i += 3) { ctx.fillStyle = (i % 6 === 0) ? 'rgba(0,0,0,0.025)' : 'rgba(255,255,255,0.03)'; ctx.fillRect(i, 0, 1, h); }
      for (var x = 0; x < w; x += px) { // batten every 12"
        ctx.fillStyle = '#cfc9bd'; ctx.fillRect(x, 0, px * 0.14, h);
        ctx.fillStyle = 'rgba(0,0,0,0.18)'; ctx.fillRect(x + px * 0.14, 0, 2, h);
        ctx.fillStyle = 'rgba(255,255,255,0.35)'; ctx.fillRect(x, 0, 1, h);
      }
    });
    tx.stone = canvasTex(T, 8, 4, function (ctx, w, h, px) {
      ctx.fillStyle = '#9b948a'; ctx.fillRect(0, 0, w, h); // mortar
      var courses = [[0, 0.7], [0.7, 0.55], [1.25, 0.75], [2.0, 0.6], [2.6, 0.7], [3.3, 0.7]];
      var seed = 7;
      function rnd() { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; }
      var tones = ['#d9d2c3', '#cfc6b4', '#c4b9a5', '#e0d9cb', '#b9ae9a', '#d3c9b6'];
      courses.forEach(function (cr, ci) {
        var y = cr[0] * px, hh = cr[1] * px, x = -rnd() * px;
        while (x < w) {
          var ww = (0.8 + rnd() * 1.4) * px;
          ctx.fillStyle = tones[Math.floor(rnd() * tones.length)];
          ctx.fillRect(x + 2, y + 2, ww - 4, hh - 4);
          ctx.fillStyle = 'rgba(255,255,255,0.18)'; ctx.fillRect(x + 2, y + 2, ww - 4, 2);
          ctx.fillStyle = 'rgba(0,0,0,0.12)'; ctx.fillRect(x + 2, y + hh - 4, ww - 4, 2);
          x += ww;
        }
      });
    });
    tx.shingle = canvasTex(T, 4, 2, function (ctx, w, h, px) {
      ctx.fillStyle = '#4a4744'; ctx.fillRect(0, 0, w, h);
      var course = px * 5 / 12, row = 0;
      for (var y = 0; y < h; y += course, row++) {
        var off = (row % 2) * px * 0.5;
        for (var x = -px; x < w + px; x += px) {
          var g = 0.92 + ((x * 7 + row * 13) % 11) / 90;
          ctx.fillStyle = 'rgb(' + Math.round(70 * g) + ',' + Math.round(66 * g) + ',' + Math.round(62 * g) + ')';
          ctx.fillRect(x + off, y, px - 1, course - 1.5);
          ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(x + off + px - 1.5, y, 1.5, course - 1.5);
        }
        ctx.fillStyle = 'rgba(0,0,0,0.45)'; ctx.fillRect(0, y + course - 1.5, w, 1.5);
      }
    });
    tx.garage = new T.CanvasTexture((function () {
      var c = document.createElement('canvas'); c.width = 1024; c.height = 512; var ctx = c.getContext('2d');
      ctx.fillStyle = '#f1efea'; ctx.fillRect(0, 0, c.width, c.height);
      var cols = 4, rows = 4, pw = c.width / cols, ph = c.height / rows;
      for (var r = 0; r < rows; r++) for (var k = 0; k < cols; k++) {
        var x = k * pw, y = r * ph;
        ctx.fillStyle = 'rgba(0,0,0,0.08)'; ctx.fillRect(x + 10, y + 10, pw - 20, ph - 20);
        ctx.fillStyle = '#e6e3dc'; ctx.fillRect(x + 22, y + 22, pw - 44, ph - 44);
        ctx.fillStyle = 'rgba(255,255,255,0.6)'; ctx.fillRect(x + 22, y + 22, pw - 44, 4);
        ctx.strokeStyle = 'rgba(0,0,0,0.25)'; ctx.lineWidth = 2; ctx.strokeRect(x + 10, y + 10, pw - 20, ph - 20);
      }
      for (var rr = 1; rr < rows; rr++) { ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fillRect(0, rr * ph - 1, c.width, 2); }
      return c;
    })()); tx.garage.encoding = T.sRGBEncoding;
    tx.door = new T.CanvasTexture((function () {
      var c = document.createElement('canvas'); c.width = 192; c.height = 416; var ctx = c.getContext('2d');
      ctx.fillStyle = '#3d4a58'; ctx.fillRect(0, 0, c.width, c.height);
      ctx.fillStyle = '#cfe0ea'; ctx.fillRect(28, 26, 136, 140); ctx.strokeStyle = '#1f2933'; ctx.lineWidth = 4; ctx.strokeRect(28, 26, 136, 140);
      ctx.strokeStyle = '#2b3744'; ctx.lineWidth = 3; ctx.strokeRect(28, 200, 136, 90); ctx.strokeRect(28, 310, 136, 80);
      ctx.fillStyle = '#c8a85a'; ctx.beginPath(); ctx.arc(170, 232, 6, 0, Math.PI * 2); ctx.fill();
      return c;
    })()); tx.door.encoding = T.sRGBEncoding;
    tx.concrete = canvasTex(T, 4, 4, function (ctx, w, h) {
      ctx.fillStyle = '#cfcdc6'; ctx.fillRect(0, 0, w, h);
      for (var i = 0; i < 600; i++) { ctx.fillStyle = 'rgba(0,0,0,' + (Math.random() * 0.06) + ')'; ctx.fillRect(Math.random() * w, Math.random() * h, 2, 2); }
      ctx.strokeStyle = 'rgba(0,0,0,0.25)'; ctx.lineWidth = 2; ctx.strokeRect(0, 0, w, h);
    });
    tx.grass = canvasTex(T, 8, 8, function (ctx, w, h) {
      ctx.fillStyle = '#6f9a5a'; ctx.fillRect(0, 0, w, h);
      for (var i = 0; i < 2500; i++) { ctx.fillStyle = 'rgba(' + (40 + Math.random() * 40) + ',' + (90 + Math.random() * 60) + ',' + (30 + Math.random() * 30) + ',0.35)'; ctx.fillRect(Math.random() * w, Math.random() * h, 3, 3); }
    });
    return tx;
  }

  // ---------------------------------------------------------------- geometry helpers
  function v3(T, p) { return new T.Vector3(p[0] * FT, p[2] * FT, p[1] * FT); } // plan [x,y,z] inches -> scene feet
  function polyMesh(T, poly3, material, uvFn) { // arbitrary planar polygon (convex or not)
    var n = poly3.length, N = normalOf(poly3);
    // choose projection axes for triangulation
    var ax = Math.abs(N[0]), ay = Math.abs(N[1]), az = Math.abs(N[2]);
    var pts2 = poly3.map(function (p) { if (az >= ax && az >= ay) return new T.Vector2(p[0], p[1]); if (ax >= ay) return new T.Vector2(p[1], p[2]); return new T.Vector2(p[0], p[2]); });
    var tris = T.ShapeUtils.triangulateShape(pts2, []);
    var pos = [], uv = [];
    tris.forEach(function (t) { t.forEach(function (i) { var p = poly3[i]; pos.push(p[0] * FT, p[2] * FT, p[1] * FT); var q = uvFn(p); uv.push(q[0], q[1]); }); });
    var g = new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
    g.computeVertexNormals();
    var m = new T.Mesh(g, material); m.castShadow = true; m.receiveShadow = true;
    return m;
  }
  function normalOf(poly3) { // Newell
    var nx = 0, ny = 0, nz = 0;
    for (var i = 0; i < poly3.length; i++) { var a = poly3[i], b = poly3[(i + 1) % poly3.length]; nx += (a[1] - b[1]) * (a[2] + b[2]); ny += (a[2] - b[2]) * (a[0] + b[0]); nz += (a[0] - b[0]) * (a[1] + b[1]); }
    var L = Math.hypot(nx, ny, nz) || 1; return [nx / L, ny / L, nz / L];
  }
  function boxBetween(T, a, b, height, thick, material, yBase) { // horizontal board along plan segment a->b (inches), yBase in inches
    var dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy); if (L < 0.5) return null;
    var g = new T.BoxGeometry(L * FT, height * FT, thick * FT);
    var m = new T.Mesh(g, material); m.castShadow = true; m.receiveShadow = true;
    m.position.set((a[0] + b[0]) / 2 * FT, (yBase + height / 2) * FT, (a[1] + b[1]) / 2 * FT);
    m.rotation.y = -Math.atan2(dy, dx);
    return m;
  }

  // ---------------------------------------------------------------- build the scene
  function buildHouse(T, spec, tx, shadows) {
    var g = HG.build(spec);
    var group = new T.Group();
    var DS = T.DoubleSide;
    var M = {
      siding: new T.MeshStandardMaterial({ map: tx.siding, roughness: 0.9, metalness: 0, side: DS }),
      stone: new T.MeshStandardMaterial({ map: tx.stone, roughness: 0.95, metalness: 0, side: DS }),
      shingle: new T.MeshStandardMaterial({ map: tx.shingle, roughness: 0.95, metalness: 0, side: T.DoubleSide }),
      trim: new T.MeshStandardMaterial({ color: 0xf5f4f0, roughness: 0.7 }),
      fascia: new T.MeshStandardMaterial({ color: 0xf2f1ed, roughness: 0.7 }),
      rowlock: new T.MeshStandardMaterial({ color: 0xa8705a, roughness: 0.9 }),
      glass: new T.MeshStandardMaterial({ color: 0x4f6f88, roughness: 0.12, metalness: 0.55, side: DS }),
      garage: new T.MeshStandardMaterial({ map: tx.garage, roughness: 0.6 }),
      door: new T.MeshStandardMaterial({ map: tx.door, roughness: 0.6 }),
      ceiling: new T.MeshStandardMaterial({ color: 0xf7f6f2, roughness: 0.9, side: T.DoubleSide }),
      concrete: new T.MeshStandardMaterial({ map: tx.concrete, roughness: 1, side: DS }),
      soffit: new T.MeshStandardMaterial({ color: 0xece9e2, roughness: 0.9, side: T.DoubleSide })
    };
    var wainscot = (spec.elevations && spec.elevations.wainscot_height) || 36;

    // walls
    g.walls.forEach(function (w) {
      if (w.kind === 'column') return; // built as boxes below
      var n = w.normal, along = [-n[1], n[0]]; // unit vector along the wall (plan)
      var uv = function (p) { return [(p[0] * along[0] + p[1] * along[1]) * FT, p[2] * FT]; };
      group.add(polyMesh(T, w.poly3, M.siding, uv));
      if (w.kind === 'wall' && w.z0 < wainscot) {
        // stone band 3/4" proud of the siding, from grade to the wainscot height, plus a rowlock cap
        var off = [n[0] * 0.75, n[1] * 0.75];
        var a = w.a, b = w.b;
        var band = [[a[0] + off[0], a[1] + off[1], 0], [b[0] + off[0], b[1] + off[1], 0], [b[0] + off[0], b[1] + off[1], wainscot], [a[0] + off[0], a[1] + off[1], wainscot]];
        group.add(polyMesh(T, band, M.stone, uv));
        var cap = boxBetween(T, [a[0] + n[0] * 1.2, a[1] + n[1] * 1.2], [b[0] + n[0] * 1.2, b[1] + n[1] * 1.2], 3.5, 4.4, M.rowlock, wainscot);
        if (cap) group.add(cap);
        // corner boards
        [a, b].forEach(function (pt) {
          var cb = new T.Mesh(new T.BoxGeometry(4 * FT, (w.z1 - wainscot - 3.5) * FT, 1 * FT), M.trim);
          cb.position.set((pt[0] + n[0] * 0.6 - along[0] * 0 ) * FT, ((w.z1 + wainscot + 3.5) / 2) * FT, (pt[1] + n[1] * 0.6) * FT);
          cb.rotation.y = -Math.atan2(along[1], along[0]);
          cb.castShadow = true; group.add(cb);
        });
      }
    });

    // porch columns, beam and ceiling
    if (g.porch && g.porch.columns) {
      var pz = g.porchPlate || 145;
      g.porch.columns.forEach(function (c) {
        var s = c.size || 24;
        var box = new T.Mesh(new T.BoxGeometry(s * FT, pz * FT, s * FT), M.stone);
        box.position.set((c.x + s / 2) * FT, pz / 2 * FT, (c.y + s / 2) * FT); box.castShadow = true; box.receiveShadow = true; group.add(box);
        var capb = new T.Mesh(new T.BoxGeometry((s + 4) * FT, 3 * FT, (s + 4) * FT), M.trim);
        capb.position.set((c.x + s / 2) * FT, (wainscot + 1.5) * FT, (c.y + s / 2) * FT); group.add(capb);
      });
      if (g.porch.poly && g.porch.poly.length >= 3) {
        var ceil = g.porch.poly.map(function (p) { return [p[0], p[1], pz]; });
        group.add(polyMesh(T, ceil, M.ceiling, function (p) { return [p[0] * FT, p[1] * FT]; }));
        // beam along the porch's street edge between column outer faces
        var xs = [], ys = [];
        g.porch.columns.forEach(function (c) { var s = c.size || 24; xs.push(c.x, c.x + s); ys.push(c.y, c.y + s); });
        var x0 = Math.min.apply(null, xs), x1 = Math.max.apply(null, xs), yFront = Math.max.apply(null, ys);
        var beam = boxBetween(T, [x0, yFront - 12], [x1, yFront - 12], 12, 24, M.trim, pz - 12);
        if (beam) group.add(beam);
      }
    }

    // roofs (clipped visible parts) + fascia on eaves/rakes
    g.roofs.forEach(function (r) {
      group.add(polyMesh(T, r.poly3, M.shingle, function (p) { return [p[0] * FT, p[1] * FT]; }));
      // 1.5" thick roof deck: a second polygon slightly below for the underside (soffit look at overhangs)
      var under = r.poly3.map(function (p) { return [p[0], p[1], p[2] - 6]; });
      group.add(polyMesh(T, under, M.soffit, function (p) { return [p[0] * FT, p[1] * FT]; }));
      (r.edges || []).forEach(function (tag, i) {
        if (tag !== 'eave' && tag !== 'rake') return;
        var a = r.poly3[i], b = r.poly3[(i + 1) % r.poly3.length];
        // fascia board follows the edge in 3D: build as a thin box between the two points
        var dx = (b[0] - a[0]) * FT, dz = (b[1] - a[1]) * FT, dy = (b[2] - a[2]) * FT, L = Math.hypot(dx, dy, dz); if (L < 0.05) return;
        var geo = new T.BoxGeometry(L, 8 * FT, 1.5 * FT);
        var m = new T.Mesh(geo, M.fascia); m.castShadow = true;
        m.position.set((a[0] + b[0]) / 2 * FT, ((a[2] + b[2]) / 2 - 3) * FT, (a[1] + b[1]) / 2 * FT);
        // orient: rotate so the box's x axis points from a to b
        var dir = new T.Vector3(dx, dy, dz).normalize();
        var q = new T.Quaternion().setFromUnitVectors(new T.Vector3(1, 0, 0), dir);
        m.quaternion.copy(q);
        // push slightly outward along the down-slope direction (edge is at the eave line)
        if (r.down) m.position.add(new T.Vector3(r.down[0], 0, r.down[1]).multiplyScalar(0.06));
        group.add(m);
      });
    });

    // openings
    g.openings.forEach(function (op) {
      var n = op.normal || [0, 1]; var along = [-n[1], n[0]];
      var cx = (op.x0 + op.x1) / 2, cy = (op.y0 + op.y1) / 2, w = Math.hypot(op.x1 - op.x0, op.y1 - op.y0), h = op.z1 - op.z0, zc = (op.z0 + op.z1) / 2;
      var rotY = -Math.atan2(along[1], along[0]);
      function slab(width, height, depth, mat, out, zmid) {
        var m = new T.Mesh(new T.BoxGeometry(width * FT, height * FT, depth * FT), mat);
        m.position.set((cx + n[0] * out) * FT, (zmid == null ? zc : zmid) * FT, (cy + n[1] * out) * FT); m.rotation.y = rotY; m.castShadow = true; m.receiveShadow = true;
        group.add(m); return m;
      }
      if (op.kind === 'garage') {
        slab(w + 6, h + 4, 2, M.trim, 3.2);
        slab(w, h, 1, M.garage, 4.4, zc);
      } else if (op.kind === 'door') {
        var pair = (op.units || 1) >= 2;
        slab(w + 6, h + 3, 2, M.trim, 3.2, zc + 1.5);
        if (pair) { // french doors: two glazed leaves
          for (var l = 0; l < 2; l++) {
            var off = (l === 0 ? -1 : 1) * (w / 4);
            var fr = new T.Mesh(new T.BoxGeometry((w / 2 - 0.5) * FT, (h - 1) * FT, 1.6 * FT), M.trim); // leaf
            fr.position.set((cx + along[0] * off + n[0] * 4.6) * FT, zc * FT, (cy + along[1] * off + n[1] * 4.6) * FT); fr.rotation.y = rotY; group.add(fr);
            var m = new T.Mesh(new T.BoxGeometry((w / 2 - 8) * FT, (h - 14) * FT, 0.6 * FT), M.glass); // 15-lite glass field
            m.position.set((cx + along[0] * off + n[0] * 5.6) * FT, (zc + 2) * FT, (cy + along[1] * off + n[1] * 5.6) * FT); m.rotation.y = rotY; group.add(m);
          }
        } else {
          slab(w, h, 1.75, M.door, 4.4, zc);
        }
      } else { // window
        slab(w + 5, h + 5, 2, M.trim, 3.2);
        var glass = slab(w - 1, h - 1, 0.5, M.glass, 4.5);
        var units = Math.max(1, op.units || 1);
        for (var k = 1; k < units; k++) { // mullions
          var mx = -w / 2 + k * (w / units);
          var mm = new T.Mesh(new T.BoxGeometry(2 * FT, h * FT, 1 * FT), M.trim);
          mm.position.set((cx + along[0] * mx + n[0] * 4.9) * FT, zc * FT, (cy + along[1] * mx + n[1] * 4.9) * FT); mm.rotation.y = rotY; group.add(mm);
        }
        var fixed = /fix|1060/i.test(op.label || '') || h <= 14;
        if (!fixed) { // meeting rail
          var rail = new T.Mesh(new T.BoxGeometry(w * FT, 1.8 * FT, 1 * FT), M.trim);
          rail.position.set((cx + n[0] * 4.9) * FT, zc * FT, (cy + n[1] * 4.9) * FT); rail.rotation.y = rotY; group.add(rail);
        }
        var sill = new T.Mesh(new T.BoxGeometry((w + 7) * FT, 2 * FT, 3 * FT), M.trim);
        sill.position.set((cx + n[0] * 3.4) * FT, (op.z0 - 1) * FT, (cy + n[1] * 3.4) * FT); sill.rotation.y = rotY; group.add(sill);
      }
    });

    // slabs: porch, stoop, driveway (from garage door to +y), walk (porch to drive)
    var fp = spec.footprint || {};
    function slabPoly(poly, thick) { if (!poly) return; var pts = poly.map(function (p) { return [p[0], p[1], thick]; }); var m = polyMesh(T, pts, M.concrete, function (p) { return [p[0] * FT, p[1] * FT]; }); m.castShadow = false; group.add(m); }
    slabPoly(fp.porch, 4); slabPoly(fp.stoop, 4);
    var gd = g.openings.filter(function (o) { return o.kind === 'garage'; })[0];
    var b = g.bounds, streetY = b.maxY + 12 * 30; // 30 ft of driveway beyond the house bounds
    if (gd) {
      var x0 = Math.min(gd.x0, gd.x1) - 12, x1 = Math.max(gd.x0, gd.x1) + 12, y0 = Math.max(gd.y0, gd.y1);
      slabPoly([[x0, y0], [x1, y0], [x1 + 36, streetY], [x0 - 36, streetY]], 0.5);
      if (fp.porch) { // 42" walk from the porch front to the drive edge
        var pys = fp.porch.map(function (p) { return p[1]; }), pxs = fp.porch.map(function (p) { return p[0]; });
        var pyFront = Math.max.apply(null, pys), pxc = (Math.min.apply(null, pxs) + Math.max.apply(null, pxs)) / 2;
        slabPoly([[pxc - 21, pyFront], [pxc + 21, pyFront], [pxc + 21, y0 + 60], [x1, y0 + 60], [x1, y0 + 102], [pxc - 21, y0 + 102]], 0.5);
      }
    }
    // ground
    var span = Math.max(b.maxX - b.minX, b.maxY - b.minY) * FT * 4;
    var ground = new T.Mesh(new T.PlaneGeometry(span, span), new T.MeshStandardMaterial({ map: tx.grass, roughness: 1 }));
    ground.rotation.x = -Math.PI / 2; ground.position.set((b.minX + b.maxX) / 2 * FT, -0.02, (b.minY + b.maxY) / 2 * FT); ground.receiveShadow = true;
    tx.grass.repeat.set(span / 8, span / 8);
    group.add(ground);
    return { group: group, model: g };
  }

  // ---------------------------------------------------------------- mount
  function mount(container, spec, opts) {
    var T = needThree();
    opts = opts || {};
    var shadows = opts.shadows !== false;
    var renderer = new T.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true, alpha: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.shadowMap.enabled = shadows; renderer.shadowMap.type = T.PCFSoftShadowMap;
    renderer.outputEncoding = T.sRGBEncoding; renderer.toneMapping = T.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
    renderer.domElement.style.display = 'block'; renderer.domElement.style.width = '100%'; renderer.domElement.style.height = '100%';
    container.appendChild(renderer.domElement);

    var scene = new T.Scene();
    scene.background = new T.Color(opts.background == null ? 0xbfe0f5 : opts.background);
    var tx = makeTextures(T);
    var built = buildHouse(T, spec, tx, shadows);
    scene.add(built.group);
    var b = built.model.bounds;
    var center = new T.Vector3((b.minX + b.maxX) / 2 * FT, 5, (b.minY + b.maxY) / 2 * FT);
    var size = Math.max(b.maxX - b.minX, b.maxY - b.minY) * FT;
    scene.fog = new T.Fog(scene.background, size * 4, size * 9);

    scene.add(new T.HemisphereLight(0xffffff, 0x5d7a45, 0.55));
    var sun = new T.DirectionalLight(0xfff4e0, 1.15);
    sun.position.set(center.x - size * 0.9, size * 1.4, center.z + size * 1.1);
    sun.target.position.copy(center); scene.add(sun.target);
    sun.castShadow = shadows; sun.shadow.mapSize.set(2048, 2048);
    var sc = sun.shadow.camera; sc.left = -size * 1.2; sc.right = size * 1.2; sc.top = size * 1.2; sc.bottom = -size * 1.2; sc.near = 1; sc.far = size * 6;
    sun.shadow.bias = -0.0008; sun.shadow.normalBias = 0.02;
    scene.add(sun);
    var fill = new T.DirectionalLight(0xdbe8ff, 0.35); fill.position.set(center.x + size, size * 0.6, center.z - size); scene.add(fill);

    var camera = new T.PerspectiveCamera(38, 16 / 10, 0.5, size * 20);
    var controls = new T.OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true; controls.dampingFactor = 0.08; controls.target.copy(center);
    controls.maxPolarAngle = Math.PI / 2 - 0.02; controls.minDistance = size * 0.4; controls.maxDistance = size * 4;
    controls.autoRotate = !!opts.autoRotate; controls.autoRotateSpeed = 0.6;

    var VIEWS = {
      'front-left': [-0.72, 0.2, 1.22], 'front-right': [0.72, 0.2, 1.22], 'rear-right': [0.78, 0.22, -1.15], 'rear-left': [-0.78, 0.22, -1.15],
      'front': [0.05, 0.22, 1.45], 'top': [0.02, 1.6, 0.7]
    };
    function setView(name) {
      var v = VIEWS[name] || VIEWS['front-left'];
      camera.position.set(center.x + v[0] * size, center.y + v[1] * size, center.z + v[2] * size);
      controls.target.copy(center); controls.update();
    }
    function resize() {
      var w = container.clientWidth || 800, h = container.clientHeight || 500;
      renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
    }
    var alive = true, raf = 0;
    function loop() { if (!alive) return; controls.update(); renderer.render(scene, camera); raf = requestAnimationFrame(loop); }
    var ro = null;
    if (typeof ResizeObserver !== 'undefined') { ro = new ResizeObserver(function () { resize(); }); ro.observe(container); }
    else window.addEventListener('resize', resize);
    resize(); setView(opts.view || 'front-left'); loop();

    return {
      scene: scene, camera: camera, renderer: renderer, controls: controls, model: built.model,
      setView: setView, resize: resize,
      renderOnce: function () { controls.update(); renderer.render(scene, camera); },
      screenshot: function () { controls.update(); renderer.render(scene, camera); return renderer.domElement.toDataURL('image/png'); },
      dispose: function () { alive = false; cancelAnimationFrame(raf); if (ro) ro.disconnect(); else window.removeEventListener('resize', resize); controls.dispose(); renderer.dispose(); if (renderer.domElement.parentNode) renderer.domElement.parentNode.removeChild(renderer.domElement); }
    };
  }

  return { mount: mount, version: '1.0.0' };
}));
