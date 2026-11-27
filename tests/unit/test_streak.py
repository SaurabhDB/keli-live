"""How long the current condition has held: changes, data gaps and window limits."""

from datetime import UTC, datetime, timedelta

from keli.api.conditions import current_streak

T0 = datetime(2026, 11, 27, 0, 0, tzinfo=UTC)
STEP = timedelta(minutes=10)


def series(*values: str | None) -> list[tuple[datetime, str | None]]:
    return [(T0 + i * STEP, v) for i, v in enumerate(values)]


def test_empty_or_unknown_latest_gives_none() -> None:
    assert current_streak([]) is None
    assert current_streak(series("wet", None)) is None


def test_change_gives_exact_start_and_previous_value() -> None:
    s = current_streak(series("wet", "wet", "ice_risk", "ice_risk", "ice_risk"))
    assert s is not None
    assert s.value == "ice_risk"
    assert s.since == T0 + 2 * STEP
    assert s.previous == "wet"
    assert s.complete


def test_data_gap_makes_start_a_lower_bound() -> None:
    s = current_streak(series("dry", None, "ice_risk", "ice_risk"))
    assert s is not None
    assert s.since == T0 + 2 * STEP
    assert s.previous is None
    assert not s.complete


def test_run_reaching_window_start_is_incomplete() -> None:
    s = current_streak(series("snow", "snow", "snow"))
    assert s is not None
    assert s.since == T0
    assert not s.complete


def test_single_point_after_change() -> None:
    s = current_streak(series("low", "high"))
    assert s is not None
    assert (s.value, s.since, s.previous, s.complete) == ("high", T0 + STEP, "low", True)
