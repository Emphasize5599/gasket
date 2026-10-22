"""Synthetic reference cases (generic, no real places). Distances/limits are given in miles/mph and converted once."""
import math
from .units import mi_to_km, mph_to_kmh

def const(Ta): return lambda h: Ta
def diurnal(mean, amp): return lambda h: mean + amp * math.cos((h % 24 - 15) / 24 * 2 * math.pi)

def route(L_mi, limits, stations, soc0, T0, t0_h, ambient, start_price=0.14, precond=False):
    """limits: [(from_mi, to_mi, limit_mph)], stations: [(mi, kW, $/kWh billed, basis, share)]"""
    return dict(L_km=mi_to_km(L_mi),
                segments=[(mi_to_km(a), mi_to_km(b), mph_to_kmh(v), 0.0) for a, b, v in limits],
                stations=[dict(km=mi_to_km(m), kW=k, price=pr, basis=b, share=sh) for m, k, pr, b, sh in stations],
                soc0=soc0, T0=T0, t0_h=t0_h, ambient=ambient, start_price=start_price, precond_available=precond)

def st(mi, kW=150, price=0.48, basis='dc_meter', share=1.0): return (mi, kW, price, basis, share)

PRICES = [0.42, 0.56, 0.39, 0.52, 0.47, 0.44]     # differing station prices ($ per billed kWh)

def cases():
    A_st = [st(45 * (i + 1), price=PRICES[i]) for i in range(4)]
    return {
        'A_mild_75mph': route(220, [(0, 100, 75), (100, 110, 65), (110, 220, 75)], A_st, 0.90, 25, 9, const(15)),
        'B_cold_noprecond': route(220, [(0, 220, 75)], A_st, 0.90, 0, 8, const(0)),
        'B2_cold_precond': route(220, [(0, 220, 75)], A_st, 0.90, 0, 8, const(0), precond=True),
        'C_stopcount_70mph': route(155, [(0, 155, 70)], [st(78, price=0.50)], 0.85, 20, 9, const(15)),
        'D_gap_75mph': route(180, [(0, 180, 75)], [], 1.00, 20, 9, const(10)),
        'E_50kW_70mph': route(310, [(0, 310, 70)], [st(50 * (i + 1), kW=50, price=PRICES[i]) for i in range(5)], 0.90, 20, 9, const(15)),
        'F_hot_75mph': route(220, [(0, 220, 75)], A_st, 0.90, 35, 11, const(35)),
        'G_cold_evening': route(280, [(0, 280, 75)], [st(56 * (i + 1), price=PRICES[i]) for i in range(4)], 0.90, 5, 15, diurnal(2, 4)),
        'H_mixed_limits_prices': route(260, [(0, 60, 55), (60, 200, 80), (200, 260, 65)],
                                       [st(70, price=0.60), st(120, price=0.30, kW=120), st(170, price=0.58), st(215, price=0.33, kW=60)],
                                       0.80, 18, 10, const(18)),
    }

CONS = dict(reserve=0.10, arrive_min=0.10, soc_cap=0.80, overhead_min=3.0, vmin_mph=45.0, vmax_mph=84.0,
            start_policy='firstDip', allow_over_limit=False)
OFFSETS_MPH = [-20, -15, -10, -5, 0]          # legal candidates: never above the posted limit
