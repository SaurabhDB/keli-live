"""Turn sensor readings into road conditions for the API (pure functions, no I/O)."""

from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime, timedelta

from keli.api.repository import Reading
from keli.labels.hazard import Finding, HazardLevel, HazardRules, assess
from keli.labels.sensor import RoadClass, station_class


@dataclass(frozen=True, slots=True)
class StationCondition:
    """Class and the key measurements behind it at one station."""

    cls: RoadClass | None
    source: str | None
    road_temp_c: float | None
    air_temp_c: float | None
    friction: float | None
    measured_at: datetime | None
    hazard: HazardLevel | None = None
    hazard_findings: tuple[Finding, ...] = ()


def station_condition(
    readings: Mapping[str, Reading], rules: HazardRules | None = None
) -> StationCondition:
    """Condition and driving hazard from the newest fresh reading of each sensor."""
    values = {name: r.value for name, r in readings.items()}
    labelled = station_class(values)
    hazard = assess(values, labelled[0] if labelled else None, rules or HazardRules())
    temps = [readings[s].value for s in ("TIE_1", "TIE_2") if s in readings]
    return StationCondition(
        cls=labelled[0] if labelled else None,
        source=labelled[1] if labelled else None,
        road_temp_c=round(min(temps), 1) if temps else None,  # coldest lane: worst case
        air_temp_c=_value(readings, "ILMA"),
        friction=_value(readings, "KITKA1_LUKU"),
        measured_at=max((r.measured_at for r in readings.values()), default=None),
        hazard=hazard.level if hazard else None,
        hazard_findings=hazard.findings if hazard else (),
    )


def condition_series(
    readings: Iterable[Reading],
    window: tuple[datetime, datetime],
    step: timedelta,
    max_age: timedelta,
    rules: HazardRules | None = None,
) -> list[tuple[datetime, StationCondition]]:
    """Condition at every ``step`` in ``window`` = (since, until] from one station's readings.

    At each point only readings within ``max_age`` count, the same freshness rule as labels.
    ``readings`` must be sorted oldest first.
    """
    since, until = window
    pending = list(readings)
    latest: dict[str, Reading] = {}
    out = []
    i = 0
    t = since + step
    while t <= until:
        while i < len(pending) and pending[i].measured_at <= t:
            latest[pending[i].sensor] = pending[i]
            i += 1
        fresh = {s: r for s, r in latest.items() if t - r.measured_at <= max_age}
        out.append((t, station_condition(fresh, rules)))
        t += step
    return out


@dataclass(frozen=True, slots=True)
class Streak:
    """How long the latest value of a series has held.

    ``complete`` is False when the run reaches the start of the window or a data gap: then
    ``since`` is only a lower bound ("since at least") and ``previous`` is unknown.
    """

    value: str
    since: datetime
    previous: str | None
    complete: bool


def current_streak(points: Sequence[tuple[datetime, str | None]]) -> Streak | None:
    """Run of the newest value, walking back until it changes; None if the newest is unknown.

    ``points`` are (time, value) oldest first, one per step; None marks missing data.
    """
    if not points or points[-1][1] is None:
        return None
    value = points[-1][1]
    since = points[-1][0]
    for t, v in reversed(points[:-1]):
        if v != value:
            # A gap (None) ends what we can vouch for; a different value is a real change.
            return Streak(value, since, v, complete=v is not None)
        since = t
    return Streak(value, since, None, complete=False)


def _value(readings: Mapping[str, Reading], sensor: str) -> float | None:
    r = readings.get(sensor)
    return round(r.value, 2) if r is not None else None
