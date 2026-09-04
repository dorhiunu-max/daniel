#!/usr/bin/env node
// Assemble web/index.html (the Artifact page) from web/template.html + the final spec + baseline + modules.
// usage: node tools/build_page.mjs [--local]   (--local inlines the vendored Three.js for offline testing -> web/index.local.html)
import fs from 'fs';
import path from 'path';
const here = path.dirname(new URL(import.meta.url).pathname);
const ROOT = path.resolve(here, '..');
const local = process.argv.includes('--local');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const safeJson = s => JSON.stringify(JSON.parse(s)).replace(/<\/script/gi, '<\\/script');
let html = read('web/template.html');
const parts = {
  '{{SPEC}}': safeJson(read('spec/sf1600.json')),
  '{{BASELINE}}': safeJson(read('spec/baseline_sf1258.json')),
  '{{JS_FLOORPLAN}}': read('web/js/floorplan.js'),
  '{{JS_GEOMETRY}}': read('web/js/geometry.js'),
  '{{JS_ELEVATIONS}}': read('web/js/elevations.js'),
  '{{JS_ROOFPLAN}}': read('web/js/roofplan.js'),
  '{{JS_SITEPLAN}}': read('web/js/siteplan.js'),
  '{{JS_MODEL3D}}': read('web/js/model3d.js'),
};
for (const [k, v] of Object.entries(parts)) { if (!html.includes(k)) throw new Error('placeholder missing: ' + k); html = html.split(k).join(() => v); }
// split/join with a function avoids $-pattern substitution issues in replace()
html = Object.entries(parts).reduce((h, [k, v]) => h.split(k).join(v), read('web/template.html'));
if (local) {
  html = html.replace('<script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"></script>', '<script>' + read('web/vendor/three.min.js') + '</script>')
             .replace('<script src="https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/controls/OrbitControls.js"></script>', '<script>' + read('web/vendor/OrbitControls.js') + '</script>');
}
const out = path.join(ROOT, local ? 'web/index.local.html' : 'web/index.html');
fs.writeFileSync(out, html);
console.log('wrote', out, (html.length / 1024).toFixed(0) + ' KB');
