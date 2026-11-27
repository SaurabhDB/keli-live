"""Driving-hazard rules: one test per rule, plus combination and no-data cases."""

import pytest

from keli.labels.hazard import HazardLevel, HazardRules, assess
from keli.labels.sensor import RoadClass

RULES = HazardRules()
DRY_COLD = {"TIE_1": -5.0, "KITKA1_LUKU": 0.82}


def level(readings: dict[str, float], cls: RoadClass | None = RoadClass.DRY) -> HazardLevel:
    hazard = assess(readings, cls, RULES)
    assert hazard is not None
    return hazard.level


def test_no_data_gives_no_hazard() -> None:
    assert assess({}, None, RULES) is None


def test_dry_road_with_good_grip_is_low_even_when_cold() -> None:
    hazard = assess(DRY_COLD, RoadClass.DRY, RULES)
    assert hazard is not None
    assert hazard.level is HazardLevel.LOW
    assert hazard.reasons == ()


@pytest.mark.parametrize(
    ("cls", "expected"),
    [
        (RoadClass.ICE_RISK, HazardLevel.HIGH),
        (RoadClass.SNOW, HazardLevel.MEDIUM),
        (RoadClass.SLUSH, HazardLevel.MEDIUM),
        (RoadClass.WET, HazardLevel.LOW),
    ],
)
def test_surface_class(cls: RoadClass, expected: HazardLevel) -> None:
    assert level({"TIE_1": 2.0}, cls) is expected


@pytest.mark.parametrize(
    ("grip", "expected"),
    [(0.25, HazardLevel.HIGH), (0.40, HazardLevel.MEDIUM), (0.45, HazardLevel.LOW)],
)
def test_grip_thresholds(grip: float, expected: HazardLevel) -> None:
    assert level({"TIE_1": 3.0, "KITKA1_LUKU": grip}) is expected


def test_frost_forming_now_is_high() -> None:
    assert level({**DRY_COLD, "KUURAPISTE_ERO_TIE": -0.3}) is HazardLevel.HIGH


def test_frost_close_and_cooling_is_medium() -> None:
    readings = {**DRY_COLD, "KUURAPISTE_ERO_TIE": 0.6, "TIE_1_DERIVAATTA": -0.4}
    assert level(readings) is HazardLevel.MEDIUM


def test_frost_close_but_warming_is_low() -> None:
    readings = {**DRY_COLD, "KUURAPISTE_ERO_TIE": 0.6, "TIE_1_DERIVAATTA": 0.4}
    assert level(readings) is HazardLevel.LOW


def test_frost_point_ignored_on_road_above_zero() -> None:
    assert level({"TIE_1": 1.0, "KUURAPISTE_ERO_TIE": -0.5}) is HazardLevel.LOW


def test_precipitation_on_frozen_road_is_high() -> None:
    assert level({**DRY_COLD, "SADE_INTENSITEETTI": 0.8}) is HazardLevel.HIGH


@pytest.mark.parametrize("mm_h", [0.0, 204.7])  # none, and a faulty gauge seen live
def test_implausible_or_no_precipitation_is_ignored(mm_h: float) -> None:
    assert level({**DRY_COLD, "SADE_INTENSITEETTI": mm_h}) is HazardLevel.LOW


def test_wet_road_freezing_within_the_hour_is_medium() -> None:
    readings = {"TIE_1": 0.8, "TIE_1_DERIVAATTA": -1.2}
    hazard = assess(readings, RoadClass.WET, RULES)
    assert hazard is not None
    assert hazard.level is HazardLevel.MEDIUM
    assert "may freeze within the hour" in hazard.reasons[0]


def test_wet_road_cooling_slowly_is_low() -> None:
    assert level({"TIE_1": 2.0, "TIE_1_DERIVAATTA": -0.5}, RoadClass.WET) is HazardLevel.LOW


def test_coldest_lane_counts() -> None:
    readings = {"TIE_1": 1.0, "TIE_2": -1.0, "SADE_INTENSITEETTI": 1.0}
    assert level(readings) is HazardLevel.HIGH


def test_reasons_are_ordered_most_serious_first() -> None:
    readings = {"TIE_1": -2.0, "KITKA1_LUKU": 0.40, "KUURAPISTE_ERO_TIE": -0.1}
    hazard = assess(readings, RoadClass.SNOW, RULES)
    assert hazard is not None
    assert hazard.level is HazardLevel.HIGH
    assert hazard.reasons[0] == "Frost forming on the road now"
    assert set(hazard.reasons[1:]) == {"Snow-covered road", "Reduced grip (0.40)"}


def test_thresholds_come_from_rules() -> None:
    strict = HazardRules(grip_medium_below=0.9)
    hazard = assess(DRY_COLD, RoadClass.DRY, strict)
    assert hazard is not None
    assert hazard.level is HazardLevel.MEDIUM


def test_findings_carry_codes_and_values_for_translation() -> None:
    hazard = assess({"TIE_1": 3.0, "KITKA1_LUKU": 0.40}, RoadClass.DRY, RULES)
    assert hazard is not None
    (finding,) = hazard.findings
    assert (finding.code, finding.params) == ("grip_reduced", {"grip": 0.40})
