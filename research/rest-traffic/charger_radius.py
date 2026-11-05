"""Compare AFDC public EV sites with NTAD parking and the RIDB Facilities export.

Pass the official AFDC CSV, NTAD ArcGIS query JSON and RIDB CSV ZIP in that order.
Counts refer to rest facilities with at least one candidate. Distances are straight
line and facility-type agreement is a proxy, not a verified common entrance.
"""
import collections
import csv
import io
import itertools
import json
import math
import sys
import zipfile

RADII = (25, 50, 100, 150, 250, 500, 1000)
EARTH = 6_371_008.8


def point(lat, lon):
    try:
        lat, lon = float(lat), float(lon)
    except (ValueError, TypeError):
        return None
    if not (-90 <= lat <= 90 and -180 <= lon <= 180) or (lat == lon == 0):
        return None
    a, b = math.radians(lat), math.radians(lon)
    return (EARTH * math.cos(a) * math.cos(b), EARTH * math.cos(a) * math.sin(b), EARTH * math.sin(a))


def cell(p):
    return tuple(math.floor(x / RADII[-1]) for x in p)


def load_chargers(path):
    grid = collections.defaultdict(list)
    totals = collections.Counter()
    with open(path, encoding='utf-8-sig', newline='') as f:
        for row in csv.DictReader(f):
            totals['source rows'] += 1
            if (row['Fuel Type Code'], row['Status Code'], row['Country'], row['Access Code']) != ('ELEC', 'E', 'US', 'public'):
                continue
            if row['Restricted Access'].strip().lower() in {'true', 'yes', '1', 't'}:
                totals['restricted'] += 1
                continue
            p = point(row['Latitude'], row['Longitude'])
            if p is None:
                totals['missing coordinates'] += 1
                continue
            dc = int(row['EV DC Fast Count'] or 0) > 0
            l2 = int(row['EV Level2 EVSE Num'] or 0) > 0
            grid[cell(p)].append((p, row['Facility Type'], dc, row['Station Name'], row['ID'], l2))
            totals['eligible'] += 1
    print('AFDC:', dict(totals))
    return grid


def report(label, locations, grid, same_type):
    counts = {r: collections.Counter() for r in RADII}
    examples = collections.defaultdict(list)
    valid = invalid = 0
    for key, name, lat, lon in locations:
        p = point(lat, lon)
        if p is None:
            invalid += 1
            continue
        valid += 1
        c = cell(p)
        matches = []
        for delta in itertools.product((-1, 0, 1), repeat=3):
            for q, kind, dc, station, sid, l2 in grid.get(tuple(i + j for i, j in zip(c, delta)), ()):
                chord = math.dist(p, q)
                if chord <= RADII[-1]:
                    meters = 2 * EARTH * math.asin(chord / (2 * EARTH))
                    matches.append((meters, kind, dc, station, sid, l2))
        for r in RADII:
            near = [m for m in matches if m[0] <= r]
            counts[r]['any'] += bool(near)
            counts[r]['DC'] += any(m[2] for m in near)
            counts[r]['Level 2'] += any(m[5] for m in near)
            counts[r]['similar facility type'] += any(m[1] in same_type for m in near)
            counts[r]['similar facility type DC'] += any(m[1] in same_type and m[2] for m in near)
        if matches:
            closest = min(matches)
            band = next((r for r in RADII if closest[0] <= r), None)
            if band is not None:
                examples[(band, closest[1] in same_type)].append((round(closest[0]), key, name, *closest[1:]))
    print(label, 'coordinate-valid:', valid, 'without valid coordinates:', invalid)
    print('meters,any,DC,Level 2,similar facility type,similar facility type DC')
    for r, c in counts.items():
        print(r, *(c[k] for k in ('any', 'DC', 'Level 2', 'similar facility type', 'similar facility type DC')), sep=',')
    for bucket, rows in sorted(examples.items()):
        print('examples', bucket, sorted(rows)[::max(1, len(rows)//4)][:4])


def ntad(path):
    with open(path, encoding='utf-8-sig') as f:
        data = json.load(f)
    if data.get('exceededTransferLimit'):
        raise ValueError('Incomplete NTAD download')
    for row in data['features']:
        a, g = row['attributes'], row.get('geometry') or {}
        yield a['OBJECTID'], a['nhs_rest_stop'], g.get('y'), g.get('x')


def ridb(path, campgrounds_only=False):
    with zipfile.ZipFile(path) as archive:
        entry = next(n for n in archive.namelist() if n.rsplit('/', 1)[-1].lower().startswith('facilities') and n.lower().endswith('.csv'))
        with archive.open(entry) as f:
            for row in csv.DictReader(io.TextIOWrapper(f, encoding='utf-8-sig')):
                if row.get('Enabled', '').lower() in {'false', '0'}:
                    continue
                if campgrounds_only and row['FacilityTypeDescription'] != 'Campground':
                    continue
                yield row['FacilityID'], row['FacilityName'], row['FacilityLatitude'], row['FacilityLongitude']


if __name__ == '__main__':
    afdc, parking, recreation = sys.argv[1:]
    chargers = load_chargers(afdc)
    report('NTAD all parking facilities', ntad(parking), chargers, {'REST_STOP', 'TRAVEL_CENTER', 'TRUCK_STOP'})
    report('RIDB all enabled facilities', ridb(recreation), chargers, {'CAMPGROUND', 'RV_PARK', 'NATL_PARK', 'PARK'})
    report('RIDB enabled campgrounds', ridb(recreation, campgrounds_only=True), chargers, {'CAMPGROUND', 'RV_PARK'})
