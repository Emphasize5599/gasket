"""
Hydrogen consumption vs speed: a PHYSICS FALLBACK, NOT VALIDATED. No steady-speed FCEV measurement was reproduced.

    hydrogen mass flow [kg/h] = P_fc_net [kW] / ( eta_fcs(P_fc_net) x LHV [kWh/kg] )
    P_fc_net [kW]             = P_wheel(v) / eta_d  +  P_aux                      (traction + vehicle auxiliaries)
    kg/km                     = (kg/h) / v [km/h]

Included: wheel road load (A + B v + C v^2, plus grade), electric drive efficiency eta_d (motor + inverter + DC/DC),
auxiliary electrical load P_aux (cabin HVAC, 12 V) drawn from the fuel-cell system's NET output.
eta_fcs is the fuel-cell SYSTEM efficiency (net electric out / H2 LHV in), i.e. it already includes the air compressor
and other balance-of-plant loads; do not subtract the compressor again.  Not included: battery buffering (assumed
energy-neutral over a cruise), fuel-cell cold start / warm-up, purge losses, stop-and-go.  Unknown: temperature effects
on eta_fcs and auxiliaries, station-side fill effects.
Sources for the only numbers here: system peak efficiency 63-64 % at < 10 kW net (Argonne 2017 Mirai, via DOE Hydrogen
Program Record 20005 and AMR 2018 tv149) [R]; the shape of eta_fcs above that is an ASSUMPTION.
"""
import numpy as np

LHV_KWH_PER_KG = 119.96 / 3.6          # 33.32 kWh/kg (LHV 119.96 MJ/kg, as used in the Argonne slides)
ETA_FCS_P = [0.0, 10.0, 30.0, 60.0, 90.0]        # kW net
ETA_FCS = [0.60, 0.60, 0.55, 0.50, 0.45]          # [A] shape; 0.60 kept below the reported 0.63-0.64 peak

def eta_fcs(P_kW):
    return float(np.interp(P_kW, ETA_FCS_P, ETA_FCS))

def wheel_kW(v_kmh, A_N, B_N_per_ms, C_N_per_ms2, mass_kg=0.0, grade=0.0):
    v = v_kmh / 3.6
    F = A_N + B_N_per_ms * v + C_N_per_ms2 * v * v + mass_kg * 9.81 * grade
    return F * v / 1000.0

def kg_per_km(v_kmh, P_wheel_kW, eta_d=0.90, P_aux_kW=0.0, eta=None):
    """returns (kg/km, flags). P_wheel_kW at this speed; eta overrides eta_fcs() (tests)."""
    if v_kmh <= 0: raise ValueError('speed must be > 0 km/h')
    P_net = max(0.0, P_wheel_kW) / eta_d + P_aux_kW
    e = eta if eta is not None else eta_fcs(P_net)
    kg_per_h = P_net / (e * LHV_KWH_PER_KG)            # kW / (kWh/kg) = kg/h
    return kg_per_h / v_kmh, ['h2_speed_model_unvalidated']

def kg_per_100km_to_mi_per_kg(x): return 100.0 / x / 1.609344
