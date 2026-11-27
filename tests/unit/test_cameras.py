import pytest

from keli.digitraffic.models import (
    CameraStationsResponse,
    WeatherStationsResponse,
    to_cameras,
    to_weather_stations,
)
from keli.ingest.cameras import collecting_presets, haversine_km, training_presets
from tests.conftest import fixture_bytes

CAMERAS = to_cameras(
    CameraStationsResponse.model_validate_json(fixture_bytes("camera_stations.json"))
)
STATIONS = to_weather_stations(
    WeatherStationsResponse.model_validate_json(fixture_bytes("weather_stations.json"))
)


def test_haversine_helsinki_to_tampere() -> None:
    assert haversine_km(60.1699, 24.9384, 61.4978, 23.7610) == pytest.approx(160, abs=2)


def test_only_collecting_cameras_are_recorded() -> None:
    presets = collecting_presets(CAMERAS)

    assert "C0153900" not in presets  # camera removed temporarily
    assert len(presets) == 6


def test_training_presets_need_a_station_within_radius() -> None:
    # Recorded 24 Nov 2026: C01504 is 0.01 km from a station, C01503 is 4.5 km away.
    training = training_presets(CAMERAS, STATIONS, radius_km=0.5)

    assert training == {"C0150401", "C0150402", "C0150409"}


def test_larger_radius_includes_more_cameras() -> None:
    assert len(training_presets(CAMERAS, STATIONS, radius_km=5.0)) == 6
