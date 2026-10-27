"""Research adapter: RV Parky links verified against its October 27, 2026 UI.

Not wired into the app's future rest-stop screen. No review/rating parameters.
Public URL format observations only; no third-party implementation copied.
"""
from math import isfinite
from urllib.parse import urlencode


CATEGORIES = dict(rv_park=1, public_park=2, military_park=3, age55_park=4,
                  koa=5, rest_area=6, walmart=7, cabelas=8, cracker_barrel=9,
                  camping_world=10, flying_j=11, pilot=12, ta=13, petro=14,
                  loves=15, gas_other=16, road_warning=17, jellystone=18,
                  casino=19)
AMENITIES = dict(water_hookup=1, electric=2, amp50=3, sewer=4, wifi=5,
                 cable=6, pool=7, pets=8, tents=9, pull_through=10,
                 big_rig=11, shade=12, accessible=13, restaurant=14,
                 picnic_tables=16, restrooms=17, laundry=18, showers=19,
                 fire_pit=21, dump_station=22, overnight_stores=23,
                 pet_area=24, playground=25, propane=26, boat_launch=27,
                 fishing=28)


def _mask(names, schema):
    result = 0
    for name in names:
        if name not in schema:
            raise ValueError('Unsupported RV Parky filter: ' + str(name))
        result |= 1 << (schema[name] - 1)
    return result


def rvparky_link(label, latitude, longitude, *, categories=None, amenities=(), radius=None):
    if not label or not all(isfinite(v) for v in (latitude, longitude)):
        raise ValueError('A label and finite coordinates are required')
    if not (-90 <= latitude <= 90 and -180 <= longitude <= 180):
        raise ValueError('Coordinates out of range')
    if radius not in (None, 5, 10, 25, 50, 100):
        raise ValueError('Unsupported radius; never silently round a required filter')
    if categories is None:
        category_mask = 0x7fffffff
    else:
        selected = _mask(categories, CATEGORIES)
        if not selected:
            raise ValueError('Select at least one category')
        # Preserve the site's default reserved category flags, outside the 19 known controls.
        category_mask = 0x7ff80000 | selected
    amenity_mask = _mask(amenities, AMENITIES)
    # f is TWO separately parsed hex chunks, not one integer or a JavaScript bitmask.
    filters = f'{category_mask:08x}{amenity_mask:x}'
    query = dict(l=label, x=latitude, y=longitude, f=filters)
    if radius is not None:
        query['d'] = radius
    return 'https://www.rvparky.com/search?' + urlencode(query)
