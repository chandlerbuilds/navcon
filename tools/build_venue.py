#!/usr/bin/env python3
"""Turn a vector floor-plan PDF into a Navcon venue bundle.

Usage:
  python3 tools/build_venue.py <map.pdf> <page1.png> data/kcna26/exhibitors.tsv public/venues/kcna26.json [data/kcna26/keywords.tsv]

The optional keywords file (booth number, tab, comma-separated search keywords) lets people
search by what a company does. Keywords are editorial: a venue admin maintains them.

<page1.png> is the map page rendered with `pdftoppm -r 200 -f 1 -l 1 -png`; it is only
used to sample display colours. The PDF itself is not committed to the repository.

What is automatic: the hall outline, zone shapes, every booth shape, and the booth
number printed inside each booth. What is curated below: the names of the white
service areas and the positions of icons (restrooms, entrances), because the PDF
draws those labels as artwork.
"""
import json
import re
import sys

import pdfplumber
from PIL import Image

# One PDF point in metres. Derived from booth sizes on the map, assuming the
# standard footprints (platinum 20 ft square = 12.9 pt, gold 15 x 10 ft, silver 8 x 10 ft).
M_PER_PT = 0.3048 / 0.645
ORIGIN = (20.0, 0.0)  # PDF point that becomes (0, 0) in metres
MAP_MAX_X = 520       # everything right of this is logos and QR panels

TIER_BY_COLOR = {
    (0.305, 0.242, 0.246, 0.0): "silver",
    (0.707, 0.094, 1.0, 0.008): "startup",
    (0.004, 0.129, 0.707, 0.0): "gold",
    (0.543, 0.316, 0.0, 0.0): "platinum",
    (0.0, 0.566, 1.0, 0.0): "media",
    (0.0, 0.969, 0.137, 0.0): "diamond",
    (0.327, 0.602, 0.0, 0.0): "enduser",
}

ZONE_BY_COLOR = {
    (0.015, 0.288, 0.0, 0.0): ("cosmic-canyon", "Cosmic Canyon"),
    (0.059, 0.232, 0.19, 0.0): ("amber-hive", "Amber Hive"),
    (0.123, 0.074, 0.001, 0.0): ("honeycomb-hub", "Honeycomb Hub"),
    (0.336, 0.105, 0.275, 0.0): ("alpine-overlook", "Alpine Overlook"),
    (0.28, 0.0, 0.222, 0.0): ("starlight-summit", "Starlight Summit"),
    (0.251, 0.168, 0.056, 0.0): ("astral-peak", "Astral Peak"),
}

# White service areas, keyed by rounded bounding box in PDF points: (id, name, kind).
AREAS = {
    (259, 15, 312, 199): ("seating-hall-5-west", "Seating (Hall 5 west)", "seating"),
    (292, 15, 338, 47): ("corner-store", "Corner Store and T-Shirt Pick-up", "service"),
    (441, 15, 480, 144): ("seating-hall-5-east", "Seating (Hall 5 east)", "seating"),
    (361, 18, 412, 47): ("cloud-native-theater", "Cloud Native Theater", "stage"),
    (384, 55, 431, 161): ("project-pavilion", "CNCF Project Pavilion", "pavilion"),
    (339, 63, 352, 88): ("cdw-game-zone", "CDW Game Zone", "lounge"),
    (358, 64, 378, 128): ("seating-hall-5-center", "Seating (Hall 5 center)", "seating"),
    (259, 106, 279, 199): ("meal-hall-4-west", "Meal Pick-up (Hall 4 west)", "food"),
    (441, 150, 461, 201): ("meal-hall-4-east", "Meal Pick-up (Hall 4 east)", "food"),
    (397, 172, 431, 187): ("mixed-use-space", "Mixed Use Space", "service"),
    (364, 194, 406, 204): ("poster-pavilion", "Poster Pavilion", "pavilion"),
    (264, 205, 296, 231): ("sponsor-storage", "Sponsor Storage", "service"),
    (441, 208, 474, 278): ("seating-hall-3-east", "Seating (Hall 3 east)", "seating"),
    (304, 214, 326, 282): ("seating-hall-3-west", "Seating (Hall 3 west)", "seating"),
    (400, 233, 412, 246): ("twingate-coffee-bar", "Twingate Coffee Bar", "food"),
    (278, 237, 298, 282): ("exhibitor-services", "Exhibitor Services Desk", "service"),
    (399, 253, 412, 278): ("cdw-hive-zone", "CDW Hive Zone", "lounge"),
    (315, 292, 329, 324): ("cdw-relaxation-station", "CDW Relaxation Station", "lounge"),
    (309, 326, 329, 482): ("seating-hall-2", "Seating (Hall 2)", "seating"),
    (382, 355, 408, 380): ("meal-hall-2", "Meal Pick-up (Hall 2)", "food"),
    (439, 425, 471, 451): ("cdw-network-nook", "CDW Network Nook", "lounge"),
    (361, 435, 374, 448): ("cloudchipr-coffee-bar", "Cloudchipr Coffee Bar", "food"),
    (378, 452, 391, 478): ("cdw-workshop-zone", "CDW Workshop Zone", "lounge"),
    (439, 453, 474, 473): ("seating-hall-1", "Seating (Hall 1)", "seating"),
    (188, 482, 291, 499): ("meal-halls-a-b", "Meal Pick-up (Halls A and B)", "food"),
    (439, 482, 463, 522): ("demo-theater", "Demo Theater", "stage"),
    (34, 483, 59, 538): ("seating-hall-c", "Seating (Hall C)", "seating"),
    (298, 526, 316, 544): ("cloudchipr-dirty-soda-bar", "Cloudchipr Dirty Soda Bar", "food"),
    (107, 532, 143, 569): ("meal-hall-c", "Meal Pick-up (Hall C)", "food"),
    (302, 534, 365, 601): ("seating-hall-a", "Seating (Hall A)", "seating"),
    (84, 551, 102, 570): ("edera-activation-zone", "Edera Activation Zone", "lounge"),
    (68, 567, 86, 586): ("tailscale-coffee-bar", "Tailscale Coffee Bar", "food"),
    (279, 578, 298, 596): ("sonatype-activation-zone", "Sonatype Activation Zone", "lounge"),
    (83, 583, 102, 601): ("echo-activation-zone", "Echo Activation Zone", "lounge"),
    (254, 594, 291, 630): ("meal-hall-a", "Meal Pick-up (Hall A)", "food"),
    (67, 599, 85, 618): ("uber-activation-zone", "Uber Activation Zone", "lounge"),
    (258, 610, 301, 652): ("cncf-sales-lounge", "CNCF Sponsorship and Membership Sales Lounge", "lounge"),
    (54, 614, 70, 630): ("headshots", "Headshots", "service"),
    (75, 622, 93, 640): ("dash0-lounge", "Dash0 Lounge", "lounge"),
}
# White shapes that are booths, not service areas: bbox -> booth number.
WHITE_BOOTHS = {(138, 521, 161, 544): "140"}
# White shapes to ignore (logo plates inside another area, label backgrounds).
IGNORE = {(381, 23, 392, 30), (362, 436, 373, 442), (300, 528, 312, 539), (69, 569, 81, 580),
          (281, 580, 292, 591), (76, 665, 152, 675)}

# Icons and labels, in PDF points: (id, name, kind, x, y).
POINTS = [
    ("main-entrance", "Main Entrance", "entrance", 138.0, 646.0),
    ("secondary-entrance-hall-2", "Secondary Entrance (Hall 2)", "entrance", 435.5, 355.5),
    ("secondary-entrance-hall-1", "Secondary Entrance (Hall 1)", "entrance", 479.5, 474.0),
    ("restrooms-hall-c", "Restrooms (Hall C)", "restroom", 88.0, 489.5),
    ("restrooms-hall-b", "Restrooms (Hall B)", "restroom", 181.5, 489.5),
    ("restroom-hall-3-north", "Restroom (Hall 3 north)", "restroom", 479.8, 216.3),
    ("restroom-hall-3-south", "Restroom (Hall 3 south)", "restroom", 480.4, 265.5),
    ("restroom-hall-1-north", "Restroom (Hall 1 north)", "restroom", 477.0, 439.0),
    ("restroom-hall-1-south", "Restroom (Hall 1 south)", "restroom", 473.6, 515.0),
    ("hall-5", "Hall 5", "hall", 345.0, 56.0),
    ("hall-4", "Hall 4", "hall", 367.0, 184.0),
    ("hall-3", "Hall 3", "hall", 369.0, 294.0),
    ("hall-2", "Hall 2", "hall", 362.0, 357.0),
    ("hall-1", "Hall 1", "hall", 369.0, 430.0),
    ("hall-c", "Hall C", "hall", 80.0, 505.0),
    ("hall-b", "Hall B", "hall", 166.0, 506.0),
    ("hall-a", "Hall A", "hall", 249.0, 506.0),
]
ZONE_LABEL_AT = {
    "cosmic-canyon": (410.0, 166.0), "amber-hive": (364.0, 236.0), "honeycomb-hub": (366.0, 406.0),
    "alpine-overlook": (421.0, 478.0), "starlight-summit": (125.0, 496.0), "astral-peak": (250.0, 594.0),
}


def ckey(c):
    try:
        return tuple(round(float(v), 3) for v in c)
    except Exception:
        return None


def bkey(o):
    return (round(o["x0"]), round(o["top"]), round(o["x1"]), round(o["bottom"]))


def poly_of(o):
    if o["object_type"] == "rect":
        return [(o["x0"], o["top"]), (o["x1"], o["top"]), (o["x1"], o["bottom"]), (o["x0"], o["bottom"])]
    pts = [(float(x), float(y)) for x, y in o.get("pts", [])]
    if len(pts) > 1 and abs(pts[0][0] - pts[-1][0]) < 0.05 and abs(pts[0][1] - pts[-1][1]) < 0.05:
        pts = pts[:-1]
    return pts


def to_m(poly):
    return [[round((x - ORIGIN[0]) * M_PER_PT, 2), round((y - ORIGIN[1]) * M_PER_PT, 2)] for x, y in poly]


def pt_m(x, y):
    return [round((x - ORIGIN[0]) * M_PER_PT, 2), round((y - ORIGIN[1]) * M_PER_PT, 2)]


def pip(x, y, poly):
    inside = False
    n = len(poly)
    for i in range(n):
        x1, y1 = poly[i]
        x2, y2 = poly[(i + 1) % n]
        if (y1 > y) != (y2 > y):
            if x < x1 + (y - y1) * (x2 - x1) / (y2 - y1):
                inside = not inside
    return inside


def main(pdf_path, png_path, exhibitors_path, out_path, keywords_path=None):
    tags = {}
    if keywords_path:
        with open(keywords_path, encoding="utf-8") as f:
            for line in f:
                if "\t" in line:
                    num, words = line.rstrip("\n").split("\t", 1)
                    tags[num.strip()] = words.strip()
    names = {}
    with open(exhibitors_path, encoding="utf-8") as f:
        for line in f:
            line = line.rstrip("\n")
            if not line:
                continue
            nums, name = line.split("\t")
            for n in nums.split(","):
                names[n.strip()] = name.strip()

    img = Image.open(png_path).convert("RGB")
    with pdfplumber.open(pdf_path) as pdf:
        page = pdf.pages[0]
        px_per_pt = img.width / float(page.width)

        def sample(x, y):
            r, g, b = img.getpixel((int(x * px_per_pt), int(y * px_per_pt)))
            return "#%02x%02x%02x" % (r, g, b)

        objs = [o for o in page.rects + page.curves if o["x1"] < MAP_MAX_X + 30]

        outline = None
        for o in page.curves:
            if o["stroke"] and not o["fill"] and (o["x1"] - o["x0"]) > 400:
                outline = poly_of(o)
        if outline is None:
            raise SystemExit("hall outline not found")

        zones = []
        for o in objs:
            k = ckey(o.get("non_stroking_color"))
            if k in ZONE_BY_COLOR and o["fill"] and (o["x1"] - o["x0"]) * (o["bottom"] - o["top"]) > 9000:
                zid, zname = ZONE_BY_COLOR[k]
                poly = poly_of(o)
                lx, ly = ZONE_LABEL_AT[zid]
                zones.append({"id": zid, "name": zname, "color": None, "poly": to_m(poly), "at": pt_m(lx, ly)})
        # zone colour = the most common pixel colour inside the zone shape
        for o in objs:
            k = ckey(o.get("non_stroking_color"))
            if k in ZONE_BY_COLOR and o["fill"] and (o["x1"] - o["x0"]) * (o["bottom"] - o["top"]) > 9000:
                poly = poly_of(o)
                counts = {}
                steps = 40
                for i in range(steps):
                    for j in range(steps):
                        x = o["x0"] + (o["x1"] - o["x0"]) * (i + 0.5) / steps
                        y = o["top"] + (o["bottom"] - o["top"]) * (j + 0.5) / steps
                        if pip(x, y, poly):
                            c = sample(x, y)
                            if c.lower() != "#ffffff":  # white service areas sit on top of the zone
                                counts[c] = counts.get(c, 0) + 1
                colour = max(counts, key=counts.get)
                for z in zones:
                    if z["id"] == ZONE_BY_COLOR[k][0]:
                        z["color"] = colour

        # booths
        shapes = {}
        for o in objs:
            k = ckey(o.get("non_stroking_color"))
            w, h = o["x1"] - o["x0"], o["bottom"] - o["top"]
            if k in TIER_BY_COLOR and o["fill"] and o["x1"] < MAP_MAX_X and 2.5 <= w <= 40 and 2.5 <= h <= 40:
                if 115 < o["x0"] < 265 and 350 < o["top"] < 440:
                    continue  # legend swatches
                poly = poly_of(o)
                if len(poly) >= 4:
                    shapes.setdefault(tuple(round(v, 1) for v in (o["x0"], o["top"], o["x1"], o["bottom"])),
                                      {"tier": TIER_BY_COLOR[k], "poly": poly, "rect": o["object_type"] == "rect", "digits": []})
        white = {}
        for o in objs:
            if ckey(o.get("non_stroking_color")) == (0.0, 0.0, 0.0, 0.0) and (o["x1"] - o["x0"]) * (o["bottom"] - o["top"]) >= 60:
                white.setdefault(bkey(o), o)
        for k, num in WHITE_BOOTHS.items():
            o = white[k]
            shapes[tuple(round(v, 1) for v in (o["x0"], o["top"], o["x1"], o["bottom"]))] = {
                "tier": "feature", "poly": poly_of(o), "rect": False, "digits": list(num), "fixed": True}

        for c in page.chars:
            if not c["text"].isdigit() or c["x0"] > MAP_MAX_X:
                continue
            cx, cy = (c["x0"] + c["x1"]) / 2, (c["top"] + c["bottom"]) / 2
            for (x0, y0, x1, y1), s in shapes.items():
                if s.get("fixed"):
                    continue
                if x0 - 0.5 <= cx <= x1 + 0.5 and y0 - 0.5 <= cy <= y1 + 0.5 and (s["rect"] or pip(cx, cy, s["poly"])):
                    s["digits"].append(c["text"])
                    break

        booths, tiers = [], {}
        for (x0, y0, x1, y1), s in shapes.items():
            num = "".join(s["digits"])
            if not re.fullmatch(r"\d{3}", num):
                raise SystemExit(f"booth at {x0},{y0} has no clean number: {num!r}")
            if s["tier"] not in tiers and s["tier"] != "feature":
                p = s["poly"]
                cx = sum(q[0] for q in p) / len(p)
                cy = sum(q[1] for q in p) / len(p)
                # sample just inside a corner, away from the printed number
                tiers[s["tier"]] = sample(p[0][0] + (cx - p[0][0]) * 0.18, p[0][1] + (cy - p[0][1]) * 0.18)
            booth = {"id": f"b{num}", "number": num, "name": names.get(num), "tier": s["tier"], "poly": to_m(s["poly"])}
            if num in tags:
                booth["tags"] = tags[num]
            booths.append(booth)
        booths.sort(key=lambda b: b["number"])
        tiers["feature"] = "#ffffff"

        areas = []
        for k, o in white.items():
            if k in IGNORE or k in WHITE_BOOTHS:
                continue
            if k not in AREAS:
                if o["x1"] < MAP_MAX_X and o["bottom"] < 655:
                    print("unlabelled white area skipped:", k, file=sys.stderr)
                continue
            aid, name, kind = AREAS[k]
            areas.append({"id": aid, "name": name, "kind": kind, "poly": to_m(poly_of(o))})
        missing = [v[0] for k, v in AREAS.items() if k not in white]
        if missing:
            raise SystemExit(f"labelled areas not found in the PDF: {missing}")

        points = [{"id": pid, "name": name, "kind": kind, "at": pt_m(x, y)} for pid, name, kind, x, y in POINTS]
        points += [{"id": z["id"], "name": z["name"], "kind": "zone", "at": z["at"]} for z in zones]

        xs = [p[0] for p in to_m(outline)]
        ys = [p[1] for p in to_m(outline)]
        bundle = {
            "id": "kcna26",
            "name": "KubeCon + CloudNativeCon North America 2026",
            "subtitle": "Solutions Showcase",
            "version": 1,
            "units": "m",
            "scaleNote": "1 PDF point = %.4f m, assuming a platinum booth is 20 ft square" % M_PER_PT,
            # Approximate position; the app refines it by geocoding the address with Radar.
            "geo": {"place": "Salt Palace Convention Center", "address": "100 S West Temple St, Salt Lake City, UT 84101", "lat": 40.7672, "lng": -111.8955},
            "size": [round(max(xs) + 6, 1), round(max(ys) + 6, 1)],
            "outline": to_m(outline),
            "zones": [{k: v for k, v in z.items() if k != "at"} for z in zones],
            "tiers": tiers,
            "booths": booths,
            "areas": areas,
            "points": points,
        }
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(bundle, f, separators=(",", ":"), ensure_ascii=False)
    unnamed = [b["number"] for b in booths if not b["name"]]
    listed_not_drawn = sorted(set(names) - {b["number"] for b in booths})
    print(f"booths {len(booths)} | areas {len(areas)} | points {len(points)} | zones {len(zones)}")
    print("booths with no exhibitor listed:", unnamed)
    print("exhibitor numbers with no booth on the map:", listed_not_drawn)
    print("size (m):", bundle["size"], "| tiers:", tiers)


if __name__ == "__main__":
    main(*sys.argv[1:6])
