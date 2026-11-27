"""Driving hazard from road weather sensors: a level plus the reasons behind it.

Deterministic and explainable (CLAUDE.md: conditions come from sensors or the model, never an
LLM). This rates how slippery a road is *now or within the hour*; it is not an accident
prediction, which would need accident, traffic and road-geometry data and a validated model.

Sensor meanings were checked against recorded data (27 Nov 2026):
``KITKA1_LUKU`` grip 0..0.82 (0.82 is the sensor maximum), ``TIE_1_DERIVAATTA`` road
temperature trend in °C/h, ``KUURAPISTE_ERO_TIE`` road temperature minus frost point in °C
(<= 0 means frost deposits on the road), ``SADE_INTENSITEETTI`` precipitation in mm/h.
"""

from collections.abc import Mapping
from dataclasses import dataclass
from enum import StrEnum

from keli.labels.sensor import RoadClass


class HazardLevel(StrEnum):
    """How dangerous the surface is for driving."""

    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"


@dataclass(frozen=True, slots=True)
class HazardRules:
    """Thresholds (from config/keli.json)."""

    grip_high_below: float = 0.30
    grip_medium_below: float = 0.45
    freeze_horizon_h: float = 1.0  # warn if the road reaches 0 °C within this time
    frost_margin_c: float = 1.0  # road within this of the frost point while cooling
    precip_min_mm_h: float = 0.1
    precip_max_mm_h: float = 100.0  # above this the gauge is faulty (204.7 seen live)


@dataclass(frozen=True, slots=True)
class Finding:
    """One reason for the hazard: a stable code and values for translation, plus English."""

    level: HazardLevel
    code: str  # e.g. "grip_reduced"; the frontend translates codes
    params: dict[str, float]
    text: str  # English sentence for API clients that do not translate


@dataclass(frozen=True, slots=True)
class Hazard:
    """Level and findings, most serious first."""

    level: HazardLevel
    findings: tuple[Finding, ...]

    @property
    def reasons(self) -> tuple[str, ...]:
        """English reasons, most serious first."""
        return tuple(f.text for f in self.findings)


@dataclass(frozen=True, slots=True)
class _Inputs:
    """The readings the rules use, already reduced (coldest lane for road temperature)."""

    road_class: RoadClass | None
    road: float | None  # °C
    grip: float | None
    trend: float | None  # road temperature change, °C/h
    frost_diff: float | None  # road temperature minus frost point, °C
    precip: float | None  # mm/h

    @property
    def frozen(self) -> bool:
        return self.road is not None and self.road <= 0

    @property
    def cooling(self) -> bool:
        return self.trend is not None and self.trend < 0


def _surface(i: _Inputs, _: HazardRules) -> Finding | None:
    if i.road_class is RoadClass.ICE_RISK:
        return Finding(
            HazardLevel.HIGH,
            "surface_ice",
            {},
            "Ice, frost or black ice reported by the road sensor",
        )
    if i.road_class is RoadClass.SNOW:
        return Finding(HazardLevel.MEDIUM, "surface_snow", {}, "Snow-covered road")
    if i.road_class is RoadClass.SLUSH:
        return Finding(HazardLevel.MEDIUM, "surface_slush", {}, "Slush on the road")
    return None


def _grip(i: _Inputs, r: HazardRules) -> Finding | None:
    if i.grip is None:
        return None
    if i.grip < r.grip_high_below:
        return Finding(
            HazardLevel.HIGH, "grip_very_low", {"grip": i.grip}, f"Very low grip ({i.grip:.2f})"
        )
    if i.grip < r.grip_medium_below:
        return Finding(
            HazardLevel.MEDIUM, "grip_reduced", {"grip": i.grip}, f"Reduced grip ({i.grip:.2f})"
        )
    return None


def _frost(i: _Inputs, r: HazardRules) -> Finding | None:
    if not i.frozen or i.frost_diff is None:
        return None
    if i.frost_diff <= 0:
        return Finding(HazardLevel.HIGH, "frost_forming", {}, "Frost forming on the road now")
    if i.cooling and i.frost_diff <= r.frost_margin_c:
        return Finding(
            HazardLevel.MEDIUM,
            "frost_soon",
            {"margin_c": i.frost_diff},
            f"Frost may form soon (road {i.frost_diff:.1f} °C above frost point)",
        )
    return None


def _precipitation(i: _Inputs, r: HazardRules) -> Finding | None:
    if i.precip is None or not i.frozen:
        return None
    if r.precip_min_mm_h <= i.precip <= r.precip_max_mm_h:
        return Finding(
            HazardLevel.HIGH,
            "precip_on_frozen_road",
            {"mm_h": i.precip},
            f"Precipitation ({i.precip:.1f} mm/h) on a road below 0 °C",
        )
    return None


def _freezing_soon(i: _Inputs, r: HazardRules) -> Finding | None:
    if i.road_class is not RoadClass.WET or i.road is None or i.road <= 0 or i.trend is None:
        return None
    if i.road + i.trend * r.freeze_horizon_h <= 0:
        return Finding(
            HazardLevel.MEDIUM,
            "freezing_soon",
            {"rate_c_h": abs(i.trend)},
            f"Wet road cooling {abs(i.trend):.1f} °C/h: may freeze within the hour",
        )
    return None


RULES = (_surface, _grip, _frost, _precipitation, _freezing_soon)


def assess(
    readings: Mapping[str, float], road_class: RoadClass | None, rules: HazardRules
) -> Hazard | None:
    """Hazard at one station from fresh readings and its surface class; None if no data.

    The level is the most serious finding; reasons list every finding, most serious first.
    """
    road = [readings[n] for n in ("TIE_1", "TIE_2") if n in readings]
    inputs = _Inputs(
        road_class=road_class,
        road=min(road) if road else None,
        grip=readings.get("KITKA1_LUKU"),
        trend=readings.get("TIE_1_DERIVAATTA"),
        frost_diff=readings.get("KUURAPISTE_ERO_TIE"),
        precip=readings.get("SADE_INTENSITEETTI"),
    )
    if road_class is None and inputs.road is None and inputs.grip is None:
        return None
    findings = [f for check in RULES if (f := check(inputs, rules)) is not None]
    if not findings:
        return Hazard(HazardLevel.LOW, ())
    order = {HazardLevel.HIGH: 0, HazardLevel.MEDIUM: 1, HazardLevel.LOW: 2}
    findings.sort(key=lambda f: order[f.level])  # stable: rule order within a level
    return Hazard(findings[0].level, tuple(findings))
