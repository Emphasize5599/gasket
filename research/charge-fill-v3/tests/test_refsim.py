"""Executable checks for refsim (unittest; no pytest needed).  python3 -I tests/run_tests.py"""
import os, sys, math, unittest
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
from refsim.profile import Profile, COLD_TERM_FLOOR_C
from refsim import sim, search, h2, units
from refsim.sim import simulate, charge, new_state, seg_speed
from refsim.cases import route, st, const, CONS, OFFSETS_MPH

P = Profile()
L75 = units.mph_to_kmh(75)

def simple(L_km=200.0, stations=(), soc0=0.9, T0=25.0, Ta=15.0, lim=L75, precond=False):
    return dict(L_km=L_km, segments=[(0.0, L_km, lim, 0.0)], stations=[dict(s) for s in stations], soc0=soc0, T0=T0,
                t0_h=9.0, ambient=const(Ta), start_price=0.14, precond_available=precond)

def cons(**k):
    c = dict(CONS, offset_mph=0); c.update(k); return c

class Units(unittest.TestCase):
    def test_conversions(self):
        self.assertAlmostEqual(units.mph_to_kmh(75), 120.7008, places=4)
        self.assertAlmostEqual(units.kmh_to_mph(units.mph_to_kmh(63.3)), 63.3)
        self.assertAlmostEqual(units.mi_to_km(1), 1.609344)
        self.assertAlmostEqual(units.kw_s_to_kwh(36, 100), 1.0)
        self.assertAlmostEqual(units.s_to_min(90), 1.5); self.assertAlmostEqual(units.min_to_s(2), 120)
        self.assertAlmostEqual(units.s_to_h(5400), 1.5); self.assertAlmostEqual(units.h_to_s(0.5), 1800)
        self.assertAlmostEqual(units.pct_to_frac(80), 0.8); self.assertAlmostEqual(units.frac_to_pct(0.8), 80)
        self.assertAlmostEqual(units.wh_per_km_to_wh_per_mi(100), 160.9344)
    def test_percent_passed_as_fraction_rejected(self):
        with self.assertRaises(ValueError): units.check_frac('soc', 80)
        with self.assertRaises(ValueError): simulate(simple(soc0=90), P, cons())

class Caps(unittest.TestCase):
    def test_heuristic_never_exceeds_cap(self):
        # one station at 30 km, then 380 km to go: reaching the destination needs far more than the 80 % cap
        r = simulate(simple(L_km=410, stations=[dict(km=30, kW=150, price=0.4)], soc0=0.5), P, cons())
        self.assertFalse(r['ok']); self.assertIn(r['reason'], ('needs_higher_soc_cap', 'gap_beyond_full_range'))
        self.assertIn('proposed_soc_cap', r)
    def test_needs_higher_cap_proposal(self):
        # destination reachable only with ~0.85: cap 0.80 must fail with a proposal, cap 0.95 must pass
        rt = simple(L_km=270, stations=[dict(km=20, kW=150, price=0.4)], soc0=0.3)
        r = simulate(rt, P, cons(soc_cap=0.80))
        self.assertFalse(r['ok']); self.assertEqual(r['reason'], 'needs_higher_soc_cap')
        self.assertGreater(r['proposed_soc_cap'], 0.80); self.assertLessEqual(r['proposed_soc_cap'], 1.0)
        r2 = simulate(rt, P, cons(soc_cap=0.95)); self.assertTrue(r2['ok'])
        self.assertTrue(all(s['target'] <= 0.95 + 1e-12 for s in r2['stop_list']))
    def test_explicit_target_above_cap_fails(self):
        r = simulate(simple(L_km=150, stations=[dict(km=50, kW=150, price=0.4)], soc0=0.5), P, cons(soc_cap=0.8), plan={0: 0.9})
        self.assertFalse(r['ok']); self.assertEqual(r['reason'], 'target_above_soc_cap')
    def test_reference_search_respects_cap(self):
        rt = route(180, [(0, 180, 75)], [st(45), st(90), st(135)], 0.8, 25, 9, const(15))
        d = search.dp_search(rt, P, cons(soc_cap=0.7), 'time')
        self.assertTrue(d['ok']); self.assertTrue(all(s['target'] <= 0.7 + 1e-9 for s in d['stop_list']))

class Reserves(unittest.TestCase):
    def test_intermediate_arrival_below_reserve_fails(self):
        # explicit plan that skips charging: arrives at station 1 below the 10 % reserve
        rt = simple(L_km=400, stations=[dict(km=100, kW=150), dict(km=260, kW=150)], soc0=0.9)
        r = simulate(rt, P, cons(), plan={})
        self.assertFalse(r['ok']); self.assertEqual(r['reason'], 'reserve_violated'); self.assertEqual(r['station'], 1)
    def test_destination_reserve(self):
        r = simulate(simple(L_km=300, soc0=1.0), P, cons(offset_mph=0))
        self.assertFalse(r['ok']); self.assertEqual(r['reason'], 'arrives_below_reserve')
    def test_start_below_reserve(self):
        rt = simple(L_km=20, stations=[dict(km=10, kW=150, price=0.4)], soc0=0.05)
        self.assertEqual(simulate(rt, P, cons(start_policy='strict'))['reason'], 'start_below_reserve')
        r = simulate(rt, P, cons(start_policy='firstDip'))
        self.assertTrue(r['ok']); self.assertIn('start_below_reserve', r['flags'])
        self.assertGreaterEqual(r['soc_end'], 0.10 - 1e-9)
    def test_every_arrival_checked_in_result(self):
        rt = route(220, [(0, 220, 75)], [st(45), st(90), st(135), st(180)], 0.9, 25, 9, const(15))
        r = simulate(rt, P, cons())
        self.assertTrue(r['ok']); self.assertTrue(all(a['soc'] >= 0.10 - 1e-9 for a in r['arrivals']))

class Charging(unittest.TestCase):
    def _st(self, soc=0.2, T=30.0, Ta=15.0):
        rt = simple(soc0=soc, T0=T, Ta=Ta); return rt, new_state(rt, P)
    def test_lands_exactly_on_target(self):
        rt, s = self._st(); r = charge(s, 0.6537, dict(kW=150, price=0.4), rt, P, cons())
        self.assertTrue(r['ok']); self.assertAlmostEqual(s['soc'], 0.6537, places=12)
    def test_timeout_reported(self):
        rt, s = self._st(); r = charge(s, 0.8, dict(kW=3.0, price=0.4), rt, P, cons())
        self.assertFalse(r['ok']); self.assertEqual(r['reason'], 'charge_timeout'); self.assertGreaterEqual(r['minutes'], 240 - 1e-6)
    def test_no_power_reported(self):
        rt, s = self._st(); r = charge(s, 0.8, dict(kW=0.5, price=0.4), rt, P, cons())
        self.assertFalse(r['ok']); self.assertEqual(r['reason'], 'charge_no_power')
    def test_invalid_and_trivial_targets(self):
        rt, s = self._st()
        with self.assertRaises(ValueError): charge(s, 80, dict(kW=150), rt, P, cons())
        self.assertEqual(charge(s, 0.1, dict(kW=150), rt, P, cons())['reason'], 'no_charge_needed')
    def test_failed_charge_fails_the_trip(self):
        rt = simple(L_km=300, stations=[dict(km=100, kW=3.0, price=0.4)], soc0=0.5)
        r = simulate(rt, P, cons())
        self.assertFalse(r['ok']); self.assertEqual(r['reason'], 'charge_timeout')
    def test_station_cap_and_sharing(self):
        rt, s = self._st(T=40); r1 = charge(s, 0.5, dict(kW=50, price=0.4), rt, P, cons())
        rt, s = self._st(T=40); r2 = charge(s, 0.5, dict(kW=100, share=0.5, price=0.4), rt, P, cons())
        self.assertAlmostEqual(r1['minutes'], r2['minutes'], places=6)

class EnergyBoundaries(unittest.TestCase):
    def test_balance_closes(self):
        for name, rt in [('A', route(220, [(0, 220, 75)], [st(45), st(90), st(135), st(180)], 0.9, 25, 9, const(15))),
                         ('B', route(220, [(0, 220, 75)], [st(45), st(90), st(135), st(180)], 0.9, 0, 8, const(0), precond=True)),
                         ('F', route(220, [(0, 220, 75)], [st(45), st(90), st(135), st(180)], 0.9, 35, 11, const(35)))]:
            r = simulate(rt, P, cons())
            self.assertTrue(r['ok'], name); self.assertLess(abs(r['energy_balance_err_kWh']), 1e-6, name)
    def test_meter_inlet_terminal_order(self):
        rt = simple(L_km=250, stations=[dict(km=150, kW=150, price=0.5, basis='ac_meter')], soc0=0.6)
        r = simulate(rt, P, cons())
        self.assertTrue(r['ok']); self.assertGreater(r['E_term_in'], 0)
        self.assertAlmostEqual(r['E_inlet'], r['E_term_in'] + r['E_aux_charge'], places=9)
        self.assertAlmostEqual(r['E_billed'], r['E_inlet'] / P.p['cable_eta'] / P.p['ac_meter_eta'], places=9)
        self.assertAlmostEqual(r['E_stored_gain'], r['E_term_in'] * P.p['eta_soc_dc'], places=9)   # aux never enters SOC
    def test_inventory_matches_soc(self):
        rt = route(220, [(0, 220, 75)], [st(45), st(90), st(135), st(180)], 0.9, 25, 9, const(15))
        s = new_state(rt, P); r = simulate(rt, P, cons()); self.assertTrue(r['ok'])
        # consumed cost + leftover value = start value + purchases
        start_val = 0.9 * P.p['E_full_kWh'] * 0.14
        self.assertGreater(r['cost'], 0); self.assertLessEqual(r['cost'], start_val + r['purchases'] + 1e-9)
    def test_precond_draw_counted_once(self):
        # cold pack, no cooling reachable: driving terminal energy differs by exactly the preconditioning draw
        rt0 = simple(L_km=120, stations=[dict(km=100, kW=150, price=0.4)], soc0=0.9, T0=-5, Ta=-5)
        plan = {0: 0.95}; c = cons(soc_cap=0.95)
        a = simulate(dict(rt0, precond_available=False), P, c, plan=dict(plan))
        b = simulate(dict(rt0, precond_available=True), P, c, plan=dict(plan, precond={0}))
        self.assertTrue(a['ok'] and b['ok']); self.assertGreater(b['E_precond'], 0)
        drive_a = a['E_drive_term']; drive_b = b['E_drive_term']
        self.assertAlmostEqual(drive_b - drive_a, b['E_precond'], places=9)
        self.assertGreater(b['arrivals'][0]['T'], a['arrivals'][0]['T'])
        # heat delivered = eta_heat x draw: temperature gain is smaller than with a 100 % assumption
        P2 = Profile(); P2.p['precond_eta_heat'] = 1.0
        b2 = simulate(dict(rt0, precond_available=True), P2, c, plan=dict(plan, precond={0}))
        self.assertGreater(b2['arrivals'][0]['T'], b['arrivals'][0]['T'])

class TemperatureBounds(unittest.TestCase):
    def test_cold_heat_term_bounded(self):
        f1, f2 = set(), set()
        self.assertAlmostEqual(P.heat_W(30, -30, f1), P.heat_W(30, COLD_TERM_FLOOR_C, f2))
        self.assertIn('pack_temp_outside_fit', f1)
    def test_cold_factor_table(self):
        f = set()
        self.assertAlmostEqual(P.cold_factor(15, f), 1.0); self.assertAlmostEqual(P.cold_factor(25, f), 1.0)
        self.assertAlmostEqual(P.cold_factor(0, f), 1.12); self.assertAlmostEqual(P.cold_factor(-5, f), 1.16)
        self.assertAlmostEqual(P.cold_factor(-20, f), 1.16); self.assertIn('ambient_outside_measured', f)
    def test_derate_never_penalises_warm_pack(self):
        f = set()
        for soc in (0.25, 0.4, 0.6, 0.79):
            warm_T = float(__import__('numpy').interp(soc, P.SOC, P.Tw))
            self.assertAlmostEqual(P.accept_kW(soc, warm_T, f), P.accept_kW(soc, warm_T, f, derate=False))
            self.assertAlmostEqual(P.accept_kW(soc, warm_T + 5, f), P.accept_kW(soc, warm_T + 5, f, derate=False))
    def test_out_of_range_flags_in_results(self):
        r = simulate(simple(L_km=60, soc0=0.9, T0=-20, Ta=-20), P, cons())
        self.assertTrue(r['ok']); self.assertIn('ambient_outside_measured', r['flags']); self.assertIn('pack_temp_outside_fit', r['flags'])

class LegalSpeeds(unittest.TestCase):
    def test_never_above_limit(self):
        seg = (0, 10, units.mph_to_kmh(65), 0)
        self.assertAlmostEqual(seg_speed(seg, cons(offset_mph=10)), units.mph_to_kmh(65))
        self.assertAlmostEqual(seg_speed(seg, cons(offset_mph=-5)), units.mph_to_kmh(60))
        self.assertAlmostEqual(seg_speed(seg, cons(offset_mph=-30, vmin_mph=45)), units.mph_to_kmh(45))
        self.assertAlmostEqual(seg_speed((0, 10, units.mph_to_kmh(85), 0), cons(vmax_mph=80)), units.mph_to_kmh(80))
        self.assertAlmostEqual(seg_speed(seg, cons(offset_mph=10, allow_over_limit=True)), units.mph_to_kmh(75))
    def test_candidate_set_is_legal(self):
        self.assertTrue(all(o <= 0 for o in OFFSETS_MPH)); self.assertFalse(CONS['allow_over_limit'])

class Integration(unittest.TestCase):
    def test_stops_exactly_at_offgrid_station_and_destination(self):
        rt = simple(L_km=123.4567, stations=[dict(km=71.337, kW=150, price=0.4)], soc0=0.9)
        r = simulate(rt, P, cons(), plan={0: 0.8})
        self.assertTrue(r['ok']); self.assertAlmostEqual(r['arrivals'][0]['km'], 71.337, places=9)
        self.assertAlmostEqual(r['arrivals'][-1]['km'], 123.4567, places=9)
    def test_road_time_exact(self):
        rt = dict(simple(L_km=100.3), segments=[(0, 40.1, units.mph_to_kmh(55), 0), (40.1, 100.3, units.mph_to_kmh(70), 0)])
        r = simulate(rt, P, cons())
        exp = 40.1 / units.mph_to_kmh(55) * 3600 + 60.2 / units.mph_to_kmh(70) * 3600
        self.assertAlmostEqual(r['road_s'], exp, places=6)
    def test_ambient_follows_clock(self):
        seen = []
        rt = dict(simple(L_km=240), ambient=lambda h: (seen.append(h), 10.0)[1], t0_h=22.0)
        simulate(rt, P, cons()); self.assertGreater(max(seen), 23.5)

class Hydrogen(unittest.TestCase):
    def test_units_kg_per_km(self):
        kgkm, flags = h2.kg_per_km(100.0, 15.0, eta_d=0.9, P_aux_kW=0.0, eta=0.55)
        self.assertAlmostEqual(kgkm, 15 / 0.9 / 0.55 / h2.LHV_KWH_PER_KG / 100.0)
        self.assertAlmostEqual(kgkm * 100, 0.9095, places=3)          # kg/100 km, plausible order for a mid-size FCEV
        self.assertIn('h2_speed_model_unvalidated', flags)
        a, _ = h2.kg_per_km(50.0, 15.0, eta=0.55); b, _ = h2.kg_per_km(100.0, 15.0, eta=0.55)
        self.assertAlmostEqual(a, 2 * b)                                # same power at twice the speed: half per km
        with self.assertRaises(ValueError): h2.kg_per_km(0.0, 10.0)
    def test_wheel_power_dimensions(self):
        self.assertAlmostEqual(h2.wheel_kW(36.0, 100.0, 0.0, 0.0), 1.0)   # 100 N at 10 m/s = 1 kW
        self.assertAlmostEqual(h2.kg_per_100km_to_mi_per_kg(1.0), 62.137, places=2)

class SearchConsistency(unittest.TestCase):
    def test_dp_matches_bruteforce_on_tiny_case(self):
        rt = route(150, [(0, 150, 70)], [st(50, price=0.4), st(100, price=0.6)], 0.6, 25, 9, const(15))
        B = search.brute_force(rt, P, cons(), ('time', 'cost'), grid=0.05)
        for obj, key in (('time', 'total_s'), ('cost', 'cost')):
            g = search.dp_search(rt, P, cons(), obj, need_targets=False)
            d = search.dp_search(rt, P, cons(), obj)
            self.assertTrue(B[obj]['ok'] and g['ok'] and d['ok'])
            self.assertLessEqual(d[key], B[obj][key] + 1e-6)                 # extra targets can only help
            self.assertLessEqual(abs(g[key] - B[obj][key]), max(1e-6, 1e-3 * B[obj][key]))

if __name__ == '__main__':
    unittest.main()
