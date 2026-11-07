#!/usr/bin/env python3
"""Build assets/web/evroadload-data.js: every EPA-listed battery EV with its EPA coast-down
road-load coefficients, when a test vehicle matches.

Usage: python3 -I tools/gen-ev-roadload.py <testcar dir> <vehicles.csv.zip> [out.js]
Sources (U.S. government works, public domain):
  EPA Test Car List workbooks (MY2017+): https://www.epa.gov/compliance-and-fuel-economy-data/data-cars-used-testing-fuel-economy
  fueleconomy.gov vehicles data: https://www.fueleconomy.gov/feg/epadata/vehicles.csv.zip
Test rows kept: Electricity test fuel and an EV displacement marker (under 0.1 L, or 99.99 L in older years;
plug-in hybrids report their engine).
Each fueleconomy.gov EV (atvType EV) is matched by model year, make and model words; wheel sizes
in the name pick that wheel's rows; several equally good rows are averaged. The same year is tried
first, then the year before and after (marked). Needs openpyxl.
"""
import csv, glob, io, json, os, re, sys, zipfile
import openpyxl

def norm_make(s):
    return re.sub(r'[^A-Z0-9]', '', str(s or '').upper())

WHEEL = re.compile(r'(\d{2})\s*(?:"|\'\'|in\b|inch|-inch)', re.I)

def tokens(s):
    s = str(s or '')
    wheel = set('w' + m for m in WHEEL.findall(s))
    s = WHEEL.sub(' ', s)
    s = s.lower()
    s = re.sub(r'\b([a-z]+)[ -]+(\d+)\b', r'\1\2', s)       # "model 3" -> "model3", "edrive 35" -> "edrive35", "f-150" -> "f150"
    s = re.sub(r'\bmodel ([a-z])\b', r'model\1', s)            # "model s" -> "models"
    out = [t for t in re.split(r'[^a-z0-9]+', s) if t]
    drop = {'wheels', 'wheel', 'and', 'with', 'the'}
    syn = {'4wd': 'awd', '2wd': 'rwd', 'allwheel': 'awd'}
    return [syn.get(t, t) for t in out if t not in drop], wheel

def load_tests(src):
    rows = {}
    for f in sorted(glob.glob(os.path.join(src, '*.xlsx'))):
        ws = openpyxl.load_workbook(f, read_only=True).active
        it = ws.iter_rows(values_only=True)
        head = [str(h or '') for h in next(it)]
        ix = {}
        for k in ['Model Year', 'Represented Test Veh Make', 'Represented Test Veh Model', 'Test Fuel Type Description',
                  'Test Veh Displacement', 'Target Coef A', 'Target Coef B', 'Target Coef C']:
            ix[k] = next((i for i, h in enumerate(head) if h.startswith(k)), None)
        for r in it:
            g = lambda k: r[ix[k]] if ix[k] is not None else None
            if str(g('Test Fuel Type Description') or '') != 'Electricity':
                continue
            try:
                disp = float(g('Test Veh Displacement') or 0)
                y, a, b, c = int(g('Model Year')), float(g('Target Coef A')), float(g('Target Coef B')), float(g('Target Coef C'))
            except (TypeError, ValueError):
                continue
            if 0.1 <= disp < 99 or a <= 0 or c <= 0:
                continue
            mk = ' '.join(str(g('Represented Test Veh Make') or '').split())
            md = ' '.join(str(g('Represented Test Veh Model') or '').split())
            key = (y, mk, md)
            rows.setdefault(key, set()).add((a, b, c))
    by = {}
    for (y, mk, md), sets in rows.items():
        by.setdefault(y, []).append((mk, md, sets))
    return by

def candidates(by, year, make):
    # the test list sometimes carries part of the model in its make field ("TESLA MODEL S", "POLESTAR 2 DUAL
    # MOTOR") or lists a brand under its parent ("MINI COOPER SE" under BMW, "Smart Fortwo" under Mercedes-Benz)
    want = norm_make(make)
    for mk, md, sets in by.get(year, []):
        words, extra = mk.split(), None
        for k in range(1, len(words) + 1):
            if norm_make(' '.join(words[:k])) == want:
                extra = ' '.join(words[k:]); break
        name, made = md, words
        if extra is None:
            made = []
            if want.lower() not in tokens(md)[0]:
                continue
        else:
            name, made = (extra + ' ' + md).strip(), words[:len(words) - len(extra.split())] if extra else words
        t, w = tokens(name)
        yield name, set(t) - {want.lower()} - set(norm_make(x).lower() for x in made), w, sets

def match(by, year, make, model, base):
    want, wheel = tokens(model)
    want = set(want)
    core = [t for t in tokens(model)[0] if t != norm_make(make).lower()][:1]   # the model's main word (bolt, model3, polestar2)
    for dy in (0, -1, 1):
        cands = candidates(by, year + dy, make)
        best, rows = -1, []
        for md, t, w, sets in cands:
            if not set(core) <= t:
                continue
            score = len(want & t) / max(1, len(want | t))
            if wheel and w:
                score += .25 if wheel & w else -.25
            if score > best + 1e-9:
                best, rows = score, [(md, sets)]
            elif abs(score - best) <= 1e-9:
                rows.append((md, sets))
        if rows:
            coef = [c for _, sets in rows for c in sets]
            a = sum(c[0] for c in coef) / len(coef); b = sum(c[1] for c in coef) / len(coef); c = sum(c[2] for c in coef) / len(coef)
            return round(a, 2), round(b, 4), round(c, 5), dy, [m for m, _ in rows]
    return None

def main(src, feg, out):
    by = load_tests(src)
    z = zipfile.ZipFile(feg)
    rd = csv.DictReader(io.TextIOWrapper(z.open(z.namelist()[0]), encoding='utf-8', errors='replace'))
    evs = sorted({(int(x['year']), x['make'].strip(), x['model'].strip(), x['baseModel'].strip()) for x in rd if x['atvType'] == 'EV'})
    data, hit, report = [], 0, []
    for y, mk, md, base in evs:
        m = match(by, y, mk, md, base) if y >= 2016 else None
        if m:
            hit += 1
            row = [y, mk, md, m[0], m[1], m[2]]
            if m[3]:
                row.append(y + m[3])   # coefficients from this model year's test vehicle
            data.append(row)
            report.append('%d %s %s  <=  %s%s' % (y, mk, md, ' | '.join(m[4]), (' (MY%d)' % (y + m[3])) if m[3] else ''))
        else:
            data.append([y, mk, md])
            if y >= 2017:
                report.append('%d %s %s  <=  (none)' % (y, mk, md))
    body = json.dumps(data, separators=(',', ':'))
    with open(out, 'w') as fh:
        fh.write('/* Generated by tools/gen-ev-roadload.py from U.S. EPA Test Car List and fueleconomy.gov data (public domain).\n'
                 ' * Every EPA-listed battery EV: [year, make, model] or [year, make, model, coast-down A lbf, B lbf/mph,\n'
                 ' * C lbf/mph^2, (test model year when a neighboring year supplied them)]. */\n'
                 '(function(root){var D=' + body + ';if(typeof module!=="undefined"&&module.exports)module.exports=D;else root.EV_ROADLOAD_DATA=D;})(this);\n')
    with open(out + '.report.txt', 'w') as fh:
        fh.write('\n'.join(report) + '\n')
    recent = [r for r in data if r[0] >= 2017]
    print(len(data), 'EVs;', hit, 'with road-load;', sum(1 for r in recent if len(r) > 3), 'of', len(recent), 'MY2017+;', os.path.getsize(out), 'bytes')

if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2], sys.argv[3] if len(sys.argv) > 3 else 'assets/web/evroadload-data.js')
