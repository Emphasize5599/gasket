"""
Reference search over WHERE to charge and HOW MUCH (and whether to precondition toward a stop) at a fixed speed policy.

`dp_search`: forward dynamic programming over stations. Labels = states on arrival at a station, kept per SOC bin
(width BIN) with the best objective-so-far (ties -> warmer pack). Pack temperature and clock ride along in the label,
so this is an approximation (a slightly worse label with a warmer pack could win later); `brute_force` on small cases
measures that error. Charging targets are a grid (GRID) plus the cap plus 'just enough' targets (forecast need + margin) for the destination
and each later station; the incremental charge at one stop is integrated
once and snapshotted at every grid target.

Objectives (all minimised; never mixed through a $/hour value):
  time   = total trip time (driving + charging + per-stop overhead)
  energy = energy used: start stored energy drawn down + billed energy bought   (kWh)
  cost   = Gasket-style consumed-energy cost: start energy valued at start_price, purchases at billed x price, burned
           energy at the inventory's running average; energy left at the end is not charged.
"""
import itertools
from .sim import (copy_state, new_state, drive, charge, ambient_at, seg_at, seg_speed, finish, simulate, fail, forecast_need, MARGIN)
from .units import check_frac

BIN = 0.01

def _obj_partial(st, objective, route, prof):
    if objective == 'time': return st['clock_s']
    if objective == 'energy': return (route['soc0'] - st['soc']) * prof.p['E_full_kWh'] + st['E_billed']
    if objective == 'cost': return st['cost_consumed'] + st['inv_val']          # same SOC bin -> same inventory kWh
    raise ValueError(objective)

def _obj_final(r, objective):
    return {'time': r['total_s'], 'energy': r['energy_used'], 'cost': r['cost']}[objective]

def _drive_leg(st, x1, route, prof, cons, pre):
    if pre:
        v = seg_speed(seg_at(route, st['x']), cons)
        start_pre = max(st['x'], x1 - v * prof.p['precond_max_min'] / 60.0)
        if not drive(st, start_pre, route, prof, cons, False): return False
    return drive(st, x1, route, prof, cons, pre)

def _keep(labels, st, objective, route, prof):
    k = round(st['soc'] / BIN)
    o = _obj_partial(st, objective, route, prof)
    cur = labels.get(k)
    if cur is None or o < cur[0] - 1e-9 or (abs(o - cur[0]) <= 1e-9 and st['T'] > cur[1]['T']):
        labels[k] = (o, st)

def dp_search(route, prof, cons, objective='time', grid=0.05, derate=True, need_targets=True):
    check_frac('soc_cap', cons['soc_cap']); check_frac('reserve', cons['reserve'])
    arrive_min = cons.get('arrive_min', cons['reserve'])
    stations = sorted(route['stations'], key=lambda s: s['km'])
    st0 = new_state(route, prof)
    start_below = st0['soc'] < cons['reserve'] - 1e-12
    if start_below:
        st0['flags'].add('start_below_reserve')
        if cons.get('start_policy', 'firstDip') == 'strict': return fail(st0, 'start_below_reserve')
    pre_opts = [False, True] if route.get('precond_available') else [False]
    if not stations:
        r = simulate(route, prof, cons, plan={}, derate=derate); r['search'] = 'no_stations'; return r
    labels = {}
    for pre in pre_opts:
        st = copy_state(st0)
        if not _drive_leg(st, stations[0]['km'], route, prof, cons, pre): continue
        floor = 0.0 if (start_below and cons.get('start_policy', 'firstDip') == 'firstDip') else cons['reserve']
        if st['soc'] < floor - 1e-9: continue
        st['arrivals'].append(dict(at=0, km=st['x'], soc=st['soc'], T=st['T'], clock_s=st['clock_s']))
        _keep(labels, st, objective, route, prof)
    best = None; n_eval = 0
    for i, sta in enumerate(stations):
        nxt_km = stations[i + 1]['km'] if i + 1 < len(stations) else route['L_km']
        last = i + 1 == len(stations)
        new_labels = {}
        for _, (_, lab) in sorted(labels.items()):
            departs = [(None, copy_state(lab))]                     # skip
            # grid targets + the cap + 'just enough' targets for the destination and each later station (forecast + MARGIN)
            cand = [g * grid for g in range(1, int(cons['soc_cap'] / grid + 1e-9) + 1)] + [cons['soc_cap']]
            if need_targets: cand.append(arrive_min + forecast_need(route, prof, cons, lab, sta['km'], route['L_km']) + MARGIN)
            if need_targets: cand += [cons['reserve'] + forecast_need(route, prof, cons, lab, sta['km'], s['km']) + MARGIN for s in stations[i + 1:]]
            targets = sorted({round(t, 6) for t in cand if t > lab['soc'] + 1e-9 and t <= cons['soc_cap'] + 1e-12})
            if targets:
                ch = copy_state(lab); b0 = ch['E_billed']; g0 = ch['E_stored_gain']; t0 = ch['charge_s']
                for t in targets:
                    r = charge(ch, t, sta, route, prof, cons, derate)
                    if not r['ok']: break
                    d = copy_state(ch)
                    d['overhead_s'] += cons['overhead_min'] * 60.0; d['clock_s'] += cons['overhead_min'] * 60.0
                    d['stops'].append(dict(station=i, km=sta['km'], target=t, minutes=(ch['charge_s'] - t0) / 60.0,
                                           billed=ch['E_billed'] - b0, gain=ch['E_stored_gain'] - g0,
                                           price=sta.get('price', 0.0), T_plug=lab['T']))
                    departs.append((t, d))
            for t, d in departs:
                for pre in (pre_opts if not last else [False]):
                    s2 = copy_state(d); n_eval += 1
                    if not _drive_leg(s2, nxt_km, route, prof, cons, pre): continue
                    if last:
                        s2['arrivals'].append(dict(at='dest', km=s2['x'], soc=s2['soc'], T=s2['T'], clock_s=s2['clock_s']))
                        if s2['soc'] < arrive_min - 1e-9: continue
                        r = finish(s2, route, prof)
                        if best is None or _obj_final(r, objective) < _obj_final(best, objective) - 1e-9: best = r
                    else:
                        s2['arrivals'].append(dict(at=i + 1, km=s2['x'], soc=s2['soc'], T=s2['T'], clock_s=s2['clock_s']))
                        if s2['soc'] < cons['reserve'] - 1e-9: continue
                        _keep(new_labels, s2, objective, route, prof)
        labels = new_labels
        if not last and not labels: break
    if best is None:
        return dict(ok=False, reason='no_feasible_plan_on_grid', evaluated=n_eval, flags=sorted(st0['flags']))
    best['search'] = dict(kind='dp', grid=grid, bin=BIN, need_targets=need_targets, evaluated=n_eval)
    return best

def brute_force(route, prof, cons, objectives=('time', 'energy', 'cost'), grid=0.05, derate=True):
    """exhaustive over (skip | each grid target) at every station, no preconditioning branches. Small cases only.
    Returns {objective: best result} from ONE enumeration."""
    stations = sorted(route['stations'], key=lambda s: s['km'])
    opts = [None] + sorted({round(g * grid, 6) for g in range(1, int(cons['soc_cap'] / grid + 1e-9) + 1)} | {cons['soc_cap']})
    best = {o: None for o in objectives}; n = 0
    for combo in itertools.product(opts, repeat=len(stations)):
        plan = {i: t for i, t in enumerate(combo) if t is not None}
        r = simulate(route, prof, cons, plan=plan, derate=derate); n += 1
        if not r['ok']: continue
        for o in objectives:
            if best[o] is None or _obj_final(r, o) < _obj_final(best[o], o) - 1e-9: best[o] = r
    out = {}
    for o in objectives:
        out[o] = best[o] if best[o] is not None else dict(ok=False, reason='no_feasible_plan_on_grid')
        out[o]['search'] = dict(kind='brute', grid=grid, evaluated=n)
    return out
