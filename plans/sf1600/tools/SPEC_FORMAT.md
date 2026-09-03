# House plan spec format (v1)

A plan is a single JSON file that every tool in this folder (validator, floor-plan
renderer, elevation renderer, 3D model, sheet generator) reads. Everything is derived
from it, so the spec must be geometrically consistent.

## Units and coordinates

* **Units: inches.** Whole or half inches only.
* **Origin:** outside face of framing at the **rear-left corner of the conditioned house**
  ("left" as seen from the street, "rear" = away from the street).
* **+x runs to the right** (toward the secondary-bedroom wing).
  **+y runs toward the street** (toward the front / garage door).
* All polygons are **rectilinear** (every edge horizontal or vertical), given as
  `[[x, y], ...]` without repeating the first vertex, any winding order, no self-intersections.
* Wall thickness convention: **exterior 6"**, **interior 4"**, **plumbing (2x6) 6"**.

## Top-level keys

```jsonc
{
  "name": "SF 1600 F",                 // display name
  "plan_no": "SF 1600",
  "description": "…",
  "based_on": "SF 1258 F (Plan Factory, 738 Sawtooth Dr.)",
  "target": { "living_sf": 1600, "tolerance_sf": 10 },
  "walls": { "exterior": 6, "interior": 4, "plumbing": 6 },

  "footprint": {
    "living": [[x,y], …],     // outside face of framing of the CONDITIONED house. Living
                              // area = area of this polygon (same convention as the original
                              // plan's "LIVING AREA" line, garage & porch excluded).
    "garage": [[x,y], …],     // outside face of garage framing. It ABUTS the living polygon;
                              // the shared wall belongs to the living polygon.
    "porch":  [[x,y], …],     // covered (roofed) porch slab, outside the house polygon
    "stoop":  [[x,y], …]      // optional uncovered slab at the rear door
  },
  "porch_columns": [ { "x": 240, "y": 364, "size": 24 } ],   // top-left corner + square size

  "rooms": [ … ],      // see below
  "doors": [ … ],
  "windows": [ … ],
  "fixtures": [ … ],
  "notes": [ { "text": "…", "x": 0, "y": 0 } ],
  "roof": { … },
  "elevations": { … },
  "site": { … }
}
```

## Rooms

```jsonc
{ "id": "master", "name": "Primary Bedroom", "zone": "living",   // "living" | "garage" | "porch"
  "poly": [[6,6],[170,6],[170,144],[6,144]],
  "floor": "tile", "ceiling": "SLOPE CLG 4:12", "label": true,
  "name_pos": [88, 70] }                                           // optional label anchor
```

* Room polygons are the **clear** (finished, inside-face-to-inside-face) area.
* Rooms never overlap. **Wall material = footprint minus rooms.** So:
  * a room edge sits **6" inside** the footprint edge along an exterior wall;
  * two rooms separated by a wall have a **gap equal to the wall thickness** (4" or 6");
  * two spaces that are **open to each other** (kitchen / dining / living, a toilet alcove
    open to a bath) **share an edge exactly** (zero gap). The renderer draws nothing (or a
    faint dashed line) there.
* Every conditioned room has `zone: "living"`; the garage bay is `zone: "garage"` (6" inside
  the garage footprint); the porch slab is `zone: "porch"`.
* Closets, pantries, halls and alcoves are rooms too (that is how the walls get drawn).
* Give **hallways ≥ 36" clear** (prefer 42"), bedrooms ≥ 70 sf and ≥ 7'-0" in each direction,
  bath fixtures IRC clearances (toilet centered in ≥ 30", ≥ 21" in front).

## Doors

```jsonc
{ "id": "2", "kind": "hinged", "w": 36, "x": 292, "y": 316, "orient": "h",
  "hinge": "right", "swing": "-", "label": "3068 w/ 2-1060 sidelights" }
```

* `(x, y)` = **center of the opening on the wall centerline**.
* `orient`: `"h"` = the wall runs along x (opening spans `x ± w/2`); `"v"` = wall runs along y.
* `swing`: `"+"` = leaf swings toward **+y** (for `h`) or **+x** (for `v`); `"-"` = the opposite.
* `hinge`: `"left"` = hinge at the **lower-coordinate end** of the opening; `"right"` = higher end.
* `kind`: `hinged` | `double` (pair, hinged both ends) | `french` (glazed pair) |
  `bifold` | `pocket` | `sliding` | `overhead` (garage door) | `opening` (cased opening, no leaf).
* A door must sit **inside wall material** and connect exactly two different spaces
  (room ↔ room, room ↔ outside, room ↔ garage bay, room ↔ porch).

## Windows

```jsonc
{ "mark": "A", "label": "PR 3050 SH", "w": 72, "x": 88, "y": 0, "orient": "h",
  "head": 80, "sill": 20 }
```

Center on the exterior wall centerline (`y = 0` for the rear wall, etc.). `orient` as for
doors. `w` is the total rough width of the unit or pair. Every bedroom needs at least one
egress-size window (≥ 5.7 sf clear opening; a 3050 single-hung qualifies).

## Fixtures

Axis-aligned rectangles, `x, y` = top-left, `w` along x, `h` along y, optional `rot`
(0/90/180/270, where the fixture's "back" faces −y at 0 and is rotated clockwise).

`kind` ∈ `tub, shower, toilet, vanity, sink, range, fridge, dw, island, counter, washer,
dryer, water_heater, bench, shelves, closet_rod, bed, sofa, table, desk`. `sinks` (1 or 2)
is allowed on `vanity`. Fixtures must lie inside their room.

## Roof

```jsonc
"roof": {
  "pitch": 6, "overhang": 18, "plate": 109, "porch_plate": 145,
  "pieces": [
    { "id": "main",  "kind": "hip",   "rect": [0, 0, 538, 316],   "ridge": "x" },
    { "id": "garage","kind": "gable", "rect": [0, 316, 240, 584], "ridge": "y", "gable_ends": ["front"] },
    { "id": "porch", "kind": "gable", "rect": [240, 300, 340, 388], "ridge": "y", "gable_ends": ["front"] },
    { "id": "wing",  "kind": "hip",   "rect": [398, 230, 538, 380], "ridge": "y" }
  ]
}
```

Each piece is a rectangular roof mass to the **outside face of frame** (the renderer adds
the overhang). Later pieces are drawn over earlier ones. Pitch is rise per 12.

## Elevations / materials

Free-form but expected keys: `siding`, `wainscot`, `wainscot_height`, `roofing`, `trim`,
`garage_door`, `front_door`, `porch_ceiling`, `plate_height_note`.

## Site (optional)

```jsonc
"site": { "units": "ft", "lot": [[x,y], …], "streets": [...], "setbacks": {...},
          "house_origin": [x, y], "house_rotation": 0, "driveway": [[…]], "walk": [[…]] }
```

## Validation

Run `python3 tools/validate_spec.py spec/<file>.json` — it prints areas, per-room clear
dimensions, door connectivity, and any errors (exit code 1 on errors). Design files are only
accepted when the validator reports **0 errors** and living area within the target tolerance.
