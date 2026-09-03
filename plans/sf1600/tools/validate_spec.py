#!/usr/bin/env python3
"""Validate a house-plan spec (see SPEC_FORMAT.md) and print a report.

Usage: validate_spec.py spec.json [--json] [--quiet]
Exit code 0 = no errors (warnings allowed), 1 = errors.
"""
import json
import sys
from collections import deque

from shapely.geometry import Polygon, Point, box
from shapely.ops import unary_union

SQIN = 144.0


def fmt_ft(inches):
    inches = round(inches * 2) / 2
    ft = int(inches // 12)
    rem = inches - ft * 12
    if abs(rem - round(rem)) < 1e-6:
        rem_s = f"{int(round(rem))}"
    else:
        rem_s = f"{int(rem)}½"
    return f"{ft}'-{rem_s}\""


def poly(pts):
    return Polygon([(float(x), float(y)) for x, y in pts])


def is_rectilinear(pts):
    n = len(pts)
    for i in range(n):
        x0, y0 = pts[i]
        x1, y1 = pts[(i + 1) % n]
        if x0 != x1 and y0 != y1:
            return False
    return True


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    flags = {a for a in sys.argv[1:] if a.startswith("--")}
    if not args:
        print(__doc__)
        sys.exit(2)
    spec = json.load(open(args[0]))
    errors, warnings, info = [], [], []

    walls = spec.get("walls", {"exterior": 6, "interior": 4, "plumbing": 6})
    fp = spec.get("footprint", {})

    # ---- footprint polygons -------------------------------------------------
    zones = {}
    for key in ("living", "garage", "porch", "stoop"):
        pts = fp.get(key)
        if not pts:
            if key in ("living",):
                errors.append("footprint.living missing")
            continue
        if not is_rectilinear(pts):
            errors.append(f"footprint.{key} is not rectilinear")
        p = poly(pts)
        if not p.is_valid:
            errors.append(f"footprint.{key} polygon invalid: {p.is_valid_reason if hasattr(p,'is_valid_reason') else ''}")
        zones[key] = p

    living = zones.get("living")
    areas = {}
    for k, p in zones.items():
        areas[k] = p.area / SQIN
    if living is not None:
        areas["total_under_roof"] = sum(areas.get(k, 0) for k in ("living", "garage", "porch"))
    tgt = spec.get("target", {})
    if living is not None and tgt.get("living_sf"):
        diff = areas["living"] - tgt["living_sf"]
        tol = tgt.get("tolerance_sf", 10)
        if abs(diff) > tol:
            errors.append(f"living area {areas['living']:.1f} sf is {diff:+.1f} sf from target {tgt['living_sf']} (tolerance ±{tol})")
        else:
            info.append(f"living area {areas['living']:.1f} sf within ±{tol} of target {tgt['living_sf']}")

    # zones must not overlap each other
    keys = list(zones)
    for i in range(len(keys)):
        for j in range(i + 1, len(keys)):
            inter = zones[keys[i]].intersection(zones[keys[j]]).area
            if inter > 1.0:
                errors.append(f"footprint.{keys[i]} overlaps footprint.{keys[j]} by {inter/SQIN:.1f} sf")

    # ---- rooms -------------------------------------------------------------
    rooms = spec.get("rooms", [])
    room_polys = {}
    room_report = []
    ids = set()
    for r in rooms:
        rid = r.get("id")
        if not rid or rid in ids:
            errors.append(f"room id missing/duplicate: {rid}")
        ids.add(rid)
        pts = r.get("poly")
        if not pts or len(pts) < 4:
            errors.append(f"room {rid}: poly missing")
            continue
        if not is_rectilinear(pts):
            errors.append(f"room {rid}: poly not rectilinear")
        p = poly(pts)
        if not p.is_valid:
            errors.append(f"room {rid}: polygon invalid")
            continue
        zone = r.get("zone", "living")
        zp = zones.get(zone)
        if zp is None:
            errors.append(f"room {rid}: zone '{zone}' has no footprint")
        else:
            outside = p.difference(zp.buffer(0.01)).area
            if outside > 1.0:
                errors.append(f"room {rid}: {outside/SQIN:.1f} sf lies outside footprint.{zone}")
            # exterior wall band check: room must be >= 6 (or >= 5.5) inside the footprint edge
            if zone == "living" and p.distance(zp.exterior) < walls.get("exterior", 6) - 0.6:
                errors.append(f"room {rid}: closer than {walls.get('exterior',6)}\" to the exterior footprint edge (exterior wall too thin)")
        room_polys[rid] = (p, r)
        minx, miny, maxx, maxy = p.bounds
        room_report.append({
            "id": rid, "name": r.get("name"), "zone": zone,
            "w": maxx - minx, "d": maxy - miny,
            "w_ft": fmt_ft(maxx - minx), "d_ft": fmt_ft(maxy - miny),
            "area_sf": round(p.area / SQIN, 1),
        })
        if zone == "living" and r.get("kind", "").lower() == "bedroom" or ("bed" in rid.lower() and zone == "living" and "closet" not in rid.lower()):
            if p.area / SQIN < 70 or min(maxx - minx, maxy - miny) < 84:
                errors.append(f"bedroom {rid}: below IRC minimum (70 sf and 7'-0\" each way)")

    # room overlaps
    rids = list(room_polys)
    for i in range(len(rids)):
        for j in range(i + 1, len(rids)):
            a = room_polys[rids[i]][0]
            b = room_polys[rids[j]][0]
            inter = a.intersection(b).area
            if inter > 0.5:
                errors.append(f"rooms {rids[i]} and {rids[j]} overlap by {inter/SQIN:.2f} sf")

    # wall material & unassigned space per zone
    for zk, zp in zones.items():
        rp = [room_polys[r][0] for r in room_polys if room_polys[r][1].get("zone", "living") == zk]
        if not rp:
            if zk in ("living", "garage"):
                warnings.append(f"no rooms in zone {zk}")
            continue
        wall = zp.difference(unary_union(rp))
        areas[f"{zk}_wall_sf"] = round(wall.area / SQIN, 1)
        if zk == "living":
            frac = wall.area / zp.area
            info.append(f"living wall material = {wall.area/SQIN:.0f} sf ({frac*100:.1f}% of footprint)")
            if frac > 0.16:
                warnings.append(f"wall material is {frac*100:.0f}% of living footprint - probably unassigned space (missing room polys)")
            # detect fat blobs: erode by 6.5" (half of max wall 6" + tolerance); anything left is unassigned space
            fat = wall.buffer(-6.5)
            if not fat.is_empty:
                geoms = getattr(fat, "geoms", [fat])
                for g in geoms:
                    if g.area > 30:  # > ~ 6x5 inches after erosion
                        cx, cy = g.centroid.x, g.centroid.y
                        full = g.buffer(6.5)
                        warnings.append(f"unassigned space (~{full.area/SQIN:.1f} sf) not covered by any room near ({cx:.0f},{cy:.0f}) - add a room/closet/chase or tighten walls")

    # ---- space lookup helpers ---------------------------------------------
    def space_at(x, y):
        """Classify a point: room id, '#wall:<zone>' (wall material of the living/garage
        footprint), '@porch' / '@stoop' (slabs) or '@outside'. Points exactly on a
        footprint edge count as wall material so door/window centers may be given on
        either the outside face or the wall centerline."""
        pt = Point(x, y)
        # conditioned rooms first, then wall material, then garage/porch rooms and slabs,
        # so a point on the shared house/porch edge reads as wall material
        for rid, (p, r) in room_polys.items():
            if r.get("zone", "living") == "living" and p.buffer(0.01).contains(pt):
                return rid
        for zk in ("living", "garage"):
            if zk in zones and zones[zk].buffer(0.01).contains(pt):
                # inside the garage footprint but inside the garage bay room -> that room
                for rid, (p, r) in room_polys.items():
                    if r.get("zone") == "garage" and p.buffer(0.01).contains(pt):
                        return rid
                return f"#wall:{zk}"
        for rid, (p, r) in room_polys.items():
            if r.get("zone", "living") not in ("living", "garage") and p.buffer(0.01).contains(pt):
                return rid
        for zk in ("porch", "stoop"):
            if zk in zones and zones[zk].buffer(0.01).contains(pt):
                return f"@{zk}"
        return "@outside"

    def is_exterior(space):
        if space.startswith("@"):
            return True
        if space in room_polys and room_polys[space][1].get("zone", "living") in ("porch", "stoop"):
            return True
        return False

    # ---- doors -------------------------------------------------------------
    adjacency = {}
    door_report = []
    for d in spec.get("doors", []):
        did = d.get("id", "?")
        x, y, w = d.get("x"), d.get("y"), d.get("w")
        orient = d.get("orient", "h")
        if x is None or y is None or not w:
            errors.append(f"door {did}: x,y,w required")
            continue
        # must sit in wall material (not inside a room)
        here = space_at(x, y)
        if not here.startswith("#wall"):
            errors.append(f"door {did}: center ({x},{y}) is not inside wall material (found {here})")
        probe = 6.0
        if orient == "h":
            a = space_at(x, y - probe)
            b = space_at(x, y + probe)
            # ends of the opening must also be in wall material (no door running past the wall end)
            e1 = space_at(x - w / 2 + 0.5, y)
            e2 = space_at(x + w / 2 - 0.5, y)
        else:
            a = space_at(x - probe, y)
            b = space_at(x + probe, y)
            e1 = space_at(x, y - w / 2 + 0.5)
            e2 = space_at(x, y + w / 2 - 0.5)
        if a.startswith("#wall") or b.startswith("#wall"):
            # try a longer probe (thick walls)
            probe = 8.5
            if orient == "h":
                a = space_at(x, y - probe); b = space_at(x, y + probe)
            else:
                a = space_at(x - probe, y); b = space_at(x + probe, y)
        if a == b:
            errors.append(f"door {did}: both sides are the same space ({a}) - not on a wall between two spaces")
        if a.startswith("#wall") or b.startswith("#wall"):
            errors.append(f"door {did}: could not find a space on both sides (got {a} / {b}); is it centered on the wall?")
        if not (e1.startswith("#wall") and e2.startswith("#wall")):
            errors.append(f"door {did}: opening ({w}\" wide) runs past the end of its wall ({e1} / {e2})")
        door_report.append({"id": did, "kind": d.get("kind"), "w": w, "connects": [a, b], "label": d.get("label")})
        adjacency.setdefault(a, set()).add(b)
        adjacency.setdefault(b, set()).add(a)

    # ---- windows -----------------------------------------------------------
    for wdw in spec.get("windows", []):
        mk = wdw.get("mark", "?")
        x, y, w = wdw.get("x"), wdw.get("y"), wdw.get("w")
        orient = wdw.get("orient", "h")
        here = space_at(x, y)
        if not here.startswith("#wall"):
            errors.append(f"window {mk} at ({x},{y}): not inside wall material (found {here})")
            continue
        if orient == "h":
            a, b = space_at(x, y - 7), space_at(x, y + 7)
            e1, e2 = space_at(x - w / 2 + 0.5, y), space_at(x + w / 2 - 0.5, y)
        else:
            a, b = space_at(x - 7, y), space_at(x + 7, y)
            e1, e2 = space_at(x, y - w / 2 + 0.5), space_at(x, y + w / 2 - 0.5)
        sides = {a, b}
        outsideish = [s for s in sides if is_exterior(s)]
        rooms_side = [s for s in sides if not is_exterior(s) and not s.startswith("#")]
        if not outsideish or not rooms_side:
            errors.append(f"window {mk} at ({x},{y}): must be in an exterior wall between a room and outside/porch (got {a} / {b})")
        if not (e1.startswith("#wall") and e2.startswith("#wall")):
            errors.append(f"window {mk}: {w}\" unit runs past the end of its wall ({e1} / {e2})")
        for rs in rooms_side:
            adjacency.setdefault(rs, set()).add("@window")

    # bedrooms need a window
    for rid, (p, r) in room_polys.items():
        nm = (r.get("name", "") + " " + rid).lower()
        if "bed" in nm and "closet" not in nm and r.get("zone", "living") == "living":
            if "@window" not in adjacency.get(rid, set()):
                errors.append(f"bedroom {rid}: no egress window on an exterior wall")

    # ---- fixtures inside rooms --------------------------------------------
    for f in spec.get("fixtures", []):
        b = box(f["x"], f["y"], f["x"] + f["w"], f["y"] + f["h"])
        inside = None
        for rid, (p, r) in room_polys.items():
            if p.buffer(0.6).contains(b):
                inside = rid
                break
        if inside is None:
            # allow fixture in porch/garage zones
            ok = any(zones[z].buffer(0.6).contains(b) for z in ("porch", "garage") if z in zones)
            if not ok:
                warnings.append(f"fixture {f.get('kind')} at ({f['x']},{f['y']}) is not inside a single room")

    # ---- circulation: every living room reachable from the front door ------
    # front door = door whose sides include @outside/@porch and a living room; pick 'entry' if labeled
    start = None
    for dr in door_report:
        a, b = dr["connects"]
        if any(is_exterior(s) for s in (a, b)) and dr.get("kind") in ("hinged", "double", "french"):
            other = b if is_exterior(a) else a
            if other in room_polys and room_polys[other][1].get("zone", "living") == "living":
                start = other
                if "front" in (dr.get("label") or "").lower() or dr["id"] in ("2", "front"):
                    break
    if start is None:
        errors.append("no exterior entry door into a living-zone room found")
    else:
        seen = {start}
        changed = True
        while changed:
            changed = False
            # walk doors / openings
            dq = deque(list(seen))
            while dq:
                cur = dq.popleft()
                for nxt in adjacency.get(cur, ()):
                    if nxt.startswith("@") or nxt.startswith("#"):
                        continue
                    if nxt not in seen:
                        seen.add(nxt)
                        dq.append(nxt)
                        changed = True
            # rooms that share an open edge (zero gap, >= 24") with a reached room are reached too
            for rid, (p, r) in room_polys.items():
                if rid in seen or r.get("zone", "living") != "living":
                    continue
                for s in list(seen):
                    if s not in room_polys or room_polys[s][1].get("zone", "living") != "living":
                        continue
                    shared = p.boundary.intersection(room_polys[s][0].boundary)
                    if shared.length > 24:
                        seen.add(rid)
                        changed = True
                        break
        for rid, (p, r) in room_polys.items():
            if r.get("zone", "living") == "living" and rid not in seen:
                errors.append(f"room {rid} is not reachable from the entry via doors/openings (missing door?)")

    # garage must connect to the house
    if "garage" in zones:
        g_rooms = [rid for rid, (p, r) in room_polys.items() if r.get("zone") == "garage"]
        ok = False
        for gr in g_rooms:
            for nb in adjacency.get(gr, ()):
                if nb in room_polys and room_polys[nb][1].get("zone", "living") == "living":
                    ok = True
        if g_rooms and not ok:
            errors.append("garage has no door into the house")
        if g_rooms and not any(dr["kind"] == "overhead" for dr in door_report):
            warnings.append("no overhead garage door")

    # ---- report -------------------------------------------------------------
    report = {
        "file": args[0],
        "areas_sf": {k: round(v, 1) for k, v in areas.items()},
        "rooms": room_report,
        "doors": door_report,
        "errors": errors,
        "warnings": warnings,
        "info": info,
    }
    if "--json" in flags:
        print(json.dumps(report, indent=1))
    else:
        print(f"== {args[0]}")
        print("AREAS (sf):", ", ".join(f"{k}={v}" for k, v in report["areas_sf"].items()))
        if "--quiet" not in flags:
            print("ROOMS:")
            for r in room_report:
                print(f"  {r['id']:<12} {str(r['name']):<22} {r['w_ft']:>8} x {r['d_ft']:<8} {r['area_sf']:>7} sf  [{r['zone']}]")
            print("DOORS:")
            for d in door_report:
                print(f"  {d['id']:<6} {str(d['kind']):<9} {d['w']:>4}\"  {d['connects'][0]} <-> {d['connects'][1]}   {d.get('label') or ''}")
        for i in info:
            print("INFO   ", i)
        for w in warnings:
            print("WARN   ", w)
        for e in errors:
            print("ERROR  ", e)
        print(f"== {len(errors)} errors, {len(warnings)} warnings")
    sys.exit(1 if errors else 0)


if __name__ == "__main__":
    main()
