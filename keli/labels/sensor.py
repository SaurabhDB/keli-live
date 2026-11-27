"""Road-surface class from road weather station sensors (CLAUDE.md, LLD 2.2).

Pure functions, no I/O: the same rules label training images and colour the live map.
"""

from collections.abc import Mapping
from enum import StrEnum


class RoadClass(StrEnum):
    """Surface classes, ordered from least to most hazardous in ``SEVERITY``."""

    DRY = "dry"
    WET = "wet"
    SLUSH = "slush"
    SNOW = "snow"
    ICE_RISK = "ice_risk"


SEVERITY = {c: i for i, c in enumerate(RoadClass)}

# In-road KELI_n codes. 0 = sensor fault (no label); unknown codes (13, 21 seen live) too.
KELI_TO_CLASS: dict[int, RoadClass] = {
    1: RoadClass.DRY,
    2: RoadClass.WET,  # moist
    3: RoadClass.WET,
    4: RoadClass.WET,  # wet and salty
    8: RoadClass.WET,  # probably moist and salty
    9: RoadClass.SLUSH,
    6: RoadClass.SNOW,
    5: RoadClass.ICE_RISK,  # frost
    7: RoadClass.ICE_RISK,  # ice
}
# Optical codes are inferred (same scale without the salty codes 4 and 8): provisional.
OPTICAL_TO_CLASS = {k: v for k, v in KELI_TO_CLASS.items() if k not in {4, 8}}

UNSALTED_WET = frozenset({2, 3})  # salty 4 and 8 stay wet below 0 °C: salt lowers freezing point
WARNING_ICE = frozenset({2, 3})  # VAROITUS_n: 2 alarm, 3 frost
ROAD_TEMP_RANGE_C = (-45.0, 60.0)  # LLD 5.3: outside this the reading is dropped
LANES = (1, 2)


def lane_class(
    code: float | None,
    road_temp_c: float | None,
    warning: float | None,
    *,
    optical: bool = False,
) -> RoadClass | None:
    """Class of one lane, or None when the sensor gives no usable label."""
    if code is None:
        return None
    key = round(code)
    cls = (OPTICAL_TO_CLASS if optical else KELI_TO_CLASS).get(key)
    if cls is None:
        return None
    if warning is not None and round(warning) in WARNING_ICE:
        return RoadClass.ICE_RISK
    unsalted_freezing = (
        key in UNSALTED_WET
        and road_temp_c is not None
        and _valid_temp(road_temp_c)
        and road_temp_c <= 0
    )
    if unsalted_freezing:
        return RoadClass.ICE_RISK
    return cls


def station_class(readings: Mapping[str, float]) -> tuple[RoadClass, str] | None:
    """Worst class over lanes 1 and 2, and its source (``sensor`` or provisional ``optical``).

    ``readings`` maps sensor names (KELI_1, TIE_1, VAROITUS_1, OPTISEN_ANTURIN_KELI1...) to
    fresh values; the caller drops readings older than the label age limit. The worst lane is
    used because a driver meets every lane's hazard.
    """
    found: list[tuple[RoadClass, str]] = []
    for lane in LANES:
        temp = readings.get(f"TIE_{lane}")
        warning = readings.get(f"VAROITUS_{lane}")
        cls = lane_class(readings.get(f"KELI_{lane}"), temp, warning)
        source = "sensor"
        if cls is None:
            optical = readings.get(f"OPTISEN_ANTURIN_KELI{lane}")
            cls = lane_class(optical, temp, warning, optical=True)
            source = "optical"
        if cls is not None:
            found.append((cls, source))
    if not found:
        return None
    return max(found, key=lambda f: SEVERITY[f[0]])


def _valid_temp(t: float) -> bool:
    return ROAD_TEMP_RANGE_C[0] <= t <= ROAD_TEMP_RANGE_C[1]
