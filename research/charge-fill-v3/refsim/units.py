"""Unit conventions used everywhere in refsim (internal SI-ish):
distance km, speed km/h, time s (minutes/hours only at the edges), power kW, energy kWh, SOC as a FRACTION 0..1,
temperature degC, mass kg, hydrogen kg.  Gasket's UI works in miles / mph / minutes / percent: convert at the edges only."""
KM_PER_MI = 1.609344

def mi_to_km(mi): return mi * KM_PER_MI
def km_to_mi(km): return km / KM_PER_MI
def mph_to_kmh(v): return v * KM_PER_MI
def kmh_to_mph(v): return v / KM_PER_MI
def kmh_to_ms(v): return v / 3.6
def s_to_min(s): return s / 60.0
def min_to_s(m): return m * 60.0
def s_to_h(s): return s / 3600.0
def h_to_s(h): return h * 3600.0
def kw_s_to_kwh(kw, s): return kw * s / 3600.0          # power x time -> energy
def wh_per_km_to_wh_per_mi(x): return x * KM_PER_MI
def pct_to_frac(p): return p / 100.0
def frac_to_pct(f): return f * 100.0

def check_frac(name, x):
    """SOC inputs must be fractions; a value like 80 (percent) is a user/unit error, not something to clamp."""
    if not (0.0 <= x <= 1.0):
        raise ValueError(f'{name}={x!r} is not a SOC fraction in [0, 1] (percent passed by mistake?)')
    return x
