"""
Event-based reference journey simulator (research code for the Gasket handoff, v3).

Units: km, km/h, s, kW, kWh, SOC fraction, degC (see units.py). A speed POLICY is an offset from each segment's legal
limit in mph (offset <= 0 by default), clamped to the user's min/max speed and never above the limit unless
`allow_over_limit` is set explicitly.

Energy boundaries (closed in every result; see `energy_balance`):
  station meter (billed)  --cable/AC-DC losses-->  vehicle inlet  ==  battery terminal energy + vehicle aux while plugged
  battery terminal energy --eta_soc_dc-->  stored energy (SOC x E_full)     (internal losses become pack heat via the
                                                                            fitted heat terms; they are NOT subtracted twice)
  while driving: stored energy decreases by battery-terminal energy (traction incl. 12 V, cabin HVAC, active pack
  heating ELECTRICAL draw, cooling electrical draw).  Active heating delivers precond_eta_heat x draw to the pack.
Statuses never silently pass: every infeasible or failed result carries `ok=False` and a reason code.
"""
import math
from .units import mph_to_kmh, check_frac

MARGIN = 0.01          # SOC margin the heuristic adds to its own forecasts
DX_MAX_KM = 1.0        # maximum driving step; steps also stop exactly at segment ends, stations and the destination
DT_CHARGE_S = 10.0
CHARGE_TIMEOUT_S = 4 * 3600.0

def seg_at(route, x):
    for s in route['segments']:
        if s[0] - 1e-9 <= x < s[1] - 1e-9: return s
    return route['segments'][-1]

def seg_speed(seg, cons):
    """km/h for one segment: limit + offset, within the user's min/max, never above the limit unless allowed."""
    lim = seg[2]
    v = lim + mph_to_kmh(cons['offset_mph'])
    v = max(v, mph_to_kmh(cons.get('vmin_mph', 0.0)))
    v = min(v, mph_to_kmh(cons.get('vmax_mph', 999.0)))
    if not cons.get('allow_over_limit', False): v = min(v, lim)
    return v

def new_state(route, prof):
    soc0 = check_frac('soc0', route['soc0'])
    return dict(x=0.0, soc=soc0, T=float(route['T0']), clock_s=0.0, road_s=0.0, charge_s=0.0, overhead_s=0.0,
                E_drive_term=0.0, E_cool_drive=0.0, E_precond=0.0, E_term_in=0.0, E_aux_charge=0.0, E_inlet=0.0,
                E_billed=0.0, E_stored_gain=0.0, inv_kWh=soc0 * prof.p['E_full_kWh'],
                inv_val=soc0 * prof.p['E_full_kWh'] * route.get('start_price', 0.0), cost_consumed=0.0,
                stops=[], arrivals=[], flags=set())

def copy_state(s):
    c = dict(s); c['stops'] = list(s['stops']); c['arrivals'] = list(s['arrivals']); c['flags'] = set(s['flags']); return c

def ambient_at(route, st):
    return route['ambient'](route['t0_h'] + st['clock_s'] / 3600.0)

def _burn(st, kwh):
    """Gasket-style consumed-energy accounting: burned stored energy takes the inventory's running average price."""
    avg = st['inv_val'] / st['inv_kWh'] if st['inv_kWh'] > 1e-12 else 0.0
    st['cost_consumed'] += kwh * avg; st['inv_val'] -= kwh * avg; st['inv_kWh'] -= kwh

def drive(st, x1, route, prof, cons, precond=False):
    """integrate from st['x'] to x1 (km). Returns True, or False if stored energy hits zero (status 'ran_out')."""
    E = prof.p['E_full_kWh']
    while st['x'] < x1 - 1e-9:
        seg = seg_at(route, st['x'])
        xe = min(x1, seg[1], st['x'] + DX_MAX_KM)
        dx = xe - st['x']
        v = seg_speed(seg, cons); dt = dx / v * 3600.0
        Ta = ambient_at(route, st)
        P = prof.drive_kW(v, Ta, seg[3], st['flags'])
        if P < 0:
            # Excess braking is friction, not energy stored beyond a full battery.
            P = -min(-P, prof.p.get('regen_max_kW', 50.0), max(0.0, 1 - st['soc']) * E * prof.p['eta_soc_dis'] * 3600 / dt)
        heat_in = 0.0
        if precond and st['T'] < prof.p['precond_target']:
            P += prof.p['precond_elec_kW']; heat_in = prof.p['precond_elec_kW'] * prof.p['precond_eta_heat'] * 1000.0
            st['E_precond'] += prof.p['precond_elec_kW'] * dt / 3600.0
        st['T'], cool = prof.thermal_step(st['T'], Ta, P, dt, prof.p['UA_drive'], heat_in, st['flags'])
        e = P * dt / 3600.0 + cool
        st['E_drive_term'] += e; st['E_cool_drive'] += cool
        st['soc'] -= e / prof.p['eta_soc_dis'] / E
        _burn(st, e / prof.p['eta_soc_dis'])
        st['x'] = xe; st['road_s'] += dt; st['clock_s'] += dt
        if st['soc'] < st.get('min_soc', st['soc']): st['min_soc'] = st['soc']
        if st['soc'] < 0: return False
    return True

def charge(st, target, station, route, prof, cons, derate=True):
    """Charge from st['soc'] to `target` (fraction). Returns dict(ok, reason, ...); never treats a failure as success.
    Invalid targets (not a fraction, or above the configured cap) raise/return explicit errors; only numerical
    overshoot of the final step is trimmed (the last step is shortened to land on the target)."""
    check_frac('target', target)
    if target > cons['soc_cap'] + 1e-12:
        return dict(ok=False, reason='target_above_soc_cap', minutes=0.0)
    if target <= st['soc'] + 1e-12:
        return dict(ok=True, reason='no_charge_needed', minutes=0.0)
    E = prof.p['E_full_kWh']; p = prof.p
    inlet_cap = station['kW'] * station.get('share', 1.0) * p['cable_eta']
    t = 0.0; Eterm = Eaux = 0.0
    while st['soc'] < target - 1e-12:
        if t >= CHARGE_TIMEOUT_S:
            return dict(ok=False, reason='charge_timeout', minutes=t / 60.0, E_term=Eterm, E_aux=Eaux)
        Ta = ambient_at(route, dict(st, clock_s=st['clock_s'] + t))
        aux = p['lv_kW'] + (prof.hvac_kW(Ta) if p['occupied_hvac_while_charging'] else 0.0)
        Pterm = min(prof.accept_kW(st['soc'], st['T'], st['flags'], derate), max(0.0, inlet_cap - aux))
        # Cooling shares the same inlet budget as charging, cabin and 12 V loads.
        # Solve jointly; adding cooling after allocating all inlet power violates the cap.
        lo, hi = 0.0, Pterm
        for _ in range(28):
            mid = (lo + hi) / 2
            trial_dt = min(DT_CHARGE_S, max(0.0, target - st['soc']) * E * 3600 / max(mid * p['eta_soc_dc'], 1e-12))
            _, cooling = prof.thermal_step(st['T'], Ta, mid, trial_dt, p['UA_park'], 0.0, st['flags'])
            if mid + aux + cooling * 3600 / trial_dt <= inlet_cap: lo = mid
            else: hi = mid
        Pterm = lo
        if Pterm <= 1e-6:
            return dict(ok=False, reason='charge_no_power', minutes=t / 60.0, E_term=Eterm, E_aux=Eaux)
        gain_rate = Pterm * p['eta_soc_dc'] / E / 3600.0                      # SOC per second
        dt = min(DT_CHARGE_S, (target - st['soc']) / gain_rate)               # last step lands exactly on the target
        T_new, cool = prof.thermal_step(st['T'], Ta, Pterm, dt, p['UA_park'], 0.0, st['flags'])
        st['T'] = T_new
        e_t = Pterm * dt / 3600.0; e_a = aux * dt / 3600.0 + cool             # cooling while plugged comes from the inlet
        Eterm += e_t; Eaux += e_a
        st['soc'] = min(target, st['soc'] + e_t * p['eta_soc_dc'] / E)
        t += dt
    inlet = Eterm + Eaux
    basis = station.get('basis', 'dc_meter')
    billed = inlet / p['cable_eta'] / (p['ac_meter_eta'] if basis == 'ac_meter' else 1.0)
    gain = Eterm * p['eta_soc_dc']
    st['E_term_in'] += Eterm; st['E_aux_charge'] += Eaux; st['E_inlet'] += inlet; st['E_billed'] += billed
    st['E_stored_gain'] += gain; st['charge_s'] += t; st['clock_s'] += t
    st['inv_kWh'] += gain; st['inv_val'] += billed * station.get('price', 0.0)
    return dict(ok=True, reason='charged', minutes=t / 60.0, E_term=Eterm, E_aux=Eaux, inlet=inlet, billed=billed, gain=gain)

def forecast_need(route, prof, cons, st, x0, x1):
    """SOC fraction the heuristic expects to use from x0 to x1 at the current ambient (a forecast, not a guarantee)."""
    Ta = ambient_at(route, st); need = 0.0; f = set()
    for s in route['segments']:
        a, b = max(x0, s[0]), min(x1, s[1])
        if b > a:
            v = seg_speed(s, cons); need += prof.drive_kW(v, Ta, s[3], f) * (b - a) / v
    return need / prof.p['E_full_kWh']

def _arrive(st, idx, cons, first_hop, start_below):
    st['arrivals'].append(dict(at=idx, km=st['x'], soc=st['soc'], T=st['T'], clock_s=st['clock_s']))
    floor = 0.0 if (first_hop and start_below and cons.get('start_policy', 'firstDip') == 'firstDip') else cons['reserve']
    return st['soc'] >= floor - 1e-9

def finish(st, route, prof):
    E = prof.p['E_full_kWh']
    out = dict(ok=True, reason='ok', total_s=st['road_s'] + st['charge_s'] + st['overhead_s'], road_s=st['road_s'],
               charge_s=st['charge_s'], overhead_s=st['overhead_s'], stops=len(st['stops']), stop_list=st['stops'],
               soc_end=st['soc'], T_end=st['T'], E_drive_term=st['E_drive_term'], E_precond=st['E_precond'],
               E_cool_drive=st['E_cool_drive'], E_term_in=st['E_term_in'], E_aux_charge=st['E_aux_charge'],
               E_inlet=st['E_inlet'], E_billed=st['E_billed'], E_stored_gain=st['E_stored_gain'],
               energy_used=(route['soc0'] - st['soc']) * E + st['E_billed'],
               cost=st['cost_consumed'], purchases=sum(s['billed'] * s['price'] for s in st['stops']),
               arrivals=st['arrivals'], flags=sorted(st['flags']))
    out['energy_balance_err_kWh'] = energy_balance(out, route, prof)
    return out

def energy_balance(r, route, prof):
    """stored(end) - stored(start) - [eta_soc_dc*E_term_in - E_drive_term/eta_soc_dis]; should be ~0."""
    E = prof.p['E_full_kWh']; p = prof.p
    return (r['soc_end'] - route['soc0']) * E - (p['eta_soc_dc'] * r['E_term_in'] - r['E_drive_term'] / p['eta_soc_dis'])

def fail(st, reason, **kw):
    d = dict(ok=False, reason=reason, at_km=round(st['x'], 3), soc=st['soc'], flags=sorted(st['flags'])); d.update(kw); return d

def simulate(route, prof, cons, plan='heuristic', derate=True):
    """plan: 'heuristic' (v2 stop rule, corrected) or {station_index: target_soc} (charge there only if below target;
    {..., 'precond': set(indices)} optional). Returns a result dict with ok/reason."""
    check_frac('reserve', cons['reserve']); check_frac('soc_cap', cons['soc_cap'])
    arrive_min = cons.get('arrive_min', cons['reserve'])
    st = new_state(route, prof)
    start_below = st['soc'] < cons['reserve'] - 1e-12
    if start_below:
        st['flags'].add('start_below_reserve')
        if cons.get('start_policy', 'firstDip') == 'strict':
            return fail(st, 'start_below_reserve')
    stations = sorted(route['stations'], key=lambda s: s['km'])
    explicit = plan if isinstance(plan, dict) else None
    pre_set = (explicit or {}).get('precond', set()) if explicit else set()
    for i, sta in enumerate(stations):
        # preconditioning toward station i when it is a planned stop and the route offers preconditioning
        pre = False
        if route.get('precond_available'):
            if explicit is not None: pre = i in pre_set
            else:
                pre = _heuristic_will_charge(route, prof, cons, st, stations, i, arrive_min)
        if pre:
            # heat only during the last precond_max_min before arrival: drive the earlier part without it
            v_avg = seg_speed(seg_at(route, st['x']), cons)
            start_pre = max(st['x'], sta['km'] - v_avg * prof.p['precond_max_min'] / 60.0)
            if not drive(st, start_pre, route, prof, cons, False): return fail(st, 'ran_out')
        if not drive(st, sta['km'], route, prof, cons, pre): return fail(st, 'ran_out')
        if not _arrive(st, i, cons, i == 0, start_below):
            return fail(st, 'reserve_violated', station=i)
        Ta = ambient_at(route, st)
        if explicit is not None:
            tgt = explicit.get(i)
            if tgt is None or tgt <= st['soc'] + 1e-12: continue
        else:
            tgt, why = _heuristic_target(route, prof, cons, st, stations, i, arrive_min)
            if why: return fail(st, why, station=i, proposed_soc_cap=tgt)
            if tgt is None: continue
        r = charge(st, tgt, sta, route, prof, cons, derate)
        if not r['ok']: return fail(st, r['reason'], station=i, minutes=r.get('minutes'))
        st['overhead_s'] += cons['overhead_min'] * 60.0; st['clock_s'] += cons['overhead_min'] * 60.0
        st['stops'].append(dict(station=i, km=sta['km'], target=tgt, minutes=r['minutes'], billed=r['billed'],
                                gain=r['gain'], price=sta.get('price', 0.0), T_plug=st['arrivals'][-1]['T']))
    if not drive(st, route['L_km'], route, prof, cons, False): return fail(st, 'ran_out')
    first = not stations
    st['arrivals'].append(dict(at='dest', km=st['x'], soc=st['soc'], T=st['T'], clock_s=st['clock_s']))
    floor = 0.0 if (first and start_below and cons.get('start_policy', 'firstDip') == 'firstDip') else arrive_min
    if st['soc'] < floor - 1e-9: return fail(st, 'arrives_below_reserve')
    return finish(st, route, prof)

def _heuristic_target(route, prof, cons, st, stations, i, arrive_min):
    """skip if the destination or the next station is reachable with the reserve; otherwise charge just enough for the
    destination (capped by soc_cap) but at least enough for the next station. Exceeding the cap is NOT allowed: the
    result is infeasible with the cap that would be needed ('needs_higher_soc_cap')."""
    x = st['x']; L = route['L_km']
    nxt = stations[i + 1]['km'] if i + 1 < len(stations) else None
    # preconditioning toward the next stop draws energy the plain forecast doesn't include: budget it (conservative)
    pre = (prof.p['precond_elec_kW'] * prof.p['precond_max_min'] / 60.0 / prof.p['E_full_kWh']) if route.get('precond_available') else 0.0
    need_dest = forecast_need(route, prof, cons, st, x, L)
    if st['soc'] - need_dest >= arrive_min: return None, None
    if nxt is not None and st['soc'] - forecast_need(route, prof, cons, st, x, nxt) - pre >= cons['reserve']: return None, None
    want_dest = arrive_min + need_dest + MARGIN
    want_next = cons['reserve'] + forecast_need(route, prof, cons, st, x, nxt) + pre + MARGIN if nxt is not None else want_dest
    tgt = min(want_dest, cons['soc_cap'])
    if tgt < want_next - 1e-12:
        return round(min(want_next, 1.0), 3), ('needs_higher_soc_cap' if want_next <= 1.0 else 'gap_beyond_full_range')
    return tgt, None

def _heuristic_will_charge(route, prof, cons, st, stations, i, arrive_min):
    """look-ahead used only to decide preconditioning toward station i (what a navigation system would plan)."""
    s2 = copy_state(st)
    need = forecast_need(route, prof, cons, s2, s2['x'], stations[i]['km'])
    s2['soc'] -= need; s2['x'] = stations[i]['km']
    tgt, why = _heuristic_target(route, prof, cons, s2, stations, i, arrive_min)
    return tgt is not None and not why
