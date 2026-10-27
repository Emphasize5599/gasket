import unittest
from rest_timing import choose


class RestTimingTests(unittest.TestCase):
    def select(self, samples, **overrides):
        args = dict(reached=960, minimum_rest=30, maximum_stay=120,
                    arrival_end=1080, permission=True)
        args.update(overrides)
        return choose(samples, **args)

    def test_nonmonotonic_feasibility_and_distinct_recommendations(self):
        r = self.select([(990, 90), (995, 120), (1020, 50), (1025, 45), (1035, 45), (1045, 50)])
        self.assertEqual([o.depart for o in r['feasible']], [990, 1020, 1025, 1035])
        self.assertEqual(r['soonest_low_traffic'].depart, 1025)
        self.assertEqual(r['latest_feasible'].depart, 1035)
        self.assertEqual(r['earliest_arrival'].depart, 1020)

    def test_both_arrival_bounds_and_rest_limit(self):
        r = self.select([(985, 80), (990, 70), (1000, 60), (1010, 50), (1020, 50)],
                        arrival_start=1060, maximum_stay=50)
        self.assertEqual([o.depart for o in r['feasible']], [990, 1000, 1010])
        self.assertEqual(r['latest_feasible'].depart, 1010)

    def test_closure_not_confused_with_recommended_sleep_time(self):
        r = self.select([(990, 50), (1000, 50), (1010, 50)], parking_closes=1000)
        self.assertEqual(r['latest_feasible'].depart, 1000)

    def test_charging_overlaps_only_if_permitted(self):
        samples = [(990, 30), (1000, 30), (1020, 30), (1030, 30)]
        self.assertEqual(self.select(samples, charge_ready=1000)['earliest_arrival'].depart, 1000)
        self.assertEqual(self.select(samples, charge_ready=1000,
                                     rest_during_charging=False)['earliest_arrival'].depart, 1030)

    def test_unknown_forecast_and_permission_are_not_approvals(self):
        r = self.select([(990, None), (1000, 50)])
        self.assertEqual(r['unavailable'], 1)
        self.assertEqual(len(r['feasible']), 1)
        r = self.select([(1000, 50)], permission=False)
        self.assertTrue(r['permission_required'])
        self.assertEqual(r['feasible'], [])

    def test_no_arrival_deadline_and_overnight_absolute_times(self):
        r = self.select([(1435, 30), (1440, 30), (1455, 30)], reached=1410,
                        arrival_end=None, maximum_stay=60)
        self.assertEqual(r['soonest_low_traffic'].depart, 1440)
        self.assertEqual(r['latest_feasible'].depart, 1455)

    def test_no_feasible_departure_and_invalid_inputs(self):
        self.assertIsNone(self.select([(990, 200)])['latest_feasible'])
        with self.assertRaises(ValueError):
            self.select([], maximum_stay=10)
        with self.assertRaises(ValueError):
            self.select([], arrival_start=1100)


if __name__ == '__main__':
    unittest.main()
