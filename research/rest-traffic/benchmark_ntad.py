"""Reproduce the public rest-area inventory experiment; no third-party packages."""
import argparse
import gzip
import hashlib
import json
import time
import urllib.parse
import urllib.request
from pathlib import Path

LAYER = ('https://services.arcgis.com/xOi1kZaI0eWDREZv/ArcGIS/rest/services/'
         'NTAD_Truck_Stop_Parking/FeatureServer/0')
FIELDS = 'OBJECTID,nhs_rest_stop,highway_route,mile_post,state,number_of_spots'


def download():
    records, raw_bytes, requests = [], 0, 0
    while True:
        query = dict(where='1=1', outFields=FIELDS, outSR='4326',
                     returnGeometry='true', f='json', orderByFields='OBJECTID',
                     resultRecordCount=2000, resultOffset=len(records))
        url = LAYER + '/query?' + urllib.parse.urlencode(query)
        with urllib.request.urlopen(url, timeout=30) as response:
            body = response.read()
        j = json.loads(body)
        if j.get('error'):
            raise RuntimeError(j['error'])
        page = j['features']
        raw_bytes += len(body)
        requests += 1
        records.extend(page)
        if not j.get('exceededTransferLimit'):
            return records, raw_bytes, requests
        if not page or requests >= 50:
            raise RuntimeError('Incomplete inventory; pagination did not finish')


def summarize(records):
    compact = []
    seen = set()
    for f in records:
        a, g = f['attributes'], f['geometry']
        if a['OBJECTID'] in seen or not (-180 <= g['x'] <= 180 and -90 <= g['y'] <= 90):
            raise ValueError('Duplicate identity or invalid coordinates')
        seen.add(a['OBJECTID'])
        compact.append([a['OBJECTID'], a['nhs_rest_stop'], a['highway_route'],
                        a['mile_post'], a['state'], a['number_of_spots'], g['y'], g['x']])
    encoded = json.dumps(compact, separators=(',', ':')).encode()
    return dict(records=len(records), states=len({f['attributes']['state'] for f in records}),
                compactBytes=len(encoded), compactGzipBytes=len(gzip.compress(encoded)),
                sha256=hashlib.sha256(encoded).hexdigest())


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument('--download', action='store_true')
    source.add_argument('--input', type=Path)
    args = parser.parse_args()
    start = time.perf_counter()
    if args.download:
        records, raw_bytes, requests = download()
    else:
        body = args.input.read_bytes()
        records, raw_bytes, requests = json.loads(body)['features'], len(body), 0
    acquired_ms = (time.perf_counter() - start) * 1000
    summary = summarize(records)
    summary.update(source=LAYER, requests=requests, responseBytes=raw_bytes,
                   acquireMs=round(acquired_ms, 2),
                   normalizeMs=round((time.perf_counter() - start) * 1000 - acquired_ms, 2))
    print(json.dumps(summary, indent=2))
