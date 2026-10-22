"""
Vehicle profile "M3-LFP": TUM 2020 Tesla Model 3 SR+ (CATL LFP, ~55 kWh). ONE car.
Coefficients come from the bundle's derived files (scripts 03, 06, 10) or are named assumptions below.
Every function that leaves its measured range adds a flag string to the `flags` set it is given; clamping an input
keeps the model numerically bounded but does NOT mean the result is validated at the real condition.
"""
import json, os
from bisect import bisect_right
import numpy as np
import pandas as pd

def interp(x, xs, ys):
    """scalar linear interpolation with end-holding (same result as numpy.interp, without per-call array overhead)"""
    if x <= xs[0]: return ys[0]
    if x >= xs[-1]: return ys[-1]
    i = bisect_right(xs, x)
    x0, x1 = xs[i - 1], xs[i]; y0, y1 = ys[i - 1], ys[i]
    return y0 + (y1 - y0) * (x - x0) / (x1 - x0)

HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_DERIVED = os.path.join(HERE, '..', 'baseline_v2', 'derived')

# Measured / fitted validity ranges (from the data, see report §B)
RANGE = dict(
    v_kmh=(15.0, 160.0),        # dyno constant-speed runs
    ambient_C=(-8.5, 32.5),     # D2 drive ambients (moving median)
    pack_C=(-8.75, 45.0),       # D2 coldest-cell range used by the warm-up fit
    derate_C=(19.0, 46.0),      # D1 unconditioned session coverage (+ assumed 1.0 at >= 46 C)
    soc_table=(0.19, 0.83),     # D1 warm session SOC coverage
)
COLD_TERM_FLOOR_C = -10.0       # q2 * P^2 * max(0, 20 - T) uses T >= -10 C (bounded, not extrapolated further)

class Profile:
    def __init__(self, derived=DEFAULT_DERIVED, **over):
        rl = json.load(open(os.path.join(derived, 'road_load_fit.json')))['batt_power_poly_W']
        wu = json.load(open(os.path.join(derived, 'warmup_lodo_summary.json')))['coef_all_data']['M4']
        warm = pd.read_csv(os.path.join(derived, 'dc_warm_curve_by_soc.csv'))
        der = pd.read_csv(os.path.join(derived, 'dc_temp_derate_uncond.csv'))
        self.poly = [rl['p0'], rl['p1'], rl['p2'], rl['p3']]                 # W, v in m/s           [F, 44 dyno runs]
        self.p = dict(
            E_full_kWh=55.4,        # [M] BMS full-pack estimate (D1)
            eta_soc_dc=0.933,       # [D] stored-energy gain / battery-terminal energy in, DC (1 session)
            eta_soc_dis=1.00,       # [D] SOC-energy / terminal energy while driving (33 drives)
            C=479000.0,             # J/K [R] Rosenberger 2024 (from masses)
            UA_park=22.2,           # W/K [R/F]
            UA_drive=wu[3],         # W/K [F] 06 M4
            q=list(wu[:3]),         # [F] kW, kW/kW^2, kW/kW^2/K
            P_heat_cap_kW=60.0,     # [A] P clip in the heat formula
            T_cool_set=45.0,        # [A] active cooling holds T <= this
            chiller_COP=2.0,        # [A] electric = removed heat / COP
            precond_elec_kW=3.0,    # [A] electrical draw of active pack heating (D1 waste-heat mode drive-unit power ~2.5-3 kW)
            precond_eta_heat=0.8,   # [A] fraction of that draw delivered to the PACK (rest heats drive unit/coolant/air)
            precond_target=40.0,    # [A]
            precond_max_min=30.0,   # [A]
            lv_kW=0.37,             # [M] 12 V load (already INSIDE the dyno drive curve; used only while parked/charging)
            occupied_hvac_while_charging=True,   # [A] cabin conditioned during a charging stop
            road_scale=0.97,        # [D] real/dyno steady-window median
            c_cold=0.12,            # [D] cold road factor at 0 C (see cold_factor)
            hvac=[(-10, 1.8), (5, 1.8), (10, 1.1), (15, 0.7), (20, 0.43), (25, 0.2), (30, 0.6), (35, 1.0), (45, 1.6)],
            #   kW cabin HVAC: <=25 C [M] this driver's PTC medians; >=30 C [A] A/C estimate
            cable_eta=0.98,         # [A] dispenser meter -> vehicle inlet
            ac_meter_eta=0.847,     # [D] EPFL Energy / integral(P_AC): AC->DC at that station
            mass_kg=1750.0, eta_up=0.90, eta_regen=0.80,   # [A] grade term
        )
        self.p.update(over)
        self.SOC = warm.soc.values.astype(float) / 100.0
        I = warm.I_A.values.astype(float)
        self.I = np.maximum.accumulate(I[::-1])[::-1]       # monotone envelope above the 19 % ramp-up bin
        self.V = warm.V.values.astype(float)
        self.Tw = warm.Tmin.values.astype(float)
        self.der_T = np.r_[5.0, der.Tb.values.astype(float), 46.0]
        self.der_f = np.r_[0.10, der.f.values.astype(float), 1.0]   # < 19 C: extrapolated to 0.10 at 5 C [A]
        self._S, self._I, self._V, self._Tw = [float(v) for v in self.SOC], [float(v) for v in self.I], [float(v) for v in self.V], [float(v) for v in self.Tw]
        self._dT, self._df = [float(v) for v in self.der_T], [float(v) for v in self.der_f]

    # ---------- driving ----------
    def cold_factor(self, Ta, flags):
        """1 + c_cold * x, x = (15 - Ta)/15 clipped to [0, 4/3]: 0 at >=15 C, +c_cold at 0 C, +4/3*c_cold at <=-5 C (held).
        Measured windows reached about -8 C ambient; below -5 C the factor is held, not extrapolated."""
        if Ta < RANGE['ambient_C'][0] or Ta > RANGE['ambient_C'][1]: flags.add('ambient_outside_measured')
        return 1.0 + self.p['c_cold'] * min(max((15.0 - Ta) / 15.0, 0.0), 4.0 / 3.0)

    def hvac_kW(self, Ta):
        h = self.p['hvac']
        if getattr(self, '_hv', None) is not h: self._hv = h; self._hx = [a for a, _ in h]; self._hy = [b for _, b in h]
        return interp(Ta, self._hx, self._hy)

    def traction_kW(self, v_kmh, flags):
        lo, hi = RANGE['v_kmh']
        if v_kmh < lo or v_kmh > hi: flags.add('speed_outside_dyno_range')
        v = v_kmh / 3.6; c = self.poly
        return (c[0] + c[1] * v + c[2] * v * v + c[3] * v ** 3) / 1000.0     # includes the 12 V load (dyno battery power)

    def drive_kW(self, v_kmh, Ta, grade, flags):
        """battery-terminal power while driving (kW): traction x road scale x cold factor + cabin HVAC + grade."""
        g = self.p['mass_kg'] * 9.81 * grade * v_kmh / 3.6 / 1000.0
        g = g / self.p['eta_up'] if g > 0 else g * self.p['eta_regen']
        return self.traction_kW(v_kmh, flags) * self.p['road_scale'] * self.cold_factor(Ta, flags) + self.hvac_kW(Ta) + g

    # ---------- thermal ----------
    def heat_W(self, P_kW, T, flags):
        if T < RANGE['pack_C'][0] or T > RANGE['pack_C'][1]: flags.add('pack_temp_outside_fit')
        P = min(abs(P_kW), self.p['P_heat_cap_kW'])
        if abs(P_kW) > self.p['P_heat_cap_kW']: flags.add('heat_power_clipped')
        Tc = max(T, COLD_TERM_FLOOR_C)
        q = self.p['q']
        return 1000.0 * (q[0] + q[1] * P * P + q[2] * P * P * max(0.0, 20.0 - Tc))

    def thermal_step(self, T, Ta, P_batt_kW, dt, ua, heat_in_W, flags):
        """advance pack temperature; returns (T_new, cooling electrical energy kWh). Cooling holds T <= T_cool_set."""
        Tn = T + dt * (self.heat_W(P_batt_kW, T, flags) + heat_in_W - ua * (T - Ta)) / self.p['C']
        cool = 0.0
        if Tn > self.p['T_cool_set']:
            cool = (Tn - self.p['T_cool_set']) * self.p['C'] / 3.6e6 / self.p['chiller_COP']; Tn = self.p['T_cool_set']
        return Tn, cool

    # ---------- DC acceptance ----------
    def accept_kW(self, soc, T, flags, derate=True):
        """battery-terminal power the car accepts at SOC fraction soc and pack T (vehicle limit only, no station cap)."""
        s0, s1 = RANGE['soc_table']
        s = min(max(soc, self.SOC[0]), self.SOC[-1])
        I = interp(s, self._S, self._I); V = interp(s, self._S, self._V)
        if soc > self.SOC[-1]:
            flags.add('soc_above_measured_curve')
            I *= max(0.0, 1.0 - 0.85 * (soc - self.SOC[-1]) / (1.0 - self.SOC[-1]))   # [A] fall to 15 % at 100 %
        if soc < s0: flags.add('soc_below_measured_curve')
        f = 1.0
        if derate:
            if T < RANGE['derate_C'][0]: flags.add('derate_extrapolated_cold')
            Tw = interp(s, self._S, self._Tw)
            f = min(1.0, interp(T, self._dT, self._df) / interp(Tw, self._dT, self._df))
        return I * V / 1000.0 * f
