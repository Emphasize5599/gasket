import unittest
from refsim.profile import Profile
from refsim.sim import charge, new_state, drive
from test_refsim import simple, cons

class IntegrationFixes(unittest.TestCase):
    def test_cooling_shares_station_budget(self):
        p=Profile();rt=simple(soc0=.2,T0=45,Ta=35);s=new_state(rt,p)
        r=charge(s,.65,dict(kW=50,price=.4),rt,p,cons())
        self.assertTrue(r['ok']);self.assertGreater(r['E_aux'],0)
        self.assertLessEqual(r['billed']/(r['minutes']/60),50.000001)
    def test_weather_changes_during_charge(self):
        seen=[];rt=simple(soc0=.2,T0=30);rt['ambient']=lambda h:(seen.append(h),15)[1]
        p=Profile();r=charge(new_state(rt,p),.8,dict(kW=50),rt,p,cons())
        self.assertTrue(r['ok']);self.assertGreater(max(seen)-min(seen),.5)
    def test_full_battery_uses_friction_brakes(self):
        p=Profile();rt=simple(L_km=10,soc0=1);rt['segments']=[(0,10,100,-.12)];s=new_state(rt,p)
        self.assertTrue(drive(s,10,rt,p,cons()))
        self.assertLessEqual(s['soc'],1);self.assertAlmostEqual(s['inv_kWh'],s['soc']*p.p['E_full_kWh'])
    def test_regeneration_updates_inventory(self):
        p=Profile();rt=simple(L_km=10,soc0=.5);rt['segments']=[(0,10,100,-.12)];s=new_state(rt,p)
        self.assertTrue(drive(s,10,rt,p,cons()));self.assertGreater(s['soc'],.5)
        self.assertAlmostEqual(s['inv_kWh'],s['soc']*p.p['E_full_kWh'])
        self.assertAlmostEqual(s['cost_consumed']+s['inv_val'],.5*p.p['E_full_kWh']*.14)
