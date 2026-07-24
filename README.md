# Babcock Building A Build Out — Proposal Schedule

**RFCSP-226-05-082-CNST** · Triun, LLC · Responsive Information — Proposed Project Schedule (RFP items 1.4.1 / 1.4.2)

Modeled on the Holland Road Dam example schedule (same WBS pattern, submittal
chains, inspection hold points, milestones, and notes discipline). Scope basis:
Exhibit C — Section 00003A Proposal Form (bid tab).

## Files

| File | What it is |
|---|---|
| `babcock_building_a_schedule.xml` | **The deliverable.** MSPDI XML — opens directly in Microsoft Project |
| `babcock_building_a_schedule.py` | Build script (all tasks, durations, logic, and notes; re-run to regenerate) |

## Opening in Microsoft Project

1. MS Project → **File → Open**, set the file type to **XML Format (*.xml)**, pick `babcock_building_a_schedule.xml`.
2. Choose **"As a new project"** when prompted.
3. **File → Save As → .mpp** — that's the native file to submit/share.
4. The schedule imports fully linked and auto-scheduled with the standard Gantt bar colors (blue tasks, black summary bars, milestone diamonds), just like the example.
5. To show the critical path in red: **Gantt Chart Format tab → check "Critical Tasks"** (the critical-path data is already in the file; MS Project just doesn't display it by default).
6. Task notes (assumptions, flags, AHJ hold points, long-lead warnings) are on the task **Notes** field — visible via the Notes column or double-clicking a task.

## Key dates (NTP placeholder 8/3/2026 — shift project start to actual NTP)

| Milestone | Date |
|---|---|
| NTP (placeholder) | Mon 8/3/2026 |
| Onsite Construction Start | Wed 8/26/2026 |
| MEP & Framing Rough-In Complete | 11/2/2026 |
| Certificate of Occupancy | 1/8/2027 |
| **Substantial Completion** | **1/26/2027** |
| **Final Completion** | **1/28/2027** |

**RFP 1.4.2 durations:**
- Notice to Proceed → Project Completion: **178 calendar days** (~6 months)
- Actual Onsite Start → Project Completion: **155 calendar days** (~104 working days onsite → substantial, matching the 105 days carried in Division 01 General Requirements)

## Structure (mirrors the example template)

- **Preconstruction** — NTP → Award → Bonds → Precon meeting → Permits (15-day AHJ assumption) → 17 submittal packages, each with the Triun Review → A/E Review → Approved Submittal → Procurement chain. Long-lead packages flagged (HVAC equipment and electrical gear at 40 working days procurement are the drivers).
- **Construction** — Mobilization → Selective Demo (Div 02) → Concrete/Underground/Structural (Div 03/04/05/31) → Framing & MEP Rough-In with AHJ hold points (Div 09/22/23/26/27/28) → Insulation/Drywall/Ceilings → Interior Finishes (Div 06/08/09/10/11/12) → MEP Trim → Startup/TAB/Commissioning → CofO. Division 01 rides as a 105-day level-of-effort bar.
- **Closeout** — Final cleaning → Punch walk → Punch list → Substantial Completion → Final payment application → Final Completion milestone.
- **Alternates Breakout** — Alts 1–3 per Exhibit C, each with placeholder submittal/construction bars and a completion milestone, running concurrent with base finishes and **not** driving base completion.

Calendar: Mon–Fri 8:00–5:00 with standard holiday exceptions (Labor Day,
Thanksgiving + Friday, Christmas Eve/Day, New Year's Day). The example carried
no holidays (its window ended in November); they're included here so no work
is scheduled on an observed holiday.

## Flags / assumptions carried in task notes

1. **NTP is a placeholder** — everything shifts with the actual NTP date.
2. **Permit duration assumed 15 working days** — confirm the AHJ and its actual review timeline.
3. **Building assumed unoccupied** during construction; occupied-adjacent phasing would add containment and duration.
4. **Div 21 Fire Suppression = $0** — existing sprinklers assumed adequate; AHJ-required modifications would be a change.
5. **Div 25 Integrated Automation = $0** — BAS/controls assumed carried under Div 23 HVAC.
6. **Div 31 Earthwork = 5 days / $0** — interior trenching assumed carried with Div 22 underground plumbing.
7. **HVAC equipment & electrical gear at 40-day procurement** — near-critical; confirm vendor lead times at award, consider early release.
8. **Hollow metal door frames** need an early release from the Div 08 supplier (set during framing, well before doors/hardware).
9. **No hazmat/abatement carried** — discovered hazardous materials would be Owner-directed work.
10. **Alternates 1–3 scope descriptions pending** — bars are placeholders sized from their bid values; provide scope to detail them.
11. **Unforeseen conditions** exposed by demolition are addressed from the Owner's 10% contingency.
12. **CMT (materials testing)** assumed Owner-carried — confirm.
