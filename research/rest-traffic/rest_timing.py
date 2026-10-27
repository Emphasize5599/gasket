"""Research only: select rest-stop departures from already obtained forecasts.

All times are absolute UTC minutes; input clocks must already be resolved through
the location's timezone. No traffic interpolation, site permission inference, or
production planner integration. See docs/REST_PLANNING.md.
"""
from dataclasses import asdict, dataclass
from math import isfinite


@dataclass(frozen=True)
class Option:
    depart: float
    arrive: float
    driving_minutes: float
    rest_site_minutes: float


def choose(samples, *, reached, minimum_rest, maximum_stay, arrival_start=None,
           arrival_end=None, parking_closes=None, charge_ready=None,
           rest_during_charging=True, traffic_tolerance=0, permission=False):
    """Return distinct guidance; do not assume feasibility is monotonic in time.

    samples: (departure, remaining driving minutes or None). Every usable sample
    is evaluated. None means unavailable, never zero congestion. Permission is
    explicit verified/user-confirmed suitability for this stay and vehicle.
    maximum_stay covers the entire stay including charging. An arrival lower
    bound is enforced as well as the upper bound; waiting at the destination
    would require its own permitted-wait model, outside this prototype.
    """
    inputs = [reached, minimum_rest, maximum_stay, traffic_tolerance]
    inputs += [v for v in (arrival_start, arrival_end, parking_closes, charge_ready)
               if v is not None]
    if not all(isfinite(v) for v in inputs):
        raise ValueError('Finite absolute times and durations are required')
    if minimum_rest < 0 or maximum_stay < minimum_rest or traffic_tolerance < 0:
        raise ValueError('Invalid rest duration or tolerance')
    if arrival_start is not None and arrival_end is not None and arrival_end < arrival_start:
        raise ValueError('Invalid arrival window')
    charging_ends = max(reached, charge_ready if charge_ready is not None else reached)
    ready = (max(reached + minimum_rest, charging_ends) if rest_during_charging
             else charging_ends + minimum_rest)
    end = min(reached + maximum_stay,
              parking_closes if parking_closes is not None else float('inf'))
    feasible, unavailable = [], 0
    if permission:
        for depart, driving in sorted(samples):
            if not isfinite(depart) or depart < ready or depart > end:
                continue
            if driving is None or not isfinite(driving) or driving <= 0:
                unavailable += 1
                continue
            arrive = depart + driving
            if arrival_start is not None and arrive < arrival_start:
                continue
            if arrival_end is not None and arrive > arrival_end:
                continue
            feasible.append(Option(depart, arrive, driving, depart - reached))
    best = min((o.driving_minutes for o in feasible), default=None)
    low = [o for o in feasible if o.driving_minutes <= best + traffic_tolerance] if feasible else []
    return {
        'soonest_low_traffic': min(low, key=lambda o: o.depart, default=None),
        'latest_feasible': max(feasible, key=lambda o: o.depart, default=None),
        'earliest_arrival': min(feasible, key=lambda o: (o.arrive, o.depart), default=None),
        'feasible': feasible,
        'unavailable': unavailable,
        'permission_required': not permission,
    }


if __name__ == '__main__':
    import json
    # Synthetic timing case, NOT extracted Google estimates or a real route.
    result = choose([(990, 90), (995, 120), (1020, 50), (1025, 45),
                     (1030, 45), (1035, 45), (1040, None), (1045, 50)],
                    reached=960, minimum_rest=30, maximum_stay=120,
                    arrival_end=1080, permission=True)
    print(json.dumps(result, default=lambda o: asdict(o), indent=2))
