# SF 1600 "F" — 1,600 sf concept of the SF 1258 F plan (738 Sawtooth Dr.)

Concept renderings of the Plan Factory **SF 1258 "F"** plan (Dantega Homes / Daniel Orhiunu,
738 Sawtooth Dr., San Antonio) grown from 1,258 sf to **1,600 sf of living area**, keeping the same
three-bedroom diagram, circulation and street face. **Concept study — not for construction.**

| Deliverable | Where |
|---|---|
| Interactive page (plans, elevations, roof, site, 3D model, notes) | `web/index.html` — built by `tools/build_page.mjs` |
| Floor plan, listing style | `renderings/floor_plan_presentation.png` (original beside it: `renderings/original_sf1258_floor_plan.png`) |
| Floor plan, drafted with dimensions | `renderings/floor_plan_architectural.png` |
| Front / rear / left / right elevations | `renderings/elevation_*.png` |
| Roof plan · site plan | `renderings/roof_plan.png`, `renderings/site_plan.png` |
| 3D exterior views | `renderings/3d_*.png` |
| Two 36"×24" sheets at drawing scale (PDF) | `sheets/SF1600_Concept_Sheets.pdf` (+ `sheet1.png`, `sheet2.png`) |
| The design itself (single source for everything above) | `spec/sf1600.json` |
| Transcription of the original plan | `spec/baseline_sf1258.json` |

## Numbers

| | Original SF 1258 F | SF 1600 F |
|---|---|---|
| Living area (outside of frame, garage & porch excluded) | 1,245 sf as modeled (sheet says 1,258) | **1,602 sf** |
| Garage · covered porch | 447 sf · 50 sf | 469 sf · 62 sf |
| Total under roof | 1,741 sf | 2,133 sf |
| Main body (frame) | 44'-10" × 26'-4" | 50'-8" × 30'-0" |
| Overall incl. garage | 44'-10" × 48'-8" | 50'-8" × 52'-4" |
| Mstr. Suite / Bath / W.I.C. | 13'-8"×11'-6" / 10'-0"×8'-6" / 9'-4"×4'-8" | 15'-6"×13'-6" / 11'-0"×9'-4" / 10'-10"×5'-6" |
| Kitchen / Dining / Living | 11'-4"×12'-8" / 7'-2"×12'-8" / 16'-0"×12'-8" | 12'-10"×14'-6" / 8'-0"×14'-6" / 18'-4"×14'-6" |
| Bedroom-3 / Bedroom-2 / Bath 2 | 11'-0"×9'-8" / 11'-0"×10'-0" / 7'-4"×7'-10" | 12'-8"×11'-0" / 12'-8"×11'-10" / 8'-8"×9'-0" |
| Utility / Pantry | 6'-4"×8'-0" / 5'-0"×5'-0" | 6'-8"×9'-10" / 5'-8"×5'-8" |
| Lot placement (Lot 48, 73.31' front, sides taper to ~58') | 10'-7" off left P.L., 39'-9½" from Hunt Lane | 7'-9½" off left P.L., 36'-9½" from Hunt Lane; right clearance 5'-0" (setback) |
| Impervious cover | 32% (sheet) | 36% |

## How it is built

Everything derives from one JSON plan spec (format: `tools/SPEC_FORMAT.md`; checked by
`tools/validate_spec.py`, which computes areas, room dims, door connectivity, egress, reachability):

```
python3 tools/validate_spec.py spec/sf1600.json          # 0 errors, 0 warnings
NODE_PATH=/opt/node22/lib/node_modules node tools/render_all.mjs   # renderings/*.svg|png + 3D views
node tools/build_sheets.mjs                              # sheets/*.pdf|png
node tools/build_page.mjs                                # web/index.html (artifact page)
```

Modules (`web/js/`): `floorplan.js` (listing and drafted plans), `geometry.js` (walls, roof planes with
hips/valleys, openings), `elevations.js`, `roofplan.js`, `siteplan.js` (lot, setback-aware placement,
impervious cover), `model3d.js` (Three.js r128 exterior). Playwright's bundled Chromium rasterizes the
SVGs and screenshots the 3D model (SwiftShader WebGL).

## Design notes and assumptions

* Proportional growth: the diagram scaled ~1.13× and every wall snapped to 2" framing increments; the
  largest gains land in the kitchen/dining/living band (12'-8" → 14'-6" deep) and the primary suite.
* Exterior character unchanged: 6:12 main hip, front-gabled garage, gabled porch on two 24" stone
  columns, hipped bedroom wing, 18" overhangs, 9'-1" plates (12'-1" porch), board-and-batten over a
  3'-0" stone wainscot with brick rowlock, same window/door schedule marks.
* Garage widened to 21'-0" frame; porch 9'-4" × 6'-8".
* The wider house still clears the 5' side setbacks by shifting 2'-9½" left and 3' toward Hunt Lane;
  the right-side clearance is exactly 5'-0" at the wing's front corner (the right line angles in).
  Verify against the recorded plat and any deed restrictions.
* Attribution: derived from Plan Factory plan SF 1258 "F" (designer Antonio Escobedo). Construction
  documents for a 1,600 sf version must come from the plan's designer or another licensed
  designer/engineer.
