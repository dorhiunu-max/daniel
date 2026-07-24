"""RFCSP-226-05-082-CNST - Babcock Building A Build Out - Proposal Schedule.

Builds the MS Project (MSPDI XML) construction schedule for the Babcock
Building A interior build-out, modeled on the Holland Road Dam example
schedule (same WBS pattern: Preconstruction with submittal
review->approval->procurement chains, phased Construction with inspection
hold points and a Division 01 level-of-effort bar, Closeout, milestones,
and assumptions carried in task notes).

Scope basis: Exhibit C - Section 00003A Proposal Form (bid tab) division
line items and day counts. Base bid divisions are scheduled in full;
Alternates 1-3 are broken out in their own section per direction.

  NTP placeholder : Mon 8/3/2026 (shift project start to actual NTP)
  Duration target : ~105 working days onsite (per Division 01 - 105 days)
  Cost loading    : none (matches the example schedule)

Output: babcock_building_a_schedule.xml  (MS Project: File > Open, then
Save As .mpp)
"""
import os
import sys

sys.path.insert(0, "/root/.claude/skills/construction-scheduling/scripts")
from schedule_builder import ScheduleBuilder, FS, SS, FF  # noqa: E402

b = ScheduleBuilder(
    "Babcock Building A Build Out - RFCSP-226-05-082-CNST",
    author="Triun, LLC",
)

# Standard holiday exceptions (non-working) on the project calendar so no
# work is scheduled on observed holidays within the project window.
import java.time as _jt  # noqa: E402

_cal = b.pf.getDefaultCalendar()
for _y, _m, _d, _nm in [
    (2026, 9, 7, "Labor Day"),
    (2026, 11, 26, "Thanksgiving Day"),
    (2026, 11, 27, "Day After Thanksgiving"),
    (2026, 12, 24, "Christmas Eve"),
    (2026, 12, 25, "Christmas Day"),
    (2027, 1, 1, "New Year's Day"),
]:
    _ex = _cal.addCalendarException(_jt.LocalDate.of(_y, _m, _d))
    _ex.setName(_nm)

root = b.root("Babcock Building A Build Out - RFCSP-226-05-082-CNST")

# =====================================================================
# PRECONSTRUCTION
# =====================================================================
pre = b.add(root, "pre", "Preconstruction")

b.add(pre, "ntp", "NTP", 1,
      notes="Placeholder NTP date of 8/3/2026 - shift the project start date "
            "to the actual Notice to Proceed.")
b.add(pre, "award", "Contract Award & Execution", 1, preds=["ntp"],
      notes="Remaining contract Exhibits provided after contract execution "
            "per RFCSP terms and the Owner/Contractor Agreement.")
b.add(pre, "bonds", "Payment & Performance Bonds / Builder's Risk & Insurance",
      5, preds=[("award", SS, 0)],
      notes="Performance Bond at 100% of the contract amount per RFCSP "
            "requirements.")
b.add(pre, "pmtg", "Pre-Construction Meeting - Owner / A/E / Triun", 1,
      preds=["award"])
b.add(pre, "presubs",
      "Preconstruction Submittals - SOV, Baseline Schedule, Safety Plan & "
      "Submittal Register", 5, preds=["award"],
      notes="Division 01 administrative submittals: Schedule of Values per "
            "Exhibit C divisions, baseline CPM schedule, site-specific "
            "safety plan, and the submittal register.")
b.add(pre, "permit",
      "Building & Trade Permits - Application to Issuance (AHJ)", 15,
      preds=["award"],
      notes="ASSUMPTION: 15 working-day permit review by the Authority "
            "Having Jurisdiction (AHJ) running concurrent with submittals - "
            "confirm jurisdiction and actual review timeline. Permit "
            "issuance gates mobilization/onsite start.")

# ---------------------------------------------------------------------
# Submittals - one package per procured division scope, each with the
# Triun Review -> A/E Review -> Approved -> Procurement chain (mirrors
# the example template). FS lag from Award staggers package preparation
# by procurement priority (long-lead packages first).
# ---------------------------------------------------------------------
subs = b.add(pre, "subs", "Submittals")

PACKAGES = [
    # key, name, procurement days, stagger lag from award, extra note
    ("hvac", "23 - HVAC Equipment (AHUs/RTUs, VAV Boxes, Fans & Grilles)",
     40, 0,
     "LONG-LEAD / CRITICAL DRIVER: largest procurement in the project "
     "(Division 23 material $543,259). Confirm manufacturer lead times at "
     "award; consider early release/purchase with the equipment submittal."),
    ("gear", "26 - Electrical Distribution (Panelboards, Transformers & "
             "Disconnects)", 40, 0,
     "LONG-LEAD: switchgear/panelboard market lead times are volatile - "
     "confirm with vendor at award and consider early release."),
    ("drs", "08 - Doors, Frames & Hardware (Schedules & Product Data)",
     30, 0,
     "LONG-LEAD. Hollow metal frames are needed early (set during framing) "
     "- request an early frame release from the supplier ahead of doors "
     "and hardware."),
    ("lite", "26 - Lighting Fixtures & Lighting Controls", 30, 1,
     "LONG-LEAD: confirm fixture lead times; substitutions subject to A/E "
     "approval."),
    ("glz", "08 - Aluminum Storefront & Interior Glazing (Shop Drawings)",
     25, 1,
     "LONG-LEAD: storefront fabrication after approved shop drawings and "
     "field verification."),
    ("mill", "06 - Architectural Millwork & Casework (Shop Drawings)",
     25, 2,
     "LONG-LEAD: custom casework fabrication; field measure after framing."),
    ("bas", "23/25 - HVAC Controls / Building Automation", 20, 2,
     "Division 25 Integrated Automation carries $0 in the bid tab - "
     "ASSUMPTION: controls/BAS are included under Division 23 HVAC. "
     "Confirm scope split."),
    ("fasec", "28 - Fire Alarm & Security / Access Control (incl. AHJ Fire "
              "Alarm Permit)", 20, 2,
     "Fire alarm shop drawings require separate AHJ permit/review before "
     "installation - confirm AHJ review time."),
    ("stl", "05 - Miscellaneous Metals & Equipment Support Steel (Shop "
            "Drawings)", 15, 3,
     "Includes RTU/AHU support frames, lintels, and miscellaneous framing."),
    ("plmb", "22 - Plumbing Fixtures, Piping & Insulation", 15, 3, None),
    ("fin", "09 - Interior Finishes (Flooring, Tile, ACT & Paint)", 15, 4,
     None),
    ("spec", "10/11/12 - Specialties, Equipment & Window Treatments", 15, 4,
     None),
    ("comm", "27 - Structured Cabling & Communications", 15, 5, None),
    ("d07", "07 - Roofing Patching, Firestopping & Joint Sealants", 10, 5,
     "Roof patching at new curbs/penetrations by a roofer compatible with "
     "the existing roof system to preserve any existing warranty - "
     "confirm existing roof warranty holder."),
    ("conc", "03 - Concrete Mix Design (4,000 PSI)", 5, 6, None),
    ("mas", "04 - Masonry Materials (CMU, Mortar & Grout)", 5, 6, None),
    ("demo", "02 - Demolition Plan, Waste Management & Haul Routes", 3, 0,
     "First construction activity onsite - expedite so demolition is not "
     "held."),
]

for key, name, proc, lag, note in PACKAGES:
    pkg = b.add(subs, f"s_{key}", name)
    b.add(pkg, f"s_{key}_r", "Triun Review", 1,
          preds=[("award", FS, lag)])
    b.add(pkg, f"s_{key}_e", "A/E Review", 5, preds=[f"s_{key}_r"])
    b.add(pkg, f"s_{key}_a", "Approved Submittal", 1, preds=[f"s_{key}_e"])
    b.add(pkg, f"s_{key}_p", "Procurement", proc, preds=[f"s_{key}_a"],
          notes=note if note else (
              "Long-lead: confirm vendor lead time at award."
              if proc >= 15 else None))

# =====================================================================
# CONSTRUCTION
# =====================================================================
con = b.add(root, "con", "Construction")

# ---- Mobilization & Site Preparation --------------------------------
mobs = b.add(con, "mobs", "Mobilization & Site Preparation")
b.add(mobs, "mob", "Mobilize Field Office, Temporary Facilities & Site "
      "Protection", 3, preds=["pmtg", "bonds", "permit", "presubs"],
      notes="Mobilization follows permit issuance, executed bonds, the "
            "approved safety plan/baseline schedule, and the "
            "pre-construction meeting.")
b.add(mobs, "onsite", "Onsite Construction Start", milestone=True,
      preds=[("mob", SS, 0)],
      notes="Actual onsite start of construction - basis for the RFCSP "
            "1.4.2 'Onsite Start to Project Completion' calendar-day "
            "duration.")
b.add(mobs, "temp", "Temporary Power, Lighting & Ventilation", 3,
      preds=["mob"])
b.add(mobs, "dust", "Install Dust Barriers, Floor Protection & Negative "
      "Air", 2, preds=["mob"],
      notes="ASSUMPTION: Building A is unoccupied and turned over to Triun "
            "for the construction period. If adjacent areas remain "
            "occupied, add phased containment and off-hours work - "
            "duration impact to be evaluated.")
b.add(mobs, "layout", "Building Control Lines, Survey & Layout", 2,
      preds=["mob"])

# ---- Selective Demolition (Division 02) -----------------------------
demo_s = b.add(con, "demo_s", "Selective Demolition (Division 02 - "
               "Existing Conditions)")
b.add(demo_s, "safeoff", "MEP Safe-Off, Disconnects & Cap-Offs", 2,
      preds=["dust", ("temp", SS, 1)])
b.add(demo_s, "demo", "Selective Interior Demolition - Walls, Ceilings, "
      "Flooring & Fixtures", 12, preds=["safeoff", "s_demo_p"],
      notes="Division 02 carries 20 days in the bid tab - demolition "
            "phase (safe-off through verification walk) spans ~20 working "
            "days. ASSUMPTION: no asbestos/hazardous materials abatement "
            "in contract (none carried in Exhibit C) - any discovered "
            "hazmat is Owner-directed work.")
b.add(demo_s, "demo_mep", "Demolish & Remove Redundant MEP Systems", 8,
      preds=[("demo", SS, 2)])
b.add(demo_s, "haul", "Load, Haul & Legally Dispose of Demolition Debris",
      10, preds=[("demo", SS, 2)])
b.add(demo_s, "demo_ver", "Post-Demolition Walk & Existing Conditions "
      "Verification - Owner / A/E / Triun", 1,
      preds=["demo", "demo_mep", "haul"],
      notes="Unforeseen existing conditions exposed by demolition are "
            "addressed from the Owner's Allowance/Contingency (10% of "
            "direct costs per Exhibit C).")

# ---- Concrete, Underground & Structural Modifications ---------------
strs = b.add(con, "strs", "Concrete, Underground & Structural "
             "Modifications (Divisions 03, 04, 05, 31)")
b.add(strs, "sawcut", "Sawcut Slab & Trench for New Underground "
      "Utilities", 3, preds=["demo_ver"],
      notes="Division 31 Earthwork carries 5 days but $0 in the bid tab - "
            "ASSUMPTION: trenching/backfill inside the building is carried "
            "with Division 22 underground plumbing. Confirm no exterior "
            "earthwork scope is intended.")
b.add(strs, "ug_plmb", "Underground Plumbing - Waste & Vent Rough-In "
      "(Division 22)", 5, preds=["sawcut", "s_plmb_p"])
b.add(strs, "ug_insp", "Underground Plumbing Inspection (AHJ) - Hold "
      "Point Before Backfill", 1, preds=["ug_plmb"],
      notes="AHJ inspection hold point - no backfill until the "
            "underground rough is approved.")
b.add(strs, "backfill", "Backfill, Compact & Density Test Trenches", 2,
      preds=["ug_insp"])
b.add(strs, "slab", "Slab Infill Pours - 4,000 PSI w/ Doweled Edges "
      "(Division 03)", 2, preds=["backfill", "s_conc_p"])
b.add(strs, "conc_t", "Concrete Field Testing (Slump, Air, Cylinders)", 2,
      preds=[("slab", FF, 0)],
      notes="Field sampling and cylinder casting during pours. "
            "ASSUMPTION: construction materials testing is an Owner-"
            "carried service unless directed otherwise - confirm.")
b.add(strs, "pads", "Housekeeping Pads - Mechanical & Electrical Rooms",
      2, preds=["slab"])
b.add(strs, "cyl28", "28-Day Cylinder Breaks & Strength Verification", 1,
      preds=[("slab", FS, 19)],
      notes="~28 calendar days after slab infill placement.")
b.add(strs, "cmu", "CMU Infill & Masonry Patching at Modified Openings "
      "(Division 04)", 3, preds=["demo_ver", "s_mas_p"])
b.add(strs, "steel", "Miscellaneous Steel - Lintels, Equipment Supports "
      "& RTU Frames (Division 05)", 10, preds=["demo_ver", "s_stl_p"])
b.add(strs, "roof", "Roof Modifications - Curbs, Openings & Patching "
      "(Division 07)", 5, preds=[("steel", SS, 5), "s_d07_p"],
      notes="Roof cuts/curbs for new HVAC equipment and penetrations; "
            "patching by a roofer compatible with the existing system to "
            "preserve any existing warranty.")

# ---- Interior Framing & MEP Rough-In --------------------------------
rough = b.add(con, "rough", "Interior Framing & MEP Rough-In "
              "(Divisions 09, 22, 23, 26, 27, 28)")
b.add(rough, "frame", "Metal Stud Framing - Interior Partitions & "
      "Furr-Outs (Division 09)", 15, preds=["demo_ver", "layout"])
b.add(rough, "frames_hm", "Set Hollow Metal Door Frames in Partitions "
      "(Division 08)", 3, preds=[("frame", SS, 5), "s_drs_p"],
      notes="Requires early frame release from the door supplier - "
            "flagged on the 08 submittal package.")
b.add(rough, "duct", "HVAC Overhead Ductwork - Mains & Branches "
      "(Division 23)", 20, preds=[("frame", SS, 3)])
b.add(rough, "mech_pipe", "Mechanical Piping - Refrigerant, Condensate "
      "& Hydronic (Division 23)", 12, preds=[("duct", SS, 5)])
b.add(rough, "plmb_oh", "Plumbing Overhead & In-Wall Rough-In "
      "(Division 22)", 15, preds=[("frame", SS, 5)])
b.add(rough, "elec_rough", "Electrical Conduit & Boxes - Overhead & "
      "In-Wall Rough-In (Division 26)", 20, preds=[("frame", SS, 5)])
b.add(rough, "comm_rough", "Communications Pathways - Cable Tray, "
      "Conduit & Sleeves (Division 27)", 10,
      preds=[("elec_rough", SS, 5)])
b.add(rough, "fa_rough", "Fire Alarm & Security Rough-In (Division 28)",
      10, preds=[("elec_rough", SS, 8)],
      notes="Division 21 Fire Suppression carries $0 in the bid tab - "
            "ASSUMPTION: existing sprinkler system remains adequate; any "
            "AHJ-required sprinkler modifications are excluded and would "
            "be a change. Confirm with the Fire Marshal.")
b.add(rough, "blocking", "In-Wall Blocking & Backing (Division 06)", 5,
      preds=[("frame", SS, 8)])
b.add(rough, "gear_set", "Set Electrical Distribution Gear, Panelboards "
      "& Transformers (Division 26)", 5,
      preds=["pads", "s_gear_p", "temp"])
b.add(rough, "wire", "Pull Wire & Make Up - Feeders & Branch Circuits "
      "(Division 26)", 12, preds=[("elec_rough", SS, 8), "gear_set"])
b.add(rough, "set_rtu", "Set HVAC Equipment - AHUs/RTUs (Crane Day) "
      "(Division 23)", 3, preds=["roof", "steel", "s_hvac_p"],
      notes="Crane pick coordinated with Owner site access. Equipment "
            "delivery per the long-lead Division 23 procurement - "
            "near-critical; confirm lead time at award.")
b.add(rough, "set_vav", "Set VAV / Fan-Powered Boxes & In-Duct Devices "
      "(Division 23)", 5, preds=[("duct", SS, 8), "s_hvac_p"])
b.add(rough, "mep_ins", "Ductwork & Piping Insulation (Divisions 07/23)",
      8, preds=[("duct", SS, 10), ("mech_pipe", SS, 6)])
b.add(rough, "firestop", "Firestopping & Fire/Smoke Sealants at Rated "
      "Penetrations (Division 07)", 5,
      preds=[("duct", FF, 2), ("elec_rough", FF, 2)])
b.add(rough, "rough_insp", "AHJ Rough Inspections - Frame, Mechanical, "
      "Electrical & Plumbing (Hold Point)", 2,
      preds=["frame", "frames_hm", "duct", "plmb_oh", "elec_rough",
             "blocking", "fa_rough", "firestop", "cmu"],
      notes="AHJ hold point - no insulation or drywall cover until rough "
            "inspections are approved. Inspection set is a standard "
            "commercial build-out sequence; verify against the project "
            "specifications and AHJ requirements (plans/specs not "
            "provided at proposal).")
b.add(rough, "mep_rough_ms", "MEP & Framing Rough-In Complete - Ready "
      "for Cover", milestone=True, preds=["rough_insp"])

# ---- Insulation, Drywall & Ceilings ---------------------------------
dry = b.add(con, "dry", "Insulation, Drywall & Ceilings (Divisions 07, "
            "09)")
b.add(dry, "wall_ins", "Wall & Sound Batt Insulation (Division 07)", 5,
      preds=["mep_rough_ms"])
b.add(dry, "ins_insp", "Insulation Inspection (AHJ)", 1,
      preds=["wall_ins"])
b.add(dry, "hang", "Hang Gypsum Board (Division 09)", 12,
      preds=["ins_insp"])
b.add(dry, "tape", "Tape, Float & Sand - Level 4 Finish (Division 09)",
      10, preds=[("hang", SS, 4)])
b.add(dry, "prime", "Prime & First Coat Paint (Division 09)", 4,
      preds=["tape"])
b.add(dry, "grid", "Acoustical Ceiling Grid (Division 09)", 8,
      preds=["prime"])
b.add(dry, "lights", "Install Light Fixtures & Lighting Controls in "
      "Grid (Division 26)", 8, preds=[("grid", SS, 2), "s_lite_p"])
b.add(dry, "grilles", "Install HVAC Grilles, Registers & Flex "
      "Connections (Division 23)", 5, preds=[("grid", SS, 3)])
b.add(dry, "comm_cable", "Pull & Terminate Structured Cabling "
      "(Division 27)", 12,
      preds=["comm_rough", ("hang", SS, 6), "s_comm_p"])
b.add(dry, "aboveceil", "AHJ Above-Ceiling / Close-In Inspection (Hold "
      "Point)", 1,
      preds=["lights", "grilles", "mep_ins", "firestop", "comm_cable"],
      notes="AHJ hold point - ceiling tile does not drop until the "
            "above-ceiling inspection is approved.")
b.add(dry, "tile_drop", "Drop Acoustical Ceiling Tile (Division 09)", 3,
      preds=["aboveceil"])

# ---- Interior Finishes ----------------------------------------------
fin = b.add(con, "fin", "Interior Finishes (Divisions 06, 08, 09, 10, "
            "11, 12)")
b.add(fin, "cer_tile", "Ceramic Tile - Restroom Floors & Walls "
      "(Division 09)", 8, preds=[("tape", FS, 2), "s_fin_p"])
b.add(fin, "storefront", "Aluminum Storefront & Interior Glazing "
      "(Division 08)", 8, preds=["tape", "s_glz_p"])
b.add(fin, "mill_inst", "Install Millwork, Casework & Wall Paneling "
      "(Division 06)", 8, preds=["prime", "s_mill_p"])
b.add(fin, "counters", "Solid Surface Countertops - Field Measure & "
      "Install (Division 06)", 3, preds=["mill_inst"])
b.add(fin, "paint", "Finish Paint & Final Coats (Division 09)", 8,
      preds=["grid"])
b.add(fin, "floor", "Flooring - LVT, Carpet Tile & Resilient Base "
      "(Division 09)", 10, preds=[("paint", SS, 4), "s_fin_p"])
b.add(fin, "seal", "Joint Sealants & Final Caulking (Division 07)", 3,
      preds=[("paint", SS, 4)])
b.add(fin, "doors", "Hang Doors, Install Hardware & Keying "
      "(Division 08)", 8, preds=[("paint", SS, 4), "s_drs_p",
                                 "frames_hm"],
      notes="Keying meeting with Owner prior to final keying/cores.")
b.add(fin, "special", "Toilet Partitions, Accessories & Specialties "
      "(Division 10)", 4, preds=["cer_tile", ("paint", SS, 6),
                                 "s_spec_p"])
b.add(fin, "signage", "Interior Signage & Wayfinding (Division 10)", 2,
      preds=["paint", "s_spec_p"])
b.add(fin, "fec", "Fire Extinguishers & Cabinets (Division 10)", 1,
      preds=["paint"])
b.add(fin, "equip", "Install Equipment (Division 11)", 2,
      preds=[("floor", FF, 0)],
      notes="Division 11 carries $700 / 3 days - minor equipment scope. "
            "ASSUMPTION: balance of equipment is Owner-furnished; "
            "coordination only.")
b.add(fin, "furnish", "Window Treatments & Furnishings (Division 12)", 3,
      preds=[("floor", SS, 7), "s_spec_p"])
b.add(fin, "ext", "Exterior Improvements - Site Repairs at Entries "
      "(Division 32)", 5, preds=[("floor", SS, 0)],
      notes="Division 32 carries $3,500 / 10 days - minor exterior "
            "repair scope concurrent with interior finishes. Confirm "
            "extent with the Scope of Services.")

# ---- MEP Trim & Low Voltage -----------------------------------------
trim = b.add(con, "trim", "MEP Trim & Low-Voltage Systems (Divisions "
             "22, 26, 27, 28)")
b.add(trim, "plmb_trim", "Plumbing Fixtures, Trim & Water Heaters "
      "(Division 22)", 8, preds=["cer_tile", "s_plmb_p"])
b.add(trim, "elec_trim", "Electrical Devices, Cover Plates & Panel "
      "Terminations (Division 26)", 8, preds=[("paint", SS, 2), "wire"])
b.add(trim, "comm_test", "Test, Certify & Label Structured Cabling "
      "(Division 27)", 3, preds=["comm_cable"],
      notes="Includes MDF/IDF rack dress-out and certification reports "
            "to the Owner.")
b.add(trim, "sec_dev", "Install Security Devices, Access Control & "
      "Cameras (Division 28)", 10, preds=["fa_rough", ("paint", SS, 2),
                                          "s_fasec_p"],
      notes="Access control and camera head-end commissioning feeds "
            "Owner training.")
b.add(trim, "fa_dev", "Fire Alarm Devices & Notification Appliances "
      "(Division 28)", 6, preds=["fa_rough", ("tile_drop", SS, 0),
                                 "s_fasec_p"])

# ---- Startup, Testing & Commissioning -------------------------------
cx = b.add(con, "cx", "Startup, Testing & Commissioning")
b.add(cx, "power_on", "Permanent Power Energization & Switchover", 2,
      preds=["gear_set", "wire"],
      notes="Coordinate utility/Owner shutdown windows for the "
            "switchover.")
b.add(cx, "controls", "BAS Controls - Point-to-Point & Programming "
      "(Divisions 23/25)", 10, preds=["s_bas_p", "set_vav", "power_on"])
b.add(cx, "hvac_start", "HVAC Equipment Startup & Refrigerant Charge",
      4, preds=["power_on", "set_rtu", "set_vav", "mech_pipe",
                ("controls", SS, 5)])
b.add(cx, "tab", "Test, Adjust & Balance (TAB) w/ Report", 8,
      preds=["hvac_start", "grilles", "tile_drop"],
      notes="Certified TAB agency; report submitted with closeout "
            "documents.")
b.add(cx, "fa_test", "Fire Alarm Pre-Test & AHJ Acceptance Test (Hold "
      "Point)", 2, preds=["fa_dev", "controls"],
      notes="AHJ acceptance test required before Certificate of "
            "Occupancy.")
b.add(cx, "life_safety", "Life Safety Demonstration - Egress, Emergency "
      "Lighting & Signage", 1, preds=["fa_test", "lights"])
b.add(cx, "cxfpt", "Functional Performance Testing / Commissioning", 5,
      preds=[("tab", SS, 4), "controls"])
b.add(cx, "final_insp", "AHJ Final Inspections - Building, Mechanical, "
      "Electrical & Plumbing", 3,
      preds=["fa_test", "tab", "doors", "plmb_trim", "elec_trim",
             "special", "fec", "signage"],
      notes="Fire extinguishers and ADA/egress signage in place ahead of "
            "final inspections and Certificate of Occupancy.")
b.add(cx, "cofo", "Certificate of Occupancy Issued", milestone=True,
      preds=["final_insp", "life_safety"],
      notes="AHJ Certificate of Occupancy / approval to occupy - "
            "precedes Substantial Completion.")

# ---- Division 01 level of effort ------------------------------------
b.add(con, "gcloe", "Field Supervision & General Conditions - Division "
      "01 (Level of Effort)", 105, preds=[("onsite", SS, 0)],
      notes="Division 01 General Requirements carries 105 days in the "
            "bid tab ($226,396.03) - basis of the ~105-working-day "
            "onsite duration. Level-of-effort bar spans onsite "
            "construction; adjust duration to actual conditions.")

# =====================================================================
# CLOSEOUT
# =====================================================================
close = b.add(root, "close", "Closeout")
b.add(close, "clean", "Final Cleaning", 3,
      preds=["floor", "doors", "special", "furnish", "seal",
             "storefront", "counters", "ext", "equip"])
b.add(close, "punch_walk", "Punch Walk - Owner / A/E / Triun", 1,
      preds=["clean", "cofo"],
      notes="Punch walk covers base bid and any awarded alternates "
            "(alternate completion milestones are linked as "
            "predecessors).")
b.add(close, "punch", "Punch List Completion", 5, preds=["punch_walk"])
b.add(close, "asbuilt", "As-Built Drawings & Record Documents", 5,
      preds=[("punch_walk", SS, 0)])
b.add(close, "om", "O&M Manuals, Warranties & Attic Stock", 5,
      preds=[("punch_walk", SS, 0)])
b.add(close, "train", "Owner Training - HVAC, Controls, Fire Alarm & "
      "Security", 2, preds=["cxfpt", "punch_walk", "sec_dev"])
b.add(close, "subst", "Substantial Completion", 1,
      preds=[("punch", FF, 0), "cofo"],
      notes="Substantial Completion at punch list completion with the "
            "Certificate of Occupancy in hand.")
b.add(close, "final_pay", "Final Inspection & Final Payment Application",
      2, preds=["subst", "asbuilt", "om", "train", "cyl28",
                "comm_test", "conc_t"])
b.add(close, "final", "Final Completion", milestone=True,
      preds=["final_pay"])

# =====================================================================
# ALTERNATES BREAKOUT (per Exhibit C - scheduled but not driving the
# base bid completion; each fits inside the base construction window)
# =====================================================================
alts = b.add(root, "alts", "Alternates Breakout (Exhibit C - If Awarded)")

alt_defs = [
    ("alt1", "Alternate No. 1", "$99,000.00", 15, 12, 0),
    ("alt2", "Alternate No. 2", "$79,008.53", 15, 10, 5),
    ("alt3", "Alternate No. 3", "$285,781.66", 20, 20, 0),
]
for key, label, amount, sub_d, con_d, stagger in alt_defs:
    alt = b.add(alts, key, f"{label} (Exhibit C)")
    b.add(alt, f"{key}_sub", f"{label} - Submittals & Procurement", sub_d,
          preds=[("award", FS, 2)],
          notes=f"Add alternate per Exhibit C - Section 00003A "
                f"({amount}: material + labor). Scope description "
                f"pending - durations are placeholders; provide the "
                f"alternate scope to detail tasks. Scheduled concurrent "
                f"with the base bid; does not extend base Substantial "
                f"Completion.")
    b.add(alt, f"{key}_con", f"{label} - Construction Work", con_d,
          preds=[f"{key}_sub", ("hang", SS, stagger)],
          notes="Runs concurrent with base-bid interior finishes; "
                "resequence once the alternate scope is confirmed.")
    b.add(alt, f"{key}_done", f"{label} Complete", milestone=True,
          preds=[f"{key}_con"])

# Link alternate completion milestones into the punch walk (added after
# creation because the Alternates section sits below Closeout in the WBS).
from org.mpxj import Relation, Duration, TimeUnit  # noqa: E402

_pw = b.tasks["punch_walk"]
for _k in ("alt1_done", "alt2_done", "alt3_done"):
    _pw.addPredecessor(
        Relation.Builder()
        .predecessorTask(b.tasks[_k])
        .type(FS)
        .lag(Duration.getInstance(0.0, TimeUnit.DAYS))
    )

# =====================================================================
# SCHEDULE & WRITE
# =====================================================================
b.schedule(2026, 8, 3)   # NTP placeholder - Mon 8/3/2026

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                   "babcock_building_a_schedule.xml")
b.write(OUT)

print(b.report())

# ---- summary ---------------------------------------------------------
import datetime as _dt  # noqa: E402


def _d(task_key, attr):
    t = b.tasks[task_key]
    v = getattr(t, attr)()
    return _dt.date(v.getYear(), v.getMonthValue(), v.getDayOfMonth())


ntp = _d("ntp", "getStart")
onsite = _d("onsite", "getStart")
subst = _d("subst", "getFinish")
final = _d("final", "getFinish")
print("\n=== KEY DATES ===")
print(f"NTP (placeholder)     : {ntp}")
print(f"Onsite start          : {onsite}")
print(f"Substantial Completion: {subst}")
print(f"Final Completion      : {final}")
print(f"NTP -> Substantial    : {(subst - ntp).days} calendar days")
print(f"NTP -> Final          : {(final - ntp).days} calendar days")
print(f"Onsite -> Substantial : {(subst - onsite).days} calendar days")
print(f"Onsite -> Final       : {(final - onsite).days} calendar days")

cp = b.critical_path()
print(f"\n=== CRITICAL PATH ({len(cp)} tasks) ===")
for tid, name, s, f in cp:
    print(f"  {tid:3d}  {name}  {s[:10]} -> {f[:10]}")

n_tasks = sum(1 for t in b.pf.getTasks() if t.getID() is not None)
n_links = sum(t.getPredecessors().size() for t in b.pf.getTasks()
              if t.getID() is not None)
n_miles = sum(1 for t in b.pf.getTasks()
              if t.getID() is not None and t.getMilestone())
print(f"\nTasks: {n_tasks}  Links: {n_links}  Milestones: {n_miles}")
print("Wrote", OUT)
