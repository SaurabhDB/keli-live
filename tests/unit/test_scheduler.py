from datetime import UTC, datetime, timedelta

from keli.config import Settings
from keli.ingest.scheduler import RecorderState, next_boundary, plan_jobs

NOW = datetime(2026, 11, 24, 6, 0, 30, tzinfo=UTC)
CAPTURED = NOW - timedelta(minutes=3)


def _state(n_presets: int = 4, n_training: int = 0) -> RecorderState:
    presets = [f"P{i}" for i in range(n_presets)]
    return RecorderState(presets=presets, training=frozenset(presets[:n_training]))


def test_new_capture_times_become_thumbnail_jobs(settings: Settings) -> None:
    state = _state()
    times = dict.fromkeys(state.presets, CAPTURED)

    jobs, unchanged, _ = plan_jobs(times, state, settings, NOW)

    assert [j.preset_id for j in jobs] == state.presets
    assert all(j.thumbnail for j in jobs)
    assert unchanged == 0


def test_unchanged_capture_time_is_skipped_without_a_request(settings: Settings) -> None:
    state = _state()
    times = dict.fromkeys(state.presets, CAPTURED)
    state.last_thumb = {"P0": CAPTURED, "P1": CAPTURED - timedelta(minutes=10)}

    jobs, unchanged, _ = plan_jobs(times, state, settings, NOW)

    assert [j.preset_id for j in jobs] == ["P1", "P2", "P3"]
    assert unchanged == 1


def test_presets_without_capture_time_are_ignored(settings: Settings) -> None:
    jobs, unchanged, _ = plan_jobs({"P0": CAPTURED}, _state(), settings, NOW)

    assert [j.preset_id for j in jobs] == ["P0"]
    assert unchanged == 0


def test_full_images_are_spread_over_the_hour(settings: Settings) -> None:
    state = _state(n_presets=12, n_training=12)
    times = dict.fromkeys(state.presets, CAPTURED)

    jobs, _, _ = plan_jobs(times, state, settings, NOW)

    full = [j for j in jobs if not j.thumbnail]
    assert len(full) == 2  # 12 training presets / 6 cycles per hour


def test_full_image_is_due_again_after_an_hour(settings: Settings) -> None:
    state = _state(n_presets=2, n_training=2)
    times = dict.fromkeys(state.presets, CAPTURED)
    state.last_full = {"P0": NOW - timedelta(minutes=58), "P1": NOW - timedelta(minutes=20)}

    jobs, _, _ = plan_jobs(times, state, settings, NOW)

    assert [j.preset_id for j in jobs if not j.thumbnail] == ["P0"]


def test_frozen_cameras_are_skipped_entirely(settings: Settings) -> None:
    # e.g. C1457409 on 24 Nov 2026: latest image from 20 Nov, a 9.9 KB placeholder.
    state = _state(n_presets=3, n_training=3)
    times = {"P0": CAPTURED, "P1": NOW - timedelta(days=4), "P2": NOW - timedelta(minutes=61)}

    jobs, unchanged, frozen = plan_jobs(times, state, settings, NOW)

    assert {j.preset_id for j in jobs} == {"P0"}  # thumbnail and full image of P0 only
    assert frozen == 2
    assert unchanged == 0


def test_next_boundary_is_the_next_ten_minute_mark() -> None:
    assert next_boundary(NOW, 600) == datetime(2026, 11, 24, 6, 10, tzinfo=UTC)
