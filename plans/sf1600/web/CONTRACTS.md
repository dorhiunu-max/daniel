# Web module contracts (SF 1600 renderings)

All modules are plain browser scripts (no bundler, no ES modules) that also work under Node
(`module.exports`) — UMD style. They take the plan `spec` object (see `tools/SPEC_FORMAT.md`) and
never fetch anything. They must run inside a published Artifact page whose Content-Security-Policy
allows external **scripts only** from `https://cdnjs.cloudflare.com` and
`https://cdn.jsdelivr.net/npm/` (no external images, fonts, fetch/XHR). Everything else is inline.

Units in the spec are inches; +x right, +y toward the street. Heights: `spec.roof.plate` (109" =
9'-1"), `spec.roof.porch_plate` (145"), window head height `spec.windows[i].head` (default 80"),
`spec.roof.pitch` (rise per 12), `spec.roof.overhang` (18").

## `web/js/floorplan.js` → `window.FloorPlan` (exists)

* `FloorPlan.renderSVG(spec, {style:'presentation'|'architectural', pxPerInch, padding, showFixtures,
  showDimensions, showDoorLabels, showWindowMarks, showLabels, title, background}) → svgString`
* `FloorPlan.fmtFt(inches)`, `FloorPlan.roomDims(poly)`

## `web/js/geometry.js` → `window.HouseGeometry`

Shared 3D model builder used by the elevations and the 3D view so they always agree.

```js
HouseGeometry.build(spec) → {
  walls: [ { id, poly3: [[x,y,z],...], normal:[nx,ny,nz], zone:'living'|'garage'|'porch_column'|'gable', material:'siding'|'stone'|'gable' } ],
    // every exterior wall face as a vertical quad from z=0 to the plate (or the gable-end triangle above the plate),
    // computed from footprint.living + footprint.garage (the shared wall is NOT exterior) and porch_columns.
  roofs: [ { id, piece, poly3: [[x,y,z],...], normal, kind:'hip'|'gable', slope:'front'|'rear'|'left'|'right'|'gable-left'|'gable-right' } ],
    // roof planes from spec.roof.pieces: for each rect (to outside of frame) add the overhang, eave at
    // z = plate - overhang*pitch/12 (fascia), ridge at eave + (halfSpan)*pitch/12.
    // hip (ridge along x): 4 planes (2 trapezoids + 2 triangles). gable (ridge along y): 2 rectangles
    // + gable-end triangles returned in `walls` with material 'gable' for the ends listed in gable_ends
    // (an end not listed is hipped).
  openings: [ { kind:'window'|'door'|'garage', mark, label, x0,y0,x1,y1 (plan, on the wall centerline), z0, z1, wallId, orient, side:'front'|'rear'|'left'|'right', units:n } ],
    // windows & exterior doors resolved from spec (label → size: "3050" = 3'-0" x 5'-0" each, "PR" = 2 units,
    // "3030", "2050", "3010", "1060", "2668", "3068"; overhead 16'x8'), z1 = head height.
  bounds: { minX, maxX, minY, maxY, maxZ }
}
```

Side naming (as seen from outside): **front** = viewer at +y looking toward −y (street side);
**rear** = viewer at −y; **left** = viewer at −x (the garage/master side is on the left when you
face the front); **right** = viewer at +x.

## `web/js/elevations.js` → `window.Elevations`

* `Elevations.renderSVG(spec, side, {pxPerFoot=12, title=true, dims=true, materials=true}) → svgString`
  Orthographic projection of `HouseGeometry.build(spec)` for `side`, painted far-to-near (sort by
  centroid depth; farther first) with opaque fills so near masses hide far ones. Walls: white with
  board-and-batten batten lines every 12" (light gray), stone wainscot to `elevations.wainscot_height`
  (36") drawn as an irregular ashlar pattern with a rowlock cap line, 4" corner/trim boards; roofs:
  shingle texture (fine horizontal course lines every 5") with a fascia band and ridge-vent marks;
  windows: frame + sash lines, single-hung split, pairs split; front door with sidelights; garage
  door with 4×8 raised panels; porch columns with stone base; grade line; landscaping optional.
  Annotations: plate-height dims on the sides ("PLT. @ 9'-1"", "PLT. @ COV. PORCH 12'-1"" where the
  porch plate is higher), pitch symbols "6:12", "COMP. ROOF SHINGLES", "BRD & BTN SIDING", "STONE
  VENEER AS SPECIFIED", "BRICK ROWLOCK", title text `FRONT ELEVATION` + `SCALE: 1/4" = 1'-0"`.
* `Elevations.renderAll(spec, opts) → { front, rear, left, right }`

## `web/js/roofplan.js` → `window.RoofPlan`

* `RoofPlan.renderSVG(spec, {pxPerInch}) → svgString` — plan view from above: eave outline (with
  overhang), hip and ridge lines from `HouseGeometry.build(spec).roofs`, valleys where pieces meet,
  pitch arrows "6:12 PITCH" on each plane pointing down-slope, "RIDGE VNT." labels, faint footprint
  underneath, title `ROOF PLAN` + `SCALE: 1/8" = 1'-0"`, the note "ALL ROOF OVERHANGS TO BE 18" FROM
  FRAME, UNLESS NOTED OTHERWISE".

## `web/js/siteplan.js` → `window.SitePlan`

* `SitePlan.renderSVG(spec, {pxPerFoot=6, placement}) → svgString` — `spec.site` gives the lot polygon
  in feet (`lot`), labels, setbacks and `house_origin` (`placement` overrides it). Draw: lot lines
  (heavy dash-dot) with lengths, setback lines (dashed, "5' B.S.L." / "20' B.S.L."), street names,
  the house footprint (living + garage + porch) at the placement with the roof outline (overhang)
  faint, the driveway from the garage door to the street and a 42" walk from the porch, the rear
  stoop, dimension ties from the house corners to the property lines, the impervious-cover table
  (LOT / HOUSE under roof / FLATWORK / total / %), north arrow, title `SITE PLAN` +
  `SCALE: 1/8" = 1'-0"`, and a note if any setback is violated (compute it!).

## `web/js/model3d.js` → `window.Model3D`

* `Model3D.mount(containerEl, spec, {view:'front-left'|'front-right'|'rear-right'|'rear-left'|'top', autoRotate:false, shadows:true}) → handle`
  with `handle.setView(name)`, `handle.resize()`, `handle.dispose()`, `handle.screenshot() → dataURL`.
  Uses Three.js **r128** loaded from `https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js`
  and OrbitControls from `https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/controls/OrbitControls.js`
  (both must be loaded before this script; the module throws a clear error if `THREE` is missing).
  Scene: ground plane (grass), driveway/walk slabs, walls from `HouseGeometry` (siding texture:
  procedural canvas board-and-batten; stone wainscot band 36" high: procedural ashlar canvas), roof
  planes (procedural shingle canvas, dark gray-brown), fascia/soffit boards, windows (dark glass with
  white frames, muntin grid), front door + sidelights, garage door with panels, porch columns with
  stone bases and a porch ceiling, soft shadows (directional sun + hemisphere light), sky-blue
  background with light fog. Coordinates: plan x → scene x, plan y → scene −z (so the street is toward
  the camera at +z... i.e. the front elevation faces +z), height → scene y; units feet.

## `web/index.html` (the Artifact)

Single self-contained page: the spec inlined as `<script id="spec" type="application/json">`, the
modules inlined, Three.js from the two CDN URLs above. Tabs: Overview (3D hero + stats + comparison
table original vs 1,600), Floor Plan (presentation), Drafted Plan (architectural), Elevations (4),
Roof Plan, Site Plan, 3D Model (interactive), Notes & Assumptions. Theme-aware per artifact rules
(light/dark tokens), responsive, drawings scroll horizontally inside their own container when wider
than the viewport. Load `artifact-design` skill guidance before styling.

## Static renderings (`renderings/*.png`) and sheets (`sheets/*.pdf`)

`tools/render_all.mjs` renders every SVG (plan × 2 styles, 4 elevations, roof, site) to SVG + PNG
with Playwright, screenshots the 3D view from 4 presets (headless WebGL via SwiftShader), and
`tools/build_sheets.mjs` lays out two 36"×24" sheets (HTML → PDF via Playwright, merged with pypdf):
Sheet 1 — Site Plan, Roof Plan, Front & Rear elevations, notes, title block; Sheet 2 — Floor Plan
(architectural) with square-footage tabulation, Left & Right elevations, door/window schedules,
general notes. Title block: "SF 1600 F — CONCEPT STUDY — NOT FOR CONSTRUCTION — derived from Plan
Factory SF 1258 F (Antonio Escobedo) for Dantega Homes / Daniel Orhiunu, 738 Sawtooth Dr."

### `HouseGeometry` — as implemented (additions to the contract above)

* `build(spec, opts)` — `opts.clip` (default **true**): `roofs` holds only the **visible** part of
  every roof plane, clipped against the other pieces, so valleys and the lines where one roof dies
  into another are polygon edges; a plane can come back as several convex parts (`planeId`, `part`,
  `parts`). `roofsUnclipped` always holds the whole planes exactly as described above
  (hip: 2 trapezoids + 2 triangles; gable: 2 rectangles + hip/valley treatment of unlisted ends).
  `opts.autoValley` (default **true**): an unlisted end whose eave line lies inside another piece and
  whose ridge runs into that roof is a **valley** end (planes run straight until the ridge meets the
  other roof, as on the architect's roof plan: garage, wing and porch ridges die into the main hip)
  rather than a hip. A piece may force it: `"ends": {"rear": "valley"}`. With
  `{clip:false, autoValley:false}` you get the literal contract planes.
* Each roof entry also carries `down` (unit plan vector down-slope), `eaveZ`, `ridgeZ` and
  `edges[i]` tagging edge `poly3[i]→poly3[i+1]`: `eave | ridge | hip | rake | valley | seam`
  (coplanar neighbour, draw no line) `| under` (another roof's eave hangs above it) `| internal`
  (split between two parts of one plane) `| cut`.
* Walls carry `kind`: `wall` (exterior face, z 0→plate), `column` (porch column box faces, z 0→porch
  plate, material `stone`), `gable` (gable-end triangle, material `gable`), `closure` (siding panel
  from the plate to the porch ceiling where an exterior wall borders the porch slab); plus `side`,
  `a`, `b` (plan end points, left→right as seen from outside), `len`, `z0`, `z1`.
* Openings also carry `w`, `h`, `unitW`, `units`, `code`, `normal`, `id` (doors), `doorKind`; their
  plan coordinates are snapped onto the wall face line. Interior doors are omitted.
* `roofPieces[]`: `{ id, kind, ridge, rect, eave, plate, eaveZ, ridgeZ, halfSpan, ridgeLine
  [[x,y],[x,y]] (visible ridge), ends {left/right | rear/front: hip|gable|valley}, extent }`;
  `porch: { poly, z, columns }`; `plate`, `porchPlate`, `pitch`, `overhang`; `warnings[]`.
* Helpers: `decodeSize(label)`, `sideOfNormal(nx, ny)`, `project([x,y,z], side) → {u, v, depth}`
  (u = to the viewer's right, depth = toward the viewer), `roofZ(model, x, y)`, `SIDES`.
