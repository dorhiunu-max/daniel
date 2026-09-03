# Design brief — SF 1600 "F" (1,600 sf version of Plan Factory SF 1258 "F")

Client: Dantega Homes / Daniel Orhiunu. Reference plan: **Plan Factory SF 1258 "F"**, designed by
Antonio Escobedo, drawn 6/22/2023, plotted 10/10/2023 for **738 Sawtooth Dr., Lot 48 Block 23,
NCB 15850, Lackland City Subdivision, San Antonio, Bexar County, TX** (sheets 1–2 of 4: Site Plan /
Roof / Elevations; Floor Plan / Elevations).

Goal: **the same house, grown to 1,600 sf of living area** — same program, same room
arrangement, same circulation, same exterior character — with the extra ~340 sf distributed where
it makes the most difference to livability, not smeared uniformly. Renderings (listing-style floor
plan, drafted floor plan, four elevations, roof plan, site plan check, 3D exterior) are produced
from the spec.

## The original, as drawn (baseline spec: `spec/baseline_sf1258.json`)

Tabulation on the sheet: **LIVING 1,258 sf · GARAGE 467 sf · COV. PORCH 49 sf · TOTAL UNDER ROOF
1,774 sf · FLATWORK 36 sf.** Our transcription measures 1,244.6 sf living to the outside face of
framing (the designer's 1,258 likely includes the veneer ledge); treat the baseline model as the
reference and hit **1,600 sf by the same convention** (outside face of frame, garage & porch
excluded, target ± 10 sf).

Overall: main body **44'-10" wide × 26'-4" deep** (frame), plus the Bedroom-2 wing projecting
**5'-4"** toward the street at the right end (11'-8" wide), plus the **20'-0" × 22'-4" two-car
garage** projecting forward at the left end with a **front-facing gable**, and the recessed
**8'-4" × 6'-0" covered porch** (12' ceiling, two 2'-0" stone columns) between the garage and
the entry. Overall depth including garage 49'-1½". Plates 9'-1"; 6:12 hips and gables; 18"
overhangs; composition shingles with ridge vents; board-and-batten siding with 4" trim; stone
veneer wainscot to 3'-0" with a brick rowlock cap; 16'×8' overhead door; 3068 entry with two
1060 fixed sidelights; 6'-8" header heights.

Program & adjacencies (all on one level):

| Room | Clear size (as drawn) | Notes |
|---|---|---|
| Mstr. Suite | 13'-8" × 11'-6" (app measured 13'10"×11'7") | rear-left; 4:12 sloped ceiling; PR 3050 SH rear window; door from the hall |
| Mstr. Bath | ~10'-0" × 8'-6" L-shape | 44"×58" tile shower w/ 32" glass door & 36" tile wall, double vanity w/ medicine cabinets, toilet alcove ("CAB"), linen & hamper closet; 3010 HS window; entered from the bedroom |
| W.I.C. | 9'-4" × 4'-8" | carpet; entered from the bath; rod & shelf both long walls |
| Hall (master) | 3'-6" wide | from the living via a 3'-0" cased opening; to master door and utility door |
| Utility | 6'-4" × 8'-0" (app 6'9"×8'4") | W/D on a 2×6 plumbing wall; door to garage (3068 S.C. w/ closer); water heater on an 18" platform in the garage |
| Pantry | 5'-0" × 5'-0" | 6 shelves; 2668 door off the kitchen |
| Kitchen | 11'-4" × 12'-8" (app 11'4"×12'4") | sink/DW under a 3030 SH window on the rear wall, range + microwave-vent and fridge on the pantry-side wall, **36"×72" island w/ 42" breakfast bar**; 3:12 slope ceiling |
| Dining | 7'-2" × 12'-8" (app 7'2"×12'5") | rear wall: PR 2668 15-lite french doors to a 6'×6' stoop |
| Living | 16'-0" × 12'-8" (app 16'6"×13'0") | 3:12 slope ceiling; PR 2050 SH front window; 6×10 beams at ceiling breaks |
| Bedroom-3 | 11'-0" × 9'-8" (app 11'1"×10'1") | rear-right; PR 3050 SH; 8'-0" × 2'-0" closet w/ PR 2068 doors |
| Hall (wing) | 3'-4" × 10'-4" | from the dining via 3010 C.O.; doors to Bed-3, Bath 2, Bed-2 |
| Bath 2 | 7'-4" × 7'-10" L-shape (app 7'5"×7'5") | 5' tub/shower, single vanity w/ MC, toilet alcove, 3010 HS window |
| Bedroom-2 | 11'-0" × 10'-0" + 4'-6"×2'-2" closet (app 11'1"×12'11" incl. closet) | front-right wing; PR 3050 SH front window |
| 2 Car Garage | 19'-0" × 21'-4" | 16'×8' O.H. door; attic stairs; WH |
| Cov. Porch | 8'-4" × 6'-0" | 12' ceiling, 2 stone columns, gable roof |

## Requirements for the 1,600 sf design

1. **Living area 1,600 ± 10 sf** (validator `target`), garage stays a true 2-car (≥ 20'×22' frame;
   up to 21'×23' allowed), covered porch 50–80 sf.
2. **Keep the plan diagram**: master suite rear-left with bath/WIC/utility block in front of it;
   open kitchen–dining–living in the center with the pantry against the master wall; two bedrooms +
   bath in the right wing with Bedroom-2 projecting forward; garage forward-left with the recessed
   porch beside it; entry into the living; rear french doors from the dining; garage → utility →
   hall → living circulation. Same window/door types (3050 pairs, 3030 at sink, 2050 pair at
   living front, 3010 sliders in baths, 2668 french pair, 3068 entry w/ sidelights, 16×8 O.H.).
3. **Spend the extra area where it counts** — designers choose, but justify: bigger primary suite
   (≥ 14'×14'), bigger secondary bedrooms (≥ 11'×11'), a real kitchen (≥ 12' run + island, walk-in
   pantry), 16'+ living, utility with counter/mud bench, hall ≥ 42" where practical, larger
   closets. Do not add a fourth bedroom or a second story; a study/flex nook is acceptable only
   if it does not break the diagram.
4. **Dimensions in framing-friendly increments** (whole inches; prefer 2" multiples; room sizes in
   2" steps). Interior walls 4", exterior 6", plumbing walls 6".
5. **IRC 2021 sanity**: bedrooms ≥ 70 sf and ≥ 7' each way with an egress window; halls ≥ 36";
   toilets centered in ≥ 30" with 21" clear in front; 30"×30" min shower (use the 44"×58");
   door swings must not conflict; no door swings into a hallway that is < 42" unless it is a
   closet.
6. **Roof stays simple**: 6:12 main hip, front gable over the garage, gable over the porch, hip
   over the projecting wing; overall width must fit the lot: lot is 73.31' at the front with 5'
   side setbacks → **house + garage overall width ≤ 60'** (original is 44'-10"), depth from the
   20' front setback line back to the rear wall ≤ 60'.
7. The design is delivered as `spec/sf1600_<variant>.json` in the format described in
   `tools/SPEC_FORMAT.md`, passing `python3 tools/validate_spec.py` with **0 errors**, and it must
   render cleanly with `node tools/render_plan.mjs`.

## Judging criteria (for the design panel)

* Fidelity to the original diagram, adjacencies and exterior character (30%)
* Livability of the added area: room proportions, kitchen work triangle, furniture-ability,
  storage, natural light, privacy of the primary suite (30%)
* Buildability: simple roof, aligned walls, plumbing grouped, framing-friendly dims, no wasted
  corridor area, wall fraction ≈ 10–12% of footprint (20%)
* Accuracy & completeness of the spec: validator clean, 1,600 ± 10 sf, doors/windows/fixtures all
  present and sensible, labels correct (20%)
